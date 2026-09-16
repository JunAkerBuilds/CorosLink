import assert from "node:assert/strict";
import { buildSleepDurationSummary } from "../src/training/sleepDuration.ts";

const key = (day) => `202609${String(day).padStart(2, "0")}`;
const points = Array.from({ length: 7 }, (_, index) => ({ date: key(index + 7), label: key(index + 7) }));
const records = Array.from({ length: 14 }, (_, index) => ({
  happenDay: index === 0 ? "20260831" : key(index),
  kind: "main", completeness: "complete", totalMinutes: index < 7 ? 400 : 448
}));

const full = buildSleepDurationSummary(points, records);
assert.equal(full.average, 448);
assert.equal(full.changePercent, 12);
assert.equal(full.nights, 7);
assert.deepEqual(full.days.map((day) => day.date), points.map((point) => point.date));

// Missing dates keep their chart slot and never become a zero-minute night.
const missing = buildSleepDurationSummary(points, records.filter((record) => record.happenDay !== key(10)));
assert.equal(missing.days[3].sleepMinutes, undefined);
assert.equal(missing.nights, 6);
assert.equal(missing.average, 448);
assert.equal(missing.changePercent, undefined);

const missingPrior = buildSleepDurationSummary(points, records.slice(1));
assert.equal(missingPrior.average, 448);
assert.equal(missingPrior.changePercent, undefined);

// Naps, partial sessions, invalid values, and invalid dates cannot skew averages.
const excluded = buildSleepDurationSummary(points, [
  ...records,
  { happenDay: key(13), kind: "nap", totalMinutes: 90 },
  { happenDay: key(13), completeness: "partial", totalMinutes: 15 },
  { happenDay: key(13), totalMinutes: NaN },
  { happenDay: key(13), totalMinutes: Infinity },
  { happenDay: key(13), totalMinutes: -1 },
  { happenDay: "20260231", totalMinutes: 999 }
]);
assert.equal(excluded.average, full.average);
assert.equal(excluded.changePercent, full.changePercent);
assert.equal(buildSleepDurationSummary(points, [...records, records[13]]).nights, 7);

const noHistory = buildSleepDurationSummary(points.map((point) => ({ ...point, sleepMinutes: 450 })));
assert.equal(noHistory.average, 450);
assert.equal(noHistory.changePercent, undefined);
assert.equal(buildSleepDurationSummary([], records).average, 448);
assert.equal(buildSleepDurationSummary([], []).average, undefined);

const zero = buildSleepDurationSummary(points, records.map((record) => ({ ...record, totalMinutes: 0 })));
assert.equal(zero.average, 0);
assert.equal(zero.changePercent, undefined);

const decrease = buildSleepDurationSummary(points, records.map((record) => ({ ...record, totalMinutes: record.totalMinutes === 448 ? 360 : 400 })));
assert.equal(decrease.changePercent, -10);
const unchanged = buildSleepDurationSummary(points, records.map((record) => ({ ...record, totalMinutes: 400 })));
assert.equal(unchanged.changePercent, 0);

const boundary = buildSleepDurationSummary([{ date: "20260103", label: "Jan 3", sleepMinutes: 480 }]);
assert.equal(boundary.days[0].date, "20251228");
assert.equal(boundary.days.at(-1).date, "20260103");
assert.equal(boundary.average, 480);
console.log("Sleep duration summaries passed: averages, comparisons, missing nights, excluded sessions, and date boundaries.");
