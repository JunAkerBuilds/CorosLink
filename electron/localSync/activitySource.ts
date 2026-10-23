import fs from "node:fs";
import { normalizeActivityName } from "../activityName";
import { parseFitActivity } from "../fitActivity";
import type { HealthInsightKind, HealthInsightResult } from "../healthInsightsTypes";
import { LOCAL_ONLY_ERROR_PREFIX } from "../privacy/dataModeTypes";
import {
  TRAINING_HUB_EXPORT_FORMATS,
  type TrainingHubActivity,
  type TrainingHubActivityDetail,
  type TrainingHubActivityFileType,
  type TrainingHubDailyHealthSummary,
  type TrainingHubDailyMetrics,
  type TrainingHubExportFormat,
  type TrainingHubSleepSummary
} from "../types";
import type { ActivityRepository } from "./activityRepository";
import { toTrainingHubActivity } from "./activityRepository";
import type { HealthRepository } from "./healthRepository";
import type { LocalArchive } from "./localArchive";
import { localFitActivityDetail, localUndecodedActivityDetail } from "./localActivityDetail";
import { buildGpx } from "./localGpx";
import { heartRateRecoveryFrom, localHealthInsight, sleepRecordsFromSessions } from "./localHealthViews";
import type { LocalTrainingMetrics } from "./localTrainingMetrics";

/**
 * Where activity and health data come from. Connected Mode reads the COROS
 * cloud; Local-Only Mode reads SQLite and the local archive. A local miss is
 * reported as unavailable and is never retried against the cloud.
 */
export interface ActivitySource {
  readonly kind: "cloud" | "local";
  listActivities(page?: number, size?: number, startDay?: string, endDay?: string): Promise<TrainingHubActivity[]>;
  getActivityDetail(activityId: string, sportType: number, listActivity?: TrainingHubActivity): Promise<TrainingHubActivityDetail>;
  readActivityFile(activityId: string, sportType: number, fileType: TrainingHubActivityFileType): Promise<{ format: TrainingHubExportFormat; content: Buffer }>;
  /** Renames an activity and resolves to the name now stored. */
  renameActivity(activityId: string, name: string, startTime?: number): Promise<string>;
}

export interface HealthDataSource {
  readonly kind: "cloud" | "local";
  getDailyHealth(days: number): Promise<TrainingHubDailyHealthSummary>;
  getSleep(days: number): Promise<TrainingHubSleepSummary>;
  getInsight(kind: HealthInsightKind, days: number): Promise<HealthInsightResult>;
  getDailyMetrics(dateList: string[]): Promise<TrainingHubDailyMetrics>;
}

class LocalDataUnavailableError extends Error {
  readonly code = "COROSLINK_LOCAL_DATA_UNAVAILABLE";
  constructor(message: string) {
    super(`${LOCAL_ONLY_ERROR_PREFIX} ${message}`);
    this.name = "LocalDataUnavailableError";
  }
}

function exportFormat(fileType: TrainingHubActivityFileType): TrainingHubExportFormat {
  const format = TRAINING_HUB_EXPORT_FORMATS.find(item => item.fileType === fileType);
  if (!format) throw new Error("Unsupported export format.");
  return format;
}

export class LocalActivitySource implements ActivitySource {
  readonly kind = "local" as const;

  constructor(private readonly repository: ActivityRepository, private readonly archive: LocalArchive, private readonly health?: HealthRepository) {}

  async listActivities(page = 1, size = 50, startDay?: string, endDay?: string): Promise<TrainingHubActivity[]> {
    return this.repository.listActivities({ page, size, startDay, endDay }).map(toTrainingHubActivity);
  }

  private record(activityId: string) {
    const record = this.repository.getActivity(activityId);
    if (!record) throw new LocalDataUnavailableError("This activity isn't stored on this computer. Sync it from your watch or import its FIT file.");
    return record;
  }

  async getActivityDetail(activityId: string): Promise<TrainingHubActivityDetail> {
    const record = this.record(activityId);
    if (record.format !== "fit") return localUndecodedActivityDetail(record);
    const bytes = await fs.promises.readFile(this.archive.resolve(record.filePath));
    const detail = localFitActivityDetail(parseFitActivity(new Uint8Array(bytes)), record);
    const recovery = record.startTime === undefined ? undefined : this.health?.findRecovery(record.startTime);
    const heartRateRecovery = recovery && heartRateRecoveryFrom(recovery);
    return heartRateRecovery ? { ...detail, heartRateRecovery } : detail;
  }

  async readActivityFile(activityId: string, _sportType: number, fileType: TrainingHubActivityFileType): Promise<{ format: TrainingHubExportFormat; content: Buffer }> {
    const record = this.record(activityId);
    const content = await fs.promises.readFile(this.archive.resolve(record.filePath));
    if (record.format !== "fit") {
      throw new LocalDataUnavailableError("This version of CorosLink can't read this activity yet. It's kept on this computer and included in backups.");
    }
    if (fileType === 4) return { format: exportFormat(4), content };
    if (fileType === 1) {
      return { format: exportFormat(1), content: Buffer.from(buildGpx(parseFitActivity(new Uint8Array(content)), record.name ?? record.sportName ?? "Activity"), "utf8") };
    }
    throw new LocalDataUnavailableError("Activities on this computer can be exported as FIT or GPX.");
  }

  async renameActivity(activityId: string, name: string): Promise<string> {
    const next = normalizeActivityName(name);
    if (!next) throw new Error("An activity needs a name.");
    this.record(activityId);
    this.repository.renameActivity(activityId, next);
    return next;
  }
}

export class LocalHealthDataSource implements HealthDataSource {
  readonly kind = "local" as const;

  constructor(private readonly repository: HealthRepository, private readonly training?: LocalTrainingMetrics) {}

  async getDailyHealth(days: number): Promise<TrainingHubDailyHealthSummary> {
    const records = this.repository.listDays(days).map(day => ({
      happenDay: day.day,
      steps: day.metrics.steps?.value,
      calories: day.metrics.active_calories?.value
    }));
    // mcpConnected reports whether the data source answered; locally it always can.
    return { latest: records[0], records, mcpConnected: true };
  }

  async getSleep(days = 7): Promise<TrainingHubSleepSummary> {
    const records = sleepRecordsFromSessions(this.repository.listSleeps(days));
    return { latest: records.find((record) => record.kind === "main") ?? records[0], records, mcpConnected: true };
  }

  async getDailyMetrics(dateList: string[]): Promise<TrainingHubDailyMetrics> {
    if (!this.training) throw new LocalDataUnavailableError("Daily training metrics aren't available on this computer.");
    return this.training.dailyMetrics(dateList);
  }

  async getInsight(kind: HealthInsightKind, days: number): Promise<HealthInsightResult> {
    const span = Math.min(Math.max(Math.trunc(days) || 7, 1), 366);
    const now = Math.floor(Date.now() / 1000);
    return localHealthInsight(kind, span, {
      days: this.repository.listDays(span),
      stress: kind === "stress" ? this.repository.listSamples("stress", now - span * 86_400, now) : [],
      healthChecks: kind === "healthCheck" ? this.repository.listHealthChecks(now - span * 86_400, now) : []
    });
  }
}

export interface DataSourceSelection {
  useLocal: () => boolean;
  localActivities: ActivitySource;
  cloudActivities: ActivitySource;
  localHealth: HealthDataSource;
  cloudHealth: HealthDataSource;
}

let selection: DataSourceSelection | undefined;

export function configureDataSources(next: DataSourceSelection): void {
  selection = next;
}

/**
 * Before main configures the sources (unit tests, very early calls) the cloud
 * readers are the existing behaviour. Main configures them before any network
 * service can start, and in Local-Only Mode the network guards refuse the
 * cloud regardless.
 */
function cloudFallback(): typeof import("./cloudSources") {
  return require("./cloudSources") as typeof import("./cloudSources");
}

/** The source for the current data mode. Every activity reader goes through this. */
export function currentActivitySource(): ActivitySource {
  if (!selection) return cloudFallback().cloudActivitySource;
  return selection.useLocal() ? selection.localActivities : selection.cloudActivities;
}

export function currentHealthSource(): HealthDataSource {
  if (!selection) return cloudFallback().cloudHealthSource;
  return selection.useLocal() ? selection.localHealth : selection.cloudHealth;
}

export function usingLocalSources(): boolean {
  return selection?.useLocal() ?? false;
}
