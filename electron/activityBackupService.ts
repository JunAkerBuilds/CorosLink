import fs from "node:fs";
import path from "node:path";
import {
  activityMatchesBackupFilters,
  hasActiveBackupFilters,
  isoDayToHappenDay,
  summarizeActivityBackup
} from "./activityBackupFilters";
import {
  fetchTrainingHubActivityFile,
  getTrainingHubExportFormat,
  listTrainingHubActivities
} from "./trainingHubService";
import type {
  ActivityBackupFilters,
  ActivityBackupPreview,
  ActivityBackupProgress,
  TrainingHubActivity,
  TrainingHubActivityFileType
} from "./types";

// Activities are fetched in pages of this size until a short page signals the end.
const BACKUP_PAGE_SIZE = 100;
// Hard stop so a misbehaving API can never loop forever (~50k activities).
const BACKUP_MAX_PAGES = 500;
// Pause between downloads so a full-history backup stays polite to COROS.
const BACKUP_DOWNLOAD_DELAY_MS = 250;

let currentProgress: ActivityBackupProgress | null = null;
let running = false;
let cancelRequested = false;
let progressListener: ((progress: ActivityBackupProgress) => void) | null =
  null;

export function setActivityBackupProgressListener(
  listener: ((progress: ActivityBackupProgress) => void) | null
): void {
  progressListener = listener;
}

export function getActivityBackupProgress(): ActivityBackupProgress | null {
  return currentProgress;
}

export function cancelActivityBackup(): ActivityBackupProgress | null {
  if (running) {
    cancelRequested = true;
  }
  return currentProgress;
}

function emitProgress(update: Partial<ActivityBackupProgress>): void {
  if (!currentProgress) {
    return;
  }
  currentProgress = { ...currentProgress, ...update };
  progressListener?.(currentProgress);
}

/** Mirrors main.ts's export sanitizer so backup names match single exports. */
function sanitizeBackupName(name?: string): string {
  if (!name) {
    return "";
  }
  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** COROS timestamps are seconds in list payloads but tolerate milliseconds. */
function activityDatePrefix(startTime?: number): string {
  if (!startTime || !Number.isFinite(startTime) || startTime <= 0) {
    return "unknown-date";
  }
  const ms = startTime < 10_000_000_000 ? startTime * 1000 : startTime;
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function backupFileName(
  activity: TrainingHubActivity,
  extension: string
): string {
  const base = sanitizeBackupName(activity.name) || "activity";
  return `${activityDatePrefix(activity.startTime)}_${base}_${activity.activityId}.${extension}`;
}

function todayIsoDay(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

async function listAllActivities(
  filters?: ActivityBackupFilters,
  shouldStop: () => boolean = () => cancelRequested
): Promise<TrainingHubActivity[]> {
  const all: TrainingHubActivity[] = [];
  const seen = new Set<string>();

  // /activity/query only honours a date window when both ends are present, so
  // an open end is padded; matches are still re-checked locally afterwards.
  const windowed = Boolean(filters?.startDay || filters?.endDay);
  const startDay = windowed
    ? isoDayToHappenDay(filters?.startDay ?? "1990-01-01")
    : undefined;
  const endDay = windowed
    ? isoDayToHappenDay(filters?.endDay ?? todayIsoDay())
    : undefined;

  for (let page = 1; page <= BACKUP_MAX_PAGES; page += 1) {
    const activities = await listTrainingHubActivities(
      page,
      BACKUP_PAGE_SIZE,
      startDay,
      endDay
    );
    let addedAny = false;
    for (const activity of activities) {
      if (!activity.activityId || seen.has(activity.activityId)) {
        continue;
      }
      seen.add(activity.activityId);
      all.push(activity);
      addedAny = true;
    }
    // A short or fully-duplicated page means the account has no more history.
    if (activities.length < BACKUP_PAGE_SIZE || !addedAny) {
      break;
    }
    if (shouldStop()) {
      break;
    }
  }

  return all;
}

// The preview re-filters one cached account listing as the user edits
// filters, so only the first count after a few minutes touches COROS.
const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
let previewCache: { listedAt: number; activities: TrainingHubActivity[] } | null =
  null;
let previewListing: Promise<TrainingHubActivity[]> | null = null;

async function cachedAccountActivities(): Promise<TrainingHubActivity[]> {
  if (previewCache && Date.now() - previewCache.listedAt < PREVIEW_CACHE_TTL_MS) {
    return previewCache.activities;
  }
  previewListing ??= listAllActivities(undefined, () => false)
    .then((activities) => {
      previewCache = { listedAt: Date.now(), activities };
      return activities;
    })
    .finally(() => {
      previewListing = null;
    });
  return previewListing;
}

/** Drops the cached listing; the next preview lists the signed-in account again. */
export function clearActivityBackupPreview(): void {
  previewCache = null;
}

/** Counts what a backup with `filters` would download, without downloading. */
export async function previewActivityBackup(
  filters?: ActivityBackupFilters
): Promise<ActivityBackupPreview> {
  return summarizeActivityBackup(await cachedAccountActivities(), filters);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Downloads every activity matching `filters` (all of them when omitted) into
 * `folder`, one file per activity, skipping files that already exist (so
 * re-running is an incremental backup). Progress streams through the
 * registered listener and the final state is also returned.
 */
export async function startActivityBackup(
  folder: string,
  fileType: TrainingHubActivityFileType = 4,
  filters?: ActivityBackupFilters
): Promise<ActivityBackupProgress> {
  if (running && currentProgress) {
    return currentProgress;
  }

  const format = getTrainingHubExportFormat(fileType);
  await fs.promises.mkdir(folder, { recursive: true });

  running = true;
  cancelRequested = false;
  currentProgress = {
    state: "listing",
    folder,
    fileType,
    formatLabel: format.label,
    filtered: hasActiveBackupFilters(filters),
    scanned: 0,
    total: 0,
    completed: 0,
    skipped: 0,
    failed: 0
  };
  progressListener?.(currentProgress);

  try {
    const listed = await listAllActivities(filters);
    const activities = listed.filter((activity) =>
      activityMatchesBackupFilters(activity, filters)
    );
    emitProgress({
      scanned: listed.length,
      total: activities.length,
      state: "downloading"
    });

    for (const activity of activities) {
      if (cancelRequested) {
        break;
      }

      const fileName = backupFileName(activity, format.extension);
      const filePath = path.join(folder, fileName);

      if (fs.existsSync(filePath)) {
        emitProgress({
          skipped: (currentProgress?.skipped ?? 0) + 1,
          currentName: activity.name
        });
        continue;
      }

      emitProgress({ currentName: activity.name || fileName });

      try {
        const { content } = await fetchTrainingHubActivityFile(
          activity.activityId,
          activity.sportType,
          fileType
        );
        await fs.promises.writeFile(filePath, content);
        emitProgress({ completed: (currentProgress?.completed ?? 0) + 1 });
      } catch {
        emitProgress({ failed: (currentProgress?.failed ?? 0) + 1 });
      }

      await delay(BACKUP_DOWNLOAD_DELAY_MS);
    }

    emitProgress({
      state: cancelRequested ? "cancelled" : "done",
      currentName: undefined
    });
  } catch (caught) {
    emitProgress({
      state: "error",
      currentName: undefined,
      error:
        caught instanceof Error
          ? caught.message
          : "Activity backup failed unexpectedly."
    });
  } finally {
    running = false;
    cancelRequested = false;
  }

  return currentProgress as ActivityBackupProgress;
}
