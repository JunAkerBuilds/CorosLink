import { execFile, spawn } from "node:child_process";
import { access, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { constants as fsConstants } from "node:fs";
import { z } from "zod";
import type { ClaudeCliModel } from "./chatModels";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" };
import type {
  ChatMessage,
  ClaudeCodeConnectionTest,
  ClaudeCodeStatus,
  CorosMcpTool
} from "./types";

const execFileAsync = promisify(execFile);
const DETECTION_TIMEOUT_MS = 5_000;
const AUTH_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 3 * 60_000;
const MODEL_LIST_TIMEOUT_MS = 20_000;

const SUBSCRIPTION_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS"
] as const;

export type ClaudeCodeFailureKind =
  | "not-installed"
  | "auth"
  | "usage-limit"
  | "timeout"
  | "cancelled"
  | "connection";

export class ClaudeCodeProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ClaudeCodeFailureKind
  ) {
    super(message);
    this.name = "ClaudeCodeProviderError";
  }
}

export interface ClaudeCodeToolCallbacks {
  onToken(delta: string): void;
  onThinking?(delta: string): void;
  onToolCallStart?(toolName: string): void;
  onToolCallError?(toolName: string, message: string): void;
  onToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string>;
}

export interface StreamClaudeCodeOptions extends ClaudeCodeToolCallbacks {
  executablePath: string;
  /** Empty directory the CLI runs in, so it never starts in `/` or the athlete's files. */
  workspaceDir?: string;
  instructions: string;
  messages: ChatMessage[];
  tools: CorosMcpTool[];
  signal: AbortSignal;
  timeoutMs?: number;
  /** Model alias (opus/fable/sonnet/haiku) or full id. Omit for the account default. */
  model?: string;
}

interface ClaudeAuthStatusPayload {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
}

export function getClaudeExecutableCandidates(
  customPath?: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const candidates = [customPath?.trim()].filter(
    (value): value is string => Boolean(value)
  );

  if (platform === "win32") {
    if (env.LOCALAPPDATA) {
      candidates.push(
        path.join(env.LOCALAPPDATA, "Programs", "Claude", "claude.exe"),
        path.join(env.LOCALAPPDATA, "Claude", "claude.exe")
      );
    }
    if (env.APPDATA) {
      candidates.push(npmPackageClaudeExe(path.join(env.APPDATA, "npm")));
    }
    candidates.push(
      path.join(home, ".local", "bin", "claude.exe"),
      path.join(home, ".claude", "local", "claude.exe")
    );
  } else {
    candidates.push(
      path.join(home, ".local", "bin", "claude"),
      path.join(home, ".claude", "local", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude"
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

/** The native binary npm installs under a global prefix (where its `claude.cmd` shim lives). */
function npmPackageClaudeExe(prefix: string): string {
  return path.join(prefix, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
}

/** Every `claude` on PATH, in PATH order. */
async function findClaudeOnPath(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      process.platform === "win32" ? "where.exe" : "which",
      process.platform === "win32" ? ["claude"] : ["-a", "claude"],
      { timeout: DETECTION_TIMEOUT_MS, windowsHide: true }
    );
    return stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Every Claude Code install on this computer, in the order they were found. */
export async function listClaudeCodeInstalls(): Promise<string[]> {
  const onPath = await findClaudeOnPath();
  const found = [
    ...getClaudeExecutableCandidates(),
    ...onPath,
    // An npm install puts shims on PATH that can't be launched directly; its binary sits beside them.
    ...(process.platform === "win32"
      ? onPath.map((shim) => npmPackageClaudeExe(path.dirname(shim)))
      : [])
  ];
  const installs: string[] = [];
  for (const candidate of new Set(found)) {
    if (await isExecutable(candidate)) installs.push(candidate);
  }
  return installs;
}

/** Orders `claude --version` answers like "2.1.3 (Claude Code)"; an unknown version sorts first. */
export function compareClaudeCodeVersions(left?: string, right?: string): number {
  const parts = (value?: string) =>
    value?.match(/\d+(?:\.\d+)*/)?.[0].split(".").map(Number) ?? [];
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? -1) - (b[index] ?? -1);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/**
 * The install to use: the newest version, and on Windows an `.exe` over a
 * shim of the same version. Ties keep the order the installs were found in.
 */
export function pickClaudeCodeInstall(
  installs: Array<{ path: string; version?: string }>,
  platform = process.platform
): string | undefined {
  const exe = (candidate: string) =>
    platform === "win32" && /\.exe$/i.test(candidate) ? 1 : 0;
  return [...installs].sort(
    (left, right) =>
      compareClaudeCodeVersions(right.version, left.version) ||
      exe(right.path) - exe(left.path)
  )[0]?.path;
}

export async function detectClaudeCodeExecutable(
  customPath?: string,
  workspaceDir?: string
): Promise<string | undefined> {
  const explicitPath = customPath?.trim();
  if (explicitPath) {
    return (await isExecutable(explicitPath)) ? explicitPath : undefined;
  }

  const installs = await listClaudeCodeInstalls();
  if (installs.length <= 1) return installs[0];
  const versions = await Promise.all(
    installs.map((install) =>
      readClaudeCodeVersion(install, workspaceDir).catch(() => undefined)
    )
  );
  return pickClaudeCodeInstall(
    installs.map((install, index) => ({ path: install, version: versions[index] }))
  );
}

// `--version` launches the CLI, so its answer is kept until the installed file changes.
const versionCache = new Map<string, Promise<string | undefined>>();

async function readClaudeCodeVersion(
  executablePath: string,
  workspaceDir?: string
): Promise<string | undefined> {
  const file = await stat(executablePath);
  const key = `${executablePath}\0${file.size}\0${file.mtimeMs}`;
  let version = versionCache.get(key);
  if (!version) {
    version = execClaude(executablePath, ["--version"], {
      timeout: DETECTION_TIMEOUT_MS,
      cwd: workspaceDir
    }).then((result) => result.stdout.trim() || undefined);
    versionCache.set(key, version);
    // A launch that failed is tried again next time.
    version.catch(() => versionCache.delete(key));
  }
  return version;
}

/** The empty folder Claude Code runs in; created on first use. */
async function prepareWorkspace(workspaceDir?: string): Promise<void> {
  if (workspaceDir) await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
}

export function createClaudeSubscriptionEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of SUBSCRIPTION_ENV_KEYS) {
    delete env[key];
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "coroslink-coach";
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = "1";
  return env;
}

export function parseClaudeAuthStatusOutput(
  output: string
): ClaudeAuthStatusPayload | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as ClaudeAuthStatusPayload;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as ClaudeAuthStatusPayload;
    } catch {
      return undefined;
    }
  }
}

export async function getClaudeCodeStatus(
  customPath?: string,
  workspaceDir?: string
): Promise<ClaudeCodeStatus> {
  const checkedAt = new Date().toISOString();
  await prepareWorkspace(workspaceDir);
  const executablePath = await detectClaudeCodeExecutable(customPath, workspaceDir);
  if (!executablePath) {
    return {
      state: "not-installed",
      installed: false,
      authenticated: false,
      checkedAt,
      message:
        "Claude Code is not installed. Install it to use your Claude subscription with CorosLink."
    };
  }

  let version: string | undefined;
  try {
    version = await readClaudeCodeVersion(executablePath, workspaceDir);
  } catch (caught) {
    return {
      state: "connection-failed",
      installed: true,
      authenticated: false,
      executablePath,
      checkedAt,
      message: `Claude Code was found but could not launch: ${safeErrorMessage(caught)}`
    };
  }

  try {
    const result = await execClaude(executablePath, ["auth", "status"], {
      timeout: AUTH_TIMEOUT_MS,
      cwd: workspaceDir
    });
    const payload = parseClaudeAuthStatusOutput(result.stdout);
    const usesSubscription =
      payload?.loggedIn === true &&
      (payload.authMethod === "claude.ai" || Boolean(payload.subscriptionType));

    if (!usesSubscription) {
      return {
        state: "sign-in-required",
        installed: true,
        authenticated: false,
        executablePath,
        version,
        authMethod: payload?.authMethod,
        subscriptionType: payload?.subscriptionType,
        checkedAt,
        message: payload?.loggedIn
          ? "Claude Code is signed in without a Claude subscription. Sign in again and choose your Claude account subscription."
          : "Claude Code is installed, but sign-in is required."
      };
    }

    return {
      state: "connected",
      installed: true,
      authenticated: true,
      executablePath,
      version,
      authMethod: payload?.authMethod,
      subscriptionType: payload?.subscriptionType,
      checkedAt,
      message: payload?.subscriptionType
        ? `Claude Code is connected with your ${payload.subscriptionType} subscription.`
        : "Claude Code is connected with your Claude subscription."
    };
  } catch {
    return {
      state: "sign-in-required",
      installed: true,
      authenticated: false,
      executablePath,
      version,
      checkedAt,
      message: "Claude Code is installed, but sign-in is required."
    };
  }
}

export async function launchClaudeCodeLogin(
  customPath?: string,
  workspaceDir?: string
): Promise<ClaudeCodeStatus> {
  const status = await getClaudeCodeStatus(customPath, workspaceDir);
  if (!status.installed || !status.executablePath || status.authenticated) {
    return status;
  }

  try {
    const child = spawn(status.executablePath, ["auth", "login"], {
      cwd: workspaceDir,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: createClaudeSubscriptionEnvironment()
    });
    child.unref();
  } catch (caught) {
    return {
      ...status,
      state: "connection-failed",
      message: `Claude sign-in could not be started: ${safeErrorMessage(caught)}`
    };
  }

  return {
    ...status,
    state: "connecting",
    checkedAt: new Date().toISOString(),
    message: "Complete Claude's official sign-in flow, then test the connection."
  };
}

export async function testClaudeCodeConnection(
  customPath?: string,
  workspaceDir?: string
): Promise<ClaudeCodeConnectionTest> {
  const status = await getClaudeCodeStatus(customPath, workspaceDir);
  if (!status.authenticated || !status.executablePath) {
    return { ok: false, status, message: status.message };
  }

  const controller = new AbortController();
  try {
    let reply = "";
    await streamClaudeCodeCompletion({
      executablePath: status.executablePath,
      workspaceDir,
      instructions:
        "You are performing a connection check. Reply with exactly: Connected",
      messages: [{ role: "user", content: "Test the connection." }],
      tools: [],
      signal: controller.signal,
      timeoutMs: TEST_TIMEOUT_MS,
      onToken: (delta) => {
        reply += delta;
      },
      onToolCall: async () => ""
    });
    const connectedStatus: ClaudeCodeStatus = {
      ...status,
      state: "connected",
      checkedAt: new Date().toISOString(),
      message: "Claude Code is connected and ready for Coach conversations."
    };
    return {
      ok: true,
      status: connectedStatus,
      message: reply.trim()
        ? "Claude Code is connected and responded successfully."
        : "Claude Code is connected and ready."
    };
  } catch (caught) {
    const error = normalizeClaudeCodeError(caught);
    const failedStatus: ClaudeCodeStatus = {
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
 * Asks the CLI which models it offers without running a turn: the session
 * initializes, reports its catalog, and closes. Spends no usage.
 */
export async function listClaudeCodeModels(
  executablePath: string,
  workspaceDir?: string
): Promise<ClaudeCliModel[]> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  await prepareWorkspace(workspaceDir);
  const controller = new AbortController();
  // Streaming-input mode keeps the session open with no prompt to answer.
  async function* noPrompt(): AsyncGenerator<never> {
    await new Promise<void>((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(), { once: true })
    );
  }
  const session = sdk.query({
    prompt: noPrompt(),
    options: {
      abortController: controller,
      pathToClaudeCodeExecutable: executablePath,
      ...(workspaceDir ? { cwd: workspaceDir } : {}),
      tools: [],
      settingSources: [],
      persistSession: false,
      env: createClaudeSubscriptionEnvironment()
    }
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      session.supportedModels(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Claude Code did not list its models.")),
          MODEL_LIST_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    clearTimeout(timeout);
    session.close();
    controller.abort();
  }
}

export async function streamClaudeCodeCompletion(
  options: StreamClaudeCodeOptions
): Promise<{ fullText: string }> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const controller = new AbortController();
  let externallyCancelled = false;
  let timedOut = false;
  const onAbort = () => {
    externallyCancelled = true;
    controller.abort();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  // Inactivity timeout: long agent turns (tool calls, plan drafting) are fine
  // as long as the stream keeps producing; only abort when it goes quiet.
  const idleTimeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const armIdleTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };
  armIdleTimeout();

  let fullText = "";
  let resultText = "";

  try {
    const definitions = options.tools.map((sourceTool) => {
      const inputShape = jsonSchemaToZodShape(sourceTool.inputSchema);
      return sdk.tool(
        sourceTool.name,
        sourceTool.description ?? "CorosLink Coach tool",
        inputShape,
        async (args) => {
          const parsedArgs = args as Record<string, unknown>;
          options.onToolCallStart?.(sourceTool.name);
          armIdleTimeout();
          try {
            const output = await options.onToolCall(sourceTool.name, parsedArgs);
            return { content: [{ type: "text" as const, text: output }] };
          } catch (caught) {
            const message = safeErrorMessage(caught);
            options.onToolCallError?.(sourceTool.name, message);
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              isError: true
            };
          } finally {
            armIdleTimeout();
          }
        }
      );
    });
    const mcpServer = sdk.createSdkMcpServer({
      name: "coroslink",
      version: "1.0.0",
      instructions:
        "Use only these CorosLink tools for approved training data, plan drafts, and calendar changes. Uploads and deletions always require explicit athlete confirmation via the buttons in chat.",
      tools: definitions,
      alwaysLoad: true
    });
    const allowedTools = options.tools.map(
      (sourceTool) => `mcp__coroslink__${sourceTool.name}`
    );

    await prepareWorkspace(options.workspaceDir);
    // An abort that came before the listener existed never fires it.
    if (options.signal.aborted) throw new Error("cancelled");
    const stream = sdk.query({
      prompt: claudePrompt(options.messages),
      options: {
        abortController: controller,
        pathToClaudeCodeExecutable: options.executablePath,
        ...(options.workspaceDir ? { cwd: options.workspaceDir } : {}),
        systemPrompt: options.instructions,
        ...(options.model ? { model: options.model } : {}),
        tools: [],
        allowedTools,
        permissionMode: "dontAsk",
        mcpServers: { coroslink: mcpServer },
        strictMcpConfig: true,
        settingSources: [],
        includePartialMessages: true,
        maxTurns: 10,
        persistSession: false,
        env: createClaudeSubscriptionEnvironment()
      }
    });

    for await (const message of stream) {
      armIdleTimeout();
      if (message.type === "stream_event") {
        const event = message.event;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          const delta = event.delta.text;
          fullText += delta;
          options.onToken(delta);
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "thinking_delta"
        ) {
          options.onThinking?.(event.delta.thinking);
        }
        continue;
      }
      if (message.type === "rate_limit_event") {
        if (message.rate_limit_info.status === "rejected") {
          throw new ClaudeCodeProviderError(
            "Your Claude usage limit may have been reached. Try again later or choose another provider.",
            "usage-limit"
          );
        }
        continue;
      }
      if (message.type === "assistant" && message.error) {
        throw new Error(message.error);
      }
      if (message.type === "result") {
        if (message.subtype === "success") {
          resultText = message.result;
          if (message.api_error_status === 429) {
            throw new ClaudeCodeProviderError(
              "Your Claude usage limit may have been reached. Try again later or choose another provider.",
              "usage-limit"
            );
          }
        } else {
          throw new Error(message.errors.join("\n") || message.subtype);
        }
      }
    }

    if (!fullText && resultText) {
      fullText = resultText;
      options.onToken(resultText);
    }
    return { fullText };
  } catch (caught) {
    if (timedOut) {
      throw new ClaudeCodeProviderError(
        "Claude Code stopped responding. Try again.",
        "timeout"
      );
    }
    if (externallyCancelled || options.signal.aborted) {
      throw new ClaudeCodeProviderError("Claude request cancelled.", "cancelled");
    }
    throw normalizeClaudeCodeError(caught);
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", onAbort);
  }
}

export function normalizeClaudeCodeError(
  caught: unknown
): ClaudeCodeProviderError {
  if (caught instanceof ClaudeCodeProviderError) {
    return caught;
  }
  const detail = safeErrorMessage(caught);
  if (/not logged in|login|authentication_failed|oauth_org_not_allowed|401|403/i.test(detail)) {
    return new ClaudeCodeProviderError(
      "Claude is installed, but you are not signed in. Sign in with Claude to continue.",
      "auth"
    );
  }
  if (/usage limit|rate.?limit|credits_required|hit your .*limit|429/i.test(detail)) {
    return new ClaudeCodeProviderError(
      "Your Claude usage limit may have been reached. Try again later or choose another provider.",
      "usage-limit"
    );
  }
  if (/enoent|not found|does not exist/i.test(detail)) {
    return new ClaudeCodeProviderError(
      "Claude Code is not installed or its executable path is no longer valid.",
      "not-installed"
    );
  }
  return new ClaudeCodeProviderError(
    `Claude connection failed: ${truncate(detail, 500)}`,
    "connection"
  );
}

function jsonSchemaToZodShape(
  schema: Record<string, unknown>
): Record<string, z.ZodType> {
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : []
  );
  const shape: Record<string, z.ZodType> = {};

  for (const [name, propertySchema] of Object.entries(properties)) {
    let validator: z.ZodType;
    try {
      validator = z.fromJSONSchema(
        propertySchema as Parameters<typeof z.fromJSONSchema>[0]
      );
    } catch {
      validator = z.unknown();
    }
    shape[name] = required.has(name) ? validator : validator.optional();
  }
  return shape;
}

/**
 * The conversation as one Claude turn. Attached images follow the transcript
 * as image blocks, which only streaming input can carry. Coach trims long
 * conversations to its history budget before they get here.
 */
export function claudePrompt(messages: ChatMessage[]): string | AsyncIterable<SDKUserMessage> {
  const text = formatClaudePrompt(messages);
  const images = messages.flatMap((message) => message.images ?? []);
  if (images.length === 0) return text;
  const message: SDKUserMessage = {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "text", text },
        ...images.flatMap((image) => [
          { type: "text" as const, text: `Image: ${image.label}` },
          {
            type: "image" as const,
            source: { type: "base64" as const, media_type: image.mimeType, data: image.base64 }
          }
        ])
      ]
    }
  };
  return (async function* () {
    yield message;
  })();
}

function formatClaudePrompt(messages: ChatMessage[]): string {
  const transcript = messages
    .map(
      (message) =>
        `${message.role === "assistant" ? "Assistant" : "Athlete"}: ${message.content}`
    )
    .join("\n\n");
  return (
    "Continue the CorosLink Coach conversation below. Answer the athlete's latest " +
    "message, using approved tools only when they materially help.\n\n" +
    transcript
  );
}

async function execClaude(
  executablePath: string,
  args: string[],
  options: { timeout: number; cwd?: string }
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(executablePath, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    windowsHide: true,
    env: createClaudeSubscriptionEnvironment(),
    maxBuffer: 1024 * 1024
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function safeErrorMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught || "Unknown error");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
