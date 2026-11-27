// Ported from CorosKit's TrainingHubWorkoutTests.swift: the same workouts, the same expected COROS programs.
import { describe, expect, it } from "vitest";
import type { HubWorkout } from "@/data/hub";
import { HubProblem } from "./errors";
import type { JsonObject } from "./json";
import { hubTotals, hubWorkoutProblem } from "./rules";
import { attachSources, buildProgram, readCatalog, readProgram, toWeb } from "./workout";

const intervals: HubWorkout = {
  name: "6 × 800 m", sport: "run", description: "Track session", blocks: [
    { repeats: null, steps: [{ kind: "warmup", target: "time", seconds: 900, intensity: { kind: "heartRate", low: 120, high: 140 } }] },
    { repeats: 6, steps: [
      { kind: "training", target: "distance", meters: 800, intensity: { kind: "pace", low: 225, high: 235 } },
      { kind: "rest", target: "time", seconds: 90, intensity: { kind: "none" } },
    ] },
    { repeats: null, steps: [{ kind: "cooldown", target: "open", intensity: { kind: "none" } }] },
  ],
};
const rows = (program: JsonObject) => program.exercises as JsonObject[];
/** What the browser would hold and send back after reading `program`. */
const roundTrip = (program: JsonObject): HubWorkout => JSON.parse(JSON.stringify(toWeb(readProgram(program)!))) as HubWorkout;

describe("writing a COROS program", () => {
  it("matches CorosLink's builder", () => {
    const program = buildProgram(intervals);
    expect(program).toMatchObject({ name: "6 × 800 m", sportType: 1, pbVersion: 2, targetType: 5, targetValue: 480_000, estimatedTime: 900 + 6 * 90 });
    const exercises = rows(program);
    expect(exercises).toHaveLength(5);
    // Warm-up, group, its two steps, cool-down; sort numbers as buildWorkoutPayload spaces them.
    expect(exercises.map((row) => row.sortNo)).toEqual([16_777_216, 33_554_432, 33_554_432 + 65_536, 33_554_432 + 131_072, 50_331_648]);
    expect(exercises[1]).toMatchObject({ isGroup: true, sets: 6 });
    expect(exercises[2]).toMatchObject({ groupId: "2", intensityType: 3, intensityValue: 225_000, intensityMultiplier: 1000, targetDisplayUnit: 2 });
    expect(exercises[3].exerciseType).toBe(4);   // Training Hub's rest
    expect(exercises[4]).toMatchObject({ exerciseType: 3, targetType: 1 });
    expect(exercises[0].hrType).toBe(2);
  });

  it("reads back what it writes", () => {
    const read = toWeb(readProgram(buildProgram(intervals))!);
    expect(read.name).toBe("6 × 800 m");
    expect(read.description).toBe("Track session");
    expect(read.blocks.map((block) => block.repeats)).toEqual([null, 6, null]);
    expect(read.blocks[1].steps.map((step) => step.kind)).toEqual(["training", "rest"]);
    expect(read.blocks[1].steps[0].meters).toBe(800);
    expect(read.blocks[1].steps[0].intensity).toEqual({ kind: "pace", low: 225, high: 235 });
    expect(read.blocks[0].steps[0].intensity).toEqual({ kind: "heartRate", low: 120, high: 140 });
    expect(read.blocks[2].steps[0].target).toBe("open");
    expect(hubTotals(read)).toEqual({ seconds: 900 + 6 * 90, meters: 4800, sets: 0 });
    // COROS's rows never reach the browser; each step and repeat keeps its row's ID instead.
    expect(JSON.stringify(read)).not.toContain("sortNo");
    expect(read.blocks.map((block) => block.id)).toEqual([undefined, "2", undefined]);
    expect(read.blocks.flatMap((block) => block.steps.map((step) => step.id))).toEqual(["1", "3", "4", "5"]);
  });

  it("keeps COROS's fields and unknown targets through an edit made in the browser", () => {
    const source = buildProgram(intervals);
    source.id = "4711";
    source.planId = "99";
    // A zone target (heart rate as % of max) the editor can't show.
    Object.assign(rows(source)[0], { isIntensityPercent: true, intensityCustom: 3, originId: "426109589008859136" });

    const workout = roundTrip(source);
    expect(workout.blocks[0].steps[0].intensity.kind).toBe("kept");
    workout.name = "5 × 800 m";
    workout.blocks[1].repeats = 5;
    workout.blocks.push({ repeats: null, steps: [{ kind: "training", target: "distance", meters: 2000, intensity: { kind: "none" } }] });
    const edited = buildProgram(attachSources(workout, source), source);
    expect(edited).toMatchObject({ id: "4711", planId: "99", name: "5 × 800 m" });
    const out = rows(edited);
    expect(out[0]).toMatchObject({ intensityCustom: 3, isIntensityPercent: true, originId: "426109589008859136" });
    expect(out[1].sets).toBe(5);
    expect(new Set(out.map((row) => row.id)).size).toBe(out.length);
    expect(out[out.length - 1].targetValue).toBe(200_000);
    // The source program itself is left as COROS sent it.
    expect(source.name).toBe("6 × 800 m");
    expect(rows(source)).toHaveLength(5);
  });

  it("says what stops COROS taking a workout", () => {
    expect(hubWorkoutProblem({ ...intervals, name: "", blocks: [] })).toBe("Give the workout a name.");
    expect(hubWorkoutProblem({ ...intervals, name: "x", blocks: [] })).toBe("Add at least one step.");
    const swimPace: HubWorkout = { name: "x", sport: "swim", description: "", blocks: [
      { repeats: null, steps: [{ kind: "training", target: "distance", meters: 100, intensity: { kind: "pace", low: 100, high: 110 } }] }] };
    expect(hubWorkoutProblem(swimPace)).toBe("That target isn't available for this step.");
    expect(hubWorkoutProblem(intervals)).toBeNull();
    expect(() => buildProgram(swimPace)).toThrow(HubProblem);
    expect(hubWorkoutProblem({ ...intervals, blocks: [{ repeats: 100, steps: intervals.blocks[1].steps }] })).toBe("Repeats go from 1 to 99.");
    expect(hubWorkoutProblem({ ...intervals, blocks: [{ repeats: null, steps: intervals.blocks[1].steps }] })).toBe("A step on its own holds one step.");
  });

  it("writes strength catalog exercises and reads them back", () => {
    const squat = { id: "426109589008859999", name: "Back Squat", code: "T1234", overview: "sid_strength_back_squat" };
    const workout: HubWorkout = { name: "Legs", sport: "strength", description: "", blocks: [
      { repeats: null, steps: [{ kind: "warmup", target: "time", seconds: 300, intensity: { kind: "none" } }] },
      { repeats: null, steps: [{ kind: "training", target: "reps", count: 8, intensity: { kind: "weight", low: 80 }, exercise: squat, sets: 4, restSeconds: 120 }] },
      { repeats: null, steps: [{ kind: "rest", target: "hrRecovery", bpm: 100, intensity: { kind: "none" } }] },
    ] };
    expect(hubWorkoutProblem(workout)).toBeNull();
    const program = buildProgram(workout);
    expect(program.sportType).toBe(4);
    expect((program.referExercise as JsonObject).valueType).toBeUndefined();
    const exercises = rows(program);
    expect(exercises[1]).toMatchObject({
      // COROS's own code as the name, its description code, and the weight in grams: a readable name with
      // `sid_strength_training` shows as "Training" and plain kilograms as 0.0 kg on COROS's own site.
      originId: "426109589008859999", name: "T1234", targetType: 3, targetValue: 8, sets: 4, restType: 1, restValue: 120,
      intensityType: 1, intensityValue: 80_000, intensityDisplayUnit: 6, overview: "sid_strength_back_squat",
    });
    expect(roundTrip(program).blocks[1].steps[0].intensity).toEqual({ kind: "weight", low: 80 });
    // A save from before grams were known holds plain kilograms.
    expect(roundTrip({ ...program, exercises: exercises.map((row, index) => (index === 1 ? { ...row, intensityValue: 80 } : row)) }).blocks[1].steps[0].intensity).toEqual({ kind: "weight", low: 80 });
    expect(exercises[2]).toMatchObject({ targetType: 7, targetValue: 100 });
    expect(hubTotals(workout).sets).toBe(4);

    // COROS names catalog exercises with codes; the editor shows the exercise and keeps the code on save.
    const stored = { ...program, exercises: exercises.map((row, index) => (index === 1 ? { ...row, name: "T1234", overview: "sid_strength_back_squat" } : row)) };
    const read = roundTrip(stored);
    const step = read.blocks[1].steps[0];
    expect(step.name).toBeUndefined();
    expect(step.exercise).toEqual({ id: "426109589008859999", name: "Back Squat" });
    expect(step.sets).toBe(4);
    expect(step.restSeconds).toBe(120);
    expect(step.intensity).toEqual({ kind: "weight", low: 80 });
    step.count = 6;
    const saved = rows(buildProgram(attachSources(read, stored), stored));
    expect(saved[1]).toMatchObject({ name: "T1234", overview: "sid_strength_back_squat", targetValue: 6 });
    // A different exercise takes its own name and description code, never the generic placeholder's.
    step.exercise = { id: "77", name: "Deadlift" };
    const swapped = rows(buildProgram(attachSources(read, stored), stored));
    expect(swapped[1]).toMatchObject({ originId: "77", name: "Deadlift", overview: "" });
    step.exercise = { id: "78", name: "Goblet Squat", code: "T1301", overview: "sid_strength_goblet_squat" };
    expect(rows(buildProgram(attachSources(read, stored), stored))[1]).toMatchObject({ originId: "78", name: "T1301", overview: "sid_strength_goblet_squat" });
  });

  it("needs an exercise for a new strength step", () => {
    const workout: HubWorkout = { name: "Gym", sport: "strength", description: "", blocks: [
      { repeats: null, steps: [{ kind: "training", target: "reps", count: 10, intensity: { kind: "none" } }] }] };
    expect(hubWorkoutProblem(workout)).toBe("Pick an exercise for each strength step.");
    // An `id` the browser made up is not a COROS row, so the server still asks for one.
    workout.blocks[0].steps[0].id = "5";
    expect(() => buildProgram(attachSources(workout, { exercises: [] }))).toThrow("Pick an exercise for each strength step.");
  });

  it("writes HYROX stations and runs", () => {
    const sled = { id: "900", name: "Sled Push", kind: 2 };
    const workout: HubWorkout = { name: "HYROX sim", sport: "hyrox", description: "", blocks: [
      { repeats: 2, steps: [
        { kind: "training", target: "distance", meters: 1000, intensity: { kind: "pace", low: 280, high: 290 } },
        { kind: "training", target: "distance", meters: 50, intensity: { kind: "weight", low: 152 }, exercise: sled },
      ] },
    ] };
    expect(hubWorkoutProblem(workout)).toBeNull();
    const program = buildProgram(workout);
    expect(program.pbVersion).toBe(9);
    const exercises = rows(program);
    expect(exercises[1].exerciseKind).toBe(0);
    expect(exercises[1].hyroxTrainingMode).toBeUndefined();
    expect(exercises[2]).toMatchObject({ subType: 2, exerciseKind: 2, hyroxTrainingMode: "strength" });
    // A station can't carry a pace.
    workout.blocks[0].steps[1].intensity = { kind: "pace", low: 200, high: 210 };
    expect(hubWorkoutProblem(workout)).toBe("That target isn't available for this step.");
  });

  it("writes climbing grades", () => {
    const workout: HubWorkout = { name: "Project night", sport: "bouldering", description: "", blocks: [
      { repeats: null, steps: [{ kind: "training", target: "routes", count: 5, intensity: { kind: "grade", grade: "V4" } }] },
      { repeats: null, steps: [{ kind: "training", target: "routes", count: 3, intensity: { kind: "grade", gradeOffset: 2 } }] },
    ] };
    expect(hubWorkoutProblem(workout)).toBeNull();
    const program = buildProgram(workout);
    expect(program.pbVersion).toBe(7);
    expect(program.referExercise).toMatchObject({ intensityType: 10, gradeSystem: 7 });
    const exercises = rows(program);
    expect(exercises[0]).toMatchObject({ targetType: 9, intensityValue: 5, onsightGradeOffset: 0 });   // V4 is the fifth V grade
    expect(exercises[1].onsightGradeOffset).toBe(34);
    const read = toWeb(readProgram(program)!);
    expect(read.gradeSystem).toBe("vScale");
    expect(read.blocks[0].steps[0].intensity.grade).toBe("V4");
    expect(read.blocks[1].steps[0].intensity.gradeOffset).toBe(2);
  });

  it("writes trail elevation and cross-country skiing", () => {
    const trail: HubWorkout = { name: "Hills", sport: "trailRun", description: "", blocks: [
      { repeats: null, steps: [{ kind: "training", target: "elevationGain", meters: 300, intensity: { kind: "none" } }] }] };
    const program = buildProgram(trail);
    expect(rows(program)[0]).toMatchObject({ targetType: 8, targetValue: 30_000 });
    expect(program.pbVersion).toBe(4);
    expect(hubWorkoutProblem({ ...trail, sport: "run" })).toBe("A step ends on something this sport doesn't support.");
    const ski: HubWorkout = { name: "Ski", sport: "xcSki", description: "", blocks: [
      { repeats: null, steps: [{ kind: "training", target: "time", seconds: 3600, intensity: { kind: "speed", low: 12, high: 15 } }] }] };
    expect(buildProgram(ski).pbVersion).toBe(9);
  });

  it("uses COROS's swim stroke IDs", () => {
    const workout: HubWorkout = { name: "Swim", sport: "swim", description: "", blocks: (["mix", "drills", "individualMedley"] as const).map((stroke) => (
      { repeats: null, steps: [{ kind: "training" as const, target: "distance" as const, meters: 100, intensity: { kind: "stroke" as const, stroke } }] })) };
    const program = buildProgram(workout);
    expect(rows(program).map((row) => row.intensityValue)).toEqual([255, 6, 7]);
    expect(program).toMatchObject({ poolLength: 2500, poolLengthUnit: 2, distanceDisplayUnit: 2 });
  });

  it("writes and reads the pool's own length", () => {
    const workout: HubWorkout = { name: "Long course", sport: "swim", description: "", poolLength: 50, blocks: [
      { repeats: null, steps: [{ kind: "training", target: "distance", meters: 400, intensity: { kind: "none" } }] }] };
    const program = buildProgram(workout);
    expect(program).toMatchObject({ poolLengthId: 0, poolLength: 5000, poolLengthUnit: 2 });
    expect(readProgram(program)?.poolLength).toBe(50);
    // An edit that doesn't name a length leaves COROS's own alone; one that does replaces it.
    const { poolLength: _left, ...unnamed } = workout;
    void _left;
    expect(buildProgram(unnamed, program).poolLength).toBe(5000);
    expect(buildProgram({ ...workout, poolLength: 33.33 }, program).poolLength).toBe(3333);
    expect(readProgram(buildProgram({ name: "Run", sport: "run", description: "", blocks: workout.blocks }))).not.toHaveProperty("poolLength");
  });

  it("labels a typed pool in yards for an athlete in imperial", () => {
    const workout: HubWorkout = { name: "Yards", sport: "swim", description: "", poolLength: 22.86, blocks: [
      { repeats: null, steps: [{ kind: "training", target: "distance", meters: 400, intensity: { kind: "none" } }] }] };
    expect(buildProgram(workout, null, { imperial: true })).toMatchObject({ poolLength: 2286, poolLengthUnit: 4 });
    expect(buildProgram(workout)).toMatchObject({ poolLength: 2286, poolLengthUnit: 2 });
  });

  it("shows weights in pounds when asked, keeping kilograms", () => {
    const workout: HubWorkout = { name: "Gym", sport: "strength", description: "", blocks: [{ repeats: null, steps: [
      { kind: "training", target: "reps", count: 5, intensity: { kind: "weight", low: 61.23 }, exercise: { id: "2", name: "Squat" } }] }] };
    expect(rows(buildProgram(workout, null, { imperial: false, pounds: true }))[0]).toMatchObject({ intensityDisplayUnit: 7, intensityValue: 61_230, overview: "" });
  });

  it("leaves the step when its exercise is dropped", () => {
    const original: HubWorkout = { name: "Legs", sport: "strength", description: "", blocks: [{ repeats: null, steps: [
      { kind: "training", target: "reps", count: 8, intensity: { kind: "none" }, exercise: { id: "426109589008859999", name: "Back Squat" }, sets: 3 }] }] };
    const source = buildProgram(original);
    const read = roundTrip(source);
    read.blocks[0].steps[0] = { id: read.blocks[0].steps[0].id, kind: "rest", target: "time", seconds: 60, intensity: { kind: "none" } };
    expect(rows(buildProgram(attachSources(read, source), source))[0]).toMatchObject({ originId: "0", name: "Rest", exerciseType: 4 });
  });

  it("can't edit swim send-offs or sports it doesn't write", () => {
    const program = buildProgram({ name: "Swim", sport: "swim", description: "", blocks: [
      { repeats: null, steps: [{ kind: "training", target: "distance", meters: 100, intensity: { kind: "none" } }] }] });
    rows(program)[0].exerciseType = 5;
    expect(readProgram(program)).toBeNull();
    expect(readProgram({ sportType: 77, exercises: [] })).toBeNull();
  });
});

describe("the exercise catalog", () => {
  it("reads rows by readable name, one per ID", () => {
    const catalog = readCatalog({ list: [
      { id: "1", originId: "0", name: "T1001", overview: "sid_strength_bench_press" },
      { id: "2", name: "Barbell Back Squat", exerciseKind: 0 },
      { id: "3", name: "S2001", overview: "sid_strength_wall_balls", exerciseKind: 8 },
      { id: "2", name: "Barbell Back Squat" },
    ] });
    expect(catalog.map((exercise) => exercise.name)).toEqual(["Barbell Back Squat", "Bench Press", "Wall Balls"]);
    expect(catalog[2]).toEqual({ id: "3", name: "Wall Balls", kind: 8, code: "S2001", overview: "sid_strength_wall_balls" });
    expect(catalog[0]).toEqual({ id: "2", name: "Barbell Back Squat" });
    expect(catalog[1].id).toBe("1");
  });
});
