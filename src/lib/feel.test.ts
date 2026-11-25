import { describe, expect, it } from "vitest";
import { feelAdjustment, loadHue, readinessHue, sleepHue } from "./feel";

describe("morning ring colours, as on the phone", () => {
  it("colours readiness by band", () => {
    expect([90, 85, 84, 79, 65, 64, 50, 49].map(readinessHue)).toEqual(["mint", "mint", "yellow", "yellow", "yellow", "coral", "coral", "rose"]);
  });
  it("colours sleep by quality", () => {
    expect([85, 70, 69, 55, 54].map(sleepHue)).toEqual(["violet", "violet", "gold", "gold", "coral"]);
  });
  it("colours load by status", () => {
    expect([loadHue("Decreasing"), loadHue("Optimized"), loadHue("Excessive"), loadHue(undefined)]).toEqual(["slate", "mint", "rose", "blue"]);
  });
});

describe("feel check", () => {
  it("moves readiness like FeelCheck.adjustment", () => {
    expect([1, 2, 3, 4, 5].map((f) => feelAdjustment(f, []))).toEqual([-12, -6, 0, 4, 7]);
    expect(feelAdjustment(4, ["sore", "stressed"])).toBe(-3);
    expect(feelAdjustment(1, ["sore", "heavyLegs", "stressed"])).toBe(-15);
    expect(feelAdjustment(5, ["unwell"])).toBe(7);
  });
});
