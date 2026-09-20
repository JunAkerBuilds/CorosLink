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
function bitmap(width, version, decoded, encoding = 0x2002) {
  const encoded = Buffer.from([...decoded].flatMap((value) => value >= 0xc0 ? [0xc1, value] : [value]));
  const header = Buffer.alloc(18);
  header.writeUInt16LE(width, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(encoding, 4);
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
  // DIGITAL's normal-mode clock fonts carry encoding 0x3002: identical frames, one extra flag bit.
  // Skipping them left the face with a colon and no digits.
  const flagged = bitmap(4, 1, Buffer.concat([Buffer.from([15, 16, 1, 0]), palette]), 0x3002);
  const layout = Buffer.alloc(0x1000);
  layout.write("614A", "latin1");
  const inputPath = path.join(temporaryDirectory, "fixture.bin");
  const outputPath = path.join(temporaryDirectory, "extracted");
  await fs.writeFile(inputPath, Buffer.concat([layout, indexed, rgba, flagged]));
  execFileSync(process.execPath, [extractor, inputPath, outputPath], { stdio: "pipe" });

  const manifest = JSON.parse(await fs.readFile(path.join(outputPath, "manifest.json"), "utf8"));
  assert.equal(manifest.bitmapGroups, 3);
  assert.equal(manifest.bitmapFrames, 3);
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
  assert.equal(manifest.blocks[2].encoding, "0x3002");
  const flaggedPng = PNG.sync.read(await fs.readFile(path.join(outputPath, manifest.blocks[2].files[0].file)));
  assert.deepEqual(flaggedPng.data, Buffer.from([
    250, 5, 100, 254,
    3, 70, 110, 128,
    200, 40, 10, 255,
    0, 0, 0, 0
  ]));
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

  // An encoding word the scan has never met (a future flag bit like 0x3002 was)
  // is admitted only when a layout pointer lands on it and every frame decodes.
  // An identical block nothing references stays out; a pointer into garbage is ignored.
  const HEADER = 0x1164;
  const header = Buffer.alloc(HEADER);
  header.write("614A", 0, "latin1");
  header.writeUInt16LE(HEADER, 0x138);
  header[0x13a] = 4;
  const vouched = bitmap(4, 1, Buffer.concat([Buffer.from([1, 0, 0, 16]), palette]), 0x4002);
  const orphan = bitmap(4, 1, Buffer.concat([Buffer.from([0, 0, 0, 0]), palette]), 0x4002);
  const known = bitmap(2, 3, rgbaPixels);
  const garbage = Buffer.from("this is not a bitmap block header at all");
  header.writeUInt32LE(HEADER + known.length, 0xb00);
  header.writeUInt32LE(HEADER + known.length + vouched.length + orphan.length + 3, 0xb04);
  const pointerPath = path.join(temporaryDirectory, "pointer.bin"), pointerOut = path.join(temporaryDirectory, "pointer-extracted");
  await fs.writeFile(pointerPath, Buffer.concat([header, known, vouched, orphan, garbage]));
  execFileSync(process.execPath, [extractor, pointerPath, pointerOut], { stdio: "pipe" });
  const pointerManifest = JSON.parse(await fs.readFile(path.join(pointerOut, "manifest.json"), "utf8"));
  assert.deepEqual(pointerManifest.blocks.map((block) => [block.offset, block.encoding, block.viaPointer ?? false]), [
    [`0x${HEADER.toString(16)}`, "0x2002", false],
    [`0x${(HEADER + known.length).toString(16)}`, "0x4002", true]
  ]);
  const vouchedPng = PNG.sync.read(await fs.readFile(path.join(pointerOut, pointerManifest.blocks[1].files[0].file)));
  assert.deepEqual(vouchedPng.data, Buffer.from([200, 40, 10, 255, 0, 0, 0, 0, 0, 0, 0, 0, 3, 70, 110, 128]));
  // A vouched block whose frames do not decode to the declared size is refused.
  const truncated = Buffer.concat([header, known, vouched.subarray(0, vouched.length - 40)]);
  const truncatedPath = path.join(temporaryDirectory, "truncated.bin"), truncatedOut = path.join(temporaryDirectory, "truncated-extracted");
  await fs.writeFile(truncatedPath, truncated);
  execFileSync(process.execPath, [extractor, truncatedPath, truncatedOut], { stdio: "pipe" });
  const truncatedManifest = JSON.parse(await fs.readFile(path.join(truncatedOut, "manifest.json"), "utf8"));
  assert.deepEqual(truncatedManifest.blocks.map((block) => block.encoding), ["0x2002"]);

  // Version 2 (0x1800) is uncompressed RGB888 — TWILIGHT's exercise icon — and
  // the scan knows it. A MIP hand sprite (NOMAD 062R/082R seconds hand) keeps
  // 0x0f in the frame-count byte over a single u16 end; a pointer admits it as
  // one frame, and the manifest says why.
  const rgb = Buffer.alloc(18 + 6);
  rgb.writeUInt16LE(2, 0); rgb.writeUInt16LE(1, 2); rgb.writeUInt16LE(0x1800, 4); rgb[6] = 1; rgb[7] = 2;
  rgb.writeUInt32LE(6, 14); Buffer.from([1, 2, 3, 250, 251, 252]).copy(rgb, 18);
  const handEncoded = Buffer.from([0xc3, 0xff, 0x2a]); // 3 × transparent white, then one opaque grey
  const handBlock = Buffer.alloc(14);
  handBlock.writeUInt16LE(1, 0); handBlock.writeUInt16LE(4, 2); handBlock.writeUInt16LE(0x0802, 4); handBlock[6] = 0x0f; handBlock[7] = 0;
  handBlock.writeUInt16LE(handEncoded.length, 12);
  const mipLayout = Buffer.alloc(0xbaa);
  mipLayout.write("062R", "latin1");
  mipLayout.writeUInt32LE(0xbaa, 0x1a);
  mipLayout.writeUInt32LE(0xbaa + rgb.length, 0x308); // time_second_icon
  const handPath = path.join(temporaryDirectory, "hand.bin"), handOut = path.join(temporaryDirectory, "hand-extracted");
  await fs.writeFile(handPath, Buffer.concat([mipLayout, rgb, handBlock, handEncoded]));
  execFileSync(process.execPath, [extractor, handPath, handOut], { stdio: "pipe" });
  const handManifest = JSON.parse(await fs.readFile(path.join(handOut, "manifest.json"), "utf8"));
  assert.deepEqual(handManifest.blocks.map((block) => [block.encoding, block.frameCount, block.viaPointer ?? false, block.note ?? null]), [
    ["0x1800", 1, false, null],
    ["0x802", 1, true, "header declares 15 frames over a single frame table; read as one frame"]
  ]);
  const rgbPng = PNG.sync.read(await fs.readFile(path.join(handOut, handManifest.blocks[0].files[0].file)));
  assert.deepEqual(rgbPng.data, Buffer.from([1, 2, 3, 255, 250, 251, 252, 255]));
  const handPng = PNG.sync.read(await fs.readFile(path.join(handOut, handManifest.blocks[1].files[0].file)));
  assert.deepEqual(handPng.data, Buffer.from([255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 170, 170, 170, 255]));
  console.log("COROS BIN extraction: indexed color/alpha, direct RGBA, 0x3002 flagged palette, MIP A2R2G2B2, pointer-vouched unknown encodings, RGB888, MIP hand sprites, and layout preservation passed.");
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
