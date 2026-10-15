import type {
  CoachChartAxis,
  CoachChartColor,
  CoachChartFreshness,
  CoachChartIntradayKey,
  CoachChartMetricKey,
  CoachChartPreview,
  CoachChartRangeSpec,
  CoachChartResolvedRange,
  CoachChartResolvedSeries,
  CoachChartResolvedTile,
  CoachChartSeriesKind,
  CoachChartSeriesMetric,
  CoachChartSeriesSpec,
  CoachChartSpec,
  CoachChartTileMetric,
  CoachChartTileOnlyKey,
  CoachChartTileSpec,
  CoachChartTileStat,
  CoachChartWindowKind,
  PinnedCoachChart,
  TrainingTrendPoint
} from "./types";

export const COACH_CHART_MIN_DAYS = 7;
export const COACH_CHART_MAX_DAYS = 90;
export const COACH_CHART_DEFAULT_DAYS = 30;
export const COACH_CHART_INTRADAY_MIN_DAYS = 1;
export const COACH_CHART_INTRADAY_MAX_DAYS = 7;
export const COACH_CHART_INTRADAY_DEFAULT_DAYS = 1;
/** Daily window tiles fall back to when the chart itself has no daily axis. */
export const COACH_CHART_TILE_DAILY_DAYS = 7;
export const COACH_CHART_MAX_SERIES = 6;
export const COACH_CHART_MAX_POINTS = 366;
export const COACH_CHART_MAX_PINNED = 12;

export const COACH_CHART_METRIC_KEYS: readonly CoachChartMetricKey[] = [
  "trainingLoad",
  "rpeLoad",
  "avgSleepHrv",
  "sleepHrvBase",
  "rhr",
  "sleepScore",
  "sleepMinutes",
  "trainingLoadRatio",
  "staminaLevel",
  "vo2max",
  "steps",
  "calories"
];

export const COACH_CHART_INTRADAY_KEYS: readonly CoachChartIntradayKey[] = [
  "stress",
  "heartRate",
  "spo2",
  "respiratoryRate"
];

export const COACH_CHART_TILE_ONLY_KEYS: readonly CoachChartTileOnlyKey[] = [
  "recoveryPct"
];

export const COACH_CHART_SERIES_METRICS: readonly CoachChartSeriesMetric[] = [
  ...COACH_CHART_METRIC_KEYS,
  ...COACH_CHART_INTRADAY_KEYS
];

export const COACH_CHART_TILE_METRICS: readonly CoachChartTileMetric[] = [
  ...COACH_CHART_SERIES_METRICS,
  ...COACH_CHART_TILE_ONLY_KEYS
];

export const COACH_CHART_TILE_STATS: readonly CoachChartTileStat[] = [
  "latest",
  "avg",
  "min",
  "max",
  "sum"
];

export const COACH_CHART_SLEEP_METRICS: readonly CoachChartMetricKey[] = [
  "sleepScore",
  "sleepMinutes"
];

/** Daily metrics that come from COROS MCP daily health rather than Training Hub. */
export const COACH_CHART_DAILY_HEALTH_METRICS: readonly CoachChartMetricKey[] = [
  "steps",
  "calories"
];

/** Which COROS health query feeds each intraday metric. */
export const COACH_CHART_INTRADAY_SOURCE: Record<
  CoachChartIntradayKey,
  { kind: "stress" | "healthCheck"; seriesKey: string }
> = {
  stress: { kind: "stress", seriesKey: "stress" },
  heartRate: { kind: "stress", seriesKey: "heartRate" },
  spo2: { kind: "healthCheck", seriesKey: "spo2" },
  respiratoryRate: { kind: "healthCheck", seriesKey: "respiratoryRate" }
};

export function isIntradayMetric(metric: string | undefined): metric is CoachChartIntradayKey {
  return (COACH_CHART_INTRADAY_KEYS as readonly string[]).includes(metric ?? "");
}

export function isDailyMetric(metric: string | undefined): metric is CoachChartMetricKey {
  return (COACH_CHART_METRIC_KEYS as readonly string[]).includes(metric ?? "");
}

const SERIES_KINDS: readonly CoachChartSeriesKind[] = ["line", "area", "bar"];
const AXES: readonly CoachChartAxis[] = ["left", "right"];
const COLORS: readonly CoachChartColor[] = [
  "load",
  "hrv",
  "sleep",
  "rpe",
  "gold",
  "blue",
  "accent",
  "muted"
];

// load/hrv/accent are all greens and sleep/rpe are both purples in the app
// palette, so default picks avoid reusing a hue family within one chart.
const COLOR_FAMILY: Record<CoachChartColor, string> = {
  load: "green",
  hrv: "green",
  accent: "green",
  sleep: "purple",
  rpe: "purple",
  gold: "gold",
  blue: "blue",
  muted: "muted"
};

const METRIC_DEFAULT_COLOR: Record<CoachChartSeriesMetric, CoachChartColor> = {
  trainingLoad: "load",
  rpeLoad: "rpe",
  avgSleepHrv: "hrv",
  sleepHrvBase: "gold",
  rhr: "gold",
  sleepScore: "sleep",
  sleepMinutes: "sleep",
  trainingLoadRatio: "accent",
  staminaLevel: "accent",
  vo2max: "accent",
  steps: "blue",
  calories: "gold",
  stress: "sleep",
  heartRate: "gold",
  spo2: "blue",
  respiratoryRate: "accent"
};

const FALLBACK_COLOR_CYCLE: readonly CoachChartColor[] = [
  "accent",
  "gold",
  "blue",
  "sleep",
  "muted",
  "rpe",
  "hrv"
];

/** Unit appended to bound tile values unless the model supplies its own. */
const METRIC_DEFAULT_UNIT: Partial<Record<CoachChartTileMetric, string>> = {
  avgSleepHrv: "ms",
  sleepHrvBase: "ms",
  rhr: "bpm",
  heartRate: "bpm",
  spo2: "%",
  recoveryPct: "%",
  respiratoryRate: "/min",
  calories: "kcal"
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

export class CoachChartSpecError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new CoachChartSpecError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);
  if (!parsed) {
    throw new CoachChartSpecError(`${field} is required.`);
  }
  return parsed;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new CoachChartSpecError(
      `${field} must be one of: ${allowed.join(", ")}.`
    );
  }
  return value as T;
}

function parseValues(value: unknown, field: string): (number | null)[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new CoachChartSpecError(`${field} must be an array of numbers.`);
  }
  if (value.length > COACH_CHART_MAX_POINTS) {
    throw new CoachChartSpecError(
      `${field} has ${value.length} values; the limit is ${COACH_CHART_MAX_POINTS}.`
    );
  }
  return value.map((entry, index) => {
    if (entry === null || entry === undefined) return null;
    const numeric = typeof entry === "string" ? Number(entry) : entry;
    if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
      throw new CoachChartSpecError(
        `${field}[${index}] must be a number or null.`
      );
    }
    return numeric;
  });
}

function parseSeries(value: unknown, index: number): CoachChartSeriesSpec {
  const field = `series[${index}]`;
  if (!isRecord(value)) {
    throw new CoachChartSpecError(`${field} must be an object.`);
  }
  const label = requiredString(value.label, `${field}.label`);
  const metric = optionalEnum(value.metric, COACH_CHART_SERIES_METRICS, `${field}.metric`);
  const values = parseValues(value.values, `${field}.values`);
  if (!metric && !values) {
    throw new CoachChartSpecError(
      `${field} ("${label}") needs either a bound "metric" or inline "values".`
    );
  }
  if (metric && values) {
    throw new CoachChartSpecError(
      `${field} ("${label}") cannot set both "metric" and "values".`
    );
  }
  return {
    label,
    kind: optionalEnum(value.kind, SERIES_KINDS, `${field}.kind`),
    axis: optionalEnum(value.axis, AXES, `${field}.axis`),
    color: optionalEnum(value.color, COLORS, `${field}.color`),
    dashed: value.dashed === true,
    metric,
    values
  };
}

function parseRange(value: unknown, index: number): CoachChartRangeSpec {
  const field = `ranges[${index}]`;
  if (!isRecord(value)) {
    throw new CoachChartSpecError(`${field} must be an object.`);
  }
  return {
    from: requiredString(value.from, `${field}.from`),
    to: requiredString(value.to, `${field}.to`),
    label: optionalString(value.label, `${field}.label`)
  };
}

function parseTile(value: unknown, index: number): CoachChartTileSpec {
  const field = `tiles[${index}]`;
  if (!isRecord(value)) {
    throw new CoachChartSpecError(`${field} must be an object.`);
  }
  const label = requiredString(value.label, `${field}.label`);
  const metric = optionalEnum(value.metric, COACH_CHART_TILE_METRICS, `${field}.metric`);
  const stat = optionalEnum(value.stat, COACH_CHART_TILE_STATS, `${field}.stat`);
  const rawValue = value.value;
  const text =
    typeof rawValue === "number" && Number.isFinite(rawValue)
      ? String(rawValue)
      : optionalString(rawValue, `${field}.value`);
  if (!metric && !text) {
    throw new CoachChartSpecError(
      `${field} ("${label}") needs either a bound "metric" or a static "value".`
    );
  }
  if (stat && !metric) {
    throw new CoachChartSpecError(`${field}.stat needs a bound "metric".`);
  }
  return {
    label,
    value: text,
    caption: optionalString(value.caption, `${field}.caption`),
    metric,
    stat,
    unit: optionalString(value.unit, `${field}.unit`)
  };
}

function clampDays(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Which x axis the bound series share; throws when daily and intraday metrics are mixed. */
export function coachChartWindowKind(series: CoachChartSeriesSpec[]): CoachChartWindowKind {
  const daily = series.filter((entry) => isDailyMetric(entry.metric));
  const intraday = series.filter((entry) => isIntradayMetric(entry.metric));
  if (daily.length && intraday.length) {
    throw new CoachChartSpecError(
      `series mix daily metrics (${daily.map((entry) => entry.metric).join(", ")}) with intraday metrics ` +
        `(${intraday.map((entry) => entry.metric).join(", ")}). Chart one window at a time: ` +
        "daily metrics span days, intraday metrics span hours."
    );
  }
  if (intraday.length) return "intraday";
  if (daily.length) return "daily";
  return "static";
}

/** Validate raw tool arguments into a CoachChartSpec, or throw a CoachChartSpecError. */
export function parseCoachChartSpec(value: unknown): CoachChartSpec {
  if (!isRecord(value)) {
    throw new CoachChartSpecError("render_chart expects an object argument.");
  }
  const title = requiredString(value.title, "title");
  if (!Array.isArray(value.series) || value.series.length === 0) {
    throw new CoachChartSpecError("series must be a non-empty array.");
  }
  if (value.series.length > COACH_CHART_MAX_SERIES) {
    throw new CoachChartSpecError(
      `series has ${value.series.length} entries; the limit is ${COACH_CHART_MAX_SERIES}.`
    );
  }
  const series = value.series.map((entry, index) => parseSeries(entry, index));
  const kind = coachChartWindowKind(series);

  let days: number | undefined;
  if (value.days !== undefined && value.days !== null) {
    const numeric =
      typeof value.days === "string" ? Number(value.days) : value.days;
    if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
      throw new CoachChartSpecError("days must be a number.");
    }
    days =
      kind === "intraday"
        ? clampDays(numeric, COACH_CHART_INTRADAY_MIN_DAYS, COACH_CHART_INTRADAY_MAX_DAYS)
        : kind === "daily"
          ? clampDays(numeric, COACH_CHART_MIN_DAYS, COACH_CHART_MAX_DAYS)
          : clampDays(numeric, COACH_CHART_INTRADAY_MIN_DAYS, COACH_CHART_MAX_DAYS);
  }

  let labels: string[] | undefined;
  if (value.labels !== undefined && value.labels !== null) {
    if (!Array.isArray(value.labels)) {
      throw new CoachChartSpecError("labels must be an array of strings.");
    }
    labels = value.labels.map((entry, index) => {
      if (typeof entry === "number") return String(entry);
      if (typeof entry !== "string") {
        throw new CoachChartSpecError(`labels[${index}] must be a string.`);
      }
      return entry;
    });
    if (labels.length > COACH_CHART_MAX_POINTS) {
      throw new CoachChartSpecError(
        `labels has ${labels.length} entries; the limit is ${COACH_CHART_MAX_POINTS}.`
      );
    }
  }

  const ranges =
    value.ranges === undefined || value.ranges === null
      ? undefined
      : Array.isArray(value.ranges)
        ? value.ranges.map((entry, index) => parseRange(entry, index))
        : (() => {
            throw new CoachChartSpecError("ranges must be an array.");
          })();
  const tiles =
    value.tiles === undefined || value.tiles === null
      ? undefined
      : Array.isArray(value.tiles)
        ? value.tiles.map((entry, index) => parseTile(entry, index))
        : (() => {
            throw new CoachChartSpecError("tiles must be an array.");
          })();

  if (kind === "static" && (!labels || labels.length < 2)) {
    throw new CoachChartSpecError(
      "labels (at least 2) are required when no series binds a metric."
    );
  }

  return {
    title,
    subtitle: optionalString(value.subtitle, "subtitle"),
    days,
    labels,
    series,
    ranges,
    tiles,
    leftAxisLabel: optionalString(value.leftAxisLabel, "leftAxisLabel"),
    rightAxisLabel: optionalString(value.rightAxisLabel, "rightAxisLabel"),
    note: optionalString(value.note, "note")
  };
}

export function coachChartUsesMetrics(spec: CoachChartSpec): boolean {
  return spec.series.some((entry) => entry.metric);
}

export function coachChartNeedsSleep(spec: CoachChartSpec): boolean {
  return [...spec.series, ...(spec.tiles ?? [])].some(
    (entry) => isDailyMetric(entry.metric) && COACH_CHART_SLEEP_METRICS.includes(entry.metric)
  );
}

/** The chart's own window: kind plus the number of days it spans. */
export function coachChartWindow(spec: CoachChartSpec): { kind: CoachChartWindowKind; days: number } {
  const kind = coachChartWindowKind(spec.series);
  if (kind === "intraday") {
    return { kind, days: spec.days ?? COACH_CHART_INTRADAY_DEFAULT_DAYS };
  }
  if (kind === "daily") {
    return { kind, days: spec.days ?? COACH_CHART_DEFAULT_DAYS };
  }
  return { kind, days: spec.days ?? COACH_CHART_TILE_DAILY_DAYS };
}

export function coachChartWindowDays(spec: CoachChartSpec): number {
  return coachChartWindow(spec).days;
}

export interface CoachChartNeeds {
  kind: CoachChartWindowKind;
  days: number;
  /** Daily points to load: the chart window, or a short tile window on other charts. */
  dailyDays?: number;
  sleep: boolean;
  dailyHealth: boolean;
  /** Intraday readings to load: the chart window, or today for tiles on other charts. */
  intradayDays?: number;
  intradayKinds: ("stress" | "healthCheck")[];
  dashboard: boolean;
}

/** Everything the resolver has to fetch before a spec can be drawn. */
export function coachChartNeeds(spec: CoachChartSpec): CoachChartNeeds {
  const window = coachChartWindow(spec);
  const metrics = [...spec.series, ...(spec.tiles ?? [])]
    .map((entry) => entry.metric)
    .filter((metric): metric is CoachChartTileMetric => Boolean(metric));
  const daily = metrics.filter(isDailyMetric);
  const intraday = metrics.filter(isIntradayMetric);
  const kinds = new Set<"stress" | "healthCheck">();
  for (const metric of intraday) kinds.add(COACH_CHART_INTRADAY_SOURCE[metric].kind);
  return {
    kind: window.kind,
    days: window.days,
    dailyDays: daily.length
      ? window.kind === "daily"
        ? window.days
        : COACH_CHART_TILE_DAILY_DAYS
      : undefined,
    sleep: daily.some((metric) => COACH_CHART_SLEEP_METRICS.includes(metric)),
    dailyHealth: daily.some((metric) => COACH_CHART_DAILY_HEALTH_METRICS.includes(metric)),
    intradayDays: intraday.length
      ? window.kind === "intraday"
        ? window.days
        : COACH_CHART_INTRADAY_DEFAULT_DAYS
      : undefined,
    intradayKinds: [...kinds],
    dashboard: metrics.some((metric) => metric === "recoveryPct")
  };
}

export function formatHappenDayShort(happenDay: string): string {
  if (!/^\d{8}$/.test(happenDay)) return happenDay;
  const month = Number(happenDay.slice(4, 6));
  const day = Number(happenDay.slice(6, 8));
  return `${MONTHS[month - 1] ?? happenDay.slice(4, 6)} ${day}`;
}

function normalizeDateToken(token: string): string | null {
  const compact = token.replace(/-/g, "").trim();
  return /^\d{8}$/.test(compact) ? compact : null;
}

function findAxisIndex(
  token: string,
  labels: string[],
  dates: string[] | undefined
): number {
  const asDate = normalizeDateToken(token);
  if (asDate && dates) {
    const exact = dates.indexOf(asDate);
    if (exact >= 0) return exact;
    // Outside the window: clamp to the nearest edge so partially overlapping
    // blocks still shade; fully outside ranges are dropped by the caller.
    if (asDate < dates[0]) return -1;
    if (asDate > dates[dates.length - 1]) return dates.length;
    // Gap inside the window (missing day): take the next available date.
    const next = dates.findIndex((date) => date > asDate);
    return next >= 0 ? next : dates.length - 1;
  }
  const lowered = token.trim().toLowerCase();
  const byLabel = labels.findIndex((label) => label.trim().toLowerCase() === lowered);
  if (byLabel >= 0) return byLabel;
  if (asDate) {
    // Labels may have been produced from dates; compare the short form too.
    const short = formatHappenDayShort(asDate).toLowerCase();
    const byShort = labels.findIndex((label) => label.trim().toLowerCase() === short);
    if (byShort >= 0) return byShort;
  }
  return Number.NaN;
}

export function resolveCoachChartRanges(
  ranges: CoachChartRangeSpec[] | undefined,
  labels: string[],
  dates: string[] | undefined
): { resolved: CoachChartResolvedRange[]; dropped: string[] } {
  const resolved: CoachChartResolvedRange[] = [];
  const dropped: string[] = [];
  const last = labels.length - 1;
  for (const range of ranges ?? []) {
    const fromIndex = findAxisIndex(range.from, labels, dates);
    const toIndex = findAxisIndex(range.to, labels, dates);
    const name = range.label ?? `${range.from} – ${range.to}`;
    if (Number.isNaN(fromIndex) || Number.isNaN(toIndex)) {
      dropped.push(name);
      continue;
    }
    const start = Math.max(0, Math.min(fromIndex, toIndex));
    const end = Math.min(last, Math.max(fromIndex, toIndex));
    if (start > last || end < 0 || start > end) {
      dropped.push(name);
      continue;
    }
    resolved.push({ fromIndex: start, toIndex: end, label: range.label });
  }
  return { resolved, dropped };
}

function pickColor(
  spec: CoachChartSeriesSpec,
  index: number,
  usedFamilies: Set<string>
): CoachChartColor {
  if (spec.color) return spec.color;
  if (spec.metric) {
    const preferred = METRIC_DEFAULT_COLOR[spec.metric];
    if (!usedFamilies.has(COLOR_FAMILY[preferred])) return preferred;
  }
  const free = FALLBACK_COLOR_CYCLE.find(
    (candidate) => !usedFamilies.has(COLOR_FAMILY[candidate])
  );
  return free ?? FALLBACK_COLOR_CYCLE[index % FALLBACK_COLOR_CYCLE.length];
}

function defaultSeriesKind(metric?: CoachChartSeriesMetric): CoachChartSeriesKind {
  return metric === "trainingLoad" ||
    metric === "rpeLoad" ||
    metric === "steps" ||
    metric === "calories"
    ? "bar"
    : "line";
}

function metricValue(
  point: TrainingTrendPoint,
  metric: CoachChartMetricKey
): number | null {
  const value = point[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ----- Intraday readings -----

export interface CoachChartIntradayBucket {
  /** ISO start of the local hour. */
  time: string;
  label: string;
  values: Partial<Record<CoachChartIntradayKey, number | null>>;
}

export interface CoachChartIntradayWindow {
  days: number;
  buckets: CoachChartIntradayBucket[];
}

export interface CoachChartReading {
  time: string;
  value: number;
}

const HOUR_MS = 60 * 60 * 1000;

function hourStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
}

function intradayLabel(date: Date, days: number): string {
  const hour = `${String(date.getHours()).padStart(2, "0")}:00`;
  return days > 1 ? `${MONTHS[date.getMonth()]} ${date.getDate()} ${hour}` : hour;
}

/**
 * Average timestamped COROS readings into one bucket per local hour, from the
 * first hour with data to the last. Readings before the window start are
 * dropped; gaps stay null so lines break where the watch was off.
 */
export function bucketIntradayReadings(
  readings: Partial<Record<CoachChartIntradayKey, CoachChartReading[]>>,
  days: number,
  now: Date = new Date()
): CoachChartIntradayWindow {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const end = hourStart(now).getTime() + HOUR_MS;
  const sums = new Map<number, Partial<Record<CoachChartIntradayKey, { sum: number; count: number }>>>();
  for (const [metric, points] of Object.entries(readings) as [CoachChartIntradayKey, CoachChartReading[]][]) {
    for (const point of points ?? []) {
      const stamp = new Date(point.time);
      const epoch = stamp.getTime();
      if (!Number.isFinite(epoch) || epoch < start.getTime() || epoch >= end) continue;
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      const bucket = hourStart(stamp).getTime();
      const entry = sums.get(bucket) ?? {};
      const current = entry[metric] ?? { sum: 0, count: 0 };
      entry[metric] = { sum: current.sum + point.value, count: current.count + 1 };
      sums.set(bucket, entry);
    }
  }
  const stamps = [...sums.keys()].sort((a, b) => a - b);
  if (stamps.length === 0) return { days, buckets: [] };
  const buckets: CoachChartIntradayBucket[] = [];
  const first = stamps[0];
  const last = stamps[stamps.length - 1];
  for (let at = first; at <= last && buckets.length < COACH_CHART_MAX_POINTS; at += HOUR_MS) {
    const date = new Date(at);
    const entry = sums.get(at) ?? {};
    const values: CoachChartIntradayBucket["values"] = {};
    for (const metric of COACH_CHART_INTRADAY_KEYS) {
      const total = entry[metric];
      values[metric] = total && total.count > 0 ? total.sum / total.count : null;
    }
    buckets.push({ time: date.toISOString(), label: intradayLabel(date, days), values });
  }
  return { days, buckets };
}

// ----- Tiles -----

function reduceStat(values: (number | null)[], stat: CoachChartTileStat): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return null;
  switch (stat) {
    case "latest":
      return present[present.length - 1];
    case "avg":
      return present.reduce((total, value) => total + value, 0) / present.length;
    case "min":
      return Math.min(...present);
    case "max":
      return Math.max(...present);
    case "sum":
      return present.reduce((total, value) => total + value, 0);
  }
}

function formatStat(value: number): string {
  return Math.abs(value) >= 100 || Number.isInteger(value)
    ? String(Math.round(value))
    : value.toFixed(1);
}

/** Bound tile text: number plus the metric's unit, in the style the Training Hub uses. */
export function formatCoachMetricValue(
  metric: CoachChartTileMetric,
  value: number,
  unit?: string
): string {
  if (metric === "sleepMinutes" && !unit) {
    const minutes = Math.round(value);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, "0")} min` : `${minutes} min`;
  }
  const suffix = unit ?? METRIC_DEFAULT_UNIT[metric] ?? "";
  let text: string;
  if (metric === "steps" || metric === "calories") {
    text = Math.round(value).toLocaleString("en-US");
  } else if (metric === "trainingLoadRatio") {
    text = value.toFixed(2);
  } else if (WHOLE_NUMBER_METRICS.has(metric)) {
    text = String(Math.round(value));
  } else {
    text = formatStat(value);
  }
  if (!suffix) return text;
  return suffix === "%" ? `${text}%` : `${text} ${suffix}`;
}

/** Readings the watch reports as whole numbers; averages of them read oddly with decimals. */
const WHOLE_NUMBER_METRICS = new Set<CoachChartTileMetric>([
  "rhr",
  "heartRate",
  "avgSleepHrv",
  "sleepHrvBase",
  "recoveryPct",
  "respiratoryRate",
  "sleepScore",
  "trainingLoad",
  "rpeLoad",
  "staminaLevel"
]);

export const COACH_CHART_NO_DATA = "No data";

interface TileContext {
  trendPoints?: TrainingTrendPoint[];
  intraday?: CoachChartIntradayWindow;
  dashboard?: { recoveryPct?: number };
}

function resolveTile(tile: CoachChartTileSpec, context: TileContext): CoachChartResolvedTile {
  if (!tile.metric) {
    return { ...tile, value: tile.value ?? "" };
  }
  const metric = tile.metric;
  const stat = tile.stat ?? "latest";
  let values: (number | null)[];
  if (metric === "recoveryPct") {
    values = [context.dashboard?.recoveryPct ?? null];
  } else if (isIntradayMetric(metric)) {
    values = (context.intraday?.buckets ?? []).map((bucket) => bucket.values[metric] ?? null);
  } else {
    values = (context.trendPoints ?? []).map((point) => metricValue(point, metric));
  }
  const reduced = reduceStat(values, stat);
  return {
    ...tile,
    stat,
    value: reduced === null ? COACH_CHART_NO_DATA : formatCoachMetricValue(metric, reduced, tile.unit)
  };
}

/** live when everything binds, snapshot when nothing does. */
export function coachChartFreshness(
  series: { metric?: string }[],
  tiles: { metric?: string }[]
): CoachChartFreshness {
  const parts = [...series, ...tiles];
  const bound = parts.filter((entry) => entry.metric).length;
  if (bound === 0) return "snapshot";
  return bound === parts.length ? "live" : "partial";
}

/** Names of the series and tiles a refresh cannot regenerate. */
export function coachChartSnapshotParts(preview: CoachChartPreview): string[] {
  return [...preview.series, ...preview.tiles]
    .filter((entry) => !entry.metric)
    .map((entry) => entry.label);
}

export interface ResolveCoachChartOptions {
  previewId: string;
  /** Daily points for the chart window, or the tile window on non-daily charts. */
  trendPoints?: TrainingTrendPoint[];
  /** Hourly readings for the chart window, or today on non-intraday charts. */
  intraday?: CoachChartIntradayWindow;
  dashboard?: { recoveryPct?: number };
  /** False when sleep metrics were requested but COROS MCP was unavailable. */
  sleepAvailable?: boolean;
  /** False when steps/calories were requested but COROS MCP was unavailable. */
  dailyHealthAvailable?: boolean;
  /** False when intraday metrics were requested but COROS MCP was unavailable. */
  intradayAvailable?: boolean;
  now?: Date;
}

/**
 * Turn a validated spec into a renderer-ready preview. Pure: all data comes
 * from the spec and the supplied windows.
 */
export function resolveCoachChart(
  spec: CoachChartSpec,
  options: ResolveCoachChartOptions
): { preview: CoachChartPreview; droppedRanges: string[] } {
  const window = coachChartWindow(spec);
  let labels: string[];
  let dates: string[] | undefined;
  let times: string[] | undefined;

  if (window.kind === "daily") {
    const points = options.trendPoints ?? [];
    if (points.length === 0) {
      throw new CoachChartSpecError(
        "No daily training data is available for the requested window."
      );
    }
    dates = points.map((point) => point.date);
    labels = dates.map((date) => formatHappenDayShort(date));
  } else if (window.kind === "intraday") {
    const buckets = options.intraday?.buckets ?? [];
    if (buckets.length === 0) {
      throw new CoachChartSpecError(
        options.intradayAvailable === false
          ? "Intraday metrics need COROS MCP. Ask the athlete to connect COROS in Settings → Accounts, or pass inline values instead."
          : "No COROS health readings are available for the requested window."
      );
    }
    times = buckets.map((bucket) => bucket.time);
    labels = buckets.map((bucket) => bucket.label);
  } else {
    labels = spec.labels ?? [];
    dates = spec.labels?.every((label) => normalizeDateToken(label))
      ? spec.labels.map((label) => normalizeDateToken(label) as string)
      : undefined;
  }

  const pointCount = labels.length;
  const usedFamilies = new Set<string>();
  const series: CoachChartResolvedSeries[] = spec.series.map((entry, index) => {
    let values: (number | null)[];
    if (isIntradayMetric(entry.metric)) {
      const metric = entry.metric;
      values = (options.intraday?.buckets ?? []).map((bucket) => bucket.values[metric] ?? null);
    } else if (isDailyMetric(entry.metric)) {
      const metric = entry.metric;
      values = (options.trendPoints ?? []).map((point) => metricValue(point, metric));
    } else {
      values = entry.values ?? [];
      if (values.length !== pointCount) {
        const windowHint =
          window.kind === "daily" && dates
            ? ` The window has ${pointCount} days (${formatHappenDayShort(
                dates[0]
              )} – ${formatHappenDayShort(dates[dates.length - 1])}); ` +
              "inline values must supply one entry per day, using null for gaps."
            : window.kind === "intraday"
              ? ` The window has ${pointCount} hourly points (${labels[0]} – ${
                  labels[pointCount - 1]
                }); inline values must supply one entry per hour, using null for gaps.`
              : ` labels has ${pointCount} entries.`;
        throw new CoachChartSpecError(
          `series "${entry.label}" has ${values.length} values but the chart has ${pointCount} points.${windowHint}`
        );
      }
    }
    const color = pickColor(entry, index, usedFamilies);
    usedFamilies.add(COLOR_FAMILY[color]);
    return {
      key: `s${index}`,
      label: entry.label,
      kind: entry.kind ?? defaultSeriesKind(entry.metric),
      axis: entry.axis ?? "left",
      color,
      dashed: entry.dashed === true,
      metric: entry.metric,
      values
    };
  });

  const { resolved: ranges, dropped } = resolveCoachChartRanges(
    spec.ranges,
    labels,
    dates
  );

  const tiles = (spec.tiles ?? []).map((tile) =>
    resolveTile(tile, {
      trendPoints: options.trendPoints,
      intraday: options.intraday,
      dashboard: options.dashboard
    })
  );
  const freshness = coachChartFreshness(spec.series, spec.tiles ?? []);

  return {
    preview: {
      previewId: options.previewId,
      spec,
      labels,
      dates,
      times,
      series,
      ranges,
      tiles,
      resolvedAt: (options.now ?? new Date()).toISOString(),
      live: freshness !== "snapshot",
      freshness,
      window
    },
    droppedRanges: dropped
  };
}

/** Fill the fields older persisted previews lack, so one shape reaches the renderer. */
export function withCoachChartDefaults(
  preview: Omit<CoachChartPreview, "freshness" | "window" | "tiles" | "live"> &
    Partial<Pick<CoachChartPreview, "freshness" | "window" | "live">> & {
      tiles?: (CoachChartTileSpec | CoachChartResolvedTile)[];
    }
): CoachChartPreview {
  const tiles: CoachChartResolvedTile[] = (preview.tiles ?? []).map((tile) => ({
    ...tile,
    value: tile.value ?? ""
  }));
  const freshness =
    preview.freshness ?? coachChartFreshness(preview.series, tiles);
  const window =
    preview.window ??
    (preview.dates
      ? { kind: "daily" as const, days: preview.spec?.days ?? preview.dates.length }
      : preview.times
        ? { kind: "intraday" as const, days: preview.spec?.days ?? COACH_CHART_INTRADAY_DEFAULT_DAYS }
        : { kind: "static" as const, days: preview.spec?.days ?? COACH_CHART_TILE_DAILY_DAYS });
  return {
    ...preview,
    tiles,
    live: freshness !== "snapshot",
    freshness,
    window
  };
}

function summarize(values: (number | null)[]): {
  count: number;
  avg: number;
  min: number;
  max: number;
} | null {
  const present = values.filter(
    (value): value is number => typeof value === "number"
  );
  if (present.length === 0) return null;
  const sum = present.reduce((total, value) => total + value, 0);
  return {
    count: present.length,
    avg: sum / present.length,
    min: Math.min(...present),
    max: Math.max(...present)
  };
}

export interface DescribeCoachChartExtras {
  droppedRanges?: string[];
  sleepAvailable?: boolean;
  dailyHealthAvailable?: boolean;
  intradayAvailable?: boolean;
}

function emptyReason(metric: string | undefined, extras: DescribeCoachChartExtras): string {
  if (isDailyMetric(metric) && COACH_CHART_SLEEP_METRICS.includes(metric) && extras.sleepAvailable === false) {
    return " — no sleep data (COROS MCP not connected)";
  }
  if (
    isDailyMetric(metric) &&
    COACH_CHART_DAILY_HEALTH_METRICS.includes(metric) &&
    extras.dailyHealthAvailable === false
  ) {
    return " — no daily health data (COROS MCP not connected)";
  }
  if (isIntradayMetric(metric) && extras.intradayAvailable === false) {
    return " — no readings (COROS MCP not connected)";
  }
  return " — no data in this window";
}

/** Text the model receives after a successful render, so it can narrate the chart. */
export function describeCoachChart(
  preview: CoachChartPreview,
  extras: DescribeCoachChartExtras = {}
): string {
  const pointCount = preview.labels.length;
  const windowLabel = preview.dates
    ? `${formatHappenDayShort(preview.dates[0])} – ${formatHappenDayShort(
        preview.dates[preview.dates.length - 1]
      )}`
    : `${preview.labels[0]} – ${preview.labels[pointCount - 1]}`;
  const unit = preview.times ? "hourly points" : "points";
  const lines = [
    `Rendered chart "${preview.spec.title}" inline (${pointCount} ${unit}, ${windowLabel}).`,
    ""
  ];
  for (const entry of preview.series) {
    const stats = summarize(entry.values);
    const source = entry.metric ? `bound ${entry.metric}` : "inline values";
    if (!stats) {
      lines.push(`- ${entry.label} (${source}): empty${emptyReason(entry.metric, extras)}`);
      continue;
    }
    lines.push(
      `- ${entry.label} (${source}): ${stats.count}/${pointCount} points, ` +
        `avg ${formatStat(stats.avg)}, min ${formatStat(stats.min)}, max ${formatStat(stats.max)}`
    );
  }
  if (preview.ranges.length > 0) {
    lines.push(
      "",
      "Shaded ranges: " +
        preview.ranges
          .map(
            (range) =>
              `${range.label ?? "range"} (${preview.labels[range.fromIndex]} – ${
                preview.labels[range.toIndex]
              })`
          )
          .join("; ")
    );
  }
  if (extras.droppedRanges?.length) {
    lines.push(
      `Ignored ranges outside the window or with unknown labels: ${extras.droppedRanges.join(
        "; "
      )}.`
    );
  }
  if (preview.tiles.length > 0) {
    lines.push(
      "Tiles: " +
        preview.tiles
          .map((tile) => {
            const binding = tile.metric ? ` (bound ${tile.metric} ${tile.stat ?? "latest"})` : "";
            const empty =
              tile.metric && tile.value === COACH_CHART_NO_DATA
                ? emptyReason(tile.metric, extras)
                : "";
            return `${tile.label} = ${tile.value}${binding}${empty}`;
          })
          .join("; ")
    );
  }
  lines.push("");
  if (preview.freshness === "live") {
    lines.push(
      "Every series and tile is bound, so if the athlete pins this chart to the Training Hub it refreshes itself."
    );
  } else if (preview.freshness === "partial") {
    lines.push(
      `Inline parts (${coachChartSnapshotParts(preview).join(", ")}) are a snapshot: a pinned copy refreshes only the bound parts. ` +
        'Rebuild them with "metric" bindings if the athlete wants the card to stay current.'
    );
  } else {
    lines.push(
      'Nothing is bound, so a pinned copy of this chart never updates. Use "metric" bindings instead of inline values when the athlete wants a card that stays current.'
    );
  }
  lines.push(
    "The athlete can see the chart. Follow up with 2–4 short takeaways instead of restating every value."
  );
  return lines.join("\n");
}

// ----- Pinned charts -----

export function normalizeCoachChartTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface UpsertPinnedCoachChartResult {
  charts: PinnedCoachChart[];
  pinned: PinnedCoachChart;
  /** True when a pin with the same title was replaced in place. */
  replaced: boolean;
  /** False when the exact preview was already pinned. */
  changed: boolean;
}

/**
 * Pin a chart without stacking duplicates: the same preview is a no-op, a
 * chart with the same title replaces the older pin in place, anything else
 * goes on top.
 */
export function upsertPinnedCoachChart(
  charts: PinnedCoachChart[],
  preview: CoachChartPreview,
  options: { id: string; now: string; maxPinned?: number }
): UpsertPinnedCoachChartResult {
  const existing = charts.find((entry) => entry.preview.previewId === preview.previewId);
  if (existing) {
    return { charts, pinned: existing, replaced: false, changed: false };
  }
  const title = normalizeCoachChartTitle(preview.spec.title);
  const index = charts.findIndex(
    (entry) => normalizeCoachChartTitle(entry.preview.spec.title) === title
  );
  if (index >= 0) {
    const pinned: PinnedCoachChart = { ...charts[index], preview, updatedAt: options.now };
    const next = [...charts];
    next[index] = pinned;
    return { charts: next, pinned, replaced: true, changed: true };
  }
  const pinned: PinnedCoachChart = { id: options.id, preview, pinnedAt: options.now };
  return {
    charts: [pinned, ...charts].slice(0, options.maxPinned ?? COACH_CHART_MAX_PINNED),
    pinned,
    replaced: false,
    changed: true
  };
}
