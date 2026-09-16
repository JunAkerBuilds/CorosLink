import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubAnalytics,
  TrainingHubDailyHealthRecord,
  TrainingHubDailyMetric,
  TrainingHubDashboard,
  TrainingHubSleepRecord,
  TrainingHubSportType,
  TrainingHubUpcomingWorkout
} from "../../electron/types";
import { buildTrainingHubSnapshot } from "./parsers";
import type { TrainingHubSnapshot } from "./types";

export interface TrainingHubSampleData {
  snapshot: TrainingHubSnapshot;
  activities: TrainingHubActivity[];
  activityDetails: Map<string, TrainingHubActivityDetail>;
  sportTypes: TrainingHubSportType[];
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function clockTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function effortLevel(load: number): number {
  return load > 170 ? 5 : load > 100 ? 4 : load > 60 ? 3 : load > 0 ? 2 : 1;
}

function activityDetail(activity: TrainingHubActivity): TrainingHubActivityDetail {
  const distance = activity.distance ?? 0;
  const duration = activity.duration ?? 0;
  const lapCount = Math.ceil(distance / 1000);
  const points = Array.from({ length: 81 }, (_, index) => {
    const progress = index / 80;
    // An illustrative route around Toronto's waterfront, with a distance axis
    // shared by the elevation profile and activity laps.
    return {
      lat: 43.637 + 0.006 * Math.sin(progress * Math.PI * 2),
      lon: -79.46 + 0.055 * (1 - Math.cos(progress * Math.PI * 2)),
      elevation: 88 + 12 * Math.sin(progress * Math.PI * 4) + 4 * Math.sin(index),
      distance: Math.round(distance * progress)
    };
  });

  return {
    ...activity,
    laps: Array.from({ length: lapCount }, (_, index) => {
      const lapDistance = Math.min(1000, distance - index * 1000);
      return {
        index: index + 1,
        distance: lapDistance,
        duration: Math.round(duration * lapDistance / distance),
        avgHr: activity.avgHr,
        maxHr: activity.maxHr,
        pace: Math.round(duration / (distance / 1000)),
        elevationGain: Math.round((activity.elevationGain ?? 0) / lapCount)
      };
    }),
    track: { points },
    series: points.map((point, index) => ({
      distance: point.distance,
      hr: (activity.avgHr ?? 140) + Math.round(8 * Math.sin(index / 6)),
      pace: Math.round(duration / (distance / 1000) + 12 * Math.sin(index / 8))
    })),
    raw: { source: "development-sample", activityId: activity.activityId }
  };
}

/** Generated only by the development preview; never stored or sent to COROS. */
export function createTrainingHubSampleData(now = new Date()): TrainingHubSampleData {
  const dayList: TrainingHubDailyMetric[] = [];
  const sleepRecords: TrainingHubSleepRecord[] = [];
  const healthRecords: TrainingHubDailyHealthRecord[] = [];
  const activities: TrainingHubActivity[] = [];
  const weeklyPlan = [
    { name: "Long trail run", sportType: 102, sportName: "Trail Run", distance: 22000, pace: 352, load: 192 },
    { name: "Easy recovery run", sportType: 100, sportName: "Run", distance: 6000, pace: 365, load: 42 },
    { name: "Threshold intervals", sportType: 100, sportName: "Run", distance: 8500, pace: 295, load: 114 },
    { name: "Lakeshore endurance ride", sportType: 200, sportName: "Bike", distance: 55000, pace: 136, load: 138 },
    { name: "Steady aerobic run", sportType: 100, sportName: "Run", distance: 12000, pace: 328, load: 86 },
    null,
    { name: "Weekend spin", sportType: 200, sportName: "Bike", distance: 35000, pace: 148, load: 74 }
  ];

  for (let offset = 364; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    date.setHours(7, 0, 0, 0);
    const happenDay = dateKey(date);
    const plan = weeklyPlan[date.getDay()];
    const variation = 1 + 0.12 * Math.sin(offset * 0.71);
    const distance = plan ? Math.round(plan.distance * variation / 100) * 100 : 0;
    const duration = plan ? Math.round(distance / 1000 * plan.pace) : 0;
    const trainingLoad = plan ? Math.round(plan.load * variation) : 0;
    const rpeLevel = effortLevel(trainingLoad);
    const rpeLoad = Math.round(duration / 60 * [0, 1, 2, 4, 7, 10][rpeLevel]);

    dayList.push({
      happenDay, trainingLoad, rpeLoad, distance, duration,
      rhr: 54 + Math.round(3 * Math.sin(offset / 4)),
      avgSleepHrv: 62 + Math.round(8 * Math.cos(offset / 3)),
      sleepHrvBase: 61,
      staminaLevel: Math.round(78 - offset / 65),
      vo2max: Math.round((53.4 - offset / 110 + 0.5 * Math.sin(offset / 7)) * 10) / 10,
      trainingLoadRatio: 1.12,
      tiredRateNew: 34,
      tiredRateStateNew: 2
    });

    if (offset < 28) {
      const totalMinutes = 440 + Math.round(32 * Math.cos(offset / 2));
      const deepMinutes = 92 + Math.round(12 * Math.sin(offset));
      const remMinutes = 106 + Math.round(14 * Math.cos(offset));
      const awakeMinutes = 12 + offset % 14;
      const windowMinutes = totalMinutes + awakeMinutes;
      const wakeTime = 7 * 60 + offset % 20;
      sleepRecords.push({
        happenDay, kind: "main", completeness: "complete",
        score: 86 + Math.round(7 * Math.cos(offset / 3)),
        totalMinutes, deepMinutes, remMinutes,
        lightMinutes: totalMinutes - deepMinutes - remMinutes,
        awakeMinutes, windowMinutes,
        awakeCountOverFiveMinutes: 2,
        sleepStart: clockTime(wakeTime - windowMinutes),
        sleepEnd: clockTime(wakeTime),
        napMinutes: offset % 3 === 0 ? 24 : 0,
        avgHr: 52 + offset % 4
      });
      healthRecords.push({
        happenDay,
        steps: 8432 + Math.round(2200 * Math.sin(offset / 2)),
        calories: 423 + Math.round(95 * Math.sin(offset / 3))
      });
      if (plan) {
        activities.push({
          activityId: `sample-training-${happenDay}`,
          name: plan.name, sportType: plan.sportType, sportName: plan.sportName,
          startTime: date.getTime() / 1000,
          endTime: date.getTime() / 1000 + duration,
          duration, distance, trainingLoad,
          avgHr: plan.load > 100 ? 153 : 137,
          maxHr: plan.load > 100 ? 176 : 158,
          calories: Math.round(duration / 60 * 9),
          elevationGain: Math.round(distance / 1000 * (plan.sportType === 102 ? 22 : 6))
        });
      }
    }
  }

  const recentDays = dayList.slice(-28);
  const totals = (key: "trainingLoad" | "distance" | "duration") =>
    activities.reduce((sum, activity) => sum + (activity[key] ?? 0), 0);
  const zoneEntries = (total: number) => [12, 43, 23, 14, 6, 2].map((ratio, index) => ({
    index: index + 1, ratio, value: Math.round(total * ratio / 100)
  }));
  const distanceBuckets = Array.from({ length: 6 }, (_, index) => activities.filter(activity =>
    Math.min(5, Math.floor((activity.distance ?? 0) / 10000)) === index
  ));
  const distanceEntries = (key?: "trainingLoad" | "duration") => distanceBuckets.map((bucket, index) => ({
    index: index + 1,
    value: key ? bucket.reduce((sum, activity) => sum + (activity[key] ?? 0), 0) : bucket.length
  }));
  const sportTypes = [
    { sportType: 100, sportName: "Run" },
    { sportType: 102, sportName: "Trail Run" },
    { sportType: 200, sportName: "Bike" }
  ];
  const analytics: TrainingHubAnalytics = {
    dayList, weekList: [],
    sportStatistics: sportTypes.map(sport => {
      const matching = activities.filter(activity => activity.sportType === sport.sportType);
      return { ...sport, count: matching.length,
        distance: matching.reduce((sum, activity) => sum + (activity.distance ?? 0), 0),
        duration: matching.reduce((sum, activity) => sum + (activity.duration ?? 0), 0),
        trainingLoad: matching.reduce((sum, activity) => sum + (activity.trainingLoad ?? 0), 0)
      };
    }),
    zoneDistributions: {
      hrTrainingLoad: zoneEntries(totals("trainingLoad")),
      hrDistance: zoneEntries(totals("distance")),
      hrTime: zoneEntries(totals("duration")),
      distanceFrequency: distanceEntries(),
      distanceTrainingLoad: distanceEntries("trainingLoad"),
      distanceTime: distanceEntries("duration")
    },
    rpeDistribution: {
      buckets: [1, 2, 3, 4, 5].map(level => {
        const days = recentDays.filter(day => {
          const load = day.trainingLoad ?? 0;
          return load > 0 && effortLevel(load) === level;
        });
        return { level, frequency: days.length,
          srpe: days.reduce((sum, day) => sum + (day.rpeLoad ?? 0), 0),
          timeSeconds: days.reduce((sum, day) => sum + (day.duration ?? 0), 0)
        };
      }),
      coverage: { rated: activities.length, total: activities.length }
    }
  };
  const dashboard: TrainingHubDashboard = {
    racePredictor: {
      staminaLevel: 78, recoveryPct: 94,
      aerobicEnduranceScore: 84, lactateThresholdCapacityScore: 79,
      anaerobicEnduranceScore: 73, anaerobicCapacityScore: 68,
      lthr: 169, ltsp: 268,
      runScoreList: [
        { distance: 5000, distanceLabel: "5K", predictSeconds: 1265, avgPace: 253 },
        { distance: 10000, distanceLabel: "10K", predictSeconds: 2650, avgPace: 265 },
        { distance: 21097.5, distanceLabel: "Half Marathon", predictSeconds: 5875, avgPace: 278 },
        { distance: 42195, distanceLabel: "Marathon", predictSeconds: 12520, avgPace: 297 }
      ]
    },
    rhr: dayList.at(-1)?.rhr, recoveryPct: 94, fullRecoveryHours: 3,
    fitnessMaxHr: 190, runningLevelHr: 169,
    lthrZones: [118, 137, 153, 169, 181, 190].map((hr, index) => ({ index: index + 1, hr })),
    ltspZones: [410, 350, 302, 268, 245, 220].map((pace, index) => ({ index: index + 1, pace })),
    personalRecords: [1, 2].map(type => ({
      type, label: type === 1 ? "All time" : "This year",
      records: [
        { type: 7, label: "1K", distance: 1000, duration: 224, avgPace: 224 },
        { type: 6, label: "3K", distance: 3000, duration: 742, avgPace: 247 },
        { type: 5, label: "5K", distance: 5000, duration: 1292, avgPace: 258 },
        { type: 4, label: "10K", distance: 10000, duration: 2746, avgPace: 275 },
        { type: 2, label: "Half Marathon", distance: 21097.5, duration: 6015, avgPace: 285 },
        { type: 13, label: "Marathon", distance: 42195, duration: 13140, avgPace: 311 },
        { type: 101, label: "Longest Run", distance: 28500 },
        { type: 103, label: "Elevation Gain", distance: 842 }
      ].map((record, index) => ({ ...record, happenDay: dayList.at(-8 - index * 3)?.happenDay }))
    })),
    sportDataCount: activities.length
  };
  const upcomingWorkouts = [
    { name: "Easy recovery run", volume: "6 km", trainingLoad: 42, sportType: 100 },
    { name: "Threshold intervals · 5 × 1 km", volume: "9 km", trainingLoad: 110, sportType: 100 },
    { name: "Aerobic endurance ride", volume: "45 km", trainingLoad: 96, sportType: 200 },
    { name: "Long trail run", volume: "20 km", trainingLoad: 175, sportType: 102 }
  ].map((workout, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() + index * 2);
    return { ...workout, happenDay: dateKey(date), sortNo: index };
  });

  activities.reverse();
  return {
    snapshot: buildTrainingHubSnapshot(analytics, dashboard, { dayList, weekList: [] },
      { latest: sleepRecords.at(-1), records: sleepRecords, mcpConnected: true },
      { latest: healthRecords.at(-1), records: healthRecords, mcpConnected: true }),
    activities,
    activityDetails: new Map(activities.map(activity => [activity.activityId, activityDetail(activity)])),
    sportTypes,
    upcomingWorkouts
  };
}
