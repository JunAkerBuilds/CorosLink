import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import {
  AcpAgent,
  AcpError,
  acpErrorMessage,
  startToolBridge,
  truncate,
  type ToolBridge
} from "./acpClient";
import type { ChatModelOption } from "./chatModels";
import { geminiPrompt, type GeminiCliToolCallbacks } from "./geminiCliProvider";
import type {
  ChatMessage,
  CorosMcpTool,
  OpencodeConnectionTest,
  OpencodeStatus
} from "./types";

// OpenCode runs as an Agent Client Protocol (ACP) agent: `opencode acp`,
// JSON-RPC over stdio, one process per request. Each process starts its own
// private OpenCode server, so nothing here reaches the athlete's background
// service or their other sessions. Coach tools reach it through a loopback MCP
// server that lives only as long as the request.
//
// Checked against OpenCode 2.0.22 (live) and the 1.19.5 and 2.2.6 sources.

const execFileAsync = promisify(execFile);
const DETECTION_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 15_000;
const TEST_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 3 * 60_000;
const SESSION_START_TIMEOUT_MS = 90_000;
const CHECK_TIMEOUT_MS = 45_000;
/** How long a session may take to show the Coach agent from the request's config. */
const COACH_AGENT_WAIT_MS = 20_000;
/** Once OpenCode has reported its agents without the Coach agent, a correction gets this long. */
const COACH_AGENT_GRACE_MS = 3_000;
/** OpenCode 1.x reads the bridge's tools as the prompt starts, so it is not waited on for long. */
const TOOLS_WAIT_MS = { v1: 3_000, v2: 20_000 };
/** OpenCode registers the tools a moment after it has read the list. */
const TOOLS_SETTLE_MS = 250;
const SESSION_DELETE_TIMEOUT_MS = 2_000;
const MODELS_CACHE_MS = 5 * 60_000;
/** A remembered "no models" is checked again on the next look after this long. */
const NO_MODELS_RECHECK_MS = 30_000;
const MAX_TOOL_CALLS = 24;
const MCP_SERVER_NAME = "coroslink";
const COACH_AGENT = "coroslink-coach";
/** Coach tools can run long: a plan draft, a FIT analysis. */
const MCP_TIMEOUT_MS = 5 * 60_000;

const NO_MODELS_MESSAGE =
  "OpenCode has no models yet. Run `opencode auth login` in a terminal to connect a provider, then check again.";

// OpenCode's free models refuse a request that offers no tools at all, so a
// request without Coach tools (a title, a connection check) offers this one.
const IDLE_TOOL: CorosMcpTool = {
  name: "no_tools_needed",
  description:
    "Placeholder. No tools are needed for this request: answer directly and do not call this.",
  inputSchema: { type: "object", properties: {} }
};

export type OpencodeFailureKind =
  | "not-installed"
  | "auth"
  | "usage-limit"
  | "timeout"
  | "cancelled"
  | "connection";

export class OpencodeProviderError extends Error {
  constructor(
    message: string,
    readonly kind: OpencodeFailureKind
  ) {
    super(message);
    this.name = "OpencodeProviderError";
  }
}

export interface StreamOpencodeOptions extends GeminiCliToolCallbacks {
  executablePath: string;
  /** CorosLink's own OpenCode folder: the empty directory sessions run in, and request files. */
  workspaceDir: string;
  instructions: string;
  messages: ChatMessage[];
  tools: CorosMcpTool[];
  signal: AbortSignal;
  timeoutMs?: number;
  /** "provider/model" as OpenCode lists it. Omit for OpenCode's default. */
  model?: string;
}

// ----- Detection -----

export function getOpencodeExecutableCandidates(
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
      candidates.push(path.join(env.APPDATA, "npm", "opencode.cmd"));
    }
    candidates.push(
      path.join(home, ".opencode", "bin", "opencode.exe"),
      path.join(home, ".bun", "bin", "opencode.exe"),
      path.join(home, "scoop", "shims", "opencode.exe")
    );
  } else {
    candidates.push(
      // The official install script's folder.
      path.join(home, ".opencode", "bin", "opencode"),
      path.join(home, ".local", "bin", "opencode"),
      "/opt/homebrew/bin/opencode",
      "/usr/local/bin/opencode",
      "/usr/bin/opencode",
      path.join(home, ".npm-global", "bin", "opencode"),
      path.join(home, ".volta", "bin", "opencode"),
      path.join(home, ".bun", "bin", "opencode")
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
    return versions.map((version) => path.join(root, version, "bin", "opencode"));
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

export async function detectOpencodeExecutable(
  customPath?: string
): Promise<string | undefined> {
  const explicitPath = customPath?.trim();
  if (explicitPath) {
    return (await isExecutable(explicitPath)) ? explicitPath : undefined;
  }

  for (const candidate of [
    ...getOpencodeExecutableCandidates(customPath),
    ...(await nvmCandidates())
  ]) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  const fromPath = await findOnPath("opencode");
  return fromPath && (await isExecutable(fromPath)) ? fromPath : undefined;
}

/** "opencode v2.0.22" or "1.19.5" → "2.0.22". */
export function parseOpencodeVersion(output: string): string | undefined {
  return /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(stripVTControlCharacters(output))?.[1];
}

/**
 * OpenCode 1.x and 2.x name their configuration keys differently. A version
 * that can't be read is taken for the current line, 2.x.
 */
export function opencodeMajor(version: string | undefined): 1 | 2 {
  return version && Number.parseInt(version, 10) < 2 ? 1 : 2;
}

function needsShell(executablePath: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(executablePath);
}

/**
 * The npm launcher is a `#!/usr/bin/env node` script, and apps opened from the
 * Dock get a minimal PATH, so the launcher's own directory goes first.
 */
function baseEnvironment(executablePath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.PATH = [path.dirname(executablePath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  env.NO_COLOR = "1";
  return env;
}

/**
 * The environment for a Coach request. `OPENCODE_CONFIG` adds the request's
 * configuration on top of the athlete's own, which keeps their providers.
 * Inline configuration and the 1.x permission override outrank a file and
 * could reopen OpenCode's own tools, so inherited ones are dropped.
 */
export function createOpencodeEnvironment(
  executablePath: string,
  configFile: string
): NodeJS.ProcessEnv {
  const env = baseEnvironment(executablePath);
  delete env.OPENCODE_CONFIG_CONTENT;
  delete env.OPENCODE_PERMISSION;
  env.OPENCODE_CONFIG = configFile;
  // A request must not swap the binary underneath itself.
  env.OPENCODE_DISABLE_AUTOUPDATE = "1";
  // Older 1.x releases add ~/.claude/CLAUDE.md to every prompt.
  env.OPENCODE_DISABLE_CLAUDE_CODE = "1";
  return env;
}

// What the launcher prints about itself, kept until the installed file changes.
const versionCache = new Map<string, string>();

async function readVersion(executablePath: string): Promise<string | undefined> {
  const key = `${executablePath}\0${(await stat(executablePath)).mtimeMs}`;
  const cached = versionCache.get(key);
  if (cached !== undefined) return cached || undefined;
  const shell = needsShell(executablePath);
  const pending = execFileAsync(shell ? `"${executablePath}"` : executablePath, ["--version"], {
    timeout: DETECTION_TIMEOUT_MS,
    windowsHide: true,
    shell,
    env: baseEnvironment(executablePath),
    maxBuffer: 1024 * 1024
  });
  pending.child.stdin?.end();
  const version = parseOpencodeVersion((await pending).stdout) ?? "";
  versionCache.set(key, version);
  return version || undefined;
}

function launchFailureMessage(caught: unknown): string {
  const error = caught as Error & { stderr?: string; killed?: boolean };
  if (error.killed) {
    return `it did not answer \`--version\` within ${DETECTION_TIMEOUT_MS / 1000} seconds.`;
  }
  const detail = stripVTControlCharacters(error.stderr || error.message || String(caught)).trim();
  if (/env: node|node: (No such file|not found)/i.test(detail)) {
    return "Node.js was not found next to the opencode launcher. Reinstall OpenCode or set its path.";
  }
  return truncate(detail.split(/\r?\n/)[0] ?? "launch failed.", 300);
}

// ----- Request configuration -----

const DENY_ALL_BUT_COACH_V2 = [
  { action: "*", resource: "*", effect: "deny" },
  { action: `${MCP_SERVER_NAME}_*`, resource: "*", effect: "allow" }
];
const DENY_ALL_BUT_COACH_V1 = { "*": "deny", [`${MCP_SERVER_NAME}_*`]: "allow" };

/**
 * OpenCode replaces `{env:NAME}` and `{file:path}` anywhere in a configuration
 * file. Coach instructions carry the athlete's own text (activity names,
 * notes), so those markers are broken up before they get there.
 */
function withoutConfigVariables(text: string): string {
  return text.replace(/\{(env|file):/gi, "{ $1:");
}

/**
 * The configuration for one request. It defines the only agent the session may
 * use: the Coach instructions replace OpenCode's coding prompt, every tool is
 * denied (which also hides it from the model) and only the bridge's tools are
 * allowed back. The rules sit on the agent as well as at the top level because
 * agent rules are read last.
 *
 * In 2.x a server's tools are only reachable through Code Mode (JavaScript
 * with `fetch`) unless the server says `codemode: false`. A server passed over
 * ACP can't say that, so the bridge is declared here instead.
 */
export function buildOpencodeConfig(input: {
  major: 1 | 2;
  instructions: string;
  bridge?: { url: string; token: string };
}): Record<string, unknown> {
  const system = withoutConfigVariables(input.instructions);
  const server = input.bridge && {
    type: "remote",
    url: input.bridge.url,
    headers: { Authorization: `Bearer ${input.bridge.token}` },
    oauth: false
  };
  if (input.major === 1) {
    return {
      $schema: "https://opencode.ai/config.json",
      default_agent: COACH_AGENT,
      share: "disabled",
      snapshot: false,
      ...(server ? { mcp: { [MCP_SERVER_NAME]: { ...server, timeout: MCP_TIMEOUT_MS } } } : {}),
      permission: DENY_ALL_BUT_COACH_V1,
      agent: {
        [COACH_AGENT]: {
          mode: "primary",
          description: "CorosLink Coach",
          prompt: system,
          permission: DENY_ALL_BUT_COACH_V1
        }
      }
    };
  }
  return {
    $schema: "https://opencode.ai/config.json",
    default_agent: COACH_AGENT,
    snapshots: false,
    ...(server
      ? {
          mcp: {
            servers: {
              [MCP_SERVER_NAME]: { ...server, codemode: false, timeout: { execution: MCP_TIMEOUT_MS } }
            }
          }
        }
      : {}),
    permissions: DENY_ALL_BUT_COACH_V2,
    agents: {
      [COACH_AGENT]: {
        mode: "primary",
        description: "CorosLink Coach",
        system,
        permissions: DENY_ALL_BUT_COACH_V2
      }
    }
  };
}

/** Where a request runs: an empty directory, so no project files or rules come along. */
function sessionDirectory(workspaceDir: string): string {
  return path.join(workspaceDir, "workspace");
}

async function writeRequestConfig(
  workspaceDir: string,
  config: Record<string, unknown>
): Promise<string> {
  const directory = path.join(workspaceDir, "requests");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(sessionDirectory(workspaceDir), { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${crypto.randomUUID()}.json`);
  // Holds the bridge's bearer token, which ends with the request.
  await writeFile(file, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  return file;
}

// ----- Session -----

type SelectOption = { value: string; name: string };

interface SessionConfig {
  models: SelectOption[];
  currentModel?: string;
  modes: string[];
  currentMode?: string;
}

function flattenSelectOptions(options: unknown): SelectOption[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option): SelectOption[] => {
    const row = option as { value?: unknown; name?: unknown; options?: unknown };
    // A group of options.
    if (Array.isArray(row.options)) return flattenSelectOptions(row.options);
    if (typeof row.value !== "string" || !row.value) return [];
    return [{ value: row.value, name: typeof row.name === "string" && row.name ? row.name : row.value }];
  });
}

/**
 * The models and agents a session reports, from its `configOptions`. OpenCode
 * before 1.14 reported `models` and `modes` instead; those are read too.
 */
export function readOpencodeSessionConfig(session: unknown): SessionConfig {
  const result = (session ?? {}) as {
    configOptions?: unknown;
    models?: { currentModelId?: unknown; availableModels?: unknown };
    modes?: { currentModeId?: unknown; availableModes?: unknown };
  };
  const config: SessionConfig = { models: [], modes: [] };
  const options = Array.isArray(result.configOptions) ? result.configOptions : [];
  for (const entry of options) {
    const option = entry as { id?: unknown; category?: unknown; currentValue?: unknown; options?: unknown };
    const current = typeof option.currentValue === "string" ? option.currentValue : undefined;
    if (option.id === "model" || option.category === "model") {
      config.models = flattenSelectOptions(option.options);
      config.currentModel = current;
    } else if (option.id === "mode" || option.category === "mode") {
      config.modes = flattenSelectOptions(option.options).map((row) => row.value);
      config.currentMode = current;
    }
  }
  if (options.length === 0) {
    if (Array.isArray(result.models?.availableModels)) {
      config.models = result.models.availableModels.flatMap((model): SelectOption[] => {
        const row = model as { modelId?: unknown; name?: unknown };
        if (typeof row.modelId !== "string" || !row.modelId) return [];
        return [{ value: row.modelId, name: typeof row.name === "string" && row.name ? row.name : row.modelId }];
      });
      if (typeof result.models.currentModelId === "string") config.currentModel = result.models.currentModelId;
    }
    if (Array.isArray(result.modes?.availableModes)) {
      config.modes = result.modes.availableModes.flatMap((mode) => {
        const id = (mode as { id?: unknown }).id;
        return typeof id === "string" ? [id] : [];
      });
      if (typeof result.modes.currentModeId === "string") config.currentMode = result.modes.currentModeId;
    }
  }
  return config;
}

/** "Default · <current model>" first, then each model the session offers. */
export function opencodeModelOptions(config: SessionConfig): ChatModelOption[] {
  if (config.models.length === 0) return [];
  const current = config.models.find((row) => row.value === config.currentModel);
  return [
    current ? { value: "", label: "Default", detail: current.name } : { value: "", label: "Default" },
    ...config.models.map((row) => ({ value: row.value, label: row.name }))
  ];
}

// What the last session that started offered, for the model picker and the status.
let lastCatalog:
  | { executablePath: string; at: number; options: ChatModelOption[] }
  | undefined;

function rememberCatalog(executablePath: string, config: SessionConfig): void {
  lastCatalog = { executablePath, at: Date.now(), options: opencodeModelOptions(config) };
}

/** The models this OpenCode's most recent session offered, without starting one. */
export function getOpencodeSessionModels(executablePath: string): ChatModelOption[] {
  return lastCatalog?.executablePath === executablePath ? lastCatalog.options : [];
}

/** Declines any permission OpenCode still asks for: Coach tools never need one. */
function declinePermission(params: unknown): unknown {
  const options = (params as { options?: Array<{ optionId?: unknown; kind?: unknown }> } | undefined)
    ?.options;
  const reject = options?.find(
    (option) => option.kind === "reject_once" && typeof option.optionId === "string"
  );
  return reject
    ? { outcome: { outcome: "selected", optionId: reject.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

interface CoachSession {
  agent: AcpAgent;
  sessionId: string;
  config: SessionConfig;
  /** Removes the session from OpenCode's own history, where OpenCode can. */
  discard(): Promise<void>;
}

interface StartSessionInput {
  executablePath: string;
  workspaceDir: string;
  major: 1 | 2;
  instructions: string;
  bridge?: ToolBridge;
  onAgent(agent: AcpAgent): void;
  onUpdate?(update: Record<string, unknown>): void;
  onActivity?(): void;
  /** Whether the caller already gave up; a failure then says nothing about OpenCode. */
  abandoned(): boolean;
}

/**
 * Starts OpenCode with the request's configuration and opens a session on the
 * Coach agent. Refuses to hand back a session that is on any other agent: that
 * would be OpenCode's coding agent, with its own tools.
 */
async function startCoachSession(input: StartSessionInput): Promise<{
  session: CoachSession;
  cleanup(): Promise<void>;
}> {
  const configFile = await writeRequestConfig(
    input.workspaceDir,
    buildOpencodeConfig({ major: input.major, instructions: input.instructions, bridge: input.bridge })
  );
  const cleanup = () => rm(configFile, { force: true }).catch(() => undefined);
  try {
    const cwd = sessionDirectory(input.workspaceDir);
    const agent = AcpAgent.start(input.executablePath, ["acp"], {
      cwd,
      env: createOpencodeEnvironment(input.executablePath, configFile),
      label: "OpenCode",
      shell: needsShell(input.executablePath),
      onPermission: declinePermission
    });
    input.onAgent(agent);

    let config: SessionConfig = { models: [], modes: [] };
    let onConfig: (() => void) | undefined;
    // What is already known stays where a newer report leaves it out.
    const mergeConfig = (older: SessionConfig, newer: SessionConfig): SessionConfig => ({
      models: newer.models.length > 0 ? newer.models : older.models,
      currentModel: newer.currentModel ?? older.currentModel,
      modes: newer.modes.length > 0 ? newer.modes : older.modes,
      currentMode: newer.currentMode ?? older.currentMode
    });
    agent.onNotification = (method, params) => {
      input.onActivity?.();
      if (method !== "session/update") return;
      const update = (params as { update?: Record<string, unknown> } | undefined)?.update;
      if (!update) return;
      if (update.sessionUpdate === "config_option_update") {
        config = mergeConfig(config, readOpencodeSessionConfig(update));
        onConfig?.();
        return;
      }
      input.onUpdate?.(update);
    };

    const initialized = (await agent.initialize()) as {
      agentCapabilities?: { sessionCapabilities?: { delete?: unknown } };
    };
    const canDelete = Boolean(initialized?.agentCapabilities?.sessionCapabilities?.delete);
    const created = (await agent.request("session/new", { cwd, mcpServers: [] })) as {
      sessionId?: string;
    };
    if (!created?.sessionId) throw new Error("OpenCode did not start a session.");
    const sessionId = created.sessionId;
    // An update can land in the same read as the reply and is the newer of the two.
    config = mergeConfig(readOpencodeSessionConfig(created), config);

    // 2.x answers before it has read the request's configuration and follows up
    // with the agents and models that configuration gives.
    if (config.currentMode !== COACH_AGENT) {
      await new Promise<void>((resolve) => {
        let timer = setTimeout(resolve, COACH_AGENT_WAIT_MS);
        onConfig = () => {
          clearTimeout(timer);
          if (config.currentMode === COACH_AGENT || config.modes.includes(COACH_AGENT)) resolve();
          else timer = setTimeout(resolve, COACH_AGENT_GRACE_MS);
        };
        void agent.whenExited().then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      onConfig = undefined;
    }
    if (config.currentMode !== COACH_AGENT && config.modes.includes(COACH_AGENT)) {
      await agent
        .request("session/set_config_option", { sessionId, configId: "mode", value: COACH_AGENT })
        .catch(() => agent.request("session/set_mode", { sessionId, modeId: COACH_AGENT }));
      config = { ...config, currentMode: COACH_AGENT };
    }
    if (config.currentMode !== COACH_AGENT && !input.abandoned()) {
      throw new OpencodeProviderError(
        "This OpenCode did not load CorosLink's Coach setup. Update OpenCode, then try again.",
        "connection"
      );
    }

    let discarded: Promise<void> | undefined;
    return {
      session: {
        agent,
        sessionId,
        get config() {
          return config;
        },
        // Asked once: a stopped turn discards before it closes, and the request's own cleanup follows.
        discard: () =>
          (discarded ??= (async () => {
            if (!canDelete) return;
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
              agent.request("session/delete", { sessionId }).catch(() => undefined),
              new Promise((resolve) => {
                timer = setTimeout(resolve, SESSION_DELETE_TIMEOUT_MS);
              })
            ]);
            clearTimeout(timer);
          })())
      },
      cleanup
    };
  } catch (caught) {
    await cleanup();
    throw caught;
  }
}

// ----- Models and status -----

interface CatalogCheck {
  options: ChatModelOption[];
  /** Why the session could not start, when it could not. */
  failure?: OpencodeProviderError;
}

/** A session that never sends a prompt: it reports the models OpenCode offers. */
async function runCatalogCheck(executablePath: string, workspaceDir: string): Promise<CatalogCheck> {
  let agent: AcpAgent | undefined;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    agent?.close();
  }, CHECK_TIMEOUT_MS);
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const major = opencodeMajor(await readVersion(executablePath).catch(() => undefined));
    const started = await startCoachSession({
      executablePath,
      workspaceDir,
      major,
      instructions: "CorosLink connection check.",
      onAgent: (started) => {
        agent = started;
      },
      abandoned: () => timedOut
    });
    cleanup = started.cleanup;
    const { session } = started;
    rememberCatalog(executablePath, session.config);
    await session.discard();
    return { options: opencodeModelOptions(session.config) };
  } catch (caught) {
    const failure = timedOut
      ? new OpencodeProviderError("OpenCode did not start a session in time.", "timeout")
      : normalizeOpencodeError(caught);
    if (isNoModelsError(caught)) {
      lastCatalog = { executablePath, at: Date.now(), options: [] };
    }
    return { options: [], failure };
  } finally {
    clearTimeout(timer);
    agent?.close();
    await cleanup?.();
  }
}

let catalogChecks = new Map<string, { at: number; result: Promise<CatalogCheck> }>();

function checkCatalog(
  executablePath: string,
  workspaceDir: string,
  maxAgeMs: number
): Promise<CatalogCheck> {
  const cached = catalogChecks.get(executablePath);
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.result;
  // Pickers and a status check that start together share one launch.
  const result = runCatalogCheck(executablePath, workspaceDir);
  catalogChecks.set(executablePath, { at: Date.now(), result });
  return result;
}

/** Forgets what OpenCode offered, so the next look starts a session. For tests. */
export function resetOpencodeCatalog(): void {
  catalogChecks = new Map();
  lastCatalog = undefined;
}

/**
 * The models OpenCode offers, from a session that never sends a prompt. The
 * list comes from the athlete's own OpenCode providers.
 */
export async function listOpencodeModels(
  executablePath: string,
  workspaceDir: string
): Promise<ChatModelOption[]> {
  const check = await checkCatalog(executablePath, workspaceDir, MODELS_CACHE_MS);
  if (check.failure && check.options.length === 0) throw check.failure;
  return check.options;
}

/**
 * Installed, and able to launch. OpenCode has no sign-in of its own to check:
 * what matters is whether it has any model to offer, which the last session
 * (or `recheckOpencodeStatus`) reported. A remembered "no models" is looked at
 * again after a moment when `workspaceDir` is given.
 */
export async function getOpencodeStatus(
  customPath?: string,
  workspaceDir?: string
): Promise<OpencodeStatus> {
  const checkedAt = new Date().toISOString();
  const executablePath = await detectOpencodeExecutable(customPath);
  if (!executablePath) {
    return {
      state: "not-installed",
      installed: false,
      authenticated: false,
      checkedAt,
      message: "OpenCode is not installed. Install it, connect a provider, then check again."
    };
  }

  let version: string | undefined;
  try {
    version = await readVersion(executablePath);
  } catch (caught) {
    return {
      state: "connection-failed",
      installed: true,
      authenticated: false,
      executablePath,
      checkedAt,
      message: `OpenCode was found but could not launch: ${launchFailureMessage(caught)}`
    };
  }

  let catalog = lastCatalog?.executablePath === executablePath ? lastCatalog : undefined;
  if (catalog && catalog.options.length === 0 && workspaceDir && Date.now() - catalog.at > NO_MODELS_RECHECK_MS) {
    await checkCatalog(executablePath, workspaceDir, 0);
    catalog = lastCatalog?.executablePath === executablePath ? lastCatalog : undefined;
  }
  const base = { installed: true, executablePath, version, checkedAt };
  if (catalog && catalog.options.length === 0) {
    return { ...base, state: "sign-in-required", authenticated: false, modelCount: 0, message: NO_MODELS_MESSAGE };
  }
  const modelCount = catalog ? catalog.options.length - 1 : undefined;
  const label = version ? `OpenCode ${version}` : "OpenCode";
  return {
    ...base,
    state: "connected",
    authenticated: true,
    ...(modelCount !== undefined ? { modelCount } : {}),
    message:
      modelCount !== undefined
        ? `${label} is ready with ${modelCount} model${modelCount === 1 ? "" : "s"} from your OpenCode providers.`
        : `${label} is installed. It uses the providers you connected in OpenCode.`
  };
}

/** "Check": starts a fresh session to see which models OpenCode offers now. */
export async function recheckOpencodeStatus(
  customPath: string | undefined,
  workspaceDir: string
): Promise<OpencodeStatus> {
  const status = await getOpencodeStatus(customPath);
  if (!status.executablePath || status.state === "connection-failed") return status;
  const check = await checkCatalog(status.executablePath, workspaceDir, 0);
  const refreshed = await getOpencodeStatus(customPath);
  if (!check.failure || refreshed.state !== "connected" || isNoModelsFailure(check.failure)) {
    return refreshed;
  }
  // Installed, but the session itself would not start.
  return {
    ...refreshed,
    state: check.failure.kind === "auth" ? "sign-in-required" : "connection-failed",
    authenticated: check.failure.kind !== "auth",
    message: check.failure.message
  };
}

export async function testOpencodeConnection(
  customPath: string | undefined,
  workspaceDir: string,
  model?: string
): Promise<OpencodeConnectionTest> {
  const status = await getOpencodeStatus(customPath, workspaceDir);
  if (!status.authenticated || !status.executablePath) {
    return { ok: false, status, message: status.message };
  }

  const controller = new AbortController();
  try {
    let reply = "";
    await streamOpencodeCompletion({
      executablePath: status.executablePath,
      workspaceDir,
      instructions: "You are performing a connection check. Reply with exactly: Connected",
      messages: [{ role: "user", content: "Test the connection." }],
      tools: [],
      signal: controller.signal,
      timeoutMs: TEST_TIMEOUT_MS,
      ...(model ? { model } : {}),
      onToken: (delta) => {
        reply += delta;
      },
      onToolCall: async () => ""
    });
    const connectedStatus: OpencodeStatus = {
      ...status,
      state: "connected",
      checkedAt: new Date().toISOString(),
      message: "OpenCode is connected and ready for Coach conversations."
    };
    return {
      ok: true,
      status: connectedStatus,
      message: reply.trim()
        ? "OpenCode is connected and responded successfully."
        : "OpenCode is connected and ready."
    };
  } catch (caught) {
    const error = normalizeOpencodeError(caught);
    const failedStatus: OpencodeStatus = {
      ...status,
      state:
        error.kind === "usage-limit"
          ? "usage-limit-reached"
          : error.kind === "auth"
            ? "sign-in-required"
            : "connection-failed",
      // One model's provider failing leaves the other models usable.
      checkedAt: new Date().toISOString(),
      message: error.message
    };
    return { ok: false, status: failedStatus, message: error.message };
  }
}

// ----- Streaming -----

export async function streamOpencodeCompletion(
  options: StreamOpencodeOptions
): Promise<{ fullText: string }> {
  let externallyCancelled = false;
  let timedOut = false;
  let agent: AcpAgent | undefined;
  let session: CoachSession | undefined;
  // A turn that is stopped or times out still has its conversation removed from
  // OpenCode's history. Only a running process can take that request, so the
  // turn is cancelled and discarded first (the discard gives up after
  // SESSION_DELETE_TIMEOUT_MS) and the process is closed after.
  const stop = () => {
    const live = session;
    if (!live) {
      agent?.close();
      return;
    }
    live.agent.notify("session/cancel", { sessionId: live.sessionId });
    void live
      .discard()
      .catch(() => undefined)
      .finally(() => live.agent.close());
  };
  const onAbort = () => {
    externallyCancelled = true;
    stop();
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
      stop();
    }, ms);
  };
  armIdleTimeout(Math.min(idleTimeoutMs, SESSION_START_TIMEOUT_MS));

  let fullText = "";
  let toolCalls = 0;
  let bridge: ToolBridge | undefined;
  let cleanup: (() => Promise<void>) | undefined;

  try {
    if (options.model && options.model.length > 200) {
      throw new OpencodeProviderError(`Unsupported OpenCode model name: ${options.model}`, "connection");
    }
    const major = opencodeMajor(await readVersion(options.executablePath).catch(() => undefined));
    const idle = options.tools.length === 0;
    bridge = await startToolBridge(MCP_SERVER_NAME, idle ? [IDLE_TOOL] : options.tools, {
      onToolCallStart: idle ? undefined : options.onToolCallStart,
      onToolCallError: idle ? undefined : options.onToolCallError,
      onToolCall: idle
        ? async () => "No tools are needed. Answer directly."
        : options.onToolCall,
      onActivity: () => armIdleTimeout()
    });
    if (options.signal.aborted) throw new Error("cancelled");

    const started = await startCoachSession({
      executablePath: options.executablePath,
      workspaceDir: options.workspaceDir,
      major,
      instructions: options.instructions,
      bridge,
      onAgent: (launched) => {
        agent = launched;
        if (options.signal.aborted) launched.close();
      },
      onActivity: () => {
        if (sessionStarted) armIdleTimeout();
      },
      onUpdate: (update) => {
        const kind = update.sessionUpdate;
        const content = update.content as { type?: string; text?: unknown } | undefined;
        const text = content?.type === "text" && typeof content.text === "string" ? content.text : "";
        if (kind === "agent_message_chunk" && text) {
          fullText += text;
          options.onToken(text);
        } else if (kind === "agent_thought_chunk" && text) {
          options.onThinking?.(text);
        } else if (kind === "tool_call") {
          toolCalls += 1;
          if (toolCalls > MAX_TOOL_CALLS && session) {
            session.agent.notify("session/cancel", { sessionId: session.sessionId });
          }
        }
      },
      abandoned: () => timedOut || externallyCancelled || options.signal.aborted
    });
    cleanup = started.cleanup;
    session = started.session;
    const { sessionId } = session;
    rememberCatalog(options.executablePath, session.config);

    if (options.model && options.model !== session.config.currentModel) {
      try {
        await session.agent.request("session/set_config_option", {
          sessionId,
          configId: "model",
          value: options.model
        });
      } catch (caught) {
        if (!isUnknownMethod(caught)) throw modelError(caught, options.model);
        // Before OpenCode had config options.
        await session.agent
          .request("session/set_model", { sessionId, modelId: options.model })
          .catch((legacy: unknown) => {
            throw modelError(legacy, options.model as string);
          });
      }
    }

    // A prompt sent before OpenCode has read the bridge's tools goes out without them.
    let toolsTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      bridge.toolsListed.then(() => new Promise((resolve) => setTimeout(resolve, TOOLS_SETTLE_MS))),
      new Promise((resolve) => {
        toolsTimer = setTimeout(resolve, major === 1 ? TOOLS_WAIT_MS.v1 : TOOLS_WAIT_MS.v2);
      }),
      session.agent.whenExited()
    ]);
    clearTimeout(toolsTimer);
    if (options.signal.aborted) throw new Error("cancelled");
    sessionStarted = true;
    armIdleTimeout();

    const result = (await session.agent.request("session/prompt", {
      sessionId,
      prompt: geminiPrompt(options.messages)
    })) as { stopReason?: string };

    if (result.stopReason === "cancelled") {
      if (toolCalls > MAX_TOOL_CALLS && !externallyCancelled) {
        throw new OpencodeProviderError(
          "OpenCode kept calling tools without answering. Try a narrower question.",
          "connection"
        );
      }
      throw new Error("cancelled");
    }
    if (!fullText.trim()) {
      if (result.stopReason === "refusal") {
        throw new OpencodeProviderError("The model declined to answer this request.", "connection");
      }
      if (result.stopReason === "max_tokens" || result.stopReason === "max_turn_requests") {
        throw new OpencodeProviderError(
          "OpenCode stopped before answering. Try again or start a new conversation.",
          "connection"
        );
      }
    }
    return { fullText };
  } catch (caught) {
    if (caught instanceof OpencodeProviderError) throw caught;
    if (timedOut) {
      throw new OpencodeProviderError(
        sessionStarted
          ? "OpenCode stopped responding. Try again."
          : "OpenCode did not start a session. Run opencode in a terminal to check it, then try again.",
        "timeout"
      );
    }
    if (externallyCancelled || options.signal.aborted) {
      throw new OpencodeProviderError("OpenCode request cancelled.", "cancelled");
    }
    if (isNoModelsError(caught)) {
      lastCatalog = { executablePath: options.executablePath, at: Date.now(), options: [] };
    }
    throw normalizeOpencodeError(caught);
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", onAbort);
    // The conversation lives in CorosLink; OpenCode's copy goes with the request.
    await session?.discard().catch(() => undefined);
    agent?.close();
    await bridge?.close();
    await cleanup?.();
  }
}

function isUnknownMethod(caught: unknown): boolean {
  return caught instanceof AcpError && caught.code === -32601;
}

function modelError(caught: unknown, model: string): OpencodeProviderError {
  if (/not found|unknown|invalid/i.test(acpErrorMessage(caught))) {
    return new OpencodeProviderError(
      `OpenCode doesn't offer ${model} any more. Choose another model.`,
      "connection"
    );
  }
  return normalizeOpencodeError(caught);
}

function isNoModelsError(caught: unknown): boolean {
  return /no models are available/i.test(acpErrorMessage(caught));
}

function isNoModelsFailure(error: OpencodeProviderError): boolean {
  return error.message === NO_MODELS_MESSAGE;
}

/** The provider's own words, without the JSON-RPC prefix OpenCode puts in front. */
function providerDetail(caught: unknown): string {
  return acpErrorMessage(caught)
    .replace(/^(internal error|invalid params|authentication required):?\s*/i, "")
    .trim();
}

export function normalizeOpencodeError(caught: unknown): OpencodeProviderError {
  if (caught instanceof OpencodeProviderError) {
    return caught;
  }
  const message = acpErrorMessage(caught);
  const detail = providerDetail(caught);
  const code = (caught as { code?: unknown } | undefined)?.code;
  const errorName = String(
    (caught instanceof AcpError
      ? (caught.data as { errorName?: unknown } | undefined)?.errorName
      : undefined) ?? ""
  );
  if (isNoModelsError(caught)) {
    return new OpencodeProviderError(NO_MODELS_MESSAGE, "auth");
  }
  if (
    code === 429 ||
    /quota/i.test(errorName) ||
    /quota|rate.?limit|resource.?exhausted|\b429\b|usage limit|insufficient (account )?(funds|credit|balance)|billing/i.test(message)
  ) {
    return new OpencodeProviderError(
      `${detail ? `OpenCode's provider refused the request: ${truncate(detail, 300)}.` : "That provider's usage limit may have been reached."} Choose another model, or check that provider's account.`,
      "usage-limit"
    );
  }
  if (
    code === -32000 ||
    /auth/i.test(errorName) ||
    /auth|sign.?in|log.?in|credential|api key|unauthenticated|permission denied|\b401\b|\b403\b/i.test(message)
  ) {
    return new OpencodeProviderError(
      "OpenCode isn't signed in to this model's provider. Run `opencode auth login` in a terminal, or choose another model.",
      "auth"
    );
  }
  if (/enoent|no such file/i.test(message)) {
    return new OpencodeProviderError(
      "OpenCode is not installed or its executable path is no longer valid.",
      "not-installed"
    );
  }
  return new OpencodeProviderError(
    `OpenCode request failed: ${truncate(detail || message, 500)}`,
    "connection"
  );
}
