import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { resolveBinary } from "./downloadService";
import { isArchiveDownloadUrl } from "./freeAudiobooksService";
import { normalizeMusicFileName } from "./musicFileNames";
import type {
  Audiobook,
  AudiobookPart,
  AudiobookProgress,
  AudiobookDraft,
  AudiobookDraftChapter,
  AudiobookSource,
  AudiobookSplitOptions,
  FreeAudiobookDetail,
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
// Applied before every user-supplied input: only local files, and only the
// demuxers for the formats the import dialog offers. Without it, a file named
// .m4b could be an ffmpeg concat script or playlist that makes ffmpeg open
// other local files or URLs, and that audio would end up on the watch.
const INPUT_GUARD = [
  "-protocol_whitelist",
  "file",
  "-format_whitelist",
  "mov,mp4,m4a,3gp,3g2,mj2,mp3,aac,flac,ogg,wav,asf,matroska,webm"
];
const DOWNLOAD_DIRECTORY = ".download";
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
const MAX_SECTION_BYTES = 1024 ** 3;

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
  source?: AudiobookSource;
  /** Chapter title for each source file, used when a file has no chapter marks. */
  sourceTitles?: string[];
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

const DRAFT_TTL_MS = 60 * 60_000;

const runningConversions = new Map<string, ChildProcess>();
const drafts = new Map<string, { sourcePaths: string[]; createdAt: number }>();
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
 * Reads chosen files without converting them, so the user can see the book's
 * length and chapters and pick a split first. Only the draft id leaves the
 * main process.
 */
export async function prepareAudiobookDraft(sourcePaths: string[]): Promise<AudiobookDraft> {
  if (sourcePaths.length === 0) {
    throw new Error("Choose at least one audio file.");
  }
  const sorted = sortSourcePaths(sourcePaths);
  const ffmpeg = resolveBinary("ffmpeg").command;
  const probes: ProbeResult[] = [];
  for (const sourcePath of sorted) {
    probes.push(await probeAudio(ffmpeg, sourcePath));
  }
  const metadata = probes[0]?.metadata ?? {};
  const durationSeconds = probes.reduce((total, probe) => total + probe.durationSeconds, 0);
  const chapters = describeChapters(probes, sorted, durationSeconds);

  const now = Date.now();
  for (const [id, draft] of drafts) {
    if (now - draft.createdAt > DRAFT_TTL_MS) drafts.delete(id);
  }
  const id = randomUUID();
  drafts.set(id, { sourcePaths: sorted, createdAt: now });

  return {
    id,
    title: cleanTitle(metadata.album || metadata.title || fallbackTitle(sorted)),
    author: metadata.album_artist || metadata.artist || metadata.author || undefined,
    durationSeconds,
    fileCount: sorted.length,
    chapterSource:
      chapters.length < 2 ? "none" : probes.some((probe) => probe.chapters.length > 0) ? "marks" : "files",
    chapters
  };
}

/** Converts a confirmed draft. Each draft converts once. */
export function startAudiobookImportFromDraft(
  draftId: string,
  split: AudiobookSplitOptions,
  onProgress: (progress: AudiobookProgress) => void,
  onUpdate: (book: Audiobook) => void
): Audiobook {
  const draft = drafts.get(draftId);
  if (!draft || Date.now() - draft.createdAt > DRAFT_TTL_MS) {
    drafts.delete(draftId);
    throw new Error("That import expired. Choose the file again.");
  }
  const book = startAudiobookImport(draft.sourcePaths, split, onProgress, onUpdate);
  drafts.delete(draftId);
  return book;
}

export function discardAudiobookDraft(draftId: string): void {
  drafts.delete(draftId);
}

function sortSourcePaths(sourcePaths: string[]): string[] {
  return [...sourcePaths].sort((left, right) =>
    path.basename(left).localeCompare(path.basename(right), undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
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

  const sorted = sortSourcePaths(sourcePaths);
  const manifest = createManifest(fallbackTitle(sorted), sorted, split);
  return launchConversion(manifest, onUpdate, () => convertAudiobook(manifest, onProgress));
}

/**
 * Downloads a LibriVox recording's sections from archive.org, then converts
 * them like an imported multi-file book: each section is one chapter.
 */
export function startFreeAudiobookImport(
  detail: FreeAudiobookDetail,
  split: AudiobookSplitOptions,
  onProgress: (progress: AudiobookProgress) => void,
  onUpdate: (book: Audiobook) => void
): Audiobook {
  if (detail.sections.length === 0) {
    throw new Error("This recording has no MP3 files to download.");
  }
  const manifest = createManifest(cleanTitle(detail.title), [], split);
  manifest.author = detail.author;
  manifest.durationSeconds = detail.runtimeSeconds ?? 0;
  manifest.source = {
    kind: "librivox",
    identifier: detail.identifier,
    pageUrl: detail.pageUrl,
    coverUrl: detail.coverUrl
  };
  manifest.sourceTitles = detail.sections.map((section) => section.title);
  writeManifest(manifest);

  const controller = new AbortController();
  // Until the first ffmpeg process starts, cancelling aborts the downloads.
  runningConversions.set(manifest.id, {
    kill: () => {
      controller.abort();
      return true;
    }
  } as unknown as ChildProcess);

  return launchConversion(manifest, onUpdate, async () => {
    try {
      manifest.sourcePaths = await downloadSections(
        manifest.id,
        detail,
        controller.signal,
        onProgress
      );
      await convertAudiobook(manifest, onProgress);
    } finally {
      // The downloaded sections are only conversion input.
      fs.rmSync(path.join(bookDirectory(manifest.id), DOWNLOAD_DIRECTORY), {
        recursive: true,
        force: true
      });
      manifest.sourcePaths = [detail.pageUrl];
    }
  });
}

function createManifest(
  title: string,
  sourcePaths: string[],
  split: AudiobookSplitOptions
): AudiobookManifest {
  const manifest: AudiobookManifest = {
    version: 1,
    id: randomUUID(),
    title,
    sourcePaths,
    createdAt: new Date().toISOString(),
    status: "converting",
    split: normalizeSplitOptions(split),
    durationSeconds: 0,
    parts: []
  };
  fs.mkdirSync(bookDirectory(manifest.id), { recursive: true });
  writeManifest(manifest);
  return manifest;
}

function launchConversion(
  manifest: AudiobookManifest,
  onUpdate: (book: Audiobook) => void,
  work: () => Promise<void>
): Audiobook {
  // Registering before the async work lets listAudiobooks tell a live
  // conversion apart from an interrupted one.
  if (!runningConversions.has(manifest.id)) {
    runningConversions.set(manifest.id, spawnPlaceholder());
  }

  void work()
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

/** Ids of books whose LibriVox recording is already downloaded or downloading. */
export function findAudiobookBySource(identifier: string): Audiobook | undefined {
  return listAudiobooks().find(
    (book) => book.source?.identifier === identifier && book.status !== "failed"
  );
}

async function downloadSections(
  id: string,
  detail: FreeAudiobookDetail,
  signal: AbortSignal,
  onProgress: (progress: AudiobookProgress) => void
): Promise<string[]> {
  const directory = path.join(bookDirectory(id), DOWNLOAD_DIRECTORY);
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });

  const knownTotal = detail.sections.every((section) => section.sizeBytes)
    ? detail.totalBytes
    : 0;
  const count = detail.sections.length;
  const paths: string[] = [];
  let doneBytes = 0;

  for (const [offset, section] of detail.sections.entries()) {
    const target = path.join(directory, `${String(offset + 1).padStart(4, "0")}.mp3`);
    const report = (sectionBytes: number): void => {
      const fraction = knownTotal
        ? (doneBytes + sectionBytes) / knownTotal
        : (offset + (section.sizeBytes ? sectionBytes / section.sizeBytes : 0)) / count;
      onProgress({
        id,
        phase: "downloading",
        progress: Math.min(Math.max(fraction, 0), 1),
        message: `Downloading section ${offset + 1} of ${count}`
      });
    };
    report(0);
    const bytes = await downloadVerified(section.url, target, section, signal, report);
    doneBytes += bytes;
    paths.push(target);
  }

  return paths;
}

/**
 * Streams one archive.org file to disk. Every redirect hop must stay on
 * archive.org over HTTPS, and the file must match the size and SHA-1 that
 * archive.org lists for it before ffmpeg ever reads it.
 */
async function downloadVerified(
  url: string,
  target: string,
  expected: { sizeBytes?: number; sha1?: string },
  signal: AbortSignal,
  onBytes: (bytes: number) => void
): Promise<number> {
  let current = url;
  let response: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isArchiveDownloadUrl(current)) {
      throw new Error("LibriVox download left archive.org; stopped for safety.");
    }
    response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "coroslink" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)])
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current).toString();
      response = undefined;
      continue;
    }
    break;
  }
  if (!response) {
    throw new Error("LibriVox download redirected too many times.");
  }
  if (!response.ok || !response.body) {
    throw new Error(`LibriVox download failed: ${response.status} ${response.statusText}.`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_SECTION_BYTES) {
    await response.body.cancel();
    throw new Error("A LibriVox section is larger than expected; stopped for safety.");
  }

  const hash = createHash("sha1");
  const output = fs.createWriteStream(target);
  let bytes = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > MAX_SECTION_BYTES) {
        throw new Error("A LibriVox section is larger than expected; stopped for safety.");
      }
      hash.update(chunk);
      if (!output.write(chunk)) {
        await once(output, "drain");
      }
      onBytes(bytes);
    }
    output.end();
    await once(output, "finish");
  } catch (caught) {
    output.destroy();
    throw caught;
  }

  if (expected.sizeBytes && bytes !== expected.sizeBytes) {
    throw new Error("A LibriVox section downloaded incompletely. Try again.");
  }
  if (expected.sha1 && hash.digest("hex") !== expected.sha1) {
    throw new Error("A LibriVox section failed its checksum. Try again.");
  }
  return bytes;
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
    book.parts.some((part) => isSamePartFile(part.name, track.name))
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

  // A downloaded book already carries its catalogue title and author.
  const metadata = probes[0]?.metadata ?? {};
  const title = manifest.source
    ? manifest.title
    : cleanTitle(metadata.album || metadata.title || manifest.title);
  manifest.title = title;
  if (!manifest.source) {
    manifest.author =
      metadata.album_artist || metadata.artist || metadata.author || undefined;
  }
  manifest.durationSeconds = probes.reduce(
    (total, probe) => total + probe.durationSeconds,
    0
  );
  writeManifest(manifest);

  const plan = planSegments(
    manifest.split ?? DEFAULT_AUDIOBOOK_SPLIT,
    probes,
    manifest.sourcePaths,
    manifest.durationSeconds,
    manifest.sourceTitles
  );
  manifest.splitNote = plan.note;

  const workDir = workDirectory(manifest.id);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  // One decode pass through the whole book, cut by ffmpeg's segment muxer.
  // Several files are joined with the concat filter rather than the concat
  // demuxer, so no user path is ever written into an ffmpeg script, and files
  // with different sample rates or channel counts still join cleanly.
  const inputArgs = manifest.sourcePaths.flatMap((sourcePath) => [
    ...INPUT_GUARD,
    "-i",
    sourcePath
  ]);
  const mapArgs =
    manifest.sourcePaths.length === 1
      ? ["-map", "0:a:0"]
      : [
          "-filter_complex",
          `${manifest.sourcePaths
            .map((_, index) => `[${index}:a:0]aresample=44100,aformat=channel_layouts=mono[a${index}]`)
            .join(";")};${manifest.sourcePaths.map((_, index) => `[a${index}]`).join("")}concat=n=${
            manifest.sourcePaths.length
          }:v=0:a=1[book]`,
          "-map",
          "[book]"
        ];
  await runFfmpeg(
    manifest.id,
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-y",
      ...inputArgs,
      ...mapArgs,
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
      ...INPUT_GUARD,
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
    // Both files are this conversion's own segments.
    "-protocol_whitelist",
    "file",
    "-format_whitelist",
    "concat,mp3",
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
  totalSeconds: number,
  sourceTitles: string[] = []
): SegmentPlan {
  const byMinutes = (note?: string): SegmentPlan => ({
    args: ["-segment_time", String(split.minutes * 60)],
    titles: [],
    note
  });
  if (split.mode !== "chapters") {
    return byMinutes();
  }

  const chapters = describeChapters(probes, sourcePaths, totalSeconds, sourceTitles);
  if (chapters.length < 2) {
    return byMinutes(`No chapters found, so it was split every ${split.minutes} min.`);
  }
  return {
    args: [
      "-segment_times",
      chapters
        .slice(1)
        .map((chapter) => chapter.startSeconds)
        .join(",")
    ],
    titles: chapters.map((chapter) => chapter.title)
  };
}

/**
 * The chapters a chapter split would produce, in order: the files' chapter
 * marks, or one chapter per joined file that has none. Marks right at the
 * start or end of the book are dropped; they would only make empty parts.
 */
export function describeChapters(
  probes: ProbeResult[],
  sourcePaths: string[],
  totalSeconds: number,
  sourceTitles: string[] = []
): AudiobookDraftChapter[] {
  const marks: ProbeChapter[] = [];
  let offset = 0;
  for (const [position, probe] of probes.entries()) {
    if (probe.chapters.length > 0) {
      marks.push(
        ...probe.chapters.map((chapter) => ({
          startSeconds: offset + chapter.startSeconds,
          title: chapter.title
        }))
      );
    } else {
      const sourcePath = sourcePaths[position];
      marks.push({
        startSeconds: offset,
        title:
          sourceTitles[position] ||
          probe.metadata.title ||
          (sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : undefined)
      });
    }
    offset += probe.durationSeconds;
  }

  const cuts = [
    ...new Set(
      marks
        .map((chapter) => chapter.startSeconds)
        .filter(
          (start) =>
            start > CHAPTER_EDGE_SECONDS && start < totalSeconds - CHAPTER_EDGE_SECONDS
        )
        .map((start) => Number(start.toFixed(3)))
    )
  ].sort((left, right) => left - right);
  const boundaries = [0, ...cuts];
  return boundaries.map((boundary, position) => {
    const mark = marks.find((candidate) =>
      position === 0
        ? candidate.startSeconds <= CHAPTER_EDGE_SECONDS
        : Math.abs(candidate.startSeconds - boundary) < 0.001
    );
    const end = boundaries[position + 1] ?? totalSeconds;
    return {
      title: mark?.title?.trim() || undefined,
      startSeconds: boundary,
      durationSeconds: Math.max(end - boundary, 0)
    };
  });
}

async function probeAudio(ffmpeg: string, sourcePath: string): Promise<ProbeResult> {
  // `ffmpeg -i` with no output exits non-zero but still prints the header.
  const { lines } = await runProcess(ffmpeg, ["-hide_banner", ...INPUT_GUARD, "-i", sourcePath]);
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
  // A line break in a path would start a new concat directive.
  if (sourcePaths.some((sourcePath) => /[\r\n]/.test(sourcePath))) {
    throw new Error("File names with line breaks can't be joined.");
  }
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
    onWatch: watchTracks.some((track) => isSamePartFile(part.name, track.name))
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
    parts,
    source: manifest.source
  };
}

/**
 * A watch file belongs to a book only under the exact part name. Unlike the
 * music library's matching, a "Name (1).mp3" copy is not treated as the
 * part: it may be someone else's file, and "Remove from watch" deletes
 * whatever matches.
 */
function isSamePartFile(partName: string, watchName: string): boolean {
  return normalizeMusicFileName(partName) === normalizeMusicFileName(watchName);
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
