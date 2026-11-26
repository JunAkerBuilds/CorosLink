// "Download combined MP3": every track of a playlist downloaded, then joined into one MP3 (a long run or a mix plays
// as one file on the watch). Finished tracks are kept in a cache folder for the playlist, so trying again after some
// tracks failed fetches only the ones still missing; the new MP3 takes the old one's place in the library. A cache
// nobody touched for 7 days is removed.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat, utimes, writeFile, access } from "node:fs/promises";
import path from "node:path";
import type { Work } from "./downloads";
import type { Source } from "./library";
import { safeName } from "./mp3";
import { concatArgs, progressOf, run, ytDlpArgs } from "./tools";
import { t } from "@/lib/i18n";

export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const VERSION = 1;

/** The cache folder's name: the playlist and exactly which tracks, so an edited playlist starts a fresh cache. */
export function cacheKey(id: string, inputs: string[]): string {
  return createHash("sha256").update(JSON.stringify({ version: VERSION, id, inputs })).digest("hex");
}

/** Written only once a track's MP3 is whole, so a file cut short by a crash is never taken as done. */
const marker = (file: string) => `${file}.complete`;

export async function isDone(file: string): Promise<boolean> {
  try {
    const [s] = await Promise.all([stat(file), access(marker(file))]);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

const touch = (dir: string, now = new Date()) => utimes(dir, now, now).catch(() => {});

/** Removes caches untouched for `maxAge`, never one a combine is using now. Best effort: it never stops a download. */
export async function pruneCache(root: string, active: ReadonlySet<string>, now = Date.now(), maxAge = CACHE_MAX_AGE): Promise<string[]> {
  const removed: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory() || active.has(e.name)) continue;
    const dir = path.join(root, e.name);
    try {
      if (now - (await stat(dir)).mtimeMs <= maxAge) continue;
      await rm(dir, { recursive: true, force: true });
      removed.push(e.name);
    } catch { /* best effort */ }
  }
  return removed;
}

export interface Track { input: string; title: string }

export interface Combine {
  /** The playlist's id, service-scoped ("yt:PL…"). */
  id: string;
  name: string;
  tracks: Track[];
  source: Source;
  cacheRoot: string;
  /** Cache keys in use in this process. */
  active: Set<string>;
  /** Saves one track as `file` (an absolute .mp3 path). */
  fetchTrack: (input: string, file: string, progress: (p: number) => void, signal: AbortSignal) => Promise<void>;
  /** Joins the MP3s into `output`. */
  join: (files: string[], output: string, list: string, signal: AbortSignal) => Promise<void>;
}

/** The library origin a combined MP3 gets. */
export const combinedOrigin = (id: string) => `combined:${id}`;

export function combinedWork(c: Combine): Work {
  return async ({ dir: jobDir, progress, note, signal }) => {
    if (!c.tracks.length) throw new Error(t("That playlist has nothing to download."));
    await mkdir(c.cacheRoot, { recursive: true });
    await pruneCache(c.cacheRoot, c.active);
    const key = cacheKey(c.id, c.tracks.map((t) => t.input));
    if (c.active.has(key)) throw new Error(t("This combined MP3 is already being made."));
    c.active.add(key);
    const dir = path.join(c.cacheRoot, key);
    let keep = true;
    try {
      await mkdir(dir, { recursive: true });
      await touch(dir);
      const files: string[] = [];
      const failed: { title: string; why: string }[] = [];
      const n = c.tracks.length;
      for (const [i, track] of c.tracks.entries()) {
        if (signal.aborted) throw new Error(t("Cancelled."));
        const file = path.join(dir, `${String(i).padStart(4, "0")}.mp3`);
        if (await isDone(file)) { files.push(file); progress(((i + 1) / n) * 0.9); continue; }
        await rm(file, { force: true });
        await rm(marker(file), { force: true });
        try {
          await c.fetchTrack(track.input, file, (p) => progress(((i + p) / n) * 0.9), signal);
          await access(file);
          await writeFile(marker(file), "complete\n");
          await touch(dir);
          files.push(file);
        } catch (error) {
          if (signal.aborted) throw error;
          failed.push({ title: track.title, why: error instanceof Error ? error.message : String(error) });
        }
      }
      if (!files.length) throw new Error(`${t("None of the {n} tracks downloaded.", { n })} ${failed[0]?.why ?? ""}`.trim());
      const name = `${(c.name.trim() || t("Combined playlist")).slice(0, 140)}.mp3`;
      const output = path.join(jobDir, safeName(name));
      if (files.length === 1) await copyFile(files[0], output);
      else await c.join(files, output, path.join(dir, "concat.txt"), signal);
      progress(1);
      if (failed.length) note(`${files.length} of ${n} tracks. Left out: ${failed.slice(0, 3).map((f) => f.title).join(", ")}${failed.length > 3 ? "…" : ""}`);
      // A complete combine has nothing to come back for.
      keep = failed.length > 0;
      return [{ file: output, name, extra: { title: c.name.trim() || t("Combined playlist"), artist: null, album: null, source: c.source, origin: combinedOrigin(c.id), replace: true } }];
    } finally {
      c.active.delete(key);
      if (keep) await touch(dir);
      else await rm(dir, { recursive: true, force: true });
    }
  };
}

/** yt-dlp saving one track as `file`, through the tools. */
export function ytDlpTrack(ytDlp: () => string | null, ffmpeg: () => string | null): Combine["fetchTrack"] {
  return async (input, file, progress, signal) => {
    const bin = ytDlp();
    if (!bin) throw new Error(t("Downloading needs yt-dlp."));
    await run(bin, ytDlpArgs(input, path.dirname(file), ffmpeg(), path.basename(file, ".mp3")), (line) => {
      const p = progressOf(line);
      if (p != null) progress(p);
    }, signal);
  };
}

/** ffmpeg joining the tracks, through the tools. */
export function ffmpegJoin(ffmpeg: () => string | null): Combine["join"] {
  return async (files, output, list, signal) => {
    const bin = ffmpeg();
    if (!bin) throw new Error(t("Joining tracks needs ffmpeg."));
    const { args, listText } = concatArgs(files, list, output);
    await writeFile(list, listText);
    await run(bin, args, () => {}, signal);
  };
}
