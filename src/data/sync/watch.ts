// Synced watch items → the Watch screen, and the screen's waiting changes ↔ `watch.change` items.
// Pure: plain bodies and `now` in. Contract sections 5.3 and 5.4.
import type { Alarm, Goal, GoalKey, GpsMode, Watch } from "../watch";
import { alarmKey, queueChange, sameValue, type Json, type PendingChange } from "@/lib/watch";
import { dateToRef, refToDate, refToMs, type WatchAlarmBody, type WatchChangeBody, type WatchChangeKey, type WatchStateBody } from "./native";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const round1 = (v: number) => Math.round(v * 10) / 10;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole calendar days from `a` to `b` (DST-safe). */
const daysBetween = (a: Date, b: Date) => Math.round((midnight(b) - midnight(a)) / 86_400_000);

/* ───────────── watch.state → Watch ───────────── */

/** "today at 06:58", "yesterday at 21:10", "18 Nov at 06:58" (with the year when it is another one). */
export function whenText(at: Date, now: Date): string {
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const back = daysBetween(at, now);
  if (back === 0) return `today at ${time}`;
  if (back === 1) return `yesterday at ${time}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]}${at.getFullYear() === now.getFullYear() ? "" : ` ${at.getFullYear()}`} at ${time}`;
}

export const alarmTime = (a: Pick<WatchAlarmBody, "hour" | "minute">): string => `${two(a.hour)}:${two(a.minute)}`;

const cleanDays = (days: readonly number[] | undefined): number[] =>
  [...new Set((days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);

/** The watch's alarms as the page lists them. An alarm's id is its slot. */
export function alarmsOf(state: WatchStateBody | undefined): Alarm[] {
  return (state?.alarms ?? []).map((a, i) => ({
    id: a.slot != null ? `slot-${a.slot}` : `row-${i}`,
    time: alarmTime(a), days: cleanDays(a.days), label: "", on: a.enabled !== false,
  }));
}

const GOALS: { key: GoalKey; field: "calories" | "exerciseMinutes" | "steps"; name: string; unit: string; step: number; max: number }[] = [
  { key: "calories", field: "calories", name: "Active calories", unit: "kcal", step: 50, max: 9999 },
  { key: "exercise", field: "exerciseMinutes", name: "Exercise", unit: "min", step: 5, max: 1440 },
  { key: "steps", field: "steps", name: "Steps", unit: "steps", step: 500, max: 99999 },
];

export function goalsOf(state: WatchStateBody | undefined): Goal[] {
  const out: Goal[] = [];
  for (const g of GOALS) {
    const goal = state?.goals?.[g.field];
    if (goal == null) continue;
    const done = state?.today?.[g.field];
    const count = done == null ? "" : Math.round(done).toLocaleString("en-US");
    const soFar = done == null ? "" : g.key === "steps" ? `${count} so far today` : `${count} ${g.unit} so far today`;
    out.push({ key: g.key, name: g.name, unit: g.unit, goal, soFar, done: done ?? 0, step: g.step, max: g.max });
  }
  return out;
}

const GPS_OPTIONS: Watch["gpsOptions"] = [
  { mode: "standard", name: "Standard", detail: "Longest battery", accuracy: 1, battery: 3 },
  { mode: "all", name: "All systems", detail: "Better in cities and under trees", accuracy: 2, battery: 2 },
  { mode: "dual", name: "Dual frequency", detail: "Best accuracy, shortest battery", accuracy: 3, battery: 1 },
];

/** One level per local day from the first reading's day to the last: the day's last reading; a day without one keeps the level before it. */
export function batteryLevels(history: WatchStateBody["batteryHistory"]): { firstDay: string; levels: number[] } {
  const readings = [...(history ?? [])].filter((r) => Number.isFinite(r.at) && Number.isFinite(r.percent)).sort((a, b) => a.at - b.at);
  if (!readings.length) return { firstDay: "", levels: [] };
  const first = refToDate(readings[0].at);
  const levels: number[] = [];
  for (const r of readings) {
    const k = daysBetween(first, refToDate(r.at));
    while (levels.length < k) levels.push(levels[levels.length - 1]);
    levels[k] = r.percent;
  }
  return { firstDay: dayKey(first), levels };
}

/** Average fall in percent over the days the level fell (charging days left out). Null with fewer than 3 such days. */
export function averageDailyDrop(levels: readonly number[]): number | null {
  let fell = 0, days = 0;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] < levels[i - 1]) { fell += levels[i - 1] - levels[i]; days += 1; }
  }
  return days >= 3 ? fell / days : null;
}

function batteryAlt(firstDay: string, levels: readonly number[]): string {
  if (!levels.length) return "";
  const n = levels.length;
  let charged = -1;
  for (let i = n - 1; i > 0; i--) if (levels[i] > levels[i - 1]) { charged = i; break; }
  const parts: string[] = [];
  if (charged > 0) {
    const [y, m, d] = firstDay.split("-").map(Number);
    const day = new Date(y, m - 1, d + charged);
    parts.push(`charged to ${levels[charged]} percent on ${day.getDate()} ${MONTH_NAMES[day.getMonth()]}`);
  }
  parts.push(`now ${levels[n - 1]} percent`);
  return `Battery level over ${n} ${n === 1 ? "day" : "days"}: ${parts.join(", ")}`;
}

const SETTING_NAMES: Record<string, string> = {
  "goal.calories": "Active calories goal", "goal.exerciseMinutes": "Exercise goal", "goal.steps": "Steps goal",
  gpsMode: "Satellite systems", alarms: "Alarms",
};

/** "The watch refused: Steps goal (today at 06:58), Alarms (18 Nov at 21:10)". Empty when it refused nothing. */
export function refusedText(refused: WatchStateBody["refused"], now: Date): string {
  const lines = (refused ?? []).map((r) => {
    const name = SETTING_NAMES[r.key] ?? r.key;
    return Number.isFinite(r.at) ? `${name} (${whenText(refToDate(r.at), now)})` : name;
  });
  return lines.length ? `The watch refused: ${lines.join(", ")}` : "";
}

/** The page with nothing from the phone on it. */
export function emptyWatch(): Watch {
  return {
    name: "Watch", synced: "", battery: { percent: null, left: "" }, storage: null, firmware: { version: "", state: "" },
    goals: [], alarms: [], gpsMode: null, gpsOptions: [], gpsReadOnly: true,
    batteryHistory: { firstDay: "", levels: [], summary: "", perDay: "", alt: "" },
    pending: [], empty: true,
  };
}

export function watchFromState(state: WatchStateBody | undefined, changes: readonly ChangeItem[], now: Date): Watch {
  if (!state) return emptyWatch();
  const { firstDay, levels } = batteryLevels(state.batteryHistory);
  const drop = averageDailyDrop(levels);
  const perDay = drop != null && drop > 0 ? `${round1(drop)}% a day` : "";
  const percent = state.battery?.percent ?? null;
  const daysLeft = percent != null && drop != null && drop > 0 ? Math.round(percent / drop) : null;
  const settable = (state.gpsModes ?? []).filter((m): m is GpsMode => GPS_OPTIONS.some((o) => o.mode === m));
  const gpsMode = state.gpsMode ?? null;
  const gpsOptions = settable.length
    ? GPS_OPTIONS.filter((o) => settable.includes(o.mode) || o.mode === gpsMode)
    : GPS_OPTIONS.filter((o) => o.mode === gpsMode);
  const storage = state.storage && state.storage.totalBytes > 0
    ? { usedGb: round1(state.storage.usedBytes / 1e9), totalGb: round1(state.storage.totalBytes / 1e9) }
    : null;
  const refused = refusedText(state.refused, now);
  return {
    name: state.name || state.model || "Watch",
    synced: state.syncedAt != null ? `Synced ${state.via === "computer" ? "with this computer" : "through your phone"} ${whenText(refToDate(state.syncedAt), now)}` : "",
    battery: { percent, left: daysLeft == null ? "" : `About ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` },
    storage,
    firmware: { version: state.firmware ?? "", state: "" },
    goals: goalsOf(state),
    alarms: alarmsOf(state),
    gpsMode,
    gpsOptions,
    gpsReadOnly: settable.length === 0,
    batteryHistory: {
      firstDay, levels,
      summary: levels.length ? `Last ${levels.length} days${perDay ? ` · ${perDay} on average` : ""}` : "",
      perDay,
      alt: batteryAlt(firstDay, levels),
    },
    pending: pendingFromItems(state, changes),
    ...(refused ? { refused } : {}),
    ...(state.via === "computer" ? { viaComputer: true } : {}),
  };
}

/* ───────────── Waiting changes ↔ watch.change items ───────────── */

export interface ChangeItem { id: string; body: WatchChangeBody }

/** The page's key for a goal or the GPS mode ↔ the item id. Alarms are handled as one list. */
const PAGE_TO_ITEM: Record<string, Exclude<WatchChangeKey, "alarms">> = {
  "goal.calories": "goal.calories", "goal.exercise": "goal.exerciseMinutes", "goal.steps": "goal.steps", "gps.mode": "gpsMode",
};
const ITEM_TO_PAGE: Record<string, string> = Object.fromEntries(Object.entries(PAGE_TO_ITEM).map(([page, item]) => [item, page]));

function stateValue(state: WatchStateBody, id: string): Json {
  if (id === "goal.calories") return state.goals?.calories ?? null;
  if (id === "goal.exerciseMinutes") return state.goals?.exerciseMinutes ?? null;
  if (id === "goal.steps") return state.goals?.steps ?? null;
  if (id === "gpsMode") return state.gpsMode ?? null;
  return null;
}

const alarmJsonOf = (a: Alarm): Json => ({ id: a.id, time: a.time, days: [...a.days], label: a.label, on: a.on });
const sameAlarm = (a: Alarm, b: Alarm) => a.time === b.time && a.on === b.on && sameValue(cleanDays(a.days), cleanDays(b.days));

function bodyOfAlarm(a: Alarm, slot: number | undefined): WatchAlarmBody {
  const [hour, minute] = a.time.split(":").map(Number);
  return { ...(slot != null ? { slot } : {}), enabled: a.on, hour: hour || 0, minute: minute || 0, days: cleanDays(a.days) };
}

const sameAlarmBody = (a: WatchAlarmBody, b: WatchAlarmBody) =>
  a.slot === b.slot && (a.enabled !== false) === (b.enabled !== false) && a.hour === b.hour && a.minute === b.minute && sameValue(cleanDays(a.days), cleanDays(b.days));

const sameAlarmList = (a: readonly WatchAlarmBody[], b: readonly WatchAlarmBody[]) => a.length === b.length && a.every((x, i) => sameAlarmBody(x, b[i]));

/** The watch's own list in the shape a change carries, for comparing. */
const watchAlarmList = (state: WatchStateBody): WatchAlarmBody[] =>
  (state.alarms ?? []).map((a) => ({ ...(a.slot != null ? { slot: a.slot } : {}), enabled: a.enabled !== false, hour: a.hour, minute: a.minute, days: cleanDays(a.days) }));

/**
 * The whole alarm list the watch should end up with: its own alarms with the waiting edits applied and the removed
 * ones left out, then the added ones in the order they were added (no slot: the phone picks one).
 */
export function wantedAlarms(state: WatchStateBody, queue: readonly PendingChange[]): WatchAlarmBody[] {
  const onWatch = alarmsOf(state);
  const known = new Set(onWatch.map((a) => alarmKey(a.id)));
  const out: WatchAlarmBody[] = [];
  onWatch.forEach((alarm, i) => {
    const hit = queue.find((c) => c.key === alarmKey(alarm.id));
    if (hit && hit.to === null) return;
    out.push(bodyOfAlarm(hit ? (hit.to as unknown as Alarm) : alarm, state.alarms?.[i]?.slot));
  });
  for (const c of queue) {
    if (c.key.startsWith("alarm.") && !known.has(c.key) && c.to !== null) out.push(bodyOfAlarm(c.to as unknown as Alarm, undefined));
  }
  return out;
}

/** Items → the page's waiting list: one entry per goal or GPS change, and one per alarm added, changed or removed. */
export function pendingFromItems(state: WatchStateBody, changes: readonly ChangeItem[]): PendingChange[] {
  const out: PendingChange[] = [];
  for (const { id, body } of changes) {
    if (!body) continue;
    const at = Number.isFinite(body.at) ? refToMs(body.at) : 0;
    if (id === "alarms") {
      if (!Array.isArray(body.value)) continue;
      const wanted = body.value;
      const onWatch = alarmsOf(state);
      const slots = (state.alarms ?? []).map((a) => a.slot);
      const used = new Set<number>();
      onWatch.forEach((alarm, i) => {
        const k = wanted.findIndex((w, j) => !used.has(j) && w.slot != null && w.slot === slots[i]);
        if (k < 0) { out.push({ key: alarmKey(alarm.id), from: alarmJsonOf(alarm), to: null, at }); return; }
        used.add(k);
        const next: Alarm = { id: alarm.id, time: alarmTime(wanted[k]), days: cleanDays(wanted[k].days), label: "", on: wanted[k].enabled !== false };
        if (!sameAlarm(alarm, next)) out.push({ key: alarmKey(alarm.id), from: alarmJsonOf(alarm), to: alarmJsonOf(next), at });
      });
      let added = 0;
      wanted.forEach((w, j) => {
        if (used.has(j)) return;
        const alarm: Alarm = { id: `new-${added++}`, time: alarmTime(w), days: cleanDays(w.days), label: "", on: w.enabled !== false };
        out.push({ key: alarmKey(alarm.id), from: null, to: alarmJsonOf(alarm), at });
      });
      continue;
    }
    const key = ITEM_TO_PAGE[id];
    if (!key || Array.isArray(body.value)) continue;
    const from = stateValue(state, id);
    if (!sameValue(from, body.value)) out.push({ key, from, to: body.value, at });
  }
  return out;
}

export interface ChangeWrites {
  puts: { id: WatchChangeKey; body: WatchChangeBody }[];
  removes: string[];
}

/**
 * The page's waiting list → what to write: an item per changed setting (only when its value differs from the item
 * already there), and a removal for every item that is no longer wanted. An empty list removes them all.
 */
export function changeWrites(state: WatchStateBody, queue: readonly PendingChange[], existing: readonly ChangeItem[], now: Date): ChangeWrites {
  const at = dateToRef(now);
  const wanted = new Map<WatchChangeKey, WatchChangeBody["value"]>();
  for (const c of queue) {
    const id = PAGE_TO_ITEM[c.key];
    if (!id || c.to === null) continue;
    if (id === "gpsMode" ? typeof c.to === "string" : typeof c.to === "number") wanted.set(id, c.to as number | GpsMode);
  }
  if (queue.some((c) => c.key.startsWith("alarm."))) {
    const list = wantedAlarms(state, queue);
    if (!sameAlarmList(list, watchAlarmList(state))) wanted.set("alarms", list);
  }
  const have = new Map(existing.map((e) => [e.id, e.body?.value]));
  const puts: ChangeWrites["puts"] = [];
  for (const [id, value] of wanted) {
    const old = have.get(id);
    const same = id === "alarms" ? Array.isArray(old) && sameAlarmList(old, value as WatchAlarmBody[]) : old === value;
    if (!same) puts.push({ id, body: { value, at, from: "web" } });
  }
  return { puts, removes: existing.map((e) => e.id).filter((id) => !wanted.has(id as WatchChangeKey)) };
}

/** One change made on the page (or undone, when `next` equals `original`), as writes. */
export function writesForChange(
  state: WatchStateBody, existing: readonly ChangeItem[], key: string, original: Json, next: Json, now: Date,
): ChangeWrites {
  const queue = queueChange(pendingFromItems(state, existing), key, original, next, now.getTime());
  return changeWrites(state, queue, existing, now);
}

/** Dropping the waiting change for one setting, as writes. */
export function writesForUndo(state: WatchStateBody, existing: readonly ChangeItem[], key: string, now: Date): ChangeWrites {
  return changeWrites(state, pendingFromItems(state, existing).filter((c) => c.key !== key), existing, now);
}
