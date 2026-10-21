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
assert.equal(scheduled[0]?.corosActivity, undefined, "no sportData = COROS linked nothing");

// entity.sportData is the activity COROS credited to the workout: it links the
// pair but must not replace the planned name, load or distance.
const linked = parseScheduledWorkoutEntries({
  entities: [
    {
      happenDay: 20261020,
      planId: "plan-2",
      idInPlan: "7",
      planProgramId: "7",
      completeRate: "0.85",
      sportData: { labelId: "480757304470307016", startTime: 1790957363, name: "Port of Spain Walk", trainingLoad: 3, distance: 217000 }
    },
    { happenDay: 20261020, planId: "plan-2", idInPlan: "8", planProgramId: "8", completeRate: "-1.00" }
  ],
  programs: [
    { id: "prog-7", idInPlan: "7", name: "Foundation Run", trainingLoad: 67, distance: 800000 },
    { id: "prog-8", idInPlan: "8", name: "Strides", trainingLoad: 10 }
  ]
});
assert.equal(linked[0]?.name, "Foundation Run");
assert.equal(linked[0]?.trainingLoad, 67);
assert.equal(linked[0]?.volume, "8.00km");
assert.deepEqual(linked[0]?.corosActivity, { activityId: "480757304470307016", startTime: 1790957363, completeRate: 0.85 });
assert.equal(linked[1]?.corosActivity, undefined);

console.log("training hub write response tests passed");
