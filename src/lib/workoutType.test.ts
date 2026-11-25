import { describe, expect, it } from "vitest";
import { workoutType } from "./workoutType";

describe("the kind of session a planned workout is", () => {
  it("reads the name the way a runner means it", () => {
    expect(workoutType("Easy run 25 min", "run")).toBe("easy");
    expect(workoutType("Easy 30 min + 4 strides", "run")).toBe("easy");
    expect(workoutType("Long run 60 min", "run")).toBe("long");
    expect(workoutType("Threshold 3×10 min", "run")).toBe("tempo");
    expect(workoutType("Tempo 20 min", "run")).toBe("tempo");
    expect(workoutType("VO2 5×1 km", "run")).toBe("intervals");
    expect(workoutType("6 × 800 m", "run")).toBe("intervals");
    expect(workoutType("Fartlek 8×1 min", "run")).toBe("speed");
    expect(workoutType("Hill repeats", "run")).toBe("hills");
    expect(workoutType("Hills, 8 × 60 s", "run")).toBe("hills");
    expect(workoutType("Hill sprints", "run")).toBe("speed");
    expect(workoutType("Recovery jog", "run")).toBe("recovery");
    expect(workoutType("Strides, 6 × 20 s", "run")).toBe("speed");
    expect(workoutType("5K time trial", "run")).toBe("race");
    expect(workoutType("Leg Workout", "strength")).toBe("strength");
    expect(workoutType("Easy spin", "bike")).toBe("cross");
  });
  it("falls back to the steps and the length", () => {
    expect(workoutType("Tuesday session", "run", { name: "", sport: "run", description: "", items: [{ type: "repeat", id: "r", count: 5, steps: [] }] })).toBe("intervals");
    expect(workoutType("Sunday run", "run", undefined, 95)).toBe("long");
    expect(workoutType("Sunday run", "run", undefined, 40)).toBe("easy");
  });
});
