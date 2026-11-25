// Tiny zips for tests, written the way COROS writes its region zips: data descriptors (flag bit 3, no sizes in the
// local headers), optionally Zip64 everywhere, stored or deflated.
import zlib from "node:zlib";

export interface TestEntry { name: string; data?: Buffer | string; deflate?: boolean }

export function buildZip(entries: TestEntry[], options: { zip64?: boolean; comment?: string } = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const z64 = !!options.zip64;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.from(e.data ?? "");
    const directory = e.name.endsWith("/");
    const method = e.deflate && !directory ? 8 : 0;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data) >>> 0;
    const flags = 0x8 | 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(z64 ? 45 : 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(z64 ? 24 : 16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    if (z64) { descriptor.writeBigUInt64LE(BigInt(body.length), 8); descriptor.writeBigUInt64LE(BigInt(data.length), 16); }
    else { descriptor.writeUInt32LE(body.length, 8); descriptor.writeUInt32LE(data.length, 12); }
    parts.push(local, name, body, descriptor);

    const extra = Buffer.alloc(z64 ? 28 : 0);
    if (z64) {
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(data.length), 4);
      extra.writeBigUInt64LE(BigInt(body.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(z64 ? 45 : 20, 4);
    head.writeUInt16LE(z64 ? 45 : 20, 6);
    head.writeUInt16LE(flags, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(z64 ? 0xffffffff : body.length, 20);
    head.writeUInt32LE(z64 ? 0xffffffff : data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt16LE(extra.length, 30);
    head.writeUInt32LE(z64 ? 0xffffffff : offset, 42);
    central.push(head, name, extra);
    offset += local.length + name.length + body.length + descriptor.length;
  }
  const cd = Buffer.concat(central);
  const cdOffset = offset;
  const tail: Buffer[] = [cd];
  if (z64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24);
    record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(cd.length), 40);
    record.writeBigUInt64LE(BigInt(cdOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(cdOffset + cd.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const comment = Buffer.from(options.comment ?? "");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(z64 ? 0xffff : entries.length, 8);
  end.writeUInt16LE(z64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(z64 ? 0xffffffff : cd.length, 12);
  end.writeUInt32LE(z64 ? 0xffffffff : cdOffset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, ...tail, end, comment]);
}
