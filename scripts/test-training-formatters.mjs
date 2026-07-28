import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const formattersUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "formatters.ts")
);
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  formatDistanceMeters,
  formatElevationMeters,
  formatHappenDayLabel,
  formatPaceSecondsPerKm,
  formatPersonalRecordHero,
  formatPersonalRecordMeta,
  formatSleepClockRange,
  formatSleepNightLabel,
  formatUpcomingWorkoutVolumeDisplay,
  isPersonalRecordVisible
} = await import(
  `${formattersUrl.href}?cacheBust=${Date.now()}`
);
const { buildTrendPoints, mergeSleepIntoTrendPoints } = await import(
  `${distUrl("trainingTrendUtils.js")}?cacheBust=${Date.now()}`
);
const weeklyActivityUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "weeklyActivity.ts")
);
const { buildWeeklyActivitySeries } = await import(
  `${weeklyActivityUrl.href}?cacheBust=${Date.now()}`
);

assert.equal(formatDistanceMeters(1_000, "metric"), "1.00 km");
assert.equal(formatDistanceMeters(1_000, "imperial"), "0.62 mi");
assert.equal(formatDistanceMeters(100, "imperial", true), "109 yd");
assert.equal(formatElevationMeters(100, "imperial"), "328 ft");
assert.equal(formatPaceSecondsPerKm(300, "imperial"), "8:03 /mi");
assert.equal(formatUpcomingWorkoutVolumeDisplay("5 km", "imperial"), "3.11 mi");
assert.equal(
  formatUpcomingWorkoutVolumeDisplay("custom aerobic volume", "imperial"),
  "custom aerobic volume"
);
assert.equal(
  formatPersonalRecordHero({ type: 101, distance: 8_046.72 }, "imperial"),
  "5.00mi"
);
assert.equal(
  formatPersonalRecordMeta({ type: 5, duration: 1_500 }, "imperial"),
  "8:03 /mi"
);

const imperialWeek = buildWeeklyActivitySeries(
  [{ happenDay: "20260727", distance: 8_046.72 }],
  "distance",
  new Date(2026, 6, 27, 12),
  "imperial"
);
assert.equal(imperialWeek.days[0]?.value, 5);
assert.equal(imperialWeek.days[0]?.displayValue, "5.00 mi");
assert.equal(imperialWeek.weeklyTotal, "5.00 mi");
assert.equal(imperialWeek.yAxisUnit, "mi");

assert.equal(
  formatSleepNightLabel({
    happenDay: "20260707",
    sleepStart: "23:23",
    sleepEnd: "08:01"
  }),
  formatHappenDayLabel("20260707")
);

assert.equal(
  formatSleepClockRange("23:09", "05:32"),
  "11:09 PM – 5:32 AM"
);
assert.equal(
  formatSleepClockRange("00:05", "12:00"),
  "12:05 AM – 12:00 PM"
);
assert.equal(formatSleepClockRange(undefined, "05:32"), undefined);

const trendPoints = mergeSleepIntoTrendPoints(
  buildTrendPoints([{ happenDay: "20260707" }, { happenDay: "20260708" }]),
  {
    mcpConnected: true,
    records: [
      {
        happenDay: "20260707",
        kind: "nap",
        totalMinutes: 45,
        completeness: "complete"
      },
      {
        happenDay: "20260707",
        kind: "main",
        totalMinutes: 388,
        score: 34,
        completeness: "complete"
      },
      {
        happenDay: "20260708",
        kind: "main",
        totalMinutes: 316,
        score: 71,
        completeness: "partial"
      }
    ]
  }
);

assert.equal(
  trendPoints.find((point) => point.date === "20260707")?.sleepMinutes,
  388
);
assert.equal(
  trendPoints.find((point) => point.date === "20260708")?.sleepMinutes,
  undefined
);

assert.equal(isPersonalRecordVisible({ type: 7, duration: 245 }), true);
assert.equal(isPersonalRecordVisible({ type: 6, duration: 769 }), true);
assert.equal(isPersonalRecordVisible({ type: 5, duration: 1309 }), true);
assert.equal(isPersonalRecordVisible({ type: 4, duration: 5127 }), true);
assert.equal(isPersonalRecordVisible({ type: 2, duration: 8268 }), true);
assert.equal(isPersonalRecordVisible({ type: 2 }), true);
assert.equal(isPersonalRecordVisible({ type: 3, duration: 9759 }), false);
assert.equal(isPersonalRecordVisible({ type: 10, duration: 1268 }), false);
assert.equal(isPersonalRecordVisible({ type: 11, duration: 3995 }), false);
assert.equal(isPersonalRecordVisible({ type: 12, duration: 5967 }), false);
assert.equal(isPersonalRecordVisible({ type: 8, duration: 408 }), false);

console.log("training formatter tests passed");
