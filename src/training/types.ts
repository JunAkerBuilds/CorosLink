import type { FormEvent } from "react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubAnalytics,
  TrainingHubDailyHealthSummary,
  TrainingHubDailyMetric,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubRacePredictor,
  TrainingHubSleepSummary,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubUpcomingWorkout
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

export interface TrainingTrendPoint {
  date: string;
  label: string;
  trainingLoad?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  rhr?: number;
  sleepMinutes?: number;
  sleepScore?: number;
}

export interface TrainingSummaryMetrics {
  staminaLevel?: number;
  recoveryPct?: number;
  todayLoad?: number;
  weekLoadTotal?: number;
  latestRhr?: number;
  rhrDelta?: number;
  steps?: number;
  calories?: number;
}

export interface TrainingHubSnapshot {
  summary: TrainingSummaryMetrics;
  trendPoints: TrainingTrendPoint[];
  racePredictor: TrainingHubRacePredictor | null;
  dashboard: TrainingHubDashboard | null;
  analytics: TrainingHubAnalytics | null;
  dailyMetrics: TrainingHubDailyMetrics | null;
  sleep?: TrainingHubSleepSummary | null;
  dailyHealth?: TrainingHubDailyHealthSummary | null;
}

export type HeatmapIntensityLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatmapCell {
  happenDay: string;
  trainingLoad?: number;
  distance?: number;
  duration?: number;
  level: HeatmapIntensityLevel;
  label: string;
}

export interface HeatmapSummary {
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  totalLoad: number;
}

export interface HeatmapMonthLabel {
  column: number;
  label: string;
}

export interface HeatmapGrid {
  cells: (HeatmapCell | null)[];
  weeks: number;
  monthLabels: HeatmapMonthLabel[];
}

export interface TrainingHubViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  email: string;
  password: string;
  remember: boolean;
  activities: TrainingHubActivity[];
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
  snapshot: TrainingHubSnapshot | null;
  sportTypes: TrainingHubSportType[];
  activityDetail: TrainingHubActivityDetail | null;
  selectedActivity: TrainingHubActivity | null;
  busy: string | null;
  sleepConnecting?: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberChange: (value: boolean) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onReconnect: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onLoadDetail: (activity: TrainingHubActivity) => void;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
}

export type { TrainingHubDailyMetric };
