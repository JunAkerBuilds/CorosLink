import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = Date.now();
const load = async (file) =>
  import(`${pathToFileURL(path.join(repoRoot, "electron", file)).href}?cacheBust=${bust}`);

const {
  canonicalStrengthExerciseName,
  normalizeHevyWorkout
} = await load("hevyModel.ts");
const {
  combineStrengthSessions,
  mergeStrengthSessionPair,
  selectStrengthSessions
} = await load("strengthSessionMerge.ts");

const templates = new Map([
  [
    "bench",
    {
      id: "bench",
      title: "Bench Press (Barbell)",
      type: "weight_reps",
      primary_muscle_group: "chest",
      secondary_muscle_groups: ["triceps"]
    }
  ],
  [
    "plank",
    {
      id: "plank",
      title: "Plank",
      type: "duration",
      primary_muscle_group: "abdominals",
      secondary_muscle_groups: []
    }
  ],
  [
    "assisted",
    {
      id: "assisted",
      title: "Assisted Pull Up",
      type: "bodyweight_assisted_reps",
      primary_muscle_group: "lats",
      secondary_muscle_groups: ["biceps"]
    }
  ]
]);

const rawWorkout = {
  id: "hevy-1",
  title: "Push Day",
  start_time: "2026-07-20T12:00:00Z",
  end_time: "2026-07-20T13:05:00Z",
  exercises: [
    {
      index: 0,
      title: "Bench Press (Barbell)",
      exercise_template_id: "bench",
      sets: [
        { index: 0, type: "warmup", weight_kg: 20, reps: 10, rpe: null },
        { index: 1, type: "normal", weight_kg: 80, reps: 8, rpe: 8.5 },
        { index: 2, type: "dropset", weight_kg: 60, reps: 10, rpe: 10 },
        { index: 3, type: "failure", weight_kg: 50, reps: 12, rpe: 12 }
      ]
    },
    {
      index: 1,
      title: "Plank",
      exercise_template_id: "plank",
      sets: [{ index: 0, type: "normal", duration_seconds: 75, reps: null }]
    },
    {
      index: 2,
      title: "Assisted Pull Up",
      exercise_template_id: "assisted",
      sets: [{ index: 0, type: "normal", weight_kg: 25, reps: 6 }]
    }
  ]
};

const withoutWarmups = normalizeHevyWorkout(rawWorkout, templates, false);
assert.ok(withoutWarmups);
assert.equal(withoutWarmups.source, "hevy");
assert.deepEqual(withoutWarmups.sourceIds, { hevy: "hevy-1" });
assert.equal(withoutWarmups.duration, 3_900);
assert.equal(withoutWarmups.detail.summary.sets, 5);
assert.equal(withoutWarmups.detail.exercises[0].entries[0].rpe, 8.5);
assert.equal(
  withoutWarmups.detail.exercises[0].entries[2].rpe,
  undefined,
  "out-of-range RPE is discarded"
);
assert.equal(withoutWarmups.detail.exercises[1].entries[0].workSec, 75);
assert.equal(
  withoutWarmups.detail.exercises[2].entries[0].weightKg,
  0,
  "assistance must not be counted as lifted weight"
);
assert.equal(withoutWarmups.detail.summary.totalWeightKg, 80 * 8 + 60 * 10 + 50 * 12);

const withWarmups = normalizeHevyWorkout(rawWorkout, templates, true);
assert.ok(withWarmups);
assert.equal(withWarmups.detail.summary.sets, 6);
assert.equal(withWarmups.detail.summary.totalWeightKg, 20 * 10 + 80 * 8 + 60 * 10 + 50 * 12);

assert.equal(canonicalStrengthExerciseName("Bench Press (Barbell)"), "bench press");
assert.equal(
  canonicalStrengthExerciseName("Bench Press (Dumbbell)"),
  "dumbbell bench press"
);

const coros = {
  activityId: "coros-1",
  sportType: 402,
  name: "Strength",
  startTime: withoutWarmups.startTime + 120,
  duration: 3_800,
  calories: 420,
  avgHr: 128,
  maxHr: 171,
  trainingLoad: 54,
  detail: {
    summary: {
      sets: 3,
      totalReps: 30,
      totalWeightKg: 1_000,
      exercises: 1,
      calories: 420,
      durationSec: 3_800
    },
    exercises: [
      {
        nameKey: "T1041",
        rawName: "Bench Press",
        sets: 3,
        totalReps: 30,
        entries: [{ reps: 10, weightKg: 70, workSec: 30, restSec: 60, calories: 5 }]
      }
    ]
  }
};

const merged = mergeStrengthSessionPair(coros, withoutWarmups);
assert.equal(merged.source, "combined");
assert.equal(merged.name, "Push Day");
assert.equal(merged.detail.exercises.length, 3, "Hevy supplies the set detail");
assert.equal(merged.avgHr, 128);
assert.equal(merged.detail.summary.trainingLoad, 54);

const combined = combineStrengthSessions([coros], [withoutWarmups]);
assert.equal(combined.length, 1);
assert.equal(combined[0].source, "combined");
assert.equal(selectStrengthSessions("hevy", [coros], [withoutWarmups]).length, 1);
assert.equal(selectStrengthSessions("coros", [coros], [withoutWarmups])[0].source, "coros");

const laterHevy = {
  ...withoutWarmups,
  activityId: "hevy:later",
  sourceIds: { hevy: "later" },
  startTime: withoutWarmups.startTime + 8 * 3_600
};
assert.equal(
  combineStrengthSessions([coros], [withoutWarmups, laterHevy]).length,
  2,
  "a second same-day workout must remain separate"
);

const codeOnlyCoros = {
  ...coros,
  activityId: "coros-code",
  startTime: withoutWarmups.startTime + 30,
  duration: withoutWarmups.duration,
  detail: {
    ...coros.detail,
    exercises: [{ ...coros.detail.exercises[0], rawName: undefined }]
  }
};
assert.equal(
  combineStrengthSessions([codeOnlyCoros], [withoutWarmups]).length,
  1,
  "very close time and duration provide a safe fallback for coded COROS exercises"
);

assert.equal(normalizeHevyWorkout({ ...rawWorkout, id: undefined }, templates, false), undefined);
assert.equal(
  normalizeHevyWorkout({ ...rawWorkout, start_time: "not-a-date" }, templates, false),
  undefined
);

console.log("hevy-strength tests passed");
