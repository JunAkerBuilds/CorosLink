import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { encodeCorosRgbaPng } from "./corosCompiledWatchface";
import {
  classifyOfficialAsset,
  composeOfficialAssetStrip,
  extractOfficialFaceAssets,
  OFFICIAL_ASSET_CATEGORY_LABELS,
  OFFICIAL_FONT_ROLE_LABELS,
  officialAssetTags,
  officialFontRole,
  type OfficialAssetCategory,
  type OfficialFontRole
} from "./corosOfficialAssetLibrary";
import { fetchCorosWatchfaceThemePackage, listCorosWatchfaceThemes } from "./corosWatchfaceService";
import { getWatchfaceTarget } from "./watchfaceTargets";
import { getWatchfaceDeviceProfileByFirmware } from "./watchModels";
import type {
  CorosOfficialAsset,
  CorosOfficialAssetFrames,
  CorosOfficialAssetLibraryStatus,
  CorosOfficialAssetPage,
  CorosOfficialAssetQuery
} from "./types";

/**
 * Serves a per-firmware library of every bitmap set in the official COROS
 * face catalog. The preferred source is the hosted, prebuilt library
 * (scripts/publish-coros-asset-library.mjs): the app downloads one index per
 * watch model and fetches strips and frame ZIPs lazily into the same on-disk
 * cache. When the hosted library is unreachable the app falls back to
 * building the library itself from the catalog with the signed-in mobile
 * session, so the browser works offline from COROS's CDN as well.
 */

const LIBRARY_VERSION = 1;
const DOWNLOAD_CONCURRENCY = 4;
const MAX_PAGE_SIZE = 96;
const HOSTED_LIBRARY_URL = (process.env.COROSLINK_ASSET_LIBRARY_URL ?? "https://coroslink-assets.akerrules.ca/official-faces").replace(/\/+$/, "");
const HOSTED_TIMEOUT_MS = 12_000;
/** A hosted index older than this is refreshed in the background on the next open. */
const HOSTED_REFRESH_MS = 24 * 60 * 60 * 1000;
const STRIP_FETCH_CONCURRENCY = 8;

interface UnzipperModule {
  Open: { buffer: (bytes: Buffer) => Promise<{ files: { path: string; type: string; buffer: () => Promise<Buffer> }[] }> };
}

interface StoredAsset {
  id: string;
  category: OfficialAssetCategory;
  role?: OfficialFontRole;
  width: number;
  height: number;
  frames: number;
  encoding: string;
  elementIds: string[];
  configKeys: string[];
  faces: string[];
  faceCount: number;
  strip: { width: number; height: number };
}

interface StoredLibrary {
  version: number;
  firmwareType: string;
  builtAt: string;
  /** Where the index came from; hosted libraries fetch strips and frames on demand. */
  source?: "hosted" | "local";
  fetchedAt?: string;
  faceCount: number;
  failures: string[];
  assets: StoredAsset[];
}

interface BuildState {
  status: CorosOfficialAssetLibraryStatus;
  library: StoredLibrary | null;
  promise: Promise<void> | null;
}

const builds = new Map<string, BuildState>();

function libraryRoot(firmwareType: string): string {
  return path.join(app.getPath("userData"), "official-asset-library", firmwareType.replace(/[^A-Za-z0-9]+/g, "-"));
}

function normalizeFirmwareType(input: string | undefined): string {
  const firmwareType = input?.trim() ?? "";
  const target = getWatchfaceTarget(firmwareType);
  if (!target) throw new Error("Choose a supported COROS watch model to browse official assets.");
  return target.firmwareType;
}

function readStoredLibrary(root: string): StoredLibrary | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, "library.json"), "utf8")) as StoredLibrary;
    return parsed.version === LIBRARY_VERSION && Array.isArray(parsed.assets) ? parsed : null;
  } catch {
    return null;
  }
}

function getState(firmwareType: string): BuildState {
  let state = builds.get(firmwareType);
  if (!state) {
    const library = readStoredLibrary(libraryRoot(firmwareType));
    state = {
      library,
      promise: null,
      status: {
        firmwareType, state: library ? "ready" : "idle",
        facesDone: library?.faceCount ?? 0, facesTotal: library?.faceCount ?? 0, assetCount: library?.assets.length ?? 0
      }
    };
    builds.set(firmwareType, state);
  }
  return state;
}

function hostedHeaders(): Record<string, string> {
  // The bucket is unlisted and its edge rule only answers requests carrying
  // this header; it is not a secret, just enough to keep the URL app-only.
  return { "X-CorosLink-Client": `coroslink/${app.getVersion()}`, Accept: "*/*" };
}

async function fetchHosted(relativePath: string): Promise<Buffer | null> {
  if (!/^https?:\/\//.test(HOSTED_LIBRARY_URL)) return null;
  try {
    const response = await fetch(`${HOSTED_LIBRARY_URL}/${relativePath}`, {
      headers: hostedHeaders(), signal: AbortSignal.timeout(HOSTED_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** Downloads the prebuilt index for a firmware type; false when the hosted library is unavailable. */
async function fetchHostedLibrary(firmwareType: string, state: BuildState): Promise<boolean> {
  const manifestBytes = await fetchHosted("v1/manifest.json");
  if (!manifestBytes) return false;
  let indexPath: string | undefined;
  try {
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as { version?: number; models?: Record<string, { index?: string }> };
    if (manifest.version !== 1) return false;
    indexPath = manifest.models?.[firmwareType]?.index;
  } catch {
    return false;
  }
  if (!indexPath || !/^v1\/models\/[A-Za-z0-9-]+\/library\.json$/.test(indexPath)) return false;
  const indexBytes = await fetchHosted(indexPath);
  if (!indexBytes) return false;
  let library: StoredLibrary;
  try {
    library = JSON.parse(indexBytes.toString("utf8")) as StoredLibrary;
  } catch {
    return false;
  }
  if (library.version !== LIBRARY_VERSION || library.firmwareType !== firmwareType || !Array.isArray(library.assets)) return false;
  library.source = "hosted";
  library.fetchedAt = new Date().toISOString();
  const root = libraryRoot(firmwareType);
  await fs.promises.mkdir(path.join(root, "assets"), { recursive: true });
  await fs.promises.writeFile(path.join(root, "library.json"), JSON.stringify(library));
  state.library = library;
  state.status = { firmwareType, state: "ready", facesDone: library.faceCount, facesTotal: library.faceCount, assetCount: library.assets.length };
  return true;
}

/** Fetches a hosted strip or frame ZIP into the cache unless it is already there. */
async function ensureHostedFile(firmwareType: string, id: string, file: string): Promise<boolean> {
  const target = path.join(libraryRoot(firmwareType), "assets", id, file);
  if (fs.existsSync(target)) return true;
  const bytes = await fetchHosted(`v1/assets/${id}/${file}`);
  if (!bytes) return false;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, bytes);
  return true;
}

/** Expands a hosted frame ZIP (<id>/NN.png entries) into the cache directory. */
async function ensureHostedFrames(firmwareType: string, asset: StoredAsset): Promise<void> {
  const directory = path.join(libraryRoot(firmwareType), "assets", asset.id);
  const last = path.join(directory, `${String(asset.frames - 1).padStart(2, "0")}.png`);
  if (fs.existsSync(last)) return;
  if (!await ensureHostedFile(firmwareType, asset.id, `${asset.id}.zip`)) {
    throw new Error("The official asset could not be downloaded. Check your connection and try again.");
  }
  const unzipper = require("unzipper") as UnzipperModule;
  const archive = await unzipper.Open.buffer(await fs.promises.readFile(path.join(directory, `${asset.id}.zip`)));
  for (const entry of archive.files) {
    const name = path.posix.basename(entry.path);
    if (entry.type !== "File" || !/^\d{2}\.png$/.test(name)) continue;
    await fs.promises.writeFile(path.join(directory, name), await entry.buffer());
  }
}

/** Downloads (once) and decodes every official face for a firmware type. */
async function buildLibrary(firmwareType: string, state: BuildState): Promise<void> {
  const root = libraryRoot(firmwareType);
  const facesDir = path.join(root, "faces");
  const assetsDir = path.join(root, "assets");
  await fs.promises.mkdir(facesDir, { recursive: true });
  await fs.promises.mkdir(assetsDir, { recursive: true });

  const profile = getWatchfaceDeviceProfileByFirmware(firmwareType);
  const themes = await listCorosWatchfaceThemes({
    firmwareType, language: "en-US", maxWatchFaceVersion: 5, catalog: "official", snCode: "x",
    modelVersion: profile?.modelVersion ?? ""
  });
  const faces = themes.filter((theme) => theme.packageUrl && theme.id);
  state.status = { ...state.status, state: "building", facesDone: 0, facesTotal: faces.length, message: undefined };

  const assets = new Map<string, StoredAsset & { faceNames: Set<string> }>();
  const failures: string[] = [];
  let decodedFaces = 0;
  let next = 0;

  const processFace = async (theme: (typeof faces)[number]) => {
    const file = path.join(facesDir, `${theme.id}.bin`);
    let bytes: Buffer | null = null;
    try {
      bytes = await fs.promises.readFile(file);
    } catch {
      try {
        bytes = await fetchCorosWatchfaceThemePackage(theme.packageUrl!);
        await fs.promises.writeFile(file, bytes);
      } catch (error) {
        failures.push(`${theme.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (bytes) {
      try {
        const extracted = extractOfficialFaceAssets(bytes);
        failures.push(...extracted.failures.map((failure) => `${theme.name}: ${failure}`));
        for (const set of extracted.sets) {
          let asset = assets.get(set.id);
          if (!asset) {
            const strip = composeOfficialAssetStrip(set.width, set.height, set.frames);
            const directory = path.join(assetsDir, set.id);
            await fs.promises.mkdir(directory, { recursive: true });
            await Promise.all([
              ...set.frames.map((frame, index) =>
                fs.promises.writeFile(path.join(directory, `${String(index).padStart(2, "0")}.png`), encodeCorosRgbaPng(set.width, set.height, frame))),
              fs.promises.writeFile(path.join(directory, "strip.png"), encodeCorosRgbaPng(strip.width, strip.height, strip.rgba))
            ]);
            asset = {
              id: set.id, category: "other", width: set.width, height: set.height, frames: set.frameCount, encoding: set.encoding,
              elementIds: [], configKeys: [], faces: [], faceCount: 0, strip: { width: strip.width, height: strip.height }, faceNames: new Set()
            };
            assets.set(set.id, asset);
          }
          asset.elementIds = [...new Set([...asset.elementIds, ...set.elementIds])].sort();
          asset.configKeys = [...new Set([...asset.configKeys, ...set.configKeys])].sort();
          asset.faceNames.add(theme.name);
        }
        decodedFaces += 1;
      } catch (error) {
        failures.push(`${theme.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    state.status = { ...state.status, facesDone: state.status.facesDone + 1, assetCount: assets.size };
    // Let IPC status polls and the rest of the app breathe between faces.
    await new Promise((resolve) => setImmediate(resolve));
  };

  const worker = async () => {
    while (next < faces.length) await processFace(faces[next++]);
  };
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));

  const library: StoredLibrary = {
    version: LIBRARY_VERSION, firmwareType, builtAt: new Date().toISOString(), source: "local", faceCount: decodedFaces, failures,
    assets: [...assets.values()].map(({ faceNames, ...asset }) => {
      const category = classifyOfficialAsset(asset.elementIds, asset.configKeys);
      return {
        ...asset, category, ...(category === "fonts" ? { role: officialFontRole(asset.elementIds) } : {}),
        faces: [...faceNames].slice(0, 3), faceCount: faceNames.size
      };
    })
  };
  library.assets.sort((a, b) => a.category.localeCompare(b.category) || b.faceCount - a.faceCount || a.id.localeCompare(b.id));
  await fs.promises.writeFile(path.join(root, "library.json"), JSON.stringify(library));
  state.library = library;
  state.status = { firmwareType, state: "ready", facesDone: decodedFaces, facesTotal: faces.length, assetCount: library.assets.length };
}

/** Hosted first, then the local catalog build when the hosted library is unreachable. */
async function loadLibrary(firmwareType: string, state: BuildState): Promise<void> {
  if (await fetchHostedLibrary(firmwareType, state)) return;
  await buildLibrary(firmwareType, state);
}

function hostedIndexIsStale(library: StoredLibrary | null): boolean {
  if (library?.source !== "hosted" || !library.fetchedAt) return false;
  return Date.now() - Date.parse(library.fetchedAt) > HOSTED_REFRESH_MS;
}

/** Starts a load when no library exists yet; returns the current status immediately. */
export function ensureCorosOfficialAssetLibrary(input: { firmwareType: string; rebuild?: boolean }): CorosOfficialAssetLibraryStatus {
  const firmwareType = normalizeFirmwareType(input?.firmwareType);
  const state = getState(firmwareType);
  if (state.promise) return state.status;
  if (state.library && !input.rebuild) {
    // A day-old hosted index is refreshed quietly; the current one keeps serving meanwhile.
    if (hostedIndexIsStale(state.library)) {
      state.promise = fetchHostedLibrary(firmwareType, state).catch(() => false).then(() => { state.promise = null; });
    }
    return state.status;
  }
  state.status = { firmwareType, state: "building", facesDone: 0, facesTotal: 0, assetCount: 0 };
  state.promise = loadLibrary(firmwareType, state)
    .catch((error: unknown) => {
      state.status = {
        ...state.status, state: state.library ? "ready" : "error",
        message: error instanceof Error ? error.message : "The official asset library could not be built."
      };
    })
    .finally(() => { state.promise = null; });
  return state.status;
}

export function getCorosOfficialAssetLibraryStatus(input: { firmwareType: string }): CorosOfficialAssetLibraryStatus {
  return getState(normalizeFirmwareType(input?.firmwareType)).status;
}

function stripDataUrl(root: string, id: string): string {
  try {
    return `data:image/png;base64,${fs.readFileSync(path.join(root, "assets", id, "strip.png")).toString("base64")}`;
  } catch {
    return "";
  }
}

export async function listCorosOfficialAssets(input: CorosOfficialAssetQuery): Promise<CorosOfficialAssetPage> {
  const firmwareType = normalizeFirmwareType(input?.firmwareType);
  const state = getState(firmwareType);
  const root = libraryRoot(firmwareType);
  const all = state.library?.assets ?? [];
  const category = input.category?.trim() || undefined;
  const role = category === "fonts" ? input.role?.trim() || undefined : undefined;
  const terms = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);

  const frameCount = Number.isInteger(input.frameCount) && (input.frameCount ?? 0) > 0 ? input.frameCount : undefined;
  const configKey = typeof input.configKey === "string" && /^[a-z0-9_]{1,64}$/i.test(input.configKey) ? input.configKey : undefined;
  const tag = typeof input.tag === "string" && /^[a-z0-9-]{1,32}$/i.test(input.tag) ? input.tag : undefined;
  const tagsOf = (asset: StoredAsset) => officialAssetTags(asset.configKeys);
  const inCategory = all.filter((asset) =>
    (!category || asset.category === category) &&
    (!frameCount || asset.frames === frameCount) &&
    (!configKey || asset.configKeys.includes(configKey)) &&
    (!input.frames || (input.frames === "single" ? asset.frames === 1 : asset.frames > 1)));
  const matches = inCategory.filter((asset) => {
    if (role && asset.role !== role) return false;
    if (tag && !tagsOf(asset).some((entry) => entry.id === tag)) return false;
    if (terms.length === 0) return true;
    const haystack = [asset.id, asset.category, asset.role ?? "", `${asset.width}x${asset.height}`, ...asset.configKeys, ...asset.faces]
      .join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(input.pageSize ?? 48)));
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(input.page ?? 1)));
  const visible = matches.slice((page - 1) * pageSize, page * pageSize);
  if (state.library?.source === "hosted") {
    // Strips arrive on demand; a few at a time keeps a fresh page snappy.
    let next = 0;
    await Promise.all(Array.from({ length: STRIP_FETCH_CONCURRENCY }, async () => {
      while (next < visible.length) await ensureHostedFile(firmwareType, visible[next++].id, "strip.png");
    }));
  }

  const categoryCounts = new Map<string, number>();
  for (const asset of all) categoryCounts.set(asset.category, (categoryCounts.get(asset.category) ?? 0) + 1);
  const roleCounts = new Map<string, number>();
  for (const asset of inCategory) if (asset.role) roleCounts.set(asset.role, (roleCounts.get(asset.role) ?? 0) + 1);
  const tagCounts = new Map<string, { label: string; count: number }>();
  for (const asset of inCategory) {
    if (role && asset.role !== role) continue;
    for (const entry of tagsOf(asset)) {
      const current = tagCounts.get(entry.id) ?? { label: entry.label, count: 0 };
      current.count += 1;
      tagCounts.set(entry.id, current);
    }
  }

  return {
    status: state.status,
    categories: (Object.keys(OFFICIAL_ASSET_CATEGORY_LABELS) as OfficialAssetCategory[])
      .filter((id) => categoryCounts.has(id))
      .map((id) => ({ id, label: OFFICIAL_ASSET_CATEGORY_LABELS[id], count: categoryCounts.get(id) ?? 0 })),
    roles: (Object.keys(OFFICIAL_FONT_ROLE_LABELS) as OfficialFontRole[])
      .filter((id) => roleCounts.has(id))
      .map((id) => ({ id, label: OFFICIAL_FONT_ROLE_LABELS[id], count: roleCounts.get(id) ?? 0 })),
    tags: [...tagCounts].map(([id, entry]) => ({ id, label: entry.label, count: entry.count })).sort((a, b) => b.count - a.count),
    total: matches.length, page, pageSize,
    assets: visible.map((asset): CorosOfficialAsset => ({
      id: asset.id, category: asset.category, ...(asset.role ? { role: asset.role } : {}),
      width: asset.width, height: asset.height, frames: asset.frames, configKeys: asset.configKeys, tags: tagsOf(asset),
      faces: asset.faces, faceCount: asset.faceCount,
      strip: { ...asset.strip, dataUrl: stripDataUrl(root, asset.id) }
    }))
  };
}

export async function readCorosOfficialAssetFrames(input: { firmwareType: string; id: string }): Promise<CorosOfficialAssetFrames> {
  const firmwareType = normalizeFirmwareType(input?.firmwareType);
  const id = typeof input?.id === "string" && /^[0-9a-f]{16}$/.test(input.id) ? input.id : "";
  const asset = getState(firmwareType).library?.assets.find((entry) => entry.id === id);
  if (!asset) throw new Error("That official asset is not in the library.");
  const directory = path.join(libraryRoot(firmwareType), "assets", id);
  if (getState(firmwareType).library?.source === "hosted") await ensureHostedFrames(firmwareType, asset);
  const frames = await Promise.all(Array.from({ length: asset.frames }, async (_, index) =>
    `data:image/png;base64,${(await fs.promises.readFile(path.join(directory, `${String(index).padStart(2, "0")}.png`))).toString("base64")}`));
  const source = asset.faces[0] ?? "official face";
  return {
    id, category: asset.category, width: asset.width, height: asset.height, frames,
    label: `${OFFICIAL_ASSET_CATEGORY_LABELS[asset.category]} from ${source}`
  };
}
