import assert from "node:assert/strict";
import { isoDateFromCompact, listCoachCreations, planEntryScheduleDate } from "../src/chat/chatTypes.ts";

// The Coach creations panel lists local drafts and official COROS review
// cards as one shape, in timeline order.

const workoutDraft = {
  draftId: "draft-workout", artifactType: "workout", name: "Tempo Tuesday", summary: "A tempo session.",
  entries: [{ key: "w1", name: "Tempo", sport: "run", saveToLibrary: true, workoutType: "Run", source: { key: "w1", name: "Tempo", schedule_date: "20261020" } }],
  conflicts: [], warnings: []
};
const planDraft = {
  draftId: "draft-plan", artifactType: "plan", name: "Base build", summary: "Four easy weeks.",
  entries: [
    { key: "p1", name: "Easy", sport: "bike", scheduleDate: "2026-11-02", saveToLibrary: false, workoutType: "Bike" },
    { key: "p2", name: "Long", sport: "bike", scheduleDate: "2026-10-31", saveToLibrary: false, workoutType: "Bike" }
  ],
  conflicts: [], warnings: [], uploadedAt: 1, uploadResult: { workoutsScheduled: 2, workoutsCreated: 0, destination: "calendar" }
};
const corosWorkout = {
  requestId: "req-1", title: "Review workout", summary: "Add an easy run to tomorrow's calendar.",
  destination: "Calendar", date: "20261016", details: ["Run · Easy aerobic run"], createdAt: 1, state: "pending", sport: "run"
};
const corosPlan = {
  requestId: "req-2", title: "Review training plan", summary: "Eight weeks to the half.",
  destination: "Training Plan", date: "20261102", details: [], createdAt: 2, state: "saved"
};

const timeline = [
  { kind: "message", role: "user", content: "Plan tomorrow's run" },
  { kind: "corosAction", preview: corosWorkout },
  { kind: "message", role: "assistant", content: "Review it on the right." },
  { kind: "planDraft", draft: workoutDraft },
  { kind: "planDraft", draft: planDraft },
  { kind: "corosAction", preview: corosPlan },
  { kind: "toolNotice", message: "ignored" }
];

const creations = listCoachCreations(timeline, { "draft-workout": { planName: "Tempo Tuesday", workoutsCreated: 1, workoutsScheduled: 0, entries: [], destination: "workoutLibrary" } });
assert.deepEqual(creations.map(c => c.id), ["coros:req-1", "draft:draft-workout", "draft:draft-plan", "coros:req-2"], "timeline order, ids prefixed per route");
assert.deepEqual(creations.map(c => c.kind), ["corosAction", "planDraft", "planDraft", "corosAction"]);
assert.deepEqual(creations.map(c => c.artifact), ["workout", "workout", "plan", "plan"], "Training Plan destination counts as a plan");
assert.deepEqual(creations.map(c => c.status), ["pending", "saved", "saved", "saved"], "draft saved via this session's upload, plan via its upload result");
assert.deepEqual(creations.map(c => c.date), ["2026-10-16", "2026-10-20", "2026-10-31", "2026-11-02"], "COROS compact dates normalized; drafts use their earliest session");
assert.deepEqual(creations.map(c => c.destination), ["Calendar", "Workout Library", "Calendar", "Training Plan"]);
assert.deepEqual(creations.map(c => c.sport), ["run", "run", "bike", undefined]);
assert.deepEqual(creations.map(c => c.title), ["Review workout", "Tempo Tuesday", "Base build", "Review training plan"]);
assert.equal(creations[0].kind === "corosAction" && creations[0].preview, corosWorkout, "the source preview rides along for the detail card");
assert.equal(creations[2].kind === "planDraft" && creations[2].draft, planDraft);

const unsaved = listCoachCreations([{ kind: "planDraft", draft: { ...workoutDraft, entries: [] } }]);
assert.equal(unsaved[0].status, "draft");
assert.equal(unsaved[0].date, undefined);
assert.equal(listCoachCreations([]).length, 0);

assert.equal(isoDateFromCompact("20261016"), "2026-10-16");
assert.equal(isoDateFromCompact("2026-10-16"), "2026-10-16", "already-ISO dates pass through");
assert.equal(isoDateFromCompact(undefined), undefined);
assert.equal(planEntryScheduleDate({ key: "x", name: "x", saveToLibrary: false, workoutType: "Run", source: { key: "x", name: "x", schedule_date: "2026" } }), undefined, "malformed source dates are ignored");

console.log("coach creations ok");
