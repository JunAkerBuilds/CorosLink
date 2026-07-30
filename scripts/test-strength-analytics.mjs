import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = Date.now();
const load = async (...segments) => {
  const url = pathToFileURL(path.join(repoRoot, ...segments));
  return import(`${url.href}?cacheBust=${bust}`);
};

const { resolveExerciseTargets, MUSCLES } = await load("src", "strength", "muscles.ts");
const {
  buildStrengthAnalytics,
  estimateOneRepMax,
  formatVolumeKg,
  formatWeightKg
} = await load(
  "src",
  "strength",
  "strengthAnalytics.ts"
);

// ---- Muscle resolution ----

const shareOf = (name, muscle) =>
  resolveExerciseTargets(name).activations.find((a) => a.muscle === muscle)?.share ?? 0;

// A compound press credits the prime mover most and the assistance partially.
assert.ok(shareOf("Bench Press", "chest") > shareOf("Bench Press", "triceps"));
assert.ok(shareOf("Bench Press", "triceps") > 0);
assert.equal(shareOf("Bench Press", "quads"), 0);

// Activations always sum to 1 so a set is never double-counted.
for (const name of ["Squats", "Deadlifts", "Pull Ups", "Planks", "Two Arm Kettlebell Swings"]) {
  const total = resolveExerciseTargets(name).activations.reduce((sum, a) => sum + a.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `${name} activations should sum to 1`);
}

// Exceptions must beat the broader rules that would otherwise swallow them.
assert.ok(shareOf("Plank Row", "lats") > 0, "Plank Row is a back exercise");
assert.ok(shareOf("Pike Push Up", "shoulders") > shareOf("Pike Push Up", "chest"));
assert.ok(shareOf("Close Grip Bench Press", "triceps") > shareOf("Close Grip Bench Press", "chest"));
assert.ok(shareOf("Behind The Neck Pulldowns", "lats") > 0, "not a neck exercise");
assert.ok(shareOf("Lying Leg Curls", "hamstrings") === 1, "leg curl is not a biceps curl");
assert.ok(shareOf("Inverse Nordic Curl", "quads") === 1);

// Body regions from unstructured sessions resolve too.
assert.ok(shareOf("Legs & Hips", "quads") > 0);
assert.ok(shareOf("Arms", "biceps") > 0 && shareOf("Arms", "triceps") > 0);

// Recovery work carries no training credit.
for (const name of ["Quadriceps Stretch", "Foam Rolling Quads", "Warm Up", "Rest"]) {
  const targets = resolveExerciseTargets(name);
  assert.equal(targets.mobility, true, `${name} should be mobility`);
  assert.equal(targets.activations.length, 0);
}

// ---- Epley estimate ----

assert.equal(estimateOneRepMax(100, 1), 100);
assert.ok(Math.abs(estimateOneRepMax(100, 10) - 133.33) < 0.01);
assert.equal(estimateOneRepMax(0, 10), 0, "bodyweight sets have no 1RM estimate");
assert.equal(estimateOneRepMax(100, 40), 0, "rep counts outside the usable range are ignored");
assert.equal(formatWeightKg(10, "metric"), "10 kg");
assert.equal(formatWeightKg(10, "imperial"), "22.0 lb");
assert.equal(formatVolumeKg(1_000, "metric"), "1.0t");
assert.equal(formatVolumeKg(1_000, "imperial"), "2,205 lb");

// ---- Aggregation ----

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

const session = (activityId, startTime, exercises) => ({
  activityId,
  sportType: 402,
  name: "Gym",
  startTime,
  duration: 3600,
  trainingLoad: 40,
  detail: {
    summary: {
      sets: exercises.reduce((n, e) => n + e.entries.length, 0),
      totalReps: 0,
      totalWeightKg: 0,
      exercises: exercises.length,
      calories: 300,
      durationSec: 3600
    },
    exercises
  }
});

const exercise = (nameKey, entries) => ({
  nameKey,
  sets: entries.length,
  totalReps: entries.reduce((n, e) => n + e.reps, 0),
  entries: entries.map((entry) => ({ restSec: 90, calories: 8, workSec: 40, ...entry }))
});

const sessions = [
  // T1041 = Bench Press, T1061 = Squats
  session("a", now - 3 * DAY, [
    exercise("T1041", [
      { reps: 10, weightKg: 60 },
      { reps: 8, weightKg: 70 },
      { reps: 6, weightKg: 80 }
    ]),
    exercise("T1061", [
      { reps: 10, weightKg: 100 },
      { reps: 10, weightKg: 100 }
    ])
  ]),
  session("b", now - 17 * DAY, [
    exercise("T1041", [
      { reps: 10, weightKg: 50 },
      { reps: 8, weightKg: 60 }
    ]),
    // T1010 = Planks (bodyweight, no volume load)
    exercise("T1010", [{ reps: 1, weightKg: 0, workSec: 60 }])
  ])
];

const analytics = buildStrengthAnalytics(sessions, 90);

assert.equal(analytics.summary.sessions, 2);
assert.equal(analytics.summary.sets, 8);

// Volume load is Σ reps × weight across every set.
const expectedVolume = 10 * 60 + 8 * 70 + 6 * 80 + 2 * 10 * 100 + 10 * 50 + 8 * 60;
assert.equal(Math.round(analytics.summary.volumeKg), expectedVolume);

assert.equal(analytics.summary.heaviestLift?.name, "Squats");
assert.equal(analytics.summary.heaviestLift?.weightKg, 100);
assert.equal(analytics.summary.bestE1rm?.name, "Squats");

// Chest leads the bench work; quads lead the squats; nothing lands on the neck.
const chest = analytics.muscleById.chest;
const quads = analytics.muscleById.quads;
assert.ok(chest.sets > 0 && quads.sets > 0);
assert.equal(analytics.muscleById.neck.sets, 0);
assert.equal(analytics.muscleById.neck.lastTrained, undefined);

// Unknown custom names fall back to Hevy's exercise-template muscle metadata.
const providerFallback = buildStrengthAnalytics(
  [
    session("hevy-custom", now, [
      {
        ...exercise("Uncatalogued Lever Movement", [{ reps: 10, weightKg: 40 }]),
        primaryMuscleGroup: "quadriceps",
        secondaryMuscleGroups: ["glutes"]
      }
    ])
  ],
  30
);
assert.ok(providerFallback.muscleById.quads.sets > 0);
assert.ok(providerFallback.muscleById.glutes.sets > 0);

// Credited sets never exceed the sets actually performed.
const creditedSets = analytics.muscles.reduce((sum, stat) => sum + stat.sets, 0);
assert.ok(creditedSets <= analytics.summary.sets + 1e-9);

// The plank is the only thing hitting the obliques and it carries no load, so
// they accrue sets and time but no volume.
assert.ok(analytics.muscleById.obliques.sets > 0);
assert.equal(analytics.muscleById.obliques.volumeKg, 0);
assert.ok(analytics.muscleById.obliques.workSec > 0);

// Every muscle appears exactly once, zero-filled.
assert.equal(analytics.muscles.length, MUSCLES.length);

// Bench press progressed 50→80 kg top set across the two sessions.
const bench = analytics.exercises.find((e) => e.name === "Bench Press");
assert.ok(bench, "bench press should be tracked");
assert.equal(bench.sessions, 2);
assert.equal(bench.bestWeightKg, 80);
assert.ok(bench.e1rmTrendKg > 0, "e1RM should trend up from the older session");
assert.deepEqual(
  bench.history.map((point) => point.topWeightKg),
  [60, 80],
  "history is chronological"
);

// Weeks are bucketed and ordered oldest first.
assert.ok(analytics.weeks.length >= 2);
assert.ok(analytics.weeks[0].weekStart < analytics.weeks[analytics.weeks.length - 1].weekStart);

// Push/pull/legs/core shares are populated from the credited sets.
assert.ok(analytics.balance.push > 0 && analytics.balance.legs > 0);

// An empty history must not throw or divide by zero.
const emptyAnalytics = buildStrengthAnalytics([], 90);
assert.equal(emptyAnalytics.summary.sessions, 0);
assert.equal(emptyAnalytics.summary.avgSessionVolumeKg, 0);
assert.equal(emptyAnalytics.muscleMax.sets, 0);
assert.equal(emptyAnalytics.muscles.length, MUSCLES.length);

console.log("strength-analytics tests passed");
