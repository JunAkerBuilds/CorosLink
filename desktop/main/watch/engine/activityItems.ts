// The `activity` and `activity.detail` item bodies the phone sends (docs/sync-contract.md §5.1): a port of CorosKit's
// SyncBodies.activities and SyncBodies.activityDetail (Sync/SyncBodies.swift), without COROS's lap table (the watch
// engine never has one). A field that can't be filled is left out, never guessed; a gap inside a stream is null.
import type { ActivityRecording, RecordingSample, RoutePoint } from "./activityRecording";
import { activityBody, isBlip, roundHalfAway, usesPace, type ActivitySummary, type Sport } from "./workoutSummary";

/** SyncCollection's names. */
export const COLLECTION_ACTIVITY = "activity";
export const COLLECTION_ACTIVITY_DETAIL = "activity.detail";

export interface SyncItemBody { collection: string; id: string; body: unknown }

export const STREAM_SAMPLES = 600;
export const ROUTE_POINTS = 800;
/** The effort zones' upper bounds as a percentage of threshold heart rate (Easy, Aerobic, Tempo, Threshold; Hard above). */
const ZONE_BOUNDS = [81, 90, 94, 100];

/** `activity` items: every activity listed, except a start-and-stop blip, which the app never shows. */
export function activityItems(activities: ActivitySummary[]): SyncItemBody[] {
  return activities.flatMap((activity) => {
    const body = isBlip(activity) ? null : activityBody(activity);
    return body ? [{ collection: COLLECTION_ACTIVITY, id: activity.id, body }] : [];
  });
}

/** At most `count` of `items`, evenly spaced, always with the first and the last. */
export function thinned<T>(items: T[], count: number): T[] {
  if (items.length <= count || count <= 1) return items;
  const step = (items.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => items[Math.min(items.length - 1, roundHalfAway(i * step))]);
}

export const rounded = (value: number, scale: number): number => roundHalfAway(value * scale) / scale;

const finite = (value: number | undefined): number | undefined => (value !== undefined && Number.isFinite(value) ? value : undefined);

/** An object without its undefined members (SyncJSON.object). */
function object(members: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(members).filter(([, v]) => v !== undefined));
}

/** §5.1, from the recording's own laps. `steps` is left out: the phone keeps a structured workout's steps with the plan. */
export function activityDetailBody(recording: ActivityRecording, sport: Sport, thresholdHR?: number): Record<string, unknown> {
  // FIT counts one foot's steps for a run; the app, COROS and the lap table show both feet's.
  const cadenceScale = usesPace(sport) ? 2 : 1;
  const laps = recording.laps.map((lap, index) => object({
    n: index + 1, distanceM: finite(lap.meters), durationS: finite(lap.seconds), avgHr: lap.averageHR, maxHr: lap.maxHR,
    cadence: lap.averageCadence === undefined ? undefined : roundHalfAway(lap.averageCadence * cadenceScale), elevationM: finite(lap.ascent),
  }));
  const members: Record<string, unknown> = { laps };

  const samples = thinned(recording.samples, STREAM_SAMPLES);
  if (samples.length > 0) {
    // Distance when the watch measured one all the way; a strength or indoor session without it reads by time.
    const byDistance = (recording.samples[recording.samples.length - 1].distance ?? 0) > 0 && samples.every((s) => s.distance !== undefined);
    const stream = (value: (s: RecordingSample) => number | undefined, places: number) => {
      const values = samples.map(value);
      if (!values.some((v) => v !== undefined)) return undefined;
      return values.map((v) => (v !== undefined && Number.isFinite(v) ? rounded(v, places) : null));
    };
    members.streams = object({
      axis: byDistance ? "distance" : "time",
      x: samples.map((s) => rounded(byDistance ? s.distance ?? 0 : s.elapsed, 10)),
      speedMps: stream((s) => s.speed, 1000),
      hr: stream((s) => s.heartRate, 1),
      elevationM: stream((s) => s.altitude, 10),
      cadence: stream((s) => (s.cadence === undefined ? undefined : roundHalfAway(s.cadence * cadenceScale)), 1),
      powerW: stream((s) => s.power, 1),
    });
  }

  const route = recording.route?.points;
  if (route && route.length > 1) {
    members.route = thinned<RoutePoint>(route, ROUTE_POINTS).map((p) => [rounded(p.latitude, 1_000_000), rounded(p.longitude, 1_000_000)]);
  }

  if (thresholdHR !== undefined && thresholdHR > 0) {
    const z = zones(recording.samples, thresholdHR);
    if (z) members.zones = z;
  }
  return members;
}

/** Seconds in each of the five effort zones: each sample's time since the one before, at most 10 s (longer is a pause). */
export function zones(samples: RecordingSample[], thresholdHR: number): Record<string, unknown>[] | null {
  if (!samples.some((s) => (s.heartRate ?? 0) > 30)) return null;
  const seconds = new Array<number>(ZONE_BOUNDS.length + 1).fill(0);
  for (let index = 1; index < samples.length; index++) {
    const hr = samples[index].heartRate;
    if (hr === undefined || hr <= 30) continue;
    const percent = (hr / thresholdHR) * 100;
    let zone = ZONE_BOUNDS.findIndex((bound) => percent < bound);
    if (zone < 0) zone = ZONE_BOUNDS.length;
    seconds[zone] += Math.min(Math.max(samples[index].elapsed - samples[index - 1].elapsed, 0), 10);
  }
  const bpm = (percent: number) => roundHalfAway((percent * thresholdHR) / 100);
  return seconds.map((s, zone) => ({
    zone: zone + 1,
    fromBpm: zone === 0 ? null : bpm(ZONE_BOUNDS[zone - 1]),
    toBpm: zone === ZONE_BOUNDS.length ? null : bpm(ZONE_BOUNDS[zone]) - 1,
    seconds: rounded(s, 1),
  }));
}
