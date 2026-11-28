// The desktop's own data: every synced item kept in SQLite on this computer, answered through the sync API of
// docs/sync-contract.md section 2: versions that only grow,
// deletion markers, paging by count and by 1 MB, unchanged writes keeping their version, all-or-nothing batches,
// sorted keys in stored bodies, and `cursor: 0` for a `since` from before a wipe. The screens' sync code
// runs on it, and the paired phone syncs to it the same way (phones/).
import { randomBytes } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { canonical } from "@/data/sync/canonical";

export const LOCAL_TOKEN_PREFIX = "clink_local_";
const MAX_ITEM = 256 * 1024, MAX_REQUEST = 1024 * 1024, MAX_PAGE = 1024 * 1024;
const COLLECTION = /^[a-z][a-z0-9.]{0,39}$/, ID = /^[A-Za-z0-9._:\-]{1,128}$/;
const KEY = /^[a-z][a-z0-9.]{0,39}\/[A-Za-z0-9._:-]{1,128}$/;

interface Row { collection: string; id: string; version: number; updatedAt: string; deleted: boolean; body?: Record<string, unknown> }
interface DbRow { collection: string; id: string; version: number; updated_at: string; deleted: number; body: string | null }
export interface Seed { collection: string; id: string; body: object }
type Change = { collection: string; id: string; body?: object; deleted?: true; base?: number };

/** Rules run on the store's writes (activities/duplicates.ts: one workout, one activity). */
export interface StoreRules {
  /** Before C-LINK's own writes. */
  prepare(changes: readonly Change[]): Change[];
  /** After any write that changed something, a phone's push included. */
  afterWrite(changed: readonly { collection: string; id: string }[]): void;
}

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Bodies are stored, and so come back, with their keys sorted. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isBag(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted(value[k])]));
}

const toRow = (r: DbRow): Row => ({
  collection: r.collection, id: r.id, version: r.version, updatedAt: r.updated_at, deleted: r.deleted === 1,
  ...(r.deleted === 1 || r.body === null ? {} : { body: JSON.parse(r.body) as Record<string, unknown> }),
});

const reply = (body: Record<string, unknown>, status = 200): Response => Response.json({ schemaVersion: 1, ...body }, { status });
const refuse = (status: number, code: string, message: string): Response => reply({ error: { code, message } }, status);

export class LocalStore {
  private readonly db: DatabaseSync;
  private readonly q: Record<string, StatementSync>;
  /** The token the app's own session carries; asked for on every sync call so nothing else on this computer reads it. */
  readonly token: string;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS items (
        collection TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0, body TEXT, PRIMARY KEY (collection, id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS items_by_version ON items (version);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.q = {
      cursor: this.db.prepare("SELECT value FROM meta WHERE key = 'cursor'"),
      setCursor: this.db.prepare("INSERT INTO meta (key, value) VALUES ('cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
      wipedAt: this.db.prepare("SELECT value FROM meta WHERE key = 'wipedAt'"),
      setWipedAt: this.db.prepare("INSERT INTO meta (key, value) VALUES ('wipedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
      token: this.db.prepare("SELECT value FROM meta WHERE key = 'token'"),
      setToken: this.db.prepare("INSERT INTO meta (key, value) VALUES ('token', ?)"),
      one: this.db.prepare("SELECT * FROM items WHERE collection = ? AND id = ?"),
      after: this.db.prepare("SELECT * FROM items WHERE version > ? ORDER BY version LIMIT ?"),
      waiting: this.db.prepare("SELECT COUNT(*) AS n FROM items WHERE version > ?"),
      put: this.db.prepare(`INSERT INTO items (collection, id, version, updated_at, deleted, body) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(collection, id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, deleted = excluded.deleted, body = excluded.body`),
      status: this.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(body)), 0) AS bytes FROM items WHERE deleted = 0"),
      newest: this.db.prepare("SELECT MAX(updated_at) AS at FROM items"),
      live: this.db.prepare("SELECT COUNT(*) AS n FROM items WHERE deleted = 0"),
      count: this.db.prepare("SELECT COUNT(*) AS n FROM items WHERE deleted = 0 AND collection = ?"),
      wipe: this.db.prepare("DELETE FROM items"),
      everything: this.db.prepare("SELECT * FROM items WHERE deleted = 0 AND body IS NOT NULL ORDER BY collection, id"),
      collection: this.db.prepare("SELECT * FROM items WHERE deleted = 0 AND body IS NOT NULL AND collection = ? ORDER BY id"),
    };
    const saved = this.q.token.get() as { value: string } | undefined;
    this.token = saved?.value ?? LOCAL_TOKEN_PREFIX + randomBytes(24).toString("base64url");
    if (!saved) this.q.setToken.run(this.token);
  }

  get cursor(): number {
    return Number((this.q.cursor.get() as { value: string } | undefined)?.value ?? 0);
  }

  /** The cursor when everything was last wiped: a client still at or below it holds what was wiped. */
  private get wipedAt(): number {
    return Number((this.q.wipedAt.get() as { value: string } | undefined)?.value ?? 0);
  }

  /**
   * Everything goes, but versions keep growing. A client whose cursor is from before the wipe is told to start again
   * from 0 (`pull`); numbering from 1 again would let a restore of more items than the client had seen pass for news.
   */
  private wipe(): void {
    this.inTransaction(() => {
      const cursor = this.cursor;
      this.q.wipe.run();
      this.q.setWipedAt.run(String(cursor));
      // One past the wipe, so a status check differs from every cursor handed out before it, even with nothing restored.
      this.q.setCursor.run(String(cursor + 1));
    });
  }

  /** How many items are kept here (deletion markers left out). */
  get size(): number {
    return Number((this.q.live.get() as { n: number }).n);
  }

  /** How many live items one collection holds. */
  count(collection: string): number {
    return Number((this.q.count.get(collection) as { n: number }).n);
  }

  /** Adds items as if they had been synced, in one transaction. For the sample athlete. */
  seed(items: readonly Seed[], now = new Date()): void {
    this.inTransaction(() => {
      let cursor = this.cursor;
      const at = now.toISOString();
      for (const item of items) this.q.put.run(item.collection, item.id, ++cursor, at, 0, JSON.stringify(sorted(item.body)));
      this.q.setCursor.run(String(cursor));
    });
  }

  /** Every live item, for a backup. */
  items(): Seed[] {
    return (this.q.everything.all() as unknown as DbRow[]).map((r) => ({ collection: r.collection, id: r.id, body: JSON.parse(r.body ?? "{}") as object }));
  }

  /** One collection's live items, for the app's own services (the watch in Local mode reads `watch.change`). */
  list(collection: string): { id: string; version: number; body: Record<string, unknown> }[] {
    return (this.q.collection.all(collection) as unknown as DbRow[]).map((r) => ({ id: r.id, version: r.version, body: JSON.parse(r.body ?? "{}") as Record<string, unknown> }));
  }

  private rules: StoreRules | null = null;
  attachRules(rules: StoreRules | null): void { this.rules = rules; }

  /** One live item's body, or undefined. */
  get(collection: string, id: string): Record<string, unknown> | undefined {
    const row = this.q.one.get(collection, id) as DbRow | undefined;
    return row && row.deleted === 0 && row.body ? (JSON.parse(row.body) as Record<string, unknown>) : undefined;
  }

  /**
   * Writes as a client's push would, by the same rules (an unchanged body keeps its version, `base` guards against
   * writing over a change made meanwhile), in batches the push takes. For the app's own services, which write as
   * a phone would: the watch in Local mode.
   */
  write(changes: readonly Change[]): { written: number; conflicts: number; skipped: number } {
    let written = 0, conflicts = 0, skipped = 0;
    // Batches of at most 100 changes and under the 1 MB a push takes (activity details run to tens of KB each). An
    // item over the 256 KB a push takes is left out alone, rather than refusing everything sent with it.
    if (this.rules) changes = this.rules.prepare(changes);
    const batches: string[][] = [];
    let batch: string[] = [], size = 0;
    for (const change of changes) {
      if (change.body && JSON.stringify(change.body).length > MAX_ITEM) { skipped++; continue; }
      const text = JSON.stringify(change);
      if (batch.length && (batch.length >= 100 || size + text.length + 1 > MAX_REQUEST - 64)) { batches.push(batch); batch = []; size = 0; }
      batch.push(text);
      size += text.length + 1;
    }
    if (batch.length) batches.push(batch);
    for (const texts of batches) {
      const answer = this.push(`{"changes":[${texts.join(",")}]}`);
      if (answer.status !== 200) throw new Error(`The store refused a write (${answer.status}).`);
      const rows = (this.lastPush ?? []) as { changed: boolean; conflict?: boolean }[];
      written += rows.filter((r) => r.changed).length;
      conflicts += rows.filter((r) => r.conflict).length;
    }
    return { written, conflicts, skipped };
  }

  /** The rows of the last push, for `write` (a Response's body can only be read asynchronously). */
  private lastPush: unknown[] | null = null;

  /** Everything replaced by `items` (sample data starting over); clients see the wipe and read it all again. */
  replaceWith(items: readonly Seed[], now = new Date()): void {
    this.wipe();
    this.seed(items, now);
  }

  private inTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Answers one request to the sync API. */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/v1/me/sync")) return refuse(404, "NOT_FOUND", "Not found.");
    if (request.headers.get("authorization") !== `Bearer ${this.token}`) return refuse(401, "UNAUTHORIZED", "Sign in again.");

    if (url.pathname === "/api/v1/me/sync/items" && request.method === "GET") {
      const keys = url.searchParams.getAll("key");
      if (!keys.length || keys.length > 20 || keys.some((key) => !KEY.test(key))) return refuse(400, "INVALID_SYNC", "Name 1 to 20 items as key=collection/id.");
      const items = [...new Set(keys)].flatMap((key) => {
        const slash = key.indexOf("/");
        const row = this.q.one.get(key.slice(0, slash), key.slice(slash + 1)) as DbRow | undefined;
        return row ? [toRow(row)] : [];
      });
      return reply({ items });
    }
    if (url.pathname === "/api/v1/me/sync/status" && request.method === "GET") {
      const { n, bytes } = this.q.status.get() as { n: number; bytes: number };
      const { at } = this.q.newest.get() as { at: string | null };
      return reply({ items: Number(n), bytes: Number(bytes), updatedAt: at, cursor: this.cursor });
    }
    if (url.pathname !== "/api/v1/me/sync") return refuse(404, "NOT_FOUND", "Not found.");
    if (request.method === "GET") return this.pull(url);
    if (request.method === "POST") return this.push(await request.text());
    if (request.method === "DELETE") {
      const deleted = this.size;
      this.wipe();
      return reply({ deleted });
    }
    return refuse(405, "METHOD", "Not allowed.");
  }

  private pull(url: URL): Response {
    const since = Number(url.searchParams.get("since") ?? 0), limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200)));
    if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit)) return refuse(400, "INVALID_SYNC", "since and limit must be whole numbers.");
    // A cursor from before a wipe: the client drops its cache and starts again from 0.
    if (since > this.cursor || (since > 0 && since <= this.wipedAt)) return reply({ items: [], cursor: 0, more: false });
    const rows = (this.q.after.all(since, limit) as unknown as DbRow[]).map(toRow);
    const items: Row[] = [];
    let bytes = 0;
    for (const row of rows) {
      const size = JSON.stringify(row).length;
      if (items.length > 0 && bytes + size > MAX_PAGE) break;
      items.push(row);
      bytes += size;
    }
    const last = items.length ? items[items.length - 1].version : since;
    const more = Number((this.q.waiting.get(last) as { n: number }).n) > 0;
    // Caught up: the store's own cursor, which may be past the last item (a wipe moves it on with nothing after it).
    const cursor = more ? last : this.cursor;
    return reply({ items, cursor, more });
  }

  private push(raw: string): Response {
    if (raw.length > MAX_REQUEST) return refuse(413, "SYNC_TOO_LARGE", "At most 1 MB per request.");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return refuse(400, "INVALID_SYNC", "Send JSON."); }
    const changes = isBag(parsed) ? parsed.changes : null;
    if (!Array.isArray(changes)) return refuse(400, "INVALID_SYNC", "changes must be a list.");
    if (changes.length > 200) return refuse(413, "SYNC_TOO_LARGE", "At most 200 changes per request.");
    for (const change of changes) {
      if (!isBag(change) || typeof change.collection !== "string" || !COLLECTION.test(change.collection) || typeof change.id !== "string" || !ID.test(change.id)) {
        return refuse(400, "INVALID_SYNC", "A change has a bad collection or id.");
      }
      if (change.deleted === true) continue;
      if (!isBag(change.body)) return refuse(400, "INVALID_SYNC", "A change needs a body or deleted: true.");
      if (JSON.stringify(change.body).length > MAX_ITEM) return refuse(400, "INVALID_SYNC", "An item is larger than 256 KB.");
    }
    const at = new Date().toISOString();
    const { results, cursor } = this.inTransaction(() => {
      let cursor = this.cursor;
      const results = (changes as Record<string, unknown>[]).map((change) => {
        const collection = change.collection as string, id = change.id as string;
        const found = this.q.one.get(collection, id) as DbRow | undefined;
        const stored = found ? toRow(found) : undefined;
        const moved = typeof change.base === "number" && !!stored && !stored.deleted && stored.version !== change.base;
        if (change.deleted === true) {
          if (!stored || stored.deleted) return { collection, id, version: stored?.version ?? 0, changed: false };
          if (moved) return { collection, id, version: stored.version, changed: false, conflict: true };
          this.q.put.run(collection, id, ++cursor, at, 1, null);
          return { collection, id, version: cursor, changed: true };
        }
        const body = sorted(change.body) as Record<string, unknown>;
        if (stored && !stored.deleted && canonical(stored.body) === canonical(body)) return { collection, id, version: stored.version, changed: false };
        if (moved) return { collection, id, version: stored!.version, changed: false, conflict: true };
        this.q.put.run(collection, id, ++cursor, at, 0, JSON.stringify(body));
        return { collection, id, version: cursor, changed: true };
      });
      this.q.setCursor.run(String(cursor));
      return { results, cursor };
    });
    const changed = results.filter((r) => r.changed);
    // The rules' own writes run in here; `lastPush` is this push's, set after them.
    if (this.rules && changed.length) this.rules.afterWrite(changed);
    this.lastPush = results;
    return reply({ results, cursor });
  }

  close(): void {
    this.db.close();
  }
}

