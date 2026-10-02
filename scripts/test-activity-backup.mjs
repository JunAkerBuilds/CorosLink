import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { backupFileName } = await import(
  `${distUrl("activityBackupService.js")}?cacheBust=${Date.now()}`
);

// Date prefix comes from the activity start time (epoch seconds).
const morningRun = {
  activityId: "478506322034196580",
  name: "Morning Run",
  sportType: 100,
  startTime: Date.UTC(2026, 5, 14, 12, 0, 0) / 1000
};
const fileName = backupFileName(morningRun, "fit");
assert.match(fileName, /^2026-06-1[45]_Morning Run_478506322034196580\.fit$/);

// Millisecond timestamps are tolerated too.
assert.match(
  backupFileName(
    { ...morningRun, startTime: Date.UTC(2026, 5, 14, 12, 0, 0) },
    "gpx"
  ),
  /^2026-06-1[45]_Morning Run_478506322034196580\.gpx$/
);

// Unsafe filesystem characters are stripped; missing metadata falls back.
assert.equal(
  backupFileName(
    { activityId: "42", name: 'Trail: "Peak" <5k>?', sportType: 100 },
    "fit"
  ),
  "unknown-date_Trail- -Peak- -5k-_42.fit"
);
assert.equal(
  backupFileName({ activityId: "42", sportType: 100 }, "fit"),
  "unknown-date_activity_42.fit"
);

const {
  activityBackupSportGroup,
  activityMatchesBackupFilters,
  hasActiveBackupFilters,
  isoDayToHappenDay,
  normalizeActivityBackupFilters,
  summarizeActivityBackup
} = await import(
  `${distUrl("activityBackupFilters.js")}?cacheBust=${Date.now()}`
);

// Sport families: known codes map to their family, unknown codes to "other".
assert.equal(activityBackupSportGroup(102), "run");
assert.equal(activityBackupSportGroup(204), "bike");
assert.equal(activityBackupSportGroup(301), "swim");
assert.equal(activityBackupSportGroup(402), "strength");
assert.equal(activityBackupSportGroup(12345), "other");

assert.equal(isoDayToHappenDay("2026-06-14"), "20260614");

const localNoon = (y, m, d) => new Date(y, m - 1, d, 12).getTime() / 1000;
const run = {
  activityId: "1",
  sportType: 100,
  startTime: localNoon(2026, 6, 14),
  distance: 10_000,
  duration: 3_000
};
const lift = {
  activityId: "2",
  sportType: 402,
  startTime: localNoon(2026, 6, 15),
  duration: 2_400
};

// No filters keeps everything.
assert.equal(activityMatchesBackupFilters(run), true);
assert.equal(activityMatchesBackupFilters(run, {}), true);
assert.equal(hasActiveBackupFilters({}), false);

// Sport families.
assert.equal(activityMatchesBackupFilters(run, { sportGroups: ["run"] }), true);
assert.equal(activityMatchesBackupFilters(lift, { sportGroups: ["run"] }), false);
assert.equal(
  activityMatchesBackupFilters(lift, { sportGroups: ["run", "strength"] }),
  true
);

// Inclusive local-day window, open ends allowed.
assert.equal(
  activityMatchesBackupFilters(run, { startDay: "2026-06-14", endDay: "2026-06-14" }),
  true
);
assert.equal(activityMatchesBackupFilters(run, { startDay: "2026-06-15" }), false);
assert.equal(activityMatchesBackupFilters(lift, { endDay: "2026-06-14" }), false);
assert.equal(
  activityMatchesBackupFilters({ ...run, startTime: undefined }, { startDay: "2000-01-01" }),
  false
);

// Length bounds are inclusive; a missing distance counts as zero.
assert.equal(
  activityMatchesBackupFilters(run, { minDistanceMeters: 10_000, maxDistanceMeters: 10_000 }),
  true
);
assert.equal(activityMatchesBackupFilters(run, { minDistanceMeters: 10_001 }), false);
assert.equal(activityMatchesBackupFilters(lift, { maxDistanceMeters: 5_000 }), true);
assert.equal(activityMatchesBackupFilters(lift, { minDistanceMeters: 1 }), false);
assert.equal(activityMatchesBackupFilters(run, { maxDurationSeconds: 2_999 }), false);
assert.equal(activityMatchesBackupFilters(lift, { minDurationSeconds: 1_800 }), true);

// Renderer input is sanitized; nothing usable means no filters at all.
assert.equal(normalizeActivityBackupFilters(undefined), undefined);
assert.equal(normalizeActivityBackupFilters({ sportGroups: ["nope"] }), undefined);
assert.deepEqual(
  normalizeActivityBackupFilters({
    sportGroups: ["run", "nope", 7],
    startDay: "2026-01-01",
    endDay: "Jan 5",
    minDistanceMeters: -1,
    maxDistanceMeters: 21_100,
    minDurationSeconds: Number.NaN,
    maxDurationSeconds: "60"
  }),
  {
    sportGroups: ["run"],
    startDay: "2026-01-01",
    endDay: undefined,
    minDistanceMeters: undefined,
    maxDistanceMeters: 21_100,
    minDurationSeconds: undefined,
    maxDurationSeconds: undefined
  }
);

// Preview totals: family counts ignore the family filter so chips can show
// what selecting them would add; everything else narrows them.
const ride = { activityId: "3", sportType: 200, startTime: localNoon(2026, 6, 16), distance: 40_000, duration: 5_400 };
const preview = summarizeActivityBackup([run, lift, ride], {
  sportGroups: ["run", "bike"],
  minDurationSeconds: 2_500
});
assert.deepEqual(preview, {
  total: 3,
  matched: 2,
  distanceMeters: 50_000,
  durationSeconds: 8_400,
  groupCounts: { run: 1, bike: 1 }
});
assert.equal(summarizeActivityBackup([run, lift, ride]).matched, 3);
assert.deepEqual(summarizeActivityBackup([run, lift, ride]).groupCounts, {
  run: 1,
  strength: 1,
  bike: 1
});

console.log("activity backup tests passed");
