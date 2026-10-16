import assert from "node:assert/strict";
import {
  coachMayReplaceBrief,
  findJournalEntry,
  formatJournalEntryForCoach,
  mergeJournalEntry,
  normalizeBrief,
  normalizeDebrief,
  normalizeJournalRef
} from "../electron/workoutJournalModel.ts";

const NOW = "2026-10-15T08:00:00.000Z";
const LATER = "2026-10-16T08:00:00.000Z";
let ids = 0;
const options = (author, now = NOW) => ({ author, now, entryId: () => `entry-${++ids}`, cueId: () => `cue-${++ids}` });
const scheduled = { happenDay: "20261016", planId: "p1", idInPlan: "7", workoutName: "Long run" };

// A ref needs a scheduled occurrence or an activity, and a real day.
assert.throws(() => normalizeJournalRef({ happenDay: "20261016" }), /Choose a workout/);
assert.throws(() => normalizeJournalRef({ happenDay: "2026-1-6", activityId: "a1" }), /YYYYMMDD/);
assert.deepEqual(normalizeJournalRef({ happenDay: "2026-10-16", activityId: 42, planId: "p1" }), { happenDay: "20261016", activityId: "42" });

// Briefs: trimmed, one line per cue, capped, empty means nothing to keep.
const brief = normalizeBrief(
  { goal: "  Aerobic durability\nand fuel practice ", cues: [{ id: "bad id!", text: " Gel every 30 min " }, { id: "", text: "  " }, "Easy on the climbs"], notes: "" },
  "athlete",
  undefined,
  NOW,
  () => `cue-${++ids}`
);
assert.equal(brief.goal, "Aerobic durability and fuel practice");
assert.deepEqual(brief.cues.map((cue) => cue.text), ["Gel every 30 min", "Easy on the climbs"]);
assert.ok(brief.cues.every((cue) => /^cue-\d+$/.test(cue.id)));
assert.equal(brief.author, "athlete");
assert.equal(brief.notes, undefined);
assert.equal(normalizeBrief({ goal: " ", cues: [] }, "athlete", undefined, NOW), undefined);

// A coach brief stays the coach's when the athlete edits it, and says so.
const coachBrief = normalizeBrief({ goal: "Tempo control", cues: [{ id: "c1", text: "Hold 4:15/km" }] }, "coach", undefined, NOW);
assert.equal(coachBrief.author, "coach");
assert.equal(coachMayReplaceBrief(coachBrief), true);
const unchanged = normalizeBrief({ goal: "Tempo control", cues: [{ id: "c1", text: "Hold 4:15/km" }] }, "athlete", coachBrief, LATER);
assert.equal(unchanged.edited, undefined, "saving without changes is not an edit");
assert.equal(unchanged.updatedAt, NOW);
const edited = normalizeBrief({ goal: "Tempo control", cues: [{ id: "c1", text: "Hold 4:20/km" }] }, "athlete", coachBrief, LATER);
assert.equal(edited.author, "coach");
assert.equal(edited.edited, true);
assert.equal(coachMayReplaceBrief(edited), false);
assert.equal(coachMayReplaceBrief({ ...brief }), false);

// Debriefs: outcomes only for cues that exist, feel 1–5, fueling kept when meaningful.
const debrief = normalizeDebrief(
  { feel: 4, cueOutcomes: { c1: "hit", gone: "missed", c2: "nope" }, fueling: { taken: " Maurten 160 ", experiment: true, outcome: "good" }, notes: "Felt smooth" },
  [{ id: "c1", text: "Hold 4:15/km" }, { id: "c2", text: "Relax shoulders" }],
  false,
  NOW
);
assert.deepEqual(debrief.cueOutcomes, { c1: "hit" });
assert.deepEqual(debrief.fueling, { taken: "Maurten 160", experiment: true, outcome: "good" });
assert.equal(normalizeDebrief({ feel: 9, cueOutcomes: {}, fueling: { experiment: false } }, [], false, NOW), undefined);

// Merging: sections are independent; null clears; both empty deletes.
let entry = mergeJournalEntry(undefined, { ref: scheduled, brief: { goal: "Long and steady", cues: [{ id: "c1", text: "Gel at 40 min" }] } }, options("athlete"));
assert.equal(entry.brief.goal, "Long and steady");
assert.equal(entry.debrief, undefined);
entry = mergeJournalEntry(entry, { ref: { ...scheduled, activityId: "act-9" }, debrief: { feel: 2, cueOutcomes: { c1: "missed" }, notes: "Bonked at 25 km" } }, options("athlete", LATER));
assert.equal(entry.brief.goal, "Long and steady", "a debrief save keeps the brief");
assert.equal(entry.activityId, "act-9", "the activity links once it exists");
assert.equal(entry.createdAt, NOW);
// Removing a cue drops its check-in from the kept debrief.
entry = mergeJournalEntry(entry, { ref: scheduled, brief: { goal: "Long and steady", cues: [] } }, options("athlete", LATER));
assert.deepEqual(entry.debrief.cueOutcomes, {});
assert.equal(entry.debrief.feel, 2);
entry = mergeJournalEntry(entry, { ref: scheduled, brief: null }, options("athlete"));
assert.equal(entry.brief, undefined);
assert.equal(mergeJournalEntry(entry, { ref: scheduled, debrief: null }, options("athlete")), null);

// Coach-logged debriefs are marked.
const viaCoach = mergeJournalEntry(undefined, { ref: { happenDay: "20261014", activityId: "a7" }, debrief: { feel: 5, cueOutcomes: {} } }, options("coach"));
assert.equal(viaCoach.debrief.viaCoach, true);

// Lookup prefers the scheduled occurrence over a loose activity entry.
const entries = [
  { entryId: "a", activityId: "act-9" },
  { entryId: "s", planId: "p1", idInPlan: "7" }
];
assert.equal(findJournalEntry(entries, { planId: "p1", idInPlan: "7", activityId: "act-9" }).entryId, "s");
assert.equal(findJournalEntry(entries, { activityId: "act-9" }).entryId, "a");
assert.equal(findJournalEntry(entries, { planId: "p1", idInPlan: "8" }), undefined);

// The Coach reads cue results inline and fueling outcomes in words.
const text = formatJournalEntryForCoach({
  entryId: "x",
  happenDay: "20261012",
  workoutName: "Long run",
  brief: { goal: "Race rehearsal", cues: [{ id: "c1", text: "Gel every 30 min" }], fuelPlan: "60 g carbs/h", author: "coach", updatedAt: NOW },
  debrief: { feel: 3, cueOutcomes: { c1: "partial" }, fueling: { taken: "Maurten 160 x3", experiment: true, outcome: "bad" }, updatedAt: NOW },
  createdAt: NOW,
  updatedAt: NOW
});
assert.match(text, /2026-10-12 "Long run"/);
assert.match(text, /brief \(coach\): goal: Race rehearsal \| focus: Gel every 30 min \[partly\] \| fuel plan: 60 g carbs\/h/);
assert.match(text, /felt okay \(3\/5\) \| fueling \(new, experiment\): Maurten 160 x3 → GI trouble/);

console.log("workout journal model ok");
