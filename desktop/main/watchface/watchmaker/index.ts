// Watchmaker, the AI designer in Studio's inspector (CorosLink's WatchfaceAiPanel + electron/watchfaceAi*.ts). Like
// CorosLink, it always runs the athlete's own Codex CLI with its own harness (codex.ts), whatever Coach uses: Codex
// drives the open face through the editor broker, so every applied step is one undo step and the canvas changes as it
// works. Chats are saved per face. Routes under /api/desktop/studio/watchmaker: status, chats (list, read, delete),
// send (a stream of events, one JSON line each), stop.
import type { AssetStore } from "../automation/assets";
import type { EditorBroker } from "../automation/broker";
import { ChatStore, titleOf, type Chat, type ChatMessage } from "./chats";
import { codexAccount, findCodex, NOT_INSTALLED, runCodex } from "./codex";
import { WATCHMAKER_RULES } from "./rules";
import { compactDocument, watchmakerTools, type WatchmakerEvent, type WatchmakerTools } from "./tools";
import { t } from "@/lib/i18n";

/** One message for the engine: the rules, the whole prompt, its pictures, and the face's tools. */
export interface EngineJob {
  instructions: string;
  prompt: string;
  pictures: { name: string; bytes: Buffer }[];
  tools: WatchmakerTools;
  emit(event: WatchmakerEvent): void;
  signal: AbortSignal;
}

/** Who answers Watchmaker: Codex, or a stand-in in tests and the smoke. */
export interface WatchmakerEngine {
  status(): Promise<{ ready: boolean; label: string; account?: string; problem?: string }>;
  run(job: EngineJob): Promise<{ text: string; edits: number; stopped: boolean }>;
}

/** The installed Codex CLI. Its sign-in is checked at most once a minute. */
export function codexEngine(assets: AssetStore): WatchmakerEngine {
  let checked: { at: number; program: string; status: Awaited<ReturnType<typeof codexAccount>> } | null = null;
  const program = async () => {
    const found = await findCodex();
    if (!found) throw new Error(t(NOT_INSTALLED));
    return found;
  };
  return {
    async status() {
      const found = await findCodex();
      if (!found) return { ready: false, label: "Codex CLI", problem: t(NOT_INSTALLED) };
      if (!checked || checked.program !== found || Date.now() - checked.at > 60_000 || !checked.status.ready) checked = { at: Date.now(), program: found, status: await codexAccount(found) };
      return { label: "Codex CLI", ...checked.status };
    },
    run: async (job) => runCodex({ ...job, program: await program(), assets }),
  };
}

export interface WatchmakerDeps {
  broker: EditorBroker;
  assets: AssetStore;
  projectsDir: string;
  engine: WatchmakerEngine;
}

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_URL = 12 * 1024 * 1024;

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const uuid = () => crypto.randomUUID();

/** The earlier conversation as text (pictures by id): Codex starts fresh for every message. */
export function historyOf(messages: ChatMessage[]): string {
  return messages.map((m) => {
    if (m.role === "user") {
      const attached = m.attachments?.length ? `\n(Attached: ${m.attachments.map((a) => `${a.use === "reference" ? "design reference" : "screenshot"} ${a.assetId}`).join(", ")})` : "";
      return `Person: ${m.text}${attached}`;
    }
    const did = [
      m.edits ? `Applied ${m.edits} step${m.edits === 1 ? "" : "s"} to the face.` : "",
      m.pictures?.length ? `Pictures made: ${m.pictures.map((p) => `${p.why ?? "image"} ${p.assetId}`).join(", ")}.` : "",
      m.stopped ? "Stopped by the person." : "", m.error ? `Failed: ${m.error}` : "",
    ].filter(Boolean).join(" ");
    return `Watchmaker: ${[m.text, did ? `(${did})` : ""].filter(Boolean).join("\n") || "(No answer.)"}`;
  }).join("\n\n");
}

/** The design reference the person picked most recently, if any. */
export const latestReference = (messages: ChatMessage[]) => [...messages].reverse().flatMap((m) => m.attachments ?? []).find((a) => a.use === "reference");

export class Watchmaker {
  readonly chats: ChatStore;
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly deps: WatchmakerDeps) {
    this.chats = new ChatStore(deps.projectsDir);
  }

  private async picture(assetId: string): Promise<{ name: string; bytes: Buffer } | null> {
    try {
      const a = await this.deps.assets.get(assetId);
      return { name: `${assetId}.${a.mime.split("/")[1]}`, bytes: a.bytes };
    } catch { return null; }
  }

  async status() {
    const engine = await this.deps.engine.status().catch((error: unknown) => ({ ready: false, label: "Codex CLI", problem: error instanceof Error ? error.message : String(error) }));
    return { ...engine, running: [...this.running.keys()] };
  }

  /** One message: saved, answered as a stream of events, and the answer saved. */
  async send(body: Record<string, unknown>): Promise<Response> {
    const projectId = typeof body.project === "string" ? body.project : "";
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 20_000) : "";
    const raw = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_ATTACHMENTS) : [];
    if (!text && !raw.length) return reply({ error: "invalid", message: t("Say what to change.") }, 400);
    if (this.running.has(projectId)) return reply({ error: "busy", message: t("Watchmaker is still working on this face.") }, 409);
    const engine = await this.deps.engine.status().catch(() => null);
    if (!engine?.ready) return reply({ error: "not_ready", message: engine?.problem ?? t(NOT_INSTALLED) }, 400);

    let chat: Chat;
    try {
      chat = typeof body.chatId === "string" && body.chatId ? await this.chats.load(projectId, body.chatId) : this.chats.fresh(projectId);
    } catch (error) {
      return reply({ error: "invalid", message: error instanceof Error ? error.message : t("That chat couldn't be opened.") }, 400);
    }
    const attachments: NonNullable<ChatMessage["attachments"]> = [];
    for (const a of raw as { dataUrl?: unknown; use?: unknown }[]) {
      if (typeof a?.dataUrl !== "string" || a.dataUrl.length > MAX_ATTACHMENT_URL) return reply({ error: "invalid", message: t("Pictures go in as PNG, JPEG or WebP, up to 8 MB.") }, 400);
      try { attachments.push({ assetId: await this.deps.assets.putDataUrl(a.dataUrl), use: a.use === "screenshot" ? "screenshot" : "reference" }); } catch (error) {
        return reply({ error: "invalid", message: error instanceof Error ? error.message : t("That picture can't be read.") }, 400);
      }
    }
    const earlier = [...chat.messages];
    const asked: ChatMessage = { id: uuid(), role: "user", at: new Date().toISOString(), text, ...(attachments.length ? { attachments } : {}) };
    chat.messages.push(asked);
    if (earlier.length === 0) chat.title = titleOf(text, attachments.length);
    await this.chats.save(chat);

    const abort = new AbortController();
    this.running.set(projectId, abort);
    // Who answered, without the account's email.
    const by = engine.label;
    const answer: ChatMessage = { id: uuid(), role: "assistant", at: new Date().toISOString(), text: "", steps: [], pictures: [], by };
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (event: unknown) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* the page went away; the work carries on and is saved */ } };
        send({ t: "start", chat: { id: chat.id, title: chat.title }, asked, answer: { id: answer.id, by: answer.by } });
        const stepAt = new Map<string, number>();
        const emit = (event: WatchmakerEvent) => {
          if (event.t === "step") { stepAt.set(event.id, answer.steps!.length); answer.steps!.push({ tool: event.tool, label: event.label, ok: true }); }
          if (event.t === "step-done") { const s = answer.steps![stepAt.get(event.id) ?? -1]; if (s) { s.ok = event.ok; if (event.message) s.message = event.message; } }
          if (event.t === "picture") answer.pictures!.push({ assetId: event.assetId, why: event.why });
          if (event.t === "plan") answer.plan = event.items;
          send(event);
        };
        try {
          const tools = watchmakerTools({ broker: this.deps.broker, assets: this.deps.assets, projectId });
          const doc = await tools.read(abort.signal);
          // With the message: the person's pictures, the design reference they picked earlier, and the face as it is now.
          const pictures: { name: string; bytes: Buffer }[] = [];
          const lines: string[] = [];
          for (const a of attachments) { const f = await this.picture(a.assetId); if (f) { pictures.push(f); lines.push(`${a.use === "reference" ? "Design reference" : "Screenshot"} ${a.assetId}`); } }
          const ref = attachments.some((a) => a.use === "reference") ? null : latestReference(earlier);
          if (ref) { const f = await this.picture(ref.assetId); if (f) { pictures.push(f); lines.push(`Design reference from earlier ${ref.assetId}`); } }
          const shot = await tools.run("render_preview", { resolution: (doc.capabilities as { placement?: { width?: number } })?.placement?.width }, abort.signal);
          const preview = shot.pictures?.[0];
          if (preview) { const f = await this.picture(preview.assetId); if (f) { pictures.push(f); lines.push(`The face now (${preview.assetId})`); } }
          const prompt = [
            earlier.length ? `The conversation so far:\n\n${historyOf(earlier)}` : "",
            `The open face:\n${JSON.stringify(compactDocument(doc))}`,
            `The person now asks:\n\n${text || "Use the attached picture."}`,
            lines.length ? `(Pictures with this message, in order: ${lines.join("; ")}.)` : "",
          ].filter(Boolean).join("\n\n");
          const outcome = await this.deps.engine.run({ instructions: WATCHMAKER_RULES, prompt, pictures, tools, emit, signal: abort.signal });
          answer.text = outcome.text || (outcome.stopped ? "" : t("Done."));
          answer.edits = outcome.edits;
          if (outcome.stopped) answer.stopped = true;
        } catch (error) {
          if (abort.signal.aborted) answer.stopped = true;
          else answer.error = error instanceof Error ? error.message : t("Watchmaker couldn't finish.");
        } finally {
          this.running.delete(projectId);
          chat.messages.push(answer);
          await this.chats.save(chat).catch(() => undefined);
          send({ t: "done", message: answer, chat: { id: chat.id, title: chat.title } });
          try { controller.close(); } catch { /* closed */ }
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
  }

  stop(projectId: string): boolean {
    const run = this.running.get(projectId);
    run?.abort();
    return !!run;
  }

  /** /api/desktop/studio/watchmaker[/…]. Null when the path isn't one of these. */
  async answer(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/desktop/studio/watchmaker")) return null;
    const route = url.pathname.slice("/api/desktop/studio/watchmaker".length) || "/";
    const get = request.method === "GET";
    if (!get && request.headers.get("x-clink-hub") !== "1") return reply({ error: "forbidden", message: t("Not from this app.") }, 403);
    const body = get ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    const project = get ? url.searchParams.get("project") ?? "" : typeof body.project === "string" ? body.project : "";
    try {
      if (get && route === "/") return reply(await this.status());
      if (get && route === "/chats") return reply({ chats: await this.chats.list(project) });
      const m = /^\/chats\/([a-f0-9-]{36})(\/delete)?$/i.exec(route);
      if (get && m && !m[2]) return reply({ chat: await this.chats.load(project, m[1]) });
      if (!get && m?.[2]) { await this.chats.remove(project, m[1]); return reply({ chats: await this.chats.list(project) }); }
      if (!get && route === "/send") return await this.send(body);
      if (!get && route === "/stop") return reply({ stopped: this.stop(project) });
    } catch (error) {
      return reply({ error: "failed", message: error instanceof Error ? error.message : t("That didn't work.") }, 400);
    }
    return reply({ error: "notFound" }, 404);
  }
}
