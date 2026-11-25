import { describe, expect, it } from "vitest";
import { RoutingProblem } from "./net";
import { checkDistance, maxKmFor, profileText, routerFor, STOCK_PROFILE } from "./sports";

describe("sports", () => {
  it("maps run/walk/hike to foot, road to the road bike, mtb to the mountain bike", () => {
    expect([routerFor("run"), routerFor("walk"), routerFor("hike"), routerFor("road"), routerFor("mtb")]).toEqual(["foot", "foot", "foot", "road", "mtb"]);
    expect(STOCK_PROFILE).toEqual({ foot: "hiking-mountain", road: "fastbike", mtb: "mtb" });
  });

  it("limits foot to 100 km and cycling to 300 km (must not regress)", () => {
    expect(maxKmFor("run")).toBe(100);
    expect(maxKmFor("hike")).toBe(100);
    expect(maxKmFor("road")).toBe(300);
    expect(maxKmFor("mtb")).toBe(300);
    expect(() => checkDistance("run", 100)).not.toThrow();
    expect(() => checkDistance("run", 100.1)).toThrow(RoutingProblem);
    expect(() => checkDistance("road", 300)).not.toThrow();
    expect(() => checkDistance("road", 301)).toThrow(/300 km/);
    expect(() => checkDistance("walk", 0)).toThrow(RoutingProblem);
  });

  it("writes profiles that price car parks and follow the athlete's choices", () => {
    const foot = profileText({ sport: "run", surface: "road", elevation: "flat", trimVias: true });
    expect(foot).toContain("validForFoot = true");
    expect(foot).toContain("correctMisplacedViaPoints = true");
    expect(foot).toMatch(/service=parking_aisle\|parking then 8/);
    expect(foot).toContain("uphillcost = 40");
    const bike = profileText({ sport: "mtb", surface: "road", elevation: "any", trimVias: false });
    expect(bike).toContain("validForBikes = true");
    expect(bike).toContain("trailwish = 1");
    expect(bike).toContain("uphillcost = 0");
    expect(profileText({ sport: "run", surface: "trail", elevation: "any", trimVias: false })).not.toBe(foot);
  });
});
