import { randomUUID } from "node:crypto";
import {
  deleteSettings,
  getSetting,
  listStoredTrainingActivities,
  setSetting
} from "./database";
import {
  BUILD_UP_WEEKS,
  computeBuildUp,
  detectRaceDistance,
  isRaceDistanceKey,
  isRaceSportType,
  raceDistanceMeters,
  suggestRaces,
  type BuildUpRun
} from "./raceModel";
import {
  clearStravaRaceActivities,
  deleteStoredRace,
  getStoredRace,
  listStoredRaces,
  listStravaRaceActivities,
  saveStoredRace,
  upsertStravaRaceActivity,
  type RaceActivitySnapshot,
  type StoredRace,
  type StoredStravaRaceActivity
} from "./raceStore";
import type {
  ManualRaceInput,
  RaceEditInput,
  RaceEntry,
  RaceOverview,
  StravaRaceImportResult
} from "./raceTypes";
import {
  stravaActivityId,
  stravaActivityStartTime,
  stravaActivityUrl,
  stravaSportType
} from "./stravaModel";
import { fetchStravaActivityPage, getStravaStatus } from "./stravaService";
import type { TrainingHubActivity } from "./types";

type JsonRecord = Record<string, unknown>;

const SETTINGS = {
  /** Start time (epoch seconds) of the newest Strava activity an import has read. */
  stravaScannedThrough: "races.stravaScannedThrough",
  stravaImportedAt: "races.stravaImportedAt",
  /** Athlete the two values above belong to. */
  stravaAthlete: "races.stravaAthlete"
};
const STRAVA_SETTINGS = Object.values(SETTINGS);

/** Enough cached COROS history for any athlete; the cache is local SQLite. */
const CACHE_LIMIT = 50_000;
/** COROS → Strava sync keeps the start time, give or take the upload's rounding. */
const MATCH_WINDOW_SEC = 180;
const STRAVA_PAGE_SIZE = 200;
const STRAVA_MAX_PAGES = 100;
/** Strava's `workout_type` for a run marked "Race". */
const STRAVA_RACE_WORKOUT_TYPE = 1;
/** Strava run types that can be a race, with the COROS code each lines up with. */
const STRAVA_RACE_SPORTS: Record<string, number> = { Run: 100, TrailRun: 102 };
/** Every Strava run type counts toward build-up, treadmill included. */
const STRAVA_RUN_SPORTS = new Set(["Run", "TrailRun", "VirtualRun"]);
/** COROS run codes that count toward build-up: road, indoor, trail, track. */
const BUILD_UP_SPORT_TYPES = new Set([100, 101, 102, 103]);

const MAX_NAME_LENGTH = 120;
const MAX_PLACING_LENGTH = 120;
const MAX_NOTES_LENGTH = 2000;
const MAX_RACE_METERS = 500_000;
const MAX_RACE_SECONDS = 10 * 86_400;

const corosRaceId = (activityId: string) => `coros:${activityId}`;
const stravaRaceId = (activityId: string) => `strava:${activityId}`;

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function snapshotFromActivity(activity: TrainingHubActivity): RaceActivitySnapshot | undefined {
  if (activity.startTime === undefined) return undefined;
  return {
    name: activity.name,
    sportType: activity.sportType,
    startTime: activity.startTime,
    distance: activity.distance,
    duration: activity.duration,
    avgHr: activity.avgHr,
    elevationGain: activity.elevationGain
  };
}

/** The fields Races reads, so the stored Strava payload stays small. */
function trimStravaSummary(activity: JsonRecord): JsonRecord {
  const keep = [
    "id",
    "name",
    "sport_type",
    "type",
    "workout_type",
    "start_date",
    "distance",
    "elapsed_time",
    "moving_time",
    "total_elevation_gain",
    "average_heartrate",
    "max_heartrate"
  ];
  return Object.fromEntries(keep.filter((key) => key in activity).map((key) => [key, activity[key]]));
}

function snapshotFromStrava(activity: StoredStravaRaceActivity): RaceActivitySnapshot {
  const summary = activity.summary;
  const sport = stravaSportType(summary);
  const avgHr = positive(summary.average_heartrate);
  return {
    name: typeof summary.name === "string" ? summary.name : undefined,
    sportType: (sport && STRAVA_RACE_SPORTS[sport]) || 100,
    startTime: activity.startTime,
    distance: positive(summary.distance),
    // Elapsed, not moving: a race clock never stops, and Strava times races the same way.
    duration: positive(summary.elapsed_time) ?? positive(summary.moving_time),
    avgHr: avgHr === undefined ? undefined : Math.round(avgHr),
    elevationGain: finite(summary.total_elevation_gain)
  };
}

function isStravaRace(activity: JsonRecord): boolean {
  const sport = stravaSportType(activity);
  return (
    sport !== undefined &&
    sport in STRAVA_RACE_SPORTS &&
    Number(activity.workout_type) === STRAVA_RACE_WORKOUT_TYPE
  );
}

/**
 * Drop Strava race data the current connection no longer covers: everything
 * after a disconnect, another athlete's after a switch.
 */
function reconcileStravaAccess(): { connected: boolean; athleteId?: string } {
  const status = getStravaStatus();
  const athleteId = status.connected ? status.athleteId : undefined;
  clearStravaRaceActivities(athleteId);
  if (getSetting(SETTINGS.stravaAthlete) !== athleteId) {
    deleteSettings(STRAVA_SETTINGS);
  }
  return { connected: Boolean(athleteId), athleteId };
}

interface CorosHistory {
  byId: Map<string, TrainingHubActivity>;
  raceRuns: TrainingHubActivity[];
  buildUpRuns: BuildUpRun[];
  /** Start of the cached history, epoch seconds. */
  coverageStart?: number;
}

function loadCorosHistory(): CorosHistory {
  const activities = listStoredTrainingActivities(CACHE_LIMIT);
  let coverageStart: number | undefined;
  const buildUpRuns: BuildUpRun[] = [];
  for (const activity of activities) {
    if (activity.startTime === undefined) continue;
    coverageStart =
      coverageStart === undefined ? activity.startTime : Math.min(coverageStart, activity.startTime);
    if (BUILD_UP_SPORT_TYPES.has(activity.sportType) && (activity.distance ?? 0) > 0) {
      buildUpRuns.push({ startTime: activity.startTime, distance: activity.distance! });
    }
  }
  return {
    byId: new Map(activities.map((activity) => [activity.activityId, activity])),
    raceRuns: activities.filter((activity) => isRaceSportType(activity.sportType)),
    buildUpRuns,
    coverageStart
  };
}

function findCorosMatch(
  startTime: number,
  raceRuns: readonly TrainingHubActivity[]
): TrainingHubActivity | undefined {
  let best: TrainingHubActivity | undefined;
  let bestGap = MATCH_WINDOW_SEC + 1;
  for (const run of raceRuns) {
    if (run.startTime === undefined) continue;
    const gap = Math.abs(run.startTime - startTime);
    if (gap < bestGap) {
      best = run;
      bestGap = gap;
    }
  }
  return best;
}

function toRaceEntry(
  row: StoredRace,
  snapshot: RaceActivitySnapshot,
  history: CorosHistory,
  stravaBuildUp?: RaceEntry["buildUp"]
): RaceEntry | undefined {
  const recordedDistance = positive(snapshot.distance);
  const recordedTime = positive(snapshot.duration);
  const distanceKey = row.distanceKey ?? detectRaceDistance(recordedDistance);
  const officialDistance =
    distanceKey === "other"
      ? (row.officialDistance ?? recordedDistance)
      : raceDistanceMeters(distanceKey);
  const officialTime = row.officialTime ?? recordedTime;
  if (!officialDistance || !officialTime) return undefined;

  const corosBuildUp =
    row.source === "strava"
      ? undefined
      : computeBuildUp(snapshot.startTime, history.buildUpRuns, history.coverageStart);
  // Prefer the COROS history unless it starts too late and Strava saw the whole window.
  const buildUp =
    corosBuildUp && (corosBuildUp.complete || !stravaBuildUp) ? corosBuildUp : stravaBuildUp;

  const activityName = snapshot.name?.trim() || undefined;
  return {
    raceId: row.raceId,
    source: row.source,
    corosActivityId: row.corosActivityId,
    stravaActivityId: row.stravaActivityId,
    stravaUrl: row.stravaActivityId ? stravaActivityUrl(row.stravaActivityId) : undefined,
    name: row.eventName ?? activityName ?? "Race",
    activityName: row.eventName && activityName !== row.eventName ? activityName : undefined,
    startTime: snapshot.startTime,
    sportType: snapshot.sportType,
    distanceKey,
    distanceIsManual: row.distanceKey !== undefined,
    officialDistance,
    officialTime,
    officialTimeIsManual: row.officialTime !== undefined,
    recordedDistance: row.source === "manual" ? undefined : recordedDistance,
    recordedTime: row.source === "manual" ? undefined : recordedTime,
    avgHr: snapshot.avgHr,
    elevationGain: snapshot.elevationGain,
    placing: row.placing,
    notes: row.notes,
    buildUp
  };
}

export function getRaceOverview(): RaceOverview {
  const strava = reconcileStravaAccess();
  const history = loadCorosHistory();
  const stored = listStoredRaces();
  const stravaById = new Map(
    listStravaRaceActivities().map((activity) => [activity.activityId, activity])
  );

  const races: RaceEntry[] = [];
  let hiddenRaces = 0;
  for (const row of stored) {
    if (row.status !== "race") continue;
    const stravaActivity = row.stravaActivityId ? stravaById.get(row.stravaActivityId) : undefined;
    let snapshot: RaceActivitySnapshot | undefined;
    if (row.source === "coros") {
      const cached = row.corosActivityId ? history.byId.get(row.corosActivityId) : undefined;
      snapshot = (cached && snapshotFromActivity(cached)) ?? row.snapshot;
    } else if (row.source === "strava") {
      snapshot = stravaActivity ? snapshotFromStrava(stravaActivity) : undefined;
      if (!snapshot) hiddenRaces += 1;
    } else {
      snapshot = row.snapshot;
    }
    if (!snapshot) continue;
    const entry = toRaceEntry(row, snapshot, history, stravaActivity?.buildUp);
    if (entry) races.push(entry);
  }

  // A Strava-only race whose COROS recording was tagged here too is the same
  // race twice; keep the COROS one and carry the Strava link onto it.
  const corosRaces = races.filter((race) => race.source === "coros");
  const deduped = races.filter((race) => {
    if (race.source !== "strava") return true;
    const twin = corosRaces.find(
      (other) => Math.abs(other.startTime - race.startTime) <= MATCH_WINDOW_SEC
    );
    if (!twin) return true;
    twin.stravaActivityId ??= race.stravaActivityId;
    twin.stravaUrl ??= race.stravaUrl;
    return false;
  });
  deduped.sort((a, b) => b.startTime - a.startTime);

  const known = new Set(
    stored.map((row) => row.corosActivityId).filter((id): id is string => Boolean(id))
  );
  const stravaRaceStarts = deduped
    .filter((race) => race.source === "strava")
    .map((race) => race.startTime);
  const suggestions = suggestRaces([...history.byId.values()], known).filter(
    (suggestion) =>
      !stravaRaceStarts.some(
        (start) => Math.abs(start - (suggestion.activity.startTime ?? 0)) <= MATCH_WINDOW_SEC
      )
  );

  return {
    races: deduped,
    suggestions,
    strava: {
      connected: strava.connected,
      lastImportedAt: strava.connected ? getSetting(SETTINGS.stravaImportedAt) : undefined,
      hiddenRaces
    }
  };
}

/** COROS activity IDs tagged as races, for badges and the activity dialog. */
export function listRaceActivityIds(): string[] {
  return listStoredRaces()
    .filter((row) => row.status === "race" && row.corosActivityId)
    .map((row) => row.corosActivityId!);
}

function requireActivity(activity: TrainingHubActivity): TrainingHubActivity {
  if (!activity || typeof activity.activityId !== "string" || !activity.activityId) {
    throw new Error("Choose an activity to mark as a race.");
  }
  if (!isRaceSportType(activity.sportType)) {
    throw new Error("Only outdoor, trail and track runs can be marked as races.");
  }
  return activity;
}

/** Fold a Strava-only race row into the COROS recording of the same race. */
function absorbStravaTwin(target: StoredRace, startTime: number): StoredRace {
  const stravaStarts = new Map(
    listStravaRaceActivities().map((activity) => [activity.activityId, activity.startTime])
  );
  const twin = listStoredRaces().find((row) => {
    const stravaStart = row.source === "strava" && row.stravaActivityId
      ? stravaStarts.get(row.stravaActivityId)
      : undefined;
    return stravaStart !== undefined && Math.abs(stravaStart - startTime) <= MATCH_WINDOW_SEC;
  });
  if (!twin) return target;
  deleteStoredRace(twin.raceId);
  return {
    ...target,
    stravaActivityId: target.stravaActivityId ?? twin.stravaActivityId,
    eventName: target.eventName ?? twin.eventName,
    distanceKey: target.distanceKey ?? twin.distanceKey,
    officialDistance: target.officialDistance ?? twin.officialDistance,
    officialTime: target.officialTime ?? twin.officialTime,
    placing: target.placing ?? twin.placing,
    notes: target.notes ?? twin.notes
  };
}

export function markActivityAsRace(input: TrainingHubActivity): RaceOverview {
  const activity = requireActivity(input);
  const raceId = corosRaceId(activity.activityId);
  const existing = getStoredRace(raceId);
  const snapshot = snapshotFromActivity(activity) ?? existing?.snapshot;
  let race: StoredRace = {
    ...existing,
    raceId,
    status: "race",
    source: "coros",
    corosActivityId: activity.activityId,
    snapshot
  };
  if (snapshot) race = absorbStravaTwin(race, snapshot.startTime);
  saveStoredRace(race);
  return getRaceOverview();
}

/** "Not a race": hide a suggestion for good. */
export function dismissRaceSuggestion(activityId: string): RaceOverview {
  if (typeof activityId !== "string" || !activityId) throw new Error("Choose an activity.");
  const raceId = corosRaceId(activityId);
  const existing = getStoredRace(raceId);
  saveStoredRace({
    ...existing,
    raceId,
    status: "dismissed",
    source: "coros",
    corosActivityId: activityId
  });
  return getRaceOverview();
}

/**
 * Take a race off the list. Recorded races are remembered as "not a race" so
 * suggestions and Strava imports do not bring them back; manual ones go.
 */
export function removeRace(raceId: string): RaceOverview {
  const existing = typeof raceId === "string" ? getStoredRace(raceId) : undefined;
  if (!existing) throw new Error("That race is no longer in your list.");
  if (existing.source === "manual") deleteStoredRace(raceId);
  else saveStoredRace({ ...existing, status: "dismissed" });
  return getRaceOverview();
}

export function unmarkActivityAsRace(activityId: string): RaceOverview {
  return removeRace(corosRaceId(activityId));
}

function readDistance(value: unknown): number | undefined {
  const meters = positive(value);
  if (meters === undefined) return undefined;
  if (meters > MAX_RACE_METERS) throw new Error("Enter a race distance under 500 km.");
  return meters;
}

function readTime(value: unknown): number | undefined {
  const seconds = positive(value);
  if (seconds === undefined) return undefined;
  if (seconds > MAX_RACE_SECONDS) throw new Error("Enter a finish time under 10 days.");
  return Math.round(seconds * 10) / 10;
}

export function updateRace(input: RaceEditInput): RaceOverview {
  const existing = input && typeof input.raceId === "string" ? getStoredRace(input.raceId) : undefined;
  if (!existing || existing.status !== "race") {
    throw new Error("That race is no longer in your list.");
  }
  const next: StoredRace = { ...existing };
  if (input.name !== undefined) next.eventName = cleanText(input.name, MAX_NAME_LENGTH);
  if (input.distanceKey !== undefined) {
    if (input.distanceKey !== null && !isRaceDistanceKey(input.distanceKey)) {
      throw new Error("Choose a race distance.");
    }
    next.distanceKey = input.distanceKey ?? undefined;
  }
  if (input.officialDistance !== undefined) next.officialDistance = readDistance(input.officialDistance);
  if (input.officialTime !== undefined) next.officialTime = readTime(input.officialTime);
  if (input.placing !== undefined) next.placing = cleanText(input.placing, MAX_PLACING_LENGTH);
  if (input.notes !== undefined) next.notes = cleanText(input.notes, MAX_NOTES_LENGTH);
  // Recorded races fall back to the measured distance; a manual one has nothing to fall back on.
  if (next.source === "manual" && next.distanceKey === "other" && next.officialDistance === undefined) {
    throw new Error("Enter the race distance.");
  }
  saveStoredRace(next);
  return getRaceOverview();
}

export function addManualRace(input: ManualRaceInput): RaceOverview {
  const name = cleanText(input?.name, MAX_NAME_LENGTH);
  if (!name) throw new Error("Enter the race name.");
  const startTime = finite(input.startTime);
  if (startTime === undefined) throw new Error("Enter the race date.");
  if (!isRaceDistanceKey(input.distanceKey)) throw new Error("Choose a race distance.");
  const officialTime = readTime(input.officialTime);
  if (officialTime === undefined) throw new Error("Enter your finish time.");
  const officialDistance =
    input.distanceKey === "other"
      ? readDistance(input.officialDistance)
      : raceDistanceMeters(input.distanceKey);
  if (officialDistance === undefined) throw new Error("Enter the race distance.");

  saveStoredRace({
    raceId: `manual:${randomUUID()}`,
    status: "race",
    source: "manual",
    snapshot: { name, startTime: Math.floor(startTime), distance: officialDistance, duration: officialTime },
    eventName: name,
    distanceKey: input.distanceKey,
    officialDistance: input.distanceKey === "other" ? officialDistance : undefined,
    officialTime,
    placing: cleanText(input.placing, MAX_PLACING_LENGTH),
    notes: cleanText(input.notes, MAX_NOTES_LENGTH)
  });
  return getRaceOverview();
}

/**
 * Read the athlete's Strava history and bring in every run marked "Race".
 * The first import reads everything; later ones re-read from the last scan,
 * reaching back a build-up window so new races get their preparation.
 */
export async function importStravaRaces(full = false): Promise<StravaRaceImportResult> {
  const strava = reconcileStravaAccess();
  if (!strava.connected || !strava.athleteId) {
    throw new Error("Connect Strava before importing races.");
  }
  const scannedThrough = Number(getSetting(SETTINGS.stravaScannedThrough));
  const after =
    !full && Number.isFinite(scannedThrough) && scannedThrough > 0
      ? Math.max(0, scannedThrough - BUILD_UP_WEEKS * 7 * 86_400)
      : 0;

  const runs: BuildUpRun[] = [];
  const raceActivities: JsonRecord[] = [];
  let scanned = 0;
  let newest = Number.isFinite(scannedThrough) ? scannedThrough : 0;
  for (let page = 1; page <= STRAVA_MAX_PAGES; page += 1) {
    const batch = await fetchStravaActivityPage(after, page, STRAVA_PAGE_SIZE);
    scanned += batch.length;
    for (const activity of batch) {
      const startTime = stravaActivityStartTime(activity);
      if (startTime === undefined) continue;
      newest = Math.max(newest, startTime);
      const sport = stravaSportType(activity);
      const distance = positive(activity.distance);
      if (sport && STRAVA_RUN_SPORTS.has(sport) && distance) runs.push({ startTime, distance });
      if (isStravaRace(activity)) raceActivities.push(activity);
    }
    if (batch.length < STRAVA_PAGE_SIZE) break;
  }

  const history = loadCorosHistory();
  const storedStrava = new Map(
    listStravaRaceActivities().map((activity) => [activity.activityId, activity])
  );
  let added = 0;
  let matched = 0;
  for (const activity of raceActivities) {
    const id = stravaActivityId(activity);
    const startTime = stravaActivityStartTime(activity);
    if (!id || startTime === undefined) continue;
    const buildUp = computeBuildUp(startTime, runs, after);
    // A partial window never replaces a complete one read by an earlier, longer scan.
    const previous = storedStrava.get(id)?.buildUp;
    upsertStravaRaceActivity({
      activityId: id,
      athleteId: strava.athleteId,
      startTime,
      summary: trimStravaSummary(activity),
      buildUp: buildUp.complete || !previous ? buildUp : previous
    });

    const stravaRow = getStoredRace(stravaRaceId(id));
    const corosMatch = findCorosMatch(startTime, history.raceRuns);
    if (corosMatch) {
      matched += 1;
      const raceId = corosRaceId(corosMatch.activityId);
      const corosRow = getStoredRace(raceId);
      // The athlete's "not a race" here outranks the flag on Strava.
      if (corosRow?.status === "dismissed") continue;
      if (corosRow) {
        if (!corosRow.stravaActivityId) saveStoredRace({ ...corosRow, stravaActivityId: id });
        continue;
      }
      saveStoredRace({
        raceId,
        status: stravaRow?.status ?? "race",
        source: "coros",
        corosActivityId: corosMatch.activityId,
        stravaActivityId: id,
        snapshot: snapshotFromActivity(corosMatch),
        eventName: stravaRow?.eventName,
        distanceKey: stravaRow?.distanceKey,
        officialDistance: stravaRow?.officialDistance,
        officialTime: stravaRow?.officialTime,
        placing: stravaRow?.placing,
        notes: stravaRow?.notes
      });
      if (stravaRow) deleteStoredRace(stravaRow.raceId);
      else added += 1;
      continue;
    }
    if (!stravaRow) {
      saveStoredRace({
        raceId: stravaRaceId(id),
        status: "race",
        source: "strava",
        stravaActivityId: id
      });
      added += 1;
    }
  }

  setSetting(SETTINGS.stravaAthlete, strava.athleteId);
  setSetting(SETTINGS.stravaScannedThrough, String(newest));
  setSetting(SETTINGS.stravaImportedAt, new Date().toISOString());
  return {
    scanned,
    found: raceActivities.length,
    incremental: after > 0,
    added,
    matched,
    overview: getRaceOverview()
  };
}

/** Strava access ended: forget its race data now rather than on the next read. */
export function clearStravaRaceData(): void {
  clearStravaRaceActivities();
  deleteSettings(STRAVA_SETTINGS);
}
