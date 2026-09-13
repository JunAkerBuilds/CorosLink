import crypto from "node:crypto";
import type { WatchfaceAutomationRequest, WatchfaceAutomationResponse } from "./watchfaceAutomationTypes";

type Scope = "hub" | "editor";
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class WatchfaceAutomationBridgeError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "WatchfaceAutomationBridgeError";
  }
}

/** Serializes external work through the same live document used by the editor. */
export class WatchfaceAutomationBroker {
  private ready = new Set<Scope>();
  private waiters = new Set<() => void>();
  private pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private queued = 0;

  constructor(private options: {
    activate: () => void;
    send: (request: WatchfaceAutomationRequest) => void;
    readyTimeoutMs?: number;
    requestTimeoutMs?: number;
  }) {}

  setReady(scope: Scope, ready: boolean): void {
    if (ready) this.ready.add(scope);
    else this.ready.delete(scope);
    for (const wake of this.waiters) wake();
  }

  respond(response: WatchfaceAutomationResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(new WatchfaceAutomationBridgeError(
        response.error.code, response.error.message, response.error.details
      ));
    } else pending.resolve(response.result);
  }

  cancel(message = "The editor connection closed. Reconnect and read the document before retrying.", resetReady = true): void {
    this.generation += 1;
    if (resetReady) this.ready.clear();
    for (const pending of this.pending.values()) {
      pending.reject(new WatchfaceAutomationBridgeError("EDITOR_DISCONNECTED", message));
    }
    this.pending.clear();
    for (const wake of this.waiters) wake();
  }

  dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.queued >= 32) return Promise.reject(new WatchfaceAutomationBridgeError("BUSY", "Too many editor requests are waiting."));
    this.queued += 1;
    const generation = this.generation;
    // The queue follows the actual reply, even if the caller times out. A slow
    // export must never overlap a later edit or be silently applied twice.
    let started!: (work: Promise<unknown>) => void;
    let didStart = false;
    const start = new Promise<{ work: Promise<unknown> }>((resolve) => {
      started = (work) => { didStart = true; resolve({ work }); };
    });
    const work = this.queue.catch(() => undefined).then(async () => {
      if (generation !== this.generation) throw new WatchfaceAutomationBridgeError("EDITOR_DISCONNECTED", "The editor connection changed. Read the document and retry.");
      this.options.activate();
      await this.waitUntilReady(["open", "get_context", "get_schema"].includes(method) ? "hub" : "editor", generation);
      const id = crypto.randomUUID();
      const response = new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try { this.options.send({ id, method, params }); }
        catch (error) { this.pending.delete(id); reject(error); }
      });
      started(response);
      return response;
    });
    this.queue = work.then(() => { this.queued -= 1; }, () => { this.queued -= 1; });
    // Also deliver failures before a request was sent (closed window/readiness).
    void work.catch((error) => { if (!didStart) started(Promise.reject(error)); });
    return start.then((result) => {
      const response = result.work;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new WatchfaceAutomationBridgeError(
          "EDITOR_TIMEOUT", "The editor is still processing this request. It may complete; inspect the document before retrying a change."
        )), this.options.requestTimeoutMs ?? 120_000);
        response.then(resolve, reject).finally(() => clearTimeout(timeout));
      });
    });
  }

  private waitUntilReady(scope: Scope, generation: number): Promise<void> {
    if (this.ready.has(scope)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        if (error) reject(error); else resolve();
      };
      const wake = () => {
        if (generation !== this.generation) finish(new WatchfaceAutomationBridgeError("EDITOR_DISCONNECTED", "The editor connection changed."));
        else if (this.ready.has(scope)) finish();
      };
      const timer = setTimeout(() => finish(new WatchfaceAutomationBridgeError(
        scope === "editor" ? "NO_OPEN_PROJECT" : "EDITOR_UNAVAILABLE",
        scope === "editor" ? "Open a watch-face project or template before using editor tools." : "The watch-face workspace did not become ready. Open CorosLink and retry."
      )), this.options.readyTimeoutMs ?? 20_000);
      this.waiters.add(wake);
      wake();
    });
  }
}
