// Files the phone app sends to the watch with SendFile: an "HF" header around a body, sent in 4 KB blocks, each
// announced by a 21-byte header on the control channel. A port of CorosKit's WatchDataFile (WatchData/WatchCommands.swift).
import { CorosError, crc16Ccitt, put16, put32, sum8 } from "./bytes";
import { COROS_EPOCH } from "./systemBind";

export const WEATHER_FILE = 80;
export const BLOCK_BYTES = 4096;
/** Largest file C-LINK pushes, as CorosLink's helper limits it. */
const MAXIMUM_BYTES = 65_536;

/** The 16-byte "HF" header (file type, creation time in seconds since 2014, body length, CRCs), then the body. */
export function encodeDataFile(body: Uint8Array, fileId: number, created?: Date): Buffer {
  const file = Buffer.alloc(16 + body.length);
  file[0] = 0x48; file[1] = 0x46; file[3] = fileId;
  if (created) put32(file, Math.max(0, Math.trunc(created.getTime() / 1000 - COROS_EPOCH)), 4);
  put32(file, body.length, 8);
  put16(file, crc16Ccitt(body), 12);
  put16(file, crc16Ccitt(file.subarray(0, 14)), 14);
  file.set(body, 16);
  return file;
}

/** SendFile block header: [0x78 0][file][offset u32][len u16][remaining u32][crc16][sum][extra 0 0][3][sum]. */
export function blockHeader(fileId: number, block: Uint8Array, offset: number, total: number, extra = 0): Buffer {
  if (block.length === 0 || block.length > BLOCK_BYTES || offset < 0 || offset + block.length > total || total > MAXIMUM_BYTES || extra >= 255) {
    throw new CorosError("The watch file is invalid.");
  }
  const header = Buffer.alloc(21);
  header[0] = 0x78; header[2] = fileId;
  put32(header, offset, 3);
  put16(header, block.length, 7);
  put32(header, total - offset, 9);
  put16(header, crc16Ccitt(block), 13);
  header[15] = sum8(block);
  header[16] = extra;
  header[19] = 3;
  header[20] = sum8(header.subarray(2, 20));
  return header;
}
