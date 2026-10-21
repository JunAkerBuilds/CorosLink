import fs from "node:fs";
import path from "node:path";
import type { DataMode, PersistedDataMode } from "./dataModeTypes";

/**
 * The data mode lives in its own small JSON file rather than SQLite so it can
 * be read synchronously before `app.whenReady()`: Chromium's resolver rules
 * must be set before the browser process starts, and no service may start
 * before the mode is known.
 *
 * Fails closed: a file that exists but cannot be read or parsed is treated as
 * Local-Only Mode, so corruption can never silently re-enable COROS access.
 */
export class DataModeStore {
  constructor(private readonly filePath: string, private readonly now: () => Date = () => new Date()) {}

  get path(): string { return this.filePath; }

  load(): PersistedDataMode {
    let text: string;
    try {
      text = fs.readFileSync(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.defaults("connected");
      return { ...this.defaults("local_only"), recovered: true };
    }
    try {
      const parsed = JSON.parse(text) as Partial<PersistedDataMode>;
      if (parsed?.version !== 1 || (parsed.mode !== "connected" && parsed.mode !== "local_only")) throw new Error("invalid");
      return {
        version: 1,
        mode: parsed.mode,
        changedAt: typeof parsed.changedAt === "string" ? parsed.changedAt : this.now().toISOString()
      };
    } catch {
      return { ...this.defaults("local_only"), recovered: true };
    }
  }

  /** Atomic replace: write a sibling temp file, fsync it, rename over, fsync the directory. */
  save(mode: DataMode): PersistedDataMode {
    const record: PersistedDataMode = { version: 1, mode, changedAt: this.now().toISOString() };
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    const handle = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeSync(handle, `${JSON.stringify(record, null, 2)}\n`);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, this.filePath);
    try {
      const directoryHandle = fs.openSync(directory, "r");
      try { fs.fsyncSync(directoryHandle); } finally { fs.closeSync(directoryHandle); }
    } catch {
      // Windows cannot fsync a directory handle; the rename is still atomic there.
    }
    return record;
  }

  private defaults(mode: DataMode): PersistedDataMode {
    return { version: 1, mode, changedAt: this.now().toISOString() };
  }
}
