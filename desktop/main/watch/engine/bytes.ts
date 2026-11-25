// Little-endian helpers and checksums the COROS protocol uses. A port of CorosKit's Protocol/Bytes.swift.
// Everything works on Uint8Array (Buffer is one), offsets from its start.

export const u8 = (b: Uint8Array, at: number): number => b[at];
export const u16 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8);
export const u32 = (b: Uint8Array, at: number): number => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
export const u16BE = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1];
export const u32BE = (b: Uint8Array, at: number): number => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

export function put16(b: Uint8Array, value: number, at: number): void {
  b[at] = value & 0xff;
  b[at + 1] = (value >>> 8) & 0xff;
}
export function put32(b: Uint8Array, value: number, at: number): void {
  for (let i = 0; i < 4; i++) b[at + i] = (value >>> (i * 8)) & 0xff;
}
export const le16 = (value: number): Buffer => { const b = Buffer.alloc(2); put16(b, value, 0); return b; };
export const le32 = (value: number): Buffer => { const b = Buffer.alloc(4); put32(b, value, 0); return b; };

/** The byte sum COROS appends to control messages and file headers. */
export function sum8(bytes: Uint8Array): number {
  let s = 0;
  for (const b of bytes) s = (s + b) & 0xff;
  return s;
}

const crc16Table = Array.from({ length: 256 }, (_, n) => {
  let crc = n << 8;
  for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  return crc;
});

/** CRC-16/CCITT-FALSE: file headers, transfer blocks and the BIN body. */
export function crc16Ccitt(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) crc = ((crc << 8) ^ crc16Table[((crc >>> 8) ^ b) & 0xff]) & 0xffff;
  return crc;
}

/** CRC-32/MPEG-2 of the account ID, stored in the SystemBind profile. */
export function crc32Mpeg2(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc = (crc ^ (b << 24)) >>> 0;
    for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
  }
  return crc >>> 0;
}

const crc32Table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
  return c >>> 0;
});

/** ZIP's CRC-32. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (crc32Table[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

/** The watch's errors, worded for the person using the app (CorosKit's CorosError). */
export class CorosError extends Error {}
