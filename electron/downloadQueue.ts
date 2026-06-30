import { randomUUID } from "node:crypto";
import { markYouTubeDownloaded } from "./database";
import { computeOverallProgress } from "./downloadProgress";
import {
  cancelDownloadProcess,
  downloadAudioSearch,
  downloadAudioWithProgress,
  DownloadCancelledError
} from "./downloadService";
import type {
  DownloadAudioResult,
  DownloadJob,
  DownloadProgressUpdate,
  DownloadQueueItem
} from "./types";
import {
  classifyYouTubeUrl,
  normalizeYouTubeDownloadUrl
} from "./youtubeService";

const MAX_CONCURRENT = 3;

const jobs = new Map<string, DownloadJob>();
let activeCount = 0;
let listener: ((jobs: DownloadJob[]) => void) | null = null;

export function setJobListener(
  next: ((jobs: DownloadJob[]) => void) | null
): void {
  listener = next;
}

function snapshot(): DownloadJob[] {
  return Array.from(jobs.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
}

function emit(): void {
  listener?.(snapshot());
}

function touch(job: DownloadJob): void {
  job.updatedAt = new Date().toISOString();
}

export function listJobs(): DownloadJob[] {
  return snapshot();
}

export function enqueueDownloads(items: DownloadQueueItem[]): DownloadJob[] {
  const activeUrls = new Set(
    Array.from(jobs.values())
      .filter(
        (job) => job.status === "queued" || job.status === "downloading"
      )
      .map((job) => job.url)
  );

  const created: DownloadJob[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    const job = createQueuedJob(item, now);
    if (!job || activeUrls.has(job.url)) {
      continue;
    }

    activeUrls.add(job.url);
    jobs.set(job.id, job);
    created.push(job);
  }

  if (created.length > 0) {
    emit();
    pump();
  }

  return created;
}

function createQueuedJob(
  item: DownloadQueueItem,
  now: string
): DownloadJob | null {
  if (isSearchQueueItem(item)) {
    const query = cleanTitle(item.query);
    const sourceUrl = item.sourceUrl.trim();
    if (!query || !sourceUrl) {
      return null;
    }

    const title = cleanTitle(item.title) || query;
    return {
      id: randomUUID(),
      url: sourceUrl,
      title,
      status: "queued",
      progress: 0,
      tracks: [],
      entryType: "search",
      query,
      fileBaseName: cleanTitle(item.fileBaseName) || title,
      createdAt: now,
      updatedAt: now
    };
  }

  const rawUrl = item.url?.trim();
  if (!rawUrl) {
    return null;
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeYouTubeDownloadUrl(rawUrl);
  } catch {
    return null;
  }

  const entryType = classifyYouTubeUrl(normalizedUrl);
  if (entryType !== "video" && entryType !== "playlist") {
    return null;
  }

  return {
    id: randomUUID(),
    url: normalizedUrl,
    title: cleanTitle(item.title) || normalizedUrl,
    status: "queued",
    progress: 0,
    tracks: [],
    entryType,
    createdAt: now,
    updatedAt: now
  };
}

function isSearchQueueItem(
  item: DownloadQueueItem
): item is Extract<DownloadQueueItem, { source: "search" }> {
  return "source" in item && item.source === "search";
}

export function clearJob(id: string): DownloadJob[] {
  const job = jobs.get(id);
  if (
    job &&
    (job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled")
  ) {
    jobs.delete(id);
    emit();
  }
  return snapshot();
}

export function clearCompletedJobs(): DownloadJob[] {
  for (const [id, job] of jobs) {
    if (
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled"
    ) {
      jobs.delete(id);
    }
  }
  emit();
  return snapshot();
}

export function cancelJob(id: string): DownloadJob[] {
  const job = jobs.get(id);
  if (!job) {
    return snapshot();
  }

  if (job.status === "queued") {
    jobs.delete(id);
    emit();
    pump();
    return snapshot();
  }

  if (job.status === "downloading") {
    job.status = "cancelled";
    job.activity = "Cancelling…";
    touch(job);
    emit();
    cancelDownloadProcess(id);
  }

  return snapshot();
}

function pump(): void {
  while (activeCount < MAX_CONCURRENT) {
    const next = Array.from(jobs.values()).find(
      (job) => job.status === "queued"
    );
    if (!next) {
      return;
    }
    void runJob(next);
  }
}

async function runJob(job: DownloadJob): Promise<void> {
  activeCount += 1;
  job.status = "downloading";
  job.progress = 0;
  job.phase = "starting";
  job.activity =
    job.entryType === "search" ? "Searching YouTube…" : "Starting yt-dlp…";
  job.trackProgress = 0;
  job.completedTrackCount = 0;
  touch(job);
  emit();

  try {
    const result = await runJobDownload(job);

    if (jobs.get(job.id)?.status === "cancelled") {
      throw new DownloadCancelledError();
    }

    job.tracks = result.tracks;
    job.progress = 100;
    job.status = "completed";
    job.phase = "completed";
    job.completedTrackCount = result.tracks.length;
    job.warning = result.warnings?.[0];

    // Prefer the real title from the downloaded file (yt-dlp names it
    // "<title> [<id>]"), since the in-page title can be missing or generic.
    const trackTitle = cleanTrackTitle(result.tracks[0]?.title);
    if (trackTitle) {
      job.title = trackTitle;
    }
    touch(job);

    if (job.entryType === "video" || job.entryType === "playlist") {
      markYouTubeDownloaded({
        url: job.url,
        title: job.title,
        entryType: job.entryType
      });
    }
  } catch (error) {
    if (error instanceof DownloadCancelledError) {
      job.status = "cancelled";
      job.activity = "Cancelled";
      job.error = undefined;
    } else {
      job.status = "failed";
      job.phase = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }
    touch(job);
  } finally {
    activeCount -= 1;
    emit();
    pump();
  }
}

function runJobDownload(job: DownloadJob): Promise<DownloadAudioResult> {
  const onProgress = (update: DownloadProgressUpdate) => {
    mergeProgressUpdate(job, update);
    touch(job);
    emit();
  };
  const runtime = {
    jobId: job.id,
    isCancelled: () => jobs.get(job.id)?.status === "cancelled"
  };

  if (job.entryType === "search") {
    const query = cleanTitle(job.query);
    if (!query) {
      throw new Error("Search query is required.");
    }

    return downloadAudioSearch(
      query,
      cleanTitle(job.fileBaseName) || cleanTitle(job.title) || "download",
      job.url,
      onProgress,
      runtime
    );
  }

  const entryType = classifyYouTubeUrl(job.url);
  if (entryType !== "video" && entryType !== "playlist") {
    throw new Error("Only YouTube videos or playlists can be downloaded.");
  }

  job.entryType = entryType;

  return downloadAudioWithProgress(job.url, onProgress, runtime);
}

function cleanTitle(title?: string): string {
  return (title ?? "")
    .replace(/\s+-\s+YouTube$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTrackTitle(title?: string): string {
  // Strip the trailing " [videoId]" that yt-dlp appends to the file name.
  return cleanTitle(title).replace(/\s*\[[A-Za-z0-9_-]{6,}\]\s*$/, "").trim();
}

function mergeProgressUpdate(job: DownloadJob, update: DownloadProgressUpdate): void {
  if (update.trackIndex !== undefined) {
    job.trackIndex = update.trackIndex;
  }

  if (update.trackTotal !== undefined) {
    job.trackTotal = update.trackTotal;
  }

  if (update.currentTrackTitle !== undefined) {
    job.currentTrackTitle = update.currentTrackTitle;
  }

  if (update.trackProgress !== undefined) {
    job.trackProgress = update.trackProgress;
  }

  if (update.phase !== undefined) {
    job.phase = update.phase;
  }

  if (update.activity !== undefined) {
    job.activity = update.activity;
  }

  if (update.completedTrackIncrement) {
    job.completedTrackCount =
      (job.completedTrackCount ?? 0) + update.completedTrackIncrement;
  }

  job.progress = computeOverallProgress({
    entryType: job.entryType,
    trackIndex: job.trackIndex,
    trackTotal: job.trackTotal,
    trackProgress: job.trackProgress,
    previousProgress: job.progress
  });
}
