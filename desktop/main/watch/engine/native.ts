// What CorosKit's Codable models look like as JSON (SyncJSON.native: the default JSONEncoder), so the engine hands back
// the same item bodies the iPhone does and keeps its files in the shape the CorosKit helper kept them. Dates are
// seconds since 2001-01-01 (Foundation's reference date); nil fields are left out; CalendarDay is {year, month, day}.

/** Seconds from 1970 to Foundation's reference date, 2001-01-01T00:00:00Z. */
export const REFERENCE_EPOCH = 978_307_200;

/** A Date as JSONEncoder writes it: seconds since 2001. */
export const refSeconds = (date: Date): number => date.getTime() / 1000 - REFERENCE_EPOCH;
export const fromRefSeconds = (seconds: number): Date => new Date((seconds + REFERENCE_EPOCH) * 1000);

/** CorosKit's CalendarDay: a day on the local calendar. */
export interface CalendarDay { year: number; month: number; day: number }

/** The local day `date` falls on (Calendar.current). */
export const calendarDay = (date: Date): CalendarDay => ({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
/** The day in UTC, for times already shifted by the watch's own UTC offset. */
export const utcCalendarDay = (date: Date): CalendarDay => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
/** Local midnight at the start of the day. */
export const dayStart = (d: CalendarDay): Date => new Date(d.year, d.month - 1, d.day);
export const addDays = (d: CalendarDay, days: number): CalendarDay => calendarDay(new Date(d.year, d.month - 1, d.day + days));
/** "2026-10-15". */
export const dayText = (d: CalendarDay): string => `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
export const dayKey = (d: CalendarDay): number => d.year * 10000 + d.month * 100 + d.day;
export const compareDays = (a: CalendarDay, b: CalendarDay): number => dayKey(a) - dayKey(b);
export const sameDay = (a: CalendarDay, b: CalendarDay): boolean => dayKey(a) === dayKey(b);

/** An object without its undefined members, as JSONEncoder leaves nil out. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
