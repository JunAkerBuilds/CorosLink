import fs from "node:fs";
import path from "node:path";
import type { DownloadProgressUpdate } from "./types";

const TRACK_PRINT_PREFIX = "before_dl:__TRACK__|";

export function parseYtDlpProgressLine(line: string): DownloadProgressUpdate | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith(TRACK_PRINT_PREFIX)) {
    const parts = trimmed.slice(TRACK_PRINT_PREFIX.length).split("|");
    if (parts.length >= 3) {
      const trackIndex = Number.parseInt(parts[0], 10);
      const trackTotal = Number.parseInt(parts[1], 10);
      const currentTrackTitle = parts.slice(2).join("|").trim();

      const update: DownloadProgressUpdate = {
        phase: "downloading",
        activity: currentTrackTitle
          ? `Starting ${currentTrackTitle}`
          : "Starting next track"
      };

      if (Number.isFinite(trackIndex) && trackIndex > 0) {
        update.trackIndex = trackIndex;
      }

      if (Number.isFinite(trackTotal) && trackTotal > 0) {
        update.trackTotal = trackTotal;
      }

      if (currentTrackTitle) {
        update.currentTrackTitle = currentTrackTitle;
      }

      return update;
    }
  }

  const itemMatch = /\[download\]\s+Downloading item (\d+) of (\d+)/i.exec(trimmed);
  if (itemMatch) {
    const trackIndex = Number.parseInt(itemMatch[1], 10);
    const trackTotal = Number.parseInt(itemMatch[2], 10);
    return {
      trackIndex: Number.isFinite(trackIndex) ? trackIndex : undefined,
      trackTotal: Number.isFinite(trackTotal) ? trackTotal : undefined,
      phase: "downloading",
      activity: `Downloading item ${itemMatch[1]} of ${itemMatch[2]}`
    };
  }

  const percentMatch = /\[download\]\s+([\d.]+)%/.exec(trimmed);
  if (percentMatch) {
    const trackProgress = Number.parseFloat(percentMatch[1]);
    if (Number.isFinite(trackProgress)) {
      return {
        trackProgress,
        phase: "downloading",
        activity: `Downloading ${trackProgress.toFixed(1)}%`
      };
    }
  }

  if (
    /\[ExtractAudio\]/i.test(trimmed) ||
    /\[ffmpeg\]/i.test(trimmed) ||
    /postprocess/i.test(trimmed)
  ) {
    return {
      phase: "converting",
      activity: "Converting to MP3"
    };
  }

  if (/^ERROR:/i.test(trimmed) || /\bERROR\b/.test(trimmed)) {
    const activity = trimmed.replace(/^ERROR:\s*/i, "").trim();
    return {
      activity: activity.length > 120 ? `${activity.slice(0, 117)}…` : activity
    };
  }

  if (trimmed.startsWith("after_move:")) {
    const filePath = trimmed.slice("after_move:".length).trim();
    const title = titleFromFilePath(filePath);
    return {
      phase: "between_tracks",
      completedTrackIncrement: 1,
      activity: title ? `Finished ${title}` : "Finished track"
    };
  }

  return null;
}

export function computeOverallProgress(options: {
  entryType?: "video" | "playlist" | "search" | "audio";
  trackIndex?: number;
  trackTotal?: number;
  trackProgress?: number;
  previousProgress?: number;
}): number {
  const trackProgress = options.trackProgress ?? 0;
  let computed = trackProgress;

  if (
    options.entryType === "playlist" &&
    options.trackIndex &&
    options.trackTotal &&
    options.trackTotal > 0
  ) {
    computed =
      ((options.trackIndex - 1) + trackProgress / 100) / options.trackTotal * 100;
  }

  const capped = Math.min(100, Math.max(0, computed));
  return Math.max(options.previousProgress ?? 0, capped);
}

function titleFromFilePath(filePath: string): string {
  const baseName = filePath.split(/[/\\]/).pop() ?? filePath;
  const withoutExt = baseName.replace(/\.[^.]+$/, "");
  return withoutExt.replace(/\s*\[[A-Za-z0-9_-]{6,}\]\s*$/, "").trim();
}

export function extractYtDlpErrors(lines: string[]): string[] {
  const errors: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.endsWith(".mp3") || trimmed.startsWith("after_move:")) {
      continue;
    }

    if (/^ERROR:/i.test(trimmed)) {
      errors.push(trimmed.replace(/^ERROR:\s*/i, "").trim());
    }
  }

  return errors;
}

const ALREADY_DOWNLOADED_PATTERN =
  /\[download\]\s+(.+?)\s+has already been downloaded/i;

export function parseAlreadyDownloadedPath(
  line: string,
  outputDirectory: string
): string | null {
  const trimmed = line.trim();
  const match = ALREADY_DOWNLOADED_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  const rawPath = match[1].trim();
  if (!rawPath || rawPath.startsWith("[")) {
    return null;
  }

  const candidate = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(outputDirectory, rawPath);

  return resolveMp3InOutputDirectory(candidate, outputDirectory);
}

export function extractAlreadyDownloadedPaths(
  lines: string[],
  outputDirectory: string
): string[] {
  const resolved = lines
    .map((line) => parseAlreadyDownloadedPath(line, outputDirectory))
    .filter((filePath): filePath is string => Boolean(filePath));

  return [...new Set(resolved)];
}

export function partitionDownloadedMp3Files(
  before: Set<string>,
  printedPaths: string[],
  after: string[]
): { newFiles: string[]; existingFiles: string[] } {
  const printedMp3s = [...new Set(printedPaths)].filter((filePath) =>
    filePath.toLowerCase().endsWith(".mp3")
  );
  const diffFiles = after.filter((filePath) => !before.has(filePath));
  const printedNewFiles = printedMp3s.filter(
    (filePath) => !before.has(filePath)
  );

  // yt-dlp prints an after_move path for every file it owns. Prefer those
  // paths whenever available: a directory diff also sees files created by
  // other concurrent queue workers and would attach them to the wrong job.
  const newFiles = printedNewFiles.length > 0 ? printedNewFiles : diffFiles;
  const existingFiles = [
    ...new Set(printedMp3s.filter((filePath) => before.has(filePath)))
  ];

  return { newFiles, existingFiles };
}

/**
 * Selects the MP3 produced by one combined-download track. The temporary
 * directory is private to the combine operation, so a directory diff is a
 * reliable fallback when yt-dlp's `after_move` line is missing, split across
 * output chunks, or formatted differently on another platform.
 */
export function selectCombinedTrackOutput(
  before: Set<string>,
  printedPaths: string[],
  after: string[],
  expectedPath: string
): string | null {
  const { newFiles } = partitionDownloadedMp3Files(
    before,
    printedPaths,
    after
  );

  return (
    newFiles.find((filePath) => filePath === expectedPath) ??
    newFiles[0] ??
    null
  );
}

export function summarizeCombinedTrackFailures(failures: string[]): string {
  const normalized = failures
    .map((failure) => failure.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return "None of the playlist tracks could be downloaded, so there was nothing to combine.";
  }

  const firstFailure = normalized[0];
  const preview =
    firstFailure.length > 500
      ? `${firstFailure.slice(0, 497)}…`
      : firstFailure;
  const remaining = normalized.length - 1;

  return `None of the playlist tracks could be downloaded. First failure: ${preview}${
    remaining > 0
      ? ` (${remaining} more track${remaining === 1 ? "" : "s"} also failed.)`
      : ""
  }`;
}

function resolveMp3InOutputDirectory(
  candidate: string,
  outputDirectory: string
): string | null {
  const resolvedOutputDirectory = path.resolve(outputDirectory);

  if (!candidate.toLowerCase().endsWith(".mp3")) {
    return null;
  }

  const inOutputDirectory =
    candidate === resolvedOutputDirectory ||
    candidate.startsWith(resolvedOutputDirectory + path.sep);

  if (!inOutputDirectory || !fs.existsSync(candidate)) {
    return null;
  }

  return candidate;
}

export function parsePlaylistTrackMarker(
  line: string
): { trackTotal: number } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(TRACK_PRINT_PREFIX)) {
    return null;
  }

  const parts = trimmed.slice(TRACK_PRINT_PREFIX.length).split("|");
  if (parts.length < 2) {
    return null;
  }

  const trackTotal = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(trackTotal) || trackTotal <= 0) {
    return null;
  }

  return { trackTotal };
}

export function isYtDlpErrorLine(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(trimmed) && /^ERROR:/i.test(trimmed);
}

export function summarizePlaylistWarnings(
  errors: string[],
  downloadedCount: number
): string[] {
  if (errors.length === 0) {
    return [];
  }

  const preview = errors.slice(0, 3).join("; ");
  const suffix =
    errors.length > 3 ? ` (+${errors.length - 3} more unavailable)` : "";

  return [
    `Downloaded ${downloadedCount} track(s). ${errors.length} video(s) were skipped: ${preview}${suffix}`
  ];
}

export function buildPlaylistCompletionWarning(options: {
  allowPlaylist: boolean;
  deliveredCount: number;
  playlistTrackTotal?: number;
  exitCode?: number | null;
  capturedErrorLines: string[];
}): string[] | undefined {
  const errors = extractYtDlpErrors(options.capturedErrorLines);
  if (errors.length > 0) {
    return summarizePlaylistWarnings(errors, options.deliveredCount);
  }

  if (!options.allowPlaylist) {
    return undefined;
  }

  const { deliveredCount, playlistTrackTotal } = options;

  if (
    playlistTrackTotal &&
    playlistTrackTotal > 0 &&
    deliveredCount < playlistTrackTotal
  ) {
    const missing = playlistTrackTotal - deliveredCount;
    return [
      `Downloaded ${deliveredCount} of ${playlistTrackTotal} track(s). ${missing} item(s) were unavailable or skipped.`
    ];
  }

  if (options.exitCode !== 0 && options.exitCode !== null) {
    return [
      `Downloaded ${deliveredCount} track(s). Some playlist items may have been unavailable or skipped.`
    ];
  }

  return undefined;
}
