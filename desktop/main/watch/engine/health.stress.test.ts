// CorosKit's SleepStressTests, ported. Left out: the parts that check `filling` and Apple Health's `adding` (not on
// the desktop's path), DailyHistory.restoring (the helper never used it) and the real-recording oracle.
import { describe, expect, it } from "vitest";
import { parseDailyHistory } from "./dailyHistory";
import { DailyHistoryWriter } from "./fixtures/healthWriter";
import {
  type SleepNight, type SleepSpan, type StressSample, asleepReadings, decodeSleepNight, encodeSleepNight, measuredReadings, mergedOver,
  newInsights, sleepStress, stressSamplesOf, stressShare, utcCalendar, withSleepStress,
} from "./insights";
import { dayKey } from "./native";
import { newWatchHealth, recordDailyHistory } from "./watchHealth";

/** 2026-10-`d` at `h`:`m`:`s` UTC (the watch's readings land 50 s before each 5-minute mark). */
const at = (d: number, h: number, m: number, s = 0): Date => new Date(Date.UTC(2026, 9, d, h, m, s));
const plus = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);
const span = (start: Date, minutes: number, stage: SleepSpan["stage"]): SleepSpan => ({ start, end: plus(start, minutes * 60), stage });
/** Readings every 5 minutes from `start`, one per value; 0 leaves that step out. */
const readings = (start: Date, values: number[]): StressSample[] =>
  values.flatMap((value, index) => (value > 0 ? [{ time: plus(start, index * 300), value }] : []));
const day31 = { year: 2026, month: 10, day: 31 };

/** 23:00–01:00 on the 30th to 31st: 10 min awake, 40 light, 30 deep, 10 awake, 30 REM. */
function night(): SleepNight {
  const bed = at(30, 23, 0);
  return {
    day: day31, totalMinutes: 100, deepMinutes: 30, lightMinutes: 40, remMinutes: 30, awakeMinutes: 20, bedtime: bed, wakeTime: at(31, 1, 0),
    stages: [span(bed, 10, "awake"), span(plus(bed, 600), 40, "light"), span(plus(bed, 3000), 30, "deep"), span(plus(bed, 4800), 10, "awake"), span(plus(bed, 5400), 30, "rem")],
  };
}

describe("sleep stress", () => {
  it("counts only readings while asleep", () => {
    const samples = readings(at(30, 22, 54, 10), [90, 0, 60, 70, 20, 22, 0, 18, 24, 16, 30, 12, 10, 8, 11, 9, 14, 13, 77, 55, 26, 40, 31, 25, 33, 28, 95]);
    const stress = sleepStress(night(), samples)!;
    expect(stress.start).toEqual(at(30, 23, 4, 10));
    expect(stress.readings).toEqual([60, 70, 20, 22, 0, 18, 24, 16, 30, 12, 10, 8, 11, 9, 14, 13, 77, 55, 26, 40, 31, 25, 33, 28]);
    expect(measuredReadings(stress)).toBe(23);
    expect(asleepReadings(stress)).toBe(19);
    expect(stress.average).toBe(21); // 390 over 19 readings
    expect(stress.peak).toBe(40); // 77 came while awake, 95 after waking
    expect(stress.peakTime).toEqual(at(31, 0, 39, 10));
    expect(stress.levels).toEqual([13, 6, 0, 0]);
    expect(stressShare(stress, 0)).toBeCloseTo(13 / 19, 9);
    expect(stress.light).toBe(20); // 142 over 7
    expect(stress.deep).toBe(11); // 65 over 6
    expect(stress.rem).toBe(31); // 183 over 6, rounded up
    expect(stressSamplesOf(stress).length).toBe(23);
    expect(stressSamplesOf(stress)[4].time).toEqual(at(30, 23, 29, 10));
  });

  it("counts bedtime to wake time for a night without stages", () => {
    const stress = sleepStress({ ...night(), stages: undefined }, readings(at(30, 23, 4, 10), [60, 20, 30]))!;
    expect(stress.average).toBe(37);
    expect(stress.peak).toBe(60);
    expect(stress.levels).toEqual([1, 1, 1, 0]);
    expect(stress.deep).toBeUndefined();
  });

  it("counts only a broken night's sleeps", () => {
    const pieces = [{ start: at(31, 1, 0), end: at(31, 2, 0), asleepMinutes: 60 }, { start: at(31, 4, 0), end: at(31, 5, 0), asleepMinutes: 60 }];
    const broken: SleepNight = { day: day31, totalMinutes: 120, bedtime: at(31, 1, 0), wakeTime: at(31, 5, 0), pieces };
    const samples = [{ time: at(31, 1, 29, 50), value: 20 }, { time: at(31, 3, 0, 0), value: 80 }, { time: at(31, 4, 29, 50), value: 30 }];
    const stress = sleepStress(broken, samples)!;
    expect(stress.average).toBe(25);
    expect(stress.peak).toBe(30);
    expect(stress.readings.length).toBe(37); // 01:29:50 to 04:29:50 in 5-minute steps
    expect(measuredReadings(stress)).toBe(2);
  });

  it("is nothing without readings while asleep", () => {
    expect(sleepStress(night(), [])).toBeUndefined();
    expect(sleepStress(night(), readings(at(30, 23, 1, 0), [50, 50]))).toBeUndefined(); // both in the first awake stretch
    expect(sleepStress(night(), readings(at(30, 23, 30, 0), [0]))).toBeUndefined();
    expect(sleepStress({ day: day31, totalMinutes: 400 }, readings(at(30, 23, 30, 0), [20]))).toBeUndefined(); // no bedtime
    expect(sleepStress(night(), [{ time: at(30, 23, 30, 0), value: 0 }])).toBeUndefined(); // 0 isn't a reading
  });

  it("takes the first of equal readings as the peak", () => {
    const stress = sleepStress(night(), readings(at(30, 23, 14, 10), [20, 35, 35, 10]))!;
    expect(stress.peak).toBe(35);
    expect(stress.peakTime).toEqual(at(30, 23, 19, 10));
  });

  it("keeps a night's stress through merges", () => {
    const samples = readings(at(30, 23, 14, 10), [20, 22, 18, 24, 16]);
    const read = withSleepStress(newInsights(at(31, 8, 0), { nights: [night()], stressSamples: samples }));
    const kept = read.nights[0].stress!;
    expect(measuredReadings(kept)).toBe(5);
    // Two days on, the phone no longer has the readings.
    read.stressSamples = [];

    // The night again without stress or readings: it keeps the stress it had.
    const again = newInsights(at(31, 9, 0), { nights: [night()] });
    expect(mergedOver(again, read, utcCalendar).nights[0].stress).toEqual(kept);
    // Fewer of its readings than it was worked out from: the fuller stress stays.
    const fewer = newInsights(at(31, 9, 0), { nights: [night()], stressSamples: samples.slice(0, 2) });
    expect(mergedOver(fewer, read, utcCalendar).nights[0].stress).toEqual(kept);
    // More of them: worked out again.
    const more = newInsights(at(31, 9, 0), { nights: [night()], stressSamples: [...samples, ...readings(at(30, 23, 39, 10), [30])] });
    expect(measuredReadings(mergedOver(more, read, utcCalendar).nights[0].stress!)).toBe(6);
    // A different night that day doesn't take it.
    const other = { ...night(), bedtime: at(31, 3, 0), wakeTime: at(31, 9, 0), stages: undefined };
    expect(mergedOver(newInsights(at(31, 9, 0), { nights: [other] }), read, utcCalendar).nights[0].stress).toBeUndefined();
  });

  it("keeps the night's stress after the watch's file starts again", () => {
    const writer = new DailyHistoryWriter();
    writer.zone(at(30, 22, 0), 0);
    // Readings every 5 minutes from 22:44:50 to 06:59:50, all through the night.
    for (let time = at(30, 22, 44, 50), step = 0; time < at(31, 7, 0); time = plus(time, 300), step++) writer.stress(time, 0, 12 + (step % 9), 1);
    writer.sleepStatus(at(30, 23, 0), 0xfa);
    writer.sleepStatus(at(30, 23, 0), 3);
    writer.sleepStatus(at(31, 1, 0), 4);
    writer.sleepStatus(at(31, 3, 0), 1);
    writer.sleepStatus(at(31, 3, 20), 5);
    writer.sleepStatus(at(31, 6, 30), 0xfb);
    const health = newWatchHealth();
    recordDailyHistory(health, parseDailyHistory(writer.pages()), undefined, at(31, 7, 0), utcCalendar);
    const stress = health.insights.nights.find((n) => dayKey(n.day) === dayKey(day31))!.stress!;
    // 23:04:50 to 06:29:50: 90 readings, the four in 03:00–03:20 awake.
    expect(measuredReadings(stress)).toBe(90);
    expect(asleepReadings(stress)).toBe(86);
    expect(stress.start).toEqual(at(30, 23, 4, 50));
    expect(stress.levels).toEqual([86, 0, 0, 0]);
    expect([stress.deep, stress.light, stress.rem].every((v) => v !== undefined)).toBe(true);

    // The COROS app synced at noon: the file starts again with an afternoon of readings and no night.
    const later = new DailyHistoryWriter();
    later.zone(at(31, 12, 0), 0);
    later.stress(at(31, 12, 4, 50), 0, 40, 2);
    recordDailyHistory(health, parseDailyHistory(later.pages()), undefined, at(31, 13, 0), utcCalendar);
    expect(health.insights.nights.find((n) => dayKey(n.day) === dayKey(day31))?.stress).toEqual(stress);
  });

  it("joins the rest of a night after the file starts again", () => {
    const first = new DailyHistoryWriter();
    first.zone(at(31, 0, 0), 0);
    first.sleepStatus(at(31, 1, 0), 0xfa);
    first.sleepStatus(at(31, 1, 0), 3);
    first.sleepStatus(at(31, 2, 0), 4);
    first.sleepStatus(at(31, 4, 0), 5);
    first.sleepStatus(at(31, 5, 30), 0xfb);
    const health = newWatchHealth();
    recordDailyHistory(health, parseDailyHistory(first.pages()), undefined, at(31, 5, 35), utcCalendar);
    const find = () => health.insights.nights.find((n) => dayKey(n.day) === dayKey(day31))!;
    expect(find().bedtime).toEqual(at(31, 1, 0));

    const rest = new DailyHistoryWriter();
    rest.zone(at(31, 5, 40), 0);
    rest.sleepStatus(at(31, 5, 45), 0xfa);
    rest.sleepStatus(at(31, 5, 45), 3);
    rest.sleepStatus(at(31, 7, 0), 5);
    rest.sleepStatus(at(31, 9, 0), 0xfb);
    recordDailyHistory(health, parseDailyHistory(rest.pages()), undefined, at(31, 9, 5), utcCalendar);
    const joined = find();
    expect(joined.bedtime).toEqual(at(31, 1, 0));
    expect(joined.wakeTime).toEqual(at(31, 9, 0));
    expect(joined.totalMinutes).toBe(270 + 195);
    expect(joined.awakeMinutes).toBe(15);
    const stages = joined.stages!;
    expect(stages[0].start).toEqual(at(31, 1, 0));
    expect(stages.at(-1)?.end).toEqual(at(31, 9, 0));
    expect(stages.some((s) => s.stage === "awake" && s.start.getTime() === at(31, 5, 30).getTime() && s.end.getTime() === at(31, 5, 45).getTime())).toBe(true);
    expect(health.insights.days.find((d) => dayKey(d.day) === dayKey(day31))?.sleepMinutes).toBe(465);
  });

  it("gives a night without the watch's stages its stress from the readings", () => {
    const answer = newInsights(at(31, 9, 0), { nights: [{ ...night(), stages: undefined }], stressSamples: readings(at(30, 23, 4, 10), [30, 20]) });
    expect(mergedOver(answer, newInsights(at(31, 8, 0)), utcCalendar).nights[0].stress?.average).toBe(25);
  });

  it("decodes old saved nights without stress, and round-trips with it", () => {
    const old = decodeSleepNight(JSON.parse(`{"day":{"year":2026,"month":10,"day":31},"totalMinutes":400}`));
    expect(old.stress).toBeUndefined();
    const withStress = withSleepStress(newInsights(new Date(), { nights: [night()], stressSamples: readings(at(30, 23, 14, 10), [20]) })).nights[0];
    expect(withStress.stress).toBeDefined();
    expect(decodeSleepNight(JSON.parse(JSON.stringify(encodeSleepNight(withStress))))).toEqual(withStress);
  });
});
