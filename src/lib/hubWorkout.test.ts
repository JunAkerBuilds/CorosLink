import { describe, expect, it } from "vitest";
import type { HubWorkout } from "@/data/hub";
import { corosWorkoutId, fromHub, intensityLabel, parseCorosWorkoutId, toHub } from "./hubWorkout";

const intervals: HubWorkout = {
  name: "5 × 1 km", sport: "trailRun", description: "Keep it smooth",
  blocks: [
    { id: "b1", repeats: null, steps: [{ id: "s1", kind: "warmup", target: "distance", meters: 2000, intensity: { kind: "heartRate", low: 124, high: 143 }, name: "Jog" }] },
    { id: "b2", repeats: 5, steps: [
      { id: "s2", kind: "training", target: "distance", meters: 1000, intensity: { kind: "pace", low: 270, high: 280 } },
      { id: "s3", kind: "rest", target: "time", seconds: 90, intensity: { kind: "none" } },
    ] },
    { id: "b3", repeats: null, steps: [{ id: "s4", kind: "cooldown", target: "time", seconds: 600, intensity: { kind: "none" } }] },
  ],
};

describe("COROS workout to builder steps", () => {
  it("maps steps, repeats, pace and kept targets", () => {
    const got = fromHub(intervals)!;
    expect(got.sport).toBe("run");
    expect(got.items).toEqual([
      { type: "step", id: "cs-s1", kind: "warmup", length: { type: "distance", metres: 2000, unit: "km" }, target: { type: "kept", label: "Heart rate 124–143 bpm" } },
      { type: "repeat", id: "cb-b2", count: 5, steps: [
        { type: "step", id: "cs-s2", kind: "work", length: { type: "distance", metres: 1000, unit: "km" }, target: { type: "pace", fast: 270, slow: 280 } },
        { type: "step", id: "cs-s3", kind: "rest", length: { type: "time", seconds: 90 }, target: { type: "none" } },
      ] },
      { type: "step", id: "cs-s4", kind: "cooldown", length: { type: "time", seconds: 600 }, target: { type: "none" } },
    ]);
  });

  it("refuses what the builder can't hold", () => {
    expect(fromHub({ ...intervals, sport: "strength" })).toBeNull();
    expect(fromHub({ ...intervals, blocks: [{ repeats: null, steps: [{ kind: "training", target: "open", intensity: { kind: "none" } }] }] })).toBeNull();
    expect(fromHub({ ...intervals, blocks: [{ repeats: null, steps: [{ kind: "training", target: "time", seconds: 60, intensity: { kind: "none" }, exercise: { id: "1", name: "Squat" } }] }] })).toBeNull();
  });
});

describe("builder steps to COROS workout", () => {
  it("round-trips an untouched COROS workout exactly", () => {
    const got = fromHub(intervals)!;
    expect(toHub(intervals.name, got.sport, got.items, intervals)).toEqual({ workout: intervals });
  });

  it("lays edits over the original step and keeps what COROS knows", () => {
    const got = fromHub(intervals)!;
    const items = got.items.map((i) => (i.id === "cs-s1" && i.type === "step" ? { ...i, length: { type: "time" as const, seconds: 720 } } : i));
    const out = toHub("Renamed", "run", items, intervals);
    if ("problem" in out) throw new Error(out.problem);
    expect(out.workout.name).toBe("Renamed");
    expect(out.workout.sport).toBe("trailRun");
    expect(out.workout.description).toBe("Keep it smooth");
    expect(out.workout.blocks[0]).toEqual({ id: "b1", repeats: null, steps: [{ id: "s1", kind: "warmup", target: "time", seconds: 720, intensity: { kind: "heartRate", low: 124, high: 143 }, name: "Jog" }] });
  });

  it("writes new steps without IDs", () => {
    const out = toHub("Easy", "ride", [{ type: "step", id: "n1", kind: "work", length: { type: "time", seconds: 1800 }, target: { type: "pace", fast: 150, slow: 170 } }]);
    expect(out).toEqual({ workout: { description: "", name: "Easy", sport: "bike", blocks: [{ repeats: null, steps: [{ kind: "training", target: "time", seconds: 1800, intensity: { kind: "pace", low: 150, high: 170 } }] }] } });
  });

  it("refuses heart rate zones and gym workouts", () => {
    const hr = toHub("Easy", "run", [{ type: "step", id: "n1", kind: "work", length: { type: "time", seconds: 600 }, target: { type: "hr", zone: 2 } }]);
    expect("problem" in hr && hr.problem).toMatch(/zones/);
    const gym = toHub("Legs", "strength", [{ type: "step", id: "n1", kind: "work", length: { type: "time", seconds: 600 }, target: { type: "none" } }]);
    expect("problem" in gym && gym.problem).toMatch(/Gym/);
  });
});

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
