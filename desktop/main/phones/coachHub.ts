// Coach for the paired phones: CorosKit CoachContract's sessions, timeline and numbered events, over the
// conversations the Coach page keeps (the `coach.conversation` and `coach.message` items). A phone's question runs
// the same Coach route the page asks (/api/coach), and its answer is saved the way the page saves one, so the page
// and the phone show the same conversations. Cards stay on the computer: the phone sees their titles.
//
// Events: each session numbers its events with no gaps (C-LINK checks `seq == cursor + 1`). Numbers start from this
// launch's time, so they only grow across restarts; a phone whose cursor isn't in this launch's log gets a snapshot.
import { randomUUID } from "node:crypto";
import { t } from "@/lib/i18n";
import { conversationEntries, previewOf, type PhoneEntry } from "./coachEntries";

const REF_EPOCH_UNIX = 978_307_200;
const refToIso = (ref: unknown) => new Date(((typeof ref === "number" && Number.isFinite(ref) ? ref : 0) + REF_EPOCH_UNIX) * 1000).toISOString();
const nowRef = () => Date.now() / 1000 - REF_EPOCH_UNIX;
const messageItemId = (conversationId: string, n: number) => `${conversationId}.${String(n).padStart(4, "0")}`;
const newId = () => randomUUID().toUpperCase();
const SESSION_ID = /^[A-Za-z0-9._:-]{1,100}$/;
/** Events kept per session for a phone that drops off and comes back. */
const LOG_LIMIT = 4000;
const MAX_TEXT = 4000;
const NEW_TITLE = "New conversation";

type Change = { collection: string; id: string; body?: object; deleted?: true };
export interface CoachItems {
  list(collection: string): { id: string; version: number; body: Record<string, unknown> }[];
  get(collection: string, id: string): Record<string, unknown> | undefined;
  write(changes: readonly Change[]): unknown;
}

/** A call to one of the app's own API routes, as the page makes it. */
export type AskApi = (path: string, body: unknown, signal?: AbortSignal) => Promise<Response>;

export interface SessionInfo { id: string; title: string; provider: string; createdAt: string; updatedAt: string }
interface ActiveTurn { requestId: string; text: string; thinking: string; tool?: string }
export interface Snapshot { session: SessionInfo; entries: PhoneEntry[]; cursor: number; activeTurn: ActiveTurn | null }
export interface EventFrame { event: string; sessionId: string; seq: number; data: unknown }

export class CoachRpcError extends Error {
  constructor(readonly code: "not_found" | "busy" | "invalid" | "unsupported" | "failed", message: string) { super(message); }
}

/** Something that receives a session's events: one phone's socket. */
export interface CoachClient { send(frame: EventFrame): void }

interface Live {
  seq: number;
  /** Events after `from`, in order: `log[i].seq === from + i + 1`. */
  log: EventFrame[];
  from: number;
  entries: PhoneEntry[];
  info: SessionInfo;
  turn: { requestId: string; abort: AbortController; active: ActiveTurn } | null;
  subscribers: Set<CoachClient>;
}

interface Stored { n: number; message: unknown }

export interface CoachHubOptions {
  items: () => CoachItems;
  ask: AskApi;
  /** The AI Coach answers with now, as the phone names a provider. */
  provider: () => Promise<string>;
  /** How often the saved conversations are compared, while a phone is watching one (the page writes them too). */
  pollMs?: number;
}

export class CoachHub {
  private readonly live = new Map<string, Live>();
  /** Sessions a phone created that have nothing in them yet: the page lists only conversations with messages. */
  private readonly drafts = new Map<string, SessionInfo>();
  /** `clientMessageId` → `requestId`, so a resent message runs once. */
  private readonly sent = new Map<string, string>();
  private readonly base = Math.floor(Date.now() / 1000) * 1000;
  private poll: NodeJS.Timeout | null = null;
  private versions = "";

  constructor(private readonly options: CoachHubOptions) {}

  // ───────────── Reading ─────────────

  private messages(sessionId: string): Stored[] {
    return this.options.items().list("coach.message")
      .filter((m) => m.body.conversationId === sessionId && typeof m.body.n === "number")
      .map((m) => ({ n: m.body.n as number, message: m.body.message }))
      .sort((a, b) => a.n - b.n);
  }

  private async infoOf(id: string, provider?: string): Promise<SessionInfo | null> {
    const body = this.options.items().get("coach.conversation", id);
    if (!body) return this.drafts.get(id) ?? null;
    const createdAt = refToIso(body.startedAt ?? body.updatedAt);
    return { id, title: typeof body.title === "string" && body.title ? body.title : t(NEW_TITLE), provider: provider ?? (await this.options.provider()), createdAt, updatedAt: refToIso(body.updatedAt ?? body.startedAt) };
  }

  async listSessions(): Promise<(SessionInfo & { preview?: string; messageCount: number })[]> {
    const provider = await this.options.provider();
    const items = this.options.items();
    const byConversation = new Map<string, Stored[]>();
    for (const m of items.list("coach.message")) {
      const id = m.body.conversationId;
      if (typeof id !== "string" || typeof m.body.n !== "number") continue;
      byConversation.set(id, [...(byConversation.get(id) ?? []), { n: m.body.n, message: m.body.message }]);
    }
    const rows = [];
    for (const c of items.list("coach.conversation")) {
      const messages = byConversation.get(c.id);
      if (!messages) continue;
      const entries = conversationEntries(messages.sort((a, b) => a.n - b.n).map((m) => m.message));
      const info = (await this.infoOf(c.id, provider))!;
      const preview = previewOf(entries);
      rows.push({ ...info, ...(preview ? { preview } : {}), messageCount: entries.length });
    }
    for (const draft of this.drafts.values()) if (!byConversation.has(draft.id)) rows.push({ ...draft, provider, messageCount: 0 });
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async session(id: string): Promise<Live> {
    if (!SESSION_ID.test(id)) throw new CoachRpcError("invalid", t("That isn't a conversation."));
    const had = this.live.get(id);
    if (had) return had;
    const info = await this.infoOf(id);
    if (!info) throw new CoachRpcError("not_found", t("That conversation isn't on this computer any more."));
    const live: Live = { seq: this.base, log: [], from: this.base, entries: conversationEntries(this.messages(id).map((m) => m.message)), info, turn: null, subscribers: new Set() };
    this.live.set(id, live);
    return live;
  }

  private snapshotOf(live: Live): Snapshot {
    return { session: live.info, entries: live.entries, cursor: live.seq, activeTurn: live.turn ? { ...live.turn.active } : null };
  }

  async getSession(id: string): Promise<Snapshot> {
    return this.snapshotOf(await this.session(id));
  }

  // ───────────── Events ─────────────

  private emit(live: Live, event: string, data: unknown): void {
    const frame: EventFrame = { event, sessionId: live.info.id, seq: ++live.seq, data };
    live.log.push(frame);
    if (live.log.length > LOG_LIMIT) { const drop = live.log.length - LOG_LIMIT; live.log.splice(0, drop); live.from += drop; }
    for (const client of live.subscribers) client.send(frame);
  }

  /** Brings a session's entries up to what is saved, as appended and updated entries. */
  private sync(live: Live): void {
    const now = conversationEntries(this.messages(live.info.id).map((m) => m.message));
    const was = live.entries;
    if (now.length < was.length) {
      // Something was taken away (Retry, a deletion): entries can only be added or replaced, so the phone starts
      // over from a snapshot. Skipping a number makes it ask for one.
      live.entries = now;
      live.seq += 1;
      live.log = [];
      live.from = live.seq;
      this.emit(live, "session.updated", { session: live.info });
      return;
    }
    live.entries = now;
    for (let i = 0; i < now.length; i++) {
      if (i >= was.length) this.emit(live, "entry.appended", { index: i, entry: now[i] });
      else if (JSON.stringify(now[i]) !== JSON.stringify(was[i])) this.emit(live, "entry.updated", { index: i, entry: now[i] });
    }
  }

  private async refreshInfo(live: Live): Promise<void> {
    const info = await this.infoOf(live.info.id);
    if (info && JSON.stringify(info) !== JSON.stringify(live.info)) { live.info = info; this.emit(live, "session.updated", { session: info }); }
  }

  async subscribe(client: CoachClient, id: string, afterSeq: number | null | undefined): Promise<{ mode: "replay" } | { mode: "snapshot"; snapshot: Snapshot }> {
    const live = await this.session(id);
    live.subscribers.add(client);
    this.watch();
    if (typeof afterSeq === "number" && afterSeq >= live.from && afterSeq <= live.seq) {
      // Sent after the answer, in order.
      const missed = live.log.slice(afterSeq - live.from);
      queueMicrotask(() => missed.forEach((frame) => client.send(frame)));
      return { mode: "replay" };
    }
    return { mode: "snapshot", snapshot: this.snapshotOf(live) };
  }

  unsubscribe(client: CoachClient, id: string): void {
    this.live.get(id)?.subscribers.delete(client);
  }

  /** A phone's socket closed. */
  drop(client: CoachClient): void {
    for (const live of this.live.values()) live.subscribers.delete(client);
  }

  /** Watches the saved conversations while a phone is subscribed to one, for what the page (or another phone) wrote. */
  private watch(): void {
    if (this.poll) return;
    this.poll = setInterval(() => { void this.check(); }, this.options.pollMs ?? 1500);
    this.poll.unref?.();
  }

  /** Compares the saved conversations with what phones were sent. Public for tests. */
  async check(): Promise<void> {
    const watched = [...this.live.values()].filter((l) => l.subscribers.size > 0);
    if (watched.length === 0) {
      if (this.poll) { clearInterval(this.poll); this.poll = null; }
      return;
    }
    const items = this.options.items();
    const versions = [...items.list("coach.conversation"), ...items.list("coach.message")].map((i) => `${i.id}:${i.version}`).join(",");
    if (versions === this.versions) return;
    this.versions = versions;
    for (const live of watched) {
      if (live.turn) continue;
      this.sync(live);
      await this.refreshInfo(live);
    }
  }

  stop(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    for (const live of this.live.values()) live.turn?.abort.abort();
  }

  // ───────────── Changing ─────────────

  async createSession(): Promise<{ session: SessionInfo }> {
    const at = new Date().toISOString();
    const session: SessionInfo = { id: newId(), title: t(NEW_TITLE), provider: await this.options.provider(), createdAt: at, updatedAt: at };
    this.drafts.set(session.id, session);
    return { session };
  }

  async deleteSession(id: string): Promise<void> {
    const live = await this.session(id);
    live.turn?.abort.abort();
    const changes: Change[] = this.messages(id).map((m) => ({ collection: "coach.message", id: messageItemId(id, m.n), deleted: true as const }));
    if (this.options.items().get("coach.conversation", id)) changes.push({ collection: "coach.conversation", id, deleted: true });
    if (changes.length) this.options.items().write(changes);
    this.drafts.delete(id);
    this.live.delete(id);
  }

  async cancel(id: string): Promise<void> {
    (await this.session(id)).turn?.abort.abort();
  }

  /** A question, or the answer to one of Coach's questions. Returns the turn's id at once; the answer streams. */
  async send(params: { sessionId: string; clientMessageId: string; text?: string | null; promptAnswer?: { promptId: string; choiceId?: string | null; text?: string | null } | null }): Promise<{ requestId: string }> {
    const { sessionId, clientMessageId } = params;
    if (typeof clientMessageId !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(clientMessageId)) throw new CoachRpcError("invalid", t("That message has no id."));
    const key = `${sessionId}/${clientMessageId}`;
    const done = this.sent.get(key);
    if (done) return { requestId: done };
    const live = await this.session(sessionId);
    if (live.turn) throw new CoachRpcError("busy", t("Coach is still answering. Wait for it, or stop it first."));

    let text = typeof params.text === "string" ? params.text.trim() : "";
    const answer = params.promptAnswer;
    if (answer) text = this.answerQuestion(live, answer) ?? text;
    if (!text) throw new CoachRpcError("invalid", t("Type a question for Coach."));
    if (text.length > MAX_TEXT) throw new CoachRpcError("invalid", t("That message is too long."));

    const requestId = newId();
    this.sent.set(key, requestId);
    if (this.sent.size > 500) this.sent.delete(this.sent.keys().next().value!);
    const abort = new AbortController();
    live.turn = { requestId, abort, active: { requestId, text: "", thinking: "" } };
    void this.run(live, text).finally(() => { live.turn = null; });
    return { requestId };
  }

  /** Marks Coach's question answered in the saved conversation; returns the words to send as the reply. */
  private answerQuestion(live: Live, answer: { promptId: string; choiceId?: string | null; text?: string | null }): string | null {
    const items = this.options.items();
    for (const m of this.messages(live.info.id).reverse()) {
      const message = m.message as { from?: string; blocks?: Record<string, unknown>[] } | null;
      const at = message?.from === "coach" && Array.isArray(message.blocks) ? message.blocks.findIndex((b) => b.kind === "question" && b.id === answer.promptId) : -1;
      if (!message || at < 0) continue;
      const card = message.blocks![at] as { options?: { id: string; title: string }[] };
      const words = (typeof answer.text === "string" && answer.text.trim()) || card.options?.find((o) => o.id === answer.choiceId)?.title || "";
      if (!words) return null;
      const blocks = message.blocks!.map((b, i) => (i === at ? { ...b, answered: { text: words, at: Date.now() } } : b));
      const id = messageItemId(live.info.id, m.n);
      items.write([{ collection: "coach.message", id, body: { ...items.get("coach.message", id), message: { ...message, blocks } } }]);
      return words;
    }
    throw new CoachRpcError("not_found", t("That question isn't in this conversation any more."));
  }

  private save(live: Live, n: number, message: object, conversation: Record<string, unknown>): void {
    const at = nowRef();
    this.options.items().write([
      { collection: "coach.conversation", id: live.info.id, body: { ...conversation, updatedAt: at } },
      { collection: "coach.message", id: messageItemId(live.info.id, n), body: { conversationId: live.info.id, n, at, message } },
    ]);
  }

  private async run(live: Live, text: string): Promise<void> {
    const { requestId, abort, active } = live.turn!;
    const id = live.info.id;
    const thread = this.messages(id);
    const had = this.options.items().get("coach.conversation", id);
    const startedAt = nowRef();
    const conversation: Record<string, unknown> = { title: typeof had?.title === "string" ? had.title : titleFrom(text), startedAt: had?.startedAt ?? startedAt, suggestions: [], sources: [] };
    let n = thread.length ? thread[thread.length - 1].n + 1 : 0;
    this.save(live, n, { id: newId(), from: "you", text }, conversation);
    this.drafts.delete(id);
    n += 1;
    this.sync(live);
    await this.refreshInfo(live);
    this.emit(live, "turn.started", { requestId });

    const failed = (message: string) => ({ kind: "failed", id: newId(), title: t("Coach couldn't answer"), text: message, tried: "" });
    const finish = (blocks: object[], extra: Record<string, unknown>, problem: string | null) => {
      this.save(live, n, { id: newId(), from: "coach", blocks }, { ...conversation, ...extra });
      this.sync(live);
      if (problem) this.emit(live, "turn.failed", { requestId, message: problem, authError: false });
      else this.emit(live, "turn.completed", { requestId });
    };

    let response: Response;
    try {
      response = await this.options.ask("/api/coach", {
        text, history: thread.map((m) => m.message).filter(Boolean), offsetMin: new Date().getTimezoneOffset(), hubDays: null, plans: [], browserWorkouts: [],
      }, abort.signal);
    } catch {
      if (abort.signal.aborted) return finish([{ kind: "note", id: newId(), note: "read", text: t("Stopped before Coach answered.") }], {}, null);
      return finish([failed(t("Coach couldn't be reached on this computer."))], {}, t("Coach couldn't be reached on this computer."));
    }
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      const message = payload?.error?.message ?? t("Coach couldn't answer.");
      return finish([failed(message)], {}, message);
    }

    const blocks: object[] = [];
    let words = "", buffer = "", problem: string | null = null;
    let done: { blocks: object[]; suggestions?: string[]; sources?: unknown[] } | null = null;
    const take = (line: string) => {
      if (!line.trim()) return;
      let event: { t: string; delta?: string; card?: { title?: string }; block?: { kind: string; id?: string; text?: string }; blocks?: object[]; suggestions?: string[]; sources?: unknown[]; message?: string };
      try { event = JSON.parse(line); } catch { return; }
      if (event.t === "text" && typeof event.delta === "string") {
        words += event.delta;
        active.text += event.delta;
        delete active.tool;
        this.emit(live, "turn.delta", { requestId, delta: event.delta });
      } else if (event.t === "reset") {
        // A note to self before reading data: the phone drops it too (a new start empties the turn's text).
        words = ""; active.text = "";
        this.emit(live, "turn.started", { requestId });
      } else if (event.t === "working") {
        const tool = event.card?.title ?? "Reading";
        active.tool = tool;
        this.emit(live, "turn.tool", { requestId, tool, status: "call" });
      } else if (event.t === "block" && event.block) {
        const b = event.block, at = b.kind === "text" ? -1 : blocks.findIndex((x) => (x as { id?: string }).id === b.id);
        if (at >= 0) blocks[at] = b;
        else { blocks.push(...paragraphs(words), b); words = ""; }
      } else if (event.t === "done" && Array.isArray(event.blocks)) {
        done = { blocks: event.blocks, suggestions: event.suggestions, sources: event.sources };
      } else if (event.t === "error") {
        problem = event.message ?? t("Coach couldn't answer.");
      }
    };
    try {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(take);
      }
      take(buffer);
    } catch {
      if (!abort.signal.aborted) problem ??= t("The answer stopped before Coach finished.");
    }
    const finished = done as { blocks: object[]; suggestions?: string[]; sources?: unknown[] } | null;
    if (finished) {
      finish(finished.blocks, { suggestions: finished.suggestions ?? [], sources: finished.sources ?? [] }, null);
      if (!had) void this.name(live, conversation.title as string, text, finished.blocks);
      return;
    }
    const partial = [...blocks, ...paragraphs(words)];
    if (abort.signal.aborted) return finish([...partial, { kind: "note", id: newId(), note: "read", text: t("Stopped before Coach finished.") }], {}, null);
    return finish([...partial, failed(problem ?? t("Coach stopped before finishing."))], {}, problem ?? t("Coach stopped before finishing."));
  }

  /** The AI's title for a new conversation, as the page asks for one; kept only while the first title stands. */
  private async name(live: Live, madeFrom: string, question: string, blocks: readonly object[]): Promise<void> {
    try {
      const answer = blocks.map((b) => { const x = b as { kind?: string; text?: string; title?: string }; return x.kind === "text" ? x.text : x.title; }).filter(Boolean).join("\n\n");
      const response = await this.options.ask("/api/ai/title", { question, answer });
      const title = response.ok ? ((await response.json()) as { title?: unknown }).title : null;
      if (typeof title !== "string" || !title) return;
      const items = this.options.items();
      const now = items.get("coach.conversation", live.info.id);
      if (!now || now.title !== madeFrom) return;
      items.write([{ collection: "coach.conversation", id: live.info.id, body: { ...now, title } }]);
      await this.refreshInfo(live);
    } catch {
      // The title made from the question stays.
    }
  }
}

const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({ kind: "text", text: p }));

export function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}
