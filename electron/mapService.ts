import { app, dialog, shell } from "electron";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  addGeneratedRoute,
  deleteCachedCorosMapRecord,
  deleteGeneratedRoute as deleteSavedGeneratedRoute,
  getCachedCorosMap,
  getGeneratedRoute,
  getSetting,
  listCachedCorosMaps as listStoredCachedCorosMaps,
  listGeneratedRoutes as listSavedGeneratedRoutes,
  setSetting,
  updateCachedCorosMapExtractedPath,
  upsertCachedCorosMap
} from "./database";
import type {
  CachedCorosMapPackage,
  CorosMapDownloadJob,
  CorosMapInstallResult,
  CorosMapInstallProgress,
  CorosMapLocalSelection,
  CorosMapManifest,
  CorosMapPackage,
  CorosMapType,
  DrawnRoutePayload,
  GenerateRouteRequest,
  GeneratedRoute,
  RouteActivityType,
  RouteApiKeyValidation,
  RouteBackend,
  RouteGeocodeResult,
  RouteGeometry,
  RouteBuilderConfig,
  RouteWaypoint,
  RouteWaypointRequest,
  TrainingHubTrackPoint
} from "./types";
import {
  haversineMeters,
  routeViaBrouter,
  straightLineGeometry,
  synthesizeLoop
} from "./routing/brouter";
import {
  geocodeNominatim,
  reverseGeocodeNominatim,
  searchNominatim
} from "./routing/nominatim";
import { getWatchStatus, invalidateWatchStatusCache } from "./watchService";

const COROS_MAP_HOST = "https://map-oss-us.coros.com";
const COROS_MAP_MANIFEST_URL = `${COROS_MAP_HOST}/regionMap/v5/regions_v5.json`;
const ORS_API_KEY_SETTING = "maps.openRouteServiceApiKey";
const ROUTE_BACKEND_SETTING = "maps.routeBackend";
const ORS_BASE_URL = "https://api.openrouteservice.org";
const MAX_FOOT_ROUTE_DISTANCE_KM = 100;
const MAX_CYCLING_ROUTE_DISTANCE_KM = 300;
const DOWNLOAD_PROGRESS_MIN_INTERVAL_MS = 250;

/** Maps a user-facing activity to an OpenRouteService routing profile. */
const ORS_PROFILE_BY_ACTIVITY: Record<RouteActivityType, string> = {
  walking: "foot-walking",
  running: "foot-walking",
  hiking: "foot-hiking",
  "cycling-road": "cycling-road",
  "cycling-mountain": "cycling-mountain"
};

function isCyclingActivity(activityType: RouteActivityType): boolean {
  return activityType.startsWith("cycling");
}

function maxRouteDistanceKm(activityType: RouteActivityType): number {
  return isCyclingActivity(activityType)
    ? MAX_CYCLING_ROUTE_DISTANCE_KM
    : MAX_FOOT_ROUTE_DISTANCE_KM;
}

interface RawCorosMapManifest {
  mapData?: RawCorosMapPackage[];
  updatedAt?: string;
  v?: string;
  host?: string;
  totalSize?: number;
  bundleVersion?: string;
}

interface RawCorosMapPackage {
  region?: string;
  parent?: string;
  type?: string;
  title?: string;
  data?: {
    size?: number;
    link?: string;
  };
}

interface DirectoryStats {
  sizeBytes: number;
  fileCount: number;
}

type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

interface CorosMapDownloadOptions {
  cacheDirectory?: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  onProgress?: (progress: {
    receivedBytes: number;
    sizeBytes: number;
    progress: number;
  }) => void;
}

interface CorosMapInstallProgressContext {
  totalBytes: number;
  totalFiles: number;
  copiedBytesOffset?: number;
  copiedFilesOffset?: number;
}

interface CorosMapInstallOptions {
  label?: string;
  progressContext?: CorosMapInstallProgressContext;
  /** When false, skip preparing and completed lifecycle publishes (batch middle packages). */
  publishLifecycle?: boolean;
}

interface CopyDirectoryOptions {
  totalBytes: number;
  totalFiles: number;
  onProgress: (progress: { copiedBytes: number; copiedFiles: number }) => void;
  signal?: AbortSignal;
}

class CorosMapInstallCancelledError extends Error {
  constructor() {
    super(COROS_MAP_INSTALL_CANCELLED_MESSAGE);
    this.name = "CorosMapInstallCancelledError";
  }
}

export const COROS_MAP_INSTALL_CANCELLED_MESSAGE = "Transfer cancelled.";

interface UnzipperFile {
  path: string;
  type: "Directory" | "File" | string;
  stream: () => NodeJS.ReadableStream;
}

interface UnzipperDirectory {
  files: UnzipperFile[];
}

interface UnzipperModule {
  Open: {
    file: (zipPath: string) => Promise<UnzipperDirectory>;
  };
}

interface OrsGeocodeResponse {
  features?: Array<{
    geometry?: {
      coordinates?: number[];
    };
    properties?: {
      label?: string;
      name?: string;
    };
  }>;
}

let corosMapDownloadListener:
  | ((jobs: CorosMapDownloadJob[]) => void)
  | undefined;
const corosMapDownloadJobs = new Map<string, CorosMapDownloadJob>();
const corosMapDownloadControllers = new Map<string, AbortController>();
let corosMapInstallProgressListener:
  | ((progress: CorosMapInstallProgress | null) => void)
  | undefined;
let corosMapInstallProgress: CorosMapInstallProgress | null = null;
let corosMapInstallAbortController: AbortController | null = null;

interface OrsDirectionsResponse {
  features?: Array<{
    geometry?: {
      type?: string;
      coordinates?: number[][];
    };
    properties?: {
      summary?: {
        distance?: number;
        duration?: number;
      };
      ascent?: number;
      descent?: number;
    };
  }>;
}

export async function getCorosMapManifest(): Promise<CorosMapManifest> {
  const response = await fetch(COROS_MAP_MANIFEST_URL, {
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(
      `COROS map manifest request failed: ${response.status} ${response.statusText}`
    );
  }

  return parseCorosMapManifest((await response.json()) as RawCorosMapManifest);
}

export function parseCorosMapManifest(
  manifest: RawCorosMapManifest
): CorosMapManifest {
  const version = String(manifest.v ?? "5");
  const host = normalizeHost(manifest.host ?? COROS_MAP_HOST);
  const packages: CorosMapPackage[] = [];

  for (const item of manifest.mapData ?? []) {
    const type = normalizeCorosMapType(item.type);
    const region = item.region?.trim();
    const link = item.data?.link?.trim();
    const sizeBytes = Number(item.data?.size ?? 0);

    if (!type || !region || !link || !Number.isFinite(sizeBytes)) {
      continue;
    }

    packages.push({
      id: `${version}:${region}:${type}`,
      region,
      parent: item.parent?.trim() || "global",
      title: titleFromMapKey(item.title ?? region),
      type,
      sizeBytes,
      link,
      downloadUrl: `${host}${link.startsWith("/") ? "" : "/"}${link}`,
      version,
      bundleVersion: manifest.bundleVersion,
      updatedAt: manifest.updatedAt
    });
  }

  packages.sort((left, right) => {
    const parent = left.parent.localeCompare(right.parent);
    if (parent !== 0) {
      return parent;
    }

    const region = left.region.localeCompare(right.region, undefined, {
      numeric: true
    });
    if (region !== 0) {
      return region;
    }

    return left.type.localeCompare(right.type);
  });

  return {
    version,
    bundleVersion: manifest.bundleVersion,
    updatedAt: manifest.updatedAt,
    totalSizeBytes: manifest.totalSize,
    packages
  };
}

export async function openCorosMapDownload(downloadUrl: string): Promise<void> {
  validateOfficialCorosDownloadUrl(downloadUrl);

  await shell.openExternal(downloadUrl);
}

export function setCorosMapDownloadListener(
  listener: (jobs: CorosMapDownloadJob[]) => void
): void {
  corosMapDownloadListener = listener;
}

export function listCorosMapDownloadJobs(): CorosMapDownloadJob[] {
  return Array.from(corosMapDownloadJobs.values()).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
}

export function setCorosMapInstallProgressListener(
  listener: (progress: CorosMapInstallProgress | null) => void
): void {
  corosMapInstallProgressListener = listener;
}

export function getCorosMapInstallProgress(): CorosMapInstallProgress | null {
  return corosMapInstallProgress;
}

export function cancelCorosMapInstall(): CorosMapInstallProgress | null {
  corosMapInstallAbortController?.abort();
  return corosMapInstallProgress;
}

export function downloadCorosMapPackage(
  mapPackage: CorosMapPackage
): CorosMapDownloadJob[] {
  validateCorosMapPackage(mapPackage);

  const existingActiveJob = listCorosMapDownloadJobs().find(
    (job) =>
      job.packageId === mapPackage.id &&
      (job.status === "queued" || job.status === "downloading")
  );
  if (existingActiveJob) {
    return listCorosMapDownloadJobs();
  }

  const existingCached = getCachedCorosMap(mapPackage.id);
  if (existingCached && fs.existsSync(existingCached.filePath)) {
    const now = new Date().toISOString();
    const job: CorosMapDownloadJob = {
      id: crypto.randomUUID(),
      packageId: mapPackage.id,
      title: mapPackage.title,
      region: mapPackage.region,
      type: mapPackage.type,
      downloadUrl: mapPackage.downloadUrl,
      sizeBytes: existingCached.sizeBytes,
      status: "cached",
      progress: 1,
      receivedBytes: existingCached.sizeBytes,
      filePath: existingCached.filePath,
      createdAt: now,
      updatedAt: now
    };
    corosMapDownloadJobs.set(job.id, job);
    publishCorosMapDownloadJobs();
    return listCorosMapDownloadJobs();
  }

  const now = new Date().toISOString();
  const job: CorosMapDownloadJob = {
    id: crypto.randomUUID(),
    packageId: mapPackage.id,
    title: mapPackage.title,
    region: mapPackage.region,
    type: mapPackage.type,
    downloadUrl: mapPackage.downloadUrl,
    sizeBytes: mapPackage.sizeBytes,
    status: "queued",
    progress: 0,
    receivedBytes: 0,
    createdAt: now,
    updatedAt: now
  };
  corosMapDownloadJobs.set(job.id, job);
  publishCorosMapDownloadJobs();

  void runCorosMapDownload(job.id, mapPackage);
  return listCorosMapDownloadJobs();
}

export function cancelCorosMapDownload(id: string): CorosMapDownloadJob[] {
  const controller = corosMapDownloadControllers.get(id);
  if (controller) {
    controller.abort();
    return listCorosMapDownloadJobs();
  }

  const job = corosMapDownloadJobs.get(id);
  if (job && (job.status === "queued" || job.status === "downloading")) {
    updateCorosMapDownloadJob(id, {
      status: "cancelled",
      error: "Download cancelled."
    });
  }

  return listCorosMapDownloadJobs();
}

export function clearCorosMapDownloadJob(id: string): CorosMapDownloadJob[] {
  const job = corosMapDownloadJobs.get(id);
  if (
    job &&
    !["queued", "downloading"].includes(job.status)
  ) {
    corosMapDownloadJobs.delete(id);
    publishCorosMapDownloadJobs();
  }

  return listCorosMapDownloadJobs();
}

export function listCachedCorosMaps(): CachedCorosMapPackage[] {
  const cachedPackages = listStoredCachedCorosMaps();
  const validPackages: CachedCorosMapPackage[] = [];

  for (const cached of cachedPackages) {
    if (fs.existsSync(cached.filePath)) {
      validPackages.push({
        ...cached,
        extractedPath:
          cached.extractedPath && fs.existsSync(cached.extractedPath)
            ? cached.extractedPath
            : undefined
      });
      continue;
    }

    deleteCachedCorosMapRecord(cached.packageId);
  }

  return validPackages;
}

export async function installCachedCorosMap(
  packageId: string
): Promise<CorosMapInstallResult> {
  const cached = getCachedCorosMap(packageId);
  if (!cached || !fs.existsSync(cached.filePath)) {
    deleteCachedCorosMapRecord(packageId);
    throw new Error("Cached COROS map package was not found.");
  }

  const status = await getWatchStatus();
  if (!status.connected || !status.rootPath) {
    throw new Error("Connect a COROS watch before installing maps.");
  }

  if (status.freeBytes !== undefined && cached.sizeBytes > status.freeBytes) {
    throw new Error(
      "The cached map package is larger than the free space on the watch."
    );
  }

  beginCorosMapInstall();
  try {
    assertCorosMapInstallNotCancelled();
    const extractPath = await ensureCachedCorosMapExtracted(cached);
    assertCorosMapInstallNotCancelled();
    return await installCorosMapFolder(extractPath, {
      label: cached.title
    });
  } catch (caught) {
    if (isCorosMapInstallCancelledError(caught)) {
      if (corosMapInstallProgress?.phase !== "cancelled") {
        publishCorosMapInstallCancelled({
          label: cached.title,
          totalBytes: cached.sizeBytes,
          totalFiles: 0,
          copiedBytes: corosMapInstallProgress?.copiedBytes ?? 0,
          copiedFiles: corosMapInstallProgress?.copiedFiles ?? 0,
          progress: corosMapInstallProgress?.progress ?? 0
        });
      }
    }
    throw caught;
  } finally {
    endCorosMapInstall();
  }
}

export async function installCachedCorosMaps(
  packageIds: string[]
): Promise<CorosMapInstallResult> {
  const uniqueIds = [...new Set(packageIds)];
  if (uniqueIds.length === 0) {
    throw new Error("Select at least one cached map package to install.");
  }

  const cachedPackages: CachedCorosMapPackage[] = [];
  for (const packageId of uniqueIds) {
    const cached = getCachedCorosMap(packageId);
    if (!cached || !fs.existsSync(cached.filePath)) {
      deleteCachedCorosMapRecord(packageId);
      throw new Error("Cached COROS map package was not found.");
    }
    cachedPackages.push(cached);
  }

  const status = await getWatchStatus();
  if (!status.connected || !status.rootPath) {
    throw new Error("Connect a COROS watch before installing maps.");
  }

  const totalSizeBytes = cachedPackages.reduce(
    (sum, cached) => sum + cached.sizeBytes,
    0
  );
  if (status.freeBytes !== undefined && totalSizeBytes > status.freeBytes) {
    throw new Error(
      "The selected map packages are larger than the free space on the watch."
    );
  }

  const preparedPackages: Array<{
    cached: CachedCorosMapPackage;
    selection: CorosMapLocalSelection;
  }> = [];
  let totalBytes = 0;
  let totalFiles = 0;

  beginCorosMapInstall();
  try {
    for (const cached of cachedPackages) {
      assertCorosMapInstallNotCancelled();
      const extractPath = await ensureCachedCorosMapExtracted(cached);
      assertCorosMapInstallNotCancelled();
      const selection = await inspectCorosMapFolder(extractPath);
      preparedPackages.push({ cached, selection });
      totalBytes += selection.sizeBytes;
      totalFiles += selection.fileCount;
    }

    const installedPath = path.join(status.rootPath, "map");
    const batchLabel =
      cachedPackages.length === 1
        ? cachedPackages[0]!.title
        : `${cachedPackages.length} map packages`;

    publishCorosMapInstallProgress({
      active: true,
      phase: "preparing",
      label: batchLabel,
      installedPath,
      copiedBytes: 0,
      totalBytes,
      copiedFiles: 0,
      totalFiles,
      progress: 0,
      updatedAt: new Date().toISOString()
    });

    let copiedBytesOffset = 0;
    let copiedFilesOffset = 0;
    let aggregateSizeBytes = 0;
    let aggregateFileCount = 0;

    try {
      await fs.promises.mkdir(installedPath, { recursive: true });

      for (let index = 0; index < preparedPackages.length; index += 1) {
        assertCorosMapInstallNotCancelled();
        const { cached, selection } = preparedPackages[index]!;
        const isLastPackage = index === preparedPackages.length - 1;
        const progressLabel =
          preparedPackages.length === 1
            ? cached.title
            : `${index + 1} of ${preparedPackages.length}: ${cached.title}`;

        const result = await installCorosMapFolder(selection.sourcePath, {
          label: progressLabel,
          publishLifecycle: false,
          progressContext: {
            totalBytes,
            totalFiles,
            copiedBytesOffset,
            copiedFilesOffset
          }
        });

        copiedBytesOffset += selection.sizeBytes;
        copiedFilesOffset += selection.fileCount;
        aggregateSizeBytes += result.sizeBytes;
        aggregateFileCount += result.fileCount;

        if (!isLastPackage) {
          publishCorosMapInstallProgress({
            active: true,
            phase: "copying",
            label: progressLabel,
            sourcePath: selection.sourcePath,
            installedPath,
            copiedBytes: copiedBytesOffset,
            totalBytes,
            copiedFiles: copiedFilesOffset,
            totalFiles,
            progress:
              totalBytes > 0 ? Math.min(copiedBytesOffset / totalBytes, 1) : 1,
            updatedAt: new Date().toISOString()
          });
        }
      }
    } catch (caught) {
      if (isCorosMapInstallCancelledError(caught)) {
        publishCorosMapInstallCancelled({
          label: batchLabel,
          installedPath,
          totalBytes,
          totalFiles,
          copiedBytes:
            corosMapInstallProgress?.copiedBytes ?? copiedBytesOffset,
          copiedFiles:
            corosMapInstallProgress?.copiedFiles ?? copiedFilesOffset,
          progress: corosMapInstallProgress?.progress ?? 0
        });
        throw caught;
      }

      const error = toWatchInstallError(caught, status.rootPath);
      publishCorosMapInstallProgress({
        active: false,
        phase: "failed",
        label: batchLabel,
        installedPath,
        copiedBytes: corosMapInstallProgress?.copiedBytes ?? copiedBytesOffset,
        totalBytes,
        copiedFiles: corosMapInstallProgress?.copiedFiles ?? copiedFilesOffset,
        totalFiles,
        progress: corosMapInstallProgress?.progress ?? 0,
        error: error.message,
        updatedAt: new Date().toISOString()
      });
      throw error;
    }

    publishCorosMapInstallProgress({
      active: false,
      phase: "completed",
      label: batchLabel,
      installedPath,
      copiedBytes: totalBytes,
      totalBytes,
      copiedFiles: totalFiles,
      totalFiles,
      progress: 1,
      updatedAt: new Date().toISOString()
    });

    invalidateWatchStatusCache();
    return {
      sourcePath: preparedPackages[0]!.selection.sourcePath,
      mapPath: preparedPackages[0]!.selection.mapPath,
      sizeBytes: aggregateSizeBytes,
      fileCount: aggregateFileCount,
      installedPath,
      watch: await getWatchStatus()
    };
  } catch (caught) {
    if (isCorosMapInstallCancelledError(caught)) {
      if (corosMapInstallProgress?.phase !== "cancelled") {
        publishCorosMapInstallCancelled({
          label:
            cachedPackages.length === 1
              ? cachedPackages[0]!.title
              : `${cachedPackages.length} map packages`,
          totalBytes: totalBytes || totalSizeBytes,
          totalFiles,
          copiedBytes: corosMapInstallProgress?.copiedBytes ?? 0,
          copiedFiles: corosMapInstallProgress?.copiedFiles ?? 0,
          progress: corosMapInstallProgress?.progress ?? 0
        });
      }
    }
    throw caught;
  } finally {
    endCorosMapInstall();
  }
}

export async function deleteCachedCorosMap(
  packageId: string
): Promise<CachedCorosMapPackage[]> {
  const cached = getCachedCorosMap(packageId);
  if (cached) {
    const cacheDirectory = getCorosMapCacheDirectory();
    await removePathInsideCache(cacheDirectory, cached.filePath);
    if (cached.extractedPath) {
      await removePathInsideCache(cacheDirectory, cached.extractedPath);
    }
  }

  deleteCachedCorosMapRecord(packageId);
  return listCachedCorosMaps();
}

export async function downloadCorosMapPackageToCache(
  mapPackage: CorosMapPackage,
  options: CorosMapDownloadOptions = {}
): Promise<CachedCorosMapPackage> {
  validateCorosMapPackage(mapPackage);
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheDirectory = options.cacheDirectory ?? getCorosMapCacheDirectory();
  await fs.promises.mkdir(cacheDirectory, { recursive: true });

  const cacheFileName = getCorosMapCacheFileName(mapPackage);
  const filePath = path.join(cacheDirectory, cacheFileName);
  const partPath = `${filePath}.part`;
  await fs.promises.rm(partPath, { force: true });

  const response = await fetchImpl(mapPackage.downloadUrl, {
    signal: options.signal
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `COROS map download failed: ${response.status} ${response.statusText}`
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  const sizeBytes =
    Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : mapPackage.sizeBytes;
  let receivedBytes = 0;
  let lastProgressAt = 0;
  const file = fs.createWriteStream(partPath, { flags: "w" });
  const reader = response.body.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      receivedBytes += chunk.byteLength;
      if (!file.write(chunk)) {
        await once(file, "drain");
      }

      const now = Date.now();
      if (now - lastProgressAt >= DOWNLOAD_PROGRESS_MIN_INTERVAL_MS) {
        lastProgressAt = now;
        options.onProgress?.({
          receivedBytes,
          sizeBytes,
          progress: sizeBytes > 0 ? Math.min(receivedBytes / sizeBytes, 1) : 0
        });
      }
    }

    file.end();
    await once(file, "finish");
  } catch (caught) {
    file.destroy();
    await fs.promises.rm(partPath, { force: true });
    throw caught;
  }

  await fs.promises.rename(partPath, filePath);
  const finalStats = await fs.promises.stat(filePath);
  options.onProgress?.({
    receivedBytes: finalStats.size,
    sizeBytes: sizeBytes > 0 ? sizeBytes : finalStats.size,
    progress: 1
  });

  return {
    packageId: mapPackage.id,
    title: mapPackage.title,
    region: mapPackage.region,
    parent: mapPackage.parent,
    type: mapPackage.type,
    sizeBytes: sizeBytes > 0 ? sizeBytes : finalStats.size,
    downloadUrl: mapPackage.downloadUrl,
    filePath,
    downloadedAt: new Date().toISOString()
  };
}

export async function chooseCorosMapFolder(): Promise<
  CorosMapLocalSelection | undefined
> {
  const result = await dialog.showOpenDialog({
    title: "Choose extracted COROS map folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }

  return inspectCorosMapFolder(result.filePaths[0]!);
}

export async function inspectCorosMapFolder(
  sourcePath: string
): Promise<CorosMapLocalSelection> {
  const mapPath = await resolveMapSourcePath(sourcePath);
  const stats = await getDirectoryStats(mapPath);
  return {
    sourcePath,
    mapPath,
    sizeBytes: stats.sizeBytes,
    fileCount: stats.fileCount
  };
}

export async function installCorosMapFolder(
  sourcePath: string,
  options: CorosMapInstallOptions = {}
): Promise<CorosMapInstallResult> {
  const ownsInstallSession = !getCorosMapInstallSignal();
  if (ownsInstallSession) {
    beginCorosMapInstall();
  }

  try {
    const selection = await inspectCorosMapFolder(sourcePath);
    const status = await getWatchStatus();

    if (!status.connected || !status.rootPath) {
      throw new Error("Connect a COROS watch before installing maps.");
    }

    const progressContext = options.progressContext;
    const publishLifecycle = options.publishLifecycle !== false;
    const totalBytes = progressContext?.totalBytes ?? selection.sizeBytes;
    const totalFiles = progressContext?.totalFiles ?? selection.fileCount;
    const copiedBytesOffset = progressContext?.copiedBytesOffset ?? 0;
    const copiedFilesOffset = progressContext?.copiedFilesOffset ?? 0;
    const installSignal = getCorosMapInstallSignal();

    const computeProgress = (copiedBytes: number, copiedFiles: number) =>
      totalBytes > 0
        ? Math.min((copiedBytesOffset + copiedBytes) / totalBytes, 1)
        : copiedFilesOffset + copiedFiles >= totalFiles
          ? 1
          : 0;

    if (
      !progressContext &&
      status.freeBytes !== undefined &&
      selection.sizeBytes > status.freeBytes
    ) {
      throw new Error(
        `The selected map folder is larger than the free space on the watch.`
      );
    }

    const installedPath = path.join(status.rootPath, "map");
    assertNotSameOrNested(selection.mapPath, installedPath);
    const label = options.label ?? path.basename(selection.sourcePath);

    if (publishLifecycle) {
      publishCorosMapInstallProgress({
        active: true,
        phase: "preparing",
        label,
        sourcePath: selection.sourcePath,
        installedPath,
        copiedBytes: copiedBytesOffset,
        totalBytes,
        copiedFiles: copiedFilesOffset,
        totalFiles,
        progress: computeProgress(0, 0),
        updatedAt: new Date().toISOString()
      });
    }

    try {
      if (publishLifecycle) {
        await fs.promises.mkdir(installedPath, { recursive: true });
      }
      assertCorosMapInstallNotCancelled();
      publishCorosMapInstallProgress({
        active: true,
        phase: "copying",
        label,
        sourcePath: selection.sourcePath,
        installedPath,
        copiedBytes: copiedBytesOffset,
        totalBytes,
        copiedFiles: copiedFilesOffset,
        totalFiles,
        progress: computeProgress(0, 0),
        updatedAt: new Date().toISOString()
      });
      await copyDirectoryContents(selection.mapPath, installedPath, {
        totalBytes: selection.sizeBytes,
        totalFiles: selection.fileCount,
        signal: installSignal,
        onProgress: ({ copiedBytes, copiedFiles }) => {
          const aggregateCopiedBytes = copiedBytesOffset + copiedBytes;
          const aggregateCopiedFiles = copiedFilesOffset + copiedFiles;
          publishCorosMapInstallProgress({
            active: true,
            phase: "copying",
            label,
            sourcePath: selection.sourcePath,
            installedPath,
            copiedBytes: aggregateCopiedBytes,
            totalBytes,
            copiedFiles: aggregateCopiedFiles,
            totalFiles,
            progress: computeProgress(copiedBytes, copiedFiles),
            updatedAt: new Date().toISOString()
          });
        }
      });
    } catch (caught) {
      if (isCorosMapInstallCancelledError(caught)) {
        if (publishLifecycle) {
          publishCorosMapInstallCancelled({
            label,
            sourcePath: selection.sourcePath,
            installedPath,
            totalBytes,
            totalFiles,
            copiedBytes:
              corosMapInstallProgress?.copiedBytes ?? copiedBytesOffset,
            copiedFiles:
              corosMapInstallProgress?.copiedFiles ?? copiedFilesOffset,
            progress: corosMapInstallProgress?.progress ?? computeProgress(0, 0)
          });
        }
        throw caught;
      }

      const error = toWatchInstallError(caught, status.rootPath);
      publishCorosMapInstallProgress({
        active: false,
        phase: "failed",
        label,
        sourcePath: selection.sourcePath,
        installedPath,
        copiedBytes:
          corosMapInstallProgress?.copiedBytes ?? copiedBytesOffset,
        totalBytes,
        copiedFiles:
          corosMapInstallProgress?.copiedFiles ?? copiedFilesOffset,
        totalFiles,
        progress: corosMapInstallProgress?.progress ?? computeProgress(0, 0),
        error: error.message,
        updatedAt: new Date().toISOString()
      });
      throw error;
    }

    if (publishLifecycle) {
      publishCorosMapInstallProgress({
        active: false,
        phase: "completed",
        label,
        sourcePath: selection.sourcePath,
        installedPath,
        copiedBytes: copiedBytesOffset + selection.sizeBytes,
        totalBytes,
        copiedFiles: copiedFilesOffset + selection.fileCount,
        totalFiles,
        progress: 1,
        updatedAt: new Date().toISOString()
      });
    }

    invalidateWatchStatusCache();
    return {
      ...selection,
      installedPath,
      watch: await getWatchStatus()
    };
  } finally {
    if (ownsInstallSession) {
      endCorosMapInstall();
    }
  }
}

export function getRouteBuilderConfig(): RouteBuilderConfig {
  const backend = getSetting(ROUTE_BACKEND_SETTING) === "ors" ? "ors" : "keyless";
  return {
    openRouteServiceApiKey: getSetting(ORS_API_KEY_SETTING) ?? "",
    backend
  };
}

export function saveRouteBuilderConfig(
  config: RouteBuilderConfig
): RouteBuilderConfig {
  setSetting(ORS_API_KEY_SETTING, config.openRouteServiceApiKey.trim());
  setSetting(ROUTE_BACKEND_SETTING, config.backend === "ors" ? "ors" : "keyless");
  return getRouteBuilderConfig();
}

/**
 * Chooses the active routing backend. ORS is used only when the user opted into
 * it AND a key is saved; otherwise routing is keyless (BRouter + Nominatim).
 */
function resolveRouteBackend(): RouteBackend {
  const configured = getSetting(ROUTE_BACKEND_SETTING);
  const hasKey = Boolean(getSetting(ORS_API_KEY_SETTING)?.trim());
  return configured === "ors" && hasKey ? "ors" : "keyless";
}

export function listGeneratedRoutes(): GeneratedRoute[] {
  return listSavedGeneratedRoutes();
}

/**
 * Makes a cheap geocode call so the user learns immediately whether their ORS
 * key works, instead of discovering it at route-generation time.
 */
export async function validateRouteApiKey(
  apiKey: string
): Promise<RouteApiKeyValidation> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { status: "empty", message: "Enter an OpenRouteService API key." };
  }

  try {
    const url = new URL(`${ORS_BASE_URL}/geocode/search`);
    url.searchParams.set("api_key", trimmed);
    url.searchParams.set("text", "Boulder, Colorado");
    url.searchParams.set("size", "1");
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (response.ok) {
      return { status: "valid", message: "API key verified." };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        status: "invalid",
        message: "OpenRouteService rejected this API key."
      };
    }
    if (response.status === 429) {
      return {
        status: "quota",
        message: "Key is valid but the daily request quota is reached."
      };
    }
    return {
      status: "error",
      message: `OpenRouteService returned ${response.status} ${response.statusText}.`
    };
  } catch (caught) {
    return {
      status: "error",
      message:
        caught instanceof Error
          ? `Could not reach OpenRouteService: ${caught.message}`
          : "Could not reach OpenRouteService."
    };
  }
}

/** Maps an ORS error response to a user-friendly message. */
function describeOrsError(
  status: number,
  statusText: string,
  details: string
): string {
  if (status === 401 || status === 403) {
    return "OpenRouteService rejected the API key. Re-check it in the key settings above.";
  }
  if (status === 429) {
    return "OpenRouteService daily quota reached. Try again later or use a different key.";
  }
  const orsCode = parseOrsErrorCode(details);
  if (orsCode === 2010) {
    return "No road or path was found near your start or destination. Move the point closer to a routable road or trail, or switch the sport (e.g. road vs. trail).";
  }
  if (orsCode === 2004) {
    return "That route is too long for OpenRouteService. Reduce the distance and try again.";
  }
  if (status === 404) {
    return "OpenRouteService could not build a route between those points. Try a different distance or location.";
  }
  const trimmed = details.trim();
  return `OpenRouteService route request failed: ${status} ${statusText}${trimmed ? ` - ${trimmed.slice(0, 180)}` : ""}`;
}

/** Extracts the numeric ORS error code from a JSON error response body. */
function parseOrsErrorCode(details: string): number | undefined {
  try {
    const parsed = JSON.parse(details) as { error?: { code?: number } };
    return parsed.error?.code;
  } catch {
    return undefined;
  }
}

export async function geocodeRouteLocation(
  query: string
): Promise<RouteGeocodeResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Enter a location to find on the map.");
  }

  const pinnedLocation = parseRouteCoordinateInput(trimmedQuery);
  if (pinnedLocation) {
    return {
      label: pinnedLocation.label,
      lat: pinnedLocation.coordinates[1],
      lon: pinnedLocation.coordinates[0]
    };
  }

  // Keyless geocoding via Nominatim; ORS is only used for route generation when
  // the user has explicitly opted into it.
  return geocodeNominatim(trimmedQuery);
}

/** Type-ahead location suggestions (keyless, Nominatim). */
export async function searchRouteLocations(
  query: string
): Promise<RouteGeocodeResult[]> {
  const trimmed = query.trim();
  const pinned = parseRouteCoordinateInput(trimmed);
  if (pinned) {
    return [
      {
        label: pinned.label,
        lat: pinned.coordinates[1],
        lon: pinned.coordinates[0]
      }
    ];
  }
  return searchNominatim(trimmed);
}

/** Reverse geocode coordinates using the same throttled Nominatim client as route search. */
export async function reverseGeocodeRouteLocation(
  lat: number,
  lon: number
): Promise<RouteGeocodeResult> {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }
  return reverseGeocodeNominatim(lat, lon);
}

export async function generateRoute(
  request: GenerateRouteRequest
): Promise<GeneratedRoute> {
  const normalized = normalizeGenerateRouteRequest(request);
  const route =
    resolveRouteBackend() === "ors"
      ? await generateRouteWithOrs(normalized)
      : await generateRouteKeyless(normalized);
  return persistRoute(route);
}

/** Keyless generation via Nominatim (geocode) + BRouter (routing). */
async function generateRouteKeyless(
  request: GenerateRouteRequest
): Promise<GeneratedRoute> {
  const start = await resolveLocation(request.startLocation);

  if (request.mode === "loop") {
    const geometry = await synthesizeLoop(
      { lat: start.lat, lon: start.lon },
      request.distanceKm,
      request.activityType,
      request.variationSeed ?? 0
    );
    return buildGeneratedRoute(request, geometry, start.label);
  }

  const destination = await resolveLocation(request.destinationLocation ?? "");
  const geometry = await routeViaBrouter(
    [
      { lat: start.lat, lon: start.lon },
      { lat: destination.lat, lon: destination.lon }
    ],
    request.activityType
  );
  return buildGeneratedRoute(request, geometry, start.label, destination.label);
}

/** Legacy OpenRouteService path, used only when the user opts into ORS. */
async function generateRouteWithOrs(
  request: GenerateRouteRequest
): Promise<GeneratedRoute> {
  const apiKey = getSetting(ORS_API_KEY_SETTING)?.trim();
  if (!apiKey) {
    throw new Error("Save an OpenRouteService API key or switch to keyless routing.");
  }

  const start = await geocodeLocation(request.startLocation, apiKey);
  const destination =
    request.mode === "point-to-point"
      ? await geocodeLocation(request.destinationLocation ?? "", apiKey)
      : undefined;

  const profile = ORS_PROFILE_BY_ACTIVITY[request.activityType];
  const body = buildOrsDirectionsBody(
    request,
    start.coordinates,
    destination?.coordinates
  );

  const response = await fetch(`${ORS_BASE_URL}/v2/directions/${profile}/geojson`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(describeOrsError(response.status, response.statusText, details));
  }

  return routeFromOrsResponse(
    (await response.json()) as OrsDirectionsResponse,
    request,
    start.label,
    destination?.label
  );
}

/**
 * Routes through arbitrary waypoints for the interactive draw tool. Returns
 * geometry + live stats without persisting anything; snapping follows real
 * paths (BRouter) while freehand draws straight legs.
 */
export async function routeWaypoints(
  request: RouteWaypointRequest
): Promise<RouteGeometry> {
  const waypoints = request.waypoints.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)
  );
  if (waypoints.length < 2) {
    throw new Error("Add at least two points to build a route.");
  }
  if (!request.snap) {
    return straightLineGeometry(waypoints);
  }
  return routeViaBrouter(waypoints, request.activityType);
}

/** Persists a finished drawn route (geometry + stats) as a saved route. */
export async function saveDrawnRoute(
  payload: DrawnRoutePayload
): Promise<GeneratedRoute> {
  const points = payload.points.filter(
    (point) => point.lat !== undefined && point.lon !== undefined
  );
  if (points.length < 2) {
    throw new Error("Draw at least two connected points before saving.");
  }

  const startLabel = await labelForWaypoint(payload.waypoints[0]);
  const endLabel = payload.closed
    ? undefined
    : await labelForWaypoint(payload.waypoints[payload.waypoints.length - 1]);
  const distanceKm = payload.distanceMeters / 1000;
  const activityLabel =
    ROUTE_ACTIVITY_LABELS[payload.activityType] ?? payload.activityType;
  const name =
    payload.name?.trim() ||
    `${distanceKm.toFixed(1)} km custom ${activityLabel.toLowerCase()}`;

  const route: GeneratedRoute = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    startLocation: startLabel,
    destinationLocation: endLabel,
    distanceMeters: Math.round(payload.distanceMeters),
    durationSeconds: payload.durationSeconds,
    ascentMeters: payload.ascentMeters,
    descentMeters: payload.descentMeters,
    mode: payload.closed ? "loop" : "point-to-point",
    activityType: payload.activityType,
    surfacePreference: "road",
    avoidHighways: false,
    elevationPreference: "any",
    points,
    bounds: boundsForPoints(points)
  };
  return persistRoute(route);
}

/** Builds GPX, writes it to disk, and stores the route in the database. */
async function persistRoute(route: GeneratedRoute): Promise<GeneratedRoute> {
  const gpx = buildRouteGpx(route);
  const gpxPath = await writeRouteGpx(route.id, route.name, gpx);
  return addGeneratedRoute({ ...route, gpxPath });
}

/** Resolves free text or a coordinate pin to a labelled point (keyless). */
async function resolveLocation(
  query: string
): Promise<{ lat: number; lon: number; label: string }> {
  const pinned = parseRouteCoordinateInput(query);
  if (pinned) {
    return {
      lat: pinned.coordinates[1],
      lon: pinned.coordinates[0],
      label: pinned.label
    };
  }
  const result = await geocodeNominatim(query);
  return { lat: result.lat, lon: result.lon, label: result.label };
}

/** Best-effort reverse geocode for naming a drawn route; never throws. */
async function labelForWaypoint(waypoint?: RouteWaypoint): Promise<string> {
  if (!waypoint) {
    return "Custom route";
  }
  try {
    const result = await reverseGeocodeNominatim(waypoint.lat, waypoint.lon);
    return result.label;
  } catch {
    return `${waypoint.lat.toFixed(4)}, ${waypoint.lon.toFixed(4)}`;
  }
}

/** Assembles a GeneratedRoute from routed geometry + request metadata. */
function buildGeneratedRoute(
  request: GenerateRouteRequest,
  geometry: RouteGeometry,
  startLabel: string,
  destinationLabel?: string
): GeneratedRoute {
  const name =
    request.mode === "loop"
      ? `${request.distanceKm} km loop from ${startLabel}`
      : `${startLabel} to ${destinationLabel ?? request.destinationLocation}`;

  return {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    startLocation: startLabel,
    destinationLocation: destinationLabel,
    distanceMeters: geometry.distanceMeters,
    durationSeconds: geometry.durationSeconds,
    ascentMeters: geometry.ascentMeters,
    descentMeters: geometry.descentMeters,
    mode: request.mode,
    activityType: request.activityType,
    surfacePreference: request.surfacePreference,
    avoidHighways: request.avoidHighways,
    elevationPreference: request.elevationPreference,
    points: geometry.points,
    bounds: boundsForPoints(geometry.points)
  };
}

export async function exportGeneratedRoute(id: string): Promise<string | null> {
  const route = getGeneratedRoute(id);
  if (!route) {
    throw new Error("Generated route was not found.");
  }

  if (!route.gpxPath || !fs.existsSync(route.gpxPath)) {
    throw new Error("Generated route GPX file is missing.");
  }

  const result = await dialog.showSaveDialog({
    title: "Export GPX",
    defaultPath: sanitizeFileName(`${route.name}.gpx`),
    filters: [{ name: "GPX", extensions: ["gpx"] }]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.promises.copyFile(route.gpxPath, result.filePath);
  return result.filePath;
}

// Imported GPX tracks can carry tens of thousands of recorded points; cap what
// we store so previews and re-exports stay fast while tracing the same path.
const GPX_IMPORT_MAX_POINTS = 4000;
// First and last points within this distance mark an imported route as a loop.
const GPX_LOOP_CLOSE_METERS = 100;

export interface ParsedGpxRoute {
  name?: string;
  points: TrainingHubTrackPoint[];
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Minimal GPX reader for route import. Prefers `<trkpt>` (recorded tracks),
 * falls back to `<rtept>` (planned courses). Deliberately regex-based: GPX is
 * flat enough that a full XML parser dependency isn't warranted here.
 */
export function parseGpxRoute(content: string): ParsedGpxRoute {
  const collect = (tag: "trkpt" | "rtept"): TrainingHubTrackPoint[] => {
    const points: TrainingHubTrackPoint[] = [];
    const pattern = new RegExp(
      `<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`,
      "g"
    );
    for (const match of content.matchAll(pattern)) {
      const attrs = match[1] ?? "";
      const lat = Number(/(?:^|\s)lat\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
      const lon = Number(/(?:^|\s)lon\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        continue;
      }
      const elevation = Number(
        /<ele>\s*(-?[\d.]+)\s*<\/ele>/.exec(match[2] ?? "")?.[1]
      );
      points.push({
        lat,
        lon,
        ...(Number.isFinite(elevation) ? { elevation } : {})
      });
    }
    return points;
  };

  const trackPoints = collect("trkpt");
  const points = trackPoints.length >= 2 ? trackPoints : collect("rtept");

  const rawName = /<name>([\s\S]*?)<\/name>/.exec(content)?.[1]?.trim();
  const name = rawName
    ?.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1")
    .trim();

  return { name: name ? unescapeXml(name) : undefined, points };
}

/**
 * Turns raw GPX text into an unsaved GeneratedRoute: parses points, derives
 * distance/ascent/descent and loop detection. Exported for tests;
 * importRouteFromGpx adds the file dialog, geocoded labels, and persistence.
 */
export function buildRouteFromGpxContent(
  content: string,
  fallbackName: string,
  activityType: RouteActivityType = "running"
): GeneratedRoute {
  const parsed = parseGpxRoute(content);
  const points = parsed.points.filter(
    (point) => point.lat !== undefined && point.lon !== undefined
  );
  if (points.length < 2) {
    throw new Error(
      "No track or route points were found in this GPX file."
    );
  }

  let distanceMeters = 0;
  let ascentMeters = 0;
  let descentMeters = 0;
  let hasElevation = false;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    distanceMeters += haversineMeters(
      { lat: previous.lat!, lon: previous.lon! },
      { lat: current.lat!, lon: current.lon! }
    );
    if (previous.elevation !== undefined && current.elevation !== undefined) {
      hasElevation = true;
      const delta = current.elevation - previous.elevation;
      if (delta > 0) {
        ascentMeters += delta;
      } else {
        descentMeters -= delta;
      }
    }
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const closed =
    haversineMeters(
      { lat: first.lat!, lon: first.lon! },
      { lat: last.lat!, lon: last.lon! }
    ) <= GPX_LOOP_CLOSE_METERS;

  const stored = decimatePoints(points, GPX_IMPORT_MAX_POINTS);

  return {
    id: crypto.randomUUID(),
    name: parsed.name || fallbackName,
    createdAt: new Date().toISOString(),
    startLocation: `${first.lat!.toFixed(4)}, ${first.lon!.toFixed(4)}`,
    destinationLocation: closed
      ? undefined
      : `${last.lat!.toFixed(4)}, ${last.lon!.toFixed(4)}`,
    distanceMeters: Math.round(distanceMeters),
    ascentMeters: hasElevation ? Math.round(ascentMeters) : undefined,
    descentMeters: hasElevation ? Math.round(descentMeters) : undefined,
    mode: closed ? "loop" : "point-to-point",
    activityType,
    surfacePreference: "road",
    avoidHighways: false,
    elevationPreference: "any",
    points: stored,
    bounds: boundsForPoints(stored)
  };
}

/**
 * Asks the user for a GPX file, converts it into a saved route (with a
 * CorosLink-format GPX on disk so export/share work), and returns it.
 * Resolves null when the dialog is cancelled.
 */
export async function importRouteFromGpx(
  activityType: RouteActivityType = "running"
): Promise<GeneratedRoute | null> {
  const result = await dialog.showOpenDialog({
    title: "Import GPX route",
    filters: [{ name: "GPX", extensions: ["gpx"] }],
    properties: ["openFile"]
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const filePath = result.filePaths[0];
  const content = await fs.promises.readFile(filePath, "utf8");
  const fallbackName = path.basename(filePath, path.extname(filePath));
  const route = buildRouteFromGpxContent(content, fallbackName, activityType);

  // Best-effort readable labels; coordinates remain as fallback.
  const startLabel = await labelForWaypoint({
    lat: route.points[0]!.lat!,
    lon: route.points[0]!.lon!
  });
  const lastPoint = route.points[route.points.length - 1]!;
  const endLabel =
    route.mode === "loop"
      ? undefined
      : await labelForWaypoint({ lat: lastPoint.lat!, lon: lastPoint.lon! });

  return persistRoute({
    ...route,
    startLocation: startLabel,
    destinationLocation: endLabel
  });
}

export function deleteGeneratedRoute(id: string): boolean {
  const route = getGeneratedRoute(id);
  const removed = deleteSavedGeneratedRoute(id);
  if (route?.gpxPath) {
    fs.promises.rm(route.gpxPath, { force: true }).catch(() => undefined);
  }
  return removed;
}

// NOTE: COROS watches do not import navigable routes over the USB cable (unlike
// Garmin's Courses/NewFiles folders) — the watch's mass storage is effectively
// Music-only. Routes reach the watch via the COROS phone app over Bluetooth, or
// (future) by uploading to the user's COROS account so it syncs through the app.
// See uploadRouteToCorosAccount() groundwork in trainingHubService.ts.

export function buildOrsDirectionsBody(
  request: GenerateRouteRequest,
  startCoordinates: [number, number],
  destinationCoordinates?: [number, number]
): Record<string, unknown> {
  if (request.mode === "point-to-point" && !destinationCoordinates) {
    throw new Error("Destination coordinates are required.");
  }

  const coordinates =
    request.mode === "loop"
      ? [startCoordinates]
      : [startCoordinates, destinationCoordinates as [number, number]];
  const options: Record<string, unknown> = {};

  if (request.mode === "loop") {
    const variation = request.variationSeed ? `:${request.variationSeed}` : "";
    options.round_trip = {
      length: Math.round(request.distanceKm * 1000),
      points: 3,
      seed: stableSeed(
        `${request.startLocation}:${request.distanceKm}:${request.activityType}${variation}`
      )
    };
  }

  // `avoid_features: ["highways"]` is only valid for cycling/driving profiles in
  // ORS; foot profiles reject it, so it stays a no-op for walking/running/hiking.
  if (request.avoidHighways && isCyclingActivity(request.activityType)) {
    options.avoid_features = ["highways"];
  }

  if (request.elevationPreference !== "any") {
    options.profile_params = {
      weightings: {
        steepness_difficulty:
          request.elevationPreference === "flatter" ? 1 : 3
      }
    };
  }

  return {
    coordinates,
    // Let ORS snap each waypoint to the nearest routable road/path instead of
    // failing with code 2010 when the pin is just off the network. -1 = no
    // limit, so a start picked in a park, on a building, or just offshore still
    // resolves to the closest usable point.
    radiuses: coordinates.map(() => -1),
    elevation: true,
    instructions: false,
    preference: "recommended",
    ...(Object.keys(options).length > 0 ? { options } : {})
  };
}

export function buildRouteGpx(route: GeneratedRoute): string {
  const validPoints = route.points.filter(
    (point) => point.lat !== undefined && point.lon !== undefined
  );

  const trkpts = validPoints
    .map((point) => {
      const elevation =
        point.elevation !== undefined ? `<ele>${point.elevation}</ele>` : "";
      return `      <trkpt lat="${point.lat}" lon="${point.lon}">${elevation}</trkpt>`;
    })
    .join("\n");

  // COROS navigation follows a GPX <rte> course. Decimate the dense routing
  // geometry to keep the route lightweight while still tracing the path.
  const rtepts = decimatePoints(validPoints, 400)
    .map((point) => {
      const elevation =
        point.elevation !== undefined ? `<ele>${point.elevation}</ele>` : "";
      return `    <rtept lat="${point.lat}" lon="${point.lon}">${elevation}</rtept>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="CorosLink" xmlns="http://www.topografix.com/GPX/1/1">',
    "  <metadata>",
    `    <name>${escapeXml(route.name)}</name>`,
    `    <desc>${escapeXml(describeRoute(route))}</desc>`,
    `    <time>${escapeXml(route.createdAt)}</time>`,
    "  </metadata>",
    "  <rte>",
    `    <name>${escapeXml(route.name)}</name>`,
    rtepts,
    "  </rte>",
    "  <trk>",
    `    <name>${escapeXml(route.name)}</name>`,
    "    <trkseg>",
    trkpts,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
    ""
  ].join("\n");
}

/** Human-readable summary embedded in the GPX <desc>. */
function describeRoute(route: GeneratedRoute): string {
  const parts = [
    `${(route.distanceMeters / 1000).toFixed(1)} km`,
    ROUTE_ACTIVITY_LABELS[route.activityType] ?? route.activityType,
    route.mode === "loop" ? "loop" : "point-to-point"
  ];
  if (route.ascentMeters !== undefined) {
    parts.push(`${Math.round(route.ascentMeters)} m ascent`);
  }
  return parts.join(" · ");
}

const ROUTE_ACTIVITY_LABELS: Record<RouteActivityType, string> = {
  walking: "Walking",
  running: "Running",
  hiking: "Hiking",
  "cycling-road": "Road cycling",
  "cycling-mountain": "Mountain biking"
};

/** Evenly samples at most `maxPoints` points, always keeping first and last. */
function decimatePoints(
  points: TrainingHubTrackPoint[],
  maxPoints: number
): TrainingHubTrackPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) {
    return points;
  }
  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: TrainingHubTrackPoint[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(points[Math.round(index * step)]!);
  }
  return sampled;
}

async function runCorosMapDownload(
  jobId: string,
  mapPackage: CorosMapPackage
): Promise<void> {
  const controller = new AbortController();
  corosMapDownloadControllers.set(jobId, controller);
  updateCorosMapDownloadJob(jobId, { status: "downloading" });

  try {
    const cached = await downloadCorosMapPackageToCache(mapPackage, {
      signal: controller.signal,
      onProgress: (progress) => {
        updateCorosMapDownloadJob(jobId, {
          receivedBytes: progress.receivedBytes,
          sizeBytes: progress.sizeBytes,
          progress: progress.progress
        });
      }
    });
    const saved = upsertCachedCorosMap(cached);
    updateCorosMapDownloadJob(jobId, {
      status: "cached",
      progress: 1,
      receivedBytes: saved.sizeBytes,
      sizeBytes: saved.sizeBytes,
      filePath: saved.filePath
    });
  } catch (caught) {
    const message = toErrorMessage(caught);
    updateCorosMapDownloadJob(jobId, {
      status: controller.signal.aborted ? "cancelled" : "failed",
      error: controller.signal.aborted ? "Download cancelled." : message
    });
  } finally {
    corosMapDownloadControllers.delete(jobId);
  }
}

function updateCorosMapDownloadJob(
  id: string,
  patch: Partial<CorosMapDownloadJob>
): void {
  const job = corosMapDownloadJobs.get(id);
  if (!job) {
    return;
  }

  corosMapDownloadJobs.set(id, {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  publishCorosMapDownloadJobs();
}

function publishCorosMapDownloadJobs(): void {
  corosMapDownloadListener?.(listCorosMapDownloadJobs());
}

function validateCorosMapPackage(mapPackage: CorosMapPackage): void {
  if (!mapPackage.id || !mapPackage.title || !mapPackage.region) {
    throw new Error("COROS map package metadata is incomplete.");
  }

  validateOfficialCorosDownloadUrl(mapPackage.downloadUrl);

  if (!Number.isFinite(mapPackage.sizeBytes) || mapPackage.sizeBytes < 0) {
    throw new Error("COROS map package size is invalid.");
  }
}

function validateOfficialCorosDownloadUrl(downloadUrl: string): void {
  const parsed = new URL(downloadUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "map-oss-us.coros.com"
  ) {
    throw new Error("Only official COROS map download URLs can be used.");
  }
}

function getCorosMapCacheDirectory(): string {
  return path.join(app.getPath("userData"), "map-cache");
}

function getCorosMapCacheFileName(mapPackage: CorosMapPackage): string {
  const hash = crypto
    .createHash("sha256")
    .update(mapPackage.id)
    .digest("hex")
    .slice(0, 10);
  return `${sanitizeFileName(`${mapPackage.title}-${mapPackage.type}-${mapPackage.version}`)}-${hash}.zip`;
}

async function ensureCachedCorosMapExtracted(
  cached: CachedCorosMapPackage
): Promise<string> {
  const cacheDirectory = getCorosMapCacheDirectory();
  assertPathInside(cacheDirectory, cached.filePath);
  const existingExtractedPath = cached.extractedPath;

  if (existingExtractedPath && fs.existsSync(existingExtractedPath)) {
    assertPathInside(cacheDirectory, existingExtractedPath);
    await resolveMapSourcePath(existingExtractedPath);
    return existingExtractedPath;
  }

  const extractPath = path.join(
    cacheDirectory,
    "extracted",
    sanitizeFileName(`${cached.packageId}-${cached.downloadedAt}`)
  );
  assertPathInside(cacheDirectory, extractPath);
  await fs.promises.rm(extractPath, { recursive: true, force: true });
  await fs.promises.mkdir(extractPath, { recursive: true });
  await extractZipSafely(cached.filePath, extractPath);
  await resolveMapSourcePath(extractPath);
  updateCachedCorosMapExtractedPath(cached.packageId, extractPath);
  return extractPath;
}

async function extractZipSafely(
  zipPath: string,
  destinationRoot: string
): Promise<void> {
  const unzipper = require("unzipper") as UnzipperModule;
  // Enumerate entries via the central directory (Open.file) rather than the
  // streaming Parse() reader. The streaming parser assumes every entry states
  // its compressed size in the local header, so archives that use data
  // descriptors (general-purpose bit 3) or Zip64 make it overrun an entry and
  // fail with "invalid signature: 0x...". COROS map zips are produced that way.
  const directory = await unzipper.Open.file(zipPath);

  for (const entry of directory.files) {
    const destinationPath = path.resolve(destinationRoot, entry.path);
    assertPathInside(destinationRoot, destinationPath);

    if (entry.type === "Directory") {
      await fs.promises.mkdir(destinationPath, { recursive: true });
      continue;
    }

    if (entry.type !== "File") {
      continue;
    }

    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(destinationPath, { flags: "w" });
      const input = entry.stream();
      input.on("error", reject);
      output.on("error", reject);
      output.on("finish", resolve);
      input.pipe(output);
    });
  }
}

async function removePathInsideCache(
  cacheDirectory: string,
  targetPath: string
): Promise<void> {
  assertPathInside(cacheDirectory, targetPath);
  await fs.promises.rm(targetPath, { recursive: true, force: true });
}

function assertPathInside(rootPath: string, targetPath: string): void {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);

  if (target !== root && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error("Map cache path resolved outside the app cache.");
  }
}

function toErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function normalizeCorosMapType(value?: string): CorosMapType | undefined {
  if (value === "landscape" || value === "topo") {
    return value;
  }

  return undefined;
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, "");
}

function titleFromMapKey(value: string): string {
  const raw = value.replace(/^map\./, "");
  return raw
    .split("-")
    .map((part) =>
      /^\d+$/.test(part)
        ? part
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
    )
    .join(" ")
    .replace(/([A-Za-z]+)(\d+)$/, "$1 - $2");
}

async function resolveMapSourcePath(sourcePath: string): Promise<string> {
  const stats = await fs.promises.stat(sourcePath).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new Error("Choose an extracted COROS map folder.");
  }

  if (path.basename(sourcePath).toLowerCase() === "map") {
    return sourcePath;
  }

  const nestedMapPath = path.join(sourcePath, "map");
  const nestedStats = await fs.promises.stat(nestedMapPath).catch(() => undefined);
  if (nestedStats?.isDirectory()) {
    return nestedMapPath;
  }

  throw new Error(
    "Choose the extracted COROS map folder named 'map', or its parent folder."
  );
}

async function getDirectoryStats(directoryPath: string): Promise<DirectoryStats> {
  let sizeBytes = 0;
  let fileCount = 0;

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.promises.readdir(currentPath, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = await fs.promises.stat(absolutePath);
      sizeBytes += stats.size;
      fileCount += 1;
    }
  }

  await walk(directoryPath);
  return { sizeBytes, fileCount };
}

function assertNotSameOrNested(sourcePath: string, destinationPath: string): void {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  const destinationInsideSource = path.relative(source, destination);
  const sourceInsideDestination = path.relative(destination, source);

  if (
    source === destination ||
    (destinationInsideSource && !destinationInsideSource.startsWith("..")) ||
    (sourceInsideDestination && !sourceInsideDestination.startsWith(".."))
  ) {
    throw new Error("The selected map folder is already on the watch.");
  }
}

async function copyDirectoryContents(
  sourcePath: string,
  destinationPath: string,
  options: CopyDirectoryOptions,
  progress = { copiedBytes: 0, copiedFiles: 0 }
): Promise<void> {
  assertCorosMapInstallNotCancelled(options.signal);
  const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    assertCorosMapInstallNotCancelled(options.signal);
    const source = path.join(sourcePath, entry.name);
    const destination = path.join(destinationPath, entry.name);

    if (entry.isDirectory()) {
      await fs.promises.mkdir(destination, { recursive: true });
      await copyDirectoryContents(source, destination, options, progress);
      continue;
    }

    if (entry.isFile()) {
      const stats = await fs.promises.stat(source);
      await fs.promises.copyFile(source, destination);
      progress.copiedBytes += stats.size;
      progress.copiedFiles += 1;
      options.onProgress({
        copiedBytes: progress.copiedBytes,
        copiedFiles: progress.copiedFiles
      });
    }
  }
}

function beginCorosMapInstall(): void {
  if (corosMapInstallAbortController) {
    throw new Error("A map transfer is already in progress.");
  }

  corosMapInstallAbortController = new AbortController();
}

function endCorosMapInstall(): void {
  corosMapInstallAbortController = null;
}

function getCorosMapInstallSignal(): AbortSignal | undefined {
  return corosMapInstallAbortController?.signal;
}

function assertCorosMapInstallNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CorosMapInstallCancelledError();
  }
}

function isCorosMapInstallCancelledError(caught: unknown): boolean {
  if (caught instanceof CorosMapInstallCancelledError) {
    return true;
  }

  const message = caught instanceof Error ? caught.message : String(caught);
  return message.includes(COROS_MAP_INSTALL_CANCELLED_MESSAGE);
}

export function toCorosMapInstallIpcError(error: unknown): Error {
  if (isCorosMapInstallCancelledError(error)) {
    return new Error(COROS_MAP_INSTALL_CANCELLED_MESSAGE);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function publishCorosMapInstallCancelled({
  label,
  sourcePath,
  installedPath,
  totalBytes,
  totalFiles,
  copiedBytes,
  copiedFiles,
  progress
}: {
  label: string;
  sourcePath?: string;
  installedPath?: string;
  totalBytes: number;
  totalFiles: number;
  copiedBytes: number;
  copiedFiles: number;
  progress: number;
}): void {
  publishCorosMapInstallProgress({
    active: false,
    phase: "cancelled",
    label,
    sourcePath,
    installedPath,
    copiedBytes,
    totalBytes,
    copiedFiles,
    totalFiles,
    progress,
    error: COROS_MAP_INSTALL_CANCELLED_MESSAGE,
    updatedAt: new Date().toISOString()
  });
}

function publishCorosMapInstallProgress(
  progress: CorosMapInstallProgress | null
): void {
  corosMapInstallProgress = progress;
  corosMapInstallProgressListener?.(progress);
}

function toWatchInstallError(caught: unknown, watchRootPath: string): Error {
  if (isWatchDisconnectedInstallError(caught, watchRootPath)) {
    return new Error(
      "The watch disconnected while installing maps. Reconnect the watch and run Install again. CorosLink merges map files, so files that already copied can remain on the watch."
    );
  }

  return caught instanceof Error ? caught : new Error(String(caught));
}

function isWatchDisconnectedInstallError(
  caught: unknown,
  watchRootPath: string
): boolean {
  if (!caught || typeof caught !== "object") {
    return false;
  }

  const error = caught as NodeJS.ErrnoException & {
    dest?: string;
    path?: string;
  };
  const removableVolumeErrorCodes = new Set([
    "ENXIO",
    "ENODEV",
    "EIO",
    "ENOENT"
  ]);
  const targetPath = error.dest ?? error.path ?? "";
  return (
    Boolean(error.code && removableVolumeErrorCodes.has(error.code)) &&
    targetPath.startsWith(watchRootPath)
  );
}

function normalizeGenerateRouteRequest(
  request: GenerateRouteRequest
): GenerateRouteRequest {
  const startLocation = request.startLocation.trim();
  const destinationLocation = request.destinationLocation?.trim();
  const distanceKm = Number(request.distanceKm);
  const activityType = request.activityType ?? "walking";
  const maxDistanceKm = maxRouteDistanceKm(activityType);

  if (!startLocation) {
    throw new Error("Enter a start location.");
  }

  if (
    request.mode === "point-to-point" &&
    (!destinationLocation || destinationLocation.length === 0)
  ) {
    throw new Error("Enter a destination for point-to-point routes.");
  }

  if (
    !Number.isFinite(distanceKm) ||
    distanceKm <= 0 ||
    distanceKm > maxDistanceKm
  ) {
    throw new Error(`Enter a route distance between 0 and ${maxDistanceKm} km.`);
  }

  return {
    startLocation,
    destinationLocation,
    distanceKm,
    mode: request.mode,
    activityType,
    surfacePreference: request.surfacePreference,
    avoidHighways: request.avoidHighways,
    elevationPreference: request.elevationPreference,
    variationSeed: request.variationSeed
  };
}

async function geocodeLocation(
  query: string,
  apiKey: string
): Promise<{ coordinates: [number, number]; label: string }> {
  const pinnedLocation = parseRouteCoordinateInput(query);
  if (pinnedLocation) {
    return pinnedLocation;
  }

  const url = new URL(`${ORS_BASE_URL}/geocode/search`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("text", query);
  url.searchParams.set("size", "1");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(
      `OpenRouteService geocoding failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as OrsGeocodeResponse;
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;

  if (
    !coordinates ||
    coordinates.length < 2 ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1])
  ) {
    throw new Error(`OpenRouteService could not find "${query}".`);
  }

  return {
    coordinates: [coordinates[0]!, coordinates[1]!],
    label: feature?.properties?.label || feature?.properties?.name || query
  };
}

export function parseRouteCoordinateInput(
  value: string
): { coordinates: [number, number]; label: string } | undefined {
  const match = value
    .trim()
    .match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(?:\s+.*)?$/);

  if (!match) {
    return undefined;
  }

  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return undefined;
  }

  return {
    coordinates: [lon, lat],
    label: `Pinned ${lat.toFixed(5)}, ${lon.toFixed(5)}`
  };
}

function routeFromOrsResponse(
  payload: OrsDirectionsResponse,
  request: GenerateRouteRequest,
  startLabel: string,
  destinationLabel?: string
): GeneratedRoute {
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;

  if (!coordinates || coordinates.length < 2) {
    throw new Error("OpenRouteService did not return a usable route.");
  }

  const points: TrainingHubTrackPoint[] = coordinates
    .filter((coordinate) => coordinate.length >= 2)
    .map((coordinate) => ({
      lon: coordinate[0],
      lat: coordinate[1],
      elevation: coordinate[2]
    }));
  const distanceMeters =
    feature?.properties?.summary?.distance ?? request.distanceKm * 1000;
  const now = new Date().toISOString();
  const name =
    request.mode === "loop"
      ? `${request.distanceKm} km loop from ${startLabel}`
      : `${startLabel} to ${destinationLabel ?? request.destinationLocation}`;

  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    startLocation: startLabel,
    destinationLocation: destinationLabel,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: feature?.properties?.summary?.duration,
    ascentMeters: feature?.properties?.ascent,
    descentMeters: feature?.properties?.descent,
    mode: request.mode,
    activityType: request.activityType,
    surfacePreference: request.surfacePreference,
    avoidHighways: request.avoidHighways,
    elevationPreference: request.elevationPreference,
    points,
    bounds: boundsForPoints(points)
  };
}

function boundsForPoints(
  points: TrainingHubTrackPoint[]
): GeneratedRoute["bounds"] {
  const lats = points
    .map((point) => point.lat)
    .filter((value): value is number => value !== undefined);
  const lons = points
    .map((point) => point.lon)
    .filter((value): value is number => value !== undefined);

  if (lats.length === 0 || lons.length === 0) {
    return undefined;
  }

  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons)
  };
}

async function writeRouteGpx(
  routeId: string,
  routeName: string,
  gpx: string
): Promise<string> {
  const directory = path.join(app.getPath("userData"), "routes");
  await fs.promises.mkdir(directory, { recursive: true });
  const gpxPath = path.join(
    directory,
    `${routeId}-${sanitizeFileName(routeName)}.gpx`
  );
  await fs.promises.writeFile(gpxPath, gpx, "utf8");
  return gpxPath;
}

function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "route";
}

function stableSeed(value: string): number {
  const hash = crypto.createHash("sha256").update(value).digest();
  return hash.readUInt32BE(0);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
