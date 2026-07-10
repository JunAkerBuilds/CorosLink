import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "strengthDetail.ts"));
const { parseStrengthDetail } = await import(`${modUrl.href}?cacheBust=${Date.now()}`);

const raw = {
  summary: {
    sets: 5,
    totalReps: 66,
    totalWeight: 2016000,
    exercises: 2,
    calories: 100000,
    totalTime: 100000,
    avgHr: 129,
    maxHr: 176,
    trainingLoad: 57,
    aerobicEffect: 2.3,
    anaerobicEffect: 0.4
  },
  lapList: [
    {
      lapItemList: [
        // exercise 1: T1178, 4 work sets each 15 reps @ 32kg, then aggregate, then S3618
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 15, weight: 32000, time: 3487, calories: 10829 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 0, weight: 32000, time: 12000, calories: 0 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 15, weight: 32000, time: 3009, calories: 9555 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 0, weight: 32000, time: 5930, calories: 0 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 15, weight: 32000, time: 2855, calories: 8918 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 0, weight: 32000, time: 12000, calories: 0 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 15, weight: 32000, time: 3212, calories: 10192 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 4, reps: 60, weight: 1920000, time: 12563, calories: 39494 },
        { exerciseIndex: 1, exerciseNameKey: "S3618", sets: 4, reps: 0, weight: 1920000, time: 41930, calories: 0 },
        // exercise 8: T1176, single work set of 6 reps @ 16kg, then aggregate
        { exerciseIndex: 8, exerciseNameKey: "T1176", sets: 0, reps: 6, weight: 16000, time: 5773, calories: 15431 },
        { exerciseIndex: 8, exerciseNameKey: "T1176", sets: 1, reps: 6, weight: 96000, time: 5773, calories: 15431 }
      ]
    }
  ]
};

const detail = parseStrengthDetail(raw);
assert.ok(detail, "strength detail should be produced");

// summary conversions (screenshot oracle)
assert.equal(detail.summary.sets, 5);
assert.equal(detail.summary.totalReps, 66);
assert.equal(detail.summary.totalWeightKg, 2016);
assert.equal(detail.summary.calories, 100);
assert.equal(detail.summary.durationSec, 1000);
assert.equal(detail.summary.avgHr, 129);
assert.equal(detail.summary.aerobicEffect, 2.3);

// grouping
assert.equal(detail.exercises.length, 2);

const ex1 = detail.exercises[0];
assert.equal(ex1.nameKey, "T1178");
assert.equal(ex1.sets, 4);
assert.equal(ex1.totalReps, 60);
assert.equal(ex1.entries.length, 4); // 4 work sets, S3618 dropped, aggregate not a set
assert.deepEqual(ex1.entries[0], { reps: 15, weightKg: 32, workSec: 34.87, restSec: 120, calories: 11 });
assert.equal(ex1.entries[1].restSec, 59.3);
assert.equal(ex1.entries[3].restSec, 0); // last work set has no trailing rest

const ex8 = detail.exercises[1];
assert.equal(ex8.nameKey, "T1176");
assert.equal(ex8.sets, 1);
assert.equal(ex8.entries.length, 1);
assert.equal(ex8.entries[0].weightKg, 16);

// non-strength payload → undefined
assert.equal(parseStrengthDetail({ summary: {}, laps: [] }), undefined);

console.log("strength-detail tests passed");
