import { getLocalHappenDayKey } from "../training/formatters";

export function dateFromKey(key: string): Date {
  return new Date(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8))
  );
}

export function keyFromDate(date: Date): string {
  return getLocalHappenDayKey(date);
}

export function addDaysToKey(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return keyFromDate(date);
}

/** Monday of the week containing the given date. */
export function mondayOf(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (result.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  result.setDate(result.getDate() - weekday);
  return result;
}

/**
 * Mon-start week rows (each 7 dateKeys) covering the given month,
 * padded with the surrounding days like the COROS web calendar.
 */
export function monthGridWeeks(year: number, monthIndex: number): string[][] {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const lastOfMonth = new Date(year, monthIndex + 1, 0);
  const cursor = mondayOf(firstOfMonth);
  const weeks: string[][] = [];

  while (cursor <= lastOfMonth) {
    const week: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(keyFromDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function weekRow(referenceDate: Date): string[] {
  const cursor = mondayOf(referenceDate);
  const week: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    week.push(keyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return week;
}

export function monthLabel(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
  }).format(new Date(year, monthIndex, 1));
}

export function weekRangeLabel(weekKeys: string[]): string {
  const first = dateFromKey(weekKeys[0]!);
  const last = dateFromKey(weekKeys[weekKeys.length - 1]!);
  const startLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(first);
  const endLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(last);
  return `${startLabel} – ${endLabel}`;
}

export function dayNumber(key: string): number {
  return Number(key.slice(6, 8));
}

export function isKeyInMonth(
  key: string,
  year: number,
  monthIndex: number
): boolean {
  return (
    Number(key.slice(0, 4)) === year && Number(key.slice(4, 6)) === monthIndex + 1
  );
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
