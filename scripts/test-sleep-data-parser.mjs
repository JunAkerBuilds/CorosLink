import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildSleepToolArgs,
  fetchSleepRecords,
  parseSleepDataResponse,
  pickLatestSleepRecord,
  setSleepToolCallerForTests,
  sleepResponseQuality
} = await import(`${distUrl("sleepDataService.js")}?cacheBust=${Date.now()}`);
const { recentTrainingHubDateList } = await import(distUrl("trainingTrendUtils.js"));

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

const officialDailyPayload = JSON.stringify({
  data: {
    dailyList: [
      {
        happenDay: 20260721,
        performance: 93,
        sleepStartTime: "2026-07-20 22:58:00",
        sleepEndTime: "2026-07-21 05:43:00",
        sleepData: {
          totalSleepTime: 397,
          deepTime: 64,
          lightTime: 234,
          eyeTime: 91,
          wakeTime: 8,
          shortSleepTime: 0
        }
      }
    ]
  }
});
const officialDailyLatest = pickLatestSleepRecord(
  parseSleepDataResponse(officialDailyPayload)
);
assert.equal(officialDailyLatest?.score, 93);
assert.equal(officialDailyLatest?.totalMinutes, 397);
assert.equal(officialDailyLatest?.sleepStart, "22:58");
assert.equal(officialDailyLatest?.sleepEnd, "05:43");
assert.equal(officialDailyLatest?.windowMinutes, 405);

const fullTimestampProsePayload = [
  "2026-07-21",
  "Sleep Score: 93",
  "Main Sleep: 6h 37min",
  "Deep Sleep Ratio: 16%",
  "Light Sleep Ratio: 59%",
  "REM Ratio: 23%",
  "Awake Ratio: 2%",
  "Awake Time: 8min",
  "Main Sleep Window: 2026-07-20 10:58:00 PM to 2026-07-21 05:43:00 AM",
  "Naps Total: 0 min"
].join("\n");
const fullTimestampProseLatest = pickLatestSleepRecord(
  parseSleepDataResponse(fullTimestampProsePayload)
);
assert.equal(fullTimestampProseLatest?.sleepStart, "22:58");
assert.equal(fullTimestampProseLatest?.sleepEnd, "05:43");
assert.equal(fullTimestampProseLatest?.windowMinutes, 405);

// querySleepOverview (2026-10): asleep vs in-bed lines, and an empty day before the real one.
const sleepOverviewPayload = JSON.stringify([
  "Sleep Overview",
  "========================",
  "Note: each record below is dated by its wake-up day.",
  "",
  "2026-10-19",
  "Sleep Score: 0",
  "Sleep detail for this day is not available yet.",
  "",
  "2026-10-20",
  "Sleep Score: 62",
  "Daily Sleep: 5h 56min (incl. naps)",
  "Main Sleep (asleep): 5h 56min",
  "Main Sleep Period (incl. awake): 7h 32min",
  "Sleep metrics scope: daily",
  "Deep Sleep Ratio: 14%",
  "Light Sleep Ratio: 57%",
  "REM Ratio: 8%",
  "Awake Ratio: 21%",
  "Awake Time: 1h 36min",
  "Awake Count (>5 min): 3",
  "Main Sleep Window: 2026-10-20 00:57 - 2026-10-20 08:29",
  "Naps Total: 0 min"
].join("\n"));
const sleepOverviewLatest = pickLatestSleepRecord(parseSleepDataResponse(sleepOverviewPayload));
assert.equal(sleepOverviewLatest?.happenDay, "20261020");
assert.equal(sleepOverviewLatest?.totalMinutes, 356);
assert.equal(sleepOverviewLatest?.awakeMinutes, 96);
assert.equal(sleepOverviewLatest?.windowMinutes, 452);
assert.equal(sleepOverviewLatest?.completeness, "complete");
// The morning before a phone sync, today's empty day comes after last night's.
const sleepOverviewUnsyncedToday = parseSleepDataResponse(JSON.stringify([
  "2026-10-20",
  "Sleep Score: 62",
  "Main Sleep (asleep): 5h 56min",
  "",
  "2026-10-21",
  "Sleep Score: 0",
  "Sleep detail for this day is not available yet."
].join("\n")));
assert.deepEqual(sleepOverviewUnsyncedToday.map((record) => record.happenDay), ["20261020"]);
assert.equal(pickLatestSleepRecord(sleepOverviewUnsyncedToday)?.totalMinutes, 356);

// querySleepOverview naps (live 2026-10-23): a nap-only day scores -1, and a day with
// both lists the nap's asleep time, in-bed period and window after the main sleep.
const sleepOverviewNaps = parseSleepDataResponse(JSON.stringify([
  "2026-10-15",
  "Sleep Score: -1",
  "Daily Sleep: 56min (incl. naps)",
  "Sleep metrics scope: daily",
  "Naps Total (asleep): 56 min",
  "Naps Period (incl. awake): 1h 2min",
  "Nap Window: 2026-10-15 15:04 - 2026-10-15 16:06",
  "",
  "2026-10-22",
  "Sleep Score: 64",
  "Daily Sleep: 5h 5min (incl. naps)",
  "Main Sleep (asleep): 5h 5min",
  "Main Sleep Window: 2026-10-22 00:13 - 2026-10-22 05:30",
  "Naps Total: 0 min",
  "",
  "2026-10-23",
  "Sleep Score: 68",
  "Daily Sleep: 5h 30min (incl. naps)",
  "Main Sleep (asleep): 4h 12min",
  "Main Sleep Period (incl. awake): 4h 18min",
  "Sleep metrics scope: daily",
  "Deep Sleep Ratio: 32%",
  "Light Sleep Ratio: 53%",
  "REM Ratio: 13%",
  "Awake Ratio: 2%",
  "Awake Time: 6 min",
  "Awake Count (>5 min): 0",
  "Main Sleep Window: 2026-10-23 00:40 - 2026-10-23 04:58",
  "Naps Total (asleep): 1h 18min",
  "Naps Period (incl. awake): 1h 26min",
  "Nap Window: 2026-10-23 07:34 - 2026-10-23 09:00"
].join("\n")));
assert.deepEqual(
  sleepOverviewNaps.map((record) => `${record.happenDay}:${record.kind}`),
  ["20261015:nap", "20261022:main", "20261023:main", "20261023:nap"]
);
const napOnlyDay = sleepOverviewNaps[0];
assert.equal(napOnlyDay.score, undefined);
assert.equal(napOnlyDay.totalMinutes, 56);
assert.equal(napOnlyDay.windowMinutes, 62);
assert.equal(napOnlyDay.awakeMinutes, 6);
assert.equal(napOnlyDay.sleepStart, "15:04");
assert.equal(napOnlyDay.sleepEnd, "16:06");
assert.equal(sleepOverviewNaps[1].napMinutes, 0);
const napMorning = pickLatestSleepRecord(sleepOverviewNaps);
assert.equal(napMorning?.happenDay, "20261023");
assert.equal(napMorning?.totalMinutes, 252);
assert.equal(napMorning?.score, 68);
assert.equal(napMorning?.sleepStart, "00:40");
assert.equal(napMorning?.completeness, "complete");
assert.equal(napMorning?.napMinutes, 78);
assert.equal(napMorning?.napStart, "07:34");
assert.equal(napMorning?.napEnd, "09:00");
// Two naps: the total stands, but no single window does.
const twoNaps = parseSleepDataResponse(JSON.stringify([
  "2026-10-24",
  "Sleep Score: -1",
  "Naps Total (asleep): 1h 30min",
  "Nap Window: 2026-10-24 12:10 - 2026-10-24 12:40",
  "Nap Window: 2026-10-24 16:00 - 2026-10-24 17:05"
].join("\n")));
assert.deepEqual(twoNaps.map((record) => [record.kind, record.totalMinutes, record.sleepStart]), [["nap", 90, undefined]]);
assert.equal(pickLatestSleepRecord(twoNaps), undefined);

const rangeStringPayload = JSON.stringify({
  happenDay: 20260721,
  sleepScore: 93,
  mainSleepMinutes: 397,
  awakeTimeMinutes: 8,
  deepSleepPercent: 16,
  lightSleepPercent: 59,
  remPercent: 23,
  mainSleepWindow: "2026-07-20T22:58:00-04:00 — 2026-07-21T05:43:00-04:00"
});
const rangeStringLatest = pickLatestSleepRecord(
  parseSleepDataResponse(rangeStringPayload)
);
assert.equal(rangeStringLatest?.sleepStart, "22:58");
assert.equal(rangeStringLatest?.sleepEnd, "05:43");
assert.equal(rangeStringLatest?.windowMinutes, 405);

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

// Arg selection: querySleepOverview's live schema (2026-10-20) gets one compact range call.
const overviewTool = {
  name: "querySleepOverview",
  inputSchema: {
    type: "object",
    properties: {
      startDate: { type: "string", description: "Optional start date in yyyyMMdd format; dates are wake-up days" },
      endDate: { type: "string", description: "Optional end date in yyyyMMdd format; dates are wake-up days" },
      days: { type: "integer", description: "Number of recent days to query when no explicit date range is given, default 7" }
    },
    required: [],
    additionalProperties: false
  }
};
const recentDays = recentTrainingHubDateList(14);
const [todayDay, startDay] = [recentDays[0], recentDays[recentDays.length - 1]];
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const toIsoDay = (day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
const overviewPlan = buildSleepToolArgs(overviewTool, 14);
assert.deepEqual(overviewPlan.range, { startDate: startDay, endDate: todayDay, days: 14 });
assert.ok(overviewPlan.probes.length <= 3, JSON.stringify(overviewPlan.probes));
for (const probe of overviewPlan.probes) {
  assert.ok(Object.keys(probe).every((key) => ["startDate", "endDate", "days"].includes(key)), JSON.stringify(probe));
  assert.ok(Object.values(probe).every((value) => !isoDatePattern.test(String(value))), JSON.stringify(probe));
}

const rangeWithoutDaysPlan = buildSleepToolArgs(
  { name: "sleep_range", inputSchema: { type: "object", properties: { startDate: { type: "string" }, endDate: { type: "string" } } } },
  7
);
assert.deepEqual(rangeWithoutDaysPlan.range, { startDate: recentTrainingHubDateList(7)[6], endDate: todayDay });
// No documented format, so ISO stays a fallback probe — but only with declared keys.
assert.ok(rangeWithoutDaysPlan.probes.some((probe) => isoDatePattern.test(String(probe.startDate))));
assert.ok(rangeWithoutDaysPlan.probes.every((probe) => Object.keys(probe).every((key) => key === "startDate" || key === "endDate")));

const schemalessPlan = buildSleepToolArgs({ name: "querySleepData", inputSchema: { type: "object" } }, 14);
assert.equal(schemalessPlan.range, undefined);
assert.ok(schemalessPlan.probes.length >= 15, `schemaless probes: ${schemalessPlan.probes.length}`);
assert.ok(schemalessPlan.probes.some((probe) => typeof probe.query === "string"));
assert.ok(schemalessPlan.probes.some((probe) => probe.startDate === toIsoDay(startDay)));

const weeksPlan = buildSleepToolArgs(
  { name: "get_sleep_data", inputSchema: { type: "object", properties: { weeks: { type: "integer" } } } },
  14
);
assert.equal(weeksPlan.range, undefined);
assert.deepEqual(weeksPlan.probes, [{ weeks: 2 }, {}]);

// Fetch: stop after the range call finds records; an anomaly warning is a failure, not data.
const overviewText = [
  `Sleep for ${toIsoDay(todayDay)}`,
  "Sleep score: 62",
  "Main sleep: 5h 56min",
  "Sleep window: 00:57–08:29",
  "Awake time: 1h 36min",
  "Deep: 14%",
  "Light: 57%",
  "REM: 8%",
  "Naps: 0 min"
].join("\n");
const anomalyText =
  "Tool call anomalies detected. High risk of session context pollution. Please start a new session.";
async function fetchWith(tool, respond) {
  const calls = [];
  setSleepToolCallerForTests(async (name, args) => {
    calls.push(args);
    return respond(calls.length, args);
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return { records: await fetchSleepRecords(tool, 14), calls };
  } finally {
    console.warn = originalWarn;
    setSleepToolCallerForTests();
  }
}

const rangeHit = await fetchWith(overviewTool, () => overviewText);
assert.equal(rangeHit.calls.length, 1);
assert.deepEqual(rangeHit.calls[0], overviewPlan.range);
assert.equal(rangeHit.records.length, 1);
assert.equal(rangeHit.records[0].happenDay, todayDay);
assert.equal(rangeHit.records[0].score, 62);

const rangeAnomaly = await fetchWith(overviewTool, () => anomalyText);
assert.equal(rangeAnomaly.calls.length, 1);
assert.deepEqual(rangeAnomaly.records, []);

const rangeEmpty = await fetchWith(overviewTool, (count) =>
  count === 1 ? "Sleep Overview\nNo sleep records in this range." : overviewText
);
assert.equal(rangeEmpty.calls.length, 2);
assert.equal(rangeEmpty.records[0]?.score, 62);

const schemalessAnomaly = await fetchWith(
  { name: "querySleepData", inputSchema: {} },
  (count) => (count === 3 ? anomalyText : count === 2 ? overviewText : "no data")
);
assert.equal(schemalessAnomaly.calls.length, 3);
assert.equal(schemalessAnomaly.records.length, 1);
assert.equal(schemalessAnomaly.records[0].score, 62);

console.log("test-sleep-data-parser: ok");
