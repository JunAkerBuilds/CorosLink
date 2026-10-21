import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  formatActivityDetailForChat,
  formatActivityListLine,
  buildActivityVisualPreview,
  buildActivityHrTrendPreview
} = await import(`${distUrl("chatActivityTools.js")}?cacheBust=${Date.now()}`);
const {
  parseActivityDetail,
  downsampleActivitySeries,
  formatActivitySeriesForChat,
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

const imperialFormatted = formatActivityDetailForChat(detail, true, "imperial");
assert.match(imperialFormatted, /62\.1 mi/);
assert.match(imperialFormatted, /Avg pace: 9:39\/mi/);
assert.match(imperialFormatted, /2\.49 mi/);

const bikeDetail = {
  activityId: "bike-1",
  name: "Ten mile ride",
  sportType: 200,
  sportName: "Bike",
  distance: 16_093.44,
  duration: 3_600,
  laps: [{ index: 1, distance: 16_093.44, duration: 3_600, pace: 223.694 }],
  series: [
    { distance: 8_046.72, pace: 223.694 },
    { distance: 16_093.44, pace: 223.694 }
  ],
  raw: {}
};
const imperialBike = formatActivityDetailForChat(bikeDetail, true, "imperial");
assert.match(imperialBike, /Avg speed: 10\.0 mph/);
assert.match(imperialBike, /Max HR \| Speed/);
assert.match(imperialBike, /Distance \| HR \| Speed \| Power/);
assert.match(imperialBike, /10\.0 mph/);
assert.match(
  formatActivitySeriesForChat(bikeDetail.series, "metric", false, true),
  /16\.1 km\/h/
);

const imperialSwim = formatActivityDetailForChat({
  activityId: "swim-1",
  name: "Pool",
  sportType: 300,
  distance: 100,
  duration: 120,
  laps: [{ index: 1, distance: 100, duration: 120 }],
  raw: {}
}, false, "imperial");
assert.match(imperialSwim, /Distance: 109 yd/);
assert.match(imperialSwim, /1 \| 109 yd/);

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
assert.equal(visualPreview.sportType, 101);

const bikePreview = buildActivityVisualPreview(bikeDetail, "req-bike");
assert.equal(bikePreview?.sportType, 200);
assert.ok(bikePreview?.sections.pace);

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

// Shape of a live PACE Pro run from /activity/detail/query (2026-10-02, values
// trimmed): power and cadence live in summary, in nested lapItemList entries,
// and in per-second frequencyList samples keyed heart/speed/power/cadence.
// COROS writes 0 where a metric was not recorded (lap maxPower, np).
// totalTime is elapsed (51:50); workoutTime is moving (41:39) = totalTime -
// pauseTime, all in 0.01 s.
const powerRunFixture = {
  labelId: "act-power-1",
  summary: {
    name: "Ottawa Run",
    sportType: 100,
    totalTime: 310995,
    workoutTime: 249889,
    pauseTime: 61106,
    distance: 700761,
    avgHr: 163,
    maxHr: 188,
    avgPower: 204,
    maxPower: 306,
    np: 0,
    avgCadence: 153,
    maxCadence: 169
  },
  lapList: [
    {
      type: 2,
      lapDistance: 100000,
      lapItemList: [
        { distance: 100000, time: 34980, avgHr: 157, maxHr: 173, avgPace: 349.81, avgPower: 201, maxPower: 0, avgCadence: 154, maxCadence: 160 },
        { distance: 100000, time: 35685, avgHr: 165, maxHr: 176, avgPace: 356.86, avgPower: 209, maxPower: 0, avgCadence: 153, maxCadence: 163 },
        { distance: 100000, time: 35224, avgHr: 157, maxHr: 173, avgPace: 352.24, avgPower: 202, maxPower: 0, avgCadence: 153, maxCadence: 160 }
      ]
    },
    {
      type: -1,
      lapItemList: [
        { distance: 700761, time: 249889, avgHr: 163, maxHr: 188, avgPower: 204, maxPower: 306, avgCadence: 153, maxCadence: 169 }
      ]
    }
  ],
  frequencyList: [
    { distance: 0, heart: 96, timestamp: 179095736400 },
    { distance: 0, heart: 97, speed: 657, timestamp: 179095736500 },
    { distance: 27250, heart: 159, speed: 356, power: 205, cadence: 155, timestamp: 179095746400 },
    { distance: 27600, heart: 160, speed: 350, power: 210, cadence: 156, timestamp: 179095746500 }
  ]
};

const powerRun = parseActivityDetail(powerRunFixture);
assert.equal(powerRun.avgPower, 204);
assert.equal(powerRun.maxPower, 306);
assert.equal(powerRun.normalizedPower, undefined);
assert.equal(powerRun.avgCadence, 153);
assert.equal(powerRun.maxCadence, 169);
assert.equal(powerRun.laps.length, 3);
assert.deepEqual(
  powerRun.laps.map((lap) => [lap.avgPower, lap.maxPower, lap.avgCadence, lap.maxCadence]),
  [[201, undefined, 154, 160], [209, undefined, 153, 163], [202, undefined, 153, 160]]
);

// Samples keep each metric on its own timestamp even when early points lack power.
assert.equal(powerRun.series?.length, 4);
assert.deepEqual(powerRun.series?.[0], { hr: 96 });
assert.deepEqual(powerRun.series?.[2], {
  distance: 272.5,
  hr: 159,
  pace: 356,
  power: 205,
  cadence: 155
});

const powerRunText = formatActivityDetailForChat(powerRun, true);
// Moving time and pace headline the summary; elapsed appears once pauses matter.
assert.equal(powerRun.duration, 3110);
assert.equal(powerRun.movingTime, 2499);
assert.match(powerRunText, /\nMoving time: 41:39\nElapsed: 51:50 \(10:11 paused\)\nAvg pace: 5:57\/km\n/);
assert.doesNotMatch(powerRunText, /Duration: 51:50|7:24\/km/);
assert.match(powerRunText, /Avg power: 204 W/);
assert.match(powerRunText, /Max power: 306 W/);
assert.match(powerRunText, /Avg cadence: 153 spm/);
assert.match(powerRunText, /Max cadence: 169 spm/);
assert.doesNotMatch(powerRunText, /Normalized power/);
assert.match(
  powerRunText,
  /Lap \| Distance \| Duration \| Avg HR \| Max HR \| Pace \| Avg Power \| Avg Cadence \| Max Cadence\n/
);
assert.match(powerRunText, /\n1 \| 1\.00 km \| 5:50 \| 157 \| 173 \| 5:50\/km \| 201 W \| 154 spm \| 160 spm\n/);
assert.match(powerRunText, /Distance \| HR \| Pace \| Power \| Cadence/);
assert.match(powerRunText, /0\.27 km \| 159 \| 5:56\/km \| 205 W \| 155 spm/);
assert.ok(buildActivityVisualPreview(powerRun, "req-power")?.sections.power);

// HR-only activities keep the compact lap table.
assert.doesNotMatch(formatted, /Power|Cadence/);

// Older fixtures without workoutTime keep elapsed as the duration.
assert.match(formatted, /\nDuration: 10:00:00\n/);
assert.doesNotMatch(formatted, /Moving time|Elapsed/);

// Under a minute of pauses: moving time and pace, no Elapsed line.
const shortPauseText = formatActivityDetailForChat(
  { ...powerRun, duration: 2540, movingTime: 2499, laps: [] },
  false
);
assert.match(shortPauseText, /\nDuration: 41:39\nAvg pace: 5:57\/km\n/);
assert.doesNotMatch(shortPauseText, /Elapsed|Moving time/);

// Rides report moving speed.
const pausedRide = formatActivityDetailForChat(
  { ...bikeDetail, duration: 3_600 + 900, movingTime: 3_600 },
  false
);
assert.match(pausedRide, /Moving time: 1:00:00\nElapsed: 1:15:00 \(15:00 paused\)\nAvg speed: /);
assert.equal(
  pausedRide.match(/Avg speed: (.+)/)?.[1],
  formatActivityDetailForChat({ ...bikeDetail, duration: 3_600 }, false).match(/Avg speed: (.+)/)?.[1]
);

// list_recent_activities lines carry moving time, plus elapsed once pauses
// reach a minute (list API values for the same run).
const listedRun = {
  activityId: "480757304470307016",
  sportType: 100,
  distance: 7007.61,
  duration: 3110,
  movingTime: 2499
};
assert.match(formatActivityListLine(listedRun, "metric"), / · 41:39 moving \(51:50 elapsed\)$/);
assert.match(
  formatActivityListLine({ ...listedRun, duration: 2540 }, "metric"),
  / · 41:39$/
);
// Activities cached before moving time was stored keep elapsed.
assert.match(
  formatActivityListLine({ ...listedRun, movingTime: undefined }, "metric"),
  / · 51:50$/
);

const poweredRide = formatActivityDetailForChat({
  ...bikeDetail,
  avgPower: 180,
  avgCadence: 88,
  laps: [{ ...bikeDetail.laps[0], avgPower: 180, avgCadence: 88 }]
}, false);
assert.match(poweredRide, /Avg cadence: 88 rpm/);
assert.match(poweredRide, /\| 180 W \| 88 rpm$/m);

// Strength: the gym lap list holds work sets, rests, a roll-up per exercise
// (sets > 0, the sum of its sets) and section-rest markers (S3618). A lap
// table would repeat every set in the roll-up, so Coach gets the parsed sets.
const strengthDetail = parseActivityDetail({
  summary: { sportType: 402, totalTime: 100000, workoutTime: 100000, avgHr: 129, trainingLoad: 57 },
  lapList: [
    {
      lapItemList: [
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 15, weight: 32000, time: 3487 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 0, weight: 32000, time: 12000 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 0, reps: 15, weight: 32000, time: 3009 },
        { exerciseIndex: 1, exerciseNameKey: "T1178", sets: 2, reps: 30, weight: 960000, time: 6496 },
        { exerciseIndex: 1, exerciseNameKey: "S3618", sets: 2, reps: 0, weight: 960000, time: 18496 },
        { exerciseIndex: 8, exerciseNameKey: "T1176", sets: 0, reps: 6, weight: 0, time: 5773 },
        { exerciseIndex: 8, exerciseNameKey: "T1176", sets: 1, reps: 6, weight: 0, time: 5773 }
      ]
    }
  ]
});
assert.equal(strengthDetail.laps.length, 7, "raw lap rows include roll-ups and markers");
const strengthText = formatActivityDetailForChat(strengthDetail, false);
assert.match(strengthText, /^- T1178: 2 sets, 30 reps · 15 × 32 kg, 15 × 32 kg$/m);
assert.match(strengthText, /^- T1176: 1 set, 6 reps · 6 reps$/m);
assert.doesNotMatch(strengthText, /Laps:/);
assert.match(formatActivityDetailForChat(strengthDetail, false, "imperial"), /15 × 71 lb/);

console.log("test-chat-activity-tools: ok");
