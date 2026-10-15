import type {
  RouteInsights,
  RouteProfileSource,
  RouteSurfaceType,
  RouteWayType,
  TrainingHubTrackPoint
} from "../types";

/**
 * Turns BRouter's per-segment `messages` table into the athlete-facing
 * breakdown (way types, surfaces, retraced distance). Pure and
 * dependency-free so the script tests can exercise it without Electron.
 */

export interface RouteSegment {
  distanceMeters: number;
  tags: Record<string, string>;
}

/**
 * BRouter's GeoJSON `properties.messages` is a header row followed by one row
 * per way change; `WayTags` is a space-separated `key=value` list of the tags
 * the profile reads.
 */
export function parseBrouterSegments(messages: unknown): RouteSegment[] {
  if (!Array.isArray(messages) || messages.length < 2) {
    return [];
  }
  const header = messages[0];
  if (!Array.isArray(header)) {
    return [];
  }
  const distanceIndex = header.indexOf("Distance");
  const tagsIndex = header.indexOf("WayTags");
  if (distanceIndex < 0 || tagsIndex < 0) {
    return [];
  }

  const segments: RouteSegment[] = [];
  for (const row of messages.slice(1)) {
    if (!Array.isArray(row)) {
      continue;
    }
    const distanceMeters = Number(row[distanceIndex]);
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      continue;
    }
    segments.push({ distanceMeters, tags: parseWayTags(String(row[tagsIndex] ?? "")) });
  }
  return segments;
}

export function parseWayTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of raw.split(/\s+/)) {
    const separator = pair.indexOf("=");
    if (separator > 0) {
      tags[pair.slice(0, separator)] = pair.slice(separator + 1);
    }
  }
  return tags;
}

const MAIN_ROADS = new Set([
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "primary",
  "primary_link",
  "trunk",
  "trunk_link"
]);
const QUIET_STREETS = new Set(["residential", "living_street", "unclassified", "road"]);
const PARKING_SERVICES = new Set(["parking_aisle", "parking", "driveway", "drive-through"]);
const PAVED_SURFACES = new Set([
  "paved",
  "asphalt",
  "concrete",
  "paving_stones",
  "sett",
  "cobblestone",
  "metal",
  "wood"
]);
const GRAVEL_SURFACES = new Set([
  "compacted",
  "fine_gravel",
  "gravel",
  "pebblestone",
  "unpaved",
  "grass_paver"
]);
const NATURAL_SURFACES = new Set([
  "ground",
  "dirt",
  "earth",
  "grass",
  "mud",
  "sand",
  "rock",
  "stone",
  "clay"
]);
/** Ways that are paved by convention when OSM omits `surface`. */
const IMPLICITLY_PAVED = new Set([
  ...MAIN_ROADS,
  ...QUIET_STREETS,
  "service",
  "cycleway",
  "pedestrian",
  "steps"
]);

function hasSidewalk(tags: Record<string, string>): boolean {
  return (
    /^(yes|both|left|right)$/.test(tags.sidewalk ?? "") ||
    tags["sidewalk:both"] === "yes" ||
    /^(yes|designated)$/.test(tags["sidewalk:left"] ?? "") ||
    /^(yes|designated)$/.test(tags["sidewalk:right"] ?? "")
  );
}

export function classifySurface(tags: Record<string, string>): RouteSurfaceType {
  const surface = tags.surface;
  if (surface) {
    if (PAVED_SURFACES.has(surface)) return "paved";
    if (GRAVEL_SURFACES.has(surface)) return "gravel";
    if (NATURAL_SURFACES.has(surface)) return "natural";
    return "unknown";
  }
  const highway = tags.highway ?? "";
  if (highway === "track") {
    if (tags.tracktype === "grade1") return "paved";
    if (tags.tracktype === "grade2") return "gravel";
    if (tags.tracktype) return "natural";
    return "unknown";
  }
  if (IMPLICITLY_PAVED.has(highway)) return "paved";
  if (highway === "footway" && /^(sidewalk|crossing)$/.test(tags.footway ?? "")) {
    return "paved";
  }
  return "unknown";
}

export function classifyWay(
  tags: Record<string, string>,
  cycling: boolean
): RouteWayType {
  const highway = tags.highway ?? "";
  if (highway === "steps") return "steps";
  if (highway === "cycleway") return "cycleway";
  if (highway === "service") {
    return PARKING_SERVICES.has(tags.service ?? "") ? "parkingLot" : "serviceRoad";
  }
  if (QUIET_STREETS.has(highway)) return "quietStreet";
  if (MAIN_ROADS.has(highway)) {
    // Tertiary roads are the backbone of a road ride; only bigger ones count
    // as busy for cyclists, while runners care whether there is a sidewalk.
    if (cycling) {
      return highway.startsWith("tertiary") ? "quietStreet" : "busyRoad";
    }
    return hasSidewalk(tags) ? "sidewalk" : "busyRoad";
  }
  if (highway === "footway" && /^(sidewalk|crossing)$/.test(tags.footway ?? "")) {
    return "sidewalk";
  }
  if (highway === "footway" || highway === "pedestrian" || highway === "path" ||
      highway === "track" || highway === "bridleway") {
    const surface = classifySurface(tags);
    if (surface === "paved") return "path";
    if (surface === "unknown" && (highway === "footway" || highway === "pedestrian")) return "path";
    return "trail";
  }
  return "other";
}

const RETRACE_PRECISION = 1e5;

function pointKey(point: TrainingHubTrackPoint): string | null {
  if (point.lat === undefined || point.lon === undefined) {
    return null;
  }
  return `${Math.round(point.lat * RETRACE_PRECISION)},${Math.round(point.lon * RETRACE_PRECISION)}`;
}

function segmentMeters(a: TrainingHubTrackPoint, b: TrainingHubTrackPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat! - a.lat!) * toRad;
  const dLon = (b.lon! - a.lon!) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat! * toRad) * Math.cos(b.lat! * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Metres travelled over a segment already covered earlier (either direction).
 * Routers return identical vertices for an out-and-back, so ~1 m rounding is
 * enough to match them; the first pass over a segment is free.
 */
export function retracedMeters(points: TrainingHubTrackPoint[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = pointKey(points[index - 1]!);
    const end = pointKey(points[index]!);
    if (!start || !end || start === end) {
      continue;
    }
    const key = start < end ? `${start}|${end}` : `${end}|${start}`;
    if (seen.has(key)) {
      total += segmentMeters(points[index - 1]!, points[index]!);
    } else {
      seen.add(key);
    }
  }
  return total;
}

export function buildRouteInsights(
  segments: RouteSegment[],
  points: TrainingHubTrackPoint[],
  cycling: boolean,
  profile: RouteProfileSource
): RouteInsights {
  const wayTypes: Partial<Record<RouteWayType, number>> = {};
  const surfaces: Partial<Record<RouteSurfaceType, number>> = {};
  for (const segment of segments) {
    const way = classifyWay(segment.tags, cycling);
    const surface = classifySurface(segment.tags);
    wayTypes[way] = (wayTypes[way] ?? 0) + segment.distanceMeters;
    surfaces[surface] = (surfaces[surface] ?? 0) + segment.distanceMeters;
  }
  return {
    wayTypes: roundValues(wayTypes),
    surfaces: roundValues(surfaces),
    retracedMeters: Math.round(retracedMeters(points)),
    profile
  };
}

function roundValues<K extends string>(
  values: Partial<Record<K, number>>
): Partial<Record<K, number>> {
  const rounded: Partial<Record<K, number>> = {};
  for (const [key, value] of Object.entries(values) as Array<[K, number]>) {
    const metres = Math.round(value);
    if (metres > 0) {
      rounded[key] = metres;
    }
  }
  return rounded;
}

/** Share of the classified distance that falls on the given way types (0–1). */
export function wayShare(
  insights: RouteInsights | undefined,
  types: RouteWayType[]
): number {
  if (!insights) {
    return 0;
  }
  const total = Object.values(insights.wayTypes).reduce((sum, value) => sum + (value ?? 0), 0);
  if (total <= 0) {
    return 0;
  }
  const matched = types.reduce((sum, type) => sum + (insights.wayTypes[type] ?? 0), 0);
  return matched / total;
}

/** Share of the classified distance on the given surfaces (0–1). */
export function surfaceShare(
  insights: RouteInsights | undefined,
  types: RouteSurfaceType[]
): number {
  if (!insights) {
    return 0;
  }
  const total = Object.values(insights.surfaces).reduce((sum, value) => sum + (value ?? 0), 0);
  if (total <= 0) {
    return 0;
  }
  const matched = types.reduce((sum, type) => sum + (insights.surfaces[type] ?? 0), 0);
  return matched / total;
}
