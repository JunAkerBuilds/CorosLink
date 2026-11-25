// Builds the final watch archive from a project's starter and what Studio composed: the 800 px background and preview,
// sprite replacements and new Studio sprites, config overrides and edited config texts. CorosLink's
// createCorosWatchfaceArchive and rewriteTemplateArchive (corosWatchfaceService.ts at c2ff5110), moved as part of the
// template engine because the watch reads every byte: same order of entries, same config rules, same pruning. Only
// the image work changed: PNGs are decoded and scaled with the compiler's own codec (compiler/png.ts, and scale.ts's
// shrinkImage, close to the Chromium resize CorosLink used) instead of Electron's nativeImage, so this runs in a worker
// thread and in tests. A face with no 800 px master (recovered from a compiled BIN, or made in the COROS app) is built
// from its own layout and then scaled to the watch's sizes with that watch's carrier (buildFromNativeLayout,
// CorosLink's prepareRecoveredExportZip).
import { decodePng, encodePng, type RgbaImage } from "../compiler/png";
import { shrinkImage } from "../compiler/scale";
import { createStoreZip } from "../zipStore";
import { getWatchfaceTarget, type WatchfaceTarget } from "../watchfaceTargets";
import type { CorosWatchfaceAssetReplacement, CorosWatchfaceConfigOverride } from "../types";
import type { WatchModelId } from "../watchModels";
import {
  applyCorosWatchfaceConfigOverrides, COROS_CONFIG_DELETE_VALUE, CONFIG_TEXT_PATH_PATTERN, finalizeCorosWatchfaceBarometerConfig,
  normalizeWatchfaceIdOverride, parseCorosWatchfaceConfig, raiseWatchFaceVersion, repairStandaloneBatteryConfigOverrides,
  setWatchFaceVersion, setWatchfaceTemplateId, setWatchfaceTemplateName, stripBlankCorosWatchfaceConfigKeys,
  synthesizeScaledCorosAodConfig, validateConfigOverrides, validateConfigTextReplacements, type ConfigTextFile,
} from "./config";
import { finalizeWatchfaceDeviceLayout, restoreWatchfaceDateLayout } from "./deviceLayout";
import { fitGeneratedWatchfaceFontRects } from "./exportFontBounds";
import { prepareRecoveredWatchfaceExport } from "./conversion";
import { readZip } from "../zipRead";
import {
  inspectTemplate, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRY_BYTES, MAX_ARCHIVE_EXPANDED_BYTES, MAX_ARCHIVE_FILES, openTemplate,
  pngSize, RETAINED_AOD_CONFIG, validateArchiveInventory,
} from "./template";

const CREATOR_CANVAS_SIZE = 800;
const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
const MAX_SPRITE_REPLACEMENTS = 4096;
const MAX_SPRITE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SPRITE_BYTES = 20 * 1024 * 1024;
const CREATED_STUDIO_SPRITE_PATTERN =
  /^watchface_(\d{3,4})x\1\/(?:studio\/[a-z0-9_-]{1,64}|cl_[a-z0-9_]{1,32}|weather2?)\/\d{2}\.png$/i;
// Only these namespaces belong to Studio. Official assets (including weather) may have firmware references outside
// the editable layout configs.
const OWNED_STUDIO_SPRITE_PATTERN =
  /^watchface_(\d{3,4})x\1\/(?:studio\/[a-z0-9_-]{1,64}|cl_[a-z0-9_]{1,32})\/\d{2}\.png$/i;
const CREATOR_ARTWORK_ENTRY_PATTERN =
  /^(?:watchface_customize\.png|watchface_\d{3,4}x\d{3,4}\/(?:background|watchface_customize|thmb)\.png)$/i;

type Entry = { name: string; data: Buffer };

/** What Studio sends to build a face (CorosLink's CorosWatchfaceCreatorInput, less the archive registry). */
export interface WatchfaceBuildInput {
  /** The 800 px background as a PNG data URL. */
  backgroundDataUrl: string;
  /** The 800 px preview (watchface_customize.png); the background when left out. */
  previewDataUrl?: string;
  /** The background wasn't edited: keep the template's own background.png files as they are. */
  keepTemplateBackground?: boolean;
  firmwareType?: string;
  watchModel?: WatchModelId;
  watchFaceVersion?: number;
  minWatchFaceVersion?: number;
  templateIdOverride?: string;
  watchfaceIdOverride?: string;
  templateNameOverride?: string;
  stripBlankConfigKeys?: boolean;
  assetReplacements?: CorosWatchfaceAssetReplacement[];
  configOverrides?: CorosWatchfaceConfigOverride[];
  configTextReplacements?: ConfigTextFile[];
}

interface DecodedSprite { data: Buffer; width: number; height: number; create: boolean; allowDimensionOverride: boolean }

function pngFromDataUrl(dataUrl: unknown, label: string): Buffer {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) throw new Error(`The creator ${label} must be a PNG canvas image.`);
  const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  if (bytes.length === 0 || bytes.length > MAX_ARTWORK_BYTES) throw new Error("The created watchface image must be smaller than 10 MB.");
  return bytes;
}

/** The background or preview at the 800 px master size. */
function creatorImage(dataUrl: unknown, label: "background" | "preview"): RgbaImage {
  let image: RgbaImage;
  try { image = decodePng(pngFromDataUrl(dataUrl, label)); } catch (e) {
    if (e instanceof Error && e.message.startsWith("The creat")) throw e;
    throw new Error(`The created watchface ${label} could not be rendered.`);
  }
  return shrinkImage(image, CREATOR_CANVAS_SIZE, CREATOR_CANVAS_SIZE);
}

function decodeSpriteReplacements(replacements: CorosWatchfaceAssetReplacement[] | undefined): Map<string, DecodedSprite> {
  const decoded = new Map<string, DecodedSprite>();
  if (replacements === undefined) return decoded;
  if (!Array.isArray(replacements) || replacements.length > MAX_SPRITE_REPLACEMENTS) throw new Error("The creator sent an invalid sprite replacement list.");
  let totalBytes = 0;
  for (const replacement of replacements) {
    if (!replacement || typeof replacement.path !== "string" || typeof replacement.dataUrl !== "string" || !replacement.dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("Sprite replacements must be PNG images with template paths.");
    }
    if (replacement.create && !CREATED_STUDIO_SPRITE_PATTERN.test(replacement.path)) throw new Error("New sprites must use a watchface resolution studio folder.");
    if (decoded.has(replacement.path)) throw new Error("Sprite replacements contain a duplicated template path.");
    const data = Buffer.from(replacement.dataUrl.slice("data:image/png;base64,".length), "base64");
    totalBytes += data.length;
    if (data.length === 0 || data.length > MAX_SPRITE_BYTES || totalBytes > MAX_TOTAL_SPRITE_BYTES) throw new Error("A sprite replacement is empty or too large.");
    let size: { width: number; height: number };
    try { size = pngSize(data); } catch { throw new Error("A sprite replacement could not be decoded as an image."); }
    decoded.set(replacement.path, { data, ...size, create: replacement.create === true, allowDimensionOverride: replacement.allowDimensionOverride === true });
  }
  return decoded;
}

function optionalVersion(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 999) throw new Error(`${label} must be a whole number from 0 to 999.`);
  return Number(value);
}

/** PACE 4 Pro, VERTIX 4, PACE 4 and APEX 4 need certain layouts; say which are missing. */
export function assertFirmwareResolutionCompatibility(resolutionDirectories: string[], firmwareType: string | undefined, watchModel?: WatchModelId): void {
  const firmware = firmwareType?.trim().toUpperCase();
  const need = firmware === "COROS W337" || watchModel === "pace-4-pro" ? { label: "PACE 4 Pro", required: ["watchface_466x466", "watchface_800x800"] }
    : firmware === "COROS W706" || watchModel === "vertix-4" ? { label: "VERTIX 4", required: ["watchface_466x466", "watchface_800x800"] }
    : firmware === "COROS W336" || watchModel === "pace-4" ? { label: "PACE 4", required: ["watchface_390x390", "watchface_800x800"] }
      : firmware === "COROS W541" || watchModel === "apex-4" ? { label: "APEX 4", required: ["watchface_240x240", "watchface_260x260"] } : null;
  if (!need) return;
  const missing = need.required.filter((d) => !resolutionDirectories.includes(d));
  if (missing.length) {
    throw new Error(`${need.label}${firmwareType ? ` (${firmwareType})` : ""} requires ${need.required.map((d) => d.replace("watchface_", "").replace("x", "×")).join(" and ")} exports. This template is missing ${missing.map((d) => d.replace("watchface_", "")).join(" and ")}. Browse and choose a ${need.label} template before exporting.`);
  }
}

/**
 * Whether `starter` is built from its own layout for `watch`: always for a face recovered from a BIN; for a face with no
 * 800 px master when it goes to another watch or lacks one of the watch's sizes (CorosLink's scalesFromNativeLayout).
 */
export function buildsFromNativeLayout(info: { recoveredFromCompiled?: boolean; resolutionDirectories: string[] }, watch: WatchfaceTarget, own: WatchfaceTarget): boolean {
  if (info.recoveredFromCompiled) return true;
  if (info.resolutionDirectories.includes("watchface_800x800")) return false;
  return watch.model !== own.model || watch.sizes.some((size) => !info.resolutionDirectories.includes(`watchface_${size}x${size}`));
}

/** The destination watch and its carrier (convert.ts picks it), for a face built from its own layout. */
export interface NativeLayoutTarget { target: WatchfaceTarget; carrier: Entry[] }

/**
 * The final watch archive (DAT/ZIP) for `starter` with Studio's composition applied. With `native`, the face is built
 * as it is and then scaled from its own layout to the destination's sizes (buildFromNativeLayout).
 */
export function buildWatchfaceArchive(starter: Buffer, input: WatchfaceBuildInput, native?: NativeLayoutTarget): Buffer {
  if (!input || typeof input !== "object") throw new Error("Choose a starter template before creating a watchface.");
  const info = inspectTemplate(starter);
  if (info.recoveredFromCompiled && !native) throw new Error("Choose a watch before building this recovered face.");
  const firmwareType = native ? native.target.firmwareType
    : typeof input.firmwareType === "string" && input.firmwareType.trim() ? input.firmwareType.trim() : undefined;
  const exportTarget = native ? undefined : getWatchfaceTarget(input.watchModel ?? firmwareType);
  const firmwareTarget = getWatchfaceTarget(firmwareType);
  if (exportTarget && firmwareTarget && exportTarget.model !== firmwareTarget.model) throw new Error("The selected watch and COROS firmware type do not match.");
  if (!native) assertFirmwareResolutionCompatibility(info.resolutionDirectories, firmwareType, input.watchModel);
  const background = creatorImage(input.backgroundDataUrl, "background");
  const preview = input.previewDataUrl ? creatorImage(input.previewDataUrl, "preview") : background;
  const sprites = decodeSpriteReplacements(input.assetReplacements);
  const configOverrides = validateConfigOverrides(input.configOverrides);
  const configTextReplacements = validateConfigTextReplacements(input.configTextReplacements);
  const minimumWatchFaceVersion = optionalVersion(input.minWatchFaceVersion, "Minimum watch-face version");
  const watchFaceVersion = optionalVersion(input.watchFaceVersion, "Archive watch-face version");
  const templateIdOverride = input.templateIdOverride === undefined ? undefined : String(input.templateIdOverride).trim();
  const watchfaceIdOverride = input.watchfaceIdOverride === undefined ? undefined : normalizeWatchfaceIdOverride(String(input.watchfaceIdOverride));
  const templateNameOverride = input.templateNameOverride === undefined ? undefined : String(input.templateNameOverride).trim();
  if (templateIdOverride !== undefined && (!/^\d{1,20}$/.test(templateIdOverride) || /^0+$/.test(templateIdOverride))) throw new Error("Template ID overrides must contain 1–20 decimal digits.");
  if (templateNameOverride !== undefined && (templateNameOverride.length === 0 || templateNameOverride.length > 64)) throw new Error("Template name overrides must contain 1–64 characters.");
  if (watchFaceVersion !== undefined && minimumWatchFaceVersion !== undefined && watchFaceVersion < minimumWatchFaceVersion) {
    throw new Error(`Archive watch-face version ${watchFaceVersion} is too low for the selected features; use version ${minimumWatchFaceVersion} or newer.`);
  }
  if (native && (templateIdOverride || watchfaceIdOverride)) {
    throw new Error("Faces rebuilt from their own layout use a compatible COROS template identity. Clear the template/watch-face ID overrides before exporting.");
  }
  const zip = rewriteTemplateArchive(starter, background, preview, sprites, configOverrides, minimumWatchFaceVersion, watchFaceVersion,
    templateIdOverride, templateNameOverride, watchfaceIdOverride, configTextReplacements, input.stripBlankConfigKeys === true,
    exportTarget, input.keepTemplateBackground === true);
  // An edited background goes on at each size from the 800 px render; an untouched one is the template's own, scaled
  // from the native tree like every other image.
  return native ? buildFromNativeLayout(zip, native, encodePng(preview), input.keepTemplateBackground === true ? undefined : encodePng(background)) : zip;
}

/**
 * A built face scaled from its own layout to `native.target`'s sizes, the carrier giving the template identity,
 * thumbnails and watchface IDs (CorosLink's prepareRecoveredExportZip). The full 800 px preview replaces the recovered
 * catalog thumbnail, which can be smaller.
 */
function buildFromNativeLayout(built: Buffer, native: NativeLayoutTarget, preview: Buffer, masterBackground?: Buffer): Buffer {
  const source = readZip(built).filter((e) => !e.directory).map((e) => ({ name: e.path, data: e.read() }))
    .map((e) => (e.name === "watchface_customize.png" ? { ...e, data: preview } : e));
  const entries = finalizeWatchfaceDeviceLayout(fitGeneratedWatchfaceFontRects(
    prepareRecoveredWatchfaceExport(source, native.carrier, native.target, masterBackground)));
  validateArchiveInventory(entries.map((e) => ({ path: e.name, size: e.data.byteLength })),
    MAX_ARCHIVE_FILES, MAX_ARCHIVE_EXPANDED_BYTES, MAX_ARCHIVE_ENTRY_BYTES, 7, "exported watch-face archive");
  const zip = createStoreZip(entries);
  if (zip.byteLength > MAX_ARCHIVE_BYTES) throw new Error("The exported archive exceeds 100 MB.");
  return zip;
}

function rewriteTemplateArchive(
  source: Buffer, background: RgbaImage, preview: RgbaImage, spriteReplacements: Map<string, DecodedSprite>,
  configOverrides: Map<string, Record<string, string>>, minWatchFaceVersion: number | undefined, watchFaceVersion: number | undefined,
  templateIdOverride: string | undefined, templateNameOverride: string | undefined, watchfaceIdOverride: string | undefined,
  configTextReplacements: Map<string, string>, stripBlankConfigKeys: boolean,
  // Kept in the signature as in CorosLink; per-watch device layout needs no target today.
  _exportTarget: WatchfaceTarget | undefined, keepTemplateBackground: boolean,
): Buffer {
  const { files: originalSourceFiles } = openTemplate(source);
  const sourcePaths = new Set(originalSourceFiles.map((e) => e.path));
  for (const configPath of configTextReplacements.keys()) {
    if (!sourcePaths.has(configPath)) throw new Error("A config text replacement targets a file the template does not have.");
  }
  const configEntries = originalSourceFiles.filter((e) => /(^|\/)(?:AODconfig|config)\.txt$/i.test(e.path));
  if (watchfaceIdOverride !== undefined) {
    for (const entry of configEntries) configOverrides.set(entry.path, { ...(configOverrides.get(entry.path) ?? {}), watchface_id: watchfaceIdOverride });
  }
  const parsedConfigs = new Map<string, Record<string, string>>();
  for (const entry of configEntries) {
    parsedConfigs.set(entry.path, parseCorosWatchfaceConfig(restoreWatchfaceDateLayout(configTextReplacements.get(entry.path) ?? entry.read().toString("utf8"))));
  }
  const normalizeConfigFolder = (value: string | undefined) => value?.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "") ?? "";
  // A removed control battery takes its sprite folder with it, unless another key in that resolution still uses it.
  const removedControlBatteryPrefixes = new Set<string>();
  for (const [configPath, overrides] of configOverrides) {
    if (overrides.control_battery_icon_dir !== COROS_CONFIG_DELETE_VALUE) continue;
    const config = parsedConfigs.get(configPath);
    if (!config) continue;
    const folder = normalizeConfigFolder(config.control_battery_icon_dir);
    const resolutionDirectory = configPath.split("/", 1)[0];
    const stillReferenced = configEntries.some((entry) => {
      if (entry.path.split("/", 1)[0] !== resolutionDirectory) return false;
      const effective = { ...(parsedConfigs.get(entry.path) ?? {}), ...(configOverrides.get(entry.path) ?? {}) };
      return Object.entries(effective).some(([key, value]) => /_icon_dir$/i.test(key) && value !== COROS_CONFIG_DELETE_VALUE && normalizeConfigFolder(value) === folder);
    });
    if (folder && !stillReferenced) removedControlBatteryPrefixes.add(`${resolutionDirectory}/${folder}/`);
  }
  const sourceFiles = originalSourceFiles.filter((e) => ![...removedControlBatteryPrefixes].some((p) => e.path.startsWith(p)));
  const studioBatteryResolutions = new Set<string>();
  for (const spritePath of [...sourcePaths, ...spriteReplacements.keys()]) {
    const match = spritePath.match(/^(watchface_\d+x\d+)\/cl_battery_icon\/\d{2}\.png$/i);
    if (match) studioBatteryResolutions.add(match[1]);
  }
  const hasNativeBackground = sourceFiles.some((e) => /^watchface_\d+x\d+\/background\.png$/i.test(e.path) && sourcePaths.has(e.path.replace(/background\.png$/i, "config.txt")));
  if (!sourcePaths.has("watchface_customize.png") || !hasNativeBackground) throw new Error("This template does not include the assets required by the creator.");

  // Every firmware family ships its own resolution trees: each artwork entry is replaced at its own size.
  const replacements = new Map<string, Buffer>();
  const scaledCache = new Map<string, Buffer>();
  const artworkAt = (image: RgbaImage, which: string, width: number, height: number) => {
    const key = `${which}:${width}x${height}`;
    let png = scaledCache.get(key);
    if (!png) { png = encodePng(shrinkImage(image, width, height)); scaledCache.set(key, png); }
    return png;
  };
  for (const entry of sourceFiles) {
    const artwork = CREATOR_ARTWORK_ENTRY_PATTERN.test(entry.path) && !(keepTemplateBackground && /\/background\.png$/i.test(entry.path));
    // Templates with COROS's custom-background picker keep the on-watch artwork in custom_bg.png (custom.pb points
    // at it), so it's replaced too, at its own size.
    const customBackground = !keepTemplateBackground && entry.path.toLowerCase().endsWith("/custom_bg.png");
    if (!artwork && !customBackground) continue;
    let size: { width: number; height: number };
    try { size = pngSize(entry.read()); } catch {
      throw new Error(customBackground ? "This template has an unreadable custom background image." : `This template has an unreadable artwork image at ${entry.path}.`);
    }
    const isPreview = entry.path.toLowerCase() === "watchface_customize.png";
    replacements.set(entry.path, artworkAt(isPreview ? preview : background, isPreview ? "preview" : "background", size.width, size.height));
  }

  for (const [spritePath, sprite] of spriteReplacements) {
    if (sprite.create && !sourcePaths.has(`${spritePath.split("/", 1)[0]}/config.txt`)) throw new Error("A new studio sprite targets a resolution the template does not have.");
    if (!sprite.create && !sourcePaths.has(spritePath)) throw new Error("A sprite replacement does not exist in the starter template.");
    if (replacements.has(spritePath) || spritePath.toLowerCase().endsWith("/custom_bg.png")) throw new Error("Sprite replacements may not target the background or preview images.");
  }
  for (const configPath of configOverrides.keys()) {
    if (!sourcePaths.has(configPath)) throw new Error("A layout override targets a config file the template does not have.");
  }

  const entries: Entry[] = sourceFiles.map((entry) => {
    if ((minWatchFaceVersion !== undefined || watchFaceVersion !== undefined || templateIdOverride !== undefined || templateNameOverride !== undefined) &&
      entry.path.replace(/^\.\//, "") === "info.json") {
      // info.json is edited as text: o_template_id is beyond JavaScript's safe integers.
      const rawInfo = entry.read().toString("utf8");
      const versioned = watchFaceVersion !== undefined ? setWatchFaceVersion(rawInfo, watchFaceVersion)
        : minWatchFaceVersion !== undefined ? raiseWatchFaceVersion(rawInfo, minWatchFaceVersion) : rawInfo;
      const identified = templateIdOverride !== undefined ? setWatchfaceTemplateId(versioned, templateIdOverride) : versioned;
      return { name: entry.path, data: Buffer.from(templateNameOverride !== undefined ? setWatchfaceTemplateName(identified, templateNameOverride) : identified, "utf8") };
    }
    const artwork = replacements.get(entry.path);
    if (artwork) return { name: entry.path, data: artwork };
    const overrides = configOverrides.get(entry.path);
    const textReplacement = configTextReplacements.get(entry.path);
    const isConfigFile = /(^|\/)(?:AODconfig|config)\.txt$/i.test(entry.path);
    const isNormalConfig = /(^|\/)config\.txt$/i.test(entry.path);
    if (isConfigFile || overrides || textReplacement !== undefined || (isNormalConfig && studioBatteryResolutions.has(entry.path.split("/", 1)[0]))) {
      const rawConfig = restoreWatchfaceDateLayout(textReplacement ?? entry.read().toString("utf8"));
      const withWatchfaceId = watchfaceIdOverride !== undefined ? { ...(overrides ?? {}), watchface_id: watchfaceIdOverride } : (overrides ?? {});
      const effective = isNormalConfig
        ? repairStandaloneBatteryConfigOverrides(rawConfig, withWatchfaceId, studioBatteryResolutions.has(entry.path.split("/", 1)[0]))
        : withWatchfaceId;
      // Barometer checks and blank-key stripping run after the overrides, so old static projects are normalised first.
      const finalize = (text: string) => {
        const safe = isConfigFile ? finalizeCorosWatchfaceBarometerConfig(text) : text;
        return isConfigFile && stripBlankConfigKeys ? stripBlankCorosWatchfaceConfigKeys(safe) : safe;
      };
      const text = Object.keys(effective).length ? applyCorosWatchfaceConfigOverrides(rawConfig, effective) : rawConfig;
      return { name: entry.path, data: Buffer.from(finalize(text), "utf8") };
    }
    const sprite = spriteReplacements.get(entry.path);
    if (!sprite) return { name: entry.path, data: entry.read() };
    // Studio paths are upserts: rebuilding from an earlier generated archive replaces the old sprite at any size.
    if (sprite.create) return { name: entry.path, data: sprite.data };
    // Template sprites keep their exact size: the firmware lays digits and icons out with the original dimensions.
    let original: { width: number; height: number } | null = null;
    try { original = pngSize(entry.read()); } catch { /* reported below */ }
    if (!original || (!sprite.allowDimensionOverride && (original.width !== sprite.width || original.height !== sprite.height))) {
      throw new Error(`The replacement for ${entry.path} must be a ${original?.width ?? "?"}×${original?.height ?? "?"} PNG like the template's.`);
    }
    return { name: entry.path, data: sprite.data };
  });

  // New Studio sprites go just before their resolution's config.txt, sorted.
  const createdByResolution = new Map<string, Entry[]>();
  const retained = new Set(sourceFiles.map((e) => e.path));
  for (const [spritePath, sprite] of spriteReplacements) {
    if (!sprite.create || retained.has(spritePath)) continue;
    const resolution = spritePath.split("/", 1)[0];
    createdByResolution.set(resolution, [...(createdByResolution.get(resolution) ?? []), { name: spritePath, data: sprite.data }]);
  }
  for (const created of createdByResolution.values()) created.sort((a, b) => a.name.localeCompare(b.name));
  const ordered: Entry[] = [];
  for (const entry of entries) {
    if (/(^|\/)config\.txt$/i.test(entry.name)) {
      const resolution = entry.name.split("/", 1)[0];
      ordered.push(...(createdByResolution.get(resolution) ?? []));
      createdByResolution.delete(resolution);
    }
    ordered.push(entry);
  }
  for (const created of createdByResolution.values()) ordered.push(...created);

  // Some templates ship AODconfig.txt for one resolution only; the others get one scaled from it.
  const finalPaths = new Set(ordered.map((e) => e.name));
  const aodSource = ordered.find((e) => /^watchface_\d+x\d+\/AODconfig\.txt$/i.test(e.name));
  if (aodSource) {
    const sourceWidth = Number(aodSource.name.match(/^watchface_(\d+)x/i)![1]);
    for (const entry of [...ordered]) {
      const match = entry.name.match(/^(watchface_(\d+)x\d+)\/config\.txt$/i);
      if (!match) continue;
      const aodPath = `${match[1]}/AODconfig.txt`;
      if (finalPaths.has(aodPath)) continue;
      const synthesized = synthesizeScaledCorosAodConfig(aodSource.data.toString("utf8"), Number(match[2]) / sourceWidth, finalPaths, match[1]);
      // The always-on id pairs with this resolution's own current-face config.
      const targetId = parseCorosWatchfaceConfig(entry.data.toString("utf8")).watchface_id;
      const paired = targetId ? applyCorosWatchfaceConfigOverrides(synthesized, { watchface_id: targetId }) : synthesized;
      ordered.splice(ordered.indexOf(entry) + 1, 0, { name: aodPath, data: Buffer.from(paired, "utf8") });
      finalPaths.add(aodPath);
    }
  }
  // Prune first so each folder holds only what is referenced, share identical folders, then prune the copies.
  const finalEntries = finalizeWatchfaceDeviceLayout(
    removeUnreferencedStudioSprites(shareIdenticalStudioSprites(removeUnreferencedStudioSprites(fitGeneratedWatchfaceFontRects(ordered)))),
  );
  validateArchiveInventory(finalEntries.map((e) => ({ path: e.name, size: e.data.byteLength })),
    MAX_ARCHIVE_FILES, MAX_ARCHIVE_EXPANDED_BYTES, MAX_ARCHIVE_ENTRY_BYTES, 7, "watch-face archive");
  const zip = createStoreZip(finalEntries);
  if (zip.byteLength > MAX_ARCHIVE_BYTES) throw new Error("The generated watch-face archive must be smaller than 100 MB.");
  return zip;
}

/**
 * Studio writes a folder per slot and per display mode, so a face often carries byte-identical copies. Points every
 * config reference at the first copy of each owned folder; the copies are then pruned as unreferenced. Folders must
 * match file for file, and only Studio-owned folders take part. An `a\` value is left alone.
 */
export function shareIdenticalStudioSprites(entries: Entry[]): Entry[] {
  const folders = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!OWNED_STUDIO_SPRITE_PATTERN.test(entry.name)) continue;
    const folder = entry.name.slice(0, entry.name.lastIndexOf("/"));
    folders.set(folder, [...(folders.get(folder) ?? []), entry]);
  }
  const same = (left: Entry[], right: Entry[], leftFolder: string, rightFolder: string) =>
    left.length === right.length && left.every((file, i) => file.name.slice(leftFolder.length) === right[i].name.slice(rightFolder.length) && file.data.equals(right[i].data));
  const replacements = new Map<string, Map<string, string>>();
  const kept = new Map<string, { folder: string; files: Entry[] }[]>();
  for (const [folder, unsorted] of folders) {
    const files = [...unsorted].sort((a, b) => a.name.localeCompare(b.name));
    const resolution = folder.split("/", 1)[0];
    const signature = `${resolution}|${files.map((f) => `${f.name.slice(folder.length)}:${f.data.byteLength}`).join(",")}`;
    const candidates = kept.get(signature) ?? [];
    const original = candidates.find((c) => same(c.files, files, c.folder, folder));
    if (original) {
      const byResolution = replacements.get(resolution) ?? new Map<string, string>();
      byResolution.set(folder.slice(resolution.length + 1).toLowerCase(), original.folder.slice(resolution.length + 1));
      replacements.set(resolution, byResolution);
    } else {
      candidates.push({ folder, files });
      kept.set(signature, candidates);
    }
  }
  if (!replacements.size) return entries;
  return entries.map((entry) => {
    if (!CONFIG_TEXT_PATH_PATTERN.test(entry.name) && !entry.name.endsWith(`/${RETAINED_AOD_CONFIG}`)) return entry;
    const byResolution = replacements.get(entry.name.split("/", 1)[0]);
    if (!byResolution) return entry;
    let changed = false;
    const text = entry.data.toString("utf8").replace(/^(\[[^\]\r\n]+\]=\s*(?:\.[\\/])?)([^\r\n]*)$/gm, (line, prefix: string, value: string) => {
      const parts = value.split(/[\\/]/);
      // Owned folders are studio/<name> or a top-level cl_<name>.
      for (const depth of [2, 1]) {
        if (parts.length < depth) continue;
        const original = byResolution.get(parts.slice(0, depth).join("/").toLowerCase());
        if (original === undefined) continue;
        const separator = value.includes("\\") ? "\\" : "/";
        changed = true;
        return prefix + [original.split("/").join(separator), ...parts.slice(depth)].join(separator);
      }
      return line;
    });
    return changed ? { name: entry.name, data: Buffer.from(text, "utf8") } : entry;
  });
}

/** Drops Studio-owned sprites no config refers to, once every override and always-on config is in place. */
export function removeUnreferencedStudioSprites(entries: Entry[]): Entry[] {
  const references = new Set<string>();
  for (const entry of entries) {
    if (!CONFIG_TEXT_PATH_PATTERN.test(entry.name) && !entry.name.endsWith(`/${RETAINED_AOD_CONFIG}`)) continue;
    const resolution = entry.name.split("/", 1)[0].toLowerCase();
    for (const value of Object.values(parseCorosWatchfaceConfig(entry.data.toString("utf8")))) {
      const relative = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
      if (!relative || relative === COROS_CONFIG_DELETE_VALUE.toLowerCase()) continue;
      references.add(`${resolution}/${relative}`);
      // Always-on layouts can fall back from a/ to the main resolution's assets.
      if (relative.startsWith("a/")) references.add(`${resolution}/${relative.slice(2)}`);
    }
  }
  return entries.filter((entry) => {
    if (!OWNED_STUDIO_SPRITE_PATTERN.test(entry.name)) return true;
    let candidate = entry.name.toLowerCase();
    while (candidate.includes("/")) {
      if (references.has(candidate)) return true;
      candidate = candidate.slice(0, candidate.lastIndexOf("/"));
    }
    return false;
  });
}
