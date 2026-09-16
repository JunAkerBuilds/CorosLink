import type { TrainingHubSleepRecord } from "../../electron/types";
import type { TrainingTrendPoint } from "./types";

function parseDate(value: string): Date | undefined {
  if (!/^\d{8}$/.test(value)) return undefined;
  const date = new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), 12);
  return dateKey(date) === value ? date : undefined;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function validDuration(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

/** Keep missing nights empty and compare only two complete seven-day windows. */
export function buildSleepDurationSummary(
  points: TrainingTrendPoint[],
  records: TrainingHubSleepRecord[] = []
) {
  const minutesByDate = new Map<string, number>();
  for (const point of points) {
    if (parseDate(point.date) && validDuration(point.sleepMinutes)) {
      minutesByDate.set(point.date, point.sleepMinutes);
    }
  }
  for (const record of records) {
    if (parseDate(record.happenDay) && record.kind !== "nap" &&
      record.completeness !== "partial" && validDuration(record.totalMinutes)) {
      minutesByDate.set(record.happenDay, record.totalMinutes);
    }
  }

  const endKey = points.map((point) => point.date).filter((date) => parseDate(date)).sort().at(-1)
    ?? [...minutesByDate.keys()].sort().at(-1);
  const end = endKey ? parseDate(endKey) : undefined;
  const days: (TrainingTrendPoint & { weekday: string; shortDate: string })[] = [];
  const previous: number[] = [];

  if (end) {
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(end);
      date.setDate(date.getDate() - offset);
      const key = dateKey(date);
      const minutes = minutesByDate.get(key);
      if (offset >= 7) {
        if (minutes !== undefined) previous.push(minutes);
      } else {
        days.push({
          date: key,
          label: key,
          weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
          shortDate: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          sleepMinutes: minutes
        });
      }
    }
  }

  const values = days.flatMap((day) => day.sleepMinutes === undefined ? [] : [day.sleepMinutes]);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
  const previousAverage = previous.length === 7 ? previous.reduce((sum, value) => sum + value, 0) / 7 : undefined;
  const changePercent = values.length === 7 && average !== undefined &&
    previousAverage !== undefined && previousAverage > 0
    ? (average - previousAverage) / previousAverage * 100 : undefined;

  return { days, average, nights: values.length, changePercent };
}
