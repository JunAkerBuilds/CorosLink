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
const VISIT_CONCURRENCY = 3;
/** Cap cached track points per activity to keep memory bounded. */
const MAX_CACHED_ROUTE_POINTS = 280;
/** ~0.5° geographic grid for visit density (~55 km). */
const GEO_HEAT_STEP = 0.5;

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
  VISIT_CACHE.set(activityId, point);
}

export function rememberActivityRoute(
  activityId: string,
  points: GlobePoint[] | null,
): void {
  if (!points || points.length < 2) {
    ROUTE_CACHE.set(activityId, null);
    return;
  }
  ROUTE_CACHE.set(activityId, sampleGlobePoints(points));
}

export function rememberActivityGeo(
  activityId: string,
  detail: TrainingHubActivityDetail | null | undefined,
): { centroid: GlobePoint | null; route: GlobePoint[] | null } {
  const track = extractTrackPoints(detail);
  const centroid =
    track.length >= 2
      ? {
          lat: track.reduce((sum, point) => sum + point.lat, 0) / track.length,
          lon: track.reduce((sum, point) => sum + point.lon, 0) / track.length,
        }
      : null;
  const route = track.length >= 2 ? sampleGlobePoints(track) : null;
  VISIT_CACHE.set(activityId, centroid);
  ROUTE_CACHE.set(activityId, route);
  return { centroid, route };
}

export function getCachedVisitCentroid(
  activityId: string,
): GlobePoint | null | undefined {
  return VISIT_CACHE.get(activityId);
}

export function getCachedVisitPoints(
  activities: TrainingHubActivity[],
): ActivityVisitPoint[] {
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
