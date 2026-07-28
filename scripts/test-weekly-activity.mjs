import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const weeklyActivityUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "weeklyActivity.ts")
);

const {
  buildWeeklyActivitySeries,
  buildWeeklyActivityYAxisTicks,
  enrichDayListWithActivityTotals,
  formatWeeklyActivityAxisTick,
  getCalendarWeekDateKeys,
  getWeeklyActivityYAxisUnitLabel
} = await import(`${weeklyActivityUrl.href}?cacheBust=${Date.now()}`);

const referenceDate = new Date(2026, 5, 28);
const weekKeys = getCalendarWeekDateKeys(referenceDate);

assert.equal(weekKeys.length, 7);
assert.equal(weekKeys[0], "20260622");
assert.equal(weekKeys[6], "20260628");

const dayList = [
  { happenDay: "20260625", distance: 6500, duration: 2400, trainingLoad: 42 },
  { happenDay: "20260626", distance: 11200, duration: 3900, trainingLoad: 68 },
  { happenDay: "20260627", distance: 8200, duration: 2700, trainingLoad: 51 }
];

const distanceSeries = buildWeeklyActivitySeries(
  dayList,
  "distance",
  referenceDate,
  "metric"
);

assert.equal(distanceSeries.hasData, true);
assert.equal(distanceSeries.days.length, 7);
assert.equal(distanceSeries.days[3].value, 6.5);
assert.equal(distanceSeries.days[3].displayValue, "6.50 km");
assert.equal(distanceSeries.days[0].value, 0);
assert.equal(distanceSeries.days[0].displayValue, "—");
assert.equal(distanceSeries.weeklyTotal, "25.90 km");
assert.equal(distanceSeries.days[6].isToday, true);
assert.ok(distanceSeries.yMax >= 11.2);

const loadSeries = buildWeeklyActivitySeries(
  dayList,
  "trainingLoad",
  referenceDate,
  "metric"
);

assert.equal(loadSeries.weeklyTotal, "161");

const emptySeries = buildWeeklyActivitySeries([], "distance", referenceDate, "metric");

assert.equal(emptySeries.hasData, false);
assert.equal(emptySeries.weeklyTotal, "—");
assert.equal(emptySeries.days.every((day) => day.value === 0), true);

const activityEnriched = buildWeeklyActivitySeries(
  enrichDayListWithActivityTotals(
    [{ happenDay: "20260625", trainingLoad: 42 }],
    [
      {
        activityId: "1",
        sportType: 100,
        startTime: Date.UTC(2026, 5, 25, 12, 0, 0) / 1000,
        distance: 6500,
        duration: 2400
      }
    ]
  ),
  "distance",
  referenceDate,
  "metric"
);

assert.equal(activityEnriched.hasData, true);
assert.equal(activityEnriched.days[3].value, 6.5);
assert.equal(activityEnriched.days[3].displayValue, "6.50 km");

const imperialSeries = buildWeeklyActivitySeries(
  [{ happenDay: "20260625", distance: 8_046.72 }],
  "distance",
  referenceDate,
  "imperial"
);
assert.equal(imperialSeries.days[3].value, 5);
assert.equal(imperialSeries.days[3].displayValue, "5.00 mi");
assert.equal(imperialSeries.weeklyTotal, "5.00 mi");
assert.equal(imperialSeries.yAxisUnit, "mi");

const yTicks = buildWeeklyActivityYAxisTicks(distanceSeries.yMax);
assert.equal(yTicks.length, 7);
assert.equal(yTicks[0], 0);
assert.equal(yTicks.at(-1), distanceSeries.yMax);
assert.equal(
  formatWeeklyActivityAxisTick(6, "distance", distanceSeries.yAxisUnit),
  "6.0"
);
assert.equal(getWeeklyActivityYAxisUnitLabel("distance", "km"), "km");
assert.equal(getWeeklyActivityYAxisUnitLabel("trainingLoad", ""), "Load");

console.log("weekly activity tests passed");
