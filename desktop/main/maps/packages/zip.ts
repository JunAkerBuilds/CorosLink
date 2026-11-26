// A zip reader for COROS's region map zips (up to ~15 GB, hundreds of thousands of tiles). Entries come from the
// CENTRAL DIRECTORY, never from walking local headers: COROS writes every entry with a data descriptor (flag bit 3),
// so the local headers carry no sizes, and big packages need Zip64. Nothing is held whole: the directory is read in
// windows and each entry streams from its own byte range.
import { createReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { pipeline, Readable, Transform } from "node:stream";
import zlib from "node:zlib";
import { t } from "@/lib/i18n";

export interface ZipEntry {
  name: string;
  directory: boolean;
  /** 0 stored, 8 deflate. */
  method: number;
  crc32: number;
  compressedSize: number;
  size: number;
  /** Where the entry's local header starts. */
  offset: number;
}

export interface ZipDirectory { entries: number; offset: number; size: number }

export class ZipProblem extends Error {}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const WINDOW = 1 << 20;
const MAX_COMMENT = 0xffff;

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await file.read(buffer, done, length - done, position + done);
    if (bytesRead === 0) break;
    done += bytesRead;
  }
  return done === length ? buffer : buffer.subarray(0, done);
}

/** 64-bit little-endian number; zip offsets stay far below 2^53. */
const u64 = (b: Buffer, at: number) => Number(b.readBigUInt64LE(at));

/** Where the central directory is, and how many entries it lists (Zip64 when the classic fields overflow). */
export async function findDirectory(file: FileHandle, fileSize: number): Promise<ZipDirectory> {
  const tailLength = Math.min(fileSize, 22 + MAX_COMMENT + 20);
  const tailStart = fileSize - tailLength;
  const tail = await readAt(file, tailStart, tailLength);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    // The comment length must reach exactly to the end, so a signature inside a comment isn't taken.
    if (tail.readUInt32LE(i) === EOCD && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { at = i; break; }
  }
  if (at < 0) throw new ZipProblem(t("This map file isn't a complete zip. Download it again."));
  let entries = tail.readUInt16LE(at + 10);
  let size = tail.readUInt32LE(at + 12);
  let offset = tail.readUInt32LE(at + 16);
  const locator = at - 20;
  if (locator >= 0 && tail.readUInt32LE(locator) === ZIP64_LOCATOR) {
    const recordAt = u64(tail, locator + 8);
    const record = await readAt(file, recordAt, 56);
    if (record.length < 56 || record.readUInt32LE(0) !== ZIP64_EOCD) throw new ZipProblem(t("This map file's Zip64 directory is damaged."));
    entries = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
  } else if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipProblem(t("This map file's Zip64 directory is missing."));
  }
  if (offset + size > fileSize) throw new ZipProblem(t("This map file is cut short. Download it again."));
  return { entries, offset, size };
}

/** Values from the Zip64 extra field (id 1), each present only where the classic field is all ones. */
function zip64Extra(extra: Buffer, entry: ZipEntry, rawSize: number, rawCompressed: number, rawOffset: number): void {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i), length = extra.readUInt16LE(i + 2);
    if (id === 0x0001) {
      let p = i + 4;
      const end = p + length;
      if (rawSize === 0xffffffff && p + 8 <= end) { entry.size = u64(extra, p); p += 8; }
      if (rawCompressed === 0xffffffff && p + 8 <= end) { entry.compressedSize = u64(extra, p); p += 8; }
      if (rawOffset === 0xffffffff && p + 8 <= end) { entry.offset = u64(extra, p); }
      return;
    }
    i += 4 + length;
  }
}

/** An open zip: its entries one at a time from the central directory, and each entry's bytes as a stream. */
export class ZipReader {
  private constructor(readonly path: string, private readonly file: FileHandle, readonly fileSize: number, readonly directory: ZipDirectory) {}

  static async open(filePath: string): Promise<ZipReader> {
    const file = await open(filePath, "r");
    try {
      const { size } = await file.stat();
      return new ZipReader(filePath, file, size, await findDirectory(file, size));
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  get count(): number { return this.directory.entries; }

  async close(): Promise<void> { await this.file.close().catch(() => undefined); }

  /** Every entry in directory order, read a window at a time. */
  async *entries(): AsyncGenerator<ZipEntry> {
    const { offset, size } = this.directory;
    let buffer = Buffer.alloc(0);
    let position = offset;
    const end = offset + size;
    let at = 0;
    let seen = 0;
    const need = async (length: number) => {
      if (buffer.length - at >= length) return true;
      if (position >= end) return false;
      const chunk = await readAt(this.file, position, Math.min(WINDOW, end - position));
      position += chunk.length;
      buffer = Buffer.concat([buffer.subarray(at), chunk]);
      at = 0;
      return need(length);
    };
    while (seen < this.directory.entries) {
      if (!(await need(46))) break;
      if (buffer.readUInt32LE(at) !== CENTRAL) throw new ZipProblem(t("This map file's directory is damaged."));
      const flags = buffer.readUInt16LE(at + 8);
      const nameLength = buffer.readUInt16LE(at + 28), extraLength = buffer.readUInt16LE(at + 30), commentLength = buffer.readUInt16LE(at + 32);
      const total = 46 + nameLength + extraLength + commentLength;
      if (!(await need(total))) throw new ZipProblem(t("This map file's directory is cut short."));
      const rawCompressed = buffer.readUInt32LE(at + 20), rawSize = buffer.readUInt32LE(at + 24), rawOffset = buffer.readUInt32LE(at + 42);
      const nameBytes = buffer.subarray(at + 46, at + 46 + nameLength);
      const name = nameBytes.toString(flags & 0x800 ? "utf8" : "latin1");
      const entry: ZipEntry = {
        name, directory: name.endsWith("/"), method: buffer.readUInt16LE(at + 10), crc32: buffer.readUInt32LE(at + 16),
        compressedSize: rawCompressed, size: rawSize, offset: rawOffset,
      };
      zip64Extra(buffer.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), entry, rawSize, rawCompressed, rawOffset);
      at += total;
      seen++;
      yield entry;
    }
  }

  /** The entry's uncompressed bytes. Sizes come from the central directory, so data descriptors don't matter. */
  async stream(entry: ZipEntry, options: { signal?: AbortSignal; verify?: boolean } = {}): Promise<Readable> {
    if (entry.method !== 0 && entry.method !== 8) throw new ZipProblem(t("Map file entry {name} uses a compression C-LINK can't read.", { name: entry.name }));
    const header = await readAt(this.file, entry.offset, 30);
    if (header.length < 30 || header.readUInt32LE(0) !== LOCAL) throw new ZipProblem(t("This map file is damaged."));
    const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (start + entry.compressedSize > this.fileSize) throw new ZipProblem(t("This map file is cut short. Download it again."));
    const raw: Readable = entry.compressedSize === 0
      ? Readable.from([])
      : createReadStream(this.path, { start, end: start + entry.compressedSize - 1, signal: options.signal });
    const stages: NodeJS.ReadWriteStream[] = [];
    if (entry.method === 8) stages.push(zlib.createInflateRaw());
    if (options.verify) stages.push(checker(entry));
    if (!stages.length) return raw;
    // pipeline() destroys every stage with the first error, so the reader of the last one sees it.
    return pipeline(raw, ...(stages as [NodeJS.ReadWriteStream]), () => undefined) as unknown as Readable;
  }
}

/** Passes bytes through and fails at the end when the size or CRC-32 doesn't match the directory. */
function checker(entry: ZipEntry): Transform {
  let crc = 0, length = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      crc = zlib.crc32(chunk, crc);
      length += chunk.length;
      done(null, chunk);
    },
    flush(done) {
      if (length !== entry.size || (crc >>> 0) !== (entry.crc32 >>> 0)) done(new ZipProblem(t("Map file entry {name} is damaged. Download the map again.", { name: entry.name })));
      else done();
    },
  });
}
