import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  CoachChartSpecError,
  bucketIntradayReadings,
  coachChartNeeds,
  describeCoachChart,
  formatCoachMetricValue,
  parseCoachChartSpec,
  resolveCoachChart,
  resolveCoachChartRanges,
  upsertPinnedCoachChart,
  withCoachChartDefaults
} = await import(`${distUrl("coachChartUtils.js")}?cacheBust=${Date.now()}`);

// ----- parseCoachChartSpec -----

const boundSpec = parseCoachChartSpec({
  title: "HRV vs load",
  days: 400,
  series: [
    { label: "HRV", metric: "avgSleepHrv" },
    { label: "Load", metric: "trainingLoad", axis: "right" }
  ],
  ranges: [{ from: "2026-09-03", to: "2026-09-10", label: "Heavy block" }],
  tiles: [{ label: "HRV avg", value: 68 }]
});
assert.equal(boundSpec.days, 90, "days clamps to the 90-day maximum");
assert.equal(boundSpec.series[1].axis, "right");
assert.equal(boundSpec.tiles[0].value, "68", "numeric tile values become strings");

assert.throws(
  () => parseCoachChartSpec({ title: "x", series: [] }),
  CoachChartSpecError,
  "empty series is rejected"
);
assert.throws(
  () => parseCoachChartSpec({ title: "x", series: [{ label: "a" }] }),
  /needs either a bound "metric" or inline "values"/
);
assert.throws(
  () =>
    parseCoachChartSpec({
      title: "x",
      series: [{ label: "a", metric: "avgSleepHrv", values: [1] }]
    }),
  /cannot set both/
);
assert.throws(
  () => parseCoachChartSpec({ title: "x", series: [{ label: "a", metric: "nope" }] }),
  /metric must be one of/
);
assert.throws(
  () => parseCoachChartSpec({ title: "x", series: [{ label: "a", values: [1, 2] }] }),
  /labels \(at least 2\) are required/,
  "inline-only charts need labels"
);

// ----- resolveCoachChart: bound window -----

const day = (offset) => {
  const date = new Date(Date.UTC(2026, 8, 1 + offset));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
};
const trendPoints = Array.from({ length: 10 }, (_, index) => ({
  date: day(index),
  label: `09/${String(index + 1).padStart(2, "0")}`,
  trainingLoad: index * 10,
  avgSleepHrv: index === 4 ? undefined : 60 + index,
  sleepScore: 80
}));

const resolved = resolveCoachChart(
  parseCoachChartSpec({
    title: "Block",
    days: 10,
    series: [
      { label: "HRV", metric: "avgSleepHrv" },
      { label: "Load", metric: "trainingLoad" },
      { label: "Rolling", values: Array(10).fill(1), dashed: true }
    ],
    ranges: [
      { from: "2026-09-03", to: "2026-09-05", label: "Heavy" },
      { from: "2026-08-20", to: "2026-09-02", label: "Clamped" },
      { from: "2026-07-01", to: "2026-07-10", label: "Outside" }
    ]
  }),
  { previewId: "p1", trendPoints, now: new Date("2026-09-19T00:00:00Z") }
);

assert.equal(resolved.preview.labels.length, 10);
assert.equal(resolved.preview.labels[0], "Sep 1");
assert.deepEqual(resolved.preview.dates.slice(0, 2), ["20260901", "20260902"]);
assert.equal(resolved.preview.live, true);
assert.equal(resolved.preview.series[0].values[4], null, "missing metric days become null");
assert.equal(resolved.preview.series[0].color, "hrv", "metric default color");
assert.equal(resolved.preview.series[1].kind, "bar", "load defaults to bars");
assert.equal(resolved.preview.series[1].color, "gold", "second green metric moves to a free hue family");
assert.equal(resolved.preview.series[2].dashed, true);
assert.equal(resolved.preview.series[2].color, "blue", "fallback picks the next unused hue family");
assert.deepEqual(
  resolved.preview.ranges.map((range) => [range.fromIndex, range.toIndex, range.label]),
  [
    [2, 4, "Heavy"],
    [0, 1, "Clamped"]
  ],
  "ranges resolve to indices; partial overlap clamps; fully outside is dropped"
);
assert.deepEqual(resolved.droppedRanges, ["Outside"]);

assert.throws(
  () =>
    resolveCoachChart(
      parseCoachChartSpec({
        title: "Mismatch",
        days: 10,
        series: [
          { label: "HRV", metric: "avgSleepHrv" },
          { label: "Short", values: [1, 2, 3] }
        ]
      }),
      { previewId: "p2", trendPoints }
    ),
  /has 3 values but the chart has 10 points\. The window has 10 days \(Sep 1 – Sep 10\)/,
  "inline series must match the bound window and the error names the window"
);

assert.throws(
  () =>
    resolveCoachChart(
      parseCoachChartSpec({ title: "Empty", series: [{ label: "HRV", metric: "avgSleepHrv" }] }),
      { previewId: "p3", trendPoints: [] }
    ),
  /No daily training data/
);

// ----- resolveCoachChart: inline-only -----

const inline = resolveCoachChart(
  parseCoachChartSpec({
    title: "Weekly volume",
    labels: ["W1", "W2", "W3"],
    series: [{ label: "km", values: [40, 52, null], kind: "bar" }],
    ranges: [{ from: "w2", to: "W3", label: "Build" }]
  }),
  { previewId: "p4" }
);
assert.equal(inline.preview.live, false);
assert.equal(inline.preview.dates, undefined);
assert.deepEqual(inline.preview.ranges, [{ fromIndex: 1, toIndex: 2, label: "Build" }], "labels match case-insensitively");

const inlineDates = resolveCoachChart(
  parseCoachChartSpec({
    title: "Dated inline",
    labels: ["2026-09-01", "2026-09-02", "2026-09-03"],
    series: [{ label: "v", values: [1, 2, 3] }],
    ranges: [{ from: "20260902", to: "2026-09-03" }]
  }),
  { previewId: "p5" }
);
assert.deepEqual(inlineDates.preview.dates, ["20260901", "20260902", "20260903"]);
assert.deepEqual(inlineDates.preview.ranges, [{ fromIndex: 1, toIndex: 2, label: undefined }]);

// ----- resolveCoachChartRanges edge cases -----

const { resolved: swapped } = resolveCoachChartRanges(
  [{ from: "2026-09-05", to: "2026-09-03" }],
  resolved.preview.labels,
  resolved.preview.dates
);
assert.deepEqual(swapped, [{ fromIndex: 2, toIndex: 4, label: undefined }], "reversed bounds are normalized");

// ----- describeCoachChart -----

const text = describeCoachChart(resolved.preview, {
  droppedRanges: resolved.droppedRanges,
  sleepAvailable: false
});
assert.match(text, /Rendered chart "Block" inline \(10 points, Sep 1 – Sep 10\)/);
assert.match(text, /HRV \(bound avgSleepHrv\): 9\/10 points, avg 64\.\d, min 60, max 69/);
assert.match(text, /Load \(bound trainingLoad\): 10\/10 points/);
assert.match(text, /Shaded ranges: Heavy \(Sep 3 – Sep 5\); Clamped \(Sep 1 – Sep 2\)/);
assert.match(text, /Ignored ranges .*Outside/);
assert.match(text, /2–4 short takeaways/);

const sleepless = describeCoachChart(
  resolveCoachChart(
    parseCoachChartSpec({ title: "Sleep", days: 10, series: [{ label: "Sleep", metric: "sleepMinutes" }] }),
    { previewId: "p6", trendPoints }
  ).preview,
  { sleepAvailable: false }
);
assert.match(sleepless, /empty — no sleep data \(COROS MCP not connected\)/);

// ----- freshness: bound vs inline parts -----

assert.equal(resolved.preview.freshness, "partial", "inline rolling series keeps the chart partial");
assert.equal(resolved.preview.window.kind, "daily");
assert.equal(resolved.preview.window.days, 10);
assert.match(
  describeCoachChart(resolved.preview),
  /Inline parts \(Rolling\) are a snapshot/,
  "the model is told which parts a pinned copy cannot refresh"
);
assert.match(describeCoachChart(inline.preview), /never updates/);

const fullyLive = resolveCoachChart(
  parseCoachChartSpec({
    title: "Load",
    days: 10,
    series: [{ label: "Load", metric: "trainingLoad" }],
    tiles: [
      { label: "Latest", metric: "trainingLoad" },
      { label: "Total", metric: "trainingLoad", stat: "sum" },
      { label: "Peak HRV", metric: "avgSleepHrv", stat: "max", unit: "ms" },
      { label: "Recovery", metric: "recoveryPct" },
      { label: "Sleep", metric: "sleepMinutes", stat: "avg" },
      { label: "Steps", metric: "steps" }
    ]
  }),
  { previewId: "p7", trendPoints, dashboard: { recoveryPct: 100 } }
);
assert.equal(fullyLive.preview.freshness, "live");
assert.equal(fullyLive.preview.live, true);
assert.deepEqual(
  fullyLive.preview.tiles.map((tile) => tile.value),
  ["90", "450", "69 ms", "100%", "No data", "No data"],
  "bound tiles reduce the chart window; empty metrics say so"
);
assert.equal(fullyLive.preview.tiles[0].stat, "latest", "stat defaults to latest");
assert.match(describeCoachChart(fullyLive.preview), /refreshes itself/);
assert.match(describeCoachChart(fullyLive.preview), /Latest = 90 \(bound trainingLoad latest\)/);

assert.throws(
  () => parseCoachChartSpec({ title: "x", labels: ["a", "b"], series: [{ label: "a", values: [1, 2] }], tiles: [{ label: "t" }] }),
  /needs either a bound "metric" or a static "value"/
);
assert.throws(
  () => parseCoachChartSpec({ title: "x", labels: ["a", "b"], series: [{ label: "a", values: [1, 2] }], tiles: [{ label: "t", value: "1", stat: "avg" }] }),
  /stat needs a bound "metric"/
);

// ----- formatCoachMetricValue -----

assert.equal(formatCoachMetricValue("sleepMinutes", 432), "7 h 12 min");
assert.equal(formatCoachMetricValue("sleepMinutes", 45), "45 min");
assert.equal(formatCoachMetricValue("steps", 12345.6), "12,346");
assert.equal(formatCoachMetricValue("calories", 2100), "2,100 kcal");
assert.equal(formatCoachMetricValue("rhr", 48.4), "48 bpm");
assert.equal(formatCoachMetricValue("spo2", 97.6), "97.6%");
assert.equal(formatCoachMetricValue("trainingLoadRatio", 1.049), "1.05");
assert.equal(formatCoachMetricValue("stress", 37.5), "37.5");
assert.equal(formatCoachMetricValue("heartRate", 62, "beats"), "62 beats", "an explicit unit wins");

// ----- intraday: parse, bucket, resolve -----

const intradaySpec = parseCoachChartSpec({
  title: "Stress today",
  days: 30,
  series: [{ label: "Stress", metric: "stress" }],
  tiles: [{ label: "Avg stress", metric: "stress", stat: "avg" }, { label: "Resting HR", metric: "rhr" }]
});
assert.equal(intradaySpec.days, 7, "intraday windows clamp to 7 days");
assert.equal(parseCoachChartSpec({ title: "s", days: 1, series: [{ label: "s", metric: "stress" }] }).days, 1);
assert.throws(
  () => parseCoachChartSpec({ title: "mix", series: [{ label: "a", metric: "stress" }, { label: "b", metric: "rhr" }] }),
  /mix daily metrics \(rhr\) with intraday metrics \(stress\)/
);
const needs = coachChartNeeds(parseCoachChartSpec({
  title: "Stress today",
  series: [{ label: "Stress", metric: "stress" }],
  tiles: [{ label: "Avg stress", metric: "stress", stat: "avg" }, { label: "Resting HR", metric: "rhr" }, { label: "SpO2", metric: "spo2" }]
}));
assert.deepEqual(
  { ...needs, intradayKinds: [...needs.intradayKinds].sort() },
  { kind: "intraday", days: 1, dailyDays: 7, sleep: false, dailyHealth: false, intradayDays: 1, intradayKinds: ["healthCheck", "stress"], dashboard: false },
  "an intraday chart with a daily tile loads today's readings plus a 7-day daily window"
);
assert.deepEqual(
  coachChartNeeds(parseCoachChartSpec({ title: "d", series: [{ label: "l", metric: "trainingLoad" }], tiles: [{ label: "r", metric: "recoveryPct" }] })),
  { kind: "daily", days: 30, dailyDays: 30, sleep: false, dailyHealth: false, intradayDays: undefined, intradayKinds: [], dashboard: true }
);

const now = new Date(2026, 9, 15, 17, 30);
const at = (hour, minute = 0) => new Date(2026, 9, 15, hour, minute).toISOString();
const bucketed = bucketIntradayReadings(
  {
    stress: [
      { time: at(7, 5), value: 30 }, { time: at(7, 35), value: 40 },
      { time: at(9, 10), value: 60 },
      { time: new Date(2026, 9, 14, 23).toISOString(), value: 99 }
    ],
    heartRate: [{ time: at(8, 0), value: 70 }]
  },
  1,
  now
);
assert.deepEqual(bucketed.buckets.map((bucket) => bucket.label), ["07:00", "08:00", "09:00"], "hourly buckets span first to last reading; yesterday is outside a 1-day window");
assert.deepEqual(bucketed.buckets.map((bucket) => bucket.values.stress), [35, null, 60], "readings average per hour; empty hours stay null");
assert.deepEqual(bucketed.buckets.map((bucket) => bucket.values.heartRate), [null, 70, null]);
assert.equal(bucketIntradayReadings({ stress: [] }, 1, now).buckets.length, 0);
const multiDay = bucketIntradayReadings({ stress: [{ time: new Date(2026, 9, 14, 23).toISOString(), value: 20 }, { time: at(1), value: 10 }] }, 2, now);
assert.deepEqual(multiDay.buckets.map((bucket) => bucket.label), ["Oct 14 23:00", "Oct 15 00:00", "Oct 15 01:00"], "multi-day labels carry the date");

const intradayResolved = resolveCoachChart(
  parseCoachChartSpec({
    title: "Stress today",
    series: [{ label: "Stress", metric: "stress" }, { label: "Marker", values: [1, 1, 1], dashed: true }],
    tiles: [{ label: "Avg stress", metric: "stress", stat: "avg" }, { label: "Resting HR", metric: "rhr" }],
    ranges: [{ from: "08:00", to: "09:00", label: "Meeting" }]
  }),
  { previewId: "p8", intraday: bucketed, trendPoints, now }
);
assert.deepEqual(intradayResolved.preview.labels, ["07:00", "08:00", "09:00"]);
assert.equal(intradayResolved.preview.times.length, 3);
assert.equal(intradayResolved.preview.dates, undefined);
assert.deepEqual(intradayResolved.preview.window, { kind: "intraday", days: 1 });
assert.deepEqual(intradayResolved.preview.series[0].values, [35, null, 60]);
assert.equal(intradayResolved.preview.series[0].color, "sleep", "stress draws in the purple family");
assert.deepEqual(intradayResolved.preview.ranges, [{ fromIndex: 1, toIndex: 2, label: "Meeting" }], "ranges match hour labels");
assert.deepEqual(intradayResolved.preview.tiles.map((tile) => tile.value), ["47.5", "No data"], "tiles reduce the intraday window; rhr is absent from the fixture");
assert.equal(intradayResolved.preview.freshness, "partial");
assert.match(describeCoachChart(intradayResolved.preview), /3 hourly points, 07:00 – 09:00/);

assert.throws(
  () => resolveCoachChart(parseCoachChartSpec({ title: "s", series: [{ label: "s", metric: "stress" }, { label: "i", values: [1] }] }), { previewId: "p9", intraday: bucketed }),
  /has 1 values but the chart has 3 points\. The window has 3 hourly points/
);
assert.throws(
  () => resolveCoachChart(parseCoachChartSpec({ title: "s", series: [{ label: "s", metric: "stress" }] }), { previewId: "p10", intraday: { days: 1, buckets: [] }, intradayAvailable: false }),
  /need COROS MCP/
);
assert.throws(
  () => resolveCoachChart(parseCoachChartSpec({ title: "s", series: [{ label: "s", metric: "stress" }] }), { previewId: "p11", intraday: { days: 1, buckets: [] }, intradayAvailable: true }),
  /No COROS health readings/
);

// ----- withCoachChartDefaults: previews saved before freshness existed -----

const legacy = withCoachChartDefaults({
  previewId: "old",
  spec: { title: "Old", series: [{ label: "a", values: [1, 2] }] },
  labels: ["a", "b"],
  series: [{ key: "s0", label: "a", kind: "line", axis: "left", color: "accent", dashed: false, values: [1, 2] }],
  ranges: [],
  tiles: [{ label: "t", value: "1" }],
  resolvedAt: "2026-01-01T00:00:00.000Z",
  live: false
});
assert.equal(legacy.freshness, "snapshot");
assert.deepEqual(legacy.window, { kind: "static", days: 7 });
assert.equal(withCoachChartDefaults({ ...resolved.preview, freshness: undefined, window: undefined }).freshness, "partial");

// ----- upsertPinnedCoachChart: no duplicate pins -----

const pinA = upsertPinnedCoachChart([], fullyLive.preview, { id: "id-a", now: "2026-10-15T10:00:00.000Z" });
assert.equal(pinA.changed, true);
assert.equal(pinA.replaced, false);
assert.equal(pinA.charts.length, 1);
const again = upsertPinnedCoachChart(pinA.charts, fullyLive.preview, { id: "id-b", now: "2026-10-15T11:00:00.000Z" });
assert.equal(again.changed, false, "the same preview is already pinned");
assert.equal(again.pinned.id, "id-a");
const rerendered = { ...fullyLive.preview, previewId: "p7-again", spec: { ...fullyLive.preview.spec, title: "  load " } };
const replaced = upsertPinnedCoachChart(pinA.charts, rerendered, { id: "id-c", now: "2026-10-15T12:00:00.000Z" });
assert.equal(replaced.replaced, true, "a re-rendered chart with the same title replaces the pin in place");
assert.equal(replaced.charts.length, 1);
assert.equal(replaced.pinned.id, "id-a", "the pin keeps its id and position");
assert.equal(replaced.pinned.preview.previewId, "p7-again");
assert.equal(replaced.pinned.updatedAt, "2026-10-15T12:00:00.000Z");
const other = upsertPinnedCoachChart(replaced.charts, intradayResolved.preview, { id: "id-d", now: "2026-10-15T13:00:00.000Z", maxPinned: 1 });
assert.deepEqual(other.charts.map((chart) => chart.id), ["id-d"], "new pins go on top and the cap trims the oldest");

console.log("test-coach-chart-utils: ok");
