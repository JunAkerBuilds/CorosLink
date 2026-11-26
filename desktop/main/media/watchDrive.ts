// The watch as a USB drive: finding it among the mounted volumes, what's on it (music, maps, free space), and the
// writes the Media page makes (copy a track in, delete one, fix a capital .MP3, eject). One write at a time, and
// every write forgets the cached status so the next read sees it.
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createReadStream, createWriteStream, existsSync, statfsSync, statSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { lowercaseMp3, readMp3, safeName, withFile, type Mp3Info } from "./mp3";
import { t } from "@/lib/i18n";

const run = promisify(execFile);

export interface Volume { name: string; root: string; explicit?: boolean }

export interface WatchTrack extends Mp3Info {
  /** Path inside the Music folder. */
  path: string;
  name: string;
  bytes: number;
  /** Place in the folder: the order the watch plays it in (the order the files were copied). */
  order: number;
  /** Ends in .MP3 or .Mp3, which the watch never plays. */
  capital?: true;
}

export interface WatchStatus {
  connected: boolean;
  /** The model as the volume names it ("PACE Pro"), or "COROS watch". */
  model?: string;
  volume?: string;
  totalBytes?: number;
  freeBytes?: number;
  musicBytes?: number;
  mapBytes?: number;
  tracks: WatchTrack[];
  /** Plugged in, but its storage hasn't mounted: the watch is waiting for approval, or the cable only charges. */
  waiting?: string;
}

// Matches the whole label: a backup drive named "COROS Backup" or "APEX archives" must never become a write target.
// APEX 4 volumes can carry their size ("COROS APEX 4 46MM").
const WATCH_VOLUME = /^(?:COROS(?: WATCH)?|(?:COROS )?(?:PACE(?: ?(?:PRO|4(?: ?PRO)?|[23]))?|NOMAD|VERTIX ?(?:2(?: ?S)?|4)|APEX(?: ?(?:2(?: ?PRO)?|4(?: ?(?:42|46)(?: ?MM)?)?|PRO))?))$/i;
const INSTALLER = /desktop|setup|installer|\.dmg/i;

/** Whether a mounted volume is a COROS watch, by its whole name. */
export function isWatchVolume(name: string): boolean {
  if (INSTALLER.test(name)) return false;
  return WATCH_VOLUME.test(name.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " "));
}

/** "COROS PACE PRO" → "PACE Pro"; "COROS APEX 4 46MM" → "APEX 4 46mm"; "COROS" → "COROS watch". */
export function modelOf(volume: string): string {
  const words = volume.trim().replace(/[_-]+/g, " ").split(/\s+/).filter((w) => !/^coros$/i.test(w) && !/^watch$/i.test(w));
  if (!words.length) return "COROS watch";
  return words.map((w) => (/^pro$/i.test(w) ? "Pro" : /^\d+mm$/i.test(w) ? w.toLowerCase() : w.toUpperCase())).join(" ");
}

/** The first folder of these names that exists. Never assumes the drive ignores case: APEX 4 has `Map`, older watches `map`. */
export function findFolder(root: string, names: readonly string[]): string | undefined {
  for (const name of names) {
    const candidate = path.join(root, name);
    try { if (statSync(candidate).isDirectory()) return candidate; } catch { /* not there */ }
  }
  return undefined;
}

const isTrack = (name: string) => /\.mp3$/i.test(name) && !name.startsWith(".");

/** Every file under a folder, in the folder's own order (the order the watch reads them in). */
async function walk(root: string, keep: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && keep(entry.name)) out.push(full);
    }
  };
  await visit(root);
  return out;
}

/** Copies with a stream so the main process stays responsive on slow watch storage; a failed copy leaves nothing behind. */
export async function copyFile(source: string, target: string, progress?: (copied: number) => void): Promise<void> {
  const input = createReadStream(source);
  const output = createWriteStream(target, { flags: "wx" });
  let copied = 0;
  try {
    for await (const chunk of input) {
      const buffer = chunk as Buffer;
      if (!output.write(buffer)) await once(output, "drain");
      copied += buffer.length;
      progress?.(copied);
    }
    output.end();
    await once(output, "finish");
  } catch (error) {
    input.destroy();
    output.destroy();
    await rm(target, { force: true });
    throw error;
  }
}

/**
 * Removes the "._Name.mp3" files macOS writes beside files on a FAT drive (their extended attributes). The watch can
 * take them for tracks. Only these, and only in the Music folder. Best effort: it never stops a copy or an eject.
 */
export async function clearAppleDouble(music: string): Promise<number> {
  const names = await readdir(music).catch(() => [] as string[]);
  let removed = 0;
  for (const n of names) {
    if (!n.startsWith("._") || !/\.mp3$/i.test(n)) continue;
    await rm(path.join(music, n), { force: true }).then(() => { removed++; }, () => {});
  }
  return removed;
}

/** A free name in the folder: "Name.mp3", then "Name (1).mp3"… Compared without case, as FAT does. */
export async function freeName(folder: string, name: string): Promise<string> {
  const taken = new Set((await readdir(folder).catch(() => [] as string[])).map((n) => n.toLowerCase()));
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 1; taken.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

export class WatchProblem extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export interface DriveHost {
  /** The mounted volumes; the operating system's by default. */
  volumes?: () => Promise<Volume[]>;
  /** The name of a COROS device on the USB bus whose storage hasn't mounted. */
  probeUsb?: () => Promise<string | null>;
  eject?: (root: string) => Promise<void>;
  /** Time, for the cache (tests move it on). */
  now?: () => number;
}

const CACHE_MS = 60_000;

export class WatchDrive {
  private cached: { key: string; at: number; status: WatchStatus } | null = null;
  private scan: { key: string; generation: number; promise: Promise<WatchStatus> } | null = null;
  /** Bumped by every write, so a scan that started before it never caches its stale result. */
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly meta = new Map<string, Mp3Info & { stamp: string }>();
  private probe: { at: number; name: string | null } | null = null;

  constructor(private readonly host: DriveHost = {}) {}

  private now() { return this.host.now?.() ?? Date.now(); }

  invalidate(): void {
    this.cached = null;
    this.generation++;
  }

  /** One watch operation at a time, in the order asked for. */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async volumes(): Promise<Volume[]> {
    const explicit = process.env.CLINK_WATCH_PATH;
    if (explicit) return [{ name: path.basename(explicit) || "COROS", root: explicit, explicit: true }];
    return this.host.volumes ? this.host.volumes() : listVolumes();
  }

  /** What's on the watch. Reuses the last scan for a minute while the same volumes are mounted; concurrent reads share one scan. */
  async status(): Promise<WatchStatus> {
    // Taken before anything is read: a write that lands while the volumes are listed makes this read stale too.
    const generation = this.generation;
    const volumes = await this.volumes();
    const key = JSON.stringify(volumes);
    if (this.cached && this.cached.key === key && this.now() - this.cached.at < CACHE_MS) return this.cached.status;
    if (this.scan && this.scan.key === key && this.scan.generation === generation) return this.scan.promise;
    const scan = { key, generation, promise: this.read(volumes) };
    this.scan = scan;
    try {
      const status = await scan.promise;
      if (generation === this.generation) this.cached = { key, at: this.now(), status };
      return status;
    } finally {
      if (this.scan === scan) this.scan = null;
    }
  }

  private async read(volumes: Volume[]): Promise<WatchStatus> {
    const volume = volumes.filter((v) => v.explicit || isWatchVolume(v.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!volume) {
      const waiting = await this.usb();
      return { connected: false, tracks: [], ...(waiting ? { waiting } : {}) };
    }
    const music = findFolder(volume.root, ["Music", "music"]);
    const maps = findFolder(volume.root, ["Map", "map"]);
    const tracks = music ? await this.tracks(music) : [];
    let totalBytes: number | undefined, freeBytes: number | undefined;
    try {
      const fs = statfsSync(volume.root);
      totalBytes = fs.blocks * fs.bsize;
      freeBytes = fs.bavail * fs.bsize;
    } catch { /* unknown */ }
    const mapBytes = maps ? await sizeOf(maps) : 0;
    return {
      connected: true, model: modelOf(volume.name), volume: volume.name, totalBytes, freeBytes,
      musicBytes: tracks.reduce((a, t) => a + t.bytes, 0), mapBytes, tracks,
    };
  }

  private async tracks(music: string): Promise<WatchTrack[]> {
    const files = await walk(music, isTrack);
    const out: WatchTrack[] = [];
    for (const [i, file] of files.entries()) {
      const info = await stat(file);
      const stamp = `${info.size}:${info.mtimeMs}`;
      let meta = this.meta.get(file);
      if (meta?.stamp !== stamp) {
        meta = { ...(await withFile(file, readMp3).catch(() => ({ title: null, artist: null, album: null, secs: null }))), stamp };
        this.meta.set(file, meta);
      }
      const name = path.basename(file);
      out.push({
        path: path.relative(music, file), name, bytes: info.size, order: i + 1,
        title: meta.title, artist: meta.artist, album: meta.album, secs: meta.secs,
        ...(lowercaseMp3(name) !== name ? { capital: true as const } : {}),
      });
    }
    return out;
  }

  private async usb(): Promise<string | null> {
    if (!this.host.probeUsb && process.platform !== "darwin") return null;
    if (this.probe && this.now() - this.probe.at < 2_500) return this.probe.name;
    const name = await (this.host.probeUsb ?? probeMacUsb)().catch(() => null);
    this.probe = { at: this.now(), name };
    return name;
  }

  /** The watch's own folder (where Music and Map live), or null when it isn't mounted. */
  async root(): Promise<string | null> {
    return this.mounted().then((m) => m.root, () => null);
  }

  private async mounted(): Promise<{ root: string; music: string }> {
    const volumes = await this.volumes();
    const volume = volumes.filter((v) => v.explicit || isWatchVolume(v.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!volume) throw new WatchProblem(t("Plug in your watch first."), "noWatch");
    return { root: volume.root, music: findFolder(volume.root, ["Music", "music"]) ?? path.join(volume.root, "Music") };
  }

  /** Copies an MP3 to the watch's Music folder, always with a lowercase .mp3. Returns the name it got there. */
  copyIn(source: string, name: string, progress?: (copied: number) => void): Promise<string> {
    return this.exclusive(async () => {
      const { music } = await this.mounted();
      if (!/\.mp3$/i.test(name)) throw new WatchProblem(t("The watch plays MP3 files only."), "notMp3");
      await mkdir(music, { recursive: true });
      const target = await freeName(music, lowercaseMp3(safeName(name)));
      try {
        await copyFile(source, path.join(music, target), progress);
        await clearAppleDouble(music);
      } finally {
        this.invalidate();
      }
      return target;
    });
  }

  /** Deletes MP3s from the watch's Music folder; nothing outside it. */
  remove(paths: string[]): Promise<number> {
    return this.exclusive(async () => {
      const { music } = await this.mounted();
      let removed = 0;
      try {
        for (const p of paths) {
          const target = inside(music, p);
          if (!isTrack(path.basename(target))) throw new WatchProblem(t("Only MP3s can be removed from the watch."), "notMp3");
          await rm(target, { force: true });
          removed++;
        }
      } finally {
        this.invalidate();
      }
      return removed;
    });
  }

  /**
   * "Song.MP3" → "Song.mp3", so the watch plays it. FAT ignores case, so a case-only rename can be ignored: it goes
   * through a temporary name.
   */
  fixExtension(p: string): Promise<string> {
    return this.exclusive(async () => {
      const { music } = await this.mounted();
      const source = inside(music, p);
      const name = path.basename(source), fixed = lowercaseMp3(name);
      if (!isTrack(name)) throw new WatchProblem(t("Only MP3s on the watch can be renamed."), "notMp3");
      if (fixed === name) return name;
      const dir = path.dirname(source);
      const others = (await readdir(dir)).filter((n) => n !== name).map((n) => n.toLowerCase());
      if (others.includes(fixed.toLowerCase())) throw new WatchProblem(t("Another file on the watch is already called {name}.", { name: fixed }), "taken");
      const temp = path.join(dir, `${fixed}.rename-${process.pid}`);
      try {
        await rename(source, temp);
        try { await rename(temp, path.join(dir, fixed)); } catch (error) { await rename(temp, source); throw error; }
      } finally {
        this.invalidate();
      }
      return fixed;
    });
  }

  /** Ejects the watch so it can be unplugged. */
  eject(): Promise<void> {
    return this.exclusive(async () => {
      if (process.env.CLINK_WATCH_PATH) throw new WatchProblem(t("This watch folder was set by CLINK_WATCH_PATH and can't be ejected."), "explicit");
      const { root, music } = await this.mounted();
      await clearAppleDouble(music);
      try {
        await (this.host.eject ?? ejectVolume)(root);
      } catch (error) {
        const detail = error instanceof Error ? error.message.split("\n").find(Boolean) : String(error);
        throw new WatchProblem(`${t("The watch couldn't be ejected. Close anything using its files and try again.")} (${detail})`, "eject");
      } finally {
        this.invalidate();
      }
      const deadline = this.now() + 10_000;
      while (existsSync(root) && this.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      if (existsSync(root)) throw new WatchProblem(t("The watch is still mounted. Close anything using its files and try again."), "eject");
    });
  }
}

function inside(base: string, relative: string): string {
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) throw new WatchProblem(t("That file isn't in the watch's Music folder."), "outside");
  return resolved;
}

async function sizeOf(folder: string): Promise<number> {
  let total = 0;
  for (const file of await walk(folder, () => true).catch(() => [] as string[])) total += (await stat(file).catch(() => ({ size: 0 }))).size;
  return total;
}

async function listVolumes(): Promise<Volume[]> {
  const list = async (base: string) => (await readdir(base, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => ({ name: e.name, root: path.join(base, e.name) }));
  if (process.platform === "darwin") return list("/Volumes");
  if (process.platform === "win32") {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3 } | Select-Object DeviceID,VolumeName | ConvertTo-Json -Compress"], { windowsHide: true });
    if (!stdout.trim()) return [];
    const rows = ([] as { DeviceID: string; VolumeName?: string }[]).concat(JSON.parse(stdout.trim()));
    return rows.map((r) => ({ name: r.VolumeName || r.DeviceID, root: `${r.DeviceID}\\` }));
  }
  const user = os.userInfo().username;
  return (await Promise.all([`/media/${user}`, `/run/media/${user}`, "/mnt"].map(list))).flat();
}

/** Product and vendor names in `ioreg -p IOUSB -l` output. */
export function usbNames(output: string): string[] {
  return [...output.matchAll(/"(?:USB Product Name|USB Vendor Name|kUSBProductString|kUSBVendorString)"\s*=\s*"([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
}

/** The COROS device among USB names, preferring a model ("COROS PACE 3") over the bare vendor. */
export function corosOnUsb(names: readonly string[]): string | null {
  const hits = names.map((n) => n.trim()).filter((n) => /\bCOROS\b/i.test(n));
  return hits.find((n) => !/^COROS(?: WEARABLES?)?(?: INC\.?)?$/i.test(n)) ?? hits[0] ?? null;
}

async function probeMacUsb(): Promise<string | null> {
  const { stdout } = await run("/usr/sbin/ioreg", ["-p", "IOUSB", "-l", "-w0"], { timeout: 4_000, maxBuffer: 8 * 1024 * 1024 });
  return corosOnUsb(usbNames(stdout));
}

async function ejectVolume(root: string): Promise<void> {
  if (process.platform === "darwin") { await run("/usr/sbin/diskutil", ["eject", root], { timeout: 30_000 }); return; }
  if (process.platform === "win32") {
    const drive = root.replace(/[\\/]+$/, "");
    if (!/^[A-Z]:$/i.test(drive)) throw new Error(t("Unexpected drive letter."));
    await run("powershell.exe", ["-NoProfile", "-Command", `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${drive}').InvokeVerb('Eject')`], { windowsHide: true, timeout: 30_000 });
    return;
  }
  try { await run("gio", ["mount", "--unmount", root], { timeout: 30_000 }); } catch { await run("umount", [root], { timeout: 30_000 }); }
}
