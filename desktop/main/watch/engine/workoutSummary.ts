// A workout read from the watch, cut down to an entry of the Activities list: CorosKit's WatchWorkoutSummary
// (WatchData/WatchWorkoutSummary.swift) and the TrainingInsights.ActivitySummary / Sport it makes (Training/
// TrainingInsights.swift, TrainingInsightsParser.swift). `activityBody` is the summary as JSONEncoder writes it
// (SyncJSON.native): nil left out, the start as seconds since 2001, the sport as its raw value.
import { refSeconds } from "./native";
import { MAX_SUMMARY_SPEED, RUN_SPORT_TYPES, type Session, type Training } from "./sportRecord";

/** The sport families C-LINK draws differently (TrainingInsights.Sport's raw values). */
export type Sport =
  | "run" | "indoorRun" | "trailRun" | "track" | "walk" | "hike" | "bike" | "indoorBike" | "poolSwim" | "openWater"
  | "strength" | "cardio" | "ski" | "row" | "multisport" | "other";

export const SPORT_TITLES: Record<Sport, string> = {
  run: "Run", indoorRun: "Indoor run", trailRun: "Trail run", track: "Track run", walk: "Walk", hike: "Hike", bike: "Ride",
  indoorBike: "Indoor ride", poolSwim: "Pool swim", openWater: "Open water", strength: "Strength", cardio: "Cardio", ski: "Ski",
  row: "Row", multisport: "Multisport", other: "Workout",
};

/** Whether pace (rather than speed) is the natural measure. */
export const usesPace = (sport: Sport): boolean => ["run", "indoorRun", "trailRun", "track", "walk", "hike"].includes(sport);

/** The family of a COROS sport code (Sport(corosCode:)), or undefined for a code it doesn't know. */
export function sportForCorosCode(code: number): Sport | undefined {
  switch (code) {
    case 100: return "run";
    case 101: return "indoorRun";
    case 102: return "trailRun";
    case 103: return "track";
    case 104: case 105: return "hike";
    case 200: case 202: case 203: case 204: case 205: case 299: return "bike";
    case 201: return "indoorBike";
    case 300: return "poolSwim";
    case 301: return "openWater";
    // 903 Elliptical, 904 Yoga, 905 Pilates, 906 Boxing.
    case 400: case 401: case 901: case 902: case 903: case 904: case 905: case 906: return "cardio";
    case 402: return "strength";
    case 500: case 501: case 502: case 503: case 10002: return "ski";
    case 700: case 701: case 702: case 704: return "row";
    case 900: return "walk";
    case 10000: case 10001: return "multisport";
    case 98: case 106: case 705: case 706: case 800: case 801: case 802: case 1100: case 1101: case 1200: case 10003: return "other";
  }
  if ((code >= 707 && code <= 715) || (code >= 1000 && code <= 1006)) return "other";
  return undefined;
}

/** TrainingInsights.ActivitySummary: one entry of the Activities list. */
export interface ActivitySummary {
  id: string;
  name: string;
  sport: Sport;
  sportCode?: number;
  start?: Date;
  distanceMeters?: number;
  durationSeconds?: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
  trainingLoad?: number;
  elevationGain?: number;
  /** Steps per minute. */
  averageCadence?: number;
  averagePower?: number;
}

/** Under a minute: a start-and-stop or a test of the button, left out of lists everywhere. */
export const isBlip = (activity: ActivitySummary): boolean => activity.durationSeconds !== undefined && activity.durationSeconds < 60;

/** The summary as JSONEncoder writes it. Nil when JSONEncoder would fail (a NaN or infinite number). */
export function activityBody(a: ActivitySummary): Record<string, unknown> | null {
  const body: Record<string, unknown> = {
    id: a.id, name: a.name, sport: a.sport, sportCode: a.sportCode, start: a.start && refSeconds(a.start),
    distanceMeters: a.distanceMeters, durationSeconds: a.durationSeconds, averageHR: a.averageHR, maxHR: a.maxHR, calories: a.calories,
    trainingLoad: a.trainingLoad, elevationGain: a.elevationGain, averageCadence: a.averageCadence, averagePower: a.averagePower,
  };
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) delete body[key];
    else if (typeof value === "number" && !Number.isFinite(value)) return null;
  }
  return body;
}

/** Swift's `.rounded()`: halves away from zero. */
export const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

/** WatchWorkoutSummary: what the Activities list and the training figures need from a workout. */
export interface WatchWorkoutSummary {
  /** `Session.watchActivityId`. */
  id: string;
  sportCode: number;
  start: Date;
  end: Date;
  /** Timer time, seconds: pauses left out, as COROS's list shows it. */
  timerSeconds: number;
  distanceMeters: number;
  calories: number;
  averageHR?: number;
  maxHR?: number;
  ascentMeters: number;
  /** Steps per minute for runs, revolutions per minute on a bike. */
  averageCadence?: number;
  averagePower?: number;
  training?: Training;
  workoutName?: string;
}

export function workoutSummary(session: Session): WatchWorkoutSummary {
  // Runs record steps per minute apart from the per-leg cadence FIT carries; COROS lists steps per minute.
  const cadence = RUN_SPORT_TYPES.has(session.sportType)
    ? session.avgStepCadence ?? (session.avgCadence === undefined ? undefined : session.avgCadence * 2)
    : session.avgCadence;
  return {
    id: session.watchActivityId, sportCode: session.sportType, start: new Date(session.startTs * 1000), end: new Date(session.endTs * 1000),
    timerSeconds: session.timerSec, distanceMeters: session.distanceM, calories: session.calories, averageHR: session.avgHr,
    maxHR: session.maxHr, ascentMeters: session.ascentM, averageCadence: cadence, averagePower: session.avgPower,
    training: session.training, workoutName: session.workoutName,
  };
}

const seconds = (w: WatchWorkoutSummary): number => (w.end.getTime() - w.start.getTime()) / 1000;
const positive = (v?: number): number | undefined => (v !== undefined && v > 0 ? v : undefined);

/** Distance, unless covered faster than 100 m/s (a summary read in the wrong layout gave a strength workout 6,239 km). */
function plausibleDistance(w: WatchWorkoutSummary): number | undefined {
  if (w.distanceMeters <= 0) return undefined;
  return w.distanceMeters <= Math.max(w.timerSeconds, seconds(w)) * MAX_SUMMARY_SPEED ? w.distanceMeters : undefined;
}

/** Calories, unless more than anyone burns in the time (30 kcal a minute, at least 50). */
function plausibleCalories(w: WatchWorkoutSummary): number | undefined {
  if (w.calories <= 0) return undefined;
  const minutes = Math.max(w.timerSeconds, seconds(w)) / 60;
  return w.calories <= Math.max(50, minutes * 30) ? w.calories : undefined;
}

/** The workout as an entry of the Activities list, under its planned workout's name or the sport's. */
export function summaryActivity(w: WatchWorkoutSummary): ActivitySummary {
  const sport = sportForCorosCode(w.sportCode) ?? "other";
  const distance = plausibleDistance(w);
  return {
    id: w.id, name: w.workoutName ?? SPORT_TITLES[sport], sport, sportCode: w.sportCode, start: w.start,
    distanceMeters: distance === undefined ? undefined : roundHalfAway(distance * 10) / 10,
    durationSeconds: w.timerSeconds > 0 ? roundHalfAway(w.timerSeconds) : undefined,
    averageHR: positive(w.averageHR), maxHR: positive(w.maxHR), calories: plausibleCalories(w),
    trainingLoad: w.training && w.training.trainingLoad > 0 ? w.training.trainingLoad : undefined,
    elevationGain: w.ascentMeters > 0 ? w.ascentMeters : undefined, averageCadence: positive(w.averageCadence),
    averagePower: positive(w.averagePower),
  };
}

/** A workout read from the watch is listed by C-LINK, not COROS. */
export const isWatchID = (id: string): boolean => id.startsWith("coros-");
