// The watch's settings file (SyncData file 54), the snapshot the COROS app reads for its settings backup. A port of
// CorosKit's WatchData/WatchSettingsFile.swift. Layout: the 16-byte "HF" header (file 54, body length, CRC-16 of the
// body, CRC-16 of the header), a 12-byte prelude, then chunks `[type u16][sub u16][protobuf length u16][0 u16]` +
// protobuf. Type 1 sub 0 is NanoPB SystemSetting, whose field 2 (`person`) is the 71-byte SyncUserInfo block.
import { CorosError, crc16Ccitt, put16, put32, u16, u32 } from "./bytes";
import { encodeDataFile } from "./dataFile";
import { fieldBytes, protoFields, ProtoWriter } from "./protobuf";

export const SETTINGS_FILE = 54;
export const PRELUDE_BYTES = 12;
const SYSTEM_SETTING = 1;
const PERSON_FIELD = 2;
export const USER_INFO_BYTES = 71;
/** The chunk that holds the watch's 28-byte "global" record (WatchSatelliteMode). */
export const GLOBAL_CHUNK = 2;

/** The global record as a PACE Pro (3.2008/3.2106) sent it, set to dual frequency. */
export const SAMPLE_GLOBAL = Buffer.from([0x5a, 0x01, 0x00, 0x00, 0xa1, 0x0d, 0xa6, 0x70, 0x1a, 0x0a, 0x01, 0x04, 0xe0, 0x10, 0x00, 0x10,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]);

/** The protobuf of the first chunk of `type` (sub 0), once the header and its CRCs check out; null when there's none. */
export function settingsChunk(type: number, file: Uint8Array): Buffer | null {
  const damaged = new CorosError("The watch's settings file is damaged.");
  if (file.length < 16 + PRELUDE_BYTES || file[0] !== 0x48 || file[1] !== 0x46 || file[3] !== SETTINGS_FILE
    || u32(file, 8) !== file.length - 16
    || crc16Ccitt(file.subarray(0, 14)) !== u16(file, 14) || crc16Ccitt(file.subarray(16)) !== u16(file, 12)) throw damaged;
  let offset = 16 + PRELUDE_BYTES;
  while (offset + 8 <= file.length) {
    const body = offset + 8, length = u16(file, offset + 4);
    if (body + length > file.length) throw damaged;
    if (u16(file, offset) === type && u16(file, offset + 2) === 0) return Buffer.from(file.subarray(body, body + length));
    offset = body + length;
  }
  return null;
}

/** The SyncUserInfo block (71 bytes), once the header and its CRCs check out. Another module's SleepProfile reads it too. */
export function userInfo(file: Uint8Array): Buffer {
  const message = settingsChunk(SYSTEM_SETTING, file);
  const person = message ? protoFields(message).find((f) => f.number === PERSON_FIELD) : undefined;
  const bytes = person ? fieldBytes(person) : null;
  if (!bytes || bytes.length !== USER_INFO_BYTES) throw new CorosError("The watch's settings file has no profile.");
  return bytes;
}

/**
 * A settings file in the watch's layout around a SyncUserInfo block, for the simulated watch and tests: the header
 * chunk, SystemSetting with fields around `person` as a PACE Pro writes them, then sport settings to about the 10 KB a
 * PACE Pro sends.
 */
export function encodeSettingsFile(info: Uint8Array, global: Uint8Array = SAMPLE_GLOBAL): Buffer {
  const chunk = (type: number, message: Uint8Array, sub = 0): Buffer => {
    const head = Buffer.alloc(8);
    put16(head, type, 0); put16(head, sub, 2); put16(head, message.length, 4);
    return Buffer.concat([head, message]);
  };
  const header = new ProtoWriter().int(1, 11).string(2, "SIM001").int(3, 403_440_052).data;
  const setting = new ProtoWriter().int(1, 0x11df_ff7d).message(PERSON_FIELD, info)
    .message(3, Buffer.alloc(16, 0x11)).message(5, Buffer.alloc(8)).int(15, 4).data;
  const prelude = Buffer.alloc(PRELUDE_BYTES);
  put32(prelude, 0x0001_5aa5, 0);
  const parts = [prelude, chunk(0, header), chunk(SYSTEM_SETTING, setting), chunk(GLOBAL_CHUNK, new ProtoWriter().message(1, global).data)];
  for (let sport = 0; sport < 45; sport++) parts.push(chunk(3, new ProtoWriter().int(1, sport + 1).message(2, Buffer.alloc(186, 9)).data, sport));
  return encodeDataFile(Buffer.concat(parts), SETTINGS_FILE);
}
