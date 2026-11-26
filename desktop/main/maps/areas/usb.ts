// Map areas over the USB cable, instead of the watch fetching them over its Wi-Fi: this computer downloads the same
// per-square files COROS packs for the Wi-Fi download (kept in a cache here), then copies the ones the watch lacks to
// Map/<layer>/<first 3 quadkey digits>/<name>, the layout of COROS's own region packages. Rewritten from CorosLink's
// mapService.ts (installCorosMapAreas). The map folder is `Map` on APEX 4 and `map` on older watches, and the drive
// may or may not ignore case: an existing folder is used as it's spelled, never a second one made beside it.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import type { WatchDrive } from "../../media/watchDrive";
import type { CopyProgress } from "../../../maps/types";
import { AreasProblem, MapPackageClient, type AreaFile } from "./client";
import { t } from "@/lib/i18n";

/** The watch as a USB drive, as Map areas needs it. */
export interface AreasDrive {
  status(): Promise<{ connected: boolean; model?: string; volume?: string; totalBytes?: number; freeBytes?: number; mapBytes?: number }>;
  /** The mounted watch's root folder, or null when none is mounted. */
  root(): Promise<string | null>;
  /** Forget cached status after a write. */
  invalidate?(): void;
  /** One write to the watch at a time (shared with the Media page's copies). */
  exclusive?<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * The Media page's WatchDrive as Map areas uses it; CLINK_WATCH_PATH stands in for the watch's folder in development.
 */
export function areasDrive(drive: WatchDrive): AreasDrive {
  return {
    status: () => drive.status(),
    root: async () => {
      const status = await drive.status();
      if (!status.connected) return null;
      return process.env.CLINK_WATCH_PATH || drive.root();
    },
    invalidate: () => drive.invalidate(),
    exclusive: (work) => drive.exclusive(work),
  };
}

/**
 * The entry of `dir` called `names[0]` (or the next name), as it's spelled on the drive: an exact match first, then
 * one differing only in case. When there's none, the first name, to be made.
 */
async function entry(dir: string, names: readonly string[]): Promise<string> {
  const listed = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) if (listed.includes(name)) return path.join(dir, name);
  for (const name of names) {
    const found = listed.find((n) => n.toLowerCase() === name.toLowerCase());
    if (found) return path.join(dir, found);
  }
  return path.join(dir, names[0]);
}

/** The watch's map folder: `Map` (APEX 4) or `map` (older watches), whichever is there; `Map` when neither is. */
export function watchMapFolder(root: string): Promise<string> { return entry(root, ["Map", "map"]); }

/** Where one area file sits under a map folder (the cache's or the watch's), with the folders as they're spelled there. */
export async function areaFileIn(mapFolder: string, file: AreaFile): Promise<string> {
  const layer = await entry(mapFolder, [file.layer]);
  const group = await entry(layer, [file.quadkey.slice(0, 3)]);
  return entry(group, [file.name]);
}

const sizeOf = (file: string) => stat(file).then((s) => (s.isFile() ? s.size : undefined), () => undefined);

/** What the watch still takes on: a file it holds at the same size counts nothing; at another size, the difference. */
export async function bytesStillNeeded(files: AreaFile[], mapFolder: string): Promise<number> {
  let needed = 0;
  for (const file of files) needed += Math.max(0, file.sizeBytes - ((await sizeOf(await areaFileIn(mapFolder, file))) ?? 0));
  return needed;
}

export class CopyCancelled extends Error { constructor() { super("Copy cancelled."); } }

/** Streams chunks to a new file (never over one), stopping between chunks when cancelled; a failed write leaves nothing. */
async function writeStream(chunks: AsyncIterable<Uint8Array>, target: string, signal: AbortSignal, onChunk: (bytes: number) => void): Promise<number> {
  const out = createWriteStream(target, { flags: "wx" });
  let failed: Error | null = null;
  out.on("error", (error) => { failed = error; });
  let written = 0;
  try {
    for await (const chunk of chunks) {
      if (signal.aborted) throw new CopyCancelled();
      if (failed) throw failed;
      written += chunk.length;
      onChunk(written);
      if (!out.write(chunk)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
    return written;
  } catch (error) {
    out.destroy();
    await once(out, "close").catch(() => undefined);
    await rm(target, { force: true });
    throw signal.aborted ? new CopyCancelled() : error;
  }
}

export interface CopyJob {
  label: string;
  files: AreaFile[];
  /** The watch's map folder. */
  mapFolder: string;
  /** This computer's cache of area files (same layout). */
  cache: string;
  freeBytes?: number;
  fetch?: typeof fetch;
  signal: AbortSignal;
  onProgress: (progress: CopyProgress) => void;
}

/** Downloads one area file to the cache unless it's there at its size; never more bytes than COROS said. */
async function download(file: AreaFile, target: string, job: CopyJob): Promise<void> {
  if ((await sizeOf(target)) === file.sizeBytes) return;
  await mkdir(path.dirname(target), { recursive: true });
  const answer = await (job.fetch ?? fetch)(MapPackageClient.fileUrl(file), { signal: job.signal, redirect: "error" })
    .catch((error: unknown) => { if (job.signal.aborted) throw new CopyCancelled(); throw error; });
  if (!answer.ok || !answer.body) throw new AreasProblem(t("A map file couldn't be downloaded from COROS ({status}).", { status: answer.status }), "coros", 502);
  const part = `${target}.part`;
  await rm(part, { force: true });
  const received = await writeStream(answer.body as unknown as AsyncIterable<Uint8Array>, part, job.signal, (bytes) => {
    if (bytes > file.sizeBytes) throw new AreasProblem(t("A map file from COROS was bigger than COROS said. Try again."), "coros", 502);
  });
  if (received !== file.sizeBytes) {
    await rm(part, { force: true });
    throw new AreasProblem(t("A map file downloaded incompletely. Try again."), "coros", 502);
  }
  await rename(part, target);
}

/**
 * Copies the areas' files the watch lacks. Counts only bytes still needed, refuses when they don't fit, and leaves no
 * half-written file on the watch: each goes to "<name>.part" first and replaces the old one only when complete.
 */
export async function copyAreas(job: CopyJob): Promise<CopyProgress> {
  const pending: { file: AreaFile; target: string }[] = [];
  for (const file of job.files) {
    const target = await areaFileIn(job.mapFolder, file);
    if ((await sizeOf(target)) !== file.sizeBytes) pending.push({ file, target });
  }
  const totalBytes = pending.reduce((sum, p) => sum + p.file.sizeBytes, 0);
  const needed = await bytesStillNeeded(job.files, job.mapFolder);
  if (job.freeBytes !== undefined && needed > job.freeBytes) throw new AreasProblem(t("These map areas need more space than the watch has free."), "space");
  const progress: CopyProgress = { state: "copying", label: job.label, copiedBytes: 0, totalBytes, files: pending.length, filesDone: 0 };
  const tell = (message?: string) => job.onProgress({ ...progress, ...(message ? { message } : {}) });
  tell();
  for (const { file, target } of pending) {
    if (job.signal.aborted) throw new CopyCancelled();
    const cached = await areaFileIn(job.cache, file);
    tell("Downloading from COROS");
    await download(file, cached, job);
    tell("Copying to the watch");
    await mkdir(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    await rm(part, { force: true });
    const before = progress.copiedBytes;
    await writeStream(createReadStream(cached), part, job.signal, (copied) => {
      progress.copiedBytes = before + copied;
      tell("Copying to the watch");
    });
    await rm(target, { force: true });
    await rename(part, target);
    progress.copiedBytes = before + file.sizeBytes;
    progress.filesDone++;
  }
  return { ...progress, state: "done" };
}

/** Takes area files off the watch (only those named, only under its map folder). Answers how many went. */
export async function removeAreaFiles(files: AreaFile[], mapFolder: string): Promise<number> {
  let removed = 0;
  for (const file of files) {
    const target = await areaFileIn(mapFolder, file);
    if (!path.resolve(target).startsWith(path.resolve(mapFolder) + path.sep)) continue;
    if ((await sizeOf(target)) === undefined) continue;
    await rm(target, { force: true });
    removed++;
  }
  return removed;
}
