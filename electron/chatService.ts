import { BrowserWindow, safeStorage, shell } from "electron";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { deleteSettings, getSetting, setSetting } from "./database";
import {
  formatScheduledExercisesForChat,
  getTrainingHubStatus,
  listTrainingHubActivities,
  getTrainingDashboard,
  getUpcomingWorkouts
} from "./trainingHubService";
import {
  callMcpTool,
  ensureAllMcpConnected,
  getAllMcpTools,
  getMcpServerCachedTools
} from "./mcpClientManager";
import { prefixToolName } from "./mcpToolNames";
import {
  getChatWorkoutTools,
  handleChatWorkoutTool,
  isChatWorkoutTool,
  uploadPlanDraftById,
  confirmWorkoutDeleteById,
  type ChatWorkoutToolName
} from "./chatWorkoutTools";
import {
  getChatActivityTools,
  handleChatActivityTool,
  isChatActivityTool,
  type ChatActivityToolName
} from "./chatActivityTools";
import {
  getChatAnalyticsTools,
  handleChatAnalyticsTool,
  isChatAnalyticsTool,
  type ChatAnalyticsToolName
} from "./chatAnalyticsTools";
import {
  getChatInteractionTools,
  handleChatInteractionTool,
  isChatInteractionTool,
  type ChatInteractionToolName
} from "./chatInteractionTools";
import { parseFunctionCallArguments } from "./chatToolArguments";
import {
  buildResponsesRequest,
  extractReasoningSummaryDelta,
  extractResponseTextDelta
} from "./chatResponsesProtocol";
import {
  detectLocalChatServersRequest,
  streamLocalChatCompletion,
  testLocalChatConnectionRequest,
  type LocalChatRuntimeConfig
} from "./localChatProvider";
import {
  ClaudeCodeProviderError,
  getClaudeCodeStatus as inspectClaudeCodeStatus,
  launchClaudeCodeLogin,
  streamClaudeCodeCompletion,
  testClaudeCodeConnection as runClaudeCodeConnectionTest
} from "./claudeCodeProvider";
import {
  CHAT_SETTINGS_KEYS,
  readChatSettingsFromStore,
  saveChatSettingsToStore,
  type ChatApiKeyStore,
  type ChatSettingsStore
} from "./chatSettingsStore";
import { getChatGptModelCandidates } from "./chatModels";
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  saveChatSession
} from "./chatHistoryStore";
import type {
  ChatAuthStatus,
  ChatSettings,
  ChatProvider,
  ClaudeCodeConnectionTest,
  ClaudeCodePermissions,
  ClaudeCodeStatus,
  CorosMcpTool,
  LocalChatDiscovery,
  LocalChatConfig,
  LocalChatConnectionTest,
  ChatMessage,
  PersistedChatEntry,
  StoredChatToken,
  TrainingHubActivity,
  TrainingHubDashboard,
  TrainingHubUpcomingWorkout,
  UploadPlanResult,
  PlanDraftPreview,
  DeleteWorkoutResult,
  UnitSystem
} from "./types";
import {
  formatDistanceValue,
  formatElevationValue,
  normalizeUnitSystem
} from "./unitSystem.js";
import {
  buildCoachInstructions,
  buildCoachSportCapabilityGuide,
  formatCoachDashboard,
  formatRecentActivityMix,
  formatUpcomingWorkoutSport
} from "./chatCoachContext";

// =========================================================================
// OpenAI "Sign in with ChatGPT" provider details.
//
// ⚠️ These reuse OpenAI's Codex OAuth client + undocumented ChatGPT backend
// endpoints. They are a grey area under OpenAI's Terms and can change without
// notice. Everything provider-specific (endpoints, headers, request body,
// SSE extraction) is deliberately confined to this section + buildResponses
// Request/extractDelta so it can be adapted or swapped for a BYOK path.
// =========================================================================
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OAUTH_SCOPE = "openid profile email offline_access";
const LOOPBACK_PORT = 1455;
const LOOPBACK_REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/auth/callback`;

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
// Max agent rounds: each round is one model response; if it calls COROS tools
// we execute them and loop, until it answers with no further tool calls.
const MAX_TOOL_ROUNDS = 10;
const RESPONSES_ORIGINATOR = "codex_cli_rs";
const RESPONSES_USER_AGENT = "codex_cli_rs";

const COACH_INSTRUCTIONS = buildCoachInstructions();

// Settings keys (encrypted blob + a plaintext timestamp).
const SETTINGS = {
  token: "chat.oauthToken",
  authUpdatedAt: "chat.authUpdatedAt",
  model: "chat.model"
} as const;

// requestId -> AbortController for in-flight streams.
const activeStreams = new Map<string, AbortController>();

// ----- Provider settings -----

export function getChatSettings(): ChatSettings {
  return readChatSettingsFromStore(chatSettingsStore, localApiKeyStore);
}

export function saveChatSettings(settings: ChatSettings): ChatSettings {
  return saveChatSettingsToStore(
    chatSettingsStore,
    localApiKeyStore,
    settings
  );
}

export async function getClaudeCodeConnectionStatus(): Promise<ClaudeCodeStatus> {
  const settings = getChatSettings();
  const status = await inspectClaudeCodeStatus(
    settings.claudeCode.executablePath
  );
  recordClaudeCodeStatus(status);
  return status;
}

export async function connectClaudeCode(): Promise<ClaudeCodeStatus> {
  const settings = getChatSettings();
  const status = await launchClaudeCodeLogin(
    settings.claudeCode.executablePath
  );
  recordClaudeCodeStatus(status);
  return status;
}

export async function testClaudeCodeConnection(): Promise<ClaudeCodeConnectionTest> {
  const settings = getChatSettings();
  const result = await runClaudeCodeConnectionTest(
    settings.claudeCode.executablePath
  );
  recordClaudeCodeStatus(result.status);
  return result;
}

function recordClaudeCodeStatus(status: ClaudeCodeStatus): void {
  const current = getChatSettings();
  saveChatSettings({
    ...current,
    claudeCode: {
      ...current.claudeCode,
      executablePath:
        current.claudeCode.executablePath || status.executablePath,
      lastConnectionStatus: status.state,
      lastCheckedAt: status.checkedAt
    }
  });
}

export function listChatSessionsForProvider(provider: ChatProvider) {
  return listChatSessions(provider);
}

export function getChatSessionEntries(id: string) {
  return getChatSession(id);
}

export function createChatSessionForProvider(provider: ChatProvider) {
  return createChatSession(provider);
}

export function saveChatSessionEntries(
  id: string,
  entries: PersistedChatEntry[]
) {
  return saveChatSession(id, entries);
}

export function deleteChatSessionById(id: string): void {
  deleteChatSession(id);
}

export async function testLocalChatConnection(
  config?: LocalChatConfig
): Promise<LocalChatConnectionTest> {
  const saved = getLocalConfig();
  const runtime = getLocalRuntimeConfig({
    ...saved,
    ...config,
    baseUrl: config?.baseUrl ?? saved.baseUrl,
    model: config?.model ?? saved.model,
    toolsEnabled: config?.toolsEnabled ?? saved.toolsEnabled,
    hasApiKey: saved.hasApiKey,
    apiKey:
      typeof config?.apiKey === "string" && config.apiKey.trim()
        ? config.apiKey.trim()
        : readStoredLocalApiKey()
  });
  return testLocalChatConnectionRequest(runtime);
}

export async function detectLocalChatServers(
  apiKey?: string
): Promise<LocalChatDiscovery> {
  return detectLocalChatServersRequest(
    typeof apiKey === "string" && apiKey.trim()
      ? apiKey.trim()
      : readStoredLocalApiKey()
  );
}

function getLocalConfig(): LocalChatConfig {
  return getChatSettings().local;
}

function getLocalRuntimeConfig(config = getLocalConfig()): LocalChatRuntimeConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey:
      typeof config.apiKey === "string" && config.apiKey.trim()
        ? config.apiKey.trim()
        : readStoredLocalApiKey(),
    toolsEnabled: config.toolsEnabled
  };
}

function storeLocalApiKey(apiKey: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure local API key storage is not available on this system.");
  }
  const encrypted = safeStorage.encryptString(apiKey).toString("base64");
  setSetting(CHAT_SETTINGS_KEYS.localApiKey, encrypted);
}

function readStoredLocalApiKey(): string | undefined {
  const encoded = getSetting(CHAT_SETTINGS_KEYS.localApiKey);
  if (!encoded || !safeStorage.isEncryptionAvailable()) {
    return undefined;
  }
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return undefined;
  }
}

const chatSettingsStore: ChatSettingsStore = {
  get: getSetting,
  set: setSetting,
  delete: deleteSettings
};

const localApiKeyStore: ChatApiKeyStore = {
  hasApiKey: () => Boolean(getSetting(CHAT_SETTINGS_KEYS.localApiKey)),
  saveApiKey: storeLocalApiKey,
  clearApiKey: () => deleteSettings([CHAT_SETTINGS_KEYS.localApiKey])
};

// ----- Auth status -----

export function getChatAuthStatus(): ChatAuthStatus {
  const token = getStoredToken();
  if (!token) {
    return { signedIn: false };
  }
  return { signedIn: true, email: token.email, expiresAt: token.expires_at };
}

export function logoutChat(): ChatAuthStatus {
  for (const controller of activeStreams.values()) {
    controller.abort();
  }
  activeStreams.clear();
  deleteSettings([SETTINGS.token, SETTINGS.authUpdatedAt, SETTINGS.model]);
  return { signedIn: false };
}

// ----- OAuth (Authorization Code + PKCE, loopback redirect) -----

export async function loginChat(
  parentWindow?: BrowserWindow
): Promise<ChatAuthStatus> {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(
    crypto.createHash("sha256").update(verifier).digest()
  );
  const state = base64Url(crypto.randomBytes(16));

  const authUrl = new URL(OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", LOOPBACK_REDIRECT_URI);
  authUrl.searchParams.set("scope", OAUTH_SCOPE);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("id_token_add_organizations", "true");
  authUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authUrl.searchParams.set("state", state);

  const code = await waitForAuthorizationCode(
    authUrl.toString(),
    state,
    parentWindow
  );
  const token = await exchangeAuthorizationCode(code, verifier);
  storeToken(token);
  return getChatAuthStatus();
}

function waitForAuthorizationCode(
  authUrl: string,
  state: string,
  parentWindow?: BrowserWindow
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let authWindow: BrowserWindow | undefined;

    const server = http.createServer((request, response) => {
      if (!request.url) {
        return;
      }
      const callbackUrl = new URL(request.url, LOOPBACK_REDIRECT_URI);
      if (callbackUrl.pathname !== "/auth/callback") {
        response.writeHead(404);
        response.end();
        return;
      }

      const error = callbackUrl.searchParams.get("error");
      const receivedState = callbackUrl.searchParams.get("state");
      const code = callbackUrl.searchParams.get("code");

      response.writeHead(200, { "Content-Type": "text/html" });
      if (error) {
        response.end("<p>ChatGPT sign-in failed. You can close this window.</p>");
        rejectOnce(new Error(error));
        return;
      }
      if (receivedState !== state || !code) {
        response.end("<p>ChatGPT sign-in failed. You can close this window.</p>");
        rejectOnce(new Error("ChatGPT OAuth state mismatch."));
        return;
      }
      response.end("<p>Signed in to ChatGPT. You can close this window.</p>");
      resolveOnce(code);
    });

    const cleanup = () => {
      try {
        server.close();
      } catch {
        // Already closing after an error path.
      }
      if (authWindow && !authWindow.isDestroyed()) {
        setTimeout(() => authWindow?.close(), 300);
      }
    };
    const resolveOnce = (code: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    server.on("error", (error) => rejectOnce(error as Error));
    server.listen(LOOPBACK_PORT, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      if (address.port !== LOOPBACK_PORT) {
        rejectOnce(new Error("ChatGPT OAuth callback port did not bind."));
        return;
      }
      authWindow = new BrowserWindow({
        width: 520,
        height: 720,
        title: "Sign in with ChatGPT",
        parent: parentWindow,
        modal: Boolean(parentWindow),
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });
      authWindow.on("closed", () => {
        authWindow = undefined;
        rejectOnce(new Error("ChatGPT sign-in window was closed."));
      });
      // Some OpenAI flows hop to an external verification page; keep it in-window.
      authWindow.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: "deny" };
      });
      void authWindow.loadURL(authUrl);
    });
  });
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string
): Promise<StoredChatToken> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: LOOPBACK_REDIRECT_URI,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: verifier
    }).toString()
  });
  const payload = (await response.json().catch(() => ({}))) as OAuthTokenResponse & {
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `ChatGPT token exchange failed (${response.status}).`
    );
  }
  return toStoredToken(payload, undefined);
}

async function refreshAccessToken(
  existing: StoredChatToken
): Promise<StoredChatToken> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: existing.refresh_token,
      client_id: OAUTH_CLIENT_ID,
      scope: OAUTH_SCOPE
    }).toString()
  });
  const payload = (await response.json().catch(() => ({}))) as OAuthTokenResponse & {
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    // invalid_grant => the session is dead; force a fresh login.
    const err = new Error("ChatGPT session expired. Please sign in again.");
    (err as Error & { authError?: boolean }).authError = true;
    throw err;
  }
  return toStoredToken(payload, existing);
}

function toStoredToken(
  payload: OAuthTokenResponse,
  previous?: StoredChatToken
): StoredChatToken {
  const claims = payload.id_token
    ? decodeJwtClaims(payload.id_token)
    : undefined;
  const authClaim = claims?.["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string }
    | undefined;
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || previous?.refresh_token || "",
    id_token: payload.id_token ?? previous?.id_token,
    account_id: authClaim?.chatgpt_account_id ?? previous?.account_id,
    email: (claims?.email as string | undefined) ?? previous?.email,
    token_type: payload.token_type ?? previous?.token_type ?? "Bearer",
    expires_at:
      Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600)
  };
}

/** Returns a non-expired access token, refreshing proactively when close. */
async function getValidToken(): Promise<StoredChatToken> {
  const token = getStoredToken();
  if (!token) {
    const err = new Error("Sign in with ChatGPT first.");
    (err as Error & { authError?: boolean }).authError = true;
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  if (token.expires_at - now < 60 && token.refresh_token) {
    const refreshed = await refreshAccessToken(token);
    storeToken(refreshed);
    return refreshed;
  }
  return token;
}

// ----- Encrypted token persistence (safeStorage, like trainingHubService) -----

function storeToken(token: StoredChatToken): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Degrade rather than crash; the user stays signed in for this session only
    // via the in-memory return values, but nothing persists.
    return;
  }
  const encrypted = safeStorage
    .encryptString(JSON.stringify(token))
    .toString("base64");
  setSetting(SETTINGS.token, encrypted);
  setSetting(SETTINGS.authUpdatedAt, new Date().toISOString());
}

function getStoredToken(): StoredChatToken | null {
  const encoded = getSetting(SETTINGS.token);
  if (!encoded || !safeStorage.isEncryptionAvailable()) {
    return null;
  }
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    const parsed = JSON.parse(decrypted) as StoredChatToken;
    return parsed.access_token ? parsed : null;
  } catch {
    return null;
  }
}

// ----- Streaming chat -----

export async function streamChat(
  mainWindow: BrowserWindow | null | undefined,
  requestId: string,
  messages: ChatMessage[],
  unitSystem: UnitSystem = "metric"
): Promise<void> {
  unitSystem = normalizeUnitSystem(unitSystem);
  const send = (channel: string, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  const controller = new AbortController();
  activeStreams.set(requestId, controller);
  // Abort if the window goes away mid-stream.
  const onClosed = () => controller.abort();
  mainWindow?.once("closed", onClosed);

  let fullText = "";
  try {
    const settings = getChatSettings();
    if (settings.provider === "claude-code") {
      const status = await inspectClaudeCodeStatus(
        settings.claudeCode.executablePath
      );
      recordClaudeCodeStatus(status);
      if (!status.authenticated || !status.executablePath) {
        throw new ClaudeCodeProviderError(
          status.message,
          status.installed ? "auth" : "not-installed"
        );
      }

      await ensureAllMcpConnected();
      const chatTools = getClaudeCodeTools(settings.claudeCode.permissions);
      const { text: instructions, hasData } = await buildTrainingContext(
        settings.claudeCode.permissions,
        unitSystem
      );
      const effectiveInstructions = withLiveToolInstructions(
        instructions,
        chatTools
      );

      send("chat:streamStart", { requestId });
      send("chat:streamInfo", {
        requestId,
        kind: "context",
        snapshotIncluded: hasData,
        mcpEnabled: chatTools.length > 0
      });

      const result = await streamClaudeCodeCompletion({
        executablePath: status.executablePath,
        instructions: effectiveInstructions,
        messages,
        tools: chatTools,
        signal: controller.signal,
        model: settings.claudeCode.model,
        onToken: (delta) => {
          fullText += delta;
          send("chat:streamToken", { requestId, delta });
        },
        onThinking: (delta) => {
          send("chat:streamInfo", { requestId, kind: "thinking", delta });
        },
        onToolCallStart: (toolName) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: toolName,
            status: "call"
          });
        },
        onToolCallError: (toolName, message) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: toolName,
            status: "failed",
            message
          });
        },
        onToolCall: async (toolName, args) => {
          if (!chatTools.some((tool) => tool.name === toolName)) {
            throw new Error(`Claude attempted an unapproved tool: ${toolName}`);
          }
          return executeChatTool(
            toolName,
            args,
            send,
            requestId,
            unitSystem,
            settings.claudeCode.permissions
          );
        }
      });
      fullText = result.fullText;
      recordClaudeCodeStatus({
        ...status,
        state: "connected",
        checkedAt: new Date().toISOString(),
        message: "Claude Code is connected and ready for Coach conversations."
      });
      send("chat:streamDone", { requestId, fullText });
      return;
    }

    if (settings.provider === "local") {
      const { text: instructions, hasData } = await buildTrainingContext(
        undefined,
        unitSystem
      );
      const runtimeConfig = getLocalRuntimeConfig(settings.local);

      if (runtimeConfig.toolsEnabled) {
        await ensureAllMcpConnected();
      }
      const chatTools = runtimeConfig.toolsEnabled
        ? getAllChatTools()
        : [...getChatWorkoutTools(), ...getChatInteractionTools()];
      const effectiveInstructions = withLiveToolInstructions(
        instructions,
        chatTools
      );

      send("chat:streamStart", { requestId });
      send("chat:streamInfo", {
        requestId,
        kind: "context",
        snapshotIncluded: hasData,
        mcpEnabled: chatTools.length > 0
      });

      const result = await streamLocalChatCompletion({
        config: runtimeConfig,
        instructions: effectiveInstructions,
        fallbackInstructions: instructions,
        messages,
        tools: chatTools,
        maxToolRounds: MAX_TOOL_ROUNDS,
        signal: controller.signal,
        onToken: (delta) => {
          fullText += delta;
          send("chat:streamToken", { requestId, delta });
        },
        onToolsDisabled: () => {
          send("chat:streamInfo", {
            requestId,
            kind: "context",
            snapshotIncluded: hasData,
            mcpEnabled: false
          });
        },
        onToolCallStart: (call) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: call.name,
            status: "call"
          });
        },
        onToolCallError: (call, message) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: call.name,
            status: "failed",
            message
          });
        },
        onToolCall: async (call) => {
          const tool = findChatTool(call.name);
          const args = parseFunctionCallArguments(call, tool);
          console.log("[chat] tool call:", call.name);
          return executeChatTool(call.name, args, send, requestId, unitSystem);
        }
      });
      fullText = result.fullText;
      send("chat:streamDone", { requestId, fullText });
      return;
    }

    const token = await getValidToken();
    const { text: instructions, hasData } = await buildTrainingContext(
      undefined,
      unitSystem
    );

    // Reconnect a previously-authorized COROS MCP session, then expose its tools
    // to the model as function tools so it can pull data on demand.
    await ensureAllMcpConnected();
    const tools = buildChatFunctionTools();

    // When live tools are available, steer the model to use them rather than
    // leaning on the brief snapshot in `instructions`.
    const effectiveInstructions = withLiveToolInstructions(
      instructions,
      getAllChatTools()
    );

    send("chat:streamStart", { requestId });
    send("chat:streamInfo", {
      requestId,
      kind: "context",
      snapshotIncluded: hasData,
      mcpEnabled: tools.length > 0
    });

    // Responses-API input items, extended each round with the model's tool calls
    // and our tool results.
    const input: Record<string, unknown>[] = messages.map(toInputMessageItem);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const opened = await resolveModelAndOpenStream(
        token,
        requestId,
        effectiveInstructions,
        input,
        tools,
        controller.signal,
        settings.chatgpt.model
      );
      if ("error" in opened) {
        send("chat:streamError", {
          requestId,
          message: opened.error,
          authError: opened.authError
        });
        return;
      }

      const reader = opened.response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const functionCalls: FunctionCall[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; keep the trailing partial.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = extractSseData(frame);
          if (data === null || data === "[DONE]") continue;
          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            continue; // ignore partial/non-JSON frames
          }
          // Diagnostic: confirm the backend accepted our tools (echoed back on
          // the response.created event) rather than silently stripping them.
          if (
            (event as { type?: string }).type === "response.created" &&
            tools.length > 0
          ) {
            const echoed = (event as { response?: { tools?: unknown[] } }).response
              ?.tools;
            console.log(
              "[chat] tools sent:",
              tools.length,
              "· accepted by backend:",
              Array.isArray(echoed) ? echoed.length : "unknown"
            );
          }
          const reasoningDelta = extractReasoningSummaryDelta(event);
          if (reasoningDelta) {
            send("chat:streamInfo", {
              requestId,
              kind: "thinking",
              delta: reasoningDelta
            });
            continue;
          }
          const delta = extractResponseTextDelta(event);
          if (delta) {
            fullText += delta;
            send("chat:streamToken", { requestId, delta });
            continue;
          }
          const call = extractFunctionCall(event);
          if (call) functionCalls.push(call);
        }
      }

      // No tool calls this round → the model answered; we're done.
      if (functionCalls.length === 0) break;

      // Echo the calls back into the conversation, execute each against COROS,
      // append the results, and loop for the model to use them.
      for (const call of functionCalls) {
        input.push({
          type: "function_call",
          call_id: call.call_id,
          name: call.name,
          arguments: call.arguments
        });
      }
      for (const call of functionCalls) {
        send("chat:streamInfo", {
          requestId,
          kind: "mcp",
          tool: call.name,
          status: "call"
        });
        let output: string;
        try {
          const sourceTool = findChatTool(call.name);
          const args = parseFunctionCallArguments(call, sourceTool);
          output = await executeChatTool(
            call.name,
            args,
            send,
            requestId,
            unitSystem
          );
        } catch (toolError) {
          output =
            "Error: " +
            (toolError instanceof Error ? toolError.message : "tool call failed");
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: call.name,
            status: "failed",
            message: output
          });
        }
        console.log("[chat] COROS tool call:", call.name);
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output
        });
      }
    }

    send("chat:streamDone", { requestId, fullText });
  } catch (error) {
    if (controller.signal.aborted) {
      send("chat:streamDone", { requestId, fullText, finishReason: "cancelled" });
    } else {
      if (getChatSettings().provider === "claude-code") {
        const current = getChatSettings().claudeCode;
        const failure =
          error instanceof ClaudeCodeProviderError ? error.kind : "connection";
        recordClaudeCodeStatus({
          state:
            failure === "usage-limit"
              ? "usage-limit-reached"
              : failure === "auth"
                ? "sign-in-required"
                : failure === "not-installed"
                  ? "not-installed"
                  : "connection-failed",
          installed: failure !== "not-installed",
          authenticated: failure !== "auth" && failure !== "not-installed",
          executablePath: current.executablePath,
          checkedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : "Claude request failed."
        });
      }
      const authError = Boolean(
        (error as Error & { authError?: boolean }).authError
      );
      send("chat:streamError", {
        requestId,
        message: error instanceof Error ? error.message : "Chat request failed.",
        authError
      });
    }
  } finally {
    mainWindow?.removeListener("closed", onClosed);
    activeStreams.delete(requestId);
  }
}

export function cancelChat(requestId: string): void {
  activeStreams.get(requestId)?.abort();
  activeStreams.delete(requestId);
}

export async function uploadTrainingPlanDraft(
  draftId: string,
  unitSystem: UnitSystem = "metric",
  destination: import("./types").TrainingPlanDestination = "workoutLibrary",
  scheduleDate?: string
): Promise<UploadPlanResult> {
  return uploadPlanDraftById(
    draftId,
    normalizeUnitSystem(unitSystem),
    destination,
    scheduleDate
  );
}

export async function confirmWorkoutDelete(
  requestId: string
): Promise<DeleteWorkoutResult> {
  return confirmWorkoutDeleteById(requestId);
}

function getAllChatTools(): CorosMcpTool[] {
  return [
    ...getAllMcpTools(),
    ...getChatActivityTools(),
    ...getChatAnalyticsTools(),
    ...getChatWorkoutTools(),
    ...getChatInteractionTools()
  ];
}

const CLAUDE_REMOTE_READ_TOOLS: Record<
  keyof ClaudeCodePermissions,
  readonly string[]
> = {
  recentActivities: [
    "get_recent_activities",
    "get_activity_details",
    "get_activity_detail"
  ],
  trainingMetrics: [
    "get_training_metrics",
    "get_fitness_metrics",
    "get_recovery_metrics",
    "get_training_load"
  ],
  upcomingWorkouts: ["get_upcoming_workouts", "get_training_calendar"],
  sleepData: ["get_sleep_summary", "get_sleep_data"],
  fullActivityFiles: []
};

export function getClaudeCodeTools(
  permissions: ClaudeCodePermissions
): CorosMcpTool[] {
  const remoteAllowedNames = new Set<string>();
  for (const [permission, names] of Object.entries(CLAUDE_REMOTE_READ_TOOLS)) {
    if (permissions[permission as keyof ClaudeCodePermissions]) {
      for (const name of names) remoteAllowedNames.add(name);
    }
  }

  // COROS remote tools are permission-gated by their (unprefixed) names, then
  // exposed prefixed. Other MCP servers the user configured are exposed in full.
  const remoteTools = [
    ...getMcpServerCachedTools("coros")
      .filter((tool) => remoteAllowedNames.has(tool.name))
      .map((tool) => ({ ...tool, name: prefixToolName("coros", tool.name) })),
    ...getAllMcpTools().filter((tool) => !tool.name.startsWith("coros__"))
  ];
  const activityTools = permissions.recentActivities
    ? getChatActivityTools()
    : [];
  const analyticsTools = permissions.trainingMetrics
    ? getChatAnalyticsTools()
    : [];
  const workoutTools = getChatWorkoutTools().filter((tool) => {
    if (
      tool.name === "upload_training_plan" ||
      tool.name === "list_scheduled_workouts" ||
      tool.name === "delete_workout"
    ) {
      return permissions.upcomingWorkouts;
    }
    return (
      tool.name === "draft_workout" ||
      tool.name === "draft_training_plan" ||
      tool.name === "search_coros_exercises"
    );
  });

  return [
    ...remoteTools,
    ...activityTools,
    ...analyticsTools,
    ...workoutTools,
    ...getChatInteractionTools()
  ];
}

async function executeChatTool(
  name: string,
  args: Record<string, unknown>,
  send: (channel: string, payload: unknown) => void,
  requestId: string,
  unitSystem: UnitSystem,
  claudePermissions?: ClaudeCodePermissions
): Promise<string> {
  if (isChatInteractionTool(name)) {
    return handleChatInteractionTool(
      name as ChatInteractionToolName,
      args,
      (prompt) => {
        send("chat:streamInfo", {
          requestId,
          kind: "coachPrompt",
          prompt
        });
      }
    );
  }
  if (isChatWorkoutTool(name)) {
    return handleChatWorkoutTool(name as ChatWorkoutToolName, args, {
      onPlanDraft: (preview: PlanDraftPreview) => {
        send("chat:streamInfo", {
          requestId,
          kind: "planDraft",
          draft: preview
        });
      },
      onWorkoutDelete: (preview) => {
        send("chat:streamInfo", {
          requestId,
          kind: "workoutDelete",
          preview
        });
      },
      allowUpcomingWorkouts: claudePermissions?.upcomingWorkouts !== false,
      unitSystem
    });
  }
  if (isChatActivityTool(name)) {
    try {
      return await handleChatActivityTool(name as ChatActivityToolName, args, {
        requestId,
        onActivityVisual: (preview) => {
          send("chat:streamInfo", {
            requestId,
            kind: "activityVisual",
            preview
          });
        },
        unitSystem
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : String(caught);
      send("chat:streamInfo", {
        requestId,
        kind: "mcp",
        tool: name,
        status: "failed",
        message
      });
      throw caught;
    }
  }
  if (isChatAnalyticsTool(name)) {
    try {
      return await handleChatAnalyticsTool(name as ChatAnalyticsToolName, args, {
        requestId,
        onFitnessTrend: (preview) => {
          send("chat:streamInfo", {
            requestId,
            kind: "fitnessTrend",
            preview
          });
        },
        onHrZoneSummary: (preview) => {
          send("chat:streamInfo", {
            requestId,
            kind: "hrZoneSummary",
            preview
          });
        },
        unitSystem
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : String(caught);
      send("chat:streamInfo", {
        requestId,
        kind: "mcp",
        tool: name,
        status: "failed",
        message
      });
      throw caught;
    }
  }
  try {
    return await callMcpTool(name, args);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    send("chat:streamInfo", {
      requestId,
      kind: "mcp",
      tool: name,
      status: "failed",
      message
    });
    throw caught;
  }
}

function findChatTool(name: string): CorosMcpTool | undefined {
  return getAllChatTools().find((tool) => tool.name === name);
}

// ----- Provider request/response shape (isolated) -----

/**
 * Sends the request with the selected model. Auto mode tries candidates until
 * the account accepts one (the ChatGPT-plan codex endpoint rejects unsupported
 * models with a 400 before streaming), then caches the working model.
 */
async function resolveModelAndOpenStream(
  token: StoredChatToken,
  requestId: string,
  instructions: string,
  input: Record<string, unknown>[],
  tools: Record<string, unknown>[],
  signal: AbortSignal,
  selectedModel?: string
): Promise<{ response: Response } | { error: string; authError: boolean }> {
  const cached = getSetting(SETTINGS.model);
  const candidates = getChatGptModelCandidates(selectedModel, cached);

  let lastDetail = "";
  for (const model of candidates) {
    const open = (includeReasoningSummary: boolean) =>
      fetch(RESPONSES_URL, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "OpenAI-Beta": "responses=experimental",
          originator: RESPONSES_ORIGINATOR,
          "User-Agent": RESPONSES_USER_AGENT,
          session_id: requestId,
          ...(token.account_id ? { "chatgpt-account-id": token.account_id } : {})
        },
        body: JSON.stringify(
          buildResponsesRequest(
            model,
            instructions,
            input,
            tools,
            includeReasoningSummary
          )
        )
      });

    let response = await open(true);
    let responseDetail = "";
    if (!response.ok && response.status === 400) {
      responseDetail = await response.text().catch(() => "");
      if (/reasoning|summary/i.test(responseDetail)) {
        // Some plan/model combinations do not expose summaries. Preserve the
        // Coach response and tool progress rather than failing the whole turn.
        response = await open(false);
        responseDetail = "";
      }
    }

    if (response.ok && response.body) {
      if (model !== cached) setSetting(SETTINGS.model, model);
      return { response };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        error: "ChatGPT session rejected. Please sign in again.",
        authError: true
      };
    }

    lastDetail =
      responseDetail || (await response.text().catch(() => ""));
    // Unsupported-model rejection: drop a stale cached choice and try the next.
    if (response.status === 400 && /is not supported/i.test(lastDetail)) {
      if (model === cached) deleteSettings([SETTINGS.model]);
      continue;
    }
    return {
      error: `Chat request failed (${response.status}). ${truncate(lastDetail, 600)}`,
      authError: false
    };
  }

  return {
    error: selectedModel?.trim()
      ? `The selected model (${selectedModel.trim()}) is not available for this ChatGPT account. ${truncate(lastDetail, 600)}`
      : `No supported chat model for this ChatGPT account. ${truncate(lastDetail, 600)}`,
    authError: false
  };
}

/** A COROS message turned into a Responses-API input item. */
function toInputMessageItem(message: ChatMessage): Record<string, unknown> {
  return {
    type: "message",
    role: message.role,
    content: [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content
      }
    ]
  };
}

/** Exposes connected MCP and local workout tools to the model as functions. */
function buildChatFunctionTools(): Record<string, unknown>[] {
  return getAllChatTools().map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
    strict: false
  }));
}

function withLiveToolInstructions(
  instructions: string,
  tools: CorosMcpTool[]
): string {
  if (tools.length === 0) {
    return instructions;
  }
  const activityTools = tools.filter((tool) => isChatActivityTool(tool.name));
  const analyticsTools = tools.filter((tool) => isChatAnalyticsTool(tool.name));
  const interactionTools = tools.filter((tool) =>
    isChatInteractionTool(tool.name)
  );
  const mcpTools = tools.filter(
    (tool) =>
      !isChatWorkoutTool(tool.name) &&
      !isChatActivityTool(tool.name) &&
      !isChatAnalyticsTool(tool.name) &&
      !isChatInteractionTool(tool.name)
  );
  const corosMcpTools = mcpTools.filter((tool) =>
    tool.name.startsWith("coros__")
  );
  const otherMcpTools = mcpTools.filter(
    (tool) => !tool.name.startsWith("coros__")
  );
  const planTools = tools.filter((tool) => isChatWorkoutTool(tool.name));
  const sections = [instructions, "", "## Live training data and tools"];
  if (activityTools.length > 0) {
    sections.push(
      `Local Training Hub tools (preferred for laps/splits): ${activityTools
        .map((tool) => tool.name)
        .join(", ")}. ` +
        "Use list_recent_activities to find activity_id and sport_type, then " +
        "get_activity_detail for lap tables. Set include_series=true for HR/pace/power trends. " +
        "Inline activity charts (HR, pace, power, elevation, laps) appear automatically when data is available."
    );
  }
  if (analyticsTools.length > 0) {
    sections.push(
      `Training analytics tools: ${analyticsTools.map((tool) => tool.name).join(", ")}. ` +
        "Use get_fitness_trends for 7-day load, resting HR, and HRV recovery trends. " +
        "Use get_hr_zone_summary for threshold heart rate zone distribution. " +
        "Inline charts are shown automatically when these tools return data."
    );
  }
  if (corosMcpTools.length > 0) {
    sections.push(
      `COROS MCP tools: ${corosMcpTools.map((tool) => tool.name).join(", ")}. ` +
        "Use these for sleep, HRV, recovery, and other MCP-only metrics. " +
        "For lap splits and interval breakdowns, prefer get_activity_detail."
    );
  }
  if (otherMcpTools.length > 0) {
    sections.push(
      `Other connected MCP server tools: ${otherMcpTools
        .map((tool) => tool.name)
        .join(", ")}. ` +
        "Use each tool according to its own name, description, and schema. " +
        "Do not assume these tools return COROS data."
    );
  }
  if (planTools.length > 0) {
    sections.push(
      "",
      "## Workout and training plan tools",
      `Authoring tools: ${planTools.map((tool) => tool.name).join(", ")}. ` +
        "Use draft_workout for exactly one standalone workout. Its card lets the athlete choose Workout Library or Calendar; set calendar_date only when the athlete names a date. " +
        "Use draft_training_plan only for multi-day or multi-week schedules. Never wrap a one-off workout in a plan. " +
        "Before drafting Strength or HYROX workouts, call search_coros_exercises once with all intended " +
        "exercise queries, or with target muscles, movement patterns, and known equipment; then use the " +
        "returned exact exercise IDs and names. A COROS naming mismatch alone never requires an athlete question. " +
        "For Strength exercises, set sets explicitly, use target_reps or target_duration_seconds per set, " +
        "and set rest_type=1 plus rest_value in seconds. Do not hide the prescription only in the step name. " +
        "Always provide sport on every new workout, including sport=run. " +
        "Use distance_km only for a simple Run or Trail Run; use steps for anything structured. " +
        "Pick each step's target " +
        "deliberately: distance for easy/long/tempo blocks, time for duration-based reps " +
        "and recovery jogs, load only when prescribing by training-load budget, and open " +
        "(no value, run-until-lap) for by-feel warmups/cooldowns or fartlek surges. Put every " +
        "prescribed HR, pace, effort pace, power, cadence, stroke, weight, RPE, or grade in " +
        "the typed intensity field; do not leave it only in workout prose or the name. " +
        "For draft_training_plan entries intended for calendar placement, include schedule_date " +
        "(YYYYMMDD). A multi-workout draft is saved as a grouped local Training Plan by default; the athlete may instead choose individual COROS workouts or Calendar. " +
        "The athlete must confirm the destination and any one-off workout date before saving. " +
        "Use list_scheduled_workouts + delete_workout to stage deletions. " +
        "The athlete confirms via the Delete from COROS button in chat.",
      "",
      "Supported workout capabilities (generated from the validator):",
      buildCoachSportCapabilityGuide()
    );
  }
  if (interactionTools.length > 0) {
    sections.push(
      "",
      "## Athlete questions",
      "When you need an answer before continuing, call request_coach_input with one concise question and 2–5 distinct choices. " +
        "Put the recommended choice first and explain important tradeoffs in each choice description. " +
        "Do not ask a clarification question only in prose. After calling request_coach_input, stop and wait for the athlete's next message."
    );
  }
  return sections.join("\n");
}

interface FunctionCall {
  call_id: string;
  name: string;
  arguments: string;
}

/** Detects a completed function tool call in a Responses-API SSE event. */
function extractFunctionCall(event: unknown): FunctionCall | null {
  if (!event || typeof event !== "object") return null;
  const evt = event as {
    type?: string;
    item?: { type?: string; call_id?: string; name?: string; arguments?: string };
  };
  if (
    evt.type === "response.output_item.done" &&
    evt.item?.type === "function_call" &&
    evt.item.call_id &&
    evt.item.name
  ) {
    return {
      call_id: evt.item.call_id,
      name: evt.item.name,
      arguments: evt.item.arguments ?? ""
    };
  }
  return null;
}

function extractSseData(frame: string): string | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return dataLines.join("");
}

// ----- Training-data context assembly -----

async function buildTrainingContext(
  permissions?: ClaudeCodePermissions,
  unitSystem: UnitSystem = "metric"
): Promise<{ text: string; hasData: boolean }> {
  const unitInstruction =
    `The athlete selected ${unitSystem === "imperial" ? "Imperial" : "Metric"} units. ` +
    `Use ${unitSystem === "imperial" ? "miles, feet, min/mi, mph, pounds, and yards for swims" : "kilometres, metres, min/km, km/h, and kilograms"} in every user-facing answer and tool summary. ` +
    "Keep tool-schema distance, elevation, pace, and weight fields canonical internally; do not reinterpret their numeric values.";
  let status: Awaited<ReturnType<typeof getTrainingHubStatus>>;
  try {
    status = getTrainingHubStatus();
  } catch {
    status = { authenticated: false };
  }
  if (!status.authenticated) {
    return {
      hasData: false,
      text:
        `${COACH_INSTRUCTIONS}\n\n${unitInstruction}\n\n` +
        "NOTE: The athlete is not signed in to COROS Training Hub, so no training " +
        "data is available. Encourage them to connect it for personalised advice."
    };
  }

  const includeActivities = permissions?.recentActivities !== false;
  const includeMetrics = permissions?.trainingMetrics !== false;
  const includeUpcoming = permissions?.upcomingWorkouts !== false;
  const [activities, dashboard, upcoming] = await Promise.allSettled([
    includeActivities
      ? listTrainingHubActivities(1, 25)
      : Promise.resolve([] as TrainingHubActivity[]),
    includeMetrics
      ? getTrainingDashboard()
      : Promise.resolve(null as TrainingHubDashboard | null),
    includeUpcoming
      ? getUpcomingWorkouts(14)
      : Promise.resolve([] as TrainingHubUpcomingWorkout[])
  ]);

  const sections: string[] = [COACH_INSTRUCTIONS, "", unitInstruction, ""];
  let hasData = false;

  if (activities.status === "fulfilled" && activities.value.length > 0) {
    sections.push(`## Recent activity mix (latest ${activities.value.length})`);
    sections.push(formatRecentActivityMix(activities.value, unitSystem));
    sections.push("");
    sections.push("## Recent activities");
    sections.push(formatActivities(activities.value.slice(0, 8), unitSystem));
    sections.push("");
    hasData = true;
  }
  if (dashboard.status === "fulfilled" && dashboard.value) {
    const fitness = formatCoachDashboard(dashboard.value);
    if (fitness) {
      sections.push("## Fitness & recovery");
      sections.push(fitness);
      sections.push("");
      hasData = true;
    }
  }
  if (upcoming.status === "fulfilled" && upcoming.value.length > 0) {
    sections.push("## Upcoming workouts");
    sections.push(formatUpcoming(upcoming.value, unitSystem));
    sections.push("");
    hasData = true;
  }

  if (permissions && !hasData) {
    sections.push(
      "The athlete's current Claude privacy settings did not include a training " +
        "snapshot for this request. Do not infer private COROS values."
    );
  }

  return { text: sections.join("\n").trim(), hasData };
}

function formatActivities(
  activities: TrainingHubActivity[],
  unitSystem: UnitSystem
): string {
  return activities
    .map((activity) => {
      const parts = [
        `id=${activity.activityId}`,
        `sport_type=${activity.sportType}`,
        activity.startTime ? isoDate(activity.startTime) : "",
        activity.sportName ?? "",
        activity.name ?? "",
        activity.distance
          ? formatDistanceValue(activity.distance, unitSystem, {
              swim:
                activity.sportType === 300 ||
                activity.sportType === 301 ||
                /swim/i.test(activity.sportName ?? "")
            })
          : "",
        activity.duration ? formatDurationSeconds(activity.duration) : "",
        activity.avgHr ? `avg HR ${activity.avgHr}` : "",
        activity.trainingLoad ? `load ${activity.trainingLoad}` : "",
        activity.elevationGain
          ? `+${formatElevationValue(activity.elevationGain, unitSystem)}`
          : ""
      ].filter(Boolean);
      return `- ${parts.join(" · ")}`;
    })
    .join("\n");
}

function formatUpcomingVolume(
  volume: string | undefined,
  unitSystem: UnitSystem
): string {
  const value = volume?.trim() ?? "";
  const match = value.match(/^([\d.]+)\s*(km|m)$/i);
  if (!match) return value;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return value;
  return formatDistanceValue(
    amount * (match[2]?.toLowerCase() === "km" ? 1_000 : 1),
    unitSystem,
    { swim: match[2]?.toLowerCase() === "m" }
  );
}

function formatUpcoming(
  workouts: TrainingHubUpcomingWorkout[],
  unitSystem: UnitSystem
): string {
  return workouts
    .map((workout) => {
      const exerciseDetail = workout.exercises?.length
        ? formatScheduledExercisesForChat(
            workout.exercises,
            unitSystem,
            Number(workout.sportType) === 3
          )
        : undefined;
      const parts = [
        workout.happenDay,
        formatUpcomingWorkoutSport(workout.sportType),
        workout.name,
        formatUpcomingVolume(workout.volume, unitSystem),
        workout.trainingLoad ? `load ${workout.trainingLoad}` : "",
        exerciseDetail ? `exercises: ${exerciseDetail}` : ""
      ].filter(Boolean);
      return `- ${parts.join(" · ")}`;
    })
    .join("\n");
}

// ----- Small helpers -----

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeJwtClaims(jwt: string): Record<string, unknown> | undefined {
  const segment = jwt.split(".")[1];
  if (!segment) return undefined;
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isoDate(epochSeconds: number): string {
  // COROS start times are unix seconds.
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function formatDurationSeconds(value: number): string {
  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
