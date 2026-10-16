import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { requireDatabase } from "../database";
import {
  BOOTSTRAP_CREDENTIAL_TTL_MS,
  COACH_PERMISSIONS,
  DEFAULT_GRANT_PERMISSIONS,
  DPOP_MAX_SKEW_SECONDS,
  PAIRING_SECRET_TTL_MS,
  SESSION_IDLE_TTL_MS,
  WS_TICKET_TTL_MS,
  narrowPermissions,
  type CoachPermission,
  type EnvironmentGrant,
  type RemoteDevice,
  type RemoteHttpErrorBody,
  type RemoteHttpErrorCode,
  type WebSocketTicket
} from "./contract";

/**
 * Who may use this computer's Coach remotely, and how they prove it.
 *
 * - A pairing secret (from the QR code) or a relay-minted bootstrap credential
 *   is spent once for a session token bound to the device's DPoP key.
 * - Every authenticated request carries that token as `Authorization: DPoP`
 *   plus a fresh proof signed by the same key, so a token copied off the
 *   (plain HTTP) LAN is useless on its own.
 * - The WebSocket opens with a 30-second single-use ticket instead of the token.
 *
 * Secrets, credentials and tokens are stored only as SHA-256 hashes.
 */

export class RemoteAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: RemoteHttpErrorCode,
    message: string,
    readonly requiredPermission?: CoachPermission
  ) {
    super(message);
    this.name = "RemoteAuthError";
  }

  toBody(): RemoteHttpErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.requiredPermission ? { requiredPermission: this.requiredPermission } : {})
      }
    };
  }
}

// jose is ESM-only; the main process is CommonJS, so it loads on first use.
const importJose = () => import("jose");
type Jose = Awaited<ReturnType<typeof importJose>>;
let josePromise: Promise<Jose> | undefined;
export function loadJose(): Promise<Jose> {
  josePromise ??= importJose();
  return josePromise;
}

export function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("base64url");
}

function randomToken(prefix = ""): string {
  return `${prefix}${crypto.randomBytes(32).toString("base64url")}`;
}

function timingSafeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A device's own name for itself, as the Remote access panel shows it. */
export function sanitizeDeviceLabel(label: unknown, fallback = "iPhone"): string {
  if (typeof label !== "string") return fallback;
  const clean = label.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return clean || fallback;
}

// ----- DPoP (RFC 9449) -----

/** The request URI as `htu` names it: scheme, host and path, no query or fragment. */
export function normalizeHtu(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Seen proof IDs, kept until their proofs could no longer pass the iat check. */
export class ReplayCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly limit = 10_000) {}

  /** Records `key` until `expiresAt`; false if it was already recorded. */
  remember(key: string, expiresAt: number, now: number): boolean {
    const existing = this.seen.get(key);
    if (existing !== undefined && existing > now) return false;
    if (this.seen.size >= this.limit) {
      for (const [candidate, expiry] of this.seen) {
        if (expiry <= now) this.seen.delete(candidate);
      }
      // Still full: forget the oldest, which expire first.
      for (const candidate of this.seen.keys()) {
        if (this.seen.size < this.limit) break;
        this.seen.delete(candidate);
      }
    }
    this.seen.set(key, expiresAt);
    return true;
  }
}

export interface DpopRequest {
  /** The `DPoP` header as Node gives it. */
  proof: string | string[] | undefined;
  method: string;
  /** The request URI this server answered on (normalizeHtu applies). */
  url: string;
  /** The session token the request carries, if any; then `ath` is required. */
  accessToken?: string;
  /** Epoch ms. */
  now: number;
  /** Tests that replay a recorded proof skip the ±60 s window. */
  ignoreIssuedAt?: boolean;
}

export interface VerifiedDpop {
  /** RFC 7638 SHA-256 thumbprint of the proof's key. */
  jkt: string;
  jti: string;
  iat: number;
}

function invalidProof(message: string): RemoteAuthError {
  return new RemoteAuthError(400, "invalid_dpop_proof", message);
}

const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Checks one DPoP proof: an ES256 JWT of type dpop+jwt carrying its public
 * key, naming this request's method and URI, issued within ±60 s, with `ath`
 * when a token is sent, and never seen before. Any failure refuses the
 * request; nothing falls back to a bearer token.
 */
export async function verifyDpopProof(request: DpopRequest, replay?: ReplayCache): Promise<VerifiedDpop> {
  const proof = request.proof;
  if (typeof proof !== "string" || !proof) throw invalidProof("This request needs a DPoP proof.");
  // Node joins repeated headers with ", "; a JWS never contains either.
  if (proof.length > 4096 || !COMPACT_JWS.test(proof)) throw invalidProof("Send exactly one well-formed DPoP proof.");
  const jose = await loadJose();
  let header: ReturnType<Jose["decodeProtectedHeader"]>;
  try {
    header = jose.decodeProtectedHeader(proof);
  } catch {
    throw invalidProof("The DPoP proof couldn't be read.");
  }
  const jwk = header.jwk as Record<string, unknown> | undefined;
  if (header.typ !== "dpop+jwt" || header.alg !== "ES256") {
    throw invalidProof("DPoP proofs must be ES256 JWTs of type dpop+jwt.");
  }
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || "d" in jwk) {
    throw invalidProof("The DPoP proof must carry a public P-256 key.");
  }
  let payload: Record<string, unknown>;
  try {
    const verified = await jose.jwtVerify(proof, jose.EmbeddedJWK, {
      algorithms: ["ES256"],
      typ: "dpop+jwt",
      currentDate: new Date(request.now)
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    throw invalidProof("The DPoP proof's signature didn't verify.");
  }
  const { htm, htu, iat, jti, ath } = payload;
  if (typeof htm !== "string" || htm !== request.method.toUpperCase()) {
    throw invalidProof("The DPoP proof was made for another HTTP method.");
  }
  const expected = normalizeHtu(request.url);
  if (typeof htu !== "string" || !expected || normalizeHtu(htu) !== expected) {
    throw invalidProof("The DPoP proof was made for another address.");
  }
  if (typeof jti !== "string" || jti.length < 1 || jti.length > 256) {
    throw invalidProof("The DPoP proof needs a jti.");
  }
  if (typeof iat !== "number" || !Number.isFinite(iat)) throw invalidProof("The DPoP proof needs an iat.");
  const nowSeconds = Math.floor(request.now / 1000);
  if (!request.ignoreIssuedAt && Math.abs(nowSeconds - iat) > DPOP_MAX_SKEW_SECONDS) {
    throw invalidProof("Your device's clock and this computer's are more than a minute apart. Set both to set the time automatically.");
  }
  if (request.accessToken !== undefined) {
    if (typeof ath !== "string" || !timingSafeEqualText(ath, sha256Base64Url(request.accessToken))) {
      throw invalidProof("The DPoP proof doesn't match the session token it was sent with.");
    }
  }
  const jkt = await jose.calculateJwkThumbprint(
    { kty: "EC", crv: "P-256", x: jwk.x as string, y: jwk.y as string },
    "sha256"
  );
  if (replay) {
    const window = (DPOP_MAX_SKEW_SECONDS * 2 + 5) * 1000;
    if (!replay.remember(`${jkt}.${jti}`, Math.max(request.now, iat * 1000) + window, request.now)) {
      throw invalidProof("This DPoP proof was already used.");
    }
  }
  return { jkt, jti, iat };
}

// ----- Sessions -----

export interface RemoteSessionRecord {
  id: string;
  label: string;
  jkt: string;
  permissions: CoachPermission[];
  via: "pair" | "bootstrap";
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
}

interface SessionRow {
  id: string;
  token_hash: string;
  label: string;
  jkt: string;
  scopes: string;
  via: "pair" | "bootstrap";
  created_at: number;
  last_used_at: number | null;
  expires_at: number;
  revoked_at: number | null;
}

interface GrantRow {
  id: string;
  kind: "pair" | "bootstrap";
  secret_hash: string;
  scopes: string;
  jkt: string | null;
  nonce: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

function parseScopes(value: string): CoachPermission[] {
  const listed = value.split(" ");
  return COACH_PERMISSIONS.filter((permission) => listed.includes(permission));
}

function toRecord(row: SessionRow): RemoteSessionRecord {
  return {
    id: row.id,
    label: row.label,
    jkt: row.jkt,
    permissions: parseScopes(row.scopes),
    via: row.via,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at
  };
}

export function remoteDeviceFromRecord(record: RemoteSessionRecord, connected: boolean): RemoteDevice {
  return {
    id: record.id,
    label: record.label,
    permissions: record.permissions,
    via: record.via,
    createdAt: new Date(record.createdAt).toISOString(),
    lastUsedAt: record.lastUsedAt === null ? null : new Date(record.lastUsedAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    connected
  };
}

const TOKEN_PATTERN = /^rcs_[A-Za-z0-9_-]{43}$/;
const TICKET_PATTERN = /^wst_[A-Za-z0-9_-]{43}$/;
const CREDENTIAL_PATTERN = /^rcb_[A-Za-z0-9_-]{43}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const JKT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Writing last-used on every request would hit the disk per keystroke; once a minute is plenty. */
const TOUCH_INTERVAL_MS = 60_000;
const MAX_TICKETS_PER_SESSION = 16;

export interface RemoteAuthOptions {
  database?: () => Database.Database;
  now?: () => number;
}

export type RemoteAuthChange =
  | { kind: "paired"; session: RemoteSessionRecord }
  | { kind: "revoked"; sessionId: string }
  | { kind: "pairing" };

export class RemoteAuth {
  private readonly database: () => Database.Database;
  private readonly now: () => number;
  private readonly replay = new ReplayCache();
  private readonly tickets = new Map<string, { sessionId: string; expiresAt: number }>();
  private readonly listeners = new Set<(change: RemoteAuthChange) => void>();

  constructor(options: RemoteAuthOptions = {}) {
    this.database = options.database ?? requireDatabase;
    this.now = options.now ?? Date.now;
  }

  onChange(listener: (change: RemoteAuthChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: RemoteAuthChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.warn("[remote] auth listener failed:", error);
      }
    }
  }

  // ----- Proofs -----

  /** verifyDpopProof with this server's replay cache and clock. */
  verifyProof(request: Omit<DpopRequest, "now"> & { now?: number }): Promise<VerifiedDpop> {
    return verifyDpopProof({ ...request, now: request.now ?? this.now() }, this.replay);
  }

  // ----- Pairing codes -----

  /**
   * A one-time pairing secret, valid 10 minutes. One code at a time: an
   * unused earlier code stops working. `access:write` is never granted.
   */
  createPairing(permissions: readonly CoachPermission[] = DEFAULT_GRANT_PERMISSIONS): {
    id: string;
    secret: string;
    createdAt: number;
    expiresAt: number;
    permissions: CoachPermission[];
  } {
    const scopes = narrowPermissions(DEFAULT_GRANT_PERMISSIONS, permissions);
    if (!scopes.includes("coach:read")) scopes.unshift("coach:read");
    const secret = crypto.randomBytes(32).toString("base64url");
    const id = crypto.randomUUID();
    const createdAt = this.now();
    const expiresAt = createdAt + PAIRING_SECRET_TTL_MS;
    const db = this.database();
    db.transaction(() => {
      db.prepare("DELETE FROM remote_pairing_grants WHERE kind = 'pair' AND used_at IS NULL").run();
      db.prepare(
        `INSERT INTO remote_pairing_grants (id, kind, secret_hash, scopes, jkt, nonce, created_at, expires_at, used_at)
         VALUES (?, 'pair', ?, ?, NULL, NULL, ?, ?, NULL)`
      ).run(id, sha256Base64Url(secret), scopes.join(" "), createdAt, expiresAt);
    })();
    this.notify({ kind: "pairing" });
    return { id, secret, createdAt, expiresAt, permissions: scopes };
  }

  cancelPairing(id?: string): void {
    const db = this.database();
    const result = id
      ? db.prepare("DELETE FROM remote_pairing_grants WHERE id = ? AND kind = 'pair' AND used_at IS NULL").run(id)
      : db.prepare("DELETE FROM remote_pairing_grants WHERE kind = 'pair' AND used_at IS NULL").run();
    if (result.changes > 0) this.notify({ kind: "pairing" });
  }

  /** The pairing code waiting to be scanned, if any. */
  pendingPairing(): { id: string; expiresAt: number } | null {
    const row = this.database()
      .prepare(
        `SELECT id, expires_at FROM remote_pairing_grants
         WHERE kind = 'pair' AND used_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(this.now()) as { id: string; expires_at: number } | undefined;
    return row ? { id: row.id, expiresAt: row.expires_at } : null;
  }

  /** Spends a pairing secret for a session bound to `jkt`. */
  redeemPairing(input: { secret: unknown; label: unknown; jkt: string; permissions?: unknown }): {
    grant: EnvironmentGrant;
    session: RemoteSessionRecord;
  } {
    const expired = new RemoteAuthError(401, "invalid_grant", "This code has expired or was already used. In CorosLink, show a new one.");
    if (typeof input.secret !== "string" || !SECRET_PATTERN.test(input.secret)) throw expired;
    return this.spendGrant("pair", sha256Base64Url(input.secret), input.jkt, input.label, input.permissions, expired);
  }

  // ----- Relay bootstrap credentials -----

  /**
   * A one-time credential for the phone key `jkt`, minted for a relay request
   * carrying `nonce`. A nonce is accepted once, ever.
   */
  mintBootstrap(input: { jkt: string; nonce: string; permissions?: readonly CoachPermission[] }): {
    credential: string;
    expiresAt: number;
  } {
    if (!JKT_PATTERN.test(input.jkt)) throw new RemoteAuthError(400, "invalid_request", "The mint request names an invalid key.");
    const credential = randomToken("rcb_");
    const now = this.now();
    // Whole seconds, so the proof's exp is exactly floor(expiresAt / 1000).
    const expiresAt = Math.floor((now + BOOTSTRAP_CREDENTIAL_TTL_MS) / 1000) * 1000;
    const scopes = narrowPermissions(DEFAULT_GRANT_PERMISSIONS, input.permissions ?? DEFAULT_GRANT_PERMISSIONS);
    try {
      this.database()
        .prepare(
          `INSERT INTO remote_pairing_grants (id, kind, secret_hash, scopes, jkt, nonce, created_at, expires_at, used_at)
           VALUES (?, 'bootstrap', ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(crypto.randomUUID(), sha256Base64Url(credential), scopes.join(" "), input.jkt, input.nonce, now, expiresAt);
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new RemoteAuthError(401, "replayed", "This mint request was already used.");
      }
      throw error;
    }
    return { credential, expiresAt };
  }

  /** Spends a relay-minted credential; only the key it was minted for can. */
  redeemBootstrap(input: { credential: unknown; label?: unknown; jkt: string; permissions?: unknown }): {
    grant: EnvironmentGrant;
    session: RemoteSessionRecord;
  } {
    const expired = new RemoteAuthError(401, "invalid_grant", "This sign-in link has expired or was already used. Try connecting again.");
    if (typeof input.credential !== "string" || !CREDENTIAL_PATTERN.test(input.credential)) throw expired;
    return this.spendGrant(
      "bootstrap",
      sha256Base64Url(input.credential),
      input.jkt,
      input.label ?? "iPhone",
      input.permissions,
      expired
    );
  }

  private spendGrant(
    kind: "pair" | "bootstrap",
    secretHash: string,
    jkt: string,
    label: unknown,
    requested: unknown,
    expired: RemoteAuthError
  ): { grant: EnvironmentGrant; session: RemoteSessionRecord } {
    if (requested !== undefined && !Array.isArray(requested)) {
      throw new RemoteAuthError(400, "invalid_request", "permissions must be a list.");
    }
    const db = this.database();
    const now = this.now();
    const token = randomToken("rcs_");
    const created = db.transaction(() => {
      const row = db
        .prepare("SELECT * FROM remote_pairing_grants WHERE secret_hash = ? AND kind = ?")
        .get(secretHash, kind) as GrantRow | undefined;
      if (!row || row.used_at !== null || row.expires_at <= now) throw expired;
      // A credential tried with the wrong key stays usable for the right one.
      if (kind === "bootstrap" && (!row.jkt || !timingSafeEqualText(row.jkt, jkt))) throw expired;
      const permissions = narrowPermissions(parseScopes(row.scopes), requested as unknown[] | undefined);
      if (!permissions.length) {
        throw new RemoteAuthError(400, "invalid_request", "Ask for at least one permission this code grants.");
      }
      const spent = db
        .prepare("UPDATE remote_pairing_grants SET used_at = ? WHERE id = ? AND used_at IS NULL")
        .run(now, row.id);
      if (spent.changes !== 1) throw expired;
      const record: RemoteSessionRecord = {
        id: crypto.randomUUID(),
        label: sanitizeDeviceLabel(label),
        jkt,
        permissions,
        via: kind,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: now + SESSION_IDLE_TTL_MS
      };
      db.prepare(
        `INSERT INTO remote_sessions (id, token_hash, label, jkt, scopes, via, created_at, last_used_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        record.id,
        sha256Base64Url(token),
        record.label,
        record.jkt,
        record.permissions.join(" "),
        record.via,
        record.createdAt,
        record.lastUsedAt,
        record.expiresAt
      );
      return record;
    })();
    this.notify({ kind: "paired", session: created });
    if (kind === "pair") this.notify({ kind: "pairing" });
    return {
      grant: {
        sessionToken: token,
        expiresAt: new Date(created.expiresAt).toISOString(),
        permissions: created.permissions
      },
      session: created
    };
  }

  // ----- Session tokens -----

  /**
   * The live session for `token`, presented with a proof from key `jkt`.
   * Revoked, expired, unknown, or bound to another key: 401. Missing
   * `permission`: 403. Each use pushes the idle expiry out again.
   */
  authenticate(input: { token: string; jkt: string; permission?: CoachPermission }): RemoteSessionRecord {
    const unauthorized = new RemoteAuthError(401, "invalid_token", "This device's session has ended. Pair it again.");
    if (!TOKEN_PATTERN.test(input.token)) throw unauthorized;
    const row = this.database()
      .prepare("SELECT * FROM remote_sessions WHERE token_hash = ?")
      .get(sha256Base64Url(input.token)) as SessionRow | undefined;
    const now = this.now();
    if (!row || row.revoked_at !== null || row.expires_at <= now) throw unauthorized;
    if (!timingSafeEqualText(row.jkt, input.jkt)) throw unauthorized;
    const record = this.touch(toRecord(row), now);
    if (input.permission && !record.permissions.includes(input.permission)) {
      throw new RemoteAuthError(403, "forbidden", "This device doesn't have permission for that.", input.permission);
    }
    return record;
  }

  private touch(record: RemoteSessionRecord, now: number): RemoteSessionRecord {
    if (record.lastUsedAt !== null && now - record.lastUsedAt < TOUCH_INTERVAL_MS) return record;
    const expiresAt = now + SESSION_IDLE_TTL_MS;
    this.database()
      .prepare("UPDATE remote_sessions SET last_used_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now, expiresAt, record.id);
    return { ...record, lastUsedAt: now, expiresAt };
  }

  /** The session if it's still live (not revoked, not expired). */
  session(sessionId: string): RemoteSessionRecord | null {
    const row = this.database().prepare("SELECT * FROM remote_sessions WHERE id = ?").get(sessionId) as
      | SessionRow
      | undefined;
    if (!row || row.revoked_at !== null || row.expires_at <= this.now()) return null;
    return toRecord(row);
  }

  /** Marks an open WebSocket's session as used, at most once a minute. */
  touchSession(sessionId: string): void {
    const record = this.session(sessionId);
    if (record) this.touch(record, this.now());
  }

  listSessions(): RemoteSessionRecord[] {
    const rows = this.database()
      .prepare(
        `SELECT * FROM remote_sessions WHERE revoked_at IS NULL AND expires_at > ?
         ORDER BY COALESCE(last_used_at, created_at) DESC`
      )
      .all(this.now()) as SessionRow[];
    return rows.map(toRecord);
  }

  /** Ends a session; its sockets are closed by whoever listens for `revoked`. */
  revokeSession(sessionId: string): boolean {
    const result = this.database()
      .prepare("UPDATE remote_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(this.now(), sessionId);
    for (const [ticket, entry] of this.tickets) {
      if (entry.sessionId === sessionId) this.tickets.delete(ticket);
    }
    if (result.changes > 0) this.notify({ kind: "revoked", sessionId });
    return result.changes > 0;
  }

  // ----- WebSocket tickets -----

  issueTicket(session: RemoteSessionRecord): WebSocketTicket {
    const now = this.now();
    let outstanding = 0;
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt <= now) this.tickets.delete(ticket);
      else if (entry.sessionId === session.id) outstanding += 1;
    }
    if (outstanding >= MAX_TICKETS_PER_SESSION) {
      throw new RemoteAuthError(429, "rate_limited", "Too many connection attempts. Wait a minute, then try again.");
    }
    const ticket = randomToken("wst_");
    const expiresAt = now + WS_TICKET_TTL_MS;
    this.tickets.set(sha256Base64Url(ticket), { sessionId: session.id, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Spends a ticket: the session it was issued to, if both are still good. */
  redeemTicket(ticket: unknown): RemoteSessionRecord | null {
    if (typeof ticket !== "string" || !TICKET_PATTERN.test(ticket)) return null;
    const key = sha256Base64Url(ticket);
    const entry = this.tickets.get(key);
    if (!entry) return null;
    this.tickets.delete(key);
    if (entry.expiresAt <= this.now()) return null;
    return this.session(entry.sessionId);
  }

  // ----- Housekeeping -----

  /** Forgets spent or expired codes, and sessions that ended a month ago. */
  prune(): void {
    const now = this.now();
    const db = this.database();
    db.prepare("DELETE FROM remote_pairing_grants WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at <= ?)").run(
      now - 24 * 60 * 60_000,
      now - 24 * 60 * 60_000
    );
    db.prepare(
      "DELETE FROM remote_sessions WHERE (revoked_at IS NOT NULL AND revoked_at <= ?) OR expires_at <= ?"
    ).run(now - 30 * 24 * 60 * 60_000, now - 30 * 24 * 60 * 60_000);
  }
}
