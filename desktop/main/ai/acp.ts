// The Agent Client Protocol: newline-delimited JSON-RPC 2.0 over an agent program's stdio. Gemini CLI, OpenCode and
// Antigravity all speak it. C-LINK is the client: it starts a session with only Coach's tools (over the bridge),
// sends one prompt, and streams the agent's words back. Files and terminals are never offered to the agent.
import type { ChildProcess } from "node:child_process";
import type { CoachFile } from "@/lib/coach/files";
import { textFileBlock } from "@/lib/coach/files";
import { CoachModelError } from "@/server/coach/anthropic";
import type { AgentAsk, AgentDone } from "./agent";
import { BRIDGE_NAME, type ToolBridge } from "./bridge";
import { startProgram } from "./cli";
import { t } from "@/lib/i18n";

type Json = Record<string, unknown>;

export class AcpError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: unknown) { super(message); this.name = "AcpError"; }
}

export class AcpAgent {
  onUpdate: (update: Json) => void = () => {};
  private next = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private exited = false;
  readonly done: Promise<void>;

  private constructor(private readonly child: ChildProcess, private readonly options: { onPermission?: (params: Json) => Json; onStderr?: (line: string) => void }) {
    child.stdout!.on("data", (d: Buffer) => this.read(d.toString("utf8")));
    let errBuffer = "";
    child.stderr!.on("data", (d: Buffer) => {
      errBuffer += d.toString("utf8");
      const lines = errBuffer.split("\n");
      errBuffer = lines.pop() ?? "";
      for (const line of lines) options.onStderr?.(line);
    });
    this.done = new Promise((resolve) => {
      const end = (why: string) => { this.fail(new AcpError(why)); resolve(); };
      child.on("error", () => end(t("The program couldn't be started.")));
      child.on("close", () => end(t("The program stopped.")));
    });
  }

  static start(file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; onPermission?: (params: Json) => Json; onStderr?: (line: string) => void }): AcpAgent {
    // Throws when the program can't be started at all (a Windows shim C-LINK can't read).
    return new AcpAgent(startProgram(file, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] }), options);
  }

  initialize(protocolVersion = 1): Promise<Json> {
    return this.request("initialize", { protocolVersion, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "clink", title: "C-LINK", version: "1" } }) as Promise<Json>;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.exited) return Promise.reject(new AcpError(t("The program isn't running.")));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.exited) this.write({ jsonrpc: "2.0", method, params });
  }

  close(): void {
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
  }

  private write(message: Json): void {
    try { this.child.stdin!.write(`${JSON.stringify(message)}\n`); } catch { /* exiting */ }
  }

  private read(text: string): void {
    this.buffer += text;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let m: { id?: number | string; method?: string; params?: Json; result?: unknown; error?: { message?: string; code?: number; data?: unknown } };
      try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined) this.answer(m.id, m.method, m.params ?? {});
      else if (m.method === "session/update") this.onUpdate((m.params?.update ?? {}) as Json);
      else if (typeof m.id === "number" && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        if (m.error) p.reject(new AcpError(String(m.error.message ?? "The agent refused."), m.error.code, m.error.data));
        else p.resolve(m.result);
      }
    }
  }

  /** Requests from the agent: permission is the caller's to give; nothing else is offered. */
  private answer(id: number | string, method: string, params: Json): void {
    if (method === "session/request_permission") {
      this.write({ jsonrpc: "2.0", id, result: this.options.onPermission?.(params) ?? { outcome: { outcome: "cancelled" } } });
      return;
    }
    this.write({ jsonrpc: "2.0", id, error: { code: -32601, message: `C-LINK doesn't offer ${method}.` } });
  }

  private fail(error: Error): void {
    this.exited = true;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
}

/** The bridge as an ACP MCP server. */
export const bridgeServer = (bridge: ToolBridge): Json => ({ type: "http", name: BRIDGE_NAME, url: bridge.url, headers: [{ name: "Authorization", value: `Bearer ${bridge.token}` }] });

/** Allows a call to Coach's own tools, once; anything that could run or change something is declined. */
export function allowCoachTools(params: Json): Json {
  const call = (params.toolCall ?? {}) as { kind?: unknown; title?: unknown; _meta?: { is_mcp_tool_call?: unknown; mcp?: { server?: unknown } } };
  const allow = ((params.options ?? []) as { optionId?: unknown; kind?: unknown }[]).find((o) => o?.kind === "allow_once");
  const risky = ["execute", "edit", "delete", "move", "fetch"].includes(String(call.kind));
  const otherServer = call._meta?.mcp?.server !== undefined && call._meta.mcp.server !== BRIDGE_NAME;
  if (risky || otherServer || typeof allow?.optionId !== "string") return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId: allow.optionId } };
}

/** The question as ACP content blocks. */
export function acpPrompt(prompt: string, files: readonly CoachFile[]): Json[] {
  return [
    { type: "text", text: prompt },
    ...files.map((f): Json => f.kind === "image" ? { type: "image", mimeType: f.mime, data: f.data }
      : f.kind === "pdf" ? { type: "resource", resource: { uri: `file:///${encodeURIComponent(f.name)}`, mimeType: "application/pdf", blob: f.data } }
      : { type: "text", text: textFileBlock(f) }),
  ];
}

export interface ModelChoice { value: string; name: string }

/** The models a session offers and the one it uses, from `configOptions` (newer agents) or `models`. */
export function sessionModels(session: unknown): { models: ModelChoice[]; current?: string } {
  const s = (session ?? {}) as { configOptions?: unknown; models?: { currentModelId?: unknown; availableModels?: unknown } };
  if (Array.isArray(s.configOptions)) {
    const option = (s.configOptions as Json[]).find((o) => o?.id === "model" || o?.category === "model");
    if (option && Array.isArray(option.options)) {
      const flat = (option.options as Json[]).flatMap((e) => (Array.isArray(e?.options) ? (e.options as Json[]) : [e]));
      return {
        models: flat.filter((o) => typeof o?.value === "string" && o.value).map((o) => ({ value: o.value as string, name: typeof o.name === "string" && o.name ? o.name : (o.value as string) })),
        current: typeof option.currentValue === "string" ? option.currentValue : undefined,
      };
    }
  }
  const available = Array.isArray(s.models?.availableModels) ? (s.models.availableModels as Json[]) : [];
  return {
    models: available.filter((m) => typeof m?.modelId === "string" && m.modelId).map((m) => ({ value: m.modelId as string, name: typeof m.name === "string" && m.name ? m.name : (m.modelId as string) })),
    current: typeof s.models?.currentModelId === "string" ? s.models.currentModelId : undefined,
  };
}

/** Switches a session's model: the config option where offered, else the older call. */
export async function setModel(agent: AcpAgent, sessionId: string, model: string): Promise<void> {
  if (!model) return;
  await agent.request("session/set_config_option", { sessionId, configId: "model", value: model })
    .catch(() => agent.request("session/set_model", { sessionId, modelId: model }))
    .catch(() => { throw new CoachModelError("refused_request", t("The model {model} isn't available. Pick another on the AI page.", { model })); });
}

/** What an ACP failure means for the athlete. The agent's own words are kept when they say more than ours. */
export function acpFailure(name: string, error: unknown, log = ""): CoachModelError {
  if (error instanceof CoachModelError) return error;
  const said = error instanceof Error ? error.message.slice(0, 240) : "";
  const text = `${said} ${(error as AcpError)?.data ? JSON.stringify((error as AcpError).data) : ""} ${log}`;
  if (/quota|balance|credit|rate.?limit|usage limit|resource.?exhausted|\b429\b/i.test(text)) return new CoachModelError("rate_limited", said ? `${name}: ${said.replace(/^Internal error: /, "")}` : t("{name} has reached its usage limit for now.", { name }));
  if (/no longer supported|migrate/i.test(said)) return new CoachModelError("bad_key", `${name}: ${said}`);
  if (/unauthenticated|authentication required|not (signed|logged) in|sign.?in required|log.?in required|credential|\b401\b/i.test(text)) return new CoachModelError("bad_key", said && !/^internal error$/i.test(said) ? `${name}: ${said}` : t("{name} isn't signed in. Sign in on the AI page.", { name }));
  return new CoachModelError("overloaded", said ? t("{name} couldn't answer: {reason}", { name, reason: said }) : t("{name} couldn't answer.", { name }));
}

const IDLE_MS = 3 * 60_000;

/**
 * One answer from an ACP agent already started: a session with Coach's tools, the model set, one prompt. The
 * session's `extra` params (Antigravity's `_meta`) and a hook after it starts (OpenCode picks its agent) are the
 * agent's own.
 */
export async function acpAnswer(agent: AcpAgent, ask: AgentAsk, options: {
  name: string; cwd: string; model: string; protocolVersion?: number; extra?: Json;
  /** False when the agent's own configuration declares the bridge (OpenCode). */
  bridgeInSession?: boolean;
  started?: (session: Json, sessionId: string) => Promise<void>;
  /** The agent's log, for saying why it failed. */
  log?: () => string;
}): Promise<AgentDone> {
  let text = "", idle: NodeJS.Timeout | undefined;
  const awake = () => { clearTimeout(idle); idle = setTimeout(() => agent.close(), IDLE_MS); };
  const stop = () => agent.close();
  ask.signal.addEventListener("abort", stop, { once: true });
  agent.onUpdate = (u) => {
    awake();
    const content = u.content as { type?: string; text?: unknown } | undefined;
    if (u.sessionUpdate === "agent_message_chunk" && content?.type === "text" && typeof content.text === "string" && content.text) {
      text += content.text;
      ask.onText(content.text);
    }
  };
  awake();
  try {
    await agent.initialize(options.protocolVersion ?? 1);
    const session = (await agent.request("session/new", { cwd: options.cwd, mcpServers: options.bridgeInSession === false ? [] : [bridgeServer(ask.bridge)], ...options.extra })) as Json;
    const sessionId = typeof session?.sessionId === "string" ? session.sessionId : "";
    if (!sessionId) throw new AcpError(t("{name} didn't start a session.", { name: options.name }));
    await options.started?.(session, sessionId);
    await setModel(agent, sessionId, options.model);
    const result = (await agent.request("session/prompt", { sessionId, prompt: acpPrompt(ask.prompt, ask.files) })) as { stopReason?: string; usage?: { inputTokens?: number; outputTokens?: number; thoughtTokens?: number } } | null;
    if (!text.trim() && result?.stopReason === "refusal") throw new CoachModelError("refused_request", `${options.name} declined to answer.`);
    // Token use, where the agent reports it.
    const usage = result?.usage ?? {};
    return { text, inputTokens: usage.inputTokens ?? 0, outputTokens: (usage.outputTokens ?? 0) + (usage.thoughtTokens ?? 0) };
  } catch (error) {
    if (ask.signal.aborted) throw new CoachModelError("unreachable", t("Stopped."));
    throw acpFailure(options.name, error, options.log?.() ?? "");
  } finally {
    clearTimeout(idle);
    ask.signal.removeEventListener("abort", stop);
    agent.close();
  }
}
