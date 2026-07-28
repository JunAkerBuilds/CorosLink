import type {
  ActivityPaceBaseline,
  GeneratedRoute,
  RouteActivityType,
  RouteElevationPreference,
  TrainingHubTrackPoint
} from "../../../electron/types";
import { ROUTE_ACTIVITY_OPTIONS } from "./constants";
import type { UnitSystem } from "../../../electron/types";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation,
  secondsPerKmToDisplayPace,
  speedUnit
} from "../../units/units";

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isCyclingActivity(activityType: RouteActivityType): boolean {
  return activityType.startsWith("cycling");
}

export function activityTypeLabel(activityType: RouteActivityType): string {
  return (
    ROUTE_ACTIVITY_OPTIONS.find((option) => option.value === activityType)
      ?.label ?? activityType
  );
}

export function maxDistanceForActivity(activityType: RouteActivityType): number {
  return isCyclingActivity(activityType) ? 300 : 100;
}

export function surfaceForActivity(
  activityType: RouteActivityType
): "road" | "trail" {
  return activityType === "hiking" || activityType === "cycling-mountain"
    ? "trail"
    : "road";
}

export function formatDistance(
  meters: number | undefined,
  unitSystem: UnitSystem
): string {
  if (meters === undefined || !Number.isFinite(meters)) {
    return "—";
  }
  return metersToDisplayDistance(meters, unitSystem).toFixed(1);
}

export function formatDuration(value?: number): string {
  if (!value || !Number.isFinite(value)) {
    return "—";
  }
  const minutes = Math.round(value / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${minutes}m`;
}

export function formatMeters(
  value: number | undefined,
  unitSystem: UnitSystem
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(metersToElevation(value, unitSystem))} ${elevationUnit(unitSystem)}`;
}

export function formatElevationPreference(
  preference: RouteElevationPreference
): string {
  switch (preference) {
    case "flatter":
      return "Prefer flatter";
    case "hilly":
      return "Prefer hilly";
    default:
      return "Any elevation";
  }
}

/**
 * Moving-time estimate. Foot "running" routes are personalised from the user's
 * COROS pace when available, else a 6:00/km model; other sports use the routing
 * engine's own duration.
 */
export function effectiveRouteDuration(
  route: Pick<
    GeneratedRoute,
    "distanceMeters" | "ascentMeters" | "activityType" | "durationSeconds"
  >,
  baseline: ActivityPaceBaseline | undefined
): { seconds: number | undefined; estimated: boolean; fromHistory: boolean } {
  const distanceKm = route.distanceMeters / 1000;
  const climbSeconds =
    (route.ascentMeters ?? 0) * (isCyclingActivity(route.activityType) ? 4 : 6);

  if (baseline && distanceKm > 0) {
    return {
      seconds: Math.round(baseline.secondsPerKm * distanceKm + climbSeconds),
      estimated: true,
      fromHistory: true
    };
  }

  if (route.activityType === "running" && distanceKm > 0) {
    return {
      seconds: Math.round(360 * distanceKm + climbSeconds),
      estimated: true,
      fromHistory: false
    };
  }

  return { seconds: route.durationSeconds, estimated: false, fromHistory: false };
}

/** Average pace (min/km) for foot sports, or average speed (km/h) for cycling. */
export function formatPaceOrSpeed(
  route: Pick<GeneratedRoute, "distanceMeters" | "activityType">,
  durationSeconds: number | undefined,
  unitSystem: UnitSystem
): string | null {
  const distanceKm = route.distanceMeters / 1000;
  if (!durationSeconds || durationSeconds <= 0 || distanceKm <= 0) {
    return null;
  }
  if (isCyclingActivity(route.activityType)) {
    const speed = distanceKm / (durationSeconds / 3600);
    const displaySpeed = unitSystem === "imperial" ? speed / 1.609344 : speed;
    return `${displaySpeed.toFixed(1)} ${speedUnit(unitSystem)}`;
  }
  const rounded = Math.round(
    secondsPerKmToDisplayPace(durationSeconds / distanceKm, unitSystem)
  );
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} /${distanceUnit(unitSystem)}`;
}

export function climbRatePerKm(
  route: Pick<GeneratedRoute, "distanceMeters" | "ascentMeters">
): number | undefined {
  const distanceKm = route.distanceMeters / 1000;
  if (distanceKm <= 0 || route.ascentMeters === undefined) {
    return undefined;
  }
  return route.ascentMeters / distanceKm;
}

export function difficultyFromClimbRate(metersPerKm: number): string {
  if (metersPerKm < 10) return "Flat";
  if (metersPerKm < 25) return "Rolling";
  if (metersPerKm < 50) return "Hilly";
  return "Steep";
}

export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const radius = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export interface ElevationProfile {
  linePoints: string;
  areaPoints: string;
  minEle: number;
  maxEle: number;
}

/**
 * Builds an SVG elevation profile (elevation vs. cumulative distance) normalized
 * to a 100×32 viewBox. Returns null when there isn't enough variation to plot.
 */
export function buildElevationProfile(
  points: TrainingHubTrackPoint[]
): ElevationProfile | null {
  const valid = points.filter(
    (point) =>
      point.lat !== undefined &&
      point.lon !== undefined &&
      point.elevation !== undefined
  );
  if (valid.length < 2) {
    return null;
  }

  const distances = [0];
  for (let index = 1; index < valid.length; index += 1) {
    const previous = valid[index - 1]!;
    const current = valid[index]!;
    distances.push(
      distances[index - 1]! +
        haversineMeters(previous.lat!, previous.lon!, current.lat!, current.lon!)
    );
  }

  const total = distances[distances.length - 1]!;
  const elevations = valid.map((point) => point.elevation as number);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  if (total <= 0 || maxEle - minEle < 2) {
    return null;
  }

  const range = maxEle - minEle;
  const linePoints = valid
    .map((point, index) => {
      const x = (distances[index]! / total) * 100;
      const y = 31 - ((point.elevation! - minEle) / range) * 30;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return {
    linePoints,
    areaPoints: `0,32 ${linePoints} 100,32`,
    minEle,
    maxEle
  };
}
