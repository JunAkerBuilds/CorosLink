import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildFitnessTrendPreview,
  buildHrZonePreview,
  buildWeeklyTrendSummary,
  formatFitnessTrendLines,
  parseFitnessTrendDays
} = await import(`${distUrl("chatAnalyticsTools.js")}?cacheBust=${Date.now()}`);
const { buildTrendPoints } = await import(
  `${distUrl("trainingTrendUtils.js")}?cacheBust=${Date.now()}`
);

const trendPoints = buildTrendPoints([
  {
    happenDay: "20260701",
    trainingLoad: 120,
    rhr: 48,
    avgSleepHrv: 62,
    sleepHrvBase: 58
  },
  {
    happenDay: "20260702",
    trainingLoad: 80,
    rhr: 49,
    avgSleepHrv: 60,
    sleepHrvBase: 58
  }
]);

const fitnessPreview = buildFitnessTrendPreview(trendPoints, "req-1");
assert.ok(fitnessPreview);
assert.equal(fitnessPreview.trendPoints.length, 2);
assert.equal(fitnessPreview.previewId, "fitness-trends:req-1:2");
assert.equal(buildFitnessTrendPreview([], "req-2"), null);

// buildTrendPoints honours the requested window instead of always slicing 7.
const thirtyDays = Array.from({ length: 40 }, (_, index) => ({
  happenDay: `202608${String(index + 1).padStart(2, "0")}`,
  trainingLoad: index,
  avgSleepHrv: 60,
  rhr: 50
}));
assert.equal(buildTrendPoints(thirtyDays).length, 7);
assert.equal(buildTrendPoints(thirtyDays, 30).length, 30);
assert.equal(buildTrendPoints(thirtyDays, 30)[0].trainingLoad, 10);

assert.equal(parseFitnessTrendDays(undefined), 7);
assert.equal(parseFitnessTrendDays("30"), 30);
assert.equal(parseFitnessTrendDays(2), 7, "clamps below the minimum");
assert.equal(parseFitnessTrendDays(500), 90, "clamps above the maximum");
assert.equal(parseFitnessTrendDays("abc"), 7);

const lines = formatFitnessTrendLines(
  [
    ...trendPoints,
    { date: "20260703", label: "07/03", trainingLoad: 0, sleepScore: 88, sleepMinutes: 455 }
  ],
  7
);
assert.equal(lines[0], "Fitness trends (last 7 days):");
assert.match(lines[4], /sleep 88 · slept 7h35/);
assert.ok(!lines.some((line) => line === "Weekly summary:"), "no weekly block for short windows");

const longPoints = Array.from({ length: 21 }, (_, index) => ({
  date: `202609${String(index + 1).padStart(2, "0")}`,
  label: `09/${String(index + 1).padStart(2, "0")}`,
  trainingLoad: 10,
  avgSleepHrv: 60 + (index % 3),
  rhr: 48,
  sleepScore: 80
}));
const weekly = buildWeeklyTrendSummary(longPoints);
assert.equal(weekly.length, 3);
assert.match(weekly[0], /^- 09\/01–09\/07: load 70 total · HRV 61 · RHR 48 · sleep 80$/);
const longLines = formatFitnessTrendLines(longPoints, 21);
assert.ok(longLines.includes("Weekly summary:"), "long windows include a weekly block");

const zonePreview = buildHrZonePreview(
  {
    hrTrainingLoad: [
      { index: 1, ratio: 0.2, value: 100 },
      { index: 2, ratio: 0.3, value: 150 },
      { index: 3, ratio: 0.5, value: 250 }
    ],
    hrDistance: [],
    hrTime: []
  },
  [{ index: 1, hr: 130 }, { index: 2, hr: 150 }],
  "trainingLoad",
  "req-3"
);
assert.ok(zonePreview);
assert.equal(zonePreview.zones.length, 3);
assert.equal(zonePreview.metric, "trainingLoad");
assert.equal(
  buildHrZonePreview(
    { hrTrainingLoad: [], hrDistance: [], hrTime: [] },
    [],
    "time",
    "req-4"
  ),
  null
);

console.log("test-chat-analytics-tools: ok");
