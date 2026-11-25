// Body from synced items: what the phone worked out (`view.body`), the goals (`body.goals`), the Fuel profile
// (`fuel.profile`), measurements typed on the web (`body.measurement`) and the nightly readings (`health.day`)
// into the Body screen's types, and the screen's edits back into item bodies. Pure: items and `now` in, values out.
import type { BodyData, BodyProfile, GoalKind, Measurement, OwnMeasurement, ProfileEdit, Signal, WatchStat } from "@/data/body";
import {
  calendarDayKey, dateToRef, refToDate,
  type BodyGoalsBody, type BodyMeasurementBody, type NativeDayVitals, type NativeFuelProfile, type RefDate, type ViewBodyBody, type ViewTrainingBody,
} from "./native";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const real = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const isDayKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const GOALS: readonly GoalKind[] = ["lose", "maintain", "gain", "custom"];

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + delta));
}

// MARK: Measurements

/** The measurements typed on the web, oldest first, each under its item id. Ones without a day or a weight are left out. */
export function ownMeasurements(items: readonly { id: string; body: BodyMeasurementBody }[]): OwnMeasurement[] {
  return items
    .filter((i) => i.body && isDayKey(i.body.day) && real(i.body.weightKg))
    .map((i): OwnMeasurement => ({ id: i.id, day: i.body.day, weightKg: i.body.weightKg, ...(real(i.body.bodyFatPct) ? { bodyFatPct: i.body.bodyFatPct } : {}) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
}

/** The phone's one weight as a reading on the day it was taken. Null when it has no weight or no date for it. */
export function phoneWeight(view: ViewBodyBody | undefined): Measurement | null {
  if (!view || !real(view.weightKg)) return null;
  const at: RefDate | undefined = real(view.weightAt) ? view.weightAt : real(view.computedAt) ? view.computedAt : undefined;
  return at == null ? null : { day: localDay(refToDate(at)), weightKg: view.weightKg };
}

/** A measurement as a `body.measurement` body. */
export function measurementBody(m: Measurement): BodyMeasurementBody {
  return { day: m.day, weightKg: m.weightKg, ...(m.bodyFatPct == null ? {} : { bodyFatPct: m.bodyFatPct }) };
}

/**
 * Where a measurement saved on the screen goes: under the id of the one already on that day (which it replaces),
 * else under `fresh`. Any other items on that day are removed.
 */
export function measurementWrite(items: readonly { id: string; body: BodyMeasurementBody }[], m: Measurement, fresh: string): { id: string; body: BodyMeasurementBody; remove: string[] } {
  const same = items.filter((i) => i.body?.day === m.day).map((i) => i.id).sort();
  return { id: same[0] ?? fresh, body: measurementBody(m), remove: same.slice(1) };
}

/** The item id a measurement saved in this browser moves to: its own id when that is a UUID, so moving twice writes once. */
export function movedId(m: Pick<OwnMeasurement, "id">, fresh: () => string): string {
  return /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(m.id) ? m.id.toUpperCase() : fresh();
}

// MARK: Profile

/** Height, age and goal from the Fuel profile, the goal weight from the goals, resting energy as the phone worked it out. */
export function bodyProfile(profile: NativeFuelProfile | undefined, goals: BodyGoalsBody | undefined, view: ViewBodyBody | undefined): BodyProfile {
  const target = goals?.goals?.weight?.target;
  return {
    heightCm: real(profile?.heightCm) && profile.heightCm > 0 ? profile.heightCm : null,
    age: real(profile?.age) ? profile.age : null,
    goal: profile && GOALS.includes(profile.goal) ? profile.goal : null,
    goalWeightKg: real(target) ? target : null,
    restingKcal: real(view?.restingKcal) ? view.restingKcal : null,
  };
}

/**
 * The Fuel profile with a newly typed weight, so the phones (which take the Fuel profile from the web but keep no
 * typed measurements of their own) use it for Fuel's targets. Only for the newest typed day; null when nothing changes.
 */
export function profileWithWeight(profile: NativeFuelProfile, measurements: readonly { body: BodyMeasurementBody }[], m: Pick<BodyMeasurementBody, "day" | "weightKg">): NativeFuelProfile | null {
  if (!real(m.weightKg) || m.weightKg <= 0) return null;
  if (measurements.some((i) => i.body?.day > m.day)) return null;
  return m.weightKg === profile.weightKg ? null : { ...profile, weightKg: m.weightKg };
}

/** The Fuel profile with the height and goal edited on the screen; every other field as the phone wrote it. Null when nothing changed. */
export function profileWithEdit(profile: NativeFuelProfile, edit: ProfileEdit): NativeFuelProfile | null {
  const heightCm = real(edit.heightCm) ? edit.heightCm : profile.heightCm;
  const goal = edit.goal ?? profile.goal;
  return heightCm === profile.heightCm && goal === profile.goal ? null : { ...profile, heightCm, goal };
}

/**
 * The goals with a new weight goal, as the phone sets one (BodyGoal): counted from the current weight, from now.
 * A date to be there by is kept; other goals stay. Null when the target is the one already there.
 */
export function goalsWithWeight(existing: BodyGoalsBody | undefined, target: number, currentKg: number, now: Date): BodyGoalsBody | null {
  const was = existing?.goals?.weight;
  if (was && was.target === target) return null;
  const weight = { target, start: currentKg, startDate: dateToRef(now), ...(real(was?.byDate) ? { byDate: was.byDate } : {}) };
  return { ...existing, goals: { ...existing?.goals, weight } };
}

// MARK: Nightly readings

export interface Reading { day: string; value: number }

/** One of the day's numbers through time, oldest first, up to `today`. Days without it are left out. */
export function readings(days: readonly NativeDayVitals[], pick: (v: NativeDayVitals) => number | undefined, today: string): Reading[] {
  const byDay = new Map<string, number>();
  for (const v of days) {
    if (!v?.day) continue;
    const value = pick(v), day = calendarDayKey(v.day);
    if (real(value) && value > 0 && day <= today) byDay.set(day, value);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, value]) => ({ day, value }));
}

export interface Against {
  latest: number;
  /** The mean of the 30 days before the latest reading's day. Null with no reading in them. */
  usual: number | null;
  /** The latest reading minus the first one of the 30 days ending on its day. Null when that is the same reading. */
  change30: number | null;
  /** The last 14 readings, oldest first. */
  values: number[];
}

/** The latest reading against the person's usual. Null with no readings. */
export function against(list: readonly Reading[]): Against | null {
  const last = list.at(-1);
  if (!last) return null;
  const from = shiftDay(last.day, -30);
  const before = list.filter((r) => r.day >= from && r.day < last.day);
  const window = list.filter((r) => r.day > from);
  return {
    latest: last.value,
    usual: before.length ? before.reduce((sum, r) => sum + r.value, 0) / before.length : null,
    change30: window.length > 1 ? last.value - window[0].value : null,
    values: list.slice(-14).map((r) => r.value),
  };
}

const whole = (v: number) => String(Math.round(v));
const signedWhole = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(Math.round(v))}`;
/** A reading as it came, without float noise: 48, 61.5. */
const plain = (v: number) => String(Math.round(v * 100) / 100);

const NIGHTLY = [
  { name: "Resting heart rate", short: "Resting HR", unit: "bpm", hue: "rose", pick: (v: NativeDayVitals) => v.restingHR },
  { name: "HRV", short: "HRV", unit: "ms", hue: "cyan", pick: (v: NativeDayVitals) => v.hrv },
] as const;

/** Resting heart rate and HRV against the usual, and VO2max. Breathing has no synced source. */
export function signalsAndStats(days: readonly NativeDayVitals[], training: ViewTrainingBody | undefined, today: string): { signals: Signal[]; stats: WatchStat[] } {
  const signals: Signal[] = [], stats: WatchStat[] = [];
  for (const n of NIGHTLY) {
    const a = against(readings(days, n.pick, today));
    if (!a) continue;
    const diff = a.usual == null ? null : Math.round(a.latest - a.usual);
    signals.push({
      name: n.name, hue: n.hue, values: a.values,
      detail: `${plain(a.latest)} ${n.unit}${a.usual == null ? "" : ` · Usual ${whole(a.usual)}`}`,
      pill: diff == null ? "" : diff === 0 ? "Usual" : `${signedWhole(diff)} ${n.unit}`,
    });
    const change = a.change30 == null ? null : Math.round(a.change30);
    stats.push({
      name: n.short, value: plain(a.latest), unit: n.unit, hue: n.hue, values: a.values,
      note: change == null ? "" : change === 0 ? "Steady" : `${signedWhole(change)} in 30 days`,
    });
  }
  if (real(training?.vo2max) && training.vo2max > 0) stats.push({ name: "VO2max", value: plain(training.vo2max), unit: "ml/kg/min", note: "", hue: "blue", values: [] });
  return { signals, stats };
}

// MARK: The screen

export interface BodyItems {
  view: ViewBodyBody | undefined;
  goals: BodyGoalsBody | undefined;
  profile: NativeFuelProfile | undefined;
  measurements: readonly { id: string; body: BodyMeasurementBody }[];
  days: readonly NativeDayVitals[];
  training: ViewTrainingBody | undefined;
}

/** The Body screen from synced items. Nothing here comes from the sample athlete. */
export function bodyFromItems(items: BodyItems, now: Date): BodyData {
  const today = localDay(now);
  const age = items.view?.bodyAge;
  const phone = phoneWeight(items.view);
  return {
    sampleDay: today,
    profile: bodyProfile(items.profile, items.goals, items.view),
    bodyAge: age && real(age.value) ? { value: age.value, ...(real(age.at) ? { asOf: localDay(refToDate(age.at)) } : {}) } : null,
    ...signalsAndStats(items.days, items.training, today),
    measurements: phone ? [phone] : [],
    own: ownMeasurements(items.measurements),
  };
}
