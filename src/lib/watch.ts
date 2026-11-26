import type { Alarm } from "@/data/watch";
import { msg, t, tx } from "@/lib/i18n";

/**
 * Watch settings changed at a desk wait in a queue until the phone app carries them to the watch.
 * Each setting has one key ("goal.steps", "gps.mode", "alarm.<id>") and at most one entry in the queue.
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface PendingChange {
  key: string;
  /** What the watch has now. null for something that does not exist on the watch yet (a new alarm). */
  from: Json;
  /** What it will have after the next sync. null removes it. */
  to: Json;
  at: number;
}

export function sameValue(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && sameValue(a[k], b[k]));
}

/**
 * Records that `key` should become `next`. `original` is what the watch has now.
 * A second change to the same setting replaces the first; setting it back to the original removes the entry.
 */
export function queueChange(queue: readonly PendingChange[], key: string, original: Json, next: Json, at: number): PendingChange[] {
  const rest = queue.filter((c) => c.key !== key);
  if (sameValue(original, next)) return rest;
  const entry: PendingChange = { key, from: original, to: next, at };
  const index = queue.findIndex((c) => c.key === key);
  if (index < 0) return [...rest, entry];
  return [...rest.slice(0, index), entry, ...rest.slice(index)];
}

/** Drops the waiting change for one setting, so it stays as the watch has it. */
export function undoChange(queue: readonly PendingChange[], key: string): PendingChange[] {
  return queue.filter((c) => c.key !== key);
}

export function pendingFor(queue: readonly PendingChange[], key: string): PendingChange | undefined {
  return queue.find((c) => c.key === key);
}

export function pendingCount(queue: readonly PendingChange[]): number {
  return queue.length;
}

/** The value to show for a setting: the waiting one if there is one, otherwise the watch's own. */
export function valueOf<T extends Json>(queue: readonly PendingChange[], key: string, original: T): T {
  const hit = pendingFor(queue, key);
  return hit ? (hit.to as T) : original;
}

export const alarmKey = (id: string) => `alarm.${id}`;

export interface AlarmRow {
  alarm: Alarm;
  /** "added" and "removed" rows exist on one side only; "changed" differs from the watch's copy. */
  pending: "added" | "changed" | "removed" | null;
}

const asJson = (a: Alarm): Json => ({ id: a.id, time: a.time, days: [...a.days], label: a.label, on: a.on });

export const alarmJson = asJson;

/** The alarm list as it will be after the next sync, with removed ones kept in place so they can be undone. */
export function alarmRows(onWatch: readonly Alarm[], queue: readonly PendingChange[]): AlarmRow[] {
  const rows: AlarmRow[] = onWatch.map((alarm) => {
    const hit = pendingFor(queue, alarmKey(alarm.id));
    if (!hit) return { alarm, pending: null };
    if (hit.to === null) return { alarm, pending: "removed" };
    return { alarm: hit.to as unknown as Alarm, pending: "changed" };
  });
  const known = new Set(onWatch.map((a) => alarmKey(a.id)));
  for (const c of queue) {
    if (c.key.startsWith("alarm.") && !known.has(c.key) && c.to !== null) {
      rows.push({ alarm: c.to as unknown as Alarm, pending: "added" });
    }
  }
  return rows;
}

const DAY_NAMES = [msg("Sunday"), msg("Monday"), msg("Tuesday"), msg("Wednesday"), msg("Thursday"), msg("Friday"), msg("Saturday")];
const DAY_SHORT = [msg("Sun"), msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat")];
/** Monday first, as the day picker shows them. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const dayName = (day: number) => (DAY_NAMES[day] ? tx("weekday", DAY_NAMES[day]) : "");
export const dayShort = (day: number) => (DAY_SHORT[day] ? tx("weekday", DAY_SHORT[day]) : "");

/** "Weekdays", "Sunday", "Mon, Wed, Fri". Days are 0 = Sunday … 6 = Saturday. */
export function repeatLabel(days: readonly number[]): string {
  const set = new Set(days.filter((d) => d >= 0 && d <= 6));
  if (set.size === 0) return t("Once");
  if (set.size === 7) return t("Every day");
  const has = (...d: number[]) => d.every((x) => set.has(x));
  if (set.size === 5 && has(1, 2, 3, 4, 5)) return t("Weekdays");
  if (set.size === 2 && has(0, 6)) return t("Weekends");
  const ordered = WEEK_ORDER.filter((d) => set.has(d));
  if (ordered.length === 1) return dayName(ordered[0]);
  return ordered.map((d) => dayShort(d)).join(t(", "));
}

/** The line beside an alarm's time: when it repeats, then its name if it has one. */
export function alarmLine(alarm: Pick<Alarm, "days" | "label">): string {
  const repeat = repeatLabel(alarm.days);
  return alarm.label ? `${repeat} · ${alarm.label}` : repeat;
}

/** A goal typed into a number field: whole, at least 1 and no more than `max`. Anything else is not saved. */
export function parseGoal(text: string, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= max ? n : null;
}

/** "06:15" style 24-hour time, as the watch stores it. */
export function validTime(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** How far today's count has got towards a goal, from 0 to 1. */
export function goalShare(done: number, goal: number): number {
  if (!(goal > 0) || !(done > 0)) return 0;
  return Math.min(1, done / goal);
}

/** A goal after one press of minus or plus: it moves to the next multiple of `step`, never below one step or above `max`. */
export function stepGoal(goal: number, step: number, direction: -1 | 1, max: number): number {
  const next = direction > 0 ? Math.floor(goal / step) * step + step : Math.ceil(goal / step) * step - step;
  return Math.min(max, Math.max(step, next));
}

/** The reading the battery was last charged at: the last day the level went up. Null if it only fell. */
export function lastChargeIndex(levels: readonly number[]): number | null {
  for (let i = levels.length - 1; i > 0; i--) if (levels[i] > levels[i - 1]) return i;
  return null;
}
