import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dragModuleUrl = pathToFileURL(
  path.join(repoRoot, "src", "calendar", "calendarDrag.ts")
);
const {
  createCalendarDragPayload,
  moveScheduledWorkoutEntries,
  parseCalendarDragPayload
} = await import(`${dragModuleUrl.href}?cacheBust=${Date.now()}`);

const workout = {
  planId: "plan-1",
  idInPlan: "workout-2",
  planProgramId: "program-3",
  happenDay: "20260722",
  name: "Easy Run",
  trainingLoad: 42
};

const payload = createCalendarDragPayload(workout);
assert.deepEqual(payload, {
  planId: "plan-1",
  idInPlan: "workout-2",
  planProgramId: "program-3",
  happenDay: "20260722",
  name: "Easy Run"
});
assert.deepEqual(parseCalendarDragPayload(JSON.stringify(payload)), payload);

for (const invalid of [
  "",
  "not json",
  "{}",
  JSON.stringify({ ...payload, planId: "" }),
  JSON.stringify({ ...payload, happenDay: "2026-07-22" }),
  JSON.stringify({ ...payload, name: 123 })
]) {
  assert.equal(parseCalendarDragPayload(invalid), null);
}

const otherWorkout = {
  ...workout,
  idInPlan: "workout-4",
  name: "Intervals"
};
const source = [workout, otherWorkout];
const moved = moveScheduledWorkoutEntries(source, payload, "20260724");

assert.equal(source[0].happenDay, "20260722", "source data is not mutated");
assert.equal(moved[0].happenDay, "20260724");
assert.strictEqual(moved[1], otherWorkout, "unrelated entries retain identity");

const rolledBack = moveScheduledWorkoutEntries(
  moved,
  { ...payload, happenDay: "20260724" },
  payload.happenDay
);
assert.deepEqual(rolledBack, source);

console.log("calendar drag tests passed");
