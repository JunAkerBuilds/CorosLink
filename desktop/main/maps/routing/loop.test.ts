import { describe, expect, it } from "vitest";
import type { LatLon } from "../../../maps/types";
import { lengthOf, meters, offset, trackPoint } from "./geo";
import { bearingForSeed, findSpurs, generateCandidates, loopPoints, planLoop, type Engine } from "./loop";
import { makeupOf, type Routed, type Tally } from "./makeup";
import type { Prefs } from "./sports";

const start: LatLon = [49.28, -123.12];
const prefs: Prefs = { sport: "run", surface: "road", elevation: "any" };

/** Routes straight through the points, 1.25× longer (like real streets); trail and flat variants change the result. */
function engine(calls: { points: LatLon[]; prefs: Prefs }[] = []): Engine {
  return {
    async route(points, p) {
      calls.push({ points, prefs: p });
      const d = lengthOf(points) * 1.25;
      const trail = p.surface === "trail";
      const tally: Tally = { ways: trail ? { trail: d * 0.7, quiet: d * 0.3 } : { quiet: d }, surfaces: trail ? { dirt: d * 0.7, paved: d * 0.3 } : { paved: d }, retracedM: 0 };
      // Variants take other streets.
      const shift = trail ? 90 : p.elevation === "flat" ? 270 : null;
      const line = shift === null ? points : points.map((q) => offset(q, shift, 400));
      return { points: line.map((q, i) => trackPoint(q[0], q[1], 50 + i)), distanceM: Math.round(d), ascentM: p.elevation === "flat" ? 20 : 120, descentM: 0, makeup: makeupOf(tally), tally } satisfies Routed;
    },
  };
}

describe("loop planner", () => {
  it("lays a closed circle through the start", () => {
    const pts = loopPoints(start, { bearing: 0, radiusM: 1000, clockwise: true, vias: 4 });
    expect(pts).toHaveLength(6);
    expect(pts[0]).toEqual(start);
    expect(pts[5]).toEqual(start);
    for (const p of pts.slice(1, -1)) expect(meters(p, start)).toBeLessThanOrEqual(2000 + 1);
  });

  it("plans a loop near the asked distance", async () => {
    const plan = await planLoop(start, 10_000, prefs, undefined, engine());
    expect(Math.abs(plan.best.distanceM - 10_000) / 10_000).toBeLessThan(0.08);
    expect(plan.points[0]).toEqual(start);
  });

  it("a new seed turns the loop and can flip its direction", async () => {
    expect(bearingForSeed(undefined)).toBe(0);
    const firstVia = async (seed: number | undefined) => (await planLoop(start, 5_000, prefs, seed, engine())).points[1];
    const seen = new Set<string>();
    for (const seed of [undefined, 1, 2, 3]) seen.add(JSON.stringify(await firstVia(seed)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("stays within its request budget", async () => {
    const calls: { points: LatLon[]; prefs: Prefs }[] = [];
    await planLoop(start, 8_000, prefs, 4, { ...engine(calls), available: () => 4 });
    expect(calls).toHaveLength(3);
  });

  it("finds out-and-back spurs", () => {
    const out = Array.from({ length: 30 }, (_, i) => trackPoint(49.28 + i * 0.0001, -123.12));
    const back = out.slice().reverse().map((p) => trackPoint(p[0], p[1] + 0.0002));
    const spurs = findSpurs([...out, ...back]);
    expect(spurs).toHaveLength(1);
    expect(spurs[0].meters).toBeGreaterThan(300);
  });

  it("offers Best match, More trail and Flatter, each with car-free and paved shares", async () => {
    const candidates = await generateCandidates({ ...prefs, kind: "loop", start, distanceKm: 10 }, engine());
    expect(candidates.map((c) => c.label)).toEqual(["Best match", "More trail", "Flatter"]);
    expect(candidates[0].paved).toBe(1);
    expect(candidates[1].paved).toBeCloseTo(0.3);
    expect(candidates[1].carFree).toBeCloseTo(0.7);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(3);
  });

  it("leaves out choices that aren't different", async () => {
    const candidates = await generateCandidates({ sport: "hike", surface: "trail", elevation: "flat", kind: "ab", start, end: [49.3, -123.1], distanceKm: 0 }, engine());
    expect(candidates.map((c) => c.label)).toEqual(["Best match"]);
  });

  it("refuses runs over 100 km and rides over 300 km (must not regress)", async () => {
    await expect(generateCandidates({ ...prefs, kind: "loop", start, distanceKm: 101 }, engine())).rejects.toMatchObject({ code: "distance" });
    await expect(generateCandidates({ ...prefs, sport: "road", kind: "loop", start, distanceKm: 301 }, engine())).rejects.toMatchObject({ code: "distance" });
    await expect(generateCandidates({ ...prefs, kind: "ab", start, end: [51, -123.12], distanceKm: 0 }, engine())).rejects.toMatchObject({ code: "distance" });
    const ride = await generateCandidates({ ...prefs, sport: "road", kind: "loop", start, distanceKm: 250 }, engine());
    expect(ride[0].label).toBe("Best match");
  });
});
