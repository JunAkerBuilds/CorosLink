import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult
} from "@modelcontextprotocol/sdk/types.js";
import type { ChatModelOption } from "./chatModels";
import type {
  ChatMessage,
  CorosMcpTool,
  GeminiCliConnectionTest,
  GeminiCliStatus
} from "./types";

// Gemini CLI runs as an Agent Client Protocol (ACP) agent: JSON-RPC over
// stdio, one process per request. Coach tools reach it through a loopback MCP
// server that lives only as long as the request.

const execFileAsync = promisify(execFile);
const DETECTION_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 3 * 60_000;
// Starting a session signs in and connects the tool bridge; a first-time
// account setup can stall far longer than that ever takes.
const SESSION_START_TIMEOUT_MS = 90_000;
const MODEL_LIST_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 6 * 60_000;
// Gemini's ACP loop has no turn cap of its own in older releases.
const MAX_TOOL_CALLS = 24;
const ACP_PROTOCOL_VERSION = 1;
const MCP_SERVER_NAME = "coroslink";
const MCP_ENDPOINT = "/mcp";
const STDERR_TAIL_BYTES = 4_000;
const SIGN_IN_REQUIRED_MESSAGE =
  "Gemini CLI needs a sign-in. Use Google sign-in with a Gemini Code Assist Standard or Enterprise account, or set up a Gemini API key or Vertex AI in Gemini CLI.";

/** Never present in a workspace, so the athlete's GEMINI.md files stay out of Coach. */
const CONTEXT_FILE_NAME = "COROSLINK_COACH_CONTEXT.md";

// Coach sessions use only CorosLink's tools: no file, shell, web or memory
// tools, user hooks, skills or IDE link. Extensions are off via `-e none`.
const WORKSPACE_SETTINGS = {
  tools: { core: [] as string[] },
  context: { fileName: CONTEXT_FILE_NAME },
  skills: { enabled: false },
  hooksConfig: { enabled: false },
  ide: { enabled: false }
};

const AUTH_METHOD_LABELS: Record<string, string> = {
  "oauth-personal": "Google account",
  "gemini-api-key": "Gemini API key",
  "vertex-ai": "Vertex AI",
  "compute-default-credentials": "Cloud credentials",
  gateway: "AI gateway"
};

export type GeminiCliFailureKind =
  | "not-installed"
  | "auth"
  | "usage-limit"
  | "timeout"
  | "cancelled"
  | "connection";

export class GeminiCliProviderError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiCliFailureKind
  ) {
    super(message);
    this.name = "GeminiCliProviderError";
  }
}

export interface GeminiCliToolCallbacks {
  onToken(delta: string): void;
  onThinking?(delta: string): void;
  onToolCallStart?(toolName: string): void;
  onToolCallError?(toolName: string, message: string): void;
  onToolCall(toolName: string, args: Record<string, unknown>): Promise<string>;
}

export interface StreamGeminiCliOptions extends GeminiCliToolCallbacks {
  executablePath: string;
  /** Stable directory the CLI runs in; holds the Coach-only workspace settings. */
  workspaceDir: string;
  instructions: string;
  messages: ChatMessage[];
  tools: CorosMcpTool[];
  signal: AbortSignal;
  timeoutMs?: number;
  /** Model alias (pro/flash/flash-lite) or full id. Omit for the CLI default. */
  model?: string;
}

// ----- Detection and sign-in state -----

export function getGeminiExecutableCandidates(
  customPath?: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const candidates = [customPath?.trim()].filter(
    (value): value is string => Boolean(value)
  );

  if (platform === "win32") {
    if (env.APPDATA) {
      candidates.push(path.join(env.APPDATA, "npm", "gemini.cmd"));
    }
    candidates.push(path.join(home, ".bun", "bin", "gemini.exe"));
  } else {
    candidates.push(
      path.join(home, ".local", "bin", "gemini"),
      "/opt/homebrew/bin/gemini",
      "/usr/local/bin/gemini",
      "/usr/bin/gemini",
      path.join(home, ".npm-global", "bin", "gemini"),
      path.join(home, ".volta", "bin", "gemini"),
      path.join(home, ".bun", "bin", "gemini")
    );
  }

  return [...new Set(candidates)];
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(
      filePath,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

/** npm installs through nvm land in one bin directory per Node version, newest first. */
async function nvmCandidates(): Promise<string[]> {
  if (process.platform === "win32") return [];
  const root = path.join(os.homedir(), ".nvm", "versions", "node");
  try {
    const versions = await readdir(root);
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions.map((version) => path.join(root, version, "bin", "gemini"));
  } catch {
    return [];
  }
}

async function findGeminiOnPath(): Promise<string | undefined> {
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(command, ["gemini"], {
      timeout: 5_000,
      windowsHide: true
    });
    return stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

export async function detectGeminiCliExecutable(
  customPath?: string
): Promise<string | undefined> {
  const explicitPath = customPath?.trim();
  if (explicitPath) {
    return (await isExecutable(explicitPath)) ? explicitPath : undefined;
  }

  for (const candidate of [
    ...getGeminiExecutableCandidates(customPath),
    ...(await nvmCandidates())
  ]) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  const fromPath = await findGeminiOnPath();
  return fromPath && (await isExecutable(fromPath)) ? fromPath : undefined;
}

/**
 * The npm launcher is a `#!/usr/bin/env node` script, and apps opened from the
 * Dock get a minimal PATH, so the launcher's own directory (where npm, nvm and
 * Homebrew keep `node`) goes first.
 */
export function createGeminiEnvironment(
  executablePath: string,
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  env.PATH = [path.dirname(executablePath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  // A terminal-only theme or colour setting must not leak into piped output.
  env.NO_COLOR = "1";
  return env;
}

function geminiHome(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.GEMINI_CLI_HOME || os.homedir(), ".gemini");
}

function systemSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GEMINI_CLI_SYSTEM_SETTINGS_PATH) return env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  if (process.platform === "darwin") return "/Library/Application Support/GeminiCli/settings.json";
  if (process.platform === "win32") return "C:\\ProgramData\\gemini-cli\\settings.json";
  return "/etc/gemini-cli/settings.json";
}

/**
 * The sign-in a settings file selects. Settings are JSON with comments, so
 * this reads only the one key instead of parsing the whole file.
 */
export function parseGeminiSelectedAuthType(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("//")) continue;
    const match = line.match(/"(?:selectedType|selectedAuthType)"\s*:\s*"([a-z-]+)"/);
    if (match) return match[1];
  }
  return undefined;
}

async function readSelectedAuthType(file: string): Promise<string | undefined> {
  try {
    return parseGeminiSelectedAuthType(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Which sign-in the CLI will use, from its settings (system over user over
 * system defaults) and environment. Google sign-in counts once cached
 * credentials exist; their contents are never read.
 */
export async function getGeminiAuthState(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ method?: string; signedIn: boolean }> {
  const systemPath = systemSettingsPath(env);
  const method =
    (await readSelectedAuthType(systemPath)) ??
    (await readSelectedAuthType(path.join(geminiHome(env), "settings.json"))) ??
    (await readSelectedAuthType(path.join(path.dirname(systemPath), "system-defaults.json"))) ??
    (env.GEMINI_DEFAULT_AUTH_TYPE || undefined) ??
    (env.GEMINI_API_KEY ? "gemini-api-key" : undefined);
  if (!method) return { signedIn: false };
  if (method !== "oauth-personal") return { method, signedIn: true };
  if (env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE === "true") {
    return { method, signedIn: true };
  }
  try {
    await access(path.join(geminiHome(env), "oauth_creds.json"), fsConstants.F_OK);
    return { method, signedIn: true };
  } catch {
    return { method, signedIn: false };
  }
}

// One Google sign-in at a time; it outlives the request that started it.
let pendingLogin: Promise<void> | null = null;
let lastLoginError: string | undefined;

/**
 * Cached credentials can exist and still be refused (Google stopped serving
 * Google sign-in for individual accounts in June 2026). A refusal holds until
 * the CLI, its credentials or its settings change.
 */
let lastAuthFailure: { key: string; message: string } | undefined;

async function authFailureKey(executablePath: string): Promise<string> {
  const mtime = async (file: string) => {
    try {
      return String((await stat(file)).mtimeMs);
    } catch {
      return "-";
    }
  };
  const home = geminiHome();
  return [
    executablePath,
    await mtime(executablePath),
    await mtime(path.join(home, "oauth_creds.json")),
    await mtime(path.join(home, "settings.json")),
    await mtime(path.join(home, ".env"))
  ].join("|");
}

async function rememberAuthFailure(executablePath: string, message: string): Promise<void> {
  lastAuthFailure = { key: await authFailureKey(executablePath), message };
}

export async function getGeminiCliStatus(
  customPath?: string
): Promise<GeminiCliStatus> {
  const checkedAt = new Date().toISOString();
  const executablePath = await detectGeminiCliExecutable(customPath);
  if (!executablePath) {
    return {
      state: "not-installed",
      installed: false,
      authenticated: false,
      checkedAt,
      message:
        "Gemini CLI is not installed. Install it, sign it in, then check again."
    };
  }

  let version: string | undefined;
  try {
    version = await launcherOutput(executablePath, "--version", (stdout) =>
      stripVTControlCharacters(stdout).trim().split(/\r?\n/)[0] ?? ""
    ) || undefined;
  } catch (caught) {
    return {
      state: "connection-failed",
      installed: true,
      authenticated: false,
      executablePath,
      checkedAt,
      message: `Gemini CLI was found but could not launch: ${launchFailureMessage(caught)}`
    };
  }

  const auth = await getGeminiAuthState();
  const methodLabel = auth.method ? AUTH_METHOD_LABELS[auth.method] ?? auth.method : undefined;
  // A sign-in that rewrites the credentials changes the key, which lifts the refusal.
  const refused =
    auth.signedIn && lastAuthFailure?.key === (await authFailureKey(executablePath))
      ? lastAuthFailure.message
      : undefined;
  // Cached credentials don't make a sign-in in progress, or one that just failed, connected.
  if (!auth.signedIn || refused || pendingLogin) {
    return {
      state: pendingLogin ? "connecting" : "sign-in-required",
      installed: true,
      authenticated: false,
      executablePath,
      version,
      authMethod: auth.method,
      checkedAt,
      message: pendingLogin
        ? "Finish signing in with Google in your browser."
        : lastLoginError
          ? `Google sign-in did not finish: ${lastLoginError}`
          : refused ?? SIGN_IN_REQUIRED_MESSAGE
    };
  }

  return {
    state: "connected",
    installed: true,
    authenticated: true,
    executablePath,
    version,
    authMethod: auth.method,
    checkedAt,
    message: methodLabel
      ? `Gemini CLI is signed in with your ${methodLabel}.`
      : "Gemini CLI is signed in."
  };
}

/**
 * Starts Gemini's own Google sign-in: the CLI opens the browser and caches the
 * credentials itself. Returns at once; the status turns connected when done.
 */
export async function launchGeminiCliLogin(
  customPath: string | undefined,
  workspaceDir: string
): Promise<GeminiCliStatus> {
  const status = await getGeminiCliStatus(customPath);
  if (!status.installed || !status.executablePath || status.authenticated || pendingLogin) {
    return status;
  }

  const executablePath = status.executablePath;
  lastLoginError = undefined;
  pendingLogin = (async () => {
    await prepareWorkspace(workspaceDir);
    const agent = AcpAgent.start(executablePath, await acpArgs(executablePath), {
      cwd: workspaceDir,
      env: createGeminiEnvironment(executablePath)
    });
    const timer = setTimeout(() => agent.close(), LOGIN_TIMEOUT_MS);
    try {
      await agent.initialize();
      await agent.request("authenticate", { methodId: "oauth-personal" });
    } catch (caught) {
      // Older CLIs say only "Authentication required"; the reason is on stderr.
      const detail = authFailureDetail(await agent.stop());
      throw new Error(detail ?? acpErrorMessage(caught));
    } finally {
      clearTimeout(timer);
      agent.close();
    }
  })()
    .catch((caught: unknown) => {
      lastLoginError = truncate(acpErrorMessage(caught), 300);
    })
    .finally(() => {
      pendingLogin = null;
    });

  return {
    ...status,
    state: "connecting",
    checkedAt: new Date().toISOString(),
    message: "Finish signing in with Google in your browser, then test the connection."
  };
}

export async function testGeminiCliConnection(
  customPath: string | undefined,
  workspaceDir: string
): Promise<GeminiCliConnectionTest> {
  const status = await getGeminiCliStatus(customPath);
  if (!status.authenticated || !status.executablePath) {
    return { ok: false, status, message: status.message };
  }

  const controller = new AbortController();
  try {
    let reply = "";
    await streamGeminiCliCompletion({
      executablePath: status.executablePath,
      workspaceDir,
      instructions: "You are performing a connection check. Reply with exactly: Connected",
      messages: [{ role: "user", content: "Test the connection." }],
      tools: [],
      signal: controller.signal,
      timeoutMs: TEST_TIMEOUT_MS,
      onToken: (delta) => {
        reply += delta;
      },
      onToolCall: async () => ""
    });
    const connectedStatus: GeminiCliStatus = {
      ...status,
      state: "connected",
      checkedAt: new Date().toISOString(),
      message: "Gemini CLI is connected and ready for Coach conversations."
    };
    return {
      ok: true,
      status: connectedStatus,
      message: reply.trim()
        ? "Gemini CLI is connected and responded successfully."
        : "Gemini CLI is connected and ready."
    };
  } catch (caught) {
    const error = normalizeGeminiCliError(caught);
    const failedStatus: GeminiCliStatus = {
      ...status,
      state:
        error.kind === "usage-limit"
          ? "usage-limit-reached"
          : error.kind === "auth"
            ? "sign-in-required"
            : "connection-failed",
      authenticated: error.kind !== "auth",
      checkedAt: new Date().toISOString(),
      message: error.message
    };
    return { ok: false, status: failedStatus, message: error.message };
  }
}

/**
 * The models the CLI offers this account, from a session that never sends a
 * prompt. Older CLIs don't list them; the caller falls back to aliases.
 */
export async function listGeminiCliModels(
  executablePath: string,
  workspaceDir: string
): Promise<ChatModelOption[]> {
  await prepareWorkspace(workspaceDir);
  const agent = AcpAgent.start(executablePath, await acpArgs(executablePath), {
    cwd: workspaceDir,
    env: createGeminiEnvironment(executablePath)
  });
  const timer = setTimeout(() => agent.close(), MODEL_LIST_TIMEOUT_MS);
  try {
    await agent.initialize();
    const session = (await agent.request("session/new", {
      cwd: workspaceDir,
      mcpServers: []
    })) as {
      models?: {
        currentModelId?: string;
        availableModels?: Array<{ modelId?: unknown; name?: unknown }>;
      };
    };
    return geminiModelOptionsFromSession(session.models);
  } finally {
    clearTimeout(timer);
    agent.close();
  }
}

/** "Default · <current model>" first, then each model the session offers. */
export function geminiModelOptionsFromSession(models?: {
  currentModelId?: string;
  availableModels?: Array<{ modelId?: unknown; name?: unknown }>;
}): ChatModelOption[] {
  const rows = (models?.availableModels ?? [])
    .filter(
      (model): model is { modelId: string; name?: unknown } =>
        typeof model.modelId === "string" && model.modelId.length > 0
    )
    .map((model) => ({
      value: model.modelId,
      label: typeof model.name === "string" && model.name ? model.name : model.modelId
    }));
  if (rows.length === 0) return [];
  const current = rows.find((row) => row.value === models?.currentModelId);
  return [
    current ? { value: "", label: "Default", detail: current.label } : { value: "", label: "Default" },
    ...rows
  ];
}

// ----- Streaming -----

export async function streamGeminiCliCompletion(
  options: StreamGeminiCliOptions
): Promise<{ fullText: string }> {
  let externallyCancelled = false;
  let timedOut = false;
  let agent: AcpAgent | undefined;
  const onAbort = () => {
    externallyCancelled = true;
    agent?.close();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  // Inactivity timeout: long agent turns are fine while the stream produces.
  const idleTimeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let sessionStarted = false;
  const armIdleTimeout = (ms = idleTimeoutMs) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timedOut = true;
      agent?.close();
    }, ms);
  };
  armIdleTimeout(Math.min(idleTimeoutMs, SESSION_START_TIMEOUT_MS));

  let fullText = "";
  let toolCalls = 0;
  let bridge: ToolBridge | undefined;
  let promptFile: string | undefined;

  try {
    if (options.model && !/^[A-Za-z0-9._:-]{1,100}$/.test(options.model)) {
      throw new GeminiCliProviderError(`Unsupported Gemini model name: ${options.model}`, "connection");
    }
    await prepareWorkspace(options.workspaceDir);
    promptFile = await writeSystemPrompt(options.workspaceDir, options.instructions);
    if (options.tools.length > 0) {
      bridge = await startToolBridge(options.tools, {
        ...options,
        onActivity: () => armIdleTimeout()
      });
    }

    const args = await acpArgs(options.executablePath);
    if (options.model) args.push("--model", options.model);
    if (options.signal.aborted) throw new Error("cancelled");
    agent = AcpAgent.start(options.executablePath, args, {
      cwd: options.workspaceDir,
      env: createGeminiEnvironment(options.executablePath, { GEMINI_SYSTEM_MD: promptFile })
    });
    if (options.signal.aborted) agent.close();

    let sessionId = "";
    agent.onNotification = (method, params) => {
      if (sessionStarted) armIdleTimeout();
      if (method !== "session/update") return;
      const update = (params as { update?: Record<string, unknown> } | undefined)?.update;
      const kind = update?.sessionUpdate;
      const content = update?.content as { type?: string; text?: unknown } | undefined;
      const text = content?.type === "text" && typeof content.text === "string" ? content.text : "";
      if (kind === "agent_message_chunk" && text) {
        fullText += text;
        options.onToken(text);
      } else if (kind === "agent_thought_chunk" && text) {
        options.onThinking?.(text);
      } else if (kind === "tool_call") {
        toolCalls += 1;
        if (toolCalls > MAX_TOOL_CALLS && sessionId) {
          agent?.notify("session/cancel", { sessionId });
        }
      }
    };

    await agent.initialize();
    let session: { sessionId?: string };
    try {
      session = (await agent.request("session/new", {
        cwd: options.workspaceDir,
        mcpServers: bridge
          ? [
              {
                type: "http",
                name: MCP_SERVER_NAME,
                url: bridge.url,
                headers: [{ name: "Authorization", value: `Bearer ${bridge.token}` }]
              }
            ]
          : []
      })) as { sessionId?: string };
    } catch (caught) {
      if (timedOut || externallyCancelled || options.signal.aborted) throw caught;
      throw await sessionStartError(caught, agent, options.executablePath);
    }
    if (!session.sessionId) throw new Error("Gemini CLI did not start a session.");
    sessionId = session.sessionId;
    sessionStarted = true;
    lastAuthFailure = undefined;
    armIdleTimeout();

    const result = (await agent.request("session/prompt", {
      sessionId,
      prompt: geminiPrompt(options.messages)
    })) as { stopReason?: string };

    if (result.stopReason === "cancelled") {
      if (toolCalls > MAX_TOOL_CALLS && !externallyCancelled) {
        throw new GeminiCliProviderError(
          "Gemini kept calling tools without answering. Try a narrower question.",
          "connection"
        );
      }
      throw new Error("cancelled");
    }
    if (!fullText.trim()) {
      if (result.stopReason === "refusal") {
        throw new GeminiCliProviderError("Gemini declined to answer this request.", "connection");
      }
      if (result.stopReason === "max_tokens" || result.stopReason === "max_turn_requests") {
        throw new GeminiCliProviderError(
          "Gemini stopped before answering. Try again or start a new conversation.",
          "connection"
        );
      }
    }
    return { fullText };
  } catch (caught) {
    if (caught instanceof GeminiCliProviderError) throw caught;
    if (timedOut) {
      throw new GeminiCliProviderError(
        sessionStarted
          ? "Gemini CLI stopped responding. Try again."
          : "Gemini CLI did not start a session. Run gemini in a terminal to check its sign-in, then try again.",
        "timeout"
      );
    }
    if (externallyCancelled || options.signal.aborted) {
      throw new GeminiCliProviderError("Gemini request cancelled.", "cancelled");
    }
    throw normalizeGeminiCliError(caught);
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", onAbort);
    agent?.close();
    await bridge?.close();
    if (promptFile) await rm(promptFile, { force: true }).catch(() => undefined);
  }
}

export function normalizeGeminiCliError(caught: unknown): GeminiCliProviderError {
  if (caught instanceof GeminiCliProviderError) {
    return caught;
  }
  const detail = acpErrorMessage(caught);
  const code = (caught as { code?: unknown } | undefined)?.code;
  if (code === 429 || /quota|rate.?limit|resource.?exhausted|429|usage limit/i.test(detail)) {
    return new GeminiCliProviderError(
      "Your Gemini usage limit may have been reached. Try again later or choose another provider.",
      "usage-limit"
    );
  }
  if (
    /auth|sign.?in|log.?in|credential|api key|unauthenticated|permission denied|401|403/i.test(detail)
  ) {
    return new GeminiCliProviderError(SIGN_IN_REQUIRED_MESSAGE, "auth");
  }
  if (/enoent|not found|no such file/i.test(detail)) {
    return new GeminiCliProviderError(
      "Gemini CLI is not installed or its executable path is no longer valid.",
      "not-installed"
    );
  }
  return new GeminiCliProviderError(
    `Gemini connection failed: ${truncate(detail, 500)}`,
    "connection"
  );
}

/** Gemini's reason for refusing a sign-in, from what the CLI printed. */
export function authFailureDetail(stderr: string): string | undefined {
  const line = stripVTControlCharacters(stderr)
    .split(/\r?\n/)
    .find((entry) => /Error authenticating:/i.test(entry));
  const detail = line
    ?.replace(/^.*Error authenticating:\s*/i, "")
    .replace(/^[A-Za-z]*Error:\s*/, "")
    .trim();
  return detail ? truncate(detail, 400) : undefined;
}

/**
 * A failed session start. Newer CLIs put the reason in the error; older ones
 * answer "Authentication required" and print the reason when they exit.
 */
async function sessionStartError(
  caught: unknown,
  agent: AcpAgent,
  executablePath: string
): Promise<GeminiCliProviderError> {
  const error = normalizeGeminiCliError(caught);
  if (error.kind !== "auth" && (caught as { code?: unknown } | undefined)?.code !== -32000) {
    return error;
  }
  const message = acpErrorMessage(caught);
  const detail = /^authentication required\.?$/i.test(message.trim())
    ? authFailureDetail(await agent.stop())
    : message;
  const refusal = new GeminiCliProviderError(
    detail ? `Gemini CLI could not sign in: ${detail}` : SIGN_IN_REQUIRED_MESSAGE,
    "auth"
  );
  await rememberAuthFailure(executablePath, refusal.message);
  return refusal;
}

const GEMINI_PROMPT_MESSAGES = 30;

/** The conversation as one ACP prompt: the transcript, then any attached images. */
export function geminiPrompt(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const recent = messages.slice(-GEMINI_PROMPT_MESSAGES);
  const transcript = recent
    .map(
      (message) =>
        `${message.role === "assistant" ? "Assistant" : "Athlete"}: ${message.content}`
    )
    .join("\n\n");
  const text =
    "Continue the CorosLink Coach conversation below. Answer the athlete's latest " +
    "message, using approved tools only when they materially help.\n\n" +
    transcript;
  return [
    { type: "text", text },
    ...recent.flatMap((message) => message.images ?? []).flatMap((image) => [
      { type: "text", text: `Image: ${image.label}` },
      { type: "image", mimeType: image.mimeType, data: image.base64 }
    ])
  ];
}

// ----- Workspace -----

async function prepareWorkspace(workspaceDir: string): Promise<void> {
  const settingsDir = path.join(workspaceDir, ".gemini");
  await mkdir(settingsDir, { recursive: true, mode: 0o700 });
  const target = path.join(settingsDir, "settings.json");
  const content = `${JSON.stringify(WORKSPACE_SETTINGS, null, 2)}\n`;
  try {
    if ((await readFile(target, "utf8")) === content) return;
  } catch {
    // Written below.
  }
  // Requests can start together; each writes whole and renames over the last.
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, target);
}

/** The coach instructions replace Gemini's coding-agent system prompt. */
async function writeSystemPrompt(workspaceDir: string, instructions: string): Promise<string> {
  const directory = path.join(path.dirname(workspaceDir), "gemini-coach-prompts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${crypto.randomUUID()}.md`);
  await writeFile(file, instructions, { mode: 0o600 });
  return file;
}

// ----- Launch -----

// Each launch of the npm launcher starts Node, so what it prints about itself
// is kept until the installed file changes.
const launcherCache = new Map<string, string>();

async function launcherOutput(
  executablePath: string,
  flag: "--version" | "--help",
  read: (stdout: string) => string
): Promise<string> {
  const key = `${executablePath}\0${(await stat(executablePath)).mtimeMs}\0${flag}`;
  const cached = launcherCache.get(key);
  if (cached !== undefined) return cached;
  const value = read((await execGemini(executablePath, [flag])).stdout);
  launcherCache.set(key, value);
  return value;
}

/** `--acp` since Gemini CLI 0.3x; older releases only know `--experimental-acp`. */
async function acpArgs(executablePath: string): Promise<string[]> {
  let flag: string;
  try {
    flag = await launcherOutput(executablePath, "--help", (stdout) =>
      /(^|\s)--acp\b/m.test(stdout) ? "--acp" : "--experimental-acp"
    );
  } catch {
    flag = "--experimental-acp";
  }
  return [flag, "--allowed-mcp-server-names", MCP_SERVER_NAME, "--extensions", "none"];
}

function needsShell(executablePath: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(executablePath);
}

async function execGemini(
  executablePath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const shell = needsShell(executablePath);
  const result = await execFileAsync(shell ? `"${executablePath}"` : executablePath, args, {
    timeout: DETECTION_TIMEOUT_MS,
    windowsHide: true,
    shell,
    env: createGeminiEnvironment(executablePath),
    maxBuffer: 1024 * 1024
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function launchFailureMessage(caught: unknown): string {
  const error = caught as Error & { stderr?: string; killed?: boolean };
  if (error.killed) return "the launch check timed out.";
  const detail = stripVTControlCharacters(error.stderr || error.message || String(caught)).trim();
  if (/env: node|node: (No such file|not found)/i.test(detail)) {
    return "Node.js was not found next to the gemini launcher. Reinstall Gemini CLI or set its path.";
  }
  return truncate(detail.split(/\r?\n/)[0] ?? "launch failed.", 300);
}

class AcpError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message);
    this.name = "AcpError";
  }
}

function acpErrorMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught || "Unknown error");
}

/** A Gemini CLI process speaking ACP: newline-delimited JSON-RPC 2.0 on stdio. */
class AcpAgent {
  onNotification?: (method: string, params: unknown) => void;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private buffer = "";
  private stderrTail = "";
  private exited = false;
  private readonly exitedPromise: Promise<void>;

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => this.fail(error));
    this.exitedPromise = new Promise((resolve) => child.once("close", () => resolve()));
    child.on("exit", (code, signal) => {
      const detail = stripVTControlCharacters(this.stderrTail).trim().split(/\r?\n/).filter(Boolean).at(-1);
      this.fail(
        new Error(
          detail
            ? `Gemini CLI exited: ${detail}`
            : `Gemini CLI exited (${code ?? signal ?? "unknown"}).`
        )
      );
    });
  }

  static start(
    executablePath: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv }
  ): AcpAgent {
    const shell = needsShell(executablePath);
    const child = spawn(shell ? `"${executablePath}"` : executablePath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell
    });
    return new AcpAgent(child);
  }

  initialize(): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "coroslink", title: "CorosLink", version: "1.0.0" }
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.exited) return Promise.reject(new Error("Gemini CLI is not running."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.exited) this.write({ jsonrpc: "2.0", method, params });
  }

  close(): void {
    if (this.exited) return;
    this.child.stdin.end();
    this.child.kill();
  }

  /** Ends the process and returns what it printed to stderr, which it may hold until exit. */
  async stop(waitMs = 3_000): Promise<string> {
    this.close();
    await Promise.race([
      this.exitedPromise,
      new Promise((resolve) => setTimeout(resolve, waitMs))
    ]);
    return this.stderrTail;
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: {
        id?: number | string;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: { code?: number; message?: string };
      };
      try {
        message = JSON.parse(line);
      } catch {
        continue; // Stray log output.
      }
      if (message.method && message.id !== undefined) {
        this.answer(message.id, message.method);
      } else if (message.method) {
        this.onNotification?.(message.method, message.params);
      } else if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new AcpError(message.error.message || "Gemini CLI request failed.", message.error.code));
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  /**
   * Requests from the agent. CorosLink's tools are pre-approved through
   * `--allowed-mcp-server-names`, so anything that still asks is one of
   * Gemini's own tools and is declined. Files and terminals are not offered.
   */
  private answer(id: number | string, method: string): void {
    if (method === "session/request_permission") {
      this.write({ jsonrpc: "2.0", id, result: { outcome: { outcome: "cancelled" } } });
      return;
    }
    this.write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `CorosLink does not support ${method}.` }
    });
  }

  private fail(error: Error): void {
    this.exited = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

// ----- Tool bridge -----

interface ToolBridge {
  url: string;
  token: string;
  close(): Promise<void>;
}

/**
 * A loopback MCP server for one request. Only the Gemini process holds its
 * random bearer token, and it closes when the request ends.
 */
async function startToolBridge(
  tools: CorosMcpTool[],
  callbacks: GeminiCliToolCallbacks & { onActivity(): void }
): Promise<ToolBridge> {
  const token = crypto.randomBytes(32).toString("base64url");
  // Raw JSON schemas, so the handlers go on the protocol server directly.
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Use only these CorosLink tools for approved training data, plan drafts, and calendar changes. Uploads and deletions always require explicit athlete confirmation via the buttons in chat."
    }
  );
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "CorosLink Coach tool",
      inputSchema: { ...tool.inputSchema, type: "object" as const }
    }))
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const name = request.params.name;
    if (!tools.some((tool) => tool.name === name)) {
      return { isError: true, content: [{ type: "text", text: `Error: unknown tool ${name}` }] };
    }
    callbacks.onToolCallStart?.(name);
    callbacks.onActivity();
    try {
      const output = await callbacks.onToolCall(name, request.params.arguments ?? {});
      return { content: [{ type: "text", text: output }] };
    } catch (caught) {
      const message = acpErrorMessage(caught);
      callbacks.onToolCallError?.(name, message);
      return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
    } finally {
      callbacks.onActivity();
    }
  });

  let transport: StreamableHTTPServerTransport | undefined;
  const httpServer = http.createServer((request, response) => {
    // Compare bytes: a non-ASCII header can match the token's length in characters but not in bytes.
    const supplied = Buffer.from(request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1] ?? "");
    const expected = Buffer.from(token);
    const authorized =
      supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (request.url !== MCP_ENDPOINT || !authorized || request.headers.origin || !transport) {
      response.writeHead(request.url !== MCP_ENDPOINT ? 404 : 401).end();
      return;
    }
    transport.handleRequest(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const { port } = httpServer.address() as AddressInfo;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableDnsRebindingProtection: true,
    allowedHosts: [`127.0.0.1:${port}`]
  });
  await server.connect(transport);

  return {
    url: `http://127.0.0.1:${port}${MCP_ENDPOINT}`,
    token,
    close: async () => {
      await server.close().catch(() => undefined);
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
