#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pngjs from "pngjs";
import { readLayoutHeaders } from "./lib/coros-bin-layout.mjs";

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
if (bytes.length < 4 || bytes.subarray(0, 4).toString("latin1") !== "614A") {
  throw new Error("This is not a supported COROS compiled watch-face binary (missing 614A magic).");
}

function findBitmapBlocks(buffer) {
  const blocks = [];

  for (let offset = 0; offset + 18 <= buffer.length; offset += 1) {
    const width = buffer.readUInt16LE(offset);
    const height = buffer.readUInt16LE(offset + 2);
    const encoding = buffer.readUInt16LE(offset + 4);
    const frameCount = buffer[offset + 6];
    const version = buffer[offset + 7];

    if (
      width < 1 || width > 800 ||
      height < 1 || height > 800 ||
      encoding !== 0x2002 ||
      frameCount < 1 || frameCount > 64 ||
      ![1, 3].includes(version) ||
      buffer.subarray(offset + 8, offset + 14).some((value) => value !== 0)
    ) {
      continue;
    }

    const dataOffset = offset + 14 + frameCount * 4;
    if (dataOffset > buffer.length) continue;
    const frameEnds = [];
    let previousEnd = 0;
    let valid = true;

    for (let frame = 0; frame < frameCount; frame += 1) {
      const end = buffer.readUInt32LE(offset + 14 + frame * 4);
      if (end <= previousEnd || dataOffset + end > buffer.length) {
        valid = false;
        break;
      }
      frameEnds.push(end);
      previousEnd = end;
    }

    if (!valid) continue;
    blocks.push({ offset, width, height, encoding, version, frameCount, dataOffset, frameEnds });
    offset = dataOffset + previousEnd - 1;
  }

  return blocks;
}

function decodeRle(encoded) {
  const decoded = [];

  for (let index = 0; index < encoded.length; index += 1) {
    const control = encoded[index];
    if (control >= 0xc0) {
      if (index + 1 >= encoded.length) throw new Error("Truncated RLE run.");
      const value = encoded[index + 1];
      const count = control & 0x3f;
      for (let repeat = 0; repeat < count; repeat += 1) decoded.push(value);
      index += 1;
    } else {
      decoded.push(control);
    }
  }

  return Buffer.from(decoded);
}

function bitmapReference(block) {
  return {
    offset: `0x${block.offset.toString(16)}`,
    width: block.width,
    height: block.height,
    frameCount: block.frameCount,
    version: block.version
  };
}

// Weather day/night pointers share a position in each mode's own header.
// AOD comes from header[0x322], never from the adjacent dark-weather pointer.
function decodeWeatherAndTemperatureSlots(buffer, blocks) {
  let headers;
  try { headers = readLayoutHeaders(buffer); } catch { return undefined; }
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
const blocks = findBitmapBlocks(bytes);
const featureSlots = decodeWeatherAndTemperatureSlots(bytes, blocks);
const manifest = {
  source: inputPath,
  magic: "614A",
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
    const decoded = decodeRle(encoded);
    const pixelCount = block.width * block.height;
    const expectedLength =
      block.version === 3 ? pixelCount * 4 : pixelCount + 256 * 4;
    if (decoded.length !== expectedLength) {
      throw new Error(
        `Unexpected decoded size at 0x${block.offset.toString(16)}, frame ${frame}: ` +
        `${decoded.length} bytes instead of ${expectedLength}.`
      );
    }

    const png = new PNG({ width: block.width, height: block.height });
    if (block.version === 3) {
      decoded.copy(png.data);
    } else {
      const indexes = decoded.subarray(0, pixelCount);
      const palette = decoded.subarray(pixelCount);
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        // COROS stores its 256-entry LUT as a transposed 16x16 table.
        // Pixel indices stay sequential; swap their nibbles for the lookup.
        // Confirmed in 4.9.9 Bitmap::ToLut256Buffer (0x168a48) and
        // Bitmap::ToQuantLut256Buffer (0x168c60). A linear lookup corrupts
        // both color and alpha, producing faded or speckled glyphs.
        const index = indexes[pixel];
        const paletteOffset = (((index & 0x0f) << 4) | (index >>> 4)) * 4;
        const outputOffset = pixel * 4;
        png.data[outputOffset] = palette[paletteOffset];
        png.data[outputOffset + 1] = palette[paletteOffset + 1];
        png.data[outputOffset + 2] = palette[paletteOffset + 2];
        png.data[outputOffset + 3] = palette[paletteOffset + 3];
      }
    }

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
