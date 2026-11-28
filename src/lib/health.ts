/** Pure maths for the Health and Energy screens: dial geometry, sleep stage sums, energy sums, labels. */
import type { SleepNight, SleepSegment, SleepStage } from "@/data/health";
import type { EnergyBand, EnergyEvent, EnergyEventKind, EnergyPoint } from "@/data/energy";
import { dateText, language, locale, msg, t } from "@/lib/i18n";

/** Repeatable scatter between -0.5 and 0.5, the same one the design canvas uses for its sample lines and stars. */
export function scatter(i: number, k: number): number {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return v - Math.floor(v) - 0.5;
}

/* ---------- Dial ---------- */

export interface DialArc {
  /** Full circle length for the radius. */
  circumference: number;
  /** Length of the open-bottom track (three quarters of the circle by default). */
  track: number;
  /** Length of the filled part. */
  value: number;
}

/** Dash lengths for the open-bottom dial: a `sweep` share of the circle, filled to `fraction` (0…1). */
export function dialArc(radius: number, fraction: number, sweep = 0.75): DialArc {
  const circumference = 2 * Math.PI * radius;
  const track = circumference * sweep;
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return { circumference, track, value: track * f };
}

/* ---------- Sleep ---------- */

export interface StageTotals {
  awake: number;
  rem: number;
  light: number;
  deep: number;
  /** Minutes asleep: everything but awake. */
  asleep: number;
  /** Minutes from falling asleep to getting up. */
  inBed: number;
}

export function stageTotals(segments: readonly SleepSegment[]): StageTotals {
  const tot: Record<SleepStage, number> = { awake: 0, rem: 0, light: 0, deep: 0 };
  for (const s of segments) tot[s.stage] += s.minutes;
  const inBed = tot.awake + tot.rem + tot.light + tot.deep;
  return { ...tot, asleep: inBed - tot.awake, inBed };
}

/** A night's minutes per stage, asleep and in bed; null where nothing gives the number. */
export type NightTotals = Record<keyof StageTotals, number | null>;

/**
 * Totals of a night: summed from its segments when it has them, else the totals the source gave.
 * `asleep` is the source's own figure whenever it gave one.
 */
export function nightTotals(night: SleepNight): NightTotals {
  const given = night.totals ?? {};
  if (night.segments.length > 0) {
    const tot = stageTotals(night.segments);
    return { ...tot, asleep: given.asleep ?? tot.asleep };
  }
  const { awake = null, rem = null, light = null, deep = null } = given;
  const asleep = given.asleep ?? (rem != null && light != null && deep != null ? rem + light + deep : null);
  return { awake, rem, light, deep, asleep, inBed: given.inBed ?? (asleep != null && awake != null ? asleep + awake : null) };
}

export interface StageSpan {
  index: number;
  stage: SleepStage;
  /** Minutes after the start of the night. */
  from: number;
  to: number;
}

/** Every segment with its start and end, in minutes after the start of the night. */
export function stageSpans(segments: readonly SleepSegment[]): StageSpan[] {
  let at = 0;
  return segments.map((s, index) => {
    const span = { index, stage: s.stage, from: at, to: at + s.minutes };
    at += s.minutes;
    return span;
  });
}

/** The segment under a minute of the night (clamped to the first and last). */
export function stageAt(segments: readonly SleepSegment[], minute: number): StageSpan | null {
  const spans = stageSpans(segments);
  if (spans.length === 0) return null;
  for (const s of spans) if (minute < s.to) return minute < s.from ? spans[0] : s;
  return spans[spans.length - 1];
}

/* ---------- Labels ---------- */

/** Minutes as "7h 42m", or "14m" under an hour. */
export function durationShort(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Decimal hours as "7 h 42 min". */
export function hoursLong(hours: number): string {
  let h = Math.floor(hours), m = Math.round((hours - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** Minutes after midnight as 24-hour "06:54". Wraps past midnight in both directions; 1440 itself reads "24:00". */
export function clockOfDay(minutes: number): string {
  const r = Math.round(minutes);
  if (r === 1440) return "24:00";
  const m = ((r % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekdayShort(d: Date): string {
  if (language() !== "en") return dateText(d, locale(), { weekday: "short" });
  return WEEKDAYS[d.getDay()];
}

/** "19 Nov", with the year added when asked. */
export function dayMonth(d: Date, withYear = false): string {
  if (language() !== "en") return dateText(d, locale(), { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;
}

/** "Thu 19 Nov". */
export function dayLabel(d: Date): string {
  return `${weekdayShort(d)} ${dayMonth(d)}`;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/* ---------- Trends ---------- */

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** The readings a series holds, without its empty days. */
export function present(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v != null);
}

/**
 * `linePath` for a series with empty days: the line breaks at each gap, and a reading with a gap on both sides
 * is a zero-length stroke (a dot under round line caps).
 */
export function gapLinePath(values: readonly (number | null)[], w: number, h: number, min: number, max: number): string {
  const n = values.length, span = max - min || 1;
  const parts: string[] = [];
  values.forEach((v, k) => {
    if (v == null) return;
    const open = k === 0 || values[k - 1] == null;
    parts.push(`${open ? "M" : "L"}${(n === 1 ? 0 : (k * w) / (n - 1)).toFixed(1)} ${(h - ((v - min) / span) * h).toFixed(1)}`);
    if (open && (k === n - 1 || values[k + 1] == null)) parts.push("h0");
  });
  return parts.join(" ");
}

/** The last `count` readings of a series. */
export function lastDays<T>(values: readonly T[], count: number): T[] {
  return values.slice(Math.max(0, values.length - count));
}

/** Bottom and top of a trend chart: the series' lowest and highest value with 12% of the spread as room. */
export function trendScale(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  const pad = (max - min) * 0.12 || 1;
  return [min - pad, max + pad];
}

/* ---------- Energy ---------- */

/** Energy at a minute of the day, read off the straight lines between readings. Null outside the readings. */
export function energyAt(points: readonly EnergyPoint[], minute: number): number | null {
  if (points.length === 0) return null;
  if (minute < points[0].minute || minute > points[points.length - 1].minute) return null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (minute <= b.minute) {
      const span = b.minute - a.minute;
      return span <= 0 ? b.level : a.level + ((b.level - a.level) * (minute - a.minute)) / span;
    }
  }
  return points[points.length - 1].level;
}

/** Lowest and highest reading from `fromMinute` (normally waking) to the end of the readings. */
export function energyRange(points: readonly EnergyPoint[], fromMinute = 0): { low: number; high: number } | null {
  let low = Infinity, high = -Infinity;
  const start = energyAt(points, fromMinute);
  if (start != null) { low = start; high = start; }
  for (const p of points) {
    if (p.minute < fromMinute) continue;
    if (p.level < low) low = p.level;
    if (p.level > high) high = p.level;
  }
  return Number.isFinite(low) ? { low, high } : null;
}

export interface EnergyShare {
  kind: EnergyEventKind;
  amount: number;
}

export interface EnergyTotals {
  /** Sum of everything that added energy (positive). */
  charged: number;
  /** Sum of everything that used energy (positive number; show it with a minus). */
  used: number;
  chargedBy: EnergyShare[];
  usedBy: EnergyShare[];
}

/** Charged and used, each split by what did it, in the order the kinds first appear in the day. */
export function energyTotals(events: readonly EnergyEvent[]): EnergyTotals {
  const chargedBy: EnergyShare[] = [], usedBy: EnergyShare[] = [];
  const add = (list: EnergyShare[], kind: EnergyEventKind, amount: number) => {
    const hit = list.find((s) => s.kind === kind);
    if (hit) hit.amount += amount; else list.push({ kind, amount });
  };
  let charged = 0, used = 0;
  for (const e of events) {
    if (e.delta > 0) { charged += e.delta; add(chargedBy, e.kind, e.delta); }
    else if (e.delta < 0) { used -= e.delta; add(usedBy, e.kind, -e.delta); }
  }
  return { charged, used, chargedBy, usedBy };
}

/** The band (sleep, workout, rest, stress) covering a minute of the day, if any. */
export function bandAt(bands: readonly EnergyBand[], minute: number): EnergyBand | null {
  for (const b of bands) if (minute >= b.from && minute <= b.to) return b;
  return null;
}

/** The lowest reading after waking, with its minute (first one if it repeats). */
export function lowestSinceWaking(points: readonly EnergyPoint[], wokeMinute: number): EnergyPoint | null {
  let best: EnergyPoint | null = null;
  for (const p of points) if (p.minute >= wokeMinute && (best == null || p.level < best.level)) best = p;
  return best;
}

export interface EnergyStep {
  kind: EnergyEventKind | "end";
  name: string;
  when: string;
  /** Level before and after this step; for the two ends, both are the level shown. */
  from: number;
  to: number;
}

/**
 * The day as steps: the level it started from, each change in order, then where it ended.
 * `endLevel` is the latest reading; the start is worked back from it so the steps add up.
 */
export function energySteps(events: readonly EnergyEvent[], endLevel: number, end: { name: string; when: string }): EnergyStep[] {
  const total = events.reduce((sum, e) => sum + e.delta, 0);
  const startLevel = endLevel - total;
  const first = events[0];
  const firstWhen = first ? (first.when ?? first.detail.split(" · ")[0]) : "";
  const steps: EnergyStep[] = [{ kind: "end", name: t("Bedtime"), when: firstWhen.split(" – ")[0], from: startLevel, to: startLevel }];
  let level = startLevel;
  for (const e of events) {
    steps.push({ kind: e.kind, name: e.name, when: e.when ?? e.detail.split(" · ")[0], from: level, to: level + e.delta });
    level += e.delta;
  }
  steps.push({ kind: "end", name: end.name, when: end.when, from: level, to: level });
  return steps;
}

/** A share of a whole in plain words: "three quarters", "two thirds", "half"… */
export function shareWords(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  if (f >= 0.92) return msg("nearly all");
  const named: [number, string][] = [[0.8, msg("most")], [0.75, msg("three quarters")], [0.667, msg("two thirds")], [0.5, msg("half")], [0.333, msg("a third")], [0.25, msg("a quarter")]];
  let best = named[0];
  for (const n of named) if (Math.abs(n[0] - f) < Math.abs(best[0] - f)) best = n;
  return Math.abs(best[0] - f) <= 0.06 ? best[1] : f > 0.5 ? msg("most") : msg("some");
}
