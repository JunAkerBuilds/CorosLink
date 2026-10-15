import crypto from "node:crypto";
import {
  COACH_CHART_INTRADAY_SOURCE,
  COACH_CHART_MAX_PINNED,
  bucketIntradayReadings,
  coachChartNeeds,
  describeCoachChart,
  parseCoachChartSpec,
  resolveCoachChart,
  upsertPinnedCoachChart,
  withCoachChartDefaults,
  CoachChartSpecError,
  type CoachChartIntradayWindow,
  type CoachChartReading
} from "./coachChartUtils";
import { ensureCorosMcpConnected } from "./corosMcpService";
import { getSetting, setSetting } from "./database";
import { getTrainingDailyHealthData } from "./dailyHealthDataService";
import { getTrainingHealthInsight } from "./healthInsightsService";
import type { HealthInsightKind } from "./healthInsightsTypes";
import { getTrainingSleepData } from "./sleepDataService";
import {
  getDailyMetrics,
  getTrainingAnalytics,
  getTrainingDashboard,
  getTrainingHubStatus
} from "./trainingHubService";
import {
  buildTrendPoints,
  mergeDailyHealthIntoTrendPoints,
  mergeSleepIntoTrendPoints,
  mergeTrainingDayLists,
  recentTrainingHubDateList
} from "./trainingTrendUtils";
import type {
  CoachChartIntradayKey,
  CoachChartPreview,
  CoachChartSpec,
  PinCoachChartResult,
  PinnedCoachChart,
  TrainingTrendPoint
} from "./types";

const PINNED_CHARTS_KEY = "coach.pinnedCharts";

export interface TrendWindow {
  points: TrainingTrendPoint[];
  sleepAvailable: boolean;
  /** True when COROS MCP answered the daily health (steps/calories) query. */
  dailyHealthAvailable: boolean;
}

/**
 * Daily trend points for the last `days` days: Training Hub daily metrics
 * merged with analytics, plus sleep score/duration and daily step/calorie
 * totals from COROS MCP when a session is already available (never prompts
 * for sign-in mid-chat).
 */
export async function loadTrendWindow(
  days: number,
  includeSleep: boolean,
  includeDailyHealth = false
): Promise<TrendWindow> {
  const [analytics, dailyMetrics] = await Promise.all([
    getTrainingAnalytics(),
    getDailyMetrics(recentTrainingHubDateList(days))
  ]);
  const dayList = mergeTrainingDayLists(dailyMetrics, analytics);
  let points = buildTrendPoints(dayList, days);
  let sleepAvailable = false;
  let dailyHealthAvailable = false;

  if ((includeSleep || includeDailyHealth) && points.length > 0) {
    try {
      if (await ensureCorosMcpConnected()) {
        if (includeSleep) {
          const sleep = await getTrainingSleepData(null, days);
          sleepAvailable = sleep.mcpConnected && sleep.records.length > 0;
          points = mergeSleepIntoTrendPoints(points, sleep);
        }
        if (includeDailyHealth) {
          const health = await getTrainingDailyHealthData(null, days);
          dailyHealthAvailable = health.mcpConnected;
          points = mergeDailyHealthIntoTrendPoints(points, health);
        }
      }
    } catch (error) {
      console.warn("[coachChartService] COROS daily merge skipped:", error);
    }
  }

  return { points, sleepAvailable, dailyHealthAvailable };
}

interface IntradayLoad {
  window: CoachChartIntradayWindow;
  available: boolean;
}

/**
 * Hourly COROS health readings for the last `days` days, from whichever
 * health queries the requested metrics need. Never opens a sign-in window.
 */
export async function loadIntradayWindow(
  days: number,
  kinds: ("stress" | "healthCheck")[],
  now = new Date()
): Promise<IntradayLoad> {
  const readings: Partial<Record<CoachChartIntradayKey, CoachChartReading[]>> = {};
  let available = false;
  for (const kind of kinds) {
    const result = await getTrainingHealthInsight(kind as HealthInsightKind, days);
    if (result.status === "error") {
      throw new Error(result.message ?? "Could not load COROS health data.");
    }
    if (result.status === "disconnected" || result.status === "unavailable") continue;
    available = true;
    for (const [metric, source] of Object.entries(COACH_CHART_INTRADAY_SOURCE) as [
      CoachChartIntradayKey,
      { kind: string; seriesKey: string }
    ][]) {
      if (source.kind !== kind) continue;
      const series = result.series.find((entry) => entry.key === source.seriesKey);
      readings[metric] = series?.points ?? [];
    }
  }
  return { window: bucketIntradayReadings(readings, days, now), available };
}

async function resolveSpec(
  spec: CoachChartSpec,
  previewId: string
): Promise<{ preview: CoachChartPreview; text: string }> {
  const needs = coachChartNeeds(spec);
  let daily: TrendWindow | undefined;
  let intraday: IntradayLoad | undefined;
  let dashboard: { recoveryPct?: number } | undefined;
  const hubAuthenticated = getTrainingHubStatus().authenticated;

  if (needs.dailyDays !== undefined || needs.dashboard) {
    if (!hubAuthenticated) {
      throw new CoachChartSpecError(
        "Daily metrics and recovery need Training Hub. Ask the athlete to connect COROS in Settings, or pass inline values instead."
      );
    }
  }
  if (needs.dailyDays !== undefined) {
    daily = await loadTrendWindow(needs.dailyDays, needs.sleep, needs.dailyHealth);
  }
  if (needs.intradayDays !== undefined) {
    intraday = await loadIntradayWindow(needs.intradayDays, needs.intradayKinds);
  }
  if (needs.dashboard) {
    try {
      const data = await getTrainingDashboard();
      dashboard = { recoveryPct: data.recoveryPct };
    } catch (error) {
      console.warn("[coachChartService] dashboard lookup skipped:", error);
      dashboard = {};
    }
  }

  const { preview, droppedRanges } = resolveCoachChart(spec, {
    previewId,
    trendPoints: daily?.points,
    intraday: intraday?.window,
    dashboard,
    sleepAvailable: daily?.sleepAvailable,
    dailyHealthAvailable: daily?.dailyHealthAvailable,
    intradayAvailable: intraday?.available
  });
  const text = describeCoachChart(preview, {
    droppedRanges,
    sleepAvailable: daily && needs.sleep ? daily.sleepAvailable : undefined,
    dailyHealthAvailable: daily && needs.dailyHealth ? daily.dailyHealthAvailable : undefined,
    intradayAvailable: intraday ? intraday.available : undefined
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
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is PinnedCoachChart =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.id === "string" &&
          typeof entry.pinnedAt === "string" &&
          typeof entry.preview === "object" &&
          entry.preview !== null
      )
      .map((entry) => ({ ...entry, preview: withCoachChartDefaults(entry.preview) }));
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

/**
 * Pin a chart to the Training Hub. A chart whose title matches an existing
 * pin replaces it in place, so re-rendering a card never leaves duplicates.
 */
export function pinCoachChart(preview: CoachChartPreview): PinCoachChartResult {
  const result = upsertPinnedCoachChart(readPinned(), withCoachChartDefaults(preview), {
    id: crypto.randomUUID(),
    now: new Date().toISOString(),
    maxPinned: COACH_CHART_MAX_PINNED
  });
  if (result.changed) writePinned(result.charts);
  return { pinned: result.pinned, replaced: result.replaced };
}

export function unpinCoachChart(id: string): void {
  writePinned(readPinned().filter((entry) => entry.id !== id));
}

/**
 * Re-resolve a pinned chart's bound series and tiles over the same window
 * ending now. Snapshot charts are returned unchanged.
 */
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
