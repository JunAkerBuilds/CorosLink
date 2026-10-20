import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { syntheticDaily } from "./fixtures/coros-daily-fixture.mjs";

// Decoder for the PACE 4 daily-history file (SyncData file 5). Runs against the
// compiled main-process modules (npm run build:electron first).
//
// COROSLINK_DAILY_ORACLE=<dir> additionally checks a real recording:
// <dir>/raw-file5.bin against <dir>/coros-daily.json, COROS's own decoding of
// the same file. Real recordings are never committed.

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(pathToFileURL(path.join(repoRoot, "dist-electron", file)).href);
const { decodeCorosDailyFile } = await load("localSync/corosDailyRecord.js");
const { CorosSportRecordFormatError } = await load("localSync/corosSportRecord.js");

let passed = 0;
function test(name, body) {
  try {
    body();
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("heart rate, activity slots and day totals", () => {
  const { file, heart, spot } = syntheticDaily();
  const daily = decodeCorosDailyFile(file);
  const perMinute = daily.heartRate.filter((s) => s.automatic);
  assert.deepEqual(perMinute.map((s) => [s.ts, s.bpm]), heart);
  assert.ok(perMinute.every((s) => s.utcOffsetMinutes === 420));
  assert.deepEqual(daily.heartRate.filter((s) => !s.automatic).map((s) => [s.ts, s.bpm, s.utcOffsetMinutes]), [[...spot, 420]], "the one-off reading keeps its exact second");
  assert.deepEqual(daily.activity.map((a) => [a.day, a.slot, a.steps, a.calories, a.activeSeconds]), [
    ["20260101", 192, 120, 9000, 60], ["20260101", 193, 40, 3000, 0], ["20260102", 108, 400, 30_500, 0]
  ]);
  assert.deepEqual(daily.days, [
    { day: "20260101", steps: 160, calories: 12, partial: true },
    { day: "20260102", steps: 400, calories: 31, partial: false }
  ]);
});

test("stress and HRV measurements", () => {
  const { file, local } = syntheticDaily();
  const daily = decodeCorosDailyFile(file);
  assert.deepEqual(daily.stress.map((s) => [s.ts, s.utcOffsetMinutes, s.stress, s.score]), [
    [local(2026, 1, 1, 18, 0), 420, 42, 2], [local(2026, 1, 1, 18, 5), 420, 61, 3]
  ]);
  assert.equal(daily.hrv.length, 3);
  assert.deepEqual({ ...daily.hrv[0], ts: 0 }, { ts: 0, utcOffsetMinutes: 420, status: 4, rmssdMs: 30, heartRate: 58.25, breathingRate: 14.5, sdnnMs: 40.125, confidence: 0.95 });
});

test("sleep: stages, rounding, the end instant and averages", () => {
  const { file, local, heart } = syntheticDaily();
  const daily = decodeCorosDailyFile(file);
  assert.equal(daily.sleeps.length, 2);
  const [night, second] = daily.sleeps;
  assert.equal(night.start, local(2026, 1, 1, 23, 0));
  assert.equal(night.end, local(2026, 1, 2, 6, 30));
  assert.equal(night.startExact, local(2026, 1, 1, 23, 0, 20));
  assert.equal(night.day, "20260102");
  assert.equal(night.totalMinutes, 450);
  // Exact seconds per stage; awake is what the rounded window leaves.
  const light = (local(2026, 1, 2, 0, 10, 10) - local(2026, 1, 1, 23, 3, 40)) + (local(2026, 1, 2, 6, 30, 10) - local(2026, 1, 2, 1, 22, 31));
  const deep = local(2026, 1, 2, 1, 0) - local(2026, 1, 2, 0, 10, 10);
  const rem = local(2026, 1, 2, 1, 20, 29) - local(2026, 1, 2, 1, 0);
  assert.deepEqual(night.stageSeconds, { awake: 450 * 60 - light - deep - rem, light, deep, rem });
  assert.deepEqual(night.stageMinutes, { awake: Math.round((450 * 60 - light - deep - rem) / 60), light: Math.round(light / 60), deep: Math.round(deep / 60), rem: Math.round(rem / 60) });
  assert.deepEqual(night.ranges.map((r) => [r.offset / 60, r.seconds / 60, r.stage]), [
    [0, 4, "awake"], [4, 66, "light"], [70, 50, "deep"], [120, 20, "rem"], [140, 3, "awake"], [143, 307, "light"]
  ], "minute-rounded ranges; the awake event at the end instant is dropped");
  assert.equal(night.awakeCount, 2);
  const inNight = heart.filter(([t]) => t >= night.start && t <= night.end).map(([, bpm]) => bpm);
  assert.deepEqual([night.minHr, night.maxHr, night.avgHr], [Math.min(...inNight), Math.max(...inNight), Math.floor(inNight.reduce((a, b) => a + b, 0) / inNight.length)]);
  assert.equal(second.totalMinutes, 33);
  assert.deepEqual(daily.sleepHrv, { "20260102": Math.floor((30 + 41) / 2) }, "only readings during sleep, floored");
});

test("heart-rate recovery after a workout", () => {
  const { file, recovery } = syntheticDaily();
  const daily = decodeCorosDailyFile(file);
  assert.deepEqual(daily.recoveries, [{ workoutStart: 1_767_247_200, workoutEnd: 1_767_247_230, samples: recovery }]);
});

test("Health Check", () => {
  const { file, healthCheck } = syntheticDaily();
  const { ts, heartRate, hrv, breathingRate, spo2, stress, stressLevel } = healthCheck;
  assert.deepEqual(decodeCorosDailyFile(file).healthChecks, [
    { ts, utcOffsetMinutes: 420, heartRate, hrvMs: hrv, restingHeartRate: 55, breathingRate, spo2, stress, stressLevel }
  ]);
});

test("not a daily file", () => {
  assert.throws(() => decodeCorosDailyFile(Buffer.alloc(4096, 0xff)), CorosSportRecordFormatError);
});

const oracle = process.env.COROSLINK_DAILY_ORACLE;
if (oracle) {
  test("real recording: matches COROS's decoding", () => {
    const daily = decodeCorosDailyFile(fs.readFileSync(path.join(oracle, "raw-file5.bin")));
    const reference = JSON.parse(fs.readFileSync(path.join(oracle, "coros-daily.json"), "utf8"));
    const sort = (list, key) => [...list].sort((a, b) => key(a) - key(b) || 0);
    assert.deepEqual(sort(daily.heartRate, (s) => s.ts).map((s) => [s.ts, s.bpm, s.utcOffsetMinutes]), sort(reference.heartRate, (s) => s.ts).map((s) => [s.ts, s.bpm, s.utcOffsetMinutes]));
    const slotKey = (a) => Number(a.day) * 1000 + a.slot;
    assert.deepEqual(sort(daily.activity, slotKey).map((a) => [a.day, a.slot, a.steps, a.calories]), sort(reference.activity, slotKey).map((a) => [a.day, a.slot, a.steps, a.calories]));
    assert.deepEqual(daily.days.map((d) => [d.day, d.steps, d.calories]), reference.days.map((d) => [d.day, d.steps, Math.round(d.smallCalories / 1000)]));
    assert.deepEqual(daily.stress.map((s) => [s.ts, s.utcOffsetMinutes, s.stress, s.score]), reference.stress.map((s) => [s.ts, s.utcOffsetMinutes, s.stress, s.score]));
    assert.deepEqual(daily.hrv.map(({ utcOffsetMinutes, ...rest }) => rest), reference.hrv);
    assert.equal(daily.sleeps.length, reference.sleeps.length);
    daily.sleeps.forEach((sleep, index) => {
      const ref = reference.sleeps[index];
      for (const key of ["day", "start", "end", "startExact", "endExact", "totalMinutes", "stageMinutes", "stageSeconds", "awakeCount", "minHr", "maxHr", "avgHr", "ranges"]) {
        assert.deepEqual(sleep[key], ref[key], `sleep ${index} ${key}`);
      }
    });
    // The night's sleep HRV is COROS's value on that day's last segment (earlier segments carry running values).
    for (const day of new Set(daily.sleeps.map((sleep) => sleep.day))) {
      const last = reference.sleeps.filter((sleep) => sleep.day === day).at(-1);
      assert.equal(daily.sleepHrv[day], last.aveHrv, `sleep HRV ${day}`);
    }
    assert.deepEqual(daily.recoveries, reference.recoveries, "the recovery curve COROS passes through");
    assert.deepEqual(daily.healthChecks, reference.healthChecks ?? [], "Health Checks (COROS's rhm)");
  });
}

console.log(`coros daily record: ${passed} checks passed${oracle ? " (including the real recording)" : ""}`);
