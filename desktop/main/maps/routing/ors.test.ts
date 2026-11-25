import { describe, expect, it } from "vitest";
import { netWith } from "./fakes";
import { fromOrs, Ors, orsProfile } from "./ors";

describe("OpenRouteService", () => {
  it("picks its profile from the sport and surface", () => {
    expect(orsProfile({ sport: "run", surface: "road", elevation: "any" })).toBe("foot-walking");
    expect(orsProfile({ sport: "run", surface: "trail", elevation: "any" })).toBe("foot-hiking");
    expect(orsProfile({ sport: "mtb", surface: "road", elevation: "any" })).toBe("cycling-mountain");
  });

  it("reads ways and surfaces from extra_info", () => {
    const r = fromOrs({ features: [{
      geometry: { coordinates: [[-123, 49, 10], [-123, 49.001, 12], [-123, 49.002, 15]] },
      properties: { summary: { distance: 222 }, ascent: 5, descent: 0, extras: { waytypes: { values: [[0, 1, 4], [1, 2, 3]] }, surface: { values: [[0, 1, 11], [1, 2, 3]] } } },
    }] });
    expect(r.distanceM).toBe(222);
    expect(r.makeup!.ways.map((w) => w.kind).sort()).toEqual(["path", "quiet"]);
    expect(r.makeup!.surfaces.map((s) => s.kind).sort()).toEqual(["dirt", "paved"]);
  });

  it("sends the key and says when it's refused", async () => {
    let auth: string | null = null, body: Record<string, unknown> = {};
    const ors = new Ors(netWith(async (_url, init) => {
      auth = new Headers(init?.headers).get("Authorization");
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}", { status: 403 });
    }), "test-key-0123456789");
    await expect(ors.roundTrip([49, -123], 5000, { sport: "run", surface: "road", elevation: "flat" }, 7)).rejects.toMatchObject({ code: "ors_key" });
    expect(auth).toBe("test-key-0123456789");
    expect(body.options).toMatchObject({ round_trip: { length: 5000, points: 3, seed: 7 }, profile_params: { weightings: { steepness_difficulty: 0 } } });
  });
});
