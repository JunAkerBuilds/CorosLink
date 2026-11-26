// A plan change Coach proposes: which calendar workouts move, come off, or get added, and the card that shows
// it. Pure. Nothing here writes: the card's Apply button does, one step at a time, and keeps what Undo needs.
import type { CoachHue, PlanCard, PlanSession } from "@/data/coach";
import type { HubWorkout } from "@/data/hub";
import { calendarDayOf, type NativeGymPlanned } from "@/data/sync/native";
import type { Workout } from "@/data/workouts";
import type { Sport } from "@/lib/workout";
import { t } from "@/lib/i18n";
import { dayOfRef, finite, isDay, mondayOfDay, quoted, shiftDay, shownDay, today, type AthleteItems, type Clock } from "./items";
import type { PlanEntry } from "./read";

/** What a step of a plan change acts on: the entry as it was when Coach proposed it. */
export interface PlanTarget {
  id: string;
  date: string;
  name: string;
  sport: Sport;
  source: PlanEntry["source"];
  load?: number;
  coros?: { idInPlan: string; name: string; workout: HubWorkout | null };
  browser?: { workoutId: string };
  planned?: NativeGymPlanned;
}

export type PlanOp =
  | { op: "move"; entry: PlanTarget; to: string }
  | { op: "remove"; entry: PlanTarget }
  /** Puts one of the athlete's saved gym routines on a day of C-LINK's own calendar. */
  | { op: "add_routine"; routineId: string; name: string; day: string; plannedId: string }
  /** Puts a new workout on a day: on COROS when Training Hub is connected and COROS can hold it, else in this browser. */
  | { op: "add_workout"; day: string; name: string; sport: Sport; workout: Workout | null; hub: HubWorkout | null; detail: string; load?: number };

/** What Undo does for one applied step. */
export type PlanUndo =
  | { undo: "coros_move"; name: string; day: string; idInPlan: string; to: string }
  | { undo: "coros_add"; day: string; workout: HubWorkout }
  | { undo: "coros_remove"; day: string; idInPlan: string; name: string }
  | { undo: "coros_update"; day: string; idInPlan: string; name: string; workout: HubWorkout }
  | { undo: "browser_delete"; workoutId: string }
  | { undo: "browser_put"; workoutId: string; date: string }
  | { undo: "browser_restore"; saved: unknown }
  | { undo: "gym_put"; planned: NativeGymPlanned }
  | { undo: "gym_remove"; plannedId: string }
  | { undo: "none"; why: string };

const SPORT_HUE: Record<Sport, CoachHue> = { run: "mint", ride: "cyan", swim: "blue", strength: "violet" };

export const planTarget = (e: PlanEntry): PlanTarget => ({ id: e.id, date: e.date, name: e.name, sport: e.sport, source: e.source, load: e.load, coros: e.coros, browser: e.browser, planned: e.planned });

/** The planned workout a change names: by entry id, or by its day and exact name. An error is written for the model. */
export function findEntry(entries: readonly PlanEntry[], change: Record<string, unknown>): PlanEntry | string {
  if (typeof change.entry === "string") {
    const hit = entries.find((e) => e.id === change.entry);
    if (hit) return hit;
  }
  if (!isDay(change.date)) return "date must be the workout's day, YYYY-MM-DD.";
  const on = entries.filter((e) => e.date === change.date);
  const name = typeof change.name === "string" ? change.name.trim().toLowerCase() : "";
  const hits = name ? on.filter((e) => e.name.toLowerCase() === name) : on;
  if (hits.length === 1) return hits[0];
  if (!on.length) return `there's no planned workout on ${change.date}. That day is empty.`;
  return `there's no “${quoted(String(change.name ?? ""), 60)}” on ${change.date}. That day has ${on.map((e) => `“${e.name}”`).join(", ")}.`;
}

/** Checks the model's changes against the calendar as it is now. An error is written for the model to fix. */
export function parsePlanChange(items: AthleteItems, clock: Clock, entries: readonly PlanEntry[], input: { changes?: unknown }, newId: () => string): { ops: PlanOp[] } | { error: string } {
  if (!Array.isArray(input.changes) || !input.changes.length) return { error: "changes must list at least one change." };
  if (input.changes.length > 14) return { error: "a plan change holds at most 14 changes. Send it in two cards." };
  const now = today(clock), ops: PlanOp[] = [], used = new Set<string>();
  for (const raw of input.changes) {
    if (typeof raw !== "object" || raw === null) return { error: "each change must be an object." };
    const c = raw as Record<string, unknown>;
    if (c.action === "add_saved") {
      const id = typeof c.saved_workout === "string" ? c.saved_workout.replace(/^routine-/, "") : "";
      const routine = items.routines.find((r) => r.id === id) ?? items.routines.find((r) => (r.name ?? "").toLowerCase() === String(c.saved_workout ?? "").trim().toLowerCase());
      if (!routine) return { error: `no saved workout “${quoted(String(c.saved_workout ?? ""), 60)}”. Find it with list_saved_workouts and use its id.` };
      if (!isDay(c.new_date) || c.new_date < now) return { error: "new_date must be a day from today on, YYYY-MM-DD." };
      ops.push({ op: "add_routine", routineId: routine.id, name: quoted(routine.name) || t("Gym workout"), day: c.new_date, plannedId: newId() });
      continue;
    }
    if (c.action !== "move" && c.action !== "remove") return { error: `unknown action ${quoted(String(c.action), 20)}. Use move, remove or add_saved.` };
    const entry = findEntry(entries, c);
    if (typeof entry === "string") return { error: entry };
    if (used.has(entry.id)) return { error: `“${entry.name}” on ${entry.date} is in this change twice.` };
    used.add(entry.id);
    if (c.action === "remove") { ops.push({ op: "remove", entry: planTarget(entry) }); continue; }
    if (!isDay(c.new_date)) return { error: "new_date must be a date, YYYY-MM-DD." };
    if (c.new_date === entry.date) return { error: "new_date is the day it's on already." };
    if (c.new_date < now) return { error: `${c.new_date} is in the past; the calendar plans from today on.` };
    ops.push({ op: "move", entry: planTarget(entry), to: c.new_date });
  }
  return { ops };
}

/** The card: each touched day as it is and as it would be, and the week's load before and after. */
export function planCard(items: AthleteItems, clock: Clock, entries: readonly PlanEntry[], ops: readonly PlanOp[], id: string, input: { title?: unknown; note?: unknown }): PlanCard {
  const days = new Set<string>();
  for (const o of ops) {
    if (o.op === "add_routine" || o.op === "add_workout") days.add(o.day);
    else { days.add(o.entry.date); if (o.op === "move") days.add(o.to); }
  }
  const session = (name: string, sport: Sport, changed?: boolean): PlanSession => ({ name, hue: SPORT_HUE[sport], ...(changed ? { changed } : {}) });
  const REST: PlanSession = { name: t("Rest"), hue: "none" };
  const loadOf = (list: { load?: number }[]) => Math.round(list.reduce((sum, e) => sum + (finite(e.load) ? e.load : 0), 0));
  const after = (day: string): { name: string; sport: Sport; load?: number; changed?: boolean }[] => {
    const gone = new Set(ops.flatMap((o) => (o.op === "move" || o.op === "remove" ? [o.entry.id] : [])));
    const out: { name: string; sport: Sport; load?: number; changed?: boolean }[] = entries.filter((e) => e.date === day && !gone.has(e.id));
    for (const o of ops) {
      if (o.op === "move" && o.to === day) out.push({ name: o.entry.name, sport: o.entry.sport, load: o.entry.load, changed: true });
      if (o.op === "add_routine" && o.day === day) out.push({ name: o.name, sport: "strength", changed: true });
      if (o.op === "add_workout" && o.day === day) out.push({ name: o.name, sport: o.sport, load: o.load, changed: true });
    }
    return out;
  };
  const rows = [...days].sort().map((day) => {
    const now = entries.filter((e) => e.date === day), next = after(day);
    return {
      day: shownDay(day),
      now: now.length ? now.map((e) => session(e.name, e.sport)) : [REST],
      proposed: next.length ? next.map((e) => session(e.name, e.sport, e.changed)) : [{ ...REST, changed: true }],
      loadNow: loadOf(now), loadNext: loadOf(next),
    };
  });
  const monday = mondayOfDay([...days].sort()[0]), sunday = shiftDay(monday, 6);
  const inWeek = (d: string) => d >= monday && d <= sunday;
  const done = Math.round(items.activities.filter((a) => inWeek(dayOfRef(a.start ?? 0, clock))).reduce((sum, a) => sum + (a.trainingLoad ?? 0), 0));
  let before = done, afterLoad = done;
  for (let d = monday; d <= sunday; d = shiftDay(d, 1)) {
    if (d < today(clock)) continue;
    before += loadOf(entries.filter((e) => e.date === d));
    afterLoad += loadOf(after(d));
  }
  return {
    kind: "plan", id, title: quoted(input.title, 80) || t("Plan change"), rows,
    week: { label: t("Week of {day} · load", { day: shownDay(monday) }), before, after: afterLoad, done },
    note: quoted(input.note, 240), ops: [...ops],
  };
}

/** The body of a `gym.planned` item for a routine put on `day`. */
export const plannedBody = (id: string, routineId: string, day: string): NativeGymPlanned => ({ id, routineID: routineId, day: calendarDayOf(day) });
