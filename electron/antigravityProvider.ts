import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AcpAgent,
  acpErrorMessage,
  startToolBridge,
  toolBridgeServer,
  truncate,
  type ToolBridge
} from "./acpClient";
import type { ChatModelOption } from "./chatModels";
import { geminiPrompt, type GeminiCliToolCallbacks } from "./geminiCliProvider";
import type {
  AntigravityConnectionTest,
  AntigravityInstallProgress,
  AntigravityStatus,
  ChatMessage,
  CorosMcpTool
} from "./types";

// Google's official Antigravity agent for ACP clients (the `antigravity-acp`
// entry in the ACP Registry). It is a separate download from the `agy` CLI,
// which has no ACP mode. CorosLink installs a pinned release under its own
// data folder and gives it a private GEMINI_HOME, so its sign-in, settings
// and conversations never touch the athlete's own Gemini or Antigravity setup.

// Loaded when the agent is installed, not at app startup.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadUnzipper = () => require("unzipper") as {
  Open: {
    file(filename: string): Promise<{
      files: Array<{ path: string; type: string; uncompressedSize: number; stream(): Readable }>;
    }>;
  };
};

export const ANTIGRAVITY_RELEASE_VERSION = "1.4.3";
const RELEASE_BASE = "https://dl.google.com/agy-extensions/releases";

interface AntigravityRelease {
  url: string;
  sha256: string;
  bytes: number;
}

// From the registry's agent.json for 1.4.3; sizes from Google's download server.
const RELEASES: Record<string, AntigravityRelease> = {
  "darwin-arm64": {
    url: `${RELEASE_BASE}/macos/agy-acp-server-1.4.3-darwin-arm64.zip`,
    sha256: "c57db0a9b8b712daa9c3c17cdb990a61842ea569f279e8bd79d7aa85a303b20b",
    bytes: 114_147_623
  },
  "darwin-x64": {
    url: `${RELEASE_BASE}/macos/agy-acp-server-1.4.3-darwin-x86_64.zip`,
    sha256: "9392dbbdad7f0663dbfb5a0bf641297b0cf80d2ee9cd2d49a616bbbc7378731d",
    bytes: 119_801_100
  },
  "linux-x64": {
    url: `${RELEASE_BASE}/linux/agy-acp-server-1.4.3-linux-x86_64.zip`,
    sha256: "0634ce5306ba92c932945455e7a83fda78e2d99c33fa8aa6ee0566206a382714",
    bytes: 336_846_435
  },
  "linux-arm64": {
    url: `${RELEASE_BASE}/linux/agy-acp-server-1.4.3-linux-arm64.zip`,
    sha256: "05c153443b0b1175151c760eeddea538950bc9843e317d54786a1f03670182bc",
    bytes: 322_887_047
  },
  "win32-x64": {
    url: `${RELEASE_BASE}/windows/agy-acp-server-1.4.3-windows-x86_64.zip`,
    sha256: "54c2e16378d9a4952e1da70e355f3c33c4f284308d6de48ab3e6e34a127bd325",
    bytes: 131_267_135
  },
  "win32-arm64": {
    url: `${RELEASE_BASE}/windows/agy-acp-server-1.4.3-windows-arm64.zip`,
    sha256: "fcd46431ad33d3b510ce0b98fe7b43d095bd8b3f1c363ee2d57faa7ee981c7bb",
    bytes: 134_301_870
  }
};

export function antigravityReleaseFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): AntigravityRelease | undefined {
  return RELEASES[`${platform}-${arch}`];
}

function runtimeFileNames(platform: NodeJS.Platform = process.platform) {
  return platform === "win32"
    ? { executable: "agy_acp_server.exe", harness: "localharness_external.exe" }
    : { executable: "agy_acp_server.par", harness: "localharness_external" };
}

const DOWNLOAD_STALL_MS = 60_000;
const TEST_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 3 * 60_000;
// The first launch unpacks the runtime; a cold sign-in or onboarding takes longer.
const SESSION_START_TIMEOUT_MS = 90_000;
const MODEL_LIST_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 6 * 60_000;
const MAX_TOOL_CALLS = 24;
const ACP_PROTOCOL_VERSION = 2;
const MCP_SERVER_NAME = "coroslink";
const AUTH_METHOD = "oauth-personal";
const AUTH_LINK_PREFIX = "Open the following link to authenticate the ACP server: ";
const SIGN_IN_REQUIRED_MESSAGE = "Sign in to Antigravity with your Google account.";
// The agent prints Google's link within seconds of being asked to sign in.
const SIGN_IN_LINK_WAIT_MS = 20_000;

export type AntigravityFailureKind =
  | "not-installed"
  | "auth"
  | "usage-limit"
  | "timeout"
  | "cancelled"
  | "connection";

export class AntigravityProviderError extends Error {
  constructor(
    message: string,
    readonly kind: AntigravityFailureKind
  ) {
    super(message);
    this.name = "AntigravityProviderError";
  }
}

export interface StreamAntigravityOptions extends GeminiCliToolCallbacks {
  /** CorosLink's Antigravity folder (runtime, private home, workspace). */
  root: string;
  instructions: string;
  messages: ChatMessage[];
  tools: CorosMcpTool[];
  signal: AbortSignal;
  timeoutMs?: number;
  /** A model id from the session's model list. Omit for the account default. */
  model?: string;
}

// ----- Folders -----

interface AntigravityFolders {
  runtime: string;
  /** GEMINI_HOME: sign-in, settings, conversations. */
  home: string;
  acp: string;
  /** Each launch unpacks into its own folder here, removed when it exits. */
  temp: string;
  /** The empty folder sessions run in. Built-in tools are off, so nothing reads it. */
  workspace: string;
  downloads: string;
}

function folders(root: string, release = antigravityReleaseFor()): AntigravityFolders {
  const runtimeId = release ? `${ANTIGRAVITY_RELEASE_VERSION}-${release.sha256.slice(0, 12)}` : "unsupported";
  const home = path.join(root, "home");
  return {
    runtime: path.join(root, "runtime", runtimeId),
    home,
    acp: path.join(home, "antigravity-acp"),
    temp: path.join(root, "tmp"),
    workspace: path.join(root, "workspace"),
    downloads: path.join(root, "downloads")
  };
}

const INSTALLED_MARKER = "installed.json";

async function installedRuntime(
  root: string
): Promise<{ executablePath: string; harnessPath: string } | undefined> {
  const release = antigravityReleaseFor();
  if (!release) return undefined;
  const dir = folders(root).runtime;
  const names = runtimeFileNames();
  try {
    const marker = JSON.parse(await readFile(path.join(dir, INSTALLED_MARKER), "utf8")) as {
      sha256?: unknown;
    };
    if (marker.sha256 !== release.sha256) return undefined;
    await stat(path.join(dir, names.executable));
    await stat(path.join(dir, names.harness));
    return {
      executablePath: path.join(dir, names.executable),
      harnessPath: path.join(dir, names.harness)
    };
  } catch {
    return undefined;
  }
}

// ----- Install -----

let installing: { promise: Promise<void>; progress: AntigravityInstallProgress } | undefined;
let lastInstallError: string | undefined;

/**
 * Downloads Google's pinned release, checks its size and SHA-256, and unpacks
 * the server and its harness. Returns at once; the status reports progress.
 */
export function installAntigravityRuntime(
  root: string,
  /** Tests serve their own archive. */
  release = antigravityReleaseFor()
): void {
  if (installing || !release) return;
  const progress: AntigravityInstallProgress = {
    phase: "downloading",
    receivedBytes: 0,
    totalBytes: release.bytes
  };
  lastInstallError = undefined;
  const promise = runInstall(root, release, progress)
    .catch((caught: unknown) => {
      lastInstallError = truncate(acpErrorMessage(caught), 300);
    })
    .finally(() => {
      installing = undefined;
    });
  installing = { promise, progress };
}

/** Resolves when an install in progress finishes. For tests and callers that must wait. */
export async function waitForAntigravityInstall(): Promise<string | undefined> {
  await installing?.promise;
  return lastInstallError;
}

async function runInstall(
  root: string,
  release: AntigravityRelease,
  progress: AntigravityInstallProgress
): Promise<void> {
  if (await installedRuntime(root)) return;
  const dirs = folders(root, release);
  await mkdir(dirs.downloads, { recursive: true, mode: 0o700 });
  const archive = path.join(dirs.downloads, `${release.sha256}.zip`);
  const partial = `${archive}.partial`;

  const controller = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const armStall = () => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
  };
  armStall();
  try {
    const response = await fetch(release.url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`Google's download server answered ${response.status}.`);
    }
    const hash = crypto.createHash("sha256");
    let received = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > release.bytes) {
          callback(new Error("The download is larger than the expected release."));
          return;
        }
        hash.update(chunk);
        progress.receivedBytes = received;
        armStall();
        callback(null, chunk);
      }
    });
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      meter,
      createWriteStream(partial, { mode: 0o600 })
    );
    if (received !== release.bytes || hash.digest("hex") !== release.sha256) {
      throw new Error("The download did not match Google's published checksum.");
    }
  } catch (caught) {
    await rm(partial, { force: true });
    if (controller.signal.aborted) throw new Error("The download stalled. Check your connection and try again.");
    throw caught;
  } finally {
    clearTimeout(stall);
  }
  await rename(partial, archive);

  progress.phase = "extracting";
  const names = runtimeFileNames();
  const staging = `${dirs.runtime}.partial-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const directory = await loadUnzipper().Open.file(archive);
    const members = directory.files.filter((entry) => entry.type === "File");
    const expected = new Set([names.executable, names.harness]);
    if (
      members.length !== expected.size ||
      !members.every((entry) => expected.has(entry.path))
    ) {
      throw new Error("The archive does not contain the expected Antigravity files.");
    }
    for (const entry of members) {
      const target = path.join(staging, entry.path);
      await pipeline(entry.stream(), createWriteStream(target, { mode: 0o700 }));
      await chmod(target, 0o755);
    }
    await writeFile(
      path.join(staging, INSTALLED_MARKER),
      `${JSON.stringify({ version: ANTIGRAVITY_RELEASE_VERSION, sha256: release.sha256 })}\n`
    );
    await rm(dirs.runtime, { recursive: true, force: true });
    await rename(staging, dirs.runtime);
  } catch (caught) {
    await rm(staging, { recursive: true, force: true });
    throw caught;
  } finally {
    await rm(archive, { force: true });
  }
  // Earlier releases are no longer used.
  const runtimes = path.dirname(dirs.runtime);
  for (const entry of await readdir(runtimes).catch(() => [] as string[])) {
    if (entry !== path.basename(dirs.runtime)) {
      await rm(path.join(runtimes, entry), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Removes the downloaded runtime. Sign-in stays in the private home. */
export async function removeAntigravityRuntime(root: string): Promise<void> {
  if (installing) throw new Error("The Antigravity download is still running.");
  await rm(path.join(root, "runtime"), { recursive: true, force: true });
  await rm(folders(root).downloads, { recursive: true, force: true });
}

// ----- Sign-in state -----

interface PendingLogin {
  promise: Promise<void>;
  url?: string;
  startedAt: number;
  /** Where the sign-in is, so a slow step says which one it is. */
  phase: "starting" | "signing-in" | "checking-plan";
  phaseStartedAt: number;
  /** The agent's latest log line, shown when a step is slow. */
  lastLine?: string;
  /** Stops the agent; the sign-in then ends without an error. */
  cancel?: () => void;
  cancelled?: boolean;
}

let pendingLogin: PendingLogin | undefined;
let lastLoginError: string | undefined;
/** A refusal from Google, held until the athlete signs in again. */
let lastRefusal: string | undefined;

async function hasSavedSignIn(root: string): Promise<boolean> {
  try {
    await stat(path.join(folders(root).acp, "acp_token.json"));
    return true;
  } catch {
    return false;
  }
}

/** The private home's settings: Google sign-in, never a credential. */
async function prepareHome(root: string): Promise<void> {
  const dirs = folders(root);
  for (const dir of [dirs.home, dirs.acp, dirs.temp, dirs.workspace]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const target = path.join(dirs.acp, "settings.json");
  const content = `${JSON.stringify({ auth: { type: AUTH_METHOD } })}\n`;
  try {
    if ((await readFile(target, "utf8")) === content) return;
  } catch {
    // Written below.
  }
  await writeFile(target, content, { mode: 0o600 });
}

export async function getAntigravityStatus(root: string): Promise<AntigravityStatus> {
  const checkedAt = new Date().toISOString();
  const release = antigravityReleaseFor();
  const base = { checkedAt, version: ANTIGRAVITY_RELEASE_VERSION, downloadBytes: release?.bytes };
  if (!release) {
    return {
      ...base,
      state: "unsupported",
      installed: false,
      authenticated: false,
      message: "Google doesn't publish Antigravity for this computer's processor."
    };
  }
  if (installing) {
    return {
      ...base,
      state: "installing",
      installed: false,
      authenticated: false,
      install: { ...installing.progress },
      message:
        installing.progress.phase === "extracting"
          ? "Unpacking Antigravity…"
          : "Downloading Antigravity from Google…"
    };
  }
  if (!(await installedRuntime(root))) {
    return {
      ...base,
      state: "not-installed",
      installed: false,
      authenticated: false,
      message: lastInstallError
        ? `The Antigravity download failed: ${lastInstallError}`
        : "Download Google's Antigravity agent to use it for Coach."
    };
  }
  if (pendingLogin) {
    return {
      ...base,
      state: "connecting",
      installed: true,
      authenticated: false,
      signInUrl: pendingLogin.url,
      message: pendingLoginMessage(pendingLogin)
    };
  }
  if (!(await hasSavedSignIn(root)) || lastRefusal) {
    return {
      ...base,
      state: "sign-in-required",
      installed: true,
      authenticated: false,
      message: lastLoginError
        ? `Google sign-in did not finish: ${lastLoginError}`
        : lastRefusal ?? SIGN_IN_REQUIRED_MESSAGE
    };
  }
  return {
    ...base,
    state: "connected",
    installed: true,
    authenticated: true,
    message: "Antigravity is signed in with your Google account."
  };
}

/** What a waiting sign-in is doing; a slow step says so, with the agent's last words. */
function pendingLoginMessage(login: PendingLogin): string {
  const slow = Date.now() - login.phaseStartedAt > SIGN_IN_LINK_WAIT_MS;
  const lastWords = login.lastLine ? ` Antigravity's last message: "${truncate(login.lastLine, 200)}"` : "";
  switch (login.phase) {
    case "starting":
      return slow
        ? "Antigravity is still starting. Its first start can take a few minutes, longer on Windows while your antivirus checks it." + lastWords
        : "Starting Antigravity…";
    case "signing-in":
      if (login.url) return "Finish signing in with Google in your browser. Closed the page? Open it again.";
      return slow
        ? "Antigravity hasn't given Google's sign-in page yet. Wait a little, or cancel and try again." + lastWords
        : "Opening Google's sign-in page…";
    case "checking-plan":
      return slow
        ? "Signed in. Google is still checking that your plan includes Antigravity." + lastWords
        : "Signed in. Checking that your Google plan includes Antigravity…";
  }
}

/** Google's sign-in page, and nothing else, may be opened from what the agent prints. */
export function parseAntigravitySignInUrl(line: string): string | undefined {
  const index = line.indexOf(AUTH_LINK_PREFIX);
  if (index < 0) return undefined;
  const raw = line.slice(index + AUTH_LINK_PREFIX.length).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const redirect = url.searchParams.get("redirect_uri") ?? "";
  if (
    url.protocol !== "https:" ||
    url.host !== "accounts.google.com" ||
    url.username ||
    url.password ||
    !/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/[\w\-./]*$/.test(redirect)
  ) {
    return undefined;
  }
  return url.href;
}

/**
 * Starts Google sign-in: the agent waits for Google's redirect on a loopback
 * port, CorosLink opens the page. Returns at once; the status turns connected
 * once the sign-in is saved and a session starts.
 */
export async function signInToAntigravity(
  root: string,
  openUrl: (url: string) => void
): Promise<AntigravityStatus> {
  const status = await getAntigravityStatus(root);
  if (!status.installed || pendingLogin) return status;

  lastLoginError = undefined;
  lastRefusal = undefined;
  const now = Date.now();
  const login: PendingLogin = { promise: Promise.resolve(), startedAt: now, phase: "starting", phaseStartedAt: now };
  const enter = (phase: PendingLogin["phase"]) => {
    login.phase = phase;
    login.phaseStartedAt = Date.now();
  };
  login.promise = (async () => {
    await prepareHome(root);
    const launch = await launchAgent(root, {
      onSignInUrl: (url) => {
        if (login.url) return;
        login.url = url;
        openUrl(url);
      },
      onLogLine: (line) => {
        const text = stripVTControlCharacters(line).trim();
        if (text && !text.includes(AUTH_LINK_PREFIX)) login.lastLine = text;
      }
    });
    if (login.cancelled) {
      await launch.close();
      return;
    }
    login.cancel = () => launch.agent.close();
    const timer = setTimeout(() => launch.agent.close(), LOGIN_TIMEOUT_MS);
    try {
      await launch.agent.initialize(ACP_PROTOCOL_VERSION);
      enter("signing-in");
      await launch.agent.request("authenticate", { methodId: AUTH_METHOD });
      // Signing in is not enough: Google checks the account's plan when a session starts.
      enter("checking-plan");
      const session = (await launch.agent.request("session/new", sessionParams(root, undefined, ""))) as {
        sessionId?: string;
        configOptions?: unknown;
      };
      rememberModels(session.configOptions);
      await launch.trackSession(session.sessionId);
    } catch (caught) {
      if (login.cancelled) return;
      const error = normalizeAntigravityError(caught);
      if (error.kind === "auth" || error.kind === "usage-limit") lastRefusal = error.message;
      throw error;
    } finally {
      clearTimeout(timer);
      await launch.close();
    }
  })()
    .catch((caught: unknown) => {
      if (!login.cancelled) lastLoginError = truncate(acpErrorMessage(caught), 300);
    })
    .finally(() => {
      // A cancelled sign-in may finish after a new one started.
      if (pendingLogin === login) pendingLogin = undefined;
    });
  pendingLogin = login;

  return {
    ...status,
    state: "connecting",
    checkedAt: new Date().toISOString(),
    message: "Starting Antigravity…"
  };
}

/** Stops a sign-in that is waiting on Google, so the athlete can start again. */
export async function cancelAntigravitySignIn(root: string): Promise<AntigravityStatus> {
  const login = pendingLogin;
  if (login) {
    login.cancelled = true;
    if (login.cancel) {
      login.cancel();
      await login.promise;
    } else {
      // Still starting: nothing to stop yet. The launch closes itself once it is up,
      // so don't make the athlete wait for a slow first start.
      if (pendingLogin === login) pendingLogin = undefined;
    }
  }
  return getAntigravityStatus(root);
}

/** Google's page for the sign-in that is waiting, to open again after the tab was closed. */
export function pendingAntigravitySignInUrl(): string | undefined {
  return pendingLogin?.url;
}

/**
 * "Check again": a refusal or failed sign-in is remembered in memory, so reading
 * the status alone never changes it. With a saved sign-in, this asks Google again
 * by starting a session (no prompt is sent), and the status follows the answer.
 */
export async function recheckAntigravity(root: string): Promise<AntigravityStatus> {
  if (pendingLogin || !(lastRefusal || lastLoginError) || !(await hasSavedSignIn(root))) {
    return getAntigravityStatus(root);
  }
  lastRefusal = undefined;
  lastLoginError = undefined;
  try {
    await listAntigravityModels(root);
  } catch (caught) {
    const error = normalizeAntigravityError(caught);
    if (!lastRefusal) {
      lastRefusal =
        error.kind === "auth" || error.kind === "usage-limit"
          ? error.message
          : `Couldn't reach Antigravity to check the sign-in: ${truncate(error.message, 200)}`;
    }
  }
  return getAntigravityStatus(root);
}

/** Removes the saved Google sign-in from CorosLink's private Antigravity home. */
export async function signOutOfAntigravity(root: string): Promise<AntigravityStatus> {
  const dirs = folders(root);
  await rm(path.join(dirs.acp, "acp_token.json"), { force: true });
  lastRefusal = undefined;
  lastLoginError = undefined;
  sessionModels = [];
  return getAntigravityStatus(root);
}

/** Resolves when a sign-in in progress finishes. For tests. */
export async function waitForAntigravitySignIn(): Promise<void> {
  await pendingLogin?.promise;
}

// ----- Models -----

// What the last session offered; the model picker reads these.
let sessionModels: ChatModelOption[] = [];

function rememberModels(configOptions: unknown): void {
  const options = antigravityModelOptions(configOptions);
  if (options.length > 0) sessionModels = options;
}

export function getAntigravitySessionModels(): ChatModelOption[] {
  return sessionModels;
}

interface SelectOption {
  value?: unknown;
  name?: unknown;
  description?: unknown;
  options?: unknown;
}

function modelConfig(configOptions: unknown): { current?: string; options: SelectOption[] } | undefined {
  if (!Array.isArray(configOptions)) return undefined;
  const model = configOptions.find(
    (option): option is { type?: unknown; currentValue?: unknown; options?: unknown } =>
      Boolean(option) && typeof option === "object" && (option as { id?: unknown }).id === "model"
  );
  if (!model || model.type !== "select" || !Array.isArray(model.options)) return undefined;
  // Options are either flat or grouped under a heading.
  const options = (model.options as SelectOption[]).flatMap((entry) =>
    Array.isArray(entry?.options) ? (entry.options as SelectOption[]) : [entry]
  );
  return {
    current: typeof model.currentValue === "string" ? model.currentValue : undefined,
    options
  };
}

/** "Default · <current model>" first, then each model the session offers. */
export function antigravityModelOptions(configOptions: unknown): ChatModelOption[] {
  const config = modelConfig(configOptions);
  if (!config) return [];
  const rows = config.options
    .filter((option): option is SelectOption & { value: string } =>
      typeof option?.value === "string" && option.value.length > 0
    )
    .map((option) => ({
      value: option.value,
      label: typeof option.name === "string" && option.name ? option.name : option.value
    }));
  if (rows.length === 0) return [];
  const current = rows.find((row) => row.value === config.current);
  return [
    current ? { value: "", label: "Default", detail: current.label } : { value: "", label: "Default" },
    ...rows
  ];
}

/**
 * The models this account can use, from a session that never sends a prompt.
 * Sign-in is never started from here: a lapsed one just fails.
 */
export async function listAntigravityModels(root: string): Promise<ChatModelOption[]> {
  const status = await getAntigravityStatus(root);
  if (!status.authenticated) return [];
  await prepareHome(root);
  const launch = await launchAgent(root, {});
  const timer = setTimeout(() => launch.agent.close(), MODEL_LIST_TIMEOUT_MS);
  try {
    await launch.agent.initialize(ACP_PROTOCOL_VERSION);
    const session = (await launch.agent.request("session/new", sessionParams(root, undefined, ""))) as {
      sessionId?: string;
      configOptions?: unknown;
    };
    await launch.trackSession(session.sessionId);
    rememberModels(session.configOptions);
    return antigravityModelOptions(session.configOptions);
  } catch (caught) {
    if (launch.signInRequired()) lastRefusal = SIGN_IN_REQUIRED_MESSAGE;
    throw normalizeAntigravityError(caught);
  } finally {
    clearTimeout(timer);
    await launch.close();
  }
}

// ----- Launch -----

/**
 * The agent's environment. Ambient Google credentials and settings are left
 * out so only CorosLink's private sign-in is used, and the agent never opens a
 * browser itself: CorosLink opens Google's page when the athlete asked to sign in.
 */
export function antigravityEnvironment(
  input: { home: string; harnessPath: string; temp: string },
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  helper: string = process.execPath
): NodeJS.ProcessEnv {
  const removed = new Set([
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_CLOUD_QUOTA_PROJECT",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GCLOUD_PROJECT",
    "CLOUDSDK_CORE_PROJECT",
    "GEMINI_HOME",
    "ANTIGRAVITY_HARNESS_PATH",
    "AGY_ACP_FORCE_FILE_STORAGE",
    "BROWSER",
    "PYTHONUNBUFFERED",
    "ELECTRON_RUN_AS_NODE"
  ]);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    // Windows environment keys are case-insensitive.
    if (!removed.has(key.toUpperCase())) env[key] = value;
  }
  return {
    ...env,
    GEMINI_HOME: input.home,
    ANTIGRAVITY_HARNESS_PATH: input.harnessPath,
    AGY_ACP_FORCE_FILE_STORAGE: "1",
    PYTHONUNBUFFERED: "1",
    ...silentBrowser(platform, helper),
    ...(platform === "win32" ? { TEMP: input.temp, TMP: input.temp } : { TMPDIR: input.temp })
  };
}

/**
 * Python's webbrowser runs $BROWSER with the sign-in URL. A command that exits
 * at once means the page is never opened behind the athlete's back. Windows has
 * no `true`, so Electron runs as Node there; shlex parses the command, so its
 * path uses forward slashes.
 */
function silentBrowser(platform: NodeJS.Platform, helper: string): NodeJS.ProcessEnv {
  if (platform !== "win32") return { BROWSER: "true" };
  return {
    ELECTRON_RUN_AS_NODE: "1",
    BROWSER: `'${helper.replaceAll("\\", "/").replaceAll("'", "")}' -e 0 %s`
  };
}

interface Launch {
  agent: AcpAgent;
  signInRequired(): boolean;
  /** A session whose saved conversation is deleted on close. */
  trackSession(sessionId: string | undefined): Promise<void>;
  close(): Promise<void>;
}

async function launchAgent(
  root: string,
  options: {
    onSignInUrl?: (url: string) => void;
    onPermission?: (params: unknown) => unknown;
    /** Every line the agent logs, for a sign-in that needs to say where it is. */
    onLogLine?: (line: string) => void;
  }
): Promise<Launch> {
  const runtime = await installedRuntime(root);
  if (!runtime) {
    throw new AntigravityProviderError("Antigravity is not downloaded yet.", "not-installed");
  }
  const dirs = folders(root);
  const temp = path.join(dirs.temp, crypto.randomUUID());
  await mkdir(temp, { recursive: true, mode: 0o700 });
  let signInRequired = false;
  let agent: AcpAgent;
  try {
    agent = AcpAgent.start(runtime.executablePath, process.platform === "linux" ? ["--uid="] : [], {
      cwd: dirs.workspace,
      env: antigravityEnvironment({ home: dirs.home, harnessPath: runtime.harnessPath, temp }),
      label: "Antigravity",
      onPermission: options.onPermission,
      onStderrLine: (line) => {
        options.onLogLine?.(line);
        const url = parseAntigravitySignInUrl(line);
        if (!url) return;
        if (options.onSignInUrl) {
          options.onSignInUrl(url);
        } else {
          // Outside sign-in the saved one has lapsed; never wait on a browser here.
          signInRequired = true;
          agent.close();
        }
      }
    });
  } catch (caught) {
    await rm(temp, { recursive: true, force: true });
    throw caught;
  }
  const sessions = new Set<string>();
  return {
    agent,
    signInRequired: () => signInRequired,
    trackSession: async (sessionId) => {
      if (sessionId) sessions.add(sessionId);
    },
    close: async () => {
      await agent.stop(5_000);
      for (const sessionId of sessions) await removeSessionFiles(dirs.acp, sessionId);
      // Windows keeps a live process's files locked, so this runs after exit.
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

/** Coach keeps its own transcript, so the agent's saved copy is deleted. */
async function removeSessionFiles(acpDir: string, sessionId: string): Promise<void> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) return;
  const conversations = path.join(acpDir, "conversations");
  for (const entry of await readdir(conversations).catch(() => [] as string[])) {
    if (entry === sessionId || entry.startsWith(`${sessionId}.`)) {
      await rm(path.join(conversations, entry), { recursive: true, force: true }).catch(() => undefined);
    }
  }
  await rm(path.join(acpDir, "brain", sessionId), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Coach sessions use only CorosLink's tools: every Antigravity built-in (files,
 * terminal, web, subagents) is switched off, and the tool bridge's tools are
 * declared up front instead of being looked up through file reads.
 */
function sessionParams(root: string, bridge: ToolBridge | undefined, instructions: string) {
  const antigravity: Record<string, unknown> = {
    enabledTools: [],
    eagerMcpServers: [MCP_SERVER_NAME]
  };
  if (instructions) antigravity.systemPrompt = { append: instructions };
  return {
    cwd: folders(root).workspace,
    mcpServers: bridge ? [toolBridgeServer(bridge, MCP_SERVER_NAME)] : [],
    _meta: { antigravity }
  };
}

/** Approves calls to CorosLink's own tools; anything else is declined. */
export function answerAntigravityPermission(params: unknown): unknown {
  const request = params as {
    toolCall?: { _meta?: { mcp?: { server?: unknown }; is_mcp_tool_call?: unknown } };
    options?: Array<{ optionId?: unknown; kind?: unknown }>;
  };
  const meta = request?.toolCall?._meta;
  const ours = meta?.is_mcp_tool_call === true && meta.mcp?.server === MCP_SERVER_NAME;
  const allowOnce = request?.options?.find((option) => option?.kind === "allow_once");
  if (!ours || typeof allowOnce?.optionId !== "string") {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
}

// ----- Streaming -----

export async function streamAntigravityCompletion(
  options: StreamAntigravityOptions
): Promise<{ fullText: string }> {
  let externallyCancelled = false;
  let timedOut = false;
  let launch: Launch | undefined;
  const onAbort = () => {
    externallyCancelled = true;
    launch?.agent.close();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  const idleTimeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let sessionStarted = false;
  const armIdleTimeout = (ms = idleTimeoutMs) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timedOut = true;
      launch?.agent.close();
    }, ms);
  };
  armIdleTimeout(Math.min(idleTimeoutMs, SESSION_START_TIMEOUT_MS));

  let fullText = "";
  let toolCalls = 0;
  let bridge: ToolBridge | undefined;

  try {
    await prepareHome(options.root);
    if (options.tools.length > 0) {
      bridge = await startToolBridge(MCP_SERVER_NAME, options.tools, {
        ...options,
        onActivity: () => armIdleTimeout()
      });
    }
    if (options.signal.aborted) throw new Error("cancelled");
    launch = await launchAgent(options.root, { onPermission: answerAntigravityPermission });
    const agent = launch.agent;
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
          agent.notify("session/cancel", { sessionId });
        }
      }
    };

    await agent.initialize(ACP_PROTOCOL_VERSION);
    const session = (await agent.request(
      "session/new",
      sessionParams(options.root, bridge, options.instructions)
    )) as { sessionId?: string; configOptions?: unknown };
    if (!session.sessionId) throw new Error("Antigravity did not start a session.");
    sessionId = session.sessionId;
    await launch.trackSession(sessionId);
    sessionStarted = true;
    lastRefusal = undefined;
    rememberModels(session.configOptions);

    if (options.model) {
      const config = modelConfig(session.configOptions);
      if (config?.current !== options.model) {
        if (!config?.options.some((option) => option.value === options.model)) {
          throw new AntigravityProviderError(
            "That Antigravity model isn't available for this Google account. Choose another model.",
            "connection"
          );
        }
        await agent.request("session/set_config_option", {
          sessionId,
          configId: "model",
          value: options.model
        });
      }
    }
    armIdleTimeout();

    const result = (await agent.request("session/prompt", {
      sessionId,
      prompt: geminiPrompt(options.messages)
    })) as { stopReason?: string };

    if (result.stopReason === "cancelled") {
      if (toolCalls > MAX_TOOL_CALLS && !externallyCancelled) {
        throw new AntigravityProviderError(
          "Antigravity kept calling tools without answering. Try a narrower question.",
          "connection"
        );
      }
      throw new Error("cancelled");
    }
    if (!fullText.trim()) {
      if (result.stopReason === "refusal") {
        throw new AntigravityProviderError("Antigravity declined to answer this request.", "connection");
      }
      if (result.stopReason === "max_tokens" || result.stopReason === "max_turn_requests") {
        throw new AntigravityProviderError(
          "Antigravity stopped before answering. Try again or start a new conversation.",
          "connection"
        );
      }
    }
    return { fullText };
  } catch (caught) {
    if (launch?.signInRequired()) {
      lastRefusal = "Your Antigravity sign-in has expired. Sign in again.";
      throw new AntigravityProviderError(lastRefusal, "auth");
    }
    if (caught instanceof AntigravityProviderError) throw caught;
    if (timedOut) {
      throw new AntigravityProviderError(
        sessionStarted
          ? "Antigravity stopped responding. Try again."
          : "Antigravity did not start a session. Check your connection, then try again.",
        "timeout"
      );
    }
    if (externallyCancelled || options.signal.aborted) {
      throw new AntigravityProviderError("Antigravity request cancelled.", "cancelled");
    }
    const error = normalizeAntigravityError(caught);
    if (error.kind === "auth") lastRefusal = error.message;
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", onAbort);
    await launch?.close();
    await bridge?.close();
  }
}

export function normalizeAntigravityError(caught: unknown): AntigravityProviderError {
  if (caught instanceof AntigravityProviderError) return caught;
  const message = acpErrorMessage(caught);
  const detail = (caught as { detail?: unknown } | undefined)?.detail;
  const text = typeof detail === "string" && detail ? `${message} ${detail}` : message;
  const code = (caught as { code?: unknown } | undefined)?.code;
  if (/SUBSCRIPTION_REQUIRED/i.test(text)) {
    return new AntigravityProviderError(
      "Google requires an eligible Antigravity plan for this account.",
      "auth"
    );
  }
  if (code === 429 || /quota|rate.?limit|resource.?exhausted|\b429\b|usage limit/i.test(text)) {
    return new AntigravityProviderError(
      "Your Antigravity usage limit may have been reached. Try again later or choose another provider.",
      "usage-limit"
    );
  }
  if (/onboarding failed/i.test(text)) {
    return new AntigravityProviderError(
      `Google could not set up Antigravity for this account: ${truncate(text.replace(/^.*onboarding failed:\s*/i, ""), 300)}`,
      "auth"
    );
  }
  if (code === -32000 || /authentication required|unauthenticated|sign.?in|log.?in|\b401\b/i.test(text)) {
    return new AntigravityProviderError(SIGN_IN_REQUIRED_MESSAGE, "auth");
  }
  if (/enoent|eacces|not downloaded/i.test(text)) {
    return new AntigravityProviderError(
      "Antigravity's runtime is missing or can't run. Download it again in Coach settings.",
      "not-installed"
    );
  }
  return new AntigravityProviderError(`Antigravity connection failed: ${truncate(text, 500)}`, "connection");
}

export async function testAntigravityConnection(root: string): Promise<AntigravityConnectionTest> {
  const status = await getAntigravityStatus(root);
  if (!status.authenticated) return { ok: false, status, message: status.message };
  const controller = new AbortController();
  try {
    let reply = "";
    await streamAntigravityCompletion({
      root,
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
    return {
      ok: true,
      status: {
        ...status,
        state: "connected",
        checkedAt: new Date().toISOString(),
        message: "Antigravity is connected and ready for Coach conversations."
      },
      message: reply.trim()
        ? "Antigravity is connected and responded successfully."
        : "Antigravity is connected and ready."
    };
  } catch (caught) {
    const error = normalizeAntigravityError(caught);
    const failed: AntigravityStatus = {
      ...(await getAntigravityStatus(root)),
      checkedAt: new Date().toISOString(),
      message: error.message
    };
    if (error.kind === "usage-limit") failed.state = "usage-limit-reached";
    else if (error.kind !== "auth" && failed.state === "connected") failed.state = "connection-failed";
    return { ok: false, status: failed, message: error.message };
  }
}
