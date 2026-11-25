// Reads a COROS template archive (a DAT/ZIP with info.json, watchface_customize.png and one folder per resolution)
// for Studio: what it is (inspectTemplate), its layouts and sprite folders (describeTemplate), its config files as
// text and its PNGs. Rewritten from CorosLink's corosWatchfaceService.ts (inspectArchive, describeCorosWatchfaceTemplate,
// loadCorosWatchfaceTemplateConfigTexts, loadCorosWatchfaceTemplateAssets) for this app: the archive is bytes in
// memory read with the app's own ZIP reader, and PNG sizes come from their headers, so nothing here needs Electron.
// The checks and folder rules are CorosLink's.
import { readZip, type ZipEntry } from "../zipRead";
import type { CorosWatchfaceResolutionDetails, CorosWatchfaceResolutionProfile, CorosWatchfaceSpriteFile, CorosWatchfaceSpriteFolder, CorosWatchfaceTemplateAsset, CorosWatchfaceTemplateDetails } from "../types";
import { extractDecimalProperty, MAX_INFO_BYTES, parseCorosWatchfaceConfig, CONFIG_TEXT_PATH_PATTERN, type ConfigTextFile } from "./config";
import { restoreWatchfaceDateLayout } from "./deviceLayout";

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 15_000;
export const MAX_ARCHIVE_EXPANDED_BYTES = 200 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_TEMPLATE_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_TEMPLATE_ASSET_REQUESTS = 800;
/** The always-on layout CorosLink keeps dormant on a memory-in-pixel face (see its watchfaceArchiveConversion.ts). */
export const RETAINED_AOD_CONFIG = "CorosLinkAODconfig.txt";

/** Four official editable templates spell the resolution separator as × or ??. */
export function normalizeConversionPath(name: string): string {
  return name.replace(/^watchface_(\d+)(?:×|\?\?)(\d+)\//, "watchface_$1x$2/");
}

/** A PNG's size from its header. Throws when the bytes aren't a PNG. */
export function pngSize(data: Uint8Array, label = "image"): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || signature.some((b, i) => data[i] !== b) || String.fromCharCode(...data.subarray(12, 16)) !== "IHDR") {
    throw new Error(`The template ${label} could not be decoded.`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height) throw new Error(`The template ${label} could not be decoded.`);
  return { width, height };
}

/** The files of an archive by normalised path. Directory records are left out. */
export interface TemplateFiles { files: ZipEntry[]; byPath: Map<string, ZipEntry> }

export function openTemplate(bytes: Buffer): TemplateFiles {
  let all: ZipEntry[];
  try { all = readZip(bytes); } catch { throw new Error("That file is not a readable ZIP watchface archive."); }
  const files: ZipEntry[] = [];
  const byPath = new Map<string, ZipEntry>();
  for (const entry of all) {
    entry.path = normalizeConversionPath(entry.path);
    if (entry.directory) continue;
    if (byPath.has(entry.path)) throw new Error("That file is not a readable ZIP watchface archive.");
    byPath.set(entry.path, entry);
    files.push(entry);
  }
  return { files, byPath };
}

/** Paths, sizes and depth an archive may have (CorosLink's validateArchiveInventory). */
export function validateArchiveInventory(
  entries: { path: string; directory?: boolean; size: number }[],
  maxFiles: number, maxExpandedBytes: number, maxEntryBytes: number, maxDepth: number, label: string,
): void {
  const files = entries.filter((entry) => !entry.directory);
  if (files.length > maxFiles) throw new Error(`The ${label} contains too many files (${files.length}; maximum ${maxFiles}).`);
  let expandedBytes = 0;
  for (const entry of entries) {
    const normalized = entry.path.normalize("NFC");
    const contentPath = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
    const parts = contentPath.split("/");
    if (
      !contentPath || normalized.length > 900 ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f\\]/.test(normalized) || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) ||
      parts.some((part) => !part || part === "." || part === "..") || parts.length > maxDepth
    ) throw new Error(`The ${label} contains an unsafe path.`);
    if (entry.directory) continue;
    if (!Number.isFinite(entry.size) || entry.size < 0 || entry.size > maxEntryBytes) throw new Error(`The ${label} contains an invalid or oversized file.`);
    expandedBytes += entry.size;
    if (expandedBytes > maxExpandedBytes) throw new Error(`The ${label} expands beyond its safe size limit.`);
  }
}

export interface TemplateInfo {
  /** Decimal text: official template IDs exceed Number.MAX_SAFE_INTEGER. */
  sourceTemplateId: string;
  diyVersion: number;
  watchFaceVersion: number;
  recoveredFromCompiled?: boolean;
  resolutionDirectories: string[];
  resolutionProfile: CorosWatchfaceResolutionProfile;
  /** info.json's m_name, when it has one. */
  name?: string;
}

/** Checks a starter the way CorosLink's inspectArchive does and says what it is. */
export function inspectTemplate(bytes: Buffer): TemplateInfo {
  if (bytes.length <= 0 || bytes.length > MAX_ARCHIVE_BYTES) throw new Error("The archive must be between 1 byte and 100 MB.");
  const { files, byPath } = openTemplate(bytes);
  validateArchiveInventory(files, MAX_ARCHIVE_FILES, MAX_ARCHIVE_EXPANDED_BYTES, MAX_ARCHIVE_ENTRY_BYTES, 7, "watch-face archive");
  const resolutionDirectories = [...new Set(files.flatMap((entry) => {
    const match = entry.path.match(/^(watchface_(\d+)x(\d+))\/config\.txt$/i);
    return match ? [match[1]] : [];
  }))].sort();
  const infoEntry = byPath.get("info.json") ?? byPath.get("./info.json");
  if (!infoEntry) throw new Error("The archive must contain an info.json template manifest.");
  if (infoEntry.size > MAX_INFO_BYTES) throw new Error("The template manifest is unexpectedly large.");
  if (!byPath.has("watchface_customize.png")) throw new Error("The archive is missing watchface_customize.png.");
  const rawInfo = infoEntry.read().toString("utf8");
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(rawInfo) as Record<string, unknown>; } catch { throw new Error("info.json is not valid UTF-8 JSON."); }
  const sourceTemplateId = extractDecimalProperty(rawInfo, "o_template_id") ??
    (typeof manifest.o_template_id === "string" ? manifest.o_template_id.trim() : undefined);
  const diyVersion = Number(manifest.o_diy_version ?? 1);
  const watchFaceVersion = Number(manifest.o_wf_ver ?? 0);
  if (!sourceTemplateId || !/^\d{1,20}$/.test(sourceTemplateId)) throw new Error("info.json must include a valid o_template_id.");
  if (!Number.isSafeInteger(diyVersion) || diyVersion < 1) throw new Error("info.json must include a valid o_diy_version.");
  if (!Number.isSafeInteger(watchFaceVersion) || watchFaceVersion < 0 || watchFaceVersion > 999) throw new Error("info.json must include a valid o_wf_ver when present.");
  const recovery = manifest.coroslinkRecovery as { partial?: unknown } | undefined;
  return {
    sourceTemplateId, diyVersion, watchFaceVersion,
    ...(recovery?.partial === true ? { recoveredFromCompiled: true } : {}),
    resolutionDirectories,
    resolutionProfile: resolutionProfileOf(resolutionDirectories),
    ...(typeof manifest.m_name === "string" && manifest.m_name.trim() ? { name: manifest.m_name.trim().slice(0, 80) } : {}),
  };
}

export function resolutionProfileOf(directories: string[]): CorosWatchfaceResolutionProfile {
  const has = new Set(directories);
  if (has.has("watchface_466x466") && has.has("watchface_800x800")) return "amoled-466-800";
  if (has.has("watchface_240x240") && has.has("watchface_260x260") && has.has("watchface_800x800")) return "mip-240-260-800";
  if (has.has("watchface_416x416") && has.has("watchface_800x800")) return "amoled-416-800";
  if (has.has("watchface_390x390") && has.has("watchface_800x800")) return "amoled-390-800";
  return "other";
}

function readConfig(byPath: Map<string, ZipEntry>, configPath: string): Record<string, string> {
  const entry = byPath.get(configPath);
  if (!entry || entry.size > MAX_INFO_BYTES) return {};
  return parseCorosWatchfaceConfig(restoreWatchfaceDateLayout(entry.read().toString("utf8")));
}

function spriteFile(entry: ZipEntry): CorosWatchfaceSpriteFile {
  return { path: entry.path, ...pngSize(entry.read(), `sprite ${entry.path}`) };
}

function classifySpriteFolder(numbered: Map<number, ZipEntry>): CorosWatchfaceSpriteFolder["kind"] | null {
  const hasRange = (count: number) => Array.from({ length: count }, (_, i) => i).every((i) => numbered.has(i));
  if (hasRange(12)) return "month";
  if (hasRange(10)) return "digits";
  if (hasRange(7)) return "week";
  return null;
}

/**
 * The bitmap-font folders and icons of one resolution: 00–09 is a digit font, 00–06 weekday labels, 00–11 one label
 * per month; folders a config names as an icon directory or level table are state sets of any length. The `a/`
 * subtree holds the same for the always-on display.
 */
function spriteAssets(files: ZipEntry[], directory: string, configs: Record<string, string>[]): Pick<CorosWatchfaceResolutionDetails, "spriteFolders" | "icons"> {
  const prefix = `${directory}/`;
  const folderFiles = new Map<string, Map<number, ZipEntry>>();
  const iconEntries = new Map<string, ZipEntry>();
  const referenced = new Set(configs.flatMap((c) => Object.values(c))
    .map((v) => v.replace(/\\/g, "/").replace(/^\.\//, "")).filter((v) => /^[^/].*\.png$/i.test(v)));
  for (const entry of files) {
    if (!entry.path.startsWith(prefix)) continue;
    const relative = entry.path.slice(prefix.length);
    if (referenced.has(relative)) iconEntries.set(entry.path, entry);
    const sprite = relative.match(/^(.+)\/(\d{2})\.png$/i);
    if (sprite) {
      const numbered = folderFiles.get(sprite[1]) ?? new Map<number, ZipEntry>();
      numbered.set(Number(sprite[2]), entry);
      folderFiles.set(sprite[1], numbered);
      continue;
    }
    if (/^(a\/)?icon\/[^/]+\.png$/i.test(relative)) iconEntries.set(entry.path, entry);
  }
  const stateFolders = new Set(configs.flatMap((c) => Object.entries(c))
    .filter(([key, value]) => (/_icon_dir$/.test(key) || /_level_icon$/.test(key) || /^(today|week)_\w+_unit_icon$/.test(key) ||
      key === "chart_moon_icon" || key === "weather_temp_max_min_dgree_icon" || key === "weather_dgree_icon") && Boolean(value))
    .map(([, value]) => value.replace(/\\/g, "/").replace(/^\.\//, "")));
  const spriteFolders: CorosWatchfaceSpriteFolder[] = [];
  for (const [folder, numbered] of folderFiles) {
    const plain = folder.replace(/^a\//, "");
    const kind = stateFolders.has(folder) || stateFolders.has(plain) ||
      /^(?:battery|weather|cl_battery_icon|cl_nd_(?![a-z0-9_]*_d$)[a-z0-9_]+)$/i.test(plain) ? "state" : classifySpriteFolder(numbered);
    if (!kind) continue;
    const indices = kind === "state" ? [...numbered.keys()].sort((a, b) => a - b)
      : Array.from({ length: kind === "month" ? 12 : kind === "digits" ? 10 : 7 }, (_, i) => i);
    spriteFolders.push({ folder, kind, aod: folder === "a" || folder.startsWith("a/"), files: indices.map((i) => spriteFile(numbered.get(i)!)) });
  }
  spriteFolders.sort((a, b) => a.folder.localeCompare(b.folder));
  const icons = [...iconEntries.values()].map(spriteFile).sort((a, b) => a.path.localeCompare(b.path));
  return { spriteFolders, icons };
}

/** Every layout of a template with its sprite folders and icons, as Studio's engine expects them. */
export function describeTemplate(bytes: Buffer, archiveId: string): CorosWatchfaceTemplateDetails {
  const { files, byPath } = openTemplate(bytes);
  const names = [...new Set(files.map((e) => e.path.match(/^(watchface_(\d+)x(\d+))\//)?.[1]).filter((n): n is string => Boolean(n)))];
  if (!names.length) throw new Error("This template does not contain any watchface resolution folders.");
  const resolutions = names.map((directory): CorosWatchfaceResolutionDetails => {
    const [, w, h] = directory.match(/_(\d+)x(\d+)$/)!;
    const config = readConfig(byPath, `${directory}/config.txt`);
    const aodConfig = readConfig(byPath, `${directory}/AODconfig.txt`);
    return { directory, width: Number(w), height: Number(h), config, aodConfig, ...spriteAssets(files, directory, [config, aodConfig]) };
  });
  return { archiveId, resolutions };
}

/** The raw config.txt / AODconfig.txt files, for Studio's baselines and its config text editor. */
export function templateConfigTexts(bytes: Buffer): ConfigTextFile[] {
  const { files } = openTemplate(bytes);
  return files.filter((e) => CONFIG_TEXT_PATH_PATTERN.test(e.path.replace(/^\.\//, "")))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => {
      if (entry.size <= 0 || entry.size > MAX_INFO_BYTES) throw new Error(`The template config at ${entry.path} is unreadable.`);
      return { path: entry.path.replace(/^\.\//, ""), text: restoreWatchfaceDateLayout(entry.read().toString("utf8")) };
    });
}

/** PNG entries of the template as data URLs. `skipMissing` leaves out ones the template names but never shipped. */
export function templateAssets(bytes: Buffer, paths: unknown, skipMissing = false): CorosWatchfaceTemplateAsset[] {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("Request at least one template image.");
  if (paths.length > MAX_TEMPLATE_ASSET_REQUESTS) throw new Error("Too many template images were requested at once.");
  const { byPath } = openTemplate(bytes);
  const assets: CorosWatchfaceTemplateAsset[] = [];
  for (const assetPath of new Set(paths)) {
    if (typeof assetPath !== "string" || !assetPath.toLowerCase().endsWith(".png")) throw new Error("Template images must be PNG entries of the archive.");
    const entry = byPath.get(assetPath);
    if (!entry) {
      if (skipMissing) continue;
      throw new Error("The template does not contain one of the requested images.");
    }
    const data = entry.read();
    if (data.length > MAX_TEMPLATE_ASSET_BYTES) throw new Error("A requested template image is unexpectedly large.");
    assets.push({ path: assetPath, dataUrl: `data:image/png;base64,${data.toString("base64")}`, ...pngSize(data, `image ${assetPath}`) });
  }
  return assets;
}
