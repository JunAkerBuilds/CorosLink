// CorosKit's WatchDataTests (daily history, battery records, sleep score, pedometer, sleep profile), ported.
import { describe, expect, it } from "vitest";
import { CorosError } from "./bytes";
import { asleepMinutes, forecastRound, parseDailyHistory, sleepScore, stageMinutes, walkRecords } from "./dailyHistory";
import { DailyHistoryWriter, hex, local7, syntheticDaily } from "./fixtures/healthWriter";
import { utcCalendar } from "./insights";
import { dayKey } from "./native";
import { COROS_EPOCH } from "./systemBind";
import { parsePedometer, pedometerDay, sleepProfileFromUserInfo } from "./watchHealth";

const unixOf = (d: Date): number => d.getTime() / 1000;
const day = (year: number, month: number, d: number) => ({ year, month, day: d });

describe("daily history", () => {
  it("reads heart rate, activity and days", () => {
    const { file, heart } = syntheticDaily();
    const daily = parseDailyHistory(file);
    const perMinute = daily.heartRate.filter((r) => r.automatic);
    expect(perMinute.map((r) => unixOf(r.time))).toEqual(heart.map((h) => h[0]));
    expect(perMinute.map((r) => r.bpm)).toEqual(heart.map((h) => h[1]));
    expect(perMinute.every((r) => r.utcOffsetMinutes === 420)).toBe(true);
    expect(daily.heartRate.filter((r) => !r.automatic).map((r) => [unixOf(r.time), r.bpm])).toEqual([[unixOf(local7(2026, 1, 2, 9, 32, 12)), 80]]);
    expect(daily.days).toEqual([
      { day: day(2026, 1, 1), steps: 160, calories: 12, partial: true, activeSeconds: 60 },
      { day: day(2026, 1, 2), steps: 400, calories: 31, partial: false, activeSeconds: 0 },
    ]);
    expect(daily.stress.map((s) => s.stress)).toEqual([42, 61]);
    expect(daily.stress.map((s) => s.level)).toEqual([2, 3]);
    expect(daily.hrv.length).toBe(3);
    expect([daily.hrv[0].status, daily.hrv[0].rmssd]).toEqual([4, 30]);
    expect([daily.hrv[0].heartRate, daily.hrv[0].breathingRate]).toEqual([58.25, 14.5]);
    expect(daily.healthChecks.map((c) => [c.heartRate, c.hrv, c.breathingRate, c.spo2, c.stress, c.stressLevel])).toEqual([[72, 40, 13, 97, 31, 2]]);
    expect(daily.recoveries.length).toBe(1);
    expect(daily.recoveries[0].samples[59]).toBe(0);
    expect(unixOf(daily.recoveries[0].workoutStart)).toBe(1_767_247_200);
    expect(() => parseDailyHistory(new Uint8Array(4096).fill(0xff))).toThrow(CorosError);
  });

  it("reads sleep", () => {
    const { file, heart } = syntheticDaily();
    const local = local7;
    const daily = parseDailyHistory(file);
    expect(daily.sleeps.length).toBe(2);
    const night = daily.sleeps[0];
    expect(night.start).toEqual(local(2026, 1, 1, 23, 0, 0));
    expect(night.end).toEqual(local(2026, 1, 2, 6, 30, 0));
    expect(night.day).toEqual(day(2026, 1, 2));
    expect(night.totalMinutes).toBe(450);
    const seconds = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / 1000;
    const light = seconds(local(2026, 1, 1, 23, 3, 40), local(2026, 1, 2, 0, 10, 10)) + seconds(local(2026, 1, 2, 1, 22, 31), local(2026, 1, 2, 6, 30, 10));
    const deep = seconds(local(2026, 1, 2, 0, 10, 10), local(2026, 1, 2, 1, 0, 0));
    const rem = seconds(local(2026, 1, 2, 1, 0, 0), local(2026, 1, 2, 1, 20, 29));
    expect(stageMinutes(night, "light")).toBe(forecastRound(light / 60));
    expect(stageMinutes(night, "deep")).toBe(forecastRound(deep / 60));
    expect(stageMinutes(night, "rem")).toBe(forecastRound(rem / 60));
    expect(stageMinutes(night, "awake")).toBe(forecastRound((450 * 60 - light - deep - rem) / 60));
    expect(night.ranges.map((r) => [r.offset / 60, r.seconds / 60])).toEqual([[0, 4], [4, 66], [70, 50], [120, 20], [140, 3], [143, 307]]);
    // The awake event at the end instant is dropped.
    expect(night.ranges.map((r) => r.stage)).toEqual(["awake", "light", "deep", "rem", "awake", "light"]);
    expect(night.awakeCount).toBe(2);
    const inNight = heart.filter(([t]) => t >= unixOf(night.start) && t <= unixOf(night.end)).map((h) => h[1]);
    expect([night.minHR, night.maxHR, night.averageHR]).toEqual([Math.min(...inNight), Math.max(...inNight), Math.trunc(inNight.reduce((a, b) => a + b, 0) / inNight.length)]);
    expect(daily.sleeps[1].totalMinutes).toBe(33);
    // Only readings during sleep, floored.
    expect([...daily.sleepHRV]).toEqual([[dayKey(day(2026, 1, 2)), Math.trunc((30 + 41) / 2)]]);
    // 0.4 × 30 + 0.12 × (90 + 90 + 70 + 88 + 75) = 61.56; the copy at the file's start goes with no segment.
    expect(daily.sleeps.map((s) => s.score)).toEqual([62, undefined]);
  });

  it("keeps the activity records' calories with their times", () => {
    const calories = parseDailyHistory(syntheticDaily().file).calories;
    expect(calories.map((c) => c.smallCalories)).toEqual([9000, 2000, 1000, 30_500]);
    expect(calories.slice(0, 2).map((c) => c.time)).toEqual([local7(2026, 1, 1, 16, 0, 0), local7(2026, 1, 1, 16, 5, 0)]);
  });

  it("reads the battery records the watch logs on the hour", () => {
    // Kind 11/7 in the layout a PACE Pro (3.2106.0) writes.
    const writer = new DailyHistoryWriter();
    const time = new Date(1_772_384_400_000); // 2026-03-01 17:00 UTC
    writer.zone(time, -20);
    writer.raw(11, hex("072a000890ac84b70110b0f3feffffffffffff011848200128be9d0430023a05088e30103c3a06088040109772"));
    writer.battery(new Date(time.getTime() + 3600_000), 71, -18_000);
    // A length past the record, a percent over 100 and a time before the watch's clock starts are no readings.
    writer.raw(11, hex("07ff000890ac84b701"));
    writer.raw(11, hex("0708000890ac84b701186f"));
    writer.raw(11, hex("070400080a1848"));
    const daily = parseDailyHistory(writer.pages());
    expect(daily.battery).toEqual([
      { time, utcOffsetMinutes: -300, percent: 72, usage: [{ key: 0x180e, value: 60 }, { key: 0x2000, value: 14_615 }] },
      { time: new Date(time.getTime() + 3600_000), utcOffsetMinutes: -300, percent: 71, usage: [{ key: 0x180e, value: 60 }] },
    ]);
  });

  /** 2026-10-24: COROS showed 02:23–10:04 where C-LINK kept 02:23–07:27. */
  it("replaces a night written again longer with the longer copy", () => {
    const at = (d: number, h: number, m: number): Date => new Date(Date.UTC(2026, 9, d, h, m));
    const writer = new DailyHistoryWriter();
    writer.zone(at(24, 0, 0), 0);
    const sleep = (start: Date, end: Date, stages: [Date, number][]): void => {
      writer.sleepStatus(start, 0xfa);
      for (const [time, status] of stages) writer.sleepStatus(time, status);
      writer.sleepStatus(end, 0xfb);
    };
    sleep(at(24, 2, 23), at(24, 7, 27), [[at(24, 2, 23), 3], [at(24, 4, 0), 4]]);
    sleep(at(24, 2, 23), at(24, 10, 4), [[at(24, 2, 23), 3], [at(24, 4, 0), 4], [at(24, 7, 27), 1], [at(24, 7, 48), 3]]);
    // Starts inside the night and ends after it: not a real recording.
    sleep(at(24, 9, 0), at(24, 11, 0), [[at(24, 9, 0), 3]]);
    // The same night again, no longer: the copy before stays.
    sleep(at(24, 2, 23), at(24, 10, 4), [[at(24, 2, 23), 4]]);
    const sleeps = parseDailyHistory(writer.pages()).sleeps;
    expect(sleeps.map((s) => [s.start, s.end])).toEqual([[at(24, 2, 23), at(24, 10, 4)]]);
    expect(sleeps[0].ranges.map((r) => r.stage)).toEqual(["light", "deep", "awake", "light"]);
    expect(stageMinutes(sleeps[0], "awake")).toBe(21);
  });

  it("reads an empty daily file as an empty history, and refuses bytes without a marker", () => {
    const empty = parseDailyHistory(new Uint8Array());
    expect(empty.heartRate.length + empty.days.length).toBe(0);
    expect(walkRecords(new Uint8Array())).toEqual([]);
    expect(() => walkRecords(new Uint8Array(64).fill(0xff))).toThrow(CorosError);
  });

  /** The bytes the PACE Pro's 3.2206.0 night-end code wrote for a two-hour night (light, deep, REM, light). */
  it("reads a night written as one record by firmware 3.2206", () => {
    const writer = new DailyHistoryWriter();
    writer.zone(new Date((1_795_388_400 - 3600) * 1000), -20);
    const record = hex("4f0906030000000070194018fae81940180378204018048027401805882e40180390354018fb");
    expect(DailyHistoryWriter.record(15, record.subarray(2))).toEqual(record);
    writer.raw(15, record.subarray(2));
    const sleeps = parseDailyHistory(writer.pages()).sleeps;
    const start = new Date((406_854_000 + COROS_EPOCH) * 1000);
    expect(sleeps.map((s) => [s.start, s.end])).toEqual([[start, new Date(start.getTime() + 2 * 3600_000)]]);
    expect(sleeps[0].ranges.map((r) => r.stage)).toEqual(["light", "deep", "rem", "light"]);

    // The same night as kind-4 records decodes the same.
    const older = new DailyHistoryWriter();
    older.zone(new Date((1_795_388_400 - 3600) * 1000), -20);
    for (const [offset, status] of [[0, 0xfa], [120, 3], [1800, 4], [3600, 5], [5400, 3], [7200, 0xfb]]) {
      older.sleepStatus(new Date(start.getTime() + offset * 1000), status);
    }
    expect(parseDailyHistory(older.pages()).sleeps).toEqual(sleeps);
  });

  it("reads kind-15 nights beside kind-4 ones, and a count larger than the events held", () => {
    const at = (d: number, h: number, m: number): Date => new Date(Date.UTC(2026, 9, d, h, m));
    const writer = new DailyHistoryWriter();
    writer.zone(at(24, 0, 0), 0);
    writer.sleepStatus(at(24, 1, 0), 0xfa); writer.sleepStatus(at(24, 1, 0), 3); writer.sleepStatus(at(24, 6, 0), 0xfb);
    writer.sleepNight([[at(25, 1, 0), 0xfa], [at(25, 1, 0), 4], [at(25, 3, 0), 5], [at(25, 7, 0), 0xfb]]);
    const t = unixOf(at(26, 1, 0)) - COROS_EPOCH;
    writer.raw(15, [9, 3, 0, 0, 0, 0, t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff, 0xfa]);
    const sleeps = parseDailyHistory(writer.pages()).sleeps;
    expect(sleeps.map((s) => [s.start, s.end])).toEqual([[at(24, 1, 0), at(24, 6, 0)], [at(25, 1, 0), at(25, 7, 0)]]);
    expect(sleeps[1].ranges.map((r) => r.stage)).toEqual(["deep", "rem"]);
  });

  it("combines the night summary into the score as the watch does", () => {
    const score = (a: number, b: number, c: number, d: number, f: number, g: number, j: number) => sleepScore([a, b, c, d, 100, f, g, 0, 0, j]);
    expect(score(85, 95, 90, 70, 30, 88, 75)).toBe(62); // time asleep lowest at 30: weight 0.4
    expect(score(90, 90, 85, 95, 82, 88, 99)).toBe(90); // every part over 80: the average, 89.83
    expect(score(90, 90, 85, 95, 85, 88, 80)).toBe(86); // regularity lowest at exactly 80: weight 0.3
    expect(score(90, 90, 65, 95, 85, 88, 99)).toBe(87); // REM lowest at 60 or more: the average
    expect(score(90, 90, 85, 10, 85, 88, 99)).toBe(66); // deep lowest under 20: weight 0.3, 65.58
    expect(score(90, 90, 85, 95, 40, 0, 0)).toBe(70); // no stress data and under a week of nights
    expect(sleepScore([90, 90])).toBeUndefined();
  });

  it("counts exercise time, a full five minutes wrapping to 44", () => {
    const writer = new DailyHistoryWriter();
    const start = new Date(1_767_312_000_000); // 2026-01-02 00:00 UTC
    for (const [minute, secs] of [[0, 300], [5, 300], [10, 240], [15, 60], [20, 0]]) {
      writer.activity(new Date(start.getTime() + minute * 60_000), new Date(start.getTime() + (minute + 5) * 60_000), 10, 1000, secs);
    }
    expect(parseDailyHistory(writer.pages()).days[0].activeSeconds).toBe(900);
  });

  it("asleepMinutes adds the sleep stages", () => {
    const night = parseDailyHistory(syntheticDaily().file).sleeps[0];
    expect(asleepMinutes(night)).toBe(stageMinutes(night, "light") + stageMinutes(night, "deep") + stageMinutes(night, "rem"));
  });
});

describe("pedometer", () => {
  it("reads today's totals and the year that puts the date closest to now", () => {
    const payload = new Uint8Array(20);
    const view = new DataView(payload.buffer);
    [8_412, 612_300, 386_400, 3_240].forEach((v, i) => view.setUint32(i * 4, v, true));
    payload.set([1, 2, 0, 0], 16);
    const totals = parsePedometer(payload);
    expect([totals.steps, totals.calories, totals.activeSeconds, totals.month, totals.day]).toEqual([8412, 386, 3240, 1, 2]);
    expect(totals.distanceMeters).toBe(6123);
    const lateDecember = new Date(1_798_675_200_000); // 2026-12-31
    expect(pedometerDay(totals, lateDecember, utcCalendar)).toEqual(day(2027, 1, 2));
    expect(() => parsePedometer(new Uint8Array(8))).toThrow(CorosError);
  });
});

describe("sleep profile", () => {
  /** A SyncUserInfo block: `weight` at byte 1, the sleep schedule at bytes 55–58. */
  const userInfo = (weight: number, schedule: number[]): Uint8Array => {
    const info = new Uint8Array(71);
    info[0] = 175; info[1] = weight;
    info.set(schedule, 55);
    return info;
  };

  it("takes the weight and sleep schedule from the user info", () => {
    expect(sleepProfileFromUserInfo(userInfo(82, [22, 30, 6, 45]))).toEqual({ weightKg: 82, schedule: { bedtime: 22 * 60 + 30, wake: 6 * 60 + 45 } });
    // The firmware keeps 11–249 kg and uses 60 kg for any other weight.
    for (const [weight, used] of [[11, 11], [249, 249], [10, 60], [250, 60], [0, 60]]) {
      expect(sleepProfileFromUserInfo(userInfo(weight, [23, 0, 7, 0])).weightKg).toBe(used);
    }
    // The watch reads 00:00 to 00:00 as 00:00–08:00.
    expect(sleepProfileFromUserInfo(userInfo(70, [0, 0, 0, 0])).schedule).toEqual({ bedtime: 0, wake: 0 });
    expect(sleepProfileFromUserInfo(userInfo(70, [24, 0, 7, 0])).schedule).toBeUndefined();
    expect(sleepProfileFromUserInfo(userInfo(70, [23, 0, 7, 60])).schedule).toBeUndefined();
    expect(sleepProfileFromUserInfo(new Uint8Array(70))).toEqual({ weightKg: 60 });
  });
});
