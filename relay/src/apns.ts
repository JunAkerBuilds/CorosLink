import type { ApnsConfig, Deps } from "./env";
import { importEs256Pkcs8 } from "./crypto";
import {
  deletePushDevice,
  getStoredProviderToken,
  markPushSent,
  storeProviderToken,
  type PushDeviceRow,
} from "./db";
import { log } from "./log";
import {
  ACTIVITY_ALERTS,
  base64UrlEncode,
  type ActivityEvent,
  type ActivityResponse,
  type CoachPushUserInfo,
} from "./protocol";

const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
/** Apple accepts a provider token for an hour and throttles refreshes under 20 minutes. */
export const PROVIDER_TOKEN_TTL_MS = 50 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;
const ALERT_EXPIRY_SECONDS = 60 * 60;

interface CachedProviderToken {
  token: string;
  issuedAt: number;
  keyId: string;
  teamId: string;
}

let providerTokenCache: CachedProviderToken | null = null;
let signingKeyCache: { pem: string; key: CryptoKey } | null = null;
/** One signing in flight at a time, so a fan-out to many devices shares a token. */
let inflight: Promise<CachedProviderToken> | null = null;

export function resetApnsCaches(): void {
  providerTokenCache = null;
  signingKeyCache = null;
  inflight = null;
}

const encoder = new TextEncoder();

/**
 * ES256 provider JWT `{alg, kid}.{iss, iat}` signed with WebCrypto and reused
 * for ~50 minutes by every isolate: it is cached in memory and in D1, because
 * Apple answers TooManyProviderTokenUpdates when tokens change too often.
 * `staleIssuedAt` forces a replacement for a token APNs called expired.
 */
export async function providerToken(
  config: ApnsConfig,
  db: D1Database,
  now: number,
  staleIssuedAt?: number,
): Promise<CachedProviderToken> {
  inflight ??= resolveProviderToken(config, db, now, staleIssuedAt).finally(() => {
    inflight = null;
  });
  return inflight;
}

function usable(
  candidate: { token: string; issuedAt: number; keyId: string; teamId: string } | null,
  config: ApnsConfig,
  now: number,
  staleIssuedAt: number | undefined,
): boolean {
  return (
    candidate !== null &&
    candidate.keyId === config.keyId &&
    candidate.teamId === config.teamId &&
    now - candidate.issuedAt < PROVIDER_TOKEN_TTL_MS &&
    (staleIssuedAt === undefined || candidate.issuedAt > staleIssuedAt)
  );
}

async function resolveProviderToken(
  config: ApnsConfig,
  db: D1Database,
  now: number,
  staleIssuedAt: number | undefined,
): Promise<CachedProviderToken> {
  if (usable(providerTokenCache, config, now, staleIssuedAt)) return providerTokenCache!;
  const stored = await getStoredProviderToken(db, config.keyId);
  const shared = stored
    ? { token: stored.token, issuedAt: stored.issued_at, keyId: config.keyId, teamId: stored.team_id }
    : null;
  if (usable(shared, config, now, staleIssuedAt)) {
    providerTokenCache = shared;
    return shared!;
  }
  if (!signingKeyCache || signingKeyCache.pem !== config.privateKey) {
    signingKeyCache = { pem: config.privateKey, key: await importEs256Pkcs8(config.privateKey) };
  }
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "ES256", kid: config.keyId })));
  const claims = base64UrlEncode(
    encoder.encode(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) })),
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto ECDSA signatures are raw r||s, which is exactly what JWS ES256 wants.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKeyCache.key,
    encoder.encode(signingInput),
  );
  // If another isolate stored a fresh token meanwhile, use theirs instead.
  const winner = await storeProviderToken(db, {
    keyId: config.keyId,
    teamId: config.teamId,
    token: `${signingInput}.${base64UrlEncode(signature)}`,
    issuedAt: now,
    replaceBefore: staleIssuedAt !== undefined ? staleIssuedAt + 1 : now - PROVIDER_TOKEN_TTL_MS,
  });
  providerTokenCache = { token: winner.token, issuedAt: winner.issued_at, keyId: config.keyId, teamId: config.teamId };
  return providerTokenCache;
}

export function coachAlertPayload(input: { environmentId: string; sessionId: string; event: ActivityEvent }) {
  const userInfo: CoachPushUserInfo = {
    kind: "coach",
    sessionId: input.sessionId,
    environmentId: input.environmentId,
    event: input.event,
  };
  return {
    aps: {
      alert: { title: "Coach", body: ACTIVITY_ALERTS[input.event] },
      sound: "default",
      "thread-id": `coach:${input.sessionId}`.slice(0, 64),
    },
    ...userInfo,
  };
}

/** Reasons that mean the token will never work again for this topic and environment. */
const DEAD_TOKEN_REASONS = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"]);
const PROVIDER_TOKEN_REASONS = new Set(["ExpiredProviderToken", "InvalidProviderToken"]);

interface SendOutcome {
  status: "sent" | "failed" | "removed";
}

async function sendOne(
  config: ApnsConfig,
  deps: Deps,
  db: D1Database,
  device: PushDeviceRow,
  body: string,
  staleIssuedAt?: number,
): Promise<SendOutcome> {
  const host = device.apns_environment === "production" ? PRODUCTION_HOST : SANDBOX_HOST;
  const provider = await providerToken(config, db, deps.now(), staleIssuedAt);
  let response: Response;
  try {
    response = await deps.fetch(`${host}/3/device/${device.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${provider.token}`,
        "apns-topic": config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(deps.now() / 1000) + ALERT_EXPIRY_SECONDS),
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return { status: "failed" };
  }
  if (response.status === 200) return { status: "sent" };
  let reason = "";
  try {
    reason = ((await response.json()) as { reason?: string }).reason ?? "";
  } catch {
    // APNs always sends a JSON reason; tolerate a missing one.
  }
  if (response.status === 410 || DEAD_TOKEN_REASONS.has(reason)) {
    await deletePushDevice(db, device.token);
    log("info", "apns_token_removed", { status: response.status, reason });
    return { status: "removed" };
  }
  if (response.status === 403 && PROVIDER_TOKEN_REASONS.has(reason) && staleIssuedAt === undefined) {
    // Retry once with a token newer than the one APNs refused.
    return sendOne(config, deps, db, device, body, provider.issuedAt);
  }
  log("warn", "apns_send_failed", { status: response.status, reason });
  return { status: "failed" };
}

export async function sendCoachAlert(
  config: ApnsConfig,
  deps: Deps,
  db: D1Database,
  devices: PushDeviceRow[],
  input: { environmentId: string; sessionId: string; event: ActivityEvent },
): Promise<ActivityResponse> {
  const body = JSON.stringify(coachAlertPayload(input));
  // Resolve the shared token once before the fan-out.
  if (devices.length > 0) await providerToken(config, db, deps.now());
  const outcomes = await Promise.all(devices.map((device) => sendOne(config, deps, db, device, body)));
  const sentTokens = devices.filter((_, index) => outcomes[index]!.status === "sent").map((device) => device.token);
  await markPushSent(db, sentTokens, deps.now());
  return {
    sent: sentTokens.length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    removed: outcomes.filter((outcome) => outcome.status === "removed").length,
  };
}
