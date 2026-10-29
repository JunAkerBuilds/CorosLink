import assert from "node:assert/strict";
import {
  computeBuildUp,
  computeRaceProgress,
  detectRaceDistance,
  equivalentTime,
  hasRaceLikeName,
  localRaceDay,
  matchPastRaces,
  raceGroupKey,
  simplifyRaceRoute,
  suggestRaces
} from "../electron/raceModel.ts";

// Distance detection: watches measure a course a little long.
assert.equal(detectRaceDistance(5070), "5k");
assert.equal(detectRaceDistance(4880), "5k");
assert.equal(detectRaceDistance(10230), "10k");
assert.equal(detectRaceDistance(21420), "half");
assert.equal(detectRaceDistance(42900), "marathon");
assert.equal(detectRaceDistance(1640), "1mi");
assert.equal(detectRaceDistance(7010), "other");
assert.equal(detectRaceDistance(15400), "15k");
assert.equal(detectRaceDistance(16300), "10mi");
assert.equal(detectRaceDistance(undefined), "other");
assert.equal(detectRaceDistance(0), "other");

// Riegel: a 20:00 5K is worth about 41:42 over 10K.
assert.equal(Math.round(equivalentTime(1200, 5000, 10000)), 2502);
assert.equal(equivalentTime(1200, 5000, 5000), 1200);

// Names: events read as races; sessions that mention a distance do not.
for (const name of ["Canada Day road race", "Ottawa Marathon", "Saturday parkrun", "Spring 10K", "Turkey Trot", "XC Championships", "Army Run Half Marathon"]) {
  assert.equal(hasRaceLikeName(name), true, name);
}
for (const name of ["10km Easy Run", "5km Easy Run", "12km Long Run", "Taper 400s", "Race pace tempo", "Rolling 400s", "Ottawa Run", "10K Easy Run", "6x800 workout", undefined]) {
  assert.equal(hasRaceLikeName(name), false, String(name));
}

// Suggestions.
const day = 86_400;
const start = 1_780_000_000;
const run = (id, offsetDays, km, minutes, extra = {}) => ({
  activityId: id,
  sportType: 100,
  startTime: start + offsetDays * day,
  distance: km * 1000,
  duration: minutes * 60,
  name: "Ottawa Run",
  ...extra
});
const easy = Array.from({ length: 8 }, (_, index) => run(`e${index}`, index * 3, 8, 8 * 7.5));
const activities = [
  ...easy,
  // 5.05 km at 4:24/km against a 7:30/km habit: an all-out effort.
  run("fast5k", 30, 5.05, 22.2),
  // Named like a race, and quick too.
  run("named", 31, 10.1, 60, { name: "Fall Classic 10K" }),
  // Quick but an odd distance: effort alone is not enough.
  run("odd", 32, 7.3, 40),
  // Indoor runs can never be races.
  run("treadmill", 33, 5, 20, { sportType: 101, name: "Treadmill race" }),
  // Already dismissed.
  run("dismissed", 34, 5, 21)
];
const suggestions = suggestRaces(activities, new Set(["dismissed"]));
assert.deepEqual(
  suggestions.map((suggestion) => suggestion.activity.activityId),
  ["named", "fast5k"]
);
assert.equal(suggestions[1].distanceKey, "5k");
assert.match(suggestions[1].reasons[0], /^41% quicker than your usual pace$/);
assert.deepEqual(suggestions[0].reasons, ["Named like a race", "21% quicker than your usual pace"]);
assert.equal(suggestions[0].distanceKey, "10k");

// A good training 10K (16% quicker than usual) is not a race; 10Ks need 17%.
const goodTenK = suggestRaces([...easy, run("tempo10k", 30, 10.0, 63)], new Set());
assert.deepEqual(goodTenK, []);
const raceTenK = suggestRaces([...easy, run("race10k", 30, 10.05, 60.3)], new Set());
assert.equal(raceTenK[0]?.activity.activityId, "race10k");

// Too little history for a baseline: only names count.
assert.deepEqual(suggestRaces([run("solo", 0, 5, 20)], new Set()), []);

// Build-up: eight weeks before the race, the race itself excluded.
const raceStart = start + 70 * day;
const buildUp = computeBuildUp(
  raceStart,
  [
    { startTime: raceStart - 60 * day, distance: 9000 }, // before the window
    { startTime: raceStart - 50 * day, distance: 10000 },
    { startTime: raceStart - 10 * day, distance: 21000 },
    { startTime: raceStart - 1 * day, distance: 5000 },
    { startTime: raceStart, distance: 5000 } // the race
  ],
  start
);
assert.deepEqual(buildUp, { weeks: 8, runs: 3, distance: 36000, longestRun: 21000, complete: true });
assert.equal(computeBuildUp(raceStart, [], raceStart - 10 * day).complete, false);
assert.equal(computeBuildUp(raceStart, [], undefined).complete, false);
assert.equal(computeBuildUp(raceStart, [], undefined).longestRun, undefined);

// Progress: PBs as they happened, deltas within a distance, "other" grouped by length.
const progress = computeRaceProgress([
  { raceId: "a", startTime: 100, distanceKey: "5k", officialDistance: 5000, officialTime: 1500 },
  { raceId: "b", startTime: 200, distanceKey: "5k", officialDistance: 5000, officialTime: 1440 },
  { raceId: "c", startTime: 300, distanceKey: "10k", officialDistance: 10000, officialTime: 3000 },
  { raceId: "d", startTime: 400, distanceKey: "5k", officialDistance: 5000, officialTime: 1460 },
  { raceId: "e", startTime: 500, distanceKey: "other", officialDistance: 7020, officialTime: 2200 },
  { raceId: "f", startTime: 600, distanceKey: "other", officialDistance: 6980, officialTime: 2150 }
]);
assert.equal(progress.get("a").wasPersonalBest, true);
assert.equal(progress.get("b").wasPersonalBest, true);
assert.equal(progress.get("b").deltaToPrevious, -60);
assert.equal(progress.get("b").isCurrentBest, true);
assert.equal(progress.get("d").wasPersonalBest, false);
assert.equal(progress.get("d").deltaToPrevious, 20);
assert.equal(progress.get("d").previousRaceId, "b");
assert.equal(progress.get("a").isCurrentBest, false);
assert.equal(progress.get("c").wasPersonalBest, true);
assert.equal(progress.get("c").deltaToPrevious, undefined);
assert.equal(progress.get("e").groupKey, "other:7000");
assert.equal(progress.get("f").groupKey, "other:7000");
assert.equal(progress.get("f").deltaToPrevious, -50);
assert.equal(Math.round(progress.get("c").fiveKEquivalent), 1439);
assert.equal(raceGroupKey({ distanceKey: "half", officialDistance: 21097.5 }), "half");

// Past races: a recording on the day of a typed-in result or a passed target.
{
  const noon = new Date(2025, 4, 18, 9, 30).getTime() / 1000;
  const raceDayKey = localRaceDay(noon);
  assert.equal(raceDayKey, "20250518");
  const recording = (id, km, extra = {}) => ({ activityId: id, sportType: 100, startTime: noon, distance: km * 1000, duration: 3600, ...extra });
  const warmUp = recording("warmup", 2.1, { startTime: noon - 3600 });
  const half = recording("half", 21.4);
  const nextDay = recording("nextday", 21.1, { startTime: noon + 86_400 });
  const indoor = recording("indoor", 21.1, { sportType: 101 });
  const hints = [
    { kind: "result", name: "Ottawa Half", raceDay: raceDayKey, distance: 21097.5 },
    { kind: "target", name: "Spring Half", raceDay: raceDayKey, distance: 21097.5 },
    { kind: "result", name: "Unrecorded 10K", raceDay: "20240101", distance: 10000 }
  ];
  const matched = matchPastRaces([warmUp, half, nextDay, indoor], new Set(), hints);
  assert.deepEqual(matched.map((suggestion) => suggestion.activity.activityId), ["half"], "one per race, closest length, right sport and day");
  assert.equal(matched[0].distanceKey, "half");
  assert.deepEqual(matched[0].reasons, ["Same day as your result: Ottawa Half", "Your target race day: Spring Half"]);
  assert.deepEqual(matchPastRaces([half], new Set(["half"]), hints), [], "tagged or dismissed runs stay out");
  assert.deepEqual(
    matchPastRaces([recording("long", 27)], new Set(), hints),
    [],
    "far longer than the race is not it"
  );
  assert.deepEqual(
    matchPastRaces([recording("any", 7)], new Set(), [{ kind: "target", name: "Fun run", raceDay: raceDayKey }]).map((s) => s.activity.activityId),
    ["any"],
    "a race with no length matches on the day alone"
  );
}

// Routes: at most 400 points, the finish kept, empty and zero fixes dropped.
{
  const track = Array.from({ length: 1001 }, (_, index) => ({ lat: 45 + index / 1e4, lon: -75.123456 }));
  const route = simplifyRaceRoute([{ lat: 0, lon: 0 }, { distance: 5 }, ...track]);
  assert.ok(route.length <= 400 && route.length > 300, String(route.length));
  assert.deepEqual(route[0], [45, -75.12346]);
  assert.deepEqual(route.at(-1), [45.1, -75.12346]);
  assert.deepEqual(simplifyRaceRoute([{ lat: 45, lon: -75 }]), []);
  assert.equal(simplifyRaceRoute(track.slice(0, 50)).length, 50);
}

console.log("race model tests passed");
