// Sketch (GPS art): the outline the athlete placed on the map → a bounded set of via points that keeps its corners
// → routed along streets, then how closely the routed line reproduces the outline (0–1).
import type { LatLon, SketchRequest } from "../../../maps/types";
import { lengthOf, meters, projector } from "./geo";

/** Fewer vias give the router room; more trace the outline tighter. */
const DIVISOR: Record<SketchRequest["fidelity"], number> = { loose: 20, balanced: 35, strict: 55 };
const MIN_SPACING_M = 60;
export const MIN_SKETCH_POINTS = 8;
/** Keeps one BRouter request inside its URL and time limits. */
export const MAX_SKETCH_POINTS = 60;

type XY = { x: number; y: number };

function toSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas–Peucker in metres: drops hand jitter, keeps corners and both ends (a closed outline stays closed). */
export function simplify(points: LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2 || toleranceM <= 0) return points.slice();
  const xy = points.map(projector(points[0]));
  const keep = points.map((_, i) => i === 0 || i === points.length - 1);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1, farM = 0;
    for (let i = a + 1; i < b; i++) {
      const d = toSegment(xy[i], xy[a], xy[b]);
      if (d > farM) { farM = d; far = i; }
    }
    if (far >= 0 && farM > toleranceM) { keep[far] = true; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Points every `spacingM` along the line (ends kept), between `min` and `max` of them. */
export function resample(points: LatLon[], spacingM: number, min = MIN_SKETCH_POINTS, max = MAX_SKETCH_POINTS): LatLon[] {
  if (points.length <= 2) return points.slice();
  const total = lengthOf(points);
  if (total === 0) return [points[0], points[points.length - 1]];
  const parts = Math.min(Math.max(Math.round(total / spacingM), min - 1), max - 1);
  const step = total / parts;
  const out: LatLon[] = [points[0]];
  let walked = 0, nextAt = step;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = meters(a, b);
    while (len > 0 && nextAt <= walked + len && out.length < parts) {
      const t = (nextAt - walked) / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      nextAt += step;
    }
    walked += len;
  }
  out.push(points[points.length - 1]);
  return out;
}

/** The via points for an outline: its corners always, plus even fill along long edges, within the budget. */
export function sketchWaypoints(outline: LatLon[], fidelity: SketchRequest["fidelity"]): LatLon[] {
  if (outline.length <= 2) return outline.slice();
  const perimeter = lengthOf(outline);
  if (perimeter === 0) return [outline[0], outline[outline.length - 1]];
  const spacing = Math.min(Math.max(MIN_SPACING_M, perimeter / DIVISOR[fidelity]), perimeter / (MIN_SKETCH_POINTS - 1));
  let tolerance = Math.min(spacing / 2, perimeter / 60);
  let corners = simplify(outline, tolerance);
  while (corners.length > MAX_SKETCH_POINTS) corners = simplify(outline, (tolerance *= 1.6));
  const edges = corners.slice(1).map((c, i) => meters(corners[i], c));
  const wanted = edges.map((len) => Math.floor(len / spacing));
  const room = MAX_SKETCH_POINTS - corners.length;
  const wantedTotal = wanted.reduce((a, b) => a + b, 0);
  const shrink = wantedTotal > room ? room / wantedTotal : 1;
  const out: LatLon[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1], b = corners[i], fill = Math.floor(wanted[i - 1] * shrink);
    for (let s = 1; s <= fill; s++) out.push([a[0] + ((b[0] - a[0]) * s) / (fill + 1), a[1] + ((b[1] - a[1]) * s) / (fill + 1)]);
    out.push(b);
  }
  return out;
}

const SAMPLES = 96;
/** The route may run this much longer than the outline before detours count against it. */
const LENGTH_SLACK = 1.15;

/**
 * How closely `route` reproduces `outline`, 0–1 (1 = traces it). Mean deviation both ways (the route must hug the
 * shape and cover all of it) over the outline's size, plus a penalty when detours make the route much longer.
 */
export function shapeMatch(route: readonly (readonly number[])[], outline: LatLon[]): number {
  const r = route.map((p) => [p[0], p[1]] as LatLon);
  if (r.length < 2 || outline.length < 2) return 0;
  const routeLen = lengthOf(r), outlineLen = lengthOf(outline);
  if (!routeLen || !outlineLen) return 0;
  const at = projector(outline[0]);
  const rs = resample(r, routeLen / SAMPLES, 2, SAMPLES + 32).map(at);
  const os = resample(outline, outlineLen / SAMPLES, 2, SAMPLES + 32).map(at);
  const rl = r.map(at), ol = outline.map(at);
  const nearest = (p: XY, line: XY[]) => line.slice(1).reduce((best, b, i) => Math.min(best, toSegment(p, line[i], b)), Infinity);
  const there = rs.reduce((a, p) => a + nearest(p, ol), 0) / rs.length;
  const back = os.reduce((a, p) => a + nearest(p, rl), 0) / os.length;
  const xs = ol.map((p) => p.x), ys = ol.map((p) => p.y);
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const score = (there + back) / 2 / size + 0.5 * Math.max(0, routeLen / outlineLen - LENGTH_SLACK);
  return Math.round(Math.max(0, Math.min(1, 1 - 2 * score)) * 100) / 100;
}
