import { app } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  combinedTrackCompletionMarker,
  createCombinedDownloadCacheKey,
  isReusableCombinedTrack,
  markCombinedTrackReusable,
  pruneCombinedDownloadCache,
  touchCombinedDownloadCache
} from "./combinedDownloadCache";
import { addDownloads } from "./database";
import {
  parseYtDlpProgressLine,
  extractYtDlpErrors,
  extractAlreadyDownloadedPaths,
  partitionDownloadedMp3Files,
  buildPlaylistCompletionWarning,
  parsePlaylistTrackMarker,
  isYtDlpErrorLine,
  selectCombinedTrackOutput,
  summarizeCombinedTrackFailures
} from "./downloadProgress";
import type {
  BinaryCheck,
  BinaryName,
  BinaryStatus,
  CombinedDownloadProgress,
  CombinedDownloadResult,
  DownloadAudioResult,
  DownloadProgressUpdate,
  DownloadQueueItem
} from "./types";
import {
  isPlaylistDownloadUrl,
  normalizeYouTubeDownloadUrl
} from "./youtubeService";

const execFileAsync = promisify(execFile);
const MAX_CAPTURED_LINES = 120;
const ARTIFACT_EXTENSIONS = [".webm", ".m4a", ".opus", ".part", ".wav", ".aac"];
const BINARY_VERSION_TIMEOUT_MS: Record<BinaryName, number> = {
  "yt-dlp": 30_000,
  ffmpeg: 6_000
};

interface ResolvedBinary {
  name: BinaryName;
  command: string;
  source: "bundled" | "path";
}

export class DownloadCancelledError extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "DownloadCancelledError";
  }
}

interface DownloadRuntimeOptions {
  jobId?: string;
  isCancelled?: () => boolean;
}

const runningProcesses = new Map<string, ChildProcess>();
const activeCombinedDownloadCaches = new Set<string>();

export function cancelDownloadProcess(jobId: string): boolean {
  const child = runningProcesses.get(jobId);
  if (!child) {
    return false;
  }

  child.kill("SIGTERM");
  return true;
}

export function getDownloadDirectory(): string {
  const directory = path.join(app.getPath("userData"), "downloads");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export async function getBinaryStatus(): Promise<BinaryStatus> {
  const [ytDlp, ffmpeg] = await Promise.all([
    checkBinary("yt-dlp"),
    checkBinary("ffmpeg")
  ]);

  return { ytDlp, ffmpeg };
}

export async function downloadAudio(url: string): Promise<DownloadAudioResult> {
  return downloadAudioWithProgress(url);
}

export async function downloadAudioWithProgress(
  url: string,
  onProgress?: (update: DownloadProgressUpdate) => void,
  runtime?: DownloadRuntimeOptions
): Promise<DownloadAudioResult> {
  const trimmedUrl = url.trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    throw new Error("Enter a valid YouTube URL or playlist URL.");
  }

  const normalizedUrl = normalizeYouTubeDownloadUrl(trimmedUrl);
  const outputDirectory = getDownloadDirectory();
  const outputTemplate = path.join(
    outputDirectory,
    "%(title).200B [%(id)s].%(ext)s"
  );

  return runAudioDownload(normalizedUrl, outputTemplate, normalizedUrl, {
    allowPlaylist: isPlaylistDownloadUrl(normalizedUrl),
    onProgress,
    runtime
  });
}

/**
 * Downloads a direct, public audio URL (for example a podcast RSS enclosure)
 * and converts it to an MP3 with a predictable library filename.
 */
export async function downloadExternalAudio(
  url: string,
  fileBaseName: string,
  onProgress?: (update: DownloadProgressUpdate) => void,
  runtime?: DownloadRuntimeOptions
): Promise<DownloadAudioResult> {
  const trimmedUrl = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    throw new Error("Enter a valid public audio URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTP(S) audio URLs can be downloaded.");
  }

  const outputDirectory = getDownloadDirectory();
  const safeBaseName = nextAvailableBaseName(
    outputDirectory,
    sanitizeFileBaseName(fileBaseName)
  );
  const outputTemplate = path.join(outputDirectory, `${safeBaseName}.%(ext)s`);

  return runAudioDownload(trimmedUrl, outputTemplate, trimmedUrl, {
    allowPlaylist: false,
    onProgress,
    runtime
  });
}

export async function downloadAudioSearch(
  searchQuery: string,
  fileBaseName: string,
  sourceUrl: string,
  onProgress?: (update: DownloadProgressUpdate) => void,
  runtime?: DownloadRuntimeOptions
): Promise<DownloadAudioResult> {
  const trimmedQuery = searchQuery.trim();
  if (!trimmedQuery) {
    throw new Error("Search query is required.");
  }

  const outputDirectory = getDownloadDirectory();
  const safeBaseName = nextAvailableBaseName(
    outputDirectory,
    sanitizeFileBaseName(fileBaseName)
  );
  const outputTemplate = path.join(outputDirectory, `${safeBaseName}.%(ext)s`);

  return runAudioDownload(`ytsearch1:${trimmedQuery}`, outputTemplate, sourceUrl, {
    allowPlaylist: false,
    onProgress,
    runtime
  });
}

interface ResolvedCombinedItem {
  input: string;
  title: string;
}

/**
 * Downloads every track in a playlist and stitches them into a single MP3 that
 * lands in the local cache (so it can be transferred to the watch like any
 * other download). Individual track failures are skipped and reported as
 * warnings rather than aborting the whole combine.
 */
export async function downloadCombinedTrack(
  id: string,
  name: string,
  items: DownloadQueueItem[],
  onProgress?: (update: CombinedDownloadProgress) => void,
  runtime?: DownloadRuntimeOptions
): Promise<CombinedDownloadResult> {
  const resolved = items
    .map(resolveCombinedItem)
    .filter((item): item is ResolvedCombinedItem => item !== null);

  if (resolved.length === 0) {
    throw new Error(
      "No downloadable tracks were provided for the combined MP3."
    );
  }

  if (runtime?.isCancelled?.()) {
    throw new DownloadCancelledError();
  }

  await assertBinariesAvailable();

  const ytDlp = resolveBinary("yt-dlp");
  const ffmpeg = resolveBinary("ffmpeg");
  const cacheRoot = path.join(
    app.getPath("userData"),
    "combined-download-cache"
  );
  const cacheKey = createCombinedDownloadCacheKey(
    id,
    resolved.map((item) => item.input)
  );

  await pruneCombinedDownloadCache(
    cacheRoot,
    activeCombinedDownloadCaches
  );
  if (activeCombinedDownloadCaches.has(cacheKey)) {
    throw new Error("This combined playlist download is already in progress.");
  }

  activeCombinedDownloadCaches.add(cacheKey);
  const workDir = path.join(cacheRoot, cacheKey);

  const downloadedFiles: string[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  const total = resolved.length;
  let reusedCount = 0;
  let shouldRemoveCache = false;

  try {
    await fs.promises.mkdir(workDir, { recursive: true });
    await touchCombinedDownloadCache(workDir);

    for (let index = 0; index < resolved.length; index += 1) {
      if (runtime?.isCancelled?.()) {
        throw new DownloadCancelledError();
      }

      const item = resolved[index];
      const outputTemplate = path.join(
        workDir,
        `${String(index).padStart(4, "0")}.%(ext)s`
      );
      const cachedFilePath = outputTemplate.replace(/\.%\(ext\)s$/, ".mp3");

      if (await isReusableCombinedTrack(cachedFilePath)) {
        downloadedFiles.push(cachedFilePath);
        reusedCount += 1;
        onProgress?.({
          phase: "downloading",
          index: index + 1,
          total,
          title: item.title,
          trackProgress: 1,
          reused: true
        });
        continue;
      }

      // An unmarked or zero-byte MP3 may have been interrupted mid-write.
      // Remove it so yt-dlp cannot mistake the track for a completed download.
      await fs.promises.rm(cachedFilePath, { force: true }).catch(() => {});
      await fs.promises
        .rm(combinedTrackCompletionMarker(cachedFilePath), { force: true })
        .catch(() => {});

      onProgress?.({
        phase: "downloading",
        index: index + 1,
        total,
        title: item.title,
        trackProgress: 0
      });

      try {
        const filePath = await downloadSingleTrackFile(
          item.input,
          outputTemplate,
          ytDlp,
          ffmpeg,
          (fraction) =>
            onProgress?.({
              phase: "downloading",
              index: index + 1,
              total,
              title: item.title,
              trackProgress: fraction
            }),
          runtime
        );

        downloadedFiles.push(filePath);
        await markCombinedTrackReusable(filePath);
        await touchCombinedDownloadCache(workDir);
      } catch (error) {
        if (error instanceof DownloadCancelledError) {
          throw error;
        }
        const failure = `"${item.title}": ${
          error instanceof Error ? error.message : String(error)
        }`;
        failures.push(failure);
        warnings.push(`Skipped ${failure}`);
      }
    }

    if (downloadedFiles.length === 0) {
      throw new Error(summarizeCombinedTrackFailures(failures));
    }

    onProgress?.({
      phase: "merging",
      index: total,
      total,
      title: name,
      trackProgress: 1
    });

    const outputDirectory = getDownloadDirectory();
    const baseName = nextAvailableBaseName(
      outputDirectory,
      sanitizeFileBaseName(name || "Combined Playlist")
    );
    const finalPath = path.join(outputDirectory, `${baseName}.mp3`);

    await mergeMp3Files(downloadedFiles, finalPath, workDir, ffmpeg, runtime);

    const tracks = addDownloads([finalPath], `combined:${baseName}`);
    const track = tracks[0];
    if (!track) {
      throw new Error(
        "The combined MP3 could not be registered in the library."
      );
    }

    onProgress?.({
      phase: "completed",
      index: total,
      total,
      title: track.title,
      trackProgress: 1
    });

    // Keep successful source tracks when some playlist items were skipped, so
    // another attempt needs to fetch only the missing items. A fully complete
    // combine has nothing left to resume and can discard its cache immediately.
    shouldRemoveCache = warnings.length === 0;

    return {
      track,
      downloadedCount: downloadedFiles.length,
      reusedCount,
      totalCount: total,
      ...(warnings.length ? { warnings } : {})
    };
  } finally {
    activeCombinedDownloadCaches.delete(cacheKey);
    if (shouldRemoveCache) {
      await fs.promises
        .rm(workDir, { recursive: true, force: true })
        .catch(() => {});
    } else {
      await touchCombinedDownloadCache(workDir);
    }
  }
}

function resolveCombinedItem(
  item: DownloadQueueItem
): ResolvedCombinedItem | null {
  if ("source" in item && item.source === "search") {
    const query = item.query.trim();
    if (!query) {
      return null;
    }
    return { input: `ytsearch1:${query}`, title: item.title.trim() || query };
  }

  if ("source" in item && item.source === "audio") {
    const audioUrl = item.audioUrl.trim();
    if (!/^https?:\/\//i.test(audioUrl)) {
      return null;
    }
    return { input: audioUrl, title: item.title.trim() || "Audio track" };
  }

  const rawUrl = "url" in item ? item.url?.trim() : "";
  if (!rawUrl) {
    return null;
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeYouTubeDownloadUrl(rawUrl);
  } catch {
    return null;
  }

  const title =
    ("title" in item && item.title?.trim()) || normalizedUrl;
  return { input: normalizedUrl, title };
}

/**
 * Downloads a single track as an MP3 into the directory implied by
 * `outputTemplate` and returns the resulting file path. Unlike
 * {@link runAudioDownload} this does not touch the database — the caller merges
 * the temp files and registers the final artifact. A missing MP3 is an error so
 * the combine can preserve the actual yt-dlp/ffmpeg diagnostic for the user.
 */
async function downloadSingleTrackFile(
  input: string,
  outputTemplate: string,
  ytDlp: ResolvedBinary,
  ffmpeg: ResolvedBinary,
  onFraction: (fraction: number) => void,
  runtime?: DownloadRuntimeOptions
): Promise<string> {
  const args = [
    "--no-playlist",
    "--no-mtime",
    "--newline",
    "--remote-components",
    "ejs:github",
    "--js-runtimes",
    `node:${process.execPath}`,
    "--print",
    "after_move:%(filepath)s",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outputTemplate
  ];

  if (ffmpeg.source === "bundled") {
    args.push("--ffmpeg-location", path.dirname(ffmpeg.command));
  }

  args.push(input);

  const targetDir = path.dirname(outputTemplate);
  const beforeMp3Files = new Set(listMp3Files(targetDir));
  const beforeArtifacts = new Set(listMediaArtifacts(targetDir));
  const printedPaths: string[] = [];

  const onLine = (line: string) => {
    const resolvedPath = resolvePrintedPath(line, targetDir);
    if (resolvedPath) {
      printedPaths.push(resolvedPath);
    }

    const parsed = parseYtDlpProgressLine(line);
    if (parsed?.trackProgress !== undefined) {
      onFraction(parsed.trackProgress);
    }
  };

  const { lines, exitCode } = await runProcess(
    ytDlp.command,
    args,
    onLine,
    runtime
  );

  if (runtime?.isCancelled?.()) {
    throw new DownloadCancelledError();
  }

  const expected = outputTemplate.replace(/\.%\(ext\)s$/, ".mp3");
  const afterMp3Files = listMp3Files(targetDir);
  const produced = selectCombinedTrackOutput(
    beforeMp3Files,
    printedPaths,
    afterMp3Files,
    expected
  );

  if (produced && fs.existsSync(produced)) {
    if (fs.existsSync(expected)) {
      return expected;
    }

    // Keep resumable cache filenames deterministic even if yt-dlp reports a
    // platform-specific output name that differs from the template.
    await fs.promises.rename(produced, expected);
    return expected;
  }

  const newArtifacts = listMediaArtifacts(targetDir).filter(
    (filePath) => !beforeArtifacts.has(filePath)
  );

  if (exitCode !== 0 && exitCode !== null) {
    throw buildProcessError(path.basename(ytDlp.command), exitCode, lines);
  }

  throw buildNoMp3Error({
    output: lines,
    ytDlp,
    ffmpeg,
    newArtifacts,
    exitCode
  });
}

/**
 * Concatenates the downloaded MP3s into a single file. Re-encodes with
 * libmp3lame so tracks with differing bitrates/sample rates stitch cleanly
 * instead of glitching on a raw stream copy.
 */
async function mergeMp3Files(
  files: string[],
  outputPath: string,
  workDir: string,
  ffmpeg: ResolvedBinary,
  runtime?: DownloadRuntimeOptions
): Promise<void> {
  if (files.length === 1) {
    await fs.promises.copyFile(files[0], outputPath);
    return;
  }

  const listPath = path.join(workDir, "concat.txt");
  const listBody = files
    .map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.promises.writeFile(listPath, `${listBody}\n`, "utf8");

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    outputPath
  ];

  const { exitCode, lines } = await runProcess(
    ffmpeg.command,
    args,
    undefined,
    runtime
  );

  if (runtime?.isCancelled?.()) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    throw new DownloadCancelledError();
  }

  if (exitCode !== 0 || !fs.existsSync(outputPath)) {
    throw buildProcessError(path.basename(ffmpeg.command), exitCode, lines);
  }
}

async function runAudioDownload(
  input: string,
  outputTemplate: string,
  sourceUrl: string,
  options: {
    allowPlaylist: boolean;
    onProgress?: (update: DownloadProgressUpdate) => void;
    runtime?: DownloadRuntimeOptions;
  }
): Promise<DownloadAudioResult> {
  if (options.runtime?.isCancelled?.()) {
    throw new DownloadCancelledError();
  }

  await assertBinariesAvailable();

  const ytDlp = resolveBinary("yt-dlp");
  const ffmpeg = resolveBinary("ffmpeg");
  const outputDirectory = getDownloadDirectory();
  const before = new Set(listMp3Files(outputDirectory));
  const beforeArtifacts = new Set(listMediaArtifacts(outputDirectory));
  const printedPaths: string[] = [];
  const skipLines: string[] = [];
  const capturedErrorLines: string[] = [];
  let playlistTrackTotal: number | undefined;

  const args = [
    options.allowPlaylist ? "--yes-playlist" : "--no-playlist",
    "--no-mtime",
    "--newline",
    "--remote-components",
    "ejs:github",
    "--js-runtimes",
    `node:${process.execPath}`,
    "--print",
    "before_dl:__TRACK__|%(playlist_index)s|%(playlist_count)s|%(title)s",
    "--print",
    "after_move:%(filepath)s",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outputTemplate
  ];

  if (options.allowPlaylist) {
    args.push("--ignore-errors");
  }

  if (ffmpeg.source === "bundled") {
    args.push("--ffmpeg-location", path.dirname(ffmpeg.command));
  }

  args.push(input);

  const onLine = (line: string) => {
    const resolvedPath = resolvePrintedPath(line, outputDirectory);
    if (resolvedPath) {
      printedPaths.push(resolvedPath);
    }

    if (line.toLowerCase().includes("has already been downloaded")) {
      skipLines.push(line);
    }

    if (isYtDlpErrorLine(line)) {
      capturedErrorLines.push(line);
    }

    const trackMarker = parsePlaylistTrackMarker(line);
    if (trackMarker) {
      playlistTrackTotal = trackMarker.trackTotal;
    }

    if (!options.onProgress) {
      return;
    }

    const parsed = parseYtDlpProgressLine(line);
    if (parsed) {
      options.onProgress(parsed);
    }
  };

  const { lines: output, exitCode } = await runProcess(
    ytDlp.command,
    args,
    onLine,
    options.runtime
  );

  if (options.runtime?.isCancelled?.()) {
    throw new DownloadCancelledError();
  }

  const after = listMp3Files(outputDirectory);
  const { newFiles, existingFiles: existingFromPrinted } = partitionDownloadedMp3Files(
    before,
    printedPaths,
    after
  );
  const existingFromSkips = extractAlreadyDownloadedPaths(skipLines, outputDirectory);
  const existingFiles = [
    ...new Set([...existingFromPrinted, ...existingFromSkips])
  ];

  if (newFiles.length === 0) {
    if (existingFiles.length > 0) {
      return {
        tracks: addDownloads(existingFiles, sourceUrl),
        output,
        warnings: [
          existingFiles.length === 1
            ? "This track was already downloaded."
            : `All ${existingFiles.length} track(s) were already downloaded.`
        ]
      };
    }

    const afterArtifacts = listMediaArtifacts(outputDirectory);
    const newArtifacts = afterArtifacts.filter(
      (filePath) => !beforeArtifacts.has(filePath)
    );
    throw buildNoMp3Error({
      output,
      skipLines,
      ytDlp,
      ffmpeg,
      newArtifacts,
      exitCode
    });
  }

  const deliveredCount = newFiles.length + existingFiles.length;
  const warnings = buildPlaylistCompletionWarning({
    allowPlaylist: options.allowPlaylist,
    deliveredCount,
    playlistTrackTotal,
    exitCode,
    capturedErrorLines
  });

  if (exitCode !== 0 && exitCode !== null) {
    if (options.allowPlaylist) {
      return {
        tracks: addDownloads(newFiles, sourceUrl),
        output,
        warnings
      };
    }

    throw buildProcessError(path.basename(ytDlp.command), exitCode, output);
  }

  return {
    tracks: addDownloads(newFiles, sourceUrl),
    output,
    ...(warnings?.length ? { warnings } : {})
  };
}

async function assertBinariesAvailable(): Promise<void> {
  const status = await getBinaryStatus();

  if (!status.ytDlp.available) {
    throw new Error(
      `yt-dlp is not available (${status.ytDlp.command}). ${
        status.ytDlp.error ?? "Install yt-dlp or run npm run binaries:prepare."
      }`
    );
  }

  if (!status.ffmpeg.available) {
    throw new Error(
      `ffmpeg is not available (${status.ffmpeg.command}). ${
        status.ffmpeg.error ?? "Install ffmpeg or run npm run binaries:prepare."
      }`
    );
  }
}

function buildNoMp3Error(options: {
  output: string[];
  skipLines?: string[];
  ytDlp: ResolvedBinary;
  ffmpeg: ResolvedBinary;
  newArtifacts: string[];
  exitCode?: number | null;
}): Error {
  const diagnosticLines = [
    ...options.output,
    ...(options.skipLines ?? [])
  ];
  const tail = diagnosticLines
    .filter(
      (line) =>
        !line.endsWith(".mp3") &&
        !line.startsWith("after_move:") &&
        !line.startsWith("before_dl:")
    )
    .slice(-15);
  const outputText = tail.join("\n");
  const fullOutputText = diagnosticLines
    .filter(
      (line) =>
        !line.endsWith(".mp3") &&
        !line.startsWith("after_move:") &&
        !line.startsWith("before_dl:")
    )
    .join("\n");
  const lines = [
    options.exitCode
      ? `yt-dlp exited with code ${options.exitCode}, but no MP3 files were created.`
      : "yt-dlp finished, but no MP3 files were created.",
    `yt-dlp: ${options.ytDlp.source} (${options.ytDlp.command})`,
    `ffmpeg: ${options.ffmpeg.source} (${options.ffmpeg.command})`
  ];

  const knownIssue =
    detectKnownDownloadIssue(fullOutputText) ?? detectKnownDownloadIssue(outputText);
  if (knownIssue) {
    lines.push(knownIssue);
  }

  if (options.newArtifacts.length > 0) {
    lines.push(
      "Non-MP3 files were created (ffmpeg may have failed to convert):",
      ...options.newArtifacts.map((filePath) => `- ${path.basename(filePath)}`)
    );
  }

  if (tail.length > 0) {
    lines.push("Recent yt-dlp output:", outputText);
  }

  return new Error(lines.join("\n"));
}

function detectKnownDownloadIssue(outputText: string): string | null {
  const lower = outputText.toLowerCase();

  if (lower.includes("has already been downloaded")) {
    return "All requested tracks appear to be already downloaded.";
  }

  if (lower.includes("sign in to confirm") || lower.includes("confirm you’re not a bot")) {
    return "YouTube blocked the download. Try updating yt-dlp (npm run binaries:prepare) or sign in with browser cookies.";
  }

  if (
    lower.includes("private video") ||
    lower.includes("this playlist is private") ||
    lower.includes("members-only")
  ) {
    return "This video or playlist is private or members-only.";
  }

  if (
    lower.includes("ffmpeg") ||
    lower.includes("ffprobe") ||
    lower.includes("postprocessing")
  ) {
    return "Audio extraction failed. Ensure ffmpeg is installed and working (npm run binaries:prepare).";
  }

  if (lower.includes("video unavailable") || lower.includes("playlist does not exist")) {
    return "The video or playlist is unavailable or does not exist.";
  }

  if (
    lower.includes("unable to download api page") ||
    lower.includes("incomplete yt initial data")
  ) {
    return "YouTube could not load the playlist. Try updating yt-dlp (npm run binaries:prepare) or sign in with browser cookies.";
  }

  return null;
}

function resolvePrintedPath(line: string, outputDirectory: string): string | null {
  const normalizedLine = line.startsWith("after_move:")
    ? line.slice("after_move:".length).trim()
    : line;

  if (normalizedLine.startsWith("[")) {
    return null;
  }

  if (/^https?:\/\//i.test(normalizedLine)) {
    return null;
  }

  const candidate = path.resolve(normalizedLine);
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

async function checkBinary(name: BinaryName): Promise<BinaryCheck> {
  const resolved = resolveBinary(name);

  if (resolved.source === "bundled") {
    try {
      await fs.promises.access(resolved.command, fs.constants.X_OK);
    } catch (error) {
      return {
        name,
        available: false,
        command: resolved.command,
        source: "bundled",
        error: error instanceof Error ? error.message : String(error)
      };
    }

    void probeBinaryVersion(resolved.command, name);

    return {
      name,
      available: true,
      command: resolved.command,
      source: "bundled"
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(resolved.command, ["--version"], {
      timeout: BINARY_VERSION_TIMEOUT_MS[name],
      windowsHide: true
    });
    const version = (stdout || stderr).trim().split(/\r?\n/)[0];
    if (!version) {
      throw new Error(`${name} did not return a version string.`);
    }

    return {
      name,
      available: true,
      command: resolved.command,
      source: "path",
      version
    };
  } catch (error) {
    return {
      name,
      available: false,
      command: resolved.command,
      source: "missing",
      error: formatBinaryCheckError(error, name)
    };
  }
}

async function probeBinaryVersion(
  command: string,
  name: BinaryName
): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"], {
      timeout: BINARY_VERSION_TIMEOUT_MS[name],
      windowsHide: true
    });

    return (stdout || stderr).trim().split(/\r?\n/)[0] || undefined;
  } catch {
    return undefined;
  }
}

function formatBinaryCheckError(error: unknown, name: BinaryName): string {
  const message = error instanceof Error ? error.message : String(error);
  const timeoutSeconds = BINARY_VERSION_TIMEOUT_MS[name] / 1000;
  const killed =
    typeof error === "object" &&
    error !== null &&
    "killed" in error &&
    Boolean((error as { killed?: boolean }).killed);

  if (
    message.includes("ETIMEDOUT") ||
    message.toLowerCase().includes("timed out") ||
    killed
  ) {
    return `${name} took longer than ${timeoutSeconds}s to respond. Install ${name} or run npm run binaries:prepare.`;
  }

  if (message.includes("ENOENT") || message.toLowerCase().includes("not found")) {
    return `${name} was not found on PATH. Install ${name} or run npm run binaries:prepare.`;
  }

  return message;
}

function resolveBinary(name: BinaryName): ResolvedBinary {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const platformDirectory = `${process.platform}-${process.arch}`;
  const basePaths = [
    process.resourcesPath,
    app.getAppPath(),
    process.cwd()
  ].filter(Boolean);

  for (const basePath of basePaths) {
    const candidates = [
      path.join(basePath, "bin", platformDirectory, executable),
      path.join(basePath, "bin", executable)
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return {
          name,
          command: candidate,
          source: "bundled"
        };
      }
    }
  }

  return {
    name,
    command: executable,
    source: "path"
  };
}

function buildProcessError(
  commandName: string,
  exitCode: number | null,
  lines: string[]
): Error {
  const errors = extractYtDlpErrors(lines);
  if (errors.length > 0) {
    const summary = errors.slice(0, 5).join("\n");
    const extra =
      errors.length > 5 ? `\n…and ${errors.length - 5} more error(s).` : "";
    return new Error(
      `${commandName} exited with code ${exitCode ?? "unknown"}.\n${summary}${extra}`
    );
  }

  const tail = lines
    .filter(
      (line) =>
        !line.endsWith(".mp3") &&
        !line.startsWith("after_move:") &&
        !line.startsWith("before_dl:")
    )
    .slice(-8);

  return new Error(
    `${commandName} exited with code ${exitCode ?? "unknown"}.\n${
      tail.join("\n") || "No output captured."
    }`
  );
}

interface ProcessResult {
  lines: string[];
  exitCode: number | null;
}

function runProcess(
  command: string,
  args: string[],
  onLine?: (line: string) => void,
  runtime?: DownloadRuntimeOptions
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const pending = { stdout: "", stderr: "" };
    const child = spawn(command, args, {
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1"
      }
    });

    if (runtime?.jobId) {
      runningProcesses.set(runtime.jobId, child);
    }

    const captureLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      onLine?.(trimmed);
      lines.push(trimmed);
      if (lines.length > MAX_CAPTURED_LINES) {
        lines.shift();
      }
    };

    const capture = (
      stream: keyof typeof pending,
      chunk: Buffer
    ): void => {
      const parts = `${pending[stream]}${chunk.toString()}`.split(/\r\n|\n|\r/);
      pending[stream] = parts.pop() ?? "";
      parts.forEach(captureLine);
    };

    const flush = (stream: keyof typeof pending): void => {
      captureLine(pending[stream]);
      pending[stream] = "";
    };

    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.stdout.on("end", () => flush("stdout"));
    child.stderr.on("end", () => flush("stderr"));
    child.on("error", (error) => {
      if (runtime?.jobId) {
        runningProcesses.delete(runtime.jobId);
      }
      reject(error);
    });
    child.on("close", (code) => {
      flush("stdout");
      flush("stderr");
      if (runtime?.jobId) {
        runningProcesses.delete(runtime.jobId);
      }

      if (runtime?.isCancelled?.()) {
        reject(new DownloadCancelledError());
        return;
      }

      resolve({ lines, exitCode: code });
    });
  });
}

function listMp3Files(directory: string): string[] {
  return listFilesByExtension(directory, [".mp3"]);
}

function listMediaArtifacts(directory: string): string[] {
  return listFilesByExtension(directory, ARTIFACT_EXTENSIONS);
}

function listFilesByExtension(directory: string, extensions: string[]): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const normalizedExtensions = extensions.map((ext) => ext.toLowerCase());

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isFile()) {
        return false;
      }

      const lowerName = entry.name.toLowerCase();
      return normalizedExtensions.some((ext) => lowerName.endsWith(ext));
    })
    .map((entry) => path.join(directory, entry.name));
}

function sanitizeFileBaseName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "Spotify Track";
}

function nextAvailableBaseName(directory: string, baseName: string): string {
  let candidate = baseName;
  let index = 1;

  while (fs.existsSync(path.join(directory, `${candidate}.mp3`))) {
    candidate = `${baseName} (${index})`;
    index += 1;
  }

  return candidate;
}
