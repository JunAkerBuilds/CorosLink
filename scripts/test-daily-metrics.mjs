import assert from "node:assert/strict";
import { parseDailyMetrics } from "../dist-electron/trainingHubService.js";

const scaledDistance = parseDailyMetrics({
  dayList: [{ happenDay: 20260625, trainingLoad: 42, distance: 650000, duration: 240000 }]
});

assert.equal(scaledDistance.dayList[0]?.distance, 6500);
assert.equal(scaledDistance.dayList[0]?.duration, 2400);

const aliasFields = parseDailyMetrics({
  dayList: [
    {
      date: 20260626,
      trainingLoad: 68,
      totalDistance: 1120000,
      totalTime: 390000
    }
  ]
});

assert.equal(aliasFields.dayList[0]?.happenDay, "20260626");
assert.equal(aliasFields.dayList[0]?.distance, 11200);
assert.equal(aliasFields.dayList[0]?.duration, 3900);

const listScale = parseDailyMetrics({
  dayList: [{ happenDay: "20260627", distance: 8200, duration: 2700, trainingLoad: 51 }]
});

assert.equal(listScale.dayList[0]?.distance, 8200);
assert.equal(listScale.dayList[0]?.duration, 2700);

const restingHr = parseDailyMetrics({
  dayList: [
    { happenDay: "20261019", rhr: 53, testRhr: 57 },
    { happenDay: "20261020", rhr: 63 }
  ]
});

assert.equal(restingHr.dayList[0]?.rhr, 57, "resting HR is COROS's testRhr");
assert.equal(restingHr.dayList[1]?.rhr, undefined, "the all-day rhr is not resting HR");

const vo2 = parseDailyMetrics({
  dayList: [
    { happenDay: "20261009", vo2max: 47, cycleVo2max: 0 },
    { happenDay: "20261010", vo2max: 47, cycleVo2max: 51 }
  ]
});

assert.equal(vo2.dayList[0]?.cycleVo2max, undefined, "COROS sends 0 for no cycling VO2max");
assert.equal(vo2.dayList[1]?.cycleVo2max, 51, "cycling VO2max is its own field");
assert.equal(vo2.dayList[1]?.vo2max, 47, "vo2max stays the running one");

console.log("daily metrics parser tests passed");
