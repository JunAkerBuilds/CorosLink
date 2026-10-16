import { RelayError } from "../http";

/**
 * Records a one-time value (environment nonce, DPoP jti). Refuses it if the
 * same scope already used it. Rows expire after `ttlMs` and the cron purges them.
 */
export async function consumeOnce(
  db: D1Database,
  input: { scope: string; value: string; now: number; ttlMs: number },
): Promise<void> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO nonces (scope, value, expires_at) VALUES (?, ?, ?)")
    .bind(input.scope, input.value, input.now + input.ttlMs)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new RelayError("signature_replayed", "This signature was already used.");
  }
}

export async function purgeExpiredNonces(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare("DELETE FROM nonces WHERE expires_at < ?").bind(now).run();
  return result.meta.changes ?? 0;
}
