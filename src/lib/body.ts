/** Body maths. Pure: measurements in, trends, monthly averages, derived numbers and arc geometry out. */
import type { Measurement, OwnMeasurement } from "@/data/body";
import { dayKey, parseDay } from "@/lib/format";
import { t } from "@/lib/i18n";

/** A measurement on the page: the sample's, or the person's own (which can be deleted). */
export interface Entry extends Measurement {
  own: boolean;
  id?: string;
}

export interface Point {
  day: string;
  value: number;
}

export type Range = "1M" | "3M" | "1Y" | "All";
export type Metric = "weight" | "bodyFat" | "lean" | "bmi";

// MARK: Days

export function shiftDay(day: string, delta: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}

/** Whole days from `a` to `b` (positive when `b` is later). Safe across clock changes. */
export function daysBetween(a: string, b: string): number {
  const x = parseDay(a), y = parseDay(b);
  return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000);
}

/** Whether `text` is a real calendar day written YYYY-MM-DD. */
export function isDay(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && dayKey(parseDay(text)) === text;
}

// MARK: Measurements

/**
 * The person's own measurements laid over the sample history, oldest first. An own measurement replaces the
 * sample's on the same day; of two own ones on a day the later in the list wins.
 */
export function mergeMeasurements(sample: readonly Measurement[], own: readonly OwnMeasurement[]): Entry[] {
  const byDay = new Map<string, Entry>();
  for (const m of sample) byDay.set(m.day, { ...m, own: false });
  for (const m of own) byDay.set(m.day, { ...m, own: true });
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Saves a measurement, replacing an own one already on that day. */
export function saveMeasurement(own: readonly OwnMeasurement[], next: OwnMeasurement): OwnMeasurement[] {
  return [...own.filter((m) => m.day !== next.day), next].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function deleteMeasurement(own: readonly OwnMeasurement[], id: string): OwnMeasurement[] {
  return own.filter((m) => m.id !== id);
}

/** Weight in kg over height in metres squared. */
export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return m > 0 ? weightKg / (m * m) : 0;
}

export function bmiBand(value: number): string {
  if (value < 18.5) return t("Below healthy range");
  if (value < 25) return t("Healthy range");
  return t("Above healthy range");
}

/** Everything that isn't fat. */
export function leanMass(weightKg: number, bodyFatPct: number): number {
  return weightKg * (1 - bodyFatPct / 100);
}

/** One metric through time. Body fat and lean mass only on the days body fat was measured. */
export function series(entries: readonly Measurement[], metric: Metric, heightCm: number): Point[] {
  const out: Point[] = [];
  for (const e of entries) {
    if (metric === "weight") out.push({ day: e.day, value: e.weightKg });
    else if (metric === "bmi") out.push({ day: e.day, value: bmi(e.weightKg, heightCm) });
    else if (e.bodyFatPct != null) out.push({ day: e.day, value: metric === "bodyFat" ? e.bodyFatPct : leanMass(e.weightKg, e.bodyFatPct) });
  }
  return out;
}

/** The first day a range shows, counting back from `end`. Null for "All". */
export function rangeStart(range: Range, end: string): string | null {
  if (range === "1M") return shiftDay(end, -29);
  if (range === "3M") return shiftDay(end, -89);
  if (range === "1Y") return shiftDay(end, -364);
  return null;
}

export function within(points: readonly Point[], from: string | null, to: string): Point[] {
  return points.filter((p) => (from == null || p.day >= from) && p.day <= to);
}

/** Last value minus first. Null with fewer than two points. */
export function trend(points: readonly Point[]): number | null {
  return points.length < 2 ? null : points[points.length - 1].value - points[0].value;
}

export interface MonthAverage {
  /** YYYY-MM */
  month: string;
  value: number;
  count: number;
}

/** The mean of each calendar month that has a reading, oldest first. */
export function monthlyAverages(points: readonly Point[]): MonthAverage[] {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const p of points) {
    const key = p.day.slice(0, 7);
    const s = sums.get(key) ?? { sum: 0, count: 0 };
    s.sum += p.value;
    s.count += 1;
    sums.set(key, s);
  }
  return [...sums.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, s]) => ({ month, value: s.sum / s.count, count: s.count }));
}

/** `values` averaged down to at most `n` evenly sized groups, for a small trend line. */
export function resample(values: readonly number[], n: number): number[] {
  if (values.length <= n) return [...values];
  return Array.from({ length: n }, (_, k) => {
    const from = Math.floor((k * values.length) / n), to = Math.floor(((k + 1) * values.length) / n);
    const part = values.slice(from, Math.max(to, from + 1));
    return part.reduce((a, b) => a + b, 0) / part.length;
  });
}

// MARK: Goal

/** How far from `start` to `goal` the current value has come, 0…1. */
export function goalProgress(start: number, current: number, goal: number): number {
  const whole = goal - start;
  if (whole === 0) return current === goal ? 1 : 0;
  return Math.min(1, Math.max(0, (current - start) / whole));
}

/**
 * Weeks until `goal` at the pace of `change` over `days`. Null when already there, when there is no pace,
 * or when the pace leads away from the goal.
 */
export function weeksToGoal(current: number, goal: number, change: number, days: number): number | null {
  const gap = goal - current;
  if (gap === 0 || change === 0 || days <= 0) return null;
  const perWeek = (change / days) * 7;
  if (Math.sign(perWeek) !== Math.sign(gap)) return null;
  return gap / perWeek;
}

// MARK: Body-age arc

/** The arc spans five years either side of the person's age, 15° a year, from 165° round the bottom to 15°. */
export const ARC = { cx: 179, cy: 131, r: 160, startDeg: 165, degPerYear: 15, halfSpan: 5 } as const;

/** Where a body age sits on the arc, in degrees (0° = 3 o'clock, growing clockwise on screen). Clamped to the arc. */
export function bodyAgeAngle(bodyAge: number, age: number): number {
  const low = age - ARC.halfSpan;
  const v = Math.min(age + ARC.halfSpan, Math.max(low, bodyAge));
  return ARC.startDeg - (v - low) * ARC.degPerYear;
}

export function arcPoint(deg: number, r: number = ARC.r): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [ARC.cx + r * Math.cos(a), ARC.cy + r * Math.sin(a)];
}

/** Body age minus age to a tenth: "2.6 years younger", "1.0 years older", "Same as your age". */
export function ageDifference(bodyAge: number, age: number): string {
  const diff = Math.round((bodyAge - age) * 10) / 10;
  if (diff === 0) return t("Same as your age");
  const years = Math.abs(diff).toFixed(1);
  return diff < 0 ? t("{years} years younger", { years }) : t("{years} years older", { years });
}

// MARK: Chart geometry

/** The weight axis: half a kilo under the lowest of the line and the goal, to the half kilo above the highest. */
export function weightDomain(values: readonly number[], goal: number | null): [number, number] {
  const all = goal == null ? [...values] : [...values, goal];
  if (all.length === 0) return [0, 1];
  const lo = Math.floor((Math.min(...all) - 0.5) * 2) / 2;
  const hi = Math.ceil((Math.max(...all) + 0.5) * 2) / 2;
  return [lo, hi];
}

/** A value's height on a chart `h` tall whose axis runs `min` (bottom) to `max` (top). */
export function yAt(value: number, min: number, max: number, h: number): number {
  return ((max - value) / (max - min || 1)) * h;
}

/** A day's place across a chart `w` wide that runs from `from` to `to`. */
export function xAt(day: string, from: string, to: string, w: number): number {
  const span = daysBetween(from, to);
  return span <= 0 ? w / 2 : (daysBetween(from, day) / span) * w;
}

/** The index of the number in ascending `xs` closest to `x`. */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}

export interface Spark {
  line: string;
  area: string;
  endX: number;
  endY: number;
}

/** A small trend line across `w`, scaled to its own range with `pad` above and below, closed to the bottom for the fill. */
export function spark(values: readonly number[], w: number, h: number, pad: number): Spark | null {
  const n = values.length;
  if (n === 0) return null;
  const mn = Math.min(...values), mx = Math.max(...values), span = mx - mn || 1;
  const pts = values.map((v, i): [number, number] => [n === 1 ? w : (i * w) / (n - 1), pad + (1 - (v - mn) / span) * (h - 2 * pad)]);
  if (n === 1) pts.unshift([0, pts[0][1]]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const end = pts[pts.length - 1];
  return { line, area: `${line} L${w} ${h} L0 ${h} Z`, endX: end[0], endY: end[1] };
}

/** A number to at least one decimal and at most two, as scales print it: 72.4, 72.45, 71.0. */
export function oneOrTwo(value: number): string {
  const two = value.toFixed(2);
  return two.endsWith("0") ? two.slice(0, -1) : two;
}
