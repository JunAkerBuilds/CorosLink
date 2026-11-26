import { describe, expect, it } from "vitest";
import { corosWorkoutId, intensityLabel, parseCorosWorkoutId } from "./hubWorkout";

describe("helpers", () => {
  it("labels targets", () => {
    expect(intensityLabel({ kind: "power", low: 200, high: 240 })).toBe("Power 200–240 W");
    expect(intensityLabel({ kind: "rpe", low: 7 })).toBe("RPE 7");
    expect(intensityLabel({ kind: "kept" })).toBe("COROS target");
  });
  it("builds and parses entry IDs", () => {
    expect(parseCorosWorkoutId(corosWorkoutId("2026-11-20", "12-a"))).toEqual({ day: "2026-11-20", idInPlan: "12-a" });
    expect(parseCorosWorkoutId("w-abc")).toBeNull();
  });
});
