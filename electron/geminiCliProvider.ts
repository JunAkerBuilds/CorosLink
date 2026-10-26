import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import {
  AcpAgent,
  acpErrorMessage,
  startToolBridge,
  toolBridgeServer,
  truncate,
  type ToolBridge
} from "./acpClient";
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
// Node's cold start loading the CLI's node_modules alone takes 16–39 s on
// Windows (gemini-cli#11511), even for `--version`.
const DETECTION_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 15_000;
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

async function findOnPath(name: string): Promise<string | undefined> {
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(command, [name], {
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

  const fromPath = await findOnPath("gemini");
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

// Google's successor to Gemini CLI. It has no ACP mode, so Coach can't run
// through it; finding it only explains why Gemini CLI is missing or stalls.
const ANTIGRAVITY_NOTE =
  "Antigravity CLI (agy) is installed, but it can't run Coach: it has no Agent Client Protocol mode. Coach needs Gemini CLI signed in with a Gemini API key or Vertex AI.";

async function antigravityNote(): Promise<string> {
  return (await findOnPath("agy")) ? ` ${ANTIGRAVITY_NOTE}` : "";
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

/** The remembered refusal, while nothing it depended on has changed. */
async function currentRefusal(executablePath: string): Promise<string | undefined> {
  if (!lastAuthFailure) return undefined;
  return lastAuthFailure.key === (await authFailureKey(executablePath))
    ? lastAuthFailure.message
    : undefined;
}

type GeminiSessionModels = {
  currentModelId?: string;
  availableModels?: Array<{ modelId?: unknown; name?: unknown }>;
};

// What the last session that started offered. With Google sign-in the model
// picker reads these instead of starting a session of its own.
let sessionModels: { executablePath: string; options: ChatModelOption[] } | undefined;

function rememberSessionModels(executablePath: string, models?: GeminiSessionModels): void {
  const options = geminiModelOptionsFromSession(models);
  if (options.length > 0) sessionModels = { executablePath, options };
}

/** The models this CLI's most recent session offered, without starting one. */
export function getGeminiSessionModels(executablePath: string): ChatModelOption[] {
  return sessionModels?.executablePath === executablePath ? sessionModels.options : [];
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
        "Gemini CLI is not installed. Install it, sign it in, then check again." +
        (await antigravityNote())
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
      message:
        `Gemini CLI was found but could not launch: ${launchFailureMessage(caught)}` +
        (await antigravityNote())
    };
  }

  const auth = await getGeminiAuthState();
  const methodLabel = auth.method ? AUTH_METHOD_LABELS[auth.method] ?? auth.method : undefined;
  // A sign-in that rewrites the credentials changes the key, which lifts the refusal.
  const refused = auth.signedIn ? await currentRefusal(executablePath) : undefined;
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
 * "Check again". A remembered refusal holds until the CLI, its credentials or its
 * settings change, which a passing failure (a proxy 403, a dropped connection)
 * never does. So it is tried once more with a session that sends no prompt:
 * success lifts it, and a refusal is remembered again with Gemini's reason.
 */
export async function recheckGeminiCliStatus(
  customPath: string | undefined,
  workspaceDir: string
): Promise<GeminiCliStatus> {
  const status = await getGeminiCliStatus(customPath);
  if (
    status.state !== "sign-in-required" ||
    !status.executablePath ||
    // Without cached credentials a session would start Google's browser sign-in.
    !(await getGeminiAuthState()).signedIn ||
    !(await currentRefusal(status.executablePath))
  ) {
    return status;
  }
  try {
    await startCheckSession(status.executablePath, workspaceDir, { rememberRefusal: true });
  } catch {
    // The status below reports a refusal remembered again, or the one that still holds.
  }
  return getGeminiCliStatus(customPath);
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
  // Google sign-in makes it the CLI's selected method and drops other cached
  // credentials; an API key or Vertex AI setup is the athlete's to change.
  if (status.authMethod && status.authMethod !== "oauth-personal") {
    const label = AUTH_METHOD_LABELS[status.authMethod] ?? status.authMethod;
    return {
      ...status,
      message: `${status.message} Gemini CLI is set up for your ${label}, so CorosLink won't switch it to Google sign-in.`
    };
  }

  const executablePath = status.executablePath;
  lastLoginError = undefined;
  pendingLogin = (async () => {
    await prepareWorkspace(workspaceDir);
    const agent = startGeminiAgent(executablePath, await acpArgs(executablePath), {
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
  return startCheckSession(executablePath, workspaceDir, { rememberRefusal: false });
}

/** A session that never sends a prompt: it proves the sign-in and reports the models. */
async function startCheckSession(
  executablePath: string,
  workspaceDir: string,
  options: { rememberRefusal: boolean }
): Promise<ChatModelOption[]> {
  await prepareWorkspace(workspaceDir);
  const agent = startGeminiAgent(executablePath, await acpArgs(executablePath), {
    cwd: workspaceDir,
    env: createGeminiEnvironment(executablePath)
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    agent.close();
  }, MODEL_LIST_TIMEOUT_MS);
  try {
    await agent.initialize();
    let session: { models?: GeminiSessionModels };
    try {
      session = (await agent.request("session/new", {
        cwd: workspaceDir,
        mcpServers: []
      })) as { models?: GeminiSessionModels };
    } catch (caught) {
      if (!options.rememberRefusal || timedOut) throw caught;
      throw await sessionStartError(caught, agent, executablePath);
    }
    lastAuthFailure = undefined;
    rememberSessionModels(executablePath, session.models);
    return geminiModelOptionsFromSession(session.models);
  } finally {
    clearTimeout(timer);
    agent.close();
  }
}

/** "Default · <current model>" first, then each model the session offers. */
export function geminiModelOptionsFromSession(models?: GeminiSessionModels): ChatModelOption[] {
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
      bridge = await startToolBridge(MCP_SERVER_NAME, options.tools, {
        ...options,
        onActivity: () => armIdleTimeout()
      });
    }

    const args = await acpArgs(options.executablePath);
    if (options.model) args.push("--model", options.model);
    if (options.signal.aborted) throw new Error("cancelled");
    agent = startGeminiAgent(options.executablePath, args, {
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
    let session: { sessionId?: string; models?: GeminiSessionModels };
    try {
      session = (await agent.request("session/new", {
        cwd: options.workspaceDir,
        mcpServers: bridge ? [toolBridgeServer(bridge, MCP_SERVER_NAME)] : []
      })) as { sessionId?: string; models?: GeminiSessionModels };
    } catch (caught) {
      if (timedOut || externallyCancelled || options.signal.aborted) throw caught;
      throw await sessionStartError(caught, agent, options.executablePath);
    }
    if (!session.sessionId) throw new Error("Gemini CLI did not start a session.");
    sessionId = session.sessionId;
    sessionStarted = true;
    lastAuthFailure = undefined;
    rememberSessionModels(options.executablePath, session.models);
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

/**
 * The conversation as one ACP prompt: the transcript, then any attached images.
 * Coach trims long conversations to its history budget before they get here.
 */
export function geminiPrompt(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const transcript = messages
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
    ...messages.flatMap((message) => message.images ?? []).flatMap((image) => [
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
  const pending = execFileAsync(shell ? `"${executablePath}"` : executablePath, args, {
    timeout: DETECTION_TIMEOUT_MS,
    windowsHide: true,
    shell,
    env: createGeminiEnvironment(executablePath),
    maxBuffer: 1024 * 1024
  });
  // Gemini CLI reads piped stdin as prompt text, and a pipe left open (or a
  // prompt from a newer release) holds `--version` until the check times out.
  pending.child.stdin?.end();
  const result = await pending;
  return { stdout: result.stdout, stderr: result.stderr };
}

function launchFailureMessage(caught: unknown): string {
  const error = caught as Error & { stderr?: string; killed?: boolean };
  if (error.killed) {
    return `it did not answer \`--version\` within ${DETECTION_TIMEOUT_MS / 1000} seconds.`;
  }
  const detail = stripVTControlCharacters(error.stderr || error.message || String(caught)).trim();
  if (/env: node|node: (No such file|not found)/i.test(detail)) {
    return "Node.js was not found next to the gemini launcher. Reinstall Gemini CLI or set its path.";
  }
  return truncate(detail.split(/\r?\n/)[0] ?? "launch failed.", 300);
}

/**
 * Gemini CLI as an ACP agent. CorosLink's tools are pre-approved through
 * `--allowed-mcp-server-names`, so any permission it still asks for is one of
 * Gemini's own tools, and the default answer declines it.
 */
function startGeminiAgent(
  executablePath: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): AcpAgent {
  return AcpAgent.start(executablePath, args, {
    ...options,
    label: "Gemini CLI",
    shell: needsShell(executablePath)
  });
}

