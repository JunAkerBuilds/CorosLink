/** Pure helpers for the dashboard board: time words, the heat map grid, the month grid. */
import { msg, t } from "@/lib/i18n";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The Dashboard's headline: the morning's readiness as a sentence when the phone sent a word we know,
 * otherwise null and the page leads with the date. Never invents a mood from a word it does not know.
 */
export function openingLine(status: string | undefined): string | null {
  const line = OPENING[status?.trim().toLowerCase() ?? ""];
  return line ? t(line) : null;
}

/** Readiness's four bands (CorosKit `Readiness.Band`), in the phone's own words for the day. */
const OPENING: Record<string, string> = {
  primed: msg("Go hard today."), // 80 and up
  ready: msg("Ready for today."), // 65–79
  steady: msg("Keep it easy today."), // 50–64
  low: msg("Rest or go easy today."), // under 50
};

/** Minutes as the board writes time: 2 h 58, 0 h 57. */
export function hMin(minutes: number): string {
  const m = Math.round(Math.max(0, minutes));
  return `${Math.floor(m / 60)} h ${pad(m % 60)}`;
}

/** A heat-map day's time: 38 min under an hour, 1 h 12 above it. */
export function dayTime(minutes: number): string {
  return minutes >= 60 ? hMin(minutes) : `${Math.round(minutes)} min`;
}

/** Hours (7.25) as h:mm (7:15). */
export function hoursClock(hours: number): string {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** Heat map cell size and step in its 795 × 105 drawing. */
export const HEAT_CELL = 11;
export const HEAT_STEP = 15;

/** Top-left corner of day `n` (0 is the first Monday): weeks run left to right, Monday at the top. */
export function heatCell(n: number): [number, number] {
  return [Math.floor(n / 7) * HEAT_STEP + 2, (n % 7) * HEAT_STEP + 2];
}

/** One path per level (0 to 4), every day of that level as a square in it. */
export function heatPaths(levels: readonly number[]): string[] {
  const out = ["", "", "", "", ""];
  levels.forEach((lv, n) => {
    const [x, y] = heatCell(n);
    out[lv] += `M${x} ${y}h${HEAT_CELL}v${HEAT_CELL}h-${HEAT_CELL}z`;
  });
  return out;
}

/** The day under a pointer at fractions (fx, fy) of the drawing, clamped to the days there are. */
export function heatIndexAt(fx: number, fy: number, weeks: number, count: number): number {
  const col = Math.max(0, Math.min(weeks - 1, Math.floor(fx * weeks)));
  const row = Math.max(0, Math.min(6, Math.floor(fy * 7)));
  return Math.min(count - 1, col * 7 + row);
}

export interface MonthCell { day: number | null; done: boolean; planned: boolean; today: boolean }

/** A Monday-first month grid: blanks before the 1st, then each day with what it holds. */
export function monthCells(month: string, today: string, done: readonly number[], planned: readonly number[]): MonthCell[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const blanks = (first + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const todayDay = today.startsWith(month) ? Number(today.slice(8)) : -1;
  const cells: MonthCell[] = Array.from({ length: blanks }, () => ({ day: null, done: false, planned: false, today: false }));
  for (let d = 1; d <= days; d++) cells.push({ day: d, done: done.includes(d), planned: planned.includes(d), today: d === todayDay });
  return cells;
}

/** Bars standing on the bottom of an h-high box: one per value, `width` wide, `step` apart, starting at `x0`. */
export function columnBars(values: readonly number[], h: number, toHeight: (v: number) => number, step: number, width: number, x0: number): string {
  return values
    .map((v, k) => {
      const bh = Math.max(0, Math.min(h, toHeight(v)));
      return `M${+(k * step + x0).toFixed(1)} ${(h - bh).toFixed(1)}h${width}v${bh.toFixed(1)}h-${width}z`;
    })
    .join(" ");
}

/**
 * The board's order mended against the widgets there are: unknown and repeated keys dropped, and a widget the
 * saved order has never seen put back just after the widget it follows by default.
 */
export function boardOrder<K extends string>(saved: readonly unknown[] | null | undefined, all: readonly K[]): K[] {
  const known = new Set<string>(all);
  const out: K[] = [];
  for (const k of Array.isArray(saved) ? saved : []) if (typeof k === "string" && known.has(k) && !out.includes(k as K)) out.push(k as K);
  all.forEach((k, i) => {
    if (!out.includes(k)) out.splice(i ? out.indexOf(all[i - 1]) + 1 : 0, 0, k);
  });
  return out;
}

/** `key` moved to `target`'s place: just after it when moving forward, just before it when moving back. */
export function moveKey<K>(order: readonly K[], key: K, target: K): K[] {
  const from = order.indexOf(key), to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const out = order.filter((k) => k !== key);
  const at = out.indexOf(target);
  out.splice(from < to ? at + 1 : at, 0, key);
  return out;
}

/** The whole order with the shown widgets laid in as `shown` has them; hidden widgets keep their places. */
export function placeShown<K>(all: readonly K[], shown: readonly K[]): K[] {
  const on = new Set(shown);
  const next = shown.filter((k) => all.includes(k));
  let i = 0;
  return all.map((k) => (on.has(k) && i < next.length ? next[i++] : k));
}
