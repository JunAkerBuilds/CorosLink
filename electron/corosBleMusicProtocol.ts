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

/** Validates the HF file and HS header for a storage category, returning its length-delimited records. */
function storageRecords(file: Buffer, category: number): Buffer[] {
  if (file.length < 44 || file.length > MAX_PAGE_BYTES || file.toString("ascii", 0, 2) !== "HF" ||
      file[2] !== 0 || file[3] !== 93 || file.readUInt32LE(8) !== file.length - 16 ||
      crc16(file.subarray(0, 14)) !== file.readUInt16LE(14) ||
      crc16(file.subarray(16)) !== file.readUInt16LE(12)) invalid();
  const body = file.subarray(16);
  if (body.toString("ascii", 0, 2) !== "HS" || body[2] !== 0 || body.readUInt32LE(3) !== category ||
      body.readUInt16LE(10) !== 44 || crc16(body.subarray(0, 26)) !== body.readUInt16LE(26) ||
      body.readUInt32LE(14) !== body.length - 28) invalid();
  // W332 computes the HS payload CRC from file +60 rather than the actual
  // payload at +44. HF's full-body CRC and each SFT block still cover all bytes.
  const records: Buffer[] = [];
  for (let offset = 28; offset < body.length;) {
    if (body.length - offset < 4) invalid();
    const size = body.readUInt32LE(offset); offset += 4;
    if (size > body.length - offset || records.length >= 256) invalid();
    records.push(body.subarray(offset, offset + size));
    offset += size;
  }
  if (records.length !== body.readUInt32LE(22)) invalid();
  return records;
}

/** Validates the HF file, HS category header and length-delimited music pages. */
export function decodeMusicInventoryPage(file: Buffer): CorosBleMusicTrack[] {
  return storageRecords(file, 0).flatMap(musicRows);
}

export interface CorosNeteasePlaylist { id: string; songIds: string[]; createdAt: number }

/** Each NetEase playlist's play_list_info bytes as the watch stored them, for building a delete. */
export function neteasePlaylistRecords(file: Buffer): Map<string, Buffer> {
  const records = new Map<string, Buffer>();
  for (const record of storageRecords(file, 3)) for (const info of fields(record)) {
    if (info.tag !== 1 || !Buffer.isBuffer(info.value)) continue;
    const id = fields(info.value).find(field => field.tag === 2)?.value;
    if (Buffer.isBuffer(id)) records.set(id.toString("latin1"), info.value);
  }
  return records;
}

/**
 * Storage category 3: one Music163StorageInfo per record, whose play_list_info (1) holds
 * play_list_id (2), repeated music_file_id (3) and create_utc (4). The watch keeps no titles here.
 */
export function decodeNeteaseInventory(file: Buffer): CorosNeteasePlaylist[] {
  const playlists: CorosNeteasePlaylist[] = [];
  const text = (value: number | Buffer) => {
    if (!Buffer.isBuffer(value) || !/^[A-Za-z0-9_-]{1,32}$/.test(value.toString("latin1"))) invalid();
    return (value as Buffer).toString("ascii");
  };
  for (const record of storageRecords(file, 3)) for (const info of fields(record)) {
    if (info.tag !== 1) continue;
    if (!Buffer.isBuffer(info.value) || playlists.length >= 64) invalid();
    let id: string | undefined, createdAt = 0;
    const songIds: string[] = [];
    for (const field of fields(info.value as Buffer)) {
      if (field.tag === 2) id = text(field.value);
      else if (field.tag === 3) { if (songIds.length >= 1000) invalid(); songIds.push(text(field.value)); }
      else if (field.tag === 4 && typeof field.value === "number") createdAt = field.value;
    }
    if (!id) invalid();
    playlists.push({ id: id!, songIds, createdAt });
  }
  return playlists;
}

function varint(value: number): Buffer {
  const bytes: number[] = [];
  do { bytes.push((value % 128) | (value > 127 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return Buffer.from(bytes);
}

/** HF/HS storage file 93 with one length-prefixed record, as the watch's delete expects. */
function storageFile(category: number, proto: Buffer): Buffer {
  const file = Buffer.alloc(48 + proto.length), body = file.subarray(16);
  file.write("HF"); file[3] = 93; file.writeUInt32LE(body.length, 8);
  body.write("HS"); body.writeUInt32LE(category, 3); body.writeUInt16LE(crc16(proto), 8); body.writeUInt16LE(44, 10);
  body.writeUInt32LE(4 + proto.length, 14); body.writeUInt32LE(4 + proto.length, 18);
  body.writeUInt32LE(1, 22); body.writeUInt16LE(crc16(body.subarray(0, 26)), 26);
  body.writeUInt32LE(proto.length, 28); proto.copy(body, 32);
  file.writeUInt16LE(crc16(body), 12); file.writeUInt16LE(crc16(file.subarray(0, 14)), 14);
  return file;
}

/**
 * Removes songs from one NetEase playlist (storage category 3). Like the COROS app, it copies the
 * playlist record the watch returned and lists only the songs to remove. The watch deletes a
 * song's file once no playlist uses it, and the playlist once it's empty.
 */
export function encodeNeteaseDeleteFile(record: Buffer, songIds: string[]): Buffer {
  const id = /^[A-Za-z0-9_-]{1,32}$/;
  if (!songIds.length || songIds.length > 500 || new Set(songIds).size !== songIds.length || songIds.some(song => !id.test(song))) {
    throw new Error("Refresh the watch's music and choose NetEase songs to delete.");
  }
  // Rebuild in field order (the app's protobuf builder does the same): the record's own fields, but songs 3 = only these.
  const parts: Array<[number, Buffer]> = [];
  for (let offset = 0; offset < record.length;) {
    const start = offset;
    let key = 0;
    for (let shift = 0; ; shift += 7) { if (offset >= record.length || shift > 28) invalid(); const byte = record[offset++]!; key += (byte & 127) * 2 ** shift; if (!(byte & 128)) break; }
    const wire = key & 7;
    if (wire === 0) { while (offset < record.length && record[offset]! & 128) offset++; offset++; }
    else if (wire === 2) {
      let size = 0;
      for (let shift = 0; ; shift += 7) { if (offset >= record.length || shift > 28) invalid(); const byte = record[offset++]!; size += (byte & 127) * 2 ** shift; if (!(byte & 128)) break; }
      offset += size;
    } else invalid();
    if (offset > record.length) invalid();
    if (key >>> 3 !== 3) parts.push([key >>> 3, record.subarray(start, offset)]);
  }
  const playlistId = fields(record).find(field => field.tag === 2)?.value;
  if (!Buffer.isBuffer(playlistId) || !id.test(playlistId.toString("latin1"))) invalid();
  for (const song of songIds) parts.push([3, Buffer.concat([Buffer.from([0x1a]), varint(song.length), Buffer.from(song, "ascii")])]);
  const info = Buffer.concat(parts.sort((a, b) => a[0] - b[0]).map(([, bytes]) => bytes));
  const file = storageFile(3, Buffer.concat([Buffer.from([10]), varint(info.length), info]));
  if (file.length > 4096) throw new Error("Delete fewer NetEase songs at once.");
  return file;
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
  return storageFile(0, Buffer.concat([Buffer.from([10]), varint(row.length), row]));
}

/** 0x78 header for a storage delete; +16 is the storage category (0 local music, 3 NetEase, checked on a W332). */
export function encodeMusicDeleteHeader(file: Buffer, category = 0): Buffer {
  if (!file.length || file.length > (category ? 4096 : 512) || ![0, 3].includes(category)) throw new Error("Invalid Bluetooth music delete request.");
  const header = Buffer.alloc(21);
  header[0] = 0x78; header[2] = 93;
  header.writeUInt16LE(file.length, 7); header.writeUInt32LE(file.length, 9);
  header.writeUInt16LE(crc16(file), 13);
  header[15] = file.reduce((sum, byte) => (sum + byte) & 255, 0); header[16] = category; header[19] = 3;
  header[20] = header.subarray(2, 20).reduce((sum, byte) => (sum + byte) & 255, 0);
  return header;
}

/** C1 storage completion is separate from the 78 transport acknowledgement. */
export function requireMusicDeleteAcknowledgement(payload: Buffer, category = 0): void {
  // [2] echoes the storage category.
  if (payload.length !== 4 || payload[0] !== 1 || payload[1] !== 1 || payload[2] !== category) {
    throw new Error("The watch returned an invalid music delete response.");
  }
  if (payload[3] === 0x1b) throw new Error(category === 3
    ? "The watch's music player has this song loaded. Stop playback on the watch (play and stop a different song if it stays selected), then refresh and try again."
    : "Stop playing this track on the watch before deleting it.");
  if (payload[3] !== 1) throw new Error("The watch could not delete this track. Refresh its music and try again.");
}
