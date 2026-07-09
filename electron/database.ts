import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { enrichActivitiesWithSportNames } from "./corosSportTypes";
import { musicFileNamesMatch } from "./musicFileNames";
import Database from "better-sqlite3";
import type {
  CachedCorosMapPackage,
  GeneratedRoute,
  LocalTrack,
  SpotifySyncTrack,
  SpotifySyncTrackStatus,
  TrainingHubActivity,
  YouTubeHistoryEntry,
  YouTubeHistoryEntryType
} from "./types";

interface DownloadRow {
  id: string;
  url: string;
  title: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
  transferred_at: string | null;
}

interface SettingRow {
  key: string;
  value: string;
}

interface SpotifySyncTrackRow {
  playlist_id: string;
  spotify_track_id: string;
  artist_name: string;
  track_name: string;
  query: string;
  filename: string;
  status: SpotifySyncTrackStatus;
  local_download_id: string | null;
  file_path: string | null;
  error: string | null;
  updated_at: string;
}

interface YouTubeHistoryRow {
  url: string;
  title: string;
  entry_type: YouTubeHistoryEntryType;
  visits: number;
  last_visited_at: string;
  downloaded_at: string | null;
}

interface GeneratedRouteRow {
  id: string;
  name: string;
  created_at: string;
  start_location: string;
  destination_location: string | null;
  distance_meters: number;
  duration_seconds: number | null;
  ascent_meters: number | null;
  descent_meters: number | null;
  mode: GeneratedRoute["mode"];
  activity_type: string | null;
  surface_preference: GeneratedRoute["surfacePreference"];
  avoid_highways: number;
  elevation_preference: GeneratedRoute["elevationPreference"];
  points_json: string;
  bounds_json: string | null;
  gpx_path: string | null;
}

interface TrainingActivityRow {
  activity_id: string;
  name: string | null;
  sport_type: number;
  sport_name: string | null;
  start_time: number | null;
  end_time: number | null;
  duration: number | null;
  distance: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  training_load: number | null;
  elevation_gain: number | null;
}

interface CachedCorosMapRow {
  package_id: string;
  title: string;
  region: string;
  parent: string;
  type: CachedCorosMapPackage["type"];
  size_bytes: number;
  download_url: string;
  file_path: string;
  extracted_path: string | null;
  downloaded_at: string;
}

let db: Database.Database | undefined;

function migrateLegacyDatabase(userDataPath: string, dbPath: string): void {
  if (fs.existsSync(dbPath)) {
    return;
  }

  const legacyPath = path.join(userDataPath, "coros-desktop.sqlite");
  if (!fs.existsSync(legacyPath)) {
    return;
  }

  fs.renameSync(legacyPath, dbPath);

  for (const suffix of ["-wal", "-shm"]) {
    const legacySidecar = `${legacyPath}${suffix}`;
    const nextSidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(legacySidecar)) {
      fs.renameSync(legacySidecar, nextSidecar);
    }
  }
}

export function initializeDatabase(userDataPath: string): Database.Database {
  if (db) {
    return db;
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, "coroslink.sqlite");
  migrateLegacyDatabase(userDataPath, dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      transferred_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spotify_sync_tracks (
      playlist_id TEXT NOT NULL,
      spotify_track_id TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      track_name TEXT NOT NULL,
      query TEXT NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL,
      local_download_id TEXT,
      file_path TEXT,
      error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (playlist_id, spotify_track_id)
    );

    CREATE TABLE IF NOT EXISTS youtube_history (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      last_visited_at TEXT NOT NULL,
      downloaded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS generated_routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      start_location TEXT NOT NULL,
      destination_location TEXT,
      distance_meters INTEGER NOT NULL,
      duration_seconds REAL,
      ascent_meters REAL,
      descent_meters REAL,
      mode TEXT NOT NULL,
      surface_preference TEXT NOT NULL,
      avoid_highways INTEGER NOT NULL,
      elevation_preference TEXT NOT NULL,
      points_json TEXT NOT NULL,
      bounds_json TEXT,
      gpx_path TEXT,
      activity_type TEXT
    );

    CREATE TABLE IF NOT EXISTS training_activities (
      activity_id TEXT PRIMARY KEY,
      name TEXT,
      sport_type INTEGER NOT NULL,
      sport_name TEXT,
      start_time INTEGER,
      end_time INTEGER,
      duration INTEGER,
      distance REAL,
      avg_hr INTEGER,
      max_hr INTEGER,
      calories INTEGER,
      training_load REAL,
      elevation_gain REAL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_coros_maps (
      package_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      region TEXT NOT NULL,
      parent TEXT NOT NULL,
      type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      download_url TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      extracted_path TEXT,
      downloaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK(provider IN ('chatgpt', 'local')),
      title TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_provider_updated
      ON chat_sessions(provider, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_plan_drafts (
      draft_id TEXT PRIMARY KEY,
      plan_json TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      uploaded_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_chat_plan_drafts_created
      ON chat_plan_drafts(created_at DESC);
  `);

  ensureColumn(db, "generated_routes", "activity_type", "TEXT");
  migrateChatTranscriptsToSessions(db);

  return db;
}

function tableExists(database: Database.Database, table: string): boolean {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function deriveSessionTitle(messagesJson: string): string {
  try {
    const parsed = JSON.parse(messagesJson) as unknown;
    if (!Array.isArray(parsed)) {
      return "New chat";
    }
    for (const entry of parsed) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as { role?: string }).role === "user" &&
        typeof (entry as { content?: string }).content === "string"
      ) {
        const content = (entry as { content: string }).content.trim();
        if (content) {
          return content.length > 48 ? `${content.slice(0, 48)}…` : content;
        }
      }
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as { kind?: string }).kind === "message" &&
        (entry as { role?: string }).role === "user" &&
        typeof (entry as { content?: string }).content === "string"
      ) {
        const content = (entry as { content: string }).content.trim();
        if (content) {
          return content.length > 48 ? `${content.slice(0, 48)}…` : content;
        }
      }
    }
  } catch {
    // fall through
  }
  return "New chat";
}

function migrateChatTranscriptsToSessions(database: Database.Database): void {
  if (!tableExists(database, "chat_transcripts")) {
    return;
  }

  const rows = database
    .prepare(
      "SELECT provider, messages_json, updated_at FROM chat_transcripts"
    )
    .all() as Array<{
    provider: string;
    messages_json: string;
    updated_at: string;
  }>;

  if (rows.length > 0) {
    const insert = database.prepare(
      `INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const transaction = database.transaction(
      (legacyRows: typeof rows) => {
        for (const row of legacyRows) {
          insert.run(
            crypto.randomUUID(),
            row.provider,
            deriveSessionTitle(row.messages_json),
            row.messages_json,
            row.updated_at,
            row.updated_at
          );
        }
      }
    );
    transaction(rows);
  }

  database.exec("DROP TABLE chat_transcripts");
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) {
    return;
  }
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function requireDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database has not been initialized.");
  }

  return db;
}

function toLocalTrack(row: DownloadRow): LocalTrack {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    transferredAt: row.transferred_at ?? undefined
  };
}

export function listDownloads(): LocalTrack[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
       FROM downloads
       ORDER BY created_at DESC`
    )
    .all() as DownloadRow[];

  return rows.map(toLocalTrack);
}

export function getDownloadById(id: string): LocalTrack | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
       FROM downloads
       WHERE id = ?`
    )
    .get(id) as DownloadRow | undefined;

  return row ? toLocalTrack(row) : undefined;
}

export function addDownloads(filePaths: string[], url: string): LocalTrack[] {
  const database = requireDatabase();
  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO downloads
      (id, url, title, file_path, size_bytes, created_at)
    VALUES
      (@id, @url, @title, @filePath, @sizeBytes, @createdAt)
  `);

  const transaction = database.transaction((paths: string[]) => {
    for (const filePath of paths) {
      const stats = fs.statSync(filePath);
      insert.run({
        id: crypto.randomUUID(),
        url,
        title: path.basename(filePath, path.extname(filePath)),
        filePath,
        sizeBytes: stats.size,
        createdAt: now
      });
    }
  });

  transaction(filePaths);

  const select = database.prepare(
    `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
     FROM downloads
     WHERE file_path = ?`
  );

  return filePaths
    .map((filePath) => select.get(filePath) as DownloadRow | undefined)
    .filter((row): row is DownloadRow => Boolean(row))
    .map(toLocalTrack);
}

export function markDownloadTransferred(id: string): void {
  requireDatabase()
    .prepare("UPDATE downloads SET transferred_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function clearDownloadTransferredByFileName(fileName: string): void {
  if (!fileName) {
    return;
  }

  const database = requireDatabase();
  const rows = database
    .prepare(
      `SELECT id, file_path
       FROM downloads
       WHERE transferred_at IS NOT NULL`,
    )
    .all() as Array<{ id: string; file_path: string }>;

  const clear = database.prepare(
    "UPDATE downloads SET transferred_at = NULL WHERE id = ?",
  );

  for (const row of rows) {
    if (musicFileNamesMatch(row.file_path, fileName)) {
      clear.run(row.id);
    }
  }
}

export function deleteDownload(id: string, removeFile: boolean): void {
  const existing = getDownloadById(id);
  if (!existing) {
    return;
  }

  if (removeFile && fs.existsSync(existing.filePath)) {
    fs.rmSync(existing.filePath, { force: true });
  }

  requireDatabase().prepare("DELETE FROM downloads WHERE id = ?").run(id);
}

export function getSetting(key: string): string | undefined {
  const row = requireDatabase()
    .prepare("SELECT key, value FROM app_settings WHERE key = ?")
    .get(key) as SettingRow | undefined;

  return row?.value;
}

export function setSetting(key: string, value: string): void {
  requireDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function deleteSettings(keys: string[]): void {
  const database = requireDatabase();
  const remove = database.prepare("DELETE FROM app_settings WHERE key = ?");
  const transaction = database.transaction((settingKeys: string[]) => {
    for (const key of settingKeys) {
      remove.run(key);
    }
  });

  transaction(keys);
}

export interface ChatSessionRow {
  id: string;
  provider: string;
  title: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
}

export function listChatSessionRows(provider: string): ChatSessionRow[] {
  return requireDatabase()
    .prepare(
      `SELECT id, provider, title, messages_json, created_at, updated_at
       FROM chat_sessions
       WHERE provider = ?
       ORDER BY updated_at DESC`
    )
    .all(provider) as ChatSessionRow[];
}

export function getChatSessionRow(id: string): ChatSessionRow | undefined {
  return requireDatabase()
    .prepare(
      `SELECT id, provider, title, messages_json, created_at, updated_at
       FROM chat_sessions
       WHERE id = ?`
    )
    .get(id) as ChatSessionRow | undefined;
}

export function insertChatSessionRow(
  id: string,
  provider: string,
  title: string,
  messagesJson: string,
  createdAt: string,
  updatedAt: string
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, provider, title, messagesJson, createdAt, updatedAt);
}

export function updateChatSessionRow(
  id: string,
  title: string,
  messagesJson: string,
  updatedAt: string
): void {
  requireDatabase()
    .prepare(
      `UPDATE chat_sessions
       SET title = ?, messages_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(title, messagesJson, updatedAt, id);
}

export function deleteChatSessionRow(id: string): void {
  requireDatabase()
    .prepare("DELETE FROM chat_sessions WHERE id = ?")
    .run(id);
}

function toSpotifySyncTrack(row: SpotifySyncTrackRow): SpotifySyncTrack {
  return {
    playlistId: row.playlist_id,
    spotifyTrackId: row.spotify_track_id,
    artistName: row.artist_name,
    trackName: row.track_name,
    query: row.query,
    filename: row.filename,
    status: row.status,
    localDownloadId: row.local_download_id ?? undefined,
    filePath: row.file_path ?? undefined,
    error: row.error ?? undefined,
    updatedAt: row.updated_at
  };
}

export function listSpotifySyncTracks(playlistId: string): SpotifySyncTrack[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT playlist_id, spotify_track_id, artist_name, track_name, query,
              filename, status, local_download_id, file_path, error, updated_at
       FROM spotify_sync_tracks
       WHERE playlist_id = ?
       ORDER BY artist_name, track_name`
    )
    .all(playlistId) as SpotifySyncTrackRow[];

  return rows.map(toSpotifySyncTrack);
}

export function getSpotifySyncTrack(
  playlistId: string,
  spotifyTrackId: string
): SpotifySyncTrack | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT playlist_id, spotify_track_id, artist_name, track_name, query,
              filename, status, local_download_id, file_path, error, updated_at
       FROM spotify_sync_tracks
       WHERE playlist_id = ? AND spotify_track_id = ?`
    )
    .get(playlistId, spotifyTrackId) as SpotifySyncTrackRow | undefined;

  return row ? toSpotifySyncTrack(row) : undefined;
}

export function upsertSpotifySyncTrack(
  track: Omit<SpotifySyncTrack, "updatedAt"> & { updatedAt?: string }
): SpotifySyncTrack {
  const updatedAt = track.updatedAt ?? new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO spotify_sync_tracks (
         playlist_id, spotify_track_id, artist_name, track_name, query,
         filename, status, local_download_id, file_path, error, updated_at
       )
       VALUES (
         @playlistId, @spotifyTrackId, @artistName, @trackName, @query,
         @filename, @status, @localDownloadId, @filePath, @error, @updatedAt
       )
       ON CONFLICT(playlist_id, spotify_track_id) DO UPDATE SET
         artist_name = excluded.artist_name,
         track_name = excluded.track_name,
         query = excluded.query,
         filename = excluded.filename,
         status = excluded.status,
         local_download_id = excluded.local_download_id,
         file_path = excluded.file_path,
         error = excluded.error,
         updated_at = excluded.updated_at`
    )
    .run({
      playlistId: track.playlistId,
      spotifyTrackId: track.spotifyTrackId,
      artistName: track.artistName,
      trackName: track.trackName,
      query: track.query,
      filename: track.filename,
      status: track.status,
      localDownloadId: track.localDownloadId ?? null,
      filePath: track.filePath ?? null,
      error: track.error ?? null,
      updatedAt
    });

  return {
    ...track,
    updatedAt
  };
}

function toYouTubeHistoryEntry(row: YouTubeHistoryRow): YouTubeHistoryEntry {
  return {
    url: row.url,
    title: row.title,
    entryType: row.entry_type,
    visits: row.visits,
    lastVisitedAt: row.last_visited_at,
    downloadedAt: row.downloaded_at ?? undefined
  };
}

export function listYouTubeHistory(limit = 50): YouTubeHistoryEntry[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT url, title, entry_type, visits, last_visited_at, downloaded_at
       FROM youtube_history
       ORDER BY COALESCE(downloaded_at, last_visited_at) DESC
       LIMIT ?`
    )
    .all(limit) as YouTubeHistoryRow[];

  return rows.map(toYouTubeHistoryEntry);
}

export function recordYouTubeVisit(entry: {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
}): YouTubeHistoryEntry {
  const now = new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO youtube_history
        (url, title, entry_type, visits, last_visited_at)
       VALUES
        (@url, @title, @entryType, 1, @now)
       ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN excluded.title != '' THEN excluded.title
          ELSE youtube_history.title
        END,
        entry_type = excluded.entry_type,
        visits = youtube_history.visits + 1,
        last_visited_at = excluded.last_visited_at`
    )
    .run({
      url: entry.url,
      title: entry.title,
      entryType: entry.entryType,
      now
    });

  return getYouTubeHistoryEntry(entry.url);
}

export function markYouTubeDownloaded(entry: {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
}): YouTubeHistoryEntry {
  const now = new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO youtube_history
        (url, title, entry_type, visits, last_visited_at, downloaded_at)
       VALUES
        (@url, @title, @entryType, 1, @now, @now)
       ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN excluded.title != '' THEN excluded.title
          ELSE youtube_history.title
        END,
        entry_type = excluded.entry_type,
        downloaded_at = excluded.downloaded_at,
        last_visited_at = excluded.last_visited_at`
    )
    .run({
      url: entry.url,
      title: entry.title,
      entryType: entry.entryType,
      now
    });

  return getYouTubeHistoryEntry(entry.url);
}

function getYouTubeHistoryEntry(url: string): YouTubeHistoryEntry {
  const row = requireDatabase()
    .prepare(
      `SELECT url, title, entry_type, visits, last_visited_at, downloaded_at
       FROM youtube_history
       WHERE url = ?`
    )
    .get(url) as YouTubeHistoryRow | undefined;

  if (!row) {
    throw new Error("YouTube history entry was not found.");
  }

  return toYouTubeHistoryEntry(row);
}

function toGeneratedRoute(row: GeneratedRouteRow): GeneratedRoute {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    startLocation: row.start_location,
    destinationLocation: row.destination_location ?? undefined,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds ?? undefined,
    ascentMeters: row.ascent_meters ?? undefined,
    descentMeters: row.descent_meters ?? undefined,
    mode: row.mode,
    activityType:
      (row.activity_type as GeneratedRoute["activityType"] | null) ??
      (row.surface_preference === "trail" ? "hiking" : "walking"),
    surfacePreference: row.surface_preference,
    avoidHighways: Boolean(row.avoid_highways),
    elevationPreference: row.elevation_preference,
    points: JSON.parse(row.points_json) as GeneratedRoute["points"],
    bounds: row.bounds_json
      ? (JSON.parse(row.bounds_json) as GeneratedRoute["bounds"])
      : undefined,
    gpxPath: row.gpx_path ?? undefined
  };
}

export function listGeneratedRoutes(limit = 20): GeneratedRoute[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT id, name, created_at, start_location, destination_location,
              distance_meters, duration_seconds, ascent_meters, descent_meters,
              mode, activity_type, surface_preference, avoid_highways,
              elevation_preference, points_json, bounds_json, gpx_path
       FROM generated_routes
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as GeneratedRouteRow[];

  return rows.map(toGeneratedRoute);
}

export function getGeneratedRoute(id: string): GeneratedRoute | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT id, name, created_at, start_location, destination_location,
              distance_meters, duration_seconds, ascent_meters, descent_meters,
              mode, activity_type, surface_preference, avoid_highways,
              elevation_preference, points_json, bounds_json, gpx_path
       FROM generated_routes
       WHERE id = ?`
    )
    .get(id) as GeneratedRouteRow | undefined;

  return row ? toGeneratedRoute(row) : undefined;
}

export function addGeneratedRoute(route: GeneratedRoute): GeneratedRoute {
  requireDatabase()
    .prepare(
      `INSERT INTO generated_routes (
         id, name, created_at, start_location, destination_location,
         distance_meters, duration_seconds, ascent_meters, descent_meters,
         mode, activity_type, surface_preference, avoid_highways,
         elevation_preference, points_json, bounds_json, gpx_path
       )
       VALUES (
         @id, @name, @createdAt, @startLocation, @destinationLocation,
         @distanceMeters, @durationSeconds, @ascentMeters, @descentMeters,
         @mode, @activityType, @surfacePreference, @avoidHighways,
         @elevationPreference, @pointsJson, @boundsJson, @gpxPath
       )`
    )
    .run({
      id: route.id,
      name: route.name,
      createdAt: route.createdAt,
      startLocation: route.startLocation,
      destinationLocation: route.destinationLocation ?? null,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds ?? null,
      ascentMeters: route.ascentMeters ?? null,
      descentMeters: route.descentMeters ?? null,
      mode: route.mode,
      activityType: route.activityType,
      surfacePreference: route.surfacePreference,
      avoidHighways: route.avoidHighways ? 1 : 0,
      elevationPreference: route.elevationPreference,
      pointsJson: JSON.stringify(route.points),
      boundsJson: route.bounds ? JSON.stringify(route.bounds) : null,
      gpxPath: route.gpxPath ?? null
    });

  return route;
}

export function deleteGeneratedRoute(id: string): boolean {
  const result = requireDatabase()
    .prepare(`DELETE FROM generated_routes WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

function toTrainingActivity(row: TrainingActivityRow): TrainingHubActivity {
  return {
    activityId: row.activity_id,
    name: row.name ?? undefined,
    sportType: row.sport_type,
    sportName: row.sport_name ?? undefined,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    duration: row.duration ?? undefined,
    distance: row.distance ?? undefined,
    avgHr: row.avg_hr ?? undefined,
    maxHr: row.max_hr ?? undefined,
    calories: row.calories ?? undefined,
    trainingLoad: row.training_load ?? undefined,
    elevationGain: row.elevation_gain ?? undefined
  };
}

export function upsertTrainingActivities(
  activities: TrainingHubActivity[]
): void {
  if (activities.length === 0) {
    return;
  }
  const database = requireDatabase();
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO training_activities (
       activity_id, name, sport_type, sport_name, start_time, end_time,
       duration, distance, avg_hr, max_hr, calories, training_load,
       elevation_gain, synced_at
     )
     VALUES (
       @activityId, @name, @sportType, @sportName, @startTime, @endTime,
       @duration, @distance, @avgHr, @maxHr, @calories, @trainingLoad,
       @elevationGain, @syncedAt
     )
     ON CONFLICT(activity_id) DO UPDATE SET
       name = excluded.name,
       sport_type = excluded.sport_type,
       sport_name = COALESCE(excluded.sport_name, training_activities.sport_name),
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       duration = excluded.duration,
       distance = excluded.distance,
       avg_hr = excluded.avg_hr,
       max_hr = excluded.max_hr,
       calories = excluded.calories,
       training_load = excluded.training_load,
       elevation_gain = excluded.elevation_gain,
       synced_at = excluded.synced_at`
  );

  const writeAll = database.transaction((rows: TrainingHubActivity[]) => {
    for (const activity of rows) {
      if (!activity.activityId) {
        continue;
      }
      insert.run({
        activityId: activity.activityId,
        name: activity.name ?? null,
        sportType: activity.sportType,
        sportName: activity.sportName ?? null,
        startTime: activity.startTime ?? null,
        endTime: activity.endTime ?? null,
        duration: activity.duration ?? null,
        distance: activity.distance ?? null,
        avgHr: activity.avgHr ?? null,
        maxHr: activity.maxHr ?? null,
        calories: activity.calories ?? null,
        trainingLoad: activity.trainingLoad ?? null,
        elevationGain: activity.elevationGain ?? null,
        syncedAt: now
      });
    }
  });

  writeAll(activities);
}

export function listStoredTrainingActivities(limit = 500): TrainingHubActivity[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT activity_id, name, sport_type, sport_name, start_time, end_time,
              duration, distance, avg_hr, max_hr, calories, training_load,
              elevation_gain
       FROM training_activities
       ORDER BY start_time DESC
       LIMIT ?`
    )
    .all(limit) as TrainingActivityRow[];

  return enrichActivitiesWithSportNames(rows.map(toTrainingActivity));
}

function toCachedCorosMap(row: CachedCorosMapRow): CachedCorosMapPackage {
  return {
    packageId: row.package_id,
    title: row.title,
    region: row.region,
    parent: row.parent,
    type: row.type,
    sizeBytes: row.size_bytes,
    downloadUrl: row.download_url,
    filePath: row.file_path,
    extractedPath: row.extracted_path ?? undefined,
    downloadedAt: row.downloaded_at
  };
}

export function listCachedCorosMaps(): CachedCorosMapPackage[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT package_id, title, region, parent, type, size_bytes,
              download_url, file_path, extracted_path, downloaded_at
       FROM cached_coros_maps
       ORDER BY downloaded_at DESC`
    )
    .all() as CachedCorosMapRow[];

  return rows.map(toCachedCorosMap);
}

export function getCachedCorosMap(
  packageId: string
): CachedCorosMapPackage | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT package_id, title, region, parent, type, size_bytes,
              download_url, file_path, extracted_path, downloaded_at
       FROM cached_coros_maps
       WHERE package_id = ?`
    )
    .get(packageId) as CachedCorosMapRow | undefined;

  return row ? toCachedCorosMap(row) : undefined;
}

export function upsertCachedCorosMap(
  cached: CachedCorosMapPackage
): CachedCorosMapPackage {
  requireDatabase()
    .prepare(
      `INSERT INTO cached_coros_maps (
         package_id, title, region, parent, type, size_bytes, download_url,
         file_path, extracted_path, downloaded_at
       )
       VALUES (
         @packageId, @title, @region, @parent, @type, @sizeBytes,
         @downloadUrl, @filePath, @extractedPath, @downloadedAt
       )
       ON CONFLICT(package_id) DO UPDATE SET
         title = excluded.title,
         region = excluded.region,
         parent = excluded.parent,
         type = excluded.type,
         size_bytes = excluded.size_bytes,
         download_url = excluded.download_url,
         file_path = excluded.file_path,
         extracted_path = excluded.extracted_path,
         downloaded_at = excluded.downloaded_at`
    )
    .run({
      packageId: cached.packageId,
      title: cached.title,
      region: cached.region,
      parent: cached.parent,
      type: cached.type,
      sizeBytes: cached.sizeBytes,
      downloadUrl: cached.downloadUrl,
      filePath: cached.filePath,
      extractedPath: cached.extractedPath ?? null,
      downloadedAt: cached.downloadedAt
    });

  return cached;
}

export function updateCachedCorosMapExtractedPath(
  packageId: string,
  extractedPath: string
): CachedCorosMapPackage {
  requireDatabase()
    .prepare(
      `UPDATE cached_coros_maps
       SET extracted_path = ?
       WHERE package_id = ?`
    )
    .run(extractedPath, packageId);

  const cached = getCachedCorosMap(packageId);
  if (!cached) {
    throw new Error("Cached COROS map package was not found.");
  }

  return cached;
}

export function deleteCachedCorosMapRecord(packageId: string): void {
  requireDatabase()
    .prepare("DELETE FROM cached_coros_maps WHERE package_id = ?")
    .run(packageId);
}

interface ChatPlanDraftRow {
  draft_id: string;
  plan_json: string;
  preview_json: string;
  created_at: number;
  uploaded_at: number | null;
}

export interface StoredChatPlanDraftRecord {
  draftId: string;
  planJson: string;
  previewJson: string;
  createdAt: number;
  uploadedAt?: number;
}

export function saveChatPlanDraft(record: StoredChatPlanDraftRecord): void {
  requireDatabase()
    .prepare(
      `INSERT INTO chat_plan_drafts (draft_id, plan_json, preview_json, created_at, uploaded_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(draft_id) DO UPDATE SET
         plan_json = excluded.plan_json,
         preview_json = excluded.preview_json,
         created_at = excluded.created_at,
         uploaded_at = excluded.uploaded_at`
    )
    .run(
      record.draftId,
      record.planJson,
      record.previewJson,
      record.createdAt,
      record.uploadedAt ?? null
    );
}

export function getChatPlanDraft(
  draftId: string
): StoredChatPlanDraftRecord | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT draft_id, plan_json, preview_json, created_at, uploaded_at
       FROM chat_plan_drafts
       WHERE draft_id = ?`
    )
    .get(draftId) as ChatPlanDraftRow | undefined;

  if (!row) {
    return undefined;
  }

  return {
    draftId: row.draft_id,
    planJson: row.plan_json,
    previewJson: row.preview_json,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at ?? undefined
  };
}

export function listChatPlanDrafts(): StoredChatPlanDraftRecord[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT draft_id, plan_json, preview_json, created_at, uploaded_at
       FROM chat_plan_drafts
       ORDER BY created_at DESC`
    )
    .all() as ChatPlanDraftRow[];

  return rows.map((row) => ({
    draftId: row.draft_id,
    planJson: row.plan_json,
    previewJson: row.preview_json,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at ?? undefined
  }));
}

export function markChatPlanDraftUploaded(
  draftId: string,
  uploadedAt: number
): void {
  requireDatabase()
    .prepare(
      `UPDATE chat_plan_drafts
       SET uploaded_at = ?
       WHERE draft_id = ?`
    )
    .run(uploadedAt, draftId);
}

export function pruneChatPlanDrafts(cutoffMs: number): number {
  const result = requireDatabase()
    .prepare("DELETE FROM chat_plan_drafts WHERE created_at < ? AND uploaded_at IS NULL")
    .run(cutoffMs);
  return result.changes;
}

export function deleteChatPlanDraft(draftId: string): void {
  requireDatabase()
    .prepare("DELETE FROM chat_plan_drafts WHERE draft_id = ?")
    .run(draftId);
}
