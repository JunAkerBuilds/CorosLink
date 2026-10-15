import crypto from "node:crypto";
import type {
  RouteActivityType,
  RouteElevationPreference,
  RouteGeometry,
  RouteProfileSource,
  RouteSurfacePreference,
  RouteWaypoint,
  TrainingHubTrackPoint
} from "../types";
import {
  buildAthleteProfile,
  normalizeElevationPreference,
  normalizeSurfacePreference,
  type AthleteProfileOptions
} from "./athleteProfiles";
import { planLoop, type LoopPlan } from "./loopPlanner";
import { buildRouteInsights, parseBrouterSegments } from "./routeInsights";

// BRouter is a free, keyless OSM router. We call its public GeoJSON endpoint,
// which returns a LineString with `[lon, lat, elevation]` coordinates plus
// distance/ascent/time and per-segment way tags in the feature properties.
const BROUTER_BASE_URL = "https://brouter.de/brouter";
const BROUTER_PROFILE_URL = `${BROUTER_BASE_URL}/profile`;
const EARTH_RADIUS_M = 6_371_000;
const ROUTE_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 15_000;
/** brouter.de prunes uploaded profiles eventually; refresh well before that. */
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;
/** After a failed upload, route with stock profiles for a while instead of retrying every request. */
const PROFILE_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
/**
 * brouter.de is a free community server: it throttles bursty clients with
 * "403 Please, retry later!" and, under contention, kills a client's oldest
 * running request. Loop planning fans out, so cap and pace our requests.
 */
const MAX_CONCURRENT_REQUESTS = 2;
const MIN_REQUEST_SPACING_MS = 150;
/**
 * Measured 2026-10-15: a steady 1 req/s is refused after ~36 requests, so
 * keep a rolling budget under that and wait briefly rather than get blocked.
 */
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_BUDGET_WAIT_MS = 10_000;
/** After a throttle answer, fail fast instead of extending the block. */
const RATE_LIMIT_COOLDOWN_MS = 30_000;
const TRANSIENT_RETRY_DELAYS_MS = [600, 1_500];
const USER_AGENT = "CorosLink/1.0 (https://github.com/Akerrules/CorosLink)";

/** Stock brouter.de profiles, used only when the athlete profile is unavailable. */
export const BROUTER_PROFILE_BY_ACTIVITY: Record<RouteActivityType, string> = {
  walking: "hiking-mountain",
  running: "hiking-mountain",
  hiking: "hiking-mountain",
  "cycling-road": "fastbike",
  "cycling-mountain": "mtb"
};

export function brouterProfileFor(activityType: RouteActivityType): string {
  return BROUTER_PROFILE_BY_ACTIVITY[activityType] ?? "trekking";
}

export interface RoutePreferences {
  activityType: RouteActivityType;
  surface: RouteSurfacePreference;
  elevation: RouteElevationPreference;
}

/** Fills sport defaults for preferences older callers do not send. */
export function resolveRoutePreferences(
  activityType: RouteActivityType,
  surface?: unknown,
  elevation?: unknown
): RoutePreferences {
  return {
    activityType,
    surface: normalizeSurfacePreference(surface, activityType),
    elevation: normalizeElevationPreference(elevation)
  };
}

export interface BrouterDeps {
  fetchImpl?: typeof fetch;
  registry?: BrouterProfileRegistry;
}

interface BrouterResponse {
  features?: Array<{
    geometry?: { coordinates?: number[][] };
    properties?: Record<string, unknown>;
  }>;
}

/** HTTP-level failure from brouter.de, keeping the body for diagnosis. */
export class BrouterRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "BrouterRequestError";
    this.status = status;
    this.body = body;
  }

  /** BRouter answers 400 + text when it genuinely cannot route the points. */
  get isRoutingFailure(): boolean {
    return this.status === 400;
  }
}

/** brouter.de asked us to slow down; retrying immediately only extends the block. */
export class BrouterRateLimitError extends Error {
  constructor(retryInSeconds: number) {
    super(
      `brouter.de, the free routing service, is asking CorosLink to slow down. Try again in about ${retryInSeconds} seconds.`
    );
    this.name = "BrouterRateLimitError";
  }
}

/** The athlete profile could not be uploaded or was rejected. */
export class BrouterProfileUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrouterProfileUnavailableError";
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points in metres. */
export function haversineMeters(a: RouteWaypoint, b: RouteWaypoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function numberFrom(
  properties: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const raw = properties?.[key];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

// ---- request plumbing -------------------------------------------------------

let activeRequests = 0;
let lastRequestStartedAt = 0;
let rateLimitedUntil = 0;
const waitingRequests: Array<() => void> = [];
const recentRequestTimes: number[] = [];

function pruneRequestWindow(now: number): void {
  while (recentRequestTimes.length > 0 && now - recentRequestTimes[0]! >= REQUEST_WINDOW_MS) {
    recentRequestTimes.shift();
  }
}

/** Requests that can be sent right now without tripping brouter.de's throttle. */
export function availableBrouterRequests(): number {
  const now = Date.now();
  if (rateLimitedUntil > now) {
    return 0;
  }
  pruneRequestWindow(now);
  return Math.max(0, MAX_REQUESTS_PER_WINDOW - recentRequestTimes.length);
}

/** Paces and budgets every individual HTTP request, retries included. */
async function takeRequestToken(): Promise<void> {
  throwIfRateLimited();
  pruneRequestWindow(Date.now());
  if (recentRequestTimes.length >= MAX_REQUESTS_PER_WINDOW) {
    const waitMs = recentRequestTimes[0]! + REQUEST_WINDOW_MS - Date.now();
    if (waitMs > MAX_BUDGET_WAIT_MS) {
      throw new BrouterRateLimitError(Math.ceil(waitMs / 1000));
    }
    await sleep(waitMs);
    pruneRequestWindow(Date.now());
  }
  const spacingMs = lastRequestStartedAt + MIN_REQUEST_SPACING_MS - Date.now();
  if (spacingMs > 0) {
    await sleep(spacingMs);
  }
  throwIfRateLimited();
  lastRequestStartedAt = Date.now();
  recentRequestTimes.push(lastRequestStartedAt);
}

function throwIfRateLimited(): void {
  const remainingMs = rateLimitedUntil - Date.now();
  if (remainingMs > 0) {
    throw new BrouterRateLimitError(Math.ceil(remainingMs / 1000));
  }
}

async function withRequestSlot<T>(task: () => Promise<T>): Promise<T> {
  throwIfRateLimited();
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => waitingRequests.push(resolve));
  }
  activeRequests += 1;
  try {
    return await task();
  } finally {
    activeRequests -= 1;
    waitingRequests.shift()?.();
  }
}

function isRateLimitResponse(status: number, body: string): boolean {
  return status === 429 || (status === 403 && /retry later|too many|rate/i.test(body));
}

/** Converts a throttle answer into a cooldown so parallel requests stop too. */
function rateLimitError(): BrouterRateLimitError {
  rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  return new BrouterRateLimitError(Math.ceil(RATE_LIMIT_COOLDOWN_MS / 1000));
}

/** Test hook: clears pacing and throttle state between scripted scenarios. */
export function resetBrouterThrottleForTests(): void {
  rateLimitedUntil = 0;
  lastRequestStartedAt = 0;
  recentRequestTimes.length = 0;
}

function isTimeout(caught: unknown): boolean {
  return caught instanceof Error && (caught.name === "TimeoutError" || caught.name === "AbortError");
}

function isTransient(caught: unknown): boolean {
  if (caught instanceof BrouterRequestError) {
    return (
      caught.status === 502 ||
      caught.status === 503 ||
      caught.status === 504 ||
      /thread-priority-watchdog|overload|too many/i.test(caught.body)
    );
  }
  // fetch() rejects with TypeError on DNS/socket failures ("fetch failed", "terminated").
  return caught instanceof TypeError;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries dropped connections and overload responses; never retries timeouts. */
async function withTransientRetry<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (caught) {
      const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || isTimeout(caught) || !isTransient(caught)) {
        throw caught;
      }
      await sleep(delay);
    }
  }
}

// ---- custom profile registry -----------------------------------------------

/**
 * Uploads generated profiles to brouter.de once and remembers the returned
 * `custom_…` id. Identical profile text shares one upload (and one in-flight
 * promise); a recent upload failure short-circuits to the stock fallback.
 */
export class BrouterProfileRegistry {
  private readonly ids = new Map<string, { id: string; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<string>>();
  private unavailableUntil = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async idFor(profileText: string, fetchImpl: typeof fetch): Promise<string> {
    const key = profileHash(profileText);
    const cached = this.ids.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.id;
    }
    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }
    if (this.unavailableUntil > this.now()) {
      throw new BrouterProfileUnavailableError("Athlete routing profile is temporarily unavailable.");
    }

    const upload = uploadProfile(profileText, fetchImpl)
      .then((id) => {
        this.ids.set(key, { id, expiresAt: this.now() + PROFILE_TTL_MS });
        return id;
      })
      .catch((caught: unknown) => {
        if (caught instanceof BrouterRateLimitError) {
          throw caught;
        }
        this.unavailableUntil = this.now() + PROFILE_FAILURE_COOLDOWN_MS;
        throw caught instanceof BrouterProfileUnavailableError
          ? caught
          : new BrouterProfileUnavailableError(
              `Could not upload the athlete routing profile: ${caught instanceof Error ? caught.message : String(caught)}`
            );
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, upload);
    return upload;
  }

  /** Drops a cached id the server no longer recognises. */
  forget(profileText: string): void {
    this.ids.delete(profileHash(profileText));
  }
}

function profileHash(profileText: string): string {
  return crypto.createHash("sha256").update(profileText).digest("hex");
}

const defaultRegistry = new BrouterProfileRegistry();

async function uploadProfile(profileText: string, fetchImpl: typeof fetch): Promise<string> {
  return withRequestSlot(() =>
    withTransientRetry(async () => {
      await takeRequestToken();
      const response = await fetchImpl(BROUTER_PROFILE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "User-Agent": USER_AGENT
        },
        body: profileText,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
      });
      const body = await response.text().catch(() => "");
      if (isRateLimitResponse(response.status, body)) {
        throw rateLimitError();
      }
      if (!response.ok) {
        throw new BrouterRequestError(`Profile upload failed: ${response.status}`, response.status, body);
      }
      let parsed: { profileid?: unknown; error?: unknown };
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        throw new BrouterProfileUnavailableError("brouter.de returned an unreadable profile response.");
      }
      if (typeof parsed.error === "string" && parsed.error) {
        // A parse error is a CorosLink bug, not a user problem: fall back quietly.
        throw new BrouterProfileUnavailableError(parsed.error);
      }
      if (typeof parsed.profileid !== "string" || !parsed.profileid.startsWith("custom_")) {
        throw new BrouterProfileUnavailableError("brouter.de did not return a profile id.");
      }
      return parsed.profileid;
    })
  );
}

// ---- routing ----------------------------------------------------------------

async function requestRoute(
  waypoints: RouteWaypoint[],
  profile: string,
  source: RouteProfileSource,
  activityType: RouteActivityType,
  fetchImpl: typeof fetch
): Promise<RouteGeometry> {
  const lonlats = waypoints
    .map((point) => `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`)
    .join("|");
  const url = new URL(BROUTER_BASE_URL);
  url.searchParams.set("lonlats", lonlats);
  url.searchParams.set("profile", profile);
  url.searchParams.set("alternativeidx", "0");
  url.searchParams.set("format", "geojson");

  const payload = await withRequestSlot(() =>
    withTransientRetry(async () => {
      await takeRequestToken();
      const response = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS)
      });
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        if (isRateLimitResponse(response.status, details)) {
          throw rateLimitError();
        }
        throw new BrouterRequestError(
          describeBrouterError(response.status, details),
          response.status,
          details
        );
      }
      return (await response.json()) as BrouterResponse;
    })
  );

  return geometryFromBrouter(payload, source, activityType);
}

/** Exported for tests: converts a BRouter GeoJSON payload into route geometry + insights. */
export function geometryFromBrouter(
  payload: BrouterResponse,
  source: RouteProfileSource,
  activityType: RouteActivityType
): RouteGeometry {
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) {
    throw new Error(
      "No path was found near one of your points. Move it closer to a road or trail."
    );
  }

  const points: TrainingHubTrackPoint[] = coordinates
    .filter((coordinate) => coordinate.length >= 2)
    .map((coordinate) => ({
      lon: coordinate[0],
      lat: coordinate[1],
      elevation: coordinate.length > 2 ? coordinate[2] : undefined
    }));

  const distanceMeters =
    numberFrom(feature?.properties, "track-length") ?? distanceAlong(points);
  const ascentMeters = numberFrom(feature?.properties, "filtered ascend");
  const durationSeconds = numberFrom(feature?.properties, "total-time");
  // Net elevation change = ascent - descent, so the filtered descent follows
  // from BRouter's filtered ascent and the start/end heights.
  const startElevation = points[0]?.elevation;
  const endElevation = points[points.length - 1]?.elevation;
  const descentMeters =
    ascentMeters === undefined
      ? undefined
      : startElevation !== undefined && endElevation !== undefined
        ? Math.max(0, Math.round(ascentMeters + startElevation - endElevation))
        : ascentMeters;

  return {
    points,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds,
    ascentMeters,
    descentMeters,
    insights: buildRouteInsights(
      parseBrouterSegments(feature?.properties?.messages),
      points,
      activityType.startsWith("cycling"),
      source
    )
  };
}

async function routeWithAthleteProfile(
  waypoints: RouteWaypoint[],
  options: AthleteProfileOptions,
  fetchImpl: typeof fetch,
  registry: BrouterProfileRegistry
): Promise<RouteGeometry> {
  const profileText = buildAthleteProfile(options);
  const id = await registry.idFor(profileText, fetchImpl);
  try {
    return await requestRoute(waypoints, id, "athlete", options.activityType, fetchImpl);
  } catch (caught) {
    // An unknown custom id surfaces as a bare 500; re-upload once and retry.
    if (caught instanceof BrouterRequestError && caught.status === 500 && !caught.body.trim()) {
      registry.forget(profileText);
      const freshId = await registry.idFor(profileText, fetchImpl);
      return requestRoute(waypoints, freshId, "athlete", options.activityType, fetchImpl);
    }
    throw caught;
  }
}

/**
 * Routes through the given waypoints with CorosLink's athlete profile,
 * falling back to BRouter's stock profile when the custom profile cannot be
 * used. A genuine "no route" answer is reported, not retried on the fallback.
 * Requires at least two waypoints.
 */
export async function routeViaBrouter(
  waypoints: RouteWaypoint[],
  preferences: RoutePreferences,
  options: BrouterDeps & { trimViaDetours?: boolean } = {}
): Promise<RouteGeometry> {
  if (waypoints.length < 2) {
    throw new Error("At least two points are needed to build a route.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const registry = options.registry ?? defaultRegistry;

  try {
    return await routeWithAthleteProfile(
      waypoints,
      { ...preferences, trimViaDetours: options.trimViaDetours ?? false },
      fetchImpl,
      registry
    );
  } catch (caught) {
    // The stock profile cannot help with unroutable points, a slow server or a throttle.
    if (
      (caught instanceof BrouterRequestError && caught.isRoutingFailure) ||
      caught instanceof BrouterRateLimitError ||
      isTimeout(caught)
    ) {
      throw toUserFacingError(caught);
    }
    if (!(caught instanceof BrouterProfileUnavailableError)) {
      console.warn("[routing] athlete profile request failed, using stock profile:", caught);
    }
  }

  try {
    return await requestRoute(
      waypoints,
      brouterProfileFor(preferences.activityType),
      "standard",
      preferences.activityType,
      fetchImpl
    );
  } catch (caught) {
    throw toUserFacingError(caught);
  }
}

function toUserFacingError(caught: unknown): Error {
  if (isTimeout(caught)) {
    return new Error("The routing service took too long to answer. Try again, or shorten the route.");
  }
  if (caught instanceof TypeError) {
    return new Error("Couldn't reach the routing service. Check your internet connection and try again.");
  }
  return caught instanceof Error ? caught : new Error(String(caught));
}

/** Straight-line geometry for freehand drawing (no snapping to paths). */
export function straightLineGeometry(
  waypoints: RouteWaypoint[]
): RouteGeometry {
  const points: TrainingHubTrackPoint[] = waypoints.map((point) => ({
    lat: point.lat,
    lon: point.lon
  }));
  return {
    points,
    distanceMeters: Math.round(distanceAlong(points))
  };
}

function distanceAlong(points: TrainingHubTrackPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (
      previous.lat === undefined ||
      previous.lon === undefined ||
      current.lat === undefined ||
      current.lon === undefined
    ) {
      continue;
    }
    total += haversineMeters(
      { lat: previous.lat, lon: previous.lon },
      { lat: current.lat, lon: current.lon }
    );
  }
  return total;
}

/**
 * Builds a loop of roughly `distanceKm` starting and ending at `start`:
 * several candidate circles are routed with via-detour trimming, scored for
 * distance accuracy and athlete comfort, and the best one is returned with
 * any distinct runner-ups. `seed` rotates the candidates so "New variation"
 * yields a different loop.
 */
export async function synthesizeLoop(
  start: RouteWaypoint,
  distanceKm: number,
  preferences: RoutePreferences,
  seed?: number,
  deps: BrouterDeps = {}
): Promise<LoopPlan> {
  return planLoop({
    start,
    distanceMeters: distanceKm * 1000,
    preferences,
    seed,
    route: (waypoints) =>
      routeViaBrouter(waypoints, preferences, { ...deps, trimViaDetours: true }),
    availableRequests: availableBrouterRequests
  });
}

function describeBrouterError(status: number, details: string): string {
  const trimmed = details.trim();
  if (/target.*island|position not mapped|no.*route|no track found/i.test(trimmed)) {
    return "No path was found near one of your points. Move it closer to a road or trail, or switch the sport.";
  }
  if (/datafile.*not found|segment.*not.*found/i.test(trimmed)) {
    return "Routing data isn't available for this area yet.";
  }
  if (status === 500 && trimmed) {
    return `Routing failed: ${trimmed.slice(0, 160)}`;
  }
  return `Routing service error: ${status}${trimmed ? ` – ${trimmed.slice(0, 160)}` : ""}`;
}
