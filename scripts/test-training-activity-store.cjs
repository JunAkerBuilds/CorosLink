const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Run with Electron's Node runtime (ELECTRON_RUN_AS_NODE=1) to match the
// installed better-sqlite3 ABI. Uses a real SQLite file in a temp folder.
const Database = require("better-sqlite3");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-activity-store-"));
try {
  // A database from before moving_time existed, with one cached run.
  const legacy = new Database(path.join(root, "coroslink.sqlite"));
  legacy.exec(`
    CREATE TABLE training_activities (
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
    INSERT INTO training_activities (activity_id, sport_type, start_time, duration, distance, synced_at)
    VALUES ('legacy-run', 100, 1759400000, 3110, 7007.61, '2026-10-02T12:00:00.000Z');
  `);
  legacy.close();

  const {
    countTrainingActivitiesMissingFeelType,
    initializeDatabase,
    listStoredTrainingActivities,
    listTrainingActivitiesMissingFeelType,
    listTrainingActivitiesMissingNote,
    setTrainingActivityFeelType,
    setTrainingActivityNote,
    upsertTrainingActivities
  } = require("../dist-electron/database.js");
  const db = initializeDatabase(root);

  const columns = db.prepare("PRAGMA table_info(training_activities)").all();
  const movingColumn = columns.find((column) => column.name === "moving_time");
  assert.ok(movingColumn, "migration adds moving_time");
  assert.equal(movingColumn.notnull, 0, "moving_time is nullable");

  // Rows cached before the migration read back without moving time.
  let stored = listStoredTrainingActivities();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].duration, 3110);
  assert.equal(stored[0].movingTime, undefined);

  // The next sync fills it in; elapsed duration is untouched.
  upsertTrainingActivities([
    {
      activityId: "legacy-run",
      sportType: 100,
      startTime: 1759400000,
      duration: 3110,
      movingTime: 2499,
      distance: 7007.61
    },
    { activityId: "no-moving", sportType: 900, startTime: 1759300000, duration: 1200 }
  ]);
  stored = listStoredTrainingActivities();
  const run = stored.find((activity) => activity.activityId === "legacy-run");
  assert.equal(run.duration, 3110);
  assert.equal(run.movingTime, 2499);
  assert.equal(
    stored.find((activity) => activity.activityId === "no-moving").movingTime,
    undefined
  );

  // Notes came after feelings: an activity with its feeling cached is not
  // refetched by the feeling backfill; only the slow note backfill asks for it.
  setTrainingActivityFeelType("legacy-run", 3);
  assert.deepEqual(listTrainingActivitiesMissingFeelType(0, 10).map((row) => row.activityId), ["no-moving"]);
  assert.equal(countTrainingActivitiesMissingFeelType(0), 1);
  assert.deepEqual(listTrainingActivitiesMissingNote(0, 10), [{ activityId: "legacy-run", sportType: 100 }]);
  setTrainingActivityNote("legacy-run", "");
  assert.deepEqual(listTrainingActivitiesMissingNote(0, 10), [], "\"\" means fetched, no note");
  // Not rated yet: the feeling backfill fetches it, note included, so it isn't on the note list.
  assert.deepEqual(listTrainingActivitiesMissingNote(0, 10), []);

  db.close();
  console.log("Training activity store passed: moving_time migration, upsert, read-back, feeling and note backfill queues.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
