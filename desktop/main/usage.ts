// Usage counts: one anonymous check-in a day to watchfaces.coroslink.com (/api/v1/app/usage), so the developer gets an
// idea of how many people use C-LINK. It carries a random install ID (made here, tied to no account), the app version,
// the system and the day. Nothing about which pages were opened, activities, health, faces or the person. Off until
// turned on (the privacy question, or Settings → Privacy), in Local mode and in development builds.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const USAGE_PATH = "/api/v1/app/usage";

/** The person's own date, as the server takes it: YYYY-MM-DD. */
export function localDay(at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** A day the app was used, and whether the server has it. */
interface Day { day: string; sent: boolean }
interface Saved { installId: string; days: Day[] }

export interface UsageHost {
  version: string;
  platform: string;
  arch: string;
  /** Turned on in Settings, and not in Local mode. Read before every send. */
  allowed: () => boolean;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Where check-ins go; none sends nothing. */
  endpoint?: string;
}

/** How often a running app looks for a new day. */
const TICK_MS = 60 * 60_000;
/** Days the server still takes (it refuses anything older than two days). */
const KEEP_DAYS = 3;

export class UsageCheckIn {
  private readonly file: string;
  private saved: Saved | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private sending: Promise<void> | null = null;

  constructor(folder: string, private readonly host: UsageHost) {
    this.file = path.join(folder, "usage.json");
  }

  private now(): Date { return this.host.now?.() ?? new Date(); }

  private load(): Saved {
    if (this.saved) return this.saved;
    try {
      const raw = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved>) : {};
      const id = typeof raw.installId === "string" && /^[0-9a-f-]{36}$/.test(raw.installId) ? raw.installId : randomUUID();
      // A file from before areas were dropped kept `sent` as a count, -1 for not yet.
      const days = Array.isArray(raw.days) ? raw.days.filter((d) => typeof d?.day === "string") : [];
      this.saved = { installId: id, days: days.map((d) => ({ day: d.day, sent: d.sent === true || (typeof d.sent === "number" && d.sent >= 0) })) };
    } catch {
      this.saved = { installId: randomUUID(), days: [] };
    }
    return this.saved;
  }

  private save(): void {
    if (!this.saved) return;
    const temp = `${this.file}.tmp`;
    try { writeFileSync(temp, JSON.stringify(this.saved)); renameSync(temp, this.file); } catch { /* counted next time */ }
  }

  private today(): Day {
    const saved = this.load();
    const day = localDay(this.now());
    let record = saved.days.find((d) => d.day === day);
    if (!record) {
      record = { day, sent: false };
      saved.days = [...saved.days, record].slice(-KEEP_DAYS);
      this.save();
    }
    return record;
  }

  /** Starts counting: today goes out now (the app was opened), then a new day is looked for every hour. */
  start(): void {
    if (!this.host.allowed()) return;
    this.today();
    void this.flush();
    this.tick ??= setInterval(() => { if (this.host.allowed()) { this.today(); void this.flush(); } }, TICK_MS);
    this.tick.unref?.();
  }

  /** Sends each kept day the server hasn't fully had. A failed send stays for the next one. */
  flush(): Promise<void> {
    this.sending ??= this.send().finally(() => { this.sending = null; });
    return this.sending;
  }

  private async send(): Promise<void> {
    if (!this.host.allowed() || !this.host.endpoint) return;
    const saved = this.load();
    const go = this.host.fetch ?? fetch;
    for (const record of saved.days.filter((d) => !d.sent)) {
      // Turned off while an earlier day was going out: the rest stay.
      if (!this.host.allowed()) return;
      try {
        const answer = await go(this.host.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ installId: saved.installId, day: record.day, version: this.host.version, platform: this.host.platform, arch: this.host.arch, areas: [] }),
          signal: AbortSignal.timeout(15_000),
        });
        // `areas` stays, always empty: the server before CorosLink-web's 0055 migration refuses a check-in without it,
        // and the one after ignores it. Drop it once that server is live. A day the server no longer takes (400)
        // won't be taken later either.
        if (answer.ok || answer.status === 400) record.sent = true;
        else return;
      } catch {
        return;
      }
      this.save();
    }
  }

  /** The install ID while usage counts are on, so an error report can be matched with its install. */
  installId(): string | null { return this.host.allowed() ? this.load().installId : null; }

  /** Turned off: nothing more goes out, and the install ID and kept days are forgotten. */
  forget(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null; this.saved = null;
    rmSync(this.file, { force: true });
  }
}
