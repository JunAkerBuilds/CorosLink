// Tests only: a WatchDriver over a child process speaking the engine's commands as JSON lines (one object per line
// each way: {"id", "cmd", …} in, {"id", "ok", "result"} or {"id", "ok": false, "error"} out, and {"event": …} lines),
// so service tests can stand in a fake watch.
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { HelperProblem, type HelperEvent, type Spawner, type WatchDriver } from "./helper";

interface Waiting { resolve: (value: unknown) => void; reject: (error: Error) => void }

export class LineDriver implements WatchDriver {
  private child: ChildProcessWithoutNullStreams | null = null;
  private next = 1;
  private readonly waiting = new Map<number, Waiting>();

  constructor(private readonly start: Spawner, private readonly onEvent: (e: HelperEvent) => void, private readonly onLog: (line: string) => void = () => {}) {}

  get running(): boolean { return this.child !== null; }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = this.start();
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.take(line));
    // Its own error text only: the helper never writes keys, payloads or the password there.
    createInterface({ input: child.stderr }).on("line", (line) => this.onLog(line.slice(0, 300)));
    const ended = (why: string) => {
      if (this.child !== child) return;
      this.child = null;
      for (const w of this.waiting.values()) w.reject(new HelperProblem(why));
      this.waiting.clear();
      this.onEvent({ event: "disconnected", reason: why });
    };
    child.on("exit", (code, signal) => ended(signal === "SIGTERM" ? "Stopped." : `The watch helper stopped (${signal ?? code}).`));
    child.on("error", (error) => ended(`The watch helper couldn't start: ${error.message}`));
    return child;
  }

  private take(line: string): void {
    let message: Record<string, unknown>;
    try { message = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    if (typeof message.event === "string") { this.onEvent(message as HelperEvent); return; }
    const id = Number(message.id);
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    if (message.ok === true) waiting.resolve(message.result);
    else waiting.reject(new HelperProblem(typeof message.error === "string" ? message.error : "The watch didn't answer."));
  }

  /** One command; answered once the helper has done everything before it. */
  call<T>(cmd: string, fields: Record<string, unknown> = {}): Promise<T> {
    const child = this.ensure();
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      child.stdin.write(JSON.stringify({ ...fields, id, cmd }) + "\n");
    });
  }

  /** Stops the helper: whatever it was doing ends, and it lets go of the watch. */
  stop(): void {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    child.kill("SIGTERM");
  }
}

