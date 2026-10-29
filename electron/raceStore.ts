import { requireDatabase } from "./database";
import { isRaceDistanceKey } from "./raceModel";
import type { RaceBuildUp, RaceDistanceKey, RacePriority, RaceSource, RaceTarget } from "./raceTypes";

// Race tags live in their own tables, created on first use. Strava-derived
// data is kept apart in `strava_race_activities` so a disconnect can drop it
// while the athlete's own notes and chip times stay.

export type RaceStatus = "race" | "dismissed";

/** What the recording said at tagging time; never Strava data. */
export interface RaceActivitySnapshot {
  name?: string;
  sportType?: number;
  /** Epoch seconds. */
  startTime: number;
  distance?: number;
  duration?: number;
  avgHr?: number;
  elevationGain?: number;
}

export interface StoredRace {
  raceId: string;
  status: RaceStatus;
  source: RaceSource;
  corosActivityId?: string;
  stravaActivityId?: string;
  snapshot?: RaceActivitySnapshot;
  eventName?: string;
  distanceKey?: RaceDistanceKey;
  officialDistance?: number;
  officialTime?: number;
  placing?: string;
  notes?: string;
}

export interface StoredStravaRaceActivity {
  activityId: string;
  athleteId: string;
  startTime: number;
  summary: Record<string, unknown>;
  buildUp?: RaceBuildUp;
}

interface RaceRow {
  race_id: string;
  status: string;
  source: string;
  coros_activity_id: string | null;
  strava_activity_id: string | null;
  snapshot_json: string | null;
  event_name: string | null;
  distance_key: string | null;
  official_distance_m: number | null;
  official_time_sec: number | null;
  placing: string | null;
  notes: string | null;
}

let preparedFor: unknown;

function database() {
  const db = requireDatabase();
  if (preparedFor !== db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS race_entries (
        race_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        coros_activity_id TEXT,
        strava_activity_id TEXT,
        snapshot_json TEXT,
        event_name TEXT,
        distance_key TEXT,
        official_distance_m REAL,
        official_time_sec REAL,
        placing TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_race_entries_coros
        ON race_entries(coros_activity_id);
      CREATE INDEX IF NOT EXISTS idx_race_entries_strava
        ON race_entries(strava_activity_id);

      CREATE TABLE IF NOT EXISTS race_targets (
        target_id TEXT PRIMARY KEY,
        event_name TEXT NOT NULL,
        race_day TEXT NOT NULL,
        distance_key TEXT NOT NULL,
        distance_m REAL NOT NULL,
        goal_time_sec REAL,
        priority TEXT,
        location TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS race_routes (
        coros_activity_id TEXT PRIMARY KEY,
        points_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS strava_race_activities (
        activity_id TEXT PRIMARY KEY,
        athlete_id TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        build_up_json TEXT,
        synced_at TEXT NOT NULL
      );
    `);
    preparedFor = db;
  }
  return db;
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function toStoredRace(row: RaceRow): StoredRace {
  return {
    raceId: row.race_id,
    status: row.status === "dismissed" ? "dismissed" : "race",
    source: row.source === "strava" || row.source === "manual" ? row.source : "coros",
    corosActivityId: optional(row.coros_activity_id),
    stravaActivityId: optional(row.strava_activity_id),
    snapshot: parseJson<RaceActivitySnapshot>(row.snapshot_json),
    eventName: optional(row.event_name),
    distanceKey: isRaceDistanceKey(row.distance_key) ? row.distance_key : undefined,
    officialDistance: optional(row.official_distance_m),
    officialTime: optional(row.official_time_sec),
    placing: optional(row.placing),
    notes: optional(row.notes)
  };
}

export function listStoredRaces(): StoredRace[] {
  const rows = database()
    .prepare(
      `SELECT race_id, status, source, coros_activity_id, strava_activity_id,
              snapshot_json, event_name, distance_key, official_distance_m,
              official_time_sec, placing, notes
       FROM race_entries`
    )
    .all() as RaceRow[];
  return rows.map(toStoredRace);
}

export function getStoredRace(raceId: string): StoredRace | undefined {
  const row = database()
    .prepare(
      `SELECT race_id, status, source, coros_activity_id, strava_activity_id,
              snapshot_json, event_name, distance_key, official_distance_m,
              official_time_sec, placing, notes
       FROM race_entries WHERE race_id = ?`
    )
    .get(raceId) as RaceRow | undefined;
  return row ? toStoredRace(row) : undefined;
}

/**
 * Insert or replace a race row whole; callers merge with `getStoredRace` first.
 * `absorbedRaceIds` (rows folded into this one) are deleted in the same transaction.
 */
export function saveStoredRace(race: StoredRace, absorbedRaceIds: readonly string[] = []): void {
  const db = database();
  db.transaction(() => {
    writeStoredRace(race);
    for (const raceId of absorbedRaceIds) {
      if (raceId !== race.raceId) deleteStoredRace(raceId);
    }
  })();
}

function writeStoredRace(race: StoredRace): void {
  const now = new Date().toISOString();
  database()
    .prepare(
      `INSERT INTO race_entries (
         race_id, status, source, coros_activity_id, strava_activity_id,
         snapshot_json, event_name, distance_key, official_distance_m,
         official_time_sec, placing, notes, created_at, updated_at
       )
       VALUES (
         @raceId, @status, @source, @corosActivityId, @stravaActivityId,
         @snapshot, @eventName, @distanceKey, @officialDistance,
         @officialTime, @placing, @notes, @now, @now
       )
       ON CONFLICT(race_id) DO UPDATE SET
         status = excluded.status,
         source = excluded.source,
         coros_activity_id = excluded.coros_activity_id,
         strava_activity_id = excluded.strava_activity_id,
         snapshot_json = excluded.snapshot_json,
         event_name = excluded.event_name,
         distance_key = excluded.distance_key,
         official_distance_m = excluded.official_distance_m,
         official_time_sec = excluded.official_time_sec,
         placing = excluded.placing,
         notes = excluded.notes,
         updated_at = excluded.updated_at`
    )
    .run({
      raceId: race.raceId,
      status: race.status,
      source: race.source,
      corosActivityId: race.corosActivityId ?? null,
      stravaActivityId: race.stravaActivityId ?? null,
      snapshot: race.snapshot ? JSON.stringify(race.snapshot) : null,
      eventName: race.eventName ?? null,
      distanceKey: race.distanceKey ?? null,
      officialDistance: race.officialDistance ?? null,
      officialTime: race.officialTime ?? null,
      placing: race.placing ?? null,
      notes: race.notes ?? null,
      now
    });
}

export function deleteStoredRace(raceId: string): void {
  database().prepare("DELETE FROM race_entries WHERE race_id = ?").run(raceId);
}

export function upsertStravaRaceActivity(activity: StoredStravaRaceActivity): void {
  database()
    .prepare(
      `INSERT INTO strava_race_activities
         (activity_id, athlete_id, start_time, summary_json, build_up_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET
         athlete_id = excluded.athlete_id,
         start_time = excluded.start_time,
         summary_json = excluded.summary_json,
         build_up_json = COALESCE(excluded.build_up_json, strava_race_activities.build_up_json),
         synced_at = excluded.synced_at`
    )
    .run(
      activity.activityId,
      activity.athleteId,
      activity.startTime,
      JSON.stringify(activity.summary),
      activity.buildUp ? JSON.stringify(activity.buildUp) : null,
      new Date().toISOString()
    );
}

export function listStravaRaceActivities(): StoredStravaRaceActivity[] {
  const rows = database()
    .prepare(
      `SELECT activity_id, athlete_id, start_time, summary_json, build_up_json
       FROM strava_race_activities`
    )
    .all() as Array<{
    activity_id: string;
    athlete_id: string;
    start_time: number;
    summary_json: string;
    build_up_json: string | null;
  }>;
  const activities: StoredStravaRaceActivity[] = [];
  for (const row of rows) {
    const summary = parseJson<Record<string, unknown>>(row.summary_json);
    if (!summary) continue;
    activities.push({
      activityId: row.activity_id,
      athleteId: row.athlete_id,
      startTime: row.start_time,
      summary,
      buildUp: parseJson<RaceBuildUp>(row.build_up_json)
    });
  }
  return activities;
}

/**
 * Drop Strava-derived race data, all of it or every athlete but `keepAthleteId`.
 * Race rows stay, so a reconnect restores them with the athlete's edits intact.
 */
export function clearStravaRaceActivities(keepAthleteId?: string): number {
  const db = database();
  const result = keepAthleteId
    ? db.prepare("DELETE FROM strava_race_activities WHERE athlete_id <> ?").run(keepAthleteId)
    : db.prepare("DELETE FROM strava_race_activities").run();
  return result.changes;
}

interface TargetRow {
  target_id: string;
  event_name: string;
  race_day: string;
  distance_key: string;
  distance_m: number;
  goal_time_sec: number | null;
  priority: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
}

function toRaceTarget(row: TargetRow): RaceTarget {
  const priority = row.priority === "A" || row.priority === "B" || row.priority === "C" ? row.priority as RacePriority : undefined;
  return {
    targetId: row.target_id,
    name: row.event_name,
    raceDay: row.race_day,
    distanceKey: isRaceDistanceKey(row.distance_key) ? row.distance_key : "other",
    distance: row.distance_m,
    goalTime: optional(row.goal_time_sec),
    priority,
    location: optional(row.location),
    notes: optional(row.notes),
    createdAt: row.created_at
  };
}

/** Races the athlete is training for, soonest first. */
export function listStoredRaceTargets(): RaceTarget[] {
  const rows = database()
    .prepare(
      `SELECT target_id, event_name, race_day, distance_key, distance_m, goal_time_sec,
              priority, location, notes, created_at
       FROM race_targets ORDER BY race_day, created_at`
    )
    .all() as TargetRow[];
  return rows.map(toRaceTarget);
}

export function saveStoredRaceTarget(target: RaceTarget): void {
  const now = new Date().toISOString();
  database()
    .prepare(
      `INSERT INTO race_targets (
         target_id, event_name, race_day, distance_key, distance_m, goal_time_sec,
         priority, location, notes, created_at, updated_at
       )
       VALUES (
         @targetId, @name, @raceDay, @distanceKey, @distance, @goalTime,
         @priority, @location, @notes, @createdAt, @now
       )
       ON CONFLICT(target_id) DO UPDATE SET
         event_name = excluded.event_name,
         race_day = excluded.race_day,
         distance_key = excluded.distance_key,
         distance_m = excluded.distance_m,
         goal_time_sec = excluded.goal_time_sec,
         priority = excluded.priority,
         location = excluded.location,
         notes = excluded.notes,
         updated_at = excluded.updated_at`
    )
    .run({
      targetId: target.targetId,
      name: target.name,
      raceDay: target.raceDay,
      distanceKey: target.distanceKey,
      distance: target.distance,
      goalTime: target.goalTime ?? null,
      priority: target.priority ?? null,
      location: target.location ?? null,
      notes: target.notes ?? null,
      createdAt: target.createdAt,
      now
    });
}

export function deleteStoredRaceTarget(targetId: string): boolean {
  return database().prepare("DELETE FROM race_targets WHERE target_id = ?").run(targetId).changes > 0;
}

/** A race recording's course, simplified for a phone; [] when COROS has no GPS for it. */
export function getStoredRaceRoute(corosActivityId: string): [number, number][] | undefined {
  const row = database()
    .prepare("SELECT points_json FROM race_routes WHERE coros_activity_id = ?")
    .get(corosActivityId) as { points_json: string } | undefined;
  return row ? parseJson<[number, number][]>(row.points_json) : undefined;
}

export function saveStoredRaceRoute(corosActivityId: string, points: [number, number][]): void {
  database()
    .prepare(
      `INSERT INTO race_routes (coros_activity_id, points_json, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(coros_activity_id) DO UPDATE SET points_json = excluded.points_json, fetched_at = excluded.fetched_at`
    )
    .run(corosActivityId, JSON.stringify(points), new Date().toISOString());
}
