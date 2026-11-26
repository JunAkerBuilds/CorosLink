// Watchmaker, the AI designer in Studio's inspector (CorosLink's WatchfaceAiPanel + electron/watchfaceAi*.ts). It asks
// the AI picked on the AI page (any provider: a key, ChatGPT, the CLIs) and drives the open face through the editor
// broker, so every applied step is one undo step and the canvas changes as it works. Chats are saved per face.
// Routes under /api/desktop/studio/watchmaker: status, chats (list, read, delete), send (a stream of events, one JSON
// line each), stop.
import type { CoachModel, ModelMessage } from "@/lib/coach/loop";
import type { CoachFile } from "@/lib/coach/files";
import type { AssetStore } from "../automation/assets";
import type { EditorBroker } from "../automation/broker";
import { ChatStore, titleOf, type Chat, type ChatMessage } from "./chats";
import { runWatchmaker, type WatchmakerEvent } from "./loop";
import { WATCHMAKER_RULES } from "./rules";
import { compactDocument, watchmakerTools, type ImageMaker } from "./tools";
import { t } from "@/lib/i18n";

export interface PickedModel { model: CoachModel; label: string; provider: string | null }

export interface WatchmakerDeps {
  broker: EditorBroker;
  assets: AssetStore;
  projectsDir: string;
  /** The AI picked on the AI page, or null while none is set up. */
  model(): Promise<PickedModel | null>;
  /** Image generation, when a provider for it is set up. */
  imageMaker(): Promise<ImageMaker | null>;
}

/** Providers that run as their own program get tool text only (ai/agent.ts restarts on any other message). */
const AGENTS = new Set(["claude-code", "gemini-cli", "opencode", "antigravity"]);
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_URL = 12 * 1024 * 1024;

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const uuid = () => crypto.randomUUID();

/** The earlier conversation as plain text turns (pictures by id), so any provider can carry it. */
export function historyOf(messages: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const attached = m.attachments?.length ? `\n(Attached: ${m.attachments.map((a) => `${a.use === "reference" ? "design reference" : "screenshot"} ${a.assetId}`).join(", ")})` : "";
      out.push({ role: "user", content: `${m.text}${attached}` });
    } else {
      const did = [
        m.edits ? `Applied ${m.edits} step${m.edits === 1 ? "" : "s"} to the face.` : "",
        m.pictures?.length ? `Pictures made: ${m.pictures.map((p) => `${p.why ?? "image"} ${p.assetId}`).join(", ")}.` : "",
        m.stopped ? "Stopped by the person." : "", m.error ? `Failed: ${m.error}` : "",
      ].filter(Boolean).join(" ");
      out.push({ role: "assistant", content: [m.text, did ? `(${did})` : ""].filter(Boolean).join("\n") || "(No answer.)" });
    }
  }
  return out;
}

/** The design reference the person picked most recently, if any. */
export const latestReference = (messages: ChatMessage[]) => [...messages].reverse().flatMap((m) => m.attachments ?? []).find((a) => a.use === "reference");

export class Watchmaker {
  readonly chats: ChatStore;
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly deps: WatchmakerDeps) {
    this.chats = new ChatStore(deps.projectsDir);
  }

  private async picture(assetId: string): Promise<CoachFile | null> {
    try {
      const a = await this.deps.assets.get(assetId);
      return { name: `${assetId}.${a.mime.split("/")[1]}`, mime: a.mime, kind: "image", data: a.bytes.toString("base64") };
    } catch { return null; }
  }

  async status() {
    const picked = await this.deps.model().catch(() => null);
    return { ready: !!picked, label: picked?.label ?? null, images: !!(await this.deps.imageMaker().catch(() => null)), running: [...this.running.keys()] };
  }

  /** One message: saved, answered as a stream of events, and the answer saved. */
  async send(body: Record<string, unknown>): Promise<Response> {
    const projectId = typeof body.project === "string" ? body.project : "";
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 20_000) : "";
    const raw = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_ATTACHMENTS) : [];
    if (!text && !raw.length) return reply({ error: "invalid", message: t("Say what to change.") }, 400);
    if (this.running.has(projectId)) return reply({ error: "busy", message: t("Watchmaker is still working on this face.") }, 409);
    const picked = await this.deps.model();
    if (!picked) return reply({ error: "not_ready", message: t("Set up an AI first.") }, 400);

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
    const answer: ChatMessage = { id: uuid(), role: "assistant", at: new Date().toISOString(), text: "", steps: [], pictures: [], by: picked.label };
    const encoder = new TextEncoder();
    const seesPictures = !AGENTS.has(picked.provider ?? "");

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
          const tools = watchmakerTools({ broker: this.deps.broker, assets: this.deps.assets, makeImage: await this.deps.imageMaker().catch(() => null), projectId });
          const doc = await tools.read(abort.signal);
          // What the model sees with the message: the person's pictures, the design reference they picked earlier, and
          // the face as it is now.
          const files: CoachFile[] = [];
          const lines: string[] = [];
          if (seesPictures) {
            for (const a of attachments) { const f = await this.picture(a.assetId); if (f) { files.push(f); lines.push(`${a.use === "reference" ? "Design reference" : "Screenshot"} ${a.assetId}`); } }
            const ref = attachments.some((a) => a.use === "reference") ? null : latestReference(earlier);
            if (ref) { const f = await this.picture(ref.assetId); if (f) { files.push(f); lines.push(`Design reference from earlier ${ref.assetId}`); } }
            const shot = await tools.run("render_preview", { resolution: (doc.capabilities as { placement?: { width?: number } })?.placement?.width }, abort.signal);
            const preview = shot.pictures?.[0];
            if (preview) { const f = await this.picture(preview.assetId); if (f) { files.push(f); lines.push(`The face now (${preview.assetId})`); } }
          } else if (attachments.length) {
            lines.push(...attachments.map((a) => `${a.use === "reference" ? "Design reference" : "Screenshot"} ${a.assetId} (look at it with inspect_asset if you can)`));
          }
          const note = lines.length ? `\n\n(Pictures with this message, in order: ${lines.join("; ")}.)` : "";
          const messages: ModelMessage[] = [...historyOf(earlier), {
            role: "user",
            content: files.length ? [{ type: "text", text: `${text || "Use the attached picture."}${note}` }, ...files.map((file) => ({ type: "file", file }))] : `${text}${note}`,
          }];
          const outcome = await runWatchmaker({
            model: picked.model, rules: WATCHMAKER_RULES, context: `The open face:\n${JSON.stringify(compactDocument(doc))}`,
            messages, tools: tools.defs, runTool: tools.run, picture: (id) => this.picture(id), seesPictures, emit, signal: abort.signal,
          });
          answer.text = outcome.text || (outcome.stopped ? "" : t("Done."));
          answer.edits = outcome.edits;
          if (outcome.stopped) answer.stopped = true;
          if (outcome.outOfRounds) answer.error = t("Watchmaker ran out of steps for this message. Send another to carry on.");
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
