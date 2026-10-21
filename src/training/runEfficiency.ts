/**
 * Running efficiency: the aerobic power a run's speed demanded, divided by the
 * share of the heart's working range it used, reported as an effective VO2max
 * (ml/kg/min).
 *
 * Two published relationships carry it:
 *  - Daniels & Gilbert (Oxygen Power, 1979) give the oxygen cost of running at
 *    a speed. Effort (grade-adjusted) pace stands in for pace, so hills do not
 *    read as slow running.
 *  - Swain & Leutholtz (1997) showed the fraction of heart-rate reserve,
 *    (HR − rest) / (max − rest), tracks the fraction of VO2 reserve.
 * So VO2max ≈ 3.5 + (cost − 3.5) / fraction, read at steady moments of the run.
 *
 * Absolute values sit below a lab VO2max on easy days, so a run is placed on
 * the athlete's COROS VO2max scale instead: the median of their recent runs
 * maps to COROS's estimate, and a run reads above or below it by as much as it
 * differs from that median.
 *
 * Only the per-step speed and heart rate (`EfficiencyCurve`) are cached per
 * run; the figure is computed when shown, on the current heart-rate profile.
 * Pure functions, no React, so `scripts/test-run-efficiency.mjs` runs it in Node.
 */

import type { ActivityStreams } from "./activityStreams";

/** Bump when a cached curve would mean something different; old ones are recomputed. */
export const EFFICIENCY_CURVE_VERSION = 1;

/** Road (100) and track (103) runs: a treadmill's pace is estimated, a trail's set by the ground. */
export function sportHasRunEfficiency(sportType: number | undefined): boolean {
  return sportType === 100 || sportType === 103;
}

/** How a run is sampled for steady moments. Seconds unless the name says otherwise. */
const SAMPLING = {
  /** A moment is judged every 30 s of moving time. */
  every: 30,
  /** Nothing before the 10th minute: heart rate is still climbing to the work. */
  warmUp: 600,
  /** Speed and heart rate are each averaged over 90 s around the moment. */
  halfWidth: 45,
  /** Heart rate answers a change of pace about 40 s later, so it is read that much later. */
  heartLag: 40,
  /** Pace must hold, within 7% (coefficient of variation), from 100 s before to 60 s after. */
  holdBefore: 100,
  holdAfter: 60,
  maxPaceVariation: 0.07,
  /** Heart rate 30 s either side of its reading point (11 s averages) may differ by 8 bpm at most. */
  settleOffset: 30,
  settleHalfWidth: 5,
  maxSettleBpm: 8,
  /** Each window needs readings for 70% of its seconds. */
  coverage: 0.7,
  /** Paces outside 2:30–15:00 /km are GPS noise or standing. */
  fastestPace: 150,
  slowestPace: 900,
  /** Under 140 steps a minute is walking, which the running cost formula does not describe. */
  walkingCadence: 140,
  longest: 8 * 3600
} as const;

export const EFFICIENCY_STEP_SECONDS = SAMPLING.every;
export const HR_LAG_SECONDS = SAMPLING.heartLag;

export type EfficiencyGapReason =
  | "warmUp"
  | "end"
  | "stopped"
  | "walking"
  | "noHeartRate"
  | "paceChanging"
  | "heartRateSettling";

export interface EfficiencyStep {
  /** Seconds of moving time. */
  t: number;
  /** `[t, speed in m/min, heart rate]` when the moment was steady enough to read. */
  reading?: [number, number, number];
  reason?: EfficiencyGapReason;
}

interface Span {
  count: number;
  mean: number;
  /** Standard deviation over the mean. */
  variation: number;
}

/** Running totals over a per-second series, so any span's mean and spread is O(1). */
class SecondSeries {
  private readonly sums: Float64Array;
  private readonly squares: Float64Array;
  private readonly counts: Float64Array;

  constructor(values: Float64Array) {
    const size = values.length + 1;
    this.sums = new Float64Array(size);
    this.squares = new Float64Array(size);
    this.counts = new Float64Array(size);
    values.forEach((value, index) => {
      const present = Number.isFinite(value);
      this.sums[index + 1] = this.sums[index]! + (present ? value : 0);
      this.squares[index + 1] = this.squares[index]! + (present ? value * value : 0);
      this.counts[index + 1] = this.counts[index]! + (present ? 1 : 0);
    });
  }

  /** Seconds `first` through `last`, inclusive; clipped to the series. */
  span(first: number, last: number): Span {
    const end = this.counts.length - 1;
    const from = Math.min(end, Math.max(0, first));
    const to = Math.min(end, Math.max(0, last + 1));
    const count = this.counts[to]! - this.counts[from]!;
    if (count <= 0) return { count: 0, mean: Number.NaN, variation: Number.NaN };
    const mean = (this.sums[to]! - this.sums[from]!) / count;
    const variance = Math.max(0, (this.squares[to]! - this.squares[from]!) / count - mean * mean);
    return { count, mean, variation: Math.sqrt(variance) / mean };
  }
}

/** Resample a run onto whole seconds of moving time: running speed, walking marks and heart rate. */
function perSecond(streams: ActivityStreams) {
  const seconds = Math.min(Math.round(streams.t[streams.length - 1]!) + 1, SAMPLING.longest);
  const speed = new Float64Array(seconds).fill(Number.NaN);
  const walking = new Float64Array(seconds).fill(Number.NaN);
  const heart = new Float64Array(seconds).fill(Number.NaN);
  const { gap, pace, hr, cadence } = streams.channels;
  for (let index = 0; index < streams.length; index += 1) {
    const second = Math.round(streams.t[index]!);
    if (second < 0 || second >= seconds) continue;
    const effortPace = gap?.[index];
    const usedPace = effortPace !== undefined && effortPace > 0 ? effortPace : pace?.[index];
    const steps = cadence?.[index];
    if (steps !== undefined && steps > 0 && steps < SAMPLING.walkingCadence) {
      walking[second] = 1;
    } else if (usedPace !== undefined && usedPace >= SAMPLING.fastestPace && usedPace <= SAMPLING.slowestPace) {
      speed[second] = 60_000 / usedPace;
    }
    const pulse = hr?.[index];
    if (pulse !== undefined && pulse >= 40 && pulse <= 230) heart[second] = pulse;
  }
  return { seconds, speed: new SecondSeries(speed), walking: new SecondSeries(walking), heart: new SecondSeries(heart) };
}

/** Every 30 s moment of a run, with its reading or the reason it has none. */
export function runEfficiencySteps(streams: ActivityStreams): EfficiencyStep[] {
  if (streams.speedKind !== "pace" || streams.length === 0) return [];
  if (!streams.channels.gap && !streams.channels.pace) return [];
  const { seconds, speed, walking, heart } = perSecond(streams);
  const {
    every, warmUp, halfWidth, heartLag, holdBefore, holdAfter, maxPaceVariation,
    settleOffset, settleHalfWidth, maxSettleBpm, coverage
  } = SAMPLING;
  const enough = (span: Span, width: number) => span.count >= width * coverage;
  const averageWidth = 2 * halfWidth + 1;
  // The last moment whose lagged heart-rate windows still fit inside the run.
  const lastMoment = seconds - 1 - heartLag - Math.max(halfWidth, settleOffset + settleHalfWidth);

  const judge = (t: number): EfficiencyStep => {
    if (t < warmUp) return { t, reason: "warmUp" };
    if (t > lastMoment) return { t, reason: "end" };
    const running = speed.span(t - halfWidth, t + halfWidth);
    if (!enough(running, averageWidth)) {
      const walked = walking.span(t - halfWidth, t + halfWidth);
      return { t, reason: walked.count >= averageWidth * (1 - coverage) ? "walking" : "stopped" };
    }
    const lagged = t + heartLag;
    const pulse = heart.span(lagged - halfWidth, lagged + halfWidth);
    if (!enough(pulse, averageWidth)) return { t, reason: "noHeartRate" };
    const held = speed.span(t - holdBefore, t + holdAfter);
    if (!enough(held, holdBefore + holdAfter + 1)) return { t, reason: "stopped" };
    if (held.variation > maxPaceVariation) return { t, reason: "paceChanging" };
    const earlier = heart.span(lagged - settleOffset - settleHalfWidth, lagged - settleOffset + settleHalfWidth);
    const later = heart.span(lagged + settleOffset - settleHalfWidth, lagged + settleOffset + settleHalfWidth);
    const settleWidth = 2 * settleHalfWidth + 1;
    if (!enough(earlier, settleWidth) || !enough(later, settleWidth)) return { t, reason: "noHeartRate" };
    if (Math.abs(later.mean - earlier.mean) > maxSettleBpm) return { t, reason: "heartRateSettling" };
    const tenth = (value: number) => Math.round(value * 10) / 10;
    return { t, reading: [t, tenth(running.mean), tenth(pulse.mean)] };
  };

  const steps: EfficiencyStep[] = [];
  for (let t = 0; t < seconds; t += every) steps.push(judge(t));
  return steps;
}

/** What is cached per run: its steady readings and COROS's VO2max at the time, the scale's anchor. */
export interface EfficiencyCurve {
  version: number;
  corosVo2max?: number;
  points: [number, number, number][];
}

export function runEfficiencyCurve(streams: ActivityStreams, corosVo2max?: number): EfficiencyCurve {
  const anchor = typeof corosVo2max === "number" && corosVo2max >= 15 && corosVo2max <= 95 ? corosVo2max : undefined;
  return {
    version: EFFICIENCY_CURVE_VERSION,
    ...(anchor !== undefined ? { corosVo2max: anchor } : {}),
    points: runEfficiencySteps(streams).flatMap((step) => (step.reading ? [step.reading] : []))
  };
}

// ---------------------------------------------------------------------------
// The figure, on the athlete's heart-rate profile.
// ---------------------------------------------------------------------------

export interface EfficiencyProfile {
  maxHr: number;
  restingHr: number;
}

/** A usable profile: a plausible resting heart rate and at least 40 bpm of reserve above it. */
export function efficiencyProfile(maxHr: number | undefined, restingHr: number | undefined): EfficiencyProfile | undefined {
  const valid =
    typeof maxHr === "number" && Number.isFinite(maxHr) &&
    typeof restingHr === "number" && Number.isFinite(restingHr) &&
    restingHr >= 25 && maxHr > restingHr + 40;
  return valid ? { maxHr, restingHr } : undefined;
}

/** Oxygen cost of running at `speed` metres per minute, ml/kg/min (Daniels & Gilbert). */
export function oxygenCost(speed: number): number {
  return -4.6 + 0.182258 * speed + 0.000104 * speed ** 2;
}

/** Below 40% of the reserve is a jog or a walk; above 102% the profile's maximum is out of date. */
const RESERVE_FRACTION = { min: 0.4, max: 1.02 } as const;

/** Effective VO2max of one reading, or nothing outside the reserve fractions it can be read at. */
export function effectiveVo2max(speed: number, heartRate: number, profile: EfficiencyProfile): number | undefined {
  const fraction = (heartRate - profile.restingHr) / (profile.maxHr - profile.restingHr);
  if (!(fraction >= RESERVE_FRACTION.min) || fraction > RESERVE_FRACTION.max) return undefined;
  const value = 3.5 + (oxygenCost(speed) - 3.5) / fraction;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export interface EfficiencyPoint {
  t: number;
  /** Effective VO2max before scaling. */
  value: number;
}

export function efficiencyPoints(curve: EfficiencyCurve | undefined, profile: EfficiencyProfile): EfficiencyPoint[] {
  if (curve?.version !== EFFICIENCY_CURVE_VERSION) return [];
  return curve.points.flatMap(([t, speed, heartRate]) => {
    const value = effectiveVo2max(speed, heartRate, profile);
    return value === undefined ? [] : [{ t, value }];
  });
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

// ---------------------------------------------------------------------------
// Fatigue over a run, and a run against the weeks before it.
// ---------------------------------------------------------------------------

/** A run's fresh level: the median reading between minutes 10 and 40, from at least 10 readings. */
const FRESH_MINUTES = { from: 10, to: 40, minReadings: 10 } as const;

function freshLevel(points: readonly EfficiencyPoint[]): number | undefined {
  const fresh = points
    .filter((point) => point.t >= FRESH_MINUTES.from * 60 && point.t <= FRESH_MINUTES.to * 60)
    .map((point) => point.value);
  return fresh.length >= FRESH_MINUTES.minReadings ? median(fresh) : undefined;
}

/**
 * How an athlete's runs typically fade: for each minute from the 10th, the
 * median (across runs) of that minute's reading over the run's fresh level,
 * smoothed over ±3 minutes and normalised so minutes 10–40 sit at 1. It stops
 * at the first minute fewer than three runs reached.
 */
export interface EfficiencyShape {
  /** Index 0 is minute 10. */
  values: number[];
  lastMinute: number;
}

export const MIN_SHAPE_RUNS = 3;

export function efficiencyShape(runs: readonly (readonly EfficiencyPoint[])[]): EfficiencyShape | undefined {
  const ratiosByMinute = new Map<number, number[]>();
  for (const points of runs) {
    const level = freshLevel(points);
    if (level === undefined) continue;
    const perMinute = new Map<number, number[]>();
    for (const point of points) {
      const minute = Math.floor(point.t / 60);
      if (minute >= FRESH_MINUTES.from) perMinute.set(minute, [...(perMinute.get(minute) ?? []), point.value / level]);
    }
    for (const [minute, ratios] of perMinute) ratiosByMinute.set(minute, [...(ratiosByMinute.get(minute) ?? []), median(ratios)]);
  }
  const typical: number[] = [];
  for (let minute = FRESH_MINUTES.from; (ratiosByMinute.get(minute)?.length ?? 0) >= MIN_SHAPE_RUNS; minute += 1) {
    typical.push(median(ratiosByMinute.get(minute)!));
  }
  if (typical.length === 0) return undefined;
  const smoothed = typical.map((_, index) => {
    const around = typical.slice(Math.max(0, index - 3), index + 4);
    return around.reduce((sum, value) => sum + value, 0) / around.length;
  });
  const freshCount = FRESH_MINUTES.to - FRESH_MINUTES.from + 1;
  const reference = median(smoothed.slice(0, freshCount));
  return { values: smoothed.map((value) => value / reference), lastMinute: FRESH_MINUTES.from + smoothed.length - 1 };
}

/** The typical fraction of the fresh level at `t`; 1 before minute 10 or without a shape, the last value past its end. */
export function shapeAt(shape: EfficiencyShape | undefined, t: number): number {
  const index = Math.floor(t / 60) - FRESH_MINUTES.from;
  if (!shape || index < 0) return 1;
  return shape.values[Math.min(index, shape.values.length - 1)]!;
}

/**
 * A run's figure: each reading divided by the typical fade at its minute, then
 * the median, so a long run is only marked down for fading more than usual.
 * Needs three minutes of readings.
 */
export function sessionEfficiency(points: readonly EfficiencyPoint[], shape: EfficiencyShape | undefined): number | undefined {
  if (points.length < 6) return undefined;
  return median(points.map((point) => point.value / shapeAt(shape, point.t)));
}

/** The usual is read from the six weeks of runs before a run, and needs three of them. */
export const BASELINE_DAYS = 42;
export const MIN_BASELINE_RUNS = 3;
/** Within ±3% of the usual counts as usual. */
export const EFFICIENCY_BAND = 0.03;

export interface EfficiencyRun {
  points: readonly EfficiencyPoint[];
  corosVo2max?: number;
}

export function efficiencyRun(curve: EfficiencyCurve | undefined, profile: EfficiencyProfile): EfficiencyRun {
  const points = efficiencyPoints(curve, profile);
  return curve?.corosVo2max === undefined ? { points } : { points, corosVo2max: curve.corosVo2max };
}

export interface EfficiencyBaseline {
  value: number;
  runs: number;
  shape?: EfficiencyShape;
}

export function efficiencyBaseline(runs: readonly EfficiencyRun[]): EfficiencyBaseline | undefined {
  const shape = efficiencyShape(runs.map((run) => run.points));
  const figures = runs.flatMap((run) => {
    const figure = sessionEfficiency(run.points, shape);
    return figure === undefined ? [] : [figure];
  });
  if (figures.length < MIN_BASELINE_RUNS) return undefined;
  return { value: median(figures), runs: figures.length, ...(shape ? { shape } : {}) };
}

/** Factor onto COROS's scale: median COROS VO2max over median figure, across runs that have both. */
export function efficiencyScale(runs: readonly EfficiencyRun[], shape: EfficiencyShape | undefined): number | undefined {
  const pairs = runs.flatMap((run) => {
    const figure = sessionEfficiency(run.points, shape);
    return figure === undefined || run.corosVo2max === undefined ? [] : [[figure, run.corosVo2max] as const];
  });
  if (pairs.length === 0) return undefined;
  return median(pairs.map(([, coros]) => coros)) / median(pairs.map(([figure]) => figure));
}

export type EfficiencyVerdict = "better" | "usual" | "worse";

export function efficiencyVerdict(value: number, usual: number): EfficiencyVerdict {
  // Judged on the change as displayed (a tenth of a percent), so "+3%" is never called usual.
  const change = Math.round((value / usual - 1) * 1000) / 1000;
  if (change >= EFFICIENCY_BAND) return "better";
  return change <= -EFFICIENCY_BAND ? "worse" : "usual";
}

/** Holding it to the end: runs of an hour or more, last 20 minutes against the fresh level. */
const DURABILITY = { minRunSeconds: 3600, tailSeconds: 1200 } as const;

export interface EfficiencyDurability {
  /** Percent change of the last 20 minutes against minutes 10–40. */
  change: number;
  /** The typical change over the same minutes, when there is a shape. */
  usual?: number;
}

export function efficiencyDurability(
  points: readonly EfficiencyPoint[],
  shape: EfficiencyShape | undefined,
  durationSeconds: number
): EfficiencyDurability | undefined {
  if (durationSeconds < DURABILITY.minRunSeconds) return undefined;
  const level = freshLevel(points);
  const tail = points.filter((point) => point.t >= durationSeconds - DURABILITY.tailSeconds);
  if (level === undefined || tail.length < 6) return undefined;
  const percent = (fraction: number) => (fraction - 1) * 100;
  return {
    change: percent(median(tail.map((point) => point.value)) / level),
    ...(shape ? { usual: percent(median(tail.map((point) => shapeAt(shape, point.t)))) } : {})
  };
}

// ---------------------------------------------------------------------------
// Cached runs, read one at a time or as a period.
// ---------------------------------------------------------------------------

export interface CachedEfficiencyRun {
  activityId: string;
  /** Unix seconds. */
  startTime: number;
  /** Moving seconds. */
  seconds: number;
  curve: EfficiencyCurve;
}

export interface RunEfficiencyReading {
  /** On COROS's VO2max scale when one could be set, else the raw figure. */
  value: number;
  scaled: boolean;
  usual?: number;
  verdict?: EfficiencyVerdict;
  /** Percent above (+) or below (−) the usual. */
  change?: number;
  baselineRuns: number;
  durability?: EfficiencyDurability;
  /** The run's readings over time, on the same scale as `value`. */
  points: EfficiencyPoint[];
}

export function readRunEfficiency(
  run: CachedEfficiencyRun,
  history: readonly CachedEfficiencyRun[],
  profile: EfficiencyProfile
): RunEfficiencyReading | undefined {
  const windowStart = run.startTime - BASELINE_DAYS * 86_400;
  const before = history
    .filter((past) => past.startTime < run.startTime && past.startTime >= windowStart)
    .map((past) => efficiencyRun(past.curve, profile));
  const baseline = efficiencyBaseline(before);
  const own = efficiencyRun(run.curve, profile);
  const figure = sessionEfficiency(own.points, baseline?.shape);
  if (figure === undefined) return undefined;
  // With no earlier run carrying COROS's estimate, the run's own estimate sets the scale,
  // but only while there is no usual it would contradict.
  const scale =
    efficiencyScale(before, baseline?.shape) ??
    (baseline === undefined && own.corosVo2max !== undefined ? own.corosVo2max / figure : undefined);
  const onScale = (value: number) => (scale === undefined ? value : value * scale);
  const durability = efficiencyDurability(own.points, baseline?.shape, run.seconds);
  return {
    value: onScale(figure),
    scaled: scale !== undefined,
    baselineRuns: baseline?.runs ?? 0,
    points: own.points.map((point) => ({ t: point.t, value: onScale(point.value) })),
    ...(baseline
      ? {
          usual: onScale(baseline.value),
          verdict: efficiencyVerdict(figure, baseline.value),
          change: (figure / baseline.value - 1) * 100
        }
      : {}),
    ...(durability ? { durability } : {})
  };
}

export interface EfficiencyTrendPoint {
  activityId: string;
  startTime: number;
  value: number;
  verdict?: EfficiencyVerdict;
}

/** Every run since `fromTime`, oldest first, each read against its own six weeks before. */
export function efficiencyTrend(
  runs: readonly CachedEfficiencyRun[],
  profile: EfficiencyProfile,
  fromTime: number
): EfficiencyTrendPoint[] {
  const ordered = [...runs].sort((a, b) => a.startTime - b.startTime);
  return ordered.flatMap((run) => {
    if (run.startTime < fromTime) return [];
    const reading = readRunEfficiency(run, ordered, profile);
    if (!reading) return [];
    return [{ activityId: run.activityId, startTime: run.startTime, value: reading.value, ...(reading.verdict ? { verdict: reading.verdict } : {}) }];
  });
}
