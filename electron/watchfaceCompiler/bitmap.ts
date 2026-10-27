import type { RgbaImage } from "./png";

/**
 * COROS 416px bitmap blocks, as WFBin8888Exporter writes them:
 *
 *   u16 width, u16 height, u8 compression (2 = RLE, 0 = raw),
 *   u8 exporter flag (0x20), u8 frame count, u8 pixel format (1 = LUT, 3 = RGBA),
 *   2 reserved bytes, u32 frameEnds[frameCount + 1] (frameEnds[0] = 0), data.
 *
 * LUT frames are one index byte per pixel followed by a 1024-byte RGBA
 * palette stored transposed (index i lives in slot (i & 15) << 4 | i >> 4).
 * COROS leaves the reserved bytes and unused palette slots uninitialized;
 * they are zero here.
 */
export const EXPORTER_FLAG = 0x20;
export const FORMAT_LUT = 1, FORMAT_RGBA = 3;
/** Where an image is used; backgrounds and thumbnails are always quantized. */
export const enum InsideType { Normal = 0, Background = 1, Thumbnail = 2 }
/** COROS CompressStyle: 0 picks the smaller of RLE and raw, 1 forces RLE, 2 stores raw. */
export const enum CompressStyle { Auto = 0, Force = 1, None = 2 }

const slot = (index: number) => ((index & 15) << 4) | (index >> 4);

/** COROS `cbz_compress(2, …)`: PCX-style RLE. Runs of 2–63, and lone bytes ≥ 0xc0, become (0xc0 | n, value). */
export function cbzCompress(input: Uint8Array): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  let length = 0;
  for (let i = 0; i < input.length;) {
    const value = input[i]!;
    let run = 1;
    while (run < 63 && i + run < input.length && input[i + run] === value) run++;
    if (run > 1 || value >= 0xc0) { output[length++] = 0xc0 | run; output[length++] = value; }
    else output[length++] = value;
    i += run;
  }
  return output.subarray(0, length);
}

/** Exact palette in first-appearance order (`Bitmap::ToLut256Buffer`); null past 256 colors. */
export function toLut256(image: RgbaImage): Uint8Array | null {
  const pixels = image.width * image.height, out = new Uint8Array(pixels + 1024);
  const view = new DataView(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const seen = new Map<number, number>();
  for (let pixel = 0; pixel < pixels; pixel++) {
    const color = view.getUint32(pixel * 4, true);
    let index = seen.get(color);
    if (index === undefined) {
      if (seen.size === 256) return null;
      index = seen.size;
      seen.set(color, index);
      out.set(image.data.subarray(pixel * 4, pixel * 4 + 4), pixels + slot(index) * 4);
    }
    out[pixel] = index;
  }
  return out;
}

/**
 * Quantizes to 256 colors with dithering, standing in for libimagequant
 * (`Bitmap::ToQuantLut256Buffer`: default attributes, dithering level 1).
 * Images that already fit keep their exact colors. Palettes are not
 * byte-identical to COROS's; the rendered result is visually equivalent.
 */
export function toQuantLut256(image: RgbaImage): Uint8Array {
  const exact = toLut256(image);
  if (exact) return exact;
  const palette = buildPalette(image, 256);
  return remapDithered(image, palette);
}

/** Straight RGBA bytes (`Bitmap::To8888Buffer`). */
export function toRgba(image: RgbaImage): Uint8Array {
  return image.data.slice();
}

// --- Palette quantizer: weighted median cut, refined by k-means ------------

interface Box { colors: Uint32Array; weights: Float64Array; start: number; end: number; score: number; axis: number }

function histogram(image: RgbaImage): { colors: Uint32Array; weights: Float64Array } {
  const view = new DataView(image.data.buffer, image.data.byteOffset, image.data.byteLength), counts = new Map<number, number>();
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    let color = view.getUint32(pixel * 4, true);
    if (color >>> 24 === 0) color = 0; // fully transparent pixels share one entry
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const colors = new Uint32Array(counts.size), weights = new Float64Array(counts.size);
  let i = 0;
  for (const [color, count] of counts) { colors[i] = color; weights[i++] = count; }
  return { colors, weights };
}

const channel = (color: number, c: number) => (color >>> (c * 8)) & 0xff;
/** A channel weighted by alpha, as the color is seen; alpha itself as is. */
const premultiplied = (color: number, c: number) => c === 3 ? color >>> 24 : channel(color, c) * (color >>> 24) / 255;

function buildPalette(image: RgbaImage, size: number): Float64Array {
  const { colors, weights } = histogram(image);
  const order = Array.from(colors.keys());
  const sortedColors = new Uint32Array(order.length), sortedWeights = new Float64Array(order.length);
  order.forEach((from, to) => { sortedColors[to] = colors[from]!; sortedWeights[to] = weights[from]!; });
  // A box's split score depends only on its own colors, so it is measured once, when the box is made.
  const measure = (colors: Uint32Array, weights: Float64Array, start: number, end: number): Box => {
    let best = -1, axis = 0;
    if (end - start >= 2) {
      // The box with the most weighted squared error is split, along its worst channel.
      // Color counts in premultiplied terms: on a nearly transparent pixel it is
      // barely visible, and scoring it at full weight spent most of the palette on
      // faint edges while opaque black text collapsed into one dark grey.
      let total = 0;
      const sum = [0, 0, 0, 0], squares = [0, 0, 0, 0];
      for (let i = start; i < end; i++) {
        const color = colors[i]!, w = weights[i]!;
        total += w;
        for (let c = 0; c < 4; c++) {
          const value = premultiplied(color, c);
          sum[c] += value * w; squares[c] += value * value * w;
        }
      }
      let error = 0;
      for (let c = 0; c < 4; c++) {
        const channelError = squares[c]! - sum[c]! * sum[c]! / total;
        error += channelError;
        if (channelError > best) { best = channelError; axis = c; }
      }
      best = error > 1e-6 ? error : -1;
    }
    return { colors, weights, start, end, score: best, axis };
  };
  const boxes: Box[] = [measure(sortedColors, sortedWeights, 0, sortedColors.length)];
  while (boxes.length < size) {
    let pick = -1, pickScore = 0, pickAxis = 0;
    boxes.forEach((box, index) => {
      if (box.score > pickScore) { pickScore = box.score; pick = index; pickAxis = box.axis; }
    });
    if (pick < 0) break;
    const box = boxes[pick]!;
    // Stable counting sort of the box along its split axis.
    const counts = new Uint32Array(257), colors = new Uint32Array(box.end - box.start), boxWeights = new Float64Array(colors.length);
    for (let i = box.start; i < box.end; i++) counts[channel(box.colors[i]!, pickAxis) + 1]++;
    for (let v = 0; v < 256; v++) counts[v + 1] += counts[v]!;
    for (let i = box.start; i < box.end; i++) {
      const to = counts[channel(box.colors[i]!, pickAxis)]++;
      colors[to] = box.colors[i]!; boxWeights[to] = box.weights[i]!;
    }
    box.colors.set(colors, box.start); box.weights.set(boxWeights, box.start);
    // Split where the two halves' squared error is smallest, not at the median:
    // a median split never isolates a small, distinct group (a thin colored
    // curve among thousands of greys), so it ended up averaged away.
    let total = 0, squares = 0;
    const sums = [0, 0, 0, 0];
    for (let i = box.start; i < box.end; i++) {
      const color = box.colors[i]!, w = box.weights[i]!;
      total += w;
      for (let c = 0; c < 4; c++) { const v = premultiplied(color, c); sums[c] += v * w; squares += v * v * w; }
    }
    let leftTotal = 0, leftSquares = 0, split = box.start + 1, bestError = Infinity;
    const left = [0, 0, 0, 0];
    for (let i = box.start; i < box.end - 1; i++) {
      const color = box.colors[i]!, w = box.weights[i]!;
      leftTotal += w;
      for (let c = 0; c < 4; c++) { const v = premultiplied(color, c); left[c] += v * w; leftSquares += v * v * w; }
      if (channel(color, pickAxis) === channel(box.colors[i + 1]!, pickAxis)) continue;
      let error = leftSquares + (squares - leftSquares);
      for (let c = 0; c < 4; c++) error -= left[c]! * left[c]! / leftTotal + (sums[c]! - left[c]!) ** 2 / (total - leftTotal);
      if (error < bestError) { bestError = error; split = i + 1; }
    }
    boxes.splice(pick, 1, measure(box.colors, box.weights, box.start, split), measure(box.colors, box.weights, split, box.end));
  }
  const palette = new Float64Array(boxes.length * 4);
  boxes.forEach((box, b) => {
    let total = 0;
    const sum = [0, 0, 0, 0];
    for (let i = box.start; i < box.end; i++) {
      const w = box.weights[i]!; total += w;
      for (let c = 0; c < 4; c++) sum[c] += channel(box.colors[i]!, c) * w;
    }
    for (let c = 0; c < 4; c++) palette[b * 4 + c] = sum[c]! / Math.max(total, 1);
  });
  // Two k-means passes over the histogram pull entries onto the true clusters.
  for (let pass = 0; pass < 2; pass++) {
    const sums = new Float64Array(palette.length), totals = new Float64Array(boxes.length), nearestIndex = nearestSearch(palette);
    for (let i = 0; i < sortedColors.length; i++) {
      const nearest = nearestIndex(channel(sortedColors[i]!, 0), channel(sortedColors[i]!, 1), channel(sortedColors[i]!, 2), channel(sortedColors[i]!, 3));
      const w = sortedWeights[i]!;
      totals[nearest] += w;
      for (let c = 0; c < 4; c++) sums[nearest * 4 + c] += channel(sortedColors[i]!, c) * w;
    }
    for (let b = 0; b < totals.length; b++) if (totals[b]) for (let c = 0; c < 4; c++) palette[b * 4 + c] = sums[b * 4 + c]! / totals[b]!;
  }
  return palette;
}

/**
 * Nearest palette entry under a perceptual distance in which color differences
 * matter less as pixels become transparent. Entries are visited outward along
 * one channel and the search stops once that channel alone rules out the rest:
 * green (weighted at least a/510) for mostly opaque pixels, alpha (exact) for
 * mostly transparent ones. Ties go to the lowest index, as in a full scan.
 */
function nearestSearch(palette: ArrayLike<number>): (r: number, g: number, b: number, a: number) => number {
  const count = palette.length >> 2;
  const axis = (c: number) => {
    const order = Array.from({ length: count }, (_, i) => i).sort((x, y) => palette[x * 4 + c]! - palette[y * 4 + c]! || x - y);
    return { order, values: Float64Array.from(order, i => palette[i * 4 + c]!) };
  };
  const green = axis(1), alpha = axis(3);
  const distance = (i: number, r: number, g: number, b: number, a: number) => {
    const at = i * 4, dr = palette[at]! - r, dg = palette[at + 1]! - g, db = palette[at + 2]! - b, da = palette[at + 3]! - a;
    return (dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * ((a + palette[at + 3]!) / 510) + da * da;
  };
  return (r, g, b, a) => {
    const { order, values } = a < 128 ? alpha : green, target = a < 128 ? a : g, bound = a < 128 ? 1 : 0.59 * a / 510;
    let low = 0, high = count;
    while (low < high) { const mid = (low + high) >> 1; if (values[mid]! < target) low = mid + 1; else high = mid; }
    let down = low - 1, up = low, best = 0, bestDistance = Infinity;
    while (down >= 0 || up < count) {
      const k = up < count && (down < 0 || values[up]! - target <= target - values[down]!) ? up++ : down--;
      const gap = values[k]! - target;
      if (gap * gap * bound > bestDistance) break;
      const index = order[k]!, d = distance(index, r, g, b, a);
      if (d < bestDistance || (d === bestDistance && index < best)) { bestDistance = d; best = index; }
    }
    return best;
  };
}

// --- Remap: libimagequant's edge-aware Floyd–Steinberg ----------------------
//
// Plain error diffusion speckles anti-aliased edges: the error of a stroke's
// soft rim spills into its neighbours, which then pick unrelated entries.
// libimagequant (what COROS links) dithers in premultiplied, gamma-adjusted
// color, scaled per pixel by a dither map that is low on edges and noise and
// high in smooth gradients whose undithered remap shows banding.

/** libimagequant's internal gamma (0.5499) over sRGB's (0.45455). */
const GAMMA = 0.5499 / 0.45455;
const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => (i / 255) ** GAMMA);

/** Premultiplied, gamma-adjusted channels in 0–1 (libimagequant's `f_pixel`), alpha last. */
function toPremultiplied(data: ArrayLike<number>, count: number): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const p = i * 4, a = data[p + 3]! / 255;
    out[p] = TO_LINEAR[data[p]!]! * a; out[p + 1] = TO_LINEAR[data[p + 1]!]! * a; out[p + 2] = TO_LINEAR[data[p + 2]!]! * a; out[p + 3] = a;
  }
  return out;
}

/** Back to a straight 8-bit channel for the nearest search. */
const toStraight = (value: number, alpha: number) => Math.round(Math.min(1, Math.max(0, value / alpha)) ** (1 / GAMMA) * 255);

/** 5-pixel cross maximum or minimum (`liq_max3`/`liq_min3`). */
function cross(src: Uint8Array, width: number, height: number, pick: (a: number, b: number) => number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width, row = y * width, down = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      const left = row + Math.max(0, x - 1), right = row + Math.min(width - 1, x + 1);
      out[row + x] = pick(pick(src[row + x]!, pick(src[left]!, src[right]!)), pick(src[up + x]!, src[down + x]!));
    }
  }
  return out;
}

/** Box blur of the given radius, rows then columns (`liq_blur`). */
function blur(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const pass = (from: Uint8Array, w: number, h: number) => {
    // Transposes while blurring rows, so running it twice blurs both ways.
    const out = new Uint8Array(from.length);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = from[row]! * radius;
      for (let i = 0; i <= radius; i++) sum += from[row + Math.min(w - 1, i)]!;
      for (let x = 0; x < w; x++) {
        out[x * h + y] = Math.round(sum / (radius * 2 + 1));
        sum += from[row + Math.min(w - 1, x + radius + 1)]! - from[row + Math.max(0, x - radius)]!;
      }
    }
    return out;
  };
  return pass(pass(src, width, height), height, width);
}

/**
 * Where dithering helps (`contrast_maps`): 255 on smooth color, low on edges
 * and on noise, which dithering would only roughen. Null below 4×4 pixels.
 */
function contrastMap(color: Float32Array, width: number, height: number): Uint8Array | null {
  if (width < 4 || height < 4) return null;
  let noise: Uint8Array = new Uint8Array(width * height), edges: Uint8Array = new Uint8Array(width * height);
  const curvature = (a: number, b: number, at: number) => {
    let most = 0;
    for (let c = 0; c < 4; c++) most = Math.max(most, Math.abs(color[a * 4 + c]! + color[b * 4 + c]! - color[at * 4 + c]! * 2));
    return most;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const horizontal = curvature(y * width + Math.max(0, x - 1), y * width + Math.min(width - 1, x + 1), at);
      const vertical = curvature(Math.max(0, y - 1) * width + x, Math.min(height - 1, y + 1) * width + x, at);
      const edge = Math.max(horizontal, vertical);
      let z = 1 - Math.max(edge - Math.abs(horizontal - vertical) * 0.5, Math.min(horizontal, vertical));
      z *= z; z *= z;
      noise[at] = Math.min(255, 85 + Math.trunc(z * 171));
      edges[at] = Math.max(0, Math.min(255, 255 - Math.trunc(edge * 256)));
    }
  }
  // Noise areas are shrunk and then expanded, which drops thin edges from the noise map.
  const max = Math.max, min = Math.min;
  noise = cross(cross(noise, width, height, max), width, height, max);
  noise = cross(blur(noise, width, height, 3), width, height, max);
  noise = cross(cross(cross(noise, width, height, min), width, height, min), width, height, min);
  edges = cross(cross(edges, width, height, min), width, height, max);
  for (let i = 0; i < edges.length; i++) edges[i] = Math.min(noise[i]!, edges[i]!);
  return edges;
}

/**
 * Raises the dither map inside long runs of one entry in the undithered remap,
 * where banding shows, and leaves it low where entries change quickly (edges,
 * texture) — `update_dither_map`.
 */
function updateDitherMap(map: Uint8Array, indices: Uint8Array, width: number, height: number) {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let last = indices[row]!, lastColumn = 0;
    for (let x = 1; x < width; x++) {
      const index = indices[row + x]!;
      if (index === last && x !== width - 1) continue;
      let neighbours = 10 * (x - lastColumn);
      for (let i = lastColumn; i < x; i++) {
        if (y > 0 && indices[row - width + i] === last) neighbours += 15;
        if (y < height - 1 && indices[row + width + i] === last) neighbours += 15;
      }
      for (; lastColumn <= x; lastColumn++) {
        map[row + lastColumn] = (map[row + lastColumn]! + 128) * (255 / (255 + 128)) * (1 - 20 / (20 + neighbours));
      }
      last = index;
    }
  }
}

/** Edge-aware Floyd–Steinberg remap to the palette; indices followed by the transposed LUT. */
function remapDithered(image: RgbaImage, palette: Float64Array): Uint8Array {
  const { width, height, data } = image, pixels = width * height, out = new Uint8Array(pixels + 1024);
  const entries = palette.length / 4, rounded = new Uint8Array(entries * 4);
  for (let i = 0; i < rounded.length; i++) rounded[i] = Math.max(0, Math.min(255, Math.round(palette[i]!)));
  for (let i = 0; i < entries; i++) out.set(rounded.subarray(i * 4, i * 4 + 4), pixels + slot(i) * 4);
  // A direct-mapped memo of nearest entries; dithered images revisit most colors.
  const cacheKeys = new Uint32Array(1 << 16), cacheValues = new Int16Array(1 << 16).fill(-1), search = nearestSearch(rounded);
  const nearest = (r: number, g: number, b: number, a: number) => {
    const key = (r << 24 | g << 16 | b << 8 | a) >>> 0, at = Math.imul(key, 0x9e3779b1) >>> 16;
    let index = cacheValues[at]!;
    if (index < 0 || cacheKeys[at] !== key) { index = search(r, g, b, a); cacheKeys[at] = key; cacheValues[at] = index; }
    return index;
  };
  const source = toPremultiplied(data, pixels), target = toPremultiplied(rounded, entries);
  // The undithered remap measures the error dithering may spread, and finds where it bands.
  let squaredError = 0;
  for (let i = 0; i < pixels; i++) {
    const p = i * 4, index = nearest(data[p]!, data[p + 1]!, data[p + 2]!, data[p + 3]!);
    out[i] = index;
    for (let c = 0; c < 4; c++) squaredError += (source[p + c]! - target[index * 4 + c]!) ** 2;
  }
  const maxError = Math.max(squaredError / pixels * 2.4, 16 / 256);
  const map = contrastMap(source, width, height);
  if (map) updateDitherMap(map, out, width, height);
  const level = 15 / 16 / (map ? 255 : 1);
  let current = new Float32Array((width + 2) * 4), next = new Float32Array((width + 2) * 4);
  const pixel = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    next.fill(0);
    const forward = y % 2 === 0, step = forward ? 1 : -1;
    for (let x = forward ? 0 : width - 1; x >= 0 && x < width; x += step) {
      const i = y * width + x, p = i * 4, e = (x + 1) * 4, weight = level * (map ? map[i]! : 1);
      // `get_dithered_pixel`: the carried error, scaled back if it would push a channel far out of range.
      let ratio = 1, spread = 0;
      for (let c = 0; c < 3; c++) {
        const value = source[p + c]!, error = current[e + c]! * weight;
        if (value + error > 1.1) ratio = Math.min(ratio, (1.1 - value) / error);
        else if (value + error < -0.1) ratio = Math.min(ratio, (-0.1 - value) / error);
        spread += error * error;
      }
      const alphaError = current[e + 3]! * weight;
      spread += alphaError * alphaError;
      if (spread > maxError) ratio *= 0.8;
      if (spread < 2 / 256 / 256) for (let c = 0; c < 4; c++) pixel[c] = source[p + c]!;
      else {
        for (let c = 0; c < 3; c++) pixel[c] = source[p + c]! + current[e + c]! * weight * ratio;
        pixel[3] = Math.min(1, Math.max(0, source[p + 3]! + alphaError));
      }
      const alpha = pixel[3]!, a = Math.round(alpha * 255);
      const index = a === 0 ? nearest(0, 0, 0, 0) : nearest(toStraight(pixel[0]!, alpha), toStraight(pixel[1]!, alpha), toStraight(pixel[2]!, alpha), a);
      out[i] = index;
      let error = 0;
      for (let c = 0; c < 4; c++) { pixel[c] = pixel[c]! - target[index * 4 + c]!; error += pixel[c]! ** 2; }
      // A very large error is only partly passed on, so it cannot pop up as a stray dot further along.
      const damp = error > maxError ? 0.75 : 1;
      for (let c = 0; c < 4; c++) {
        const value = pixel[c]! * damp;
        current[e + step * 4 + c] += value * 7 / 16;
        next[e - step * 4 + c] += value * 3 / 16;
        next[e + c] += value * 5 / 16;
        next[e + step * 4 + c] += value / 16;
      }
    }
    [current, next] = [next, current];
  }
  return out;
}

const clamp = (value: number) => value < 0 ? 0 : value > 255 ? 255 : value;

// --- Blocks -------------------------------------------------------------

export interface EncodedFrame { format: number; data: Uint8Array }

/** `WFBin8888Exporter::LoadPngWithFormat`: color format 255 is automatic, 1 LUT, 3 RGBA. */
export function encodeFrame(image: RgbaImage, colorFormat: 255 | 1 | 3, inside: InsideType, fullColor = false): EncodedFrame {
  if (colorFormat === 3) return { format: FORMAT_RGBA, data: toRgba(image) };
  const lut = toLut256(image);
  if (lut) return { format: FORMAT_LUT, data: lut };
  // Full color keeps what would be quantized as straight RGBA, as COROS's own faces do. The
  // thumbnail stays a palette: the watch renders its picker thumbnail itself.
  if (fullColor && colorFormat === 255 && inside !== InsideType.Thumbnail) return { format: FORMAT_RGBA, data: toRgba(image) };
  return { format: FORMAT_LUT, data: toQuantLut256(image) };
}

function blockHeader(image: { width: number; height: number }, compressed: boolean, frames: number, format: number): Buffer {
  const header = Buffer.alloc(10);
  header.writeUInt16LE(image.width, 0);
  header.writeUInt16LE(image.height, 2);
  header[4] = compressed ? 2 : 0;
  header[5] = EXPORTER_FLAG;
  header[6] = frames;
  header[7] = format;
  return header;
}

/** One image as a block (`InsertBinPositionOfIconByPath`: automatic format and compression). */
export function encodeImageBlock(image: RgbaImage, inside: InsideType = InsideType.Normal, fullColor = false): Buffer {
  const frame = encodeFrame(image, 255, inside, fullColor);
  const compressed = cbzCompress(frame.data);
  const useRle = compressed.length < frame.data.length;
  const data = useRle ? compressed : Buffer.from(frame.data);
  const table = Buffer.alloc(8);
  table.writeUInt32LE(data.length, 4);
  return Buffer.concat([blockHeader(image, useRle, 1, frame.format), table, data]);
}

/**
 * An ordered frame list as one block (`GetBinPositionOfIconList`). COROS's
 * frames are always LUT palettes, each exact when it fits 256 colors and
 * quantized otherwise: the RGBA fallback is gated on `Bitmap::Add2Lut256`,
 * which COROS stubs to return true. RLE is chosen from the first frame and applied to all.
 */
export function encodeFramesBlock(images: RgbaImage[], fullColor = false): Buffer {
  if (!images.length) throw new Error("A frame list needs at least one image.");
  if (images.length > 255) throw new Error("A frame list holds at most 255 images.");
  // One format per block: in full color, a list with any frame past 256 colors is all RGBA.
  const rgba = fullColor && images.some(image => !toLut256(image));
  const frames = images.map(image => encodeFrame(image, rgba ? 3 : 1, InsideType.Normal));
  const useRle = cbzCompress(frames[0]!.data).length < frames[0]!.data.length;
  const parts = frames.map(frame => useRle ? cbzCompress(frame.data) : Buffer.from(frame.data));
  const table = Buffer.alloc((images.length + 1) * 4);
  let end = 0;
  parts.forEach((part, i) => { end += part.length; table.writeUInt32LE(end, (i + 1) * 4); });
  return Buffer.concat([blockHeader(images[0]!, useRle, images.length, frames[0]!.format), table, ...parts]);
}

// --- Memory-in-pixel (WFBin2222Exporter) ---------------------------------

/**
 * Memory-in-pixel watches (PACE 3, APEX 4, NOMAD, VERTIX) take one byte per pixel, AARRGGBB
 * with the 2-bit alpha inverted (0 = opaque). Blocks keep the LUT block's header with exporter
 * flag 0x08 and pixel format 0, then u16 frame ends: `u16 width, u16 height, u8 compression,
 * u8 0x08, u8 frames, u8 0, 2 reserved bytes, u16 frameEnds[frames + 1], data`. COROS truncates
 * the u16 ends past 64 KB; this does too, and the compiler warns (see `mipBlockOverflows`).
 * Ported from C-LINK's Swift compiler, measured against COROS 4.9.9's `ExportBin(…, 0)`.
 */
export const MIP_EXPORTER_FLAG = 0x08;

/** A channel's 2-bit level, as COROS rounds it: 0–42, 43–127, 128–212, 213–255. */
const level = (value: number) => value < 43 ? 0 : value < 128 ? 1 : value < 213 ? 2 : 3;

/** `Bitmap::To2222Buffer` for sprites, fonts and icons. Alpha below 64 is fully transparent; color is not premultiplied. */
export function to2222(image: RgbaImage): Uint8Array {
  const out = new Uint8Array(image.width * image.height).fill(0xff), pixels = image.data;
  for (let index = 0; index < out.length; index++) {
    const at = index * 4, alpha = pixels[at + 3]!;
    if (alpha < 64) continue;
    out[index] = ((3 - (alpha >> 6)) << 6) | (level(pixels[at]!) << 4) | (level(pixels[at + 1]!) << 2) | level(pixels[at + 2]!);
  }
  return out;
}

/** COROS's default memory-in-pixel tone curve (`rgb_curve_xy`), linearly interpolated. */
const TONE = (() => {
  const points = [[0, 0], [41, 13], [105, 50], [155, 115], [200, 183], [255, 255]] as const;
  return Array.from({ length: 256 }, (_, x) => {
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i]!;
      if (x <= x1) { const [x0, y0] = points[i - 1]!; return y0 + (x - x0) * (y1 - y0) / (x1 - x0); }
    }
    return 255;
  });
})();

/**
 * Backgrounds and thumbnails get COROS's photo treatment for memory-in-pixel screens
 * (`AggRender::OptimizeBitmap` with `WFConfigBuilder::NewDefaultCfg`): the tone curve, +25
 * saturation, a −5 green midtone shift, then Floyd–Steinberg dithering to the 64 displayable
 * colors. Close to COROS, not byte-identical.
 */
export function mipBackground(image: RgbaImage): Uint8Array {
  const { width, height, data: pixels } = image, count = width * height;
  const rgb = new Float64Array(count * 3), out = new Uint8Array(count).fill(0xff);
  for (let index = 0; index < count; index++) {
    const at = index * 4;
    let r = TONE[pixels[at]!]!, g = TONE[pixels[at + 1]!]!, b = TONE[pixels[at + 2]!]!;
    // Saturation +25 (of 255) in HSV, keeping hue and value.
    const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
    if (maximum > 0 && maximum > minimum) {
      const saturation = (maximum - minimum) / maximum, scale = Math.min(1, saturation + 25 / 255) / saturation;
      r = maximum - (maximum - r) * scale; g = maximum - (maximum - g) * scale; b = maximum - (maximum - b) * scale;
    }
    rgb[index * 3] = r; rgb[index * 3 + 1] = g - 5; rgb[index * 3 + 2] = b;
  }
  // Spread the error to opaque neighbours only (7/16, 3/16, 5/16, 1/16).
  const spread = (x: number, y: number, c: number, error: number) => {
    for (const [dx, dy, weight] of [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny >= height) continue;
      const neighbour = ny * width + nx;
      if (pixels[neighbour * 4 + 3]! >= 64) rgb[neighbour * 3 + c]! += error * weight;
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x, alpha = pixels[index * 4 + 3]!;
      if (alpha < 64) continue;
      const levels = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const value = clamp(rgb[index * 3 + c]!), chosen = level(Math.round(value));
        levels[c] = chosen;
        spread(x, y, c, value - chosen * 85);
      }
      out[index] = ((3 - (alpha >> 6)) << 6) | (levels[0]! << 4) | (levels[1]! << 2) | levels[2]!;
    }
  }
  return out;
}

/** RLE is chosen from the first frame and applied to all, as for LUT blocks. */
function mipBlock(frames: Uint8Array[], width: number, height: number): Buffer {
  const useRle = cbzCompress(frames[0]!).length < frames[0]!.length;
  const parts = frames.map(frame => useRle ? cbzCompress(frame) : Buffer.from(frame));
  const header = Buffer.alloc(10 + (frames.length + 1) * 2);
  header.writeUInt16LE(width & 0xffff, 0); header.writeUInt16LE(height & 0xffff, 2);
  header[4] = useRle ? 2 : 0; header[5] = MIP_EXPORTER_FLAG; header[6] = frames.length; header[7] = 0;
  let end = 0;
  parts.forEach((part, i) => { end += part.length; header.writeUInt16LE(end & 0xffff, 10 + (i + 1) * 2); });
  return Buffer.concat([header, ...parts]);
}

/** One memory-in-pixel image; backgrounds and thumbnails are dithered, everything else rounded. */
export function encodeMipImageBlock(image: RgbaImage, inside: InsideType = InsideType.Normal): Buffer {
  return mipBlock([inside === InsideType.Normal ? to2222(image) : mipBackground(image)], image.width, image.height);
}

export function encodeMipFramesBlock(images: RgbaImage[]): Buffer {
  if (!images.length) throw new Error("A frame list needs at least one image.");
  if (images.length > 255) throw new Error("A frame list holds at most 255 images.");
  return mipBlock(images.map(to2222), images[0]!.width, images[0]!.height);
}

/** Frame data past 64 KB, whose u16 ends COROS truncates, so the watch would misread the block. */
export function mipBlockOverflows(block: Buffer): boolean {
  return block.length - 10 - (block[6]! + 1) * 2 > 0xffff;
}
