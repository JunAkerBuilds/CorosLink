import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "calendar", "scheduledStructure.ts")
);
const {
  buildScheduledWorkoutView,
  formatStepDistanceLabel,
  formatStepTimeLabel
} = await import(`${modUrl.href}?cacheBust=${Date.now()}`);

// --- label helpers ---
assert.equal(formatStepTimeLabel(90), "1:30");
assert.equal(formatStepTimeLabel(600), "10:00");
assert.equal(formatStepTimeLabel(3661), "1:01:01");
assert.equal(formatStepDistanceLabel(800, "metric"), "800 m");
assert.equal(formatStepDistanceLabel(7000, "metric"), "7.00 km");
assert.equal(formatStepDistanceLabel(21097, "metric"), "21.1 km");
assert.equal(formatStepDistanceLabel(1609.344, "imperial"), "1.00 mi");
assert.equal(formatStepDistanceLabel(91.44, "imperial", true), "100 yd");

// --- raw path: simple distance run (mirrors COROS schedule payload) ---
const simpleRun = buildScheduledWorkoutView({
  rawProgram: {
    name: "7km Easy Run",
    sportType: 1,
    exercises: [
      {
        id: "1",
        exerciseType: 2,
        name: "T3001",
        targetType: 5,
        targetValue: 700000,
        intensityType: 0,
        intensityValue: 0,
        sets: 1,
        sortNo: 1
      }
    ]
  }
}, "metric");
assert.equal(simpleRun.source, "raw");
assert.equal(simpleRun.nodes.length, 1);
assert.equal(simpleRun.nodes[0].type, "step");
assert.equal(simpleRun.nodes[0].step.kind, "training");
assert.equal(simpleRun.nodes[0].step.name, "Training"); // T-name → friendly
assert.equal(simpleRun.nodes[0].step.targetLabel, "7.00 km");
assert.equal(simpleRun.nodes[0].step.magnitude, 7000);
assert.equal(simpleRun.nodes[0].step.magnitudeType, "distance");
assert.equal(simpleRun.totals.distanceMeters, 7000);
assert.equal(simpleRun.totals.stepCount, 1);
assert.equal(simpleRun.totals.repeatGroups, 0);

// --- raw path: intervals with a repeat group + pace intensity ---
const intervalRun = buildScheduledWorkoutView({
  rawProgram: {
    name: "Rolling 400s",
    sportType: 1,
    exercises: [
      {
        id: "w",
        exerciseType: 1,
        name: "Warm-up",
        targetType: 2,
        targetValue: 600,
        intensityType: 0,
        sets: 1,
        sortNo: 1
      },
      {
        id: "g1",
        exerciseType: 2,
        name: "Repeat",
        isGroup: true,
        sets: 6,
        sortNo: 2
      },
      {
        id: "i1",
        exerciseType: 2,
        name: "Interval",
        groupId: "g1",
        targetType: 5,
        targetValue: 80000,
        intensityType: 3,
        intensityValue: 240000,
        intensityValueExtend: 250000,
        intensityMultiplier: 1000,
        sets: 1,
        sortNo: 3
      },
      {
        id: "r1",
        exerciseType: 4,
        name: "Rest",
        groupId: "g1",
        targetType: 2,
        targetValue: 90,
        intensityType: 0,
        sets: 1,
        sortNo: 4
      },
      {
        id: "c",
        exerciseType: 3,
        name: "Cool-down",
        targetType: 5,
        targetValue: 100000,
        intensityType: 0,
        sets: 1,
        sortNo: 5
      }
    ]
  }
}, "metric");
assert.equal(intervalRun.nodes.length, 3);
assert.deepEqual(
  intervalRun.nodes.map((node) => node.type),
  ["step", "repeat", "step"]
);
assert.equal(intervalRun.nodes[0].step.kind, "warmup");
assert.equal(intervalRun.nodes[0].step.targetLabel, "10:00");
const group = intervalRun.nodes[1];
assert.equal(group.repeat, 6);
assert.equal(group.steps.length, 2);
assert.equal(group.steps[0].kind, "training");
assert.equal(group.steps[0].targetLabel, "800 m");
assert.equal(group.steps[0].intensityLabel, "4:00–4:10/km");
assert.equal(group.steps[1].kind, "rest");
assert.equal(group.steps[1].targetLabel, "1:30");
assert.equal(group.magnitude, 800); // per-rep distance dominates
assert.equal(group.magnitudeType, "distance");
assert.equal(intervalRun.nodes[2].step.kind, "cooldown");
assert.equal(intervalRun.totals.distanceMeters, 6 * 800 + 1000);
assert.equal(intervalRun.totals.durationSeconds, 600 + 6 * 90);
assert.equal(intervalRun.totals.stepCount, 4);
assert.equal(intervalRun.totals.repeatGroups, 1);

const imperialIntervals = buildScheduledWorkoutView({
  rawProgram: intervalRun.sourceProgram ?? {
    name: "Imperial intervals",
    sportType: 1,
    exercises: [
      {
        id: "i1",
        exerciseType: 2,
        name: "Interval",
        targetType: 5,
        targetValue: 80000,
        intensityType: 3,
        intensityValue: 240000,
        intensityValueExtend: 250000,
        intensityMultiplier: 1000,
        sets: 1,
        sortNo: 1
      }
    ]
  }
}, "imperial");
assert.equal(imperialIntervals.nodes[0].step.targetLabel, "0.50 mi");
assert.equal(imperialIntervals.nodes[0].step.intensityLabel, "6:26–6:42/mi");

// --- raw path: strength exercises (sets × reps @ weight) ---
const strength = buildScheduledWorkoutView({
  rawProgram: {
    name: "Lower Body",
    sportType: 13,
    exercises: [
      {
        id: "s1",
        exerciseType: 2,
        name: "Back Squat",
        targetType: 3,
        targetValue: 10,
        intensityType: 1,
        intensityValue: 60,
        sets: 3,
        sortNo: 1
      },
      {
        id: "s2",
        exerciseType: 2,
        name: "Walking Lunge",
        targetType: 3,
        targetValue: 12,
        intensityType: 1,
        intensityValue: 24,
        sets: 3,
        sortNo: 2
      }
    ]
  }
}, "metric");
assert.equal(strength.nodes.length, 2);
assert.equal(strength.nodes[0].step.sets, 3);
assert.equal(strength.nodes[0].step.reps, 10);
assert.equal(strength.nodes[0].step.weight, 60);
assert.equal(strength.nodes[0].step.weightUnit, "kg");
assert.equal(strength.nodes[0].step.targetLabel, "10 reps");
assert.equal(strength.nodes[1].step.weight, 24);

const imperialStrength = buildScheduledWorkoutView({
  rawProgram: {
    name: "Imperial strength",
    sportType: 13,
    exercises: [{
      id: "s1",
      exerciseType: 2,
      name: "Back Squat",
      targetType: 3,
      targetValue: 10,
      intensityType: 1,
      intensityValue: 10,
      sets: 3,
      sortNo: 1
    }]
  }
}, "imperial");
assert.equal(imperialStrength.nodes[0].step.weight, 10);
assert.equal(imperialStrength.nodes[0].step.weightUnit, "kg");
assert.match(imperialStrength.nodes[0].step.intensityLabel, /22(?:\.0)? lb/);

// --- fallback path: pre-parsed exercises without rawProgram ---
const fallback = buildScheduledWorkoutView({
  exercises: [
    { name: "Warm-up", targetLabel: "10:00", sets: 1 },
    { name: "Easy Run", targetLabel: "7.00 km", sets: 1 },
    { name: "Cool Down Jog", targetLabel: "5:00", sets: 1 }
  ]
}, "metric");
assert.equal(fallback.source, "parsed");
assert.equal(fallback.nodes.length, 3);
assert.equal(fallback.nodes[0].step.kind, "warmup");
assert.equal(fallback.nodes[0].step.magnitude, 600);
assert.equal(fallback.nodes[0].step.magnitudeType, "time");
assert.equal(fallback.nodes[1].step.kind, "training");
assert.equal(fallback.nodes[1].step.magnitude, 7000);
assert.equal(fallback.nodes[2].step.kind, "cooldown");
assert.equal(fallback.totals.distanceMeters, 7000);
assert.equal(fallback.totals.durationSeconds, 900);

// --- fallback path: strength keeps sets/reps/weight ---
const fallbackStrength = buildScheduledWorkoutView({
  exercises: [
    { name: "Bench Press", sets: 4, reps: 8, weight: 80, targetLabel: "8 reps" }
  ]
}, "metric");
assert.equal(fallbackStrength.nodes[0].step.sets, 4);
assert.equal(fallbackStrength.nodes[0].step.reps, 8);
assert.equal(fallbackStrength.nodes[0].step.weight, 80);
assert.equal(fallbackStrength.nodes[0].step.weightUnit, "kg");

// --- empty entry ---
const empty = buildScheduledWorkoutView({}, "metric");
assert.equal(empty.nodes.length, 0);
assert.equal(empty.totals.stepCount, 0);
assert.equal(empty.totals.distanceMeters, undefined);

console.log("scheduled-structure tests passed");
