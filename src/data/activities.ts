import { fromSample, fromSynced, NotWiredError, type Loaded } from "@/data/core";
import { createStore } from "@/data/local/store";
import { language, t } from "@/lib/i18n";
import { addMinutes, weatherFrom, weatherUrl } from "@/lib/openMeteo";
import { SAMPLE_ACTIVITIES, sampleActivityDetail } from "@/data/sample/activities";
import { syncView } from "@/data/sync";
import { syncNow } from "@/data/sync/engine";
import { activitiesFromItems, activityFromNative, detailFromBody, matchGymWorkout } from "@/data/sync/activities";

/** The sport families the table filters by. "Run" holds every sport on foot, "Other" everything without a family. */
export type Sport = "Run" | "Ride" | "Strength" | "Swim" | "Other";
export const SPORTS: readonly Sport[] = ["Run", "Ride", "Strength", "Swim", "Other"];

/** One row of the activities table. Durations are seconds with hundredths kept. */
export interface Activity {
  id: string;
  /** Local start time, `YYYY-MM-DDTHH:MM`. */
  start: string;
  name: string;
  sport: Sport;
  /** The exact sport when it says more than the family: "Trail run", "Hike", "Pool swim". */
  sportName?: string;
  distanceM: number | null;
  durationS: number;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  /** Steps per minute for runs, crank turns per minute for rides. */
  cadence: number | null;
  load: number | null;
  calories?: number | null;
  /** Average power in watts, when the watch or a meter measured it. */
  avgPowerW?: number | null;
}

export interface Lap {
  n: number;
  distanceM: number | null;
  durationS: number;
  avgHr: number | null;
  maxHr: number | null;
  cadence: number | null;
  elevationM: number | null;
  /** The name a workout step or a manual lap carries, such as "Warm up". */
  name?: string;
  /** Recorded per lap by some watches; the page fills what it can from the recording otherwise. */
  powerW?: number | null;
  maxPowerW?: number | null;
  strideM?: number | null;
  groundContactMs?: number | null;
  verticalOscCm?: number | null;
  ascentM?: number | null;
  descentM?: number | null;
}

/**
 * Per-sample recordings, all the same length as `x`.
 * `x` is metres from the start (`axis: "distance"`) or seconds from the start (`axis: "time"`).
 * `pace` is seconds per km for runs, seconds per 100 m for swims and km/h for rides.
 */
export interface Streams {
  axis: "distance" | "time";
  x: number[];
  pace: number[] | null;
  hr: number[] | null;
  elevation: number[] | null;
  cadence: number[] | null;
  /** Metres from the start at each sample of a recording drawn over time, when it is known. */
  distance?: number[] | null;
  /** Watts. */
  power?: number[] | null;
  /** Running dynamics: ground contact (ms), vertical oscillation (cm), stride length (m). */
  groundContact?: number[] | null;
  verticalOsc?: number[] | null;
  stride?: number[] | null;
}

/** The value range each chart is drawn over, as [low, high]. */
export interface ChartScales {
  pace: [number, number] | null;
  hr: [number, number] | null;
  elevation: [number, number] | null;
}

/** A point of the route drawing in its 760 × 420 box, with the metres covered on reaching it. */
export interface RoutePoint {
  x: number;
  y: number;
  d: number;
  /** Where the point is on Earth. Only a recorded route has these; the sample sketch does not. */
  lat?: number;
  lon?: number;
}

/** A route point that can be placed on a real map. */
export type PlacedPoint = RoutePoint & { lat: number; lon: number };

export interface ZoneTime {
  zone: number;
  /** Lowest and highest heart rate of the zone; null where it is open-ended. */
  fromBpm: number | null;
  toBpm: number | null;
  seconds: number;
}

/** The athlete's own marks the page measures an activity against. Each is missing until the phone has worked it out. */
export interface Thresholds {
  /** Threshold heart rate, bpm. */
  hr?: number;
  maxHr?: number;
  /** Threshold pace, seconds per km. */
  paceSPerKm?: number;
  /** Functional threshold power, watts. */
  ftp?: number;
  weightKg?: number;
}

/** Where the activity sits in its Monday-to-Sunday week. */
export interface WeekShare {
  /** 1 for the week's first workout. */
  index: number;
  count: number;
  /** 0 to 1; null when the week has no time or no load to share. */
  time: number | null;
  load: number | null;
}

export interface RecordRow { what: string; rank: string; value: string; pace?: string; best?: boolean }

export type Stroke = "Freestyle" | "Breaststroke" | "Backstroke" | "Butterfly" | "Medley" | "Drill";

/** One length of the pool. `restAfterS` is the time spent at the wall before the next one. */
export interface SwimLength { stroke: Stroke; seconds: number; strokes: number | null; restAfterS: number }

export interface SwimData { poolM: number; lengths: SwimLength[] }

export interface StrengthSet {
  /** Kilograms on the bar, or added to bodyweight for a bodyweight exercise. Null when no load was logged. */
  weightKg: number | null;
  reps: number | null;
  /** Seconds under load, when timed. */
  seconds: number | null;
  /** Seconds from the start of the activity to the end of the set, when known. */
  endS: number | null;
  warmUp?: boolean;
}

export interface StrengthExercise { name: string; bodyweight?: boolean; sets: StrengthSet[] }

export interface MuscleWork { name: string; /** Effective sets this session. */ sets: number }

export interface StrengthSession {
  exercises: StrengthExercise[];
  /** Per-muscle work, when the exercises are known well enough to say. */
  muscles?: MuscleWork[];
  /** A turntable strip drawn for exactly this session's muscles. */
  figure?: { light: string; dark: string; label: string };
}

export interface Weather {
  tempC: number; feelsC?: number; humidityPct?: number; dewPointC?: number;
  windKmh?: number; windFrom?: string; gustKmh?: number; finishTempC?: number; sky?: string; note?: string;
}

/** Things only some sources hold. Every one is left out when the source has nothing, and its card is not drawn. */
export interface ActivityExtras {
  device?: string;
  /** Wall-clock seconds from start to finish, stops included. */
  elapsedS?: number;
  /** Lowest and highest reading of the watch's own thermometer, °C. */
  watchTempC?: [number, number];
  summary?: string;
  weather?: Weather;
  journal?: { felt?: number; tags?: string[]; note?: string };
  gear?: { name: string; note?: string };
  records?: RecordRow[];
  relativeEffort?: { score: number; harderThanPct: number | null; basis: string };
  swim?: SwimData;
  strength?: StrengthSession;
}

export interface ActivityDetail {
  activity: Activity;
  laps: Lap[];
  /** The same activity cut by workout step, when it followed a structured workout. */
  steps: Lap[] | null;
  /** Null until the recording has been read: then there are no charts to draw. */
  streams: Streams | null;
  scales: ChartScales | null;
  route: RoutePoint[] | null;
  zones: ZoneTime[];
  /** Spoken descriptions of the drawings, when someone wrote them. */
  labels?: { route?: string; pace?: string; hr?: string; elevation?: string };
  thresholds?: Thresholds;
  week?: WeekShare;
  extras?: ActivityExtras;
}

/** An activity whose recording is there to chart. */
export type RecordedDetail = ActivityDetail & { streams: Streams; scales: ChartScales };

export async function listActivities(): Promise<Loaded<Activity[]>> {
  const view = await syncView();
  if (!view) return fromSample(SAMPLE_ACTIVITIES);
  return fromSynced(activitiesFromItems(view.all("activity")));
}

/** One activity with laps, streams, route and zones. `data` is null when no activity has this id. */
export async function getActivity(id: string): Promise<Loaded<ActivityDetail | null>> {
  const view = await syncView();
  if (!view) return fromSample(sampleActivityDetail(id));
  const body = view.get("activity", id);
  const activity = body ? activityFromNative(id, body) : null;
  if (!body || !activity) return fromSynced(null);
  const gym = matchGymWorkout(body, view.all("gym.workout").map((w) => w.body));
  const detail = detailFromBody(activity, view.get("activity.detail", id), {
    all: activitiesFromItems(view.all("activity")),
    training: view.get("view.training", "me"),
    gym: gym && body.start != null ? { workout: gym, start: body.start, names: view.get("view.strength", "me")?.exerciseNames ?? {} } : undefined,
  });
  // The note C-LINK wrote about this workout (the server's summary endpoint or the phone), in the app's
  // language when there is one in it, else whichever was written last.
  const notes = view.all("ai.note").map((n) => n.body).filter((n) => n.kind === "workout" && n.key === id && n.text);
  const lang = language();
  const base = lang.split("-")[0];
  const note = notes.find((n) => n.language.split("-")[0] === base) ?? notes.sort((a, b) => b.writtenAt - a.writtenAt)[0];
  if (note) detail.extras = { ...detail.extras, summary: note.text };
  else askForNote(id, lang);
  if (!detail.extras?.weather) {
    const weather = await weatherFor(detail);
    if (weather) detail.extras = { ...detail.extras, weather };
  }
  return fromSynced(detail);
}

/** Weather already read for an activity, kept in this browser so a visit asks Open-Meteo once. */
const weatherStore = createStore<Record<string, Weather>>("activity.weather.v1", {});

/**
 * The weather at the start of an outdoor activity's route, from Open-Meteo. Null for one without a route,
 * and quietly null when Open-Meteo can't be reached: the card then stays empty.
 */
async function weatherFor(detail: ActivityDetail): Promise<Weather | null> {
  const a = detail.activity;
  const cached = weatherStore.get()[a.id];
  if (cached) return cached;
  const at = detail.route?.find((p) => p.lat != null && p.lon != null);
  if (!at || at.lat == null || at.lon == null || typeof fetch === "undefined") return null;
  const finish = addMinutes(a.start, (detail.extras?.elapsedS ?? a.durationS) / 60);
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 8000);
  try {
    const response = await fetch(weatherUrl(at.lat, at.lon, a.start, finish, new Date()), { signal: stop.signal });
    if (!response.ok) return null;
    const weather = weatherFrom(await response.json(), a.start, finish);
    if (weather) weatherStore.set((all) => ({ ...all, [a.id]: weather }));
    return weather;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const askedNotes = new Set<string>();

/**
 * Asks the server to write this workout's note, once a visit. When it does, the note arrives as a synced item and
 * the page reads it again. Quiet when it can't (no key on the server yet, offline): the card stays as it was.
 */
function askForNote(id: string, language: string): void {
  if (typeof window === "undefined" || askedNotes.has(id)) return;
  askedNotes.add(id);
  void fetch("/api/ai/note", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" },
    body: JSON.stringify({ kind: "workout", key: id, language, imperial: false, utcOffsetMinutes: -new Date().getTimezoneOffset() }),
  }).then((response) => { if (response.ok) void syncNow().catch(() => {}); }, () => {});
}

export const IMPORT_TYPES = [".fit", ".gpx", ".tcx"] as const;

/** Reading activity files is not built: this always throws, so the screen can say so. */
export async function importActivityFile(file: { name: string }): Promise<never> {
  const known = IMPORT_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext));
  throw new NotWiredError(
    "activities.import",
    known
      ? t("Importing files is not connected yet. {file} was not added.", { file: file.name })
      : t("{file} is not a .fit, .gpx or .tcx file, and importing is not connected yet.", { file: file.name }),
  );
}

export async function exportActivityFit(id: string): Promise<never> {
  void id;
  throw new NotWiredError("activities.exportFit", t("Export FIT is not connected yet. The original file stays on your COROS account."));
}

export async function compareActivity(id: string): Promise<never> {
  void id;
  throw new NotWiredError("activities.compare", t("Compare is not connected yet."));
}

let mapToken: Promise<string | null> | null = null;

/**
 * The public Mapbox token the map tiles are asked for with, from this site's server. Null when the site has
 * none set up, or the person is signed out: the route is then drawn as a sketch.
 */
export function loadMapToken(): Promise<string | null> {
  mapToken ??= fetch("/api/map/token", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((body: { token?: unknown } | null) => (typeof body?.token === "string" ? body.token : null))
    .catch(() => null);
  return mapToken;
}

/** Table columns the person chose to hide, saved in this browser. */
export const hiddenColumnsStore = createStore<string[]>("activities.hiddenColumns", []);
