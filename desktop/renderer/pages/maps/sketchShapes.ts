// Sketch outlines for GPS art: preset shapes and a single-stroke font (each letter traced once), in unit space
// [-1, 1] (x east, y north), then placed on the map at a centre, size (metres across) and rotation.
import { tx } from "@/lib/i18n";
import type { LatLon } from "../../../maps/types";

export type Unit = [number, number];
export type ShapeId = "circle" | "heart" | "star" | "square" | "triangle" | "bolt";
export const SHAPES: ShapeId[] = ["circle", "heart", "star", "square", "triangle", "bolt"];
/** A shape's name, in the app's language (read when shown). */
export const shapeName = (id: ShapeId) => ({
  circle: tx("sketch shape", "Circle"), heart: tx("sketch shape", "Heart"), star: tx("sketch shape", "Star"),
  square: tx("sketch shape", "Square"), triangle: tx("sketch shape", "Triangle"), bolt: tx("sketch shape", "Bolt"),
})[id];

/** Scales and centres points to fill [-1, 1] and closes the outline. */
export function normalize(points: Unit[], close = true): Unit[] {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = 2 / Math.max(maxX - minX, maxY - minY || 1e-9);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const out = points.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale] as Unit);
  if (close && (out[0][0] !== out.at(-1)![0] || out[0][1] !== out.at(-1)![1])) out.push([...out[0]]);
  return out;
}

const ring = (n: number, r: (i: number) => number, start = Math.PI / 2): Unit[] =>
  Array.from({ length: n }, (_, i) => { const a = start + (i / n) * 2 * Math.PI; return [Math.cos(a) * r(i), Math.sin(a) * r(i)]; });

export function shapeOutline(id: ShapeId): Unit[] {
  switch (id) {
    case "circle": return normalize(ring(48, () => 1));
    case "star": return normalize(ring(10, (i) => (i % 2 ? 0.42 : 1)));
    case "square": return normalize([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    case "triangle": return normalize([[0, 1], [0.95, -0.75], [-0.95, -0.75]]);
    case "bolt": return normalize([[0.1, 1], [-0.6, -0.05], [-0.05, -0.05], [-0.25, -1], [0.6, 0.15], [0.05, 0.15], [0.35, 1]]);
    case "heart": return normalize(Array.from({ length: 48 }, (_, i) => {
      const t = (i / 48) * 2 * Math.PI;
      return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)] as Unit;
    }));
  }
}

// Letters on a 4 × 6 grid (y up). Each is one or more strokes; strokes of a word are joined in order.
const G: Record<string, Unit[][]> = {
  A: [[[0, 0], [2, 6], [4, 0]], [[0.8, 2.4], [3.2, 2.4]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [3, 3.2], [0, 3.2]], [[3, 3.2], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
  H: [[[0, 6], [0, 0]], [[4, 6], [4, 0]], [[0, 3], [4, 3]]],
  I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 6], [0, 0]], [[4, 6], [0, 2.5]], [[1.3, 3.5], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  P: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]]],
  Q: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]], [[2.5, 1.5], [4, 0]]],
  R: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 4], [3, 0], [4, 6]]],
  X: [[[0, 6], [4, 0]], [[4, 6], [0, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  0: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]], [[0.5, 0.8], [3.5, 5.2]]],
  1: [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  2: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  3: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1.5, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  4: [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  5: [[[4, 6], [0, 6], [0, 3.5], [3, 3.5], [4, 2.5], [4, 1], [3, 0], [1, 0], [0, 1]]],
  6: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2.5], [3, 3.5], [0, 3.5]]],
  7: [[[0, 6], [4, 6], [1.5, 0]]],
  8: [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  9: [[[4, 2.5], [1, 2.5], [0, 3.5], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0], [0, 1]]],
};

export const TEXT_CHARS = /^[A-Z0-9 ]*$/;

/** A word as one connected line (letters joined left to right), normalized to [-1, 1]. Empty when nothing to draw. */
export function textOutline(text: string): Unit[] {
  const points: Unit[] = [];
  let x = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === " ") { x += 3; continue; }
    const glyph = G[ch];
    if (!glyph) continue;
    for (const stroke of glyph) for (const [gx, gy] of stroke) points.push([x + gx, gy]);
    x += 5.5;
  }
  return points.length > 1 ? normalize(points, false) : [];
}

const M_PER_DEG = 111_320;
/** Unit outline → map points: centred on `center`, `sizeM` metres across, turned `rotation` degrees clockwise. */
export function place(outline: Unit[], center: LatLon, sizeM: number, rotation: number): LatLon[] {
  const r = (-rotation * Math.PI) / 180, half = sizeM / 2, cos = Math.cos((center[0] * Math.PI) / 180);
  return outline.map(([x, y]) => {
    const rx = x * Math.cos(r) - y * Math.sin(r), ry = x * Math.sin(r) + y * Math.cos(r);
    return [center[0] + (ry * half) / M_PER_DEG, center[1] + (rx * half) / (M_PER_DEG * cos)] as LatLon;
  });
}

/** Length of a line of map points in metres. */
export function lengthM(points: readonly (readonly number[])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1] as LatLon, points[i] as LatLon);
  return total;
}
export function haversine(a: LatLon, b: LatLon): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
