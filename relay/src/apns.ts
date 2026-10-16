import type { ApnsConfig, Deps } from "./env";
import { importEs256Pkcs8 } from "./crypto";
import { deletePushDevice, markPushSent, type PushDeviceRow } from "./db";
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
let inflight: Promise<string> | null = null;

export function resetApnsCaches(): void {
  providerTokenCache = null;
  signingKeyCache = null;
  inflight = null;
}

const encoder = new TextEncoder();

/** ES256 provider JWT `{alg, kid}.{iss, iat}` signed with WebCrypto, cached ~50 minutes. */
export async function providerToken(config: ApnsConfig, now: number): Promise<string> {
  inflight ??= mintProviderToken(config, now).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function mintProviderToken(config: ApnsConfig, now: number): Promise<string> {
  const cached = providerTokenCache;
  if (
    cached &&
    cached.keyId === config.keyId &&
    cached.teamId === config.teamId &&
    now - cached.issuedAt < PROVIDER_TOKEN_TTL_MS
  ) {
    return cached.token;
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
  const token = `${signingInput}.${base64UrlEncode(signature)}`;
  providerTokenCache = { token, issuedAt: now, keyId: config.keyId, teamId: config.teamId };
  return token;
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
  retryOnProviderToken = true,
): Promise<SendOutcome> {
  const host = device.apns_environment === "production" ? PRODUCTION_HOST : SANDBOX_HOST;
  let response: Response;
  try {
    response = await deps.fetch(`${host}/3/device/${device.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${await providerToken(config, deps.now())}`,
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
  if (response.status === 403 && PROVIDER_TOKEN_REASONS.has(reason) && retryOnProviderToken) {
    providerTokenCache = null;
    return sendOne(config, deps, db, device, body, false);
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
  const outcomes = await Promise.all(devices.map((device) => sendOne(config, deps, db, device, body)));
  const sentTokens = devices.filter((_, index) => outcomes[index]!.status === "sent").map((device) => device.token);
  await markPushSent(db, sentTokens, deps.now());
  return {
    sent: sentTokens.length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    removed: outcomes.filter((outcome) => outcome.status === "removed").length,
  };
}
