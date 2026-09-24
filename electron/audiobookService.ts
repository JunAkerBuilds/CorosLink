import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { resolveBinary } from "./downloadService";
import { musicFileNamesMatch } from "./musicFileNames";
import type {
  Audiobook,
  AudiobookPart,
  AudiobookProgress,
  AudiobookSplitOptions,
  WatchTrack
} from "./types";

// COROS watches play MP3 only and keep no bookmark inside a track, so a book
// is cut into short, speech-tuned MP3 parts. Losing your place then costs at
// most one part, and the watch's skip button jumps a whole part.
export const DEFAULT_AUDIOBOOK_SPLIT: AudiobookSplitOptions = {
  mode: "minutes",
  minutes: 10
};
export const MIN_PART_MINUTES = 1;
export const MAX_PART_MINUTES = 180;
// Chapter marks this close to the start or end of the book would only make
// empty parts.
const CHAPTER_EDGE_SECONDS = 0.5;
const AUDIO_BITRATE = "64k";
const MAX_TITLE_LENGTH = 40;
const MANIFEST_NAME = "book.json";
const MAX_CAPTURED_LINES = 200;
// About three seconds at 64 kbps.
const TINY_TAIL_BYTES = 24_000;

export const AUDIOBOOK_EXTENSIONS = [
  "m4b",
  "m4a",
  "mp3",
  "aac",
  "flac",
  "ogg",
  "opus",
  "wav",
  "wma"
];

interface StoredPart {
  index: number;
  name: string;
  sizeBytes: number;
  durationSeconds: number;
  chapterTitle?: string;
}

interface AudiobookManifest {
  version: 1;
  id: string;
  title: string;
  author?: string;
  sourcePaths: string[];
  createdAt: string;
  status: Audiobook["status"];
  error?: string;
  /** Absent in manifests written before split options existed. */
  split?: AudiobookSplitOptions;
  splitNote?: string;
  durationSeconds: number;
  parts: StoredPart[];
}

export interface ProbeChapter {
  startSeconds: number;
  title?: string;
}

interface ProbeResult {
  durationSeconds: number;
  metadata: Record<string, string>;
  chapters: ProbeChapter[];
}

interface SegmentPlan {
  args: string[];
  /** Chapter title for each expected segment, by position. */
  titles: Array<string | undefined>;
  note?: string;
}

const runningConversions = new Map<string, ChildProcess>();
const cancelledConversions = new Set<string>();

export function getAudiobookDirectory(): string {
  const directory = path.join(app.getPath("userData"), "audiobooks");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function listAudiobooks(watchTracks: WatchTrack[] = []): Audiobook[] {
  const root = getAudiobookDirectory();
  const books: Audiobook[] = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifest = readManifest(entry.name);
    if (!manifest) {
      continue;
    }
    // A conversion that is not running in this process was interrupted by an
    // app restart or crash; its partial output is unusable.
    if (manifest.status === "converting" && !runningConversions.has(manifest.id)) {
      manifest.status = "failed";
      manifest.error = "Conversion was interrupted. Delete and import again.";
      writeManifest(manifest);
    }
    books.push(toAudiobook(manifest, watchTracks));
  }

  return books.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getAudiobook(
  id: string,
  watchTracks: WatchTrack[] = []
): Audiobook | undefined {
  const manifest = readManifest(id);
  return manifest ? toAudiobook(manifest, watchTracks) : undefined;
}

/** Absolute local paths of a book's parts, in the order they must be transferred. */
export function getAudiobookPartPaths(id: string): string[] {
  const manifest = requireManifest(id);
  return [...manifest.parts]
    .sort((left, right) => left.index - right.index)
    .map((part) => path.join(bookDirectory(id), part.name));
}

/**
 * Creates the book record and starts converting in the background. The
 * returned book is in the "converting" state; `onUpdate` receives the final
 * ready or failed book.
 */
export function startAudiobookImport(
  sourcePaths: string[],
  split: AudiobookSplitOptions,
  onProgress: (progress: AudiobookProgress) => void,
  onUpdate: (book: Audiobook) => void
): Audiobook {
  if (sourcePaths.length === 0) {
    throw new Error("Choose at least one audio file.");
  }

  const sorted = [...sourcePaths].sort((left, right) =>
    path.basename(left).localeCompare(path.basename(right), undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
  const manifest: AudiobookManifest = {
    version: 1,
    id: randomUUID(),
    title: fallbackTitle(sorted),
    sourcePaths: sorted,
    createdAt: new Date().toISOString(),
    status: "converting",
    split: normalizeSplitOptions(split),
    durationSeconds: 0,
    parts: []
  };
  fs.mkdirSync(bookDirectory(manifest.id), { recursive: true });
  writeManifest(manifest);

  // Registering before the async work lets listAudiobooks tell a live
  // conversion apart from an interrupted one.
  runningConversions.set(manifest.id, spawnPlaceholder());

  void convertAudiobook(manifest, onProgress)
    .then(() => {
      manifest.status = "ready";
      manifest.error = undefined;
    })
    .catch((caught: unknown) => {
      manifest.status = "failed";
      manifest.error = cancelledConversions.has(manifest.id)
        ? "Conversion cancelled."
        : caught instanceof Error
          ? caught.message
          : String(caught);
      manifest.parts = [];
      removePartFiles(manifest.id);
    })
    .finally(() => {
      runningConversions.delete(manifest.id);
      cancelledConversions.delete(manifest.id);
      fs.rmSync(workDirectory(manifest.id), { recursive: true, force: true });
      if (fs.existsSync(bookDirectory(manifest.id))) {
        writeManifest(manifest);
        onUpdate(toAudiobook(manifest, []));
      }
    });

  return toAudiobook(manifest, []);
}

export function cancelAudiobookConversion(id: string): boolean {
  const child = runningConversions.get(id);
  if (!child) {
    return false;
  }
  cancelledConversions.add(id);
  child.kill("SIGTERM");
  return true;
}

export function deleteAudiobook(id: string): void {
  cancelAudiobookConversion(id);
  fs.rmSync(bookDirectory(id), { recursive: true, force: true });
}

/** Names of the book's parts that are currently on the watch. */
export function audiobookPartsOnWatch(
  book: Audiobook,
  watchTracks: WatchTrack[]
): WatchTrack[] {
  return watchTracks.filter((track) =>
    book.parts.some((part) => musicFileNamesMatch(part.name, track.name))
  );
}

async function convertAudiobook(
  manifest: AudiobookManifest,
  onProgress: (progress: AudiobookProgress) => void
): Promise<void> {
  const ffmpeg = resolveBinary("ffmpeg").command;
  const report = (progress: number, message: string): void =>
    onProgress({ id: manifest.id, phase: "converting", progress, message });

  report(0, "Reading audiobook");
  const probes: ProbeResult[] = [];
  for (const sourcePath of manifest.sourcePaths) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`File not found: ${sourcePath}`);
    }
    probes.push(await probeAudio(ffmpeg, sourcePath));
  }

  const metadata = probes[0]?.metadata ?? {};
  const title = cleanTitle(metadata.album || metadata.title || manifest.title);
  manifest.title = title;
  manifest.author =
    metadata.album_artist || metadata.artist || metadata.author || undefined;
  manifest.durationSeconds = probes.reduce(
    (total, probe) => total + probe.durationSeconds,
    0
  );
  writeManifest(manifest);

  const plan = planSegments(
    manifest.split ?? DEFAULT_AUDIOBOOK_SPLIT,
    probes,
    manifest.sourcePaths,
    manifest.durationSeconds
  );
  manifest.splitNote = plan.note;

  const workDir = workDirectory(manifest.id);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  // One decode pass through the whole book, cut by ffmpeg's segment muxer.
  const inputArgs =
    manifest.sourcePaths.length === 1
      ? ["-i", manifest.sourcePaths[0]]
      : ["-f", "concat", "-safe", "0", "-i", writeConcatList(workDir, manifest.sourcePaths)];
  await runFfmpeg(
    manifest.id,
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-y",
      ...inputArgs,
      "-map",
      "0:a:0",
      "-vn",
      "-map_metadata",
      "-1",
      "-ac",
      "1",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      AUDIO_BITRATE,
      "-f",
      "segment",
      ...plan.args,
      "-segment_format",
      "mp3",
      "-reset_timestamps",
      "1",
      "-progress",
      "pipe:1",
      path.join(workDir, "segment_%05d.mp3")
    ],
    (line) => {
      const match = /^out_time_us=(\d+)$/.exec(line);
      if (match && manifest.durationSeconds > 0) {
        const seconds = Number(match[1]) / 1_000_000;
        report(
          Math.min(seconds / manifest.durationSeconds, 1) * 0.95,
          `Converting ${formatClock(seconds)} of ${formatClock(manifest.durationSeconds)}`
        );
      }
    }
  );

  const segments = fs
    .readdirSync(workDir)
    .filter((name) => /^segment_\d+\.mp3$/.test(name))
    .sort();
  if (segments.length === 0) {
    throw new Error("ffmpeg produced no audio. Is the file a DRM-free audiobook?");
  }
  await foldTinyTailSegment(manifest.id, ffmpeg, workDir, segments);

  // Zero-padded names sort in play order, and the watch plays in transfer
  // order, which follows this same order.
  const width = Math.max(3, String(segments.length).length);
  const fileStem = sanitizeFileStem(title);
  const parts: StoredPart[] = [];

  for (const [offset, segment] of segments.entries()) {
    const index = offset + 1;
    const number = String(index).padStart(width, "0");
    const name = `${fileStem} ${number}.mp3`;
    const destination = path.join(bookDirectory(manifest.id), name);
    const chapterTitle = plan.titles[offset];
    const tags: Record<string, string> = {
      title: chapterTitle ? `${number} ${chapterTitle}` : `${title} ${number}`,
      album: title,
      track: `${index}/${segments.length}`,
      genre: "Audiobook"
    };
    if (manifest.author) {
      tags.artist = manifest.author;
      tags.album_artist = manifest.author;
    }

    // Stream copy rewrites the ID3 tags and the Xing header (accurate
    // per-part duration) without re-encoding.
    await runFfmpeg(manifest.id, ffmpeg, [
      "-hide_banner",
      "-nostats",
      "-y",
      "-i",
      path.join(workDir, segment),
      "-map",
      "0:a",
      "-c",
      "copy",
      "-map_metadata",
      "-1",
      "-id3v2_version",
      "3",
      ...Object.entries(tags).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
      destination
    ]);

    // Chapter parts vary in length, so read each part's real duration.
    parts.push({
      index,
      name,
      sizeBytes: fs.statSync(destination).size,
      durationSeconds: (await probeAudio(ffmpeg, destination)).durationSeconds,
      chapterTitle
    });
    report(0.95 + (index / segments.length) * 0.05, `Tagging part ${index} of ${segments.length}`);
  }

  manifest.parts = parts;
}

/**
 * Encoder padding often leaves a final segment a fraction of a second long
 * when a book is a near-exact multiple of the part length. Append it to the
 * previous part instead of shipping a blip as its own track.
 */
async function foldTinyTailSegment(
  id: string,
  ffmpeg: string,
  workDir: string,
  segments: string[]
): Promise<void> {
  if (segments.length < 2) {
    return;
  }
  const tailPath = path.join(workDir, segments[segments.length - 1]);
  if (fs.statSync(tailPath).size >= TINY_TAIL_BYTES) {
    return;
  }
  const previousPath = path.join(workDir, segments[segments.length - 2]);
  const mergedPath = path.join(workDir, "merged.mp3");
  await runFfmpeg(id, ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    writeConcatList(workDir, [previousPath, tailPath]),
    "-c",
    "copy",
    mergedPath
  ]);
  fs.renameSync(mergedPath, previousPath);
  fs.rmSync(tailPath);
  segments.pop();
}

export function normalizeSplitOptions(
  split: Partial<AudiobookSplitOptions> | undefined
): AudiobookSplitOptions {
  const minutes = Math.round(Number(split?.minutes));
  return {
    mode: split?.mode === "chapters" ? "chapters" : "minutes",
    minutes: Number.isFinite(minutes)
      ? Math.min(Math.max(minutes, MIN_PART_MINUTES), MAX_PART_MINUTES)
      : DEFAULT_AUDIOBOOK_SPLIT.minutes
  };
}

/**
 * Turns the split choice into segment-muxer arguments. Chapter mode cuts at
 * each chapter start; when several files are joined, a file without chapter
 * marks counts as one chapter. A book with fewer than two chapters falls back
 * to fixed-length parts.
 */
export function planSegments(
  split: AudiobookSplitOptions,
  probes: ProbeResult[],
  sourcePaths: string[],
  totalSeconds: number
): SegmentPlan {
  const byMinutes = (note?: string): SegmentPlan => ({
    args: ["-segment_time", String(split.minutes * 60)],
    titles: [],
    note
  });
  if (split.mode !== "chapters") {
    return byMinutes();
  }

  const chapters: ProbeChapter[] = [];
  let offset = 0;
  for (const [position, probe] of probes.entries()) {
    if (probe.chapters.length > 0) {
      chapters.push(
        ...probe.chapters.map((chapter) => ({
          startSeconds: offset + chapter.startSeconds,
          title: chapter.title
        }))
      );
    } else {
      const sourcePath = sourcePaths[position];
      chapters.push({
        startSeconds: offset,
        title:
          probe.metadata.title ||
          (sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : undefined)
      });
    }
    offset += probe.durationSeconds;
  }

  const cuts = [
    ...new Set(
      chapters
        .map((chapter) => chapter.startSeconds)
        .filter(
          (start) =>
            start > CHAPTER_EDGE_SECONDS && start < totalSeconds - CHAPTER_EDGE_SECONDS
        )
        .map((start) => Number(start.toFixed(3)))
    )
  ].sort((left, right) => left - right);
  if (cuts.length === 0) {
    return byMinutes(`No chapters found, so it was split every ${split.minutes} min.`);
  }

  const boundaries = [0, ...cuts];
  const titles = boundaries.map((boundary, position) => {
    const chapter = chapters.find((candidate) =>
      position === 0
        ? candidate.startSeconds <= CHAPTER_EDGE_SECONDS
        : Math.abs(candidate.startSeconds - boundary) < 0.001
    );
    return chapter?.title?.trim() || undefined;
  });
  return {
    args: ["-segment_times", cuts.join(",")],
    titles
  };
}

async function probeAudio(ffmpeg: string, sourcePath: string): Promise<ProbeResult> {
  // `ffmpeg -i` with no output exits non-zero but still prints the header.
  const { lines } = await runProcess(ffmpeg, ["-hide_banner", "-i", sourcePath]);
  return parseProbeOutput(lines);
}

export function parseProbeOutput(lines: string[]): ProbeResult {
  const metadata: Record<string, string> = {};
  const chapters: ProbeChapter[] = [];
  let durationSeconds = 0;
  let inInputMetadata = false;
  let currentChapter: ProbeChapter | undefined;

  for (const line of lines) {
    const chapter = /^\s*Chapter #\d+:\d+: start (-?\d+(?:\.\d+)?), end/.exec(line);
    if (chapter) {
      currentChapter = { startSeconds: Math.max(Number(chapter[1]), 0) };
      chapters.push(currentChapter);
      continue;
    }
    if (/^\s*Stream #/.test(line)) {
      currentChapter = undefined;
    }
    if (currentChapter) {
      const chapterTitle = /^\s*title\s*:\s(.*)$/.exec(line);
      if (chapterTitle && currentChapter.title === undefined) {
        currentChapter.title = chapterTitle[1].trim();
      }
      continue;
    }

    const duration = /^\s*Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
    if (duration) {
      durationSeconds =
        Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      inInputMetadata = false;
      continue;
    }
    if (/^Input #0/.test(line)) {
      inInputMetadata = true;
      continue;
    }
    if (!inInputMetadata || /^\s*Metadata:\s*$/.test(line)) {
      continue;
    }
    const field = /^\s*([A-Za-z_]+)\s*:\s(.*)$/.exec(line);
    if (field && !(field[1].toLowerCase() in metadata)) {
      metadata[field[1].toLowerCase()] = field[2].trim();
    }
  }

  if (durationSeconds <= 0) {
    const reason = lines.find((line) => /Invalid data|No such file|decrypt|DRM/i.test(line));
    throw new Error(reason ?? "Could not read the audio duration.");
  }

  return { durationSeconds, metadata, chapters };
}

async function runFfmpeg(
  id: string,
  command: string,
  args: string[],
  onLine?: (line: string) => void
): Promise<void> {
  if (cancelledConversions.has(id)) {
    throw new Error("Conversion cancelled.");
  }
  const { exitCode, lines } = await runProcess(command, args, onLine, (child) =>
    runningConversions.set(id, child)
  );
  if (cancelledConversions.has(id)) {
    throw new Error("Conversion cancelled.");
  }
  if (exitCode !== 0) {
    const tail = lines.filter((line) => !line.includes("=")).slice(-6).join("\n");
    throw new Error(`ffmpeg exited with code ${exitCode ?? "unknown"}.\n${tail}`);
  }
}

function runProcess(
  command: string,
  args: string[],
  onLine?: (line: string) => void,
  onSpawn?: (child: ChildProcess) => void
): Promise<{ exitCode: number | null; lines: string[] }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const pending = { stdout: "", stderr: "" };
    const child = spawn(command, args, { windowsHide: true });
    onSpawn?.(child);

    const capture = (stream: keyof typeof pending, chunk: Buffer): void => {
      const parts = `${pending[stream]}${chunk.toString()}`.split(/\r\n|\n|\r/);
      pending[stream] = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim()) {
          continue;
        }
        onLine?.(part.trim());
        lines.push(part);
        if (lines.length > MAX_CAPTURED_LINES) {
          lines.shift();
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      for (const rest of [pending.stdout, pending.stderr]) {
        if (rest.trim()) {
          lines.push(rest);
        }
      }
      resolve({ exitCode, lines });
    });
  });
}

function spawnPlaceholder(): ChildProcess {
  // Stands in until the first ffmpeg process starts, so an early cancel is
  // recorded and honoured by runFfmpeg.
  return { kill: () => true } as unknown as ChildProcess;
}

function writeConcatList(workDir: string, sourcePaths: string[]): string {
  const listPath = path.join(workDir, "concat.txt");
  const body = sourcePaths
    .map((sourcePath) => `file '${sourcePath.replace(/'/g, "'\\''")}'`)
    .join("\n");
  fs.writeFileSync(listPath, `${body}\n`, "utf8");
  return listPath;
}

function toAudiobook(manifest: AudiobookManifest, watchTracks: WatchTrack[]): Audiobook {
  const parts: AudiobookPart[] = manifest.parts.map((part) => ({
    ...part,
    onWatch: watchTracks.some((track) => musicFileNamesMatch(part.name, track.name))
  }));
  return {
    id: manifest.id,
    title: manifest.title,
    author: manifest.author,
    sourcePaths: manifest.sourcePaths,
    createdAt: manifest.createdAt,
    status: manifest.status,
    error: manifest.error,
    split: manifest.split ?? DEFAULT_AUDIOBOOK_SPLIT,
    splitNote: manifest.splitNote,
    durationSeconds: manifest.durationSeconds,
    sizeBytes: parts.reduce((total, part) => total + part.sizeBytes, 0),
    parts
  };
}

function bookDirectory(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Invalid audiobook id.");
  }
  return path.join(getAudiobookDirectory(), id);
}

function workDirectory(id: string): string {
  return path.join(bookDirectory(id), ".work");
}

function readManifest(id: string): AudiobookManifest | undefined {
  try {
    const raw = fs.readFileSync(path.join(bookDirectory(id), MANIFEST_NAME), "utf8");
    const parsed = JSON.parse(raw) as AudiobookManifest;
    return parsed.version === 1 && parsed.id === id ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function requireManifest(id: string): AudiobookManifest {
  const manifest = readManifest(id);
  if (!manifest) {
    throw new Error("Audiobook was not found.");
  }
  return manifest;
}

function writeManifest(manifest: AudiobookManifest): void {
  const target = path.join(bookDirectory(manifest.id), MANIFEST_NAME);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(`${target}.tmp`, target);
}

function removePartFiles(id: string): void {
  const directory = bookDirectory(id);
  for (const name of fs.existsSync(directory) ? fs.readdirSync(directory) : []) {
    if (name.toLowerCase().endsWith(".mp3")) {
      fs.rmSync(path.join(directory, name), { force: true });
    }
  }
}

function fallbackTitle(sourcePaths: string[]): string {
  const first = sourcePaths[0];
  const stem = path.basename(first, path.extname(first));
  // A multi-file book is usually a folder of numbered chapters.
  return cleanTitle(sourcePaths.length > 1 ? path.basename(path.dirname(first)) : stem);
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim() || "Audiobook";
}

export function sanitizeFileStem(title: string): string {
  const stem = title
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .replace(/[\s.]+$/, "");
  return stem || "Audiobook";
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
