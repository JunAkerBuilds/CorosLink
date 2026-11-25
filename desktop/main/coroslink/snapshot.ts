// A private copy of CorosLink's database to read from. CorosLink may still be open and writing (WAL): its files are
// copied, never opened in place, so nothing C-LINK does can lock, change or check-point them. "A copy, not a move."
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class Snapshot {
  private constructor(private readonly db: DatabaseSync, private readonly folder: string) {}

  /** Copies `db` (with its -wal and -shm) into `scratch` and opens the copy. */
  static open(db: string, scratch: string): Snapshot {
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });
    const copy = path.join(scratch, "coroslink.sqlite");
    copyFileSync(db, copy);
    for (const tail of ["-wal", "-shm"]) if (existsSync(db + tail)) copyFileSync(db + tail, copy + tail);
    return new Snapshot(new DatabaseSync(copy), scratch);
  }

  /** Rows of a query; none when CorosLink's version didn't have that table or column. */
  all<T>(sql: string, ...params: (string | number)[]): T[] {
    try { return this.db.prepare(sql).all(...params) as T[]; } catch { return []; }
  }

  one<T>(sql: string, ...params: (string | number)[]): T | null {
    return this.all<T>(sql, ...params)[0] ?? null;
  }

  count(sql: string): number {
    return Number(this.one<{ n: number }>(sql)?.n ?? 0);
  }

  /** One `app_settings` value (plain JSON text in CorosLink), or null. */
  setting(key: string): string | null {
    return this.one<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", key)?.value ?? null;
  }

  close(): void {
    try { this.db.close(); } catch { /* already */ }
    rmSync(this.folder, { recursive: true, force: true });
  }
}
