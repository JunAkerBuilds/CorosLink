import type {
  TrainingHubAnalytics,
  TrainingHubDailyMetric,
  TrainingHubDailyMetrics,
  TrainingTrendPoint
} from "./types";

function formatHappenDayLabel(happenDay: string): string {
  if (!/^\d{8}$/.test(happenDay)) {
    return happenDay;
  }

  const month = happenDay.slice(4, 6);
  const day = happenDay.slice(6, 8);
  return `${month}/${day}`;
}

export function mergeTrainingDayLists(
  dailyMetrics: TrainingHubDailyMetrics | null,
  analytics: TrainingHubAnalytics | null
): TrainingHubDailyMetric[] {
  const combined = new Map<string, TrainingHubDailyMetric>();

  for (const day of analytics?.dayList ?? []) {
    if (day.happenDay) {
      combined.set(day.happenDay, { ...day });
    }
  }

  for (const day of dailyMetrics?.dayList ?? []) {
    if (!day.happenDay) {
      continue;
    }

    combined.set(day.happenDay, {
      ...combined.get(day.happenDay),
      ...day
    });
  }

  return [...combined.values()].sort((left, right) =>
    left.happenDay.localeCompare(right.happenDay)
  );
}

export function buildTrendPoints(dayList: TrainingHubDailyMetric[]): TrainingTrendPoint[] {
  return dayList.slice(-7).map((day) => ({
    date: day.happenDay,
    label: formatHappenDayLabel(day.happenDay),
    trainingLoad: day.trainingLoad,
    avgSleepHrv: day.avgSleepHrv,
    sleepHrvBase: day.sleepHrvBase,
    rhr: day.rhr
  }));
}

export function recentTrainingHubDateList(days: number): string[] {
  return Array.from({ length: days }, (_value, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  });
}
