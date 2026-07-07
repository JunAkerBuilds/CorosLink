import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { parseSleepDataResponse, pickLatestSleepRecord, sleepResponseQuality } = await import(
  `${distUrl("sleepDataService.js")}?cacheBust=${Date.now()}`
);

const officialPayload = JSON.stringify({
  records: [
    {
      date: "20260701",
      sleepScore: 82,
      totalDurationMinutes: 432,
      phases: {
        deepMinutes: 72,
        lightMinutes: 240,
        remMinutes: 96,
        awakeMinutes: 24
      },
      avgHeartRate: 52,
      napMinutes: 0
    }
  ],
  count: 1
});

const communityPayload = JSON.stringify({
  records: [
    {
      date: "20260702",
      quality_score: 76,
      total_duration_minutes: 405,
      phases: {
        deep_minutes: 68,
        light_minutes: 220,
        rem_minutes: 88,
        awake_minutes: 29,
        nap_minutes: 15
      },
      avg_hr: 54
    }
  ]
});

const markdownPayload = [
  "Sleep data:",
  "```json",
  JSON.stringify({
    sleepList: [
      {
        happenDay: "20260703",
        score: 88,
        totalMinutes: 450,
        deepMinutes: 80,
        lightMinutes: 250,
        remMinutes: 90,
        awakeMinutes: 30
      }
    ]
  }),
  "```"
].join("\n");

const officialRecords = parseSleepDataResponse(officialPayload);
assert.equal(officialRecords.length, 1);
assert.equal(officialRecords[0].happenDay, "20260701");
assert.equal(officialRecords[0].score, 82);
assert.equal(officialRecords[0].totalMinutes, 432);
assert.equal(officialRecords[0].deepMinutes, 72);
assert.equal(officialRecords[0].avgHr, 52);

const communityRecords = parseSleepDataResponse(communityPayload);
assert.equal(communityRecords.length, 1);
assert.equal(communityRecords[0].happenDay, "20260702");
assert.equal(communityRecords[0].score, 76);
assert.equal(communityRecords[0].napMinutes, 15);

const markdownRecords = parseSleepDataResponse(markdownPayload);
assert.equal(markdownRecords.length, 1);
assert.equal(markdownRecords[0].happenDay, "20260703");
assert.equal(markdownRecords[0].remMinutes, 90);

const structuredPayload = JSON.stringify({
  sleepDataList: [
    {
      happenDay: "20260707",
      sleepScore: 34,
      mainSleepMinutes: 388,
      awakeTimeMinutes: 130,
      deepSleepPercent: 18,
      lightSleepPercent: 52,
      remPercent: 5,
      awakeCountOverFiveMinutes: 4,
      sleepWindowStart: "23:23",
      sleepWindowEnd: "08:01",
      napMinutes: 0
    }
  ]
});
const structuredRecords = parseSleepDataResponse(structuredPayload);
assert.equal(structuredRecords.length, 1);
assert.equal(structuredRecords[0].score, 34);
assert.equal(structuredRecords[0].totalMinutes, 388);
assert.equal(structuredRecords[0].awakeMinutes, 130);
assert.equal(structuredRecords[0].windowMinutes, 518);
assert.equal(structuredRecords[0].deepPercent, 18);
assert.equal(structuredRecords[0].lightPercent, 52);
assert.equal(structuredRecords[0].remPercent, 5);
assert.equal(Math.round(structuredRecords[0].awakePercent ?? 0), 25);
assert.equal(structuredRecords[0].deepMinutes, 93);
assert.equal(structuredRecords[0].remMinutes, 26);
assert.equal(structuredRecords[0].lightMinutes, 269);
assert.equal(structuredRecords[0].awakeCountOverFiveMinutes, 4);
assert.equal(structuredRecords[0].napMinutes, 0);
assert.equal(structuredRecords[0].completeness, "complete");

const prosePayload = [
  "Sleep for Tue, Jul 7",
  "Sleep score: 34 — poor",
  "Main sleep: 6h 28min",
  "Sleep window: 23:23–08:01",
  "Awake time: 2h 10min",
  "Awake count >5 min: 4",
  "Deep: 18%",
  "Light: 52%",
  "REM: 5%",
  "Naps: 0 min"
].join("\n");
const proseRecords = parseSleepDataResponse(prosePayload);
assert.equal(proseRecords.length, 1);
assert.equal(proseRecords[0].score, 34);
assert.equal(proseRecords[0].totalMinutes, 388);
assert.equal(proseRecords[0].awakeMinutes, 130);
assert.equal(proseRecords[0].deepMinutes, 93);
assert.equal(proseRecords[0].lightMinutes, 269);
assert.equal(proseRecords[0].remMinutes, 26);
assert.equal(proseRecords[0].awakeCountOverFiveMinutes, 4);
assert.equal(proseRecords[0].napMinutes, 0);

const wrappedLivePayload = JSON.stringify({
  text: JSON.stringify(
    [
      "Sleep Data",
      "========================",
      "",
      "2026-07-07",
      "Sleep Score: 34",
      "Main Sleep: 6h 28min",
      "Deep Sleep Ratio: 18%",
      "Light Sleep Ratio: 52%",
      "REM Ratio: 5%",
      "Awake Ratio: 25%",
      "Awake Time: 2h 10min",
      "Awake Count (>5 min): 4",
      "Main Sleep Window: 23:23 - 08:01",
      "Naps Total: 0 min"
    ].join("\n")
  )
});
const wrappedLiveRecords = parseSleepDataResponse(wrappedLivePayload);
assert.equal(wrappedLiveRecords.length, 1);
assert.equal(wrappedLiveRecords[0].happenDay, "20260707");
assert.equal(wrappedLiveRecords[0].score, 34);
assert.equal(wrappedLiveRecords[0].totalMinutes, 388);
assert.equal(wrappedLiveRecords[0].windowMinutes, 518);
assert.equal(wrappedLiveRecords[0].deepPercent, 18);
assert.equal(wrappedLiveRecords[0].lightPercent, 52);
assert.equal(wrappedLiveRecords[0].remPercent, 5);
assert.equal(wrappedLiveRecords[0].awakePercent, 25);
assert.equal(wrappedLiveRecords[0].awakeMinutes, 130);
assert.equal(wrappedLiveRecords[0].awakeCountOverFiveMinutes, 4);
assert.equal(wrappedLiveRecords[0].sleepStart, "23:23");
assert.equal(wrappedLiveRecords[0].sleepEnd, "08:01");
assert.equal(wrappedLiveRecords[0].napMinutes, 0);
assert.equal(wrappedLiveRecords[0].completeness, "complete");

assert.deepEqual(parseSleepDataResponse(""), []);

const jul6BundlePayload = JSON.stringify({
  sleepDataList: [
    {
      happenDay: "20260706",
      sleepScore: 70,
      mainSleepMinutes: 410,
      awakeTimeMinutes: 39,
      deepSleepPercent: 14,
      remPercent: 17,
      sleepWindowStart: "23:58",
      sleepWindowEnd: "07:27",
      napMinutes: 71,
      napStart: "18:28",
      napEnd: "19:39"
    },
    {
      happenDay: "20260707",
      sleepScore: 43,
      mainSleepMinutes: 309,
      awakeTimeMinutes: 43,
      sleepWindowStart: "18:28",
      sleepWindowEnd: "19:39"
    }
  ]
});
const jul6Records = parseSleepDataResponse(jul6BundlePayload);
const jul6Latest = pickLatestSleepRecord(jul6Records);
assert.equal(jul6Latest?.happenDay, "20260706");
assert.equal(jul6Latest?.score, 70);
assert.equal(jul6Latest?.totalMinutes, 410);
assert.equal(jul6Latest?.awakeMinutes, 39);
assert.equal(jul6Latest?.deepMinutes, 63);
assert.equal(jul6Latest?.remMinutes, 76);
assert.equal(jul6Latest?.sleepStart, "23:58");
assert.equal(jul6Latest?.sleepEnd, "07:27");
assert.equal(jul6Latest?.napMinutes, 71);
assert.equal(jul6Latest?.napStart, "18:28");
assert.equal(jul6Latest?.napEnd, "19:39");

const mobileApiPayload = JSON.stringify({
  statisticData: {
    dayDataList: [
      {
        happenDay: 20260707,
        performance: 70,
        sleepData: {
          totalSleepTime: 410,
          deepTime: 57,
          lightTime: 244,
          eyeTime: 70,
          wakeTime: 39,
          shortSleepTime: 71,
          fallAsleepTime: "23:58",
          wakeUpTime: "07:27"
        }
      }
    ]
  }
});
const mobileRecords = parseSleepDataResponse(mobileApiPayload);
const mobileLatest = pickLatestSleepRecord(mobileRecords);
assert.equal(mobileLatest?.score, 70);
assert.equal(mobileLatest?.totalMinutes, 410);
assert.equal(mobileLatest?.deepMinutes, 57);
assert.equal(mobileLatest?.remMinutes, 70);
assert.equal(mobileLatest?.napMinutes, 71);
assert.equal(mobileLatest?.sleepStart, "23:58");
assert.equal(mobileLatest?.sleepEnd, "07:27");

const partialStructuredPayload = JSON.stringify({
  sleepDataList: [
    {
      happenDay: "20260706",
      sleepScore: 70,
      mainSleepMinutes: 410,
      awakeTimeMinutes: 39,
      deepSleepPercent: 14,
      remPercent: 17,
      sleepWindowStart: "23:58",
      sleepWindowEnd: "07:27",
      napMinutes: 71,
      napStart: "18:28",
      napEnd: "19:39"
    },
    {
      happenDay: "20260707",
      sleepScore: 71,
      totalSleepTime: 316,
      deepTime: 0,
      lightTime: 292,
      eyeTime: 0,
      wakeTime: 24,
      fallAsleepTime: "22:40",
      wakeUpTime: "04:20"
    }
  ]
});
const partialStructuredLatest = pickLatestSleepRecord(
  parseSleepDataResponse(partialStructuredPayload)
);
assert.equal(partialStructuredLatest?.happenDay, "20260707");
assert.equal(partialStructuredLatest?.score, 71);
assert.equal(partialStructuredLatest?.totalMinutes, 316);
assert.equal(partialStructuredLatest?.sleepStart, "22:40");
assert.equal(partialStructuredLatest?.sleepEnd, "04:20");
assert.equal(partialStructuredLatest?.completeness, "partial");
assert.match(partialStructuredLatest?.partialReason ?? "", /stages/i);

const latestSyncedPayload = [
  JSON.stringify({
    sleepDataList: [
      {
        happenDay: "20260706",
        sleepScore: 70,
        mainSleepMinutes: 410,
        awakeTimeMinutes: 39,
        deepSleepPercent: 14,
        remPercent: 17,
        sleepWindowStart: "23:58",
        sleepWindowEnd: "07:27",
        napMinutes: 71,
        napStart: "18:28",
        napEnd: "19:39"
      }
    ]
  }),
  [
    "Sleep for 2026-07-07",
    "Sleep score: 34 — poor",
    "Main sleep: 6h 28min",
    "Sleep window: 23:23–08:01",
    "Awake time: 2h 10min",
    "Awake ratio: 25%",
    "Wake-ups >5 min: 4",
    "Deep sleep: 18%",
    "Light: 52%",
    "REM: 5%",
    "Naps: 0 min"
  ].join("\n")
].join("\n");
const latestSynced = pickLatestSleepRecord(parseSleepDataResponse(latestSyncedPayload));
assert.equal(latestSynced?.happenDay, "20260707");
assert.equal(latestSynced?.score, 34);
assert.equal(latestSynced?.totalMinutes, 388);
assert.equal(latestSynced?.awakeMinutes, 130);
assert.equal(latestSynced?.windowMinutes, 518);
assert.equal(latestSynced?.deepPercent, 18);
assert.equal(latestSynced?.lightPercent, 52);
assert.equal(latestSynced?.remPercent, 5);
assert.equal(latestSynced?.awakePercent, 25);
assert.equal(latestSynced?.deepMinutes, 93);
assert.equal(latestSynced?.lightMinutes, 269);
assert.equal(latestSynced?.remMinutes, 26);
assert.equal(latestSynced?.awakeCountOverFiveMinutes, 4);
assert.equal(latestSynced?.sleepStart, "23:23");
assert.equal(latestSynced?.sleepEnd, "08:01");
assert.equal(latestSynced?.napMinutes, 0);
assert.equal(latestSynced?.completeness, "complete");

const partialOnlyRecords = parseSleepDataResponse(
  JSON.stringify({
    sleepDataList: [
      {
        happenDay: "20260707",
        sleepScore: 71,
        totalSleepTime: 316,
        deepTime: 0,
        lightTime: 292,
        eyeTime: 0,
        wakeTime: 24,
        fallAsleepTime: "22:40",
        wakeUpTime: "04:20"
      }
    ]
  })
);
const partialOnlyLatest = pickLatestSleepRecord(partialOnlyRecords);
assert.equal(partialOnlyLatest?.happenDay, "20260707");
assert.equal(partialOnlyLatest?.score, 71);
assert.equal(partialOnlyLatest?.completeness, "partial");
assert(
  sleepResponseQuality(parseSleepDataResponse(latestSyncedPayload)) >
    sleepResponseQuality(partialOnlyRecords)
);

const completeBeatsPartialSameDay = pickLatestSleepRecord(
  parseSleepDataResponse(
    [
      JSON.stringify({
        sleepDataList: [
          {
            happenDay: "20260707",
            sleepScore: 71,
            totalSleepTime: 316,
            deepTime: 0,
            lightTime: 292,
            eyeTime: 0,
            wakeTime: 24,
            fallAsleepTime: "22:40",
            wakeUpTime: "04:20"
          }
        ]
      }),
      [
        "Sleep for 2026-07-07",
        "Sleep score: 34 — poor",
        "Main sleep: 6h 28min",
        "Sleep window: 23:23–08:01",
        "Awake time: 2h 10min",
        "Deep: 18%",
        "Light: 52%",
        "REM: 5%",
        "Naps: 0 min"
      ].join("\n")
    ].join("\n")
  )
);
assert.equal(completeBeatsPartialSameDay?.score, 34);
assert.equal(completeBeatsPartialSameDay?.completeness, "complete");

const combinedPayload = [
  "Sleep for 2026-07-06",
  "Sleep score: 70 — okay, but not great",
  "Main sleep: 6h 50min",
  "Sleep window: 23:58–07:27",
  "Awake time: 39 min",
  "Deep sleep: 14%",
  "REM: 17%",
  "Nap: 1h 11min in the evening, 18:28–19:39",
  JSON.stringify({
    statisticData: {
      dayDataList: [
        {
          happenDay: 20260707,
          performance: 71,
          sleepData: {
            totalSleepTime: 316,
            deepTime: 0,
            lightTime: 292,
            eyeTime: 0,
            wakeTime: 24,
            fallAsleepTime: "22:40",
            wakeUpTime: "04:20"
          }
        }
      ]
    }
  })
].join("\n");
const combinedLatest = pickLatestSleepRecord(parseSleepDataResponse(combinedPayload));
assert.equal(combinedLatest?.happenDay, "20260707");
assert.equal(combinedLatest?.score, 71);
assert.equal(combinedLatest?.totalMinutes, 316);
assert.equal(combinedLatest?.completeness, "partial");

console.log("test-sleep-data-parser: ok");
