// The `health.day` and `health.night` sync items the iPhone sends, from the watch's insights. A port of CorosKit's
// SyncBodies.healthDays / healthNights (Sync/SyncBodies.swift); bodies are what SyncJSON.native writes.
import {
  type TrainingInsights, addingDays, encodeDayVitals, encodeSleepNight, isBlankDay, withoutOtherHealthSources,
} from "./insights";
import { type CalendarDay, compareDays, dayText } from "./native";

export const HEALTH_DAY = "health.day";
export const HEALTH_NIGHT = "health.night";

export interface HealthItem { collection: typeof HEALTH_DAY | typeof HEALTH_NIGHT; id: string; body: Record<string, unknown> }

/** Whether JSONEncoder could write it: it refuses NaN and infinity, and SyncJSON.native gives nil. */
function encodable(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(encodable);
  if (value && typeof value === "object") return Object.values(value).every(encodable);
  return true;
}

const inRange = (day: CalendarDay, first: CalendarDay, today: CalendarDay): boolean => compareDays(day, first) >= 0 && compareDays(day, today) <= 0;

/** `health.day` items for the last `keep` days: each day's vitals without Apple Health's. A day with nothing left isn't sent. */
export function healthDays(insights: TrainingInsights, today: CalendarDay, keep = 400): HealthItem[] {
  const first = addingDays(today, -(keep - 1));
  return withoutOtherHealthSources(insights).days.flatMap((day) => {
    if (!inRange(day.day, first, today) || isBlankDay(day)) return [];
    const body = encodeDayVitals(day);
    return encodable(body) ? [{ collection: HEALTH_DAY, id: dayText(day.day), body }] : [];
  });
}

/** `health.night` items for the last `keep` days, never a night that came from Apple Health. */
export function healthNights(insights: TrainingInsights, today: CalendarDay, keep = 400): HealthItem[] {
  const first = addingDays(today, -(keep - 1));
  return withoutOtherHealthSources(insights).nights.flatMap((night) => {
    if (!inRange(night.day, first, today)) return [];
    const body = encodeSleepNight(night);
    return encodable(body) ? [{ collection: HEALTH_NIGHT, id: dayText(night.day), body }] : [];
  });
}
