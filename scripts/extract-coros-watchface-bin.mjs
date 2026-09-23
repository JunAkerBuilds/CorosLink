#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pngjs from "pngjs";
import { decodeCorosBitmapFrame, findCorosBitmapBlocks, parseCorosFaceMagic, readLayoutHeaders } from "./lib/coros-bin-layout.mjs";

const { PNG } = pngjs;
const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : inputPath
    ? path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}-extracted`)
    : undefined;

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/extract-coros-watchface-bin.mjs <watchface.bin> [output-directory]");
  process.exit(1);
}

const bytes = await fs.readFile(inputPath);
const magic = bytes.length >= 4 ? bytes.subarray(0, 4).toString("latin1") : "";
if (!parseCorosFaceMagic(magic)) {
  throw new Error("This is not a supported COROS compiled watch-face binary (expected a size/variant magic such as 614A or 062R).");
}

function bitmapReference(block) {
  return {
    offset: `0x${block.offset.toString(16)}`,
    width: block.width,
    height: block.height,
    encoding: `0x${block.encoding.toString(16)}`,
    frameCount: block.frameCount,
    version: block.version,
    ...(block.viaPointer ? { viaPointer: true } : {}),
    ...(block.note ? { note: block.note } : {})
  };
}

// Weather day/night pointers share a position in each mode's own header.
// AOD comes from header[0x322], never from the adjacent dark-weather pointer.
function decodeWeatherAndTemperatureSlots(buffer, blocks) {
  let headers;
  try { headers = readLayoutHeaders(buffer); } catch { return undefined; }
  if (headers[0].length < 0xc9a) return undefined; // No weather block in this header generation.
  const byOffset = new Map(blocks.map((block) => [block.offset, block]));
  const bitmap = (field) => {
    const block = byOffset.get(buffer.readUInt32LE(field));
    return block ? bitmapReference(block) : undefined;
  };
  const position = (base) => ({ x: buffer.readInt32LE(base + 0xc4a), y: buffer.readInt32LE(base + 0xc4e) });
  const normal = bitmap(0xc52);
  const night = bitmap(0xc92);
  const aodHeader = headers.find((header) => header.mode === "aod");
  const aod = aodHeader && bitmap(aodHeader.offset + 0xc52);
  const digits = bitmap(0xc60);
  const rect = { x0: buffer.readInt16LE(0xc56), y0: buffer.readInt16LE(0xc58),
    x1: buffer.readInt16LE(0xc5a), y1: buffer.readInt16LE(0xc5c) };
  const temperature = digits && rect.x1 > rect.x0 && rect.y1 > rect.y0
    ? { rect, digits, sign: bitmap(0xc64), suffix: bitmap(0xc68) } : undefined;
  if (!normal && !night && !aod && !temperature) return undefined;
  return {
    ...(normal || night || aod ? { weather: { position: position(0), normal, night,
      ...(aod ? { aod: { ...aod, position: position(aodHeader.offset) } } : {}) } } : {}),
    ...(temperature ? { temperature } : {})
  };
}

await fs.mkdir(outputPath, { recursive: true });
const layoutEnd = (() => { try { return Math.max(...readLayoutHeaders(bytes).map((h) => h.offset + h.length)); } catch { return 0; } })();
const blocks = findCorosBitmapBlocks(bytes, layoutEnd);
const featureSlots = decodeWeatherAndTemperatureSlots(bytes, blocks);
const manifest = {
  source: inputPath,
  magic,
  screen: parseCorosFaceMagic(magic).size,
  sizeBytes: bytes.length,
  layoutBytes: blocks[0]?.offset ?? bytes.length,
  layoutFile: "layout.bin",
  bitmapGroups: blocks.length,
  bitmapFrames: blocks.reduce((total, block) => total + block.frameCount, 0),
  ...(featureSlots ? { featureSlots } : {}),
  blocks: []
};

// The pre-bitmap region is COROS's compiled element/layout table. Keep it for
// further reverse engineering. For additional partial layout recovery, run
// decompile-coros-watchface-layout.mjs; unknown records remain preserved.
await fs.writeFile(path.join(outputPath, manifest.layoutFile), bytes.subarray(0, manifest.layoutBytes));

for (const [blockIndex, block] of blocks.entries()) {
  const groupName = `group-${String(blockIndex).padStart(2, "0")}-${block.width}x${block.height}-0x${block.offset.toString(16)}`;
  const groupPath = path.join(outputPath, groupName);
  await fs.mkdir(groupPath, { recursive: true });
  const files = [];
  let previousEnd = 0;

  for (let frame = 0; frame < block.frameCount; frame += 1) {
    const frameEnd = block.frameEnds[frame];
    const encoded = bytes.subarray(block.dataOffset + previousEnd, block.dataOffset + frameEnd);
    // Shared with the app: transposed 256-entry LUT for 0x2002/0x3002 frames
    // (4.9.9 Bitmap::ToLut256Buffer at 0x168a48), direct RGBA for version 3,
    // raw RGB888 for version 2, and A2R2G2B2 bytes for MIP 0x0802 frames.
    const png = new PNG({ width: block.width, height: block.height });
    decodeCorosBitmapFrame(bytes, block, frame).copy(png.data);

    const fileName = `frame-${String(frame).padStart(2, "0")}.png`;
    await fs.writeFile(path.join(groupPath, fileName), PNG.sync.write(png));
    files.push({ file: `${groupName}/${fileName}`, encodedBytes: encoded.length });
    previousEnd = frameEnd;
  }

  manifest.blocks.push({
    index: blockIndex,
    ...bitmapReference(block),
    files
  });
}

await fs.writeFile(path.join(outputPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Extracted ${manifest.bitmapFrames} PNG frames from ${manifest.bitmapGroups} groups to ${outputPath}`);
