import assert from "node:assert/strict";
import {
  buildSleepWeek,
  formatNoonClock,
  minutesAfterNoon,
  sleepClockVerdict,
  sleepStageMinutes
} from "../src/training/sleepWeek.ts";

const now = new Date(2026, 9, 22, 9, 30);
const key = (day) => `202610${String(day).padStart(2, "0")}`;
const night = (day, extra = {}) => ({
  happenDay: key(day), kind: "main", completeness: "complete", totalMinutes: 450, score: 80,
  sleepStart: "23:00", sleepEnd: "07:00", windowMinutes: 480, deepMinutes: 90, lightMinutes: 240,
  remMinutes: 120, awakeMinutes: 30, awakeCountOverFiveMinutes: 2, avgHr: 52, ...extra
});
// Previous week (Oct 9–15) sleeps 420 at score 70; this week (Oct 16–22) 450 at 80.
const twoWeeks = [
  ...Array.from({ length: 7 }, (_, index) => night(9 + index, { totalMinutes: 420, score: 70 })),
  ...Array.from({ length: 7 }, (_, index) => night(16 + index))
];

const week = buildSleepWeek(twoWeeks, now);
assert.deepEqual(week.nights.map((item) => item.date), [16, 17, 18, 19, 20, 21, 22].map(key));
assert.equal(week.tracked, 7);
assert.equal(week.duration.value, 450);
assert.equal(week.duration.delta, 30);
assert.equal(week.score.delta, 10);
assert.equal(week.nights.at(-1).isToday, true);
assert.equal(week.defaultDate, key(22));
assert.equal(week.sleepHr, 52);
assert.equal(week.wakeUps, 2);

// Windows sit after the noon before, so a bedtime past midnight stays on the same night.
assert.equal(minutesAfterNoon("23:30"), 690);
assert.equal(minutesAfterNoon("01:15"), 795);
assert.equal(minutesAfterNoon("24:00"), undefined);
assert.deepEqual(week.nights[0].window, { start: 660, end: 1140 });
const late = buildSleepWeek([night(22, { sleepStart: "01:40", sleepEnd: "08:05" })], now);
assert.deepEqual(late.nights.at(-1).window, { start: 820, end: 1205 });
// A night with only an end time and a window length still gets a bar.
const endOnly = buildSleepWeek([night(22, { sleepStart: undefined })], now);
assert.deepEqual(endOnly.nights.at(-1).window, { start: 660, end: 1140 });
assert.ok(week.axis.start <= 660 && week.axis.end >= 1140 && week.axis.end - week.axis.start >= 540);
assert.ok(week.axis.ticks.every((tick) => tick % 120 === 0 && tick >= week.axis.start && tick <= week.axis.end));

// Bedtimes either side of midnight average to midnight, not to noon.
const straddle = buildSleepWeek([20, 21, 22].map((day, index) => night(day, { sleepStart: ["23:30", "00:30", "00:00"][index] })), now);
assert.equal(formatNoonClock(straddle.bedtime.mean), "12:00 AM");
assert.equal(Math.round(straddle.bedtime.spread), 24);
assert.equal(sleepClockVerdict(straddle.bedtime.spread).key, "steady");
assert.equal(sleepClockVerdict(45).key, "varied");
assert.equal(sleepClockVerdict(61).key, "irregular");
// Two timed nights are too few to call a bedtime steady.
assert.equal(buildSleepWeek([night(21), night(22)], now).bedtime.spread, undefined);

// Partial nights show but stay out of averages; complete beats partial on the same day; naps add up.
const mixed = buildSleepWeek([
  ...twoWeeks.filter((record) => record.happenDay !== key(21)),
  night(21, { completeness: "partial", totalMinutes: 200, score: undefined }),
  night(20, { completeness: "partial", totalMinutes: 999 }),
  { happenDay: key(20), kind: "nap", totalMinutes: 20 },
  { happenDay: key(20), kind: "nap", totalMinutes: 15 }
], now);
assert.equal(mixed.nights[5].partial, true);
assert.equal(mixed.nights[4].partial, false);
assert.equal(mixed.nights[4].napMinutes, 35);
assert.equal(mixed.duration.value, 450);
assert.equal(mixed.tracked, 7);

// Missing nights keep their row; a short week still averages but does not compare.
const sparse = buildSleepWeek([...twoWeeks.slice(0, 7), night(20), night(22, { totalMinutes: 390 })], now);
assert.equal(sparse.nights[2].record, undefined);
assert.equal(sparse.tracked, 2);
assert.equal(sparse.duration.value, 420);
assert.equal(sparse.duration.delta, undefined);

// Nothing in the last seven days: show the newest recorded week instead of seven empty rows.
const stale = buildSleepWeek(twoWeeks.slice(0, 7), now);
assert.equal(stale.nights.at(-1).date, key(15));
assert.equal(stale.tracked, 7);
assert.equal(buildSleepWeek([], now).nights.at(-1).date, key(22));

// Stage minutes fall back to the stage's share of the window.
assert.equal(sleepStageMinutes({ happenDay: key(22), deepPercent: 25, windowMinutes: 480 }, "deep"), 120);
assert.equal(sleepStageMinutes({ happenDay: key(22), deepMinutes: 0, deepPercent: 25, windowMinutes: 480 }, "deep"), 0);
assert.equal(sleepStageMinutes({ happenDay: key(22) }, "rem"), undefined);

// COROS's overnight resting HR and HRV ride along by wake-up day; zero means unmeasured.
const withHeart = buildSleepWeek(twoWeeks, now, [
  { date: key(21), rhr: 48, avgSleepHrv: 70 },
  { date: key(22), rhr: 50, avgSleepHrv: 0 },
  { date: key(14), rhr: 60, avgSleepHrv: 40 }
]);
assert.equal(withHeart.nights.at(-1).restingHr, 50);
assert.equal(withHeart.nights.at(-1).hrv, undefined);
assert.equal(withHeart.restingHr, 49);
assert.equal(withHeart.hrv, 70);
assert.equal(buildSleepWeek(twoWeeks, now).restingHr, undefined);

// Best night is the top score among complete nights.
const best = buildSleepWeek([night(20, { score: 91 }), night(21, { score: 95, completeness: "partial" }), night(22, { score: 88 })], now);
assert.equal(best.best.date, key(20));

console.log("Sleep week passed: anchoring, midnight windows, steadiness, partial nights, naps, comparisons and stage fallbacks.");
