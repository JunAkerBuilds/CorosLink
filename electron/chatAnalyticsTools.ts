import {
  getDailyMetrics,
  getTrainingAnalytics,
  getTrainingDashboard,
  getTrainingHubStatus
} from "./trainingHubService";
import { buildTrendPoints, mergeTrainingDayLists, recentTrainingHubDateList } from "./trainingTrendUtils";
import type {
  CorosMcpTool,
  FitnessTrendPreview,
  HrZonePreview,
  TrainingHubZoneDistributionEntry
} from "./types";

export const CHAT_ANALYTICS_TOOL_NAMES = [
  "get_fitness_trends",
  "get_hr_zone_summary"
] as const;

export type ChatAnalyticsToolName = (typeof CHAT_ANALYTICS_TOOL_NAMES)[number];

export function isChatAnalyticsTool(name: string): name is ChatAnalyticsToolName {
  return (CHAT_ANALYTICS_TOOL_NAMES as readonly string[]).includes(name);
}

export interface ChatAnalyticsToolCallbacks {
  onFitnessTrend?: (preview: FitnessTrendPreview) => void;
  onHrZoneSummary?: (preview: HrZonePreview) => void;
  requestId?: string;
}

export function getChatAnalyticsTools(): CorosMcpTool[] {
  const hubStatus = getTrainingHubStatus();
  if (!hubStatus.authenticated) {
    return [];
  }

  return [
    {
      name: "get_fitness_trends",
      description:
        "Fetch 7-day training load, resting HR, and HRV vs baseline trends for " +
        "recovery and fitness analysis.",
      inputSchema: {
        type: "object",
        properties: {}
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
    }
  ];
}

export async function handleChatAnalyticsTool(
  name: ChatAnalyticsToolName,
  args: Record<string, unknown>,
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  if (name === "get_fitness_trends") {
    return handleGetFitnessTrends(callbacks);
  }
  return handleGetHrZoneSummary(args, callbacks);
}

async function handleGetFitnessTrends(
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  try {
    const [analytics, dailyMetrics, dashboard] = await Promise.all([
      getTrainingAnalytics(),
      getDailyMetrics(recentTrainingHubDateList(7)),
      getTrainingDashboard()
    ]);

    const dayList = mergeTrainingDayLists(dailyMetrics, analytics);
    const trendPoints = buildTrendPoints(dayList);
    const preview = buildFitnessTrendPreview(trendPoints, callbacks?.requestId);

    if (preview && callbacks?.onFitnessTrend) {
      callbacks.onFitnessTrend(preview);
    }

    if (trendPoints.length === 0) {
      return "No fitness trend data available for the last 7 days.";
    }

    const lines = ["Fitness trends (last 7 days):", ""];
    for (const point of trendPoints) {
      const parts = [
        point.label,
        point.trainingLoad != null ? `load ${Math.round(point.trainingLoad)}` : undefined,
        point.rhr != null ? `RHR ${Math.round(point.rhr)} bpm` : undefined,
        point.avgSleepHrv != null
          ? `HRV ${Math.round(point.avgSleepHrv)}`
          : undefined,
        point.sleepHrvBase != null
          ? `baseline ${Math.round(point.sleepHrvBase)}`
          : undefined
      ].filter(Boolean);
      lines.push(`- ${parts.join(" · ")}`);
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
          `- ${zone.label}: ${zone.percent.toFixed(1)}% (${Math.round(zone.value)})`
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
    previewId: `fitness-trends:${requestId ?? "static"}`,
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
