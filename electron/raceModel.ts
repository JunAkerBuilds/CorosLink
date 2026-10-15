import type { RaceBuildUp, RaceDistanceKey, RaceSuggestion } from "./raceTypes";
import type { TrainingHubActivity } from "./types";

// Pure race logic shared by the main process and the renderer. Type-only
// imports keep it loadable by Node's strip-types test runner.

export interface RaceDistance {
  key: Exclude<RaceDistanceKey, "other">;
  label: string;
  meters: number;
}

export const RACE_DISTANCES: readonly RaceDistance[] = [
  { key: "1mi", label: "Mile", meters: 1609.344 },
  { key: "5k", label: "5K", meters: 5000 },
  { key: "10k", label: "10K", meters: 10000 },
  { key: "15k", label: "15K", meters: 15000 },
  { key: "10mi", label: "10 Mile", meters: 16093.44 },
  { key: "half", label: "Half Marathon", meters: 21097.5 },
  { key: "marathon", label: "Marathon", meters: 42195 },
  { key: "50k", label: "50K", meters: 50000 }
];

const RACE_DISTANCE_BY_KEY = new Map(RACE_DISTANCES.map((distance) => [distance.key, distance]));

export const RACE_DISTANCE_KEYS: readonly RaceDistanceKey[] = [
  ...RACE_DISTANCES.map((distance) => distance.key),
  "other"
];

export function isRaceDistanceKey(value: unknown): value is RaceDistanceKey {
  return typeof value === "string" && (RACE_DISTANCE_KEYS as readonly string[]).includes(value);
}

export function raceDistanceLabel(key: RaceDistanceKey): string {
  return key === "other" ? "Other" : RACE_DISTANCE_BY_KEY.get(key)!.label;
}

export function raceDistanceMeters(key: RaceDistanceKey): number | undefined {
  return key === "other" ? undefined : RACE_DISTANCE_BY_KEY.get(key)?.meters;
}

/** COROS runs that can be a race: road, trail and track. Indoor runs cannot. */
const RACE_SPORT_TYPES = new Set([100, 102, 103]);

export function isRaceSportType(sportType: number | undefined): boolean {
  return sportType !== undefined && RACE_SPORT_TYPES.has(sportType);
}

// A watch measures a course a little long (tangents, weaving, GPS drift) and
// occasionally a little short, so the window leans long.
const SHORT_TOLERANCE = 0.96;
const LONG_TOLERANCE = 1.07;

/** The standard distance a recording matches, or "other" when it is none of them. */
export function detectRaceDistance(meters: number | undefined): RaceDistanceKey {
  if (meters === undefined || !Number.isFinite(meters) || meters <= 0) return "other";
  let best: RaceDistance | undefined;
  let bestError = Number.POSITIVE_INFINITY;
  for (const distance of RACE_DISTANCES) {
    const ratio = meters / distance.meters;
    if (ratio < SHORT_TOLERANCE || ratio > LONG_TOLERANCE) continue;
    const error = Math.abs(Math.log(ratio));
    if (error < bestError) {
      best = distance;
      bestError = error;
    }
  }
  return best?.key ?? "other";
}

/**
 * Riegel's endurance model, T2 = T1 × (D2 / D1)^1.06: what a result is worth
 * over another distance. It lets a 5K and a half marathon share one line.
 */
export function equivalentTime(
  seconds: number,
  fromMeters: number,
  toMeters: number,
  exponent = 1.06
): number {
  return seconds * Math.pow(toMeters / fromMeters, exponent);
}

/** Seconds per kilometre. */
export function paceSecondsPerKm(seconds: number, meters: number): number | undefined {
  return seconds > 0 && meters > 0 ? seconds / (meters / 1000) : undefined;
}

// ----- Suggestions -----

const RACE_NAME_PATTERN =
  /\b(race|racing|parkrun|marathon|half[- ]marathon|ultra|fun run|turkey trot|xc|cross[- ]country|relay|championships?|[0-9]+ ?k|[0-9]+ ?mile|[0-9]+ ?miler)\b/i;
// Words that mark a session as training even when it mentions a race:
// "Race pace tempo", "10K Easy Run", "Taper 400s".
const TRAINING_NAME_PATTERN =
  /\b(easy|recovery|long run|tempo|threshold|intervals?|repeats?|reps|workout|fartlek|progressive|progression|strides|warm[- ]?up|cool[- ]?down|shake ?out|taper|pace|drills?|[0-9]+ ?x ?[0-9]+|[0-9]+s)\b/i;

/** A name that reads like an event rather than a session. */
export function hasRaceLikeName(name: string | undefined): boolean {
  if (!name) return false;
  return RACE_NAME_PATTERN.test(name) && !TRAINING_NAME_PATTERN.test(name);
}

const BASELINE_DAYS = 120;
const BASELINE_MIN_RUNS = 5;
const BASELINE_MIN_METERS = 2000;
/**
 * How much quicker than the athlete's usual pace a run must be to read as an
 * all-out effort. Race pace sits further from everyday pace the shorter the
 * race, and "usual pace" includes stops, so short races need the bigger gap.
 */
const EFFORT_SPEEDUP: Record<Exclude<RaceDistanceKey, "other">, number> = {
  "1mi": 0.22,
  "5k": 0.2,
  "10k": 0.17,
  "15k": 0.15,
  "10mi": 0.15,
  half: 0.12,
  marathon: 0.08,
  "50k": 0.06
};
const SUGGESTION_MIN_METERS = 1500;
const MAX_SUGGESTIONS = 8;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Runs that look like races but are not tagged yet, newest first. `known`
 * holds activity IDs the athlete already tagged or dismissed.
 */
export function suggestRaces(
  activities: readonly TrainingHubActivity[],
  known: ReadonlySet<string>
): RaceSuggestion[] {
  const runs = activities
    .filter(
      (activity) =>
        isRaceSportType(activity.sportType) &&
        activity.startTime !== undefined &&
        (activity.distance ?? 0) > 0 &&
        (activity.duration ?? 0) > 0
    )
    .sort((a, b) => a.startTime! - b.startTime!);

  const suggestions: RaceSuggestion[] = [];
  for (const run of runs) {
    if (known.has(run.activityId) || run.distance! < SUGGESTION_MIN_METERS) continue;
    const distanceKey = detectRaceDistance(run.distance);
    const reasons: string[] = [];
    if (hasRaceLikeName(run.name)) reasons.push("Named like a race");

    const windowStart = run.startTime! - BASELINE_DAYS * 86_400;
    const baseline = runs
      .filter(
        (other) =>
          other !== run &&
          other.startTime! >= windowStart &&
          other.startTime! < run.startTime! &&
          other.distance! >= BASELINE_MIN_METERS
      )
      .map((other) => paceSecondsPerKm(other.duration!, other.distance!)!)
      .filter(Number.isFinite);
    const usualPace = baseline.length >= BASELINE_MIN_RUNS ? median(baseline) : undefined;
    const pace = paceSecondsPerKm(run.duration!, run.distance!);
    if (usualPace !== undefined && pace !== undefined && distanceKey !== "other") {
      const speedup = 1 - pace / usualPace;
      if (speedup >= EFFORT_SPEEDUP[distanceKey]) {
        reasons.push(`${Math.round(speedup * 100)}% quicker than your usual pace`);
      }
    }
    if (reasons.length > 0) suggestions.push({ activity: run, distanceKey, reasons });
  }
  return suggestions.reverse().slice(0, MAX_SUGGESTIONS);
}

// ----- Build-up -----

export const BUILD_UP_WEEKS = 8;

export interface BuildUpRun {
  /** Epoch seconds. */
  startTime: number;
  /** Meters. */
  distance: number;
}

/**
 * Running in the weeks before a race. `coverageStart` is the start of the
 * synced history: a window that begins earlier is reported incomplete.
 */
export function computeBuildUp(
  raceStart: number,
  runs: readonly BuildUpRun[],
  coverageStart: number | undefined,
  weeks = BUILD_UP_WEEKS
): RaceBuildUp {
  const windowStart = raceStart - weeks * 7 * 86_400;
  // A minute of slack keeps the race itself out of its own build-up.
  const inWindow = runs.filter(
    (run) => run.startTime >= windowStart && run.startTime < raceStart - 60 && run.distance > 0
  );
  const longest = inWindow.reduce((max, run) => Math.max(max, run.distance), 0);
  return {
    weeks,
    runs: inWindow.length,
    distance: inWindow.reduce((sum, run) => sum + run.distance, 0),
    longestRun: longest > 0 ? longest : undefined,
    complete: coverageStart !== undefined && coverageStart <= windowStart
  };
}

// ----- Journey -----

export interface RaceResultInput {
  raceId: string;
  startTime: number;
  distanceKey: RaceDistanceKey;
  officialDistance: number;
  officialTime: number;
}

export interface RaceResultProgress {
  /** Groups results that are comparable head to head. */
  groupKey: string;
  /** A personal best when it was run (faster than every earlier result in the group). */
  wasPersonalBest: boolean;
  /** The fastest result in the group today. */
  isCurrentBest: boolean;
  /** Seconds versus the previous result in the group; negative is faster. */
  deltaToPrevious?: number;
  previousRaceId?: string;
  /** Riegel equivalent over 5 km, for comparing across distances. */
  fiveKEquivalent: number;
}

/**
 * Standard distances compare among themselves; an "other" result only
 * compares with races of the same length to the nearest 100 m.
 */
export function raceGroupKey(race: Pick<RaceResultInput, "distanceKey" | "officialDistance">): string {
  return race.distanceKey === "other"
    ? `other:${Math.round(race.officialDistance / 100) * 100}`
    : race.distanceKey;
}

export function computeRaceProgress(
  races: readonly RaceResultInput[]
): Map<string, RaceResultProgress> {
  const progress = new Map<string, RaceResultProgress>();
  const chronological = [...races].sort((a, b) => a.startTime - b.startTime);
  const bestSoFar = new Map<string, number>();
  const previous = new Map<string, RaceResultInput>();
  const bestOverall = new Map<string, RaceResultInput>();

  for (const race of chronological) {
    const groupKey = raceGroupKey(race);
    const best = bestSoFar.get(groupKey);
    const before = previous.get(groupKey);
    progress.set(race.raceId, {
      groupKey,
      wasPersonalBest: best === undefined || race.officialTime < best,
      isCurrentBest: false,
      deltaToPrevious: before ? race.officialTime - before.officialTime : undefined,
      previousRaceId: before?.raceId,
      fiveKEquivalent: equivalentTime(race.officialTime, race.officialDistance, 5000)
    });
    bestSoFar.set(groupKey, best === undefined ? race.officialTime : Math.min(best, race.officialTime));
    previous.set(groupKey, race);
    const overall = bestOverall.get(groupKey);
    if (!overall || race.officialTime < overall.officialTime) bestOverall.set(groupKey, race);
  }
  for (const race of bestOverall.values()) {
    progress.get(race.raceId)!.isCurrentBest = true;
  }
  return progress;
}
