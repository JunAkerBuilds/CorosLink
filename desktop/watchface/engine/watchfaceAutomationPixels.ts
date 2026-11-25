/**
 * Pixel analysis behind Watchmaker's color and contrast tools. Everything here
 * works on plain RGBA arrays (canvas ImageData layout, straight alpha) so it
 * stays testable outside the browser.
 */

export interface WatchfacePixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatchfaceRgb {
  r: number;
  g: number;
  b: number;
}

export function parseWatchfaceHexColor(value: string): WatchfaceRgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = Number.parseInt(match[1]!, 16);
  return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
}

export function watchfaceRgbToHex({ r, g, b }: WatchfaceRgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** WCAG 2.x relative luminance of an sRGB color. */
export function relativeLuminance({ r, g, b }: WatchfaceRgb): number {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatioOfLuminance(a: number, b: number): number {
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

export function contrastRatio(a: WatchfaceRgb, b: WatchfaceRgb): number {
  return contrastRatioOfLuminance(relativeLuminance(a), relativeLuminance(b));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function clampBox(box: WatchfacePixelBox, width: number, height: number) {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.width));
  const y1 = Math.min(height, Math.ceil(box.y + box.height));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

// Probe renders give each pixel's layer coverage; half-covered or more counts
// as glyph. Antialiased edges below that are part background.
const GLYPH_COVERAGE = 0.5;
// Without a white probe (always-on renders on black) fall back to the pixels
// that visibly change when the layer is hidden.
const GLYPH_DIFF_THRESHOLD = 32;
const GLYPH_CORE_FRACTION = 0.6;
const WORST_BACKGROUND_PERCENTILE = 0.1;
// A glyph's ink is the part that stands out: at least this fraction of the
// contrast its strongest pixels (95th percentile) have. Dark fills inside
// outlined digits and drop shadows aren't ink.
const INK_FRACTION = 0.5;
const INK_PERCENTILE = 0.95;

export interface WatchfaceLayerContrast {
  /** Pixels of ink measured, and their share of everything the layer draws. */
  glyphPixels: number;
  inkShare: number;
  glyphColor: string;
  backgroundColor: string;
  /** Text color against the average background behind it. */
  ratio: number;
  /** Text against background, pixel by pixel, at the least favorable tenth. */
  worstRatio: number;
}

export interface WatchfaceContrastRenders {
  width: number;
  height: number;
  /** The face as rendered, without the layer: what sits behind the text. */
  behind: ArrayLike<number>;
  /** The layer drawn over solid black, and the same frame without it. */
  onBlack: { withLayer: ArrayLike<number>; withoutLayer: ArrayLike<number> };
  /** The same over solid white; omit when the mode can't render it (AOD). */
  onWhite?: { withLayer: ArrayLike<number>; withoutLayer: ArrayLike<number> };
}

interface GlyphPixel {
  index: number;
  color: WatchfaceRgb;
  weight: number;
}

/**
 * Over black a layer pixel reads glyph x coverage; over white it reads
 * glyph x coverage + 255 x (1 - coverage). Together they recover both, so
 * text is found even where it matches the real background exactly.
 */
function probeGlyphPixels(renders: WatchfaceContrastRenders, box: { x0: number; y0: number; x1: number; y1: number }): GlyphPixel[] {
  const black = renders.onBlack;
  const white = renders.onWhite!;
  const pixels: GlyphPixel[] = [];
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const index = (y * renders.width + x) * 4;
      let coverage = 0;
      const premultiplied = [0, 0, 0];
      for (let channel = 0; channel < 3; channel += 1) {
        const overBlack = black.withLayer[index + channel]! - black.withoutLayer[index + channel]!;
        const overWhite = white.withoutLayer[index + channel]! - white.withLayer[index + channel]!;
        premultiplied[channel] = Math.max(0, overBlack);
        coverage += (Math.max(0, overBlack) + Math.max(0, overWhite)) / 255;
      }
      coverage /= 3;
      if (coverage < GLYPH_COVERAGE) continue;
      const unpremultiply = (value: number) => Math.min(255, value / Math.min(1, coverage));
      pixels.push({
        index,
        color: { r: unpremultiply(premultiplied[0]!), g: unpremultiply(premultiplied[1]!), b: unpremultiply(premultiplied[2]!) },
        weight: Math.min(1, coverage)
      });
    }
  }
  return pixels;
}

function diffGlyphPixels(renders: WatchfaceContrastRenders, box: { x0: number; y0: number; x1: number; y1: number }): GlyphPixel[] {
  const { withLayer, withoutLayer } = renders.onBlack;
  const changed: Array<{ index: number; diff: number }> = [];
  let maxDiff = 0;
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const index = (y * renders.width + x) * 4;
      const diff = Math.max(
        Math.abs(withLayer[index]! - withoutLayer[index]!),
        Math.abs(withLayer[index + 1]! - withoutLayer[index + 1]!),
        Math.abs(withLayer[index + 2]! - withoutLayer[index + 2]!)
      );
      if (diff < GLYPH_DIFF_THRESHOLD) continue;
      changed.push({ index, diff });
      if (diff > maxDiff) maxDiff = diff;
    }
  }
  return changed
    .filter((pixel) => pixel.diff >= maxDiff * GLYPH_CORE_FRACTION)
    .map(({ index }) => ({
      index,
      color: { r: withLayer[index]!, g: withLayer[index + 1]!, b: withLayer[index + 2]! },
      weight: 1
    }));
}

/**
 * Measures a text layer against what is actually behind it, pixel by pixel,
 * from renders of the same frame with and without the layer.
 */
export function analyzeLayerContrast(
  renders: WatchfaceContrastRenders,
  box: WatchfacePixelBox
): WatchfaceLayerContrast | null {
  const clamped = clampBox(box, renders.width, renders.height);
  if (!clamped) return null;
  const drawn = renders.onWhite ? probeGlyphPixels(renders, clamped) : diffGlyphPixels(renders, clamped);
  if (drawn.length < 4) return null;
  const behindOf = (index: number) => ({
    r: renders.behind[index]!,
    g: renders.behind[index + 1]!,
    b: renders.behind[index + 2]!
  });
  const overall = drawn.reduce(
    (sum, pixel) => {
      const behind = behindOf(pixel.index);
      return { r: sum.r + behind.r, g: sum.g + behind.g, b: sum.b + behind.b };
    },
    { r: 0, g: 0, b: 0 }
  );
  const overallBackground = { r: overall.r / drawn.length, g: overall.g / drawn.length, b: overall.b / drawn.length };
  // Judge each pixel's own color against the backdrop as a whole, so ink that
  // vanishes over one bright patch still counts as ink and gets measured.
  const standOut = drawn.map((pixel) => contrastRatio(pixel.color, overallBackground));
  const strongest = [...standOut].sort((left, right) => left - right)[
    Math.floor((standOut.length - 1) * INK_PERCENTILE)
  ]!;
  const glyphs = drawn.filter((_, index) => standOut[index]! >= Math.max(1, strongest * INK_FRACTION));
  const glyphSum = { r: 0, g: 0, b: 0, weight: 0 };
  const backgroundSum = { r: 0, g: 0, b: 0 };
  const perPixel: number[] = [];
  for (const glyph of glyphs) {
    glyphSum.r += glyph.color.r * glyph.weight;
    glyphSum.g += glyph.color.g * glyph.weight;
    glyphSum.b += glyph.color.b * glyph.weight;
    glyphSum.weight += glyph.weight;
    const behind = behindOf(glyph.index);
    backgroundSum.r += behind.r;
    backgroundSum.g += behind.g;
    backgroundSum.b += behind.b;
    perPixel.push(contrastRatio(glyph.color, behind));
  }
  const glyph = { r: glyphSum.r / glyphSum.weight, g: glyphSum.g / glyphSum.weight, b: glyphSum.b / glyphSum.weight };
  const background = {
    r: backgroundSum.r / glyphs.length,
    g: backgroundSum.g / glyphs.length,
    b: backgroundSum.b / glyphs.length
  };
  perPixel.sort((left, right) => left - right);
  return {
    glyphPixels: glyphs.length,
    inkShare: round2(glyphs.length / drawn.length),
    glyphColor: watchfaceRgbToHex(glyph),
    backgroundColor: watchfaceRgbToHex(background),
    ratio: round2(contrastRatio(glyph, background)),
    worstRatio: round2(perPixel[Math.floor((perPixel.length - 1) * WORST_BACKGROUND_PERCENTILE)]!)
  };
}

export interface WatchfaceColorShare {
  color: string;
  share: number;
}

export interface WatchfaceRegionSample {
  x: number;
  y: number;
  width: number;
  height: number;
  average: string | null;
  /** Fraction of the region's pixels that are visible at all. */
  coverage: number;
  palette: WatchfaceColorShare[];
}

const PALETTE_BITS = 4;

/**
 * Average color and dominant colors of a region, weighting each pixel by its
 * alpha so transparent padding doesn't pull the result toward black.
 */
export function sampleRegion(
  data: ArrayLike<number>,
  width: number,
  height: number,
  box: WatchfacePixelBox,
  paletteSize: number
): WatchfaceRegionSample {
  const clamped = clampBox(box, width, height);
  const region = clamped
    ? { x: clamped.x0, y: clamped.y0, width: clamped.x1 - clamped.x0, height: clamped.y1 - clamped.y0 }
    : { x: 0, y: 0, width: 0, height: 0 };
  if (!clamped) return { ...region, average: null, coverage: 0, palette: [] };
  const buckets = new Map<number, { r: number; g: number; b: number; weight: number }>();
  const sum = { r: 0, g: 0, b: 0, weight: 0 };
  let visible = 0;
  const shift = 8 - PALETTE_BITS;
  for (let y = clamped.y0; y < clamped.y1; y += 1) {
    for (let x = clamped.x0; x < clamped.x1; x += 1) {
      const index = (y * width + x) * 4;
      const weight = data[index + 3]! / 255;
      if (weight <= 0) continue;
      visible += 1;
      const r = data[index]!;
      const g = data[index + 1]!;
      const b = data[index + 2]!;
      sum.r += r * weight;
      sum.g += g * weight;
      sum.b += b * weight;
      sum.weight += weight;
      const key = ((r >> shift) << (2 * PALETTE_BITS)) | ((g >> shift) << PALETTE_BITS) | (b >> shift);
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
      bucket.r += r * weight;
      bucket.g += g * weight;
      bucket.b += b * weight;
      bucket.weight += weight;
      buckets.set(key, bucket);
    }
  }
  const total = region.width * region.height;
  const palette = [...buckets.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, Math.max(0, paletteSize))
    .map((bucket) => ({
      color: watchfaceRgbToHex({ r: bucket.r / bucket.weight, g: bucket.g / bucket.weight, b: bucket.b / bucket.weight }),
      share: round2(bucket.weight / sum.weight)
    }));
  return {
    ...region,
    average: sum.weight > 0
      ? watchfaceRgbToHex({ r: sum.r / sum.weight, g: sum.g / sum.weight, b: sum.b / sum.weight })
      : null,
    coverage: round2(visible / total),
    palette
  };
}

export function samplePoint(
  data: ArrayLike<number>,
  width: number,
  height: number,
  point: { x: number; y: number }
): { x: number; y: number; color: string; alpha: number } | null {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const index = (y * width + x) * 4;
  return {
    x,
    y,
    color: watchfaceRgbToHex({ r: data[index]!, g: data[index + 1]!, b: data[index + 2]! }),
    alpha: round2(data[index + 3]! / 255)
  };
}

/**
 * Paints visible pixels a flat color, keeping their alpha so antialiased
 * edges stay smooth. With `from`, only pixels within `tolerance` (largest
 * per-channel difference) of that color change. Returns how many changed.
 */
export function recolorPixels(
  data: Uint8ClampedArray | Uint8Array,
  color: WatchfaceRgb,
  from?: WatchfaceRgb,
  tolerance = 48
): number {
  let changed = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    if (
      from &&
      Math.max(
        Math.abs(data[index]! - from.r),
        Math.abs(data[index + 1]! - from.g),
        Math.abs(data[index + 2]! - from.b)
      ) > tolerance
    ) {
      continue;
    }
    data[index] = color.r;
    data[index + 1] = color.g;
    data[index + 2] = color.b;
    changed += 1;
  }
  return changed;
}

/**
 * Box swept by a COROS progress arc (0° at 3 o'clock, positive
 * counter-clockwise, screen y down), including half the stroke.
 */
export function watchfaceArcSweepBox(arc: {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  startAngle: number;
  endAngle: number;
  strokeWidth: number;
}): { x0: number; y0: number; x1: number; y1: number } {
  const span = Math.max(-360, Math.min(360, arc.endAngle - arc.startAngle));
  const steps = Math.max(1, Math.ceil(Math.abs(span)));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let step = 0; step <= steps; step += 1) {
    const radians = ((arc.startAngle + (span * step) / steps) * Math.PI) / 180;
    const x = arc.centerX + arc.radiusX * Math.cos(radians);
    const y = arc.centerY - arc.radiusY * Math.sin(radians);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const half = arc.strokeWidth / 2;
  return { x0: x0 - half, y0: y0 - half, x1: x1 + half, y1: y1 + half };
}
