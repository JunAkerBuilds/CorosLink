import { inflateSync } from "node:zlib";

/** Straight (non-premultiplied) RGBA, 8 bits per channel, row-major. */
export interface RgbaImage { width: number; height: number; data: Uint8Array }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ADAM7: Array<[number, number, number, number]> = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]
];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Decodes any valid PNG to straight RGBA8, the way libpng's EXPAND transform
 * hands RGB/RGBA/palette images to COROS. COROS mis-reads grayscale and
 * 16-bit PNGs; this decoder reads them correctly (16-bit keeps the high byte).
 * Gamma and color-profile chunks are ignored, as libpng does by default.
 */
export function decodePng(file: Uint8Array): RgbaImage {
  const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG image.");
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | undefined, transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("latin1", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) throw new Error("Truncated PNG image.");
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]!; colorType = body[9]!; interlace = body[12]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = CHANNELS[colorType];
  if (!width || !height || width > 8192 || height > 8192 || !channels || ![1, 2, 4, 8, 16].includes(depth) ||
      (colorType === 3 && (!palette || depth === 16)) || ((colorType === 2 || colorType >= 4) && depth < 8)) {
    throw new Error("Unsupported PNG image.");
  }
  const bitsPerPixel = channels * depth, stride = (w: number) => Math.ceil(w * bitsPerPixel / 8);
  // Interlaced passes add at most a filter byte and a partial byte per pass row; cap the inflate there.
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: height * (stride(width) + 1) + 7 * height * 2 + 64 });
  const pixelBytes = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(width * height * 4);
  // Common layouts copied row by row: 8-bit RGBA, and 8-bit RGB without a transparent color key.
  const rgba8 = colorType === 6 && depth === 8, rgb8 = colorType === 2 && depth === 8 && !transparency;
  let cursor = 0;
  const pass = (x0: number, y0: number, dx: number, dy: number) => {
    const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy);
    if (w <= 0 || h <= 0) return;
    const rowBytes = stride(w);
    let previous = new Uint8Array(rowBytes), current = new Uint8Array(rowBytes);
    for (let row = 0; row < h; row++) {
      if (cursor + 1 + rowBytes > raw.length) throw new Error("Truncated PNG image data.");
      const filter = raw[cursor++]!, n = pixelBytes;
      switch (filter) {
        case 0: current.set(raw.subarray(cursor, cursor + rowBytes)); break;
        case 1: for (let i = 0; i < rowBytes; i++) current[i] = raw[cursor + i]! + (i >= n ? current[i - n]! : 0); break;
        case 2: for (let i = 0; i < rowBytes; i++) current[i] = raw[cursor + i]! + previous[i]!; break;
        case 3: for (let i = 0; i < rowBytes; i++) current[i] = raw[cursor + i]! + (((i >= n ? current[i - n]! : 0) + previous[i]!) >> 1); break;
        case 4:
          for (let i = 0; i < rowBytes; i++) {
            const a = i >= n ? current[i - n]! : 0, b = previous[i]!, c = i >= n ? previous[i - n]! : 0;
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            current[i] = raw[cursor + i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          }
          break;
        default: throw new Error("Invalid PNG filter.");
      }
      cursor += rowBytes;
      const at = ((y0 + row * dy) * width + x0) * 4;
      if (rgba8 && dx === 1) out.set(current, at);
      else if (rgb8 && dx === 1) for (let column = 0, from = 0, to = at; column < w; column++, from += 3, to += 4) {
        out[to] = current[from]!; out[to + 1] = current[from + 1]!; out[to + 2] = current[from + 2]!; out[to + 3] = 255;
      }
      else for (let column = 0; column < w; column++) writePixel(current, column, out, at + column * dx * 4);
      [previous, current] = [current, previous];
    }
  };
  const sample = (row: Uint8Array, index: number): number => {
    if (depth === 8) return row[index]!;
    if (depth === 16) return row[index * 2]!;
    const perByte = 8 / depth, shift = 8 - depth * (index % perByte + 1);
    return (row[Math.floor(index / perByte)]! >> shift) & ((1 << depth) - 1);
  };
  const scale = (value: number) => depth >= 8 ? value : Math.round(value * 255 / ((1 << depth) - 1));
  /** A full-precision sample, for tRNS keys (which are stored at the image's own depth). */
  const exact = (row: Uint8Array, index: number) => depth === 16 ? (row[index * 2]! << 8) | row[index * 2 + 1]! : sample(row, index);
  function writePixel(row: Uint8Array, column: number, target: Uint8Array, at: number) {
    const base = column * channels;
    if (colorType === 3) {
      const index = sample(row, column);
      target[at] = palette![index * 3] ?? 0; target[at + 1] = palette![index * 3 + 1] ?? 0; target[at + 2] = palette![index * 3 + 2] ?? 0;
      target[at + 3] = transparency && index < transparency.length ? transparency[index]! : 255;
      return;
    }
    if (colorType === 0 || colorType === 4) {
      target[at] = target[at + 1] = target[at + 2] = scale(sample(row, base));
      target[at + 3] = colorType === 4 ? sample(row, base + 1)
        : transparency && transparency.length >= 2 && exact(row, base) === transparency.readUInt16BE(0) ? 0 : 255;
      return;
    }
    target[at] = sample(row, base); target[at + 1] = sample(row, base + 1); target[at + 2] = sample(row, base + 2);
    target[at + 3] = colorType === 6 ? sample(row, base + 3)
      : transparency && transparency.length >= 6 && [0, 1, 2].every(k => exact(row, base + k) === transparency!.readUInt16BE(k * 2)) ? 0 : 255;
  }
  if (interlace) for (const [x0, y0, dx, dy] of ADAM7) pass(x0, y0, dx, dy);
  else pass(0, 0, 1, 1);
  return { width, height, data: out };
}
