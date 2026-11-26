// Putting cached region zips on the watch over USB: each zip's `map/…` tree is unpacked straight into the watch's
// Map folder (no extracted copy on this computer). Files the watch already holds at the same size are skipped, so
// only the bytes still needed count, and free space is checked before anything is written. A check reads those
// same-size files back and compares their CRC-32 with the zip's, so a stale or damaged tile is replaced too.
import { createReadStream, createWriteStream, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import zlib from "node:zlib";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipReader, type ZipEntry } from "./zip";
import { t } from "@/lib/i18n";

export class InstallProblem extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

/**
 * The watch's map folder. Never assumes the drive ignores case: APEX 4 has `Map`, older watches `map`. When neither
 * is there yet it's made the way the model has it.
 */
export function mapFolderOf(root: string, model?: string): { folder: string; exists: boolean } {
  let names: string[] = [];
  try { names = readdirSync(root).filter((n) => { try { return statSync(path.join(root, n)).isDirectory(); } catch { return false; } }); } catch { /* no root */ }
  // The folder's own spelling, as listed: `Map` first, then `map`, then any other case.
  const found = names.find((n) => n === "Map") ?? names.find((n) => n === "map") ?? names.find((n) => n.toLowerCase() === "map");
  if (found) return { folder: path.join(root, found), exists: true };
  return { folder: path.join(root, /APEX 4/i.test(model ?? "") ? "Map" : "map"), exists: false };
}

function canonical(p: string, paths: typeof path): string {
  let resolved = paths.resolve(p);
  try { resolved = realpathSync.native(resolved); } catch { /* not there yet */ }
  return resolved;
}

/**
 * True when one folder is the other or inside it. On Windows paths compare without case (E:\Map is e:\map);
 * elsewhere real paths are compared, which settles case on drives that ignore it.
 */
export function overlaps(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const paths = platform === "win32" ? path.win32 : path.posix;
  let x = platform === "win32" ? paths.resolve(a) : canonical(a, paths);
  let y = platform === "win32" ? paths.resolve(b) : canonical(b, paths);
  if (platform === "win32") { x = x.toLowerCase(); y = y.toLowerCase(); }
  const inside = (parent: string, child: string) => {
    const rel = paths.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !paths.isAbsolute(rel));
  };
  return inside(x, y) || inside(y, x);
}

/** Refuses to copy from the watch's own folder onto itself. */
export function assertNotOwnFolder(source: string, mapFolder: string, platform: NodeJS.Platform = process.platform): void {
  if (overlaps(source, mapFolder, platform)) throw new InstallProblem(t("These maps are already in the watch's own Map folder."), "ownFolder");
}

/**
 * Where an entry goes inside the watch's map folder: the zip's top `map`/`Map` folder is dropped (v4 zips say
 * `Map/`, v5 `map/`). Anything outside it, and any path that would climb out, is skipped.
 */
export function targetOf(mapFolder: string, entry: ZipEntry): string | null {
  if (entry.directory) return null;
  const parts = entry.name.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2 || parts[0].toLowerCase() !== "map") return null;
  const rest = parts.slice(1);
  if (rest.some((p) => p === ".." || p === "." || /[:<>|?*\0]/.test(p))) return null;
  if (rest[rest.length - 1].startsWith("._")) return null;
  return path.join(mapFolder, ...rest);
}

async function sizeAt(file: string): Promise<number | null> {
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? info.size : null;
}

/** Leftover `.clink-part` files: a copy cut short by a crash or an unplugged watch, never renamed into place. */
const PART = ".clink-part";

/** Removes the leftover parts in the map folder; how many there were. */
export async function clearLeftovers(mapFolder: string): Promise<number> {
  let removed = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(PART)) { await rm(full, { force: true }); removed++; }
    }
  };
  await walk(mapFolder);
  return removed;
}

/** A file's CRC-32, read in pieces; `onBytes` hears each piece. */
export async function crcOf(file: string, signal?: AbortSignal, onBytes?: (n: number) => void): Promise<number> {
  let crc = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20, signal }) as AsyncIterable<Buffer>) {
    crc = zlib.crc32(chunk, crc);
    onBytes?.(chunk.length);
  }
  return crc >>> 0;
}

export interface PlanTotals {
  /** Files to write and their bytes (the progress total). */
  files: number;
  bytes: number;
  /** What the watch's free space must take: new bytes beyond the files being replaced. */
  neededBytes: number;
  /** Files already there at the same size (and, in a check, the same contents). */
  skipped: number;
  /** Same-size files a check found different: written again (lower-case target paths). */
  replace: Set<string>;
}

export interface CheckOptions {
  /** Read same-size files back and compare their CRC-32 with the zip's. */
  check?: boolean;
  /** How far the check is: bytes read of the same-size files' total. */
  onChecked?: (read: number, total: number) => void;
}

/** Counts what still has to go to the watch for these zips. */
export async function plan(zips: string[], mapFolder: string, signal?: AbortSignal, options: CheckOptions = {}): Promise<PlanTotals> {
  const totals: PlanTotals = { files: 0, bytes: 0, neededBytes: 0, skipped: 0, replace: new Set() };
  const seen = new Set<string>();
  const stop = () => { if (signal?.aborted) throw new InstallProblem(t("Transfer cancelled."), "cancelled"); };
  const same: { target: string; key: string; size: number; crc: number }[] = [];
  for (const file of zips) {
    const zip = await ZipReader.open(file);
    try {
      for await (const entry of zip.entries()) {
        stop();
        const target = targetOf(mapFolder, entry);
        if (!target) continue;
        const key = target.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = await sizeAt(target);
        if (existing === entry.size) {
          if (options.check) same.push({ target, key, size: entry.size, crc: entry.crc32 >>> 0 });
          else totals.skipped++;
          continue;
        }
        totals.files++;
        totals.bytes += entry.size;
        totals.neededBytes += Math.max(0, entry.size - (existing ?? 0));
      }
    } finally {
      await zip.close();
    }
  }
  // The check: each same-size file read once; a different one is written again (same size, so no new space).
  const total = same.reduce((a, f) => a + f.size, 0);
  let read = 0;
  for (const f of same) {
    stop();
    let crc: number | null = null;
    try {
      crc = await crcOf(f.target, signal, (n) => { read += n; options.onChecked?.(read, total); });
    } catch {
      // A file the watch can't read back is written again.
      stop();
    }
    if (crc === f.crc) { totals.skipped++; continue; }
    totals.replace.add(f.key);
    totals.files++;
    totals.bytes += f.size;
  }
  return totals;
}

export interface CopyTick { copiedBytes: number; filesDone: number; label: string }

/**
 * Writes every file the watch doesn't hold yet. Each goes to a temporary name first and is renamed when complete,
 * so a cancelled or failed copy never leaves a short tile behind under its real name.
 */
export async function unpack(
  zips: { file: string; label: string }[],
  mapFolder: string,
  options: { signal?: AbortSignal; onProgress?: (tick: CopyTick) => void; replace?: ReadonlySet<string> } = {},
): Promise<{ copiedBytes: number; filesDone: number }> {
  const { signal } = options;
  let copiedBytes = 0, filesDone = 0;
  const seen = new Set<string>();
  const made = new Set<string>();
  const stop = () => { if (signal?.aborted) throw new InstallProblem(t("Transfer cancelled."), "cancelled"); };
  for (const { file, label } of zips) {
    const zip = await ZipReader.open(file);
    try {
      for await (const entry of zip.entries()) {
        stop();
        const target = targetOf(mapFolder, entry);
        if (!target) continue;
        const key = target.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if ((await sizeAt(target)) === entry.size && !options.replace?.has(key)) continue;
        const dir = path.dirname(target);
        if (!made.has(dir)) { await mkdir(dir, { recursive: true }); made.add(dir); }
        const temp = `${target}${PART}`;
        const base = copiedBytes;
        try {
          const input = await zip.stream(entry, { signal, verify: true });
          let written = 0;
          const count = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              written += chunk.length;
              options.onProgress?.({ copiedBytes: base + written, filesDone, label });
              done(null, chunk);
            },
          });
          await pipeline(input, count, createWriteStream(temp), { signal });
          await rename(temp, target);
        } catch (error) {
          await rm(temp, { force: true }).catch(() => undefined);
          if (signal?.aborted) throw new InstallProblem(t("Transfer cancelled."), "cancelled");
          throw error;
        }
        copiedBytes = base + entry.size;
        filesDone++;
        options.onProgress?.({ copiedBytes, filesDone, label });
      }
    } finally {
      await zip.close();
    }
  }
  return { copiedBytes, filesDone };
}

/** A few of a zip's files, spread through it, to tell later whether the package is on a watch. */
export interface Fingerprint { files: number; bytes: number; sample: [string, number][] }

const SAMPLE = 24;

export async function fingerprint(file: string): Promise<Fingerprint> {
  const zip = await ZipReader.open(file);
  try {
    const step = Math.max(1, Math.floor(zip.count / SAMPLE));
    const out: Fingerprint = { files: 0, bytes: 0, sample: [] };
    let index = 0;
    for await (const entry of zip.entries()) {
      const rel = targetOf("", entry);
      index++;
      if (rel === null) continue;
      out.files++;
      out.bytes += entry.size;
      if ((index - 1) % step === 0 && out.sample.length < SAMPLE) out.sample.push([rel.split(path.sep).join("/"), entry.size]);
    }
    if (!out.files) throw new InstallProblem(t("This download has no map files in it."), "empty");
    return out;
  } finally {
    await zip.close();
  }
}

/** On the watch when every sampled file is in its map folder at the same size. */
export async function onWatch(print: Fingerprint, mapFolder: string): Promise<boolean> {
  if (!print.sample.length) return false;
  for (const [rel, size] of print.sample) if ((await sizeAt(path.join(mapFolder, ...rel.split("/")))) !== size) return false;
  return true;
}
