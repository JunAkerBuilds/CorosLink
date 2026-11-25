// The `watch.state` item body (docs/sync-contract.md §5.4), as CorosKit's SyncBodies.watchState builds it from plain
// values: a field that can't be filled is left out, never guessed. Times are seconds since 2001 (SyncJSON.time).
import { refSeconds } from "./native";

export const BATTERY_HISTORY_DAYS = 60;
export const REFUSALS_KEPT = 10;

export interface StateAlarm { slot: number; enabled: boolean; hour: number; minute: number; /** 0 = Sunday … 6 = Saturday. */ days: number[] }

/** CorosKit's SyncBodies.WatchState. */
export interface WatchState {
  name?: string;
  model?: string;
  firmware?: string;
  syncedAt?: Date;
  battery?: { percent: number; readAt: Date };
  storage?: { usedBytes: number; totalBytes: number };
  goalCalories?: number; goalExerciseMinutes?: number; goalSteps?: number;
  todayCalories?: number; todayExerciseMinutes?: number; todaySteps?: number;
  /** Undefined when the alarms weren't read. */
  alarms?: StateAlarm[];
  alarmsReadAt?: Date;
  gpsMode?: string;
  sleepSchedule?: { bedtime: number; wake: number };
  gpsModes?: string[];
  batteryHistory?: { at: Date; percent: number }[];
  refused?: { key: string; at: Date }[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** An object of the members that have a value. */
function object(members: [string, Json | undefined][]): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const [key, value] of members) if (value !== undefined) out[key] = value;
  return out;
}
const num = (value: number | undefined): number | undefined => (value !== undefined && Number.isFinite(value) ? value : undefined);
const time = (date: Date | undefined): number | undefined => (date ? refSeconds(date) : undefined);

export function watchStateBody(state: WatchState, now: Date = new Date()): { [key: string]: Json } {
  const goals = object([["calories", num(state.goalCalories)], ["exerciseMinutes", num(state.goalExerciseMinutes)], ["steps", num(state.goalSteps)]]);
  const today = object([["calories", num(state.todayCalories)], ["exerciseMinutes", num(state.todayExerciseMinutes)], ["steps", num(state.todaySteps)]]);
  const since = now.getTime() - BATTERY_HISTORY_DAYS * 86_400_000;
  const history = (state.batteryHistory ?? []).filter((r) => r.at.getTime() >= since);
  return object([
    ["name", state.name], ["model", state.model], ["firmware", state.firmware],
    ["syncedAt", time(state.syncedAt)],
    ["battery", state.battery ? { percent: state.battery.percent, readAt: refSeconds(state.battery.readAt) } : undefined],
    ["storage", state.storage ? { usedBytes: state.storage.usedBytes, totalBytes: state.storage.totalBytes } : undefined],
    ["goals", Object.keys(goals).length ? goals : undefined],
    ["today", Object.keys(today).length ? today : undefined],
    ["alarms", state.alarms?.map((a) => ({ slot: a.slot, enabled: a.enabled, hour: a.hour, minute: a.minute, days: [...a.days].sort((x, y) => x - y) }))],
    ["alarmsReadAt", state.alarms === undefined ? undefined : time(state.alarmsReadAt)],
    ["gpsMode", state.gpsMode],
    ["sleepSchedule", state.sleepSchedule ? { bedtime: state.sleepSchedule.bedtime, wake: state.sleepSchedule.wake } : undefined],
    ["gpsModes", state.gpsModes?.length ? state.gpsModes : undefined],
    ["batteryHistory", history.length ? history.map((r) => ({ at: refSeconds(r.at), percent: r.percent })) : undefined],
    ["refused", state.refused?.length ? state.refused.slice(-REFUSALS_KEPT).map((r) => ({ key: r.key, at: refSeconds(r.at) })) : undefined],
  ]);
}

/** At most `count` items, evenly spaced, always with the first and the last (SyncBodies.thinned). */
export function thinned<T>(items: T[], count: number): T[] {
  if (items.length <= count || count <= 1) return items;
  const step = (items.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => items[Math.min(items.length - 1, swiftRound(i * step))]);
}

/** Swift's `.rounded()`: to nearest, halves away from zero. */
export const swiftRound = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));
