import assert from "node:assert/strict";
import { parseRacePredictor } from "../dist-electron/trainingHubService.js";

const fixture = {
  staminaLevel: 75,
  recoveryPct: 82,
  aerobicEnduranceScore: 77,
  lactateThresholdCapacityScore: 71,
  runScoreList: [
    { type: 1, duration: 14417, avgPace: 342 },
    { type: 2, duration: 6774, avgPace: 321 },
    { type: 4, duration: 3000, avgPace: 300 },
    { type: 5, duration: 1439, avgPace: 288 }
  ]
};

const predictor = parseRacePredictor(fixture);

assert.equal(predictor.staminaLevel, 75);
assert.equal(predictor.recoveryPct, 82);
assert.equal(predictor.runScoreList.length, 4);

const [fiveK, tenK, half, marathon] = predictor.runScoreList;

assert.equal(fiveK.distanceLabel, "5K");
assert.equal(fiveK.distance, 5000);
assert.equal(fiveK.predictSeconds, 1439);
assert.equal(fiveK.avgPace, 288);

assert.equal(tenK.distanceLabel, "10K");
assert.equal(tenK.distance, 10000);
assert.equal(tenK.predictSeconds, 3000);
assert.equal(tenK.avgPace, 300);

assert.equal(half.distanceLabel, "Half Marathon");
assert.equal(half.distance, 21097);
assert.equal(half.predictSeconds, 6774);
assert.equal(half.avgPace, 321);

assert.equal(marathon.distanceLabel, "Marathon");
assert.equal(marathon.distance, 42195);
assert.equal(marathon.predictSeconds, 14417);
assert.equal(marathon.avgPace, 342);

const legacyFixture = parseRacePredictor({
  runScoreList: [
    {
      raceType: 5,
      predictSecond: 1500,
      distance: 5000,
      raceName: "5 km"
    }
  ]
});

assert.equal(legacyFixture.runScoreList.length, 1);
assert.equal(legacyFixture.runScoreList[0].predictSeconds, 1500);
assert.equal(legacyFixture.runScoreList[0].distanceLabel, "5K");

const emptyFixture = parseRacePredictor({
  runScoreList: [{ type: 5, avgPace: 300 }]
});

assert.equal(emptyFixture.runScoreList.length, 0);

console.log("test-race-predictor: all assertions passed");
