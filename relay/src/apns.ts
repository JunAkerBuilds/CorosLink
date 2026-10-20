import type { ApnsConfig, ApnsKey, Deps } from "./env";
import { importEs256Pkcs8 } from "./crypto";
import {
  deleteLiveActivity,
  deletePushDevice,
  getStoredProviderToken,
  markLiveActivitySent,
  markPushSent,
  storeProviderToken,
  type LiveActivityRow,
  type PushDeviceRow,
} from "./db";
import { log } from "./log";
import {
  ACTIVITY_ALERTS,
  base64UrlEncode,
  LIVE_ACTIVITY_TTL_SECONDS,
  LIVE_DISMISS_AFTER_SECONDS,
  LIVE_HIGH_PRIORITY_INTERVAL_SECONDS,
  LIVE_STALE_AFTER_SECONDS,
  LIVE_UPDATE_MIN_INTERVAL_SECONDS,
  type ActivityEvent,
  type ActivityResponse,
  type CoachPushUserInfo,
  type LiveActivityPayload,
  type LiveActivityResponse,
  type LiveEvent,
  type LivePhase,
} from "./protocol";

const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
/** Apple accepts a provider token for an hour and throttles refreshes under 20 minutes. */
export const PROVIDER_TOKEN_TTL_MS = 50 * 60 * 1000;
/**
 * Apple answers TooManyProviderTokenUpdates to a team whose token changes more
 * often than this, and that refusal then fails every push. A token APNs calls
 * invalid or expired is replaced only once it is at least this old: a younger
 * one was refused for its key or configuration, which a new token can't fix.
 */
export const PROVIDER_TOKEN_MIN_REFRESH_MS = 20 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;
const ALERT_EXPIRY_SECONDS = 60 * 60;

interface CachedProviderToken {
  token: string;
  issuedAt: number;
  keyId: string;
  teamId: string;
}

/** An APNs key and its team: what signs a provider token. */
export type ApnsSigner = ApnsKey & { teamId: string };

type ApnsEnvironment = "sandbox" | "production";

/** Everything below is per key id: a relay may hold one key per APNs environment. */
const providerTokenCache = new Map<string, CachedProviderToken>();
const signingKeyCache = new Map<string, { pem: string; key: CryptoKey }>();
/** One signing in flight per key, so a fan-out to many devices shares a token. */
const inflight = new Map<string, Promise<CachedProviderToken>>();

export function resetApnsCaches(): void {
  providerTokenCache.clear();
  signingKeyCache.clear();
  inflight.clear();
}

/** The key that signs pushes to device tokens of `environment`, if the relay has one. */
export function apnsSigner(config: ApnsConfig, environment: ApnsEnvironment): ApnsSigner | null {
  const key = environment === "production" ? config.production : config.sandbox;
  return key ? { ...key, teamId: config.teamId } : null;
}

/** Resolves each environment's shared token once before a fan-out. */
async function prepareProviderTokens(
  config: ApnsConfig,
  db: D1Database,
  now: number,
  targets: Array<{ apns_environment: ApnsEnvironment }>,
): Promise<void> {
  for (const environment of new Set(targets.map((target) => target.apns_environment))) {
    const signer = apnsSigner(config, environment);
    if (signer) await providerToken(signer, db, now);
  }
}

const encoder = new TextEncoder();

/**
 * ES256 provider JWT `{alg, kid}.{iss, iat}` signed with WebCrypto and reused
 * for ~50 minutes by every isolate: it is cached in memory and in D1, because
 * Apple answers TooManyProviderTokenUpdates when tokens change too often.
 * `staleIssuedAt` forces a replacement for a token APNs called expired.
 */
export async function providerToken(
  signer: ApnsSigner,
  db: D1Database,
  now: number,
  staleIssuedAt?: number,
): Promise<CachedProviderToken> {
  let pending = inflight.get(signer.keyId);
  if (!pending) {
    pending = resolveProviderToken(signer, db, now, staleIssuedAt).finally(() => {
      inflight.delete(signer.keyId);
    });
    inflight.set(signer.keyId, pending);
  }
  return pending;
}

function usable(
  candidate: { token: string; issuedAt: number; keyId: string; teamId: string } | null | undefined,
  config: ApnsSigner,
  now: number,
  staleIssuedAt: number | undefined,
): boolean {
  return (
    candidate != null &&
    candidate.keyId === config.keyId &&
    candidate.teamId === config.teamId &&
    now - candidate.issuedAt < PROVIDER_TOKEN_TTL_MS &&
    (staleIssuedAt === undefined || candidate.issuedAt > staleIssuedAt)
  );
}

async function resolveProviderToken(
  config: ApnsSigner,
  db: D1Database,
  now: number,
  staleIssuedAt: number | undefined,
): Promise<CachedProviderToken> {
  const cached = providerTokenCache.get(config.keyId);
  if (usable(cached, config, now, staleIssuedAt)) return cached!;
  const stored = await getStoredProviderToken(db, config.keyId);
  const shared = stored
    ? { token: stored.token, issuedAt: stored.issued_at, keyId: config.keyId, teamId: stored.team_id }
    : null;
  if (usable(shared, config, now, staleIssuedAt)) {
    providerTokenCache.set(config.keyId, shared!);
    return shared!;
  }
  let signingKey = signingKeyCache.get(config.keyId);
  if (!signingKey || signingKey.pem !== config.privateKey) {
    signingKey = { pem: config.privateKey, key: await importEs256Pkcs8(config.privateKey) };
    signingKeyCache.set(config.keyId, signingKey);
  }
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "ES256", kid: config.keyId })));
  const claims = base64UrlEncode(
    encoder.encode(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) })),
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto ECDSA signatures are raw r||s, which is exactly what JWS ES256 wants.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey.key,
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
  const fresh = { token: winner.token, issuedAt: winner.issued_at, keyId: config.keyId, teamId: config.teamId };
  providerTokenCache.set(config.keyId, fresh);
  return fresh;
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
const DEAD_TOKEN_REASONS = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic", "ExpiredToken"]);
const PROVIDER_TOKEN_REASONS = new Set(["ExpiredProviderToken", "InvalidProviderToken"]);

interface ApnsTarget {
  token: string;
  apns_environment: "sandbox" | "production";
}

interface ApnsMessage {
  pushType: "alert" | "liveactivity";
  topic: string;
  priority: 5 | 10;
  /** Unix seconds after which APNs stops trying. */
  expiration: number;
  body: string;
}

/** `dead`: APNs says the token will never work again; the caller forgets it. */
type Delivery = "sent" | "failed" | "dead";

async function deliver(
  config: ApnsConfig,
  deps: Deps,
  db: D1Database,
  target: ApnsTarget,
  message: ApnsMessage,
  staleIssuedAt?: number,
): Promise<Delivery> {
  const host = target.apns_environment === "production" ? PRODUCTION_HOST : SANDBOX_HOST;
  const signer = apnsSigner(config, target.apns_environment);
  if (!signer) {
    log("warn", "apns_send_failed", { pushType: message.pushType, reason: "NoKeyForEnvironment", environment: target.apns_environment });
    return "failed";
  }
  const provider = await providerToken(signer, db, deps.now(), staleIssuedAt);
  let response: Response;
  try {
    response = await deps.fetch(`${host}/3/device/${target.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${provider.token}`,
        "apns-topic": message.topic,
        "apns-push-type": message.pushType,
        "apns-priority": String(message.priority),
        "apns-expiration": String(message.expiration),
        "content-type": "application/json",
      },
      body: message.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return "failed";
  }
  if (response.status === 200) return "sent";
  let reason = "";
  try {
    reason = ((await response.json()) as { reason?: string }).reason ?? "";
  } catch {
    // APNs always sends a JSON reason; tolerate a missing one.
  }
  if (response.status === 410 || DEAD_TOKEN_REASONS.has(reason)) {
    log("info", "apns_token_removed", { pushType: message.pushType, status: response.status, reason });
    return "dead";
  }
  if (
    response.status === 403 &&
    PROVIDER_TOKEN_REASONS.has(reason) &&
    staleIssuedAt === undefined &&
    deps.now() - provider.issuedAt >= PROVIDER_TOKEN_MIN_REFRESH_MS
  ) {
    // Retry once with a token newer than the one APNs refused.
    return deliver(config, deps, db, target, message, provider.issuedAt);
  }
  log("warn", "apns_send_failed", { pushType: message.pushType, status: response.status, reason });
  return "failed";
}

export async function sendCoachAlert(
  config: ApnsConfig,
  deps: Deps,
  db: D1Database,
  devices: PushDeviceRow[],
  input: { environmentId: string; sessionId: string; event: ActivityEvent },
): Promise<ActivityResponse> {
  const message: ApnsMessage = {
    pushType: "alert",
    topic: config.bundleId,
    priority: 10,
    expiration: Math.floor(deps.now() / 1000) + ALERT_EXPIRY_SECONDS,
    body: JSON.stringify(coachAlertPayload(input)),
  };
  await prepareProviderTokens(config, db, deps.now(), devices);
  const outcomes = await Promise.all(devices.map((device) => deliver(config, deps, db, device, message)));
  const dead = devices.filter((_, index) => outcomes[index] === "dead");
  for (const device of dead) await deletePushDevice(db, device.token);
  const sentTokens = devices.filter((_, index) => outcomes[index] === "sent").map((device) => device.token);
  await markPushSent(db, sentTokens, deps.now());
  return {
    sent: sentTokens.length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
    removed: dead.length,
  };
}

// --- Live Activities ------------------------------------------------------------------

export interface LiveUpdate {
  event: LiveEvent;
  phase: LivePhase;
  words: number;
}

type LivePushHistory = Pick<LiveActivityRow, "last_phase" | "last_sent_at" | "last_high_priority_at" | "last_timestamp">;

export type LivePlan = { send: false } | { send: true; priority: 5 | 10; timestamp: number };

/**
 * Whether and how to push `update` to one activity, given what it got last.
 * Each push's `timestamp` is newer than the last, since ActivityKit keeps the
 * newest content. See LIVE_UPDATE_MIN_INTERVAL_SECONDS for the budget.
 */
export function liveActivityPlan(history: LivePushHistory, update: LiveUpdate, now: number): LivePlan {
  const timestamp = Math.max(Math.floor(now / 1000), (history.last_timestamp ?? 0) + 1);
  if (update.event === "end") return { send: true, priority: 10, timestamp };
  if (history.last_sent_at !== null && now - history.last_sent_at < LIVE_UPDATE_MIN_INTERVAL_SECONDS * 1000) {
    return { send: false };
  }
  const phaseChanged = history.last_phase !== update.phase;
  const budgetAllows =
    history.last_high_priority_at === null ||
    now - history.last_high_priority_at >= LIVE_HIGH_PRIORITY_INTERVAL_SECONDS * 1000;
  return { send: true, priority: phaseChanged && budgetAllows ? 10 : 5, timestamp };
}

export function liveActivityPayload(update: LiveUpdate, timestamp: number): LiveActivityPayload {
  const state = { phase: update.phase, words: update.words };
  return update.event === "end"
    ? { aps: { timestamp, event: "end", "content-state": state, "dismissal-date": timestamp + LIVE_DISMISS_AFTER_SECONDS } }
    : { aps: { timestamp, event: "update", "content-state": state, "stale-date": timestamp + LIVE_STALE_AFTER_SECONDS } };
}

/**
 * Pushes one turn's phase to the activities following it. An end, or a token
 * APNs calls dead, removes the registration; an update records what was sent.
 */
export async function sendLiveActivity(
  config: ApnsConfig,
  deps: Deps,
  db: D1Database,
  activities: Array<ApnsTarget & LivePushHistory>,
  update: LiveUpdate,
): Promise<LiveActivityResponse> {
  const result: LiveActivityResponse = { sent: 0, failed: 0, removed: 0, skipped: 0 };
  const now = deps.now();
  const planned = activities.map((activity) => ({ activity, plan: liveActivityPlan(activity, update, now) }));
  await prepareProviderTokens(config, db, now, planned.filter(({ plan }) => plan.send).map(({ activity }) => activity));
  await Promise.all(
    planned.map(async ({ activity, plan }) => {
      if (!plan.send) {
        result.skipped += 1;
        return;
      }
      const ttl = update.event === "end" ? LIVE_ACTIVITY_TTL_SECONDS : LIVE_STALE_AFTER_SECONDS;
      const outcome = await deliver(config, deps, db, activity, {
        pushType: "liveactivity",
        topic: `${config.bundleId}.push-type.liveactivity`,
        priority: plan.priority,
        expiration: Math.floor(now / 1000) + ttl,
        body: JSON.stringify(liveActivityPayload(update, plan.timestamp)),
      });
      if (outcome === "failed") {
        result.failed += 1;
      } else if (outcome === "dead" || update.event === "end") {
        // An ended activity takes no more pushes.
        await deleteLiveActivity(db, activity.token);
        result[outcome === "dead" ? "removed" : "sent"] += 1;
      } else {
        await markLiveActivitySent(db, {
          token: activity.token,
          phase: update.phase,
          now,
          highPriority: plan.priority === 10,
          timestamp: plan.timestamp,
        });
        result.sent += 1;
      }
    }),
  );
  return result;
}
