// Watchmaker's engine: the athlete's own Codex CLI, run as CorosLink runs it (`codex app-server` over stdio). Codex
// keeps its own harness (shell, files, web search, its native image generation) in a fresh temporary folder, and
// reaches the open face through a private MCP server made for this one message (ai/bridge.ts) that offers
// Watchmaker's tools. Images Codex generates are copied into the asset store before the folder is removed. The
// sign-in and the model are Codex's own (`codex login`, ~/.codex/config.toml); nothing here reads or changes them.
import { execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { ToolDef } from "@/lib/coach/tools";
import { openBridge, type BridgeResult } from "../../ai/bridge";
import { locateProgram, logProgram, programEnv, startProgram } from "../../ai/cli";
import { pngSize, sniffImage, type AssetStore } from "../automation/assets";
import { STEP_WORDS, type ToolResult, type WatchmakerEvent, type WatchmakerTools } from "./tools";
import { msg, t } from "@/lib/i18n";

export const NOT_INSTALLED = msg("Install the Codex CLI and run codex login in a terminal, then try again.");
const NOT_SIGNED_IN = msg("Run codex login in a terminal first.");
const SERVER = "watchmaker";
const TOKEN_ENV = "CLINK_WATCHMAKER_TOKEN";
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_LINE = 32 * 1024 * 1024;

/** What Codex's own items are shown as in the chat. */
const ITEM_WORDS: Record<string, string> = {
  commandExecution: msg("Running a command"), fileChange: msg("Changing a file"), webSearch: msg("Searching the web"),
  imageView: msg("Looking at an image"), imageGeneration: msg("Generating an image"), mcpToolCall: msg("Using a tool"),
};

type Json = Record<string, unknown>;

/** One `codex app-server` over stdio: JSON-RPC requests out, answers and notifications in. */
export class AppServer {
  private seq = 0;
  private buffer = "";
  private stderr = "";
  private readonly waiting = new Map<number, { resolve(value: Json): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private closing: Promise<void> | null = null;
  failure: Error | null = null;
  onNotify: (method: string, params: Json) => void = () => {};
  onFail: (error: Error) => void = () => {};

  private constructor(private readonly child: ChildProcess) {
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d: string) => { this.stderr = (this.stderr + d).slice(-4000); });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => this.read(d));
    child.on("error", (error) => this.fail(new Error(t("Codex couldn't be started: {why}", { why: error.message }))));
    child.on("exit", (code) => this.fail(new Error(`${t("Codex stopped ({code}).", { code: String(code ?? "signal") })} ${stripVTControlCharacters(this.stderr).trim().slice(-600)}`.trim())));
  }

  static start(program: string, cwd: string, env: NodeJS.ProcessEnv): AppServer {
    // Its own process group, so Stop ends Codex's shell commands too.
    return new AppServer(startProgram(program, ["app-server", "--listen", "stdio://"], { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" }));
  }

  private read(data: string): void {
    this.buffer += data;
    if (this.buffer.length > MAX_LINE) { this.fail(new Error(t("Codex sent more than C-LINK takes at once."))); return; }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: Json;
      try { message = JSON.parse(line) as Json; } catch { continue; }
      this.receive(message);
    }
  }

  private receive(message: Json): void {
    const id = message.id as number | string | undefined;
    if (id !== undefined && typeof message.method === "string") {
      // A question for the client mid-turn (an approval, an elicitation): no one is here to answer it.
      this.send({ id, error: { code: -32601, message: "No one can answer this mid-turn. Carry on without it, or say so in your reply." } });
      return;
    }
    if (id !== undefined) {
      const w = this.waiting.get(Number(id));
      if (!w) return;
      clearTimeout(w.timer);
      this.waiting.delete(Number(id));
      const error = message.error as { message?: string } | undefined;
      if (error) w.reject(new Error(`Codex: ${error.message ?? "the request failed"}`));
      else w.resolve((message.result ?? {}) as Json);
      return;
    }
    if (typeof message.method === "string") this.onNotify(message.method, (message.params ?? {}) as Json);
  }

  private send(value: unknown): void {
    if (this.failure || !this.child.stdin || this.child.stdin.destroyed) throw this.failure ?? new Error(t("Codex isn't running."));
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  request(method: string, params: unknown, timeoutMs = 60_000): Promise<Json> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(t("Codex didn't answer {method}. Update the Codex CLI and try again.", { method }))); }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.waiting.delete(id); reject(error as Error); }
    });
  }

  notify(method: string, params: unknown): void { this.send({ method, params }); }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(error); }
    this.waiting.clear();
    this.onFail(error);
  }

  /** Ends Codex and everything it started. */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.fail(new Error(t("Codex was closed.")));
      const { child } = this;
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      const pid = child.pid;
      if (process.platform === "win32") { await new Promise<void>((done) => execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => done())); return; }
      const kill = (signal: NodeJS.Signals) => { try { process.kill(-pid, signal); } catch { /* gone */ } };
      kill("SIGTERM");
      await new Promise<void>((done) => {
        const timer = setTimeout(() => { kill("SIGKILL"); done(); }, 1500);
        child.once("exit", () => { clearTimeout(timer); done(); });
      });
    })();
  }
}

const INIT = { clientInfo: { name: "clink_watchmaker", title: "C-LINK Watchmaker", version: "1.0.0" }, capabilities: { experimentalApi: true } };

/** Starts Codex in `cwd` and says hello. */
async function connect(program: string, cwd: string, env: NodeJS.ProcessEnv): Promise<AppServer> {
  const server = AppServer.start(program, cwd, env);
  try {
    await server.request("initialize", INIT, 30_000);
    server.notify("initialized", {});
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

/** Whether Codex can answer: installed and signed in, and as whom. */
export async function codexAccount(program: string): Promise<{ ready: boolean; account?: string; problem?: string }> {
  const cwd = os.tmpdir();
  let server: AppServer | null = null;
  try {
    server = await connect(program, cwd, programEnv());
    const read = await server.request("account/read", {}, 20_000) as { account?: { type?: string; email?: string | null } | null; requiresOpenaiAuth?: boolean };
    if (!read.account && read.requiresOpenaiAuth !== false) return { ready: false, problem: t(NOT_SIGNED_IN) };
    return { ready: true, account: read.account?.type === "chatgpt" ? read.account.email ?? "ChatGPT" : read.account?.type === "apiKey" ? t("API key") : undefined };
  } catch (error) {
    logProgram(`codex account check: ${error instanceof Error ? error.message : String(error)}`);
    return { ready: false, problem: error instanceof Error ? error.message : t(NOT_INSTALLED) };
  } finally {
    await server?.close();
  }
}

export interface CodexJob {
  program: string;
  instructions: string;
  prompt: string;
  /** Pictures for the message, written into Codex's folder and attached in this order. */
  pictures: { name: string; bytes: Buffer }[];
  tools: WatchmakerTools;
  assets: AssetStore;
  emit(event: WatchmakerEvent): void;
  signal: AbortSignal;
  /** How long Codex may stay silent before the answer is given up. */
  idleMs?: number;
}

export interface CodexOutcome { text: string; edits: number; stopped: boolean }

/** The tools only the Codex engine offers: its own generated images, and files it made in its folder. */
const CODEX_TOOLS: ToolDef[] = [
  { name: "get_generated_images", description: "The images you generated with your own image tool during this message, in order, each as {assetId} with its size. Use these ids in crop_image and apply_commands.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "import_file", description: "Take a PNG, JPEG or WebP you made in your working folder (a path in it) for use in commands. Returns its {assetId} and size.", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
];

const said = (error: unknown) => JSON.stringify({ error: { code: "FAILED", message: error instanceof Error ? error.message : String(error) } });

/** Image bytes from a finished imageGeneration item: inline base64 or the file Codex saved. */
async function generatedBytes(item: Json): Promise<Buffer> {
  if (typeof item.result === "string" && item.result) {
    const data = item.result.replace(/^data:image\/[a-z+.-]+;base64,/i, "");
    if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error(t("Codex's image is too large."));
    return Buffer.from(data, "base64");
  }
  if (typeof item.savedPath === "string" && item.savedPath) {
    const info = await stat(item.savedPath);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new Error(t("Codex's image is too large."));
    return readFile(item.savedPath);
  }
  throw new Error(t("Codex sent no image. Update the Codex CLI and try again."));
}

/** One Watchmaker message, answered by Codex. Throws when Codex can't start or the turn fails. */
export async function runCodex(job: CodexJob): Promise<CodexOutcome> {
  const { emit, signal, assets, tools } = job;
  const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), "clink-watchmaker-")));
  let text = "", lastItem = "", edits = 0, n = 0, files = 0;
  const generated: { assetId: string; width?: number; height?: number; prompt?: string }[] = [];
  const steps = new Map<string, string>();
  // Generated images are copied in order; get_generated_images and the end of the turn wait for them.
  let copying = Promise.resolve();
  const step = (key: string, tool: string, label: string) => { const id = `s${++n}`; steps.set(key, id); emit({ t: "step", id, tool, label }); return id; };
  const stepDone = (key: string, ok: boolean, message?: string) => {
    const id = steps.get(key);
    if (!id) return;
    steps.delete(key);
    emit({ t: "step-done", id, ok, ...(message ? { message: message.slice(0, 400) } : {}) });
  };
  const save = async (name: string, bytes: Buffer) => {
    const file = path.join(folder, `${++files}-${name.replace(/[^\w.-]/g, "_")}`);
    await writeFile(file, bytes, { mode: 0o600 });
    return file;
  };

  /** A watchmaker tool called by Codex over the bridge. */
  const call = async (name: string, input: unknown): Promise<BridgeResult> => {
    const key = `tool${++n}`;
    step(key, name, name in STEP_WORDS ? t(STEP_WORDS[name]) : t("Working"));
    let result: ToolResult;
    try {
      if (name === "get_generated_images") { await copying; result = { text: JSON.stringify({ images: generated }) }; }
      else if (name === "import_file") result = await importFile(input);
      else result = await tools.run(name, input, signal);
    } catch (error) {
      result = { text: said(error), isError: true };
    }
    stepDone(key, !result.isError, result.isError ? result.text : undefined);
    if (result.edited) { edits++; emit({ t: "edit" }); }
    if (result.plan) emit({ t: "plan", items: result.plan });
    const images: { mime: string; data: string }[] = [];
    const saved: string[] = [];
    for (const p of result.pictures ?? []) {
      emit({ t: "picture", assetId: p.assetId, why: p.why });
      try {
        const a = await assets.get(p.assetId);
        images.push({ mime: a.mime, data: a.bytes.toString("base64") });
        saved.push(await save(`${p.assetId}.${a.mime.split("/")[1]}`, a.bytes));
      } catch { /* gone: the id is still in the text */ }
    }
    const note = saved.length ? `\n(Saved in your folder: ${saved.join(", ")})` : "";
    return { text: `${result.text}${note}`, isError: result.isError, images };
  };

  const importFile = async (input: unknown): Promise<ToolResult> => {
    const raw = typeof (input as { path?: unknown })?.path === "string" ? (input as { path: string }).path : "";
    const file = await realpath(path.resolve(folder, raw)).catch(() => "");
    if (!file || path.relative(folder, file).startsWith("..") || path.isAbsolute(path.relative(folder, file))) {
      return { text: said(new Error("Give a file in your working folder.")), isError: true };
    }
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return { text: said(new Error("That isn't an image file up to 16 MB.")), isError: true };
    const bytes = await readFile(file);
    if (!sniffImage(bytes)) return { text: said(new Error("Only PNG, JPEG and WebP images are taken.")), isError: true };
    const assetId = await assets.put(bytes);
    return { text: JSON.stringify({ assetId, ...(pngSize(bytes) ?? {}) }), pictures: [{ assetId, why: t("Imported image") }] };
  };

  const bridge = await openBridge([...tools.defs, ...CODEX_TOOLS], call, "C-LINK Watchmaker");
  let server: AppServer | null = null;
  let threadId = "", turnId = "";
  let stopped = false;
  try {
    signal.throwIfAborted();
    const attached = [];
    for (const p of job.pictures) attached.push(await save(p.name, p.bytes));
    server = await connect(job.program, folder, programEnv({ [TOKEN_ENV]: bridge.token }));
    const codex = server;

    let finish!: () => void, fail!: (error: Error) => void;
    const finished = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    // A failure before anything waits on it is still thrown below, not reported as unhandled.
    finished.catch(() => undefined);
    const idleMs = job.idleMs ?? 10 * 60_000;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const awake = () => { clearTimeout(idle); idle = setTimeout(() => fail(new Error(t("Codex went quiet for too long. What it did stays; send another message to carry on."))), idleMs); };
    awake();
    codex.onFail = (error) => fail(error);
    codex.onNotify = (method, params) => {
      awake();
      if (method === "turn/started") turnId = String((params.turn as Json | undefined)?.id ?? turnId);
      else if (method === "item/agentMessage/delta") {
        const delta = String(params.delta ?? "");
        if (!delta) return;
        const item = String(params.itemId ?? "");
        const lead = item !== lastItem && text ? "\n\n" : "";
        lastItem = item;
        text += lead + delta;
        emit({ t: "text", delta: lead + delta });
      } else if (method === "item/started" || method === "item/completed") {
        const item = (params.item ?? {}) as Json;
        const type = String(item.type ?? "");
        // A message that came whole, without deltas.
        if (type === "agentMessage" && method === "item/completed" && item.id !== lastItem && typeof item.text === "string" && item.text) {
          const lead = text ? "\n\n" : "";
          lastItem = String(item.id);
          text += lead + item.text;
          emit({ t: "text", delta: lead + item.text });
          return;
        }
        if (!(type in ITEM_WORDS) || (type === "mcpToolCall" && item.server === SERVER)) return;
        const key = `item${String(item.id)}`;
        if (method === "item/started") { step(key, `codex_${type}`, t(ITEM_WORDS[type])); return; }
        if (!steps.has(key)) step(key, `codex_${type}`, t(ITEM_WORDS[type]));
        const failed = item.status === "failed" || item.status === "declined" || !!item.failure || (typeof item.exitCode === "number" && item.exitCode !== 0);
        if (type !== "imageGeneration" || failed) {
          stepDone(key, !failed, failed ? String((item.failure as Json | undefined)?.message ?? item.aggregatedOutput ?? (typeof item.command === "string" ? item.command : "")) : undefined);
          return;
        }
        copying = copying.then(async () => {
          try {
            const bytes = await generatedBytes(item);
            if (!sniffImage(bytes)) throw new Error(t("Codex's image isn't a PNG, JPEG or WebP."));
            const assetId = await assets.put(bytes);
            generated.push({ assetId, ...(pngSize(bytes) ?? {}), ...(typeof item.revisedPrompt === "string" ? { prompt: item.revisedPrompt.slice(0, 400) } : {}) });
            stepDone(key, true);
            emit({ t: "picture", assetId, why: t("Generated image") });
          } catch (error) {
            stepDone(key, false, error instanceof Error ? error.message : String(error));
          }
        });
      } else if (method === "turn/completed") {
        const turn = (params.turn ?? {}) as { status?: string; error?: { message?: string } | null };
        turnId = "";
        if (turn.status === "completed") finish();
        else if (turn.status === "interrupted") { stopped = true; finish(); } else fail(new Error(turn.error?.message ?? t("Codex couldn't finish.")));
      } else if (method === "error" && !params.willRetry) {
        fail(new Error(String((params.error as Json | undefined)?.message ?? t("Codex couldn't finish."))));
      }
    };

    const onAbort = () => {
      stopped = true;
      if (turnId && threadId) void codex.request("turn/interrupt", { threadId, turnId }, 3_000).catch(() => undefined);
      setTimeout(() => finish(), 3_000);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const thread = await codex.request("thread/start", {
        cwd: folder, approvalPolicy: "never", sandbox: "workspace-write", ephemeral: true,
        config: {
          "sandbox_workspace_write.network_access": true, "features.image_generation": true,
          // Our tools are pre-approved: with approvals off, Codex otherwise declines every MCP call ("requires approval").
          [`mcp_servers.${SERVER}`]: { url: bridge.url, bearer_token_env_var: TOKEN_ENV, required: true, tool_timeout_sec: 600, default_tools_approval_mode: "approve" },
        },
        developerInstructions: job.instructions,
      });
      threadId = String((thread.thread as Json | undefined)?.id ?? "");
      if (!threadId) throw new Error(t("Codex didn't start a conversation. Update the Codex CLI and try again."));
      signal.throwIfAborted();
      const named = attached.length ? `\n\n(The attached pictures are also in your folder, in order: ${attached.join(", ")}.)` : "";
      const started = await codex.request("turn/start", {
        threadId,
        input: [{ type: "text", text: `${job.prompt}${named}`, text_elements: [] }, ...attached.map((file) => ({ type: "localImage", path: file }))],
      });
      turnId ||= String((started.turn as Json | undefined)?.id ?? "");
      await finished;
      await copying;
    } finally {
      clearTimeout(idle);
      signal.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    stopped = true;
  } finally {
    for (const key of [...steps.keys()]) stepDone(key, false, t("Stopped."));
    bridge.close();
    await server?.close();
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  return { text: text.trim(), edits, stopped };
}

/** The installed Codex CLI, or null. */
export const findCodex = () => locateProgram("codex", null, programEnv());
