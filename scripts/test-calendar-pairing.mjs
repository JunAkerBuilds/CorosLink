import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { pairPlannedWithActual, computeWeeklyStats } = await import(
  `${pathToFileURL(path.join(repoRoot, "src", "calendar", "pairing.ts")).href}?cacheBust=${Date.now()}`
);

const at = (day, hour) => Math.round(new Date(2026, 9, day, hour).valueOf() / 1000);
const foundation = { planId: "p", idInPlan: "1", planProgramId: "1", happenDay: "20261020", name: "Block 6 W3D1: Foundation Run", trainingLoad: 67, volume: "8.00km" };
const strides = { planId: "p", idInPlan: "2", planProgramId: "2", happenDay: "20261020", name: "Block 6 W3D1: 4x20s Strides", trainingLoad: 10, volume: "2 set(s)" };
const walkA = { activityId: "a", name: "Port of Spain Walk", sportType: 900, startTime: at(20, 7), duration: 1876, movingTime: 1621, distance: 2170, trainingLoad: 3 };
const walkB = { activityId: "b", name: "Sangre Grande Walk", sportType: 900, startTime: at(20, 12), duration: 1165, movingTime: 1164, distance: 1570, trainingLoad: 1 };
const walkC = { activityId: "c", name: "Port of Spain Walk", sportType: 900, startTime: at(20, 18), duration: 1488, movingTime: 1309, distance: 1750, trainingLoad: 2 };
const walks = [walkA, walkB, walkC];

// The reported day: nothing linked, so nothing combines — like COROS's calendar.
{
  const { pairs, unplanned } = pairPlannedWithActual([strides, foundation], walks);
  assert.deepEqual(pairs.map((pair) => pair.activity), [undefined, undefined]);
  assert.deepEqual(unplanned.map((activity) => activity.activityId), ["a", "b", "c"]);
}

// COROS's own link (entity.sportData) pairs them and its rate is the badge.
{
  const linked = { ...foundation, corosActivity: { activityId: "a", completeRate: 0.05 } };
  const { pairs, unplanned } = pairPlannedWithActual([strides, linked], walks);
  assert.equal(pairs[1].activity?.activityId, "a");
  assert.equal(pairs[1].linkSource, "coros");
  assert.equal(pairs[1].completionPct, 5);
  assert.equal(pairs[0].activity, undefined);
  assert.deepEqual(unplanned.map((activity) => activity.activityId), ["b", "c"]);
}

// A COROS link without labelId falls back to the start time.
{
  const linked = { ...foundation, corosActivity: { startTime: walkC.startTime } };
  const { pairs } = pairPlannedWithActual([linked], walks);
  assert.equal(pairs[0].activity?.activityId, "c");
}

// The user's link pairs them; load ratio is the badge.
{
  const manual = [{ planId: "p", idInPlan: "2", happenDay: "20261020", activityId: "b" }];
  const { pairs, unplanned } = pairPlannedWithActual([strides, foundation], walks, manual);
  assert.equal(pairs[0].activity?.activityId, "b");
  assert.equal(pairs[0].linkSource, "manual");
  assert.equal(pairs[0].completionPct, 10);
  assert.equal(pairs[1].activity, undefined);
  assert.deepEqual(unplanned.map((activity) => activity.activityId), ["a", "c"]);
}

// The user's link beats COROS's; "none" hides COROS's.
{
  const linked = { ...foundation, corosActivity: { activityId: "a" } };
  const swapped = pairPlannedWithActual([linked], walks, [{ planId: "p", idInPlan: "1", happenDay: "20261020", activityId: "c" }]);
  assert.equal(swapped.pairs[0].activity?.activityId, "c");
  assert.equal(swapped.pairs[0].linkSource, "manual");
  const hidden = pairPlannedWithActual([linked], walks, [{ planId: "p", idInPlan: "1", happenDay: "20261020" }]);
  assert.equal(hidden.pairs[0].activity, undefined);
  assert.equal(hidden.unplanned.length, 3);
}

// A manual link only counts on the workout's day (a moved workout drops it).
{
  const moved = { ...strides, happenDay: "20261021" };
  const { pairs } = pairPlannedWithActual([moved], walks, [{ planId: "p", idInPlan: "2", happenDay: "20261020", activityId: "b" }]);
  assert.equal(pairs[0].activity, undefined);
}

// COROS may credit an activity from another day; it leaves that day's list.
{
  const yesterday = { ...foundation, happenDay: "20261019", corosActivity: { activityId: "a" } };
  const { pairs, unplanned } = pairPlannedWithActual([yesterday], walks);
  assert.equal(pairs[0].activity?.activityId, "a");
  assert.equal(unplanned.some((activity) => activity.activityId === "a"), false);
}

// One activity, one workout.
{
  const both = [
    { ...foundation, corosActivity: { activityId: "a" } },
    { ...strides, corosActivity: { activityId: "a" } }
  ];
  const { pairs } = pairPlannedWithActual(both, walks);
  assert.equal(pairs[0].activity?.activityId, "a");
  assert.equal(pairs[1].activity, undefined);
}

// Week totals count moving time, like the cards.
{
  const { pairs, unplanned } = pairPlannedWithActual([], walks);
  const stats = computeWeeklyStats([{ dateKey: "20261020", inMonth: true, isToday: true, isPast: false, scheduled: [], activities: walks, pairs, unplannedActivities: unplanned }]);
  assert.equal(stats.activityTimeSeconds, 1621 + 1164 + 1309);
}

console.log("calendar pairing tests passed");
