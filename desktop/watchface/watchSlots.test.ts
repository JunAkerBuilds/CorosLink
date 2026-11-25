// The slot rules of CorosLink's Bluetooth install (corosNativeBleService.ts listWatchfaceSlots / syncWatchface), with
// the "Must not regress" items (replacement-checklist §5) named.
import { describe, expect, it } from "vitest";
import { encodeWatchfaceFile } from "./corosBleWatchfaceProtocol";
import { crc16Ccitt } from "./crc16";
import {
  checkFaceFits, chooseSlot, FACE_LIST_ARGUMENT, FACE_LIST_COMMAND, installed, installPlan, parseFaceList, slotTarget, verification, VERIFY_ATTEMPTS,
  VERIFY_INTERVAL_MS, type WatchSlot,
} from "./watchSlots";

const list = (...ids: number[]) => {
  const payload = Buffer.alloc(ids.length * 4);
  ids.forEach((id, i) => payload.writeUInt32LE(id, i * 4));
  return payload;
};
const EMPTY = 0xffffffff;

/** A minimal compiled PACE Pro BIN, as in corosBleWatchfaceProtocol.test.ts. */
function fixtureFace(): Buffer {
  const body = Buffer.alloc(12_000);
  body.write("614A"); body.writeUInt32LE(12345, 4); body.writeUInt32LE(body.length - 18, 8);
  body.writeUInt16LE(0x340, 0x138); body.writeUInt16LE(crc16Ccitt(body.subarray(18)), 12);
  return body;
}

describe("watch face slots", () => {
  it("reads the face list with command 0x96", () => {
    expect(FACE_LIST_COMMAND).toBe(0x96);
    expect([...FACE_LIST_ARGUMENT]).toEqual([0]);
  });

  it("Must not regress: face ID 0xFFFFFFFF is an empty slot", () => {
    expect(parseFaceList(list(27, EMPTY, 3), "apex-4")).toEqual([{ slot: 0, faceId: 27 }, { slot: 1, faceId: null }, { slot: 2, faceId: 3 }]);
  });

  it("Must not regress: 10 slots padded only on PACE Pro", () => {
    const five = list(27, 28, EMPTY, EMPTY, EMPTY);
    const pacePro = parseFaceList(five, "pace-pro");
    expect(pacePro).toHaveLength(10);
    expect(pacePro.slice(5).every((s) => s.faceId === null)).toBe(true);
    expect(parseFaceList(list(...Array(10).fill(1)), "pace-pro")).toHaveLength(10);
    expect(parseFaceList(five, "pace-4")).toHaveLength(5);
    expect(parseFaceList(five)).toHaveLength(5);
    expect(() => parseFaceList(Buffer.alloc(6), "pace-pro")).toThrow(/unsupported/);
  });

  it("installs into the first empty slot when none is chosen", () => {
    expect(chooseSlot(parseFaceList(list(27, 28, EMPTY, EMPTY, EMPTY), "pace-pro"))).toBe(2);
    expect(() => chooseSlot(parseFaceList(list(1, 2, 3), "apex-4"))).toThrow(/occupied/);
  });

  it("Must not regress: replacing needs the expected face ID", () => {
    const earlier = parseFaceList(list(27, 28, EMPTY), "apex-4");
    const replace = slotTarget(earlier, { slot: 1, replaceExisting: true });
    expect(replace).toEqual({ slot: 1, replaceExisting: true, expectedFaceId: 28 });
    expect(chooseSlot(earlier, replace)).toBe(1);
    // The face in that slot changed since it was chosen.
    expect(() => chooseSlot(parseFaceList(list(27, 99, EMPTY), "apex-4"), replace)).toThrow(/changed/);
    // Occupied, but replacing wasn't chosen.
    expect(() => chooseSlot(earlier, slotTarget(earlier, { slot: 0, replaceExisting: false }))).toThrow(/replacement/);
    // An empty slot that has since been filled.
    const empty = slotTarget(earlier, { slot: 2, replaceExisting: false });
    expect(chooseSlot(earlier, empty)).toBe(2);
    expect(() => chooseSlot(parseFaceList(list(27, 28, 5), "apex-4"), empty)).toThrow(/changed/);
  });

  it("refuses a slot the earlier read didn't have", () => {
    const earlier: WatchSlot[] = parseFaceList(list(27, EMPTY, EMPTY), "apex-4");
    for (const slot of [-1, 3, 10, 1.5]) expect(() => slotTarget(earlier, { slot, replaceExisting: false })).toThrow(/Refresh/);
    expect(() => slotTarget(earlier, { slot: 1, replaceExisting: "yes" as unknown as boolean })).toThrow(/Refresh/);
  });

  it("Must not regress: the BIN's magic is checked against the watch", () => {
    expect(() => checkFaceFits("614A", "pace-pro")).not.toThrow();
    expect(() => checkFaceFits("062R", "apex-4")).not.toThrow();
    expect(() => checkFaceFits("062R", "nomad")).not.toThrow();
    expect(() => checkFaceFits("062R", "apex-2-pro")).not.toThrow();
    expect(() => checkFaceFits("614A", "apex-4")).toThrow("This face was built for a 416 px PACE Pro, not your APEX 4. Compile it for this watch.");
    expect(() => checkFaceFits("999A", "pace-pro")).toThrow(/another watch/);
  });

  it("sends file 8 in 4 KB blocks and verifies by reading the list 8 × 500 ms", () => {
    const bin = fixtureFace();
    const plan = installPlan(bin, 3);
    const { file } = encodeWatchfaceFile(bin);
    expect(plan).toMatchObject({ faceId: 12345, magic: "614A", slot: 3, fileIndex: 8, totalBytes: file.length, verify: { attempts: 8, intervalMs: 500 } });
    expect(VERIFY_ATTEMPTS).toBe(8);
    expect(VERIFY_INTERVAL_MS).toBe(500);
    expect(plan.blocks.map((b) => b.offset)).toEqual([0, 4096, 8192]);
    expect(plan.blocks.map((b) => b.block.length)).toEqual([4096, 4096, file.length - 8192]);
    expect(Buffer.concat(plan.blocks.map((b) => b.block)).equals(file)).toBe(true);
    for (const b of plan.blocks) {
      expect(b.header[0]).toBe(0x78);
      expect(b.header[2]).toBe(8);
      expect(b.header[16]).toBe(3);
    }
    expect(installed(parseFaceList(list(1, 2, 3, 12345), "apex-4"), plan)).toBe(true);
    expect(installed(parseFaceList(list(1, 2, 3, EMPTY), "apex-4"), plan)).toBe(false);
    expect(installed(parseFaceList(list(1, 2), "apex-4"), plan)).toBe(false);
  });

  it("says how an install was confirmed", () => {
    const plan = { faceId: 12345 };
    expect(verification(undefined, plan)).toBe("inventory-id");
    expect(verification({ slot: 0, replaceExisting: true, expectedFaceId: 12345 }, plan)).toBe("transfer-acknowledged");
    expect(verification({ slot: 0, replaceExisting: true, expectedFaceId: 7 }, plan)).toBe("inventory-id");
  });
});
