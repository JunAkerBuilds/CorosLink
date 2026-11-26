// Energy from synced `energy.day` items (contract 5.2), one screen day per item.
import type { EnergyBand, EnergyDay, EnergyEvent, EnergyPoint } from "../energy";
import type { EnergyDayBody, NativeSleepNight } from "./native";
import { dayKey, parseDay } from "@/lib/format";
import { addDays, clockOfDay, energyAt, energyRange } from "@/lib/health";
import { msg, t } from "@/lib/i18n";

interface Item<B> { id: string; body: B }
type NativeEvent = NonNullable<EnergyDayBody["events"]>[number];

const DAY = 1440;
const PACE: Record<NonNullable<EnergyDayBody["trend"]>, NonNullable<EnergyDay["pace"]>> = {
  charging: { label: msg("Charging"), direction: "up" },
  steady: { label: msg("Holding steady"), direction: "flat" },
  usingSlowly: { label: msg("Using slowly"), direction: "down" },
  usingFast: { label: msg("Using fast"), direction: "down" },
};

const whole = (p: { minute: number; level: number }): EnergyPoint => ({ minute: p.minute, level: Math.round(p.level) });

/** The readings inside the day (00:00…24:00), with the level read off the line where it crosses midnight. */
export function pointsOfDay(points: readonly EnergyPoint[]): EnergyPoint[] {
  const sorted = [...points].sort((a, b) => a.minute - b.minute);
  const inside = sorted.filter((p) => p.minute >= 0 && p.minute <= DAY).map(whole);
  const edge = (minute: number) => {
    const level = energyAt(sorted, minute);
    return level == null ? null : { minute, level: Math.round(level) };
  };
  if (sorted.length && sorted[0].minute < 0 && inside[0]?.minute !== 0) { const p = edge(0); if (p) inside.unshift(p); }
  if (sorted.length && sorted[sorted.length - 1].minute > DAY && inside[inside.length - 1]?.minute !== DAY) { const p = edge(DAY); if (p) inside.push(p); }
  return inside;
}

/** The shaded stretches: every sleep, rest, workout and stress event, cut to the day. A night that began the evening before starts at 00:00. */
export function bandsOfDay(events: readonly NativeEvent[]): EnergyBand[] {
  const bands: EnergyBand[] = [];
  for (const e of [...events].sort((a, b) => a.startMinute - b.startMinute)) {
    if (e.kind === "awake") continue;
    const from = Math.max(0, e.startMinute), to = Math.min(DAY, e.endMinute);
    if (to > from) bands.push({ kind: e.kind, from, to, label: nameOf(e) });
  }
  return bands;
}

const nameOf = (e: NativeEvent) =>
  e.kind === "sleep" ? t("Sleep") : e.kind === "rest" ? t("Rest") : e.kind === "stress" ? t("Stress") : e.kind === "awake" ? t("Awake") : e.workoutName || t("Workout");

/**
 * What charged and used energy, oldest first. Changes are whole points, as the phone shows them. Time awake is one
 * entry at the end, however many stretches the phone sent.
 */
export function eventsOfDay(events: readonly NativeEvent[], current: boolean): EnergyEvent[] {
  const out: EnergyEvent[] = [];
  let awake: number | null = null;
  for (const e of [...events].sort((a, b) => a.startMinute - b.startMinute)) {
    if (e.change == null) continue;
    if (e.kind === "awake") { awake = (awake ?? 0) + e.change; continue; }
    const when = `${clockOfDay(e.startMinute)} – ${clockOfDay(e.endMinute)}`;
    const event: EnergyEvent = { kind: e.kind, name: nameOf(e), detail: when, delta: Math.round(e.change) };
    if (e.kind === "sleep") {
      event.when = when;
      if (e.sleepScore != null) event.detail = t("{time} · Score {score}", { time: when, score: e.sleepScore });
    }
    out.push(event);
  }
  if (awake != null) {
    const event: EnergyEvent = { kind: "awake", name: t("Awake"), detail: current ? t("The rest of the day so far") : t("The rest of the day"), delta: Math.round(awake) };
    if (current) event.when = t("so far");
    out.push(event);
  }
  return out;
}

/**
 * One screen day from one item, or null when the item has nothing to draw. `current` is the day still running:
 * only then are now, the pace and the projection to bedtime kept. `next` is the following day's item, whose night
 * shades this day's late evening.
 */
export function energyDayFromItem(date: string, body: EnergyDayBody, current: boolean, night?: NativeSleepNight, next?: EnergyDayBody): EnergyDay | null {
  const points = pointsOfDay(body.points ?? []);
  const woke = body.woke ? whole(body.woke) : null;
  const range = energyRange(points, woke?.minute ?? 0) ?? (woke ? { low: woke.level, high: woke.level } : null);
  if (!range) return null;

  const events = body.events ?? [];
  const bands = bandsOfDay(events);
  for (const e of next?.events ?? []) {
    if (e.kind === "sleep" && e.startMinute < 0 && e.endMinute > e.startMinute) {
      bands.push({ kind: "sleep", from: Math.max(0, DAY + e.startMinute), to: Math.min(DAY, DAY + e.endMinute), label: t("Sleep") });
    }
  }

  const day: EnergyDay = { date, points, bands, events: eventsOfDay(events, current), woke, low: range.low, high: range.high };
  if (body.learning) day.learning = true;

  const slept = events.filter((e) => e.kind === "sleep").sort((a, b) => (b.endMinute - b.startMinute) - (a.endMinute - a.startMinute))[0];
  const score = slept?.sleepScore ?? night?.score;
  if (night?.totalMinutes != null && score != null) day.sleep = { minutes: night.totalMinutes, score };

  if (current && body.now) {
    day.now = whole(body.now);
    if (body.trend) day.pace = { ...PACE[body.trend], label: t(PACE[body.trend].label) };
    // Where the day is heading: the end of the phone's projection. (`bedtime` in the contract is last night's.)
    const ahead = (body.projection ?? []).filter((p) => p.minute > body.now!.minute).sort((a, b) => a.minute - b.minute);
    const end = ahead[ahead.length - 1] ?? (body.bedtime && body.bedtime.minute > body.now.minute ? body.bedtime : undefined);
    if (end) {
      const level = end.minute > DAY ? energyAt([body.now, end], DAY) ?? end.level : end.level;
      day.bedtime = { minute: Math.min(DAY, end.minute), level: Math.round(level) };
    }
  }
  return day;
}

/** Every synced day, oldest first. Days the phone did not send are simply not there. */
export function energyFromItems(items: readonly Item<EnergyDayBody>[], nights: readonly Item<NativeSleepNight>[], now: Date): EnergyDay[] {
  const todayKey = dayKey(now);
  const byDay = new Map(items.map((i) => [i.id, i.body]));
  const nightBy = new Map(nights.map((n) => [n.id, n.body]));
  const days: EnergyDay[] = [];
  for (const id of [...byDay.keys()].sort()) {
    const next = byDay.get(dayKey(addDays(parseDay(id), 1)));
    const day = energyDayFromItem(id, byDay.get(id)!, id === todayKey, nightBy.get(id), next);
    if (day) days.push(day);
  }
  return days;
}
