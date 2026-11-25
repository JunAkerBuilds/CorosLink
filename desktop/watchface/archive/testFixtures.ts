// Fixtures shared by the archive and Studio tests.

/** The synthetic 614A face of CorosLink's scripts/test-official-watchface-editor.cjs. */
export function compiledFixture(): Buffer {
  const headers = Buffer.alloc(0x1164 * 2);
  for (const base of [0, 0x1164]) {
    headers.write("614A", base); headers.writeUInt16LE(0x1164, base + 0x138); headers[base + 0x13a] = 4;
    headers.writeUInt32LE(42, base + 4);
    for (const offset of [0x1b0, 0x1be, 0x1cc, 0x1da]) {
      headers.writeInt32LE(60 + (offset - 0x1b0) * 2, base + offset); headers.writeInt32LE(base ? 270 : 100, base + offset + 4);
      headers.writeUInt32LE(headers.length, base + offset + 8);
    }
  }
  headers.writeUInt32LE(0x1164, 0x322);
  const palette = Buffer.alloc(1024); palette.set([200, 40, 10, 255], 64); palette.set([3, 70, 110, 128], 4);
  const decoded = Buffer.concat([Buffer.from([1, 16]), palette]);
  const encoded = Buffer.from([...decoded].flatMap(n => n >= 0xc0 ? [0xc1, n] : [n]));
  const bitmap = Buffer.alloc(14 + 10 * 4);
  bitmap.writeUInt16LE(2); bitmap.writeUInt16LE(1, 2); bitmap.writeUInt16LE(0x2002, 4); bitmap[6] = 10; bitmap[7] = 1;
  for (let i = 0; i < 10; i++) bitmap.writeUInt32LE(encoded.length * (i + 1), 14 + i * 4);
  return Buffer.concat([headers, bitmap, ...Array<Buffer>(10).fill(encoded)]);
}
