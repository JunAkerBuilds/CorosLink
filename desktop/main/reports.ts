// Error reports to the developer (watchfaces.coroslink.com, /api/v1/app/reports): the error log the person sends from
// Settings → Error logs, with an optional note and email, and crash reports sent on their own. The log is the same
// redacted text the page previews (errorLog.ts): home folders become ~, keys and tokens [hidden].
// A crash is written down first and sent after, so one that takes the app down still goes out on the next launch.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redact } from "./errorLog";

export const REPORTS_PATH = "/api/v1/app/reports";

const MAX_NOTE = 2000;
const MAX_CONTACT = 200;
const MAX_LOG = 64_000;
/** Crash reports a day, at most: a crash in a loop sends a few, not hundreds. */
const CRASHES_A_DAY = 3;
/** Crash reports waiting to go out, at most. */
const MAX_WAITING = 5;

export interface Report {
  kind: "manual" | "crash";
  installId: string | null;
  version: string; platform: string; arch: string; system: string; electron: string;
  note: string; contact: string; log: string;
}

interface Outbox { waiting: Report[]; crashDays: Record<string, number>; lastCrash?: string }

export interface ReportsHost {
  version: string; platform: string; arch: string; system: string; electron: string;
  /** Where reports go; null in development builds without a test server (CLINK_TELEMETRY_ORIGIN). */
  origin: string | null;
  /** The redacted error log of the last `hours`. */
  log: (hours: number) => string;
  /** The usage install ID, when usage counts are on, so a report can be matched with its install. */
  installId: () => string | null;
  /** Crash reports turned on in Settings, and not in Local mode. */
  crashesAllowed: () => boolean;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** The log's newest end, when it is longer than the server takes. */
export function tail(text: string, max = MAX_LOG): string {
  return text.length <= max ? text : `…\n${text.slice(text.length - max + 2)}`;
}

export class ReportSender {
  private readonly file: string;
  private sending: Promise<void> | null = null;

  constructor(folder: string, private readonly host: ReportsHost) {
    this.file = path.join(folder, "logs", "outbox.json");
  }

  private now(): Date { return this.host.now?.() ?? new Date(); }

  private read(): Outbox {
    try {
      const raw = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Partial<Outbox>) : {};
      return { waiting: Array.isArray(raw.waiting) ? raw.waiting : [], crashDays: raw.crashDays && typeof raw.crashDays === "object" ? raw.crashDays : {}, lastCrash: raw.lastCrash };
    } catch {
      return { waiting: [], crashDays: {} };
    }
  }

  private write(outbox: Outbox): void {
    const temp = `${this.file}.tmp`;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(temp, JSON.stringify(outbox), { mode: 0o600 });
      renameSync(temp, this.file);
    } catch { /* lost with the crash it was about */ }
  }

  private report(kind: Report["kind"], note: string, contact: string, hours: number): Report {
    const h = this.host;
    return {
      kind, installId: h.installId(), version: h.version, platform: h.platform, arch: h.arch, system: h.system, electron: h.electron,
      note: note.trim().slice(0, MAX_NOTE), contact: contact.trim().slice(0, MAX_CONTACT), log: tail(h.log(hours)),
    };
  }

  private async post(report: Report): Promise<{ reference: string } | { status: number }> {
    if (!this.host.origin) return { status: 0 };
    const answer = await (this.host.fetch ?? fetch)(`${this.host.origin}${REPORTS_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report), signal: AbortSignal.timeout(20_000),
    });
    if (!answer.ok) return { status: answer.status };
    const body = (await answer.json().catch(() => ({}))) as { reference?: unknown };
    return { reference: typeof body.reference === "string" ? body.reference : "" };
  }

  /** The person pressed Send: the log of the last `hours`, their note and email. Returns the reference to quote. */
  async send(input: { note: string; contact: string; hours: number }): Promise<{ reference: string } | { failed: "offline" | "refused" | "unavailable" }> {
    if (!this.host.origin) return { failed: "unavailable" };
    try {
      const sent = await this.post(this.report("manual", input.note, input.contact, input.hours));
      return "reference" in sent ? sent : { failed: sent.status === 429 || sent.status >= 500 ? "unavailable" : "refused" };
    } catch {
      return { failed: "offline" };
    }
  }

  /**
   * Something crashed: written down at once (the app may be going), then sent. The same crash twice in a row and more
   * than three a day aren't kept.
   */
  crashed(what: string): void {
    if (!this.host.crashesAllowed() || !this.host.origin) return;
    const outbox = this.read();
    const day = this.now().toISOString().slice(0, 10);
    // The crash's own words leave with home folders and keys taken out, as the log does (errorLog.ts).
    what = redact(what);
    // The same crash twice in a row is kept once a day, not once ever.
    const today = outbox.crashDays[day] ?? 0;
    if (today >= CRASHES_A_DAY || (today > 0 && outbox.lastCrash === what)) return;
    outbox.crashDays = { [day]: (outbox.crashDays[day] ?? 0) + 1 };
    outbox.lastCrash = what;
    outbox.waiting = [...outbox.waiting, this.report("crash", what, "", 1)].slice(-MAX_WAITING);
    this.write(outbox);
    void this.flush();
  }

  /** Sends what's waiting (on launch, and after a crash). What fails stays for the next launch. */
  flush(): Promise<void> {
    this.sending ??= this.drain().finally(() => { this.sending = null; });
    return this.sending;
  }

  private async drain(): Promise<void> {
    let outbox = this.read();
    if (!outbox.waiting.length) return;
    if (!this.host.crashesAllowed()) { this.write({ ...outbox, waiting: [] }); return; }
    while (outbox.waiting.length) {
      const [next] = outbox.waiting;
      try {
        const sent = await this.post(next);
        // Refused (400): it won't be taken later either. Busy or down: try on the next launch.
        if ("status" in sent && (sent.status === 0 || sent.status === 429 || sent.status >= 500)) return;
      } catch {
        return;
      }
      // Taken out by what it is, not by place: a crash written meanwhile may have pushed the queue along.
      outbox = this.read();
      const gone = JSON.stringify(next);
      outbox.waiting = outbox.waiting.filter((r) => JSON.stringify(r) !== gone);
      this.write(outbox);
    }
  }
}
