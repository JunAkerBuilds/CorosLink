import assert from "node:assert/strict";
import { parsePersonalRecordGroups } from "../dist-electron/trainingHubService.js";

const fixture = {
  recordDetailList: [
    {
      type: 1,
      recordList: [
        {
          type: 10,
          record: 184900,
          avgPace: 370,
          happenDay: 20260627
        },
        {
          type: 10,
          record: 178200,
          avgPace: 356,
          happenDay: 20250518,
          name: "5 km"
        },
        {
          type: 0,
          record: 184900,
          avgPace: 370,
          happenDay: 20260627,
          name: "5 km"
        },
        {
          type: 102,
          record: 357,
          avgPace: 357,
          happenDay: 20260610
        },
        {
          type: 101,
          record: 755000,
          distance: 21600,
          happenDay: 20260627
        },
        {
          type: 100,
          distance: 7550,
          date: 20260627,
          site: "Longest Run"
        },
        {
          type: 101,
          distance: 755,
          happenDay: 20260627
        },
        {
          type: 103,
          record: 36,
          time: 8400,
          avgPace: 368,
          happenDay: 20260628
        },
        {
          type: 11,
          record: 0,
          happenDay: 0
        }
      ]
    }
  ]
};

const groups = parsePersonalRecordGroups(fixture.recordDetailList);
assert.equal(groups[0]?.label, "All");
const records = groups[0]?.records ?? [];

assert.equal(records.length, 5);

const longestRun = records.find((record) => record.type === 101);
assert.equal(longestRun?.distance, 7550);

const fiveK = records.find((record) => record.label === "5K");
assert.equal(fiveK?.duration, 1782);
assert.equal(fiveK?.avgPace, 356.4);
assert.equal(records.filter((record) => record.label === "5K" || record.label === "5 km").length, 1);

assert.equal(records.some((record) => record.type === 102), false);

const elevation = records.find((record) => record.type === 103);
assert.equal(elevation?.distance, 84);
assert.equal(elevation?.avgPace, 368);

const halfMarathon = records.find((record) => record.type === 12);
assert.equal(halfMarathon?.label, "Half Marathon");
assert.equal(halfMarathon?.duration, undefined);

const marathon = records.find((record) => record.type === 13);
assert.equal(marathon?.label, "Marathon");
assert.equal(marathon?.duration, undefined);

assert.equal(records.some((record) => record.type === 11), false);

const periodGroups = parsePersonalRecordGroups([
  {
    type: 1,
    recordList: [
      {
        type: 10,
        record: 178200,
        avgPace: 356,
        happenDay: 20250518
      }
    ]
  },
  {
    type: 3,
    recordList: [
      {
        type: 10,
        record: 184700,
        avgPace: 369,
        happenDay: 20260620
      }
    ]
  },
  {
    type: 2,
    recordList: [
      {
        type: 10,
        record: 184500,
        avgPace: 369,
        happenDay: 20260615
      }
    ]
  },
  {
    type: 4,
    recordList: [
      {
        type: 10,
        record: 184900,
        avgPace: 370,
        happenDay: 20260627
      }
    ]
  }
]);

assert.equal(periodGroups.length, 4);
assert.equal(periodGroups[0]?.label, "4 weeks");
assert.equal(periodGroups[1]?.label, "12 weeks");
assert.equal(periodGroups[2]?.label, "Half year");
assert.equal(periodGroups[3]?.label, "All");
assert.equal(periodGroups[0]?.records[0]?.duration, 1849);
assert.equal(periodGroups[1]?.records[0]?.duration, 1847);
assert.equal(periodGroups[2]?.records[0]?.duration, 1845);
assert.equal(periodGroups[3]?.records[0]?.duration, 1782);
assert.equal(periodGroups[0]?.records[0]?.avgPace, 369.8);

const tenKFixture = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 11,
        record: 512700,
        avgPace: 54300,
        happenDay: 20260628
      }
    ]
  }
])[0]?.records[0];

assert.equal(tenKFixture?.duration, 5127);
assert.equal(tenKFixture?.avgPace, 512.7);

const halfYearGroup = parsePersonalRecordGroups([
  {
    type: 2,
    recordList: [
      {
        type: 10,
        record: 184900,
        avgPace: 370,
        happenDay: 20260627
      },
      {
        type: 0,
        record: 178200,
        avgPace: 356,
        happenDay: 20260627,
        name: "5 km"
      },
      {
        type: 10,
        record: 178200,
        avgPace: 356,
        happenDay: 20260627
      }
    ]
  }
])[0];

assert.equal(halfYearGroup?.label, "Half year");
assert.equal(halfYearGroup?.records[0]?.duration, 1849);
assert.equal(halfYearGroup?.records[0]?.avgPace, 369.8);

const recordTimePriority = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 10,
        record: 184900,
        time: 178200,
        avgPace: 370,
        happenDay: 20260627
      }
    ]
  }
])[0]?.records[0];

assert.equal(recordTimePriority?.duration, 1849);
assert.equal(recordTimePriority?.avgPace, 369.8);

const swappedRecordTime = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 10,
        record: 178200,
        time: 184900,
        avgPace: 370,
        happenDay: 20260627
      }
    ]
  }
])[0]?.records[0];

assert.equal(swappedRecordTime?.duration, 1849);
assert.equal(swappedRecordTime?.avgPace, 369.8);

const allPeriodSegmentPair = parsePersonalRecordGroups([
  {
    type: 1,
    recordList: [
      {
        type: 10,
        record: 178200,
        time: 184900,
        avgPace: 356,
        happenDay: 20250518
      }
    ]
  }
])[0]?.records[0];

assert.equal(allPeriodSegmentPair?.duration, 1849);
assert.equal(allPeriodSegmentPair?.avgPace, 369.8);

const longestRunPace = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 101,
        record: 1201000,
        time: 120,
        avgPace: 368,
        happenDay: 20260628
      }
    ]
  }
])[0]?.records[0];

assert.equal(longestRunPace?.distance, 12010);
assert.equal(longestRunPace?.avgPace, 368);
assert.notEqual(longestRunPace?.avgPace, 10);

const elevGainAlias = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 0,
        record: 36,
        time: 8400,
        happenDay: 20260628,
        site: "Most Elev Gain"
      }
    ]
  }
])[0]?.records[0];

assert.equal(elevGainAlias?.type, 103);
assert.equal(elevGainAlias?.distance, 84);

const corosType102Elevation = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 102,
        record: 84,
        avgPace: 368,
        happenDay: 20260628,
        labelIdStr: "478529681556013058",
        site: "12km Long Run"
      }
    ]
  }
])[0]?.records[0];

assert.equal(corosType102Elevation?.type, 103);
assert.equal(corosType102Elevation?.distance, 84);
assert.equal(corosType102Elevation?.avgPace, 368);
assert.equal(corosType102Elevation?.activityId, "478529681556013058");

const coros5kActivity = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 10,
        record: 178200,
        avgPace: 370,
        happenDay: 20260627,
        labelIdStr: "478506322034196580"
      }
    ]
  }
])[0]?.records[0];

assert.equal(coros5kActivity?.duration, 1850);
assert.equal(coros5kActivity?.avgPace, 370);
assert.equal(coros5kActivity?.activityId, "478506322034196580");

const coros5kWithBestField = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 10,
        record: 178200,
        best: 184900,
        avgPace: 370,
        happenDay: 20260627,
        labelIdStr: "478506322034196580"
      }
    ]
  }
])[0]?.records[0];

assert.equal(coros5kWithBestField?.duration, 1849);

const coros5kBestOverRecord = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 10,
        record: 184500,
        best: 184900,
        avgPace: 370,
        happenDay: 20260627,
        labelIdStr: "478506322034196580"
      }
    ]
  }
])[0]?.records[0];

assert.equal(coros5kBestOverRecord?.duration, 1849);
assert.equal(coros5kBestOverRecord?.avgPace, 369.8);

const corosLiveFiveKBoard = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 10,
        record: 1782,
        duration: 1782,
        distance: 4828.03,
        avgPace: 369,
        happenDay: 20260627,
        labelIdStr: "478506322034196580",
        name: "Rolling 400s"
      },
      {
        type: 5,
        record: 1849,
        duration: 1849,
        distance: 5000,
        avgPace: 370,
        happenDay: 20260627,
        labelIdStr: "478506322034196580",
        name: "Rolling 400s"
      }
    ]
  }
])[0]?.records.find((record) => record.label === "5K");

assert.equal(corosLiveFiveKBoard?.duration, 1849);
assert.equal(corosLiveFiveKBoard?.apiType, 5);

const corosFourWeeksBoard = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 103,
        record: 36,
        time: 8400,
        avgPace: 368,
        happenDay: 20260628
      },
      {
        type: 101,
        record: 1201000,
        avgPace: 368,
        happenDay: 20260628
      },
      {
        type: 7,
        record: 28400,
        avgPace: 284,
        happenDay: 20260627
      },
      {
        type: 6,
        record: 100500,
        avgPace: 335,
        happenDay: 20260627
      },
      {
        type: 10,
        record: 178200,
        time: 184900,
        avgPace: 370,
        happenDay: 20260627,
        labelIdStr: "478506322034196580"
      },
      {
        type: 11,
        record: 512700,
        avgPace: 513,
        happenDay: 20260628
      }
    ]
  }
])[0]?.records ?? [];

assert.equal(
  corosFourWeeksBoard.find((record) => record.label === "5K")?.duration,
  1849
);
assert.equal(
  corosFourWeeksBoard.find((record) => record.label === "10K")?.duration,
  5127
);
assert.equal(
  corosFourWeeksBoard.find((record) => record.type === 103)?.distance,
  84
);
assert.equal(
  corosFourWeeksBoard.find((record) => record.type === 101)?.distance,
  12010
);

const currentCorosDistanceBoard = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: [
      {
        type: 3,
        distance: 15000,
        duration: 9759,
        avgPace: 651,
        happenDay: 20260705
      },
      {
        type: 4,
        distance: 10000,
        duration: 5127,
        avgPace: 513,
        happenDay: 20260628
      },
      {
        type: 10,
        distance: 4828.03,
        duration: 1268,
        avgPace: 263,
        happenDay: 20260701
      },
      {
        type: 11,
        distance: 8046.7,
        duration: 3995,
        avgPace: 496,
        happenDay: 20260705
      }
    ]
  }
])[0]?.records ?? [];

assert.deepEqual(
  currentCorosDistanceBoard
    .filter((record) => [3, 4, 10, 11].includes(record.type))
    .map((record) => [record.label, record.duration]),
  [
    ["3 Mile", 1268],
    ["5 Mile", 3995],
    ["10K", 5127],
    ["15K", 9759]
  ]
);

const emptyGroup = parsePersonalRecordGroups([
  {
    type: 4,
    recordList: []
  }
])[0];

assert.equal(emptyGroup?.records.length, 3);
assert.deepEqual(
  emptyGroup?.records.map((record) => record.type).sort((left, right) => left - right),
  [12, 13, 103]
);
assert.equal(
  emptyGroup?.records.every(
    (record) =>
      record.duration === undefined &&
      record.distance === undefined &&
      record.avgPace === undefined
  ),
  true
);

console.log("personal record parsing tests passed");
