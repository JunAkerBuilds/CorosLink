import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
// RACE_TEST_DIST lets the test run against a private build instead of dist-electron.
const distDir = process.env.RACE_TEST_DIST
  ? path.resolve(repoRoot, process.env.RACE_TEST_DIST)
  : path.join(repoRoot, "dist-electron");
const distUrl = (file) =>
  `${pathToFileURL(path.join(distDir, file)).href}?cacheBust=${Date.now()}`;
const database = await import(distUrl("database.js"));
const strava = await import(distUrl("stravaService.js"));
const races = await import(distUrl("raceService.js"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-race-test-"));
database.initializeDatabase(tempRoot);

const day = 86_400;
const raceDay = Date.UTC(2026, 6, 1, 13, 0, 0) / 1000;
const run = (id, offsetDays, km, seconds, extra = {}) => ({
  activityId: id,
  sportType: 100,
  sportName: "Run",
  startTime: raceDay + offsetDays * day,
  duration: seconds,
  distance: km * 1000,
  avgHr: 150,
  elevationGain: 20,
  name: "Ottawa Run",
  ...extra
});
const easyRuns = Array.from({ length: 10 }, (_, index) =>
  run(`easy${index}`, -40 + index * 4, 8, 8 * 450)
);
const canadaDay = run("canada", 0, 5.07, 1331, { name: "Canada Day road race", avgHr: 182 });
const fastTenK = run("fast10k", 20, 10.08, 2900);
database.upsertTrainingActivities([...easyRuns, canadaDay, fastTenK]);

// --- Suggestions and tagging -------------------------------------------------
let overview = races.getRaceOverview();
assert.deepEqual(overview.races, []);
assert.equal(overview.strava.connected, false);
assert.deepEqual(
  overview.suggestions.map((suggestion) => suggestion.activity.activityId),
  ["fast10k", "canada"]
);

overview = races.markActivityAsRace(canadaDay);
assert.equal(overview.races.length, 1);
let race = overview.races[0];
assert.equal(race.raceId, "coros:canada");
assert.equal(race.source, "coros");
assert.equal(race.name, "Canada Day road race");
assert.equal(race.distanceKey, "5k");
assert.equal(race.distanceIsManual, false);
assert.equal(race.officialDistance, 5000);
assert.equal(race.officialTime, 1331);
assert.equal(race.officialTimeIsManual, false);
assert.equal(race.recordedDistance, 5070);
assert.equal(race.avgHr, 182);
assert.equal(race.buildUp.runs, 10);
assert.equal(race.buildUp.distance, 80000);
assert.equal(race.buildUp.complete, false, "history starts inside the 8-week window");
assert.deepEqual(races.listRaceActivityIds(), ["canada"]);
assert.deepEqual(
  overview.suggestions.map((suggestion) => suggestion.activity.activityId),
  ["fast10k"]
);

overview = races.dismissRaceSuggestion("fast10k");
assert.deepEqual(overview.suggestions, []);

assert.throws(
  () => races.markActivityAsRace({ ...canadaDay, activityId: "treadmill", sportType: 101 }),
  /outdoor, trail and track/
);

// --- Editing ------------------------------------------------------------------
overview = races.updateRace({
  raceId: "coros:canada",
  name: "  Canada Day 5K  ",
  officialTime: 1325,
  placing: "48th of 912"
});
race = overview.races[0];
assert.equal(race.name, "Canada Day 5K");
assert.equal(race.activityName, "Canada Day road race");
assert.equal(race.officialTime, 1325);
assert.equal(race.officialTimeIsManual, true);
assert.equal(race.placing, "48th of 912");

overview = races.updateRace({ raceId: "coros:canada", officialTime: null, distanceKey: "other", officialDistance: 5070 });
race = overview.races[0];
assert.equal(race.officialTime, 1331, "clearing the chip time falls back to the recording");
assert.equal(race.distanceKey, "other");
assert.equal(race.officialDistance, 5070);
overview = races.updateRace({ raceId: "coros:canada", distanceKey: null, officialDistance: null });
assert.equal(overview.races[0].distanceKey, "5k");
assert.throws(() => races.updateRace({ raceId: "coros:nope", name: "x" }), /no longer in your list/);
assert.throws(() => races.updateRace({ raceId: "coros:canada", distanceKey: "6k" }), /Choose a race distance/);

// --- Manual races ---------------------------------------------------------------
assert.throws(
  () => races.addManualRace({ name: "", startTime: raceDay, distanceKey: "5k", officialTime: 1500 }),
  /race name/
);
assert.throws(
  () => races.addManualRace({ name: "Odd", startTime: raceDay, distanceKey: "other", officialTime: 1500 }),
  /race distance/
);
const firstFiveK = Date.UTC(2024, 4, 12, 13) / 1000;
overview = races.addManualRace({
  name: "Spring 5K",
  startTime: firstFiveK,
  distanceKey: "5k",
  officialTime: 1600,
  notes: "First race ever"
});
assert.equal(overview.races.length, 2);
const manual = overview.races[1];
assert.equal(manual.source, "manual");
assert.equal(manual.officialDistance, 5000);
assert.equal(manual.officialTime, 1600);
assert.equal(manual.recordedDistance, undefined);
assert.equal(manual.notes, "First race ever");
assert.equal(manual.buildUp.runs, 0);
assert.equal(manual.buildUp.complete, false);

// Removing: manual races go, recorded ones are remembered as "not a race".
overview = races.removeRace(manual.raceId);
assert.equal(overview.races.length, 1);
overview = races.unmarkActivityAsRace("canada");
assert.equal(overview.races.length, 0);
assert.deepEqual(overview.suggestions, [], "a removed race is not suggested again");
overview = races.markActivityAsRace(canadaDay);
assert.equal(overview.races[0].name, "Canada Day 5K", "re-tagging keeps the athlete's edits");
assert.equal(overview.races[0].placing, "48th of 912");

// --- Strava import -------------------------------------------------------------
strava.setStravaCredentialStorageForTests({
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, "")
});
const realFetch = globalThis.fetch;
strava.setStravaUrlOpenerForTests(async (url) => {
  const authorize = new URL(url);
  const callback = new URL(authorize.searchParams.get("redirect_uri"));
  callback.searchParams.set("state", authorize.searchParams.get("state"));
  callback.searchParams.set("code", "auth-code");
  callback.searchParams.set("scope", "read,activity:read_all");
  await realFetch(callback);
});

const iso = (epochSeconds) => new Date(epochSeconds * 1000).toISOString();
const stravaRun = (id, start, km, seconds, extra = {}) => ({
  id,
  name: `Run ${id}`,
  sport_type: "Run",
  type: "Run",
  workout_type: 0,
  start_date: iso(start),
  distance: km * 1000,
  elapsed_time: seconds,
  moving_time: seconds,
  total_elevation_gain: 30,
  average_heartrate: 170,
  ...extra
});
const oldHalf = Date.UTC(2025, 9, 5, 12) / 1000;
let stravaActivities = [
  // Ten weeks of build-up for last year's half, all before COROS history.
  ...Array.from({ length: 12 }, (_, index) =>
    stravaRun(9000 + index, oldHalf - (60 - index * 5) * day, 12, 4200)
  ),
  stravaRun(8001, oldHalf, 21.3, 6900, { name: "Army Run Half", workout_type: 1, map: { summary_polyline: "x" } }),
  // The Canada Day race synced from COROS 40 s later, also tagged on Strava.
  stravaRun(8002, raceDay + 40, 5.07, 1331, { workout_type: 1 }),
  // A Strava-tagged race for the dismissed fast 10K: the athlete's "no" wins.
  stravaRun(8003, fastTenK.startTime, 10.08, 2900, { workout_type: 1 }),
  // A long run tagged "Long Run" (workout_type 2) and a virtual race are not races here.
  stravaRun(8004, raceDay - 3 * day, 18, 7000, { workout_type: 2 }),
  stravaRun(8005, raceDay - 5 * day, 5, 1300, { workout_type: 1, sport_type: "VirtualRun", type: "VirtualRun" })
];
const listCalls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === "127.0.0.1") return realFetch(input, init);
  if (url.pathname === "/oauth/authorize") {
    return new Response(null, { status: 302, headers: { location: "https://www.strava.com/login" } });
  }
  if (url.pathname === "/oauth/token") {
    return Response.json({
      token_type: "Bearer",
      access_token: "access",
      refresh_token: "refresh",
      expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
      athlete: { id: 42, firstname: "Ada", lastname: "Lovelace" },
      scope: "read activity:read_all"
    });
  }
  if (url.pathname === "/oauth/revoke") return new Response(null, { status: 200 });
  if (url.pathname === "/api/v3/athlete/activities") {
    const after = Number(url.searchParams.get("after"));
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));
    listCalls.push({ after, page });
    const inWindow = stravaActivities
      .filter((activity) => Date.parse(activity.start_date) / 1000 > after)
      .sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date));
    return Response.json(inWindow.slice((page - 1) * perPage, page * perPage));
  }
  throw new Error(`Unexpected request: ${url}`);
};

await assert.rejects(() => races.importStravaRaces(), /Connect Strava/);
strava.saveStravaConfig({ clientId: "213543", clientSecret: "client-secret" });
await strava.connectStrava();

let result = await races.importStravaRaces();
assert.equal(listCalls[0].after, 0, "the first import reads all history");
assert.equal(result.scanned, stravaActivities.length);
assert.equal(result.found, 3);
assert.equal(result.incremental, false);
assert.equal(result.added, 1, "only the half is new; the 5K and 10K are COROS recordings");
assert.equal(result.matched, 2);
overview = result.overview;
assert.equal(overview.strava.connected, true);
assert.ok(overview.strava.lastImportedAt);
assert.deepEqual(
  overview.races.map((entry) => entry.raceId),
  ["coros:canada", "strava:8001"]
);
const half = overview.races[1];
assert.equal(half.source, "strava");
assert.equal(half.name, "Army Run Half");
assert.equal(half.distanceKey, "half");
assert.equal(half.officialTime, 6900);
assert.equal(half.stravaUrl, "https://www.strava.com/activities/8001");
assert.equal(half.buildUp.complete, true);
assert.equal(half.buildUp.runs, 11, "runs within eight weeks of the half");
assert.equal(overview.races[0].stravaActivityId, "8002", "the COROS race links to its Strava twin");
assert.ok(!overview.races.some((entry) => entry.corosActivityId === "fast10k"));

// Edits on a Strava race survive; an incremental import re-reads from the last scan.
races.updateRace({ raceId: "strava:8001", officialTime: 6880, notes: "Windy" });
stravaActivities.push(stravaRun(8006, raceDay + 60 * day, 10.1, 2700, { name: "Fall 10K", workout_type: 1 }));
listCalls.length = 0;
result = await races.importStravaRaces();
assert.equal(listCalls[0].after, fastTenK.startTime - 8 * 7 * day, "reaches back one build-up window");
assert.equal(result.incremental, true);
assert.equal(result.added, 1);
assert.deepEqual(
  result.overview.races.map((entry) => entry.raceId),
  ["strava:8006", "coros:canada", "strava:8001"]
);
assert.equal(result.overview.races[2].officialTime, 6880);
assert.equal(result.overview.races[2].buildUp.complete, true, "a partial rescan keeps the complete build-up");

// Disconnecting drops Strava data but keeps the athlete's own notes for a reconnect.
await strava.disconnectStrava();
races.clearStravaRaceData();
overview = races.getRaceOverview();
assert.equal(overview.strava.connected, false);
assert.equal(overview.strava.hiddenRaces, 2);
assert.deepEqual(overview.races.map((entry) => entry.raceId), ["coros:canada"]);
await strava.connectStrava();
overview = (await races.importStravaRaces()).overview;
assert.equal(overview.races.length, 3);
assert.equal(overview.races.find((entry) => entry.raceId === "strava:8001").notes, "Windy");

// --- Target races --------------------------------------------------------------
const today = new Date();
const dayKey = (offset) => {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
};
assert.throws(() => races.normalizeRaceTarget({ name: "Old race", raceDay: dayKey(-1), distanceKey: "10k" }), /in the future/);
assert.throws(() => races.normalizeRaceTarget({ name: "Far race", raceDay: dayKey(4 * 365), distanceKey: "10k" }), /three years/);
assert.throws(() => races.normalizeRaceTarget({ name: "Trail", raceDay: dayKey(30), distanceKey: "other" }), /race distance/);
assert.throws(() => races.normalizeRaceTarget({ name: " ", raceDay: dayKey(30), distanceKey: "10k" }), /race name/);
assert.throws(() => races.normalizeRaceTarget({ name: "Bad date", raceDay: "2026-02-30", distanceKey: "10k" }), /YYYY-MM-DD/);
let targetEvents = 0;
const stopTargets = races.onRaceTargetsChanged(() => { targetEvents += 1; });
const marathon = races.addRaceTarget({ name: "  Valencia Marathon ", raceDay: dayKey(60), distanceKey: "marathon", goalTime: 11700, priority: "A", location: "Valencia", notes: "Goal race" });
assert.equal(marathon.name, "Valencia Marathon");
assert.equal(marathon.distance, 42195);
assert.equal(marathon.goalTime, 11700);
const trail = races.addRaceTarget({ name: "Sintra Trail", raceDay: `${dayKey(20).slice(0, 4)}-${dayKey(20).slice(4, 6)}-${dayKey(20).slice(6)}`, distanceKey: "other", distance: 27500, priority: "C" });
assert.equal(trail.raceDay, dayKey(20), "a dashed date is stored as YYYYMMDD");
assert.equal(targetEvents, 2);
overview = races.getRaceOverview();
assert.deepEqual(overview.targets.map((target) => target.name), ["Sintra Trail", "Valencia Marathon"], "soonest first");
assert.equal(overview.targets[0].distance, 27500);
assert.equal(overview.races.length, 3, "targets never mix into results");
overview = races.removeRaceTarget(trail.targetId);
assert.deepEqual(overview.targets.map((target) => target.targetId), [marathon.targetId]);
assert.throws(() => races.removeRaceTarget(trail.targetId), /no longer in your list/);
assert.equal(targetEvents, 3);
stopTargets();

globalThis.fetch = realFetch;
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("race service tests passed");
