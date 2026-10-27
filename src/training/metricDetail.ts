import { formatNumber, getLocale, t } from "../i18n/trainingLocale";
import type { TrainingHubActivity, TrainingHubDailyHealthRecord } from "../../electron/types";
import type { TrainingTrendPoint } from "./types";

/** The four daily stat cards that open a page of their own. */
export type MetricKind = "load" | "heart" | "steps" | "calories";
export const METRIC_RANGES = [7, 30, 90] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

/** Weekly blocks and the weekday pattern look further back than the chart. */
const WEEKS = 8;
const PATTERN_DAYS = 84;
/** Averages and comparisons need a few readings; one sync shouldn't make a trend. */
const MIN_DAYS_TO_COMPARE = 3;

export interface MetricDay {
  date: string;
  value?: number;
  isToday: boolean;
  weekday: string;
  weekdayLong: string;
  dayOfMonth: string;
  shortDate: string;
  /** Monday (or the 1st, for long ranges): the chart labels these. */
  isWeekStart: boolean;
  isMonthStart: boolean;
}

export interface MetricWeek {
  start: string;
  label: string;
  value?: number;
  days: number;
  isCurrent: boolean;
}

export interface MetricWeekday {
  weekday: string;
  value?: number;
}

export type MetricVerdictKey = "good" | "steady" | "watch" | "high" | "neutral";

export interface MetricVerdict {
  key: MetricVerdictKey;
  label: string;
}

/** Acute (7-day) load against the 4-week weekly average. */
export interface LoadBalance {
  acute: number;
  chronic: number;
  ratio: number;
  zone: "low" | "optimal" | "high" | "spike";
}

export interface MetricSummary {
  kind: MetricKind;
  range: MetricRange;
  days: MetricDay[];
  /** Today, or for resting HR the newest reading in range. */
  current?: { date: string; value: number };
  average?: number;
  previousAverage?: number;
  /** Percent change of the range average (absolute bpm for resting HR). */
  change?: number;
  total?: number;
  peak?: MetricDay;
  low?: MetricDay;
  /** Days with a reading (load: days with any load). */
  counted: number;
  /** Steps: days at or over 10,000. */
  goalDays?: number;
  verdict?: MetricVerdict;
  weeks: MetricWeek[];
  pattern: MetricWeekday[];
  balance?: LoadBalance;
  axisMax: number;
  axisMin: number;
  ticks: number[];
  /** Whether any day in range has a reading. */
  hasData: boolean;
}

export const STEP_GOAL = 10_000;

function parseDay(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)), 12);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDay(key: string, offset: number): string {
  const date = parseDay(key);
  date.setDate(date.getDate() + offset);
  return dayKey(date);
}

function average(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function usable(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Whether a metric adds up over days (load, steps, calories) or is a level (resting HR). */
export function metricIsSum(kind: MetricKind): boolean {
  return kind !== "heart";
}

export function metricUnit(kind: MetricKind): string {
  switch (kind) {
    case "heart": return "bpm";
    case "calories": return "kcal";
    // "steps" alone means workout steps in the catalogs; this is the step count.
    case "steps": return t("steps", undefined, "daily");
    default: return t("load");
  }
}

export function metricTitle(kind: MetricKind, local = false): string {
  switch (kind) {
    case "heart": return t("Resting HR");
    case "steps": return t("Steps");
    case "calories": return local ? t("Active calories") : t("Calories");
    default: return t("Training Load");
  }
}

export function formatMetricValue(value: number | undefined, kind: MetricKind, { compact = false } = {}): string {
  if (value === undefined || !Number.isFinite(value)) return "–";
  const rounded = Math.round(value);
  if (compact && Math.abs(rounded) >= 10_000) {
    return formatNumber(rounded / 1000, { maximumFractionDigits: 1 }) + "k";
  }
  return kind === "heart" ? String(rounded) : formatNumber(rounded);
}

/**
 * One reading per day: COROS daily metrics for load and resting HR, daily
 * health for steps and calories. Load counts a covered day without any as 0;
 * the others leave unmeasured days empty.
 */
export function metricReadings(
  kind: MetricKind,
  trendPoints: TrainingTrendPoint[],
  healthRecords: TrainingHubDailyHealthRecord[]
): Map<string, number> {
  const readings = new Map<string, number>();
  if (kind === "load" || kind === "heart") {
    for (const point of trendPoints) {
      const value = usable(kind === "load" ? point.trainingLoad : point.rhr);
      if (value === undefined || (kind === "heart" && value <= 0)) continue;
      readings.set(point.date, value);
    }
  } else {
    for (const record of healthRecords) {
      const value = usable(kind === "steps" ? record.steps : record.calories);
      if (value === undefined) continue;
      readings.set(record.happenDay, value);
    }
  }
  return readings;
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}

function buildAxis(kind: MetricKind, values: number[], reference?: number): { min: number; max: number; ticks: number[] } {
  const all = reference === undefined ? values : [...values, reference];
  if (!all.length) return { min: 0, max: 1, ticks: [] };
  if (metricIsSum(kind)) {
    const top = Math.max(...all, kind === "steps" ? STEP_GOAL * 0.6 : 1);
    const step = niceStep(top / 3);
    const max = Math.ceil(top / step) * step;
    return { min: 0, max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) };
  }
  // A level reads best with room around it: a few bpm either side, on whole steps.
  const low = Math.min(...all);
  const high = Math.max(...all);
  const step = Math.max(2, niceStep(Math.max(high - low, 4) / 3));
  const min = Math.floor((low - step / 2) / step) * step;
  const max = Math.ceil((high + step / 2) / step) * step;
  return { min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + index * step) };
}

function heartVerdict(latest: number, usual: number): MetricVerdict {
  const delta = latest - usual;
  if (delta <= -2) return { key: "good", label: t("Below your usual") };
  if (delta < 2) return { key: "steady", label: t("Steady") };
  if (delta < 5) return { key: "watch", label: t("Elevated") };
  return { key: "high", label: t("Well above usual") };
}

function sumVerdict(kind: MetricKind, change: number): MetricVerdict {
  if (Math.abs(change) < 8) return { key: "steady", label: t("In line with before") };
  if (change > 0) return { key: kind === "load" && change > 40 ? "watch" : "good", label: t("Up on before") };
  return { key: "neutral", label: t("Down on before") };
}

export function loadBalanceZone(ratio: number): LoadBalance["zone"] {
  if (ratio < 0.8) return "low";
  if (ratio <= 1.3) return "optimal";
  if (ratio <= 1.5) return "high";
  return "spike";
}

export function loadBalanceLabel(zone: LoadBalance["zone"]): string {
  switch (zone) {
    case "low": return t("Easing off");
    case "optimal": return t("Productive");
    case "high": return t("Building fast");
    default: return t("Spike");
  }
}

function startOfWeek(key: string): string {
  const date = parseDay(key);
  const offset = (date.getDay() + 6) % 7;
  return shiftDay(key, -offset);
}

export function buildMetricSummary(
  kind: MetricKind,
  range: MetricRange,
  readings: Map<string, number>,
  today = dayKey(new Date())
): MetricSummary {
  const locale = getLocale();
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric" });
  const short = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const sum = metricIsSum(kind);
  // Load days COROS covers but has nothing for were rest days; before the first reading they're unknown.
  const firstKnown = [...readings.keys()].sort()[0];
  const valueOn = (key: string): number | undefined => {
    const value = readings.get(key);
    if (value !== undefined) return value;
    return kind === "load" && firstKnown !== undefined && key >= firstKnown && key <= today ? 0 : undefined;
  };

  const days: MetricDay[] = Array.from({ length: range }, (_, index) => {
    const key = shiftDay(today, index - range + 1);
    const date = parseDay(key);
    return {
      date: key,
      value: valueOn(key),
      isToday: key === today,
      weekday: weekday.format(date),
      weekdayLong: weekdayLong.format(date),
      dayOfMonth: String(date.getDate()),
      shortDate: short.format(date),
      isWeekStart: date.getDay() === 1,
      isMonthStart: date.getDate() === 1
    };
  });

  const measured = days.filter((day): day is MetricDay & { value: number } => day.value !== undefined);
  const values = measured.map((day) => day.value);
  const previous = Array.from({ length: range }, (_, index) => valueOn(shiftDay(today, index - 2 * range + 1)))
    .filter((value): value is number => value !== undefined);

  const avg = average(values);
  const previousAverage = average(previous);
  const current = kind === "heart"
    ? measured.at(-1)
    : days.at(-1)?.value !== undefined ? days.at(-1) as MetricDay & { value: number } : undefined;

  let change: number | undefined;
  let verdict: MetricVerdict | undefined;
  if (kind === "heart") {
    // Against your own normal: the newest reading vs the rest of the range.
    const usual = average(measured.slice(0, -1).map((day) => day.value));
    if (current && usual !== undefined && measured.length > MIN_DAYS_TO_COMPARE) {
      verdict = heartVerdict(current.value, usual);
    }
    if (avg !== undefined && previousAverage !== undefined && values.length >= MIN_DAYS_TO_COMPARE && previous.length >= MIN_DAYS_TO_COMPARE) {
      change = avg - previousAverage;
    }
  } else if (avg !== undefined && previousAverage !== undefined && previousAverage > 0
    && values.length >= MIN_DAYS_TO_COMPARE && previous.length >= MIN_DAYS_TO_COMPARE) {
    change = (avg - previousAverage) / previousAverage * 100;
    verdict = sumVerdict(kind, change);
  }

  const byValue = [...measured].sort((a, b) => b.value - a.value);
  const peak = byValue[0];
  const low = byValue.at(-1);

  // Mon–Sun weeks, newest last; a sum metric totals each, resting HR averages it.
  const thisWeek = startOfWeek(today);
  const weeks: MetricWeek[] = Array.from({ length: WEEKS }, (_, index) => {
    const start = shiftDay(thisWeek, (index - WEEKS + 1) * 7);
    const weekValues = Array.from({ length: 7 }, (_, offset) => shiftDay(start, offset))
      .filter((key) => key <= today)
      .map(valueOn)
      .filter((value): value is number => value !== undefined);
    return {
      start,
      label: short.format(parseDay(start)),
      value: weekValues.length ? sum ? weekValues.reduce((a, b) => a + b, 0) : average(weekValues) : undefined,
      days: weekValues.length,
      isCurrent: start === thisWeek
    };
  });

  const patternBuckets: number[][] = Array.from({ length: 7 }, () => []);
  for (let offset = 0; offset < PATTERN_DAYS; offset++) {
    const key = shiftDay(today, -offset);
    const value = valueOn(key);
    if (value === undefined) continue;
    patternBuckets[(parseDay(key).getDay() + 6) % 7].push(value);
  }
  const monday = parseDay(thisWeek);
  const pattern = patternBuckets.map((bucket, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return { weekday: weekday.format(date), value: bucket.length >= 2 ? average(bucket) : undefined };
  });

  let balance: LoadBalance | undefined;
  if (kind === "load") {
    const window = (from: number, length: number) => Array.from({ length }, (_, index) => valueOn(shiftDay(today, -from - index)));
    const acuteDays = window(0, 7);
    const chronicDays = window(0, 28);
    if (chronicDays.filter((value) => value !== undefined).length >= 21) {
      const acute = acuteDays.reduce<number>((total, value) => total + (value ?? 0), 0);
      const chronic = chronicDays.reduce<number>((total, value) => total + (value ?? 0), 0) / 4;
      if (chronic > 0) {
        const ratio = acute / chronic;
        balance = { acute, chronic, ratio, zone: loadBalanceZone(ratio) };
      }
    }
  }

  const axis = buildAxis(kind, values, avg);

  return {
    kind,
    range,
    days,
    current: current ? { date: current.date, value: current.value } : undefined,
    average: avg,
    previousAverage,
    change,
    total: sum && values.length ? values.reduce((a, b) => a + b, 0) : undefined,
    peak,
    low,
    counted: kind === "load" ? values.filter((value) => value > 0).length : values.length,
    goalDays: kind === "steps" ? values.filter((value) => value >= STEP_GOAL).length : undefined,
    verdict,
    weeks,
    pattern,
    balance,
    axisMax: axis.max,
    axisMin: axis.min,
    ticks: axis.ticks,
    hasData: values.length > 0
  };
}

/** Activities that started on a day, newest first. */
export function activitiesOn(activities: TrainingHubActivity[], date: string): TrainingHubActivity[] {
  return activities
    .filter((activity) => {
      if (!activity.startTime) return false;
      const ms = activity.startTime < 10_000_000_000 ? activity.startTime * 1000 : activity.startTime;
      return dayKey(new Date(ms)) === date;
    })
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}
