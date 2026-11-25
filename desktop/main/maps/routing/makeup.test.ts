import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../../../maps/types";
import { carFreeShare, makeupOf, pavedShare, retracedMeters, segmentsFrom, surfaceOf, tallyOf, wayOf } from "./makeup";

describe("route makeup", () => {
  it("classifies ways for runners and riders", () => {
    expect(wayOf({ highway: "service", service: "parking_aisle" }, false)).toBe("parking");
    expect(wayOf({ highway: "secondary", sidewalk: "both" }, false)).toBe("sidewalk");
    expect(wayOf({ highway: "secondary" }, false)).toBe("busy");
    expect(wayOf({ highway: "tertiary" }, true)).toBe("quiet");
    expect(wayOf({ highway: "path", surface: "dirt" }, false)).toBe("trail");
    expect(surfaceOf({ highway: "track", tracktype: "grade2" })).toBe("gravel");
    expect(surfaceOf({ highway: "residential" })).toBe("paved");
  });

  it("adds up metres, car-free and paved shares, and retraced sections", () => {
    const segs = segmentsFrom([["Distance", "WayTags"], ["600", "highway=path surface=ground"], ["300", "highway=residential"], ["100", "highway=service service=parking_aisle"]]);
    const out: TrackPoint[] = [[49, -123], [49.001, -123], [49.002, -123]];
    const points = [...out, out[1], out[0]];
    const makeup = makeupOf(tallyOf(segs, points, false));
    expect(makeup.ways).toEqual([{ kind: "path", meters: 600 }, { kind: "quiet", meters: 300 }, { kind: "other", meters: 100 }]);
    expect(carFreeShare(makeup, false)).toBeCloseTo(0.6);
    expect(pavedShare(makeup)).toBeCloseTo(0.4);
    expect(makeup.retracedMeters).toBe(Math.round(retracedMeters(points)));
    expect(makeup.retracedMeters).toBeGreaterThan(200);
  });
});
