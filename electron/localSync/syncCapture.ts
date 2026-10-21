import fs from "node:fs";
import path from "node:path";

/**
 * Developer capture for confirming the watch-sync protocol on real hardware.
 * Off unless CorosLink is started with COROSLINK_SYNC_CAPTURE=1. Every frame
 * of the local-sync operations (activity blocks and the step summary) is appended to one JSON-lines file per app session under
 * local-archive/captures/. Authentication exchanges are never captured, and
 * the watch serial number is never written. Frames can contain activity data
 * (GPS), so files are private to this user and never leave the computer.
 */

const SYNC_CAPTURE_ENV = "COROSLINK_SYNC_CAPTURE";

export function syncCaptureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SYNC_CAPTURE_ENV] === "1";
}

export class SyncCaptureLog {
  private file?: string;

  constructor(
    readonly directory: string,
    private readonly session: Record<string, unknown> = {},
    private readonly now: () => Date = () => new Date()
  ) {}

  /** The current session's file, created on first write. */
  get filePath(): string | undefined {
    return this.file;
  }

  write(entry: Record<string, unknown>): void {
    try {
      if (!this.file) {
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        const stamp = this.now().toISOString().replace(/[:.]/g, "-");
        this.file = path.join(this.directory, `sync-capture-${stamp}.jsonl`);
        this.append({ type: "session", ...this.session });
      }
      this.append(entry);
    } catch {
      // A capture problem never affects the sync itself.
    }
  }

  private append(entry: Record<string, unknown>): void {
    fs.appendFileSync(this.file!, `${JSON.stringify({ at: this.now().toISOString(), ...entry })}\n`, { mode: 0o600 });
  }
}
