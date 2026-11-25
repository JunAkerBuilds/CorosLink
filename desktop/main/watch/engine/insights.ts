// The parts of CorosKit's TrainingInsights the watch's health path needs: the model (Training/TrainingInsights.swift),
// merging over what was kept (TrainingInsights+Cache.swift), sleep stress (SleepStress.swift), the source filter and
// blank days (Sync/SyncBodies.swift), and the JSON JSONEncoder writes for them (SyncJSON.native, health.json).
import type { SleepStage } from "./dailyHistory";
import {
  type CalendarDay, calendarDay, compact, compareDays, dayKey, dayStart, fromRefSeconds, refSeconds, utcCalendarDay,
} from "./native";

// MARK: Calendar

/** Swift's `Calendar` as the health code uses it: which day a moment falls on, and when a day starts. */
export interface HealthCalendar {
  dayOf(date: Date): CalendarDay;
  start(day: CalendarDay): Date;
}
/** Calendar.current: the process's time zone. */
export const localCalendar: HealthCalendar = { dayOf: calendarDay, start: dayStart };
export const utcCalendar: HealthCalendar = { dayOf: utcCalendarDay, start: (d) => new Date(Date.UTC(d.year, d.month - 1, d.day)) };

/** `day` moved by `days` on the Gregorian calendar (CalendarDay.adding). */
export const addingDays = (day: CalendarDay, days: number): CalendarDay => utcCalendarDay(new Date(Date.UTC(day.year, day.month - 1, day.day + days)));

/** A model without its undefined members (compact for interfaces). */
export const tidy = <T extends object>(value: T): T => compact(value as Record<string, unknown>) as T;

/** Swift's `.rounded()`: halves away from zero. */
export const swiftRound = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));

// MARK: Model

export type HealthSource = "appleHealth";

export interface Recovery { percent: number; status?: string; fullRecoveryHours?: number }

export interface DayVitals {
  day: CalendarDay;
  steps?: number;
  /** kcal. */
  calories?: number;
  restingHR?: number;
  averageHR?: number;
  /** Sleep HRV of the night that ended this day, ms. */
  hrv?: number;
  sleepMinutes?: number;
  sleepScore?: number;
  /** Average stress, 0–100. */
  stress?: number;
  trainingLoad?: number;
  exerciseMinutes?: number;
  acuteLoad?: number;
  chronicLoad?: number;
  loadRatio?: number;
  loadComment?: string;
  hrvSource?: HealthSource;
  restingHRSource?: HealthSource;
}

export interface Detail { label: string; value: string }

/** One stretch of a single sleep stage. */
export interface SleepSpan { start: Date; end: Date; stage: SleepStage }

/** A nap: when it was, how long you slept and what it added to the day's sleep score. */
export interface Nap {
  start: Date;
  end: Date;
  asleepMinutes: number;
  /** The points it added, from the watch's summaries before and after it; undefined when one is missing. */
  points?: number;
  stages?: SleepSpan[];
}

/** Stress through one night's sleep, from the watch's own readings (CorosKit's SleepStress). */
export interface SleepStress {
  /** The night's first reading. */
  start: Date;
  /** One per 5-minute step from `start` to the night's last reading; 0 where the watch took none. */
  readings: number[];
  /** The average while asleep, 0–100. */
  average: number;
  peak: number;
  peakTime: Date;
  /** Readings while asleep in each of COROS's bands, rest to high. */
  levels: number[];
  deep?: number;
  light?: number;
  rem?: number;
}

export interface SleepNight {
  /** The day the night ended. */
  day: CalendarDay;
  totalMinutes?: number;
  score?: number;
  deepMinutes?: number;
  lightMinutes?: number;
  remMinutes?: number;
  awakeMinutes?: number;
  bedtime?: Date;
  wakeTime?: Date;
  averageHR?: number;
  /** Daytime naps that day, minutes. */
  napMinutes?: number;
  details?: Detail[];
  /** Each stage when it came, bedtime to wake time, oldest first (the watch's records). */
  stages?: SleepSpan[];
  /** The watch's score as the main sleep ended, before the day's naps added to it. */
  nightScore?: number;
  naps?: Nap[];
  /** A broken night: the sleeps that ended before noon when none lasted the 3 hours a main sleep needs. */
  pieces?: Nap[];
  source?: HealthSource;
  sourceApp?: string;
  stress?: SleepStress;
}

export interface StressSample { time: Date; /** 0–100. */ value: number }

export interface HealthCheck {
  time: Date;
  heartRate?: number;
  hrv?: number;
  stress?: number;
  respiratoryRate?: number;
  spo2?: number;
}

export interface HRVStatus { day?: CalendarDay; average: number; baseline?: number; rangeLow?: number; rangeHigh?: number; evaluation?: string }

export interface TrainingLoad { acute?: number; chronic?: number; ratio?: number; status?: string; weekTotal?: number }

export interface RacePrediction { distance: string; seconds: number }

export interface Fitness {
  vo2max?: number;
  runningPerformance?: number;
  thresholdPace?: number;
  thresholdHR?: number;
  maxHR?: number;
  ftp?: number;
  cyclingVO2max?: number;
  predictions: RacePrediction[];
}

export interface ActivitySummary {
  id: string;
  name: string;
  sport: string;
  sportCode?: number;
  start?: Date;
  distanceMeters?: number;
  durationSeconds?: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
  trainingLoad?: number;
  elevationGain?: number;
  averageCadence?: number;
  averagePower?: number;
}

export interface TrainingInsights {
  fetchedAt: Date;
  recovery?: Recovery;
  /** One entry per calendar day with any value, oldest first. */
  days: DayVitals[];
  /** Oldest first; a night belongs to the day it ended. */
  nights: SleepNight[];
  hrv?: HRVStatus;
  load?: TrainingLoad;
  fitness?: Fitness;
  /** Newest first. */
  activities: ActivitySummary[];
  hrvBaseline?: number;
  /** Stress through the latest two days that have samples, oldest first. */
  stressSamples: StressSample[];
  /** Oldest first. */
  healthChecks: HealthCheck[];
  activityListCut: boolean;
}

export const newInsights = (fetchedAt: Date, parts: Partial<TrainingInsights> = {}): TrainingInsights => ({
  fetchedAt, days: [], nights: [], activities: [], stressSamples: [], healthChecks: [], activityListCut: false, ...parts,
});

export const isEmptyInsights = (i: TrainingInsights): boolean =>
  !i.recovery && i.days.length === 0 && i.nights.length === 0 && !i.hrv && !i.load && !i.fitness && i.activities.length === 0 &&
  i.stressSamples.length === 0 && i.healthChecks.length === 0;

/** The latest night with a sleep length. */
export const lastNight = (i: TrainingInsights): SleepNight | undefined => i.nights.findLast((n) => (n.totalMinutes ?? 0) > 0);
/** The latest night with anything; a day of naps alone isn't a night. */
export const latestNight = (i: TrainingInsights): SleepNight | undefined => i.nights.findLast((n) => !isNapsOnly(n));

// MARK: SleepNight

/** COROS has the score, but not yet the length and stages. */
export const isScoreOnly = (n: SleepNight): boolean => (n.totalMinutes ?? 0) === 0 && n.score !== undefined;
/** A day with naps and no main sleep. */
export const isNapsOnly = (n: SleepNight): boolean => (n.totalMinutes ?? 0) === 0 && n.score === undefined && (n.napMinutes ?? 0) > 0;
/** The night came in sleeps the watch counted as naps (`pieces`). */
export const isBroken = (n: SleepNight): boolean => (n.pieces ?? []).length > 0;

/** Everything slept that day: the night and the naps. */
export function dayMinutes(n: SleepNight): number | undefined {
  const minutes = (n.totalMinutes ?? 0) + (n.napMinutes ?? 0);
  return minutes > 0 ? minutes : undefined;
}

/** The longest of a broken night's sleeps, start to end, in minutes. */
export const longestPieceMinutes = (n: SleepNight): number | undefined =>
  n.pieces?.reduce<number | undefined>((best, p) => Math.max(best ?? -Infinity, swiftRound((p.end.getTime() - p.start.getTime()) / 60_000)), undefined);

/** The points the day's naps added to `score`, when the watch's summaries account for all of it. */
export function napPoints(n: SleepNight): number | undefined {
  if (n.score === undefined || n.nightScore === undefined || !n.naps || n.naps.length === 0) return undefined;
  const points = n.naps.flatMap((nap) => (nap.points === undefined ? [] : [nap.points]));
  const sum = points.reduce((a, b) => a + b, 0);
  if (points.length !== n.naps.length || !points.every((p) => p >= 0) || n.nightScore + sum !== n.score) return undefined;
  return sum;
}

/** The night's own part of `score`, before the day's naps added to it. */
export function nightPoints(n: SleepNight): number | undefined {
  if (n.score === undefined) return undefined;
  const naps = napPoints(n);
  if (naps !== undefined) return n.score - naps;
  return (n.naps ?? []).length === 0 ? n.score : n.nightScore;
}

// MARK: Sleep stress

/** The time between two stress readings. */
export const STRESS_STEP = 300;

/** COROS's stress bands for a 0–100 reading, as an index: rest, low, medium, high. */
export const stressLevel = (value: number): number => (value < 26 ? 0 : value < 51 ? 1 : value < 76 ? 2 : 3);

/**
 * The night's stress from `samples`: the readings from bedtime to wake time (each of a broken night's sleeps), and of
 * those, the ones in a stage other than awake. Undefined when no reading falls while asleep.
 */
export function sleepStress(night: SleepNight, samples: StressSample[]): SleepStress | undefined {
  let windows: [number, number][];
  if (night.pieces && night.pieces.length > 0) {
    windows = night.pieces.filter((p) => p.end > p.start).map((p) => [p.start.getTime(), p.end.getTime()]);
  } else if (night.bedtime && night.wakeTime && night.wakeTime > night.bedtime) {
    windows = [[night.bedtime.getTime(), night.wakeTime.getTime()]];
  } else {
    return undefined;
  }
  const inside = samples.filter((s) => s.value >= 1 && s.value <= 100 && windows.some(([a, b]) => s.time.getTime() >= a && s.time.getTime() <= b))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  const first = inside[0];
  if (!first) return undefined;
  const spans = night.stages ?? [];
  const stageAt = (time: Date): SleepStage | undefined => spans.find((s) => s.start <= time && time < s.end)?.stage;
  // With the stages in, a reading counts while in a stage other than awake.
  const asleep: { sample: StressSample; stage?: SleepStage }[] = [];
  for (const sample of inside) {
    if (spans.length === 0) { asleep.push({ sample }); continue; }
    const stage = stageAt(sample.time);
    if (stage && stage !== "awake") asleep.push({ sample, stage });
  }
  if (asleep.length === 0) return undefined;

  const step = (time: Date): number => swiftRound((time.getTime() - first.time.getTime()) / 1000 / STRESS_STEP);
  const readings = new Array<number>(step(inside[inside.length - 1].time) + 1).fill(0);
  for (const sample of inside) readings[step(sample.time)] = sample.value;
  const mean = (values: number[]): number | undefined => (values.length ? swiftRound(values.reduce((a, b) => a + b, 0) / values.length) : undefined);
  const values = asleep.map((a) => a.sample.value);
  // The highest, the first of equal ones.
  let highest = asleep[0];
  for (const entry of asleep) {
    if (entry.sample.value > highest.sample.value || (entry.sample.value === highest.sample.value && highest.sample.time > entry.sample.time)) highest = entry;
  }
  const levels = [0, 0, 0, 0];
  for (const value of values) levels[stressLevel(value)] += 1;
  const inStage = (stage: SleepStage): number | undefined => mean(asleep.filter((a) => a.stage === stage).map((a) => a.sample.value));
  return {
    start: first.time, readings, average: mean(values)!, peak: highest.sample.value, peakTime: highest.sample.time, levels,
    deep: inStage("deep"), light: inStage("light"), rem: inStage("rem"),
  };
}

/** Every reading with its time, awake ones included. */
export const stressSamplesOf = (stress: SleepStress): StressSample[] =>
  stress.readings.flatMap((value, index) => (value > 0 ? [{ time: new Date(stress.start.getTime() + index * STRESS_STEP * 1000), value }] : []));
/** How many readings there are from bedtime to wake time, awake ones included. */
export const measuredReadings = (stress: SleepStress): number => stress.readings.filter((r) => r > 0).length;
/** How many readings fell while asleep. */
export const asleepReadings = (stress: SleepStress): number => stress.levels.reduce((a, b) => a + b, 0);
/** The share of the readings while asleep in a band (index 0–3), 0–1. */
export function stressShare(stress: SleepStress, level: number): number {
  const total = asleepReadings(stress);
  return total > 0 && level < stress.levels.length ? stress.levels[level] / total : 0;
}

/** Whether `stress` lies within this night (a quarter of an hour's leeway either side). */
export function nightCovers(night: SleepNight, stress: SleepStress): boolean {
  if (!night.bedtime || !night.wakeTime) return false;
  const last = stress.start.getTime() + Math.max(stress.readings.length - 1, 0) * STRESS_STEP * 1000;
  return stress.start.getTime() >= night.bedtime.getTime() - 15 * 60_000 && last <= night.wakeTime.getTime() + 15 * 60_000;
}

/**
 * The nights with their sleep stress: `previous`'s for the same night where a night came in again without it, then
 * worked out from `stressSamples` wherever those hold at least as many of the night's readings.
 */
export function withSleepStress(insights: TrainingInsights, previous: SleepNight[] = []): TrainingInsights {
  const before = new Map(previous.map((n) => [dayKey(n.day), n]));
  const nights = insights.nights.map((original) => {
    const night = { ...original };
    const old = before.get(dayKey(night.day))?.stress;
    if (night.stress === undefined && old && nightCovers(night, old)) night.stress = old;
    const worked = sleepStress(night, insights.stressSamples);
    if (worked && measuredReadings(worked) >= (night.stress ? measuredReadings(night.stress) : 0)) night.stress = worked;
    return night;
  });
  return { ...insights, nights };
}

// MARK: Merging over what was kept (TrainingInsights+Cache.swift)

const KEPT_DAYS = 400;
const KEPT_ACTIVITIES = 1200;
const KEPT_HEALTH_CHECKS = 200;
/** Recovery is a reading of now with no date of its own, so an older one isn't shown as current. */
const RECOVERY_LIFETIME = 12 * 3600 * 1000;

/** This day with its empty values taken from `old`. */
export function filledDay(day: DayVitals, old: DayVitals | undefined): DayVitals {
  if (!old) return day;
  const out = { ...day };
  out.steps = day.steps ?? old.steps;
  out.calories = day.calories ?? old.calories;
  if (day.restingHR === undefined) { out.restingHR = old.restingHR; out.restingHRSource = old.restingHRSource; }
  out.averageHR = day.averageHR ?? old.averageHR;
  if (day.hrv === undefined) { out.hrv = old.hrv; out.hrvSource = old.hrvSource; }
  out.sleepMinutes = day.sleepMinutes ?? old.sleepMinutes;
  out.sleepScore = day.sleepScore ?? old.sleepScore;
  out.stress = day.stress ?? old.stress;
  out.trainingLoad = day.trainingLoad ?? old.trainingLoad;
  out.exerciseMinutes = day.exerciseMinutes ?? old.exerciseMinutes;
  out.acuteLoad = day.acuteLoad ?? old.acuteLoad;
  out.chronicLoad = day.chronicLoad ?? old.chronicLoad;
  out.loadRatio = day.loadRatio ?? old.loadRatio;
  out.loadComment = day.loadComment ?? old.loadComment;
  return out;
}

/** This activity with its empty values taken from `old`. */
export function filledActivity(activity: ActivitySummary, old: ActivitySummary): ActivitySummary {
  return {
    ...activity,
    sport: activity.sport === "other" ? old.sport : activity.sport,
    sportCode: activity.sportCode ?? old.sportCode,
    start: activity.start ?? old.start,
    distanceMeters: activity.distanceMeters ?? old.distanceMeters,
    durationSeconds: activity.durationSeconds ?? old.durationSeconds,
    averageHR: activity.averageHR ?? old.averageHR,
    maxHR: activity.maxHR ?? old.maxHR,
    calories: activity.calories ?? old.calories,
    trainingLoad: activity.trainingLoad ?? old.trainingLoad,
    elevationGain: activity.elevationGain ?? old.elevationGain,
    averageCadence: activity.averageCadence ?? old.averageCadence,
    averagePower: activity.averagePower ?? old.averagePower,
  };
}

/**
 * These insights with what they lack taken from `previous` (what was kept): days, nights, activities and health checks
 * no longer sent, and values this read left empty. Anything in these insights wins.
 */
export function mergedOver(current: TrainingInsights, previous: TrainingInsights, calendar: HealthCalendar = localCalendar): TrainingInsights {
  const merged: TrainingInsights = { ...current };
  if (merged.recovery === undefined && current.fetchedAt.getTime() - previous.fetchedAt.getTime() < RECOVERY_LIFETIME) merged.recovery = previous.recovery;
  merged.hrv = current.hrv ?? previous.hrv;
  merged.load = current.load ?? previous.load;
  merged.fitness = current.fitness ?? previous.fitness;
  merged.hrvBaseline = current.hrvBaseline ?? previous.hrvBaseline;

  const oldDays = new Map(previous.days.map((d) => [dayKey(d.day), d]));
  const days = new Map(current.days.map((d) => [dayKey(d.day), filledDay(d, oldDays.get(dayKey(d.day)))]));
  for (const [key, vitals] of oldDays) if (!days.has(key)) days.set(key, vitals);
  merged.days = [...days.values()].sort((a, b) => compareDays(a.day, b.day)).slice(-KEPT_DAYS);

  // A night sent again is replaced whole: its stages belong together.
  const nights = new Map(previous.nights.map((n) => [dayKey(n.day), n]));
  for (const night of current.nights) nights.set(dayKey(night.day), night);
  merged.nights = [...nights.values()].sort((a, b) => compareDays(a.day, b.day)).slice(-KEPT_DAYS);

  // Activities from before this list's window stay; one inside it that's no longer listed was deleted.
  const oldActivities = new Map<string, ActivitySummary>();
  for (const a of previous.activities) if (!oldActivities.has(a.id)) oldActivities.set(a.id, a);
  const activities = current.activities.map((a) => { const old = oldActivities.get(a.id); return old ? filledActivity(a, old) : a; });
  const listed = new Set(activities.map((a) => a.id));
  const starts = current.activities.flatMap((a) => (a.start ? [a.start.getTime()] : []));
  const windowStart = starts.length ? Math.min(...starts) : undefined;
  activities.push(...previous.activities.filter((old) => {
    if (listed.has(old.id)) return false;
    if (windowStart === undefined) return current.activities.length === 0;
    return old.start ? old.start.getTime() < windowStart : false;
  }));
  merged.activities = activities.map((element, offset) => ({ element, offset })).sort((a, b) => {
    const x = a.element.start?.getTime(), y = b.element.start?.getTime();
    if (x !== undefined && y !== undefined) return x !== y ? y - x : a.offset - b.offset;
    if (x !== undefined) return -1;
    if (y !== undefined) return 1;
    return a.offset - b.offset;
  }).map((e) => e.element).slice(0, KEPT_ACTIVITIES);

  const checks = new Map(previous.healthChecks.map((c) => [c.time.getTime(), c]));
  for (const check of current.healthChecks) checks.set(check.time.getTime(), check);
  merged.healthChecks = [...checks.values()].sort((a, b) => a.time.getTime() - b.time.getTime()).slice(-KEPT_HEALTH_CHECKS);

  // Stress samples: still the latest two days that have any.
  const samples = new Map(previous.stressSamples.map((s) => [s.time.getTime(), s]));
  for (const sample of current.stressSamples) samples.set(sample.time.getTime(), sample);
  const sorted = [...samples.values()].sort((a, b) => a.time.getTime() - b.time.getTime());
  const dayOf = (s: StressSample): number => dayKey(calendar.dayOf(s.time));
  const sampledDays = new Set([...new Set(sorted.map(dayOf))].sort((a, b) => a - b).slice(-2));
  merged.stressSamples = sorted.filter((s) => sampledDays.has(dayOf(s)));
  return withSleepStress(merged, previous.nights);
}

// MARK: Sync filters (SyncBodies.swift)

/** Nothing but the date. */
export const isBlankDay = (d: DayVitals): boolean =>
  d.steps === undefined && d.calories === undefined && d.restingHR === undefined && d.averageHR === undefined && d.hrv === undefined &&
  d.sleepMinutes === undefined && d.sleepScore === undefined && d.stress === undefined && d.trainingLoad === undefined &&
  d.exerciseMinutes === undefined && d.acuteLoad === undefined && d.chronicLoad === undefined && d.loadRatio === undefined && d.loadComment === undefined;

/**
 * These insights with everything from another source (Apple Health) taken out, by the source tags: nights with a
 * `source`, a day's HRV or resting heart rate with one, and the sleep a day took from such a night; HRV from elsewhere
 * takes the HRV status and baseline with it.
 */
export function withoutOtherHealthSources(insights: TrainingInsights): TrainingInsights {
  const clean = { ...insights };
  const sourcedNights = new Set(insights.nights.filter((n) => n.source !== undefined).map((n) => dayKey(n.day)));
  clean.nights = insights.nights.filter((n) => n.source === undefined);
  const hrvFromElsewhere = insights.days.some((d) => d.hrvSource !== undefined);
  clean.days = insights.days.map((original) => {
    const day = { ...original };
    if (day.hrvSource !== undefined) { day.hrv = undefined; day.hrvSource = undefined; }
    if (day.restingHRSource !== undefined) { day.restingHR = undefined; day.restingHRSource = undefined; }
    if (sourcedNights.has(dayKey(day.day))) { day.sleepMinutes = undefined; day.sleepScore = undefined; }
    return day;
  });
  if (hrvFromElsewhere) { clean.hrv = undefined; clean.hrvBaseline = undefined; }
  return clean;
}

// MARK: JSON, as JSONEncoder writes it (declaration order, nil left out, Dates as seconds since 2001)

type JSONObject = Record<string, unknown>;
const time = (date: Date | undefined): number | undefined => (date ? refSeconds(date) : undefined);
const list = <T>(items: T[] | undefined, encode: (item: T) => unknown): unknown[] | undefined => items?.map(encode);

export const encodeDay = (d: CalendarDay): JSONObject => ({ year: d.year, month: d.month, day: d.day });
const encodeSpan = (s: SleepSpan): JSONObject => ({ start: refSeconds(s.start), end: refSeconds(s.end), stage: s.stage });
const encodeNap = (n: Nap): JSONObject =>
  compact({ start: refSeconds(n.start), end: refSeconds(n.end), asleepMinutes: n.asleepMinutes, points: n.points, stages: list(n.stages, encodeSpan) });
const encodeStress = (s: SleepStress): JSONObject => compact({
  start: refSeconds(s.start), readings: s.readings, average: s.average, peak: s.peak, peakTime: refSeconds(s.peakTime), levels: s.levels,
  deep: s.deep, light: s.light, rem: s.rem,
});

export const encodeDayVitals = (d: DayVitals): JSONObject => compact({
  day: encodeDay(d.day), steps: d.steps, calories: d.calories, restingHR: d.restingHR, averageHR: d.averageHR, hrv: d.hrv,
  sleepMinutes: d.sleepMinutes, sleepScore: d.sleepScore, stress: d.stress, trainingLoad: d.trainingLoad, exerciseMinutes: d.exerciseMinutes,
  acuteLoad: d.acuteLoad, chronicLoad: d.chronicLoad, loadRatio: d.loadRatio, loadComment: d.loadComment, hrvSource: d.hrvSource,
  restingHRSource: d.restingHRSource,
});

export const encodeSleepNight = (n: SleepNight): JSONObject => compact({
  day: encodeDay(n.day), totalMinutes: n.totalMinutes, score: n.score, deepMinutes: n.deepMinutes, lightMinutes: n.lightMinutes,
  remMinutes: n.remMinutes, awakeMinutes: n.awakeMinutes, bedtime: time(n.bedtime), wakeTime: time(n.wakeTime), averageHR: n.averageHR,
  napMinutes: n.napMinutes, details: list(n.details, (d) => ({ label: d.label, value: d.value })), stages: list(n.stages, encodeSpan),
  nightScore: n.nightScore, naps: list(n.naps, encodeNap), pieces: list(n.pieces, encodeNap), source: n.source, sourceApp: n.sourceApp,
  stress: n.stress && encodeStress(n.stress),
});

const encodeActivity = (a: ActivitySummary): JSONObject => compact({
  id: a.id, name: a.name, sport: a.sport, sportCode: a.sportCode, start: time(a.start), distanceMeters: a.distanceMeters,
  durationSeconds: a.durationSeconds, averageHR: a.averageHR, maxHR: a.maxHR, calories: a.calories, trainingLoad: a.trainingLoad,
  elevationGain: a.elevationGain, averageCadence: a.averageCadence, averagePower: a.averagePower,
});

export const encodeInsights = (i: TrainingInsights): JSONObject => compact({
  fetchedAt: refSeconds(i.fetchedAt),
  recovery: i.recovery && compact({ percent: i.recovery.percent, status: i.recovery.status, fullRecoveryHours: i.recovery.fullRecoveryHours }),
  days: i.days.map(encodeDayVitals),
  nights: i.nights.map(encodeSleepNight),
  hrv: i.hrv && compact({
    day: i.hrv.day && encodeDay(i.hrv.day), average: i.hrv.average, baseline: i.hrv.baseline, rangeLow: i.hrv.rangeLow,
    rangeHigh: i.hrv.rangeHigh, evaluation: i.hrv.evaluation,
  }),
  load: i.load && compact({ acute: i.load.acute, chronic: i.load.chronic, ratio: i.load.ratio, status: i.load.status, weekTotal: i.load.weekTotal }),
  fitness: i.fitness && compact({
    vo2max: i.fitness.vo2max, runningPerformance: i.fitness.runningPerformance, thresholdPace: i.fitness.thresholdPace,
    thresholdHR: i.fitness.thresholdHR, maxHR: i.fitness.maxHR, ftp: i.fitness.ftp, cyclingVO2max: i.fitness.cyclingVO2max,
    predictions: i.fitness.predictions.map((p) => ({ distance: p.distance, seconds: p.seconds })),
  }),
  activities: i.activities.map(encodeActivity),
  hrvBaseline: i.hrvBaseline,
  stressSamples: i.stressSamples.map((s) => ({ time: refSeconds(s.time), value: s.value })),
  healthChecks: i.healthChecks.map((c) => compact({
    time: refSeconds(c.time), heartRate: c.heartRate, hrv: c.hrv, stress: c.stress, respiratoryRate: c.respiratoryRate, spo2: c.spo2,
  })),
  activityListCut: i.activityListCut,
});

// Decoding: as JSONDecoder reads it, failing on a missing required field or a wrong type (the caller starts afresh).

class DecodeError extends Error {}

export const obj = (value: unknown, what: string): JSONObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DecodeError(`${what} isn't an object`);
  return value as JSONObject;
};
export const num = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new DecodeError(`${what} isn't a number`);
  return value;
};
const str = (value: unknown, what: string): string => {
  if (typeof value !== "string") throw new DecodeError(`${what} isn't a string`);
  return value;
};
const arr = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new DecodeError(`${what} isn't a list`);
  return value;
};
/** An optional member: missing and null are nil, as decodeIfPresent reads them. */
const opt = <T>(value: unknown, read: (v: unknown) => T): T | undefined => (value === undefined || value === null ? undefined : read(value));
const int = (value: unknown, what: string): number => {
  const n = num(value, what);
  if (!Number.isInteger(n)) throw new DecodeError(`${what} isn't a whole number`);
  return n;
};
export const date = (value: unknown, what: string): Date => fromRefSeconds(num(value, what));
const source = (value: unknown): HealthSource => {
  if (value !== "appleHealth") throw new DecodeError("unknown health source");
  return value;
};
const stage = (value: unknown): SleepStage => {
  if (value !== "awake" && value !== "light" && value !== "deep" && value !== "rem") throw new DecodeError("unknown sleep stage");
  return value;
};

export function decodeDay(value: unknown): CalendarDay {
  const o = obj(value, "day");
  return { year: int(o.year, "year"), month: int(o.month, "month"), day: int(o.day, "day") };
}

const decodeSpan = (value: unknown): SleepSpan => {
  const o = obj(value, "stage");
  return { start: date(o.start, "start"), end: date(o.end, "end"), stage: stage(o.stage) };
};
const decodeNap = (value: unknown): Nap => {
  const o = obj(value, "nap");
  return compact({
    start: date(o.start, "start"), end: date(o.end, "end"), asleepMinutes: int(o.asleepMinutes, "asleepMinutes"),
    points: opt(o.points, (v) => int(v, "points")), stages: opt(o.stages, (v) => arr(v, "stages").map(decodeSpan)),
  });
};
const decodeStress = (value: unknown): SleepStress => {
  const o = obj(value, "stress");
  return compact({
    start: date(o.start, "start"), readings: arr(o.readings, "readings").map((v) => int(v, "reading")), average: int(o.average, "average"),
    peak: int(o.peak, "peak"), peakTime: date(o.peakTime, "peakTime"), levels: arr(o.levels, "levels").map((v) => int(v, "level")),
    deep: opt(o.deep, (v) => int(v, "deep")), light: opt(o.light, (v) => int(v, "light")), rem: opt(o.rem, (v) => int(v, "rem")),
  });
};

export function decodeDayVitals(value: unknown): DayVitals {
  const o = obj(value, "day vitals");
  const i = (key: string) => opt(o[key], (v) => int(v, key));
  const d = (key: string) => opt(o[key], (v) => num(v, key));
  return compact({
    day: decodeDay(o.day), steps: i("steps"), calories: i("calories"), restingHR: i("restingHR"), averageHR: i("averageHR"), hrv: i("hrv"),
    sleepMinutes: i("sleepMinutes"), sleepScore: i("sleepScore"), stress: i("stress"), trainingLoad: d("trainingLoad"),
    exerciseMinutes: i("exerciseMinutes"), acuteLoad: d("acuteLoad"), chronicLoad: d("chronicLoad"), loadRatio: d("loadRatio"),
    loadComment: opt(o.loadComment, (v) => str(v, "loadComment")), hrvSource: opt(o.hrvSource, source),
    restingHRSource: opt(o.restingHRSource, source),
  });
}

export function decodeSleepNight(value: unknown): SleepNight {
  const o = obj(value, "night");
  const i = (key: string) => opt(o[key], (v) => int(v, key));
  return compact({
    day: decodeDay(o.day), totalMinutes: i("totalMinutes"), score: i("score"), deepMinutes: i("deepMinutes"), lightMinutes: i("lightMinutes"),
    remMinutes: i("remMinutes"), awakeMinutes: i("awakeMinutes"), bedtime: opt(o.bedtime, (v) => date(v, "bedtime")),
    wakeTime: opt(o.wakeTime, (v) => date(v, "wakeTime")), averageHR: i("averageHR"), napMinutes: i("napMinutes"),
    details: opt(o.details, (v) => arr(v, "details").map((x) => { const d = obj(x, "detail"); return { label: str(d.label, "label"), value: str(d.value, "value") }; })),
    stages: opt(o.stages, (v) => arr(v, "stages").map(decodeSpan)), nightScore: i("nightScore"),
    naps: opt(o.naps, (v) => arr(v, "naps").map(decodeNap)), pieces: opt(o.pieces, (v) => arr(v, "pieces").map(decodeNap)),
    source: opt(o.source, source), sourceApp: opt(o.sourceApp, (v) => str(v, "sourceApp")), stress: opt(o.stress, decodeStress),
  });
}

function decodeActivity(value: unknown): ActivitySummary {
  const o = obj(value, "activity");
  const i = (key: string) => opt(o[key], (v) => int(v, key));
  const d = (key: string) => opt(o[key], (v) => num(v, key));
  return compact({
    id: str(o.id, "id"), name: str(o.name, "name"), sport: str(o.sport, "sport"), sportCode: i("sportCode"), start: opt(o.start, (v) => date(v, "start")),
    distanceMeters: d("distanceMeters"), durationSeconds: d("durationSeconds"), averageHR: i("averageHR"), maxHR: i("maxHR"), calories: i("calories"),
    trainingLoad: d("trainingLoad"), elevationGain: d("elevationGain"), averageCadence: i("averageCadence"), averagePower: i("averagePower"),
  });
}

/** TrainingInsights as its decoder reads it: lists and the cut flag saved before they existed read as empty. */
export function decodeInsights(value: unknown): TrainingInsights {
  const o = obj(value, "insights");
  const d = (x: JSONObject, key: string) => opt(x[key], (v) => num(v, key));
  const s = (x: JSONObject, key: string) => opt(x[key], (v) => str(v, key));
  const i = (x: JSONObject, key: string) => opt(x[key], (v) => int(v, key));
  return compact({
    fetchedAt: date(o.fetchedAt, "fetchedAt"),
    recovery: opt(o.recovery, (v) => { const r = obj(v, "recovery"); return compact({ percent: int(r.percent, "percent"), status: s(r, "status"), fullRecoveryHours: d(r, "fullRecoveryHours") }); }),
    days: opt(o.days, (v) => arr(v, "days").map(decodeDayVitals)) ?? [],
    nights: opt(o.nights, (v) => arr(v, "nights").map(decodeSleepNight)) ?? [],
    hrv: opt(o.hrv, (v) => {
      const h = obj(v, "hrv");
      return compact({
        day: opt(h.day, decodeDay), average: int(h.average, "average"), baseline: i(h, "baseline"), rangeLow: i(h, "rangeLow"),
        rangeHigh: i(h, "rangeHigh"), evaluation: s(h, "evaluation"),
      });
    }),
    load: opt(o.load, (v) => { const l = obj(v, "load"); return compact({ acute: d(l, "acute"), chronic: d(l, "chronic"), ratio: d(l, "ratio"), status: s(l, "status"), weekTotal: d(l, "weekTotal") }); }),
    fitness: opt(o.fitness, (v) => {
      const f = obj(v, "fitness");
      return compact({
        vo2max: d(f, "vo2max"), runningPerformance: d(f, "runningPerformance"), thresholdPace: d(f, "thresholdPace"), thresholdHR: i(f, "thresholdHR"),
        maxHR: i(f, "maxHR"), ftp: i(f, "ftp"), cyclingVO2max: d(f, "cyclingVO2max"),
        predictions: arr(f.predictions, "predictions").map((x) => { const p = obj(x, "prediction"); return { distance: str(p.distance, "distance"), seconds: num(p.seconds, "seconds") }; }),
      });
    }),
    activities: opt(o.activities, (v) => arr(v, "activities").map(decodeActivity)) ?? [],
    hrvBaseline: i(o, "hrvBaseline"),
    stressSamples: opt(o.stressSamples, (v) => arr(v, "stressSamples").map((x) => { const p = obj(x, "sample"); return { time: date(p.time, "time"), value: int(p.value, "value") }; })) ?? [],
    healthChecks: opt(o.healthChecks, (v) => arr(v, "healthChecks").map((x) => {
      const c = obj(x, "check");
      return compact({ time: date(c.time, "time"), heartRate: i(c, "heartRate"), hrv: i(c, "hrv"), stress: i(c, "stress"), respiratoryRate: d(c, "respiratoryRate"), spo2: i(c, "spo2") });
    })) ?? [],
    activityListCut: opt(o.activityListCut, (v) => { if (typeof v !== "boolean") throw new DecodeError("activityListCut"); return v; }) ?? false,
  });
}
