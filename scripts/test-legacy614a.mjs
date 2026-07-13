import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const {
  assertLegacy614aReference,
  assertLegacy614aPatchedCarrier,
  inspectLegacy614aCarrier,
  SLENDER_MULTIDATA_416_PATCH,
  patchLegacy614aBundle,
  crc16CcittFalse,
  decodeLegacy614aRle,
  encodeLegacy614aRle,
  patchLegacy614aFeatures,
  replaceLegacy614aBitmap
} = await import(
  `${pathToFileURL(path.join(repoRoot, "dist-electron", "legacy614a.js")).href}?cacheBust=${Date.now()}`
);

const HEADER_BYTES = 0x12;
const RECORD = 0xc40;
const WEATHER = 0x1000;
const DIGITS = 0x1200;
const SIGN = 0x1400;
const SUFFIX = 0x1600;

function makeReference() {
  const bytes = Buffer.alloc(0x1800);
  bytes.write("614A", 0, "latin1");
  bytes.writeUInt32LE(42, 4);
  bytes.writeUInt32LE(bytes.length - HEADER_BYTES, 8);
  bytes.writeUInt16LE(176, RECORD + 0x0a);
  bytes.writeUInt16LE(7, RECORD + 0x0e);
  bytes.writeUInt32LE(WEATHER, RECORD + 0x12);
  bytes.writeUInt16LE(168, RECORD + 0x16);
  bytes.writeUInt16LE(71, RECORD + 0x18);
  bytes.writeUInt16LE(247, RECORD + 0x1a);
  bytes.writeUInt16LE(127, RECORD + 0x1c);
  bytes.writeUInt32LE(DIGITS, RECORD + 0x20);
  bytes.writeUInt32LE(SIGN, RECORD + 0x24);
  bytes.writeUInt32LE(SUFFIX, RECORD + 0x28);
  bytes.writeUInt16LE(72, WEATHER);
  bytes.writeUInt16LE(72, WEATHER + 2);
  bytes.writeUInt16LE(0x2002, WEATHER + 4);
  bytes[WEATHER + 6] = 41;
  bytes[WEATHER + 7] = 3;
  bytes.writeUInt16LE(crc16CcittFalse(bytes.subarray(HEADER_BYTES)), 12);
  return bytes;
}

const source = makeReference();
const profile = {
  name: "Synthetic fixture",
  watchFaceId: 42,
  expectedSize: source.length,
  referenceSha256: crypto.createHash("sha256").update(source).digest("hex"),
  normalWeatherRecord: RECORD,
  aodWeatherRecord: 0xc80,
  weatherSpriteOffset: WEATHER,
  weatherSpriteSize: 72,
  temperatureDigitsOffset: DIGITS,
  temperatureSignOffset: SIGN,
  temperatureSuffixOffset: SUFFIX,
  fileCrcCorrectionOffset: 0x0e
};

assert.doesNotThrow(() => assertLegacy614aReference(source, profile));
const patched = patchLegacy614aFeatures(
  source,
  {
    weatherPosition: { x: 180, y: 10 },
    temperatureRect: { x0: 160, y0: 70, x1: 260, y1: 130 }
  },
  profile
);
assert.notEqual(patched, source, "patching must return a new Buffer");
assert.equal(source.readUInt16LE(RECORD + 0x0a), 176, "input must remain unchanged");
assert.equal(source.readInt32LE(4), 42, "input ID must remain unchanged");
assert.equal(patched.length, source.length, "safe patch must preserve payload length");
assert.equal(patched.readInt32LE(4), 42, "public carrier identity must remain unchanged");
assert.equal(patched.readUInt16LE(RECORD + 0x0a), 180);
assert.equal(patched.readUInt16LE(RECORD + 0x0e), 10);
assert.deepEqual(
  [0, 2, 4, 6].map((offset) => patched.readUInt16LE(RECORD + 0x16 + offset)),
  [160, 70, 260, 130]
);
assert.equal(
  patched.readUInt16LE(12),
  crc16CcittFalse(patched.subarray(HEADER_BYTES)),
  "CRC must be regenerated after each patch"
);
assert.doesNotThrow(() => assertLegacy614aPatchedCarrier(source, patched, profile));
assert.deepEqual(inspectLegacy614aCarrier(source, profile).weatherPosition, { x: 176, y: 7 });
const slenderLayout = patchLegacy614aFeatures(source, SLENDER_MULTIDATA_416_PATCH, profile);
assert.deepEqual(
  [
    slenderLayout.readUInt16LE(RECORD + 0x0a),
    slenderLayout.readUInt16LE(RECORD + 0x0e),
    slenderLayout.readUInt16LE(RECORD + 0x16),
    slenderLayout.readUInt16LE(RECORD + 0x18),
    slenderLayout.readUInt16LE(RECORD + 0x1a),
    slenderLayout.readUInt16LE(RECORD + 0x1c)
  ],
  [292, 72, 266, 152, 404, 212],
  "SLENDER layout must stay within the guarded live-data patch map"
);
const crcPreservingPatch = patchLegacy614aFeatures(
  source,
  { weatherPosition: { x: 180, y: 10 }, preserveReferenceFileCrc: true },
  profile
);
assert.equal(crc16CcittFalse(crcPreservingPatch), crc16CcittFalse(source));
assert.equal(
  crcPreservingPatch.readUInt16LE(12),
  crc16CcittFalse(crcPreservingPatch.subarray(HEADER_BYTES)),
  "full-file CRC preservation must retain a valid payload CRC"
);
assert.throws(
  () => patchLegacy614aFeatures(source, { weatherPosition: { x: 416, y: 0 } }, profile),
  /inside the 416px legacy canvas/
);
assert.throws(
  () => patchLegacy614aFeatures(source, { temperatureRect: { x0: 100, y0: 10, x1: 20, y1: 30 } }, profile),
  /top-left to bottom-right/
);
assert.throws(
  () => patchLegacy614aFeatures(source, { watchFaceId: -123, weatherPosition: { x: 1, y: 1 } }, profile),
  /preserve the public carrier identity/
);
assert.throws(
  () => patchLegacy614aFeatures(patched, { weatherPosition: { x: 1, y: 1 } }, profile),
  /unmodified/
);
const identityCorruption = Buffer.from(patched);
identityCorruption.writeUInt32LE(99, 4);
identityCorruption.writeUInt16LE(crc16CcittFalse(identityCorruption.subarray(HEADER_BYTES)), 12);
assert.throws(
  () => assertLegacy614aPatchedCarrier(source, identityCorruption, profile),
  /watchface ID/
);
const unknownByteCorruption = Buffer.from(patched);
unknownByteCorruption[0x200] ^= 0xff;
unknownByteCorruption.writeUInt16LE(crc16CcittFalse(unknownByteCorruption.subarray(HEADER_BYTES)), 12);
assert.throws(
  () => assertLegacy614aPatchedCarrier(source, unknownByteCorruption, profile),
  /approved patch map/
);

console.log("Legacy 614A patcher test passed");

// RLE fixtures cover both literal-safe (<0xc0) and escaped high-byte values.
const decodedRle = Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x12, 0x12, 0x12, 0x12]);
const encodedRle = encodeLegacy614aRle(decodedRle);
assert.deepEqual(decodeLegacy614aRle(encodedRle), decodedRle);
const expandedRle = encodeLegacy614aRle(decodedRle, encodedRle.length + 3);
assert.equal(expandedRle.length, encodedRle.length + 3);
assert.deepEqual(decodeLegacy614aRle(expandedRle), decodedRle);
assert.throws(() => encodeLegacy614aRle(decodedRle, 1), /between|representable/);

function makeBitmapReference() {
  const blockOffset = 0x1000;
  const frameCount = 41;
  const framePayloads = Array.from({ length: frameCount }, (_, index) => Buffer.alloc(16, index));
  const encodedFrames = framePayloads.map((frame) => encodeLegacy614aRle(frame));
  const blockDataOffset = blockOffset + 14 + frameCount * 4;
  const blockEnd = blockDataOffset + encodedFrames.reduce((sum, frame) => sum + frame.length, 0);
  const bytes = Buffer.alloc(0x4000);
  bytes.write("614A", 0, "latin1");
  bytes.writeUInt32LE(42, 4);
  bytes.writeUInt32LE(bytes.length - HEADER_BYTES, 8);
  bytes.writeUInt16LE(176, RECORD + 0x0a);
  bytes.writeUInt16LE(7, RECORD + 0x0e);
  bytes.writeUInt32LE(blockOffset, RECORD + 0x12);
  bytes.writeUInt16LE(168, RECORD + 0x16);
  bytes.writeUInt16LE(71, RECORD + 0x18);
  bytes.writeUInt16LE(247, RECORD + 0x1a);
  bytes.writeUInt16LE(127, RECORD + 0x1c);
  bytes.writeUInt32LE(0x3000, RECORD + 0x20);
  bytes.writeUInt32LE(0x3200, RECORD + 0x24);
  bytes.writeUInt32LE(0x3400, RECORD + 0x28);
  bytes.writeUInt16LE(2, blockOffset);
  bytes.writeUInt16LE(2, blockOffset + 2);
  bytes.writeUInt16LE(0x2002, blockOffset + 4);
  bytes[blockOffset + 6] = frameCount;
  bytes[blockOffset + 7] = 3;
  let cursor = 0;
  for (let index = 0; index < frameCount; index += 1) {
    cursor += encodedFrames[index].length;
    bytes.writeUInt32LE(cursor, blockOffset + 14 + index * 4);
    encodedFrames[index].copy(bytes, blockDataOffset + cursor - encodedFrames[index].length);
  }
  bytes.writeUInt16LE(crc16CcittFalse(bytes.subarray(HEADER_BYTES)), 12);
  return { bytes, blockOffset, framePayloads, blockEnd };
}

const bitmapFixture = makeBitmapReference();
const bitmapProfile = {
  name: "Synthetic bitmap fixture",
  watchFaceId: 42,
  expectedSize: bitmapFixture.bytes.length,
  referenceSha256: crypto.createHash("sha256").update(bitmapFixture.bytes).digest("hex"),
  normalWeatherRecord: RECORD,
  aodWeatherRecord: 0xc80,
  weatherSpriteOffset: bitmapFixture.blockOffset,
  weatherSpriteSize: 2,
  temperatureDigitsOffset: 0x3000,
  temperatureSignOffset: 0x3200,
  temperatureSuffixOffset: 0x3400,
  bitmapBlocks: [{ offset: bitmapFixture.blockOffset, width: 2, height: 2, frameCount: 41, version: 3 }]
};
const replacementFrames = bitmapFixture.framePayloads.map(() => Buffer.alloc(16, 0x2a));
const replacedBitmap = replaceLegacy614aBitmap(
  bitmapFixture.bytes,
  { blockOffset: bitmapFixture.blockOffset, frames: replacementFrames },
  bitmapProfile
);
assert.equal(replacedBitmap.length, bitmapFixture.bytes.length);
assert.equal(replacedBitmap.readUInt16LE(12), crc16CcittFalse(replacedBitmap.subarray(HEADER_BYTES)));
assert.deepEqual(
  decodeLegacy614aRle(
    replacedBitmap.subarray(bitmapFixture.blockEnd - 2, bitmapFixture.blockEnd),
    16
  ),
  replacementFrames[40]
);
assert.throws(
  () => replaceLegacy614aBitmap(bitmapFixture.bytes, { blockOffset: 0x1100, frames: replacementFrames }, bitmapProfile),
  /not enabled|bitmap block/
);
console.log("Legacy 614A RLE and bitmap replacement tests passed");

const bundled = patchLegacy614aBundle(
  bitmapFixture.bytes,
  {
    features: { weatherPosition: { x: 300, y: 300 } },
    bitmapPatches: [{ blockOffset: bitmapFixture.blockOffset, frames: replacementFrames }]
  },
  bitmapProfile
);
assert.equal(bundled.readInt32LE(4), 42);
assert.equal(bundled.readUInt16LE(RECORD + 0x0a), 300);
assert.equal(bundled.readUInt16LE(RECORD + 0x0e), 300);
assert.equal(bundled.length, bitmapFixture.bytes.length);
assert.equal(bundled.readUInt16LE(12), crc16CcittFalse(bundled.subarray(HEADER_BYTES)));
assert.deepEqual(
  decodeLegacy614aRle(bundled.subarray(bitmapFixture.blockEnd - 2, bitmapFixture.blockEnd), 16),
  replacementFrames[40]
);
console.log("Legacy 614A bundle test passed");
