// Error logs: what went wrong in the app, kept on this computer only (logs/errors.json) for Settings → Error logs.
// At most 200 entries and 7 days; the same message again within 30 minutes counts up instead of adding a line.
// Home folders and anything that looks like a key or token are taken out before a line is kept.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface LogEntry { at: number; area: string; message: string; count: number }

const MAX_ENTRIES = 200;
const MAX_AGE = 7 * 24 * 3600_000;
const MERGE_WITHIN = 30 * 60_000;
const MAX_MESSAGE = 600;

/** Paths under the home folder become ~, and keys, tokens and sign-in codes become [hidden]. */
export function redact(text: string, home = homedir()): string {
  let out = text;
  if (home) out = out.split(home).join("~");
  return out
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, "$1 [hidden]")
    .replace(/\b(sk|pk|rk|cl(?:in)?k_local|sess|ghp|gho|xox[abp])[-_][\w-]{8,}/gi, "[hidden]")
    .replace(/\b(token|key|secret|password|passphrase|code|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[hidden]")
    .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+/g, "[hidden]")
    .slice(0, MAX_MESSAGE);
}

export class ErrorLog {
  private entries: LogEntry[] = [];
  private readonly file: string;

  constructor(folder: string, private readonly now: () => number = Date.now) {
    this.file = path.join(folder, "logs", "errors.json");
    try { if (existsSync(this.file)) this.entries = (JSON.parse(readFileSync(this.file, "utf8")) as LogEntry[]).filter((e) => typeof e?.message === "string"); } catch { /* starts empty */ }
    this.prune();
  }

  get path(): string { return this.file; }

  add(area: string, message: string): void {
    const text = redact(message.trim());
    if (!text) return;
    const at = this.now();
    const same = this.entries.findLast((e) => e.area === area && e.message === text && at - e.at < MERGE_WITHIN);
    if (same) { same.count += 1; same.at = at; } else this.entries.push({ at, area, message: text, count: 1 });
    this.prune();
    this.save();
  }

  /** Entries from the last `hours`, oldest first. */
  since(hours: number): LogEntry[] {
    const from = this.now() - hours * 3600_000;
    return this.entries.filter((e) => e.at >= from);
  }

  /** The report the page previews and copies: a heading line, then one line per entry. */
  report(hours: number, heading: string): string {
    const lines = this.since(hours).map((e) => {
      const d = new Date(e.at), two = (n: number) => String(n).padStart(2, "0");
      const time = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
      return `[${time}] ${e.area.padEnd(6)} ${e.message}${e.count > 1 ? ` (×${e.count})` : ""}`;
    });
    return [heading, ...lines].join("\n");
  }

  clear(): void {
    this.entries = [];
    this.save();
  }

  private prune(): void {
    const from = this.now() - MAX_AGE;
    this.entries = this.entries.filter((e) => e.at >= from).slice(-MAX_ENTRIES);
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.entries), { mode: 0o600 });
    } catch { /* a log that can't be written is not worth failing over */ }
  }
}
