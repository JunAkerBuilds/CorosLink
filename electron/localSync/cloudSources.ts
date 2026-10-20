import type { BrowserWindow } from "electron";
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

export function createCloudHealthSource(window: () => BrowserWindow | undefined): HealthDataSource {
  return {
    kind: "cloud",
    getDailyHealth: days => getTrainingDailyHealthData(window(), days),
    getSleep: days => getTrainingSleepData(window(), days),
    getInsight: (kind, days) => getTrainingHealthInsight(kind, days),
    getDailyMetrics: dateList => getDailyMetrics(dateList)
  };
}
