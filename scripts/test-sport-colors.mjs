import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "calendar", "sportColors.ts")
);
const { sportColorCategory, parseSportColors, DEFAULT_SPORT_COLORS } =
  await import(`${modUrl.href}?c=${Date.now()}`);

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

console.log("sport-colors tests passed");
