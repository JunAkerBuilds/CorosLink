import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

// Categorization by COROS sportType code (names are user-editable free text
// and never consulted). Unknown or missing codes → "other".
assert.equal(sportColorCategory(100), "run"); //      Run
assert.equal(sportColorCategory(101), "run"); //      Indoor Run
assert.equal(sportColorCategory(102), "trail"); //    Trail Run
assert.equal(sportColorCategory(103), "run"); //      Track Run
assert.equal(sportColorCategory(104), "trail"); //    Hike
assert.equal(sportColorCategory(105), "trail"); //    Mountain Climb
assert.equal(sportColorCategory(200), "bike"); //     Bike
assert.equal(sportColorCategory(204), "bike"); //     Mountain Bike
assert.equal(sportColorCategory(400), "strength"); // Gym Cardio
assert.equal(sportColorCategory(402), "strength"); // Strength
assert.equal(sportColorCategory(300), "other"); //    Pool Swim
assert.equal(sportColorCategory(700), "other"); //    Rowing
assert.equal(sportColorCategory(10000), "other"); //  Triathlon
assert.equal(sportColorCategory(999), "other"); //    unknown code
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

// The :root --sport-* fallbacks in styles.css mirror DEFAULT_SPORT_COLORS.
// They're overridden before first paint, but must not silently drift.
const css = await readFile(path.join(repoRoot, "src", "styles.css"), "utf8");
for (const [cat, hex] of Object.entries(DEFAULT_SPORT_COLORS)) {
  const match = css.match(new RegExp(`--sport-${cat}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `styles.css is missing a --sport-${cat} declaration`);
  assert.equal(
    match[1].toLowerCase(),
    hex.toLowerCase(),
    `--sport-${cat} in styles.css drifted from DEFAULT_SPORT_COLORS`
  );
}

// happenDayFromTimestamp: seconds vs ms epochs, invalid → undefined.
const noonMs = new Date(2026, 6, 14, 12, 0, 0).getTime(); // 2026-07-14 local
assert.equal(happenDayFromTimestamp(noonMs), "20260714");
assert.equal(happenDayFromTimestamp(Math.floor(noonMs / 1000)), "20260714");
assert.equal(happenDayFromTimestamp(undefined), undefined);
assert.equal(happenDayFromTimestamp(0), undefined);

// buildDominantSportByDay: highest-TL individual activity sets the color.
const dominant = buildDominantSportByDay([
  // Same day: run (TL 40) vs strength (TL 90) → strength wins.
  { activityId: "a", sportType: 100, trainingLoad: 40, startTime: noonMs },
  { activityId: "b", sportType: 402, trainingLoad: 90, startTime: noonMs },
  // Different day, single trail.
  { activityId: "c", sportType: 102, trainingLoad: 55, startTime: new Date(2026, 6, 15, 9).getTime() },
  // No TL and an unknown sportType → "other".
  { activityId: "d", sportType: 999, startTime: new Date(2026, 6, 16, 9).getTime() },
  // No startTime → skipped entirely.
  { activityId: "e", sportType: 100 }
]);
assert.equal(dominant.get("20260714"), "strength");
assert.equal(dominant.get("20260715"), "trail");
assert.equal(dominant.get("20260716"), "other");
assert.equal(dominant.size, 3);

// Tie on TL keeps the first activity seen (deterministic).
const tie = buildDominantSportByDay([
  { activityId: "f", sportType: 200, trainingLoad: 30, startTime: noonMs },
  { activityId: "g", sportType: 100, trainingLoad: 30, startTime: noonMs }
]);
assert.equal(tie.get("20260714"), "bike");

// buildSportCategoriesByDay: distinct categories per day, canonical order,
// same-category activities collapse to one slice.
const cats = buildSportCategoriesByDay([
  // One day: trail + bike + a second bike → 2 slices (trail, bike).
  { activityId: "h", sportType: 102, trainingLoad: 30, startTime: noonMs },
  { activityId: "i", sportType: 201, trainingLoad: 20, startTime: noonMs },
  { activityId: "j", sportType: 200, trainingLoad: 25, startTime: noonMs },
  // Another day: single run.
  { activityId: "k", sportType: 100, trainingLoad: 40, startTime: new Date(2026, 6, 15, 9).getTime() },
  // No startTime → skipped.
  { activityId: "l", sportType: 100 }
]);
assert.deepEqual([...cats.get("20260714")], ["trail", "bike"]); // canonical order
assert.deepEqual([...cats.get("20260715")], ["run"]);
assert.equal(cats.size, 2);

console.log("sport-colors tests passed");
