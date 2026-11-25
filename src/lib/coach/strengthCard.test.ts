import { describe, expect, it } from "vitest";
import type { WorkoutCard } from "@/data/coach";
import type { HubWorkout, HubWorkoutStep } from "@/data/hub";
import type { NativeGymWorkout } from "@/data/sync/native";
import { blockNote } from "./prompt";
import { liftHistory, strengthLines } from "./strengthCard";
import { parseWorkout, workoutCard } from "./workout";

const none = { kind: "none" as const };
const one = (step: HubWorkoutStep) => ({ repeats: null, steps: [step] });
const set = (kind: "normal" | "warmUp", weightKg: number | undefined, reps?: number, seconds?: number) => ({ id: "s", kind, weightKg, reps, seconds });

const LOG: NativeGymWorkout[] = [
  { id: "old", start: 100, entries: [{ id: "e0", exerciseID: "squat-barbell", sets: [set("normal", 100, 5)] }] },
  { id: "new", start: 200, entries: [
    { id: "e1", exerciseID: "squat-barbell", sets: [set("warmUp", 40, 8), set("normal", 80, 6), set("normal", 80, 6), set("normal", 80, 5)] },
    { id: "e2", exerciseID: "romanian-deadlift-barbell", sets: [set("normal", 70, 8), set("normal", 70, 7)] },
    { id: "e3", exerciseID: "walking-lunge", sets: [set("normal", undefined, 9), set("normal", undefined, 9)] },
    { id: "e4", exerciseID: "plank", sets: [set("normal", undefined, undefined, 40)] },
  ] },
];
const NAMES = { "squat-barbell": "Back squat", "romanian-deadlift-barbell": "Romanian deadlift" };

describe("the athlete's last logged sets", () => {
  it("keeps each exercise's newest workout, its heaviest working weight and the most reps at it, warm-ups left out", () => {
    const h = liftHistory(LOG, NAMES);
    expect(h.get("back squat")).toEqual({ kg: 80, reps: 6, seconds: 0 });
    expect(h.get("squat barbell")).toEqual({ kg: 80, reps: 6, seconds: 0 });
    expect(h.get("romanian deadlift")).toEqual({ kg: 70, reps: 8, seconds: 0 });
    expect(h.get("walking lunge")).toEqual({ kg: 0, reps: 9, seconds: 0 });
    expect(h.get("plank")).toEqual({ kg: 0, reps: 0, seconds: 40 });
    expect(liftHistory([])).toEqual(new Map());
  });
});

describe("a strength card's lines", () => {
  const W: HubWorkout = { name: "Legs", sport: "strength", description: "", blocks: [
    one({ kind: "warmup", target: "time", seconds: 480, intensity: none, name: "Bike and mobility" }),
    one({ kind: "training", target: "reps", count: 6, sets: 4, restSeconds: 150, intensity: { kind: "weight", low: 82.5 }, name: "Back squat" }),
    one({ kind: "training", target: "reps", count: 8, sets: 3, restSeconds: 120, intensity: { kind: "weight", low: 70 }, name: "Romanian deadlift" }),
    one({ kind: "training", target: "reps", count: 10, sets: 3, restSeconds: 90, intensity: { kind: "bodyweight" }, name: "Walking lunge" }),
    one({ kind: "rest", target: "time", seconds: 120, intensity: none }),
    one({ kind: "training", target: "time", seconds: 45, sets: 3, restSeconds: 45, intensity: { kind: "bodyweight" }, name: "Plank" }),
    one({ kind: "training", target: "open", sets: 2, intensity: none, name: "Farmer carry" }),
    one({ kind: "cooldown", target: "open", intensity: none }),
  ] };

  it("puts the warm-up and cool-down in blocks of their own, and every number with its unit", () => {
    const { lifts, before, after } = strengthLines(W);
    expect(before).toEqual([{ name: "Bike and mobility", amount: { value: "8", unit: "min" } }]);
    expect(after).toEqual([{ name: "Cool-down", amount: { value: "", unit: "to lap button" } }]);
    expect(lifts.map((l) => [l.kind, l.name, l.sets, `${l.each.value} ${l.each.unit}`.trim(), l.load === null || l.load === "bodyweight" ? l.load : `${l.load.value} ${l.load.unit}`, l.rest])).toEqual([
      ["lift", "Back squat", 4, "6 reps", "82.5 kg", "2:30"],
      ["lift", "Romanian deadlift", 3, "8 reps", "70 kg", "2:00"],
      ["lift", "Walking lunge", 3, "10 reps", "bodyweight", "1:30"],
      ["rest", "Rest", 0, "", null, "2:00"],
      ["lift", "Plank", 3, "45 s hold", "bodyweight", "0:45"],
      ["lift", "Farmer carry", 2, "to lap button", null, ""],
    ]);
    expect(lifts.some((l) => l.up)).toBe(false);
  });

  it("marks only where today goes past the last logged sets, on the number that goes up", () => {
    const { lifts } = strengthLines(W, liftHistory(LOG, NAMES));
    expect(Object.fromEntries(lifts.map((l) => [l.name, l.up ?? null]))).toEqual({
      "Back squat": { on: "load", by: "+2.5" }, "Romanian deadlift": null, "Walking lunge": { on: "each", by: "+1" }, Rest: null, Plank: { on: "each", by: "+5 s" }, "Farmer carry": null,
    });
  });

  it("marks nothing when today is lighter, or the reps go up at a different weight", () => {
    const lighter: HubWorkout = { ...W, blocks: [one({ kind: "training", target: "reps", count: 10, sets: 3, intensity: { kind: "weight", low: 60 }, name: "Back squat" })] };
    expect(strengthLines(lighter, liftHistory(LOG, NAMES)).lifts[0].up).toBeUndefined();
  });

  it("counts a circuit's sets once per round", () => {
    const circuit: HubWorkout = { ...W, blocks: [{ repeats: 3, steps: [{ kind: "training", target: "reps", count: 12, intensity: { kind: "bodyweight" }, name: "Push-up" }] }] };
    expect(strengthLines(circuit).lifts[0]).toMatchObject({ name: "Push-up", sets: 3 });
  });
});

describe("the strength card as Coach puts it up", () => {
  const GYM = { name: "Lower body", sport: "strength", blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 480, name: "Bike and mobility" }] },
    { steps: [{ kind: "training", target: "reps", count: 6, sets: 4, restSeconds: 150, exercise: "Back squat", intensity: { kind: "weight", low: 82.5 } }] },
    { steps: [{ kind: "training", target: "reps", count: 8, sets: 3, restSeconds: 120, exercise: "Romanian deadlift", intensity: { kind: "weight", low: 70 } }] },
  ] };
  const card = () => {
    const made = parseWorkout(GYM, "2026-11-26", "w");
    if ("error" in made) throw new Error(made.error);
    return workoutCard(made, null, { id: "c", date: "2026-11-26" }, null, liftHistory(LOG, NAMES));
  };

  it("carries its lines, a summary line and the main muscles, in the strength colour", () => {
    const c = card();
    expect(c.hue).toBe("pink");
    // 8:00 warm-up + 4 × 18 s + 3 × 2:30 rest + 3 × 24 s + 2 × 2:00 rest = 21:54.
    expect(c.body).toMatchObject({ kind: "strength", line: "2 lifts · 7 sets · about 22 min", before: [{ name: "Bike and mobility" }] });
    expect(c.body!.lifts!.map((l) => [l.name, l.up?.by ?? ""])).toEqual([["Back squat", "+2.5"], ["Romanian deadlift", ""]]);
    expect(c.body!.works).toEqual(["glutes", "quads", "hamstrings"]);
  });

  it("tells the model when the athlete said not now", () => {
    const c: WorkoutCard = { ...card(), declined: { at: 1 } };
    expect(blockNote(c)).toBe("[Proposed adding “Lower body” on 2026-11-26: the athlete said not now]");
    expect(blockNote({ ...c, declined: undefined })).toMatch(/waiting for the athlete/);
  });
});
