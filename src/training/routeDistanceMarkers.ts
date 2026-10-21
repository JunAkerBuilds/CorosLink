import type { TrainingHubTrackPoint, UnitSystem } from "../../electron/types";

export interface RouteDistanceMarker {
  /** Distance in the display unit: 1, 2, 3… (or 5, 10, 15… on long routes). */
  label: string;
  latLng: [number, number];
}

const METERS_PER_UNIT: Record<UnitSystem, number> = { metric: 1000, imperial: 1609.344 };
// Past ~30 the inline map is a row of overlapping chips; long rides step up.
const MAX_MARKERS = 30;
const MARKER_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];
// A marker this close to the finish would sit on the finish dot.
const FINISH_CLEARANCE = 0.05;
const EARTH_RADIUS_METERS = 6_371_008.8;

interface DistancedPoint {
  lat: number;
  lon: number;
  distance: number;
}

function haversineMeters(a: DistancedPoint, b: DistancedPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * GPS points with the watch's own distance, so markers land where the watch
 * counted each km (where COROS ends auto-laps). COROS writes distance 0
 * while paused, which parses as undefined; those points are skipped. Without
 * watch distance, fall back to the GPS path length.
 */
function distancedPoints(points: TrainingHubTrackPoint[]): DistancedPoint[] {
  const gps = points.filter(
    (point): point is TrainingHubTrackPoint & { lat: number; lon: number } =>
      point.lat !== undefined && point.lon !== undefined
  );
  const watched: DistancedPoint[] = [];
  for (const point of gps) {
    const distance = point.distance;
    if (distance === undefined || !Number.isFinite(distance)) {
      continue;
    }
    if (watched.length > 0 && distance < watched[watched.length - 1]!.distance) {
      continue;
    }
    watched.push({ lat: point.lat, lon: point.lon, distance });
  }
  if (watched.length > 1 && watched[watched.length - 1]!.distance > 0) {
    return watched;
  }

  const measured: DistancedPoint[] = [];
  for (const point of gps) {
    const previous = measured[measured.length - 1];
    const next = { lat: point.lat, lon: point.lon, distance: 0 };
    next.distance = previous ? previous.distance + haversineMeters(previous, next) : 0;
    measured.push(next);
  }
  return measured;
}

export function routeDistanceMarkers(
  points: TrainingHubTrackPoint[],
  unitSystem: UnitSystem
): RouteDistanceMarker[] {
  const path = distancedPoints(points);
  if (path.length < 2) {
    return [];
  }

  const unit = METERS_PER_UNIT[unitSystem];
  const total = path[path.length - 1]!.distance;
  const step =
    MARKER_STEPS.find((candidate) => total / (candidate * unit) <= MAX_MARKERS) ??
    MARKER_STEPS[MARKER_STEPS.length - 1]!;
  const spacing = step * unit;
  const markers: RouteDistanceMarker[] = [];
  let index = 1;

  for (let count = 1; count * spacing < total - FINISH_CLEARANCE * unit; count += 1) {
    const target = count * spacing;
    // GPS that locked late has no position for the first kilometres.
    if (target < path[0]!.distance) {
      continue;
    }
    while (index < path.length - 1 && path[index]!.distance < target) {
      index += 1;
    }
    const from = path[index - 1]!;
    const to = path[index]!;
    const span = to.distance - from.distance;
    const progress = span > 0 ? Math.min(1, Math.max(0, (target - from.distance) / span)) : 0;
    markers.push({
      label: String(count * step),
      latLng: [from.lat + (to.lat - from.lat) * progress, from.lon + (to.lon - from.lon) * progress]
    });
  }

  return markers;
}
