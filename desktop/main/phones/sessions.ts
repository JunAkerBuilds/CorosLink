// The phones paired with this computer: one session each, bound to the phone's key (DPoP thumbprint). Only a hash of
// each session token is kept, so the database alone can't be used to pose as a phone.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SESSION_DAYS = 90;
const PAIRING_MINUTES = 10;
/** What a paired phone may do: sync, and use Coach here (read, ask, approve). */
export const PHONE_PERMISSIONS = ["sync:read", "sync:write", "coach:read", "coach:operate", "coach:approve"];
/** A credential the relay handed a phone away from home works once, for this long. */
const BOOTSTRAP_MS = 2 * 60_000;

export interface PhoneSession { id: string; jkt: string; label: string; createdAt: string; lastUsedAt: string; expiresAt: string }
export interface Grant { sessionToken: string; expiresAt: string; permissions: string[] }

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const token = (bytes: number) => randomBytes(bytes).toString("base64url");
const days = (n: number) => n * 24 * 3600 * 1000;

export class PhoneSessions {
  private readonly db: DatabaseSync;
  private pairing: { secret: string; expiresAt: number } | null = null;
  /** One-time credentials minted for the relay, by hash: the phone key each is for, and when it lapses. */
  private readonly credentials = new Map<string, { jkt: string; expiresAt: number }>();
  /** Called when a phone's session ends (removed here, or signed out on the phone): its sockets close. */
  onEnded: (id: string) => void = () => {};
  readonly environmentId: string;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS phones (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, jkt TEXT NOT NULL, label TEXT NOT NULL,
        created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS removed (jkt TEXT PRIMARY KEY, removed_at TEXT NOT NULL);
    `);
    const saved = this.db.prepare("SELECT value FROM meta WHERE key = 'environment'").get() as { value: string } | undefined;
    // 16 random bytes, base64url: the 22 characters the phones expect.
    this.environmentId = saved?.value ?? token(16);
    if (!saved) this.db.prepare("INSERT INTO meta (key, value) VALUES ('environment', ?)").run(this.environmentId);
  }

  /** The port phones were given, so a saved address keeps working after a restart. */
  get port(): number {
    return Number((this.db.prepare("SELECT value FROM meta WHERE key = 'port'").get() as { value: string } | undefined)?.value ?? 0);
  }

  set port(value: number) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('port', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(value));
  }

  /** A new one-time pairing secret, replacing any earlier one. 32 random bytes; good for ten minutes. */
  startPairing(now = Date.now()): { secret: string; expiresAt: number } {
    this.pairing = { secret: token(32), expiresAt: now + PAIRING_MINUTES * 60_000 };
    return this.pairing;
  }

  get pairingOpen(): boolean {
    return !!this.pairing && this.pairing.expiresAt > Date.now();
  }

  /** Spends the pairing secret for a session bound to `jkt`. Null when the secret is wrong, used or expired. */
  pair(secret: string, jkt: string, label: string, now = Date.now()): Grant | null {
    const open = this.pairing;
    if (!open || open.expiresAt <= now) return null;
    const a = Buffer.from(secret), b = Buffer.from(open.secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    this.pairing = null;
    // Scanning a code here is the athlete's say-so: a phone removed earlier may use the relay again.
    this.db.prepare("DELETE FROM removed WHERE jkt = ?").run(jkt);
    return this.issue(jkt, label, now);
  }

  /** Whether the athlete removed the phone with key `jkt` here: it comes back only by scanning a new code. */
  isRemoved(jkt: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM removed WHERE jkt = ?").get(jkt);
  }

  /** A one-time credential for the phone key `jkt`, for the relay to hand that phone (cloud/mint.ts). Null for a phone removed here. */
  mintCredential(jkt: string, now = Date.now()): { credential: string; expiresAt: number } | null {
    if (this.isRemoved(jkt)) return null;
    for (const [hash, c] of this.credentials) if (c.expiresAt <= now) this.credentials.delete(hash);
    const credential = token(32), expiresAt = now + BOOTSTRAP_MS;
    this.credentials.set(hashOf(credential), { jkt, expiresAt });
    return { credential, expiresAt };
  }

  /** Spends a relay-brokered credential for a session, if it is for this key and still good. */
  bootstrap(credential: string, jkt: string, label: string, now = Date.now()): Grant | null {
    const hash = hashOf(credential), found = this.credentials.get(hash);
    if (!found) return null;
    this.credentials.delete(hash);
    if (found.expiresAt <= now || found.jkt !== jkt || this.isRemoved(jkt)) return null;
    return this.issue(jkt, label, now);
  }

  private issue(jkt: string, label: string, now: number): Grant {
    const sessionToken = token(32), at = new Date(now).toISOString(), expiresAt = new Date(now + days(SESSION_DAYS)).toISOString();
    const clean = label.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "Phone";
    // The same phone pairing again (same key): its earlier session goes, so it's listed once.
    for (const old of this.db.prepare("SELECT id FROM phones WHERE jkt = ?").all(jkt) as { id: string }[]) this.onEnded(old.id);
    this.db.prepare("DELETE FROM phones WHERE jkt = ?").run(jkt);
    this.db.prepare("INSERT INTO phones (id, token_hash, jkt, label, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(token(9), hashOf(sessionToken), jkt, clean, at, at, expiresAt);
    return { sessionToken, expiresAt, permissions: PHONE_PERMISSIONS };
  }

  /** The session a token names, if it is still good; each use extends it to 90 days from now. */
  use(sessionToken: string, now = Date.now()): PhoneSession | null {
    const row = this.db.prepare("SELECT * FROM phones WHERE token_hash = ?").get(hashOf(sessionToken)) as Record<string, string> | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= now) {
      this.db.prepare("DELETE FROM phones WHERE id = ?").run(row.id);
      return null;
    }
    const at = new Date(now).toISOString(), expiresAt = new Date(now + days(SESSION_DAYS)).toISOString();
    this.db.prepare("UPDATE phones SET last_used_at = ?, expires_at = ? WHERE id = ?").run(at, expiresAt, row.id);
    return { id: row.id, jkt: row.jkt, label: row.label, createdAt: row.created_at, lastUsedAt: at, expiresAt };
  }

  list(): PhoneSession[] {
    return (this.db.prepare("SELECT * FROM phones ORDER BY created_at").all() as Record<string, string>[]).map((r) => ({
      id: r.id, jkt: r.jkt, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at,
    }));
  }

  /** Removes a phone. It can't sign in again through the relay until it scans a new code here. */
  remove(id: string, now = Date.now()): boolean {
    const row = this.db.prepare("SELECT jkt FROM phones WHERE id = ?").get(id) as { jkt: string } | undefined;
    if (!row) return false;
    this.db.prepare("DELETE FROM phones WHERE id = ?").run(id);
    this.db.prepare("INSERT INTO removed (jkt, removed_at) VALUES (?, ?) ON CONFLICT(jkt) DO UPDATE SET removed_at = excluded.removed_at").run(row.jkt, new Date(now).toISOString());
    for (const [hash, c] of this.credentials) if (c.jkt === row.jkt) this.credentials.delete(hash);
    this.onEnded(id);
    return true;
  }

  /** Ends the session a token names (the phone's own sign-out). */
  end(sessionToken: string): void {
    const row = this.db.prepare("SELECT id FROM phones WHERE token_hash = ?").get(hashOf(sessionToken)) as { id: string } | undefined;
    if (!row) return;
    this.db.prepare("DELETE FROM phones WHERE id = ?").run(row.id);
    this.onEnded(row.id);
  }
}
