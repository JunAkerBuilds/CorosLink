/**
 * The raw material for a session's training label, distilled from its parsed
 * detail (`ActivityStreams`) into something small enough to cache per activity:
 *  - seconds spent in each heart-rate zone after the warm-up, and on paced runs
 *    the same seconds cross-tabulated with pace zone, so a later step can count
 *    each second at whichever of the two says it was easier (heart rate drifts
 *    up on hot or long days while the legs are still running easy);
 *  - the work intervals of a repeat session, which define what the session
 *    trained (Seiler & Kjerland's session-goal approach), whatever the time in
 *    zone says.
 *
 * Kept free of React and app imports so `scripts/test-training-labels.mjs` can
 * load it under Node's strip-types.
 */

import type { ActivityStreams, StreamHrZoneModel, StreamLapKind, StreamZone } from "./activityStreams";

/** Bump when the summary changes meaning; cached ones from an older version are recomputed. */
export const INTENSITY_SUMMARY_VERSION = 1;

const RUNS = [100, 101, 102, 103] as const;
/** Road, indoor, gravel, mountain and helmet-sensor rides. E-bikes are left out: the motor sets the heart rate. */
const RIDES = [200, 201, 203, 204, 299] as const;
const LABELLED: ReadonlySet<number> = new Set<number>([...RUNS, ...RIDES]);
const TREADMILL = 101;
const TRAIL = 102;
/** Runs whose pace the watch measures from GPS or the track: everything but the treadmill. */
const MEASURED_PACE: ReadonlySet<number> = new Set([100, 102, 103]);

/** Runs and rides; hikes, swims, strength and the rest have no tempo to name. */
export function sportHasTrainingLabel(sportType: number | undefined): boolean {
  return sportType !== undefined && LABELLED.has(sportType);
}

/** The first ten minutes are warm-up: heart rate has not caught up with the effort yet. */
export const WARM_UP_SECONDS = 600;
/** COROS's six heart-rate zones; its pace zones are six too once Threshold's two halves are joined. */
export const ZONE_COUNT = 6;

const SAMPLE = {
  /** A gap to the next sample longer than this is a dropout, worth one second. */
  maxGap: 5,
  /** Slower than 20:00/km is standing still. */
  slowestPace: 1200
} as const;

const REPS = {
  /** Shorter laps are accidental presses. */
  minSeconds: 10,
  /** A "rep" over four times the typical one is the run the reps sat inside. */
  bodyFactor: 4,
  /** Pressed laps: at least four timed laps, the fast group 15% quicker than the slow one. */
  minPressedLaps: 4,
  fastOverSlow: 1.15,
  /** Laps this close to 1 km or 1 mile are the watch's auto-laps, and at 70% of laps the whole set is. */
  autoLapMeters: [1000, 1609.344],
  autoLapTolerance: 0.02,
  autoLapShare: 0.7
} as const;

export interface SessionRep {
  seconds: number;
  meters: number;
  /** 0–5: zone of the rep's average heart rate. */
  hrZone?: number;
  /** 0–5: zone of the rep's own pace, on a measured-pace run off the trail. */
  paceZone?: number;
}

export interface SessionIntensity {
  version: number;
  /** Moving seconds of the session. */
  seconds: number;
  /** The heart-rate model COROS scored it on, when it said. */
  model?: StreamHrZoneModel;
  /** Seconds per heart-rate zone after the warm-up. */
  hr: number[];
  /** Paced runs: `joint[hrZone][paceZone]` seconds after the warm-up. */
  joint?: number[][];
  reps?: SessionRep[];
}

/** Lower of the two middle values, so the median of ranks is itself a rank. 0 for an empty list. */
export function lowerMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1]!;
}

/** Index of the highest zone (above zone 0) whose bound `passes` accepts, else 0. */
function topZone(zones: readonly StreamZone[], passes: (bound: number) => boolean): number {
  for (let position = Math.min(zones.length, ZONE_COUNT) - 1; position > 0; position -= 1) {
    const bound = zones[position]!.start;
    if (bound !== undefined && passes(bound)) return position;
  }
  return 0;
}

/** Heart-rate zone: the highest zone whose floor the heart rate has reached. */
export function heartRateZone(zones: readonly StreamZone[], hr: number): number {
  return topZone(zones, (floor) => hr >= floor);
}

/** Pace zone: the highest zone whose slow edge the pace is at or inside (faster is a smaller number). */
export function paceZone(zones: readonly StreamZone[], pace: number): number {
  return topZone(zones, (slowEdge) => pace <= slowEdge);
}

/**
 * The pace a run's seconds are zoned on, if any: effort pace on a trail, plain
 * pace elsewhere, and only when COROS's six named pace zones are there to line
 * up with the heart-rate zones.
 */
function paceSource(streams: ActivityStreams, sportType: number): { zones: readonly StreamZone[]; values: Float64Array } | undefined {
  if (!MEASURED_PACE.has(sportType) || streams.speedKind !== "pace") return undefined;
  const distribution = sportType === TRAIL ? streams.zones.gap : streams.zones.pace;
  const values = sportType === TRAIL ? streams.channels.gap : streams.channels.pace;
  return distribution?.named && distribution.zones.length === ZONE_COUNT && values
    ? { zones: distribution.zones, values }
    : undefined;
}

function emptyRow(): number[] {
  return Array.from({ length: ZONE_COUNT }, () => 0);
}

function zoneSeconds(
  streams: ActivityStreams,
  hrZones: readonly StreamZone[],
  pace: ReturnType<typeof paceSource>
): Pick<SessionIntensity, "hr" | "joint"> {
  const hr = emptyRow();
  const joint = pace ? Array.from({ length: ZONE_COUNT }, emptyRow) : undefined;
  const heart = streams.channels.hr;
  const { t } = streams;
  if (heart) {
    for (let index = 0; index < streams.length; index += 1) {
      const pulse = heart[index]!;
      // `t` is moving time, so the warm-up does not count the pauses in it.
      if (t[index]! < WARM_UP_SECONDS || !(pulse > 0)) continue;
      const step = index + 1 < streams.length ? t[index + 1]! - t[index]! : 1;
      const weight = step > 0 && step <= SAMPLE.maxGap ? step : 1;
      const hrZone = heartRateZone(hrZones, pulse);
      if (pace && joint) {
        const value = pace.values[index]!;
        if (!(value > 0) || value > SAMPLE.slowestPace) continue;
        joint[hrZone]![paceZone(pace.zones, value)]! += weight;
      }
      hr[hrZone]! += weight;
    }
  }
  const whole = (row: number[]) => row.map(Math.round);
  return { hr: whole(hr), ...(joint ? { joint: joint.map(whole) } : {}) };
}

interface Bout {
  kind: StreamLapKind;
  seconds: number;
  meters: number;
  avgHr?: number;
}

/** Time, distance and time-weighted heart rate of samples `from`..`to`. */
function measure(streams: ActivityStreams, from: number, to: number, kind: StreamLapKind): Bout {
  const { t, d } = streams;
  const end = Math.min(to + 1, streams.length - 1);
  let beats = 0;
  let heartSeconds = 0;
  const heart = streams.channels.hr;
  for (let index = from; heart && index < end; index += 1) {
    const step = t[index + 1]! - t[index]!;
    const pulse = heart[index]!;
    if (pulse > 0 && step > 0 && step <= SAMPLE.maxGap) {
      beats += pulse * step;
      heartSeconds += step;
    }
  }
  return {
    kind,
    seconds: Math.max(0, t[end]! - t[from]!),
    meters: streams.hasDistance ? Math.max(0, d[end]! - d[from]!) : 0,
    ...(heartSeconds > 0 ? { avgHr: beats / heartSeconds } : {})
  };
}

/**
 * Work steps of a structured workout that sit next to a recovery step. COROS
 * splits one step into several laps by auto-lap, so neighbouring laps of the
 * same kind are joined first. A work step with no recovery beside it is the
 * session's main block, not a rep.
 */
function workoutReps(streams: ActivityStreams): Bout[] {
  const steps: { kind: StreamLapKind; from: number; to: number }[] = [];
  for (const lap of streams.laps) {
    const previous = steps.at(-1);
    if (previous?.kind === lap.kind) previous.to = lap.to;
    else steps.push({ kind: lap.kind, from: lap.from, to: lap.to });
  }
  return steps
    .filter((step, at) => step.kind === "work" && (steps[at - 1]?.kind === "recovery" || steps[at + 1]?.kind === "recovery"))
    .map((step) => measure(streams, step.from, step.to, step.kind));
}

/**
 * Reps from laps pressed by hand: unless the laps are mostly auto-laps, sort
 * their speeds, cut at the biggest jump, and if the fast group is clearly
 * quicker, every fast lap next to a slow one is a rep.
 */
function pressedReps(streams: ActivityStreams): Bout[] {
  const laps = streams.laps
    .map((lap) => measure(streams, lap.from, lap.to, lap.kind))
    .filter((lap) => lap.seconds >= REPS.minSeconds && lap.meters > 0);
  if (laps.length < REPS.minPressedLaps) return [];
  // The final lap is whatever was left when the watch stopped.
  const judged = laps.slice(0, -1);
  const isAutoLap = (lap: Bout) =>
    REPS.autoLapMeters.some((meters) => Math.abs(lap.meters - meters) <= meters * REPS.autoLapTolerance);
  if (judged.filter(isAutoLap).length >= judged.length * REPS.autoLapShare) return [];

  const speedOf = (lap: Bout) => lap.meters / lap.seconds;
  const speeds = laps.map(speedOf).sort((a, b) => a - b);
  let cut = -1;
  let biggestJump = 1;
  speeds.slice(1).forEach((speed, at) => {
    const jump = speed / speeds[at]!;
    if (jump > biggestJump) {
      biggestJump = jump;
      cut = at;
    }
  });
  if (cut < 0) return [];
  const slow = speeds.slice(0, cut + 1);
  const fast = speeds.slice(cut + 1);
  if (lowerMedian(fast) < REPS.fastOverSlow * lowerMedian(slow)) return [];
  const threshold = speeds[cut]!;
  const isFast = (lap: Bout | undefined) => lap !== undefined && speedOf(lap) > threshold;
  return laps.filter((lap, at) => isFast(lap) && ((at > 0 && !isFast(laps[at - 1])) || (at + 1 < laps.length && !isFast(laps[at + 1]))));
}

/** Drop strays and the body of the run; two or more reps left, or none. */
function keepReps(bouts: readonly Bout[]): Bout[] {
  const real = bouts.filter((bout) => bout.seconds >= REPS.minSeconds);
  const typical = lowerMedian(real.map((bout) => bout.seconds));
  const reps = real.filter((bout) => bout.seconds <= REPS.bodyFactor * typical);
  return reps.length >= 2 ? reps : [];
}

function sessionReps(streams: ActivityStreams, sportType: number, hrZones: readonly StreamZone[]): SessionRep[] | undefined {
  const found = streams.structured
    ? workoutReps(streams)
    : sportType < 200 && sportType !== TREADMILL
      ? pressedReps(streams)
      : [];
  const reps = keepReps(found);
  if (reps.length === 0) return undefined;
  // A trail rep is uphill, where its pace says little about effort: zone it on heart rate only.
  const paceZones =
    MEASURED_PACE.has(sportType) && sportType !== TRAIL && streams.zones.pace?.named ? streams.zones.pace.zones : undefined;
  return reps.map((rep) => {
    const pace = rep.meters > 0 ? rep.seconds / (rep.meters / 1000) : undefined;
    return {
      seconds: Math.round(rep.seconds),
      meters: Math.round(rep.meters),
      ...(rep.avgHr !== undefined ? { hrZone: heartRateZone(hrZones, rep.avgHr) } : {}),
      ...(paceZones && pace !== undefined ? { paceZone: paceZone(paceZones, pace) } : {})
    };
  });
}

/**
 * The label's inputs for a session, or nothing for a sport that is not
 * labelled or a session COROS did not score on its six heart-rate zones.
 */
export function summarizeSessionIntensity(
  streams: ActivityStreams,
  sportType: number | undefined
): SessionIntensity | undefined {
  if (sportType === undefined || !sportHasTrainingLabel(sportType)) return undefined;
  const hrZones = streams.zones.hr?.zones ?? [];
  if (hrZones.length !== ZONE_COUNT) return undefined;
  const reps = sessionReps(streams, sportType, hrZones);
  const model = streams.zones.hr?.model;
  return {
    version: INTENSITY_SUMMARY_VERSION,
    // The last sample covers its own second: a 90:00 run is 5,400 s, not 5,399.
    seconds: streams.length > 0 ? Math.round(streams.t[streams.length - 1]! + 1) : 0,
    ...(model ? { model } : {}),
    ...zoneSeconds(streams, hrZones, paceSource(streams, sportType)),
    ...(reps ? { reps } : {})
  };
}
