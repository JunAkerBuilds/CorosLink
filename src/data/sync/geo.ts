// Shared by the screens that draw a route or name a sport from synced activities.
import type { NativeSport } from "./native";

/** The phone's own English name for each sport family (TrainingInsights.Sport.title). */
export const SPORT_TITLE: Record<NativeSport, string> = {
  run: "Run", indoorRun: "Indoor run", trailRun: "Trail run", track: "Track run", walk: "Walk", hike: "Hike", bike: "Ride", indoorBike: "Indoor ride",
  poolSwim: "Pool swim", openWater: "Open water", strength: "Strength", cardio: "Cardio", ski: "Ski", row: "Row", multisport: "Multisport", other: "Workout",
};

export interface ProjectedPoint { x: number; y: number; /** Metres covered on reaching the point. */ d: number; /** Where the point is on Earth, for the real map. */ lat: number; lon: number }

const EARTH_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * `[latitude, longitude]` pairs drawn into a `width` × `height` box with `pad` kept clear on every side:
 * an equirectangular projection around the route's middle latitude, scaled to fit with its shape kept,
 * centred, north up. `d` is the distance along the route (haversine), scaled to end at `totalM` when given.
 */
export function projectRoute(route: readonly (readonly [number, number])[], width: number, height: number, pad = 24, totalM?: number): ProjectedPoint[] {
  const points = route.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length === 0) return [];
  const lats = points.map((p) => p[0]), lons = points.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const k = Math.cos(rad((minLat + maxLat) / 2));
  const spanX = Math.max((maxLon - minLon) * k, 1e-9), spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2, offY = (height - spanY * scale) / 2;
  const out: ProjectedPoint[] = [];
  let d = 0;
  points.forEach((p, i) => {
    if (i > 0) {
      const q = points[i - 1];
      const a = Math.sin(rad(p[0] - q[0]) / 2) ** 2 + Math.cos(rad(q[0])) * Math.cos(rad(p[0])) * Math.sin(rad(p[1] - q[1]) / 2) ** 2;
      d += 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
    }
    out.push({ x: offX + (p[1] - minLon) * k * scale, y: offY + (maxLat - p[0]) * scale, d, lat: p[0], lon: p[1] });
  });
  const factor = totalM != null && d > 0 ? totalM / d : 1;
  return out.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, d: Math.round(p.d * factor * 10) / 10, lat: p.lat, lon: p.lon }));
}
