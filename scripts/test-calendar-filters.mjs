import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(`${pathToFileURL(path.join(repoRoot, "src", "calendar", file)).href}?cacheBust=${Date.now()}`);
const {
  countCalendarEntries,
  countCalendarSports,
  DEFAULT_CALENDAR_FILTER,
  filterCalendarDay,
  isCalendarFilter,
  isCalendarFilterActive,
  pairSportFamily
} = await load("calendarFilters.ts");

// Planned workouts carry program codes (1 run, 4 strength); activities carry activity codes.
const run = { planId: "p", idInPlan: "1", planProgramId: "1", happenDay: "20261020", name: "Foundation Run", sportType: 1 };
const lift = { planId: "p", idInPlan: "2", planProgramId: "2", happenDay: "20261020", name: "Full-Body Strength", sportType: 4 };
const trailRun = { activityId: "t", name: "Hill loop", sportType: 102 };
const walkA = { activityId: "a", name: "Port of Spain Walk", sportType: 900 };
const walkB = { activityId: "b", name: "Sangre Grande Walk", sportType: 900 };
const day = {
  dateKey: "20261020",
  inMonth: true,
  isToday: false,
  isPast: true,
  scheduled: [run, lift],
  activities: [trailRun, walkA, walkB],
  // The run was done as a trail run; the strength session was missed.
  pairs: [{ scheduled: run, activity: trailRun, completionPct: 96 }, { scheduled: lift }],
  unplannedActivities: [walkA, walkB]
};

// A pair counts as what was done, else what was planned.
assert.equal(pairSportFamily(day.pairs[0]), "trail");
assert.equal(pairSportFamily(day.pairs[1]), "strength");

// No filter: the same day object, untouched.
assert.equal(isCalendarFilterActive(DEFAULT_CALENDAR_FILTER), false);
assert.equal(filterCalendarDay(day, DEFAULT_CALENDAR_FILTER), day);

// Hiding walks drops the commute walks and nothing else.
{
  const filtered = filterCalendarDay(day, { kind: "all", hiddenSports: ["walk"] });
  assert.deepEqual(filtered.unplannedActivities, []);
  assert.equal(filtered.pairs.length, 2);
  // Day actions and week totals still see everything.
  assert.equal(filtered.scheduled.length, 2);
  assert.equal(filtered.activities.length, 3);
  assert.equal(countCalendarEntries([day]) - countCalendarEntries([filtered]), 2);
}

// Planned: every plan (done or missed), no freestyle activities.
{
  const filtered = filterCalendarDay(day, { kind: "planned", hiddenSports: [] });
  assert.deepEqual(filtered.pairs.map((pair) => pair.scheduled.idInPlan), ["1", "2"]);
  assert.deepEqual(filtered.unplannedActivities, []);
}

// Completed: every recorded activity, no plan nobody did.
{
  const filtered = filterCalendarDay(day, { kind: "completed", hiddenSports: [] });
  assert.deepEqual(filtered.pairs.map((pair) => pair.scheduled.idInPlan), ["1"]);
  assert.deepEqual(filtered.unplannedActivities.map((activity) => activity.activityId), ["a", "b"]);
}

// Kind and sport combine.
{
  const filtered = filterCalendarDay(day, { kind: "completed", hiddenSports: ["walk", "trail"] });
  assert.equal(countCalendarEntries([filtered]), 0);
}

// Sport counts follow the kind and come in display order.
assert.deepEqual(countCalendarSports([day], "all"), [
  { family: "trail", count: 1 },
  { family: "strength", count: 1 },
  { family: "walk", count: 2 }
]);
assert.deepEqual(countCalendarSports([day], "planned"), [
  { family: "trail", count: 1 },
  { family: "strength", count: 1 }
]);
assert.deepEqual(countCalendarSports([day], "completed"), [
  { family: "trail", count: 1 },
  { family: "walk", count: 2 }
]);

// Stored preferences are validated before use.
assert.equal(isCalendarFilter({ kind: "planned", hiddenSports: ["walk"] }), true);
assert.equal(isCalendarFilter({ kind: "done", hiddenSports: [] }), false);
assert.equal(isCalendarFilter({ kind: "all", hiddenSports: ["walk", "walk"] }), false);
assert.equal(isCalendarFilter({ kind: "all", hiddenSports: ["yoga"] }), false);
assert.equal(isCalendarFilter({ kind: "all" }), false);
assert.equal(isCalendarFilter(null), false);

console.log("calendar filter tests passed");
