import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { parseTrainingHubApiResponse } = await import(
  `${distUrl("trainingHubService.js")}?cacheBust=${Date.now()}`
);

assert.equal(
  parseTrainingHubApiResponse({ result: "0000", data: "12345" }),
  "12345"
);

assert.equal(
  parseTrainingHubApiResponse(
    { result: "0000" },
    { allowEmptyData: true, contextPath: "/training/schedule/update" }
  ),
  undefined
);

assert.throws(
  () =>
    parseTrainingHubApiResponse(
      { result: "0000" },
      { contextPath: "/training/schedule/update" }
    ),
  /\/training\/schedule\/update succeeded but returned no data/
);

assert.throws(
  () => parseTrainingHubApiResponse({ result: "0101", message: "expired" }),
  /expired/
);

assert.throws(
  () =>
    parseTrainingHubApiResponse({
      result: "9999",
      message: "invalid workout"
    }),
  /invalid workout/
);

assert.equal(
  parseTrainingHubApiResponse(
    { result: "0000", data: null },
    { allowEmptyData: true }
  ),
  undefined
);

const { parseScheduledWorkoutEntries } = await import(
  `${distUrl("trainingHubService.js")}?cacheBust=${Date.now()}`
);

const scheduled = parseScheduledWorkoutEntries({
  entities: [
    {
      happenDay: 20260707,
      planId: "plan-1",
      idInPlan: 42,
      planProgramId: "99",
      sortNoInSchedule: 1,
      status: 1
    }
  ],
  programs: [
    {
      id: "prog-1",
      idInPlan: 42,
      name: "Easy 7km",
      distance: 700000
    }
  ]
});

assert.equal(scheduled.length, 1);
assert.equal(scheduled[0]?.name, "Easy 7km");
assert.equal(scheduled[0]?.planId, "plan-1");
assert.equal(scheduled[0]?.idInPlan, "42");

console.log("training hub write response tests passed");
