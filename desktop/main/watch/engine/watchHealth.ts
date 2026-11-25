// Daily health read from the watch and kept between syncs (health.json). A port of CorosKit's WatchData/WatchHealth.swift
// (WatchHealth, SleepProfile, SleepSchedule, SleepRules, RestingHeartRate, SleepNight.joining/adding) and
// PedometerTotals from WatchData/WatchSyncFile.swift.
import { CorosError, u32 } from "./bytes";
import {
  type DailyHistory, type HeartRateReading, type SleepSegment, asleepMinutes, forecastRound, stageMinutes,
} from "./dailyHistory";
import {
  type DayVitals, type Fitness, type HealthCalendar, type Nap, type SleepNight, type SleepSpan, type TrainingInsights,
  date, decodeDay, decodeInsights, encodeDay, encodeInsights, isBroken, isEmptyInsights, isNapsOnly, localCalendar, mergedOver,
  newInsights, num, obj, swiftRound, tidy, withSleepStress,
} from "./insights";
import { type CalendarDay, compact, compareDays, dayKey, refSeconds, utcCalendarDay } from "./native";

// MARK: Model

/** Today's running totals, as the watch counted them when last read. */
export interface TodayTotals {
  day: CalendarDay;
  steps: number;
  distanceMeters: number;
  /** Active kilocalories. */
  calories: number;
  activeSeconds?: number;
  readAt: Date;
}

/** The sleep schedule set in the COROS app (Sleep Time to Wake Time), in local minutes after midnight. */
export interface SleepSchedule { bedtime: number; wake: number }

/** What the watch's sleep rules take from the profile the COROS app writes to it. */
export interface SleepProfile { weightKg: number; schedule?: SleepSchedule }

export interface WatchHealth {
  syncedAt: Date;
  insights: TrainingInsights;
  today?: TodayTotals;
  /** What the sleep rules took from the watch's profile when a daily history was last recorded. */
  sleepProfile?: SleepProfile;
}

/** Swift's Date.distantPast, the syncedAt of a WatchHealth never synced. */
export const DISTANT_PAST = new Date((-63_114_076_800 + 978_307_200) * 1000);

export function newWatchHealth(syncedAt: Date = DISTANT_PAST): WatchHealth {
  return { syncedAt, insights: newInsights(syncedAt) };
}

export const isEmptyHealth = (health: WatchHealth): boolean => isEmptyInsights(health.insights) && !health.today;

const larger = (a: number | undefined, b: number | undefined): number | undefined =>
  (a !== undefined && b !== undefined ? Math.max(a, b) : a ?? b);

// MARK: Sleep profile

/** The weights the firmware keeps; any other is its own 60 kg. */
const WEIGHTS = { min: 11, max: 249 };
const USER_INFO_BYTES = 71;

export const defaultSleepProfile = (): SleepProfile => ({ weightKg: 60 });

/**
 * From a SyncUserInfo block (WatchSettingsFile's userInfo): body weight at byte 1, the sleep schedule at bytes 55–58
 * (Sleep Time hour and minute, Wake Time hour and minute). A schedule whose hours or minutes aren't times is left out.
 */
export function sleepProfileFromUserInfo(userInfo: Uint8Array): SleepProfile {
  const profile = defaultSleepProfile();
  if (userInfo.length !== USER_INFO_BYTES) return profile;
  if (userInfo[1] >= WEIGHTS.min && userInfo[1] <= WEIGHTS.max) profile.weightKg = userInfo[1];
  const [sleepHour, sleepMinute, wakeHour, wakeMinute] = [userInfo[55], userInfo[56], userInfo[57], userInfo[58]];
  if (sleepHour < 24 && wakeHour < 24 && sleepMinute < 60 && wakeMinute < 60) {
    profile.schedule = { bedtime: sleepHour * 60 + sleepMinute, wake: wakeHour * 60 + wakeMinute };
  }
  return profile;
}

/** Whether `time` falls in Sleep Time to Wake Time (one that starts and ends at once lasts 8 hours), as the firmware checks. */
export function scheduleContains(schedule: SleepSchedule, time: Date, utcOffsetMinutes: number): boolean {
  const minute = ((Math.floor(time.getTime() / 60_000) + utcOffsetMinutes) % 1440 + 1440) % 1440;
  const end = schedule.wake === schedule.bedtime ? (schedule.bedtime + 8 * 60) % 1440 : schedule.wake;
  return schedule.bedtime < end ? minute >= schedule.bedtime && minute < end : minute >= schedule.bedtime || minute < end;
}

// MARK: Sleep rules

/** One day's sleeps: its main sleep's segments and each nap's, oldest first. */
export interface SleepDay { day: CalendarDay; main?: SleepSegment[]; naps: SleepSegment[][] }

export const MAIN_LENGTH = 3 * 3600_000;
const SHORTEST_LENGTH = 15 * 60_000;
const FREE_JOIN_GAP = 15 * 60_000;
/** Sleeps up to an hour apart may join. */
export const JOIN_GAP = 3600_000;
const SCHEDULED_JOIN_GAP = 2 * 3600_000;
const SCHEDULED_JOIN_LENGTH = 6 * 3600_000;

const endOf = (sleep: SleepSegment[]): Date => sleep[sleep.length - 1].end;
const lengthOf = (sleep: SleepSegment[]): number => endOf(sleep).getTime() - sleep[0].start.getTime();

/** Each sleep joined onto the one before when `joins` says so, given the gap between them in ms. */
function joined(sleeps: SleepSegment[][], joins: (sleep: SleepSegment[], next: SleepSegment[], gap: number) => boolean): SleepSegment[][] {
  const out: SleepSegment[][] = [];
  for (const sleep of sleeps) {
    const last = out[out.length - 1];
    const gap = last ? sleep[0].start.getTime() - endOf(last).getTime() : -1;
    if (last && gap >= 0 && joins(last, sleep, gap)) out[out.length - 1] = [...last, ...sleep];
    else out.push(sleep);
  }
  return out;
}

/** Active kcal per kg burned from `from` to `to`, by the records that start in that time. */
function caloriesPerKg(history: DailyHistory, from: Date, to: Date, weightKg: number): number {
  const small = history.calories.filter((c) => c.time >= from && c.time <= to).reduce((sum, c) => sum + c.smallCalories, 0);
  return weightKg > 0 ? small / 1000 / weightKg : 0;
}

const calorieLimit = (gap: number): number => (gap < 1_800_000 ? 0.4 : gap <= 2_700_000 ? 0.6 : 0.7);

/**
 * How the watch turns its sleep segments into each day's main sleep and naps (firmware PACE Pro W332 3.2008.0):
 * 1. Sleeps up to an hour apart join: under 15 minutes always, otherwise when the active kcal per kg burned in between
 *    is at most 0.4 (under 30 minutes apart), 0.6 (to 45) or 0.7 (to an hour).
 * 2. A sleep under 15 minutes is dropped.
 * 3. Sleeps up to two hours apart join when the first lasted under 6 hours and its end and the next one's start both
 *    fall in the sleep schedule (skipped without one).
 * 4. A sleep belongs to the day it ends on; the first to end that lasted 3 hours is the main sleep, every other a nap.
 * Keyed by dayKey, in the order the days' first sleeps end.
 */
export function sleepRuleDays(history: DailyHistory, profile: SleepProfile = defaultSleepProfile()): Map<number, SleepDay> {
  let sleeps = joined([...history.sleeps].sort((a, b) => a.start.getTime() - b.start.getTime()).map((s) => [s]), (sleep, next, gap) =>
    gap <= JOIN_GAP && (gap < FREE_JOIN_GAP || caloriesPerKg(history, endOf(sleep), next[0].start, profile.weightKg) <= calorieLimit(gap)));
  sleeps = sleeps.filter((s) => lengthOf(s) >= SHORTEST_LENGTH);
  const schedule = profile.schedule;
  if (schedule) {
    sleeps = joined(sleeps, (sleep, next, gap) =>
      gap <= SCHEDULED_JOIN_GAP && lengthOf(sleep) < SCHEDULED_JOIN_LENGTH &&
      scheduleContains(schedule, endOf(sleep), sleep[sleep.length - 1].utcOffsetMinutes) &&
      scheduleContains(schedule, next[0].start, next[0].utcOffsetMinutes));
  }
  const days = new Map<number, SleepDay>();
  for (const sleep of [...sleeps].sort((a, b) => endOf(a).getTime() - endOf(b).getTime())) {
    const day = sleep[sleep.length - 1].day;
    const entry = days.get(dayKey(day)) ?? { day, naps: [] };
    if (!entry.main && lengthOf(sleep) >= MAIN_LENGTH) entry.main = sleep;
    else entry.naps.push(sleep);
    days.set(dayKey(day), entry);
  }
  return days;
}

// MARK: Resting heart rate

/** A night needs this much sleep for a resting heart rate. */
export const MINIMUM_ASLEEP_MINUTES = 180;
const WINDOW = 30 * 60;
const MINIMUM_COVERAGE = 0.8;
const DIP = 10;
const NEIGHBOURS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.trunc(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Resting heart rate from the watch's own readings: the lowest 30-minute average during the night's main sleep.
 * Per-minute readings only, 30–220 bpm; one 10 bpm below the median of the 5 on each side is a dropout; a window counts
 * with 80% of the readings the night's own interval gives it.
 */
export function restingHeartRate(start: Date, end: Date, readings: HeartRateReading[]): number | undefined {
  const startTs = Math.trunc(start.getTime() / 1000), endTs = Math.trunc(end.getTime() / 1000);
  const byMinute = new Map<number, number>();
  for (const reading of readings) {
    const ts = Math.trunc(reading.time.getTime() / 1000);
    if (ts % 60 === 0 && ts >= startTs && ts <= endTs && reading.bpm >= 30 && reading.bpm <= 220) byMinute.set(ts, reading.bpm);
  }
  const plausible = [...byMinute.entries()].sort((a, b) => a[0] - b[0]);
  if (plausible.length < 2) return undefined;
  const kept = plausible.filter((entry, index) => {
    const around = [
      ...plausible.slice(Math.max(0, index - NEIGHBOURS), index).map((e) => e[1]),
      ...plausible.slice(index + 1, Math.min(plausible.length, index + 1 + NEIGHBOURS)).map((e) => e[1]),
    ];
    return around.length < 4 || entry[1] > median(around) - DIP;
  });
  // The night's reading interval (whole minutes): a watch set to measure less often still gets a value.
  const gaps = plausible.slice(1).map((entry, index) => entry[0] - plausible[index][0]);
  const interval = Math.max(60, forecastRound(median(gaps) / 60) * 60);
  const needed = Math.ceil(Math.max(1, Math.trunc(WINDOW / interval)) * MINIMUM_COVERAGE);
  let lowest: number | undefined;
  let last = 0, sum = 0;
  for (let first = 0; first < kept.length; first++) {
    const from = kept[first][0];
    // The window ends inside the night (its last minute no later than the night's end).
    if (from + WINDOW - 60 > endTs) break;
    while (last < kept.length && kept[last][0] < from + WINDOW) { sum += kept[last][1]; last += 1; }
    const count = last - first;
    if (count >= needed && (lowest === undefined || sum / count < lowest)) lowest = sum / count;
    sum -= kept[first][1];
  }
  return lowest === undefined ? undefined : forecastRound(lowest);
}

// MARK: From the daily history

/** The segments' average heart rate, weighted by their length. */
export function averageHR(segments: SleepSegment[]): number | undefined {
  const rated = segments.filter((s) => s.averageHR !== undefined && s.totalMinutes > 0);
  const minutes = rated.reduce((sum, s) => sum + s.totalMinutes, 0);
  return minutes > 0 ? forecastRound(rated.reduce((sum, s) => sum + s.averageHR! * s.totalMinutes, 0) / minutes) : undefined;
}

/** Whether a sleep ended before noon, on its own clock. */
export function endsBeforeNoon(sleep: SleepSegment[]): boolean {
  const last = sleep[sleep.length - 1];
  const minute = ((Math.floor(last.end.getTime() / 60_000) + last.utcOffsetMinutes) % 1440 + 1440) % 1440;
  return minute < 12 * 60;
}

/** The night's stages in order across its segments; the time between two segments counts as awake. */
export function stagesOf(segments: SleepSegment[]): SleepSpan[] {
  const spans: SleepSpan[] = [];
  for (const segment of segments) {
    const previous = spans[spans.length - 1];
    if (previous && segment.start > previous.end) spans.push({ start: previous.end, end: segment.start, stage: "awake" });
    for (const range of segment.ranges) {
      if (range.seconds <= 0) continue;
      const start = new Date(segment.start.getTime() + range.offset * 1000);
      const end = new Date(start.getTime() + range.seconds * 1000);
      const before = spans[spans.length - 1];
      // Back-to-back stages of the same kind read as one.
      if (before && before.stage === range.stage && before.end.getTime() === start.getTime()) spans[spans.length - 1] = { ...before, end };
      else spans.push({ start, end, stage: range.stage });
    }
  }
  return spans;
}

/**
 * Each nap, with the points it added after the main sleep (`after`: its end and the score as it ended): a nap's points
 * are its summary's score less the one before; a missing summary leaves that nap's points, and the next one's, unknown.
 */
export function napList(naps: SleepSegment[][], after?: { end: Date; score?: number }): Nap[] | undefined {
  let previous = after?.score;
  const list = naps.map((nap): Nap => {
    const end = nap[nap.length - 1].end;
    const score = nap.findLast((s) => s.score !== undefined)?.score;
    let points: number | undefined;
    if (after && end > after.end) {
      if (previous !== undefined && score !== undefined) points = score - previous;
      previous = score;
    }
    return compact({ start: nap[0].start, end, asleepMinutes: nap.reduce((sum, s) => sum + asleepMinutes(s), 0), points, stages: stagesOf(nap) });
  });
  return list.length ? list : undefined;
}

const sum = (segments: SleepSegment[], value: (s: SleepSegment) => number): number => segments.reduce((total, s) => total + value(s), 0);
const minutesBetween = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / 60_000;

/** TrainingInsights from a daily history alone, its sleeps worked out with `profile` (WatchHealth.insights(from:)). */
export function insightsFromHistory(history: DailyHistory, profile: SleepProfile = defaultSleepProfile(), now: Date = new Date()): TrainingInsights {
  const localDay = (time: Date, utcOffsetMinutes: number): CalendarDay => utcCalendarDay(new Date(time.getTime() + utcOffsetMinutes * 60_000));
  const minuteReadings = history.heartRate.filter((r) => Math.trunc(r.time.getTime() / 1000) % 60 === 0 && r.bpm > 0);

  const nights: SleepNight[] = [];
  const resting = new Map<number, number>();
  const sleepHRV = new Map<number, number>();
  for (const { day, main, naps: napSleeps } of sleepRuleDays(history, profile).values()) {
    const naps = napSleeps.flat();
    const napMinutes = sum(naps, asleepMinutes);
    if (!main || main.length === 0) {
      // No sleep lasted 3 hours, so the watch counts them all as naps and scores none. The ones that ended before noon
      // were still the night, broken up: they make the night, without a score.
      const overnight = napSleeps.filter(endsBeforeNoon);
      const daytime = napSleeps.filter((s) => !endsBeforeNoon(s));
      const dayNapMinutes = sum(daytime.flat(), asleepMinutes);
      if (overnight.length === 0) {
        // A day of naps alone keeps them.
        if (napMinutes > 0) nights.push(compact({ day, napMinutes, naps: napList(napSleeps) }));
        continue;
      }
      const first = overnight[0][0], lastSleep = overnight[overnight.length - 1], last = lastSleep[lastSleep.length - 1];
      const segments = overnight.flat();
      const deep = sum(segments, (s) => stageMinutes(s, "deep")), light = sum(segments, (s) => stageMinutes(s, "light"));
      const rem = sum(segments, (s) => stageMinutes(s, "rem"));
      // Awake inside each sleep; the time between them wasn't in bed.
      const inBed = overnight.reduce((total, s) => total + forecastRound(minutesBetween(s[0].start, s[s.length - 1].end)), 0);
      nights.push(compact({
        day, totalMinutes: deep + light + rem, deepMinutes: deep, lightMinutes: light, remMinutes: rem,
        awakeMinutes: Math.max(0, inBed - deep - light - rem), bedtime: first.start, wakeTime: last.end, averageHR: averageHR(segments),
        napMinutes: dayNapMinutes > 0 ? dayNapMinutes : undefined, stages: overnight.flatMap(stagesOf), naps: napList(daytime),
        pieces: napList(overnight),
      }));
      continue;
    }
    const first = main[0], last = main[main.length - 1];
    // The watch's score counts the day's naps too, so it's its latest summary from the main sleep on.
    const score = [...main, ...naps].filter((s) => s.end >= first.start).sort((a, b) => a.end.getTime() - b.end.getTime())
      .findLast((s) => s.score !== undefined)?.score;
    const nightScore = main.findLast((s) => s.score !== undefined)?.score;
    const dayNaps = napList(napSleeps, { end: last.end, score: nightScore });
    const window = forecastRound(minutesBetween(first.start, last.end));
    const deep = sum(main, (s) => stageMinutes(s, "deep")), light = sum(main, (s) => stageMinutes(s, "light"));
    const rem = sum(main, (s) => stageMinutes(s, "rem"));
    nights.push(compact({
      day, totalMinutes: deep + light + rem, score, deepMinutes: deep, lightMinutes: light, remMinutes: rem,
      awakeMinutes: Math.max(0, window - deep - light - rem), bedtime: first.start, wakeTime: last.end, averageHR: averageHR(main),
      napMinutes: napMinutes > 0 ? napMinutes : undefined, stages: stagesOf(main), nightScore, naps: dayNaps,
    }));
    if (deep + light + rem >= MINIMUM_ASLEEP_MINUTES) {
      const value = restingHeartRate(first.start, last.end, minuteReadings);
      if (value !== undefined) resting.set(dayKey(day), value);
    }
    // Sleep HRV: the floored average of the readings taken during the main sleep's segments.
    const readings = history.hrv.filter((r) => r.rmssd > 0 && main.some((s) => r.time >= s.start && r.time <= s.end));
    if (readings.length) sleepHRV.set(dayKey(day), Math.trunc(readings.reduce((total, r) => total + r.rmssd, 0) / readings.length));
  }

  const byDay = new Map<number, DayVitals>();
  const update = (day: CalendarDay, change: (vitals: DayVitals) => void): void => {
    const vitals = byDay.get(dayKey(day)) ?? { day };
    change(vitals);
    byDay.set(dayKey(day), vitals);
  };
  for (const total of history.days) {
    update(total.day, (v) => { v.steps = total.steps; v.calories = total.calories; v.exerciseMinutes = Math.trunc(total.activeSeconds / 60); });
  }
  for (const group of groupBy(minuteReadings, (r) => localDay(r.time, r.utcOffsetMinutes))) {
    update(group.day, (v) => { v.averageHR = forecastRound(group.items.reduce((total, r) => total + r.bpm, 0) / group.items.length); });
  }
  const stressReadings = history.stress.filter((r) => r.stress >= 1 && r.stress <= 100);
  for (const group of groupBy(stressReadings, (r) => localDay(r.time, r.utcOffsetMinutes))) {
    update(group.day, (v) => { v.stress = forecastRound(group.items.reduce((total, r) => total + r.stress, 0) / group.items.length); });
  }
  for (const night of nights) update(night.day, (v) => { v.sleepMinutes = night.totalMinutes; v.sleepScore = night.score; });
  for (const [key, value] of resting) update(dayOfKey(key), (v) => { v.restingHR = value; });
  for (const [key, value] of sleepHRV) update(dayOfKey(key), (v) => { v.hrv = value; });

  // Each night's stress from every reading in the file, before the phone keeps only the latest two days of them.
  return withSleepStress(newInsights(now, {
    days: [...byDay.values()].map((v) => compact({ ...v })).sort((a, b) => compareDays(a.day, b.day)),
    nights: nights.sort((a, b) => compareDays(a.day, b.day)),
    stressSamples: stressReadings.map((r) => ({ time: r.time, value: r.stress })).sort((a, b) => a.time.getTime() - b.time.getTime()),
    healthChecks: history.healthChecks.map((c) => compact({
      time: c.time, heartRate: c.heartRate > 0 ? c.heartRate : undefined, hrv: c.hrv > 0 ? c.hrv : undefined,
      stress: c.stress > 0 ? c.stress : undefined, respiratoryRate: c.breathingRate > 0 ? c.breathingRate : undefined,
      spo2: c.spo2 > 0 ? c.spo2 : undefined,
    })).sort((a, b) => a.time.getTime() - b.time.getTime()),
  }));
}

const dayOfKey = (key: number): CalendarDay => ({ year: Math.trunc(key / 10000), month: Math.trunc(key / 100) % 100, day: key % 100 });

function groupBy<T>(items: T[], day: (item: T) => CalendarDay): { day: CalendarDay; items: T[] }[] {
  const groups = new Map<number, { day: CalendarDay; items: T[] }>();
  for (const item of items) {
    const d = day(item);
    const group = groups.get(dayKey(d)) ?? { day: d, items: [] };
    group.items.push(item);
    groups.set(dayKey(d), group);
  }
  return [...groups.values()];
}

// MARK: A night read in parts (SleepNight.joining / adding)

/**
 * This night with `later`, the rest of it read after the watch's file started again, joined on: one night from this
 * bedtime to that wake time, the time between awake. The score is the later read's.
 */
export function joiningNight(night: SleepNight, later: SleepNight): SleepNight {
  const { bedtime, wakeTime: woke } = night;
  if (!bedtime || !woke || !later.bedtime || !later.wakeTime) return later;
  const add = (a?: number, b?: number): number | undefined => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  const out: SleepNight = { ...later, bedtime };
  out.deepMinutes = add(night.deepMinutes, later.deepMinutes);
  out.lightMinutes = add(night.lightMinutes, later.lightMinutes);
  out.remMinutes = add(night.remMinutes, later.remMinutes);
  out.totalMinutes = add(night.totalMinutes, later.totalMinutes);
  const window = swiftRound(minutesBetween(bedtime, later.wakeTime));
  out.awakeMinutes = Math.max(0, window - (out.deepMinutes ?? 0) - (out.lightMinutes ?? 0) - (out.remMinutes ?? 0));
  const [a, b, m, n] = [night.averageHR, later.averageHR, night.totalMinutes, later.totalMinutes];
  if (a !== undefined && b !== undefined && m !== undefined && n !== undefined && m + n > 0) out.averageHR = swiftRound((a * m + b * n) / (m + n));
  else out.averageHR = later.averageHR ?? night.averageHR;
  if (night.stages && later.stages) {
    const gap: SleepSpan[] = later.bedtime > woke ? [{ start: woke, end: later.bedtime, stage: "awake" }] : [];
    out.stages = [...night.stages, ...gap, ...later.stages];
  } else {
    out.stages = undefined;
  }
  out.score = later.score ?? night.score;
  out.nightScore = later.nightScore ?? night.nightScore;
  out.stress = night.stress;
  return tidy(out);
}

/**
 * This night with `naps` read later added: a nap read again replaces the one it was, keeping the points known before;
 * naps inside the night are left out. `scores` has the watch's score as each nap ended, by its start (ms): a new nap's
 * points are what it added to the score before it, and the night's score becomes the latest.
 */
export function addingNaps(night: SleepNight, naps: Nap[], scores: Map<number, number> = new Map()): SleepNight {
  const byStart = new Map((night.naps ?? []).map((n) => [n.start.getTime(), n]));
  const out: SleepNight = { ...night };
  if (naps.length > 0 && (out.naps?.length ?? 0) === 0) out.nightScore = out.nightScore ?? out.score;
  let previous = out.score;
  const from = night.wakeTime?.getTime() ?? -Infinity;
  for (const original of [...naps].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    if (original.start.getTime() < from) continue;
    const nap = { ...original };
    if (nap.points === undefined) nap.points = byStart.get(nap.start.getTime())?.points;
    const score = scores.get(nap.start.getTime());
    if (score !== undefined && out.score !== undefined) {
      if (nap.points === undefined && previous !== undefined) nap.points = score - previous;
      previous = score;
      out.score = score;
    }
    byStart.set(nap.start.getTime(), compact(nap));
  }
  const list = [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  if (list.length === 0) return night;
  out.naps = list;
  out.napMinutes = list.reduce((total, n) => total + n.asleepMinutes, 0);
  return tidy(out);
}

// MARK: Recording

/**
 * Adds what a daily-history file holds, its sleeps worked out with `profile`. Days the watch no longer has stay as read
 * before, and a day's totals only grow. A day the file has sleeps ending on is worked out from the file alone: when the
 * rules now join its sleeps into another day's, what was read for it before goes.
 */
export function recordDailyHistory(health: WatchHealth, history: DailyHistory, profile: SleepProfile = defaultSleepProfile(),
  now: Date = new Date(), calendar: HealthCalendar = localCalendar): void {
  const read = insightsFromHistory(history, profile, now);
  health.sleepProfile = profile;
  // Only sleeps the rules keep: a sleep under 15 minutes they drop leaves its day as read before.
  const sleepDays = [...sleepRuleDays(history, profile).values()];
  const keptDays = new Set(sleepDays.flatMap((d) => [...(d.main ?? []), ...d.naps.flat()]).map((s) => dayKey(s.day)));
  const readNights = new Set(read.nights.map((n) => dayKey(n.day)));
  const moved = new Set([...keptDays].filter((key) => !readNights.has(key)));
  const before: TrainingInsights = {
    ...health.insights,
    nights: health.insights.nights.filter((n) => !moved.has(dayKey(n.day))),
    days: health.insights.days.map((d) => (moved.has(dayKey(d.day))
      ? compact({ ...d, sleepMinutes: undefined, sleepScore: undefined, hrv: undefined, restingHR: undefined }) : d)),
  };
  const old = new Map(health.insights.days.map((d) => [dayKey(d.day), d]));
  const merged = mergedOver(read, before, calendar);
  // After the COROS app syncs, the watch starts its daily file again, so a day can come back with only the naps since:
  // the night read before stays, with those naps added. A nap ending before noon reads as a broken night of one piece;
  // when it starts after the night read before woke, it's a nap too.
  const earlier = new Map(before.nights.map((n) => [dayKey(n.day), n]));
  // The watch's score as each nap ended (its summaries count the day's naps), by the nap's start.
  const napScores = new Map<number, number>();
  for (const nap of sleepDays.flatMap((d) => d.naps)) {
    const score = nap.findLast((s) => s.score !== undefined)?.score;
    if (score !== undefined) napScores.set(nap[0].start.getTime(), score);
  }
  const restored = new Map<number, SleepNight>();
  merged.nights = merged.nights.map((night) => {
    const kept = earlier.get(dayKey(night.day));
    if (!kept || (kept.totalMinutes ?? 0) <= 0) return night;
    // The rest of a night after a restart, long enough to be a main sleep of its own: the watch joins the two.
    if (!isBroken(night) && (night.totalMinutes ?? 0) > 0 && night.bedtime && kept.wakeTime &&
      night.bedtime >= kept.wakeTime && night.bedtime.getTime() - kept.wakeTime.getTime() <= JOIN_GAP) {
      const joinedNight = joiningNight(kept, night);
      restored.set(dayKey(night.day), joinedNight);
      return joinedNight;
    }
    const laterPieces = isBroken(night) && night.score === undefined && !!night.bedtime && !!kept.wakeTime && night.bedtime >= kept.wakeTime;
    if (!isNapsOnly(night) && !laterPieces) return night;
    const withNaps = addingNaps(kept, [...(night.pieces ?? []), ...(night.naps ?? [])], napScores);
    restored.set(dayKey(night.day), withNaps);
    return withNaps;
  });
  merged.days = merged.days.map((original) => {
    const day = { ...original };
    // A night kept through a restarted file keeps its length, and its score takes the naps read since.
    const night = restored.get(dayKey(day.day));
    if (night) { day.sleepMinutes = night.totalMinutes; day.sleepScore = night.score; }
    const previous = old.get(dayKey(day.day));
    if (previous) {
      day.steps = larger(day.steps, previous.steps);
      day.calories = larger(day.calories, previous.calories);
      day.exerciseMinutes = larger(day.exerciseMinutes, previous.exerciseMinutes);
    }
    return compact(day);
  });
  health.insights = merged;
  health.syncedAt = now;
  const today = health.today;
  if (today) {
    const day = health.insights.days.find((d) => dayKey(d.day) === dayKey(today.day));
    if (day) applyToday(health, today, day);
  }
}

/** The heart rates a watch's training profile can hold (CorosKit's WatchProfile ranges). */
export const MAX_HR_RANGE = { min: 100, max: 240 };
export const THRESHOLD_HR_RANGE = { min: 80, max: 230 };
export const FTP_RANGE = { min: 50, max: 700 };
const within = (value: number, range: { min: number; max: number }): number | undefined => (value >= range.min && value <= range.max ? value : undefined);

/** What recordProfile takes from the watch's training profile (WatchProfile). */
export interface ProfileHeartRates { maxHR: number; thresholdHR: number; ftp: number }

/**
 * Keeps the heart rates set in the watch's training profile, which COROS's MCP doesn't send: the threshold the
 * intensity bands are read against, the maximum the effort zones are, and the cycling FTP.
 */
export function recordProfile(health: WatchHealth, profile: ProfileHeartRates): void {
  const threshold = within(profile.thresholdHR, THRESHOLD_HR_RANGE);
  const maximum = within(profile.maxHR, MAX_HR_RANGE);
  // UNVERIFIED on a real watch (as in CorosKit): that field 15 is the cycling FTP in watts.
  const ftp = within(profile.ftp, FTP_RANGE);
  if (threshold === undefined && maximum === undefined && ftp === undefined) return;
  const fitness: Fitness = { ...(health.insights.fitness ?? { predictions: [] }), thresholdHR: threshold, maxHR: maximum, ftp };
  health.insights = { ...health.insights, fitness: tidy(fitness) };
}

/** Adds today's running totals (GetPedometer). */
export function recordPedometer(health: WatchHealth, totals: PedometerTotals, now: Date = new Date(), calendar: HealthCalendar = localCalendar): void {
  const day = pedometerDay(totals, now, calendar);
  const reading: TodayTotals = compact({
    day, steps: totals.steps, distanceMeters: totals.distanceMeters, calories: totals.calories, activeSeconds: totals.activeSeconds, readAt: now,
  });
  health.today = reading;
  health.syncedAt = now;
  health.insights = { ...health.insights, fetchedAt: now };
  applyToday(health, reading, health.insights.days.find((d) => dayKey(d.day) === dayKey(day)) ?? { day });
}

function applyToday(health: WatchHealth, today: TodayTotals, original: DayVitals): void {
  const vitals = { ...original };
  vitals.steps = larger(vitals.steps, today.steps);
  vitals.calories = larger(vitals.calories, today.calories);
  vitals.exerciseMinutes = larger(vitals.exerciseMinutes, today.activeSeconds === undefined ? undefined : Math.trunc(today.activeSeconds / 60));
  const days = health.insights.days.filter((d) => dayKey(d.day) !== dayKey(vitals.day));
  days.push(compact(vitals));
  days.sort((a, b) => compareDays(a.day, b.day));
  health.insights = { ...health.insights, days };
}

// MARK: GetPedometer

/** GetPedometer (0x90): today's running totals. */
export interface PedometerTotals {
  steps: number;
  distanceMeters: number;
  /** Kilocalories (the watch counts small calories). */
  calories: number;
  activeSeconds?: number;
  month?: number;
  day?: number;
}

export const PEDOMETER_OPCODE = 0x90;
/** Like the other control reads, the request carries one 0x00 byte; an empty one gets another answer. */
export const PEDOMETER_REQUEST = Buffer.from([0]);

/** int32 steps, int32 distance (cm), int32 small calories, int32 active seconds, u8 month, u8 day, 2 padding bytes. */
export function parsePedometer(payload: Uint8Array): PedometerTotals {
  if (payload.length < 12 || payload.length > 64) throw new CorosError("The watch returned an invalid step summary.");
  const steps = u32(payload, 0) | 0, centimeters = u32(payload, 4) | 0, smallCalories = u32(payload, 8) | 0;
  if (steps < 0 || steps > 500_000 || centimeters < 0 || centimeters > 50_000_000 || smallCalories < 0 || smallCalories > 100_000_000) {
    throw new CorosError("The watch returned an implausible step summary.");
  }
  const totals: PedometerTotals = { steps, distanceMeters: centimeters / 100, calories: forecastRound(smallCalories / 1000) };
  if (payload.length >= 18) {
    const active = u32(payload, 12) | 0;
    if (active >= 0 && active <= 86_400) totals.activeSeconds = active;
    if (payload[16] >= 1 && payload[16] <= 12 && payload[17] >= 1 && payload[17] <= 31) { totals.month = payload[16]; totals.day = payload[17]; }
  }
  return totals;
}

/** The day these totals are for: the watch reports month and day only, so the year that puts that date closest to now. */
export function pedometerDay(totals: PedometerTotals, now: Date = new Date(), calendar: HealthCalendar = localCalendar): CalendarDay {
  const { month, day } = totals;
  if (month === undefined || day === undefined) return calendar.dayOf(now);
  const year = calendar.dayOf(now).year;
  const distance = (y: number): number => Math.abs(calendar.start({ year: y, month, day }).getTime() - now.getTime());
  const best = [year - 1, year, year + 1].reduce((a, b) => (distance(b) < distance(a) ? b : a));
  return { year: best, month, day };
}

// MARK: health.json

export function healthToJSON(health: WatchHealth): Record<string, unknown> {
  const t = health.today;
  return compact({
    syncedAt: refSeconds(health.syncedAt),
    insights: encodeInsights(health.insights),
    today: t && compact({
      day: encodeDay(t.day), steps: t.steps, distanceMeters: t.distanceMeters, calories: t.calories, activeSeconds: t.activeSeconds,
      readAt: refSeconds(t.readAt),
    }),
    sleepProfile: health.sleepProfile && compact({
      weightKg: health.sleepProfile.weightKg,
      schedule: health.sleepProfile.schedule && { bedtime: health.sleepProfile.schedule.bedtime, wake: health.sleepProfile.schedule.wake },
    }),
  });
}

export function healthFromJSON(value: unknown): WatchHealth {
  const o = obj(value, "health");
  const whole = (v: unknown, what: string): number => {
    const n = num(v, what);
    if (!Number.isInteger(n)) throw new CorosError(`${what} isn't a whole number`);
    return n;
  };
  const health: WatchHealth = { syncedAt: date(o.syncedAt, "syncedAt"), insights: decodeInsights(o.insights) };
  if (o.today !== undefined && o.today !== null) {
    const t = obj(o.today, "today");
    health.today = compact({
      day: decodeDay(t.day), steps: whole(t.steps, "steps"), distanceMeters: num(t.distanceMeters, "distanceMeters"),
      calories: whole(t.calories, "calories"),
      activeSeconds: t.activeSeconds === undefined || t.activeSeconds === null ? undefined : whole(t.activeSeconds, "activeSeconds"),
      readAt: date(t.readAt, "readAt"),
    });
  }
  if (o.sleepProfile !== undefined && o.sleepProfile !== null) {
    const p = obj(o.sleepProfile, "sleepProfile");
    const profile: SleepProfile = { weightKg: whole(p.weightKg, "weightKg") };
    if (p.schedule !== undefined && p.schedule !== null) {
      const s = obj(p.schedule, "schedule");
      profile.schedule = { bedtime: whole(s.bedtime, "bedtime"), wake: whole(s.wake, "wake") };
    }
    health.sleepProfile = profile;
  }
  return health;
}

/** health.json's text, in the shape the CorosKit helper's JSONEncoder wrote it. */
export const encodeHealth = (health: WatchHealth): string => JSON.stringify(healthToJSON(health));
/** A kept health.json (this engine's or the CorosKit helper's); throws when it isn't one. */
export const decodeHealth = (json: string): WatchHealth => healthFromJSON(JSON.parse(json));
