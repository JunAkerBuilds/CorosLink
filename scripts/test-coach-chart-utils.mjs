import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  CoachChartSpecError,
  describeCoachChart,
  parseCoachChartSpec,
  resolveCoachChart,
  resolveCoachChartRanges
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

console.log("test-coach-chart-utils: ok");
