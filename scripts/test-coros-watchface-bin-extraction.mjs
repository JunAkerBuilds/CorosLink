#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";

const { PNG } = pngjs;
const extractor = fileURLToPath(new URL("./extract-coros-watchface-bin.mjs", import.meta.url));
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "coros-bin-extraction-test-"));

// Literal RLE packets keep the fixture independent of any production encoder.
function bitmap(width, version, decoded) {
  const encoded = Buffer.from([...decoded].flatMap((value) => value >= 0xc0 ? [0xc1, value] : [value]));
  const header = Buffer.alloc(18);
  header.writeUInt16LE(width, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(0x2002, 4);
  header[6] = 1;
  header[7] = version;
  header.writeUInt32LE(encoded.length, 14);
  return Buffer.concat([header, encoded]);
}

try {
  // COROS's LUT stores logical colors 1, 16 and 15 in slots 16, 1 and 240.
  // Distinct RGB and alpha catch linear lookup and channel-order regressions.
  const palette = Buffer.alloc(1024);
  palette.set([200, 40, 10, 255], 64);
  palette.set([3, 70, 110, 128], 4);
  palette.set([250, 5, 100, 254], 960);
  const indexed = bitmap(4, 1, Buffer.concat([Buffer.from([0, 1, 16, 15]), palette]));
  const rgbaPixels = Buffer.from([10, 20, 30, 255, 40, 50, 60, 100]);
  const rgba = bitmap(2, 3, rgbaPixels);
  const layout = Buffer.alloc(0x1000);
  layout.write("614A", "latin1");
  const inputPath = path.join(temporaryDirectory, "fixture.bin");
  const outputPath = path.join(temporaryDirectory, "extracted");
  await fs.writeFile(inputPath, Buffer.concat([layout, indexed, rgba]));
  execFileSync(process.execPath, [extractor, inputPath, outputPath], { stdio: "pipe" });

  const manifest = JSON.parse(await fs.readFile(path.join(outputPath, "manifest.json"), "utf8"));
  assert.equal(manifest.bitmapGroups, 2);
  assert.equal(manifest.bitmapFrames, 2);
  assert.deepEqual(await fs.readFile(path.join(outputPath, "layout.bin")), layout);
  const indexedPng = PNG.sync.read(await fs.readFile(path.join(outputPath, manifest.blocks[0].files[0].file)));
  assert.deepEqual(indexedPng.data, Buffer.from([
    0, 0, 0, 0,
    200, 40, 10, 255,
    3, 70, 110, 128,
    250, 5, 100, 254
  ]));
  const rgbaPng = PNG.sync.read(await fs.readFile(path.join(outputPath, manifest.blocks[1].files[0].file)));
  assert.deepEqual(rgbaPng.data, rgbaPixels);
  assert.equal(manifest.magic, "614A");

  // MIP faces ("062R"): version-0 header ended by the background pointer, and
  // 0x0802 blocks with u16 frame ends and one A2R2G2B2 byte per pixel.
  const mipHeader = Buffer.alloc(0xbaa);
  mipHeader.write("062R", "latin1");
  mipHeader.writeUInt32LE(0xbaa, 0x1a);
  const mipPixels = Buffer.from([0x00, 0x3f, 0xff, 0x80, 0x2a, 0x7f]);
  const mipEncoded = Buffer.from([0xc2, 0x00, 0x3f, 0xc1, 0xff, 0x80, 0x2a, 0x7f]); // a run, literals, and a value ≥ 0xc0 as a one-run
  const mipBlock = Buffer.alloc(14);
  mipBlock.writeUInt16LE(7, 0); mipBlock.writeUInt16LE(1, 2); mipBlock.writeUInt16LE(0x0802, 4); mipBlock[6] = 1; mipBlock[7] = 0;
  mipBlock.writeUInt16LE(mipEncoded.length, 12);
  const mipPath = path.join(temporaryDirectory, "mip.bin"), mipOut = path.join(temporaryDirectory, "mip-extracted");
  await fs.writeFile(mipPath, Buffer.concat([mipHeader, mipBlock, mipEncoded]));
  execFileSync(process.execPath, [extractor, mipPath, mipOut], { stdio: "pipe" });
  const mipManifest = JSON.parse(await fs.readFile(path.join(mipOut, "manifest.json"), "utf8"));
  assert.deepEqual([mipManifest.magic, mipManifest.screen, mipManifest.bitmapGroups, mipManifest.blocks[0].encoding], ["062R", 260, 1, "0x802"]);
  const mipPng = PNG.sync.read(await fs.readFile(path.join(mipOut, mipManifest.blocks[0].files[0].file)));
  assert.deepEqual(mipPng.data, Buffer.from([
    0, 0, 0, 255, 0, 0, 0, 255,      // opaque black ×2
    255, 255, 255, 255,              // opaque white
    255, 255, 255, 0,                // transparent
    0, 0, 0, 85,                     // black, alpha 2 → mostly transparent
    170, 170, 170, 255,              // mid grey
    255, 255, 255, 170               // white, alpha 1
  ]));
  void mipPixels;
  console.log("COROS BIN extraction: indexed color/alpha, direct RGBA, MIP A2R2G2B2, and layout preservation passed.");
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
