// Synced gym items → the Strength screen. Pure: plain bodies and `now` in, the screen's type out.
// The workout maths follows CorosKit's GymLog.swift: a set is done when `doneAt` is there, working sets are the
// done ones that are not warm-ups, volume is Σ weight × reps over working sets (a missing weight or reps counts 0).
import { language, locale, msg, t } from "@/lib/i18n";
import { weightIn, weightUnit } from "@/lib/units";
import type { GymWorkout, Lift, LiftedRange, Muscle, Strength, Suggestion } from "../strength";
import { refToDate, refToMs, type NativeGymSet, type NativeGymWorkout, type ViewStrengthBody } from "./native";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** English; translate where shown: `t(NOTHING_YET)`. */
export const NOTHING_YET = msg("Nothing from your phone yet");

/* ───────────── One workout ───────────── */

export const isDone = (set: NativeGymSet): boolean => set.doneAt != null;

export function workingSets(workout: NativeGymWorkout): NativeGymSet[] {
  return (workout.entries ?? []).flatMap((e) => (e.sets ?? []).filter((s) => isDone(s) && s.kind !== "warmUp"));
}

/** Every done set, warm-ups included (GymWorkout.doneSetCount). */
export function doneSetCount(workout: NativeGymWorkout): number {
  return (workout.entries ?? []).reduce((n, e) => n + (e.sets ?? []).filter(isDone).length, 0);
}

export function volumeKg(workout: NativeGymWorkout): number {
  return workingSets(workout).reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
}

/** Seconds from start to end; 0 when the end is missing. */
export function durationSeconds(workout: NativeGymWorkout): number {
  return workout.end == null ? 0 : Math.max(0, workout.end - workout.start);
}

/** A weight in kg as typed, in the shown unit: 77.5, 100, 12.25 (kg) or 170.86 (lb). */
export const liftNumber = (kg: number): string => String(Math.round(weightIn(kg) * 100) / 100);
/** The same with its unit: 77.5 kg or 170.86 lb. */
export const liftWeight = (kg: number): string => `${liftNumber(kg)} ${weightUnit()}`;

/** "Tue 17 Nov". */
export function dateText(d: Date): string {
  if (language() !== "en") return new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short" }).format(d);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** The heaviest working set of each of the first `count` exercises that have one: "Bench press 77.5 kg × 5 · …". */
export function topLine(workout: NativeGymWorkout, names: Record<string, string>, count = 3): string {
  const parts: string[] = [];
  for (const entry of workout.entries ?? []) {
    if (parts.length >= count) break;
    const sets = (entry.sets ?? []).filter((s) => isDone(s) && s.kind !== "warmUp");
    if (!sets.length) continue;
    const best = sets.reduce((a, b) => {
      const wa = a.weightKg ?? 0, wb = b.weightKg ?? 0;
      return wb > wa || (wb === wa && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a;
    });
    const name = names[entry.exerciseID] ?? entry.exerciseID;
    if ((best.weightKg ?? 0) > 0 && best.reps != null) parts.push(`${name} ${liftWeight(best.weightKg!)} × ${best.reps}`);
    else if ((best.weightKg ?? 0) > 0) parts.push(`${name} ${liftWeight(best.weightKg!)}`);
    else if (best.reps != null) parts.push(`${name} × ${best.reps}`);
    else if (best.seconds != null) parts.push(`${name} ${best.seconds} s`);
    else parts.push(name);
  }
  return parts.join(" · ");
}

/**
 * The table rows, newest first. `sets` counts working sets, as the phone's history and workout page do.
 * `fromHevy` holds the ids of the workouts this browser read from Hevy: their rows say so.
 */
export function workoutRows(workouts: readonly NativeGymWorkout[], names: Record<string, string>, fromHevy?: ReadonlySet<string>): GymWorkout[] {
  return [...workouts].sort((a, b) => b.start - a.start).map((w) => ({
    id: w.id,
    ...(fromHevy?.has(w.id) ? { source: "hevy" as const } : {}),
    date: dateText(refToDate(w.start)),
    name: w.name?.trim() || t("Workout"),
    top: topLine(w, names),
    sets: workingSets(w).length,
    liftedKg: Math.round(volumeKg(w)),
    seconds: Math.round(durationSeconds(w)),
  }));
}

/* ───────────── Ranges ───────────── */

/** Local midnight of the Monday of `d`'s week. */
export function weekStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

/** How many Monday-start weeks `d` is before the week of `now`: 0 = this week. Negative for later weeks. */
export function weeksAgo(d: Date, now: Date): number {
  return Math.round((weekStart(now).getTime() - weekStart(d).getTime()) / (7 * DAY_MS));
}

const monthsAgo = (d: Date, now: Date): number => (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();

/** "+12%" against the period before; "" when that period lifted nothing. */
export function changeText(current: number, previous: number): string {
  if (!(previous > 0)) return "";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct > 0 ? `+${pct}%` : pct < 0 ? `−${Math.abs(pct)}%` : "0%";
}

function range(
  key: LiftedRange["key"], label: string, per: LiftedRange["per"], bars: number,
  workouts: readonly NativeGymWorkout[], ago: (d: Date) => number,
): LiftedRange {
  const kgs = new Array<number>(bars).fill(0);
  let previous = 0, count = 0, sets = 0, seconds = 0;
  for (const w of workouts) {
    const back = ago(refToDate(w.start));
    if (back < 0 || back >= bars * 2) continue;
    const volume = volumeKg(w);
    if (back >= bars) { previous += volume; continue; }
    kgs[bars - 1 - back] += volume;
    count += 1;
    sets += workingSets(w).length;
    seconds += durationSeconds(w);
  }
  const total = kgs.reduce((a, b) => a + b, 0);
  return { key, label, per, totals: kgs.map((v) => v / 1000), change: changeText(total, previous), workouts: count, sets, hours: seconds / 3600 };
}

/** 4 weeks, 12 weeks (Monday-start weeks ending with this one) and 12 calendar months ending with this one. */
export function liftedRanges(workouts: readonly NativeGymWorkout[], now: Date): LiftedRange[] {
  return [
    range("4w", t("4 weeks"), "week", 4, workouts, (d) => weeksAgo(d, now)),
    range("12w", t("12 weeks"), "week", 12, workouts, (d) => weeksAgo(d, now)),
    range("year", t("Year"), "month", 12, workouts, (d) => monthsAgo(d, now)),
  ];
}

/* ───────────── Main lifts ───────────── */

const LIFT_WEEKS = 12;

/**
 * The line under a lift's best, from its heaviest working set per week (oldest first, null = not lifted that week)
 * and the heaviest before its latest week (null = no earlier set):
 * 1. "New best, +2.5 kg": the latest week it was lifted is this week or last, and beat everything before it.
 * 2. "Holding for 5 weeks": the same weight from one week to the latest one, at least 3 weeks apart counted inclusively.
 * 3. "+2.5 kg in 12 weeks" (or −): first lifted week against the latest, counted inclusively.
 * Anything else has no line.
 */
export function liftNote(weekly: readonly (number | null)[], bestBefore: number | null): string {
  const at = weekly.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  if (!at.length) return "";
  const lastAt = at[at.length - 1], last = weekly[lastAt]!;
  if (lastAt >= weekly.length - 2 && bestBefore != null && last > bestBefore) return t("New best, +{weight}", { weight: liftWeight(last - bestBefore) });
  let runStart = lastAt;
  for (let k = at.length - 2; k >= 0 && weekly[at[k]] === last; k--) runStart = at[k];
  const held = lastAt - runStart + 1;
  if (held >= 3) return t("Holding for {n} weeks", { n: held });
  const firstAt = at[0], diff = last - weekly[firstAt]!;
  if (firstAt === lastAt || diff === 0) return "";
  return t("{change} in {n} weeks", { change: `${diff > 0 ? "+" : "−"}${liftWeight(Math.abs(diff))}`, n: lastAt - firstAt + 1 });
}

/**
 * The lifts done in the most workouts of the last 12 weeks (up to `count`; ties go to the heavier one).
 * Only sets with a weight count. `history` holds the weeks the lift was done, oldest first.
 */
export function mainLifts(workouts: readonly NativeGymWorkout[], names: Record<string, string>, now: Date, count = 4): Lift[] {
  interface Acc { sessions: number; best: number; weekly: (number | null)[]; beforeByWeek: { back: number; top: number }[] }
  const byLift = new Map<string, Acc>();
  for (const w of workouts) {
    const back = weeksAgo(refToDate(w.start), now);
    const tops = new Map<string, number>();
    for (const e of w.entries ?? []) {
      for (const s of e.sets ?? []) {
        if (!isDone(s) || s.kind === "warmUp" || !((s.weightKg ?? 0) > 0)) continue;
        tops.set(e.exerciseID, Math.max(tops.get(e.exerciseID) ?? 0, s.weightKg!));
      }
    }
    for (const [id, top] of tops) {
      const acc = byLift.get(id) ?? { sessions: 0, best: 0, weekly: new Array<number | null>(LIFT_WEEKS).fill(null), beforeByWeek: [] };
      acc.best = Math.max(acc.best, top);
      acc.beforeByWeek.push({ back, top });
      if (back >= 0 && back < LIFT_WEEKS) {
        acc.sessions += 1;
        const k = LIFT_WEEKS - 1 - back;
        acc.weekly[k] = Math.max(acc.weekly[k] ?? 0, top);
      }
      byLift.set(id, acc);
    }
  }
  return [...byLift.entries()]
    .filter(([, a]) => a.sessions > 0)
    .map(([id, a]) => ({ id, name: names[id] ?? id, ...a }))
    .sort((a, b) => b.sessions - a.sessions || b.best - a.best || a.name.localeCompare(b.name))
    .slice(0, count)
    .map((a) => {
      const lastAt = a.weekly.reduce<number>((hit, v, i) => (v == null ? hit : i), -1);
      const lastBack = LIFT_WEEKS - 1 - lastAt;
      const earlier = a.beforeByWeek.filter((x) => x.back > lastBack).map((x) => x.top);
      return {
        name: a.name,
        bestKg: Math.round(a.best * 100) / 100,
        note: liftNote(a.weekly, earlier.length ? Math.max(...earlier) : null),
        history: a.weekly.filter((v): v is number => v != null),
      };
    });
}

/* ───────────── Muscles ───────────── */

/**
 * The phone calls a muscle overdue when the days since it was trained pass max(usual gap × 1.5, usual gap + 2) and are
 * no more than 90 (StrengthHistory+Readiness.swift). The synced view holds no usual gap, so the web uses a fixed
 * 14 days with the phone's 90-day cap.
 */
export const OVERDUE_FROM_DAYS = 14;
export const OVERDUE_TO_DAYS = 90;

export function muscleRow(m: NonNullable<ViewStrengthBody["muscles"]>[number], now: Date): Muscle {
  const fatigue = Math.max(0, Math.min(100, Math.round(m.fatigue ?? 0)));
  const nowMs = now.getTime();
  if (m.readyAt != null && refToMs(m.readyAt) > nowMs) {
    const at = refToDate(m.readyAt);
    const hours = Math.max(1, Math.ceil((at.getTime() - nowMs) / 3_600_000));
    const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
    const days = Math.round(hours / 24);
    const note = sameDay && at.getHours() >= 18 ? t("Ready tonight")
      : hours < 24 ? (hours === 1 ? t("Ready in 1 hour") : t("Ready in {n} hours", { n: hours }))
        : days === 1 ? t("Ready in 1 day") : t("Ready in {n} days", { n: days });
    return { name: m.name, fatigue, state: "recovering", note };
  }
  if (m.lastTrainedAt != null) {
    const days = Math.floor((nowMs - refToMs(m.lastTrainedAt)) / DAY_MS);
    // The phone's own verdict wins when it sent one; the fixed 14 days is only for bodies without it.
    if (m.state != null) return m.state === "overdue" ? { name: m.name, fatigue, state: "overdue", note: t("Not trained in {n} days", { n: days }) } : { name: m.name, fatigue, state: "ready", note: t("Ready") };
    if (days >= OVERDUE_FROM_DAYS && days <= OVERDUE_TO_DAYS) return { name: m.name, fatigue, state: "overdue", note: t("Not trained in {n} days", { n: days }) };
  }
  return { name: m.name, fatigue, state: "ready", note: t("Ready") };
}

/* ───────────── Suggestion ───────────── */

const FIGURE_ALT = msg("The muscle figure's torso, close up");

export function suggestionCard(s: ViewStrengthBody["suggestion"]): Suggestion {
  if (!s?.title) return { title: t("No suggestion yet"), text: "", figureAlt: t(FIGURE_ALT) };
  const names = (s.exercises ?? []).map((e) => e.name).filter(Boolean);
  const count = names.length;
  const text = !count ? "" : count === 1 ? t("1 exercise: {names}.", { names: names.join(", ") }) : t("{n} exercises: {names}.", { n: count, names: names.join(", ") });
  return { title: s.title, text, figureAlt: t(FIGURE_ALT) };
}

/* ───────────── The screen ───────────── */

/**
 * `hevy` is what this browser read from Hevy and the phone doesn't already hold (`mergeGymLogs`): those workouts
 * are in `workouts` too, and count in the ranges, lifts and table like any other. Muscles and the suggestion come
 * from the phone's view alone.
 */
export function strengthFromItems(
  workouts: readonly NativeGymWorkout[], view: ViewStrengthBody | undefined, now: Date,
  hevy?: { ids: ReadonlySet<string>; names: Record<string, string> },
): Strength {
  const names = { ...(hevy?.names ?? {}), ...(view?.exerciseNames ?? {}) };
  return {
    suggestion: suggestionCard(view?.suggestion),
    muscles: (view?.muscles ?? []).map((m) => muscleRow(m, now)),
    ranges: liftedRanges(workouts, now),
    lifts: mainLifts(workouts, names, now),
    workouts: workoutRows(workouts, names, hevy?.ids),
  };
}
