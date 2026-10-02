import type { CorosWatchfaceRasterFont } from "../../electron/types";

type Ink = { source: HTMLCanvasElement; x: number; y: number; width: number; height: number };
const fontInkCache = new WeakMap<CorosWatchfaceRasterFont, Promise<Map<string, Ink>>>();

/** Alpha the AOD cleanup treats as a stroke's opaque core. */
const OPAQUE_CORE_ALPHA = 250;
/** Output coverage below this is never promoted back into the core. */
const RESTORABLE_ALPHA = 64;
/** Fits this close to 1:1 copy pixels instead of resampling them. */
const EXACT_FIT_TOLERANCE = 0.01;

/**
 * drawImage with smoothing, then restores full opacity to output pixels that
 * are mostly opaque core in the source. Smoothing pulls the centre of a thin
 * stroke below opaque, and the AOD cleanup keeps only opaque pixels as a
 * stroke's core, so a resized thin outline broke apart on the watch. The
 * share of core an output pixel needs shrinks with the downscale, because a
 * stroke that ends up narrower than a pixel must still come through as one
 * unbroken pixel-wide line. Unscaled draws at whole-pixel offsets are left
 * untouched.
 */
export function drawSpritePreservingCore(
  context: CanvasRenderingContext2D, source: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number
): void {
  context.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  if (sw === dw && sh === dh && Number.isInteger(dx) && Number.isInteger(dy)) return;
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return;
  const copy = document.createElement("canvas");
  copy.width = Math.ceil(sw); copy.height = Math.ceil(sh);
  const copyContext = copy.getContext("2d", { willReadFrequently: true });
  if (!copyContext) return;
  copyContext.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  const sourceAlpha = copyContext.getImageData(0, 0, copy.width, copy.height).data;
  const x0 = Math.max(0, Math.floor(dx)), y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(context.canvas.width, Math.ceil(dx + dw));
  const y1 = Math.min(context.canvas.height, Math.ceil(dy + dh));
  if (x1 <= x0 || y1 <= y0) return;
  const region = context.getImageData(x0, y0, x1 - x0, y1 - y0);
  const pixels = region.data;
  const scaleX = sw / dw, scaleY = sh / dh;
  const coreShare = Math.max(0.2, Math.min(0.5, 0.5 * Math.min(dw / sw, dh / sh)));
  let restored = false;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const index = ((y - y0) * region.width + (x - x0)) * 4 + 3;
    const alpha = pixels[index]!;
    if (alpha < RESTORABLE_ALPHA || alpha >= OPAQUE_CORE_ALPHA) continue;
    // Area-weight the source pixels under this output pixel's footprint.
    const bx0 = (x - dx) * scaleX, bx1 = (x + 1 - dx) * scaleX;
    const by0 = (y - dy) * scaleY, by1 = (y + 1 - dy) * scaleY;
    let core = 0, area = 0;
    for (let v = Math.floor(by0); v < by1; v++) {
      const wy = Math.min(by1, v + 1) - Math.max(by0, v);
      if (wy <= 0) continue;
      for (let u = Math.floor(bx0); u < bx1; u++) {
        const wx = Math.min(bx1, u + 1) - Math.max(bx0, u);
        if (wx <= 0) continue;
        area += wx * wy;
        if (u >= 0 && v >= 0 && u < copy.width && v < copy.height &&
          sourceAlpha[(v * copy.width + u) * 4 + 3]! >= OPAQUE_CORE_ALPHA) core += wx * wy;
      }
    }
    if (area <= 0 || core < area * coreShare) continue;
    pixels[index] = 255; restored = true;
  }
  if (restored) context.putImageData(region, x0, y0);
}

async function decode(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function measure(source: HTMLCanvasElement): Ink {
  const pixels = source.getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, source.width, source.height).data;
  let x0 = source.width, y0 = source.height, x1 = -1, y1 = -1;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    if (pixels[(y * source.width + x) * 4 + 3]! < 8) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { source, x: x1 < 0 ? 0 : x0, y: y1 < 0 ? 0 : y0,
    width: Math.max(0, x1 - x0 + 1), height: Math.max(0, y1 - y0 + 1) };
}

function fontInk(font: CorosWatchfaceRasterFont): Promise<Map<string, Ink>> {
  const cached = fontInkCache.get(font);
  if (cached) return cached;
  const pending = (async () => {
    const result = new Map<string, Ink>();
    const direct = { ...font.labels, ...font.sprites };
    await Promise.all(Object.entries(direct).map(async ([text, url]) => {
      const image = await decode(url);
      const source = document.createElement("canvas");
      source.width = image.naturalWidth; source.height = image.naturalHeight;
      source.getContext("2d")!.drawImage(image, 0, 0);
      result.set(text.toUpperCase(), measure(source));
    }));
    const glyphs = [...font.glyphs.toUpperCase().replace(/\s/g, "")];
    if (font.dataUrl && glyphs.some((glyph) => !result.has(glyph))) {
      const atlas = await decode(font.dataUrl);
      const columns = Math.max(1, Math.min(glyphs.length, Math.round(font.columns)));
      const rows = Math.ceil(glyphs.length / columns);
      glyphs.forEach((glyph, index) => {
        if (result.has(glyph)) return;
        const source = document.createElement("canvas");
        source.width = Math.max(1, Math.round(atlas.naturalWidth / columns));
        source.height = Math.max(1, Math.round(atlas.naturalHeight / rows));
        source.getContext("2d")!.drawImage(atlas,
          index % columns * atlas.naturalWidth / columns,
          Math.floor(index / columns) * atlas.naturalHeight / rows,
          atlas.naturalWidth / columns, atlas.naturalHeight / rows,
          0, 0, source.width, source.height);
        result.set(glyph, measure(source));
      });
    }
    return result;
  })();
  fontInkCache.set(font, pending);
  void pending.catch(() => fontInkCache.delete(font));
  return pending;
}

/** PNG ink and its advance cell are independent. All numerals use one cap
 * height and baseline, even when source images have different padding. */
export async function renderAlignedRasterGlyph(
  text: string, width: number | undefined, height: number,
  font: CorosWatchfaceRasterFont, color: string
): Promise<string | null> {
  const ink = await fontInk(font);
  const glyph = ink.get(text.toUpperCase());
  if (!glyph) return null;
  const canvas = document.createElement("canvas");
  const numeric = /^\d$/.test(text);
  const numerals = [...ink.entries()].filter(([key]) => /^\d$/.test(key)).map(([, value]) => value.source);
  if (!font.glyphLayout && numeric && numerals.length > 0 && numerals.every((source) =>
    source.height === height && (width === undefined || source.width <= width))) {
    // Numerals authored at the cell height (a recolored template folder, say)
    // are copied pixel for pixel, exactly like the template's own sprites.
    // The check covers the whole font so every digit takes the same path.
    canvas.width = width ?? glyph.source.width; canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.drawImage(glyph.source, Math.round((canvas.width - glyph.source.width) / 2), 0);
    if (font.tint) {
      context.globalCompositeOperation = "source-in";
      context.fillStyle = color; context.fillRect(0, 0, canvas.width, height);
    }
    return canvas.toDataURL("image/png");
  }
  const digits = [...ink.entries()].filter(([key, value]) => /^\d$/.test(key) && value.height > 0)
    .map(([, value]) => value);
  const reference = numeric && digits.length ? digits : [glyph];
  const aspect = Math.max(...reference.map((value) => value.width / (value.height || 1)), 0.01);
  const baseline = Math.round(height * (font.glyphLayout?.baseline ?? 0.97));
  const capHeight = Math.min(baseline, height * (font.glyphLayout?.height ?? 0.94),
    width === undefined ? Infinity : width * 0.98 / aspect);
  canvas.width = width ?? Math.max(1, Math.ceil(capHeight * aspect) + 2);
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  if (glyph.height > 0) {
    // Punctuation keeps its height relative to the font's digits and sits
    // inside their cap area. Labels and units share the lower baseline.
    const punctuation = /^[:.\-]$/.test(text) && digits.length > 0;
    const referenceHeight = punctuation ? Math.max(...digits.map((digit) => digit.height)) : glyph.height;
    const fitScale = capHeight / referenceHeight;
    // A fit within a percent of 1:1 is drawn unscaled on whole pixels; the
    // sub-pixel resample it replaces would only blur the ink.
    const exact = Math.abs(fitScale - 1) <= EXACT_FIT_TOLERANCE &&
      glyph.width <= canvas.width && glyph.height <= height;
    const scale = exact ? 1 : fitScale;
    const drawHeight = glyph.height * scale;
    const drawX = (canvas.width - glyph.width * scale) / 2;
    const drawY = text === ":" ? baseline - (capHeight + drawHeight) / 2 : baseline - drawHeight;
    context.imageSmoothingQuality = "high";
    drawSpritePreservingCore(context, glyph.source, glyph.x, glyph.y, glyph.width, glyph.height,
      exact ? Math.round(drawX) : drawX, exact ? Math.round(drawY) : drawY,
      glyph.width * scale, drawHeight);
    if (font.tint) {
      context.globalCompositeOperation = "source-in";
      context.fillStyle = color; context.fillRect(0, 0, canvas.width, height);
    }
  }
  return canvas.toDataURL("image/png");
}

/** Firmware advances rect-based numbers by PNG width. Tracking changes that
 * width using transparent bearings, never by resizing the painted glyph. */
export async function spaceWatchfaceGlyph(dataUrl: string, tracking = 0): Promise<string> {
  if (Math.abs(tracking) < 0.001) return dataUrl;
  const image = await decode(dataUrl);
  const source = document.createElement("canvas");
  source.width = image.naturalWidth; source.height = image.naturalHeight;
  source.getContext("2d")!.drawImage(image, 0, 0);
  const ink = measure(source);
  const requested = image.naturalWidth + Math.round(image.naturalHeight * Math.max(-0.35, Math.min(0.25, tracking)));
  const canvas = document.createElement("canvas");
  // Negative tracking can consume transparent bearings, but cannot cut ink.
  canvas.width = Math.max(1, ink.width, requested);
  canvas.height = image.naturalHeight;
  const offset = Math.min(-ink.x + canvas.width - ink.width,
    Math.max(-ink.x, Math.floor((canvas.width - image.naturalWidth) / 2)));
  canvas.getContext("2d")!.drawImage(image, offset, 0);
  return canvas.toDataURL("image/png");
}

export function visibleGlyphBounds(canvas: HTMLCanvasElement): { top: number; bottom: number } | null {
  const ink = measure(canvas);
  return ink.height ? { top: ink.y, bottom: ink.y + ink.height } : null;
}

export function glyphBaselineMovements(items: Array<{ id: string; top: number; bottom: number; colon?: boolean }>): Record<string, { dx: number; dy: number }> {
  const reference = items.filter((item) => !item.colon).sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top))[0];
  if (!reference) return {};
  return Object.fromEntries(items.map((item) => [item.id, { dx: 0, dy: item.colon
    ? (reference.top + reference.bottom - item.top - item.bottom) / 2
    : reference.bottom - item.bottom }]));
}
