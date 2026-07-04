import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  formatActivityDetailForChat,
  buildActivityVisualPreview,
  buildActivityHrTrendPreview
} = await import(`${distUrl("chatActivityTools.js")}?cacheBust=${Date.now()}`);
const {
  parseActivityDetail,
  downsampleActivitySeries,
  parseScheduledExercises,
  formatScheduledExercisesForChat
} = await import(`${distUrl("trainingHubService.js")}?cacheBust=${Date.now()}`);

const trailDetailFixture = {
  labelId: "act-trail-1",
  summary: {
    name: "Track Intervals",
    sportType: 101,
    totalTime: 3600000,
    distance: 10000000,
    avgHr: 160,
    maxHr: 182
  },
  lapList: [
    {
      distance: 400000,
      totalTime: 90000,
      avgHr: 170,
      maxHr: 182,
      avgPace: 225000
    },
    {
      distance: 400000,
      totalTime: 92000,
      avgHr: 168,
      maxHr: 180,
      avgPace: 230000
    }
  ],
  graphList: [
    {
      heartRateList: [120, 130, 140, 150, 160],
      distanceList: [0, 1000, 2000, 3000, 4000],
      avgPaceList: [240000, 235000, 230000, 228000, 225000]
    }
  ]
};

const detail = parseActivityDetail(trailDetailFixture);
assert.equal(detail.laps.length, 2);
assert.ok(detail.series && detail.series.length > 0);

const formatted = formatActivityDetailForChat(detail, false);
assert.match(formatted, /Laps:/);
assert.match(formatted, /4\.00 km/);
assert.match(formatted, /170/);

const withSeries = formatActivityDetailForChat(detail, true);
assert.match(withSeries, /Time series/);

const downsampled = downsampleActivitySeries(detail.series ?? [], 3);
assert.ok(downsampled.length <= 3);

const exercises = parseScheduledExercises({
  exercises: [
    {
      name: "Back Squat",
      sets: 4,
      reps: 8,
      targetType: 6,
      targetValue: 80000
    }
  ]
});
assert.equal(exercises.length, 1);
assert.match(formatScheduledExercisesForChat(exercises), /Back Squat/);

const visualPreview = buildActivityVisualPreview(detail, "req-1");
assert.ok(visualPreview);
assert.ok(visualPreview.sections.hr);
assert.equal(visualPreview.sections.hr?.chartKind, "series");
assert.ok(visualPreview.sections.laps && visualPreview.sections.laps.length > 0);
assert.equal(visualPreview.previewId, `${detail.activityId}:req-1`);

const legacyPreview = buildActivityHrTrendPreview(detail, "req-legacy");
assert.ok(legacyPreview);
assert.equal(legacyPreview.chartKind, "series");

const lapsOnlyFixture = {
  labelId: "act-laps-1",
  summary: {
    name: "Easy Run",
    sportType: 102,
    totalTime: 1800000,
    distance: 5000000,
    avgHr: 145,
    maxHr: 158
  },
  lapList: [
    { distance: 1000000, totalTime: 360000, avgHr: 140, maxHr: 150 },
    { distance: 1000000, totalTime: 350000, avgHr: 146, maxHr: 155 },
    { distance: 1000000, totalTime: 345000, avgHr: 150, maxHr: 158 }
  ]
};
const lapsDetail = parseActivityDetail(lapsOnlyFixture);
const lapsPreview = buildActivityVisualPreview(lapsDetail, "req-2");
assert.ok(lapsPreview);
assert.equal(lapsPreview.sections.hr?.chartKind, "laps");
assert.equal(lapsPreview.sections.laps?.length, 3);

const noHrFixture = {
  labelId: "act-nohr-1",
  summary: { name: "Walk", sportType: 102, totalTime: 900000, distance: 1000000 },
  lapList: [{ distance: 500000, totalTime: 450000 }]
};
const noHrDetail = parseActivityDetail(noHrFixture);
const noHrPreview = buildActivityVisualPreview(noHrDetail, "req-3");
assert.ok(noHrPreview);
assert.equal(noHrPreview.sections.hr, undefined);
assert.equal(noHrPreview.sections.laps?.length, 1);

assert.equal(
  buildActivityVisualPreview(
    parseActivityDetail({
      labelId: "act-empty-1",
      summary: { name: "Empty", sportType: 102 }
    }),
    "req-4"
  ),
  null
);

console.log("test-chat-activity-tools: ok");
