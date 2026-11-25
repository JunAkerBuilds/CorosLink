// CorosKit's WatchDataTests for WatchHealth (insights from the daily history, the sleep rules, naps, resting heart
// rate, the profile's heart rates), ported. The parts that check `filling` (merging with COROS's own insights) aren't:
// the desktop has no COROS insights to fill.
import { describe, expect, it } from "vitest";
import { type DailyHistory, type SleepSegment, parseDailyHistory } from "./dailyHistory";
import { DailyHistoryWriter, syntheticDaily } from "./fixtures/healthWriter";
import {
  type SleepNight, dayMinutes, isBroken, isNapsOnly, lastNight, latestNight, longestPieceMinutes, napPoints, nightPoints, utcCalendar,
} from "./insights";
import { type CalendarDay, dayKey, utcCalendarDay } from "./native";
import {
  type SleepProfile, defaultSleepProfile, insightsFromHistory, newWatchHealth, recordDailyHistory, recordProfile, restingHeartRate,
  scheduleContains,
} from "./watchHealth";

const day = (year: number, month: number, d: number): CalendarDay => ({ year, month, day: d });
/** 2026-10-`d` at `h`:`m` UTC. */
const at = (d: number, h: number, m: number): Date => new Date(Date.UTC(2026, 9, d, h, m));
const oct = (d: number): CalendarDay => day(2026, 10, d);
const findDay = <T extends { day: CalendarDay }>(items: T[], d: CalendarDay): T | undefined => items.find((i) => dayKey(i.day) === dayKey(d));

/** A segment in UTC: `asleep` minutes of light sleep (all of it by default), then awake. */
function segment(start: Date, end: Date, asleep?: number, score?: number): SleepSegment {
  const minutes = Math.trunc((end.getTime() - start.getTime()) / 60_000), light = asleep ?? minutes;
  const ranges: SleepSegment["ranges"] = [{ offset: 0, seconds: light * 60, stage: "light" }];
  if (light < minutes) ranges.push({ offset: light * 60, seconds: (minutes - light) * 60, stage: "awake" });
  return {
    start, end, utcOffsetMinutes: 0, day: utcCalendarDay(end), totalMinutes: minutes, stageMinutes: { light, awake: minutes - light },
    awakeCount: light < minutes ? 1 : 0, ranges, score,
  };
}

function history(sleeps: SleepSegment[], calories: [Date, number][] = []): DailyHistory {
  const writer = new DailyHistoryWriter();
  writer.zone(at(1, 0, 0), 0);
  const read = parseDailyHistory(writer.pages());
  read.sleeps = sleeps;
  read.calories = calories.map(([time, kcal]) => ({ time, smallCalories: kcal * 1000 }));
  return read;
}

function nights(read: DailyHistory, profile: SleepProfile = defaultSleepProfile()): Map<number, SleepNight> {
  return new Map(insightsFromHistory(read, profile, at(30, 0, 0)).nights.map((n) => [dayKey(n.day), n]));
}

describe("watch health", () => {
  it("becomes training insights", () => {
    const health = newWatchHealth();
    recordDailyHistory(health, parseDailyHistory(syntheticDaily().file), undefined, new Date(1_767_330_000_000), utcCalendar);
    const day2 = day(2026, 1, 2);
    const night = findDay(health.insights.nights, day2)!;
    // Two segments, 23:00–06:30 and 06:40–07:13; the gap counts as awake.
    expect(night.bedtime).toEqual(new Date(1_767_283_200_000)); // 2026-01-01 23:00 at UTC+7
    expect(night.wakeTime).toEqual(new Date((1_767_283_200 + 8 * 3600 + 13 * 60) * 1000));
    expect(night.awakeMinutes).toBe(8 * 60 + 13 - (night.totalMinutes ?? 0));
    expect(night.score).toBe(62); // the summary of the night's first segment
    // Each stage when it came, across both segments, the gap between them awake.
    const stages = night.stages!;
    expect(stages[0].start).toEqual(night.bedtime);
    expect(stages[stages.length - 1].end).toEqual(night.wakeTime);
    expect(stages.map((s) => s.stage)).toEqual(["awake", "light", "deep", "rem", "awake", "light", "awake", "light"]);
    expect(stages.slice(1).every((s, i) => s.start.getTime() === stages[i].end.getTime())).toBe(true); // no holes or overlaps
    const gap = stages[6];
    expect(gap.end.getTime() - gap.start.getTime()).toBe(13 * 60_000); // 06:30 to 06:43
    const vitals = findDay(health.insights.days, day2)!;
    expect(vitals.steps).toBe(400);
    expect(vitals.hrv).toBe(35);
    expect(vitals.sleepMinutes).toBe(night.totalMinutes);
    expect(vitals.sleepScore).toBe(62);
    expect(vitals.restingHR).toBeDefined(); // over 3 hours asleep with per-minute readings
    expect(health.insights.healthChecks.map((c) => c.spo2)).toEqual([97]);
    expect(health.insights.days[0].stress).toBe(52);

    // A later file after the COROS app synced: day 1 is gone from the watch, so it stays as read; a lower partial count never wins.
    const later = new DailyHistoryWriter();
    later.zone(new Date(1_767_330_000_000), 28);
    later.activity(new Date(1_767_330_000_000), new Date(1_767_330_300_000), 50, 1000);
    recordDailyHistory(health, parseDailyHistory(later.pages()), undefined, new Date(1_767_340_000_000), utcCalendar);
    expect(findDay(health.insights.days, day2)?.steps).toBe(400);
    expect(findDay(health.insights.days, day(2026, 1, 1))?.steps).toBe(160);
  });

  it("keeps the heart rates from the watch's training profile", () => {
    const health = newWatchHealth();
    recordProfile(health, { maxHR: 0, thresholdHR: 0, ftp: 0 });
    expect(health.insights.fitness).toBeUndefined(); // a profile without heart rates adds nothing
    recordProfile(health, { maxHR: 196, thresholdHR: 171, ftp: 0 });
    expect(health.insights.fitness).toEqual({ thresholdHR: 171, maxHR: 196, predictions: [] });
  });

  it("counts exercise time from the watch", () => {
    const writer = new DailyHistoryWriter();
    const start = new Date(1_767_312_000_000); // 2026-01-02 00:00 UTC
    for (const [minute, secs] of [[0, 300], [5, 300], [10, 240], [15, 60], [20, 0]]) {
      writer.activity(new Date(start.getTime() + minute * 60_000), new Date(start.getTime() + (minute + 5) * 60_000), 10, 1000, secs);
    }
    const health = newWatchHealth();
    recordDailyHistory(health, parseDailyHistory(writer.pages()), undefined, new Date(start.getTime() + 3600_000), utcCalendar);
    expect(findDay(health.insights.days, day(2026, 1, 2))?.exerciseMinutes).toBe(15);
  });
});

describe("main sleep and naps", () => {
  /** A real morning (2026-10-23): 00:40–04:58, then 07:34–09:00, which COROS logs as a nap. */
  it("takes the day's first sleep of three hours as the main one, the rest as naps", () => {
    const read = history([segment(at(23, 0, 40), at(23, 4, 58), 252, 50), segment(at(23, 7, 34), at(23, 9, 0), 78, 68)]);
    read.hrv = [at(23, 2, 0), at(23, 8, 0)].map((time, index) => ({ time, utcOffsetMinutes: 0, status: 4, rmssd: index === 0 ? 40 : 90, heartRate: 0, breathingRate: 0 }));
    const insights = insightsFromHistory(read, undefined, at(23, 10, 0));
    const night = insights.nights[0];
    expect(insights.nights.length).toBe(1);
    expect(night.day).toEqual(oct(23));
    expect([night.bedtime, night.wakeTime]).toEqual([at(23, 0, 40), at(23, 4, 58)]); // 2 h 36 min apart: they don't join
    expect(night.totalMinutes).toBe(252);
    expect(night.napMinutes).toBe(78);
    expect(night.stages?.at(-1)?.end).toEqual(at(23, 4, 58));
    expect(night.score).toBe(68); // the watch's score counts the nap's sleep
    expect(night.nightScore).toBe(50);
    expect(night.naps?.map((n) => ({ start: n.start, end: n.end, asleepMinutes: n.asleepMinutes, points: n.points })))
      .toEqual([{ start: at(23, 7, 34), end: at(23, 9, 0), asleepMinutes: 78, points: 18 }]); // the 18 points COROS shows
    expect(night.naps?.[0].stages?.[0].start).toEqual(at(23, 7, 34)); // each nap has its stages
    expect(nightPoints(night)).toBe(night.nightScore);
    expect(napPoints(night)).toBe(18);
    expect(insights.days[0].hrv).toBe(40); // sleep HRV from the main sleep only

    // Exactly 3 hours, start to end, is a main sleep; the first to end wins, not the longest.
    const three = history([segment(at(10, 23, 0), at(11, 2, 0), 170), segment(at(11, 4, 0), at(11, 9, 0))]);
    const night11 = nights(three).get(dayKey(oct(11)))!;
    expect([night11.bedtime, night11.wakeTime]).toEqual([at(10, 23, 0), at(11, 2, 0)]);
    expect([night11.totalMinutes, night11.napMinutes]).toEqual([170, 300]);
    // Under 15 minutes is no nap at all.
    const short = history([segment(at(20, 23, 0), at(21, 7, 0)), segment(at(21, 14, 0), at(21, 14, 14)), segment(at(21, 16, 0), at(21, 16, 15))]);
    expect(nights(short).get(dayKey(oct(21)))?.napMinutes).toBe(15);
  });

  it("gives each nap the points from the watch's summaries", () => {
    const night = segment(at(20, 23, 0), at(21, 7, 0), undefined, 60);
    const first = segment(at(21, 13, 0), at(21, 13, 30), undefined, 66), last = segment(at(21, 18, 0), at(21, 18, 20), undefined, 70);
    const two = nights(history([night, first, last])).get(dayKey(oct(21)))!;
    expect([two.score, two.nightScore]).toEqual([70, 60]);
    expect(two.naps?.map((n) => n.points)).toEqual([6, 4]);
    expect(napPoints(two)).toBe(10);
    // A nap without a summary leaves its points, and the next nap's, unknown: no split.
    const missing = nights(history([night, first, segment(at(21, 16, 0), at(21, 16, 40)), last])).get(dayKey(oct(21)))!;
    expect(missing.naps?.map((n) => n.points)).toEqual([6, undefined, undefined]);
    expect(missing.score).toBe(70);
    expect(napPoints(missing)).toBeUndefined();
  });

  /** The COROS app synced after the night, so the watch's new file has only the day's naps (2026-11-06 on a PACE Pro). */
  it("joins naps read after the file starts again to the night read before", () => {
    const night = segment(at(21, 0, 10), at(21, 4, 57), undefined, 78);
    const first = segment(at(21, 12, 5), at(21, 13, 7)), second = segment(at(21, 14, 10), at(21, 15, 50));
    const health = newWatchHealth();
    recordDailyHistory(health, history([night, first]), undefined, at(21, 13, 30), utcCalendar);
    recordDailyHistory(health, history([first, second]), undefined, at(21, 16, 0), utcCalendar);
    const kept = findDay(health.insights.nights, oct(21))!;
    expect([kept.bedtime, kept.wakeTime]).toEqual([at(21, 0, 10), at(21, 4, 57)]);
    expect(kept.stages?.at(-1)?.end).toEqual(at(21, 4, 57)); // the night keeps its stages
    expect(kept.score).toBe(78);
    expect(kept.naps?.map((n) => n.start)).toEqual([at(21, 12, 5), at(21, 14, 10)]);
    expect(kept.napMinutes).toBe(kept.naps?.reduce((sum, n) => sum + n.asleepMinutes, 0));

    // A day of naps alone, with no night read before, stays naps alone.
    const fresh = newWatchHealth();
    recordDailyHistory(fresh, history([first, second]), undefined, at(21, 16, 0), utcCalendar);
    expect(isNapsOnly(findDay(fresh.insights.nights, oct(21))!)).toBe(true);
  });

  it("joins a morning nap read after the file starts again to the night, with its points", () => {
    const night = segment(at(21, 0, 10), at(21, 4, 57), undefined, 78);
    const morning = segment(at(21, 10, 0), at(21, 10, 40), undefined, 80);
    const afternoon = segment(at(21, 14, 10), at(21, 15, 50), undefined, 84);
    const health = newWatchHealth();
    recordDailyHistory(health, history([night]), undefined, at(21, 7, 0), utcCalendar);
    recordDailyHistory(health, history([morning, afternoon]), undefined, at(21, 16, 0), utcCalendar);
    const kept = findDay(health.insights.nights, oct(21))!;
    expect([kept.bedtime, kept.wakeTime]).toEqual([at(21, 0, 10), at(21, 4, 57)]);
    expect(kept.stages?.at(-1)?.end).toEqual(at(21, 4, 57));
    expect(kept.pieces).toBeUndefined();
    expect(kept.naps?.map((n) => n.start)).toEqual([at(21, 10, 0), at(21, 14, 10)]);
    expect(kept.naps?.map((n) => n.points)).toEqual([2, 4]);
    expect([kept.score, kept.nightScore, napPoints(kept)]).toEqual([84, 78, 6]);
    expect(findDay(health.insights.days, oct(21))?.sleepScore).toBe(84);
  });

  it("joins sleeps up to an hour apart unless you were active in between", () => {
    const first = segment(at(10, 23, 0), at(11, 1, 0)), second = segment(at(11, 1, 40), at(11, 6, 30));
    const key = dayKey(oct(11));
    const joined = nights(history([first, second])).get(key)!;
    expect([joined.bedtime, joined.wakeTime]).toEqual([at(10, 23, 0), at(11, 6, 30)]); // 40 minutes apart and still
    expect(joined.awakeMinutes).toBe(40);
    expect(joined.napMinutes).toBeUndefined();

    // 40 minutes apart the limit is 0.6 kcal per kg: 36 kcal at the watch's default 60 kg.
    const active = history([first, second], [[at(11, 1, 10), 20], [at(11, 1, 15), 17]]);
    const apart = nights(active).get(key)!;
    expect([apart.bedtime, apart.wakeTime]).toEqual([at(11, 1, 40), at(11, 6, 30)]);
    expect(apart.napMinutes).toBe(120);
    expect(nights(history([first, second], [[at(11, 1, 10), 36]])).get(key)?.bedtime).toEqual(at(10, 23, 0)); // at the limit
    expect(nights(active, { weightKg: 80 }).get(key)?.bedtime).toEqual(at(10, 23, 0)); // 0.46 kcal per kg at 80 kg
    const outside = history([first, second], [[at(11, 0, 55), 99], [at(11, 1, 45), 99]]);
    expect(nights(outside).get(key)?.bedtime).toEqual(at(10, 23, 0)); // only what was burned between them counts

    // Under 15 minutes apart they join whatever you did; over an hour apart they don't.
    const brief = history([first, segment(at(11, 1, 14), at(11, 6, 30))], [[at(11, 1, 5), 500]]);
    expect(nights(brief).get(key)?.bedtime).toEqual(at(10, 23, 0));
    expect(nights(history([first, segment(at(11, 2, 0), at(11, 6, 30))])).get(key)?.bedtime).toEqual(at(10, 23, 0)); // an hour apart, still
    expect(nights(history([first, segment(at(11, 2, 1), at(11, 6, 30))])).get(key)?.bedtime).toEqual(at(11, 2, 1));
  });

  it("joins sleeps up to two hours apart inside the sleep schedule", () => {
    const broken = history([segment(at(11, 23, 0), at(12, 1, 30)), segment(at(12, 3, 0), at(12, 5, 30))], [[at(12, 2, 0), 300]]);
    const key = dayKey(oct(12));
    const unscheduled = nights(broken).get(key)!;
    expect(unscheduled.score).toBeUndefined(); // two 2.5-hour sleeps a night: no main sleep
    expect(unscheduled.pieces?.length).toBe(2);
    expect(unscheduled.totalMinutes).toBe(300);
    const scheduled = nights(broken, { weightKg: 60, schedule: { bedtime: 22 * 60, wake: 7 * 60 } }).get(key)!;
    expect([scheduled.bedtime, scheduled.wakeTime]).toEqual([at(11, 23, 0), at(12, 5, 30)]); // and calories don't matter here
    expect(scheduled.totalMinutes).toBe(300);
    expect(isBroken(nights(broken, { weightKg: 60, schedule: { bedtime: 2 * 60, wake: 7 * 60 } }).get(key)!)).toBe(true); // ends before Sleep Time
    expect(isBroken(nights(broken, { weightKg: 60, schedule: { bedtime: 22 * 60, wake: 2 * 60 + 30 } }).get(key)!)).toBe(true); // starts after Wake Time
    expect(isBroken(scheduled)).toBe(false);
    const long = history([segment(at(11, 22, 0), at(12, 4, 0)), segment(at(12, 5, 30), at(12, 7, 0))]);
    const apart = nights(long, { weightKg: 60, schedule: { bedtime: 21 * 60, wake: 8 * 60 } }).get(key)!;
    expect([apart.bedtime, apart.wakeTime]).toEqual([at(11, 22, 0), at(12, 4, 0)]); // the first lasted 6 hours
    expect(apart.napMinutes).toBe(90);
  });

  it("reads a sleep schedule across midnight", () => {
    const schedule = { bedtime: 22 * 60, wake: 7 * 60 };
    expect(scheduleContains(schedule, at(1, 22, 0), 0)).toBe(true);
    expect(scheduleContains(schedule, at(2, 6, 59), 0)).toBe(true);
    expect(scheduleContains(schedule, at(2, 7, 0), 0)).toBe(false);
    expect(scheduleContains(schedule, at(1, 21, 59), 0)).toBe(false);
    expect(scheduleContains(schedule, at(2, 15, 0), 0)).toBe(false);
    expect(scheduleContains(schedule, at(2, 3, 0), -240)).toBe(true); // 23:00 at UTC−4
    expect(scheduleContains({ bedtime: 60, wake: 9 * 60 }, at(2, 8, 0), 0)).toBe(true);
    const same = { bedtime: 23 * 60, wake: 23 * 60 };
    expect(scheduleContains(same, at(2, 6, 59), 0)).toBe(true); // starting and ending at once: 8 hours
    expect(scheduleContains(same, at(2, 7, 0), 0)).toBe(false);
  });

  /** 2026-10-27 on a PACE Pro: 2 h 59 min, up for 2 h 38 min, then 1 h 40 min. */
  it("takes a broken night as the night", () => {
    const read = history([segment(at(27, 0, 43), at(27, 3, 42), 159), segment(at(27, 6, 20), at(27, 8, 0), 93), segment(at(27, 14, 0), at(27, 14, 30))]);
    const health = newWatchHealth();
    recordDailyHistory(health, read, undefined, at(27, 15, 0), utcCalendar);
    const night = health.insights.nights.at(-1)!;
    expect(night.day).toEqual(oct(27));
    expect(night.score).toBeUndefined();
    expect(isNapsOnly(night)).toBe(false);
    expect(isBroken(night)).toBe(true);
    expect(night.pieces?.map((p) => p.asleepMinutes)).toEqual([159, 93]);
    expect(longestPieceMinutes(night)).toBe(179);
    expect([night.bedtime, night.wakeTime]).toEqual([at(27, 0, 43), at(27, 8, 0)]);
    expect(night.totalMinutes).toBe(252);
    expect(night.awakeMinutes).toBe(27); // awake inside the sleeps, not the time between them
    expect(night.stages?.find((s) => s.start >= at(27, 3, 42))?.start).toEqual(at(27, 6, 20)); // nothing drawn between them
    expect(night.napMinutes).toBe(30);
    expect(dayMinutes(night)).toBe(282);
    expect(night.naps?.map((n) => n.start)).toEqual([at(27, 14, 0)]);
    expect(latestNight(health.insights)?.day).toEqual(night.day);
    expect(findDay(health.insights.days, night.day)?.sleepMinutes).toBe(252);
  });

  it("keeps a day of naps alone", () => {
    const read = history([segment(at(20, 23, 0), at(21, 7, 0)), segment(at(21, 15, 0), at(21, 15, 30)), segment(at(22, 14, 0), at(22, 14, 45), 40)]);
    const health = newWatchHealth();
    recordDailyHistory(health, read, undefined, at(22, 15, 0), utcCalendar);
    const all = health.insights.nights;
    expect(all.map((n) => n.day)).toEqual([oct(21), oct(22)]);
    expect(all.map((n) => n.napMinutes)).toEqual([30, 40]);
    expect(isNapsOnly(all[1])).toBe(true);
    expect(all[1].naps?.map((n) => ({ start: n.start, end: n.end, asleepMinutes: n.asleepMinutes, points: n.points })))
      .toEqual([{ start: at(22, 14, 0), end: at(22, 14, 45), asleepMinutes: 40, points: undefined }]); // no main sleep, no points
    expect(all[1].naps?.[0].stages?.map((s) => s.stage)).toEqual(["light", "awake"]);
    expect(napPoints(all[1])).toBeUndefined();
    expect(latestNight(health.insights)?.day).toEqual(all[0].day); // a day of naps isn't the latest night
    expect(lastNight(health.insights)?.day).toEqual(all[0].day);
    expect(findDay(health.insights.days, all[1].day)?.sleepMinutes).toBeUndefined();
  });

  /** 20:00–23:20 then 00:30–06:30: 70 minutes apart, so one night only inside the sleep schedule. */
  it("takes the watch's profile into the sleep rules", () => {
    const read = history([segment(at(11, 20, 0), at(11, 23, 20)), segment(at(12, 0, 30), at(12, 6, 30))]);
    const health = newWatchHealth();
    recordDailyHistory(health, read, undefined, at(12, 8, 0), utcCalendar);
    expect(health.sleepProfile).toEqual(defaultSleepProfile());
    expect(health.insights.nights.map((n) => n.day)).toEqual([oct(11), oct(12)]);
    expect(findDay(health.insights.days, oct(11))?.sleepMinutes).toBe(200);

    const profile = { weightKg: 75, schedule: { bedtime: 22 * 60, wake: 7 * 60 } };
    recordDailyHistory(health, read, profile, at(12, 8, 5), utcCalendar);
    expect(health.sleepProfile).toEqual(profile);
    expect(health.insights.nights.map((n) => n.day)).toEqual([oct(12)]); // day 11's sleep is now the start of day 12's night
    expect([health.insights.nights[0].bedtime, health.insights.nights[0].wakeTime]).toEqual([at(11, 20, 0), at(12, 6, 30)]);
    expect(findDay(health.insights.days, oct(11))?.sleepMinutes).toBeUndefined();
    expect(findDay(health.insights.days, oct(12))?.sleepMinutes).toBe(560);
  });

  it("works out resting heart rate without dropouts and with enough readings", () => {
    const start = new Date(1_767_283_200_000);
    const end = new Date(start.getTime() + 6 * 3600_000);
    const readings = Array.from({ length: 6 * 60 }, (_, minute) => ({
      time: new Date(start.getTime() + minute * 60_000), bpm: minute >= 120 && minute < 150 ? 46 : 55, automatic: true, utcOffsetMinutes: 0,
    }));
    expect(restingHeartRate(start, end, readings)).toBe(46);
    readings[200].bpm = 20; // below 30 bpm: never counted
    readings[300].bpm = 38; // an optical dropout, 17 below its neighbours
    expect(restingHeartRate(start, end, readings)).toBe(46);
    expect(restingHeartRate(start, end, readings.filter((_, i) => i % 3 === 0))).toBe(46); // measuring every 3 minutes
    expect(restingHeartRate(start, end, readings.slice(0, 20))).toBeUndefined();
  });
});
