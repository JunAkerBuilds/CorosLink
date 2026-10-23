import { formatNumber, getLocale, t } from "../i18n/trainingLocale";
import type { TrainingHubSleepRecord } from "../../electron/types";

export const SLEEP_WEEK_NIGHTS = 7;
export const SLEEP_STAGES = ["deep", "light", "rem", "awake"] as const;
export type SleepStage = (typeof SLEEP_STAGES)[number];
export type SleepScoreTone = "low" | "mid" | "good" | "high" | "neutral";

/** A comparison needs most of both weeks; one missed night shouldn't hide it. */
const MIN_NIGHTS_TO_COMPARE = 4;
const MIN_NIGHTS_FOR_SPREAD = 3;

export function formatSleepDuration(minutes?: number): string {
  if (minutes === undefined || !Number.isFinite(minutes)) {
    return "–";
  }

  if (minutes <= 0) {
    return "0m";
  }

  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);

  if (hours <= 0) {
    return `${remainder}m`;
  }

  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

export function sleepScoreTone(score?: number): SleepScoreTone {
  if (score === undefined || !Number.isFinite(score)) {
    return "neutral";
  }

  if (score < 60) {
    return "low";
  }

  if (score < 75) {
    return "mid";
  }

  if (score < 90) {
    return "good";
  }

  return "high";
}

export function sleepScoreLabel(score?: number): string {
  switch (sleepScoreTone(score)) {
    case "low":
      return t("Poor");
    case "mid":
      return t("Fair");
    case "good":
      return t("Good");
    case "high":
      return t("Excellent");
    default:
      return t("Waiting");
  }
}

function valid(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

/** Stage minutes, falling back to the stage's share of the sleep window. */
export function sleepStageMinutes(record: TrainingHubSleepRecord, stage: SleepStage): number | undefined {
  const minutes = record[`${stage}Minutes`];
  if (valid(minutes)) return minutes;
  const percent = record[`${stage}Percent`];
  const base = record.windowMinutes ?? record.totalMinutes;
  return valid(percent) && valid(base) ? Math.round(percent / 100 * base) : undefined;
}

/** "HH:MM" as minutes after the noon before the night: 23:30 → 690, 01:15 → 795. */
export function minutesAfterNoon(value?: string): number | undefined {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return (hours * 60 + minutes + 720) % 1440;
}

/** Clock text for minutes after noon, in the same style as the sleep card's window. */
export function formatNoonClock(value: number, { short = false } = {}): string {
  const ofDay = ((Math.round(value) + 720) % 1440 + 1440) % 1440;
  const hours = Math.floor(ofDay / 60);
  const minutes = ofDay % 60;
  if (getLocale() !== "en-US") return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return short && minutes === 0 ? `${displayHour} ${period}` : `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

function parseDayKey(value: string): Date | undefined {
  if (!/^\d{8}$/.test(value)) return undefined;
  const date = new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), 12);
  return dayKey(date) === value ? date : undefined;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDay(key: string, days: number): string {
  const date = parseDayKey(key)!;
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

function counts(record: TrainingHubSleepRecord | undefined): record is TrainingHubSleepRecord & { totalMinutes: number } {
  return Boolean(record && record.completeness !== "partial" && valid(record.totalMinutes) && record.totalMinutes > 0);
}

/** One main sleep per night: complete beats partial, then the longer one. */
function mainSleepByDay(records: TrainingHubSleepRecord[]): Map<string, TrainingHubSleepRecord> {
  const byDay = new Map<string, TrainingHubSleepRecord>();
  const complete = (record: TrainingHubSleepRecord) => Number(record.completeness !== "partial");
  for (const record of records) {
    if (record.kind === "nap" || !parseDayKey(record.happenDay)) continue;
    const current = byDay.get(record.happenDay);
    if (!current || complete(record) > complete(current) ||
      (complete(record) === complete(current) && (record.totalMinutes ?? 0) > (current.totalMinutes ?? 0))) {
      byDay.set(record.happenDay, record);
    }
  }
  return byDay;
}

function napsByDay(records: TrainingHubSleepRecord[]): Map<string, TrainingHubSleepRecord[]> {
  const byDay = new Map<string, TrainingHubSleepRecord[]>();
  for (const record of records) {
    if (record.kind === "nap" && valid(record.totalMinutes)) {
      byDay.set(record.happenDay, [...(byDay.get(record.happenDay) ?? []), record]);
    }
  }
  return byDay;
}

/** One nap's clock times; a day with several naps has no single window. */
function napWindow(naps: TrainingHubSleepRecord[], main?: TrainingHubSleepRecord): SleepWeekNight["napWindow"] {
  if (naps.length > 1) return undefined;
  const start = minutesAfterNoon(naps[0] ? naps[0].sleepStart ?? naps[0].napStart : main?.napStart);
  const end = minutesAfterNoon(naps[0] ? naps[0].sleepEnd ?? naps[0].napEnd : main?.napEnd);
  return start === undefined || end === undefined ? undefined : { start, end: end <= start ? end + 1440 : end };
}

/** A day of Training Hub metrics: COROS measures resting HR and HRV while you sleep. */
export interface SleepTrendDay {
  date: string;
  rhr?: number;
  avgSleepHrv?: number;
}

export interface SleepWeekNight {
  date: string;
  weekday: string;
  weekdayLong: string;
  dayOfMonth: string;
  shortDate: string;
  isToday: boolean;
  record?: TrainingHubSleepRecord;
  partial: boolean;
  napMinutes?: number;
  /** The day's nap, when it had one with times, in the same minutes as `window`. */
  napWindow?: { start: number; end: number };
  /** Minutes after the noon before; end may pass the next noon. */
  window?: { start: number; end: number };
  stages: Record<SleepStage, number | undefined>;
  /** COROS's overnight resting HR and HRV for the morning this night ended. */
  restingHr?: number;
  hrv?: number;
}

export interface SleepWeekMetric {
  value?: number;
  previous?: number;
  /** Set only when both weeks have enough nights to compare. */
  delta?: number;
}

export interface SleepWeekClock {
  mean: number;
  /** Standard deviation in minutes; set from three timed nights. */
  spread?: number;
}

export interface SleepWeekSummary {
  nights: SleepWeekNight[];
  tracked: number;
  duration: SleepWeekMetric;
  score: SleepWeekMetric;
  awake?: number;
  wakeUps?: number;
  /** Average heart rate while asleep, where the sleep source records one (the watch does). */
  sleepHr?: number;
  restingHr?: number;
  hrv?: number;
  bedtime?: SleepWeekClock;
  wake?: SleepWeekClock;
  stages: Record<SleepStage, number | undefined>;
  best?: SleepWeekNight;
  axis: { start: number; end: number; ticks: number[] };
  /** The newest night with a record, or the newest night. */
  defaultDate: string;
}

function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function spread(values: number[], average: number): number | undefined {
  if (values.length < MIN_NIGHTS_FOR_SPREAD) return undefined;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function sleepWindow(record: TrainingHubSleepRecord): SleepWeekNight["window"] {
  const end = minutesAfterNoon(record.sleepEnd);
  let start = minutesAfterNoon(record.sleepStart);
  if (start === undefined && end !== undefined && valid(record.windowMinutes)) start = end - record.windowMinutes;
  if (start === undefined || end === undefined) return undefined;
  return { start, end: end <= start ? end + 1440 : end };
}

function metric(current: number[], previous: number[]): SleepWeekMetric {
  const value = mean(current);
  const before = mean(previous);
  return {
    value,
    previous: before,
    delta: value !== undefined && before !== undefined &&
      current.length >= MIN_NIGHTS_TO_COMPARE && previous.length >= MIN_NIGHTS_TO_COMPARE
      ? value - before : undefined
  };
}

function buildAxis(nights: SleepWeekNight[]): SleepWeekSummary["axis"] {
  const windows = nights.flatMap((night) => night.window ? [night.window] : []);
  // 9 PM to 9 AM until a night says otherwise.
  let start = windows.length ? Math.floor((Math.min(...windows.map((w) => w.start)) - 30) / 60) * 60 : 540;
  let end = windows.length ? Math.ceil((Math.max(...windows.map((w) => w.end)) + 30) / 60) * 60 : 1260;
  const minimumSpan = 9 * 60;
  if (end - start < minimumSpan) {
    const grow = Math.ceil((minimumSpan - (end - start)) / 120) * 60;
    start -= grow;
    end += grow;
  }
  const step = end - start > 15 * 60 ? 240 : end - start > 10 * 60 ? 180 : 120;
  const ticks: number[] = [];
  for (let tick = Math.ceil(start / step) * step; tick <= end; tick += step) ticks.push(tick);
  return { start, end, ticks };
}

/** The last seven nights, ending today when any of them were recorded, else at the newest record. */
export function buildSleepWeek(records: TrainingHubSleepRecord[] = [], now = new Date(), trend: SleepTrendDay[] = []): SleepWeekSummary {
  const mains = mainSleepByDay(records);
  const heart = new Map(trend.map((day) => [day.date, day]));
  const positive = (value: number | undefined) => valid(value) && value > 0 ? value : undefined;
  const naps = napsByDay(records);
  const today = dayKey(now);
  const recentDays = Array.from({ length: SLEEP_WEEK_NIGHTS }, (_value, index) => shiftDay(today, -index));
  const newest = [...mains.keys()].filter((key) => key <= today).sort().at(-1);
  const endKey = recentDays.some((key) => mains.has(key)) || !newest ? today : newest;
  const locale = getLocale();

  const nights: SleepWeekNight[] = Array.from({ length: SLEEP_WEEK_NIGHTS }, (_value, index) => {
    const date = shiftDay(endKey, index - SLEEP_WEEK_NIGHTS + 1);
    const day = parseDayKey(date)!;
    const record = mains.get(date);
    const dayNaps = naps.get(date) ?? [];
    return {
      date,
      weekday: day.toLocaleDateString(locale, { weekday: "short" }),
      weekdayLong: day.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" }),
      dayOfMonth: day.toLocaleDateString(locale, { day: "numeric" }),
      shortDate: day.toLocaleDateString(locale, { month: "short", day: "numeric" }),
      isToday: date === today,
      record,
      partial: record?.completeness === "partial",
      napMinutes: dayNaps.length
        ? dayNaps.reduce((sum, nap) => sum + (nap.totalMinutes ?? 0), 0)
        : record?.napMinutes && record.napMinutes > 0 ? record.napMinutes : undefined,
      napWindow: napWindow(dayNaps, record),
      window: record ? sleepWindow(record) : undefined,
      stages: Object.fromEntries(SLEEP_STAGES.map((stage) => [stage, record ? sleepStageMinutes(record, stage) : undefined])) as Record<SleepStage, number | undefined>,
      restingHr: positive(heart.get(date)?.rhr),
      hrv: positive(heart.get(date)?.avgSleepHrv)
    };
  });

  const previousRecords = Array.from({ length: SLEEP_WEEK_NIGHTS }, (_value, index) => mains.get(shiftDay(endKey, -SLEEP_WEEK_NIGHTS - index)));
  const counted = nights.filter((night) => counts(night.record));
  const previousCounted = previousRecords.filter(counts);
  const scores = (list: (TrainingHubSleepRecord | undefined)[]) => list.flatMap((record) => counts(record) && valid(record.score) ? [record.score] : []);
  const timed = counted.flatMap((night) => night.window ? [night.window] : []);
  const bedtimeMean = mean(timed.map((w) => w.start));
  const wakeMean = mean(timed.map((w) => w.end));
  const best = counted.filter((night) => valid(night.record?.score))
    .sort((left, right) => (right.record!.score! - left.record!.score!) || right.date.localeCompare(left.date))[0];

  return {
    nights,
    tracked: nights.filter((night) => night.record).length,
    duration: metric(counted.map((night) => night.record!.totalMinutes!), previousCounted.map((record) => record.totalMinutes)),
    score: metric(scores(counted.map((night) => night.record)), scores(previousCounted)),
    awake: mean(counted.flatMap((night) => valid(night.stages.awake) ? [night.stages.awake] : [])),
    wakeUps: mean(counted.flatMap((night) => valid(night.record!.awakeCountOverFiveMinutes) ? [night.record!.awakeCountOverFiveMinutes!] : [])),
    sleepHr: mean(counted.flatMap((night) => valid(night.record!.avgHr) && night.record!.avgHr! > 0 ? [night.record!.avgHr!] : [])),
    // Measured on nights the sleep summary may still lack, so every night of the week counts.
    restingHr: mean(nights.flatMap((night) => night.restingHr === undefined ? [] : [night.restingHr])),
    hrv: mean(nights.flatMap((night) => night.hrv === undefined ? [] : [night.hrv])),
    bedtime: bedtimeMean === undefined ? undefined : { mean: bedtimeMean, spread: spread(timed.map((w) => w.start), bedtimeMean) },
    wake: wakeMean === undefined ? undefined : { mean: wakeMean, spread: spread(timed.map((w) => w.end), wakeMean) },
    stages: Object.fromEntries(SLEEP_STAGES.map((stage) => [stage, mean(counted.flatMap((night) => valid(night.stages[stage]) ? [night.stages[stage]!] : []))])) as Record<SleepStage, number | undefined>,
    best,
    axis: buildAxis(nights),
    defaultDate: [...nights].reverse().find((night) => night.record)?.date ?? nights.at(-1)!.date
  };
}

/** How steady a bedtime or wake time was: athletes read this against their own week. */
export function sleepClockVerdict(spreadMinutes?: number): { key: "steady" | "varied" | "irregular"; label: string } | undefined {
  if (spreadMinutes === undefined) return undefined;
  if (spreadMinutes <= 30) return { key: "steady", label: t("Steady") };
  if (spreadMinutes <= 60) return { key: "varied", label: t("Some drift") };
  return { key: "irregular", label: t("Irregular") };
}

export function formatSleepSpread(minutes: number): string {
  return t("±{{value1}} min", { value1: formatNumber(Math.round(minutes)) });
}
