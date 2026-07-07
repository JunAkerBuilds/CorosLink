import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { parseDailyHealthDataResponse, pickLatestDailyHealthRecord } = await import(
  `${distUrl("dailyHealthDataService.js")}?cacheBust=${Date.now()}`
);

const structuredPayload = JSON.stringify({
  dailyHealthDataList: [
    {
      happenDay: "20260707",
      steps: 9284,
      calories: 2387
    }
  ]
});
const structuredRecords = parseDailyHealthDataResponse(
  structuredPayload,
  "20260707"
);
assert.equal(structuredRecords.length, 1);
assert.equal(structuredRecords[0].happenDay, "20260707");
assert.equal(structuredRecords[0].steps, 9284);
assert.equal(structuredRecords[0].calories, 2387);

const nestedPayload = JSON.stringify({
  data: {
    date: "2026-07-07",
    summary: {
      stepCount: "9,284",
      totalCalories: "2,387 kcal"
    }
  }
});
const nestedRecords = parseDailyHealthDataResponse(nestedPayload, "20260707");
assert.equal(nestedRecords.length, 1);
assert.equal(nestedRecords[0].steps, 9284);
assert.equal(nestedRecords[0].calories, 2387);

const wrappedPayload = JSON.stringify({
  text: JSON.stringify(
    [
      "Daily Health Data",
      "========================",
      "",
      "2026-07-07",
      "Steps: 9,284",
      "Calories: 2,387 kcal"
    ].join("\n")
  )
});
const wrappedRecords = parseDailyHealthDataResponse(wrappedPayload, "20260707");
assert.equal(wrappedRecords.length, 1);
assert.equal(wrappedRecords[0].happenDay, "20260707");
assert.equal(wrappedRecords[0].steps, 9284);
assert.equal(wrappedRecords[0].calories, 2387);

const latest = pickLatestDailyHealthRecord([
  { happenDay: "20260706", steps: 10000, calories: 2400 },
  { happenDay: "20260707", steps: 9284 }
]);
assert.equal(latest?.happenDay, "20260707");
assert.equal(latest?.steps, 9284);
assert.equal(latest?.calories, undefined);

assert.deepEqual(parseDailyHealthDataResponse("", "20260707"), []);

console.log("daily health data parser tests passed");
