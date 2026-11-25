// CorosLink's scripts/test-coros-watchface-ble.mjs: compiled face validation, the face list, slot selection and the
// file-8 block framing, with the "Must not regress" items (replacement-checklist §5) named.
import { describe, expect, it } from "vitest";
import { crc16Ccitt } from "./crc16";
import {
  decodeWatchfaceInventory, emptyWatchfaceSlot, encodeWatchfaceBlockHeader, encodeWatchfaceFile, selectWatchfaceSlot, WATCHFACE_MAX_BYTES,
} from "./corosBleWatchfaceProtocol";

/** A minimal compiled PACE Pro BIN: magic, face ID 12345, length, header size and checksum. */
function fixtureFace(): Buffer {
  const body = Buffer.alloc(12_000);
  body.write("614A"); body.writeUInt32LE(12345, 4); body.writeUInt32LE(body.length - 18, 8);
  body.writeUInt16LE(0x340, 0x138); body.writeUInt16LE(crc16Ccitt(body.subarray(18)), 12);
  return body;
}

describe("watch face Bluetooth protocol", () => {
  const body = fixtureFace();

  it("wraps a compiled BIN as HF file 8", () => {
    const { file, faceId, magic } = encodeWatchfaceFile(body);
    expect(faceId).toBe(12345);
    expect(magic).toBe("614A");
    expect(file.toString("latin1", 0, 2)).toBe("HF");
    expect(file[3]).toBe(8);
    expect(file.readUInt16LE(14)).toBe(crc16Ccitt(file.subarray(0, 14)));
    expect(file.readUInt16LE(12)).toBe(crc16Ccitt(body));
  });

  it("refuses a damaged BIN and an editable archive", () => {
    for (const [offset, value] of [[0, 0], [8, 0], [12, 0], [0x139, 0xff], [0x500, 1]]) {
      const bad = Buffer.from(body); bad[offset] = value;
      expect(() => encodeWatchfaceFile(bad)).toThrow();
    }
    expect(() => encodeWatchfaceFile(Buffer.from("PK"))).toThrow(/compiled/);
  });

  // Must not regress: BIN limit 0x320000 (3.2 MB) including the 16-byte HF header.
  it("keeps a BIN with its HF header within 0x320000 bytes", () => {
    expect(WATCHFACE_MAX_BYTES).toBe(0x320000);
    const big = Buffer.alloc(WATCHFACE_MAX_BYTES - 15);
    big.write("614A"); big.writeUInt32LE(1, 4); big.writeUInt32LE(big.length - 18, 8); big.writeUInt16LE(0x340, 0x138);
    expect(() => encodeWatchfaceFile(big)).toThrow(/3\.2 MB/);
    expect(() => encodeWatchfaceBlockHeader(Buffer.alloc(16), 0, WATCHFACE_MAX_BYTES + 1, 0)).toThrow();
  });

  // Must not regress: magic is the screen size reversed + A/R; one BIN fits APEX 4, NOMAD, APEX 2 Pro.
  it("accepts only a known screen magic", () => {
    const unknown = Buffer.from(body); unknown.write("999A");
    expect(() => encodeWatchfaceFile(unknown)).toThrow(/compiled/);
  });

  // Must not regress: 0xFFFFFFFF is an empty slot; 10 slots padded only on PACE Pro.
  it("reads the face list, padding to ten slots only when asked", () => {
    for (const size of [20, 40]) {
      const inventory = Buffer.alloc(size, 0xff); inventory.writeUInt32LE(27, 0);
      const ids = decodeWatchfaceInventory(inventory);
      expect(ids).toHaveLength(10);
      expect(emptyWatchfaceSlot(ids)).toBe(1);
    }
    const five = Buffer.alloc(20, 0xff); five.writeUInt32LE(27, 0);
    expect(decodeWatchfaceInventory(five, false)).toHaveLength(5);
    expect(() => decodeWatchfaceInventory(Buffer.alloc(21))).toThrow(/unsupported/);
    expect(() => decodeWatchfaceInventory(Buffer.alloc(0), false)).toThrow(/unsupported/);
    expect(() => decodeWatchfaceInventory(Buffer.alloc(44), false)).toThrow(/unsupported/);
    expect(() => emptyWatchfaceSlot(Array(10).fill(1))).toThrow(/occupied/);
  });

  // Must not regress: replacing needs the expected face ID.
  it("chooses a slot only while it still holds what was chosen", () => {
    expect(selectWatchfaceSlot(Array(10).fill(1), { slot: 4, expectedFaceId: 1, replaceExisting: true })).toBe(4);
    expect(selectWatchfaceSlot(Array(10).fill(0xffffffff), { slot: 7, expectedFaceId: null, replaceExisting: false })).toBe(7);
    expect(() => selectWatchfaceSlot(Array(10).fill(1), { slot: 4, expectedFaceId: 1, replaceExisting: false })).toThrow(/replacement/);
    expect(() => selectWatchfaceSlot(Array(10).fill(2), { slot: 4, expectedFaceId: 1, replaceExisting: true })).toThrow(/changed/);
    expect(() => selectWatchfaceSlot(Array(10).fill(1), { slot: 4, expectedFaceId: null, replaceExisting: false })).toThrow(/changed/);
    expect(() => selectWatchfaceSlot(Array(10).fill(1), { slot: 10, expectedFaceId: 1, replaceExisting: true })).toThrow(/valid/);
  });

  it("frames each 4 KB block with a 21-byte 0x78 header", () => {
    const { file } = encodeWatchfaceFile(body);
    for (let offset = 0; offset < file.length; offset += 4096) {
      const block = file.subarray(offset, offset + 4096), h = encodeWatchfaceBlockHeader(block, offset, file.length, 9);
      expect(h).toHaveLength(21);
      expect(Array.from(h.subarray(0, 3))).toEqual([0x78, 0, 8]);
      expect(h.readUInt32LE(3)).toBe(offset);
      expect(h.readUInt16LE(7)).toBe(block.length);
      expect(h.readUInt32LE(9)).toBe(file.length - offset);
      expect(h.readUInt16LE(13)).toBe(crc16Ccitt(block));
      expect(h[16]).toBe(9);
      expect(h[20]).toBe(h.subarray(2, 20).reduce((sum, b) => (sum + b) & 255, 0));
    }
    expect(() => encodeWatchfaceBlockHeader(Buffer.alloc(4097), 0, 5000, 0)).toThrow();
    expect(() => encodeWatchfaceBlockHeader(Buffer.alloc(2), 0, 2, 10)).toThrow();
  });
});
