import { describe, expect, it } from "vitest";
import type { LatLon } from "../../../maps/types";
import { offset } from "./geo";
import { MAX_SKETCH_POINTS, MIN_SKETCH_POINTS, shapeMatch, simplify, sketchWaypoints } from "./sketch";

const centre: LatLon = [49.28, -123.12];
/** A square 1 km a side, drawn with many jittery points, closed. */
function square(): LatLon[] {
  const corners = [offset(offset(centre, 0, 500), 270, 500), offset(offset(centre, 0, 500), 90, 500), offset(offset(centre, 180, 500), 90, 500), offset(offset(centre, 180, 500), 270, 500)];
  const out: LatLon[] = [];
  for (let c = 0; c < 4; c++) {
    const a = corners[c], b = corners[(c + 1) % 4];
    for (let i = 0; i < 100; i++) out.push([a[0] + ((b[0] - a[0]) * i) / 100 + (i % 2 ? 1e-6 : -1e-6), a[1] + ((b[1] - a[1]) * i) / 100]);
  }
  out.push(out[0]);
  return out;
}

describe("sketch geometry", () => {
  it("keeps the corners and stays within the via budget", () => {
    const outline = square();
    const vias = sketchWaypoints(outline, "strict");
    expect(vias.length).toBeGreaterThanOrEqual(MIN_SKETCH_POINTS);
    expect(vias.length).toBeLessThanOrEqual(MAX_SKETCH_POINTS);
    expect(vias[0]).toEqual(outline[0]);
    expect(vias[vias.length - 1]).toEqual(outline[outline.length - 1]);
    expect(simplify(outline, 5)).toHaveLength(5);
    expect(sketchWaypoints(outline, "loose").length).toBeLessThan(vias.length);
  });

  it("scores the shape match from 0 to 1", () => {
    const outline = square();
    expect(shapeMatch(outline, outline)).toBe(1);
    const shifted = outline.map((p) => offset(p, 90, 150));
    const off = shapeMatch(shifted, outline);
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThan(1);
    const far = outline.map((p) => offset(p, 90, 5_000));
    expect(shapeMatch(far, outline)).toBe(0);
  });
});
