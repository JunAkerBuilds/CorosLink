/**
 * Pure maths for the training calendar: the weeks of a month (Monday first), paging,
 * where repeated workouts fall, and the week totals column.
 * Days are local calendar days written YYYY-MM-DD; months are YYYY-MM.
 */

import { language, locale } from "@/lib/i18n";

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function isDayKey(text: string | null | undefined): text is string {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return toKey(toDate(text)) === text;
}

export function isMonthKey(text: string | null | undefined): text is string {
  if (!text || !/^\d{4}-\d{2}$/.test(text)) return false;
  const m = Number(text.slice(5));
  return m >= 1 && m <= 12;
}

export function addDays(day: string, n: number): string {
  const d = toDate(day);
  return toKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** The Monday of the week a day is in. */
export function mondayOf(day: string): string {
  const d = toDate(day);
  return addDays(day, -((d.getDay() + 6) % 7));
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Seven days from a Monday. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, k) => addDays(monday, k));
}

/** Every week that has a day in the month, Monday first: four to six rows of seven days. */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`;
  const next = `${addMonths(month, 1)}-01`;
  const weeks: string[][] = [];
  for (let monday = mondayOf(first); monday < next; monday = addDays(monday, 7)) weeks.push(weekDays(monday));
  return weeks;
}

/** The week to show when switching from a month to one week: today's if it is in the month, else the first. */
export function weekInMonth(month: string, today: string): string {
  return monthOf(today) === month ? mondayOf(today) : mondayOf(`${month}-01`);
}

/** The month a week belongs to: the one holding its Thursday. */
export function monthOfWeek(monday: string): string {
  return monthOf(addDays(monday, 3));
}

/** The days a workout falls on: its day, then the same weekday for `repeatWeeks` weeks in all. */
export function occurrences(day: string, repeatWeeks: number): string[] {
  const n = Number.isFinite(repeatWeeks) ? Math.max(1, Math.min(52, Math.floor(repeatWeeks))) : 1;
  return Array.from({ length: n }, (_, k) => addDays(day, k * 7));
}

/* ───────────── Entries ───────────── */

export interface PlacedEntry {
  id: string;
  date: string;
  sport: string;
  status: "done" | "planned";
  source: string;
  metres?: number;
  load?: number;
}

export interface Placed<E> {
  /** What each day shows, done first. */
  byDay: Map<string, E[]>;
  /** Planned entries from the account that a workout saved here took the place of. */
  replaced: E[];
}

/**
 * Lays entries on their days. A workout saved in this browser replaces whatever the sample or COROS
 * had planned for that day; recorded activities and the gym plans a phone synced always stay.
 */
export function placeEntries<E extends PlacedEntry>(account: readonly E[], saved: readonly E[]): Placed<E> {
  const savedDays = new Set(saved.map((e) => e.date));
  const byDay = new Map<string, E[]>();
  const replaced: E[] = [];
  const put = (e: E) => {
    const list = byDay.get(e.date);
    if (list) list.push(e); else byDay.set(e.date, [e]);
  };
  for (const e of account) {
    if (e.status === "planned" && e.source !== "synced" && savedDays.has(e.date)) replaced.push(e);
    else put(e);
  }
  for (const e of saved) put(e);
  for (const list of byDay.values()) list.sort((a, b) => Number(a.status === "planned") - Number(b.status === "planned"));
  return { byDay, replaced };
}

/* ───────────── Week totals ───────────── */

export interface WeekBase {
  timeSeconds: number | null;
  runMetres: number;
  load: number | null;
  plannedLoad: number | null;
}

export interface WeekSummary {
  timeSeconds: number | null;
  /** Null when the week has no running at all. */
  runMetres: number | null;
  load: number | null;
  plannedLoad: number | null;
  /** Width of the load bar, 0 to 100. */
  bar: number;
}

/** A week's recorded load that fills the bar. */
export const LOAD_BAR_FULL = 500;

/** Hours and minutes of a week's time, as the column prints it (4:32). */
export function hoursMinutes(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/* ───────────── Names ───────────── */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Dates in the app's language; English keeps the hand-made forms below. */
const intl = (d: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), options).format(d);

export function weekdayName(day: string): string {
  if (language() !== "en") return intl(toDate(day), { weekday: "long" });
  return DAYS[toDate(day).getDay()];
}

/** Thu: the weekday's short name. */
export function shortWeekday(day: string): string {
  if (language() !== "en") return intl(toDate(day), { weekday: "short" });
  return DAYS[toDate(day).getDay()].slice(0, 3);
}

/** Thursday 19 November */
export function longDay(day: string): string {
  const d = toDate(day);
  if (language() !== "en") return intl(d, { weekday: "long", day: "numeric", month: "long" });
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Thu 19 Nov, with the year on request. */
export function shortDay(day: string, withYear = false): string {
  const d = toDate(day);
  if (language() !== "en") return intl(d, { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return `${DAYS[d.getDay()].slice(0, 3)} ${dayMonth(day)}${withYear ? ` ${d.getFullYear()}` : ""}`;
}

/** 28 Aug */
export function dayMonth(day: string): string {
  const d = toDate(day);
  if (language() !== "en") return intl(d, { day: "numeric", month: "short" });
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/** November 2026 */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (language() !== "en") return intl(new Date(y, m - 1, 1), { month: "long", year: "numeric" });
  return `${MONTHS[m - 1]} ${y}`;
}

/** 16 – 22 November 2026, or 30 Nov – 6 Dec 2026 when the week crosses months. */
export function weekTitle(monday: string): string {
  const a = toDate(monday), b = toDate(addDays(monday, 6));
  if (language() !== "en") return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric" }).formatRange(a, b);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  const yearA = a.getFullYear() === b.getFullYear() ? "" : ` ${a.getFullYear()}`;
  return `${dayMonth(monday)}${yearA} – ${dayMonth(addDays(monday, 6))} ${b.getFullYear()}`;
}
