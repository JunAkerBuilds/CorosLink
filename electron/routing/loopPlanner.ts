import type {
  RouteActivityType,
  RouteElevationPreference,
  RouteGeometry,
  RouteSurfacePreference,
  RouteWaypoint,
  TrainingHubTrackPoint
} from "../types";
import { surfaceShare, wayShare } from "./routeInsights";

/**
 * Loop generation for the keyless router. BRouter has no usable round-trip
 * primitive for our profiles, so we lay via points on a circle that passes
 * through the start (not centred on it, which forces an out-and-back to the
 * rim), route a few rotations in parallel, score each candidate the way an
 * athlete would judge it, then spend a small request budget rerouting around
 * out-and-back spurs and nudging the radius toward the target distance.
 * The winner comes back with up to two distinct runner-ups to choose from.
 * Routing is injected so tests can run without the network.
 */

export interface LoopPreferences {
  activityType: RouteActivityType;
  surface: RouteSurfacePreference;
  elevation: RouteElevationPreference;
}

export interface LoopPlanRequest {
  start: RouteWaypoint;
  distanceMeters: number;
  preferences: LoopPreferences;
  /** Rotates the candidate fan so "New variation" yields a different loop. */
  seed?: number;
  route: (waypoints: RouteWaypoint[]) => Promise<RouteGeometry>;
  /** Routing requests the caller can spend right now; improvements stop near zero. */
  availableRequests?: () => number;
}

export interface LoopCandidateShape {
  bearing: number;
  radiusMeters: number;
  clockwise: boolean;
  viaCount: number;
  /** Via indexes (0-based, along the circle) dropped to repair a spur. */
  skipVias?: number[];
}

export interface LoopPlan {
  geometry: RouteGeometry;
  /**
   * Up to two runner-up loops from the same requests, best first: each
   * close to the target distance and on mostly different streets.
   */
  alternatives: RouteGeometry[];
}

/** An out-and-back the route makes and returns from, e.g. on opposite sidewalks. */
export interface RouteSpur {
  startIndex: number;
  endIndex: number;
  lengthMeters: number;
  tip: RouteWaypoint;
}

const EARTH_RADIUS_M = 6_371_000;
/** Within this fraction of the target a candidate pays no distance penalty. */
const FREE_DISTANCE_ERROR = 0.03;
/** Refine the radius while the best loop is further off than this. */
const REFINE_DISTANCE_ERROR = 0.03;
const FIRST_ROUND_BEARINGS = [0, 120, 240];
/**
 * Requests per improvement round after the first (spur repair or radius
 * correction). brouter.de throttles bursts, so a loop stays within six.
 */
const IMPROVEMENT_ROUND_WIDTHS = [2, 1];
/** Leave the user this many requests for their next edit before improving. */
const RESERVED_REQUESTS = 4;
/** Spur ends can sit on opposite sidewalks of a wide arterial. */
const SPUR_MAX_GAP_METERS = 45;
const SPUR_MIN_LENGTH_METERS = 120;
/**
 * Enclosed area divided by half the spur's length, which is roughly the gap
 * between the two legs: ~10-35 m for an out-and-back on two sidewalks, far
 * larger for a genuine loop or block.
 */
const SPUR_MAX_WIDTH_METERS = 35;
/** Only reroute around spurs long enough for an athlete to mind. */
const SPUR_REPAIR_MIN_METERS = 150;
const SPUR_REPAIR_VIA_RADIUS_METERS = 300;
const MAX_ALTERNATIVES = 2;
/** Runner-ups must still be the loop the athlete asked for... */
const ALTERNATIVE_MAX_DISTANCE_ERROR = 0.12;
/** ...on mostly different streets from every loop already offered... */
const ALTERNATIVE_MAX_SHARED_SHARE = 0.7;
/** ...and not clearly worse than the winner (e.g. a fifth of it in parking lots). */
const ALTERNATIVE_MAX_SCORE_GAP = 1.5;
/** Opposite sidewalks of one street count as the same way. */
const SHARED_TOLERANCE_METERS = 25;
const SHARED_SAMPLE_METERS = 10;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function offsetPoint(
  origin: RouteWaypoint,
  bearingDegrees: number,
  distanceM: number
): RouteWaypoint {
  const bearing = toRadians(bearingDegrees);
  const dLat = ((distanceM * Math.cos(bearing)) / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon =
    ((distanceM * Math.sin(bearing)) /
      (EARTH_RADIUS_M * Math.cos(toRadians(origin.lat)))) *
    (180 / Math.PI);
  return { lat: origin.lat + dLat, lon: origin.lon + dLon };
}

/** Road distance per metre of circle; trimmed via detours keep this modest. */
function detourFactor(activityType: RouteActivityType): number {
  return activityType.startsWith("cycling") ? 1.2 : 1.25;
}

function viaCountFor(distanceMeters: number): number {
  if (distanceMeters < 6_000) return 3;
  if (distanceMeters < 15_000) return 4;
  if (distanceMeters < 40_000) return 5;
  return 6;
}

/**
 * Start → vias around a circle whose rim passes through the start → start.
 * The circle centre sits `radius` metres from the start along `bearing`.
 */
export function loopWaypoints(
  start: RouteWaypoint,
  shape: LoopCandidateShape
): RouteWaypoint[] {
  const center = offsetPoint(start, shape.bearing, shape.radiusMeters);
  const startAngle = shape.bearing + 180;
  const step = 360 / (shape.viaCount + 1);
  const vias: RouteWaypoint[] = [];
  for (let index = 1; index <= shape.viaCount; index += 1) {
    if (shape.skipVias?.includes(index - 1)) {
      continue;
    }
    const angle = startAngle + (shape.clockwise ? 1 : -1) * step * index;
    vias.push(offsetPoint(center, angle, shape.radiusMeters));
  }
  return [start, ...vias, start];
}

/**
 * Finds out-and-back spurs: stretches that leave and come back to within
 * SPUR_MAX_GAP_METERS of where they started while enclosing almost no area.
 * BRouter's via-detour trimming only catches same-way returns; this also
 * catches the common "up one sidewalk, back down the other" spur. Uses a
 * grid for candidate pairs and prefix shoelace sums for O(1) area checks.
 */
export function findSpurs(points: TrainingHubTrackPoint[]): RouteSpur[] {
  const valid = points.filter(
    (point): point is TrainingHubTrackPoint & RouteWaypoint =>
      point.lat !== undefined && point.lon !== undefined
  );
  const count = valid.length;
  if (count < 4) {
    return [];
  }
  const origin = valid[0]!;
  const metersPerLon = 111_320 * Math.cos(toRadians(origin.lat));
  const xs = valid.map((point) => (point.lon - origin.lon) * metersPerLon);
  const ys = valid.map((point) => (point.lat - origin.lat) * 111_320);
  const along = [0];
  const shoelace = [0];
  for (let index = 1; index < count; index += 1) {
    along.push(along[index - 1]! + Math.hypot(xs[index]! - xs[index - 1]!, ys[index]! - ys[index - 1]!));
    shoelace.push(
      shoelace[index - 1]! + (xs[index - 1]! * ys[index]! - xs[index]! * ys[index - 1]!)
    );
  }
  const total = along[count - 1]!;

  const cellOf = (index: number) =>
    [Math.floor(xs[index]! / SPUR_MAX_GAP_METERS), Math.floor(ys[index]! / SPUR_MAX_GAP_METERS)] as const;
  const grid = new Map<string, number[]>();
  const pairs: Array<{ start: number; end: number; length: number }> = [];

  for (let end = 0; end < count; end += 1) {
    const [cellX, cellY] = cellOf(end);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const start of grid.get(`${cellX + dx},${cellY + dy}`) ?? []) {
          const length = along[end]! - along[start]!;
          if (length < SPUR_MIN_LENGTH_METERS || length > total * 0.6) continue;
          if (Math.hypot(xs[end]! - xs[start]!, ys[end]! - ys[start]!) > SPUR_MAX_GAP_METERS) continue;
          const area =
            Math.abs(
              shoelace[end]! - shoelace[start]! + (xs[end]! * ys[start]! - xs[start]! * ys[end]!)
            ) / 2;
          if (area / (length / 2) <= SPUR_MAX_WIDTH_METERS) {
            pairs.push({ start, end, length });
          }
        }
      }
    }
    const key = `${cellX},${cellY}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(end);
    else grid.set(key, [end]);
  }

  // Keep the longest non-overlapping spurs.
  pairs.sort((a, b) => b.length - a.length);
  const spurs: RouteSpur[] = [];
  for (const pair of pairs) {
    if (spurs.some((spur) => pair.start <= spur.endIndex && pair.end >= spur.startIndex)) {
      continue;
    }
    const midway = along[pair.start]! + pair.length / 2;
    let tipIndex = pair.start;
    while (tipIndex < pair.end && along[tipIndex]! < midway) tipIndex += 1;
    spurs.push({
      startIndex: pair.start,
      endIndex: pair.end,
      lengthMeters: Math.round(pair.length),
      tip: { lat: valid[tipIndex]!.lat, lon: valid[tipIndex]!.lon }
    });
  }
  return spurs.sort((a, b) => a.startIndex - b.startIndex);
}

function spurMeters(geometry: RouteGeometry): number {
  return findSpurs(geometry.points).reduce((sum, spur) => sum + spur.lengthMeters, 0);
}

/**
 * Share (0–1) of `route`'s length that runs within SHARED_TOLERANCE_METERS of
 * `other`. Both tracks are resampled every SHARED_SAMPLE_METERS so long
 * straight segments with few vertices still compare fairly.
 */
export function sharedGeometryShare(
  route: TrainingHubTrackPoint[],
  other: TrainingHubTrackPoint[]
): number {
  const origin = route.find((point) => point.lat !== undefined && point.lon !== undefined);
  if (!origin) {
    return 0;
  }
  const metersPerLon = 111_320 * Math.cos(toRadians(origin.lat!));
  const project = (points: TrainingHubTrackPoint[]) =>
    points
      .filter((point) => point.lat !== undefined && point.lon !== undefined)
      .map((point) => [(point.lon! - origin.lon!) * metersPerLon, (point.lat! - origin.lat!) * 111_320] as const);

  const cellOf = (x: number, y: number) =>
    `${Math.floor(x / SHARED_TOLERANCE_METERS)},${Math.floor(y / SHARED_TOLERANCE_METERS)}`;
  const grid = new Map<string, Array<readonly [number, number]>>();
  const otherPoints = project(other);
  otherPoints.forEach(([x, y], index) => {
    const [nextX, nextY] = otherPoints[index + 1] ?? [x, y];
    const steps = Math.max(1, Math.ceil(Math.hypot(nextX - x, nextY - y) / SHARED_SAMPLE_METERS));
    for (let step = 0; step < steps; step += 1) {
      const sample = [x + ((nextX - x) * step) / steps, y + ((nextY - y) * step) / steps] as const;
      const key = cellOf(sample[0], sample[1]);
      const bucket = grid.get(key);
      if (bucket) bucket.push(sample);
      else grid.set(key, [sample]);
    }
  });
  const isNearOther = (x: number, y: number) => {
    const cellX = Math.floor(x / SHARED_TOLERANCE_METERS);
    const cellY = Math.floor(y / SHARED_TOLERANCE_METERS);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const [sampleX, sampleY] of grid.get(`${cellX + dx},${cellY + dy}`) ?? []) {
          if (Math.hypot(sampleX - x, sampleY - y) <= SHARED_TOLERANCE_METERS) return true;
        }
      }
    }
    return false;
  };

  const routePoints = project(route);
  let totalMeters = 0;
  let sharedMeters = 0;
  for (let index = 1; index < routePoints.length; index += 1) {
    const [x0, y0] = routePoints[index - 1]!;
    const [x1, y1] = routePoints[index]!;
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length / SHARED_SAMPLE_METERS));
    for (let step = 0; step < steps; step += 1) {
      // Judge each slice of the segment by its midpoint.
      const t = (step + 0.5) / steps;
      if (isNearOther(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) {
        sharedMeters += length / steps;
      }
    }
    totalMeters += length;
  }
  return totalMeters > 0 ? sharedMeters / totalMeters : 0;
}

/**
 * Picks runner-ups from candidates ranked best first (index 0 is the
 * winner): near the target distance, not clearly worse than the winner, and
 * mostly on different streets from the winner and from each other.
 */
export function pickAlternatives(
  ranked: Array<{ geometry: RouteGeometry; score: number }>,
  targetMeters: number
): RouteGeometry[] {
  const winner = ranked[0];
  if (!winner) {
    return [];
  }
  const offered = [winner.geometry];
  const alternatives: RouteGeometry[] = [];
  for (const candidate of ranked.slice(1)) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    const distanceError = Math.abs(candidate.geometry.distanceMeters - targetMeters) / targetMeters;
    if (distanceError > ALTERNATIVE_MAX_DISTANCE_ERROR) continue;
    if (candidate.score - winner.score > ALTERNATIVE_MAX_SCORE_GAP) continue;
    const distinct = offered.every(
      (loop) =>
        Math.max(
          sharedGeometryShare(candidate.geometry.points, loop.points),
          sharedGeometryShare(loop.points, candidate.geometry.points)
        ) < ALTERNATIVE_MAX_SHARED_SHARE
    );
    if (!distinct) continue;
    offered.push(candidate.geometry);
    alternatives.push(candidate.geometry);
  }
  return alternatives;
}

/** Stable pseudo-random rotation for a variation seed (golden-angle spread). */
export function bearingForSeed(seed: number | undefined): number {
  if (seed === undefined || !Number.isFinite(seed)) {
    return 0;
  }
  const mixed = Math.imul(Math.floor(seed) | 0, 0x9e3779b1) >>> 0;
  return mixed % 360;
}

/**
 * Lower is better. Distance accuracy dominates, then the things athletes
 * notice on the ground: retracing the same street, parking lots/driveways,
 * running on busy carriageways, and the surface/climb preferences.
 */
export function scoreLoop(
  geometry: RouteGeometry,
  targetMeters: number,
  preferences: LoopPreferences
): number {
  const distance = Math.max(1, geometry.distanceMeters);
  const distanceError = Math.abs(distance - targetMeters) / targetMeters;
  let score = 10 * Math.max(0, distanceError - FREE_DISTANCE_ERROR);

  const insights = geometry.insights;
  score += 2.5 * Math.min(1, (insights?.retracedMeters ?? 0) / distance);
  score += 4 * Math.min(1, spurMeters(geometry) / distance);
  score += 8 * wayShare(insights, ["parkingLot"]);
  score += 3 * wayShare(insights, ["busyRoad"]);
  score += 0.6 * wayShare(insights, ["serviceRoad"]);

  if (preferences.surface === "trail") {
    score += 1.2 * surfaceShare(insights, ["paved"]);
  } else if (preferences.surface === "road") {
    score += 0.8 * surfaceShare(insights, ["natural"]);
  }

  const climbPerKm = ((geometry.ascentMeters ?? 0) / distance) * 1000;
  const climbIntensity = Math.min(1, climbPerKm / 25);
  if (preferences.elevation === "hilly") {
    score -= 0.8 * climbIntensity;
  } else if (preferences.elevation === "flatter") {
    score += 0.8 * climbIntensity;
  }

  // A stock-profile fallback cannot see parking aisles; prefer athlete routes.
  if (insights?.profile === "standard") {
    score += 0.5;
  }
  return score;
}

interface ScoredCandidate {
  shape: LoopCandidateShape;
  geometry: RouteGeometry;
  score: number;
  distanceError: number;
}

export async function planLoop(request: LoopPlanRequest): Promise<LoopPlan> {
  const targetMeters = request.distanceMeters;
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) {
    throw new Error("Choose a loop distance greater than zero.");
  }
  const baseBearing = bearingForSeed(request.seed);
  const clockwise = Math.floor(baseBearing) % 2 === 0;
  const viaCount = viaCountFor(targetMeters);
  const baseRadius =
    targetMeters / (2 * Math.PI * detourFactor(request.preferences.activityType));

  // Every routed sample per shape family, for bracketing the radius.
  const samples = new Map<string, Array<{ radius: number; distance: number }>>();
  const familyKey = (shape: LoopCandidateShape) =>
    `${shape.bearing.toFixed(1)}|${(shape.skipVias ?? []).join(",")}`;

  const evaluate = async (shape: LoopCandidateShape): Promise<ScoredCandidate> => {
    const geometry = await request.route(loopWaypoints(request.start, shape));
    const family = samples.get(familyKey(shape)) ?? [];
    family.push({ radius: shape.radiusMeters, distance: geometry.distanceMeters });
    samples.set(familyKey(shape), family);
    return {
      shape,
      geometry,
      score: scoreLoop(geometry, targetMeters, request.preferences),
      distanceError: Math.abs(geometry.distanceMeters - targetMeters) / targetMeters
    };
  };
  const affordable = () =>
    request.availableRequests
      ? Math.max(0, request.availableRequests() - RESERVED_REQUESTS)
      : Number.POSITIVE_INFINITY;
  const settle = async (shapes: LoopCandidateShape[]) => {
    const results = await Promise.allSettled(shapes.map(evaluate));
    return {
      fulfilled: results
        .filter((result): result is PromiseFulfilledResult<ScoredCandidate> => result.status === "fulfilled")
        .map((result) => result.value),
      firstError: results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      )?.reason as unknown
    };
  };

  /**
   * Next shape worth routing for a candidate: drop the via behind a long
   * spur, else move the radius toward the target. Routed distance jumps when
   * a bigger circle crosses a highway or river, so once a shape family has
   * samples on both sides of the target we interpolate between them.
   */
  const nextShape = (candidate: ScoredCandidate): LoopCandidateShape | null => {
    const repair = spurRepairShape(candidate, request.start, targetMeters);
    if (repair) {
      return repair;
    }
    if (candidate.distanceError <= REFINE_DISTANCE_ERROR) {
      return null;
    }
    const family = samples.get(familyKey(candidate.shape)) ?? [];
    const below = family
      .filter((sample) => sample.distance < targetMeters)
      .sort((a, b) => b.distance - a.distance)[0];
    const above = family
      .filter((sample) => sample.distance > targetMeters)
      .sort((a, b) => a.distance - b.distance)[0];
    let radius: number;
    if (below && above && above.distance !== below.distance) {
      const t = (targetMeters - below.distance) / (above.distance - below.distance);
      radius = below.radius + t * (above.radius - below.radius);
    } else {
      const ratio = targetMeters / Math.max(1, candidate.geometry.distanceMeters);
      radius = candidate.shape.radiusMeters * Math.min(2, Math.max(0.5, ratio));
    }
    if (family.some((sample) => Math.abs(sample.radius - radius) / radius < 0.02)) {
      return null;
    }
    return { ...candidate.shape, radiusMeters: radius };
  };

  const firstRound = await settle(
    FIRST_ROUND_BEARINGS.map((offset) => ({
      bearing: (baseBearing + offset) % 360,
      radiusMeters: baseRadius,
      clockwise,
      viaCount
    }))
  );
  const candidates = firstRound.fulfilled;
  if (candidates.length === 0) {
    throw firstRound.firstError instanceof Error
      ? firstRound.firstError
      : new Error("Couldn't build a loop from that location.");
  }

  // Round two improves the two best shapes in parallel; round three polishes
  // the overall winner. Each round only spends requests the budget allows.
  for (const width of IMPROVEMENT_ROUND_WIDTHS) {
    candidates.sort((a, b) => a.score - b.score);
    const shapes: LoopCandidateShape[] = [];
    const seenFamilies = new Set<string>();
    for (const candidate of candidates) {
      if (shapes.length >= Math.min(width, affordable())) break;
      if (seenFamilies.has(familyKey(candidate.shape))) continue;
      seenFamilies.add(familyKey(candidate.shape));
      const shape = nextShape(candidate);
      if (shape) shapes.push(shape);
    }
    if (shapes.length === 0) {
      break;
    }
    candidates.push(...(await settle(shapes)).fulfilled);
  }

  // Runner-ups come from loops already routed; offering them costs no requests.
  candidates.sort((a, b) => a.score - b.score);
  return {
    geometry: candidates[0]!.geometry,
    alternatives: pickAlternatives(candidates, targetMeters)
  };
}

/**
 * Shape that drops the synthetic via behind each long spur, with the circle
 * grown to make up for the lost distance; null when there is nothing to fix.
 */
function spurRepairShape(
  candidate: ScoredCandidate,
  start: RouteWaypoint,
  targetMeters: number
): LoopCandidateShape | null {
  const spurs = findSpurs(candidate.geometry.points).filter(
    (spur) => spur.lengthMeters >= SPUR_REPAIR_MIN_METERS
  );
  if (spurs.length === 0) {
    return null;
  }
  const skip = new Set(candidate.shape.skipVias ?? []);
  const vias = loopWaypoints(start, { ...candidate.shape, skipVias: [] }).slice(1, -1);
  for (const spur of spurs) {
    let nearest = -1;
    let nearestMeters = SPUR_REPAIR_VIA_RADIUS_METERS;
    vias.forEach((via, index) => {
      const meters = distanceMeters(via, spur.tip);
      if (!skip.has(index) && meters < nearestMeters) {
        nearest = index;
        nearestMeters = meters;
      }
    });
    if (nearest >= 0) skip.add(nearest);
  }
  // Keep at least two vias so the result is still a loop, not an out-and-back.
  if (skip.size === (candidate.shape.skipVias?.length ?? 0) || vias.length - skip.size < 2) {
    return null;
  }
  const repairedShape = { ...candidate.shape, skipVias: [...skip].sort((a, b) => a - b) };
  const removedMeters = spurs.reduce((sum, spur) => sum + spur.lengthMeters, 0);
  const expectedMeters =
    Math.max(1, candidate.geometry.distanceMeters - removedMeters) *
    (waypointPerimeter(loopWaypoints(start, repairedShape)) /
      Math.max(1, waypointPerimeter(loopWaypoints(start, candidate.shape))));
  const scale = Math.min(1.5, Math.max(0.7, (targetMeters / expectedMeters) ** 0.9));
  return { ...repairedShape, radiusMeters: candidate.shape.radiusMeters * scale };
}

function waypointPerimeter(waypoints: RouteWaypoint[]): number {
  let total = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    total += distanceMeters(waypoints[index - 1]!, waypoints[index]!);
  }
  return total;
}

function distanceMeters(a: RouteWaypoint, b: RouteWaypoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
