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
import type { CoachPrefill } from "../chat/chatTypes";

export interface TrainingTrendPoint {
  date: string;
  label: string;
  trainingLoad?: number;
  rpeLoad?: number;
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
  /** Local-Only Mode, from the watch's latest activity that has it: when it counts you as fully recovered (Unix seconds). */
  recoveredAt?: number;
  /** Local-Only Mode, from the watch: the latest Base Fitness, Load Impact and fatigue (%), and their day. */
  fitnessBalance?: { happenDay: string; baseFitness: number; loadImpact?: number; fatigue?: number };
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

export type HeatmapMetric = "trainingLoad" | "rpeLoad";

export interface HeatmapCell {
  happenDay: string;
  trainingLoad?: number;
  rpeLoad?: number;
  /** Value of the currently selected metric — drives level and summary. */
  value?: number;
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

/** Another view asking the Training Hub to show a tab, optionally with an activity open. */
export interface TrainingHubNavigationRequest {
  tab: "overview" | "activities" | "records" | "races";
  activity?: TrainingHubActivity;
  requestId: number;
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
  rpeBackfill?: { pending: number; running: boolean } | null;
  activityDetail: TrainingHubActivityDetail | null;
  selectedActivity: TrainingHubActivity | null;
  busy: string | null;
  sleepConnecting?: boolean;
  // Two-factor: non-null email means a verification code is being awaited.
  twoFactorEmail: string | null;
  twoFactorCode: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberChange: (value: boolean) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onTwoFactorCodeChange: (value: string) => void;
  onVerifyTwoFactor: (event: FormEvent<HTMLFormElement>) => void;
  onResendTwoFactor: () => void;
  onCancelTwoFactor: () => void;
  onReconnect: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onLoadDetail: (activity: TrainingHubActivity) => void;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
  navigationRequest?: TrainingHubNavigationRequest | null;
  onNavigationRequestHandled?: () => void;
  /** Opens Coach with the composer prefilled (e.g. to rebuild a pinned chart). */
  onOpenCoach?: (prefill: CoachPrefill) => void;
  /** Opens a scheduled workout on its day in the Training Calendar. */
  onOpenCalendarWorkout?: (workout: TrainingHubUpcomingWorkout) => void;
  /** Local-Only Mode: starts "Sync watch now" (offered on the dashboard before the first sync). */
  onSyncWatch?: () => void;
  /** Bumped after each watch sync, so cards that fetch their own data fetch again. */
  localDataVersion?: number;
}

export type { TrainingHubDailyMetric };
