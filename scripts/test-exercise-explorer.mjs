import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "strength", "exerciseExplorerData.ts")
);
const { buildExerciseExplorer } = await import(
  `${modUrl.href}?cacheBust=${Date.now()}`
);

const DAY = 86_400;
const start = 1_720_000_000;

const exercise = (nameKey, entries, rawName) => ({
  nameKey,
  rawName,
  sets: entries.length,
  totalReps: entries.reduce((sum, entry) => sum + entry.reps, 0),
  entries: entries.map((entry) => ({
    reps: entry.reps,
    weightKg: entry.weightKg,
    workSec: entry.workSec ?? 30,
    restSec: entry.restSec ?? 90,
    calories: entry.calories ?? 5
  }))
});

const session = (activityId, day, exercises, name = "Gym") => ({
  activityId,
  sportType: 402,
  name,
  startTime: start + day * DAY,
  duration: 3_600,
  trainingLoad: 40,
  detail: {
    summary: {
      sets: exercises.reduce((sum, item) => sum + item.entries.length, 0),
      totalReps: exercises.reduce((sum, item) => sum + item.totalReps, 0),
      totalWeightKg: 0,
      exercises: exercises.length,
      calories: 200,
      durationSec: 3_600
    },
    exercises
  }
});

const benchSessions = [
  session("bench-1", 1, [exercise("T1041", [{ reps: 10, weightKg: 60 }])]),
  session("bench-2", 8, [exercise("T1041", [{ reps: 8, weightKg: 70 }])]),
  session("bench-3", 15, [
    // COROS can split one lift into multiple blocks in a single activity. The
    // explorer should show one session with continuous set numbering.
    exercise("T1041", [{ reps: 6, weightKg: 75 }]),
    exercise("T1041", [{ reps: 10, weightKg: 65 }])
  ]),
  session("bench-4", 22, [exercise("T1041", [{ reps: 5, weightKg: 80 }])]),
  session("bench-5", 29, [exercise("T1041", [{ reps: 5, weightKg: 82.5 }])])
];

const bench = buildExerciseExplorer(benchSessions, "Bench Press");

assert.equal(bench.sessions.length, 5);
assert.equal(bench.sessions[0].activityId, "bench-5", "sessions are newest first");
assert.equal(bench.totalSets, 6);
assert.equal(bench.totalReps, 44);
assert.equal(bench.heaviestSet?.weightKg, 82.5);
assert.equal(bench.heaviestSet?.reps, 5);
assert.ok(Math.abs((bench.bestE1rmSet?.e1rmKg ?? 0) - 96.25) < 0.001);

const merged = bench.sessions.find((item) => item.activityId === "bench-3");
assert.ok(merged, "the split activity should be present");
assert.deepEqual(merged.sets.map((set) => set.setNumber), [1, 2]);
assert.equal(merged.volumeKg, 1_100);
assert.ok(merged.prs.includes("volume"));

assert.deepEqual(
  bench.repRangeRecords.map((record) => [record.id, record.weightKg, record.reps]),
  [
    ["4-6", 82.5, 5],
    ["7-9", 70, 8],
    ["10-12", 65, 10]
  ]
);
assert.equal(bench.comparison?.latest.activityId, "bench-5");
assert.equal(bench.comparison?.previous.activityId, "bench-4");
assert.deepEqual(bench.sessions[0].prs.sort(), ["e1rm", "weight"]);
assert.equal(bench.plateau.state, "progressing");

const flatSessions = Array.from({ length: 4 }, (_, index) =>
  session(`flat-${index}`, index * 7, [
    exercise("T1041", [{ reps: 5, weightKg: 100 }])
  ])
);
const flat = buildExerciseExplorer(flatSessions, "Bench Press");
assert.equal(flat.plateau.state, "plateau");
assert.equal(flat.plateau.sessionsConsidered, 4);

const plank = buildExerciseExplorer(
  [session("plank-1", 1, [exercise("T1010", [{ reps: 1, weightKg: 0, workSec: 60 }])])],
  "Planks"
);
assert.equal(plank.sessions.length, 1);
assert.equal(plank.totalVolumeKg, 0);
assert.equal(plank.heaviestSet, undefined);
assert.equal(plank.bestE1rmSet, undefined);
assert.deepEqual(plank.repRangeRecords, []);
assert.equal(plank.plateau.state, "insufficient");

console.log("exercise-explorer tests passed");
