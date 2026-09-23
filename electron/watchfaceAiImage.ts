import { nativeImage } from "electron";
import { validVisualRegion } from "./watchfaceAiVisual";

export interface WatchfaceAiImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatchfaceAiImageOps {
  /** Region of the source in its own pixels, applied first. */
  crop?: WatchfaceAiImageRect;
  /** Drops fully transparent margins after cropping. */
  trim?: boolean;
  /** Final pixel size; with only one side given the aspect ratio is kept. */
  width?: number;
  height?: number;
  /** Labels a font crop for stricter checks and comparison with its siblings. */
  glyph?: { character: string; setId: string };
}

export interface WatchfaceCropQuality {
  glyph?: { character: string; setId: string };
  requestedRegion: WatchfaceAiImageRect;
  inkBounds: WatchfaceAiImageRect | null;
  padding: { left: number; top: number; right: number; bottom: number } | null;
  width: number;
  height: number;
  cutInkEdges: string[];
  errors: string[];
  warnings: string[];
}

export interface WatchfaceAiImageResult {
  base64Png: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  /** The part of the source that was kept, before resizing. */
  region: WatchfaceAiImageRect;
  cropQuality?: WatchfaceCropQuality;
}

export const MAX_WATCHFACE_AI_IMAGE_SIDE = 2048;
// Matches the Studio sprite fitter: near-invisible fringe pixels don't count.
const ALPHA_THRESHOLD = 8;

/**
 * Bounding box of the visible pixels in a 4-byte-per-pixel bitmap with alpha
 * last (Electron's BGRA or RGBA), or null when every pixel is transparent.
 */
export function opaqueBounds(
  bitmap: Uint8Array,
  width: number,
  height: number,
  threshold = ALPHA_THRESHOLD
): WatchfaceAiImageRect | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (bitmap[row + x * 4 + 3]! < threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  return right < 0
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Clips a requested crop to the image, rejecting one that misses it. */
export function clampCropRect(
  crop: WatchfaceAiImageRect,
  width: number,
  height: number
): WatchfaceAiImageRect {
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("crop needs numeric x, y, width and height.");
  }
  const x0 = Math.max(0, Math.round(crop.x));
  const y0 = Math.max(0, Math.round(crop.y));
  const x1 = Math.min(width, Math.round(crop.x + crop.width));
  const y1 = Math.min(height, Math.round(crop.y + crop.height));
  if (x1 <= x0 || y1 <= y0) {
    throw new Error(`crop lies outside the ${width}x${height} image.`);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function outputSide(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 1 || value > MAX_WATCHFACE_AI_IMAGE_SIDE) {
    throw new Error(`${name} must be between 1 and ${MAX_WATCHFACE_AI_IMAGE_SIDE} pixels.`);
  }
  return Math.round(value);
}

/** Checks the original cut, before trimming can conceal a severed stroke. */
export function cropInkEdges(bitmap: Uint8Array, width: number, height: number, crop: WatchfaceAiImageRect): string[] {
  const ink = (x: number, y: number) => bitmap[(y * width + x) * 4 + 3]! >= ALPHA_THRESHOLD;
  const edges = new Set<string>();
  const right = crop.x + crop.width - 1, bottom = crop.y + crop.height - 1;
  for (let y = crop.y; y <= bottom; y++) {
    if (crop.x > 0 && ink(crop.x, y) && ink(crop.x - 1, y)) edges.add("left");
    if (right < width - 1 && ink(right, y) && ink(right + 1, y)) edges.add("right");
  }
  for (let x = crop.x; x <= right; x++) {
    if (crop.y > 0 && ink(x, crop.y) && ink(x, crop.y - 1)) edges.add("top");
    if (bottom < height - 1 && ink(x, bottom) && ink(x, bottom + 1)) edges.add("bottom");
  }
  return [...edges];
}

export function describeCropQuality(input: {
  crop: WatchfaceAiImageRect; region: WatchfaceAiImageRect; width: number; height: number;
  inkBounds: WatchfaceAiImageRect | null; cutInkEdges: string[]; clamped: boolean;
  glyph?: WatchfaceAiImageOps["glyph"];
}): WatchfaceCropQuality {
  const { crop, region, width, height, inkBounds, cutInkEdges, glyph } = input;
  const errors: string[] = [], warnings: string[] = [];
  if (!inkBounds && (!glyph || glyph.character.trim())) errors.push("The crop is blank; no visible glyph/artwork remains.");
  if (input.clamped) (glyph ? errors : warnings).push("The requested crop extends outside the source image; choose a fully contained cell.");
  if (cutInkEdges.length) (glyph ? errors : warnings).push(`The original cut crosses visible pixels on ${cutInkEdges.join(", ")}; enlarge/reposition the cell to avoid clipping a stroke.`);
  const stretch = (width / height) / (region.width / region.height);
  if (Math.abs(stretch - 1) > 0.05) warnings.push("Resizing changes the aspect ratio by more than 5%; compare glyph proportions with the reference.");
  if (width > region.width || height > region.height) warnings.push("This crop was upscaled; larger output dimensions do not add source detail.");
  const padding = inkBounds ? { left: inkBounds.x, top: inkBounds.y, right: width - inkBounds.x - inkBounds.width, bottom: height - inkBounds.y - inkBounds.height } : null;
  if (glyph && padding && (padding.top === 0 || padding.bottom === 0)) warnings.push("Glyph ink touches the output's top/bottom. Check clipping and use common cell height/baseline across this font set; individual trimming can remove alignment margins.");
  return { ...(glyph ? { glyph } : {}), requestedRegion: crop, inkBounds, padding, width, height, cutInkEdges, errors, warnings };
}

/** Applies crop, then trim, then resize, and returns a PNG. */
export function transformWatchfaceAiImage(
  dataUrl: string,
  ops: WatchfaceAiImageOps
): WatchfaceAiImageResult {
  let image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("The image could not be read.");
  const source = image.getSize();
  if (ops.glyph !== undefined && (!ops.glyph || typeof ops.glyph.character !== "string" || [...ops.glyph.character].length !== 1 || typeof ops.glyph.setId !== "string" || !ops.glyph.setId.trim() || ops.glyph.setId.length > 80)) throw new Error("glyph needs one character and a nonempty setId (up to 80 characters).");
  let region: WatchfaceAiImageRect = { x: 0, y: 0, width: source.width, height: source.height };
  const requestedRegion = ops.crop ? clampCropRect(ops.crop, source.width, source.height) : { ...region };
  const cutInkEdges = ops.crop ? cropInkEdges(image.toBitmap(), source.width, source.height, requestedRegion) : [];
  const clamped = Boolean(ops.crop && (ops.crop.x < 0 || ops.crop.y < 0 || ops.crop.x + ops.crop.width > source.width || ops.crop.y + ops.crop.height > source.height));
  if (ops.crop) {
    region = clampCropRect(ops.crop, source.width, source.height);
    image = image.crop(region);
  }
  if (ops.trim) {
    const size = image.getSize();
    const visible = opaqueBounds(image.toBitmap(), size.width, size.height);
    if (visible && (visible.width < size.width || visible.height < size.height)) {
      image = image.crop(visible);
      region = {
        x: region.x + visible.x,
        y: region.y + visible.y,
        width: visible.width,
        height: visible.height
      };
    }
  }
  const width = outputSide(ops.width, "width");
  const height = outputSide(ops.height, "height");
  if (width !== undefined || height !== undefined) {
    image = image.resize({
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      quality: "best"
    });
  }
  const output = image.getSize();
  const cropQuality = ops.crop || ops.glyph ? describeCropQuality({
    crop: requestedRegion, region, width: output.width, height: output.height,
    inkBounds: opaqueBounds(image.toBitmap(), output.width, output.height), cutInkEdges, clamped, glyph: ops.glyph
  }) : undefined;
  return {
    base64Png: image.toPNG().toString("base64"),
    width: output.width,
    height: output.height,
    sourceWidth: source.width,
    sourceHeight: source.height,
    region,
    ...(cropQuality ? { cropQuality } : {})
  };
}

/** Comparison boards retain aspect ratios and common scale; never stretch a font to match. */
export function compareWatchfaceRegions(input: {
  previews: string[];
  region: import("./watchfaceAiVisual").VisualRegion;
  reference?: { dataUrl: string; region: import("./watchfaceAiVisual").VisualRegion };
  dynamic: boolean;
  ring: boolean;
}): { imageDataUrl: string; width: number; height: number; changedFractions: number[] } {
  if (!validVisualRegion(input.region) || input.reference && !validVisualRegion(input.reference.region)) throw new Error("Comparison regions must lie within the full face.");
  const read = (url: string) => {
    const image = nativeImage.createFromDataURL(url);
    const size = image.getSize();
    if (image.isEmpty() || size.width > 2048 || size.height > 2048) throw new Error("Comparison needs readable images up to 2048 pixels per side.");
    return image;
  };
  const previews = input.previews.map(read);
  if (!previews.length || previews.length > 8) throw new Error("Compare 1–8 previews.");
  const { width, height } = previews[0]!.getSize();
  if (previews.some(image => image.getSize().width !== width || image.getSize().height !== height)) throw new Error("State comparisons must use the same resolution and size.");
  const crop = (image: Electron.NativeImage, region: import("./watchfaceAiVisual").VisualRegion) => {
    const size = image.getSize();
    return image.crop(clampCropRect({ x: region.x * size.width, y: region.y * size.height, width: region.width * size.width, height: region.height * size.height }, size.width, size.height));
  };
  const cuts = previews.map(image => crop(image, input.region));
  const size = cuts[0]!.getSize();
  if (size.width < 8 || size.height < 8) throw new Error("The target is too small for a meaningful pixel comparison.");
  const changedFractions: number[] = [];
  if (input.dynamic) {
    if (cuts.length < 2) throw new Error("A live target needs distinct state previews.");
    // Compare every pair so identical middle/high artwork cannot pass via low/high only.
    for (let a = 0; a < cuts.length; a++) for (let b = a + 1; b < cuts.length; b++) {
      const left = cuts[a]!.toBitmap(), right = cuts[b]!.toBitmap();
      let sampled = 0, changed = 0;
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const radius = Math.hypot((x + .5 - size.width / 2) / (size.width / 2), (y + .5 - size.height / 2) / (size.height / 2));
        if (input.ring && (radius < .65 || radius > 1)) continue;
        sampled++;
        const i = (y * size.width + x) * 4;
        // Compare premultiplied visible channels, ignoring transparent RGB noise.
        if ([0, 1, 2].some(c => Math.abs(left[i + c]! * left[i + 3]! / 255 - right[i + c]! * right[i + 3]! / 255) >= 24)) changed++;
      }
      changedFractions.push(sampled ? changed / sampled : 0);
    }
    if (changedFractions.some(fraction => fraction < .02)) throw new Error(input.ring
      ? "The requested ring does not visibly change between every sampled state. Changes to center digits or a small battery icon do not count. Replace the baked ring and fit the complete dynamic ring set."
      : "The requested component does not visibly change between every sampled state. Inspect its binding, visibility and state artwork.");
  }
  const sources = input.reference ? [crop(read(input.reference.dataUrl), input.reference.region), ...cuts] : cuts;
  // Scale each full canvas to the preview scale before cutting; this preserves
  // the relative size of a reference glyph versus the implemented glyph.
  const scaled = sources.map((source, index) => {
    if (!input.reference || index > 0) return source;
    const referenceSize = read(input.reference.dataUrl).getSize();
    return source.resize({ width: Math.max(1, Math.round(source.getSize().width * width / referenceSize.width)), quality: "best" });
  });
  const gap = 12;
  const boardWidth = scaled.reduce((sum, image) => sum + image.getSize().width + gap, -gap);
  const boardHeight = Math.max(...scaled.map(image => image.getSize().height));
  if (boardWidth * boardHeight > 12_000_000) throw new Error("Comparison board is too large. Compare smaller target regions.");
  const board = Buffer.alloc(boardWidth * boardHeight * 4);
  for (let i = 3; i < board.length; i += 4) board[i] = 255;
  let offset = 0;
  for (const source of scaled) {
    const dimensions = source.getSize(), pixels = source.toBitmap();
    for (let y = 0; y < dimensions.height; y++) pixels.copy(board, (y * boardWidth + offset) * 4, y * dimensions.width * 4, (y + 1) * dimensions.width * 4);
    offset += dimensions.width + gap;
  }
  return { imageDataUrl: nativeImage.createFromBitmap(board, { width: boardWidth, height: boardHeight }).toDataURL(), width, height, changedFractions };
}
