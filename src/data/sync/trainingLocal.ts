// The training view worked out on this computer, for people with no phone paired: the phone normally sends it
// (`view.training`), and without one the Dashboard's fitness, load and readiness would wait for a sync that never
// comes. Same models as the phone's CorosKit, from what the computer has: activities and the watch's days and nights.
// What needs the phone's recordings or its settings (VO2max, thresholds, bests, the weekly goal) stays out.
import { addDays } from "@/lib/calendar";
import { feelAdjustment } from "@/lib/feel";
import { dayKey } from "@/lib/format";
import { calendarDayKey, refToDate, type FeelCheckBody, type NativeActivity, type NativeDayVitals, type NativeSleepNight, type ViewTrainingBody } from "./native";
import type { SyncView } from "./engine";

export interface LocalTrainingItems {
  activities: readonly NativeActivity[];
  days: readonly NativeDayVitals[];
  nights: readonly NativeSleepNight[];
  /** Today's feel check, which moves readiness as it does on the phone. */
  feel?: FeelCheckBody;
}

/** Days of fitness and fatigue kept (CorosKit `SyncBodies.fitnessDays`). */
export const FITNESS_DAYS = 371;

/* ───────────── Fitness & freshness (CorosKit TrainingEffort) ───────────── */

/**
 * The heart rate the zones are read from: the highest a workout reached, the second highest when the highest
 * stands well clear (optical sensors spike).
 */
export function estimatedMaxHR(activities: readonly NativeActivity[]): number | null {
  const peaks = activities.map((a) => a.maxHR).filter((h): h is number => h != null && h >= 120 && h <= 230).sort((a, b) => b - a);
  if (!peaks.length) return null;
  return peaks.length >= 2 && peaks[0] - peaks[1] > 8 ? peaks[1] : peaks[0];
}

/** Edwards' summated heart-rate zones: minutes at 50–60 % of max count once, up to five times at 90 % and over. */
export function zoneWeight(heartRate: number, maxHR: number): number {
  const percent = (heartRate / maxHR) * 100;
  return percent < 50 ? 0 : percent < 60 ? 1 : percent < 70 ? 2 : percent < 80 ? 3 : percent < 90 ? 4 : 5;
}

/** A workout's effort from its average heart rate: all of it in the average's zone. */
export function effortOf(a: NativeActivity, maxHR: number): number | null {
  if (!a.averageHR || a.averageHR <= 0 || !a.durationSeconds || a.durationSeconds <= 0) return null;
  return (a.durationSeconds / 60) * zoneWeight(a.averageHR, maxHR);
}

/**
 * 42-day Fitness and 7-day Fatigue (Banister's model, as the phone draws it), every day from the first workout to
 * today, keeping the last `FITNESS_DAYS`. Null without a heart rate to score from.
 */
export function fitnessOf(activities: readonly NativeActivity[], now: Date): ViewTrainingBody["fitness"] | undefined {
  const maxHR = estimatedMaxHR(activities);
  if (maxHR == null) return undefined;
  const byDay = new Map<string, number>();
  for (const a of activities) {
    if (a.start == null) continue;
    const at = refToDate(a.start);
    if (at > now) continue;
    const score = effortOf(a, maxHR);
    if (score == null) continue;
    const k = dayKey(at);
    byDay.set(k, (byDay.get(k) ?? 0) + score);
  }
  if (!byDay.size) return undefined;
  const today = dayKey(now);
  const first = [...byDay.keys()].sort()[0];
  const fitness: number[] = [], fatigue: number[] = [];
  let fit = 0, fat = 0, start = first;
  for (let k = first; k <= today; k = addDays(k, 1)) {
    const effort = byDay.get(k) ?? 0;
    fit += (effort - fit) / 42;
    fat += (effort - fat) / 7;
    fitness.push(round1(fit));
    fatigue.push(round1(fat));
  }
  const skip = Math.max(0, fitness.length - FITNESS_DAYS);
  if (skip) start = addDays(first, skip);
  return { start, fitness: fitness.slice(skip), fatigue: fatigue.slice(skip) };
}

/* ───────────── Training load ───────────── */

/** COROS's word for a load ratio, on the board's scale (0.8 and 1.3 its marks, 1.5 where it turns red). */
export function loadStatus(ratio: number): string {
  return ratio < 0.8 ? "Decreasing" : ratio < 1 ? "Maintaining" : ratio <= 1.3 ? "Optimized" : ratio <= 1.5 ? "Performance" : "Excessive";
}

/**
 * Acute (7-day) over chronic (42-day) load. The watch's own reading from the last two days when it has one;
 * otherwise worked out from the workouts' training load: the daily average of the last 7 days over that of the last 42.
 */
export function loadOf(activities: readonly NativeActivity[], days: readonly NativeDayVitals[], now: Date): ViewTrainingBody["load"] | undefined {
  const today = dayKey(now);
  const byDay = new Map<string, number>();
  for (const a of activities) {
    if (a.start == null || a.trainingLoad == null) continue;
    const at = refToDate(a.start);
    if (at > now) continue;
    const k = dayKey(at);
    byDay.set(k, (byDay.get(k) ?? 0) + a.trainingLoad);
  }
  let weekTotal = 0;
  for (let back = 0; back < 7; back++) weekTotal += byDay.get(addDays(today, -back)) ?? 0;

  const watch = [...days].filter((d) => calendarDayKey(d.day) <= today).sort((a, b) => (calendarDayKey(a.day) < calendarDayKey(b.day) ? -1 : 1))
    .filter((d) => d.acuteLoad != null && d.chronicLoad != null && d.chronicLoad > 0).pop();
  if (watch && calendarDayKey(watch.day) >= addDays(today, -1)) {
    const ratio = watch.loadRatio ?? watch.acuteLoad! / watch.chronicLoad!;
    return { acute: watch.acuteLoad, chronic: watch.chronicLoad, ratio: round2(ratio), status: watch.loadComment || loadStatus(ratio), weekTotal: Math.round(weekTotal) };
  }

  if (!byDay.size) return undefined;
  const first = [...byDay.keys()].sort()[0];
  // Six weeks of history before the long-term average says anything.
  if (first > addDays(today, -41)) return undefined;
  let chronic = 0;
  for (let back = 0; back < 42; back++) chronic += byDay.get(addDays(today, -back)) ?? 0;
  const acute = weekTotal / 7;
  chronic /= 42;
  if (chronic <= 0) return undefined;
  const ratio = acute / chronic;
  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio: round2(ratio), status: loadStatus(ratio), weekTotal: Math.round(weekTotal) };
}

/* ───────────── Readiness (CorosKit Readiness.compute) ───────────── */

const CALIBRATION_NIGHTS = 14;
const SLEEP_NEED = 480;
type PartKind = "hrv" | "lastNight" | "sleepDebt" | "restingHR" | "timing";
const PART_WEIGHT: Record<PartKind, number> = { hrv: 30, lastNight: 20, sleepDebt: 15, restingHR: 15, timing: 5 };
const CAP = { strain: 59, shortNight: 64, unwell: 40 } as const;

const mean = (v: readonly number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const deviation = (v: readonly number[]) => {
  const m = mean(v);
  if (v.length < 2 || m == null) return null;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1));
};
const zScore = (z: number) => (z < 0 ? Math.max(0, 80 + 30 * z) : Math.min(100, 80 + 15 * z));
const asleep = (n: NativeSleepNight) => (n.totalMinutes && n.totalMinutes > 0 ? n.totalMinutes + Math.min(90, n.napMinutes ?? 0) : null);
/** Swift's `.rounded()`: halves away from zero. */
const swiftRound = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

/** Readiness's band for a score. */
export const band = (score: number): string => (score >= 80 ? "primed" : score >= 65 ? "ready" : score >= 50 ? "steady" : "low");

/**
 * Today's readiness from the watch's HRV, sleep and resting heart rate, or null without enough to say anything:
 * at least two parts, one of them HRV or last night's sleep. COROS's recovery and HRV status are the phone's only.
 */
export function readinessOf(days: readonly NativeDayVitals[], nights: readonly NativeSleepNight[], feelCheck: FeelCheckBody | undefined, now: Date): ViewTrainingBody["readiness"] | undefined {
  const today = dayKey(now);
  const feel = feelCheck && feelCheck.feel >= 1 && feelCheck.feel <= 5 ? feelCheck : undefined;
  const byDay = [...days].map((d) => ({ k: calendarDayKey(d.day), d })).filter((x) => x.k <= today).sort((a, b) => (a.k < b.k ? -1 : 1));
  const nightsIn = [...nights].map((n) => ({ k: calendarDayKey(n.day), n })).filter((x) => x.k <= today).sort((a, b) => (a.k < b.k ? -1 : 1));
  const raw: { kind: PartKind; score: number; value: number; normal?: number }[] = [];

  // HRV balance, once there are two weeks of nights to compare with.
  const hrv = byDay.filter((x) => x.d.hrv != null && x.d.hrv > 0).map((x) => ({ k: x.k, v: x.d.hrv! }));
  const lastHRV = hrv[hrv.length - 1];
  if (lastHRV && lastHRV.k >= addDays(today, -1)) {
    const week = hrv.filter((x) => x.k > addDays(today, -7)).map((x) => Math.log(x.v));
    const recent = hrv.filter((x) => x.k > addDays(today, -67));
    const older = recent.filter((x) => x.k <= addDays(today, -7)).map((x) => Math.log(x.v));
    const baseline = older.length >= CALIBRATION_NIGHTS ? older : recent.map((x) => Math.log(x.v));
    const m = mean(baseline), sd0 = deviation(baseline);
    if (baseline.length >= CALIBRATION_NIGHTS && week.length >= 3 && m != null && sd0 != null) {
      const sd = Math.max(sd0, 0.04);
      const rolling = mean(week)!;
      const z = (0.7 * (rolling - m)) / sd + (0.3 * (Math.log(lastHRV.v) - m)) / sd;
      raw.push({ kind: "hrv", score: zScore(z), value: Math.exp(rolling), normal: Math.exp(m) });
    }
  }

  // Last night.
  let asleepLastNight: number | null = null;
  const tonight = [...nightsIn].reverse().find((x) => x.k === today)?.n;
  const minutes = tonight ? asleep(tonight) : null;
  if (tonight && minutes != null) {
    asleepLastNight = minutes;
    const ratio = minutes / SLEEP_NEED;
    const duration = ratio >= 1 ? 100 : Math.max(0, 100 - 180 * (1 - ratio));
    const quality = tonight.nightScore ?? tonight.score;
    raw.push({ kind: "lastNight", score: quality != null ? 0.65 * duration + 0.35 * quality : duration, value: minutes, normal: SLEEP_NEED });
  }

  // Sleep debt over 14 nights.
  const fortnight = nightsIn.filter((x) => x.k > addDays(today, -14)).map((x) => asleep(x.n)).filter((m): m is number => m != null);
  if (fortnight.length >= 4) {
    let debt = 0;
    for (const m of fortnight) debt = Math.max(0, debt * 0.9 + (m < SLEEP_NEED ? SLEEP_NEED - m : -(m - SLEEP_NEED) * 0.5));
    raw.push({ kind: "sleepDebt", score: Math.max(10, 100 - 6.5 * (debt / 60)), value: debt });
  }

  // Resting heart rate against the 30 days before.
  const rhr = byDay.filter((x) => x.d.restingHR != null && x.d.restingHR > 0).map((x) => ({ k: x.k, v: x.d.restingHR! }));
  const lastRHR = rhr[rhr.length - 1];
  if (lastRHR && lastRHR.k >= addDays(today, -1)) {
    const history = rhr.filter((x) => x.k < lastRHR.k && x.k >= addDays(lastRHR.k, -30)).map((x) => x.v);
    const normal = history.length >= 7 ? mean(history) : null;
    if (normal != null) {
      const delta = lastRHR.v - normal;
      raw.push({ kind: "restingHR", score: delta > 0 ? Math.max(0, 80 - 6 * delta) : Math.min(100, 80 - 4 * delta), value: lastRHR.v, normal });
    }
  }

  // Sleep timing: the spread of the night's midpoint over the last 7 nights.
  const midpoints = nightsIn.filter((x) => x.k > addDays(today, -7)).flatMap((x) => {
    if (x.n.bedtime == null || x.n.wakeTime == null) return [];
    const bed = refToDate(x.n.bedtime).getTime(), wake = refToDate(x.n.wakeTime).getTime();
    if (wake <= bed) return [];
    const [y, mo, d] = x.k.split("-").map(Number);
    return [(bed + (wake - bed) / 2 - new Date(y, mo - 1, d).getTime()) / 60000];
  });
  const spread = midpoints.length >= 4 ? deviation(midpoints) : null;
  if (spread != null) raw.push({ kind: "timing", score: Math.max(25, Math.min(100, 100 - ((spread - 30) * 25) / 30)), value: spread });

  const kinds = new Set(raw.map((p) => p.kind));
  if (raw.length < 2 || !(kinds.has("hrv") || kinds.has("lastNight"))) return undefined;
  const total = raw.reduce((s, p) => s + PART_WEIGHT[p.kind], 0);
  const parts = raw.map((p) => ({ ...p, score: swiftRound(p.score), share: PART_WEIGHT[p.kind] / total }));
  const objective = parts.reduce((s, p) => s + p.score * p.share, 0);

  const caps: number[] = [];
  const hrvPart = parts.find((p) => p.kind === "hrv"), rhrPart = parts.find((p) => p.kind === "restingHR");
  if (hrvPart && rhrPart && hrvPart.score < 65 && rhrPart.normal != null && rhrPart.value - rhrPart.normal >= 3) caps.push(CAP.strain);
  if (asleepLastNight != null && asleepLastNight < 300) caps.push(CAP.shortNight);
  if (feel && Array.isArray(feel.tags) && feel.tags.includes("unwell")) caps.push(CAP.unwell);

  const adjustment = feel ? feelAdjustment(feel.feel, Array.isArray(feel.tags) ? feel.tags : []) : 0;
  const cap = caps.length ? Math.min(...caps) : 100;
  const unheld = swiftRound(objective);
  const held = Math.max(1, Math.min(100, Math.min(unheld, cap)));
  const score = Math.max(1, Math.min(100, adjustment < 0 ? held + adjustment : Math.min(swiftRound(objective + adjustment), cap)));
  return { score, status: band(score) };
}

/* ───────────── The view ───────────── */

/** Everything the computer can work out of the training view, or undefined when it has nothing to go on. */
export function localTraining(items: LocalTrainingItems, now: Date): ViewTrainingBody | undefined {
  const fitness = fitnessOf(items.activities, now);
  const load = loadOf(items.activities, items.days, now);
  const readiness = readinessOf(items.days, items.nights, items.feel, now);
  if (!fitness && !load && !readiness) return undefined;
  return { ...(fitness ? { fitness } : {}), ...(load ? { load } : {}), ...(readiness ? { readiness } : {}) };
}

/** The phone's training view when one has synced here; otherwise the one this computer works out. */
export function trainingOf(view: SyncView, now = new Date()): ViewTrainingBody | undefined {
  return view.get("view.training", "me") ?? localTraining({
    activities: view.all("activity").map((i) => i.body),
    days: view.all("health.day").map((i) => i.body),
    nights: view.all("health.night").map((i) => i.body),
    feel: view.get("feel.check", dayKey(now)),
  }, now);
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
