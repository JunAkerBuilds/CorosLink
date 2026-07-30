import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildTrainingHubActivityPagePlan,
  parseTrainingHubApiResponse
} = await import(
  `${distUrl("trainingHubService.js")}?cacheBust=${Date.now()}`
);

assert.deepEqual(buildTrainingHubActivityPagePlan(1, 50), {
  requests: [{ page: 1, size: 50 }],
  sliceStart: 0
});
assert.deepEqual(buildTrainingHubActivityPagePlan(1, 500), {
  requests: [1, 2, 3, 4, 5].map((page) => ({ page, size: 100 })),
  sliceStart: 0
});
assert.deepEqual(buildTrainingHubActivityPagePlan(2, 150), {
  requests: [2, 3].map((page) => ({ page, size: 100 })),
  sliceStart: 50
});
assert.throws(
  () => buildTrainingHubActivityPagePlan(0, 50),
  /page must be a positive integer/
);
assert.throws(
  () => buildTrainingHubActivityPagePlan(1, Number.NaN),
  /page size must be a positive integer/
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
