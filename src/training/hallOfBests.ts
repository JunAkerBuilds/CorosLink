import type { TrainingHubActivity } from "../../electron/types";
import { activityMovingSeconds, activitySpeedKmh } from "../../electron/activityTime";
import { activityCategory, activityTimestamp } from "./activityCollection";
import { sportColorCategory, type SportColorCategory } from "./sportColors";

/**
 * The Records tab's "hall of bests" beyond COROS's running records: bests for
 * every other sport, the totals, milestones and weekly work behind them, all
 * computed from the activity history for the selected period.
 */

const DAY_MS = 86_400_000;

/** Sports that get their own wing. Running is COROS's own record board. */
export type HallSport = "run" | "ride" | "swim" | "walk";

export const HALL_SPORT_LABELS: Record<HallSport, string> = {
  run: "Running",
  ride: "Cycling",
  swim: "Swimming",
  walk: "Walking & hiking"
};

const SPORT_NOUNS: Record<HallSport, [string, string]> = {
  run: ["run", "runs"],
  ride: ["ride", "rides"],
  swim: ["swim", "swims"],
  walk: ["walk", "walks"]
};

export function sessionNoun(sport: HallSport, count: number): string {
  return SPORT_NOUNS[sport][count === 1 ? 0 : 1];
}

/** COROS record groups and how far back each reaches; All time has no start. */
const PERIOD_DAYS: Record<number, number> = { 1: 28, 2: 84, 3: 182 };

export function periodStart(groupType: number | undefined, now = Date.now()): number | null {
  const days = groupType === undefined ? undefined : PERIOD_DAYS[groupType];
  if (days === undefined) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today.getTime() - days * DAY_MS;
}

export function activitiesSince(
  activities: TrainingHubActivity[],
  since: number | null
): TrainingHubActivity[] {
  return since === null
    ? activities
    : activities.filter((activity) => activityTimestamp(activity.startTime) >= since);
}

export function hallSport(activity: TrainingHubActivity): HallSport | null {
  const category = activityCategory(activity.sportType);
  return category === "run" || category === "ride" || category === "swim" || category === "walk"
    ? category
    : null;
}

const positive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

/** Moving seconds, as COROS headlines them; elapsed time adds pauses and stops. */
const movingSeconds = (activity: TrainingHubActivity): number =>
  activityMovingSeconds(activity) ?? 0;

// --- Bests from the activity list -------------------------------------------------

export type ActivityRecordKind = "distance" | "duration" | "climb" | "speed";

export interface ActivityRecordDef {
  kind: ActivityRecordKind;
  label: string;
}

/** Fastest-ride speed only counts rides long enough to be a real effort. */
const SPEED_MIN_METERS = 5000;

export const ACTIVITY_RECORD_DEFS: Record<Exclude<HallSport, "run">, ActivityRecordDef[]> = {
  ride: [
    { kind: "distance", label: "Longest ride" },
    { kind: "duration", label: "Longest in the saddle" },
    { kind: "climb", label: "Biggest climb" },
    { kind: "speed", label: "Fastest ride" }
  ],
  swim: [
    { kind: "distance", label: "Longest swim" },
    { kind: "duration", label: "Longest time in the water" }
  ],
  walk: [
    { kind: "distance", label: "Longest walk" },
    { kind: "duration", label: "Longest time on foot" },
    { kind: "climb", label: "Biggest climb" }
  ]
};

export interface ActivityRecord {
  key: string;
  sport: Exclude<HallSport, "run">;
  kind: ActivityRecordKind;
  label: string;
  /** Metres, seconds, metres climbed, or km/h. */
  value: number;
  activity: TrainingHubActivity;
  /** Epoch ms of the activity. */
  time: number;
}

function recordValue(activity: TrainingHubActivity, kind: ActivityRecordKind): number | undefined {
  switch (kind) {
    case "distance":
      return positive(activity.distance) ? activity.distance : undefined;
    case "duration":
      return activityMovingSeconds(activity);
    case "climb":
      return positive(activity.elevationGain) ? activity.elevationGain : undefined;
    case "speed":
      return positive(activity.distance) && activity.distance >= SPEED_MIN_METERS
        ? activitySpeedKmh(activity)
        : undefined;
  }
}

/** The best activity for each record of a sport; a record with no candidate is null. */
export function activityRecords(
  activities: TrainingHubActivity[],
  sport: Exclude<HallSport, "run">
): (ActivityRecord | null)[] {
  const pool = activities.filter((activity) => hallSport(activity) === sport);
  return ACTIVITY_RECORD_DEFS[sport].map((def) => {
    let best: ActivityRecord | null = null;
    for (const activity of pool) {
      const value = recordValue(activity, def.kind);
      if (value === undefined || (best && value <= best.value)) continue;
      best = {
        key: `${sport}:${def.kind}`,
        sport,
        kind: def.kind,
        label: def.label,
        value,
        activity,
        time: activityTimestamp(activity.startTime)
      };
    }
    return best;
  });
}

// --- Totals and milestones --------------------------------------------------------

export interface SportTally {
  count: number;
  distance: number;
  duration: number;
}

export function sportTally(activities: TrainingHubActivity[], sport: HallSport): SportTally {
  return activities
    .filter((activity) => hallSport(activity) === sport)
    .reduce(
      (tally, activity) => ({
        count: tally.count + 1,
        distance: tally.distance + (positive(activity.distance) ? activity.distance : 0),
        duration: tally.duration + movingSeconds(activity)
      }),
      { count: 0, distance: 0, duration: 0 }
    );
}

export interface WorkTotals {
  count: number;
  distance: number;
  duration: number;
  climb: number;
  activeDays: number;
  /** Epoch ms of the first activity in the set. */
  first: number | null;
}

function dayKey(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function workTotals(activities: TrainingHubActivity[]): WorkTotals {
  const days = new Set<string>();
  let first: number | null = null;
  let distance = 0;
  let duration = 0;
  let climb = 0;
  for (const activity of activities) {
    const time = activityTimestamp(activity.startTime);
    if (time) {
      days.add(dayKey(time));
      first = first === null ? time : Math.min(first, time);
    }
    distance += positive(activity.distance) ? activity.distance : 0;
    duration += movingSeconds(activity);
    climb += positive(activity.elevationGain) ? activity.elevationGain : 0;
  }
  return { count: activities.length, distance, duration, climb, activeDays: days.size, first };
}

function weekStart(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  // Weeks start on Monday.
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

export interface Milestones {
  biggestWeek: { start: number; seconds: number; count: number } | null;
  longestStreak: { days: number; end: number } | null;
  hardestSession: TrainingHubActivity | null;
  longestSession: TrainingHubActivity | null;
}

export function milestones(activities: TrainingHubActivity[]): Milestones {
  const weeks = new Map<number, { seconds: number; count: number }>();
  const days = new Set<number>();
  let hardestSession: TrainingHubActivity | null = null;
  let longestSession: TrainingHubActivity | null = null;

  for (const activity of activities) {
    const time = activityTimestamp(activity.startTime);
    if (time) {
      const week = weeks.get(weekStart(time)) ?? { seconds: 0, count: 0 };
      week.seconds += movingSeconds(activity);
      week.count += 1;
      weeks.set(weekStart(time), week);
      const day = new Date(time);
      day.setHours(0, 0, 0, 0);
      days.add(day.getTime());
    }
    if (
      positive(activity.trainingLoad) &&
      (activity.trainingLoad ?? 0) > (hardestSession?.trainingLoad ?? 0)
    ) {
      hardestSession = activity;
    }
    if (movingSeconds(activity) > (longestSession ? movingSeconds(longestSession) : 0)) {
      longestSession = activity;
    }
  }

  let biggestWeek: Milestones["biggestWeek"] = null;
  for (const [start, week] of weeks) {
    if (week.seconds > 0 && (!biggestWeek || week.seconds > biggestWeek.seconds)) {
      biggestWeek = { start, ...week };
    }
  }

  // Calendar days in a row; a day is 23–25 hours across DST, so step by date.
  let longestStreak: Milestones["longestStreak"] = null;
  const sorted = [...days].sort((a, b) => a - b);
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    const expected = previous === null ? null : new Date(previous);
    expected?.setDate(expected.getDate() + 1);
    run = expected && expected.getTime() === day ? run + 1 : 1;
    if (!longestStreak || run > longestStreak.days) longestStreak = { days: run, end: day };
    previous = day;
  }

  return { biggestWeek, longestStreak, hardestSession, longestSession };
}

// --- Weekly work series -------------------------------------------------------------

export interface WorkBucket {
  start: number;
  end: number;
  /** Seconds per sport colour category. */
  seconds: Record<SportColorCategory, number>;
  total: number;
  count: number;
}

const EMPTY_SECONDS = (): Record<SportColorCategory, number> => ({
  strength: 0,
  trail: 0,
  run: 0,
  bike: 0,
  other: 0
});

/**
 * Time trained per week (per month once the span passes half a year), stacked
 * by the app's sport colour categories.
 */
export function workBuckets(
  activities: TrainingHubActivity[],
  from: number,
  to: number
): { unit: "week" | "month"; buckets: WorkBucket[] } {
  const unit = to - from > 26 * 7 * DAY_MS ? "month" : "week";
  const buckets: WorkBucket[] = [];
  const cursor = new Date(unit === "week" ? weekStart(from) : from);
  if (unit === "month") {
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
  }
  while (cursor.getTime() <= to) {
    const start = cursor.getTime();
    if (unit === "week") cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
    buckets.push({ start, end: cursor.getTime(), seconds: EMPTY_SECONDS(), total: 0, count: 0 });
  }
  for (const activity of activities) {
    const time = activityTimestamp(activity.startTime);
    const bucket = buckets.find((candidate) => time >= candidate.start && time < candidate.end);
    if (!bucket) continue;
    const seconds = movingSeconds(activity);
    bucket.seconds[sportColorCategory(activity.sportType)] += seconds;
    bucket.total += seconds;
    bucket.count += 1;
  }
  return { unit, buckets };
}

// --- Record stories -----------------------------------------------------------------

/** A sparkline's worth of one record's metric, oldest first, from the sport's sessions. */
export function activitySeries(
  activities: TrainingHubActivity[],
  sport: Exclude<HallSport, "run">,
  kind: ActivityRecordKind,
  limit = 14
): number[] {
  return activities
    .filter((activity) => hallSport(activity) === sport)
    .map((activity) => ({
      time: activityTimestamp(activity.startTime),
      value: recordValue(activity, kind)
    }))
    .filter((point): point is { time: number; value: number } => point.value !== undefined)
    .sort((left, right) => left.time - right.time)
    .slice(-limit)
    .map((point) => point.value);
}

export interface RecordHistoryPoint {
  /** Epoch ms of the day the time was set. */
  time: number;
  seconds: number;
}

function signatureDay(day: string): number | null {
  if (!/^\d{8}$/.test(day)) return null;
  return new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8))
  ).getTime();
}

/**
 * The best-time staircase for one record type, from the "type:happenDay:value"
 * signatures the app has seen over time (the celebration's memory), plus the
 * current record. Only times that beat every earlier one are kept, so period
 * bests that never were all-time bests drop out.
 */
export function recordHistory(
  signatures: readonly string[],
  type: number,
  current?: RecordHistoryPoint | null
): RecordHistoryPoint[] {
  const byDay = new Map<number, number>();
  const add = (time: number, seconds: number) =>
    byDay.set(time, Math.min(seconds, byDay.get(time) ?? Infinity));
  for (const signature of signatures) {
    const [typeText, day, valueText] = signature.split(":");
    if (Number(typeText) !== type || !day || !valueText) continue;
    const time = signatureDay(day);
    const seconds = Number(valueText);
    if (time === null || !Number.isFinite(seconds) || seconds <= 0) continue;
    add(time, seconds);
  }
  if (current && current.seconds > 0) add(current.time, current.seconds);
  const staircase: RecordHistoryPoint[] = [];
  for (const [time, seconds] of [...byDay].sort((left, right) => left[0] - right[0])) {
    const best = staircase.at(-1);
    if (!best || seconds < best.seconds - 0.5) staircase.push({ time, seconds });
  }
  return staircase;
}

/** The best that stood on a given day, or null when the history starts later. */
export function bestAsOf(history: RecordHistoryPoint[], time: number): RecordHistoryPoint | null {
  let best: RecordHistoryPoint | null = null;
  for (const point of history) {
    if (point.time > time) break;
    best = point;
  }
  return best;
}

/**
 * How close a record sits to COROS's predicted time, 0–1: 1 when the record
 * already matches or beats the prediction, falling to 0 at 15% slower.
 */
export function reachShare(recordSeconds: number, predictedSeconds: number): number {
  if (!(recordSeconds > 0) || !(predictedSeconds > 0)) return 0;
  const ratio = predictedSeconds / recordSeconds;
  return ratio >= 1 ? 1 : Math.max(0, Math.min(1, (ratio - 0.85) / 0.15));
}

/**
 * The run a COROS record was set in: by its activity id, or else the only run
 * that day long enough to hold the distance. Never a pick between several.
 */
export function findRecordActivity(
  activities: TrainingHubActivity[],
  record: { activityId?: string; day: number | null; meters?: number }
): TrainingHubActivity | null {
  if (record.activityId) {
    const exact = activities.find((activity) => activity.activityId === record.activityId);
    if (exact) return exact;
  }
  const day = record.day;
  if (day === null) return null;
  const next = new Date(day);
  next.setDate(next.getDate() + 1);
  const candidates = activities.filter((activity) => {
    const time = activityTimestamp(activity.startTime);
    return (
      hallSport(activity) === "run" &&
      time >= day &&
      time < next.getTime() &&
      (!record.meters || (activity.distance ?? 0) >= record.meters * 0.98)
    );
  });
  return candidates.length === 1 ? candidates[0]! : null;
}
