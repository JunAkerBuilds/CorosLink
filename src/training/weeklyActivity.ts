import type {
  TrainingHubActivity,
  TrainingHubDailyMetric
} from "../../electron/types";
import type { UnitSystem } from "../../electron/types";
import { distanceUnit, metersToDisplayDistance } from "../units/units";

export type WeeklyActivityMetric = "distance" | "duration" | "trainingLoad";

export interface WeeklyActivityDay {
  happenDay: string;
  weekdayLabel: string;
  value: number;
  displayValue: string;
  isToday: boolean;
}

export interface WeeklyActivitySeries {
  days: WeeklyActivityDay[];
  weeklyTotal: string;
  yMax: number;
  hasData: boolean;
  metricLabel: string;
  yAxisUnit: string;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const METRIC_LABELS: Record<WeeklyActivityMetric, string> = {
  distance: "Distance",
  duration: "Duration",
  trainingLoad: "Training Load"
};

function dateToHappenDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function happenDayFromTimestamp(timestamp?: number): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }

  const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return dateToHappenDay(new Date(ms));
}

function aggregateActivityTotalsByDay(
  activities: TrainingHubActivity[]
): Map<string, { distance: number; duration: number }> {
  const totals = new Map<string, { distance: number; duration: number }>();

  for (const activity of activities) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay) {
      continue;
    }

    const distance =
      activity.distance !== undefined && Number.isFinite(activity.distance)
        ? activity.distance
        : 0;
    const duration =
      activity.duration !== undefined && Number.isFinite(activity.duration)
        ? activity.duration
        : 0;

    if (distance <= 0 && duration <= 0) {
      continue;
    }

    const current = totals.get(happenDay) ?? { distance: 0, duration: 0 };
    totals.set(happenDay, {
      distance: current.distance + distance,
      duration: current.duration + duration
    });
  }

  return totals;
}

export function enrichDayListWithActivityTotals(
  dayList: TrainingHubDailyMetric[],
  activities: TrainingHubActivity[]
): TrainingHubDailyMetric[] {
  if (activities.length === 0) {
    return dayList;
  }

  const activityTotals = aggregateActivityTotalsByDay(activities);
  if (activityTotals.size === 0) {
    return dayList;
  }

  const dayMap = new Map(dayList.map((day) => [day.happenDay, { ...day }]));

  for (const [happenDay, totals] of activityTotals) {
    const day = dayMap.get(happenDay) ?? { happenDay };
    const hasDistance = day.distance !== undefined && day.distance > 0;
    const hasDuration = day.duration !== undefined && day.duration > 0;

    dayMap.set(happenDay, {
      ...day,
      distance: hasDistance ? day.distance : totals.distance || undefined,
      duration: hasDuration ? day.duration : totals.duration || undefined
    });
  }

  return [...dayMap.values()].sort((left, right) =>
    left.happenDay.localeCompare(right.happenDay)
  );
}

export function getCalendarWeekDateKeys(referenceDate = new Date()): string[] {
  const mondayOffset = (referenceDate.getDay() + 6) % 7;
  const monday = new Date(referenceDate);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(referenceDate.getDate() - mondayOffset);

  return Array.from({ length: 7 }, (_value, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return dateToHappenDay(date);
  });
}

function readMetricRaw(day: TrainingHubDailyMetric | undefined, metric: WeeklyActivityMetric) {
  if (!day) {
    return undefined;
  }

  switch (metric) {
    case "distance":
      return day.distance;
    case "duration":
      return day.duration;
    case "trainingLoad":
      return day.trainingLoad;
  }
}

function toChartValue(
  raw: number,
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): number {
  switch (metric) {
    case "distance":
      return metersToDisplayDistance(raw, unitSystem);
    case "duration":
      return raw / 3600;
    case "trainingLoad":
      return raw;
  }
}

function formatDayDisplayValue(
  raw: number,
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): string {
  switch (metric) {
    case "distance":
      return `${metersToDisplayDistance(raw, unitSystem).toFixed(2)} ${distanceUnit(unitSystem)}`;
    case "duration":
      return formatDurationTotal(raw);
    case "trainingLoad":
      return `${Math.round(raw)}`;
  }
}

function formatDurationTotal(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${Math.round(seconds / 60)}m`;
}

function formatWeeklyTotal(
  totalRaw: number,
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): string {
  switch (metric) {
    case "distance":
      return `${metersToDisplayDistance(totalRaw, unitSystem).toFixed(2)} ${distanceUnit(unitSystem)}`;
    case "duration":
      return formatDurationTotal(totalRaw);
    case "trainingLoad":
      return `${Math.round(totalRaw)}`;
  }
}

function roundAxisMax(max: number): number {
  if (max <= 0) {
    return 4;
  }

  const padded = max * 1.25;
  const step = padded <= 10 ? 2 : padded <= 20 ? 4 : padded <= 50 ? 10 : 20;
  return Math.ceil(padded / step) * step;
}

function yAxisUnitForMetric(
  metric: WeeklyActivityMetric,
  maxValue: number,
  unitSystem: UnitSystem
): string {
  if (metric === "distance") {
    return distanceUnit(unitSystem);
  }

  if (metric === "trainingLoad") {
    return "";
  }

  return maxValue >= 1 ? "h" : "m";
}

function formatAxisTick(value: number, metric: WeeklyActivityMetric, useMinutes: boolean): string {
  if (metric === "distance") {
    return value.toFixed(value >= 10 ? 0 : 1);
  }

  if (metric === "trainingLoad") {
    return String(Math.round(value));
  }

  if (useMinutes) {
    return String(Math.round(value * 60));
  }

  return value >= 1 ? value.toFixed(1) : value.toFixed(2);
}

export function buildWeeklyActivitySeries(
  dayList: TrainingHubDailyMetric[],
  metric: WeeklyActivityMetric,
  referenceDate = new Date(),
  unitSystem: UnitSystem
): WeeklyActivitySeries {
  const dayMap = new Map(dayList.map((day) => [day.happenDay, day]));
  const weekKeys = getCalendarWeekDateKeys(referenceDate);
  const todayKey = dateToHappenDay(referenceDate);
  let totalRaw = 0;
  let hasData = false;
  let maxChartValue = 0;

  const days = weekKeys.map((happenDay, index) => {
    const raw = readMetricRaw(dayMap.get(happenDay), metric);
    const hasValue = raw !== undefined && Number.isFinite(raw) && raw > 0;
    const chartValue = hasValue ? toChartValue(raw, metric, unitSystem) : 0;

    if (hasValue && raw !== undefined) {
      totalRaw += raw;
      hasData = true;
      maxChartValue = Math.max(maxChartValue, chartValue);
    }

    return {
      happenDay,
      weekdayLabel: WEEKDAY_LABELS[index],
      value: chartValue,
      displayValue: hasValue && raw !== undefined
        ? formatDayDisplayValue(raw, metric, unitSystem)
        : "—",
      isToday: happenDay === todayKey
    };
  });

  const useMinutes = metric === "duration" && maxChartValue < 1 && hasData;
  const yMax =
    metric === "duration" && useMinutes
      ? roundAxisMax(maxChartValue * 60) / 60
      : roundAxisMax(maxChartValue);

  return {
    days,
    weeklyTotal: hasData ? formatWeeklyTotal(totalRaw, metric, unitSystem) : "—",
    yMax: yMax > 0 ? yMax : 4,
    hasData,
    metricLabel: getWeeklyActivityMetricLabel(metric, unitSystem),
    yAxisUnit: yAxisUnitForMetric(metric, maxChartValue, unitSystem)
  };
}

export function formatWeeklyActivityAxisTick(
  value: number,
  metric: WeeklyActivityMetric,
  yAxisUnit: string
): string {
  const useMinutes = metric === "duration" && yAxisUnit === "m";
  return formatAxisTick(value, metric, useMinutes);
}

export function buildWeeklyActivityYAxisTicks(
  yMax: number,
  divisions = 6
): number[] {
  if (yMax <= 0 || divisions <= 0) {
    return [0];
  }

  return Array.from({ length: divisions + 1 }, (_value, index) =>
    (yMax * index) / divisions
  );
}

export function getWeeklyActivityYAxisUnitLabel(
  metric: WeeklyActivityMetric,
  yAxisUnit: string
): string {
  if (metric === "trainingLoad") {
    return "Load";
  }

  return yAxisUnit;
}

export const WEEKLY_ACTIVITY_METRICS: WeeklyActivityMetric[] = [
  "distance",
  "duration",
  "trainingLoad"
];

export function getWeeklyActivityMetricLabel(
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): string {
  return metric === "distance"
    ? `Distance (${distanceUnit(unitSystem)})`
    : METRIC_LABELS[metric];
}
