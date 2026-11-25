// Audiobooks: how a book is cut into parts the watch can play. COROS watches play MP3 only, and keep your place
// inside a track only until the watch restarts or is plugged in over USB (every sync does that; measured on a PACE 4,
// CorosLink issue #167). So a book becomes short mono MP3 parts: losing your place costs at most one part, and the
// skip button jumps a part. Nothing here runs ffmpeg; audiobooks.ts does, with these plans.
import path from "node:path";
import { lowercaseMp3 } from "./mp3";

export type SplitMode = "chapters" | "minutes";
export interface Split { mode: SplitMode; minutes: number }

/** The watch adds about 3 s of silence between tracks, so shorter parts waste listening time. */
export const MIN_PART_MINUTES = 3;
export const MAX_PART_MINUTES = 180;
export const DEFAULT_SPLIT: Split = { mode: "minutes", minutes: 10 };

/** Formats the import accepts: DRM-free audio ffmpeg can read. */
export const BOOK_EXTENSIONS = ["m4b", "m4a", "mp3", "aac", "flac", "ogg", "opus", "wav", "wma"] as const;
export const isBookFile = (name: string) => BOOK_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase() as (typeof BOOK_EXTENSIONS)[number]);

export function normalizeSplit(split: Partial<Split> | undefined): Split {
  const minutes = Math.round(Number(split?.minutes));
  return {
    mode: split?.mode === "chapters" ? "chapters" : "minutes",
    minutes: Number.isFinite(minutes) ? Math.min(Math.max(minutes, MIN_PART_MINUTES), MAX_PART_MINUTES) : DEFAULT_SPLIT.minutes,
  };
}

/* ───────────── Pauses ───────────── */

/** A stretch of quiet audio, as ffmpeg's silencedetect reports it. */
export interface Pause { start: number; end: number }

/** silencedetect settings: quiet enough to be a pause between sentences. */
export const PAUSE_DB = -35;
export const PAUSE_SECONDS = 0.3;
/** A cut may move a tenth of the part length to land in a pause, but never more than 30 s. */
const MAX_SNAP = 30;
const SNAP_SHARE = 0.1;
/** A cut this close to the end would make only a sliver of a part. */
const END_MARGIN = 1;
/** Cut at most this long before speech resumes, so a long pause stays at the end of the earlier part. */
const LEAD_IN = 0.35;

/** Reads silencedetect lines as they stream; `finish` closes a pause that runs to the end. */
export function pauseCollector(): { push: (line: string) => void; finish: (total: number) => Pause[] } {
  const spans: Pause[] = [];
  let open: number | undefined;
  return {
    push(line) {
      const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
      if (start) { open = Math.max(Number(start[1]), 0); return; }
      const end = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
      if (end && open !== undefined) {
        if (Number(end[1]) > open) spans.push({ start: open, end: Number(end[1]) });
        open = undefined;
      }
    },
    finish(total) {
      if (open !== undefined && total > open) spans.push({ start: open, end: total });
      open = undefined;
      return spans;
    },
  };
}

/** Where in a pause a part ends: its middle, but no earlier than just before the next words. */
export function cutInPause(p: Pause): number {
  return Math.min(Math.max(p.start + (p.end - p.start) / 2, p.end - LEAD_IN), p.end);
}

/**
 * Cut times for parts of about `partSecs`, each moved to the nearest pause within reach so no part starts or ends
 * mid-word; with no pause close enough the cut stays on its mark. Each mark is measured from the previous cut, so parts
 * keep their length after a cut moves.
 */
export function pauseCuts(total: number, partSecs: number, pauses: readonly Pause[]): number[] {
  if (!(total > 0) || !(partSecs > 0)) return [];
  const reach = Math.min(MAX_SNAP, partSecs * SNAP_SHARE);
  const points = pauses.map(cutInPause).filter((p) => p > 0 && p < total - END_MARGIN).sort((a, b) => a - b);
  const cuts: number[] = [];
  let last = 0;
  for (;;) {
    const mark = last + partSecs;
    if (mark >= total - END_MARGIN) break;
    let best: number | undefined;
    for (const p of points) {
      if (p <= last || p < mark - reach) continue;
      if (p > mark + reach) break;
      if (best === undefined || Math.abs(p - mark) < Math.abs(best - mark)) best = p;
    }
    const cut = Number((best ?? mark).toFixed(3));
    cuts.push(cut);
    last = cut;
  }
  return cuts;
}

/* ───────────── Reading a file ───────────── */

export interface ProbeChapter { start: number; title?: string }
export interface Probe { secs: number; tags: Record<string, string>; chapters: ProbeChapter[] }

/** What `ffmpeg -i <file>` prints about a file: its length, tags and chapter marks. */
export function parseProbe(lines: readonly string[]): Probe {
  const tags: Record<string, string> = {};
  const chapters: ProbeChapter[] = [];
  let secs = 0;
  let inInput = false;
  let chapter: ProbeChapter | undefined;
  for (const line of lines) {
    const mark = /^\s*Chapter #\d+:\d+: start (-?\d+(?:\.\d+)?), end/.exec(line);
    if (mark) { chapter = { start: Math.max(Number(mark[1]), 0) }; chapters.push(chapter); continue; }
    if (/^\s*Stream #/.test(line)) chapter = undefined;
    if (chapter) {
      const t = /^\s*title\s*:\s(.*)$/.exec(line);
      if (t && chapter.title === undefined) chapter.title = t[1].trim();
      continue;
    }
    const d = /^\s*Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
    if (d) { secs = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]); inInput = false; continue; }
    if (/^Input #0/.test(line)) { inInput = true; continue; }
    if (!inInput || /^\s*Metadata:\s*$/.test(line)) continue;
    const field = /^\s*([A-Za-z_]+)\s*:\s(.*)$/.exec(line);
    if (field && !(field[1].toLowerCase() in tags)) tags[field[1].toLowerCase()] = field[2].trim();
  }
  if (secs <= 0) {
    const reason = lines.find((l) => /Invalid data|No such file|decrypt|DRM/i.test(l));
    throw new Error(/decrypt|DRM/i.test(reason ?? "") ? "This book is copy-protected (DRM), so it can't be converted." : "That file's length couldn't be read. Is it an audio file?");
  }
  return { secs, tags, chapters };
}

/* ───────────── Chapters and parts ───────────── */

export interface Chapter { title: string | null; start: number; secs: number }

/** Chapter marks this close to the start or end would make only empty parts. */
const EDGE = 0.5;

/**
 * The chapters a chapter split makes, in order: the files' own chapter marks, or one chapter per joined file that has
 * none (named by `titles`, its title tag or its file name).
 */
export function chaptersOf(probes: readonly Probe[], files: readonly string[], total: number, titles: readonly string[] = []): Chapter[] {
  const marks: ProbeChapter[] = [];
  let offset = 0;
  for (const [i, p] of probes.entries()) {
    if (p.chapters.length) marks.push(...p.chapters.map((c) => ({ start: offset + c.start, title: c.title })));
    else marks.push({ start: offset, title: titles[i] || p.tags.title || (files[i] ? path.basename(files[i], path.extname(files[i])) : undefined) });
    offset += p.secs;
  }
  const cuts = [...new Set(marks.map((m) => m.start).filter((s) => s > EDGE && s < total - EDGE).map((s) => Number(s.toFixed(3))))].sort((a, b) => a - b);
  const bounds = [0, ...cuts];
  return bounds.map((b, i) => {
    const mark = marks.find((m) => (i === 0 ? m.start <= EDGE : Math.abs(m.start - b) < 0.001));
    return { title: mark?.title?.trim() || null, start: b, secs: Math.max((bounds[i + 1] ?? total) - b, 0) };
  });
}

export interface SegmentPlan {
  /** ffmpeg segment-muxer arguments. */
  args: string[];
  /** Each part's chapter title, by position. */
  titles: (string | null)[];
  /** Said on the book when the split asked for wasn't possible. */
  note: string | null;
  /** Set for equal parts, whose cuts move to nearby pauses first. */
  partSecs: number | null;
}

/** The split as ffmpeg cuts it. A book with fewer than two chapters falls back to equal parts. */
export function planSegments(split: Split, probes: readonly Probe[], files: readonly string[], total: number, titles: readonly string[] = []): SegmentPlan {
  const byLength = (note: string | null): SegmentPlan => ({ args: ["-segment_time", String(split.minutes * 60)], titles: [], note, partSecs: split.minutes * 60 });
  if (split.mode !== "chapters") return byLength(null);
  const chapters = chaptersOf(probes, files, total, titles);
  if (chapters.length < 2) return byLength(`No chapters found, so it was split every ${split.minutes} min.`);
  return { args: ["-segment_times", chapters.slice(1).map((c) => c.start).join(",")], titles: chapters.map((c) => c.title), note: null, partSecs: null };
}

/* ───────────── Names ───────────── */

const MAX_STEM = 40;

export const cleanTitle = (title: string) => title.replace(/\s+/g, " ").trim() || "Audiobook";

/** A book's title as part of a file name: no characters FAT refuses, 40 characters at most. */
export function fileStem(title: string): string {
  const stem = title.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_STEM).replace(/[\s.]+$/, "");
  return stem || "Audiobook";
}

/** "012 Dune.mp3": the number first, because long names scroll on the watch and the number says where you are. */
export const partName = (stem: string, index: number, count: number) => `${String(index).padStart(Math.max(3, String(count).length), "0")} ${stem}.mp3`;

/**
 * Whether a watch file is this part. Only under its exact name: a "Name (1).mp3" may be someone else's file, and
 * removing a book from the watch deletes whatever matches.
 */
export const samePart = (part: string, onWatch: string) => lowercaseMp3(part).normalize("NFC").toLowerCase() === lowercaseMp3(onWatch).normalize("NFC").toLowerCase();

/** Files chosen together are one book, in the order their names count (01, 02 … 10). */
export const sortFiles = (files: readonly string[]) => [...files].sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: "base" }));

/** A book's title from its files when the tags have none: the folder of a multi-file book, or the file's name. */
export function titleFromFiles(files: readonly string[], names: readonly string[] = files): string {
  const first = names[0] ?? "Audiobook";
  if (names.length > 1) {
    const folder = path.basename(path.dirname(first));
    if (folder && folder !== ".") return cleanTitle(folder);
  }
  return cleanTitle(path.basename(first, path.extname(first)));
}
