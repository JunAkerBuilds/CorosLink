import type { UnitPoint } from "../../../electron/routing/sketchGeometry";

/**
 * Preset GPS-art outlines in normalized [-1, 1] unit space (x east, y north).
 * All templates are closed: the last point repeats the first so the snapped
 * route comes back to its start.
 */

export type SketchTemplateId =
  | "circle"
  | "heart"
  | "star"
  | "square"
  | "triangle"
  | "lightning";

export interface SketchTemplate {
  id: SketchTemplateId;
  label: string;
  points: UnitPoint[];
}

/** Scales and centers a polygon so it exactly fills the [-1, 1] square. */
function normalizeToUnit(points: UnitPoint[]): UnitPoint[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const scale = 2 / Math.max(maxX - minX, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return points.map((point) => ({
    x: (point.x - centerX) * scale,
    y: (point.y - centerY) * scale
  }));
}

function closed(points: UnitPoint[]): UnitPoint[] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first.x === last.x && first.y === last.y) {
    return points;
  }
  return [...points, { ...first }];
}

function circlePoints(samples = 64): UnitPoint[] {
  const points: UnitPoint[] = [];
  for (let i = 0; i < samples; i += 1) {
    const angle = (i / samples) * 2 * Math.PI + Math.PI / 2;
    points.push({ x: Math.cos(angle), y: Math.sin(angle) });
  }
  return points;
}

/** Classic parametric heart curve, sampled and fit to the unit square. */
function heartPoints(samples = 64): UnitPoint[] {
  const points: UnitPoint[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * 2 * Math.PI;
    points.push({
      x: 16 * Math.sin(t) ** 3,
      y:
        13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t)
    });
  }
  return normalizeToUnit(points);
}

function starPoints(spikes = 5, innerRadius = 0.42): UnitPoint[] {
  const points: UnitPoint[] = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = i % 2 === 0 ? 1 : innerRadius;
    const angle = Math.PI / 2 + (i / (spikes * 2)) * 2 * Math.PI;
    points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  return normalizeToUnit(points);
}

const SQUARE: UnitPoint[] = [
  { x: -1, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 }
];

const TRIANGLE: UnitPoint[] = normalizeToUnit([
  { x: 0, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 }
]);

const LIGHTNING: UnitPoint[] = normalizeToUnit([
  { x: 0.2, y: 1 },
  { x: -0.5, y: 0.05 },
  { x: -0.05, y: 0.05 },
  { x: -0.35, y: -1 },
  { x: 0.5, y: 0.25 },
  { x: 0.05, y: 0.25 }
]);

export const SKETCH_TEMPLATES: SketchTemplate[] = [
  { id: "circle", label: "Circle", points: closed(circlePoints()) },
  { id: "heart", label: "Heart", points: closed(heartPoints()) },
  { id: "star", label: "Star", points: closed(starPoints()) },
  { id: "square", label: "Square", points: closed(SQUARE) },
  {
    id: "triangle",
    label: "Triangle",
    points: closed(TRIANGLE)
  },
  {
    id: "lightning",
    label: "Bolt",
    points: closed(LIGHTNING)
  }
];
