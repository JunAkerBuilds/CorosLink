import crypto from "node:crypto";

/**
 * Narrow support for the historical 416px `614A` layout used by selected
 * public COROS faces. This is intentionally a patcher, not a general BIN
 * compiler: callers must start from the exact known-good reference artifact.
 *
 * Keeping the scope this small makes the first watch test safe. It changes
 * only feature coordinates or the existing temperature rectangle, preserves
 * every bitmap and layout byte we have not decoded, and updates the firmware
 * payload CRC.
 */

export interface Legacy614aPosition {
  x: number;
  y: number;
}

export interface Legacy614aTemperatureRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Legacy614aFeaturePatch {
  weatherPosition?: Legacy614aPosition;
  temperatureRect?: Legacy614aTemperatureRect;
  /**
   * Preserve the full-file CCITT CRC of the exact reference using two
   * explicitly profiled reserved header bytes. The ordinary payload CRC is
   * still regenerated. This is useful for faces whose catalog CRC covers the
   * entire BIN rather than only bytes after the fixed header.
   */
  preserveReferenceFileCrc?: boolean;
}

export interface Legacy614aProfile {
  name: string;
  watchFaceId: number;
  expectedSize: number;
  /** SHA-256 of the unmodified reference BIN. */
  referenceSha256: string;
  normalWeatherRecord: number;
  aodWeatherRecord: number;
  weatherSpriteOffset: number;
  weatherSpriteSize: number;
  temperatureDigitsOffset: number;
  temperatureSignOffset: number;
  temperatureSuffixOffset: number;
  /** First of two reserved header bytes allowed to carry a CRC correction. */
  fileCrcCorrectionOffset?: number;
  /** Bitmap blocks which this profile permits replacing in place. */
  bitmapBlocks?: readonly Legacy614aBitmapBlockProfile[];
}

export interface Legacy614aBitmapBlockProfile {
  offset: number;
  width: number;
  height: number;
  frameCount: number;
  /** COROS bitmap payload format: 1 is indexed+palette, 3 is RGBA. */
  version: 1 | 3;
}

export interface Legacy614aBitmapPatch {
  blockOffset: number;
  /** Decoded frame payloads (RGBA for v3, index bytes followed by 1024-byte palette for v1). */
  frames: readonly Uint8Array[];
}

export interface Legacy614aBundlePatch {
  features?: Legacy614aFeaturePatch;
  bitmapPatches?: readonly Legacy614aBitmapPatch[];
}

export interface Legacy614aCarrierInspection {
  profileName: string;
  watchFaceId: number;
  sizeBytes: number;
  payloadCrc16: number;
  fullFileCrc16: number;
  weatherPosition: Legacy614aPosition;
  temperatureRect: Legacy614aTemperatureRect;
  weatherSpriteSize: number;
}

/**
 * First reproducible layout for a MULTIDATA ELEV carrier. It deliberately
 * changes only the documented live-weather slot and live-temperature bounds:
 * all static art, AOD bytes, identity metadata, and dynamic resources remain
 * from the public carrier.
 */
export const SLENDER_MULTIDATA_416_PATCH: Readonly<Legacy614aFeaturePatch> = {
  weatherPosition: { x: 292, y: 72 },
  temperatureRect: { x0: 266, y0: 152, x1: 404, y1: 212 }
};

/**
 * The public MULTIDATA ELEV face for the 416px Pace Pro class. Its hash pins
 * this experimental writer to the exact supplied reference, preventing it
 * from silently modifying a different `614A` variant with a similar header.
 */
export const MULTIDATA_ELEV_416_PROFILE: Legacy614aProfile = {
  name: "MULTIDATA ELEV (416 legacy)",
  watchFaceId: 1000001115,
  expectedSize: 2_438_628,
  referenceSha256: "6bbef1705738f36ece33850c706d6c666c7d62e810bfbd15f5f6cc069934c948",
  normalWeatherRecord: 0xc40,
  aodWeatherRecord: 0xc80,
  weatherSpriteOffset: 0x11fe07,
  weatherSpriteSize: 72,
  temperatureDigitsOffset: 0x2465a0,
  temperatureSignOffset: 0x248a15,
  temperatureSuffixOffset: 0x248af6,
  bitmapBlocks: [
    { offset: 0x11fe07, width: 72, height: 72, frameCount: 41, version: 3 },
    { offset: 0x2465a0, width: 40, height: 56, frameCount: 10, version: 1 },
    { offset: 0x248a15, width: 24, height: 56, frameCount: 1, version: 1 },
    { offset: 0x248af6, width: 19, height: 56, frameCount: 1, version: 1 }
  ]
};

/**
 * The public BLOCK3 face for the 416px Pace Pro class. Like MULTIDATA ELEV,
 * this profile is hash-pinned: its shared record layout alone is not enough
 * permission to patch an arbitrary `614A` face.
 */
export const BLOCK3_416_PROFILE: Legacy614aProfile = {
  name: "BLOCK3 (416 legacy)",
  watchFaceId: 1000000819,
  expectedSize: 628_173,
  referenceSha256: "72a75a3e2789fb9fb94c8593503b8471aa98a27eb1de3187e7c85ff84afca79c",
  normalWeatherRecord: 0xc40,
  aodWeatherRecord: 0xc80,
  weatherSpriteOffset: 0x15963,
  weatherSpriteSize: 46,
  temperatureDigitsOffset: 0x12b69,
  temperatureSignOffset: 0x6465,
  temperatureSuffixOffset: 0x90291,
  fileCrcCorrectionOffset: 0x0e,
  bitmapBlocks: [
    { offset: 0x15963, width: 46, height: 46, frameCount: 41, version: 3 },
    { offset: 0x12b69, width: 23, height: 33, frameCount: 10, version: 1 },
    { offset: 0x6465, width: 23, height: 33, frameCount: 1, version: 1 },
    { offset: 0x90291, width: 17, height: 33, frameCount: 1, version: 1 }
  ]
};

const HEADER_BYTES = 0x12;
const MAGIC = "614A";
const WEATHER_X_OFFSET = 0x0a;
const WEATHER_Y_OFFSET = 0x0e;
const WEATHER_SPRITE_OFFSET = 0x12;
const TEMPERATURE_RECT_OFFSET = 0x16;
const TEMPERATURE_DIGITS_OFFSET = 0x20;
const TEMPERATURE_SIGN_OFFSET = 0x24;
const TEMPERATURE_SUFFIX_OFFSET = 0x28;

/** CRC-16/CCITT-FALSE used in bytes 0x0c–0x0d of legacy `614A` files. */
export function crc16CcittFalse(bytes: Uint8Array): number {
  return crc16CcittFalseFrom(bytes, 0xffff);
}

function crc16CcittFalseFrom(bytes: Uint8Array, initial: number): number {
  let crc = initial;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function crc16CcittFalseStep(crc: number, byte: number): number {
  crc ^= byte << 8;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * Finds a two-byte correction that restores the reference's complete-file
 * CRC without touching the payload. The CRC state after a fixed suffix is an
 * affine transform, so this searches all 65,536 pairs without re-hashing the
 * full BIN for every candidate.
 */
function preserveReferenceFileCrc(
  reference: Buffer,
  output: Buffer,
  profile: Legacy614aProfile
): void {
  const offset = profile.fileCrcCorrectionOffset;
  if (offset === undefined || offset < 0 || offset + 2 > HEADER_BYTES) {
    throw new Error(`${profile.name} does not define two reserved header bytes for a file-CRC correction.`);
  }
  if (reference[offset] !== 0 || reference[offset + 1] !== 0) {
    throw new Error(`${profile.name} reference header correction bytes are not reserved zero bytes.`);
  }

  const target = crc16CcittFalse(reference);
  const prefixCrc = crc16CcittFalseFrom(output.subarray(0, offset), 0xffff);
  const suffix = output.subarray(offset + 2);
  const suffixFromZero = crc16CcittFalseFrom(suffix, 0);
  const basis = Array.from({ length: 16 }, (_unused, bit) =>
    crc16CcittFalseFrom(suffix, 1 << bit) ^ suffixFromZero
  );
  const finish = (state: number): number => {
    let result = suffixFromZero;
    for (let bit = 0; bit < 16; bit += 1) {
      if (state & (1 << bit)) result ^= basis[bit];
    }
    return result;
  };

  for (let pair = 0; pair <= 0xffff; pair += 1) {
    const state = crc16CcittFalseStep(
      crc16CcittFalseStep(prefixCrc, pair & 0xff),
      pair >>> 8
    );
    if (finish(state) !== target) continue;
    output[offset] = pair & 0xff;
    output[offset + 1] = pair >>> 8;
    if (crc16CcittFalse(output) !== target) {
      throw new Error("The full-file CRC correction did not verify.");
    }
    return;
  }
  throw new Error("Could not find a two-byte full-file CRC correction.");
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function requireUint16(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`${label} must be a whole number from 0 to 65535.`);
  }
}

function requireScreenCoordinate(value: number, label: string): void {
  requireUint16(value, label);
  if (value > 415) {
    throw new Error(`${label} must be inside the 416px legacy canvas.`);
  }
}

function readBitmapShape(bytes: Buffer, offset: number): {
  width: number;
  height: number;
  frames: number;
  version: number;
} {
  if (offset < 0 || offset + 18 > bytes.length) {
    throw new Error("The legacy BIN contains an out-of-bounds bitmap pointer.");
  }
  return {
    width: bytes.readUInt16LE(offset),
    height: bytes.readUInt16LE(offset + 2),
    frames: bytes[offset + 6]!,
    version: bytes[offset + 7]!
  };
}

interface Legacy614aBitmapBlock {
  offset: number;
  width: number;
  height: number;
  frameCount: number;
  version: 1 | 3;
  dataOffset: number;
  frameEnds: number[];
}

function readBitmapBlock(bytes: Buffer, offset: number): Legacy614aBitmapBlock {
  if (offset < 0 || offset + 14 > bytes.length) {
    throw new Error("The legacy BIN contains an out-of-bounds bitmap block.");
  }
  const width = bytes.readUInt16LE(offset);
  const height = bytes.readUInt16LE(offset + 2);
  if (bytes.readUInt16LE(offset + 4) !== 0x2002) {
    throw new Error("The bitmap block does not use COROS RLE encoding.");
  }
  const frameCount = bytes[offset + 6]!;
  const version = bytes[offset + 7]!;
  if (!width || !height || !frameCount || (version !== 1 && version !== 3)) {
    throw new Error("The legacy bitmap block has invalid dimensions, frame count, or version.");
  }
  if (bytes.subarray(offset + 8, offset + 14).some((value) => value !== 0)) {
    throw new Error("The legacy bitmap block has a non-zero reserved header.");
  }
  const tableEnd = offset + 14 + frameCount * 4;
  if (tableEnd > bytes.length) throw new Error("The legacy bitmap frame table is truncated.");
  const frameEnds: number[] = [];
  let previousEnd = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const end = bytes.readUInt32LE(offset + 14 + frame * 4);
    if (end <= previousEnd || tableEnd + end > bytes.length) {
      throw new Error("The legacy bitmap frame table contains an invalid end offset.");
    }
    frameEnds.push(end);
    previousEnd = end;
  }
  return { offset, width, height, frameCount, version, dataOffset: tableEnd, frameEnds };
}

function decodedBitmapLength(block: Pick<Legacy614aBitmapBlock, "width" | "height" | "version">): number {
  const pixels = block.width * block.height;
  return block.version === 3 ? pixels * 4 : pixels + 256 * 4;
}

/** Decodes one COROS RLE frame, validating its decoded length when supplied. */
export function decodeLegacy614aRle(encoded: Uint8Array, expectedLength?: number): Buffer {
  const decoded: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    const control = encoded[index]!;
    if (control >= 0xc0) {
      if (index + 1 >= encoded.length) throw new Error("Truncated COROS RLE run.");
      const count = control & 0x3f;
      if (!count) throw new Error("COROS RLE contains a zero-length run.");
      const value = encoded[index + 1]!;
      for (let repeat = 0; repeat < count; repeat += 1) decoded.push(value);
      index += 1;
    } else {
      decoded.push(control);
    }
    if (expectedLength !== undefined && decoded.length > expectedLength) {
      throw new Error("COROS RLE frame expands beyond its expected decoded size.");
    }
  }
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`COROS RLE decoded to ${decoded.length} bytes instead of ${expectedLength}.`);
  }
  return Buffer.from(decoded);
}

interface RleRun {
  value: number;
  length: number;
  minEncodedLength: number;
  maxEncodedLength: number;
  low: boolean;
}

function bitmapRuns(decoded: Uint8Array): RleRun[] {
  const runs: RleRun[] = [];
  for (let index = 0; index < decoded.length;) {
    const value = decoded[index]!;
    let end = index + 1;
    while (end < decoded.length && decoded[end] === value) end += 1;
    const length = end - index;
    const low = value < 0xc0;
    const fullRuns = Math.floor(length / 63);
    const remainder = length % 63;
    runs.push({
      value,
      length,
      low,
      // A low byte can remain a literal. For a remainder of one, that is
      // cheaper than a second two-byte run (e.g. 64 bytes => 63-run + 1
      // literal = 3 bytes). High bytes must always use two-byte runs.
      minEncodedLength: low
        ? 2 * fullRuns + (remainder === 0 ? 0 : Math.min(remainder, 2))
        : 2 * Math.ceil(length / 63),
      maxEncodedLength: low ? 2 * length : 2 * length
    });
    index = end;
  }
  return runs;
}

function appendRun(output: number[], value: number, count: number): void {
  if (count < 1 || count > 63) throw new Error("COROS RLE runs must contain 1–63 bytes.");
  output.push(0xc0 | count, value);
}

function encodeRunAtLength(run: RleRun, encodedLength: number, output: number[]): void {
  if (encodedLength < run.minEncodedLength || encodedLength > run.maxEncodedLength) {
    throw new Error("Requested COROS RLE frame length is not representable.");
  }
  if (!run.low) {
    if (encodedLength % 2 !== 0) throw new Error("High-byte COROS RLE runs require an even encoded length.");
    let tokenCount = encodedLength / 2;
    let remaining = run.length;
    while (tokenCount > 0) {
      const count = Math.min(63, remaining - (tokenCount - 1));
      appendRun(output, run.value, count);
      remaining -= count;
      tokenCount -= 1;
    }
    if (remaining !== 0) throw new Error("Failed to construct the requested COROS RLE run.");
    return;
  }

  // For low bytes, choose p run tokens and l literals: 2p + l = encodedLength,
  // p + l <= length <= 63p + l. This covers every length in the valid interval.
  const pMin = Math.max(0, encodedLength - run.length, Math.ceil((run.length - encodedLength) / 61));
  const pMax = Math.floor(encodedLength / 2);
  if (pMin > pMax) throw new Error("Failed to construct the requested COROS RLE run.");
  const runTokens = pMin;
  const literalCount = encodedLength - 2 * runTokens;
  const runBytes = run.length - literalCount;
  if (runBytes < runTokens || runBytes > runTokens * 63) {
    throw new Error("Failed to construct the requested COROS RLE run.");
  }
  for (let literal = 0; literal < literalCount; literal += 1) output.push(run.value);
  let remaining = runBytes;
  let left = runTokens;
  while (left > 0) {
    const count = Math.min(63, remaining - (left - 1));
    appendRun(output, run.value, count);
    remaining -= count;
    left -= 1;
  }
}

/**
 * Encodes a decoded v1/v3 frame. Supplying targetLength is mandatory when the
 * bytes will replace an existing block: it guarantees that all following
 * pointers remain valid. Without it the shortest valid representation is used.
 */
export function encodeLegacy614aRle(decoded: Uint8Array, targetLength?: number): Buffer {
  if (!decoded.length) throw new Error("Cannot encode an empty COROS RLE frame.");
  const runs = bitmapRuns(decoded);
  const minLength = runs.reduce((sum, run) => sum + run.minEncodedLength, 0);
  const maxLength = runs.reduce((sum, run) => sum + run.maxEncodedLength, 0);
  const requested = targetLength ?? minLength;
  if (!Number.isSafeInteger(requested) || requested < minLength || requested > maxLength) {
    throw new Error(`Requested COROS RLE length must be between ${minLength} and ${maxLength}.`);
  }
  const highRuns = runs.filter((run) => !run.low);
  const lowRuns = runs.filter((run) => run.low);
  const remaining = requested - minLength;
  const highCapacity = highRuns.reduce((sum, run) => sum + (run.maxEncodedLength - run.minEncodedLength), 0);
  const lowCapacity = lowRuns.reduce((sum, run) => sum + (run.maxEncodedLength - run.minEncodedLength), 0);
  let highExtra = Math.max(0, remaining - lowCapacity);
  if (highExtra % 2) highExtra += 1;
  if (highExtra > highCapacity || highExtra > remaining) {
    throw new Error("Requested COROS RLE length is not representable for this frame.");
  }
  let lowExtra = remaining - highExtra;
  const additions = new Map<RleRun, number>();
  for (const run of highRuns) {
    const capacity = run.maxEncodedLength - run.minEncodedLength;
    const add = Math.min(capacity, highExtra - (highExtra % 2));
    additions.set(run, add);
    highExtra -= add;
  }
  for (const run of lowRuns) {
    const capacity = run.maxEncodedLength - run.minEncodedLength;
    const add = Math.min(capacity, lowExtra);
    additions.set(run, add);
    lowExtra -= add;
  }
  if (highExtra !== 0 || lowExtra !== 0) throw new Error("Failed to allocate the requested COROS RLE length.");
  const output: number[] = [];
  for (const run of runs) {
    encodeRunAtLength(run, run.minEncodedLength + (additions.get(run) ?? 0), output);
  }
  if (output.length !== requested) throw new Error("COROS RLE encoder produced the wrong byte length.");
  return Buffer.from(output);
}

function assertBitmapProfile(
  block: Legacy614aBitmapBlock,
  profile: Legacy614aProfile
): Legacy614aBitmapBlockProfile {
  const allowed = profile.bitmapBlocks?.find((candidate) => candidate.offset === block.offset);
  if (!allowed) {
    throw new Error("This bitmap block is not enabled in the selected legacy profile.");
  }
  if (
    block.width !== allowed.width ||
    block.height !== allowed.height ||
    block.frameCount !== allowed.frameCount ||
    block.version !== allowed.version
  ) {
    throw new Error("The bitmap block does not match the selected legacy profile.");
  }
  return allowed;
}

function applyBitmapPatch(
  source: Buffer,
  output: Buffer,
  patch: Legacy614aBitmapPatch,
  profile: Legacy614aProfile
): void {
  if (!Number.isSafeInteger(patch.blockOffset) || patch.blockOffset < 0) {
    throw new Error("Bitmap block offset must be a non-negative integer.");
  }
  const block = readBitmapBlock(source, patch.blockOffset);
  assertBitmapProfile(block, profile);
  if (patch.frames.length !== block.frameCount) {
    throw new Error(`Bitmap replacement requires exactly ${block.frameCount} decoded frames.`);
  }
  const expectedDecodedLength = decodedBitmapLength(block);
  let previousEnd = 0;
  for (let frame = 0; frame < block.frameCount; frame += 1) {
    const frameEnd = block.frameEnds[frame]!;
    const encodedLength = frameEnd - previousEnd;
    const decoded = patch.frames[frame];
    if (decoded === undefined || decoded.length !== expectedDecodedLength) {
      throw new Error(
        `Bitmap frame ${frame} must contain exactly ${expectedDecodedLength} decoded bytes.`
      );
    }
    // Validate the original frame before touching the copy. This catches a
    // malformed profile/file even when the replacement payload is valid.
    decodeLegacy614aRle(
      source.subarray(block.dataOffset + previousEnd, block.dataOffset + frameEnd),
      expectedDecodedLength
    );
    const encoded = encodeLegacy614aRle(decoded, encodedLength);
    encoded.copy(output, block.dataOffset + previousEnd);
    previousEnd = frameEnd;
  }
}

function applyFeaturePatch(
  output: Buffer,
  patch: Legacy614aFeaturePatch,
  profile: Legacy614aProfile
): void {
  if (Object.prototype.hasOwnProperty.call(patch, "watchFaceId")) {
    throw new Error(
      "Legacy 614A carrier patches must preserve the public carrier identity; use the custom-template compiler for custom IDs."
    );
  }
  if (!patch.weatherPosition && !patch.temperatureRect) {
    throw new Error("Choose a weather position or temperature rectangle to patch.");
  }
  const record = profile.normalWeatherRecord;
  if (patch.weatherPosition) {
    requireScreenCoordinate(patch.weatherPosition.x, "Weather x");
    requireScreenCoordinate(patch.weatherPosition.y, "Weather y");
    output.writeUInt16LE(patch.weatherPosition.x, record + WEATHER_X_OFFSET);
    output.writeUInt16LE(patch.weatherPosition.y, record + WEATHER_Y_OFFSET);
  }
  if (patch.temperatureRect) {
    const { x0, y0, x1, y1 } = patch.temperatureRect;
    requireScreenCoordinate(x0, "Temperature x0");
    requireScreenCoordinate(y0, "Temperature y0");
    requireScreenCoordinate(x1, "Temperature x1");
    requireScreenCoordinate(y1, "Temperature y1");
    if (x0 > x1 || y0 > y1) {
      throw new Error("Temperature rectangle must run from top-left to bottom-right.");
    }
    output.writeUInt16LE(x0, record + TEMPERATURE_RECT_OFFSET);
    output.writeUInt16LE(y0, record + TEMPERATURE_RECT_OFFSET + 2);
    output.writeUInt16LE(x1, record + TEMPERATURE_RECT_OFFSET + 4);
    output.writeUInt16LE(y1, record + TEMPERATURE_RECT_OFFSET + 6);
  }
}

function markWritableBytes(
  writable: Uint8Array,
  start: number,
  length: number
): void {
  if (start < 0 || length < 0 || start + length > writable.length) {
    throw new Error("The legacy profile permits an out-of-bounds write range.");
  }
  writable.fill(1, start, start + length);
}

function writableLegacy614aOffsets(
  reference: Buffer,
  profile: Legacy614aProfile,
  preserveFileCrc: boolean
): Uint8Array {
  const writable = new Uint8Array(reference.length);
  // The mandatory payload CRC changes for every valid patch.
  markWritableBytes(writable, 12, 2);
  if (preserveFileCrc) {
    if (profile.fileCrcCorrectionOffset === undefined) {
      throw new Error(`${profile.name} cannot preserve its full-file CRC; no reserved correction bytes are profiled.`);
    }
    markWritableBytes(writable, profile.fileCrcCorrectionOffset, 2);
  }

  const record = profile.normalWeatherRecord;
  markWritableBytes(writable, record + WEATHER_X_OFFSET, 2);
  markWritableBytes(writable, record + WEATHER_Y_OFFSET, 2);
  markWritableBytes(writable, record + TEMPERATURE_RECT_OFFSET, 8);

  for (const configuredBlock of profile.bitmapBlocks ?? []) {
    const block = readBitmapBlock(reference, configuredBlock.offset);
    assertBitmapProfile(block, profile);
    const finalFrameEnd = block.frameEnds.at(-1);
    if (finalFrameEnd === undefined) {
      throw new Error("The legacy bitmap block contains no frames.");
    }
    markWritableBytes(writable, block.dataOffset, finalFrameEnd);
  }
  return writable;
}

function assertLegacy614aCarrierStructure(bytes: Buffer, profile: Legacy614aProfile): void {
  if (bytes.length < HEADER_BYTES || bytes.subarray(0, 4).toString("latin1") !== MAGIC) {
    throw new Error("This is not a legacy COROS 614A watchface BIN.");
  }
  if (bytes.length !== profile.expectedSize) {
    throw new Error(`This BIN does not match the ${profile.name} reference size.`);
  }
  if (bytes.readUInt32LE(4) !== profile.watchFaceId) {
    throw new Error(`This BIN does not match the ${profile.name} watchface ID.`);
  }
  if (bytes.readUInt32LE(8) + HEADER_BYTES !== bytes.length) {
    throw new Error("The legacy BIN's declared length does not match its payload.");
  }
  if (bytes.readUInt16LE(12) !== crc16CcittFalse(bytes.subarray(HEADER_BYTES))) {
    throw new Error("The legacy BIN payload CRC is not valid.");
  }

  const record = profile.normalWeatherRecord;
  if (record + TEMPERATURE_SUFFIX_OFFSET + 4 > bytes.length) {
    throw new Error("The legacy weather record is truncated.");
  }
  if (bytes.readUInt32LE(record + WEATHER_SPRITE_OFFSET) !== profile.weatherSpriteOffset) {
    throw new Error("The legacy weather sprite pointer does not match the reference.");
  }
  const weather = readBitmapShape(bytes, profile.weatherSpriteOffset);
  if (
    weather.width !== profile.weatherSpriteSize ||
    weather.height !== profile.weatherSpriteSize ||
    weather.frames !== 41 ||
    weather.version !== 3
  ) {
    throw new Error("The legacy weather sprite table does not match the reference.");
  }
  if (
    bytes.readUInt32LE(record + TEMPERATURE_DIGITS_OFFSET) !== profile.temperatureDigitsOffset ||
    bytes.readUInt32LE(record + TEMPERATURE_SIGN_OFFSET) !== profile.temperatureSignOffset ||
    bytes.readUInt32LE(record + TEMPERATURE_SUFFIX_OFFSET) !== profile.temperatureSuffixOffset
  ) {
    throw new Error("The legacy temperature sprites do not match the reference.");
  }
}

/**
 * Validates a generated carrier against its exact public source. Aside from
 * documented layout fields, profiled bitmap *payloads*, and checksum bytes,
 * every byte must be identical. This protects the catalog identity and all
 * uncharted resources from accidental corruption.
 */
export function assertLegacy614aPatchedCarrier(
  reference: Buffer,
  output: Buffer,
  profile: Legacy614aProfile = MULTIDATA_ELEV_416_PROFILE,
  preserveFileCrc = false
): void {
  assertLegacy614aReference(reference, profile);
  assertLegacy614aCarrierStructure(output, profile);
  if (reference.length !== output.length) {
    throw new Error("A patched legacy carrier must retain its exact file length.");
  }
  const writable = writableLegacy614aOffsets(reference, profile, preserveFileCrc);
  for (let offset = 0; offset < reference.length; offset += 1) {
    if (reference[offset] !== output[offset] && writable[offset] !== 1) {
      throw new Error(
        `Legacy carrier validation rejected a change at 0x${offset.toString(16)} outside the approved patch map.`
      );
    }
  }
  if (preserveFileCrc && crc16CcittFalse(output) !== crc16CcittFalse(reference)) {
    throw new Error("The patched carrier did not preserve the reference full-file CRC.");
  }
}

/** Returns the mapped live-data geometry after authenticating the input reference. */
export function inspectLegacy614aCarrier(
  reference: Buffer,
  profile: Legacy614aProfile = MULTIDATA_ELEV_416_PROFILE
): Legacy614aCarrierInspection {
  assertLegacy614aReference(reference, profile);
  const record = profile.normalWeatherRecord;
  return {
    profileName: profile.name,
    watchFaceId: profile.watchFaceId,
    sizeBytes: reference.length,
    payloadCrc16: reference.readUInt16LE(12),
    fullFileCrc16: crc16CcittFalse(reference),
    weatherPosition: {
      x: reference.readUInt16LE(record + WEATHER_X_OFFSET),
      y: reference.readUInt16LE(record + WEATHER_Y_OFFSET)
    },
    temperatureRect: {
      x0: reference.readUInt16LE(record + TEMPERATURE_RECT_OFFSET),
      y0: reference.readUInt16LE(record + TEMPERATURE_RECT_OFFSET + 2),
      x1: reference.readUInt16LE(record + TEMPERATURE_RECT_OFFSET + 4),
      y1: reference.readUInt16LE(record + TEMPERATURE_RECT_OFFSET + 6)
    },
    weatherSpriteSize: profile.weatherSpriteSize
  };
}

/**
 * Replaces one explicitly profiled bitmap block without moving any bytes.
 * Every encoded frame must fit exactly into its original frame interval;
 * this is what keeps all subsequent pointers and layout records untouched.
 */
export function replaceLegacy614aBitmap(
  reference: Buffer,
  patch: Legacy614aBitmapPatch,
  profile: Legacy614aProfile = MULTIDATA_ELEV_416_PROFILE
): Buffer {
  assertLegacy614aReference(reference, profile);
  const output = Buffer.from(reference);
  applyBitmapPatch(reference, output, patch, profile);
  output.writeUInt16LE(crc16CcittFalse(output.subarray(HEADER_BYTES)), 12);
  assertLegacy614aPatchedCarrier(reference, output, profile);
  return output;
}

/**
 * Applies feature records and one or more profiled bitmap replacements in a
 * single transaction. The exact reference is authenticated once; the output
 * CRC is regenerated only after every requested operation succeeds.
 */
export function patchLegacy614aBundle(
  reference: Buffer,
  patch: Legacy614aBundlePatch,
  profile: Legacy614aProfile = MULTIDATA_ELEV_416_PROFILE
): Buffer {
  const bitmapPatches = patch.bitmapPatches ?? [];
  if (!patch.features && bitmapPatches.length === 0) {
    throw new Error("Choose feature fields or at least one bitmap replacement to patch.");
  }
  assertLegacy614aReference(reference, profile);
  const output = Buffer.from(reference);
  if (patch.features) applyFeaturePatch(output, patch.features, profile);
  const seenBlocks = new Set<number>();
  for (const bitmapPatch of bitmapPatches) {
    if (seenBlocks.has(bitmapPatch.blockOffset)) {
      throw new Error(`Bitmap block 0x${bitmapPatch.blockOffset.toString(16)} was listed more than once.`);
    }
    seenBlocks.add(bitmapPatch.blockOffset);
    applyBitmapPatch(reference, output, bitmapPatch, profile);
  }
  output.writeUInt16LE(crc16CcittFalse(output.subarray(HEADER_BYTES)), 12);
  if (patch.features?.preserveReferenceFileCrc) preserveReferenceFileCrc(reference, output, profile);
  assertLegacy614aPatchedCarrier(
    reference,
    output,
    profile,
    patch.features?.preserveReferenceFileCrc === true
  );
  return output;
}

/**
 * Validates the exact pre-edit reference. This rejects other variants before
 * any byte is changed; adding another face requires a separately reviewed
 * profile rather than assuming a shared layout.
 */
export function assertLegacy614aReference(
  bytes: Buffer,
  profile: Legacy614aProfile = MULTIDATA_ELEV_416_PROFILE
): void {
  assertLegacy614aCarrierStructure(bytes, profile);
  if (sha256(bytes) !== profile.referenceSha256) {
    throw new Error(`This BIN is not the unmodified ${profile.name} reference.`);
  }
}

/**
 * Produces a fixed-length test BIN from an exact legacy reference. The input
 * is never mutated. AOD fields, bitmap data, and unknown records are retained
 * byte-for-byte so a hardware test isolates the coordinate/rectangle change.
 */
export function patchLegacy614aFeatures(
  reference: Buffer,
  patch: Legacy614aFeaturePatch,
  profile: Legacy614aProfile = MULTIDATA_ELEV_416_PROFILE
): Buffer {
  assertLegacy614aReference(reference, profile);
  const output = Buffer.from(reference);
  applyFeaturePatch(output, patch, profile);
  output.writeUInt16LE(crc16CcittFalse(output.subarray(HEADER_BYTES)), 12);
  if (patch.preserveReferenceFileCrc) preserveReferenceFileCrc(reference, output, profile);
  assertLegacy614aPatchedCarrier(reference, output, profile, patch.preserveReferenceFileCrc === true);
  return output;
}
