import { describe, expect, it } from "vitest";
import { mapVersionFor, quadkey, takesMapAreas, tileAt, tileBounds } from "../../../maps/types";
import { estimate, joinLegs, pointAt, profile, shares, terrain } from "./routeMath";
import { haversine, lengthM, place, shapeOutline, textOutline } from "./sketchShapes";

describe("route sums", () => {
  it("joins drawn legs without repeating the shared point, and adds their makeup", () => {
    const a = { points: [[47, -122, 10], [47.01, -122, 20]] as [number, number, number][], distanceM: 1112, ascentM: 10, descentM: 0,
      makeup: { ways: [{ kind: "path" as const, meters: 1000 }], surfaces: [{ kind: "paved" as const, meters: 1112 }], busyMeters: 0, retracedMeters: 0 } };
    const b = { points: [[47.01, -122, 20], [47.02, -122, 15]] as [number, number, number][], distanceM: 1112, ascentM: 0, descentM: 5,
      makeup: { ways: [{ kind: "busy" as const, meters: 1112 }, { kind: "path" as const, meters: 112 }], surfaces: [{ kind: "paved" as const, meters: 1112 }], busyMeters: 1112, retracedMeters: 0 } };
    const j = joinLegs([a, b])!;
    expect(j.points).toHaveLength(3);
    expect(j.distanceM).toBe(2224);
    expect(j.ascentM).toBe(10);
    expect(j.descentM).toBe(5);
    expect(j.makeup!.ways.find((w) => w.kind === "path")!.meters).toBe(1112);
    expect(shares(j.makeup)!.carFree).toBeCloseTo(0.5, 2);
    expect(terrain(j.makeup)).toBe("Paved");
    expect(joinLegs([])).toBeNull();
  });

  it("profiles heights along the line and finds the point at a distance", () => {
    const pts: [number, number, number][] = [[0, 0, 5], [0, 0.01, 15], [0, 0.02, 10]];
    const p = profile(pts)!;
    expect(p.min).toBe(5);
    expect(p.max).toBe(15);
    expect(p.total).toBeCloseTo(2 * haversine([0, 0], [0, 0.01]), 3);
    expect(pointAt(pts, p.total * 0.75)).toBe(2);
    expect(profile([[0, 0], [0, 1]])).toBeNull();
  });

  it("estimates time from pace and climbing", () => {
    expect(estimate("run", 10_000, 0).time).toBe("1:00");
    expect(estimate("run", 10_000, 0).pace).toBe("6:00");
    expect(estimate("road", 25_000, 0).pace).toBe("25.0");
  });
});

describe("sketch outlines", () => {
  it("closes shapes and fills [-1, 1]", () => {
    for (const id of ["circle", "heart", "star", "square", "triangle", "bolt"] as const) {
      const o = shapeOutline(id);
      expect(o[0]).toEqual(o.at(-1));
      const span = Math.max(Math.max(...o.map((p) => p[0])) - Math.min(...o.map((p) => p[0])), Math.max(...o.map((p) => p[1])) - Math.min(...o.map((p) => p[1])));
      expect(span).toBeCloseTo(2, 5);
    }
  });

  it("writes text as one line and places it at the asked size", () => {
    expect(textOutline("")).toEqual([]);
    const placed = place(textOutline("HI"), [47.6, -122.3], 2000, 0);
    const lons = placed.map((p) => p[1]);
    const width = haversine([47.6, Math.min(...lons)], [47.6, Math.max(...lons)]);
    expect(width).toBeGreaterThan(1900);
    expect(width).toBeLessThan(2100);
    expect(lengthM(placed)).toBeGreaterThan(width);
  });
});

describe("maps rules", () => {
  it("knows each watch's map version (v6 PACE 4 Pro; v5 APEX 4, PACE 4, NOMAD, PACE Pro; v4 VERTIX, APEX 2; else v5)", () => {
    expect(mapVersionFor("PACE 4 Pro")).toBe(6);
    for (const w of ["APEX 4", "PACE 4", "NOMAD", "PACE Pro"]) expect(mapVersionFor(w)).toBe(5);
    for (const w of ["VERTIX 2S", "APEX 2 Pro", "APEX Pro"]) expect(mapVersionFor(w)).toBe(4);
    expect(mapVersionFor(undefined)).toBe(5);
  });

  it("takes map areas only on PACE 4, PACE 4 Pro, PACE Pro and APEX 4", () => {
    for (const w of ["PACE 4", "PACE 4 Pro", "PACE Pro", "APEX 4"]) expect(takesMapAreas(w)).toBe(true);
    for (const w of ["VERTIX 2", "APEX 2 Pro", "NOMAD", "PACE 3"]) expect(takesMapAreas(w)).toBe(false);
  });

  it("finds the zoom-7 square of a place and its quadkey", () => {
    const t = tileAt(47.6, -122.3);
    const b = tileBounds(t);
    expect(b.west).toBeLessThanOrEqual(-122.3);
    expect(b.east).toBeGreaterThan(-122.3);
    expect(b.south).toBeLessThanOrEqual(47.6);
    expect(b.north).toBeGreaterThan(47.6);
    expect(quadkey(t)).toMatch(/^[0-3]{7}$/);
    expect(quadkey({ x: 0, y: 0 })).toBe("0000000");
    expect(quadkey({ x: 127, y: 127 })).toBe("3333333");
  });
});
