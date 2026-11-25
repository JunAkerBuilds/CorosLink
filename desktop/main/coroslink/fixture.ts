// A small CorosLink data folder, as CorosLink 0.1.8x leaves it (tables from its electron/database.ts), for the
// move's tests and for smoke screenshots (CLINK_COROSLINK_DIR). Only the tables the move reads. Its secrets are
// sealed the way CorosLink's safeStorage seals them on a Mac, with FIXTURE_KEYCHAIN_PASSWORD as the keychain's.
// Every account, key and name in it is made up.
import { createCipheriv, generateKeyPairSync, pbkdf2Sync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const PROJECT = "0b7a3a52-8f5e-4c43-9d55-1f2a3b4c5d6e";
/** The made-up keychain password the fixture's secrets are sealed with ("CorosLink Safe Storage"). */
export const FIXTURE_KEYCHAIN_PASSWORD = "fixture-keychain-password";
/** The made-up watch key's account ID: past 2^53, as real ones are. */
export const FIXTURE_ACCOUNT_ID = "9223372036854775899";

/** What CorosLink's safeStorage writes on a Mac: base64 of "v10" + AES-128-CBC (see oldKeychain.ts). */
export function sealLikeCorosLink(text: string, password = FIXTURE_KEYCHAIN_PASSWORD): string {
  const key = pbkdf2(password);
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  return Buffer.concat([Buffer.from("v10"), cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}
const pbkdf2 = (password: string) => pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");

/** A COROS run program (as CorosLink keeps them in plans and Local-Only Mode): 10 min warm-up, 5 km, 5 min cool-down. */
export const FIXTURE_PROGRAM = {
  id: "481700000000000001", name: "Easy 5K", sportType: 1, overview: "Steady", exercises: [
    { id: "1", name: "Warm up", exerciseType: 1, targetType: 2, targetValue: 600, sortNo: 16777216, intensityType: 0 },
    { id: "2", name: "Run", exerciseType: 2, targetType: 5, targetValue: 500000, sortNo: 33554432, intensityType: 0 },
    { id: "3", name: "Cool down", exerciseType: 3, targetType: 2, targetValue: 300, sortNo: 50331648, intensityType: 0 },
  ],
};

export function makeCorosLinkFolder(folder: string, options: { activities?: number } = {}): string {
  mkdirSync(folder, { recursive: true });
  const db = new DatabaseSync(path.join(folder, "coroslink.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE training_activities (activity_id TEXT PRIMARY KEY, name TEXT, sport_type INTEGER NOT NULL, sport_name TEXT, start_time INTEGER,
      end_time INTEGER, duration INTEGER, distance REAL, avg_hr INTEGER, max_hr INTEGER, calories INTEGER, training_load REAL, elevation_gain REAL,
      synced_at TEXT NOT NULL, feel_type INTEGER, moving_time INTEGER, note TEXT);
    CREATE TABLE local_activity_files (activity_id TEXT PRIMARY KEY, device_id TEXT, watch_activity_id TEXT, source TEXT NOT NULL, provenance TEXT NOT NULL,
      file_path TEXT NOT NULL, payload_id INTEGER, format TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL, verification TEXT NOT NULL,
      sport_type INTEGER NOT NULL, sport_name TEXT, name TEXT, start_time INTEGER, end_time INTEGER, duration REAL, moving_time REAL, distance REAL,
      avg_hr INTEGER, max_hr INTEGER, calories INTEGER, elevation_gain REAL, original_name TEXT, imported_at TEXT NOT NULL);
    CREATE TABLE local_health_summaries (day TEXT NOT NULL, metric TEXT NOT NULL, device_id TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
      method TEXT NOT NULL, computed_at TEXT NOT NULL, PRIMARY KEY (day, metric, device_id));
    CREATE TABLE local_sleep_sessions (device_id TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL, day TEXT NOT NULL,
      utc_offset_minutes INTEGER NOT NULL, total_minutes INTEGER NOT NULL, awake_minutes INTEGER NOT NULL, light_minutes INTEGER NOT NULL,
      deep_minutes INTEGER NOT NULL, rem_minutes INTEGER NOT NULL, awake_count INTEGER NOT NULL, min_hr INTEGER, avg_hr INTEGER, max_hr INTEGER,
      ranges TEXT NOT NULL, source TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (device_id, start_ts));
    CREATE TABLE local_devices (device_id TEXT PRIMARY KEY, name TEXT, model TEXT, firmware TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
    CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, provider TEXT NOT NULL, title TEXT NOT NULL, messages_json TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE athlete_memory (fact_id TEXT PRIMARY KEY, category TEXT NOT NULL, text TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE generated_routes (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, start_location TEXT NOT NULL, destination_location TEXT,
      distance_meters INTEGER NOT NULL, duration_seconds REAL, ascent_meters REAL, descent_meters REAL, mode TEXT NOT NULL, surface_preference TEXT NOT NULL,
      avoid_highways INTEGER NOT NULL, elevation_preference TEXT NOT NULL, points_json TEXT NOT NULL, bounds_json TEXT, gpx_path TEXT, activity_type TEXT, insights_json TEXT);
    CREATE TABLE training_plans (id TEXT PRIMARY KEY, remote_id TEXT UNIQUE, source TEXT NOT NULL, name TEXT NOT NULL, document_json TEXT NOT NULL,
      raw_remote_json TEXT, remote_version INTEGER, remote_updated_at INTEGER, sync_state TEXT NOT NULL DEFAULT 'local', last_synced_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);
    CREATE TABLE race_targets (target_id TEXT PRIMARY KEY, event_name TEXT NOT NULL, race_day TEXT NOT NULL, distance_key TEXT NOT NULL, distance_m REAL NOT NULL,
      goal_time_sec REAL, priority TEXT, location TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, details_json TEXT);
    CREATE TABLE strength_sessions (activity_id TEXT PRIMARY KEY, sport_type INTEGER NOT NULL, detail_json TEXT, fetched_at TEXT NOT NULL);
    CREATE TABLE local_training_programs (id TEXT PRIMARY KEY, program TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE local_training_schedule (id_in_plan TEXT PRIMARY KEY, happen_day TEXT NOT NULL, sort_no INTEGER NOT NULL, program TEXT NOT NULL, exercise_bar_chart TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE local_health_samples (device_id TEXT NOT NULL, metric TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, validity TEXT NOT NULL,
      source TEXT NOT NULL, provenance TEXT NOT NULL, utc_offset_minutes INTEGER, recorded_at TEXT NOT NULL, PRIMARY KEY (device_id, metric, ts, source));
    CREATE TABLE workout_journal (entry_id TEXT PRIMARY KEY, user_key TEXT NOT NULL, happen_day TEXT, plan_id TEXT, id_in_plan TEXT, activity_id TEXT, workout_name TEXT,
      sport_type INTEGER, brief_json TEXT, debrief_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE race_entries (race_id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL, coros_activity_id TEXT, strava_activity_id TEXT, snapshot_json TEXT,
      event_name TEXT, distance_key TEXT, official_distance_m REAL, official_time_sec REAL, placing TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, transport TEXT NOT NULL DEFAULT 'streamable-http', auth_type TEXT NOT NULL DEFAULT 'oauth',
      scope TEXT, enabled INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE remote_sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, jkt TEXT NOT NULL, scopes TEXT NOT NULL,
      via TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER NOT NULL, revoked_at INTEGER);
  `);
  const at = "2026-11-21T18:24:55.988Z";
  const put = db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const watchKey = { version: 1, accountUserId: FIXTURE_ACCOUNT_ID, privateKeyDer: privateKey.export({ format: "der", type: "pkcs1" }).toString("base64"), unit: 0, dataCollectSwitch: 1, savedAt: 1792000000000, accountEmail: "runner@example.com" };
  for (const [k, v] of [
    ["chat.provider", "chatgpt"], ["chat.chatgpt.model", "gpt-5"], ["chat.chatgpt.effort", "high"], ["chat.claudeCode.model", "opus"],
    ["chat.openRouter.apiKey", sealLikeCorosLink("sk-or-fixture")],
    ["chat.oauthToken", sealLikeCorosLink(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: 1800000000, account_id: "acct", email: "runner@example.com", token_type: "Bearer" }))],
    ["chat.customInstructions", "Keep it short."],
    ["coros.ble.loginAuth", sealLikeCorosLink(JSON.stringify(watchKey))],
    ["coros.ble.watchIdentity", JSON.stringify({ system: { deviceId: "8A1F0C2E-0000-4000-8000-000000000001", deviceName: "COROS PACE Pro 2F1A6C", serialNumber: "FIXTURE01", model: "PACE Pro", pinnedAt: 1792000000000 } })],
    ["watch.weatherLocation", JSON.stringify({ latitude: 45.4, longitude: -75.7, place: "Ottawa", source: "chosen" })],
    ["watch.autoSync", JSON.stringify({ enabled: true, intervalHours: 6 })],
    ["coros.credentials", sealLikeCorosLink(JSON.stringify({ account: "runner@example.com", pwdHash: "0123456789abcdef0123456789abcdef" }))],
    ["watchfaces.mobileSession", sealLikeCorosLink(JSON.stringify({ accessToken: "mobile-token", userId: FIXTURE_ACCOUNT_ID, region: "us" }))],
    ["trainingHub.accessToken", "hub-token"], ["trainingHub.userId", FIXTURE_ACCOUNT_ID], ["trainingHub.regionId", "2"], ["trainingHub.baseUrl", "https://teamapi.coros.com"],
    ["hevy.apiKey", sealLikeCorosLink("hevy-fixture-key")],
    // intervals.icu fell back to plain text where the keychain wasn't there.
    ["intervals.apiKey", "intervals-fixture-key"], ["intervals.athleteId", "i12345"],
    ["strava.secureState", sealLikeCorosLink(JSON.stringify({ clientSecret: "s" }))],
    ["appleCalendar.secureState", sealLikeCorosLink("{}")],
    ["calendar.workoutEvents.0fd0", JSON.stringify({ events: {} })],
    ["corosMcp.tokens", sealLikeCorosLink(JSON.stringify({ access_token: "mcp-at", token_type: "Bearer", refresh_token: "mcp-rt" }))],
    ["corosMcp.clientInfo", `encrypted:${sealLikeCorosLink(JSON.stringify({ client_id: "cid", redirect_uris: ["http://127.0.0.1:1456/coros-mcp/callback"] }))}`],
    ["mcp.notes.bearer", sealLikeCorosLink("notes-token")],
    ["maps.openRouteServiceApiKey", "ors-fixture-key-0123456789"],
    ["spotify.clientId", "spotify-client-id"],
    ["app.language", "en"], ["coach.unitSystem", "metric"],
  ]) put.run(k, v);

  const act = db.prepare(`INSERT INTO training_activities (activity_id, name, sport_type, sport_name, start_time, end_time, duration, distance, avg_hr, max_hr,
    calories, training_load, elevation_gain, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const start = 1794418202;
  const count = options.activities ?? 6;
  for (let i = 0; i < count; i++) {
    const s = start - i * 86_400;
    act.run(String(481686637942702580n - BigInt(i)), i % 3 === 2 ? "Evening Ride" : "4 km Easy Run", i % 3 === 2 ? 200 : 100, "Run", s, s + 2180, 2180, 4006.21 + i, 150, 175, 366, 76, 16, at);
  }
  // A start-and-stop blip COROS kept: never brought over.
  act.run("481642827137187942", "Run", 100, "Run", 1794259297, 1794259325, 28, 0, 86, 0, 2, 0, 0, at);

  mkdirSync(path.join(folder, "local-archive", "fit", "27"), { recursive: true });
  writeFileSync(path.join(folder, "local-archive", "fit", "27", "277d.fit"), Buffer.from("FIT-BYTES"));
  db.prepare(`INSERT INTO local_activity_files (activity_id, device_id, watch_activity_id, source, provenance, file_path, format, sha256, size_bytes,
    verification, sport_type, name, start_time, duration, distance, avg_hr, max_hr, calories, elevation_gain, imported_at)
    VALUES (?, ?, ?, 'watch-ble', 'watch', ?, 'fit', ?, 9, 'verified', 100, 'Run', ?, 1800, 5000, 140, 160, 300, 12, ?)`)
    .run("watch-846db480-coros-1792419428", "dev-1", "coros-1792419428-0", "fit/27/277d.fit", "277d", 1792419428, at);

  const h = db.prepare("INSERT INTO local_health_summaries (day, metric, device_id, value, unit, method, computed_at) VALUES (?, ?, 'dev-1', ?, 'count', 'watch-day-total', ?)");
  h.run("20261021", "steps", 7250, at); h.run("20261021", "active_time", 1800, at); h.run("20261022", "steps", 9100, at);
  db.prepare(`INSERT INTO local_sleep_sessions (device_id, start_ts, end_ts, day, utc_offset_minutes, total_minutes, awake_minutes, light_minutes, deep_minutes,
    rem_minutes, awake_count, avg_hr, ranges, source, recorded_at) VALUES ('dev-1', 1792368000, 1792395000, '2026-10-22', -240, 430, 20, 230, 90, 90, 2, 52, '[]', 'watch', ?)`).run(at);
  db.prepare("INSERT INTO local_devices VALUES ('dev-1', 'COROS PACE Pro 2F1A6C', 'pace-pro', 'V 3.2008.0', ?, ?)").run(at, at);

  const chat = db.prepare("INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at) VALUES (?, 'chatgpt', ?, ?, ?, ?)");
  chat.run("05ac7817-4079-459d-b8a7-3660af96b5e7", "Today's run", JSON.stringify([
    { kind: "message", role: "user", content: "How was today's run?" },
    { kind: "activityVisual", preview: { activityId: "481686637942702580" } },
    { kind: "message", role: "assistant", content: "Easy and steady. **164 bpm** average." },
  ]), "2026-11-11T18:46:11.319Z", "2026-11-11T18:46:55.798Z");
  chat.run("2286c2ed-92bc-4153-a545-06f0bc45360e", "hello", JSON.stringify([{ kind: "message", role: "user", content: "hello" }]), "2026-11-12T21:51:25.912Z", "2026-11-12T21:51:28.365Z");
  db.prepare("INSERT INTO athlete_memory VALUES ('fact-1', 'goal', 'Sub-50 10K in May', 'user', ?, ?)").run(at, at);

  db.prepare(`INSERT INTO generated_routes (id, name, created_at, start_location, distance_meters, ascent_meters, descent_meters, mode, surface_preference,
    avoid_highways, elevation_preference, points_json, activity_type) VALUES (?, ?, ?, 'Pinned', 4666, 19, 19, 'loop', 'road', 0, 'any', ?, 'running')`)
    .run("bb171df9-ee34-4da3-acd8-d9ac37ddf476", "5.0 km loop", "2026-10-15T13:55:23.943Z", JSON.stringify([
      { lat: 45.396023, lon: -75.750273, elevation: 63 }, { lat: 45.397, lon: -75.751, elevation: 64 }, { lat: 45.396023, lon: -75.750273, elevation: 63 }]));
  const plan = {
    id: "plan:7d1e", name: "10K plan", description: "", goal: "Sub-50 10K", difficulty: "intermediate", notes: "", source: "local", sportMix: ["run"], weekCount: 2,
    startDate: "2026-12-07", phases: [{ id: "ph1", name: "Base", startWeek: 1, endWeek: 2, kind: "base" }], tags: ["10k"], favorite: true, archived: false, syncState: "local",
    entries: [
      { id: "entry:1", kind: "workout", weekIndex: 0, dayIndex: 1, sortOrder: 0, programId: FIXTURE_PROGRAM.id, workout: { key: "w1", name: "Easy 5K", sport: "run" }, corosProgram: FIXTURE_PROGRAM, plannedDistanceMeters: 5000 },
      { id: "entry:2", kind: "rest", weekIndex: 0, dayIndex: 2, sortOrder: 0 },
    ],
    calendarInstalls: [{ id: "inst1", startDate: "20261207", planRevision: "abc", state: "active", createdAt: at, updatedAt: at,
      occurrences: [{ planEntryId: "entry:1", happenDay: "20261208", schedulePlanId: "0", scheduleIdInPlan: "17", planProgramId: "1", createdAt: at }], failures: [] }],
    createdAt: at, updatedAt: at,
  };
  const putPlan = db.prepare("INSERT INTO training_plans (id, remote_id, source, name, document_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  putPlan.run(plan.id, null, "local", plan.name, JSON.stringify(plan), at, at);
  // One COROS has: C-LINK reads it from COROS, so it isn't brought.
  putPlan.run("coros:1", "1", "coros", "COROS plan", JSON.stringify({ ...plan, id: "coros:1", source: "coros" }), at, at);
  db.prepare("INSERT INTO local_training_programs VALUES ('1792000000000000', ?, 0, 0)").run(JSON.stringify(FIXTURE_PROGRAM));
  db.prepare("INSERT INTO local_training_schedule VALUES ('3', '20261210', 1, ?, NULL, 0)").run(JSON.stringify({ ...FIXTURE_PROGRAM, name: "Thursday 5K" }));
  db.prepare("INSERT INTO local_health_samples VALUES ('dev-1', 'heart_rate', 1792368000, 52, 'bpm', 'valid', 'watch', 'watch', -240, ?)").run(at);
  db.prepare("INSERT INTO workout_journal VALUES ('j1', 'k', '20261208', '0', '17', NULL, 'Easy 5K', 100, ?, ?, ?, ?)")
    .run(JSON.stringify({ goal: "Stay easy", cues: [{ id: "cue-1", text: "Relax shoulders" }], fuelPlan: "Water", author: "athlete", updatedAt: at }), JSON.stringify({ feel: 4, cueOutcomes: { "cue-1": "hit" }, updatedAt: at }), at, at);
  db.prepare("INSERT INTO race_entries (race_id, status, source, event_name, created_at, updated_at) VALUES ('manual:1', 'race', 'manual', 'Spring 5K', ?, ?)").run(at, at);
  const mcp = db.prepare("INSERT INTO mcp_servers (id, name, url, auth_type, builtin, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
  mcp.run("coros", "COROS", "https://mcpus.coros.com/mcp", "oauth", 1, 0);
  mcp.run("notes", "Notes", "https://notes.example.com/mcp", "bearer", 0, 1);
  db.prepare("INSERT INTO race_targets VALUES ('r1', 'Toronto 10K', '20270502', '10k', 10000, NULL, NULL, NULL, NULL, ?, ?, NULL)").run(at, at);
  db.prepare("INSERT INTO remote_sessions (id, token_hash, label, jkt, scopes, via, created_at, expires_at) VALUES ('s1', 'h', 'iPhone', 'j', '[]', 'pair', 0, 0)").run();
  db.close();

  const project = path.join(folder, "watchface-projects", PROJECT);
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, "project.json"), JSON.stringify({ projectId: PROJECT, name: "NOMAD", updatedAt: "2026-10-16T19:20:24.204Z", sourceTemplateId: "480059855971926016", firmwareType: "COROS W332", design: { version: 1 } }));
  writeFileSync(path.join(project, "starter.dat"), Buffer.from("starter"));
  writeFileSync(path.join(project, "preview.png"), Buffer.from("png"));
  writeFileSync(path.join(project, "summary.json"), "{}");
  // A folder that isn't a project.
  mkdirSync(path.join(folder, "watchface-projects", "not-a-project"), { recursive: true });
  mkdirSync(path.join(folder, "privacy"), { recursive: true });
  writeFileSync(path.join(folder, "privacy", "data-mode.json"), JSON.stringify({ version: 1, mode: "local_only", changedAt: at }));
  mkdirSync(path.join(folder, "coach-attachments", "s1", "a1"), { recursive: true });
  writeFileSync(path.join(folder, "coach-attachments", "s1", "a1", "text.txt"), "attached");
  mkdirSync(path.join(folder, "watchface-ai-chats"), { recursive: true });
  writeFileSync(path.join(folder, "watchface-ai-chats", "c1.json"), "{}");
  mkdirSync(path.join(folder, "local-archive", "partial"), { recursive: true });
  writeFileSync(path.join(folder, "local-archive", "partial", "half.bin"), "half");
  mkdirSync(path.join(folder, "downloads"), { recursive: true });
  writeFileSync(path.join(folder, "downloads", "song.mp3"), Buffer.alloc(2048));
  return folder;
}

export const FIXTURE_PROJECT = PROJECT;
