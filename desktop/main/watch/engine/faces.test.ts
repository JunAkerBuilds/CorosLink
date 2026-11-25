// Faces against CorosKit's tests: WatchfaceSelectionTests, FaceInstallCheckTests and the watch face parts of
// CorosKitTests (transfer encoding vectors, installs on SimulatedWatch and ScriptedWatch). The BIN is CorosKit's
// compile of its vectors archive (sha256 checked below against vectors.json's binSha256).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { crc16Ccitt, put16, put32, sum8 } from "./bytes";
import {
  decodeFaceCheck, decodeInventory, decodeShownFace, EMPTY_SLOT, encodeFaceBlockHeader, encodeFaceCheck, encodeFaceFile, encodeShowFace,
  faceTiming, faceVerdict, firstEmptySlot, installBin, installFace, lastInstall, linkDropped, readFaces, readShownFace, requireShown,
  showFace, showFaceCommand, type FaceInstallCheck, type ShownFace,
} from "./faces";
import { SimulatedWatch } from "./simulatedWatch";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (text: string) => Buffer.from(text.replace(/\s+/g, ""), "hex");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// CorosKit's Tests/CorosKitTests/Resources/vectors.json.
const V = {
  faceId: 1145624654,
  binSha256: "9f88d99e05bcca3411db5d55221cf532b6e0df1030c37efc71d4009cc52303db",
  fileSha256: "d7882ada69965b6d9c544333006ecfb34771a9e0caf82e1ce05abc2633327b7c",
  firstBlockHeader: "780008000000000010fe6c03008f4de6040000034e",
  lastBlockHeader: "78000800600300fe0cfe0c0000e6c955090000038f",
  lastOffset: 221184,
};
const bin = gunzipSync(readFileSync(new URL("./fixtures/coroskit-face.bin.gz", import.meta.url)));
const blocks = Math.ceil((bin.length + 16) / 4096);

/** A minimal BIN that passes the file checks: `magic`, one 0x340-byte layout header, the length and CRC. */
function syntheticBin(magic: string, faceId: number): Buffer {
  const body = Buffer.alloc(0x400);
  body.write(magic, 0, "latin1");
  put32(body, faceId, 4);
  put16(body, 0x340, 0x138);
  put32(body, body.length - 18, 8);
  put16(body, crc16Ccitt(body.subarray(18)), 12);
  return body;
}

beforeAll(() => Object.assign(faceTiming, { queuePoll: 5, verifyPause: 1, resendQuiet: 1, resendCap: 200 }));

describe("WatchfaceProtocol", () => {
  it("is CorosKit's compiled BIN", () => expect(sha(bin)).toBe(V.binSha256));

  it("encodes the transfer like the desktop (testTransferEncodingMatchesDesktop)", () => {
    const { file, faceId } = encodeFaceFile(bin);
    expect(faceId).toBe(V.faceId);
    expect(sha(file)).toBe(V.fileSha256);
    expect(hex(encodeFaceBlockHeader(file.subarray(0, 4096), 0, file.length, 4))).toBe(V.firstBlockHeader);
    expect(hex(encodeFaceBlockHeader(file.subarray(V.lastOffset), V.lastOffset, file.length, 9))).toBe(V.lastBlockHeader);
  });

  it("pads only PACE Pro's inventory (testInventoryOnlyPadsPacePro)", () => {
    const five = Buffer.alloc(20);
    [1, 2, 3, 4, 5].forEach((id, i) => five.writeUInt32LE(id, i * 4));
    expect(decodeInventory(five)).toHaveLength(10);
    expect(decodeInventory(five, false)).toEqual([1, 2, 3, 4, 5]);
    expect(() => firstEmptySlot([1, 2, 3, 4, 5])).toThrow("All watch face slots are occupied");
  });

  it("refuses BINs it can't send", () => {
    expect(() => encodeFaceFile(Buffer.alloc(0x340))).toThrow("smaller than 3.2 MB");
    const broken = Buffer.from(bin); broken[100] ^= 0xff;
    expect(() => encodeFaceFile(broken)).toThrow("length or checksum");
    expect(() => encodeFaceFile(syntheticBin("614A", EMPTY_SLOT))).toThrow("invalid identifier");
  });
});

describe("0xB7 face selection (WatchfaceSelectionTests)", () => {
  // The watch's answer to `B7 00 00 00` in the capture: slot 8 on screen, then all ten slots (frame header and SUM cut).
  const frame = bytes(`b7 00 01 0b 08 b4 5f 26 6c 00 ee f2 67 5c 01 24 90 05 69 02 c9 3b 43 55 03 0c 62 8b 45
    04 1d 73 42 4f 05 9e 4d 75 69 06 ee bb c4 59 07 27 cc 93 63 08 b4 5f 26 6c 09 5a 1f 92 45 13`);
  const captured = frame.subarray(2, frame.length - 1);
  /** One control frame as clink-ble writes it: opcode, frames remaining, payload, SUM. */
  const framed = (opcode: number, payload: Buffer) => hex(Buffer.concat([Buffer.from([opcode, 0]), payload, Buffer.from([sum8(payload)])]));

  it("requests match the capture", () => {
    expect(sum8(captured)).toBe(frame[frame.length - 1]);
    expect(framed(0xb7, Buffer.from([0]))).toBe("b7000000");
    expect(framed(0xb7, encodeShowFace(9, 0x4592_1f5a))).toBe("b7000101095a1f92455b");
    expect(() => encodeShowFace(10, 1)).toThrow();
    expect(() => encodeShowFace(0, EMPTY_SLOT)).toThrow();
  });

  it("decodes the captured answers", () => {
    const shown = decodeShownFace(captured);
    expect(shown.slot).toBe(8);
    expect(shown.faceId).toBe(0x6c26_5fb4);
    expect(shown.slots).toHaveLength(10);
    expect(shown.slots[0]).toBe(0x5c67_f2ee);
    expect(shown.slots[9]).toBe(0x4592_1f5a);
    expect(() => requireShown(Buffer.from([1]))).not.toThrow();
    expect(() => requireShown(Buffer.from([3]))).toThrow();
    expect(() => requireShown(Buffer.alloc(0))).toThrow();
  });

  it("refuses answers it can't read", () => {
    const edit = (at: number, value: number) => { const b = Buffer.from(captured); b[at] = value; return b; };
    expect(() => decodeShownFace(edit(0, 3))).toThrow(); // status
    expect(() => decodeShownFace(captured.subarray(0, captured.length - 1))).toThrow(); // short
    expect(() => decodeShownFace(edit(1, 10))).toThrow(); // record count
    expect(() => decodeShownFace(edit(2 + 5 * 3, 7))).toThrow(); // slots out of order
    expect(() => decodeShownFace(edit(2, 10))).toThrow(); // shown slot past the last
  });

  it("shows an installed face only while its slot holds it", async () => {
    const watch = new SimulatedWatch();
    const session = watch.session();
    const before = await readShownFace(session);
    expect(before.slot).toBe(0);
    expect(before.slots).toEqual(watch.slots);
    const shown = await showFace(session, 2, watch.slots[2]);
    expect(shown.slot).toBe(2);
    expect(shown.faceId).toBe(watch.slots[2]);
    expect(watch.shownSlot).toBe(2);
    // A slot that now holds another face, or none, is refused before the watch is asked to show it.
    await expect(showFace(session, 3, 0x1234)).rejects.toThrow("slot changed");
    await expect(showFace(session, 6, EMPTY_SLOT)).rejects.toThrow();
    expect(watch.shownSlot).toBe(2);
    expect(watch.isConnected).toBe(true);
  });

  it("switches other watches too", async () => {
    const watch = new SimulatedWatch("COROS NOMAD 81D0", null);
    const session = watch.session();
    expect((await readShownFace(session)).slot).toBe(0);
    expect((await showFace(session, 1, watch.slots[1])).slot).toBe(1);
    expect(watch.shownSlot).toBe(1);
  });

  it("answers like the helper's faces and showFace", async () => {
    const watch = new SimulatedWatch();
    const session = watch.session();
    expect(await readFaces(session)).toEqual({
      slots: [{ slot: 0, faceId: 0x5d2a1f40 }, { slot: 1, faceId: 0x5d2a1f41 }, { slot: 2, faceId: 0x4a91c3e2 }, { slot: 3, faceId: 0x4b07aa19 },
        { slot: 4 }, { slot: 5 }, { slot: 6 }, { slot: 7 }, { slot: 8 }, { slot: 9 }],
      shown: 0,
    });
    expect((await showFaceCommand(session, { slot: 3, faceId: 0x4b07aa19 })).shown).toBe(3);
    await expect(showFaceCommand(session, { slot: 3 })).rejects.toThrow("Pick a face on the watch.");
    await expect(showFaceCommand(session, { slot: 3, faceId: 2 ** 32 })).rejects.toThrow("Refresh the slots and choose the face again.");
    // A watch that doesn't answer 0xB7 as a PACE Pro does: the slots alone.
    const other = new SimulatedWatch("COROS APEX 4 81D0", "W541");
    const plain = other.session();
    const exchange = other.exchange.bind(other);
    other.exchange = (opcode, payload, max) => (opcode === 0xb7 ? Promise.resolve(Buffer.from([2])) : exchange(opcode, payload, max));
    const faces = await readFaces(plain);
    expect(faces.shown).toBeNull();
    expect(faces.slots).toHaveLength(10);
  });
});

describe("installs", () => {
  it("installs on the simulated watch (testInstallOnSimulatedWatch)", async () => {
    const watch = new SimulatedWatch();
    const session = watch.session();
    let reported = 0;
    const result = await installFace(session, bin, undefined, (sent) => { reported = sent; });
    expect(result.slot).toBe(4);
    expect(watch.slots[4]).toBe(V.faceId);
    expect(reported).toBe(bin.length + 16);
    expect(lastInstall(session)?.stage).toBe("installed");
    // A PACE Pro shows the face it just received (testInstalledFaceIsShown).
    const shown = await readShownFace(session);
    expect(shown.slot).toBe(result.slot);
    expect(shown.faceId).toBe(V.faceId);
    // A slot that changed since it was chosen is refused before anything is written.
    await expect(installFace(session, bin, { slot: 5, expectedFaceId: 0x1234, replaceExisting: true }, () => {})).rejects.toThrow("slot changed");
    expect(watch.isConnected).toBe(true);
  });

  it("resends a failed block once, then drops the link (testFailedInstallReportsWhereTheTransferStopped)", async () => {
    const watch = new SimulatedWatch();
    watch.script = ["stored", "timeout"];
    const session = watch.session();
    await expect(installFace(session, bin, undefined, () => {})).rejects.toThrow("did not acknowledge");
    const report = lastInstall(session)!;
    expect(report.block).toBe(1);
    expect(report.sentBytes).toBe(4096);
    expect(report.binSHA256).toHaveLength(64);
    expect(report.probe?.startsWith("block 2 failed")).toBe(true);
    expect(report.recovered).toEqual([]);
    expect(watch.offsets).toEqual([0, 4096, 4096]);
    expect(watch.isConnected).toBe(false);
  });

  it("carries on after a block that fell out of step (testInstallResendsABlockThatFellOutOfStep)", async () => {
    const watch = new SimulatedWatch();
    watch.script = ["stored", "rejected", "stored"];
    const session = watch.session();
    let reported = 0;
    const result = await installFace(session, bin, undefined, (sent) => { reported = sent; });
    expect(watch.slots[result.slot]).toBe(V.faceId);
    expect(reported).toBe(bin.length + 16);
    const report = lastInstall(session)!;
    expect(report.stage).toBe("installed");
    expect(report.recovered).toEqual(["block 2 sending"]);
    expect(report.probe?.startsWith("block 2 accepted")).toBe(true);
    expect(watch.offsets.slice(0, 4)).toEqual([0, 4096, 4096, 8192]);
    expect(watch.isConnected).toBe(true);
  });

  it("goes through the file again when the face isn't listed (testInstallRefillsABlockTheWatchLost)", async () => {
    expect(blocks).toBeGreaterThan(3);
    const watch = new SimulatedWatch();
    // The first pass loses the second-to-last block. clink-ble doesn't say which blocks the watch already had, so the
    // second pass sends every block again (CorosKit's lists only the one the watch asked for).
    watch.script = [...Array(blocks - 2).fill("stored"), "lost", "stored", "stored"];
    const session = watch.session();
    const result = await installFace(session, bin, undefined, () => {});
    expect(watch.slots[result.slot]).toBe(V.faceId);
    const report = lastInstall(session)!;
    expect(report.stage).toBe("installed");
    expect(report.refilled).toEqual(Array.from({ length: blocks }, (_, i) => i + 1));
    expect(report.slotChecks).toBe(9);
    expect(watch.offsets).toHaveLength(2 * blocks);
    expect(watch.isConnected).toBe(true);
  });

  it("gives up when the second pass doesn't list it (testInstallGivesUpWhenTheRefillDoesNotList)", async () => {
    const watch = new SimulatedWatch();
    watch.script = ["lost"];
    const session = watch.session();
    await expect(installFace(session, bin, undefined, () => {})).rejects.toThrow(
      "The watch didn't confirm the new face in its slot list. Check the watch, then try again.");
    const report = lastInstall(session)!;
    expect(report.stage).toBe("verifying");
    expect(report.slotChecks).toBe(16);
    expect(report.refilled).toEqual(Array.from({ length: blocks }, (_, i) => i + 1));
    expect(watch.offsets).toHaveLength(2 * blocks);
    expect(watch.isConnected).toBe(false);
  });

  it("refuses a BIN for another screen before writing (testInstallChecksTheBinFitsTheWatch)", async () => {
    const watch = new SimulatedWatch("COROS NOMAD 81D0", null);
    const session = watch.session();
    const before = [...watch.slots];
    await expect(installFace(session, bin, undefined, () => {})).rejects.toThrow("This face was built for a 416 px PACE Pro, not your NOMAD. Add it again for this watch.");
    expect(watch.slots).toEqual(before);
    expect(watch.isConnected).toBe(true);
    // Built for APEX 4: the same 260 px memory-in-pixel screen, so NOMAD takes it.
    const result = await installFace(session, syntheticBin("062R", 0x4000_0007), undefined, () => {});
    expect(watch.slots[result.slot]).toBe(0x4000_0007);
    const unknown = new SimulatedWatch("Garmin 1234", null).session();
    await expect(installFace(unknown, bin, undefined, () => {})).rejects.toThrow("C-LINK doesn't support installing faces on Garmin (model unknown) yet.");
  });

  it("stops while waiting for another operation when cancelled", async () => {
    const watch = new SimulatedWatch();
    const session = watch.session();
    let release!: () => void;
    void session.exclusively(() => new Promise<void>((resolve) => { release = resolve; }));
    let cancelled = false;
    const install = installFace(session, bin, undefined, () => {}, () => cancelled);
    cancelled = true;
    await expect(install).rejects.toThrow("Cancelled.");
    release();
    await session.exclusively(async () => {});
    expect(watch.offsets).toEqual([]);
  });

  it("answers like the helper's install, with progress events", async () => {
    const watch = new SimulatedWatch();
    const session = watch.session();
    const events: Record<string, unknown>[] = [];
    const answer = await installBin(session, bin, { slot: 1, expectedFaceId: 0x5d2a1f41, replace: true }, (e) => events.push(e));
    expect(answer.installed).toBe(1);
    expect(answer.shown).toBe(1);
    expect(answer.slots[1]).toEqual({ slot: 1, faceId: V.faceId });
    expect(events[0]).toEqual({ event: "progress", step: "face", percent: 0 });
    expect(events.at(-1)).toEqual({ event: "progress", step: "face", percent: 100 });
    expect(events.every((e) => e.step === "face" && Number.isInteger(e.percent))).toBe(true);
    // An occupied slot without `replace` is refused.
    await expect(installBin(session, bin, { slot: 0, expectedFaceId: 0x5d2a1f40 }, () => {})).rejects.toThrow("Choose the occupied slot for replacement before installing.");
  });
});

describe("FaceInstallCheck (FaceInstallCheckTests)", () => {
  const installed = new Date(1_800_000_000_000);
  const face = 0x6c26_5fb4, other = 0x4592_1f5a;
  const check = (): FaceInstallCheck => ({ watchName: "COROS PACE 4", target: "PACE 4", faceName: "Nixie Circuit", catalogSlug: "nixie",
    slot: 2, faceId: face, installedAt: installed, firmware: "3.2108.0", binBytes: 1_110_776, drops: 0 });
  const slots = (id: number) => { const s = Array(10).fill(EMPTY_SLOT); s[2] = id; return s; };
  const shown = (id: number): ShownFace => ({ slot: 2, faceId: id, slots: slots(face) });
  const at = (minutes: number) => new Date(installed.getTime() + minutes * 60_000);
  const verdict = (c: FaceInstallCheck, ...args: Parameters<typeof faceVerdict> extends [unknown, ...infer R] ? R : never) => faceVerdict(c, ...args);

  it("waits right after the install", () => expect(verdict(check(), "COROS PACE 4", slots(face), shown(face), at(0.2))).toEqual({ kind: "waiting" }));
  it("is fine once the face stayed up", () => expect(verdict(check(), "COROS PACE 4", slots(face), shown(face), at(10))).toEqual({ kind: "fine" }));
  it("is fine when another face was picked without a restart", () => expect(verdict(check(), "COROS PACE 4", slots(face), shown(other), at(10))).toEqual({ kind: "fine" }));

  it("calls a face replaced after a restart a crash", () => {
    const c = check();
    linkDropped(c, at(1));
    expect(verdict(c, "COROS PACE 4", slots(face), shown(other), at(3))).toEqual({ kind: "crashed",
      signs: { reason: "face replaced after a restart", screen: "another face", drops: 1, inSlot: true, secondsAfterInstall: 180 } });
  });

  it("calls a face removed after a restart a crash", () => {
    const c = check();
    linkDropped(c, at(1));
    const v = verdict(c, "COROS PACE 4", slots(EMPTY_SLOT), null, at(3));
    expect(v.kind === "crashed" && v.signs).toMatchObject({ reason: "face removed after a restart", inSlot: false, screen: "unknown" });
  });

  it("waits for a steady link when the face is still shown after a drop", () => {
    const c = check();
    linkDropped(c, at(1));
    expect(verdict(c, "COROS PACE 4", slots(face), shown(face), at(2))).toEqual({ kind: "waiting" });
    expect(verdict(c, "COROS PACE 4", slots(face), shown(face), at(7))).toEqual({ kind: "fine" });
  });

  it("calls repeated drops a restart loop", () => {
    const c = check();
    for (const minute of [1, 2, 3]) linkDropped(c, at(minute));
    const v = verdict(c, "COROS PACE 4", slots(face), shown(face), at(4));
    expect(v.kind === "crashed" && v.signs).toMatchObject({ reason: "restart loop", screen: "installed face" });
  });

  it("doesn't count late drops", () => {
    const c = check();
    linkDropped(c, at(20));
    expect(c.drops).toBe(0);
    expect(verdict(c, "COROS PACE 4", slots(face), shown(other), at(25))).toEqual({ kind: "fine" });
  });

  it("waits for another watch or no slots", () => {
    const c = check();
    linkDropped(c, at(1));
    expect(verdict(c, "COROS APEX 4", slots(other), shown(other), at(3))).toEqual({ kind: "waiting" });
    expect(verdict(c, "COROS PACE 4", null, null, at(3))).toEqual({ kind: "waiting" });
  });

  it("expires after a day", () => expect(verdict(check(), "COROS PACE 4", null, null, at(25 * 60))).toEqual({ kind: "expired" }));

  it("survives saving", () => {
    const c = check();
    linkDropped(c, at(1));
    const json = JSON.parse(JSON.stringify(encodeFaceCheck(c))) as Record<string, unknown>;
    expect(json.installedAt).toBe(1_800_000_000 - 978_307_200);
    expect(decodeFaceCheck(json)).toEqual(c);
  });
});
