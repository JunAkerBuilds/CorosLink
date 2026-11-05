/**
 * The library's week: Monday to Sunday around today, the span the reader's
 * day strip and the masthead's "this week" chip both talk about.
 */
import { formatDate } from "../i18n/training";

export interface LibraryDay {
  /** yyyy-mm-dd, as a date input reads it. */
  iso: string;
  /** yyyymmdd, as COROS reads it. */
  key: string;
  weekday: string;
  day: string;
  long: string;
  isToday: boolean;
  /** Before today: COROS will not schedule into the past. */
  past: boolean;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function keyToIso(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

export function libraryWeek(now = new Date()): LibraryDay[] {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const todayKey = dayKey(today);
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    const key = dayKey(date);
    return {
      iso: keyToIso(key),
      key,
      weekday: formatDate(date, { weekday: "short" }),
      day: String(date.getDate()),
      long: formatDate(date, { weekday: "long", month: "long", day: "numeric" }),
      isToday: key === todayKey,
      past: key < todayKey
    };
  });
}

/** Monday of this week through a week from today: the week strip plus "up next". */
export function scheduleWindow(now = new Date()): { start: string; end: string } {
  const week = libraryWeek(now);
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  const endKey = dayKey(end);
  return { start: week[0]!.key, end: endKey > week[6]!.key ? endKey : week[6]!.key };
}
