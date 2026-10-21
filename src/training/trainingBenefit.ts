/**
 * A session's training label (Recovery, Aerobic, Tempo, Threshold, VO2 Max or
 * Anaerobic) and its shape (intervals, strides, a long run), decided from the
 * summary `sessionIntensity.ts` caches per activity.
 *
 * COROS's six zones correspond to Jack Daniels' training intensities (Aerobic
 * Endurance ≈ easy, Aerobic Power ≈ marathon, Threshold ≈ threshold, Anaerobic
 * Endurance ≈ interval, Anaerobic Power ≈ repetition), so the rules use
 * Daniels' minimum amounts of work per session type:
 *  - Repeat sessions are judged by their reps (the session goal, after Seiler &
 *    Kjerland): each rep ranked on its pace zone where it has one, otherwise its
 *    heart-rate zone, with short fast reps counted as repetition work.
 *  - Steady sessions are judged by time after the warm-up, hardest type first,
 *    each second ranked at the easier of its pace and heart-rate zones.
 *
 * Node-free and React-free, so `scripts/test-training-labels.mjs` can reach it.
 */

import type { StreamHrZoneModel } from "./activityStreams";
import { lowerMedian, sportHasTrainingLabel, type SessionIntensity, type SessionRep } from "./sessionIntensity";

/** Easiest first: a label's index is its rank. */
export const TRAINING_LABELS = ["recovery", "aerobic", "tempo", "threshold", "vo2max", "anaerobic"] as const;
export type TrainingLabel = (typeof TRAINING_LABELS)[number];

const rankOf = (label: TrainingLabel) => TRAINING_LABELS.indexOf(label);

/**
 * Rank of each heart-rate zone. On HR reserve and LTHR the six zones are the
 * six ranks. The Max HR model's zones sit lower (its Warm Up is still easy and
 * its Threshold is the fifth zone), so they shift down one from the second.
 * Pace zones are always the six ranks.
 */
const HEART_RATE_RANKS: Record<"standard" | "maxHr", readonly number[]> = {
  standard: [0, 1, 2, 3, 4, 5],
  maxHr: [0, 0, 1, 2, 3, 4]
};
const PACE_RANKS: readonly number[] = [0, 1, 2, 3, 4, 5];

/** Sessions under ten minutes of moving time are not labelled. */
export const MIN_LABEL_SECONDS = 600;
/** Nor are steady sessions with under five minutes of heart rate after the warm-up. */
const MIN_STEADY_SECONDS = 300;

/**
 * The hard session types, hardest first, with the work each needs (Daniels):
 * a few minutes of repetitions, eight of intervals, twenty at threshold or
 * marathon effort. A steady VO2 Max or Tempo session also needs that work to be
 * a real share of it, so a hard finish does not relabel an easy run.
 */
const HARD_SESSIONS: readonly { label: TrainingLabel; work: number; share?: number }[] = [
  { label: "anaerobic", work: 4 * 60 },
  { label: "vo2max", work: 8 * 60, share: 0.25 },
  { label: "threshold", work: 20 * 60 },
  { label: "tempo", work: 20 * 60, share: 0.5 }
];
const workNeeded = (label: TrainingLabel) => HARD_SESSIONS.find((session) => session.label === label)?.work;

/** A recovery run is short and almost all easy. */
const RECOVERY = { maxSeconds: 45 * 60, share: 0.7 } as const;
/** A rep at interval effort or faster that is under two minutes is repetition work. */
const REPETITION_MAX_SECONDS = 120;
/** Strides: reps under 45 s that add up to under five minutes. */
const STRIDES = { maxRepSeconds: 45, maxWorkSeconds: 5 * 60 } as const;
/** Long sessions: 90 minutes running, three hours riding. */
const LONG_SECONDS = { run: 90 * 60, ride: 3 * 3600 } as const;

export type RepSize = { unit: "seconds" | "meters"; value: number };

export type SessionShape =
  | { kind: "intervals" | "strides"; count: number; size: RepSize }
  | { kind: "long"; ride: boolean };

export type LabelBasis =
  | { kind: "reps"; count: number; measure: "pace" | "hr" }
  /** Seconds at the label or harder (Recovery and Aerobic: at it or easier), and their share of the time read. */
  | { kind: "steady"; measure: "both" | "hr"; seconds: number; share: number };

export interface TrainingLabelReading {
  label: TrainingLabel;
  basis: LabelBasis;
  shape?: SessionShape;
}

/** Coefficient of variation; Infinity when the mean is not positive. */
function variation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!(mean > 0)) return Infinity;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean;
}

/** Reps set by distance hold their metres more tightly than their seconds, and the other way round. */
function repSize(reps: readonly SessionRep[], strides: boolean): RepSize {
  const seconds = reps.map((rep) => rep.seconds);
  const meters = reps.map((rep) => rep.meters);
  // GPS distance on a 20 s stride is too rough to say what was set: strides are given in time.
  if (!strides && variation(meters) < variation(seconds)) return { unit: "meters", value: lowerMedian(meters) };
  return { unit: "seconds", value: lowerMedian(seconds) };
}

function repRank(rep: SessionRep, heartRanks: readonly number[]): number | undefined {
  const rank = rep.paceZone !== undefined ? PACE_RANKS[rep.paceZone] : rep.hrZone !== undefined ? heartRanks[rep.hrZone] : undefined;
  if (rank === undefined) return undefined;
  return rank >= rankOf("vo2max") && rep.seconds < REPETITION_MAX_SECONDS ? rankOf("anaerobic") : rank;
}

/**
 * A repeat session: its shape always, and its label when the reps add up to
 * enough work for the type they rank as. Otherwise they were pick-ups within
 * some other session (`decides: false`).
 */
function judgeReps(reps: readonly SessionRep[], heartRanks: readonly number[]): { shape: SessionShape; decides: boolean; reading?: Omit<TrainingLabelReading, "shape"> } {
  const work = reps.reduce((sum, rep) => sum + rep.seconds, 0);
  const strides =
    lowerMedian(reps.map((rep) => rep.seconds)) < STRIDES.maxRepSeconds && work < STRIDES.maxWorkSeconds;
  const shape: SessionShape = { kind: strides ? "strides" : "intervals", count: reps.length, size: repSize(reps, strides) };
  if (strides) return { shape, decides: false };
  const ranks = reps.flatMap((rep) => {
    const rank = repRank(rep, heartRanks);
    return rank === undefined ? [] : [rank];
  });
  if (ranks.length === 0) return { shape, decides: false };
  const label = TRAINING_LABELS[lowerMedian(ranks)]!;
  const needed = workNeeded(label);
  if (needed === undefined || work < needed) return { shape, decides: false };
  const onPace = reps.filter((rep) => rep.paceZone !== undefined).length;
  return {
    shape,
    decides: true,
    reading: { label, basis: { kind: "reps", count: reps.length, measure: onPace > reps.length / 2 ? "pace" : "hr" } }
  };
}

/** Seconds after the warm-up per rank, each at the easier of its heart-rate and pace zones where both were read. */
function secondsByRank(intensity: SessionIntensity, heartRanks: readonly number[]): number[] {
  const byRank = TRAINING_LABELS.map(() => 0);
  if (intensity.joint) {
    intensity.joint.forEach((paceRow, hrZone) =>
      paceRow.forEach((seconds, paceZone) => {
        byRank[Math.min(heartRanks[hrZone] ?? 0, PACE_RANKS[paceZone] ?? 0)]! += seconds;
      })
    );
  } else {
    intensity.hr.forEach((seconds, hrZone) => {
      byRank[heartRanks[hrZone] ?? 0]! += seconds;
    });
  }
  return byRank;
}

/** A steady session: the hardest type it did enough of, else Recovery or Aerobic. */
function judgeSteady(intensity: SessionIntensity, heartRanks: readonly number[]): Omit<TrainingLabelReading, "shape"> | undefined {
  const byRank = secondsByRank(intensity, heartRanks);
  const read = byRank.reduce((sum, seconds) => sum + seconds, 0);
  if (read < MIN_STEADY_SECONDS) return undefined;
  const measure = intensity.joint ? "both" : "hr";
  const steady = (label: TrainingLabel, seconds: number): Omit<TrainingLabelReading, "shape"> => ({
    label,
    basis: { kind: "steady", measure, seconds, share: seconds / read }
  });
  const atLeast = (label: TrainingLabel) => byRank.slice(rankOf(label)).reduce((sum, seconds) => sum + seconds, 0);
  for (const session of HARD_SESSIONS) {
    const seconds = atLeast(session.label);
    if (seconds >= session.work && (session.share === undefined || seconds / read >= session.share)) {
      return steady(session.label, seconds);
    }
  }
  const easiest = byRank[rankOf("recovery")]!;
  if (intensity.seconds <= RECOVERY.maxSeconds && easiest / read >= RECOVERY.share) return steady("recovery", easiest);
  return steady("aerobic", read - atLeast("tempo"));
}

/**
 * The session's label and shape, or nothing for a sport that is not labelled,
 * a session under ten minutes, or too little read after the warm-up.
 * `fallbackModel` is used when COROS did not name the zone model it scored the
 * session on (some activities say 0 on an account that never changed model).
 */
export function trainingLabel(
  sportType: number | undefined,
  intensity: SessionIntensity | undefined,
  fallbackModel?: StreamHrZoneModel
): TrainingLabelReading | undefined {
  if (!intensity || !sportHasTrainingLabel(sportType) || intensity.seconds < MIN_LABEL_SECONDS) return undefined;
  const heartRanks = HEART_RATE_RANKS[(intensity.model ?? fallbackModel) === "maxHr" ? "maxHr" : "standard"];
  const reps = intensity.reps?.length ? judgeReps(intensity.reps, heartRanks) : undefined;
  const reading = reps?.reading ?? judgeSteady(intensity, heartRanks);
  if (!reading) return undefined;
  const ride = (sportType ?? 0) >= 200;
  const long = intensity.seconds >= (ride ? LONG_SECONDS.ride : LONG_SECONDS.run);
  // On a long session, pick-ups that decided nothing matter less than its length; strides stay strides.
  let shape: SessionShape | undefined;
  if (reps && (reps.decides || reps.shape.kind === "strides" || !long)) shape = reps.shape;
  else if (long) shape = { kind: "long", ride };
  return shape ? { ...reading, shape } : reading;
}

// ---------------------------------------------------------------------------
// English source text for the UI; callers translate it.
// ---------------------------------------------------------------------------

export const TRAINING_LABEL_NAMES: Record<TrainingLabel, string> = {
  recovery: "Recovery",
  aerobic: "Aerobic",
  tempo: "Tempo",
  threshold: "Threshold",
  vo2max: "VO2 Max",
  anaerobic: "Anaerobic"
};

/** The COROS zone each label is named after, for the reason line. */
export const TRAINING_LABEL_ZONES: Record<TrainingLabel, string> = {
  recovery: "Recovery",
  aerobic: "Aerobic Endurance",
  tempo: "Aerobic Power",
  threshold: "Threshold",
  vo2max: "Anaerobic Endurance",
  anaerobic: "Anaerobic Power"
};

/**
 * A rep's size as it would be written on a track session: "400 m", "1 km",
 * "1.6 km" (metric whatever the unit setting), or "20″", "1′30″", "8′".
 * `formatDecimal` localises the kilometre figure.
 */
export function formatRepSize(size: RepSize, formatDecimal: (value: number) => string = String): string {
  if (size.unit === "meters") {
    if (size.value < 1000) return `${Math.max(50, Math.round(size.value / 50) * 50)} m`;
    return `${formatDecimal(Math.round(size.value / 100) / 10)} km`;
  }
  if (size.value < 60) return `${Math.round(size.value)}″`;
  const total = Math.round(size.value / 5) * 5;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return seconds === 0 ? `${minutes}′` : `${minutes}′${String(seconds).padStart(2, "0")}″`;
}
