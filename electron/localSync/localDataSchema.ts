import type Database from "better-sqlite3";

/**
 * Tables for data that never came from a cloud API: activities read from the
 * watch or imported from files, raw sync payloads, sync bookkeeping and
 * health measurements. Idempotent; runs on every launch.
 *
 * Provenance is explicit on every row ("watch" for Bluetooth reads, "file"
 * for user imports, "cloud-export" for FIT files that were once downloaded
 * from COROS) so a backup or a later merge never passes cloud-derived data
 * off as freshly read from the watch.
 */
export function createLocalDataTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS local_devices (
      device_id TEXT PRIMARY KEY,
      name TEXT,
      model TEXT,
      firmware TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_activity_files (
      activity_id TEXT PRIMARY KEY,
      device_id TEXT,
      watch_activity_id TEXT,
      source TEXT NOT NULL CHECK (source IN ('watch-ble', 'fit-import', 'restore')),
      provenance TEXT NOT NULL CHECK (provenance IN ('watch', 'file', 'cloud-export')),
      file_path TEXT NOT NULL,
      payload_id INTEGER,
      format TEXT NOT NULL CHECK (format IN ('fit', 'coros-record')),
      sha256 TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      verification TEXT NOT NULL CHECK (verification IN ('verified', 'undecoded', 'invalid')),
      sport_type INTEGER NOT NULL,
      sport_name TEXT,
      name TEXT,
      start_time INTEGER,
      end_time INTEGER,
      duration REAL,
      moving_time REAL,
      distance REAL,
      avg_hr INTEGER,
      max_hr INTEGER,
      calories INTEGER,
      elevation_gain REAL,
      original_name TEXT,
      imported_at TEXT NOT NULL,
      UNIQUE (device_id, watch_activity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_local_activity_files_start
      ON local_activity_files(start_time DESC);

    CREATE TABLE IF NOT EXISTS local_sync_payloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      file_index INTEGER NOT NULL,
      selector INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      decoder TEXT,
      decoded_records INTEGER,
      decode_error TEXT,
      UNIQUE (device_id, file_index, sha256)
    );

    CREATE TABLE IF NOT EXISTS local_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('activities', 'health-totals')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      state TEXT NOT NULL CHECK (state IN ('running', 'done', 'failed', 'cancelled', 'interrupted')),
      received_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER,
      new_records INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_sync_runs_started
      ON local_sync_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS local_sync_checkpoints (
      device_id TEXT NOT NULL,
      file_index INTEGER NOT NULL,
      selector INTEGER NOT NULL,
      partial_path TEXT,
      offset_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER,
      last_payload_sha256 TEXT,
      last_complete_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (device_id, file_index, selector)
    );

    CREATE TABLE IF NOT EXISTS local_health_samples (
      device_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      ts INTEGER NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      validity TEXT NOT NULL DEFAULT 'valid' CHECK (validity IN ('valid', 'partial', 'invalid')),
      source TEXT NOT NULL,
      provenance TEXT NOT NULL CHECK (provenance IN ('watch', 'file', 'cloud-export')),
      utc_offset_minutes INTEGER,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (device_id, metric, ts, source)
    );

    CREATE INDEX IF NOT EXISTS idx_local_health_samples_metric_ts
      ON local_health_samples(metric, ts DESC);

    CREATE TABLE IF NOT EXISTS local_sleep_sessions (
      device_id TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      day TEXT NOT NULL,
      utc_offset_minutes INTEGER NOT NULL,
      total_minutes INTEGER NOT NULL,
      awake_minutes INTEGER NOT NULL,
      light_minutes INTEGER NOT NULL,
      deep_minutes INTEGER NOT NULL,
      rem_minutes INTEGER NOT NULL,
      awake_count INTEGER NOT NULL,
      min_hr INTEGER,
      avg_hr INTEGER,
      max_hr INTEGER,
      ranges TEXT NOT NULL,
      source TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (device_id, start_ts)
    );

    CREATE INDEX IF NOT EXISTS idx_local_sleep_sessions_day
      ON local_sleep_sessions(day DESC);

    -- Local-Only Mode's workout library and training calendar (COROS program JSON; see localTrainingBackend.ts).
    CREATE TABLE IF NOT EXISTS local_training_programs (
      id TEXT PRIMARY KEY,
      program TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_training_schedule (
      id_in_plan INTEGER PRIMARY KEY,
      happen_day TEXT NOT NULL,
      sort_no INTEGER NOT NULL DEFAULT 1,
      program TEXT NOT NULL,
      exercise_bar_chart TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_training_schedule_day
      ON local_training_schedule(happen_day);

    CREATE TABLE IF NOT EXISTS local_health_checks (
      device_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      utc_offset_minutes INTEGER,
      heart_rate INTEGER NOT NULL,
      hrv_ms INTEGER NOT NULL,
      breathing_rate INTEGER NOT NULL,
      spo2 INTEGER NOT NULL,
      stress INTEGER NOT NULL,
      stress_level INTEGER NOT NULL,
      source TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (device_id, ts)
    );

    CREATE TABLE IF NOT EXISTS local_workout_recovery (
      device_id TEXT NOT NULL,
      workout_start_ts INTEGER NOT NULL,
      workout_end_ts INTEGER NOT NULL,
      samples TEXT NOT NULL,
      source TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (device_id, workout_start_ts)
    );

    -- Derived from each activity's FIT file and refreshed when the file changes (sha256); not backed up.
    CREATE TABLE IF NOT EXISTS local_activity_training (
      activity_id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      training_load REAL,
      -- The watch's own figures stored with the activity (VO₂ max, recovery time, Base Fitness, …), JSON.
      watch_figures TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_health_summaries (
      day TEXT NOT NULL,
      metric TEXT NOT NULL,
      device_id TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      method TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      PRIMARY KEY (day, metric, device_id)
    );
  `);

  // A run still "running" at launch was cut off by a crash or quit.
  database.prepare(
    "UPDATE local_sync_runs SET state = 'interrupted', finished_at = COALESCE(finished_at, ?) WHERE state = 'running'"
  ).run(new Date().toISOString());
}
