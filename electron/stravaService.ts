import { safeStorage, shell } from "electron";
import {
  clearStravaCache,
  deleteSettings,
  getSetting,
  listStoredStravaActivities,
  reconcileStravaActivityIds,
  setSetting,
  setStravaActivityDetail,
  upsertStravaActivitySummary,
  type StoredStravaActivity
} from "./database";
import {
  isStravaGymActivity,
  normalizeStravaActivity,
  stravaActivityId,
  stravaActivityStartTime,
  stravaSportType,
  stravaSummaryFingerprint
} from "./stravaModel";
import {
  authorizeStrava,
  requestStravaTokens,
  StravaAuthorizationError,
  type StravaClientConfig
} from "./stravaOAuth";
import type { StrengthSession, StravaConfigInput, StravaStatus } from "./types";

type JsonRecord = Record<string, unknown>;

// Strava moves the API to https://api-v3.strava.com on 2027-01-04; the old
// path keeps working until it is retired.
const API_BASE_URL = "https://www.strava.com/api/v3";
const LIST_PAGE_SIZE = 200;
/** Re-list the window at most this often unless the user forces a refresh. */
const LIST_FRESH_MS = 10 * 60_000;
/** Detail reads per sync round; the Strength view drains the rest in rounds. */
const DETAIL_BATCH = 15;
/** A forced refresh re-reads notes this recent, since they are often edited after the session. */
const RECENT_DETAIL_REFRESH_SEC = 3 * 86_400;
/** Requests left untouched in every rate-limit window for the user's other apps. */
const RATE_LIMIT_RESERVE = 10;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

const SETTINGS = {
  clientId: "strava.clientId",
  secureState: "strava.secureState",
  athlete: "strava.athlete",
  coverageSince: "strava.coverageSince",
  listedAt: "strava.listedAt",
  lastSyncedAt: "strava.lastSyncedAt"
};
const SYNC_SETTINGS = [SETTINGS.coverageSince, SETTINGS.listedAt, SETTINGS.lastSyncedAt];

interface CredentialStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

let credentialStorage: CredentialStorage = safeStorage;
let openUrl: (url: string) => Promise<void> = (url) => shell.openExternal(url);

/** Test seams; production always uses Electron safeStorage and the system browser. */
export function setStravaCredentialStorageForTests(storage: CredentialStorage): void {
  credentialStorage = storage;
}

export function setStravaUrlOpenerForTests(opener: (url: string) => Promise<void>): void {
  openUrl = opener;
}

interface SecureState {
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  scopes?: string[];
}

interface StravaIdentity {
  id: string;
  displayName?: string;
}

interface RateLimitWindow {
  limit: number;
  usage: number;
}

export interface StravaSyncResult {
  sessions: StrengthSession[];
  /** Detail payloads read during this call. */
  fetched: number;
  /** Gym activities whose detail is still unread. */
  pending: number;
  /** Non-fatal note, for example a deferred detail backlog. */
  notice?: string;
}

class StravaRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

let connectController: AbortController | undefined;
let refreshInFlight: Promise<string> | undefined;
/** Most recent `[15-minute, daily]` usage Strava reported for read requests. */
let readRateLimits: RateLimitWindow[] | undefined;
/** Activities whose detail failed (deleted, hidden); skipped until a forced refresh. */
const unreadableDetails = new Set<string>();

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function requireEncryption(): void {
  if (!credentialStorage.isEncryptionAvailable()) {
    throw new Error(
      "Secure credential storage is unavailable. CorosLink did not save the Strava credentials."
    );
  }
}

function readSecureState(): SecureState {
  const encrypted = getSetting(SETTINGS.secureState);
  if (!encrypted || !credentialStorage.isEncryptionAvailable()) return {};
  try {
    const parsed = record(
      JSON.parse(credentialStorage.decryptString(Buffer.from(encrypted, "base64")))
    );
    return (parsed ?? {}) as SecureState;
  } catch {
    // Undecryptable state (keychain changed) reads as disconnected, never as
    // ciphertext sent to Strava.
    return {};
  }
}

function writeSecureState(state: SecureState): void {
  requireEncryption();
  setSetting(
    SETTINGS.secureState,
    credentialStorage.encryptString(JSON.stringify(state)).toString("base64")
  );
}

function readIdentity(): StravaIdentity | undefined {
  const raw = getSetting(SETTINGS.athlete);
  if (!raw) return undefined;
  try {
    const parsed = record(JSON.parse(raw));
    return typeof parsed?.id === "string"
      ? {
          id: parsed.id,
          displayName: typeof parsed.displayName === "string" ? parsed.displayName : undefined
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function clientConfig(state = readSecureState()): StravaClientConfig | undefined {
  const clientId = getSetting(SETTINGS.clientId);
  return clientId && state.clientSecret
    ? { clientId, clientSecret: state.clientSecret }
    : undefined;
}

/** Drop the athlete's grant and cached sessions; the API application stays saved. */
function forgetConnection(): void {
  const { clientSecret } = readSecureState();
  if (clientSecret) writeSecureState({ clientSecret });
  else deleteSettings([SETTINGS.secureState]);
  clearStravaCache();
  deleteSettings([SETTINGS.athlete, ...SYNC_SETTINGS]);
}

function windowStartEpochSeconds(days: number): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return Math.floor(start.getTime() / 1000);
}

export function getStravaStatus(): StravaStatus {
  const state = readSecureState();
  const identity = readIdentity();
  const clientId = getSetting(SETTINGS.clientId);
  return {
    configured: Boolean(clientConfig(state)),
    clientId,
    connected: Boolean(state.refreshToken && identity),
    connecting: Boolean(connectController),
    athleteId: identity?.id,
    displayName: identity?.displayName,
    profileUrl: identity ? `https://www.strava.com/athletes/${identity.id}` : undefined,
    canReadPrivate: Boolean(state.scopes?.includes("activity:read_all")),
    lastSyncedAt: getSetting(SETTINGS.lastSyncedAt)
  };
}

export function saveStravaConfig(input: StravaConfigInput): StravaStatus {
  const clientId = input.clientId.trim();
  if (!/^\d+$/.test(clientId)) {
    throw new Error("Enter the numeric Client ID from strava.com/settings/api.");
  }
  requireEncryption();
  const state = readSecureState();
  const clientSecret = input.clientSecret?.trim() || state.clientSecret;
  if (!clientSecret) throw new Error("Enter the Client Secret from strava.com/settings/api.");
  // Tokens belong to the application that issued them.
  if (getSetting(SETTINGS.clientId) !== clientId && state.refreshToken) {
    forgetConnection();
  }
  setSetting(SETTINGS.clientId, clientId);
  const current = readSecureState();
  writeSecureState({ ...current, clientSecret });
  return getStravaStatus();
}

export async function connectStrava(): Promise<StravaStatus> {
  const config = clientConfig();
  if (!config) throw new Error("Save your Strava Client ID and Client Secret first.");
  requireEncryption();
  connectController?.abort();
  const controller = new AbortController();
  connectController = controller;
  try {
    const tokens = await authorizeStrava(config, openUrl, controller.signal);
    if (!tokens.athlete) throw new Error("Strava did not return an athlete identity.");
    const previous = readIdentity();
    if (previous && previous.id !== tokens.athlete.id) {
      clearStravaCache();
      deleteSettings(SYNC_SETTINGS);
    }
    writeSecureState({
      clientSecret: config.clientSecret,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes
    });
    setSetting(SETTINGS.athlete, JSON.stringify(tokens.athlete));
    return getStravaStatus();
  } finally {
    if (connectController === controller) connectController = undefined;
  }
}

export function cancelStravaConnect(): void {
  connectController?.abort();
  connectController = undefined;
}

export async function disconnectStrava(): Promise<void> {
  cancelStravaConnect();
  const state = readSecureState();
  const config = clientConfig(state);
  const token = state.refreshToken ?? state.accessToken;
  if (config && token) {
    // Best effort: revoking also removes CorosLink from the athlete's Strava
    // "My Apps" list. Local tokens are dropped either way.
    await fetch("https://www.strava.com/oauth/revoke", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`
      },
      body: new URLSearchParams({
        token,
        token_type_hint: state.refreshToken ? "refresh_token" : "access_token"
      }),
      signal: AbortSignal.timeout(15_000)
    }).catch(() => undefined);
  }
  forgetConnection();
}

async function accessToken(forceRefresh = false): Promise<string> {
  const state = readSecureState();
  if (!state.refreshToken) throw new Error("Connect Strava before syncing gym sessions.");
  if (
    !forceRefresh &&
    state.accessToken &&
    (state.expiresAt ?? 0) - TOKEN_REFRESH_MARGIN_MS > Date.now()
  ) {
    return state.accessToken;
  }
  // Strava rotates refresh tokens and invalidates the old one at once, so two
  // concurrent refreshes would sign the athlete out. Share one.
  refreshInFlight ??= (async () => {
    const config = clientConfig(state);
    if (!config) throw new Error("Save your Strava Client ID and Client Secret first.");
    try {
      const tokens = await requestStravaTokens(config, {
        grant_type: "refresh_token",
        refresh_token: state.refreshToken!
      });
      writeSecureState({
        ...readSecureState(),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt
      });
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof StravaAuthorizationError) forgetConnection();
      throw error;
    }
  })().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

function parseRateLimits(headers: Headers): void {
  const parse = (name: string) =>
    headers
      .get(name)
      ?.split(",")
      .map((part) => Number(part.trim()));
  const limits = parse("x-readratelimit-limit") ?? parse("x-ratelimit-limit");
  const usage = parse("x-readratelimit-usage") ?? parse("x-ratelimit-usage");
  if (!limits || !usage || limits.length !== usage.length) return;
  if ([...limits, ...usage].some((value) => !Number.isFinite(value))) return;
  readRateLimits = limits.map((limit, index) => ({ limit, usage: usage[index]! }));
}

function rateLimitHeadroom(): number {
  if (!readRateLimits) return Number.POSITIVE_INFINITY;
  return Math.min(...readRateLimits.map((window) => window.limit - window.usage));
}

async function stravaRequest(
  path: string,
  search?: Record<string, string | number>,
  retried = false
): Promise<unknown> {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const token = await accessToken(retried);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  parseRateLimits(response.headers);
  if (response.status === 401 && !retried) {
    return stravaRequest(path, search, true);
  }
  if (response.status === 401) {
    throw new StravaAuthorizationError("Strava access was revoked. Reconnect Strava.");
  }
  if (response.status === 403) {
    throw new StravaRequestError(
      "Strava refused the request. Check the banner on strava.com/settings/api — personal API apps now need an active Strava subscription.",
      403
    );
  }
  if (response.status === 429) {
    throw new StravaRequestError(
      "Strava's API rate limit is used up. Try again in 15 minutes.",
      429
    );
  }
  if (!response.ok) {
    throw new StravaRequestError(
      `Strava API request failed (${response.status}).`,
      response.status
    );
  }
  return response.json();
}

function stopsDetailRound(error: unknown): boolean {
  return (
    error instanceof StravaAuthorizationError ||
    (error instanceof StravaRequestError && (error.status === 403 || error.status === 429)) ||
    !(error instanceof StravaRequestError)
  );
}

/** Re-list every activity in the window; Strava has no "changed since" query. */
async function listWindow(since: number): Promise<void> {
  const retained = new Set<string>();
  for (let page = 1; ; page += 1) {
    const payload = await stravaRequest("/athlete/activities", {
      after: since,
      page,
      per_page: LIST_PAGE_SIZE
    });
    const activities = Array.isArray(payload)
      ? payload.map(record).filter((item): item is JsonRecord => Boolean(item))
      : [];
    for (const activity of activities) {
      if (!isStravaGymActivity(activity)) continue;
      const id = stravaActivityId(activity);
      const startTime = stravaActivityStartTime(activity);
      const sportType = stravaSportType(activity);
      if (!id || startTime === undefined || !sportType) continue;
      retained.add(id);
      upsertStravaActivitySummary(
        id,
        startTime,
        sportType,
        activity,
        stravaSummaryFingerprint(activity)
      );
    }
    if (!Array.isArray(payload) || payload.length < LIST_PAGE_SIZE) break;
  }
  reconcileStravaActivityIds(since, retained);
  setSetting(SETTINGS.coverageSince, String(since));
  setSetting(SETTINGS.listedAt, new Date().toISOString());
}

function needsDetail(activity: StoredStravaActivity): boolean {
  return (
    !unreadableDetails.has(activity.activityId) &&
    (!activity.detail || activity.detailFingerprint !== activity.summaryFingerprint)
  );
}

function normalizeStored(activities: StoredStravaActivity[]): StrengthSession[] {
  return activities
    .map((activity) =>
      normalizeStravaActivity(
        activity.summary,
        // A stale detail still beats none; it is replaced on the next round.
        activity.detail
      )
    )
    .filter((session): session is StrengthSession => Boolean(session));
}

export function getStoredStravaStrengthSessions(days: number): StrengthSession[] {
  return normalizeStored(listStoredStravaActivities(windowStartEpochSeconds(days)));
}

export async function syncStravaStrengthHistory(
  days = 90,
  force = false
): Promise<StravaSyncResult> {
  if (!getStravaStatus().connected) {
    throw new Error("Connect Strava before syncing gym sessions.");
  }
  const since = windowStartEpochSeconds(days);
  const coverageSince = Number(getSetting(SETTINGS.coverageSince));
  const listedAt = Date.parse(getSetting(SETTINGS.listedAt) ?? "");
  const listIsCurrent =
    Number.isFinite(coverageSince) &&
    coverageSince <= since &&
    Number.isFinite(listedAt) &&
    Date.now() - listedAt < LIST_FRESH_MS;
  if (force) unreadableDetails.clear();
  if (force || !listIsCurrent) await listWindow(since);

  const recentCutoff = Math.floor(Date.now() / 1000) - RECENT_DETAIL_REFRESH_SEC;
  const queue = listStoredStravaActivities(since).filter(
    (activity) => needsDetail(activity) || (force && activity.startTime >= recentCutoff)
  );
  let fetched = 0;
  let deferred = false;
  for (const activity of queue.slice(0, DETAIL_BATCH)) {
    if (rateLimitHeadroom() <= RATE_LIMIT_RESERVE) {
      deferred = true;
      break;
    }
    try {
      const detail = record(await stravaRequest(`/activities/${activity.activityId}`));
      if (detail) {
        setStravaActivityDetail(activity.activityId, detail, activity.summaryFingerprint);
        fetched += 1;
      } else {
        unreadableDetails.add(activity.activityId);
      }
    } catch (error) {
      // One deleted or hidden activity must not stall the rest; auth,
      // refusal, rate-limit and network failures stop the round.
      if (!stopsDetailRound(error)) {
        unreadableDetails.add(activity.activityId);
        continue;
      }
      if (fetched === 0) throw error;
      deferred = true;
      break;
    }
  }

  const stored = listStoredStravaActivities(since);
  const pending = stored.filter(needsDetail).length;
  setSetting(SETTINGS.lastSyncedAt, new Date().toISOString());
  return {
    sessions: normalizeStored(stored),
    fetched,
    // A deferred backlog is reported as a notice instead, so the view stops
    // draining rather than spinning against the limit.
    pending: deferred ? 0 : pending,
    ...(deferred && pending > 0
      ? {
          notice: `Strava's API limit is nearly used up, so notes for ${pending} gym session${
            pending === 1 ? "" : "s"
          } will load on a later refresh.`
        }
      : {})
  };
}

/**
 * One page of the athlete's activity list, for features beyond Strength
 * (Races reads `workout_type`). Shares this module's token refresh and
 * rate-limit handling.
 */
export async function fetchStravaActivityPage(
  after: number,
  page: number,
  perPage = LIST_PAGE_SIZE
): Promise<JsonRecord[]> {
  const payload = await stravaRequest("/athlete/activities", {
    after,
    page,
    per_page: perPage
  });
  return Array.isArray(payload)
    ? payload.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
}
