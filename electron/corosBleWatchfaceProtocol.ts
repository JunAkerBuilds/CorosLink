import { crc16Ccitt } from "./corosBleRouteProtocol";
import { readLayoutHeaders } from "./corosBinLayout";
import { watchfaceTargetsForMagic } from "./watchfaceTargets";

export const WATCHFACE_FILE_INDEX = 8;
export const WATCHFACE_MAX_BYTES = 0x320000;
export const WATCHFACE_BLOCK_BYTES = 4096;

/**
 * Command 96 returns little-endian face IDs, no result prefix. W332 3.2008.0 answers with five or
 * ten and has ten slots, as CorosLink has always read it (`padsToTen`). Other watches get only the
 * slots they report, so a face never goes to a slot they may not have.
 */
export function decodeWatchfaceInventory(payload: Buffer, padsToTen = true): number[] {
  if (padsToTen && (payload.length === 20 || payload.length === 40)) {
    return Array.from({ length: 10 }, (_, slot) => slot * 4 < payload.length ? payload.readUInt32LE(slot * 4) : 0xffffffff);
  }
  if (payload.length % 4 !== 0 || payload.length < 4 || payload.length > 40) {
    throw new Error(`The watch returned an unsupported watch face inventory (${payload.length} bytes).`);
  }
  return Array.from({ length: payload.length / 4 }, (_, slot) => payload.readUInt32LE(slot * 4));
}

const validSlots = (ids: number[]) => ids.length >= 1 && ids.length <= 10;

export function emptyWatchfaceSlot(ids: number[]): number {
  const slot = ids.indexOf(0xffffffff);
  if (!validSlots(ids) || slot < 0) throw new Error("All watch face slots are occupied. Refresh slots and choose a face to replace.");
  return slot;
}

export function selectWatchfaceSlot(ids: number[], target?: { slot: number; expectedFaceId: number | null; replaceExisting: boolean }): number {
  if (!target) return emptyWatchfaceSlot(ids);
  if (!validSlots(ids) || !Number.isInteger(target.slot) || target.slot < 0 || target.slot >= ids.length) {
    throw new Error("Choose a valid watch face slot.");
  }
  const expected = target.expectedFaceId ?? 0xffffffff;
  if (!Number.isSafeInteger(expected) || expected < 0 || expected > 0xffffffff || ids[target.slot] !== expected) {
    throw new Error("The selected watch face slot changed. Refresh slots and choose it again.");
  }
  if (expected !== 0xffffffff && target.replaceExisting !== true) {
    throw new Error("Choose the occupied slot for replacement before syncing.");
  }
  return target.slot;
}

/**
 * Editable DAT/ZIP archives must be compiled before this local transfer. `magic` is the BIN's screen
 * header ("614A" for PACE Pro, "062R" for APEX 4 and NOMAD), checked against the watch before sending.
 */
export function encodeWatchfaceFile(body: Buffer): { file: Buffer; faceId: number; magic: string } {
  const magic = body.length >= 4 ? body.toString("latin1", 0, 4) : "";
  if (body.length < 0x340 || body.length + 16 > WATCHFACE_MAX_BYTES || !watchfaceTargetsForMagic(magic).length) {
    throw new Error("Choose a compiled COROS watch face BIN smaller than 3.2 MB. Editable DAT and ZIP files need compilation first.");
  }
  readLayoutHeaders(body);
  if (body.readUInt32LE(8) !== body.length - 18 || body.readUInt16LE(12) !== crc16Ccitt(body.subarray(18))) {
    throw new Error("The compiled watch face length or checksum is invalid.");
  }
  const faceId = body.readUInt32LE(4);
  if (faceId === 0xffffffff) throw new Error("The compiled watch face has an invalid identifier.");
  const file = Buffer.alloc(16 + body.length);
  file.write("HF", 0, "ascii"); file[3] = WATCHFACE_FILE_INDEX;
  file.writeUInt32LE(body.length, 8); file.writeUInt16LE(crc16Ccitt(body), 12);
  file.writeUInt16LE(crc16Ccitt(file.subarray(0, 14)), 14); body.copy(file, 16);
  return { file, faceId, magic };
}

export function encodeWatchfaceBlockHeader(block: Buffer, offset: number, total: number, slot: number): Buffer {
  if (!block.length || block.length > WATCHFACE_BLOCK_BYTES || !Number.isInteger(offset) || offset < 0 ||
      offset + block.length > total || total > WATCHFACE_MAX_BYTES || !Number.isInteger(slot) || slot < 0 || slot > 9) {
    throw new Error("Invalid watch face transfer block.");
  }
  const header = Buffer.alloc(21);
  header[0] = 0x78; header[2] = WATCHFACE_FILE_INDEX;
  header.writeUInt32LE(offset, 3); header.writeUInt16LE(block.length, 7);
  header.writeUInt32LE(total - offset, 9); header.writeUInt16LE(crc16Ccitt(block), 13);
  header[15] = block.reduce((sum, byte) => (sum + byte) & 255, 0);
  header[16] = slot; header[19] = 3;
  header[20] = header.subarray(2, 20).reduce((sum, byte) => (sum + byte) & 255, 0);
  return header;
}
