import {
  getTrainingHubStatus,
  getTrainingHubActivityDetail,
  listTrainingHubActivities,
  downsampleActivitySeries,
  formatActivitySeriesForChat
} from "./trainingHubService";
import type {
  ActivityHrTrendPreview,
  ActivityVisualLapPoint,
  ActivityVisualPreview,
  CorosMcpTool,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityLap
} from "./types";

export const CHAT_ACTIVITY_TOOL_NAMES = [
  "list_recent_activities",
  "get_activity_detail"
] as const;

export type ChatActivityToolName = (typeof CHAT_ACTIVITY_TOOL_NAMES)[number];

const MAX_LAPS = 50;

export function isChatActivityTool(name: string): name is ChatActivityToolName {
  return (CHAT_ACTIVITY_TOOL_NAMES as readonly string[]).includes(name);
}

export function getChatActivityTools(): CorosMcpTool[] {
  const hubStatus = getTrainingHubStatus();
  if (!hubStatus.authenticated) {
    return [];
  }

  return [
    {
      name: "list_recent_activities",
      description:
        "List recent COROS activities with activity_id and sport_type needed for " +
        "get_activity_detail. Prefer this over COROS MCP when you need reliable lap data.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of activities to return (default 10, max 25)"
          },
          page: {
            type: "number",
            description: "Page number for pagination (default 1)"
          }
        }
      }
    },
    {
      name: "get_activity_detail",
      description:
        "Fetch detailed COROS activity data including lap/split breakdown (distance, " +
        "duration, avg/max HR, pace). Use activity_id and sport_type from " +
        "list_recent_activities or the training snapshot. Prefer this local tool over " +
        "COROS MCP for lap and split analysis.",
      inputSchema: {
        type: "object",
        properties: {
          activity_id: {
            type: "string",
            description: "COROS activity ID (labelId)"
          },
          sport_type: {
            type: "number",
            description: "COROS sport type code from the activity list"
          },
          include_series: {
            type: "boolean",
            description:
              "Include downsampled HR/pace/power progression (~60 points). Default false."
          }
        },
        required: ["activity_id", "sport_type"]
      }
    }
  ];
}

export interface ChatActivityToolCallbacks {
  onActivityVisual?: (preview: ActivityVisualPreview) => void;
  requestId?: string;
}

export async function handleChatActivityTool(
  name: ChatActivityToolName,
  args: Record<string, unknown>,
  callbacks?: ChatActivityToolCallbacks
): Promise<string> {
  if (name === "list_recent_activities") {
    return handleListRecentActivities(args);
  }
  return handleGetActivityDetail(args, callbacks);
}

async function handleListRecentActivities(
  args: Record<string, unknown>
): Promise<string> {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  const page = Math.max(Number(args.page) || 1, 1);

  try {
    const activities = await listTrainingHubActivities(page, limit);
    if (activities.length === 0) {
      return "No recent activities found in COROS Training Hub.";
    }

    const lines = activities.map((activity) => formatActivityListLine(activity));
    return [
      `Recent activities (${activities.length}):`,
      "",
      ...lines,
      "",
      "Use get_activity_detail with activity_id and sport_type for lap splits."
    ].join("\n");
  } catch (caught) {
    throw formatActivityToolError("list_recent_activities", caught);
  }
}

async function handleGetActivityDetail(
  args: Record<string, unknown>,
  callbacks?: ChatActivityToolCallbacks
): Promise<string> {
  const activityId = String(args.activity_id ?? args.activityId ?? "").trim();
  const sportType = Number(args.sport_type ?? args.sportType);

  if (!activityId) {
    throw new Error(
      "activity_id is required. Call list_recent_activities first to find the correct ID."
    );
  }
  if (!Number.isFinite(sportType)) {
    throw new Error(
      "sport_type is required. Copy it from list_recent_activities or the training snapshot."
    );
  }

  const includeSeries = args.include_series === true || args.includeSeries === true;

  try {
    const listActivities = await listTrainingHubActivities(1, 50);
    const listActivity = listActivities.find(
      (activity) => activity.activityId === activityId
    );
    const detail = await getTrainingHubActivityDetail(
      activityId,
      sportType,
      listActivity
    );

    if (!detail.laps.length && !detail.duration && !detail.distance) {
      return (
        `No activity detail found for activity_id=${activityId} sport_type=${sportType}. ` +
        "Check the ID and sport type from list_recent_activities."
      );
    }

    if (callbacks?.onActivityVisual && callbacks.requestId) {
      const preview = buildActivityVisualPreview(detail, callbacks.requestId);
      if (preview) {
        callbacks.onActivityVisual(preview);
      }
    }

    return formatActivityDetailForChat(detail, includeSeries);
  } catch (caught) {
    throw formatActivityToolError("get_activity_detail", caught);
  }
}

function mapLapPoints(laps: TrainingHubActivityLap[]): ActivityVisualLapPoint[] {
  return laps.slice(0, MAX_LAPS).map((lap) => ({
    index: lap.index,
    avgHr: lap.avgHr,
    maxHr: lap.maxHr,
    distance: lap.distance,
    duration: lap.duration,
    pace: lap.pace
  }));
}

export function migrateActivityHrTrendPreview(
  legacy: ActivityHrTrendPreview
): ActivityVisualPreview {
  return {
    previewId: legacy.previewId,
    activityId: legacy.activityId,
    name: legacy.name,
    startTime: legacy.startTime,
    avgHr: legacy.avgHr,
    maxHr: legacy.maxHr,
    sections: {
      hr: {
        chartKind: legacy.chartKind,
        series: legacy.series,
        laps: legacy.laps
      }
    }
  };
}

export function buildActivityVisualPreview(
  detail: TrainingHubActivityDetail,
  requestId: string
): ActivityVisualPreview | null {
  const activityId = detail.activityId?.trim();
  if (!activityId) {
    return null;
  }

  const downsampled =
    detail.series && detail.series.length > 0
      ? downsampleActivitySeries(detail.series)
      : [];

  const sections: ActivityVisualPreview["sections"] = {};

  const hrSeriesPoints = downsampled.filter(
    (point) => point.hr !== undefined && Number.isFinite(point.hr)
  );
  const hrLaps = detail.laps.filter(
    (lap) => lap.avgHr !== undefined && Number.isFinite(lap.avgHr)
  );

  if (hrSeriesPoints.length >= 2) {
    sections.hr = { chartKind: "series", series: downsampled };
  } else if (hrLaps.length >= 2) {
    sections.hr = {
      chartKind: "laps",
      laps: mapLapPoints(hrLaps)
    };
  }

  const pacePoints = downsampled.filter(
    (point) => point.pace !== undefined && Number.isFinite(point.pace)
  );
  if (pacePoints.length >= 2) {
    sections.pace = { series: downsampled };
  }

  const powerPoints = downsampled.filter(
    (point) => point.power !== undefined && Number.isFinite(point.power)
  );
  if (powerPoints.length >= 2) {
    sections.power = { series: downsampled };
  }

  const elevationPoints = (detail.track?.points ?? []).filter(
    (point) => point.elevation !== undefined && Number.isFinite(point.elevation)
  );
  if (elevationPoints.length >= 2) {
    sections.elevation = { points: elevationPoints };
  }

  if (detail.laps.length > 0) {
    sections.laps = mapLapPoints(detail.laps);
  }

  if (
    !sections.hr &&
    !sections.pace &&
    !sections.power &&
    !sections.elevation &&
    !sections.laps
  ) {
    return null;
  }

  return {
    previewId: `${activityId}:${requestId}`,
    activityId,
    name: detail.name,
    startTime: detail.startTime ? formatIsoDate(detail.startTime) : undefined,
    avgHr: detail.avgHr,
    maxHr: detail.maxHr,
    sections
  };
}

/** @deprecated Use buildActivityVisualPreview */
export function buildActivityHrTrendPreview(
  detail: TrainingHubActivityDetail,
  requestId: string
): ActivityHrTrendPreview | null {
  const preview = buildActivityVisualPreview(detail, requestId);
  if (!preview?.sections.hr) {
    return null;
  }

  const hr = preview.sections.hr;
  return {
    previewId: preview.previewId,
    activityId: preview.activityId,
    name: preview.name,
    startTime: preview.startTime,
    avgHr: preview.avgHr,
    maxHr: preview.maxHr,
    chartKind: hr.chartKind,
    series: hr.series,
    laps: hr.laps
  };
}

function formatActivityToolError(tool: string, caught: unknown): Error {
  const detail = caught instanceof Error ? caught.message : String(caught);
  if (/not authenticated|sign in/i.test(detail)) {
    return new Error(
      `${tool} failed: Training Hub is not signed in. Ask the athlete to connect COROS in Settings.`
    );
  }
  if (/not found|404/i.test(detail)) {
    return new Error(
      `${tool} failed: activity not found. Verify activity_id and sport_type from list_recent_activities.`
    );
  }
  return new Error(`${tool} failed: ${detail}`);
}

function formatActivityListLine(activity: TrainingHubActivity): string {
  const parts = [
    `id=${activity.activityId}`,
    `sport_type=${activity.sportType}`,
    activity.startTime ? formatIsoDate(activity.startTime) : undefined,
    activity.sportName ?? undefined,
    activity.name ?? undefined,
    activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : undefined,
    activity.duration ? formatDurationSeconds(activity.duration) : undefined,
    activity.avgHr ? `avg HR ${activity.avgHr}` : undefined,
    activity.maxHr ? `max HR ${activity.maxHr}` : undefined,
    activity.trainingLoad ? `load ${activity.trainingLoad}` : undefined
  ].filter(Boolean);
  return `- ${parts.join(" · ")}`;
}

export function formatActivityDetailForChat(
  detail: TrainingHubActivityDetail,
  includeSeries: boolean
): string {
  const summaryParts = [
    detail.name ? `Name: ${detail.name}` : undefined,
    detail.activityId ? `Activity ID: ${detail.activityId}` : undefined,
    detail.sportType !== undefined ? `Sport type: ${detail.sportType}` : undefined,
    detail.startTime ? `Date: ${formatIsoDate(detail.startTime)}` : undefined,
    detail.distance ? `Distance: ${(detail.distance / 1000).toFixed(2)} km` : undefined,
    detail.duration ? `Duration: ${formatDurationSeconds(detail.duration)}` : undefined,
    detail.avgHr ? `Avg HR: ${detail.avgHr} bpm` : undefined,
    detail.maxHr ? `Max HR: ${detail.maxHr} bpm` : undefined,
    detail.elevationGain
      ? `Elevation gain: +${Math.round(detail.elevationGain)} m`
      : undefined,
    detail.trainingLoad ? `Training load: ${detail.trainingLoad}` : undefined,
    detail.calories ? `Calories: ${Math.round(detail.calories)}` : undefined
  ].filter(Boolean);

  const sections = ["Activity detail", summaryParts.join("\n")];

  if (detail.laps.length > 0) {
    sections.push("", formatLapTable(detail.laps));
  } else {
    sections.push("", "Laps: none recorded for this activity.");
  }

  if (includeSeries) {
    sections.push("");
    if (detail.series && detail.series.length > 0) {
      sections.push(formatActivitySeriesForChat(downsampleActivitySeries(detail.series)));
    } else {
      sections.push(
        "Time series: HR/pace samples are not available in the COROS detail response for this activity. " +
          "For full per-second data, export the FIT file from CorosLink."
      );
    }
  }

  return sections.join("\n");
}

function formatLapTable(laps: TrainingHubActivityLap[]): string {
  const capped = laps.slice(0, MAX_LAPS);
  const header = "Lap | Distance | Duration | Avg HR | Max HR | Pace";
  const rows = capped.map((lap) => {
    const cols = [
      String(lap.index),
      lap.distance ? `${(lap.distance / 1000).toFixed(2)} km` : "—",
      lap.duration ? formatDurationSeconds(lap.duration) : "—",
      lap.avgHr ? `${lap.avgHr}` : "—",
      lap.maxHr ? `${lap.maxHr}` : "—",
      lap.pace ? formatPaceSeconds(lap.pace) : "—"
    ];
    return cols.join(" | ");
  });

  const lines = ["Laps:", header, ...rows];
  if (laps.length > MAX_LAPS) {
    lines.push(`… ${laps.length - MAX_LAPS} more laps omitted`);
  }
  return lines.join("\n");
}

function formatIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function formatDurationSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPaceSeconds(paceSecondsPerKm: number): string {
  const total = Math.max(0, Math.round(paceSecondsPerKm));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

export { formatDurationSeconds, formatPaceSeconds };
