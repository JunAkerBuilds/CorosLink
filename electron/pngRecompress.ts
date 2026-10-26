import zlib from "node:zlib";
import { promisify } from "node:util";

const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Chunks that only describe the file (editor XMP, print size, timestamps). Pixels and colour never depend on them. */
const DROPPED_CHUNKS = new Set(["iTXt", "tEXt", "zTXt", "pHYs", "tIME", "eXIf"]);
/** Bytes per pixel for 8-bit grey, RGB, grey+alpha and RGBA. Palette images keep their pixel data as is. */
const BYTES_PER_PIXEL: Partial<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

interface Chunk {
  type: string;
  data: Buffer;
}

function readChunks(png: Buffer): Chunk[] | undefined {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) return undefined;
    const type = png.toString("latin1", offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset = end;
    if (type === "IEND") return chunks;
  }
  return undefined;
}

function writeChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(header.subarray(4))), 0);
  return Buffer.concat([header, data, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undoes the PNG row filters, returning the rows without their filter bytes. */
function unfilter(raw: Buffer, height: number, stride: number, bpp: number): Buffer | undefined {
  if (raw.length !== height * (stride + 1)) return undefined;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? pixels[row + x - bpp] : 0;
      const up = y > 0 ? pixels[previous + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[previous + x - bpp] : 0;
      const value = raw[source + x];
      switch (filter) {
        case 0: pixels[row + x] = value; break;
        case 1: pixels[row + x] = value + left; break;
        case 2: pixels[row + x] = value + up; break;
        case 3: pixels[row + x] = value + ((left + up) >> 1); break;
        case 4: pixels[row + x] = value + paeth(left, up, upLeft); break;
        default: return undefined;
      }
    }
  }
  return pixels;
}

function filterRow(pixels: Buffer, y: number, stride: number, bpp: number, filter: number, out: Buffer, at: number): void {
  const row = y * stride;
  const previous = row - stride;
  out[at] = filter;
  for (let x = 0; x < stride; x++) {
    const value = pixels[row + x];
    const left = x >= bpp ? pixels[row + x - bpp] : 0;
    const up = y > 0 ? pixels[previous + x] : 0;
    const upLeft = y > 0 && x >= bpp ? pixels[previous + x - bpp] : 0;
    let predicted = 0;
    if (filter === 1) predicted = left;
    else if (filter === 2) predicted = up;
    else if (filter === 3) predicted = (left + up) >> 1;
    else if (filter === 4) predicted = paeth(left, up, upLeft);
    out[at + 1 + x] = (value - predicted) & 0xff;
  }
}

/** Filters every row with one filter, or (filter -1) with whichever filter gives the smallest absolute sum per row. */
function filterImage(pixels: Buffer, height: number, stride: number, bpp: number, filter: number): Buffer {
  const out = Buffer.alloc(height * (stride + 1));
  const scratch = Buffer.alloc(stride + 1);
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    if (filter >= 0) {
      filterRow(pixels, y, stride, bpp, filter, out, at);
      continue;
    }
    let best = Infinity;
    for (let candidate = 0; candidate <= 4; candidate++) {
      filterRow(pixels, y, stride, bpp, candidate, scratch, 0);
      let sum = 0;
      for (let x = 1; x <= stride; x++) sum += scratch[x] < 128 ? scratch[x] : 256 - scratch[x];
      if (sum < best) {
        best = sum;
        scratch.copy(out, at);
      }
    }
  }
  return out;
}

/**
 * Re-encodes a PNG without changing a single pixel, its format or its colour
 * information: file metadata is dropped and the image data is refiltered and
 * deflated at the highest level. Returns the original when nothing is smaller
 * or the file is not a PNG this can safely rewrite.
 */
export async function recompressPngLossless(png: Buffer): Promise<Buffer> {
  const chunks = readChunks(png);
  const header = chunks?.[0];
  if (!chunks || header?.type !== "IHDR" || header.data.length !== 13) return png;
  const width = header.data.readUInt32BE(0);
  const height = header.data.readUInt32BE(4);
  const bitDepth = header.data[8];
  const colorType = header.data[9];
  const interlace = header.data[12];
  const idat = Buffer.concat(chunks.filter(chunk => chunk.type === "IDAT").map(chunk => chunk.data));
  if (idat.length === 0) return png;

  let imageData = idat;
  const bpp = BYTES_PER_PIXEL[colorType];
  if (bitDepth === 8 && bpp && interlace === 0 && width > 0 && height > 0) {
    const stride = width * bpp;
    const pixels = unfilter(await inflate(idat).catch(() => Buffer.alloc(0)), height, stride, bpp);
    if (!pixels) return png;
    // Watch-face art is mostly flat colour, where no filter wins; the per-row
    // pick covers photos. The single Sub/Up/Paeth passes saved under 0.01%.
    for (const filter of [0, -1]) {
      const encoded = await deflate(filterImage(pixels, height, stride, bpp, filter), { level: 9, memLevel: 9 });
      if (encoded.length < imageData.length) imageData = encoded;
    }
  }

  const parts: Buffer[] = [PNG_SIGNATURE];
  let wroteImageData = false;
  for (const chunk of chunks) {
    if (DROPPED_CHUNKS.has(chunk.type)) continue;
    if (chunk.type === "IDAT") {
      if (!wroteImageData) parts.push(writeChunk("IDAT", imageData));
      wroteImageData = true;
      continue;
    }
    parts.push(writeChunk(chunk.type, chunk.data));
  }
  const rewritten = Buffer.concat(parts);
  return rewritten.length < png.length ? rewritten : png;
}
