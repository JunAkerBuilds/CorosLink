import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

// Exports over 10 MB are brought toward 8 MB: losslessly first, then image by image in tier
// order, and only as far as needed. What the watch draws must not change before the tiers that
// say it may (the picker thumbnail and memory-in-pixel backgrounds come last).
const require = createRequire(import.meta.url);
const { fitArchiveEntries } = require("../dist-electron/watchfaceCompiler/archiveFit.js");
const { fitWatchfaceArchiveSize } = require("../dist-electron/watchfaceArchiveFit.js");
const { decodePng } = require("../dist-electron/watchfaceCompiler/png.js");
const { encodeFrame, slot, to2222 } = require("../dist-electron/watchfaceCompiler/bitmap.js");
const { compileWatchface } = require("../dist-electron/watchfaceCompiler/compiler.js");
const { prepareLocalWatchfaceZip } = require("../dist-electron/corosWatchfaceCompiler.js");
const { getWatchfaceTarget, watchfaceBinTarget } = require("../dist-electron/watchfaceTargets.js");
const { createStoreZip } = require("../dist-electron/zipStore.js");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(header.subarray(4))), 0);
  return Buffer.concat([header, data, crc]);
}
/** 8-bit RGBA PNG, unfiltered and lightly deflated, as an image editor might leave it. */
function png(width, height, pixel) {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}
let seed = 7;
const noise = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
/** A photo-like image: smooth gradients plus grain, far past 256 colours. */
const photo = (width, height) => png(width, height, (x, y) => [(x * 255 / width + noise() / 8) | 0, (y * 255 / height + noise() / 8) | 0, (128 + noise() / 4) | 0, 255]);
/** Anti-aliased digit-like art with soft alpha. */
const sprite = (width, height) => png(width, height, (x, y) => {
  const edge = Math.max(0, Math.min(255, 255 - Math.abs(Math.hypot(x - width / 2, y - height / 2) - width / 3) * 60));
  return [(200 + noise() / 8) | 0, (x * 4 + noise() / 16) & 255, 60, edge | 0];
});
const flatIcon = png(40, 40, (x, y) => (x + y) % 9 < 4 ? [255, 255, 255, 255] : [20, 20, 20, 0]);

const config = "[background_icon]=background.png\r\n[background_icon_pos]={0,0}\r\n[watchface_thmb_icon]=thmb.png\r\n";
const digits = sprite(90, 120);
const files = [
  ["info.json", Buffer.from(JSON.stringify({ m_name: "Fit test", m_app: "watchface_416x416", m_preview: "watchface_customize.png" }))],
  ["watchface_customize.png", photo(500, 500)],
  ["watchface_416x416/config.txt", Buffer.from(config)],
  ["watchface_416x416/background.png", photo(416, 416)],
  ["watchface_416x416/thmb.png", photo(315, 315)],
  ["watchface_416x416/watchface_customize.png", photo(500, 500)],
  ["watchface_416x416/studio/hh/00.png", digits],
  ["watchface_416x416/studio/mm/00.png", digits],
  ["watchface_416x416/icon/flat.png", flatIcon],
  ["watchface_240x240/config.txt", Buffer.from(config)],
  ["watchface_240x240/background.png", photo(240, 240)],
  ["watchface_240x240/thmb.png", photo(182, 182)],
  ["watchface_240x240/studio/hh/00.png", sprite(52, 70)],
  ["watchface_800x800/config.txt", Buffer.from(config)],
  ["watchface_800x800/background.png", photo(800, 800)],
  ["watchface_800x800/thmb.png", photo(400, 400)]
].map(([name, data]) => ({ name, data }));
const byName = result => new Map(result.entries.map(entry => [entry.name, Buffer.from(entry.data)]));
const zipSize = result => createStoreZip(result.entries.map(entry => ({ name: entry.name, data: Buffer.from(entry.data) }))).length;
const pixels = data => Buffer.from(decodePng(data).data);
const changed = (result, name) => !Buffer.from(byName(result).get(name)).equals(byName(lossless).get(name));

// 1. With room to spare only the lossless pass runs: every pixel survives, nothing is reduced.
const lossless = await fitArchiveEntries(files, Number.MAX_SAFE_INTEGER);
assert.equal(lossless.stats.reducedImages, 0);
assert.ok(lossless.stats.losslessImages > 0);
for (const entry of files) {
  const after = byName(lossless).get(entry.name);
  if (entry.name.endsWith(".png")) assert.deepEqual(pixels(after), pixels(entry.data), `${entry.name} pixels`);
  else assert.deepEqual(after, entry.data, `${entry.name} untouched`);
}
const losslessSize = zipSize(lossless);

// 2. A target just under the lossless size: the exact palette (tier 0) is enough, nothing else changes.
const justUnder = await fitArchiveEntries(files, losslessSize - 1);
assert.ok(zipSize(justUnder) <= losslessSize - 1);
assert.equal(justUnder.stats.reducedImages, 1);
assert.ok(changed(justUnder, "watchface_416x416/icon/flat.png"));
assert.deepEqual(pixels(byName(justUnder).get("watchface_416x416/icon/flat.png")), pixels(flatIcon), "exact palette keeps every pixel");

// 3. Further down, images the watch never draws (800 px master, per-layout previews) go next;
//    the face as compiled for PACE Pro and for PACE 3 stays the same frame for frame.
const unusedSavings = 300_000;
const unused = await fitArchiveEntries(files, losslessSize - unusedSavings);
assert.ok(zipSize(unused) <= losslessSize - unusedSavings);
for (const name of ["watchface_customize.png", "watchface_416x416/background.png", "watchface_416x416/thmb.png", "watchface_240x240/studio/hh/00.png"]) {
  assert.ok(!changed(unused, name), `${name} untouched while unused images suffice`);
}
assert.ok(changed(unused, "watchface_800x800/background.png") || changed(unused, "watchface_416x416/watchface_customize.png"));

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "coroslink-archive-fit-"));
/**
 * The two images this face compiles, as the watch reads them: the background (layout pointer
 * 0x1a) and the picker thumbnail (0x1e). Blocks are `u16 w, u16 h, u8 compression (2 = RLE),
 * u8 flag, u8 frames, u8 format (1 = LUT), 2 reserved, frame ends (u32; u16 on memory-in-pixel)`;
 * LUT frames are indices plus a transposed 256-entry RGBA palette, memory-in-pixel one byte per pixel.
 */
async function compiledImages(entries, model) {
  const file = path.join(directory, `${model}-${Math.random().toString(36).slice(2)}.dat`);
  await fs.writeFile(file, createStoreZip(entries.map(entry => ({ name: entry.name, data: Buffer.from(entry.data) }))));
  const target = getWatchfaceTarget(model);
  const { files: prepared, faceId } = await prepareLocalWatchfaceZip(file, target);
  const bin = compileWatchface(prepared, { faceId, target: watchfaceBinTarget(target) }).bin;
  const mip = target.display === "mip", entry = mip ? 2 : 4;
  return [0x1a, 0x1e].map(pointer => {
    const at = bin.readUInt32LE(pointer);
    const width = bin.readUInt16LE(at), height = bin.readUInt16LE(at + 2), count = width * height;
    const ends = at + 10, end = mip ? bin.readUInt16LE(ends + entry) : bin.readUInt32LE(ends + entry);
    let data = bin.subarray(ends + (bin[at + 6] + 1) * entry, ends + (bin[at + 6] + 1) * entry + end);
    if (bin[at + 4] === 2) {
      const out = [];
      for (let i = 0; i < data.length; i++) {
        if (data[i] >= 0xc0) { for (let n = data[i] & 0x3f, value = data[++i]; n > 0; n--) out.push(value); }
        else out.push(data[i]);
      }
      data = Buffer.from(out);
    }
    if (mip || bin[at + 7] !== 1) return data;
    return renderLut(data, count);
  });
}
async function differingImages(a, b, model) {
  const [x, y] = await Promise.all([compiledImages(a, model), compiledImages(b, model)]);
  return x.flatMap((image, index) => image.equals(y[index]) ? [] : [index]);
}
const renderLut = (data, count) => {
  const out = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) data.subarray(count + slot(data[i]) * 4, count + slot(data[i]) * 4 + 4).forEach((value, c) => { out[i * 4 + c] = value; });
  return out;
};
assert.deepEqual(await differingImages(files, unused.entries, "pace-pro"), []);
assert.deepEqual(await differingImages(files, unused.entries, "pace-3"), []);

// 4. All the way: the target cannot be met, so everything that can shrink does.
const all = await fitArchiveEntries(files, 1);
assert.ok(zipSize(all) < losslessSize * 0.7, `${zipSize(all)} of ${losslessSize}`);
const fitted = byName(all);
// Identical PNGs change together.
assert.deepEqual(fitted.get("watchface_416x416/studio/hh/00.png"), fitted.get("watchface_416x416/studio/mm/00.png"));
// AMOLED sprites: the compiler's own 256-colour quantizer, so the LUT frame renders the same.
const before = decodePng(digits), after = decodePng(fitted.get("watchface_416x416/studio/hh/00.png"));
assert.deepEqual(renderLut(encodeFrame(after, 255, 0).data, 90 * 120), renderLut(encodeFrame(before, 255, 0).data, 90 * 120));
// Memory-in-pixel sprites: snapped to the levels the compiler keeps, so the 2222 bytes are identical.
const mipSprite = files.find(entry => entry.name === "watchface_240x240/studio/hh/00.png").data;
assert.deepEqual(to2222(decodePng(fitted.get("watchface_240x240/studio/hh/00.png"))), to2222(decodePng(mipSprite)));
// Compiled, only the last tiers show: PACE Pro's quantized background still renders the same and
// only its picker thumbnail (1) differs; on PACE 3 the background (0, photo treatment) and thumbnail.
assert.deepEqual(await differingImages(files, all.entries, "pace-pro"), [1]);
assert.deepEqual(await differingImages(files, all.entries, "pace-3"), [0, 1]);

// 5. fitWatchfaceArchiveSize: archives at or under the trigger come back as the same buffer;
//    over it, the result is a smaller ZIP with the same entry names in the same order.
const zip = createStoreZip(files.map(entry => ({ name: entry.name, data: Buffer.from(entry.data) })));
const untouched = await fitWatchfaceArchiveSize(zip, { triggerBytes: zip.length });
assert.equal(untouched.bytes, zip);
assert.equal(untouched.fit, undefined);
const shrunk = await fitWatchfaceArchiveSize(zip, { triggerBytes: 0, targetBytes: losslessSize - unusedSavings });
assert.ok(shrunk.bytes.length <= losslessSize - unusedSavings);
assert.deepEqual(shrunk.fit, { originalBytes: zip.length, bytes: shrunk.bytes.length, ...unused.stats });
const names = [];
for (let offset = 0; shrunk.bytes.readUInt32LE(offset) === 0x04034b50;) {
  const size = shrunk.bytes.readUInt32LE(offset + 18), nameLength = shrunk.bytes.readUInt16LE(offset + 26);
  names.push(shrunk.bytes.toString("utf8", offset + 30, offset + 30 + nameLength));
  offset += 30 + nameLength + size;
}
assert.deepEqual(names, files.map(entry => entry.name));

await fs.rm(directory, { recursive: true, force: true });
console.log("watchface archive fit: ok");
