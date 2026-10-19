import assert from "node:assert/strict";
import {
  mapTrainingHubActivity,
  mergeActivityDetailWithList,
  parseActivityDetail
} from "../dist-electron/trainingHubService.js";

const trailDetailFixture = {
  summary: {
    name: "Trail Verrières Igny Gilles Ludo Quentin & Yann",
    sportType: 102,
    totalTime: 1443564,
    distance: 2974700,
    avgHr: 151,
    maxHr: 176,
    calories: 2675000,
    elevGain: 100500,
    trainingLoad: 665
  },
  frequencyList: [
    { distance: 0, altitude: 12000 },
    { distance: 100000, altitude: 12500 },
    { distance: 200000, altitude: 13000 },
    { distance: 300000, altitude: 12800 }
  ],
  lapList: [
    {
      type: 1,
      lapItemList: [
        {
          distance: 742000,
          totalTime: 360000,
          avgHr: 142,
          maxHr: 158,
          ascent: 25000
        },
        {
          distance: 755000,
          totalTime: 370000,
          avgHr: 149,
          maxHr: 165,
          ascent: 28000
        }
      ]
    },
    {
      type: 2,
      lapItemList: [
        {
          distance: 742000,
          totalTime: 360000,
          avgHr: 142,
          maxHr: 158,
          ascent: 25000
        },
        {
          distance: 755000,
          totalTime: 370000,
          avgHr: 149,
          maxHr: 165,
          ascent: 28000
        }
      ]
    }
  ],
  graphList: [
    {
      gpsLat: [488000000, 488100000, 488200000, 488300000],
      gpsLon: [22000000, 22100000, 22200000, 22300000],
      altitude: [12000, 12500, 13000, 12800],
      distance: [0, 100000, 200000, 300000]
    }
  ]
};

const listActivity = {
  activityId: "trail-1",
  name: "Trail Verrières Igny Gilles Ludo Quentin & Yann",
  sportType: 102,
  startTime: 1719477060,
  duration: 14436,
  distance: 29700,
  avgHr: 151,
  maxHr: 176,
  calories: 2675,
  trainingLoad: 665,
  elevationGain: 1005
};

const detail = parseActivityDetail(trailDetailFixture);

assert.equal(detail.duration, 14436);
assert.equal(detail.distance, 29747);
assert.equal(detail.calories, 2675);
assert.equal(detail.elevationGain, 1005);
assert.equal(detail.laps.length, 2);
assert.equal(detail.laps[0]?.distance, 7420);
assert.equal(detail.laps[0]?.duration, 3600);
assert.equal(detail.laps[0]?.elevationGain, 250);
assert.ok(detail.track);
assert.ok((detail.track?.points.length ?? 0) >= 2);
assert.equal(detail.track?.points[0]?.elevation, 120);
assert.equal(detail.track?.points[0]?.lat, 48.8);
assert.equal(detail.track?.points[0]?.lon, 2.2);

const merged = mergeActivityDetailWithList(
  {
    ...detail,
    duration: 1443564,
    distance: 2974700,
    calories: undefined,
    elevationGain: undefined
  },
  listActivity
);

assert.equal(merged.duration, 14436);
assert.equal(merged.distance, 29700);
assert.equal(merged.calories, 2675);
assert.equal(merged.elevationGain, 1005);

// Detail summary sends elapsed (totalTime) and moving (workoutTime) time in
// 0.01 s; laps carry moving time. Values from a live PACE Pro run, 2026-10-02.
const pausedRunFixture = {
  summary: {
    sportType: 100,
    totalTime: 310995,
    workoutTime: 249889,
    pauseTime: 61106,
    distance: 700761
  },
  lapList: [
    {
      type: -1,
      lapItemList: [{ distance: 700761, time: 249889, pauseTime: 61106 }]
    }
  ]
};
const pausedRun = parseActivityDetail(pausedRunFixture);
assert.equal(pausedRun.duration, 3110);
assert.equal(pausedRun.movingTime, 2499);
assert.equal(pausedRun.laps[0]?.duration, 2499);
assert.equal(detail.movingTime, undefined);

// The list API sends the same pair in seconds; the detail's duration stays
// elapsed and its moving time survives the merge.
const pausedRunMerged = mergeActivityDetailWithList(pausedRun, {
  activityId: "480757304470307016",
  sportType: 100,
  duration: 3110,
  distance: 7007.61
});
assert.equal(pausedRunMerged.duration, 3110);
assert.equal(pausedRunMerged.movingTime, 2499);

// Moving time longer than elapsed means mismatched units: drop it.
assert.equal(
  parseActivityDetail({ summary: { totalTime: 310995, workoutTime: 9000 } }).movingTime,
  undefined
);
assert.equal(
  mergeActivityDetailWithList(
    { ...pausedRun, duration: 31, movingTime: 2499 },
    { activityId: "480757304470307016", sportType: 100, duration: 3110 }
  ).movingTime,
  2499
);
assert.equal(
  mergeActivityDetailWithList(
    { ...pausedRun, duration: 310995, movingTime: 249889 },
    { activityId: "480757304470307016", sportType: 100, duration: 3110 }
  ).movingTime,
  undefined
);

// The list API (/activity/query) row for the same run, in whole seconds:
// totalTime is elapsed, workoutTime is moving.
const pausedRunListRow = {
  labelId: "480757304470307016",
  sportType: 100,
  totalTime: 3110,
  workoutTime: 2499,
  distance: 7007.61
};
const pausedRunListed = mapTrainingHubActivity(pausedRunListRow);
assert.equal(pausedRunListed.activityId, "480757304470307016");
assert.equal(pausedRunListed.duration, 3110);
assert.equal(pausedRunListed.movingTime, 2499);
// Long activities stay in seconds: no 0.01 s rescaling above 10,000.
assert.equal(
  mapTrainingHubActivity({ ...pausedRunListRow, totalTime: 15_000, workoutTime: 14_000 }).movingTime,
  14_000
);
// Missing, zero, or longer-than-elapsed moving time falls back to elapsed.
for (const workoutTime of [undefined, 0, 3111]) {
  assert.equal(mapTrainingHubActivity({ ...pausedRunListRow, workoutTime }).movingTime, undefined);
}
assert.equal(
  mapTrainingHubActivity({ ...pausedRunListRow, totalTime: undefined }).movingTime,
  2499
);

// A detail without workoutTime takes the list's moving time.
const { movingTime: _dropped, ...pausedRunNoMoving } = pausedRun;
assert.equal(
  mergeActivityDetailWithList(pausedRunNoMoving, pausedRunListed).movingTime,
  2499
);

const flatLapFixture = {
  summary: {
    totalTime: 248900,
    distance: 658000
  },
  lapList: [
    {
      distance: 1000000,
      totalTime: 37700,
      avgHr: 168,
      maxHr: 176
    },
    {
      distance: 1000000,
      totalTime: 37700,
      avgHr: 174,
      maxHr: 182
    }
  ]
};

const flatDetail = parseActivityDetail(flatLapFixture);

assert.equal(flatDetail.duration, 2489);
assert.equal(flatDetail.distance, 6580);
assert.equal(flatDetail.laps.length, 2);
assert.equal(flatDetail.laps[0]?.distance, 10000);
assert.equal(flatDetail.laps[0]?.duration, 377);
assert.equal(flatDetail.track, undefined);

const frequencyOnlyFixture = {
  summary: {
    totalTime: 360000,
    distance: 1000000
  },
  frequencyList: [
    { distance: 0, altitude: 9500 },
    { distance: 50000, altitude: 9800 },
    { distance: 100000, altitude: 10200 }
  ]
};

const frequencyDetail = parseActivityDetail(frequencyOnlyFixture);

assert.ok(frequencyDetail.track);
assert.equal(frequencyDetail.track?.points.length, 3);
assert.equal(frequencyDetail.track?.points[0]?.elevation, 95);
assert.equal(frequencyDetail.track?.points[0]?.lat, undefined);

const walkFixture = {
  summary: {
    totalTime: 220500,
    distance: 346000
  },
  lapList: [
    {
      type: 10,
      lapItemList: [
        { distance: 86500, time: 52500, avgHr: 132, maxHr: 146, elevGain: 600 },
        { distance: 86300, time: 52700, avgHr: 133, maxHr: 146, elevGain: 500 },
        { distance: 87500, time: 51000, avgHr: 137, maxHr: 145, elevGain: 400 },
        { distance: 78400, time: 58700, avgHr: 128, maxHr: 139, elevGain: 700 }
      ]
    }
  ]
};

const walkDetail = parseActivityDetail(walkFixture);

assert.equal(walkDetail.distance, 3460);
assert.equal(walkDetail.laps.length, 4);
assert.equal(walkDetail.laps[0]?.distance, 865);
assert.equal(walkDetail.laps[1]?.distance, 863);
assert.deepEqual(walkDetail.lapGroups, []);

// lapList carries every grouping Training Hub offers: type 2 = the watch's
// laps, 10/11/12 = 1/5/10 km splits, -1 = whole activity. Shapes and order
// from a live 16.2 km PACE Pro run, 2026-10-19.
const kmLap = (time, avgHr) => ({ distance: 100000, time, avgHr });
const splitRun = parseActivityDetail({
  summary: { totalTime: 773000, workoutTime: 726358, distance: 1624537 },
  lapList: [
    {
      type: 11,
      lapDistance: 500000,
      fastLapIndexList: [0],
      lapItemList: [
        { distance: 500000, time: 211995, avgHr: 166 },
        { distance: 500000, time: 225465, avgHr: 161 },
        { distance: 500000, time: 230810, avgHr: 152 },
        { distance: 124537, time: 58088, avgHr: 150 }
      ]
    },
    {
      type: 12,
      lapDistance: 1000000,
      fastLapIndexList: [0],
      lapItemList: [
        { distance: 1000000, time: 437460, avgHr: 164 },
        { distance: 624537, time: 288898, avgHr: 152 }
      ]
    },
    {
      type: 2,
      lapDistance: 100000,
      fastLapIndexList: [1],
      lapItemList: [kmLap(43754, 155), kmLap(42346, 165), kmLap(42589, 173)]
    },
    {
      type: -1,
      lapDistance: 1624537,
      fastLapIndexList: [1],
      lapItemList: [{ distance: 1624537, time: 726358, avgHr: 159 }]
    }
  ]
});

assert.deepEqual(
  splitRun.lapGroups.map((group) => [group.kind, group.splitDistance, group.laps.length]),
  [
    ["laps", undefined, 3],
    ["split", 5000, 4],
    ["split", 10000, 2],
    ["whole", undefined, 1]
  ]
);
assert.deepEqual(splitRun.lapGroups[0].fastestLaps, [1]);
assert.deepEqual(splitRun.lapGroups[3].fastestLaps, []);
assert.equal(splitRun.lapGroups[1].laps[3]?.distance, 1245.37);
assert.equal(splitRun.lapGroups[3].laps[0]?.duration, 7264);
assert.equal(splitRun.laps.length, 4, "detail.laps keeps its most-populated pick");

// A ride without auto-lap: its one watch lap is the whole ride, so only the
// 1 km splits and the whole activity remain. Unknown types are ignored.
const ride = parseActivityDetail({
  summary: { totalTime: 101739, distance: 307064 },
  lapList: [
    {
      type: 10,
      lapDistance: 100000,
      fastLapIndexList: [1, 9],
      lapItemList: [
        { distance: 100000, time: 29340 },
        { distance: 100000, time: 24733 },
        { distance: 107064, time: 47666 }
      ]
    },
    { type: 2, lapDistance: 500000, lapItemList: [{ distance: 307064, time: 101739 }] },
    { type: 7, lapItemList: [{ distance: 1, time: 1 }, { distance: 2, time: 2 }] },
    { type: -1, lapItemList: [{ distance: 307064, time: 101739 }] }
  ]
});

assert.deepEqual(
  ride.lapGroups.map((group) => [group.kind, group.splitDistance]),
  [
    ["split", 1000],
    ["whole", undefined]
  ]
);
assert.deepEqual(ride.lapGroups[0].fastestLaps, [1], "out-of-range fastest indexes are dropped");

// Workout steps under 100 s are still 0.01 s: a 60 s rest is 6000, a 400 m
// rep 9880 (live "Taper 400s", 2026-07-02), not 1:40:00 and 2:44:40.
const intervals = parseActivityDetail({
  summary: { totalTime: 310000, distance: 648857 },
  lapList: [
    {
      type: 2,
      lapItemList: [
        { distance: 250000, time: 107460 },
        { distance: 5980, time: 6000 },
        { distance: 40000, time: 9880 },
        { distance: 1437, time: 521 },
        { distance: 9305, startTimestamp: 178302874500, endTimestamp: 178302883500 }
      ]
    }
  ]
});

assert.deepEqual(
  intervals.laps.map((lap) => lap.duration),
  [1075, 60, 99, 5, 90]
);

// One lap and the whole activity are the same row: no grouping to offer.
const openWater = parseActivityDetail({
  summary: { totalTime: 162840, distance: 18321 },
  lapList: [
    { type: 2, lapDistance: 50000, lapItemList: [{ distance: 18321, time: 162840 }] },
    { type: -1, lapItemList: [{ distance: 18321, time: 162840 }] }
  ]
});

assert.deepEqual(openWater.lapGroups, []);

console.log("Activity detail parser tests passed.");
