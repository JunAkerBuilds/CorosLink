import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "sportColors.ts")
);
const {
  sportColorCategory,
  parseSportColors,
  DEFAULT_SPORT_COLORS,
  happenDayFromTimestamp,
  buildDominantSportByDay,
  buildSportCategoriesByDay
} = await import(`${modUrl.href}?c=${Date.now()}`);

// Categorization (trail before run; bike before run; French + English names).
assert.equal(sportColorCategory("TrailRun"), "trail");
assert.equal(sportColorCategory("Morning Trail Run"), "trail");
assert.equal(sportColorCategory("Run"), "run");
assert.equal(sportColorCategory("Lunch Trail Run"), "trail");
assert.equal(sportColorCategory("Lunch Cyclisme"), "bike");
assert.equal(sportColorCategory("VirtualRide"), "bike");
assert.equal(sportColorCategory("Evening Vélo"), "bike");
assert.equal(sportColorCategory("WeightTraining"), "strength");
assert.equal(sportColorCategory("Afternoon Musculation"), "strength");
assert.equal(sportColorCategory("Afternoon Entraînement"), "strength");
assert.equal(sportColorCategory("Workout"), "strength");
assert.equal(sportColorCategory("Pool Swim"), "other");
assert.equal(sportColorCategory(""), "other");
assert.equal(sportColorCategory(undefined), "other");

// parseSportColors: merge partial over defaults, ignore invalid, malformed → defaults.
assert.deepEqual(parseSportColors(null), DEFAULT_SPORT_COLORS);
assert.equal(parseSportColors('{"run":"#123456"}').run, "#123456");
assert.equal(
  parseSportColors('{"run":"#123456"}').trail,
  DEFAULT_SPORT_COLORS.trail
);
assert.equal(
  parseSportColors('{"run":"not-a-color"}').run,
  DEFAULT_SPORT_COLORS.run
);
assert.deepEqual(parseSportColors("{malformed"), DEFAULT_SPORT_COLORS);

// happenDayFromTimestamp: seconds vs ms epochs, invalid → undefined.
const noonMs = new Date(2026, 6, 14, 12, 0, 0).getTime(); // 2026-07-14 local
assert.equal(happenDayFromTimestamp(noonMs), "20260714");
assert.equal(happenDayFromTimestamp(Math.floor(noonMs / 1000)), "20260714");
assert.equal(happenDayFromTimestamp(undefined), undefined);
assert.equal(happenDayFromTimestamp(0), undefined);

// buildDominantSportByDay: highest-TL individual activity sets the color.
const dominant = buildDominantSportByDay([
  // Same day: run (TL 40) vs strength (TL 90) → strength wins.
  { activityId: "a", sportType: 0, sportName: "Run", trainingLoad: 40, startTime: noonMs },
  { activityId: "b", sportType: 0, sportName: "Musculation", trainingLoad: 90, startTime: noonMs },
  // Different day, single trail.
  { activityId: "c", sportType: 0, sportName: "Trail Run", trainingLoad: 55, startTime: new Date(2026, 6, 15, 9).getTime() },
  // No TL and no sportName → "other".
  { activityId: "d", sportType: 0, startTime: new Date(2026, 6, 16, 9).getTime() },
  // No startTime → skipped entirely.
  { activityId: "e", sportType: 0, sportName: "Run" }
]);
assert.equal(dominant.get("20260714"), "strength");
assert.equal(dominant.get("20260715"), "trail");
assert.equal(dominant.get("20260716"), "other");
assert.equal(dominant.size, 3);

// Tie on TL keeps the first activity seen (deterministic).
const tie = buildDominantSportByDay([
  { activityId: "f", sportType: 0, sportName: "Cycling", trainingLoad: 30, startTime: noonMs },
  { activityId: "g", sportType: 0, sportName: "Run", trainingLoad: 30, startTime: noonMs }
]);
assert.equal(tie.get("20260714"), "bike");

// buildSportCategoriesByDay: distinct categories per day, canonical order,
// same-category activities collapse to one slice.
const cats = buildSportCategoriesByDay([
  // One day: trail + bike + a second bike → 2 slices (trail, bike).
  { activityId: "h", sportType: 0, sportName: "Trail Run", trainingLoad: 30, startTime: noonMs },
  { activityId: "i", sportType: 0, sportName: "VirtualRide", trainingLoad: 20, startTime: noonMs },
  { activityId: "j", sportType: 0, sportName: "Cyclisme", trainingLoad: 25, startTime: noonMs },
  // Another day: single run.
  { activityId: "k", sportType: 0, sportName: "Run", trainingLoad: 40, startTime: new Date(2026, 6, 15, 9).getTime() },
  // No startTime → skipped.
  { activityId: "l", sportType: 0, sportName: "Run" }
]);
assert.deepEqual([...cats.get("20260714")], ["trail", "bike"]); // canonical order
assert.deepEqual([...cats.get("20260715")], ["run"]);
assert.equal(cats.size, 2);

console.log("sport-colors tests passed");
