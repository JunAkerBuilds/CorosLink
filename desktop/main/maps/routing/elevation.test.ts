import { describe, expect, it } from "vitest";
import type { LatLon } from "../../../maps/types";
import { ELEVATION_BATCH, Elevations } from "./elevation";
import { netWith } from "./fakes";

describe("Open-Meteo heights", () => {
  it("asks at most 100 points per call and climbs from the answers", async () => {
    const sizes: number[] = [];
    const heights = new Elevations(netWith(async (url) => {
      const lats = (new URL(url).searchParams.get("latitude") ?? "").split(",").map(Number);
      sizes.push(lats.length);
      return Response.json({ elevation: lats.map((lat) => (lat - 49) * 10_000) });
    }));
    // ~2.2 km north in two clicks: filled every ~100 m.
    const line: LatLon[] = [[49, -123], [49.01, -123], [49.02, -123]];
    const geometry = await heights.line(line);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(ELEVATION_BATCH);
    expect(geometry.points.length).toBeGreaterThan(20);
    expect(geometry.points[0]).toEqual([49, -123, 0]);
    expect(geometry.ascentM).toBeGreaterThan(190);
    expect(geometry.descentM).toBe(0);

    sizes.length = 0;
    const many: LatLon[] = Array.from({ length: 250 }, (_, i) => [49 + i * 0.0001, -123]);
    await heights.line(many);
    expect(sizes).toEqual([100, 100, 50]);
  });
});
