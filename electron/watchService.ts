import { execFile } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DriveCandidate,
  WatchConnectionSmokeOptionId,
  WatchStatus,
  WatchTrack
} from "./types";
import { fallbackBytesForModel, resolveWatchModel } from "./watchModels";

const execFileAsync = promisify(execFile);
const INSTALLER_VOLUME_PATTERN = /desktop|setup|installer|\.dmg/i;
const ORIGINAL_COROS_WATCH_PATH = process.env.COROS_WATCH_PATH;
// Throttle progress callbacks so a fast local copy doesn't flood IPC, while a
// slow copy to the watch still ticks often enough to look responsive.
const TRANSFER_PROGRESS_MIN_INTERVAL_MS = 150;

export interface WatchTransferFileProgress {
  copiedBytes: number;
  totalBytes: number;
}

interface WatchConnectionSmokeFixture {
  volumeName: string;
  createMusicFolder: boolean;
  createMapFolder?: boolean;
  trackNames: string[];
  totalBytes?: number;
}

const WATCH_CONNECTION_SMOKE_FIXTURES: Record<
  Exclude<WatchConnectionSmokeOptionId, "auto">,
  WatchConnectionSmokeFixture
> = {
  none: {
    volumeName: "COROS WATCH EMPTY",
    createMusicFolder: false,
    trackNames: []
  },
  "pace-pro": {
    volumeName: "COROS PACE PRO",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Existing Track.mp3", "Workout Mix.mp3"],
    totalBytes: fallbackBytesForModel("pace-pro")
  },
  "pace-4": {
    volumeName: "COROS PACE 4",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Warmup.mp3"],
    totalBytes: fallbackBytesForModel("pace-4")
  },
  "pace-3": {
    volumeName: "COROS PACE 3",
    createMusicFolder: true,
    trackNames: ["Cooldown.mp3"],
    totalBytes: fallbackBytesForModel("pace-3")
  },
  "pace-2": {
    volumeName: "COROS PACE 2",
    createMusicFolder: true,
    trackNames: ["Interval Mix.mp3"],
    totalBytes: fallbackBytesForModel("pace-2")
  },
  nomad: {
    volumeName: "COROS NOMAD",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Trail Mix.mp3"],
    totalBytes: fallbackBytesForModel("nomad")
  },
  "vertix-2": {
    volumeName: "COROS VERTIX 2",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Summit Mix.mp3"],
    totalBytes: fallbackBytesForModel("vertix-2")
  },
  "vertix-2s": {
    volumeName: "COROS VERTIX 2S",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Ridge Mix.mp3"],
    totalBytes: fallbackBytesForModel("vertix-2s")
  },
  "apex-4": {
    volumeName: "COROS APEX 4",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Alpine Mix.mp3"],
    totalBytes: fallbackBytesForModel("apex-4")
  },
  "apex-2-pro": {
    volumeName: "COROS APEX 2 PRO",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Summit Mix.mp3"],
    totalBytes: fallbackBytesForModel("apex-2-pro")
  },
  "apex-2": {
    volumeName: "COROS APEX 2",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Ridge Mix.mp3"],
    totalBytes: fallbackBytesForModel("apex-2")
  },
  "apex-pro": {
    volumeName: "COROS APEX PRO",
    createMusicFolder: true,
    createMapFolder: true,
    trackNames: ["Trail Mix.mp3"],
    totalBytes: fallbackBytesForModel("apex-pro")
  },
  apex: {
    volumeName: "COROS APEX",
    createMusicFolder: true,
    trackNames: ["Classic Mix.mp3"],
    totalBytes: fallbackBytesForModel("apex")
  },
  "unknown-pace": {
    volumeName: "COROS PACE",
    createMusicFolder: true,
    trackNames: ["Track.mp3"],
    totalBytes: fallbackBytesForModel("pace-4")
  },
  installer: {
    volumeName: "COROS Desktop-0.1.0-arm64",
    createMusicFolder: false,
    createMapFolder: false,
    trackNames: []
  }
};

let activeSmokeTempRoot: string | undefined;
let activeSmokeWatchRoot: string | undefined;
let activeSmokeTotalBytes: number | undefined;
let activeWatchConnectionSmokeOptionId: WatchConnectionSmokeOptionId = "auto";

interface RawVolume {
  name: string;
  rootPath: string;
}

interface StorageStats {
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
}

// The renderer polls watch status on an interval; walking the watch's Music
// and map folders on every poll keeps the disk and main process busy. Reuse
// the last result while the mounted volume set is unchanged and the entry is
// fresh. Anything that writes to the watch must call
// invalidateWatchStatusCache() so the next poll rescans.
const WATCH_STATUS_CACHE_TTL_MS = 60_000;
let cachedWatchStatus:
  | { status: WatchStatus; volumeKey: string; expiresAt: number }
  | undefined;

export function invalidateWatchStatusCache(): void {
  cachedWatchStatus = undefined;
}

export async function getWatchStatus(): Promise<WatchStatus> {
  try {
    const volumes = await listVolumes();
    const volumeKey = volumes.map((volume) => volume.rootPath).join("\n");
    if (
      cachedWatchStatus &&
      cachedWatchStatus.volumeKey === volumeKey &&
      Date.now() < cachedWatchStatus.expiresAt
    ) {
      return cachedWatchStatus.status;
    }

    const candidates = await findDriveCandidates(volumes);
    const selected = candidates.find(
      (candidate) => candidate.musicPath || candidate.mapPath
    );

    if (!selected) {
      const status: WatchStatus = {
        connected: false,
        checkedAt: new Date().toISOString(),
        tracks: [],
        candidates
      };
      cachedWatchStatus = {
        status,
        volumeKey,
        expiresAt: Date.now() + WATCH_STATUS_CACHE_TTL_MS
      };
      return status;
    }

    const musicPath = selected.musicPath;
    const mapPath = selected.mapPath;
    const tracks = musicPath ? listWatchTracks(musicPath) : [];
    const model = resolveWatchModel(selected.name, selected.totalBytes);

    const status: WatchStatus = {
      connected: true,
      checkedAt: new Date().toISOString(),
      name: selected.name,
      model,
      rootPath: selected.rootPath,
      musicPath,
      mapPath,
      mapSizeBytes: selected.mapSizeBytes,
      mapFileCount: selected.mapFileCount,
      totalBytes: selected.totalBytes,
      freeBytes: selected.freeBytes,
      usedBytes: selected.usedBytes,
      tracks,
      candidates
    };
    cachedWatchStatus = {
      status,
      volumeKey,
      expiresAt: Date.now() + WATCH_STATUS_CACHE_TTL_MS
    };
    return status;
  } catch (error) {
    return {
      connected: false,
      checkedAt: new Date().toISOString(),
      tracks: [],
      candidates: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function getWatchConnectionSmokeOption(): WatchConnectionSmokeOptionId {
  return activeWatchConnectionSmokeOptionId;
}

export async function setWatchConnectionSmokeOption(
  optionId: WatchConnectionSmokeOptionId
): Promise<WatchStatus> {
  invalidateWatchStatusCache();
  if (optionId === "auto") {
    activeWatchConnectionSmokeOptionId = "auto";
    await clearActiveSmokeFixture();
    restoreOriginalWatchPathOverride();
    return getWatchStatus();
  }

  const fixture = WATCH_CONNECTION_SMOKE_FIXTURES[optionId];
  if (!fixture) {
    throw new Error(`Unknown watch smoke option: ${optionId}`);
  }

  await clearActiveSmokeFixture();
  restoreOriginalWatchPathOverride();

  try {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), `coroslink-watch-smoke-${optionId}-`)
    );
    const watchRoot = path.join(tempRoot, fixture.volumeName);
    await fs.promises.mkdir(watchRoot, { recursive: true });

    if (fixture.createMusicFolder) {
      const musicPath = path.join(watchRoot, "Music");
      await fs.promises.mkdir(musicPath, { recursive: true });

      for (const trackName of fixture.trackNames) {
        await fs.promises.writeFile(path.join(musicPath, trackName), "mp3");
      }

      await fs.promises.writeFile(path.join(musicPath, "._Ghost.mp3"), "junk");
      await fs.promises.writeFile(path.join(musicPath, ".DS_Store"), "junk");
      await fs.promises.writeFile(path.join(musicPath, "notes.txt"), "ignore");
    }

    if (fixture.createMapFolder) {
      const mapPath = path.join(watchRoot, "map");
      await fs.promises.mkdir(mapPath, { recursive: true });
      await fs.promises.writeFile(path.join(mapPath, "base.map"), "map");
    }

    activeSmokeTempRoot = tempRoot;
    activeSmokeWatchRoot = watchRoot;
    activeSmokeTotalBytes = fixture.totalBytes;
    activeWatchConnectionSmokeOptionId = optionId;
    process.env.COROS_WATCH_PATH = watchRoot;
    return getWatchStatus();
  } catch (error) {
    activeWatchConnectionSmokeOptionId = "auto";
    await clearActiveSmokeFixture();
    restoreOriginalWatchPathOverride();
    throw error;
  }
}

export async function deleteWatchTrack(relativePath: string): Promise<void> {
  const status = await getWatchStatus();
  if (!status.connected || !status.musicPath) {
    throw new Error("No COROS watch is connected.");
  }

  const targetPath = safeResolveInside(status.musicPath, relativePath);
  const fileName = path.basename(targetPath);
  if (!isWatchMusicFile(fileName)) {
    throw new Error("Only MP3 files can be deleted from the watch.");
  }

  fs.rmSync(targetPath, { force: true });
  invalidateWatchStatusCache();
}

export async function transferFileToWatch(
  filePath: string,
  onProgress?: (progress: WatchTransferFileProgress) => void
): Promise<WatchTrack> {
  if (!filePath.toLowerCase().endsWith(".mp3")) {
    throw new Error("COROS watches only support MP3 files.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error("Local MP3 file no longer exists.");
  }

  const status = await getWatchStatus();
  if (!status.connected || !status.rootPath) {
    throw new Error("No COROS watch is connected.");
  }

  const musicPath = status.musicPath ?? path.join(status.rootPath, "Music");

  fs.mkdirSync(musicPath, { recursive: true });

  const destination = nextAvailablePath(
    musicPath,
    sanitizeFileName(path.basename(filePath))
  );
  await copyFileToWatch(filePath, destination, onProgress);
  invalidateWatchStatusCache();

  const stats = fs.statSync(destination);
  return {
    name: path.basename(destination),
    relativePath: path.relative(musicPath, destination),
    absolutePath: destination,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString()
  };
}

// Copy to the watch with a streamed, backpressure-aware loop so the main
// process event loop stays responsive (a synchronous copy of a multi-megabyte
// file to slow watch storage blocks IPC for tens of seconds and freezes the
// UI). Emits byte-level progress so the renderer can show a live indicator.
async function copyFileToWatch(
  source: string,
  destination: string,
  onProgress?: (progress: WatchTransferFileProgress) => void
): Promise<void> {
  const totalBytes = (await fs.promises.stat(source)).size;

  if (!onProgress) {
    await fs.promises.copyFile(source, destination);
    return;
  }

  const readStream = fs.createReadStream(source);
  const writeStream = fs.createWriteStream(destination);
  let copiedBytes = 0;
  let lastEmitAt = 0;

  try {
    for await (const chunk of readStream) {
      const buffer = chunk as Buffer;
      if (!writeStream.write(buffer)) {
        await once(writeStream, "drain");
      }
      copiedBytes += buffer.length;

      const now = Date.now();
      if (now - lastEmitAt >= TRANSFER_PROGRESS_MIN_INTERVAL_MS) {
        lastEmitAt = now;
        onProgress({ copiedBytes, totalBytes });
      }
    }

    writeStream.end();
    await once(writeStream, "finish");
  } catch (caught) {
    writeStream.destroy();
    await fs.promises.rm(destination, { force: true });
    throw caught;
  }

  onProgress({ copiedBytes: totalBytes, totalBytes });
}

async function findDriveCandidates(
  volumes: RawVolume[]
): Promise<DriveCandidate[]> {
  const candidates: DriveCandidate[] = [];

  for (const volume of volumes) {
    if (INSTALLER_VOLUME_PATTERN.test(volume.name)) {
      continue;
    }

    const musicPath = path.join(volume.rootPath, "Music");
    const mapPath = path.join(volume.rootPath, "map");
    const hasMusicFolder = isDirectory(musicPath);
    const hasMapFolder = isDirectory(mapPath);

    if (!hasMusicFolder && !hasMapFolder) {
      continue;
    }

    const storage = getStorageStats(volume.rootPath, volume.name);
    const mapStats = hasMapFolder ? getDirectoryStats(mapPath) : {};
    candidates.push({
      name: volume.name,
      rootPath: volume.rootPath,
      musicPath: hasMusicFolder ? musicPath : undefined,
      mapPath: hasMapFolder ? mapPath : undefined,
      ...mapStats,
      ...storage,
      reason:
        hasMusicFolder && hasMapFolder
          ? "Music and map folders found"
          : hasMusicFolder
            ? "Music folder found"
            : "map folder found"
    });
  }

  return candidates.sort((left, right) => left.name.localeCompare(right.name));
}

async function listVolumes(): Promise<RawVolume[]> {
  const explicitWatchPath = process.env.COROS_WATCH_PATH;
  if (explicitWatchPath) {
    return [
      {
        name: path.basename(explicitWatchPath) || "COROS Watch",
        rootPath: explicitWatchPath
      }
    ];
  }

  if (process.platform === "darwin") {
    return listMacVolumes();
  }

  if (process.platform === "win32") {
    return listWindowsVolumes();
  }

  return listLinuxVolumes();
}

function listMacVolumes(): RawVolume[] {
  const base = "/Volumes";
  if (!isDirectory(base)) {
    return [];
  }

  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      rootPath: path.join(base, entry.name)
    }));
}

async function listWindowsVolumes(): Promise<RawVolume[]> {
  const command = [
    "Get-CimInstance Win32_LogicalDisk",
    "| Where-Object { $_.DriveType -in 2,3 }",
    "| Select-Object DeviceID,VolumeName",
    "| ConvertTo-Json -Compress"
  ].join(" ");

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    { windowsHide: true }
  );

  if (!stdout.trim()) {
    return [];
  }

  const parsed = JSON.parse(stdout.trim()) as
    | { DeviceID: string; VolumeName?: string }[]
    | { DeviceID: string; VolumeName?: string };
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows.map((row) => ({
    name: row.VolumeName || row.DeviceID,
    rootPath: `${row.DeviceID}\\`
  }));
}

function listLinuxVolumes(): RawVolume[] {
  const user = os.userInfo().username;
  const bases = [`/media/${user}`, `/run/media/${user}`, "/mnt"];

  return bases.flatMap((base) => {
    if (!isDirectory(base)) {
      return [];
    }

    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => ({
        name: entry.name,
        rootPath: path.join(base, entry.name)
      }));
  });
}

function listWatchTracks(musicPath: string): WatchTrack[] {
  const tracks: WatchTrack[] = [];

  function walk(currentPath: string): void {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile() || !isWatchMusicFile(entry.name)) {
        continue;
      }

      const stats = fs.statSync(absolutePath);
      tracks.push({
        name: entry.name,
        relativePath: path.relative(musicPath, absolutePath),
        absolutePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString()
      });
    }
  }

  walk(musicPath);
  return tracks.sort((left, right) => left.name.localeCompare(right.name));
}

function isWatchMusicFile(name: string): boolean {
  if (!name.toLowerCase().endsWith(".mp3")) {
    return false;
  }

  if (name.startsWith(".")) {
    return false;
  }

  return true;
}

function getStorageStats(rootPath: string, volumeName: string): StorageStats {
  if (
    activeSmokeWatchRoot &&
    path.resolve(rootPath) === path.resolve(activeSmokeWatchRoot)
  ) {
    return {
      totalBytes:
        activeSmokeTotalBytes ?? fallbackBytesForModel(resolveWatchModel(volumeName))
    };
  }

  try {
    const stats = fs.statfsSync(rootPath);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    return {
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - freeBytes
    };
  } catch {
    const model = resolveWatchModel(volumeName);
    return {
      totalBytes: fallbackBytesForModel(model)
    };
  }
}

function getDirectoryStats(directoryPath: string): {
  mapSizeBytes?: number;
  mapFileCount?: number;
} {
  let sizeBytes = 0;
  let fileCount = 0;

  function walk(currentPath: string): void {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = fs.statSync(absolutePath);
      sizeBytes += stats.size;
      fileCount += 1;
    }
  }

  try {
    walk(directoryPath);
    return {
      mapSizeBytes: sizeBytes,
      mapFileCount: fileCount
    };
  } catch {
    return {};
  }
}

async function clearActiveSmokeFixture(): Promise<void> {
  const tempRoot = activeSmokeTempRoot;
  activeSmokeTempRoot = undefined;
  activeSmokeWatchRoot = undefined;
  activeSmokeTotalBytes = undefined;

  if (tempRoot) {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

function restoreOriginalWatchPathOverride(): void {
  if (ORIGINAL_COROS_WATCH_PATH) {
    process.env.COROS_WATCH_PATH = ORIGINAL_COROS_WATCH_PATH;
  } else {
    delete process.env.COROS_WATCH_PATH;
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function safeResolveInside(basePath: string, relativePath: string): string {
  const resolved = path.resolve(basePath, relativePath);
  const normalizedBase = path.resolve(basePath) + path.sep;
  if (!resolved.startsWith(normalizedBase)) {
    throw new Error("Track path is outside the watch Music folder.");
  }

  return resolved;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
}

function nextAvailablePath(directory: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidate = path.join(directory, fileName);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${baseName} (${index})${extension}`);
    index += 1;
  }

  return candidate;
}
