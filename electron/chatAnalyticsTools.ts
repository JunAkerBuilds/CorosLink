import { loadTrendWindow, renderCoachChart } from "./coachChartService";
import {
  COACH_CHART_DEFAULT_DAYS,
  COACH_CHART_MAX_DAYS,
  COACH_CHART_METRIC_KEYS,
  COACH_CHART_MIN_DAYS,
  CoachChartSpecError
} from "./coachChartUtils";
import {
  getTrainingAnalytics,
  getTrainingDashboard,
  getTrainingHubStatus
} from "./trainingHubService";
import type {
  CoachChartPreview,
  CorosMcpTool,
  FitnessTrendPreview,
  HrZonePreview,
  TrainingHubZoneDistributionEntry,
  TrainingTrendPoint,
  UnitSystem
} from "./types";
import { formatDistanceValue } from "./unitSystem.js";

export const CHAT_ANALYTICS_TOOL_NAMES = [
  "get_fitness_trends",
  "get_hr_zone_summary",
  "render_chart"
] as const;

const FITNESS_TREND_DEFAULT_DAYS = 7;

export type ChatAnalyticsToolName = (typeof CHAT_ANALYTICS_TOOL_NAMES)[number];

export function isChatAnalyticsTool(name: string): name is ChatAnalyticsToolName {
  return (CHAT_ANALYTICS_TOOL_NAMES as readonly string[]).includes(name);
}

export interface ChatAnalyticsToolCallbacks {
  onFitnessTrend?: (preview: FitnessTrendPreview) => void;
  onHrZoneSummary?: (preview: HrZonePreview) => void;
  onCoachChart?: (preview: CoachChartPreview) => void;
  requestId?: string;
  unitSystem?: UnitSystem;
}

const RENDER_CHART_TOOL: CorosMcpTool = {
  name: "render_chart",
  description:
    "Draw a chart inline in the chat. Use it whenever the athlete asks to see, chart, graph, " +
    "compare, or visualize a trend, or when a multi-week pattern is clearer as a picture. " +
    "Prefer metric-bound series (set `metric`) so CorosLink fetches the daily numbers itself " +
    "over the last `days` days; only pass inline `values` for derived series (e.g. a 7-day " +
    "rolling load) and match the window length exactly, using null for gaps. Shade training " +
    "blocks with `ranges` and add per-block summaries with `tiles`. Up to 6 series. " +
    "The tool returns per-series stats so you can narrate the chart afterwards.",
  inputSchema: {
    type: "object",
    required: ["title", "series"],
    properties: {
      title: { type: "string", description: "Short chart title." },
      subtitle: { type: "string", description: "Optional one-line context." },
      days: {
        type: "integer",
        minimum: COACH_CHART_MIN_DAYS,
        maximum: COACH_CHART_MAX_DAYS,
        description:
          `Window for metric-bound series, ${COACH_CHART_MIN_DAYS}–${COACH_CHART_MAX_DAYS} days ending today. Default ${COACH_CHART_DEFAULT_DAYS}.`
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description:
          "X-axis labels for inline-only charts (ignored when any series binds a metric). Use YYYY-MM-DD when the axis is a date so ranges can reference dates."
      },
      series: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          required: ["label"],
          properties: {
            label: { type: "string" },
            metric: {
              type: "string",
              enum: [...COACH_CHART_METRIC_KEYS],
              description:
                "Daily metric to bind: trainingLoad (daily load), rpeLoad (session-RPE load), avgSleepHrv (overnight HRV ms), sleepHrvBase (HRV baseline), rhr (resting HR), sleepScore, sleepMinutes, trainingLoadRatio, staminaLevel."
            },
            values: {
              type: "array",
              items: { type: ["number", "null"] },
              description: "Inline values, one per x-axis point; null for gaps."
            },
            kind: { type: "string", enum: ["line", "area", "bar"] },
            axis: {
              type: "string",
              enum: ["left", "right"],
              description: "Put series with different units on different axes."
            },
            color: {
              type: "string",
              enum: ["load", "hrv", "sleep", "rpe", "gold", "blue", "accent", "muted"]
            },
            dashed: { type: "boolean" }
          }
        }
      },
      ranges: {
        type: "array",
        items: {
          type: "object",
          required: ["from", "to"],
          properties: {
            from: { type: "string", description: "Start date (YYYY-MM-DD) or label, inclusive." },
            to: { type: "string", description: "End date (YYYY-MM-DD) or label, inclusive." },
            label: { type: "string" }
          }
        },
        description: "Shaded spans, e.g. a heavy training block or taper."
      },
      tiles: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "value"],
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            caption: { type: "string" }
          }
        },
        description: "Summary stat tiles shown above the chart."
      },
      leftAxisLabel: { type: "string" },
      rightAxisLabel: { type: "string" },
      note: { type: "string", description: "One-line footnote under the chart." }
    }
  }
};

export function getChatAnalyticsTools(): CorosMcpTool[] {
  const hubStatus = getTrainingHubStatus();
  if (!hubStatus.authenticated) {
    // render_chart still works with inline values (e.g. numbers from COROS MCP).
    return [RENDER_CHART_TOOL];
  }

  return [
    {
      name: "get_fitness_trends",
      description:
        "Fetch daily training load, resting HR, HRV vs baseline, and sleep score " +
        "for the last N days (default 7, up to 90) for recovery and fitness analysis. " +
        "Windows longer than 14 days also include weekly averages.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            minimum: COACH_CHART_MIN_DAYS,
            maximum: COACH_CHART_MAX_DAYS,
            description: `Number of days ending today. Default ${FITNESS_TREND_DEFAULT_DAYS}.`
          }
        }
      }
    },
    {
      name: "get_hr_zone_summary",
      description:
        "Fetch threshold heart rate zone distribution (time, distance, or training load).",
      inputSchema: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["time", "distance", "trainingLoad"],
            description: "Zone breakdown metric. Default trainingLoad."
          }
        }
      }
    },
    RENDER_CHART_TOOL
  ];
}

export async function handleChatAnalyticsTool(
  name: ChatAnalyticsToolName,
  args: Record<string, unknown>,
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  if (name === "get_fitness_trends") {
    return handleGetFitnessTrends(args, callbacks);
  }
  if (name === "render_chart") {
    return handleRenderChart(args, callbacks);
  }
  return handleGetHrZoneSummary(args, callbacks);
}

export function parseFitnessTrendDays(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return FITNESS_TREND_DEFAULT_DAYS;
  }
  return Math.min(
    COACH_CHART_MAX_DAYS,
    Math.max(COACH_CHART_MIN_DAYS, Math.round(numeric))
  );
}

function average(values: (number | undefined)[]): number | undefined {
  const present = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (present.length === 0) return undefined;
  return present.reduce((total, value) => total + value, 0) / present.length;
}

function formatMetric(value: number | undefined, digits = 0): string {
  return value === undefined ? "–" : value.toFixed(digits);
}

/** Weekly (7-day bucket) averages, newest bucket last, for long windows. */
export function buildWeeklyTrendSummary(points: TrainingTrendPoint[]): string[] {
  const lines: string[] = [];
  for (let start = 0; start < points.length; start += 7) {
    const bucket = points.slice(start, start + 7);
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    const load = bucket.map((point) => point.trainingLoad ?? 0).reduce((a, b) => a + b, 0);
    lines.push(
      `- ${first.label}–${last.label}: load ${Math.round(load)} total · ` +
        `HRV ${formatMetric(average(bucket.map((p) => p.avgSleepHrv)))} · ` +
        `RHR ${formatMetric(average(bucket.map((p) => p.rhr)))} · ` +
        `sleep ${formatMetric(average(bucket.map((p) => p.sleepScore)))}`
    );
  }
  return lines;
}

export function formatFitnessTrendLines(
  points: TrainingTrendPoint[],
  days: number
): string[] {
  const lines = [`Fitness trends (last ${days} days):`, ""];
  for (const point of points) {
    const parts = [
      point.label,
      point.trainingLoad != null ? `load ${Math.round(point.trainingLoad)}` : undefined,
      point.rhr != null ? `RHR ${Math.round(point.rhr)} bpm` : undefined,
      point.avgSleepHrv != null ? `HRV ${Math.round(point.avgSleepHrv)}` : undefined,
      point.sleepHrvBase != null ? `baseline ${Math.round(point.sleepHrvBase)}` : undefined,
      point.sleepScore != null ? `sleep ${Math.round(point.sleepScore)}` : undefined,
      point.sleepMinutes != null
        ? `slept ${Math.floor(point.sleepMinutes / 60)}h${String(
            Math.round(point.sleepMinutes % 60)
          ).padStart(2, "0")}`
        : undefined
    ].filter(Boolean);
    lines.push(`- ${parts.join(" · ")}`);
  }
  if (days > 14 && points.length > 7) {
    lines.push("", "Weekly summary:", ...buildWeeklyTrendSummary(points));
  }
  return lines;
}

async function handleGetFitnessTrends(
  args: Record<string, unknown>,
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  const days = parseFitnessTrendDays(args.days);
  try {
    const [window, dashboard] = await Promise.all([
      loadTrendWindow(days, true),
      getTrainingDashboard()
    ]);

    const trendPoints = window.points;
    const preview = buildFitnessTrendPreview(trendPoints, callbacks?.requestId);

    if (preview && callbacks?.onFitnessTrend) {
      callbacks.onFitnessTrend(preview);
    }

    if (trendPoints.length === 0) {
      return `No fitness trend data available for the last ${days} days.`;
    }

    const lines = formatFitnessTrendLines(trendPoints, days);
    if (!window.sleepAvailable) {
      lines.push(
        "",
        "Sleep score is unavailable (COROS MCP not connected or no sleep records)."
      );
    }

    if (dashboard.rhr != null) {
      lines.push("", `Latest resting HR: ${dashboard.rhr} bpm`);
    }
    if (dashboard.recoveryPct != null) {
      lines.push(`Recovery: ${dashboard.recoveryPct}%`);
    }

    return lines.join("\n");
  } catch (caught) {
    throw formatAnalyticsToolError("get_fitness_trends", caught);
  }
}

async function handleRenderChart(
  args: Record<string, unknown>,
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  try {
    const { preview, text } = await renderCoachChart(
      args,
      callbacks?.requestId ?? "static"
    );
    callbacks?.onCoachChart?.(preview);
    return text;
  } catch (caught) {
    if (caught instanceof CoachChartSpecError) {
      // Spec problems are the model's to fix: hand back the exact complaint.
      throw new Error(`render_chart rejected the chart: ${caught.message}`);
    }
    throw formatAnalyticsToolError("render_chart", caught);
  }
}

async function handleGetHrZoneSummary(
  args: Record<string, unknown>,
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  const metricArg = String(args.metric ?? "trainingLoad");
  const metric =
    metricArg === "time" || metricArg === "distance" || metricArg === "trainingLoad"
      ? metricArg
      : "trainingLoad";

  try {
    const [analytics, dashboard] = await Promise.all([
      getTrainingAnalytics(),
      getTrainingDashboard()
    ]);

    const preview = buildHrZonePreview(
      analytics.zoneDistributions,
      dashboard.lthrZones ?? [],
      metric,
      callbacks?.requestId ?? "unknown"
    );

    if (preview && callbacks?.onHrZoneSummary) {
      callbacks.onHrZoneSummary(preview);
    }

    if (!preview) {
      return "No heart rate zone distribution data available.";
    }

    const metricLabel =
      metric === "time"
        ? "time"
        : metric === "distance"
          ? "distance"
          : "training load";

    const lines = [
      `Heart rate zone distribution (${metricLabel}):`,
      "",
      ...preview.zones.map(
        (zone) =>
          `- ${zone.label}: ${zone.percent.toFixed(1)}% (${
            metric === "distance"
              ? formatDistanceValue(zone.value, callbacks?.unitSystem ?? "metric")
              : Math.round(zone.value)
          })`
      )
    ];

    return lines.join("\n");
  } catch (caught) {
    throw formatAnalyticsToolError("get_hr_zone_summary", caught);
  }
}

export function buildFitnessTrendPreview(
  trendPoints: FitnessTrendPreview["trendPoints"],
  requestId?: string
): FitnessTrendPreview | null {
  if (trendPoints.length === 0) {
    return null;
  }

  return {
    previewId: `fitness-trends:${requestId ?? "static"}:${trendPoints.length}`,
    trendPoints
  };
}

export function buildHrZonePreview(
  distributions: {
    hrTrainingLoad: TrainingHubZoneDistributionEntry[];
    hrDistance: TrainingHubZoneDistributionEntry[];
    hrTime: TrainingHubZoneDistributionEntry[];
  },
  lthrZones: HrZonePreview["lthrZones"],
  metric: HrZonePreview["metric"],
  requestId: string
): HrZonePreview | null {
  const areaList =
    metric === "time"
      ? distributions.hrTime
      : metric === "distance"
        ? distributions.hrDistance
        : distributions.hrTrainingLoad;

  if (areaList.length === 0) {
    return null;
  }

  const total = areaList.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  if (total <= 0) {
    return null;
  }

  const zones = areaList.map((entry, index) => {
    const zoneIndex = entry.index ?? index + 1;
    const value = entry.value ?? 0;
    return {
      index: zoneIndex,
      label: `Zone ${zoneIndex}`,
      percent: (value / total) * 100,
      value
    };
  });

  return {
    previewId: `hr-zones:${metric}:${requestId}`,
    metric,
    zones,
    lthrZones
  };
}

function formatAnalyticsToolError(tool: string, caught: unknown): Error {
  const detail = caught instanceof Error ? caught.message : String(caught);
  if (/not authenticated|sign in/i.test(detail)) {
    return new Error(
      `${tool} failed: Training Hub is not signed in. Ask the athlete to connect COROS in Settings.`
    );
  }
  return new Error(`${tool} failed: ${detail}`);
}
