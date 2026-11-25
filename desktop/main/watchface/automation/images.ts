// crop_image, in the main process so it never holds up the screen: a region of a stored PNG (its own pixels), its
// transparent margins trimmed, then scaled to a size. Decoded and encoded with the compiler's PNG codec.
import { decodePng, encodePng, type RgbaImage } from "../../../watchface/compiler/png";
import type { AssetStore } from "./assets";
import { EditorError } from "./broker";

export const MAX_IMAGE_SIDE = 2048;
type Box = { x: number; y: number; width: number; height: number };

/** The box of pixels with alpha of 8 or more, or null when the image is empty. */
export function inkBounds(image: RgbaImage): Box | null {
  let x0 = image.width, y0 = image.height, x1 = -1, y1 = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] >= 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

export function cropPixels(image: RgbaImage, r: Box): RgbaImage {
  const data = new Uint8Array(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) {
    const from = ((r.y + y) * image.width + r.x) * 4;
    data.set(image.data.subarray(from, from + r.width * 4), y * r.width * 4);
  }
  return { width: r.width, height: r.height, data };
}

/** Scales with a box filter, weighting colour by alpha so transparent edges don't go dark. */
export function resizePixels(image: RgbaImage, width: number, height: number): RgbaImage {
  if (width === image.width && height === image.height) return image;
  const out = new Uint8Array(width * height * 4);
  const sx = image.width / width, sy = image.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ax = x * sx, bx = (x + 1) * sx, ay = y * sy, by = (y + 1) * sy;
    let r = 0, g = 0, b = 0, a = 0, w = 0;
    for (let yy = Math.floor(ay); yy < Math.min(image.height, Math.ceil(by)); yy++) {
      const wy = Math.min(by, yy + 1) - Math.max(ay, yy);
      for (let xx = Math.floor(ax); xx < Math.min(image.width, Math.ceil(bx)); xx++) {
        const wt = wy * (Math.min(bx, xx + 1) - Math.max(ax, xx)), i = (yy * image.width + xx) * 4, al = image.data[i + 3] / 255;
        r += image.data[i] * al * wt; g += image.data[i + 1] * al * wt; b += image.data[i + 2] * al * wt; a += al * wt; w += wt;
      }
    }
    const o = (y * width + x) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
    out[o + 3] = Math.round((a / w) * 255);
  }
  return { width, height, data: out };
}

const num = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new EditorError("INVALID_PARAMS", `${name} must be a number.`);
  return Math.round(v);
};
const side = (v: unknown, name: string) => {
  const n = num(v, name);
  if (n < 1 || n > MAX_IMAGE_SIDE) throw new EditorError("INVALID_PARAMS", `${name} must be 1 to ${MAX_IMAGE_SIDE} pixels.`);
  return n;
};

export interface CropAsk { crop?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }; trim?: boolean; width?: unknown; height?: unknown }

/** The pixels after crop → trim → scale. */
export function cropImage(source: RgbaImage, ask: CropAsk): { image: RgbaImage; region: Box } {
  let image = source;
  let region: Box = { x: 0, y: 0, width: source.width, height: source.height };
  if (ask.crop !== undefined) {
    const r = { x: num(ask.crop?.x, "crop.x"), y: num(ask.crop?.y, "crop.y"), width: side(ask.crop?.width, "crop.width"), height: side(ask.crop?.height, "crop.height") };
    if (r.x < 0 || r.y < 0 || r.x + r.width > source.width || r.y + r.height > source.height) throw new EditorError("INVALID_PARAMS", `The crop leaves the ${source.width}×${source.height} image.`);
    image = cropPixels(source, r);
    region = r;
  }
  if (ask.trim !== false) {
    const ink = inkBounds(image);
    if (!ink) throw new EditorError("EMPTY_IMAGE", "Nothing visible is left in that region.");
    image = cropPixels(image, ink);
    region = { x: region.x + ink.x, y: region.y + ink.y, width: ink.width, height: ink.height };
  }
  const w = ask.width === undefined ? undefined : side(ask.width, "width");
  const h = ask.height === undefined ? undefined : side(ask.height, "height");
  if (w || h) image = resizePixels(image, w ?? Math.max(1, Math.round((h! * image.width) / image.height)), h ?? Math.max(1, Math.round((w! * image.height) / image.width)));
  return { image, region };
}

/** crop_image on a stored PNG; the result is stored too. */
export async function cropAsset(assets: AssetStore, assetId: string, ask: CropAsk) {
  const stored = await assets.get(assetId);
  if (stored.mime !== "image/png") throw new EditorError("INVALID_PARAMS", "crop_image takes PNG images.");
  const source = decodePng(stored.bytes);
  if (source.width > 4096 || source.height > 4096) throw new EditorError("INVALID_PARAMS", "That image is too large to crop.");
  const { image, region } = cropImage(source, ask);
  const id = await assets.put(encodePng(image));
  return { assetId: id, width: image.width, height: image.height, sourceWidth: source.width, sourceHeight: source.height, region };
}
