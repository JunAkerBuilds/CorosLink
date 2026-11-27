import { afterEach, describe, expect, it } from "vitest";
import { useUnitsNow } from "./units";
import { corosWorkoutId, intensityLabel, parseCorosWorkoutId } from "./hubWorkout";

describe("helpers", () => {
  afterEach(() => useUnitsNow("metric"));
  it("labels targets", () => {
    expect(intensityLabel({ kind: "power", low: 200, high: 240 })).toBe("Power 200–240 W");
    expect(intensityLabel({ kind: "rpe", low: 7 })).toBe("RPE 7");
    expect(intensityLabel({ kind: "kept" })).toBe("COROS target");
  });
  it("labels speed and weight targets in the shown units", () => {
    expect(intensityLabel({ kind: "speed", low: 25, high: 30 })).toBe("Speed 25–30 km/h");
    expect(intensityLabel({ kind: "weight", low: 20 })).toBe("Weight 20 kg");
    useUnitsNow("imperial");
    expect(intensityLabel({ kind: "speed", low: 25, high: 30 })).toBe("Speed 15.5–18.6 mph");
    expect(intensityLabel({ kind: "weight", low: 20 })).toBe("Weight 44.1 lb");
    expect(intensityLabel({ kind: "power", low: 200, high: 240 })).toBe("Power 200–240 W");
  });
  it("builds and parses entry IDs", () => {
    expect(parseCorosWorkoutId(corosWorkoutId("2026-11-20", "12-a"))).toEqual({ day: "2026-11-20", idInPlan: "12-a" });
    expect(parseCorosWorkoutId("w-abc")).toBeNull();
  });
});
