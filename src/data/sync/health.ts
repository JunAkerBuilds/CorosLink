// Health from synced items: the latest night, this morning's measures and the trend series.
import type { HealthData, MorningMeasure, SleepNight, SleepSegment, TrendSeries } from "../health";
import type { EnergyDayBody, NativeDayVitals, NativeSleepNight } from "./native";
import { refToDate } from "./native";
import { dayKey, parseDay } from "@/lib/format";
import { addDays, mean, present } from "@/lib/health";
import { t } from "@/lib/i18n";

interface Item<B> { id: string; body: B }

/** Longest run of days the trends go back. */
const MAX_DAYS = 365;

const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

/**
 * A night as the Health page draws it. Stages, when the phone sent them, become the segments (whole seconds kept);
 * a night with totals only has no segments and carries the totals instead.
 */
export function nightFromItem(n: NativeSleepNight): SleepNight {
  const spans = [...(n.stages ?? [])].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const segments: SleepSegment[] = spans.map((s) => ({ stage: s.stage, minutes: Math.round(s.end - s.start) / 60 }));
  const begin = spans[0]?.start ?? n.bedtime;
  const totals: NonNullable<SleepNight["totals"]> = {};
  if (n.awakeMinutes != null) totals.awake = n.awakeMinutes;
  if (n.remMinutes != null) totals.rem = n.remMinutes;
  if (n.lightMinutes != null) totals.light = n.lightMinutes;
  if (n.deepMinutes != null) totals.deep = n.deepMinutes;
  if (n.totalMinutes != null) totals.asleep = n.totalMinutes;
  if (n.bedtime != null && n.wakeTime != null && n.wakeTime > n.bedtime) totals.inBed = Math.round(n.wakeTime - n.bedtime) / 60;
  return {
    score: n.score ?? null,
    startMinute: begin != null ? minuteOfDay(refToDate(begin)) : null,
    segments, totals,
    heartRateAsleep: n.averageHR ?? null,
  };
}

export interface MeasureMaths {
  today: number;
  /** Mean of the readings in the last seven days, today included. */
  week: number;
  /** 0…100 between the lowest and highest of the last 30 days; null when they are the same. */
  position: number | null;
}

/** Today against the last 7 and 30 days of a daily series (oldest first, last = today). Null when today has no reading. */
export function measureMaths(values: readonly (number | null)[]): MeasureMaths | null {
  const today = values[values.length - 1];
  if (today == null) return null;
  const month = present(values.slice(-30));
  const low = Math.min(...month), high = Math.max(...month);
  return {
    today,
    week: mean(present(values.slice(-7))),
    position: high > low ? Math.round(((today - low) / (high - low)) * 100) : null,
  };
}

/** Minutes as "7:42". */
const hoursMinutes = (minutes: number) => {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** One value per day from `first` to `last` (both YYYY-MM-DD dates), null where `read` has nothing. */
function daily(first: Date, count: number, read: (key: string) => number | undefined): (number | null)[] {
  return Array.from({ length: count }, (_, k) => read(dayKey(addDays(first, k))) ?? null);
}

export function healthFromItems(
  days: readonly Item<NativeDayVitals>[], nights: readonly Item<NativeSleepNight>[], energy: readonly Item<EnergyDayBody>[], now: Date,
): HealthData {
  const dayBy = new Map(days.map((d) => [d.id, d.body]));
  const nightBy = new Map(nights.map((n) => [n.id, n.body]));
  const energyBy = new Map(energy.map((e) => [e.id, e.body]));

  const todayKey = dayKey(now);
  const current = energyBy.get(todayKey)?.now?.level;
  const energyNow = current != null ? Math.round(current) : null;

  const nightKeys = [...nightBy.keys()].sort();
  const latestNight = nightKeys.length ? nightBy.get(nightKeys[nightKeys.length - 1])! : null;
  const night = latestNight ? nightFromItem(latestNight) : null;

  const keys = [...dayBy.keys(), ...nightKeys, ...energyBy.keys()].sort();
  if (keys.length === 0) return { lastDay: todayKey, energyNow, night, morning: [], trends: [] };

  const lastDay = keys[keys.length - 1];
  const last = parseDay(lastDay);
  const oldest = parseDay(keys[0]), limit = addDays(last, -(MAX_DAYS - 1));
  const first = oldest > limit ? oldest : limit;
  const count = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;

  const hrv = daily(first, count, (k) => dayBy.get(k)?.hrv);
  const rhr = daily(first, count, (k) => dayBy.get(k)?.restingHR);
  const sleep = daily(first, count, (k) => nightBy.get(k)?.totalMinutes ?? dayBy.get(k)?.sleepMinutes);
  const stress = daily(first, count, (k) => dayBy.get(k)?.stress);
  const steps = daily(first, count, (k) => dayBy.get(k)?.steps);
  const waking = daily(first, count, (k) => energyBy.get(k)?.woke?.level);

  const morning: MorningMeasure[] = [];
  const row = (name: string, hue: MorningMeasure["hue"], values: (number | null)[], today: (v: number) => string, week: (v: number) => string) => {
    const m = measureMaths(values);
    if (m) morning.push({ name, today: today(m.today), week: week(m.week), position: m.position, hue });
  };
  const whole = (v: number) => String(Math.round(v));
  row("HRV", "cyan", hrv, (v) => `${v} ms`, whole);
  row(t("Resting heart rate"), "rose", rhr, (v) => `${v} bpm`, whole);
  row(t("Sleep"), "violet", sleep, hoursMinutes, hoursMinutes);
  row(t("Stress"), "coral", stress, String, whole);
  const nightScore = daily(first, count, (k) => nightBy.get(k)?.score ?? dayBy.get(k)?.sleepScore);
  row(t("Sleep score"), "violet", nightScore, String, whole);
  row(t("Energy on waking"), "mint", waking, (v) => String(Math.round(v)), whole);

  const all: TrendSeries[] = [
    { id: "hrv", name: "HRV", hue: "cyan", unit: " ms", format: "int", values: hrv },
    { id: "rhr", name: t("Resting heart rate"), hue: "rose", unit: " bpm", format: "int", values: rhr },
    { id: "sleep", name: t("Sleep"), hue: "violet", unit: "", format: "hours", values: sleep.map((m) => (m == null ? null : m / 60)) },
    { id: "stress", name: t("Stress"), hue: "coral", unit: "", format: "int", values: stress },
    { id: "steps", name: t("Steps"), hue: "orange", unit: "", format: "thousands", values: steps },
    { id: "energy", name: t("Energy on waking"), hue: "mint", unit: "", format: "int", values: waking },
  ];
  return { lastDay, energyNow, night, morning, trends: all.filter((series) => series.values.some((v) => v != null)) };
}
