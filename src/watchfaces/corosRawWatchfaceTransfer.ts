/**
 * The captured COROS "SFT_8" watch-face transfer format.
 *
 * This module deliberately has no Electron or Bluetooth dependency.  It owns
 * the bytes that are safe to verify locally; a GATT implementation only has
 * to write the returned command/data packets and wait for notifications.
 *
 * The format is based on a PACE Pro (W332) transfer captured on 2026-07-12.
 * It is intentionally restricted to validated legacy `614A` BINs.  Compact
 * studio BINs do not contain the legacy live-data resources and are not an
 * interchangeable input format.
 */

export const COROS_SFT_DATA_INDEX = 0x08;
export const COROS_SFT_BLOCK_SIZE = 12_288;
export const COROS_SFT_PACKET_BYTES = 240;
export const COROS_SFT_PACKET_DATA_BYTES = COROS_SFT_PACKET_BYTES - 3;
export const COROS_SFT_PACKETS_PER_WINDOW = 26;
// PACE Pro's official app writes `01 00 00 03` after each block checksum.
export const COROS_SFT_PROTOCOL_VERSION = 0x01;

const LEGACY_HEADER_BYTES = 0x12;
const LEGACY_MAGIC = [0x36, 0x31, 0x34, 0x41] as const; // "614A"
const TRANSFER_PREFIX = [0x48, 0x46, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00] as const;

export interface CorosRawWatchfaceBin {
  watchFaceId: number;
  sizeBytes: number;
  declaredPayloadBytes: number;
  payloadCrc16: number;
  fullFileCrc16: number;
}

export interface CorosSftBlock {
  /** Byte position in the framed transfer stream, always divisible by 256. */
  offset: number;
  /** Bytes remaining from this block onward, including this block. */
  remainingBytes: number;
  crc16: number;
  byteSum: number;
  bytes: Uint8Array;
}

export interface CorosRawWatchfaceTransfer {
  bin: CorosRawWatchfaceBin;
  /** The 16-byte COROS transport prefix followed by the raw BIN. */
  bytes: Uint8Array;
  blocks: CorosSftBlock[];
}

export interface CorosSftDataWindow {
  /** The packet index resets to zero for each 26-packet window. */
  packetIndex: number;
  /** One write-without-response value for the bulk characteristic. */
  bytes: Uint8Array;
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! * 0x1000000)
  ) >>> 0;
}

function readInt32Le(bytes: Uint8Array, offset: number): number {
  const value = readUint32Le(bytes, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function writeUint32Le(bytes: Uint8Array, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("The COROS transfer value must fit in an unsigned 32-bit field.");
  }
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = Math.floor(value / 0x1000000) & 0xff;
}

/** CRC-16/CCITT-FALSE used by legacy `614A` files and SFT blocks. */
export function crc16CcittFalse(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** The SFT block's second check is the unsigned 8-bit sum of block bytes. */
export function corosByteSum(bytes: Uint8Array): number {
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) & 0xff;
  return sum;
}

export function inspectCorosRawWatchfaceBin(rawBytes: Uint8Array): CorosRawWatchfaceBin {
  if (rawBytes.length < LEGACY_HEADER_BYTES) {
    throw new Error("The watch-face BIN is smaller than the 614A header.");
  }
  if (!LEGACY_MAGIC.every((value, index) => rawBytes[index] === value)) {
    throw new Error("Direct install currently accepts legacy 614A watch-face BINs only.");
  }

  const declaredPayloadBytes = readUint32Le(rawBytes, 8);
  if (declaredPayloadBytes !== rawBytes.length - LEGACY_HEADER_BYTES) {
    throw new Error(
      `The 614A header declares ${declaredPayloadBytes} payload bytes, but the file contains ${rawBytes.length - LEGACY_HEADER_BYTES}.`
    );
  }

  const payloadCrc16 = rawBytes[12]! | (rawBytes[13]! << 8);
  const calculatedPayloadCrc16 = crc16CcittFalse(rawBytes.subarray(LEGACY_HEADER_BYTES));
  if (payloadCrc16 !== calculatedPayloadCrc16) {
    throw new Error(
      `The 614A payload CRC is invalid (header ${toHex16(payloadCrc16)}, calculated ${toHex16(calculatedPayloadCrc16)}).`
    );
  }

  return {
    watchFaceId: readInt32Le(rawBytes, 4),
    sizeBytes: rawBytes.length,
    declaredPayloadBytes,
    payloadCrc16,
    fullFileCrc16: crc16CcittFalse(rawBytes)
  };
}

/**
 * Creates the 16-byte transfer envelope observed before every raw BIN.
 * Its final word is not a nonce: it is a CRC of the preceding 14 bytes.
 */
export function createCorosRawWatchfaceEnvelope(rawBytes: Uint8Array): Uint8Array {
  const envelope = new Uint8Array(16);
  envelope.set(TRANSFER_PREFIX, 0);
  writeUint32Le(envelope, 8, rawBytes.length);
  const fileCrc = crc16CcittFalse(rawBytes);
  envelope[12] = fileCrc & 0xff;
  envelope[13] = fileCrc >>> 8;
  const envelopeCrc = crc16CcittFalse(envelope.subarray(0, 14));
  envelope[14] = envelopeCrc & 0xff;
  envelope[15] = envelopeCrc >>> 8;
  return envelope;
}

export function prepareCorosRawWatchfaceTransfer(rawBytes: Uint8Array): CorosRawWatchfaceTransfer {
  const rawCopy = rawBytes.slice();
  const bin = inspectCorosRawWatchfaceBin(rawCopy);
  const envelope = createCorosRawWatchfaceEnvelope(rawCopy);
  const bytes = new Uint8Array(envelope.length + rawCopy.length);
  bytes.set(envelope, 0);
  bytes.set(rawCopy, envelope.length);

  const blocks: CorosSftBlock[] = [];
  for (let offset = 0; offset < bytes.length; offset += COROS_SFT_BLOCK_SIZE) {
    const blockBytes = bytes.subarray(offset, Math.min(offset + COROS_SFT_BLOCK_SIZE, bytes.length));
    blocks.push({
      offset,
      remainingBytes: bytes.length - offset,
      crc16: crc16CcittFalse(blockBytes),
      byteSum: corosByteSum(blockBytes),
      bytes: blockBytes
    });
  }

  return { bin, bytes, blocks };
}

/**
 * Builds the SFT_8 control write for one 12,288-byte block.
 *
 * Captured layout:
 *   78 00 08 00 | offset/256 (u24 LE) | block bytes (u16 LE) |
 *   remaining (u32 LE) | block CRC16 LE | byte sum | 01 00 00 03 | check
 *
 * The final block uses its short actual byte length in both the block-bytes
 * and remaining fields. Byte 20 is `(sum(bytes[0..19]) & 0xff) ^ 0x88`.
 */
export function createCorosSftStartCommand(block: CorosSftBlock): Uint8Array {
  if (block.offset % 256 !== 0) {
    throw new Error("A COROS SFT block offset must be divisible by 256.");
  }
  const offsetUnits = block.offset / 256;
  if (offsetUnits > 0xffffff) {
    throw new Error("The COROS SFT offset exceeds the observed 24-bit field.");
  }
  const command = new Uint8Array(21);
  command.set([0x78, 0x00, COROS_SFT_DATA_INDEX, 0x00], 0);
  command[4] = offsetUnits & 0xff;
  command[5] = (offsetUnits >>> 8) & 0xff;
  command[6] = (offsetUnits >>> 16) & 0xff;
  command[7] = block.bytes.length & 0xff;
  command[8] = block.bytes.length >>> 8;
  writeUint32Le(command, 9, block.remainingBytes);
  command[13] = block.crc16 & 0xff;
  command[14] = block.crc16 >>> 8;
  command[15] = block.byteSum;
  command[16] = COROS_SFT_PROTOCOL_VERSION;
  command[17] = 0x00;
  command[18] = 0x00;
  command[19] = 0x03;
  command[20] = corosByteSum(command.subarray(0, 20)) ^ 0x88;
  return command;
}

/**
 * Splits one SFT block into bulk-characteristic writes.  The counter resets
 * after every 26 packets; callers wait for the bulk `78 00` notification at
 * each such boundary before sending the next group.
 */
export function createCorosSftDataWindows(block: CorosSftBlock): CorosSftDataWindow[][] {
  const packets: CorosSftDataWindow[] = [];
  for (let offset = 0, packetIndex = 0; offset < block.bytes.length; offset += COROS_SFT_PACKET_DATA_BYTES, packetIndex += 1) {
    const chunk = block.bytes.subarray(offset, offset + COROS_SFT_PACKET_DATA_BYTES);
    const bytes = new Uint8Array(3 + chunk.length);
    bytes[0] = 0x78;
    bytes[1] = packetIndex % COROS_SFT_PACKETS_PER_WINDOW;
    bytes[2] = COROS_SFT_DATA_INDEX;
    bytes.set(chunk, 3);
    packets.push({ packetIndex: bytes[1]!, bytes });
  }

  const windows: CorosSftDataWindow[][] = [];
  for (let offset = 0; offset < packets.length; offset += COROS_SFT_PACKETS_PER_WINDOW) {
    windows.push(packets.slice(offset, offset + COROS_SFT_PACKETS_PER_WINDOW));
  }
  return windows;
}

/** The transaction stop code reported after SFT_8 reaches the final block. */
export function createCorosSftStopCommand(): Uint8Array {
  return Uint8Array.from([0x78, 0x08, 0x00, 0x00, 0x01]);
}

function toHex16(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}
