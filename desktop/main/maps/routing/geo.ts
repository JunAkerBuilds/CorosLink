// Small geometry over [lat, lon(, ele)] tuples: distances, offsets, climbs, local metres.
import type { LatLon, RouteGeometry, TrackPoint } from "../../../maps/types";

const EARTH_M = 6_371_000;
const M_PER_DEG = 111_320;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle metres between two points. */
export function meters(a: readonly number[], b: readonly number[]): number {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lengthOf(points: readonly (readonly number[])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += meters(points[i - 1], points[i]);
  return total;
}

/** The point `distanceM` away from `origin` along `bearingDeg` (flat-earth; fine at loop scale). */
export function offset(origin: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const b = rad(bearingDeg);
  return [
    origin[0] + ((distanceM * Math.cos(b)) / EARTH_M) * (180 / Math.PI),
    origin[1] + ((distanceM * Math.sin(b)) / (EARTH_M * Math.cos(rad(origin[0])))) * (180 / Math.PI),
  ];
}

/** Local east/north metres around `origin`. */
export function projector(origin: readonly number[]) {
  const perLon = M_PER_DEG * Math.cos(rad(origin[0]));
  return (p: readonly number[]) => ({ x: (p[1] - origin[1]) * perLon, y: (p[0] - origin[0]) * M_PER_DEG });
}

/** Ascent and descent, ignoring wiggles under 3 m (GPS and DEM noise). */
export function climb(points: readonly TrackPoint[]): { ascentM: number; descentM: number } {
  let ascent = 0, descent = 0, ref: number | undefined;
  for (const p of points) {
    const ele = p[2];
    if (ele === undefined || !Number.isFinite(ele)) continue;
    if (ref === undefined) { ref = ele; continue; }
    if (ele - ref >= 3) { ascent += ele - ref; ref = ele; } else if (ref - ele >= 3) { descent += ref - ele; ref = ele; }
  }
  return { ascentM: Math.round(ascent), descentM: Math.round(descent) };
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
export function trackPoint(lat: number, lon: number, ele?: number): TrackPoint {
  return ele === undefined || !Number.isFinite(ele) ? [r6(lat), r6(lon)] : [r6(lat), r6(lon), Math.round(ele * 10) / 10];
}

/** A line through the points as drawn, with whatever heights they carry. */
export function lineGeometry(points: TrackPoint[]): RouteGeometry {
  return { points, distanceM: Math.round(lengthOf(points)), ...climb(points) };
}

export function isLatLon(v: unknown): v is LatLon {
  return Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) &&
    Math.abs(v[0] as number) <= 90 && Math.abs(v[1] as number) <= 180;
}
