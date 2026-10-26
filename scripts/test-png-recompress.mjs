import assert from "node:assert/strict";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { recompressPngLossless } = await import(
  pathToFileURL(path.join(repoRoot, "electron", "pngRecompress.ts")).href
);

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(header.subarray(4))), 0);
  return Buffer.concat([header, data, crc]);
}

function readChunks(png) {
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(png.readUInt32BE(offset + 8 + length), zlib.crc32(data, zlib.crc32(png.subarray(offset + 4, offset + 8))), `${type} CRC`);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Independent decoder for 8-bit RGBA, so the test does not trust the encoder's own unfilter. */
function decodeRgba(png) {
  const chunks = readChunks(png);
  const width = chunks[0].data.readUInt32BE(0);
  const height = chunks[0].data.readUInt32BE(4);
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter(c => c.type === "IDAT").map(c => c.data)));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const value = raw[y * (stride + 1) + 1 + x];
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return pixels;
}

// A flat-colour dial with a gradient ring, written the way an image editor
// would: Paeth on every row, default deflate, XMP metadata and a colour profile.
const width = 96, height = 80;
const pixels = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const ring = Math.abs(Math.hypot(x - 48, y - 40) - 30) < 4;
    pixels.set(ring ? [x * 2, y * 3, 200, 255] : [12, 12, 12, x < 10 ? 0 : 255], at);
  }
}
const filtered = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y++) {
  filtered[y * (width * 4 + 1)] = 4;
  for (let x = 0; x < width * 4; x++) {
    const a = x >= 4 ? pixels[y * width * 4 + x - 4] : 0;
    const b = y ? pixels[(y - 1) * width * 4 + x] : 0;
    const c = y && x >= 4 ? pixels[(y - 1) * width * 4 + x - 4] : 0;
    filtered[y * (width * 4 + 1) + 1 + x] = (pixels[y * width * 4 + x] - paeth(a, b, c)) & 0xff;
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header.set([8, 6, 0, 0, 0], 8);
const profile = Buffer.concat([Buffer.from("Display P3\0\0", "latin1"), zlib.deflateSync(Buffer.alloc(400, 7))]);
const idat = zlib.deflateSync(filtered, { level: 1 });
const original = Buffer.concat([
  SIGNATURE,
  chunk("IHDR", header),
  chunk("iCCP", profile),
  chunk("pHYs", Buffer.from([0, 0, 11, 19, 0, 0, 11, 19, 1])),
  chunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0", "latin1"), Buffer.alloc(3000, 0x20)])),
  chunk("IDAT", idat.subarray(0, 100)),
  chunk("IDAT", idat.subarray(100)),
  chunk("IEND", Buffer.alloc(0))
]);

const smaller = await recompressPngLossless(original);
assert.ok(smaller.length < original.length, "re-encoded PNG is smaller");
assert.deepEqual(decodeRgba(smaller), pixels, "every pixel is unchanged");
const types = readChunks(smaller).map(c => c.type);
assert.deepEqual(types, ["IHDR", "iCCP", "IDAT", "IEND"], "metadata dropped, colour profile kept, one IDAT");
assert.deepEqual(readChunks(smaller)[1].data, profile, "colour profile bytes unchanged");
assert.deepEqual(readChunks(smaller)[0].data, header, "still 8-bit RGBA, not interlaced");

// Already optimal output stays byte for byte the same.
assert.equal(await recompressPngLossless(smaller), smaller);

// Not a PNG, or a truncated one: returned as is.
const notPng = Buffer.from("not a png");
assert.equal(await recompressPngLossless(notPng), notPng);
const truncated = original.subarray(0, original.length - 20);
assert.equal(await recompressPngLossless(truncated), truncated);

// Palette images keep their pixel data and palette; only metadata goes.
const paletteHeader = Buffer.from(header);
paletteHeader[9] = 3;
const palette = Buffer.from([0, 0, 0, 255, 255, 255]);
const paletteData = zlib.deflateSync(Buffer.alloc(height * (width + 1)));
const palettePng = Buffer.concat([
  SIGNATURE, chunk("IHDR", paletteHeader), chunk("PLTE", palette),
  chunk("tEXt", Buffer.from("Software\0Editor".padEnd(2000, " "), "latin1")),
  chunk("IDAT", paletteData), chunk("IEND", Buffer.alloc(0))
]);
const paletteOut = readChunks(await recompressPngLossless(palettePng));
assert.deepEqual(paletteOut.map(c => c.type), ["IHDR", "PLTE", "IDAT", "IEND"]);
assert.deepEqual(paletteOut[2].data, paletteData);

console.log("png recompress: ok");
