// The maths of the Sports pages, ported from the phone app (CorosKit: SportsProfile.swift, SportSections.swift,
// TrainingTrends.swift, RideFindings.swift, SwimHistory.swift). Pure: activities and recordings in, readings out.
// Weeks run Monday to Sunday, as everywhere on the web.
import { language, locale, msg, t } from "@/lib/i18n";

export type Family = "run" | "ride" | "swim" | "strength" | "walk" | "other";
export const FAMILIES: readonly Family[] = ["run", "ride", "swim", "strength", "walk", "other"];

/** One activity, as the list holds it. `kind` is the phone's own sport name ("trailRun", "indoorBike"). */
export interface SportAct {
  id: string;
  at: Date;
  family: Family;
  kind: string;
  name: string;
  meters: number | null;
  seconds: number;
  avgHr: number | null;
  climbM: number | null;
  avgPowerW: number | null;
}

/** One activity's recording over time. Every stream is as long as `t` (seconds from the start). */
export interface Recording {
  id: string;
  at: Date;
  t: number[];
  hr?: number[];
  power?: number[];
  speed?: number[];
}

const DAY = 86_400_000;
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: readonly number[]) => (values.length ? sum(values) / values.length : 0);

/** The Monday that starts `date`'s week, at local midnight. */
export function weekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export const addDays = (date: Date, days: number): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), date.getSeconds());

/** Under a minute: a start-and-stop or a test of the button, left out everywhere as on the phone. */
export const isBlip = (a: Pick<SportAct, "seconds">): boolean => a.seconds < 60;

/* ───────────── Which sports ───────────── */

export const DETECTION_DAYS = 90;
export const MINIMUM_SHARE = 0.15;
export const MINIMUM_SESSIONS = 4;

/**
 * The families of the 90 days before `now`, most time first (more sessions on a tie): each with at least 15% of
 * the time or 4 sessions. Empty when there is nothing to go by, and then every sport shows.
 */
export function detectSports(acts: readonly SportAct[], now: Date, days = DETECTION_DAYS): Family[] {
  const from = now.getTime() - days * DAY;
  const seconds = new Map<Family, number>(), sessions = new Map<Family, number>();
  for (const a of acts) {
    const at = a.at.getTime();
    if (at < from || at > now.getTime()) continue;
    seconds.set(a.family, (seconds.get(a.family) ?? 0) + Math.max(0, a.seconds));
    sessions.set(a.family, (sessions.get(a.family) ?? 0) + 1);
  }
  const total = sum([...seconds.values()]);
  return [...sessions.keys()]
    .filter((f) => (sessions.get(f) ?? 0) >= MINIMUM_SESSIONS || (total > 0 && (seconds.get(f) ?? 0) / total >= MINIMUM_SHARE))
    .sort((a, b) => (seconds.get(b) ?? 0) - (seconds.get(a) ?? 0) || (sessions.get(b) ?? 0) - (sessions.get(a) ?? 0) || FAMILIES.indexOf(a) - FAMILIES.indexOf(b));
}

/** Whether a family's page and card show. With nothing known, every family's do. */
export const includesSport = (families: readonly Family[], family: Family): boolean => families.length === 0 || families.includes(family);

/* ───────────── Weeks ───────────── */

export interface VolumeWeek { start: Date; seconds: number; meters: number; sessions: number; longestSeconds: number; longestMeters: number; longestAt: Date | null }
export interface VolumeDay { date: Date; seconds: number; meters: number }
export interface SportVolume {
  /** Oldest first, this week last. */
  weeks: VolumeWeek[];
  /** This week's seven days, Monday first. */
  days: VolumeDay[];
  todayIndex: number;
  /** The average of the four full weeks before this one. Null unless at least two of them had a session. */
  usualSeconds: number | null;
  usualMeters: number | null;
  /** The longest (by time) of this calendar year. */
  yearLongest: { seconds: number; meters: number; at: Date } | null;
}

/** One sport's calendar weeks, from the activity list alone. */
export function sportVolume(acts: readonly SportAct[], now: Date, count = 8): SportVolume {
  const listed = acts.filter((a) => a.at.getTime() <= now.getTime() && !isBlip(a)).sort((a, b) => a.at.getTime() - b.at.getTime());
  const thisWeek = weekStart(now);
  const week = (start: Date): VolumeWeek => {
    const end = addDays(start, 7).getTime();
    const inWeek = listed.filter((a) => a.at.getTime() >= start.getTime() && a.at.getTime() < end);
    const longest = inWeek.reduce<SportAct | null>((best, a) => (!best || a.seconds > best.seconds ? a : best), null);
    return {
      start, seconds: sum(inWeek.map((a) => a.seconds)), meters: sum(inWeek.map((a) => a.meters ?? 0)), sessions: inWeek.length,
      longestSeconds: longest?.seconds ?? 0, longestMeters: longest?.meters ?? 0, longestAt: longest?.at ?? null,
    };
  };
  const all = Array.from({ length: Math.max(count, 5) }, (_, k) => week(addDays(thisWeek, -7 * (Math.max(count, 5) - 1 - k))));
  const days = Array.from({ length: 7 }, (_, k) => {
    const date = addDays(thisWeek, k), end = addDays(date, 1).getTime();
    const onDay = listed.filter((a) => a.at.getTime() >= date.getTime() && a.at.getTime() < end);
    return { date, seconds: sum(onDay.map((a) => a.seconds)), meters: sum(onDay.map((a) => a.meters ?? 0)) };
  });
  const before = all.slice(-5, -1);
  const usual = before.length === 4 && before.filter((w) => w.sessions > 0).length >= 2;
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const year = listed.filter((a) => a.at.getTime() >= yearStart && a.seconds > 0).reduce<SportAct | null>((best, a) => (!best || a.seconds > best.seconds ? a : best), null);
  return {
    weeks: all.slice(-count), days, todayIndex: (now.getDay() + 6) % 7,
    usualSeconds: usual ? sum(before.map((w) => w.seconds)) / 4 : null,
    usualMeters: usual ? sum(before.map((w) => w.meters)) / 4 : null,
    yearLongest: year ? { seconds: year.seconds, meters: year.meters ?? 0, at: year.at } : null,
  };
}

export type Standing = { kind: "none" } | { kind: "more"; by: number } | { kind: "less"; by: number } | { kind: "level" } | { kind: "soFar" };

/**
 * A week so far against the usual one. "less" waits for the week's last day, as a Tuesday is always behind;
 * differences under `margin` (or 10%) read as level.
 */
export function standing(value: number, usual: number | null, daysLeft: number, margin: number): Standing {
  if (!(value > 0)) return { kind: "none" };
  if (usual == null || !(usual > 0)) return { kind: "soFar" };
  const tolerance = Math.max(margin, usual * 0.1), difference = value - usual;
  if (difference > tolerance) return { kind: "more", by: difference };
  if (daysLeft > 1) return { kind: "soFar" };
  if (difference < -tolerance) return daysLeft === 0 ? { kind: "less", by: -difference } : { kind: "soFar" };
  return { kind: "level" };
}

/* ───────────── Long runs ───────────── */

export interface RunSpike { id: string; at: Date; meters: number; /** The longest run of the 30 days before; null when there was none. */ priorLongest: number | null }
export interface SpikeCheck {
  /** Runs of the last eight weeks, oldest first, each against the 30 days before it. */
  runs: RunSpike[];
  /** The longest run of the last 30 days. */
  recentLongest: number | null;
  /** How far a run can go and stay within 10% of the recent longest (Frandsen et al. 2025). */
  nextLimit: number | null;
}

const withDistance = (runs: readonly SportAct[]) => runs.filter((r) => (r.meters ?? 0) > 0).sort((a, b) => a.at.getTime() - b.at.getTime());

export function spikeCheck(allRuns: readonly SportAct[], now: Date): SpikeCheck | null {
  const runs = withDistance(allRuns);
  const recent = runs.filter((r) => r.at.getTime() >= now.getTime() - 56 * DAY && r.at.getTime() <= now.getTime());
  if (!recent.length) return null;
  const checked = recent.map((r) => {
    const prior = runs.filter((p) => p.id !== r.id && p.at.getTime() >= r.at.getTime() - 30 * DAY && p.at.getTime() < r.at.getTime()).map((p) => p.meters as number);
    return { id: r.id, at: r.at, meters: r.meters as number, priorLongest: prior.length ? Math.max(...prior) : null };
  });
  const month = runs.filter((r) => r.at.getTime() >= now.getTime() - 30 * DAY && r.at.getTime() <= now.getTime()).map((r) => r.meters as number);
  const recentLongest = month.length ? Math.max(...month) : null;
  return { runs: checked, recentLongest, nextLimit: recentLongest == null ? null : recentLongest * 1.1 };
}

/** Whether a run went past 110% of the longest of the 30 days before it. */
export const isSpike = (run: RunSpike): boolean => run.priorLongest != null && run.priorLongest > 0 && run.meters / run.priorLongest > 1.1;

/* ───────────── Easy and hard ───────────── */

export interface IntensitySeconds { low: number; moderate: number; high: number }
export type IntensityPattern = "base" | "polarized" | "pyramidal" | "threshold" | "high" | "mixed";
export interface IntensityBalance extends IntensitySeconds {
  /** Activities read from their recording, and those judged by average heart rate alone. */
  measured: number;
  estimated: number;
  pattern: IntensityPattern;
}

/** Seiler's band of a heart rate: under 90% of threshold is low, under 100% moderate. */
export const bandOf = (percentOfThreshold: number): keyof IntensitySeconds => (percentOfThreshold < 90 ? "low" : percentOfThreshold < 100 ? "moderate" : "high");

/** Seconds in each band across a recording's heart rate. Null without one. */
export function intensityOf(rec: Pick<Recording, "t" | "hr">, thresholdHr: number): IntensitySeconds | null {
  if (!rec.hr || rec.t.length < 2 || !(thresholdHr > 0)) return null;
  const out = { low: 0, moderate: 0, high: 0 };
  for (let i = 1; i < rec.t.length; i++) {
    const dt = rec.t[i] - rec.t[i - 1], hr = rec.hr[i];
    // A gap of more than 30 s is a pause, not time at that heart rate.
    if (!(dt > 0) || dt > 30 || !(hr > 0)) continue;
    out[bandOf((hr / thresholdHr) * 100)] += dt;
  }
  return out.low + out.moderate + out.high > 0 ? out : null;
}

/** Treff et al. 2019: log10(Z1 / Z2 × Z3 × 100). Only defined for Z1 > Z3 > Z2. */
export function polarizationIndex(low: number, moderate: number, high: number): number | null {
  if (!(low > high && high > moderate && low > moderate)) return null;
  return high > 0 ? Math.log10((low / Math.max(moderate, 0.01)) * high * 100) : 0;
}

/**
 * Time in the three bands over the last `days`: from each activity's recording when it was read, from its average
 * heart rate otherwise. Null under three activities with heart rate or under an hour of them.
 */
export function intensityBalance(acts: readonly SportAct[], recordings: ReadonlyMap<string, Recording>, thresholdHr: number | null, now: Date, days = 28): IntensityBalance | null {
  if (thresholdHr == null || !(thresholdHr > 0)) return null;
  const seconds = { low: 0, moderate: 0, high: 0 };
  let measured = 0, estimated = 0;
  for (const a of acts) {
    if (a.at.getTime() < now.getTime() - days * DAY || a.at.getTime() > now.getTime()) continue;
    const rec = recordings.get(a.id);
    const read = rec ? intensityOf(rec, thresholdHr) : null;
    if (read) {
      seconds.low += read.low; seconds.moderate += read.moderate; seconds.high += read.high;
      measured++;
    } else if (a.avgHr != null && a.avgHr > 0 && a.seconds > 0) {
      seconds[bandOf((a.avgHr / thresholdHr) * 100)] += a.seconds;
      estimated++;
    }
  }
  const total = seconds.low + seconds.moderate + seconds.high;
  if (measured + estimated < 3 || total < 3600) return null;
  const z1 = seconds.low / total, z2 = seconds.moderate / total, z3 = seconds.high / total;
  const index = polarizationIndex(z1, z2, z3);
  const pattern: IntensityPattern = z1 >= 0.92 ? "base" : z2 >= z1 || z3 >= z1 ? (z3 > z2 ? "high" : "threshold") : index != null && index > 2 ? "polarized" : z2 > z3 ? "pyramidal" : "mixed";
  return { ...seconds, measured, estimated, pattern };
}

/** The three shares as whole percents that add up to 100. */
export function sharePercents(s: IntensitySeconds): [number, number, number] {
  const total = s.low + s.moderate + s.high;
  if (!(total > 0)) return [0, 0, 0];
  const moderate = Math.round((s.moderate / total) * 100), high = Math.round((s.high / total) * 100);
  return [100 - moderate - high, moderate, high];
}

/* ───────────── What each run was ───────────── */

export type RunKind = "easy" | "long" | "tempo" | "hard";
export const isQuality = (kind: RunKind): boolean => kind === "tempo" || kind === "hard";

/** A run's type from its average heart rate alone: 100% of threshold and over is hard, 90% tempo, else long from 75 minutes. */
export function estimatedKind(run: Pick<SportAct, "avgHr" | "seconds">, thresholdHr: number | null): RunKind | null {
  if (thresholdHr == null || !(thresholdHr > 0) || run.avgHr == null || !(run.avgHr > 0)) return null;
  const percent = (run.avgHr / thresholdHr) * 100;
  if (percent >= 100) return "hard";
  if (percent >= 90) return "tempo";
  return run.seconds >= 75 * 60 ? "long" : "easy";
}

export interface RunTypeWeek { start: Date; runs: { id: string; at: Date; kind: RunKind | null }[] }
export interface RunTypes {
  /** Oldest first, this week last. */
  weeks: RunTypeWeek[];
  /** Runs with intensity, and runs whose type is known, in the last four calendar weeks. */
  quality: number;
  known: number;
  /** Calendar weeks with runs but none with intensity, back to the last week that had one, up to 12 weeks back. */
  weeksWithoutQuality: number;
}

/** Each run's type for the last `shown` calendar weeks. Null without a run in the last 12. */
export function runTypes(allRuns: readonly SportAct[], thresholdHr: number | null, now: Date, shown = 6): RunTypes | null {
  const runs = withDistance(allRuns).filter((r) => r.at.getTime() <= now.getTime() && !isBlip(r));
  const thisWeek = weekStart(now);
  const all: RunTypeWeek[] = Array.from({ length: 12 }, (_, k) => {
    const start = addDays(thisWeek, -7 * (11 - k)), end = addDays(start, 7).getTime();
    return { start, runs: runs.filter((r) => r.at.getTime() >= start.getTime() && r.at.getTime() < end).map((r) => ({ id: r.id, at: r.at, kind: estimatedKind(r, thresholdHr) })) };
  });
  if (!all.some((w) => w.runs.length)) return null;
  let without = 0;
  for (const w of [...all].reverse()) {
    const known = w.runs.filter((r) => r.kind != null);
    if (known.some((r) => isQuality(r.kind as RunKind))) break;
    if (known.length) without++;
  }
  const four = all.slice(-4).flatMap((w) => w.runs);
  return {
    weeks: all.slice(-shown),
    quality: four.filter((r) => r.kind != null && isQuality(r.kind)).length,
    known: four.filter((r) => r.kind != null).length,
    weeksWithoutQuality: without,
  };
}

/* ───────────── Aerobic efficiency and durability ───────────── */

export interface EfficiencyTrend {
  /** Metres per heartbeat on easy runs, one point per week that had one, oldest first. */
  points: { start: Date; value: number }[];
  /** The last 4 weeks' runs against the 8 before, percent; null under three runs on either side. */
  change: number | null;
  recent: number | null;
  before: number | null;
}

/** Speed per heartbeat on easy runs (under 90% of threshold, 20 minutes or more), week by week for 12 weeks. */
export function efficiencyTrend(allRuns: readonly SportAct[], thresholdHr: number | null, now: Date): EfficiencyTrend | null {
  if (thresholdHr == null || !(thresholdHr > 0)) return null;
  const easy = withDistance(allRuns)
    .filter((r) => r.avgHr != null && r.avgHr > 0 && r.seconds >= 1200 && (r.avgHr / thresholdHr) * 100 < 90 && r.at.getTime() <= now.getTime() && r.at.getTime() >= now.getTime() - 84 * DAY)
    .map((r) => ({ at: r.at, value: ((r.meters as number) / r.seconds) * 60 / (r.avgHr as number) }));
  if (easy.length < 3) return null;
  const thisWeek = weekStart(now);
  const points: { start: Date; value: number }[] = [];
  for (let k = 11; k >= 0; k--) {
    const start = addDays(thisWeek, -7 * k), end = addDays(start, 7).getTime();
    const inWeek = easy.filter((r) => r.at.getTime() >= start.getTime() && r.at.getTime() < end);
    if (inWeek.length) points.push({ start, value: mean(inWeek.map((r) => r.value)) });
  }
  const cut = now.getTime() - 28 * DAY;
  const recent = easy.filter((r) => r.at.getTime() >= cut).map((r) => r.value), before = easy.filter((r) => r.at.getTime() < cut).map((r) => r.value);
  const both = recent.length >= 3 && before.length >= 3;
  return { points, change: both ? (mean(recent) / mean(before) - 1) * 100 : null, recent: both ? mean(recent) : null, before: both ? mean(before) : null };
}

/**
 * Aerobic decoupling: how far speed per heartbeat fell between the first half and the second, percent.
 * Null without speed and heart rate through both halves.
 */
export function decoupling(rec: Pick<Recording, "t" | "hr" | "speed">): number | null {
  if (!rec.hr || !rec.speed || rec.t.length < 20) return null;
  const half = (rec.t[0] + rec.t[rec.t.length - 1]) / 2;
  const sides = [{ speed: 0, hr: 0, dt: 0 }, { speed: 0, hr: 0, dt: 0 }];
  for (let i = 1; i < rec.t.length; i++) {
    const dt = rec.t[i] - rec.t[i - 1];
    if (!(dt > 0) || dt > 30 || !(rec.hr[i] > 0) || !(rec.speed[i] > 0.5)) continue;
    const side = sides[rec.t[i] <= half ? 0 : 1];
    side.speed += rec.speed[i] * dt; side.hr += rec.hr[i] * dt; side.dt += dt;
  }
  if (!(sides[0].dt > 300) || !(sides[1].dt > 300)) return null;
  const first = sides[0].speed / sides[0].hr, second = sides[1].speed / sides[1].hr;
  return ((first - second) / first) * 100;
}

export const LONG_RUN_SECONDS = 3600;
export const HELD_PERCENT = 5;

export interface DurabilityPoint { id: string; at: Date; seconds: number; percent: number }
export interface RunDurability { /** Oldest first, at most eight. */ points: DurabilityPoint[]; /** How many of the newest in a row held under 5%. */ heldInARow: number }

/** Heart-rate drift on runs of an hour or more in the last six months (Friel). Null under three of them. */
export function runDurability(recordings: readonly Recording[], now: Date): RunDurability | null {
  const found = recordings
    .filter((r) => r.at.getTime() >= now.getTime() - 180 * DAY && r.at.getTime() <= now.getTime() && r.t.length > 1 && r.t[r.t.length - 1] - r.t[0] >= LONG_RUN_SECONDS)
    .map((r) => ({ id: r.id, at: r.at, seconds: r.t[r.t.length - 1] - r.t[0], percent: decoupling(r) }))
    .filter((p): p is DurabilityPoint => p.percent != null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (found.length < 3) return null;
  const points = found.slice(-8);
  let held = 0;
  for (const p of [...points].reverse()) { if (p.percent >= HELD_PERCENT) break; held++; }
  return { points, heldInARow: held };
}

/* ───────────── Climbing ───────────── */

export interface ClimbWeeks {
  /** Oldest first, this week last: the last eight. */
  weeks: { start: Date; meters: number }[];
  /** The last week before this one that climbed at least as much, up to 26 weeks back. */
  moreBefore: Date | null;
  /** Whether this week climbed more than each of the four before it. */
  isNotable: boolean;
}

/** Metres climbed on outdoor rides, week by week, from the watch's own totals. Null without an outdoor ride. */
export function rideClimbing(rides: readonly SportAct[], now: Date): ClimbWeeks | null {
  const outdoor = rides.filter((r) => r.kind === "bike" && r.at.getTime() <= now.getTime() && !isBlip(r));
  if (!outdoor.length) return null;
  const thisWeek = weekStart(now);
  const all = Array.from({ length: 26 }, (_, k) => {
    const start = addDays(thisWeek, -7 * (25 - k)), end = addDays(start, 7).getTime();
    return { start, meters: sum(outdoor.filter((r) => r.at.getTime() >= start.getTime() && r.at.getTime() < end).map((r) => Math.max(0, r.climbM ?? 0))) };
  });
  const current = all[all.length - 1].meters, earlier = all.slice(0, -1);
  const more = current > 0 ? [...earlier].reverse().find((w) => w.meters >= current) : undefined;
  return { weeks: all.slice(-8), moreBefore: more?.start ?? null, isNotable: current > 0 && earlier.slice(-4).every((w) => current > w.meters) };
}

/* ───────────── Power ───────────── */

/** The durations the power curve reads, in seconds. */
export const POWER_DURATIONS = [5, 60, 300, 1200, 3600] as const;

/** The highest average power held for `seconds` in a recording. Null when it is shorter than that. */
export function bestPower(rec: Pick<Recording, "t" | "power">, seconds: number): number | null {
  const { t, power } = rec;
  if (!power || t.length < 2 || t[t.length - 1] - t[0] < seconds) return null;
  // Work done up to each sample. A gap of more than 30 s is a stop: no work in it.
  const work = new Float64Array(t.length);
  for (let i = 1; i < t.length; i++) { const dt = t[i] - t[i - 1]; work[i] = work[i - 1] + (dt > 0 && dt <= 30 ? Math.max(0, power[i - 1] || 0) * dt : 0); }
  let best: number | null = null, j = 0;
  for (let i = 0; i < t.length; i++) {
    if (j < i) j = i;
    while (j < t.length - 1 && t[j] - t[i] < seconds) j++;
    const span = t[j] - t[i];
    if (span < seconds) break;
    const watts = (work[j] - work[i]) / span;
    if (best == null || watts > best) best = watts;
  }
  return best;
}

export interface PowerRow { seconds: number; /** Best of the last 90 days; null when no ride in them lasted that long. */ recent: number | null; /** Best of every ride read. */ best: number }

/** How far the last 90 days stand below the best ever, percent; 0 when they hold it. */
export const shortfall = (row: PowerRow): number | null => (row.recent == null ? null : Math.max(0, ((row.best - row.recent) / row.best) * 100));

/** The best power at each duration in the last 90 days against the best ever. Null before a ride with power. */
export function powerCurve(rides: readonly Recording[], now: Date): PowerRow[] | null {
  const since = now.getTime() - 90 * DAY;
  const withPower = rides.filter((r) => r.power && r.at.getTime() <= now.getTime());
  const rows: PowerRow[] = [];
  for (const seconds of POWER_DURATIONS) {
    let best: number | null = null, recent: number | null = null;
    for (const r of withPower) {
      const watts = bestPower(r, seconds);
      if (watts == null) continue;
      if (best == null || watts > best) best = watts;
      if (r.at.getTime() >= since && (recent == null || watts > recent)) recent = watts;
    }
    if (best != null && best > 0) rows.push({ seconds, recent, best });
  }
  return rows.length ? rows : null;
}

/** The durations the last 90 days are within 1% of the best ever, shortest first. */
export const atBest = (rows: readonly PowerRow[]): PowerRow[] => rows.filter((r) => (shortfall(r) ?? 100) <= 1);

/** 95% of the best 20 minutes in each of the last `blocks` 4-week blocks, oldest first (Allen and Coggan). */
export function ftpTrend(rides: readonly Recording[], now: Date, blocks = 4): { end: Date; watts: number }[] {
  const out: { end: Date; watts: number }[] = [];
  for (let b = blocks - 1; b >= 0; b--) {
    const end = now.getTime() - b * 28 * DAY, start = end - 28 * DAY;
    let best: number | null = null;
    for (const r of rides) {
      if (r.at.getTime() <= start || r.at.getTime() > end) continue;
      const watts = bestPower(r, 1200);
      if (watts != null && (best == null || watts > best)) best = watts;
    }
    if (best != null) out.push({ end: new Date(end), watts: best * 0.95 });
  }
  return out;
}

export interface PowerZone { zone: number; name: string; /** Watts; null where the zone is open-ended. */ from: number | null; to: number | null }

const COGGAN: [string, number][] = [
  [msg("Active recovery"), 0.55], [msg("Endurance"), 0.75], [msg("Tempo"), 0.9], [msg("Threshold"), 1.05], ["VO₂ max", 1.2], [msg("Anaerobic"), 1.5], [msg("Neuromuscular"), Infinity],
];

/** Coggan's seven zones as shares of FTP: up to 55%, 75%, 90%, 105%, 120%, 150%, and over. */
export function cogganZones(ftp: number): PowerZone[] {
  let from: number | null = null;
  return COGGAN.map(([name, top], k) => {
    const to = Number.isFinite(top) ? Math.round(ftp * top) : null;
    const zone = { zone: k + 1, name: t(name), from, to };
    from = to == null ? null : to + 1;
    return zone;
  });
}

/** Seconds in each of the seven zones across the rides of the last `days`. Null without a ride with power in them. */
export function powerZoneSeconds(rides: readonly Recording[], ftp: number, now: Date, days = 28): number[] | null {
  if (!(ftp > 0)) return null;
  const tops = COGGAN.map(([, top]) => ftp * top);
  const out = new Array<number>(7).fill(0);
  for (const r of rides) {
    if (!r.power || r.at.getTime() < now.getTime() - days * DAY || r.at.getTime() > now.getTime()) continue;
    for (let i = 1; i < r.t.length; i++) {
      const dt = r.t[i] - r.t[i - 1];
      if (!(dt > 0) || dt > 30) continue;
      const watts = Math.max(0, r.power[i] || 0);
      out[tops.findIndex((top) => watts <= top)] += dt;
    }
  }
  return sum(out) > 0 ? out : null;
}

/** C-LINK's own Cycling VO₂ max from the best five minutes of power: 16.6 + 8.87 × W/kg (Sitko 2022). */
export function cyclingVo2Estimate(fiveMinuteWatts: number, kilograms: number): number | null {
  if (!(fiveMinuteWatts > 0) || !(kilograms > 0)) return null;
  const value = 16.6 + (8.87 * fiveMinuteWatts) / kilograms;
  return value >= 20 && value <= 95 ? value : null;
}

/** Average power over average heart rate on each ride of 30 minutes or more with both, oldest first. */
export function wattsPerBeat(rides: readonly Recording[], now: Date, days = 180): { id: string; at: Date; value: number }[] {
  const out: { id: string; at: Date; value: number }[] = [];
  for (const r of rides) {
    if (!r.power || !r.hr || r.t.length < 2 || r.at.getTime() < now.getTime() - days * DAY || r.at.getTime() > now.getTime()) continue;
    let work = 0, beats = 0, time = 0;
    for (let i = 1; i < r.t.length; i++) {
      const dt = r.t[i] - r.t[i - 1];
      if (!(dt > 0) || dt > 30 || !(r.hr[i] > 0)) continue;
      work += Math.max(0, r.power[i] || 0) * dt; beats += r.hr[i] * dt; time += dt;
    }
    if (time >= 1800 && beats > 0 && work > 0) out.push({ id: r.id, at: r.at, value: work / beats });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/* ───────────── Swimming ───────────── */

/** Critical swim speed as seconds per 100 m, from the best 200 m and 400 m: the pace of the 200 m between them. */
export function criticalSwimPace(best200: number, best400: number): number | null {
  const pace = (best400 - best200) / 2;
  return best200 > 0 && pace > 0 && pace < 600 && best400 > best200 ? pace : null;
}

/** Seconds per 100 m around critical swim speed: easy is 10 s slower, threshold within 2 s, fast 6 s quicker. */
export function swimBands(css: number): { easyFrom: number; thresholdFrom: number; thresholdTo: number; fastTo: number } {
  return { easyFrom: css + 10, thresholdFrom: css - 2, thresholdTo: css + 2, fastTo: css - 6 };
}

/** This period's total against the one before it, as a fraction; null when the one before had nothing. */
export function volumeChange(acts: readonly SportAct[], now: Date, days = 28): number | null {
  const total = (from: number, to: number) => sum(acts.filter((a) => a.at.getTime() > from && a.at.getTime() <= to).map((a) => a.meters ?? 0));
  const recent = total(now.getTime() - days * DAY, now.getTime()), before = total(now.getTime() - 2 * days * DAY, now.getTime() - days * DAY);
  return before > 0 ? recent / before - 1 : null;
}

/* ───────────── Words ───────────── */

const pad = (n: number) => String(n).padStart(2, "0");

/** "1 h 10" for a figure, "1 h 10 min" in a sentence; under an hour "48 min". */
export function hoursText(seconds: number, long = false): string {
  const minutes = Math.round(Math.max(0, seconds) / 60), h = Math.floor(minutes / 60), m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${pad(m)}${long ? " min" : ""}`;
}

/** Kilometres to one decimal: 30.6 km. */
export const kmText = (meters: number): string => `${(meters / 1000).toFixed(1)} km`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** A date in the app's language; English keeps the words above. */
const dated = (d: Date, options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(locale(), options).format(d);
export const dayMonthOf = (d: Date): string => (language() === "en" ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : dated(d, { day: "numeric", month: "short" }));
export const monthOf = (d: Date): string => (language() === "en" ? MONTHS[d.getMonth()] : dated(d, { month: "short" }));
export const weekdayOf = (d: Date): string => (language() === "en" ? DAYS[d.getDay()] : dated(d, { weekday: "short" }));
export const weekdayLong = (d: Date): string => (language() === "en" ? LONG_DAYS[d.getDay()] : dated(d, { weekday: "long" }));

/** "5 s", "1 min", "20 min". */
export const durationName = (seconds: number): string => (seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`);
