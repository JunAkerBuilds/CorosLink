import crypto from "node:crypto";
import {
  coachChartNeedsSleep,
  coachChartUsesMetrics,
  coachChartWindowDays,
  describeCoachChart,
  parseCoachChartSpec,
  resolveCoachChart,
  CoachChartSpecError
} from "./coachChartUtils";
import { ensureCorosMcpConnected } from "./corosMcpService";
import { getSetting, setSetting } from "./database";
import { getTrainingSleepData } from "./sleepDataService";
import {
  getDailyMetrics,
  getTrainingAnalytics,
  getTrainingHubStatus
} from "./trainingHubService";
import {
  buildTrendPoints,
  mergeSleepIntoTrendPoints,
  mergeTrainingDayLists,
  recentTrainingHubDateList
} from "./trainingTrendUtils";
import type {
  CoachChartPreview,
  CoachChartSpec,
  PinnedCoachChart,
  TrainingTrendPoint
} from "./types";

const PINNED_CHARTS_KEY = "coach.pinnedCharts";
const MAX_PINNED_CHARTS = 12;

export interface TrendWindow {
  points: TrainingTrendPoint[];
  sleepAvailable: boolean;
}

/**
 * Daily trend points for the last `days` days: Training Hub daily metrics
 * merged with analytics, plus sleep score/duration from COROS MCP when a
 * session is already available (never prompts for sign-in mid-chat).
 */
export async function loadTrendWindow(
  days: number,
  includeSleep: boolean
): Promise<TrendWindow> {
  const [analytics, dailyMetrics] = await Promise.all([
    getTrainingAnalytics(),
    getDailyMetrics(recentTrainingHubDateList(days))
  ]);
  const dayList = mergeTrainingDayLists(dailyMetrics, analytics);
  let points = buildTrendPoints(dayList, days);
  let sleepAvailable = false;

  if (includeSleep && points.length > 0) {
    try {
      if (await ensureCorosMcpConnected()) {
        const sleep = await getTrainingSleepData(null, days);
        sleepAvailable = sleep.mcpConnected && sleep.records.length > 0;
        points = mergeSleepIntoTrendPoints(points, sleep);
      }
    } catch (error) {
      console.warn("[coachChartService] sleep merge skipped:", error);
    }
  }

  return { points, sleepAvailable };
}

async function resolveSpec(
  spec: CoachChartSpec,
  previewId: string
): Promise<{ preview: CoachChartPreview; text: string }> {
  let window: TrendWindow | undefined;
  if (coachChartUsesMetrics(spec)) {
    if (!getTrainingHubStatus().authenticated) {
      throw new CoachChartSpecError(
        "Metric-bound series need Training Hub. Ask the athlete to connect COROS in Settings, or pass inline values instead."
      );
    }
    window = await loadTrendWindow(
      coachChartWindowDays(spec),
      coachChartNeedsSleep(spec)
    );
  }

  const { preview, droppedRanges } = resolveCoachChart(spec, {
    previewId,
    trendPoints: window?.points,
    sleepAvailable: window?.sleepAvailable
  });
  const text = describeCoachChart(preview, {
    droppedRanges,
    sleepAvailable: window ? window.sleepAvailable : undefined
  });
  return { preview, text };
}

/** Validate + resolve a render_chart call. Throws Error with a model-readable message. */
export async function renderCoachChart(
  args: Record<string, unknown>,
  requestId: string
): Promise<{ preview: CoachChartPreview; text: string }> {
  const spec = parseCoachChartSpec(args);
  const previewId = `coach-chart:${requestId}:${crypto.randomUUID().slice(0, 8)}`;
  return resolveSpec(spec, previewId);
}

// ----- Pinned charts -----

function readPinned(): PinnedCoachChart[] {
  const raw = getSetting(PINNED_CHARTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is PinnedCoachChart =>
            typeof entry === "object" &&
            entry !== null &&
            typeof entry.id === "string" &&
            typeof entry.pinnedAt === "string" &&
            typeof entry.preview === "object" &&
            entry.preview !== null
        )
      : [];
  } catch {
    return [];
  }
}

function writePinned(charts: PinnedCoachChart[]): void {
  setSetting(PINNED_CHARTS_KEY, JSON.stringify(charts));
}

export function listPinnedCoachCharts(): PinnedCoachChart[] {
  return readPinned();
}

export function pinCoachChart(preview: CoachChartPreview): PinnedCoachChart {
  const charts = readPinned();
  const existing = charts.find(
    (entry) => entry.preview.previewId === preview.previewId
  );
  if (existing) return existing;

  const pinned: PinnedCoachChart = {
    id: crypto.randomUUID(),
    preview,
    pinnedAt: new Date().toISOString()
  };
  const next = [pinned, ...charts].slice(0, MAX_PINNED_CHARTS);
  writePinned(next);
  return pinned;
}

export function unpinCoachChart(id: string): void {
  writePinned(readPinned().filter((entry) => entry.id !== id));
}

/** Re-resolve a pinned chart's metric-bound series over a fresh window. */
export async function refreshPinnedCoachChart(
  id: string
): Promise<PinnedCoachChart | null> {
  const charts = readPinned();
  const index = charts.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const current = charts[index];
  if (!current.preview.live) return current;

  const { preview } = await resolveSpec(
    current.preview.spec,
    current.preview.previewId
  );
  const updated: PinnedCoachChart = { ...current, preview };
  charts[index] = updated;
  writePinned(charts);
  return updated;
}
