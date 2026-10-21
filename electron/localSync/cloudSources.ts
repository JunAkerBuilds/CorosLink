import { getTrainingDailyHealthData } from "../dailyHealthDataService";
import { getTrainingHealthInsight } from "../healthInsightsService";
import { getTrainingSleepData } from "../sleepDataService";
import { fetchTrainingHubActivityFile, getDailyMetrics, getTrainingHubActivityDetail, listTrainingHubActivities } from "../trainingHubService";
import type { ActivitySource, HealthDataSource } from "./activitySource";

/** Connected Mode: the existing COROS Training Hub and COROS MCP readers, unchanged. */
export const cloudActivitySource: ActivitySource = {
  kind: "cloud",
  listActivities: (page, size, startDay, endDay) => listTrainingHubActivities(page, size, startDay, endDay),
  getActivityDetail: (activityId, sportType, listActivity) => getTrainingHubActivityDetail(activityId, sportType, listActivity),
  readActivityFile: (activityId, sportType, fileType) => fetchTrainingHubActivityFile(activityId, sportType, fileType)
};

export const cloudHealthSource: HealthDataSource = {
  kind: "cloud",
  getDailyHealth: days => getTrainingDailyHealthData(days),
  getSleep: days => getTrainingSleepData(days),
  getInsight: (kind, days) => getTrainingHealthInsight(kind, days),
  getDailyMetrics: dateList => getDailyMetrics(dateList)
};
