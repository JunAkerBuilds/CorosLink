import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "src", "training", "hallOfBests.ts"));
const { activityRecords, milestones, sportTally, workBuckets, workTotals } = await import(
  `${modUrl.href}?cacheBust=${Date.now()}`
);

const DAY = 86_400;
const start = Date.UTC(2026, 9, 5, 8) / 1000;
// 60 km in 2 h of riding plus a 90 min café stop (elapsed 3 h 30).
const cafeRide = { activityId: "cafe", sportType: 200, startTime: start, distance: 60_000, duration: 12_600, movingTime: 7_200 };
// 50 km at a steady 20 km/h, no stops.
const steadyRide = { activityId: "steady", sportType: 200, startTime: start + DAY, distance: 50_000, duration: 9_000, movingTime: 9_000 };
// Cached before movingTime existed: elapsed time stands in.
const legacyRide = { activityId: "legacy", sportType: 200, startTime: start + 2 * DAY, distance: 30_000, duration: 4_500 };
const rides = [cafeRide, steadyRide, legacyRide];

// Records use moving time, as COROS does: the café stop neither lengthens
// "in the saddle" nor slows the fastest ride.
const [longest, inSaddle, climb, fastest] = activityRecords(rides, "ride");
assert.equal(longest.activity.activityId, "cafe");
assert.equal(inSaddle.activity.activityId, "steady");
assert.equal(inSaddle.value, 9_000);
assert.equal(climb, null);
assert.equal(fastest.activity.activityId, "cafe");
assert.equal(fastest.value, 30);

assert.equal(milestones(rides).longestSession?.activityId, "steady");
assert.equal(workTotals(rides).duration, 7_200 + 9_000 + 4_500);
assert.equal(sportTally(rides, "ride").duration, 7_200 + 9_000 + 4_500);
const { buckets } = workBuckets(rides, start * 1000, (start + 3 * DAY) * 1000);
assert.equal(buckets.reduce((total, bucket) => total + bucket.total, 0), 7_200 + 9_000 + 4_500);

// Record stories: the staircase keeps only times that beat every earlier one.
const { recordHistory, bestAsOf, reachShare, findRecordActivity, activitySeries } = await import(
  `${modUrl.href}?cacheBust=${Date.now()}-stories`
);
const history = recordHistory(
  ["5:20250110:1400", "5:20250301:1420", "5:20250601:1350", "4:20250601:3000", "5:20250601:1340", "bad"],
  5,
  { time: new Date(2026, 9, 22).getTime(), seconds: 1292 }
);
assert.deepEqual(history.map((point) => point.seconds), [1400, 1340, 1292]);
assert.equal(bestAsOf(history, new Date(2025, 3, 1).getTime())?.seconds, 1400);
assert.equal(bestAsOf(history, new Date(2024, 0, 1).getTime()), null);
assert.equal(recordHistory([], 5, { time: 1, seconds: 100 }).length, 1);

assert.equal(reachShare(1292, 1300), 1);
assert.ok(reachShare(1292, 1265) > 0.8 && reachShare(1292, 1265) < 0.9);
assert.equal(reachShare(1000, 700), 0);

const day = new Date(2026, 9, 22).getTime();
const runA = { activityId: "a", sportType: 100, startTime: day / 1000 + 3600, distance: 5200 };
const runB = { activityId: "b", sportType: 100, startTime: day / 1000 + 7200, distance: 3000 };
assert.equal(findRecordActivity([runA, runB], { day, meters: 5000 })?.activityId, "a");
assert.equal(findRecordActivity([runA, { ...runB, distance: 6000 }], { day, meters: 5000 }), null);
assert.equal(findRecordActivity([runA, runB], { activityId: "b", day: null })?.activityId, "b");

assert.deepEqual(activitySeries(rides, "ride", "distance"), [60_000, 50_000, 30_000]);

console.log("hall of bests tests passed");
