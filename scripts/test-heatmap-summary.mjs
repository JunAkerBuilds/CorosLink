import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "parsers.ts")
);
const { buildHeatmapSummary } = await import(`${modUrl.href}?c=${Date.now()}`);

// Cells are ordered oldest → newest; the last cell is "today". Each cell gets
// a distinct consecutive happenDay ending at TODAY.
const TODAY_UTC = Date.UTC(2026, 0, 10);
function cells(loads) {
  return loads.map((load, index) => {
    const date = new Date(
      TODAY_UTC - (loads.length - 1 - index) * 24 * 60 * 60 * 1000
    );
    return {
      happenDay: date.toISOString().slice(0, 10).replace(/-/g, ""),
      trainingLoad: load,
      level: load && load > 0 ? 2 : 0,
      label: "day"
    };
  });
}

// A rest day *today* (day still in progress) must NOT break the streak:
// the streak is broken only when both yesterday AND today have no activity.
const restTodayActiveYesterday = buildHeatmapSummary(
  cells([
    50, // day -3
    50, // day -2
    50, // yesterday (active)
    0 //   today (rest, in progress)
  ])
);
assert.equal(restTodayActiveYesterday.currentStreak, 3);

// Active today counts today plus the preceding consecutive active days.
const activeToday = buildHeatmapSummary(
  cells([
    50, // day -2
    50, // yesterday
    50 //  today
  ])
);
assert.equal(activeToday.currentStreak, 3);

// No activity yesterday AND today → streak broken (0).
const restTwoDays = buildHeatmapSummary(
  cells([
    50, // day -2 (active)
    0, //  yesterday (rest)
    0 //   today (rest)
  ])
);
assert.equal(restTwoDays.currentStreak, 0);

// A gap earlier in the window doesn't affect the current streak.
const gapEarlier = buildHeatmapSummary(
  cells([
    50,
    0, // gap
    50,
    50,
    0 // today rest → streak = last two active days
  ])
);
assert.equal(gapEarlier.currentStreak, 2);

// Sanity: activeDays / totalLoad unchanged by the streak fix.
assert.equal(restTodayActiveYesterday.activeDays, 3);
assert.equal(restTodayActiveYesterday.totalLoad, 150);
assert.equal(restTodayActiveYesterday.longestStreak, 3);

console.log("heatmap-summary tests passed");
