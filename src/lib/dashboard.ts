/** Pure helpers for the dashboard board: time words, the heat map grid, the month grid. */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The Dashboard's headline: the morning's readiness as a sentence when the phone sent a word we know,
 * otherwise null and the page leads with the date. Never invents a mood from a word it does not know.
 */
export function openingLine(status: string | undefined): string | null {
  return OPENING[status?.trim().toLowerCase() ?? ""] ?? null;
}

/** Readiness's four bands (CorosKit `Readiness.Band`), in the phone's own words for the day. */
const OPENING: Record<string, string> = {
  primed: "Go hard today.", // 80 and up
  ready: "Ready for today.", // 65–79
  steady: "Keep it easy today.", // 50–64
  low: "Rest or go easy today.", // under 50
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
