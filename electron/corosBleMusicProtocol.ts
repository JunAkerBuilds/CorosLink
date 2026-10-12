import { TextDecoder } from "node:util";
import { crc16Ccitt as crc16 } from "./corosBleRouteProtocol";
import type { CorosBleMusicTrack } from "./corosBleMusicTypes";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const MAX_PAGE_BYTES = 262_144;

function invalid(): never { throw new Error("The watch returned an invalid music inventory."); }

/** Bounded protobuf wire reader for the W332 music-list descriptor at 0062786c. */
function fields(data: Buffer): Array<{ tag: number; value: number | Buffer }> {
  let offset = 0;
  function varint(): number {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (offset >= data.length) invalid();
      const byte = data[offset++]!;
      value += (byte & 127) * 2 ** (i * 7);
      if (!(byte & 128)) {
        if (value > 0xffffffff) invalid();
        return value;
      }
    }
    return invalid();
  }
  const result: Array<{ tag: number; value: number | Buffer }> = [];
  while (offset < data.length) {
    const key = varint(), tag = key >>> 3, wire = key & 7;
    if (!tag || result.length >= 1000) invalid();
    if (wire === 0) result.push({ tag, value: varint() });
    else if (wire === 2) {
      const size = varint();
      if (size > data.length - offset) invalid();
      result.push({ tag, value: data.subarray(offset, offset + size) });
      offset += size;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (size > data.length - offset) invalid();
      offset += size;
    } else invalid();
  }
  return result;
}

function musicRows(proto: Buffer): CorosBleMusicTrack[] {
  const tracks: CorosBleMusicTrack[] = [];
  for (const field of fields(proto)) {
    if (field.tag !== 1) continue;
    if (!Buffer.isBuffer(field.value) || tracks.length >= 20) invalid();
    const row = new Map<number, number | Buffer>();
    for (const entry of fields(field.value)) {
      if (entry.tag > 4) continue;
      if (row.has(entry.tag)) invalid();
      row.set(entry.tag, entry.value);
    }
    const nameBytes = row.get(3), size = row.get(2), watchId = row.get(4);
    if (!Buffer.isBuffer(nameBytes) || nameBytes.length === 0 || nameBytes.length > 259 ||
        typeof size !== "number" || typeof watchId !== "number") invalid();
    let name: string;
    try { name = utf8.decode(nameBytes); } catch { return invalid(); }
    if (name.includes("\0") || /[\r\n]/.test(name) || !name.startsWith("/emmc2:/Music/")) invalid();
    const watchPath = name;
    name = name.slice("/emmc2:/Music/".length);
    if (!name || name.includes("/") || !name.toLowerCase().endsWith(".mp3")) invalid();
    tracks.push({ name, watchPath, sizeBytes: size, watchId });
  }
  return tracks;
}

/** Validates the HF file, HS category header and length-delimited music pages. */
export function decodeMusicInventoryPage(file: Buffer): CorosBleMusicTrack[] {
  if (file.length < 44 || file.length > MAX_PAGE_BYTES || file.toString("ascii", 0, 2) !== "HF" ||
      file[2] !== 0 || file[3] !== 93 || file.readUInt32LE(8) !== file.length - 16 ||
      crc16(file.subarray(0, 14)) !== file.readUInt16LE(14) ||
      crc16(file.subarray(16)) !== file.readUInt16LE(12)) invalid();
  const body = file.subarray(16);
  if (body.toString("ascii", 0, 2) !== "HS" || body[2] !== 0 || body.readUInt32LE(3) !== 0 ||
      body.readUInt16LE(10) !== 44 || crc16(body.subarray(0, 26)) !== body.readUInt16LE(26) ||
      body.readUInt32LE(14) !== body.length - 28) invalid();
  // W332 computes the HS payload CRC from file +60 rather than the actual
  // payload at +44. HF's full-body CRC and each SFT block still cover all bytes.
  const result: CorosBleMusicTrack[] = [];
  let records = 0;
  for (let offset = 28; offset < body.length;) {
    if (body.length - offset < 4) invalid();
    const size = body.readUInt32LE(offset); offset += 4;
    if (size > body.length - offset || ++records > 256) invalid();
    result.push(...musicRows(body.subarray(offset, offset + size)));
    offset += size;
  }
  if (records !== body.readUInt32LE(22)) invalid();
  return result;
}

function varint(value: number): Buffer {
  const bytes: number[] = [];
  do { bytes.push((value % 128) | (value > 127 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return Buffer.from(bytes);
}

/** A single local MP3 row, never an arbitrary storage category or file path. */
export function encodeMusicDeleteFile(track: CorosBleMusicTrack): Buffer {
  if (!track || typeof track.name !== "string" || typeof track.watchPath !== "string" ||
      track.watchPath !== `/emmc2:/Music/${track.name}` || /[\x00-\x1f/\\]/.test(track.name) ||
      !track.name.toLowerCase().endsWith(".mp3") || Buffer.byteLength(track.watchPath, "utf8") > 259 ||
      ![track.watchId, track.sizeBytes].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff)) {
    throw new Error("Refresh the watch's music and choose a valid MP3 to delete.");
  }
  const name = Buffer.from(track.watchPath, "utf8");
  const row = Buffer.concat([Buffer.from([8, 1, 16]), varint(track.sizeBytes),
    Buffer.from([26]), varint(name.length), name, Buffer.from([32]), varint(track.watchId)]);
  const proto = Buffer.concat([Buffer.from([10]), varint(row.length), row]);
  const file = Buffer.alloc(48 + proto.length), body = file.subarray(16);
  file.write("HF"); file[3] = 93; file.writeUInt32LE(body.length, 8);
  body.write("HS"); body.writeUInt16LE(crc16(proto), 8); body.writeUInt16LE(44, 10);
  body.writeUInt32LE(4 + proto.length, 14); body.writeUInt32LE(4 + proto.length, 18);
  body.writeUInt32LE(1, 22); body.writeUInt16LE(crc16(body.subarray(0, 26)), 26);
  body.writeUInt32LE(proto.length, 28); proto.copy(body, 32);
  file.writeUInt16LE(crc16(body), 12); file.writeUInt16LE(crc16(file.subarray(0, 14)), 14);
  return file;
}

export function encodeMusicDeleteHeader(file: Buffer): Buffer {
  if (!file.length || file.length > 512) throw new Error("Invalid Bluetooth music delete request.");
  const header = Buffer.alloc(21);
  header[0] = 0x78; header[2] = 93;
  header.writeUInt16LE(file.length, 7); header.writeUInt32LE(file.length, 9);
  header.writeUInt16LE(crc16(file), 13);
  header[15] = file.reduce((sum, byte) => (sum + byte) & 255, 0); header[19] = 3;
  header[20] = header.subarray(2, 20).reduce((sum, byte) => (sum + byte) & 255, 0);
  return header;
}

/** C1 storage completion is separate from the 78 transport acknowledgement. */
export function requireMusicDeleteAcknowledgement(payload: Buffer): void {
  if (payload.length !== 4 || payload[0] !== 1 || payload[1] !== 1 || payload[2] !== 0) {
    throw new Error("The watch returned an invalid music delete response.");
  }
  if (payload[3] === 0x1b) throw new Error("Stop playing this track on the watch before deleting it.");
  if (payload[3] !== 1) throw new Error("The watch could not delete this track. Refresh its music and try again.");
}
