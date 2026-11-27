// Synced `activity` and `activity.detail` items → the Activities table and the activity page.
import type {
  Activity, ActivityDetail, ActivityExtras, ChartScales, Lap, RecordRow, RoutePoint, Sport, Streams, StrengthExercise, StrengthSession, Thresholds, ZoneTime,
} from "@/data/activities";
import { formatDistance, paceUnit, recordPace, scalesFor } from "@/lib/activities";
import { maxHrFor, muscleWork, relativeEffort, weekShare } from "@/lib/activityDetail";
import { bestEfforts, timesFromDistance } from "@/lib/bestEfforts";
import { clock } from "@/lib/format";
import { msg, t } from "@/lib/i18n";
import { projectRoute, SPORT_TITLE } from "./geo";
import gymMuscles from "./gymMuscles.json";
import {
  refToDate, type ActivityDetailBody, type NativeActivity, type NativeGymWorkout, type NativeSport, type RefDate, type ViewTrainingBody,
} from "./native";

/** The family each sport is filtered, coloured and paced under. Every sport on foot reads as pace per km. */
export const SPORT_FAMILY: Record<NativeSport, Sport> = {
  run: "Run", indoorRun: "Run", trailRun: "Run", track: "Run", walk: "Run", hike: "Run",
  bike: "Ride", indoorBike: "Ride",
  poolSwim: "Swim", openWater: "Swim",
  strength: "Strength",
  cardio: "Other", ski: "Other", row: "Other", multisport: "Other", other: "Other",
};

/** The route drawing's box (ActivityRouteMap) and the air kept around the route inside it. */
export const ROUTE_BOX = { width: 760, height: 420, pad: 40 } as const;

/** Below this speed (m/s) a sample counts as standing still, so a stop does not send the pace chart off to infinity. */
const STOPPED_MPS = { "min/km": 0.3, "min/100m": 0.2 } as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown): number | null => (finite(v) && v > 0 ? v : null);
const pad2 = (v: number) => String(v).padStart(2, "0");

/** A phone date as the screen's local `YYYY-MM-DDTHH:MM`. */
export function localStart(ref: RefDate): string {
  const d = refToDate(ref);
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** One table row. Null for an activity without a start time: it has no place in a table ordered and grouped by date. */
export function activityFromNative(id: string, n: NativeActivity): Activity | null {
  if (!finite(n.start)) return null;
  const sport = SPORT_FAMILY[n.sport] ?? "Other";
  const title = SPORT_TITLE[n.sport] ?? SPORT_TITLE.other;
  const row: Activity = {
    id,
    start: localStart(n.start),
    name: typeof n.name === "string" && n.name.trim() ? n.name : t(title),
    sport,
    distanceM: positive(n.distanceMeters),
    durationS: positive(n.durationSeconds) ?? 0,
    avgHr: positive(n.averageHR),
    maxHr: positive(n.maxHR),
    elevationGainM: finite(n.elevationGain) ? n.elevationGain : null,
    cadence: positive(n.averageCadence),
    load: finite(n.trainingLoad) ? n.trainingLoad : null,
  };
  if (positive(n.calories) != null) row.calories = n.calories;
  if (positive(n.averagePower) != null) row.avgPowerW = n.averagePower;
  if (title !== sport) row.sportName = title;
  return row;
}

/** Every activity with a start time, newest first. */
export function activitiesFromItems(items: readonly { id: string; body: NativeActivity }[]): Activity[] {
  return items
    .map((item) => activityFromNative(item.id, item.body))
    .filter((a): a is Activity => a != null)
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * Speed in m/s as the chart's pace: seconds per km on foot, seconds per 100 m in the water, km/h on a bike.
 * A sample standing still shows the slowest moving pace of the recording (0 km/h on a bike).
 */
export function paceFromSpeed(sport: Sport, speedMps: readonly number[]): number[] | null {
  const unit = paceUnit(sport);
  if (!unit) return null;
  if (unit === "km/h") return speedMps.map((v) => (v > 0 ? v * 3.6 : 0));
  const per = unit === "min/km" ? 1000 : 100;
  const stopped = STOPPED_MPS[unit];
  let slowest = Infinity;
  for (const v of speedMps) if (v >= stopped && v < slowest) slowest = v;
  if (!Number.isFinite(slowest)) return null;
  return speedMps.map((v) => per / (v >= stopped ? v : slowest));
}

/** Metres covered at each sample of a recording over time, from its speed, ending at `totalM` when that is known. */
export function distanceFromSpeed(seconds: readonly number[], speedMps: readonly number[], totalM: number | null): number[] | null {
  const out: number[] = [0];
  for (let i = 1; i < seconds.length; i++) {
    out.push(out[i - 1] + ((Math.max(0, speedMps[i - 1]) + Math.max(0, speedMps[i])) / 2) * Math.max(0, seconds[i] - seconds[i - 1]));
  }
  const end = out[out.length - 1];
  if (!(end > 0)) return null;
  const factor = totalM != null ? totalM / end : 1;
  return out.map((d) => d * factor);
}

type LapBody = NonNullable<ActivityDetailBody["laps"]>[number];

function lapsFrom(rows: readonly LapBody[] | undefined): Lap[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((l) => l != null && finite(l.durationS))
    .map((l, k) => {
      const lap: Lap = {
        n: Number.isInteger(l.n) ? l.n : k + 1,
        distanceM: positive(l.distanceM),
        durationS: l.durationS,
        avgHr: positive(l.avgHr),
        maxHr: positive(l.maxHr),
        cadence: positive(l.cadence),
        elevationM: finite(l.elevationM) ? l.elevationM : null,
      };
      if (typeof l.name === "string" && l.name.trim()) lap.name = l.name;
      return lap;
    });
}

function streamsFrom(activity: Activity, body: ActivityDetailBody["streams"]): Streams | null {
  if (!body || !Array.isArray(body.x) || body.x.length < 2 || !body.x.every(finite)) return null;
  const n = body.x.length;
  // Phones write null where a sensor dropped out. A stream is drawn when at least half its samples are numbers;
  // each gap takes the nearest reading before it (or the first reading, at the start).
  const stream = (values: unknown): number[] | null => {
    if (!Array.isArray(values) || values.length < n) return null;
    const cut = values.slice(0, n);
    const first = cut.find(finite);
    if (first === undefined || cut.filter(finite).length * 2 < n) return null;
    let last = first as number;
    return cut.map((v) => (finite(v) ? (last = v) : last));
  };
  const axis = body.axis === "time" ? "time" : "distance";
  const speed = stream(body.speedMps);
  const streams: Streams = {
    axis,
    x: body.x,
    pace: speed ? paceFromSpeed(activity.sport, speed) : null,
    hr: stream(body.hr),
    elevation: stream(body.elevationM),
    cadence: stream(body.cadence),
    power: stream(body.powerW),
  };
  if (!streams.pace && !streams.hr && !streams.elevation) return null;
  if (axis === "time" && speed) streams.distance = distanceFromSpeed(body.x, speed, activity.distanceM);
  return streams;
}

/** `scalesFor`, with the elevation chart starting just under the lowest point instead of at sea level. */
function scalesOf(streams: Streams): ChartScales {
  const scales = scalesFor(streams);
  if (!streams.elevation) return scales;
  let lo = Infinity, hi = -Infinity;
  for (const v of streams.elevation) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { ...scales, elevation: [Math.floor((lo - 5) / 5) * 5, Math.ceil((hi + 5) / 5) * 5] };
}

function zonesFrom(rows: ActivityDetailBody["zones"]): ZoneTime[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((z) => z != null && finite(z.zone) && finite(z.seconds))
    .map((z) => ({ zone: z.zone, fromBpm: finite(z.fromBpm) ? z.fromBpm : null, toBpm: finite(z.toBpm) ? z.toBpm : null, seconds: z.seconds }));
}

/** What else the person's synced items say about one activity. */
export interface DetailContext {
  /** Every activity, for the week's shares. */
  all?: readonly Activity[];
  training?: ViewTrainingBody;
  /** The gym log matched to a strength activity, with when the activity started. */
  gym?: { workout: NativeGymWorkout; start: RefDate; names: Record<string, string> };
}

export function thresholdsFrom(view: ViewTrainingBody | undefined): Thresholds {
  const th: Thresholds = {};
  if (!view) return th;
  if (positive(view.thresholdHr) != null) th.hr = view.thresholdHr;
  if (positive(view.maxHr) != null) th.maxHr = view.maxHr;
  if (positive(view.thresholdPaceSecPerKm) != null) th.paceSPerKm = view.thresholdPaceSecPerKm;
  if (positive(view.ftp) != null) th.ftp = view.ftp;
  return th;
}

/** The phone's personal bests that were set in this activity. */
export function recordsFor(id: string, view: ViewTrainingBody | undefined): RecordRow[] {
  return (view?.bests ?? [])
    .filter((b) => b != null && b.activityId === id && finite(b.seconds) && finite(b.meters) && b.meters > 0)
    .map((b) => ({ what: b.name, rank: t("Personal best"), value: clock(b.seconds, 2), pace: recordPace(b.seconds, b.meters), best: true }));
}

/**
 * The quickest 400 m, 1 km, mile, 5 km and longer inside a run, worked out from its recording, each set against
 * the phone's personal best for that distance: "Personal best" when this run holds it, else how far off it is.
 */
export function effortsFor(activity: Activity, body: ActivityDetailBody | undefined, streams: Streams | null, view: ViewTrainingBody | undefined): RecordRow[] {
  const raw = body?.streams;
  if (activity.sport !== "Run" || !raw || !Array.isArray(raw.x) || raw.x.length < 2) return [];
  let tm: number[] | null, d: number[] | null;
  if (raw.axis === "time") { tm = raw.x; d = streams?.distance ?? null; }
  else { d = raw.x; tm = Array.isArray(raw.speedMps) ? timesFromDistance(raw.x, raw.speedMps) : null; }
  if (!tm || !d) return [];
  const bests = (view?.bests ?? []).filter((b) => b != null && finite(b.seconds) && finite(b.meters) && b.meters > 0);
  return bestEfforts(tm, d).map((e) => {
    const pb = bests.find((b) => Math.abs(b.meters - e.metres) <= e.metres * 0.01);
    const mine = pb?.activityId === activity.id;
    const seconds = mine && pb ? pb.seconds : e.seconds;
    const rank = mine ? t("Personal best") : pb ? (seconds <= pb.seconds ? t("Faster than your best") : t("{time} off your best", { time: clock(seconds - pb.seconds, 2) })) : "";
    return { what: t(e.name), rank, value: clock(seconds, 2), pace: recordPace(seconds, e.metres), ...(mine ? { best: true } : {}) };
  });
}

/** How far a logged workout may start or end outside the watch's recording and still be the same session. */
const GYM_SLACK_S = 300;

/** The logged gym workout that overlaps a strength activity the most, as the phone pairs them. */
export function matchGymWorkout(activity: NativeActivity, workouts: readonly NativeGymWorkout[]): NativeGymWorkout | null {
  if (!finite(activity.start) || activity.sport !== "strength") return null;
  const from = activity.start - GYM_SLACK_S, to = activity.start + (positive(activity.durationSeconds) ?? 0) + GYM_SLACK_S;
  let best: NativeGymWorkout | null = null, most = 0;
  for (const w of workouts) {
    if (!finite(w.start)) continue;
    const overlap = Math.min(to, finite(w.end) ? w.end : w.start + 1) - Math.max(from, w.start);
    if (overlap > most) { most = overlap; best = w; }
  }
  return best;
}

const MUSCLE_TITLE: Record<string, string> = {
  abs: msg("Abs"), abductors: msg("Abductors"), adductors: msg("Adductors"), biceps: msg("Biceps"), calves: msg("Calves"), chest: msg("Chest"),
  forearms: msg("Forearms"), glutes: msg("Glutes"), hamstrings: msg("Hamstrings"), lats: msg("Lats"), lowerBack: msg("Lower back"),
  obliques: msg("Obliques"), quads: msg("Quads"), shoulders: msg("Shoulders"), traps: msg("Traps"), triceps: msg("Triceps"), upperBack: msg("Upper back"),
};
const muscleTitle = (key: string) => (MUSCLE_TITLE[key] ? t(MUSCLE_TITLE[key]) : key.charAt(0).toUpperCase() + key.slice(1));
type MuscleEntry = { m: [string, number][]; k?: string };
const EXERCISE_MUSCLES = gymMuscles.exercises as unknown as Record<string, MuscleEntry | undefined>;

/** A logged gym workout as the strength page's exercises, with set times counted from the activity's start. */
export function strengthFromGym(workout: NativeGymWorkout, start: RefDate, names: Record<string, string>): StrengthSession | null {
  const worked: { workingSets: number; muscles: [string, number][] }[] = [];
  let known = true;
  const exercises: StrengthExercise[] = [];
  for (const entry of workout.entries ?? []) {
    const done = (entry.sets ?? []).filter((set) => set != null && set.doneAt != null);
    if (done.length === 0) continue;
    const info = EXERCISE_MUSCLES[entry.exerciseID];
    const ex: StrengthExercise = {
      name: names[entry.exerciseID] ?? entry.exerciseID.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
      sets: done.map((set) => ({
        weightKg: positive(set.weightKg), reps: positive(set.reps), seconds: positive(set.seconds),
        endS: finite(set.doneAt) ? set.doneAt - start : null, ...(set.kind === "warmUp" ? { warmUp: true } : {}),
      })),
    };
    if (info?.k === "b") ex.bodyweight = true;
    exercises.push(ex);
    const working = ex.sets.filter((x) => !x.warmUp).length;
    if (!info) known = known && working === 0;
    else worked.push({ workingSets: working, muscles: info.m });
  }
  if (exercises.length === 0) return null;
  const session: StrengthSession = { exercises };
  // Muscles are only listed when every exercise is one the app's own table knows; a partial list would mislead.
  if (known && worked.length > 0) session.muscles = muscleWork(worked).map((m) => ({ ...m, name: muscleTitle(m.name) }));
  return session;
}

/**
 * The activity page for a row and its `activity.detail` body. Without a body (the phone has not read the
 * recording yet) there are no laps, charts, route or zones: only the row and what the other items say about it.
 */
export function detailFromBody(activity: Activity, body: ActivityDetailBody | undefined, context: DetailContext = {}): ActivityDetail {
  const detail = recordingFromBody(activity, body);
  const thresholds = thresholdsFrom(context.training);
  if (Object.keys(thresholds).length > 0) detail.thresholds = thresholds;
  const week = context.all ? weekShare(activity, context.all) : null;
  if (week) detail.week = week;
  const extras: ActivityExtras = {};
  const efforts = effortsFor(activity, body, detail.streams, context.training);
  const records = efforts.length > 0 ? efforts : recordsFor(activity.id, context.training);
  if (records.length > 0) extras.records = records;
  const strength = context.gym ? strengthFromGym(context.gym.workout, context.gym.start, context.gym.names) : null;
  if (strength) extras.strength = strength;
  if (context.all) {
    const maxHr = maxHrFor(thresholds.maxHr, thresholds.hr, context.all);
    const effort = relativeEffort({ activity, streams: detail.streams, all: context.all, maxHr, exercises: strength?.exercises });
    if (effort) extras.relativeEffort = effort;
  }
  if (Object.keys(extras).length > 0) detail.extras = extras;
  return detail;
}

function recordingFromBody(activity: Activity, body: ActivityDetailBody | undefined): ActivityDetail {
  if (!body) return { activity, laps: [], steps: null, streams: null, scales: null, route: null, zones: [] };
  const steps = lapsFrom(body.steps);
  const streams = streamsFrom(activity, body.streams);
  const projected: RoutePoint[] = Array.isArray(body.route)
    ? projectRoute(body.route, ROUTE_BOX.width, ROUTE_BOX.height, ROUTE_BOX.pad, activity.distanceM ?? undefined)
    : [];
  const route = projected.length >= 2 ? projected : null;
  const detail: ActivityDetail = {
    activity,
    laps: lapsFrom(body.laps),
    steps: steps.length ? steps : null,
    streams,
    scales: streams ? scalesOf(streams) : null,
    route,
    zones: zonesFrom(body.zones),
  };
  if (route && activity.distanceM != null) detail.labels = { route: t("Route, {distance}", { distance: formatDistance(activity) }) };
  return detail;
}
