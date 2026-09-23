import type {
  CoachChartAxis,
  CoachChartColor,
  CoachChartMetricKey,
  CoachChartPreview,
  CoachChartRangeSpec,
  CoachChartResolvedRange,
  CoachChartResolvedSeries,
  CoachChartSeriesKind,
  CoachChartSeriesSpec,
  CoachChartSpec,
  CoachChartTileSpec,
  TrainingTrendPoint
} from "./types";

export const COACH_CHART_MIN_DAYS = 7;
export const COACH_CHART_MAX_DAYS = 90;
export const COACH_CHART_DEFAULT_DAYS = 30;
export const COACH_CHART_MAX_SERIES = 6;
export const COACH_CHART_MAX_POINTS = 366;

export const COACH_CHART_METRIC_KEYS: readonly CoachChartMetricKey[] = [
  "trainingLoad",
  "rpeLoad",
  "avgSleepHrv",
  "sleepHrvBase",
  "rhr",
  "sleepScore",
  "sleepMinutes",
  "trainingLoadRatio",
  "staminaLevel"
];

export const COACH_CHART_SLEEP_METRICS: readonly CoachChartMetricKey[] = [
  "sleepScore",
  "sleepMinutes"
];

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

const METRIC_DEFAULT_COLOR: Record<CoachChartMetricKey, CoachChartColor> = {
  trainingLoad: "load",
  rpeLoad: "rpe",
  avgSleepHrv: "hrv",
  sleepHrvBase: "gold",
  rhr: "gold",
  sleepScore: "sleep",
  sleepMinutes: "sleep",
  trainingLoadRatio: "accent",
  staminaLevel: "accent"
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
  const metric = optionalEnum(value.metric, COACH_CHART_METRIC_KEYS, `${field}.metric`);
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
  const rawValue = value.value;
  const tileValue =
    typeof rawValue === "number" && Number.isFinite(rawValue)
      ? String(rawValue)
      : requiredString(rawValue, `${field}.value`);
  return {
    label: requiredString(value.label, `${field}.label`),
    value: tileValue,
    caption: optionalString(value.caption, `${field}.caption`)
  };
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

  let days: number | undefined;
  if (value.days !== undefined && value.days !== null) {
    const numeric =
      typeof value.days === "string" ? Number(value.days) : value.days;
    if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
      throw new CoachChartSpecError("days must be a number.");
    }
    days = Math.min(
      COACH_CHART_MAX_DAYS,
      Math.max(COACH_CHART_MIN_DAYS, Math.round(numeric))
    );
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

  const hasBound = series.some((entry) => entry.metric);
  if (!hasBound) {
    if (!labels || labels.length < 2) {
      throw new CoachChartSpecError(
        "labels (at least 2) are required when no series binds a metric."
      );
    }
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
  return spec.series.some(
    (entry) => entry.metric && COACH_CHART_SLEEP_METRICS.includes(entry.metric)
  );
}

export function coachChartWindowDays(spec: CoachChartSpec): number {
  return spec.days ?? COACH_CHART_DEFAULT_DAYS;
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

function defaultSeriesKind(metric?: CoachChartMetricKey): CoachChartSeriesKind {
  return metric === "trainingLoad" || metric === "rpeLoad" ? "bar" : "line";
}

function metricValue(
  point: TrainingTrendPoint,
  metric: CoachChartMetricKey
): number | null {
  const value = point[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ResolveCoachChartOptions {
  previewId: string;
  /** Daily points for the requested window; required when any series is bound. */
  trendPoints?: TrainingTrendPoint[];
  /** False when sleep metrics were requested but COROS MCP was unavailable. */
  sleepAvailable?: boolean;
  now?: Date;
}

/**
 * Turn a validated spec into a renderer-ready preview. Pure: all data comes
 * from the spec and the supplied trend window.
 */
export function resolveCoachChart(
  spec: CoachChartSpec,
  options: ResolveCoachChartOptions
): { preview: CoachChartPreview; droppedRanges: string[] } {
  const bound = coachChartUsesMetrics(spec);
  let labels: string[];
  let dates: string[] | undefined;

  if (bound) {
    const points = options.trendPoints ?? [];
    if (points.length === 0) {
      throw new CoachChartSpecError(
        "No daily training data is available for the requested window."
      );
    }
    dates = points.map((point) => point.date);
    labels = dates.map((date) => formatHappenDayShort(date));
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
    if (entry.metric) {
      const metric = entry.metric;
      values = (options.trendPoints ?? []).map((point) => metricValue(point, metric));
    } else {
      values = entry.values ?? [];
      if (values.length !== pointCount) {
        const windowHint =
          bound && dates
            ? ` The window has ${pointCount} days (${formatHappenDayShort(
                dates[0]
              )} – ${formatHappenDayShort(dates[dates.length - 1])}); ` +
              "inline values must supply one entry per day, using null for gaps."
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

  return {
    preview: {
      previewId: options.previewId,
      spec,
      labels,
      dates,
      series,
      ranges,
      tiles: spec.tiles ?? [],
      resolvedAt: (options.now ?? new Date()).toISOString(),
      live: bound
    },
    droppedRanges: dropped
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

function formatStat(value: number): string {
  return Math.abs(value) >= 100 || Number.isInteger(value)
    ? String(Math.round(value))
    : value.toFixed(1);
}

/** Text the model receives after a successful render, so it can narrate the chart. */
export function describeCoachChart(
  preview: CoachChartPreview,
  extras: { droppedRanges?: string[]; sleepAvailable?: boolean } = {}
): string {
  const pointCount = preview.labels.length;
  const windowLabel = preview.dates
    ? `${formatHappenDayShort(preview.dates[0])} – ${formatHappenDayShort(
        preview.dates[preview.dates.length - 1]
      )}`
    : `${preview.labels[0]} – ${preview.labels[pointCount - 1]}`;
  const lines = [
    `Rendered chart "${preview.spec.title}" inline (${pointCount} points, ${windowLabel}).`,
    ""
  ];
  for (const entry of preview.series) {
    const stats = summarize(entry.values);
    const source = entry.metric ? `bound ${entry.metric}` : "inline values";
    if (!stats) {
      const reason =
        entry.metric &&
        COACH_CHART_SLEEP_METRICS.includes(entry.metric) &&
        extras.sleepAvailable === false
          ? " — no sleep data (COROS MCP not connected)"
          : " — no data in this window";
      lines.push(`- ${entry.label} (${source}): empty${reason}`);
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
        preview.tiles.map((tile) => `${tile.label} = ${tile.value}`).join("; ")
    );
  }
  lines.push(
    "",
    "The athlete can see the chart. Follow up with 2–4 short takeaways instead of restating every value."
  );
  return lines.join("\n");
}
