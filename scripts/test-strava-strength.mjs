import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = Date.now();
const load = async (file) =>
  import(`${pathToFileURL(path.join(repoRoot, "electron", file)).href}?cacheBust=${bust}`);

const {
  isStravaGymActivity,
  normalizeStravaActivity,
  stravaSummaryFingerprint
} = await load("stravaModel.ts");
const { attachStravaSessions, selectStrengthSessions } = await load(
  "strengthSessionMerge.ts"
);
const { parseStravaScopes, hasStravaActivityAccess } = await load("stravaOAuth.ts");

const summary = {
  id: 16234567890,
  name: "Leg day",
  sport_type: "WeightTraining",
  type: "WeightTraining",
  start_date: "2026-07-20T12:00:00Z",
  elapsed_time: 3900,
  moving_time: 3600,
  average_heartrate: 121.6,
  max_heartrate: 162,
  suffer_score: 48,
  device_name: "Apple Watch Ultra",
  visibility: "only_me"
};

// --- Classification ---------------------------------------------------------
assert.equal(isStravaGymActivity(summary), true);
assert.equal(isStravaGymActivity({ sport_type: "HighIntensityIntervalTraining" }), true);
assert.equal(isStravaGymActivity({ type: "Crossfit" }), true, "legacy type still counts");
assert.equal(isStravaGymActivity({ sport_type: "Run", type: "Run" }), false);
assert.equal(isStravaGymActivity({ sport_type: "Yoga" }), false);

// --- Normalization ----------------------------------------------------------
const listed = normalizeStravaActivity(summary);
assert.equal(listed.activityId, "strava:16234567890");
assert.equal(listed.source, "strava");
assert.deepEqual(listed.sourceIds, { strava: "16234567890" });
assert.equal(listed.sportType, 402);
assert.equal(listed.sportName, "Weight Training");
assert.equal(listed.startTime, Date.parse("2026-07-20T12:00:00Z") / 1000);
assert.equal(listed.duration, 3900, "elapsed time, like COROS totals");
assert.equal(listed.avgHr, 122);
assert.equal(listed.maxHr, 162);
assert.equal(listed.calories, undefined, "calories only arrive with the detail payload");
assert.equal(listed.detail.exercises.length, 0);
assert.equal(listed.detail.summary.sets, 0);
assert.equal(listed.strava.url, "https://www.strava.com/activities/16234567890");
assert.equal(listed.strava.relativeEffort, 48);
assert.equal(listed.strava.deviceName, "Apple Watch Ultra");
assert.equal(listed.strava.detailLoaded, false);

const detailed = normalizeStravaActivity(summary, {
  id: 16234567890,
  description: "Squat 5x5 @ 100kg\nRDL 3x8",
  calories: 412.5,
  perceived_exertion: 7
});
assert.equal(detailed.calories, 412.5);
assert.equal(detailed.detail.summary.calories, 412.5);
assert.equal(detailed.strava.description, "Squat 5x5 @ 100kg\nRDL 3x8");
assert.equal(detailed.strava.perceivedExertion, 7);
assert.equal(detailed.strava.detailLoaded, true);

assert.equal(
  normalizeStravaActivity({ ...summary, sport_type: "HighIntensityIntervalTraining" }).sportType,
  400,
  "HIIT lines up with COROS Gym Cardio"
);
assert.equal(normalizeStravaActivity({ ...summary, sport_type: "Run" }), undefined);
assert.equal(normalizeStravaActivity({ ...summary, id: undefined }), undefined);
assert.equal(normalizeStravaActivity({ ...summary, start_date: "nope" }), undefined);
assert.equal(
  normalizeStravaActivity(summary, { perceived_exertion: 0 }).strava.perceivedExertion,
  undefined,
  "an unrated session carries no exertion"
);

// --- Fingerprints -----------------------------------------------------------
assert.equal(stravaSummaryFingerprint(summary), stravaSummaryFingerprint({ ...summary }));
assert.notEqual(
  stravaSummaryFingerprint(summary),
  stravaSummaryFingerprint({ ...summary, name: "Leg day (heavy)" }),
  "a rename invalidates the cached detail"
);
assert.equal(
  stravaSummaryFingerprint(summary),
  stravaSummaryFingerprint({ ...summary, kudos_count: 9 }),
  "social counters do not force a detail re-read"
);

// --- Scopes -----------------------------------------------------------------
assert.deepEqual(parseStravaScopes("read,activity:read_all"), ["read", "activity:read_all"]);
assert.deepEqual(parseStravaScopes("read activity:read"), ["read", "activity:read"]);
assert.equal(hasStravaActivityAccess(["read"]), false);
assert.equal(hasStravaActivityAccess(["read", "activity:read"]), true);

// --- Merging ----------------------------------------------------------------
const corosSession = {
  activityId: "coros-1",
  source: "coros",
  sourceIds: { coros: "coros-1" },
  sportType: 402,
  name: "Strength",
  startTime: Date.parse("2026-07-20T12:00:30Z") / 1000,
  duration: 3870,
  calories: 390,
  avgHr: 118,
  maxHr: 158,
  detail: {
    summary: {
      sets: 12,
      totalReps: 90,
      totalWeightKg: 6000,
      exercises: 3,
      calories: 390,
      durationSec: 3870,
      avgHr: 118,
      maxHr: 158
    },
    exercises: [{ nameKey: "Squat", rawName: "Squat", sets: 5, totalReps: 25, entries: [] }]
  }
};
const hevySession = {
  activityId: "hevy:h1",
  source: "hevy",
  sourceIds: { hevy: "h1" },
  sportType: 402,
  name: "Push",
  startTime: Date.parse("2026-07-22T18:00:00Z") / 1000,
  duration: 3000,
  detail: {
    summary: {
      sets: 9,
      totalReps: 70,
      totalWeightKg: 3000,
      exercises: 3,
      calories: 0,
      durationSec: 3000
    },
    exercises: [{ nameKey: "Bench", rawName: "Bench", sets: 3, totalReps: 24, entries: [] }]
  }
};
const stravaCopyOfCoros = detailed;
const stravaCopyOfHevy = normalizeStravaActivity(
  { ...summary, id: 2, name: "Push", start_date: "2026-07-22T18:01:00Z" },
  { id: 2, calories: 300, description: "Felt strong" }
);
const stravaOnly = normalizeStravaActivity({
  ...summary,
  id: 3,
  name: "Hotel gym",
  start_date: "2026-07-24T07:00:00Z"
});

const merged = attachStravaSessions(
  [corosSession, hevySession],
  [stravaCopyOfCoros, stravaCopyOfHevy, stravaOnly]
);
assert.equal(merged.length, 3, "two copies fold in, one Strava-only session stands alone");
assert.deepEqual(
  merged.map((session) => session.name),
  ["Hotel gym", "Push", "Strength"],
  "newest first"
);

const mergedCoros = merged.find((session) => session.activityId === "coros-1");
assert.equal(mergedCoros.source, "combined");
assert.deepEqual(mergedCoros.sourceIds, { coros: "coros-1", strava: "16234567890" });
assert.equal(mergedCoros.avgHr, 118, "COROS heart rate wins over Strava's copy");
assert.equal(mergedCoros.calories, 390);
assert.equal(mergedCoros.detail.exercises.length, 1, "sets are never replaced");
assert.equal(mergedCoros.strava.description, "Squat 5x5 @ 100kg\nRDL 3x8");

const mergedHevy = merged.find((session) => session.activityId === "hevy:h1");
assert.deepEqual(mergedHevy.sourceIds, { hevy: "h1", strava: "2" });
assert.equal(mergedHevy.calories, 300, "Strava fills calories Hevy never records");
assert.equal(mergedHevy.detail.summary.calories, 300);
assert.equal(mergedHevy.avgHr, 122, "Strava fills missing heart rate");

const standalone = merged.find((session) => session.activityId === "strava:3");
assert.equal(standalone.source, "strava");

// A Strava activity hours away on the same day is a different workout.
const evening = normalizeStravaActivity({
  ...summary,
  id: 4,
  start_date: "2026-07-20T19:00:00Z"
});
const notMatched = attachStravaSessions([corosSession], [evening]);
assert.equal(notMatched.length, 2);
assert.equal(notMatched.find((session) => session.activityId === "coros-1").strava, undefined);

// One Strava copy can only enrich one session: the closest start wins.
const twin = { ...corosSession, activityId: "coros-2", sourceIds: { coros: "coros-2" }, startTime: corosSession.startTime + 600 };
const onePair = attachStravaSessions([twin, corosSession], [stravaCopyOfCoros]);
assert.equal(onePair.length, 2);
assert.equal(onePair.filter((session) => session.strava).length, 1);
assert.equal(onePair.find((session) => session.strava).activityId, "coros-1");

// --- Source selection -------------------------------------------------------
assert.deepEqual(
  selectStrengthSessions("strava", [corosSession], [hevySession], [stravaOnly]).map(
    (session) => session.activityId
  ),
  ["strava:3"]
);
assert.equal(
  selectStrengthSessions("coros", [corosSession], [hevySession], [stravaCopyOfCoros])[0].strava,
  undefined,
  "a single-provider view stays single-provider"
);
assert.equal(
  selectStrengthSessions("combined", [corosSession], [], [stravaCopyOfCoros, stravaOnly]).length,
  2
);
assert.equal(
  selectStrengthSessions("combined", [corosSession], [hevySession]).length,
  2,
  "Strava stays optional for existing callers"
);

console.log("strava-strength tests passed");
