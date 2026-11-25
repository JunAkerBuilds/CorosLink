// An authenticated COROS session over the link: SystemBind, then what the COROS app does on each connection. A port
// of CorosKit's Bluetooth/WatchSession.swift and WatchData/WatchSession+Data.swift; it grows phase by phase
// (docs/watch-engine.md).
import { CorosError } from "./bytes";
import { nearLocalMidnight, requireAcknowledgement, SYNC_TIME, syncTime } from "./commands";
import { supports, targetOf } from "./models";
import { decodeSettings, EXTENDED_SWITCHES, SETTINGS_GET, settingsRequest, switchesFrom, type WatchSwitches } from "./settings";
import { BIND_OPCODE, describeBindReply, SystemBind, type WatchAccountKey } from "./systemBind";
import type { BleLink } from "./transport";

export class WatchSession {
  authenticatedAt: Date | null = null;
  /** What the watch answered in the last bind, for reports: statuses and checksums only. */
  lastBind: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly link: BleLink, private readonly note: (line: string) => void = () => {}) {}

  /** Runs one watch operation at a time: a sync or an install is a series of requests nothing may interleave with. */
  exclusively<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Answers a fresh watch challenge with a new signature. Never activates or resets the watch's account key. */
  async authenticate(account: WatchAccountKey): Promise<void> {
    const info = this.link.info;
    const bind = new SystemBind(account, info.name);
    const base = bind.initialPayload();
    this.lastBind = [`C-LINK checksum ${bind.keyChecksum?.toString(16).toUpperCase().padStart(4, "0") ?? "unknown"}`];
    const challenge = await this.link.exchange(BIND_OPCODE, base, 20);
    this.lastBind.push(`challenge: ${describeBindReply(challenge)}`);
    const signed = bind.authenticatedPayload(base, challenge);
    const reply = await this.link.exchange(BIND_OPCODE, signed, Math.min(240, info.maximumWriteBytes));
    this.lastBind.push(`reply: ${describeBindReply(reply)}`);
    this.note(`bind: ${this.lastBind.join("; ")}`);
    if (!SystemBind.isBound(reply) || !this.link.isConnected) {
      throw new CorosError("The watch rejected the COROS account. Pair with the CorosLink account this watch uses, then reconnect.");
    }
    this.authenticatedAt = new Date();
  }

  requireAuthenticated(): void {
    if (!this.link.isConnected || !this.authenticatedAt) throw new CorosError("Connect and authenticate your watch first.");
  }

  private async switchesNow(): Promise<WatchSwitches> {
    const reply = decodeSettings(await this.link.exchange(SETTINGS_GET, settingsRequest([EXTENDED_SWITCHES]), 20));
    return switchesFrom(reply, targetOf(this.link.info));
  }

  /** The system switches as stored on the watch. */
  readSwitches(): Promise<WatchSwitches> {
    this.requireAuthenticated();
    return this.exclusively(() => this.switchesNow());
  }

  /**
   * Sets the clock and time zone from this computer, as the app does on every connection. On watches whose 12/24-hour
   * switch was checked, the watch's own format is kept; others get the computer's. False when the watch's format
   * couldn't be read, so the clock wasn't set.
   */
  setClock(computerUses12Hour: boolean, now: () => Date = () => new Date()): Promise<boolean> {
    this.requireAuthenticated();
    return this.exclusively(async () => {
      let hour12 = computerUses12Hour;
      if (supports(this.link.info, "clockFormat")) {
        try { hour12 = (await this.switchesNow()).hour12; } catch {
          this.note("clock: 12/24-hour format unknown, not set");
          return false;
        }
      }
      // The watch rolls its day over in the first seconds after midnight; the app waits that out.
      while (nearLocalMidnight(now())) await new Promise((r) => setTimeout(r, 2000));
      const reply = await this.link.exchange(SYNC_TIME, syncTime(now(), hour12), 20);
      requireAcknowledgement(reply, "The watch didn't accept the time and time zone.");
      this.note("clock set");
      return true;
    });
  }
}
