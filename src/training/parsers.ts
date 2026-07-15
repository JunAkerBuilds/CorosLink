import type {
  TrainingHubAnalytics,
  TrainingHubDailyHealthSummary,
  TrainingHubDailyMetric,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubSleepSummary
} from "../../electron/types";
import {
  buildTrendPoints,
  mergeSleepIntoTrendPoints,
  mergeTrainingDayLists
} from "../../electron/trainingTrendUtils";
import { formatHappenDayLabel, recentTrainingHubDateList } from "./formatters";
import { TRAINING_HEATMAP_DAYS } from "./chartConfig";
import type {
  HeatmapCell,
  HeatmapGrid,
  HeatmapIntensityLevel,
  HeatmapMetric,
  HeatmapMonthLabel,
  HeatmapSummary,
  TrainingHubSnapshot,
  TrainingSummaryMetrics
} from "./types";

export { mergeTrainingDayLists } from "../../electron/trainingTrendUtils";

function happenDayToDate(happenDay: string): Date | null {
  if (!/^\d{8}$/.test(happenDay)) {
    return null;
  }

  const year = Number(happenDay.slice(0, 4));
  const month = Number(happenDay.slice(4, 6)) - 1;
  const day = Number(happenDay.slice(6, 8));
  return new Date(year, month, day);
}

function mondayRowIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function loadToLevel(
  load: number | undefined,
  maxLoad: number
): HeatmapIntensityLevel {
  if (load === undefined || load <= 0 || maxLoad <= 0) {
    return 0;
  }

  const ratio = load / maxLoad;

  if (ratio <= 0.25) {
    return 1;
  }

  if (ratio <= 0.5) {
    return 2;
  }

  if (ratio <= 0.75) {
    return 3;
  }

  return 4;
}

export function buildHeatmapCells(
  dayList: TrainingHubDailyMetric[],
  days = TRAINING_HEATMAP_DAYS,
  metric: HeatmapMetric = "trainingLoad"
): HeatmapCell[] {
  const dayMap = new Map(dayList.map((day) => [day.happenDay, day]));
  const dateKeys = recentTrainingHubDateList(days).reverse();
  const values = dateKeys
    .map((key) => dayMap.get(key)?.[metric])
    .filter(
      (value): value is number =>
        value !== undefined && Number.isFinite(value) && value > 0
    );
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  return dateKeys.map((happenDay) => {
    const day = dayMap.get(happenDay);
    const value = day?.[metric];

    return {
      happenDay,
      trainingLoad: day?.trainingLoad,
      rpeLoad: day?.rpeLoad,
      value,
      distance: day?.distance,
      duration: day?.duration,
      level: loadToLevel(value, maxValue),
      label: formatHappenDayLabel(happenDay)
    };
  });
}

export function buildHeatmapSummary(cells: HeatmapCell[]): HeatmapSummary {
  const activeDays = cells.filter((cell) => (cell.value ?? 0) > 0).length;
  const totalLoad = cells.reduce((total, cell) => total + (cell.value ?? 0), 0);

  // Current streak counts consecutive active days ending at the most recent
  // day. Today is still in progress, so an empty *today* does not break the
  // streak — only a full rest day (yesterday) does. In other words the streak
  // breaks only when both yesterday and today have no activity.
  let currentStreak = 0;
  let index = cells.length - 1;
  if (index >= 0 && (cells[index].value ?? 0) <= 0) {
    index -= 1; // skip an empty, in-progress "today"
  }
  for (; index >= 0; index -= 1) {
    if ((cells[index].value ?? 0) > 0) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  let longestStreak = 0;
  let streak = 0;
  for (const cell of cells) {
    if ((cell.value ?? 0) > 0) {
      streak += 1;
      longestStreak = Math.max(longestStreak, streak);
    } else {
      streak = 0;
    }
  }

  return {
    activeDays,
    currentStreak,
    longestStreak,
    totalLoad
  };
}

export function buildHeatmapGrid(cells: HeatmapCell[]): HeatmapGrid {
  if (cells.length === 0) {
    return { cells: [], weeks: 0, monthLabels: [] };
  }

  const firstDate = happenDayToDate(cells[0].happenDay);
  const leadingPadding = firstDate ? mondayRowIndex(firstDate) : 0;
  const totalSlots = leadingPadding + cells.length;
  const trailingPadding = (7 - (totalSlots % 7)) % 7;
  const paddedCells: (HeatmapCell | null)[] = [
    ...Array.from({ length: leadingPadding }, () => null),
    ...cells,
    ...Array.from({ length: trailingPadding }, () => null)
  ];
  const weeks = paddedCells.length / 7;
  const monthLabels: HeatmapMonthLabel[] = [];
  const seenMonths = new Set<string>();

  for (let column = 0; column < weeks; column += 1) {
    for (let row = 0; row < 7; row += 1) {
      const cell = paddedCells[column * 7 + row];
      if (!cell) {
        continue;
      }

      const date = happenDayToDate(cell.happenDay);
      if (!date) {
        continue;
      }

      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      if (seenMonths.has(monthKey)) {
        continue;
      }

      seenMonths.add(monthKey);
      monthLabels.push({
        column,
        label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date)
      });
      break;
    }
  }

  return {
    cells: paddedCells,
    weeks,
    monthLabels
  };
}

function buildSummary(
  dayList: TrainingHubDailyMetric[],
  dashboard: TrainingHubDashboard | null,
  dailyHealth?: TrainingHubDailyHealthSummary | null
): TrainingSummaryMetrics {
  const racePredictor = dashboard?.racePredictor ?? null;
  const recent = dayList.slice(-7);
  const latest = recent[recent.length - 1];
  const latestHealth = dailyHealth?.latest;
  const priorRhrValues = recent
    .slice(0, -1)
    .map((day) => day.rhr)
    .filter((value): value is number => Number.isFinite(value));

  const priorRhrAverage =
    priorRhrValues.length > 0
      ? priorRhrValues.reduce((total, value) => total + value, 0) /
        priorRhrValues.length
      : undefined;

  const weekLoadTotal = recent.reduce(
    (total, day) => total + (day.trainingLoad ?? 0),
    0
  );
  const latestRhr = latest?.rhr ?? dashboard?.rhr;

  return {
    staminaLevel: racePredictor?.staminaLevel ?? latest?.staminaLevel,
    recoveryPct: racePredictor?.recoveryPct ?? dashboard?.recoveryPct,
    todayLoad: latest?.trainingLoad,
    weekLoadTotal: weekLoadTotal > 0 ? weekLoadTotal : undefined,
    latestRhr,
    rhrDelta:
      latestRhr !== undefined && priorRhrAverage !== undefined
        ? latestRhr - priorRhrAverage
        : undefined,
    steps: latestHealth?.steps,
    calories: latestHealth?.calories
  };
}

export function buildTrainingHubSnapshot(
  analytics: TrainingHubAnalytics | null,
  dashboard: TrainingHubDashboard | null,
  dailyMetrics: TrainingHubDailyMetrics | null,
  sleep?: TrainingHubSleepSummary | null,
  dailyHealth?: TrainingHubDailyHealthSummary | null
): TrainingHubSnapshot {
  const dayList = mergeTrainingDayLists(dailyMetrics, analytics);
  const trendPoints = mergeSleepIntoTrendPoints(buildTrendPoints(dayList), sleep);

  return {
    summary: buildSummary(dayList, dashboard, dailyHealth),
    trendPoints,
    racePredictor: dashboard?.racePredictor ?? null,
    dashboard,
    analytics,
    dailyMetrics,
    sleep: sleep ?? null,
    dailyHealth: dailyHealth ?? null
  };
}

export function recoveryTone(
  recoveryPct?: number
): "low" | "mid" | "high" | "neutral" {
  if (recoveryPct === undefined) {
    return "neutral";
  }

  if (recoveryPct < 40) {
    return "low";
  }

  if (recoveryPct < 70) {
    return "mid";
  }

  return "high";
}
