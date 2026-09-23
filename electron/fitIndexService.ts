import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  countFitIndexRows,
  getFitIndexRow,
  getSetting,
  listFitIndexActivityIds,
  listFitIndexRows,
  setSetting,
  upsertFitIndexRow,
  type FitIndexQuery,
  type FitIndexRow
} from "./database";
import { parseFitActivity } from "./fitActivity";
import {
  FIT_SUMMARY_VERSION,
  summarizeFitActivity,
  type FitActivitySummary,
  type FitSummaryMeta
} from "./fitSummary";
import {
  fetchTrainingHubActivityFile,
  listTrainingHubActivities
} from "./trainingHubService";
import type {
  FitIndexProgress,
  FitIndexStatus,
  FitIndexSyncOptions,
  TrainingHubActivity
} from "./types";

const FIT_FILE_TYPE = 4;
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 500;
// Same politeness pause as the bulk backup so a full-history index is gentle.
const DOWNLOAD_DELAY_MS = 250;
const LAST_SYNC_KEY = "fitIndex.lastSyncAt";
// Strength sessions carry no continuous records worth indexing.
const SKIPPED_SPORT_TYPES = new Set([402]);

let cacheDirOverride: string | null = null;
let syncing = false;
let cancelRequested = false;
let currentProgress: FitIndexProgress | null = null;
let progressListener: ((progress: FitIndexProgress) => void) | null = null;

export function setFitIndexProgressListener(
  listener: ((progress: FitIndexProgress) => void) | null
): void {
  progressListener = listener;
}

/** Tests point the cache somewhere writable without an Electron app. */
export function setFitCacheDirForTesting(dir: string | null): void {
  cacheDirOverride = dir;
}

export function fitCacheDir(): string {
  return cacheDirOverride ?? path.join(app.getPath("userData"), "fit-cache");
}

function fitFilePath(activityId: string): string {
  return path.join(fitCacheDir(), `${activityId}.fit`);
}

function emitProgress(update: Partial<FitIndexProgress>): void {
  if (!currentProgress) return;
  currentProgress = { ...currentProgress, ...update };
  progressListener?.(currentProgress);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSummary(row: FitIndexRow): FitActivitySummary | null {
  try {
    const parsed = JSON.parse(row.summary_json) as FitActivitySummary;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function storeSummary(summary: FitActivitySummary, filePath: string): void {
  upsertFitIndexRow({
    activity_id: summary.activityId,
    sport_type: summary.sportType,
    sport_name: summary.sportName ?? null,
    name: summary.name ?? null,
    start_time: summary.startTime || null,
    distance_m: summary.distanceM ?? null,
    timer_sec: summary.timerSec ?? null,
    has_power: summary.hasPower ? 1 : 0,
    has_hr: summary.hasHr ? 1 : 0,
    has_gps: summary.hasGps ? 1 : 0,
    file_path: filePath,
    summary_version: FIT_SUMMARY_VERSION,
    summary_json: JSON.stringify(summary)
  });
}

/** Parse a cached file and (re)write its summary row. */
export async function indexFitFile(
  filePath: string,
  meta: FitSummaryMeta
): Promise<FitActivitySummary> {
  const bytes = await fs.promises.readFile(filePath);
  const activity = parseFitActivity(new Uint8Array(bytes));
  const summary = summarizeFitActivity(activity, meta);
  storeSummary(summary, filePath);
  return summary;
}

export interface EnsureSummaryOptions {
  /** False = never hit the network; return null when the file is not cached. */
  download?: boolean;
}

/**
 * Summary for one activity: from the index when current, re-parsed from the
 * cached file when the summary format changed, otherwise downloaded once.
 */
export async function ensureFitSummary(
  activity: FitSummaryMeta,
  options: EnsureSummaryOptions = {}
): Promise<FitActivitySummary | null> {
  const row = getFitIndexRow(activity.activityId);
  if (row) {
    const fileExists = fs.existsSync(row.file_path);
    if (row.summary_version === FIT_SUMMARY_VERSION) {
      const summary = parseSummary(row);
      if (summary) return summary;
    }
    if (fileExists) {
      return indexFitFile(row.file_path, {
        ...activity,
        sportName: activity.sportName ?? row.sport_name ?? undefined,
        name: activity.name ?? row.name ?? undefined
      });
    }
  }

  const filePath = fitFilePath(activity.activityId);
  if (fs.existsSync(filePath)) {
    return indexFitFile(filePath, activity);
  }
  if (options.download === false) return null;

  await fs.promises.mkdir(fitCacheDir(), { recursive: true });
  const { content } = await fetchTrainingHubActivityFile(
    activity.activityId,
    activity.sportType,
    FIT_FILE_TYPE
  );
  await fs.promises.writeFile(filePath, content);
  return indexFitFile(filePath, activity);
}

export interface EnsureSummariesResult {
  summaries: FitActivitySummary[];
  downloaded: number;
  failed: number;
  /** Activities left un-indexed because `maxDownloads` was reached. */
  deferred: number;
}

/**
 * Index a batch on demand (chat tools). Downloads are capped per call so one
 * question never turns into a full-history crawl; the caller reports what was
 * deferred and the athlete can run a background sync for the rest.
 */
export async function ensureFitSummaries(
  activities: FitSummaryMeta[],
  maxDownloads: number
): Promise<EnsureSummariesResult> {
  const result: EnsureSummariesResult = {
    summaries: [],
    downloaded: 0,
    failed: 0,
    deferred: 0
  };
  for (const activity of activities) {
    if (SKIPPED_SPORT_TYPES.has(activity.sportType)) continue;
    const cached = await ensureFitSummary(activity, { download: false }).catch(
      () => null
    );
    if (cached) {
      result.summaries.push(cached);
      continue;
    }
    if (result.downloaded >= maxDownloads) {
      result.deferred += 1;
      continue;
    }
    try {
      const summary = await ensureFitSummary(activity);
      if (summary) {
        result.summaries.push(summary);
        result.downloaded += 1;
      }
    } catch (error) {
      console.warn(`[fitIndex] failed to index ${activity.activityId}:`, error);
      result.failed += 1;
    }
    await delay(DOWNLOAD_DELAY_MS);
  }
  return result;
}

export function listIndexedSummaries(query: FitIndexQuery = {}): FitActivitySummary[] {
  return listFitIndexRows(query)
    .map((row) => parseSummary(row))
    .filter((summary): summary is FitActivitySummary => summary !== null);
}

export function getIndexedSummary(activityId: string): FitActivitySummary | null {
  const row = getFitIndexRow(activityId);
  return row ? parseSummary(row) : null;
}

async function cacheSizeBytes(): Promise<number> {
  const dir = fitCacheDir();
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    try {
      total += (await fs.promises.stat(path.join(dir, entry.name))).size;
    } catch {
      // File vanished mid-scan; ignore.
    }
  }
  return total;
}

export async function getFitIndexStatus(): Promise<FitIndexStatus> {
  return {
    indexed: countFitIndexRows(),
    cacheBytes: await cacheSizeBytes(),
    cacheDir: fitCacheDir(),
    syncing,
    progress: currentProgress,
    lastSyncAt: getSetting(LAST_SYNC_KEY)
  };
}

export function cancelFitIndexSync(): FitIndexProgress | null {
  if (syncing) cancelRequested = true;
  return currentProgress;
}

async function listActivitiesSince(sinceEpochSeconds?: number): Promise<TrainingHubActivity[]> {
  const all: TrainingHubActivity[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const activities = await listTrainingHubActivities(page, LIST_PAGE_SIZE);
    let addedAny = false;
    let reachedCutoff = false;
    for (const activity of activities) {
      if (!activity.activityId || seen.has(activity.activityId)) continue;
      if (
        sinceEpochSeconds !== undefined &&
        activity.startTime !== undefined &&
        activity.startTime < sinceEpochSeconds
      ) {
        reachedCutoff = true;
        continue;
      }
      seen.add(activity.activityId);
      all.push(activity);
      addedAny = true;
    }
    if (activities.length < LIST_PAGE_SIZE || !addedAny || reachedCutoff) break;
    if (cancelRequested) break;
  }
  return all;
}

/**
 * Background crawl: download + index every activity not yet in the index.
 * Progress streams through the registered listener; the final state is also
 * returned. Re-running is incremental.
 */
export async function startFitIndexSync(
  options: FitIndexSyncOptions = {}
): Promise<FitIndexProgress> {
  if (syncing && currentProgress) return currentProgress;

  syncing = true;
  cancelRequested = false;
  currentProgress = {
    state: "listing",
    total: 0,
    completed: 0,
    skipped: 0,
    failed: 0
  };
  progressListener?.(currentProgress);

  try {
    const since =
      options.sinceDays && options.sinceDays > 0
        ? Math.floor(Date.now() / 1000) - options.sinceDays * 86400
        : undefined;
    const activities = (await listActivitiesSince(since)).filter(
      (activity) => !SKIPPED_SPORT_TYPES.has(activity.sportType)
    );
    const indexed = listFitIndexActivityIds();
    emitProgress({ total: activities.length, state: "indexing" });

    for (const activity of activities) {
      if (cancelRequested) break;
      if (indexed.has(activity.activityId)) {
        emitProgress({ skipped: (currentProgress?.skipped ?? 0) + 1 });
        continue;
      }
      emitProgress({ currentName: activity.name || activity.activityId });
      try {
        await ensureFitSummary({
          activityId: activity.activityId,
          sportType: activity.sportType,
          sportName: activity.sportName,
          name: activity.name,
          startTime: activity.startTime
        });
        emitProgress({ completed: (currentProgress?.completed ?? 0) + 1 });
      } catch (error) {
        console.warn(`[fitIndex] sync failed for ${activity.activityId}:`, error);
        emitProgress({ failed: (currentProgress?.failed ?? 0) + 1 });
      }
      await delay(DOWNLOAD_DELAY_MS);
    }

    if (!cancelRequested) setSetting(LAST_SYNC_KEY, new Date().toISOString());
    emitProgress({
      state: cancelRequested ? "cancelled" : "done",
      currentName: undefined
    });
  } catch (caught) {
    emitProgress({
      state: "error",
      currentName: undefined,
      error:
        caught instanceof Error ? caught.message : "FIT index sync failed unexpectedly."
    });
  } finally {
    syncing = false;
    cancelRequested = false;
  }

  return currentProgress as FitIndexProgress;
}
