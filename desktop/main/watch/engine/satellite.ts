// The watch's Satellite Systems setting, the GPS mode every workout starts with. A port of CorosKit's
// WatchData/WatchSatelliteMode.swift. No command reads or writes it: it sits in the settings file's chunk 2 (the
// 28-byte "global" record, protobuf field 1), the low nibble of byte 15 (bits 1–2 of byte 10 mirror it). C-LINK sets it
// by sending back a small settings file with only that record changed (W332 3.2008.0, tried on a PACE Pro).
import { CorosError, crc32, put32, u16, u32 } from "./bytes";
import { encodeDataFile } from "./dataFile";
import { fieldBytes, protoFields } from "./protobuf";
import { GLOBAL_CHUNK, PRELUDE_BYTES, SETTINGS_FILE, settingsChunk } from "./settingsFile";

/** CorosKit's case names, which models.ts `satelliteChoices` uses too. */
export type SatelliteMode = "dualFrequency" | "allSystems" | "standard";
const RAW: Record<SatelliteMode, number> = { dualFrequency: 0, allSystems: 1, standard: 2 };
const BY_RAW: SatelliteMode[] = ["dualFrequency", "allSystems", "standard"];

const GLOBAL_FIELD = 1;
const GLOBAL_BYTES = 28;
const MODE_BYTE = 15;
/** Bytes 4–7 of the record hold zlib's CRC-32 of bytes 8–27; the firmware writes it again when the mode changes. */
const CHECKSUM_AT = 4;
/** The record bytes a mode change may touch: the checksum, the mirror in byte 10 and the mode in byte 15. */
const MODE_CHANGE_BYTES = new Set([4, 5, 6, 7, 10, 15]);

/** The contract's names (SyncBodies.gpsMode / satelliteMode). */
export const gpsModeName = (mode: SatelliteMode): "standard" | "all" | "dual" => (mode === "standard" ? "standard" : mode === "allSystems" ? "all" : "dual");
export function satelliteModeNamed(name: string): SatelliteMode | null {
  switch (name) {
    case "standard": return "standard";
    case "all": return "allSystems";
    case "dual": return "dualFrequency";
    default: return null;
  }
}

/** The mode in a settings file; null when it has no 28-byte global record. Anything but 0–2 is the factory 1. */
export function satelliteModeOf(file: Uint8Array): SatelliteMode | null {
  const message = settingsChunk(GLOBAL_CHUNK, file);
  if (!message) return null;
  const field = protoFields(message).find((f) => f.number === GLOBAL_FIELD);
  const global = field ? fieldBytes(field) : null;
  if (!global || global.length !== GLOBAL_BYTES) return null;
  return BY_RAW[global[MODE_BYTE] & 0x0f] ?? "allSystems";
}

/** Where the first chunk of `type` (sub 0) sits in the file, its 8-byte head included. */
export function chunkRange(type: number, file: Uint8Array): [number, number] {
  settingsChunk(type, file);
  let offset = 16 + PRELUDE_BYTES;
  while (offset + 8 <= file.length) {
    const end = offset + 8 + u16(file, offset + 4);
    if (u16(file, offset) === type && u16(file, offset + 2) === 0) return [offset, end];
    offset = end;
  }
  throw new CorosError(`The watch's settings file has no chunk ${type}.`);
}

/**
 * The file to send for `mode`: the read's prelude and header chunk (the watch's restore wants chunk 0 first) and the
 * global record with only the mode changed (byte 15's low nibble and its mirror in byte 10, bits 1–2) and its CRC-32
 * worked out again. The HF header is written again with creation time 0, as the COROS app sends files.
 */
export function satelliteSettingsFile(file: Uint8Array, mode: SatelliteMode): Buffer {
  const [hStart, hEnd] = chunkRange(0, file);
  const [gStart, gEnd] = chunkRange(GLOBAL_CHUNK, file);
  if (gEnd - gStart !== 8 + 2 + GLOBAL_BYTES || file[gStart + 8] !== 0x0a || file[gStart + 9] !== GLOBAL_BYTES) {
    throw new CorosError("The watch's settings file doesn't hold the GPS mode where C-LINK expects it.");
  }
  const chunk = Buffer.from(file.subarray(gStart, gEnd));
  const record = 10, raw = RAW[mode];
  chunk[record + MODE_BYTE] = (chunk[record + MODE_BYTE] & 0xf0) | raw;
  chunk[record + 10] = (chunk[record + 10] & ~0x06 & 0xff) | (raw << 1);
  put32(chunk, crc32(chunk.subarray(record + 8, record + GLOBAL_BYTES)), record + CHECKSUM_AT);
  const body = Buffer.concat([file.subarray(16, 16 + PRELUDE_BYTES), file.subarray(hStart, hEnd), chunk]);
  return encodeDataFile(body, SETTINGS_FILE);
}

/** A saved read's global record to send back as it was, in the same small file as `satelliteSettingsFile`. */
export function restoringFile(saved: Uint8Array): Buffer {
  const [hStart, hEnd] = chunkRange(0, saved);
  const [gStart, gEnd] = chunkRange(GLOBAL_CHUNK, saved);
  return encodeDataFile(Buffer.concat([saved.subarray(16, 16 + PRELUDE_BYTES), saved.subarray(hStart, hEnd), saved.subarray(gStart, gEnd)]), SETTINGS_FILE);
}

/** True when the 28-byte record's CRC-32 matches. */
export function checksumHolds(record: Uint8Array): boolean {
  return record.length === GLOBAL_BYTES && u32(record, CHECKSUM_AT) === crc32(record.subarray(8));
}

/** How two reads differ in one chunk; bytes are offsets in the protobuf, or in the 28-byte record for the global one. */
export interface SettingsDifference { chunk: string; bytes?: number[]; change?: string; isGlobal: boolean }

/** A change a new GPS mode makes: only the global record's mode, mirror and checksum bytes. */
export const isModeChange = (d: SettingsDifference): boolean => d.isGlobal && d.bytes !== undefined && d.bytes.every((b) => MODE_CHANGE_BYTES.has(b));

export function describeDifference(d: SettingsDifference): string {
  if (d.change !== undefined) return `${d.chunk}: ${d.change}`;
  const bytes = d.bytes ?? [];
  return `${d.chunk}: ${d.isGlobal ? "record " : ""}bytes ${bytes.slice(0, 12).join(", ")}${bytes.length > 12 ? "…" : ""}`;
}

/** How two reads of the settings file differ, chunk by chunk, leaving out what the watch writes afresh for each read. */
export function differences(before: Uint8Array, after: Uint8Array): SettingsDifference[] {
  const chunks = (file: Uint8Array): Map<string, Buffer> => {
    settingsChunk(0, file);
    const found = new Map<string, Buffer>();
    let offset = 16 + PRELUDE_BYTES;
    while (offset + 8 <= file.length) {
      const body = offset + 8, length = u16(file, offset + 4);
      const key = `type ${u16(file, offset)} sub ${u16(file, offset + 2)}`;
      if (u16(file, offset) !== 0) found.set(key, Buffer.concat([found.get(key) ?? Buffer.alloc(0), file.subarray(offset, body + length)]));
      offset = body + length;
    }
    return found;
  };
  const found: SettingsDifference[] = [];
  const a = Buffer.from(before), b = Buffer.from(after);
  if (!a.subarray(16, 20).equals(b.subarray(16, 20)) || !a.subarray(24, 26).equals(b.subarray(24, 26))) found.push({ chunk: "prelude", change: "changed", isGlobal: false });
  const old = chunks(a), next = chunks(b);
  const globalKey = `type ${GLOBAL_CHUNK} sub 0`;
  for (const key of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const isGlobal = key === globalKey;
    const x = old.get(key), y = next.get(key);
    if (!x) { found.push({ chunk: key, change: "added", isGlobal }); continue; }
    if (!y) { found.push({ chunk: key, change: "missing", isGlobal }); continue; }
    if (x.equals(y)) continue;
    if (x.length !== y.length) { found.push({ chunk: key, change: `${x.length} → ${y.length} bytes`, isGlobal }); continue; }
    const bytes: number[] = [];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) bytes.push(i - (isGlobal ? 10 : 8));
    found.push({ chunk: key, bytes, isGlobal });
  }
  return found;
}

/**
 * Whether a write did what it should: the watch reads back `mode` with a record whose checksum holds, and nothing
 * changed but the mode's bytes. The problems, empty when it worked.
 */
export function checkWrite(mode: SatelliteMode, before: Uint8Array, after: Uint8Array): string[] {
  const problems: string[] = [];
  const read = satelliteModeOf(after);
  if (read !== mode) problems.push(`the watch reads back ${read ?? "no mode"}, not ${mode}`);
  let range: [number, number] | null = null;
  try { range = chunkRange(GLOBAL_CHUNK, after); } catch { /* no record: the mode check above says so */ }
  if (range && range[1] - range[0] === 8 + 2 + GLOBAL_BYTES && !checksumHolds(after.subarray(range[0] + 10, range[1]))) {
    problems.push("the global record's CRC-32 doesn't match");
  }
  for (const d of differences(before, after)) if (!isModeChange(d) && d.chunk !== "prelude") problems.push(`also changed: ${describeDifference(d)}`);
  return problems;
}
