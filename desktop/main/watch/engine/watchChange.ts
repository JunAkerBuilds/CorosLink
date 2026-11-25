// A setting changed on the web, waiting to be written to the watch (sync contract §5.4): the item's id is the
// setting's key, its body `{ value, at, from }`. A port of CorosKit's Sync/SyncWatchChange.swift.
import { alarm, ALARM_SLOTS, alarmDays, daysFromContract, type WatchAlarm } from "./alarms";
import { compact } from "./native";

export const WATCH_CHANGE_KEYS = ["goal.calories", "goal.exerciseMinutes", "goal.steps", "gpsMode", "alarms"] as const;
export type WatchChangeKey = (typeof WATCH_CHANGE_KEYS)[number];

/** The step goal lives on the phone, so it needs no watch. */
export const needsWatch = (key: WatchChangeKey): boolean => key !== "goal.steps";

/** An alarm as the web wants it: `slot` undefined for a new one. `days`: 0 = Sunday … 6 = Saturday, empty rings once. */
export interface ChangeAlarm { slot?: number; enabled: boolean; hour: number; minute: number; days: number[] }

export type WatchChangeValue = { number: number } | { mode: string } | { alarms: ChangeAlarm[] };

export interface WatchChange {
  key: WatchChangeKey;
  value: WatchChangeValue;
  /** When it was changed on the web: seconds since 2001, as the contract writes every `…At`. */
  at?: number;
  from?: string;
}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
/** JSONValue.intValue: a whole, finite number. */
const intValue = (v: Json): number | null => (typeof v === "number" && Number.isFinite(v) && v === Math.round(v) && Math.abs(v) < 9e15 ? v : null);
const numberValue = (v: Json): number | null => (typeof v === "number" ? v : null);

/** From a pulled item; null when the key isn't one this computer knows or the value doesn't fit it. */
export function parseWatchChange(id: string, body: Json): WatchChange | null {
  if (!(WATCH_CHANGE_KEYS as readonly string[]).includes(id) || !isObject(body) || !("value" in body)) return null;
  const key = id as WatchChangeKey, raw = body.value;
  let value: WatchChangeValue;
  switch (key) {
    case "goal.calories":
    case "goal.exerciseMinutes":
    case "goal.steps": {
      const n = intValue(raw);
      if (n === null || n < 0) return null;
      value = { number: n };
      break;
    }
    case "gpsMode":
      if (typeof raw !== "string") return null;
      value = { mode: raw };
      break;
    case "alarms": {
      if (!Array.isArray(raw)) return null;
      const alarms: ChangeAlarm[] = [];
      for (const row of raw) {
        const hour = isObject(row) ? intValue(row.hour) : null, minute = isObject(row) ? intValue(row.minute) : null;
        if (!isObject(row) || hour === null || minute === null || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
        const days = (Array.isArray(row.days) ? row.days : []).map(intValue).filter((d): d is number => d !== null && d >= 0 && d <= 6);
        const slot = intValue(row.slot);
        alarms.push(compact({ slot: slot ?? undefined, enabled: typeof row.enabled === "boolean" ? row.enabled : true, hour, minute,
          days: [...new Set(days)].sort((a, b) => a - b) }));
      }
      value = { alarms };
      break;
    }
  }
  return compact({ key, value, at: numberValue(body.at) ?? undefined, from: typeof body.from === "string" ? body.from : undefined });
}

/** The item's body. */
export function watchChangeBody(change: WatchChange): Record<string, Json> {
  const v = change.value;
  const raw = "number" in v ? v.number : "mode" in v ? v.mode
    : v.alarms.map((a) => compact({ slot: a.slot, enabled: a.enabled, hour: a.hour, minute: a.minute, days: a.days }));
  return compact({ value: raw, at: change.at !== undefined && Number.isFinite(change.at) ? change.at : undefined, from: change.from });
}

/**
 * What to write so the watch's alarms become `wanted`: each wanted alarm in its slot (a new one in the first free
 * slot), and the slots the watch has that aren't wanted any more, to clear. Null when they can't fit: more than the
 * watch's slots, a slot out of range or named twice.
 */
export function alarmPlan(wanted: ChangeAlarm[], current: WatchAlarm[], slots = ALARM_SLOTS): { write: WatchAlarm[]; clear: WatchAlarm[] } | null {
  if (wanted.length > slots) return null;
  const named = wanted.flatMap((a) => (a.slot === undefined ? [] : [a.slot]));
  if (new Set(named).size !== named.length || !named.every((s) => s >= 0 && s < slots)) return null;
  const taken = new Set(named);
  // A new alarm never lands on one being cleared in the same go: the watch's reply doesn't say which write won.
  const free: number[] = [];
  for (let s = 0; s < slots; s++) if (!taken.has(s) && !current.some((c) => c.slot === s)) free.push(s);
  const write: WatchAlarm[] = [];
  for (const a of wanted) {
    let slot: number;
    if (a.slot !== undefined) slot = a.slot;
    else {
      const next = free.shift();
      if (next === undefined) return null;
      slot = next;
      taken.add(slot);
    }
    const want = alarm(slot, a.enabled, a.hour, a.minute, daysFromContract(a.days));
    // An alarm the watch already has as wanted isn't written again.
    const same = current.some((c) => c.slot === slot && c.enabled === want.enabled && c.hour === want.hour && c.minute === want.minute && alarmDays(c) === alarmDays(want));
    if (!same) write.push(want);
  }
  return { write, clear: current.filter((c) => !taken.has(c.slot)) };
}
