import { app } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { addDownloads } from "./database";
import {
  parseYtDlpProgressLine,
  extractYtDlpErrors,
  extractAlreadyDownloadedPaths,
  partitionDownloadedMp3Files,
  buildPlaylistCompletionWarning,
  parsePlaylistTrackMarker,
  isYtDlpErrorLine
} from "./downloadProgress";
import type {
  BinaryCheck,
  BinaryName,
  BinaryStatus,
  DownloadAudioResult,
  DownloadProgressUpdate
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

    const capture = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        onLine?.(trimmed);
        lines.push(trimmed);
        if (lines.length > MAX_CAPTURED_LINES) {
          lines.shift();
        }
      }
    };

    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", (error) => {
      if (runtime?.jobId) {
        runningProcesses.delete(runtime.jobId);
      }
      reject(error);
    });
    child.on("close", (code) => {
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
