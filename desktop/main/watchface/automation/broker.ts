// The way from the main process to the open Studio editor (CorosLink's watchfaceAutomationBroker.ts, without IPC).
// The page keeps a request open on /api/desktop/studio/automation/inbox; each request from the MCP server or
// Watchmaker is written to it as one JSON line, and the page answers with POST …/reply. Requests run one at a time,
// in the order asked, and the next starts only once the page has answered the last (a slow save never overlaps a later
// edit). A request waits a while for a page to connect, and fails if the page goes away while it is pending.

export class EditorError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "EditorError";
  }
}

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void }
interface Inbox { send(line: string): void; close(): void }

export interface BrokerOptions {
  /** How long a request waits for the page to connect. */
  readyTimeoutMs?: number;
  /** How long a request waits for the page's answer. */
  requestTimeoutMs?: number;
  /** Keep-alive line interval, so nothing on the way closes an idle stream. */
  heartbeatMs?: number;
}

let counter = 0;

export class EditorBroker {
  private inbox: Inbox | null = null;
  private readonly waiters = new Set<() => void>();
  private readonly pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;

  constructor(private readonly options: BrokerOptions = {}) {}

  get connected(): boolean { return this.inbox !== null; }

  /** GET …/inbox: the page's stream. A newer page (a reload) takes over from an older one. */
  open(signal?: AbortSignal): Response {
    this.drop("The editor reconnected. Read the document again before retrying.");
    let beat: ReturnType<typeof setInterval> | undefined;
    const encoder = new TextEncoder();
    let mine: Inbox | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const inbox: Inbox = {
          send: (line) => controller.enqueue(encoder.encode(`${line}\n`)),
          close: () => { clearInterval(beat); try { controller.close(); } catch { /* already closed */ } },
        };
        mine = inbox;
        this.inbox = inbox;
        beat = setInterval(() => { try { inbox.send(""); } catch { this.lost(inbox); } }, this.options.heartbeatMs ?? 15_000);
        for (const wake of this.waiters) wake();
      },
      cancel: () => { clearInterval(beat); if (mine) this.lost(mine); },
    });
    signal?.addEventListener("abort", () => { if (mine) { mine.close(); this.lost(mine); } }, { once: true });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
  }

  private lost(inbox: Inbox): void {
    if (this.inbox !== inbox) return;
    this.inbox = null;
    this.failPending("The editor connection closed. Read the document again before retrying.");
  }

  private drop(message: string): void {
    if (!this.inbox) return;
    const old = this.inbox;
    this.inbox = null;
    old.close();
    this.failPending(message);
  }

  private failPending(message: string): void {
    for (const p of this.pending.values()) p.reject(new EditorError("EDITOR_DISCONNECTED", message));
    this.pending.clear();
  }

  /** POST …/reply. */
  reply(body: unknown): boolean {
    const answer = body as { id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; details?: unknown } };
    if (typeof answer?.id !== "string") return false;
    const pending = this.pending.get(answer.id);
    if (!pending) return false;
    this.pending.delete(answer.id);
    if (answer.error) pending.reject(new EditorError(String(answer.error.code ?? "EDITOR_ERROR"), String(answer.error.message ?? "The editor refused the request."), answer.error.details));
    else pending.resolve(answer.result);
    return true;
  }

  private waitForPage(signal?: AbortSignal): Promise<Inbox> {
    if (this.inbox) return Promise.resolve(this.inbox);
    return new Promise((resolve, reject) => {
      const done = (error?: Error) => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        signal?.removeEventListener("abort", aborted);
        if (error) reject(error); else resolve(this.inbox!);
      };
      const wake = () => { if (this.inbox) done(); };
      const aborted = () => done(new EditorError("CANCELLED", "Stopped."));
      const timer = setTimeout(() => done(new EditorError("EDITOR_UNAVAILABLE", "C-LINK's window isn't open. Open it and try again.")), this.options.readyTimeoutMs ?? 20_000);
      this.waiters.add(wake);
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }

  /** Asks the page. Resolves with its result or rejects with an EditorError. */
  request(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    if (this.queued >= 32) return Promise.reject(new EditorError("BUSY", "Too many editor requests are waiting."));
    this.queued++;
    const work = this.queue.catch(() => undefined).then(async () => {
      if (signal?.aborted) throw new EditorError("CANCELLED", "Stopped.");
      const inbox = await this.waitForPage(signal);
      const id = `r${++counter}`;
      const answered = new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try { inbox.send(JSON.stringify({ id, method, params })); } catch (error) { this.pending.delete(id); reject(error as Error); }
      });
      // The queue follows the page's real answer, even after the caller gives up waiting.
      const timeout = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new EditorError("EDITOR_TIMEOUT", "The editor is still working on this. It may finish; read the document before retrying a change.")), this.options.requestTimeoutMs ?? 120_000);
        void answered.finally(() => clearTimeout(t)).catch(() => undefined);
      });
      return { answered, timeout };
    });
    // …but never for ever: a page that neither answers nor disconnects frees the queue after a long while.
    const cap = (this.options.requestTimeoutMs ?? 120_000) * 5;
    this.queue = work.then(({ answered }) => Promise.race([answered, new Promise((r) => setTimeout(r, cap).unref?.())]))
      .catch(() => undefined).finally(() => { this.queued--; });
    return work.then(({ answered, timeout }) => Promise.race([answered, timeout]));
  }
}
