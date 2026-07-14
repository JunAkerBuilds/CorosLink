import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubTrackPoint,
} from "../../electron/types";

export interface GlobePoint {
  lat: number;
  lon: number;
}

export interface ActivityVisitPoint extends GlobePoint {
  activityId: string;
}

/** Downsampled GPS track for one activity (street-map polylines). */
export interface ActivityRoutePolyline {
  activityId: string;
  points: GlobePoint[];
}

export interface OverallActivityStats {
  count: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  totalElevationMeters: number;
  totalTrainingLoad: number;
  totalCalories: number;
}

export interface GeoHeatBucket {
  key: string;
  lat: number;
  lon: number;
  count: number;
}

const VISIT_CACHE = new Map<string, GlobePoint | null>();
const ROUTE_CACHE = new Map<string, GlobePoint[] | null>();
const MAX_VISIT_ACTIVITIES = 20;
const VISIT_CONCURRENCY = 5;
/** Cap cached track points per activity to keep memory bounded. */
const MAX_CACHED_ROUTE_POINTS = 280;
/** Keep only recent, downsampled coordinates in the renderer's local storage. */
const MAX_PERSISTED_GEO_ACTIVITIES = 80;
const GEO_CACHE_STORAGE_KEY = "coroslink.activity-globe.geo-cache.v1";
/** ~0.5° geographic grid for visit density (~55 km). */
const GEO_HEAT_STEP = 0.5;

interface PersistedGeoRecord {
  activityId: string;
  visit?: GlobePoint | null;
  route?: GlobePoint[] | null;
}

interface PersistedGeoCache {
  version: 1;
  records: PersistedGeoRecord[];
}

let geoCacheHydrated = false;
let geoCacheWriteScheduled = false;

function isStoredGlobePoint(value: unknown): value is GlobePoint {
  if (!value || typeof value !== "object") {
    return false;
  }
  const point = value as Partial<GlobePoint>;
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 &&
    typeof point.lon === "number" &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180
  );
}

function hydrateGeoCache(): void {
  if (geoCacheHydrated) {
    return;
  }
  geoCacheHydrated = true;
  if (typeof window === "undefined") {
    return;
  }

  try {
    const stored = window.localStorage.getItem(GEO_CACHE_STORAGE_KEY);
    if (!stored) {
      return;
    }
    const parsed = JSON.parse(stored) as Partial<PersistedGeoCache>;
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return;
    }
    for (const record of parsed.records.slice(-MAX_PERSISTED_GEO_ACTIVITIES)) {
      if (!record || typeof record.activityId !== "string") {
        continue;
      }
      if (record.visit === null || isStoredGlobePoint(record.visit)) {
        VISIT_CACHE.set(record.activityId, record.visit);
      }
      if (record.route === null) {
        ROUTE_CACHE.set(record.activityId, null);
      } else if (Array.isArray(record.route)) {
        const route = record.route
          .filter(isStoredGlobePoint)
          .slice(0, MAX_CACHED_ROUTE_POINTS);
        ROUTE_CACHE.set(record.activityId, route.length >= 2 ? route : null);
      }
    }
  } catch {
    // Storage is best-effort; a corrupt or unavailable cache must not block UI.
  }
}

function persistGeoCache(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const activityIds = Array.from(
      new Set([...VISIT_CACHE.keys(), ...ROUTE_CACHE.keys()]),
    ).slice(-MAX_PERSISTED_GEO_ACTIVITIES);
    const records = activityIds.map<PersistedGeoRecord>((activityId) => ({
      activityId,
      ...(VISIT_CACHE.has(activityId)
        ? { visit: VISIT_CACHE.get(activityId) ?? null }
        : {}),
      ...(ROUTE_CACHE.has(activityId)
        ? { route: ROUTE_CACHE.get(activityId) ?? null }
        : {}),
    }));
    const payload: PersistedGeoCache = { version: 1, records };
    window.localStorage.setItem(GEO_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota and privacy settings can disable storage; memory cache still works.
  }
}

function scheduleGeoCacheWrite(): void {
  if (geoCacheWriteScheduled || typeof window === "undefined") {
    return;
  }
  geoCacheWriteScheduled = true;
  const write = () => {
    geoCacheWriteScheduled = false;
    persistGeoCache();
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(write, { timeout: 1_500 });
  } else {
    window.setTimeout(write, 400);
  }
}

function rememberCacheEntry<T>(
  cache: Map<string, T>,
  activityId: string,
  value: T,
): void {
  cache.delete(activityId);
  cache.set(activityId, value);
}

export function geoHeatBucketKey(point: GlobePoint): string {
  const latKey = Math.round(point.lat / GEO_HEAT_STEP);
  const lonKey = Math.round(point.lon / GEO_HEAT_STEP);
  return `${latKey}:${lonKey}`;
}

export function isGlobePoint(
  point: TrainingHubTrackPoint,
): point is GlobePoint {
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 &&
    typeof point.lon === "number" &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180
  );
}

export function sampleGlobePoints(
  points: GlobePoint[],
  maxPoints = MAX_CACHED_ROUTE_POINTS,
): GlobePoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = points.length / maxPoints;
  return Array.from(
    { length: maxPoints },
    (_, index) => points[Math.floor(index * step)]!,
  );
}

export function extractTrackPoints(
  detail: TrainingHubActivityDetail | null | undefined,
): GlobePoint[] {
  return (detail?.track?.points ?? []).filter(isGlobePoint);
}

export function extractCentroid(
  detail: TrainingHubActivityDetail | null | undefined,
): GlobePoint | null {
  const points = extractTrackPoints(detail);
  if (points.length < 2) {
    return null;
  }

  let latSum = 0;
  let lonSum = 0;
  for (const point of points) {
    latSum += point.lat;
    lonSum += point.lon;
  }

  return {
    lat: latSum / points.length,
    lon: lonSum / points.length,
  };
}

export function rememberVisitCentroid(
  activityId: string,
  point: GlobePoint | null,
): void {
  hydrateGeoCache();
  rememberCacheEntry(VISIT_CACHE, activityId, point);
  scheduleGeoCacheWrite();
}

export function rememberActivityRoute(
  activityId: string,
  points: GlobePoint[] | null,
): void {
  hydrateGeoCache();
  if (!points || points.length < 2) {
    rememberCacheEntry(ROUTE_CACHE, activityId, null);
    scheduleGeoCacheWrite();
    return;
  }
  rememberCacheEntry(ROUTE_CACHE, activityId, sampleGlobePoints(points));
  scheduleGeoCacheWrite();
}

export function rememberActivityGeo(
  activityId: string,
  detail: TrainingHubActivityDetail | null | undefined,
): { centroid: GlobePoint | null; route: GlobePoint[] | null } {
  hydrateGeoCache();
  const track = extractTrackPoints(detail);
  const centroid =
    track.length >= 2
      ? {
          lat: track.reduce((sum, point) => sum + point.lat, 0) / track.length,
          lon: track.reduce((sum, point) => sum + point.lon, 0) / track.length,
        }
      : null;
  const route = track.length >= 2 ? sampleGlobePoints(track) : null;
  rememberCacheEntry(VISIT_CACHE, activityId, centroid);
  rememberCacheEntry(ROUTE_CACHE, activityId, route);
  scheduleGeoCacheWrite();
  return { centroid, route };
}

export function getCachedVisitCentroid(
  activityId: string,
): GlobePoint | null | undefined {
  hydrateGeoCache();
  return VISIT_CACHE.get(activityId);
}

export function getCachedVisitPoints(
  activities: TrainingHubActivity[],
): ActivityVisitPoint[] {
  hydrateGeoCache();
  const visits: ActivityVisitPoint[] = [];
  for (const activity of activities) {
    const cached = VISIT_CACHE.get(activity.activityId);
    if (cached) {
      visits.push({
        activityId: activity.activityId,
        lat: cached.lat,
        lon: cached.lon,
      });
    }
  }
  return visits;
}

export function getCachedRoutePolylines(
  activities: TrainingHubActivity[],
): ActivityRoutePolyline[] {
  hydrateGeoCache();
  const routes: ActivityRoutePolyline[] = [];
  for (const activity of activities) {
    const cached = ROUTE_CACHE.get(activity.activityId);
    if (cached && cached.length >= 2) {
      routes.push({
        activityId: activity.activityId,
        points: cached,
      });
    }
  }
  return routes;
}

export function aggregateActivityStats(
  activities: TrainingHubActivity[],
): OverallActivityStats {
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  let totalElevationMeters = 0;
  let totalTrainingLoad = 0;
  let totalCalories = 0;

  for (const activity of activities) {
    if (typeof activity.distance === "number" && Number.isFinite(activity.distance)) {
      totalDistanceMeters += activity.distance;
    }
    if (typeof activity.duration === "number" && Number.isFinite(activity.duration)) {
      totalDurationSeconds += activity.duration;
    }
    if (
      typeof activity.elevationGain === "number" &&
      Number.isFinite(activity.elevationGain)
    ) {
      totalElevationMeters += activity.elevationGain;
    }
    if (
      typeof activity.trainingLoad === "number" &&
      Number.isFinite(activity.trainingLoad)
    ) {
      totalTrainingLoad += activity.trainingLoad;
    }
    if (typeof activity.calories === "number" && Number.isFinite(activity.calories)) {
      totalCalories += activity.calories;
    }
  }

  return {
    count: activities.length,
    totalDistanceMeters,
    totalDurationSeconds,
    totalElevationMeters,
    totalTrainingLoad,
    totalCalories,
  };
}

export function bucketVisitsGeographically(
  visits: GlobePoint[],
): GeoHeatBucket[] {
  if (visits.length === 0) {
    return [];
  }

  const buckets = new Map<string, GeoHeatBucket>();
  for (const visit of visits) {
    const key = geoHeatBucketKey(visit);
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.lat = (existing.lat * (existing.count - 1) + visit.lat) / existing.count;
      existing.lon = (existing.lon * (existing.count - 1) + visit.lon) / existing.count;
    } else {
      buckets.set(key, {
        key,
        lat: visit.lat,
        lon: visit.lon,
        count: 1,
      });
    }
  }

  return Array.from(buckets.values());
}

export function formatOverallDuration(totalSeconds: number): {
  value: string;
  unit: string;
} {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return { value: String(minutes), unit: "min" };
  }

  const hours = seconds / 3600;
  if (hours < 10) {
    return { value: hours.toFixed(1), unit: "h" };
  }

  return { value: String(Math.round(hours)), unit: "h" };
}

export function formatOverallDistance(meters: number): {
  value: string;
  unit: string;
} {
  const km = meters / 1000;
  if (km >= 100) {
    return { value: String(Math.round(km)), unit: "km" };
  }
  if (km >= 10) {
    return { value: km.toFixed(1), unit: "km" };
  }
  return { value: km.toFixed(2), unit: "km" };
}

type DetailFetcher = (
  activityId: string,
  sportType: number,
  listActivity?: TrainingHubActivity,
) => Promise<TrainingHubActivityDetail>;

function emitCachedRoute(
  activityId: string,
  onRoute?: (route: ActivityRoutePolyline) => void,
): void {
  const cached = ROUTE_CACHE.get(activityId);
  if (cached && cached.length >= 2) {
    onRoute?.({ activityId, points: cached });
  }
}

export async function loadActivityVisitCentroids(
  activities: TrainingHubActivity[],
  fetchDetail: DetailFetcher,
  options?: {
    limit?: number;
    concurrency?: number;
    signal?: AbortSignal;
    onVisit?: (visit: ActivityVisitPoint) => void;
    onRoute?: (route: ActivityRoutePolyline) => void;
  },
): Promise<ActivityVisitPoint[]> {
  hydrateGeoCache();
  const limit = options?.limit ?? MAX_VISIT_ACTIVITIES;
  const concurrency = options?.concurrency ?? VISIT_CONCURRENCY;
  const signal = options?.signal;
  const candidates = activities.slice(0, limit);
  const visits: ActivityVisitPoint[] = [];

  let index = 0;

  async function worker(): Promise<void> {
    while (index < candidates.length) {
      if (signal?.aborted) {
        return;
      }

      const current = index;
      index += 1;
      const activity = candidates[current]!;
      const cachedVisit = VISIT_CACHE.get(activity.activityId);
      const cachedRoute = ROUTE_CACHE.get(activity.activityId);
      // Both caches filled (including null miss) — reuse without refetching.
      if (cachedVisit !== undefined && cachedRoute !== undefined) {
        if (cachedVisit) {
          const visit = {
            activityId: activity.activityId,
            lat: cachedVisit.lat,
            lon: cachedVisit.lon,
          };
          visits.push(visit);
          options?.onVisit?.(visit);
        }
        emitCachedRoute(activity.activityId, options?.onRoute);
        continue;
      }

      try {
        const detail = await fetchDetail(
          activity.activityId,
          activity.sportType,
          activity,
        );
        if (signal?.aborted) {
          return;
        }

        const { centroid, route } = rememberActivityGeo(
          activity.activityId,
          detail,
        );
        if (centroid) {
          const visit = {
            activityId: activity.activityId,
            ...centroid,
          };
          visits.push(visit);
          options?.onVisit?.(visit);
        }
        if (route && route.length >= 2) {
          options?.onRoute?.({
            activityId: activity.activityId,
            points: route,
          });
        }
      } catch {
        // Skip failed lookups; never block the globe on one activity.
        VISIT_CACHE.set(activity.activityId, null);
        ROUTE_CACHE.set(activity.activityId, null);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, candidates.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return visits;
}
