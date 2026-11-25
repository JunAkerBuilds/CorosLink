import { createHash } from "node:crypto";
import { encodeIndexedPng, recompressPngLossless } from "../pngRecompress";
import { WATCHFACE_TARGETS } from "../watchfaceTargets";
import { slot, toLut256, toQuantLut256 } from "./bitmap";
import { configPath, parseConfig } from "./config";
import { decodePng, type RgbaImage } from "./png";

/** Exported faces larger than this are made smaller… */
export const ARCHIVE_FIT_TRIGGER_BYTES = 10 * 1024 * 1024;
/** …aiming for as close under this as they can get. */
export const ARCHIVE_FIT_TARGET_BYTES = 8 * 1024 * 1024;

export interface ArchiveFitEntry { name: string; data: Uint8Array }
export interface ArchiveFitStats {
  /** PNGs re-encoded with every pixel unchanged. */
  losslessImages: number;
  /** PNGs brought to a palette, or to the watch's own colour levels, to reach the target. */
  reducedImages: number;
}
export interface ArchiveFitResult { entries: ArchiveFitEntry[]; stats: ArchiveFitStats }

/**
 * How an image is reduced, least visible on the watch first:
 *
 * 0. at most 256 colours: an exact palette, pixel for pixel the same;
 * 1. images the watch never draws: the 800 px master when the face has its watch's own layout,
 *    and each layout's `watchface_customize.png` (the face's preview is the root one);
 * 2. memory-in-pixel sprites: snapped to the four levels the compiler rounds every channel to,
 *    so the compiled face is identical;
 * 3. everything else: 256 colours with the compiler's own quantizer, which AMOLED compiles apply
 *    to every image past 256 colours anyway, so the compiled face is identical too (not with the
 *    experimental full-colour option);
 * 4. the picker thumbnail's sources (`m_preview`, `watchface_thmb_icon`): the compiler scales them
 *    down to the thumbnail, which then differs slightly, and `m_preview` is the COROS app's preview;
 * 5. memory-in-pixel backgrounds, whose photo treatment wants the original colours.
 */
const Tier = { Exact: 0, Unused: 1, MipSprite: 2, Quantize: 3, Thumbnail: 4, MipBackground: 5 } as const;
type Tier = (typeof Tier)[keyof typeof Tier];

const TREE = /^watchface_(\d{3,4})x\1\//;
const MIP_SCREENS: ReadonlySet<number> = new Set(WATCHFACE_TARGETS.filter(target => target.display === "mip").map(target => target.previewSize));
const MASTER_SIZE = 800;

interface Group {
  names: string[];
  original: Buffer;
  lossless: Buffer;
  current: Buffer;
  tier: Tier;
}

/** Bytes `createStoreZip` adds around the file data: local and central headers plus the end record. */
function storeZipOverhead(entries: readonly ArchiveFitEntry[]): number {
  return entries.reduce((sum, entry) => sum + 76 + 2 * Buffer.byteLength(entry.name, "utf8"), 22);
}

interface FaceImages {
  /** Each layout's `background_icon`, which memory-in-pixel compiles treat as a photo. */
  backgrounds: Set<string>;
  /** What the compiler scales into the picker thumbnail: info.json's `m_preview`, else each layout's `watchface_thmb_icon`. */
  thumbnails: Set<string>;
  /** The face has a layout of its own beside the 800 px master. */
  hasNativeLayout: boolean;
}

function faceImages(files: ReadonlyMap<string, Uint8Array>): FaceImages {
  const text = (name: string) => Buffer.from(files.get(name) ?? []).toString("latin1");
  const backgrounds = new Set<string>(), thumbnails = new Set<string>();
  let preview: unknown = "watchface_customize.png";
  try { preview = (JSON.parse(text("info.json") || "{}") as Record<string, unknown>).m_preview ?? preview; } catch { /* the default preview */ }
  if (typeof preview === "string" && preview) thumbnails.add(configPath(preview));
  let hasNativeLayout = false;
  for (const name of files.keys()) {
    const match = name.match(/^(watchface_(\d{3,4})x\2)\/(config|AODconfig)\.txt$/);
    if (!match) continue;
    if (Number(match[2]) !== MASTER_SIZE) hasNativeLayout = true;
    const config = parseConfig(text(name));
    const background = config.get("background_icon"), thumbnail = config.get("watchface_thmb_icon");
    if (background) backgrounds.add(`${match[1]}/${configPath(background)}`);
    if (thumbnail) thumbnails.add(`${match[1]}/${configPath(thumbnail)}`);
  }
  return { backgrounds, thumbnails, hasNativeLayout };
}

function tierOf(name: string, exact: boolean, face: FaceImages): Tier {
  if (exact) return Tier.Exact;
  const size = Number(name.match(TREE)?.[1]);
  const watchDrawn = !(size === MASTER_SIZE && face.hasNativeLayout);
  if (face.thumbnails.has(name) && watchDrawn) return Tier.Thumbnail;
  if (!watchDrawn || (size && /\/watchface_customize\.png$/i.test(name))) return Tier.Unused;
  if (MIP_SCREENS.has(size)) return face.backgrounds.has(name) ? Tier.MipBackground : Tier.MipSprite;
  return Tier.Quantize;
}

/** The compiler's channel levels (0–42, 43–127, 128–212, 213–255) and alpha steps (`alpha >> 6`, below 64 transparent). */
function snapToMipLevels(image: RgbaImage): RgbaImage {
  const data = new Uint8Array(image.data.length);
  const level = (value: number) => value < 43 ? 0 : value < 128 ? 85 : value < 213 ? 170 : 255;
  for (let at = 0; at < data.length; at += 4) {
    const alpha = image.data[at + 3]!;
    if (alpha < 64) continue;
    data[at] = level(image.data[at]!);
    data[at + 1] = level(image.data[at + 1]!);
    data[at + 2] = level(image.data[at + 2]!);
    data[at + 3] = alpha < 128 ? 85 : alpha < 192 ? 170 : 255;
  }
  return { width: image.width, height: image.height, data };
}

/** A transposed LUT (`toLut256`/`toQuantLut256`) as a palette PNG holding only the entries it uses. */
async function lutToPng(image: RgbaImage, lut: Uint8Array, source: Buffer): Promise<Buffer> {
  const pixels = image.width * image.height;
  const remap = new Int16Array(256).fill(-1);
  const indices = new Uint8Array(pixels);
  const palette: number[] = [];
  for (let pixel = 0; pixel < pixels; pixel++) {
    const entry = lut[pixel]!;
    if (remap[entry]! < 0) {
      remap[entry] = palette.length / 4;
      const at = pixels + slot(entry) * 4;
      palette.push(lut[at]!, lut[at + 1]!, lut[at + 2]!, lut[at + 3]!);
    }
    indices[pixel] = remap[entry]!;
  }
  return encodeIndexedPng(image.width, image.height, indices, Uint8Array.from(palette), source);
}

async function reduce(group: Group): Promise<Buffer | undefined> {
  let image: RgbaImage;
  try { image = decodePng(group.original); } catch { return undefined; }
  if (group.tier === Tier.Exact) {
    const lut = toLut256(image);
    return lut ? lutToPng(image, lut, group.original) : undefined;
  }
  if (group.tier === Tier.MipSprite) {
    const snapped = snapToMipLevels(image);
    return lutToPng(snapped, toLut256(snapped)!, group.original);
  }
  return lutToPng(image, toQuantLut256(image), group.original);
}

/** 8-bit source with at most 256 colours: a palette holds it exactly. */
function fitsExactPalette(png: Buffer): boolean {
  if (png.length < 33 || png[24]! > 8) return false;
  try { return toLut256(decodePng(png)) !== null; } catch { return false; }
}

/**
 * Brings a final face archive toward `targetBytes` (as `createStoreZip` would write it). Every PNG
 * is first re-encoded losslessly; if that is not enough, images are reduced one at a time in tier
 * order, largest first, until the archive fits. Reductions it turned out not to need are then
 * undone, so the face lands as close under the target as one image allows, with as few images
 * changed as possible. Identical PNGs (a digit set repeated per time field) change together.
 * When even every reduction cannot reach the target, the archive is as small as it gets.
 */
export async function fitArchiveEntries(entries: readonly ArchiveFitEntry[], targetBytes = ARCHIVE_FIT_TARGET_BYTES): Promise<ArchiveFitResult> {
  const files = new Map(entries.map(entry => [entry.name, entry.data]));
  const groups = new Map<string, Group>();
  let fixedBytes = storeZipOverhead(entries);
  for (const entry of entries) {
    if (!/\.png$/i.test(entry.name)) { fixedBytes += entry.data.length; continue; }
    const data = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const key = createHash("sha256").update(data).digest("hex");
    const group = groups.get(key);
    if (group) group.names.push(entry.name);
    else groups.set(key, { names: [entry.name], original: data, lossless: data, current: data, tier: Tier.Quantize });
  }
  const list = [...groups.values()];
  // Four at a time keeps the zlib thread pool busy without holding every decoded image at once.
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < list.length) {
      const group = list[next++]!;
      group.lossless = group.current = await recompressPngLossless(group.original);
    }
  }));
  const size = () => list.reduce((sum, group) => sum + group.current.length * group.names.length, fixedBytes);
  let total = size();
  const stats: ArchiveFitStats = {
    losslessImages: list.reduce((sum, group) => sum + (group.lossless !== group.original ? group.names.length : 0), 0),
    reducedImages: 0
  };

  if (total > targetBytes) {
    const face = faceImages(files);
    for (const group of list) {
      const exact = fitsExactPalette(group.original);
      group.tier = Math.max(...group.names.map(name => tierOf(name, exact, face))) as Tier;
    }
    const order = [...list].sort((a, b) => a.tier - b.tier || b.lossless.length * b.names.length - a.lossless.length * a.names.length);
    const reduced: Group[] = [];
    for (const group of order) {
      if (total <= targetBytes) break;
      const smaller = await reduce(group);
      if (!smaller || smaller.length >= group.current.length) continue;
      total -= (group.current.length - smaller.length) * group.names.length;
      group.current = smaller;
      reduced.push(group);
    }
    // Undo the reductions that were not needed, most visible first.
    for (const group of reduced.reverse()) {
      const growth = (group.lossless.length - group.current.length) * group.names.length;
      if (total + growth > targetBytes) continue;
      total += growth;
      group.current = group.lossless;
    }
    stats.reducedImages = list.reduce((sum, group) => sum + (group.current !== group.lossless ? group.names.length : 0), 0);
  }

  const byName = new Map(list.flatMap(group => group.names.map(name => [name, group.current] as const)));
  return {
    entries: entries.map(entry => ({ name: entry.name, data: byName.get(entry.name) ?? entry.data })),
    stats
  };
}
