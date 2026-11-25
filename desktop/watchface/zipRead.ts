// Reads a ZIP held in memory: watch-face archives (DAT/ZIP), COROS template packages and editable projects. Stored
// and deflated entries only, which is all COROS and Studio write; ZIP64, encryption and spanned archives are refused.
// Used in place of the `unzipper` package CorosLink loads, so nothing new is added for it.
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** The name as stored, with "/" between folders. */
  path: string;
  directory: boolean;
  size: number;
  compressedSize: number;
  /** The entry's bytes. Throws when the archive is damaged. */
  read(): Buffer;
}

export class ZipError extends Error {}

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

/** The entries of a ZIP, in the order of its central directory. */
export function readZip(zip: Buffer): ZipEntry[] {
  // The end record is in the last 22 + 65,535 bytes (its comment can be that long).
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) { end = i; break; }
  }
  if (end < 0) throw new ZipError("This isn't a ZIP archive.");
  const count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12), start = zip.readUInt32LE(end + 16);
  if (count === 0xffff || start === 0xffffffff) throw new ZipError("ZIP64 archives aren't supported.");
  if (start + size > end) throw new ZipError("The ZIP archive is damaged.");
  const entries: ZipEntry[] = [];
  let at = start;
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL) throw new ZipError("The ZIP archive is damaged.");
    const flags = zip.readUInt16LE(at + 8), method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20), uncompressed = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28), extraLength = zip.readUInt16LE(at + 30), commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString(flags & 0x800 ? "utf8" : "latin1", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x1) throw new ZipError("Encrypted ZIP archives aren't supported.");
    if (method !== 0 && method !== 8) throw new ZipError(`The ZIP archive uses a compression method this app can't read (${method}).`);
    entries.push({
      path: name, directory: name.endsWith("/"), size: uncompressed, compressedSize,
      read() {
        if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL) throw new ZipError("The ZIP archive is damaged.");
        const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        if (dataAt + compressedSize > zip.length) throw new ZipError("The ZIP archive is truncated.");
        const raw = zip.subarray(dataAt, dataAt + compressedSize);
        const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: Math.max(uncompressed, 1) });
        if (data.length !== uncompressed) throw new ZipError("The ZIP archive contains a truncated file.");
        return data;
      },
    });
  }
  return entries;
}

/** True when a stored name could escape the folder it is unpacked into, or isn't a plain relative path. */
export function unsafeZipPath(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || /[\u0000-\u001f]/.test(name) || /^[a-z]:/i.test(name);
}
