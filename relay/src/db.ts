import { RelayError } from "./http";
import type { EnvironmentPlatform } from "./protocol";

export interface LinkRow {
  user_id: string;
  environment_id: string;
  env_public_jwk: string;
  env_key_jkt: string;
  label: string;
  platform: EnvironmentPlatform;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
}

export type AllocationStatus = "provisioning" | "ready" | "reaping" | "deprovisioning" | "released";

export interface AllocationRow {
  user_id: string;
  environment_id: string;
  env_key_jkt: string;
  hostname: string;
  tunnel_name: string;
  status: AllocationStatus;
  generation: number;
  tunnel_id: string | null;
  configured_tunnel_id: string | null;
  origin_port: number | null;
  dns_record_id: string | null;
  dns_tunnel_id: string | null;
  ready_at: number | null;
  recovery_registered_at: number | null;
  last_recovery_at: number | null;
  claimed_at: number | null;
  tunnel_released_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface LinkKey {
  userId: string;
  environmentId: string;
}

/** An allocation belongs to a link and the environment key it was made with. */
export interface AllocationKey extends LinkKey {
  kid: string;
}

export function allocationKeyOf(row: Pick<AllocationRow, "user_id" | "environment_id" | "env_key_jkt">): AllocationKey {
  return { userId: row.user_id, environmentId: row.environment_id, kid: row.env_key_jkt };
}

// --- links ------------------------------------------------------------------

export async function getLink(db: D1Database, key: LinkKey): Promise<LinkRow | null> {
  return db
    .prepare("SELECT * FROM environment_links WHERE user_id = ? AND environment_id = ?")
    .bind(key.userId, key.environmentId)
    .first<LinkRow>();
}

export async function getActiveLink(db: D1Database, key: LinkKey): Promise<LinkRow | null> {
  return db
    .prepare("SELECT * FROM environment_links WHERE user_id = ? AND environment_id = ? AND revoked_at IS NULL")
    .bind(key.userId, key.environmentId)
    .first<LinkRow>();
}

/** The one active link that holds this environment key, if any. */
export async function getActiveLinkByKey(db: D1Database, environmentId: string, kid: string): Promise<LinkRow | null> {
  return db
    .prepare("SELECT * FROM environment_links WHERE environment_id = ? AND env_key_jkt = ? AND revoked_at IS NULL")
    .bind(environmentId, kid)
    .first<LinkRow>();
}

export async function listActiveLinks(db: D1Database, userId: string, limit = 50): Promise<LinkRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM environment_links WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at LIMIT ?")
    .bind(userId, limit)
    .all<LinkRow>();
  return results;
}

/**
 * Activates the link for (user, environment) with this key. The same key
 * active under another account is revoked in the same transaction: the
 * desktop switched accounts. Returns the keys of the links it revoked.
 */
export async function activateLink(
  db: D1Database,
  input: LinkKey & { publicJwk: string; kid: string; label: string; platform: EnvironmentPlatform; now: number },
): Promise<LinkKey[]> {
  const { results: superseded } = await db
    .prepare(
      "SELECT user_id, environment_id FROM environment_links WHERE environment_id = ? AND env_key_jkt = ? AND user_id != ? AND revoked_at IS NULL",
    )
    .bind(input.environmentId, input.kid, input.userId)
    .all<{ user_id: string; environment_id: string }>();
  const statements = [
    db
      .prepare(
        "UPDATE environment_links SET revoked_at = ?, updated_at = ? WHERE environment_id = ? AND env_key_jkt = ? AND user_id != ? AND revoked_at IS NULL",
      )
      .bind(input.now, input.now, input.environmentId, input.kid, input.userId),
    db
      .prepare(
        `INSERT INTO environment_links (user_id, environment_id, env_public_jwk, env_key_jkt, label, platform, created_at, updated_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (user_id, environment_id) DO UPDATE SET
           env_public_jwk = excluded.env_public_jwk,
           env_key_jkt = excluded.env_key_jkt,
           label = excluded.label,
           platform = excluded.platform,
           updated_at = excluded.updated_at,
           revoked_at = NULL`,
      )
      .bind(
        input.userId,
        input.environmentId,
        input.publicJwk,
        input.kid,
        input.label,
        input.platform,
        input.now,
        input.now,
      ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/u.test(error.message)) {
      throw new RelayError("allocation_conflict", "This computer is being linked by another request. Retry.");
    }
    throw error;
  }
  return superseded.map((row) => ({ userId: row.user_id, environmentId: row.environment_id }));
}

/** Commits the revocation. Returns false when the link was not active. */
export async function revokeLink(db: D1Database, key: LinkKey, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE environment_links SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND environment_id = ? AND revoked_at IS NULL",
    )
    .bind(now, now, key.userId, key.environmentId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

// --- allocations --------------------------------------------------------------

export async function getAllocation(db: D1Database, key: AllocationKey): Promise<AllocationRow | null> {
  return db
    .prepare("SELECT * FROM allocations WHERE user_id = ? AND environment_id = ? AND env_key_jkt = ?")
    .bind(key.userId, key.environmentId, key.kid)
    .first<AllocationRow>();
}

/** Every allocation of a user/environment pair, whatever key it was made with. */
export async function listAllocationsForLink(db: D1Database, key: LinkKey): Promise<AllocationRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM allocations WHERE user_id = ? AND environment_id = ?")
    .bind(key.userId, key.environmentId)
    .all<AllocationRow>();
  return results;
}

/** Creates the allocation once; the hostname and tunnel name never change afterwards. */
export async function reserveAllocation(
  db: D1Database,
  input: AllocationKey & { hostname: string; tunnelName: string; now: number },
): Promise<AllocationRow> {
  await db
    .prepare(
      `INSERT INTO allocations (user_id, environment_id, env_key_jkt, hostname, tunnel_name, status, generation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'provisioning', 0, ?, ?)
       ON CONFLICT (user_id, environment_id, env_key_jkt) DO NOTHING`,
    )
    .bind(input.userId, input.environmentId, input.kid, input.hostname, input.tunnelName, input.now, input.now)
    .run();
  const row = await getAllocation(db, input);
  if (!row) {
    throw new RelayError("internal_error", "The tunnel allocation could not be reserved.");
  }
  return row;
}

type AllocationFields = Partial<
  Pick<
    AllocationRow,
    | "status"
    | "tunnel_id"
    | "configured_tunnel_id"
    | "origin_port"
    | "dns_record_id"
    | "dns_tunnel_id"
    | "ready_at"
    | "recovery_registered_at"
    | "last_recovery_at"
    | "claimed_at"
    | "tunnel_released_at"
  >
>;

const ALLOCATION_COLUMNS = new Set<string>([
  "status",
  "tunnel_id",
  "configured_tunnel_id",
  "origin_port",
  "dns_record_id",
  "dns_tunnel_id",
  "ready_at",
  "recovery_registered_at",
  "last_recovery_at",
  "claimed_at",
  "tunnel_released_at",
]);

/**
 * Writes `fields` only if the row is still at `generation` (and, optionally,
 * still records `tunnelId`). Bumps the generation. Returns the new
 * generation, or null when another writer got there first.
 */
export async function updateAllocation(
  db: D1Database,
  key: AllocationKey,
  generation: number,
  fields: AllocationFields,
  now: number,
  conditions: { tunnelId?: string | null; statusIn?: AllocationStatus[] } = {},
): Promise<number | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (!ALLOCATION_COLUMNS.has(column)) throw new Error(`unknown allocation column ${column}`);
    assignments.push(`${column} = ?`);
    values.push(value ?? null);
  }
  assignments.push("generation = generation + 1", "updated_at = ?");
  values.push(now);
  let where = "user_id = ? AND environment_id = ? AND env_key_jkt = ? AND generation = ?";
  values.push(key.userId, key.environmentId, key.kid, generation);
  if (conditions.tunnelId === null) {
    where += " AND tunnel_id IS NULL";
  } else if (conditions.tunnelId !== undefined) {
    where += " AND tunnel_id = ?";
    values.push(conditions.tunnelId);
  }
  if (conditions.statusIn && conditions.statusIn.length > 0) {
    where += ` AND status IN (${conditions.statusIn.map(() => "?").join(", ")})`;
    values.push(...conditions.statusIn);
  }
  const result = await db
    .prepare(`UPDATE allocations SET ${assignments.join(", ")} WHERE ${where}`)
    .bind(...values)
    .run();
  return (result.meta.changes ?? 0) === 1 ? generation + 1 : null;
}

export type AllocationWithLinkState = AllocationRow & {
  /** 1 while the allocation's link is active with the same key; 0 once revoked or re-keyed. */
  link_active: number;
};

export async function listAllocationsByTunnelNames(db: D1Database, names: string[]): Promise<AllocationWithLinkState[]> {
  const rows: AllocationWithLinkState[] = [];
  // D1 caps bound parameters per statement at 100.
  for (let start = 0; start < names.length; start += 90) {
    const chunk = names.slice(start, start + 90);
    if (chunk.length === 0) continue;
    const { results } = await db
      .prepare(
        `SELECT a.*, CASE WHEN l.revoked_at IS NULL AND l.env_key_jkt = a.env_key_jkt THEN 1 ELSE 0 END AS link_active
         FROM allocations a
         JOIN environment_links l ON l.user_id = a.user_id AND l.environment_id = a.environment_id
         WHERE a.tunnel_name IN (${chunk.map(() => "?").join(", ")})`,
      )
      .bind(...chunk)
      .all<AllocationWithLinkState>();
    rows.push(...results);
  }
  return rows;
}

/** Allocations whose link was revoked or re-keyed but still hold Cloudflare resources. */
export async function listPendingTeardowns(db: D1Database, staleBefore: number, limit: number): Promise<AllocationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.* FROM allocations a
       JOIN environment_links l ON l.user_id = a.user_id AND l.environment_id = a.environment_id
       WHERE (l.revoked_at IS NOT NULL OR l.env_key_jkt != a.env_key_jkt)
         AND (a.tunnel_id IS NOT NULL OR a.dns_record_id IS NOT NULL)
         AND (a.status NOT IN ('reaping', 'deprovisioning') OR a.claimed_at IS NULL OR a.claimed_at < ?)
       ORDER BY a.updated_at
       LIMIT ?`,
    )
    .bind(staleBefore, limit)
    .all<AllocationRow>();
  return results;
}

// --- tunnel status cache --------------------------------------------------------

export async function getCachedTunnelStatus(
  db: D1Database,
  tunnelId: string,
): Promise<{ status: string; checked_at: number } | null> {
  return db
    .prepare("SELECT status, checked_at FROM tunnel_status_cache WHERE tunnel_id = ?")
    .bind(tunnelId)
    .first<{ status: string; checked_at: number }>();
}

export async function putCachedTunnelStatus(db: D1Database, tunnelId: string, status: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tunnel_status_cache (tunnel_id, status, checked_at) VALUES (?, ?, ?)
       ON CONFLICT (tunnel_id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at`,
    )
    .bind(tunnelId, status, now)
    .run();
}

export async function pruneTunnelStatusCache(db: D1Database, before: number): Promise<void> {
  await db.prepare("DELETE FROM tunnel_status_cache WHERE checked_at < ?").bind(before).run();
}

// --- push devices ---------------------------------------------------------------

export interface PushDeviceRow {
  token: string;
  user_id: string;
  apns_environment: "sandbox" | "production";
  created_at: number;
  updated_at: number;
  last_sent_at: number | null;
}

export const MAX_DEVICES_PER_USER = 20;

export async function registerPushDevice(
  db: D1Database,
  input: { token: string; userId: string; environment: "sandbox" | "production"; now: number },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO push_devices (token, user_id, apns_environment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (token) DO UPDATE SET
           user_id = excluded.user_id,
           apns_environment = excluded.apns_environment,
           updated_at = excluded.updated_at`,
      )
      .bind(input.token, input.userId, input.environment, input.now, input.now),
    // Keep the newest MAX_DEVICES_PER_USER registrations per user.
    db
      .prepare(
        `DELETE FROM push_devices WHERE user_id = ? AND token NOT IN (
           SELECT token FROM push_devices WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?
         )`,
      )
      .bind(input.userId, input.userId, MAX_DEVICES_PER_USER),
  ]);
}

export async function unregisterPushDevice(db: D1Database, userId: string, token: string): Promise<void> {
  await db.prepare("DELETE FROM push_devices WHERE token = ? AND user_id = ?").bind(token, userId).run();
}

export async function listPushDevices(db: D1Database, userId: string): Promise<PushDeviceRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM push_devices WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
    .bind(userId, MAX_DEVICES_PER_USER)
    .all<PushDeviceRow>();
  return results;
}

export async function deletePushDevice(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM push_devices WHERE token = ?").bind(token).run();
}

export async function markPushSent(db: D1Database, tokens: string[], now: number): Promise<void> {
  if (tokens.length === 0) return;
  await db.batch(tokens.map((token) => db.prepare("UPDATE push_devices SET last_sent_at = ? WHERE token = ?").bind(now, token)));
}

// --- live activities ----------------------------------------------------------------

export interface LiveActivityRow {
  token: string;
  user_id: string;
  environment_id: string;
  session_id: string;
  request_id: string;
  apns_environment: "sandbox" | "production";
  created_at: number;
  expires_at: number;
  last_phase: string | null;
  last_sent_at: number | null;
  last_high_priority_at: number | null;
  last_timestamp: number | null;
}

export interface LiveTurnKey {
  userId: string;
  environmentId: string;
  sessionId: string;
  requestId: string;
}

export interface LiveTurnEndRow {
  request_id: string;
  phase: string;
  words: number;
  ended_at: number;
}

/** An iPhone follows a few turns at a time; this caps what one account can register. */
export const MAX_LIVE_ACTIVITIES_PER_USER = 20;
/** How long the relay remembers how a turn ended, for activities that register late. */
export const LIVE_TURN_END_TTL_MS = 60 * 60 * 1000;

export async function registerLiveActivity(
  db: D1Database,
  input: LiveTurnKey & { token: string; environment: "sandbox" | "production"; now: number; expiresAt: number },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO live_activities
           (token, user_id, environment_id, session_id, request_id, apns_environment, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (token) DO UPDATE SET
           user_id = excluded.user_id,
           environment_id = excluded.environment_id,
           session_id = excluded.session_id,
           request_id = excluded.request_id,
           apns_environment = excluded.apns_environment,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at,
           last_phase = NULL,
           last_sent_at = NULL,
           last_high_priority_at = NULL`,
      )
      .bind(
        input.token,
        input.userId,
        input.environmentId,
        input.sessionId,
        input.requestId,
        input.environment,
        input.now,
        input.expiresAt,
      ),
    db
      .prepare(
        `DELETE FROM live_activities WHERE user_id = ? AND token NOT IN (
           SELECT token FROM live_activities WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
         )`,
      )
      .bind(input.userId, input.userId, MAX_LIVE_ACTIVITIES_PER_USER),
  ]);
}

export async function unregisterLiveActivity(db: D1Database, userId: string, token: string): Promise<void> {
  await db.prepare("DELETE FROM live_activities WHERE token = ? AND user_id = ?").bind(token, userId).run();
}

export async function deleteLiveActivity(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM live_activities WHERE token = ?").bind(token).run();
}

/** The unexpired activities following this turn. */
export async function listLiveActivities(db: D1Database, key: LiveTurnKey, now: number): Promise<LiveActivityRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM live_activities
       WHERE user_id = ? AND environment_id = ? AND session_id = ? AND request_id = ? AND expires_at > ?
       LIMIT ?`,
    )
    .bind(key.userId, key.environmentId, key.sessionId, key.requestId, now, MAX_LIVE_ACTIVITIES_PER_USER)
    .all<LiveActivityRow>();
  return results;
}

export async function markLiveActivitySent(
  db: D1Database,
  input: { token: string; phase: string; now: number; highPriority: boolean; timestamp: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE live_activities SET
         last_phase = ?,
         last_sent_at = ?,
         last_high_priority_at = CASE WHEN ? THEN ? ELSE last_high_priority_at END,
         last_timestamp = ?
       WHERE token = ?`,
    )
    .bind(input.phase, input.now, input.highPriority ? 1 : 0, input.now, input.timestamp, input.token)
    .run();
}

export async function recordLiveTurnEnd(
  db: D1Database,
  input: LiveTurnKey & { phase: string; words: number; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO live_turn_ends (user_id, environment_id, session_id, request_id, phase, words, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, environment_id, session_id) DO UPDATE SET
         request_id = excluded.request_id, phase = excluded.phase, words = excluded.words, ended_at = excluded.ended_at`,
    )
    .bind(input.userId, input.environmentId, input.sessionId, input.requestId, input.phase, input.words, input.now)
    .run();
}

/** How this turn ended, if it ended within LIVE_TURN_END_TTL_MS. */
export async function getLiveTurnEnd(db: D1Database, key: LiveTurnKey, now: number): Promise<LiveTurnEndRow | null> {
  return db
    .prepare(
      `SELECT request_id, phase, words, ended_at FROM live_turn_ends
       WHERE user_id = ? AND environment_id = ? AND session_id = ? AND request_id = ? AND ended_at > ?`,
    )
    .bind(key.userId, key.environmentId, key.sessionId, key.requestId, now - LIVE_TURN_END_TTL_MS)
    .first<LiveTurnEndRow>();
}

/** Drops expired registrations and old turn ends; returns how many rows went. */
export async function pruneLiveActivities(db: D1Database, now: number): Promise<number> {
  const [activities, ends] = await db.batch([
    db.prepare("DELETE FROM live_activities WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM live_turn_ends WHERE ended_at <= ?").bind(now - LIVE_TURN_END_TTL_MS),
  ]);
  return (activities?.meta.changes ?? 0) + (ends?.meta.changes ?? 0);
}

// --- APNs provider token ----------------------------------------------------------

export async function getStoredProviderToken(
  db: D1Database,
  keyId: string,
): Promise<{ team_id: string; token: string; issued_at: number } | null> {
  return db
    .prepare("SELECT team_id, token, issued_at FROM apns_provider_tokens WHERE key_id = ?")
    .bind(keyId)
    .first<{ team_id: string; token: string; issued_at: number }>();
}

/**
 * Stores a freshly minted token unless another isolate stored a newer one
 * than `replaceBefore`, then returns whichever token won.
 */
export async function storeProviderToken(
  db: D1Database,
  input: { keyId: string; teamId: string; token: string; issuedAt: number; replaceBefore: number },
): Promise<{ token: string; issued_at: number }> {
  await db
    .prepare(
      `INSERT INTO apns_provider_tokens (key_id, team_id, token, issued_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key_id) DO UPDATE SET team_id = excluded.team_id, token = excluded.token, issued_at = excluded.issued_at
       WHERE apns_provider_tokens.issued_at < ? OR apns_provider_tokens.team_id != excluded.team_id`,
    )
    .bind(input.keyId, input.teamId, input.token, input.issuedAt, input.replaceBefore)
    .run();
  const stored = await getStoredProviderToken(db, input.keyId);
  return stored ?? { token: input.token, issued_at: input.issuedAt };
}
