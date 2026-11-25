// Claude Code: Coach answered by the athlete's own Claude subscription, through the `claude` program they installed
// and signed in to. Each answer runs `claude -p` with no built-in tools, no settings, no saved session, and only
// Coach's tools (over the bridge). Signing in is Claude Code's own (`claude auth login`).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { CoachModel } from "@/lib/coach/loop";
import { textFileBlock } from "@/lib/coach/files";
import { CoachModelError } from "@/server/coach/anthropic";
import { agentModel, type AgentAsk, type AgentDone } from "./agent";
import { BRIDGE_NAME } from "./bridge";
import { findProgram, programEnv, runProgram } from "./cli";
import type { AccountProvider, EffortLevels } from "./service";

/** Anything that would point Claude Code away from the athlete's subscription. */
const NOT_SUBSCRIPTION = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_ANTHROPIC_AWS"];
const IDLE_MS = 3 * 60_000;
/** What `claude --effort` takes, lowest first. */
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const env = () => programEnv({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1" }, NOT_SUBSCRIPTION);

/** The `claude -p` arguments for one answer. */
export function claudeArgs(model: string, system: string, bridge: { url: string; token: string }, effort?: string): string[] {
  const mcp = { mcpServers: { [BRIDGE_NAME]: { type: "http", url: bridge.url, headers: { Authorization: `Bearer ${bridge.token}` } } } };
  return [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--system-prompt", system, "--tools", "", "--mcp-config", JSON.stringify(mcp), "--strict-mcp-config",
    "--allowedTools", `mcp__${BRIDGE_NAME}__*`, "--permission-mode", "dontAsk", "--setting-sources", "", "--no-session-persistence",
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
  ];
}

/** The question as Claude Code's stream-json input: words, then photos and PDFs as Claude's own blocks. */
export function claudeInput(ask: Pick<AgentAsk, "prompt" | "files">): string {
  const content: Record<string, unknown>[] = [
    { type: "text", text: ask.prompt },
    ...ask.files.flatMap((f): Record<string, unknown>[] => f.kind === "image" ? [{ type: "image", source: { type: "base64", media_type: f.mime, data: f.data } }]
      : f.kind === "pdf" ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name }]
      : [{ type: "text", text: textFileBlock(f) }]),
  ];
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
}

function failure(text: string): CoachModelError {
  if (/rate limit|usage limit|limit reached|out of (extra )?usage/i.test(text)) return new CoachModelError("rate_limited", "Your Claude plan has reached its usage limit for now.");
  if (/log ?in|auth|credential|401/i.test(text)) return new CoachModelError("bad_key", "Claude Code isn't signed in. Sign in on the AI page.");
  return new CoachModelError("overloaded", `Claude Code couldn't answer${text ? `: ${text.slice(0, 200)}` : "."}`);
}

function run(program: string, workspace: string, model: string, ask: AgentAsk, effort?: string): Promise<AgentDone> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, claudeArgs(model, ask.system, ask.bridge, effort), { cwd: workspace, env: env(), stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "", stderr = "", streamed = "", settled = false;
    let idle: NodeJS.Timeout;
    const finish = (error: Error | null, done?: AgentDone) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      ask.signal.removeEventListener("abort", stop);
      if (child.exitCode === null) child.kill();
      if (error) reject(error); else resolve(done!);
    };
    const stop = () => finish(new CoachModelError("unreachable", "Stopped."));
    const awake = () => { clearTimeout(idle); idle = setTimeout(() => finish(new CoachModelError("unreachable", "Claude Code stopped answering.")), IDLE_MS); };
    awake();
    ask.signal.addEventListener("abort", stop, { once: true });
    const line = (raw: string) => {
      if (!raw.trim()) return;
      let event: { type?: string; subtype?: string; is_error?: boolean; result?: string; usage?: Record<string, number>; event?: { type?: string; delta?: { type?: string; text?: string } } };
      try { event = JSON.parse(raw); } catch { return; }
      if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta" && event.event.delta.text) {
        streamed += event.event.delta.text;
        ask.onText(event.event.delta.text);
      } else if (event.type === "stream_event" && event.event?.type === "message_start" && streamed) {
        // A new message after a tool call: keep the paragraphs apart.
        ask.onText("\n\n");
      } else if (event.type === "result") {
        if (event.is_error || event.subtype !== "success") { finish(failure(event.result ?? stderr)); return; }
        const u = event.usage ?? {};
        finish(null, { text: event.result ?? "", inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0 });
      }
    };
    child.stdout.on("data", (d: Buffer) => {
      awake();
      buffer += d.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(line);
    });
    child.stderr.on("data", (d: Buffer) => { stderr = (stderr + d.toString("utf8")).slice(-4000); });
    child.on("error", () => finish(new CoachModelError("unreachable", "Claude Code couldn't be started.")));
    child.on("close", () => { line(buffer); finish(failure(stderr.trim())); });
    child.stdin.end(claudeInput(ask));
  });
}

export class ClaudeCodeAccount implements AccountProvider {
  readonly canSignOut = false;
  constructor(private readonly folder: string) {}

  private program(): string {
    const found = findProgram("claude");
    if (!found) throw new CoachModelError("unreachable", "Install Claude Code first: claude.com/code");
    return found;
  }

  async status() {
    const program = findProgram("claude");
    if (!program) return { ready: false, problem: "Install Claude Code first: claude.com/code" };
    const out = await runProgram(program, ["auth", "status"], { env: env() });
    let s: { loggedIn?: boolean; email?: string; authMethod?: string; subscriptionType?: string } = {};
    try { s = JSON.parse(out?.stdout ?? "{}"); } catch { /* not signed in */ }
    // Only a Claude account counts: an API key would be billed separately, and that is the Anthropic row's job.
    const ready = !!s.loggedIn && (s.authMethod === "claude.ai" || !!s.subscriptionType);
    return ready ? { ready, program, ...(s.email ? { account: s.email } : {}) } : { ready: false, program, problem: "Not signed in to Claude Code." };
  }

  /** Claude Code's own sign-in, in the browser. Resolves when it is done. */
  async signIn(): Promise<void> {
    const out = await runProgram(this.program(), ["auth", "login"], { env: env(), timeoutMs: 10 * 60_000 });
    if (!(await this.status()).ready) throw new CoachModelError("bad_key", out ? "Claude Code didn't sign in." : "Sign-in took too long.");
  }

  /** Signing out of Claude Code would sign every app out; C-LINK just stops using it. */
  async signOut(): Promise<void> {}

  async models(): Promise<string[]> {
    return ["", "opus", "fable", "sonnet", "haiku"];
  }

  /** Claude Code's --effort levels; Haiku has none. */
  async efforts(model: string): Promise<EffortLevels | null> {
    return model === "haiku" ? null : { levels: [...CLAUDE_EFFORTS] };
  }

  model(model: string, effort?: string): CoachModel {
    const workspace = path.join(this.folder, "claude-coach");
    mkdirSync(workspace, { recursive: true });
    return agentModel((ask) => run(this.program(), workspace, model, ask, effort));
  }
}
