// A watch stand-in for tests, in place of BleLink: a port of the parts of CorosKit's Bluetooth/SimulatedWatch.swift
// the face, route and map commands use (a PACE Pro unless told otherwise), plus a route library CorosKit's lacks and
// per-block outcomes like CorosKitTests' ScriptedWatch.
import { CorosError, crc16Ccitt, u16, u32 } from "./bytes";
import type { DeviceInfo } from "./models";
import { WatchSession } from "./session";
import type { BleLink } from "./transport";

/** A file block: stored, the data never confirmed, refused, or stored without the watch keeping it. */
export type BlockOutcome = "stored" | "timeout" | "rejected" | "lost";

export class SimulatedWatch {
  info: DeviceInfo;
  isConnected = true;
  slots: number[];
  /** The slot whose face is on screen: chosen with 0xB7, or the last face installed. */
  shownSlot = 0;
  /** Every control request, as [opcode, payload hex]. */
  requests: [number, string][] = [];
  /** The offset of every face or route block sent. */
  offsets: number[] = [];
  /** One outcome per face block (the last repeats). */
  script: BlockOutcome[] = ["stored"];
  /** The route library (0xAA): capacity and entries by slot. */
  routeCapacity = 5;
  routes = new Map<number, { trackId: bigint; crc16: number }>();
  /** Answers for B6 requests by payload hex, else the storage a PACE Pro reports. */
  mapReplies = new Map<string, Buffer>();
  /** Answers for other opcodes. */
  replies = new Map<number, Buffer>();

  private pendingFaceId: number | null = null;
  private lost = new Set<number>();
  private routeFile: Buffer = Buffer.alloc(0);

  constructor(name = "COROS PACE Pro 2F1A6C", modelNumber: string | null = "W332", slots?: number[]) {
    this.info = { name, modelNumber: modelNumber ?? undefined, firmwareRevision: "V3.2008.0", softwareRevision: "V3.2008.0", serialNumber: "SIM-0001", batteryPercent: 82, maximumWriteBytes: 244 };
    this.slots = slots ?? [0x5d2a1f40, 0x5d2a1f41, 0x4a91c3e2, 0x4b07aa19, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];
  }

  /** An authenticated session over this watch. */
  session(): WatchSession {
    const session = new WatchSession(this as unknown as BleLink);
    session.authenticatedAt = new Date();
    return session;
  }

  async exchange(opcode: number, payload: Uint8Array, maximumWrite: number): Promise<Buffer> {
    if (!this.isConnected) throw new CorosError("The watch is disconnected.");
    if (maximumWrite < 3) throw new CorosError("The COROS control request is invalid.");
    const request = Buffer.from(payload);
    this.requests.push([opcode, request.toString("hex")]);
    await Promise.resolve();
    if (opcode === 0x96) {
      const out = Buffer.alloc(this.slots.length * 4);
      this.slots.forEach((id, i) => out.writeUInt32LE(id, i * 4));
      return out;
    }
    if (opcode === 0xb7 && request.equals(Buffer.from([0]))) {
      const records = [[this.shownSlot, this.slots[this.shownSlot]], ...this.slots.map((id, slot) => [slot, id])];
      const out = Buffer.alloc(2 + records.length * 5);
      out[0] = 1; out[1] = records.length;
      records.forEach(([slot, id], i) => { out[2 + i * 5] = slot; out.writeUInt32LE(id, 3 + i * 5); });
      return out;
    }
    if (opcode === 0xb7 && request.length === 7 && request[0] === 1 && request[1] === 1) {
      const slot = request[2];
      if (slot >= this.slots.length || this.slots[slot] === 0xffffffff || this.slots[slot] !== u32(request, 3)) return Buffer.from([3]);
      this.shownSlot = slot;
      return Buffer.from([1]);
    }
    if (opcode === 0xaa) {
      const entries = [...this.routes.entries()];
      const out = Buffer.alloc(6 + entries.length * 13);
      out[1] = this.routeCapacity; out[2] = entries.length; out[3] = 13;
      entries.forEach(([slot, e], i) => {
        const at = 6 + i * 13;
        out[at] = slot; out.writeBigUInt64LE(e.trackId, at + 1); out.writeUInt16LE(e.crc16, at + 9); out.writeUInt16LE(1, at + 11);
      });
      return out;
    }
    if (opcode === 0xb6) {
      const reply = this.mapReplies.get(request.toString("hex"));
      if (reply) return reply;
      if (request.equals(Buffer.from([7]))) {
        // 32 GB of flash as a PACE Pro reports it: maps, music, training plans, routes, free, total.
        const sizes = [6_120_000_000n, 412_000_000n, 2_400_000n, 18_600_000n, 22_350_000_000n, 34_359_738_368n];
        const out = Buffer.alloc(49);
        out[0] = 1;
        sizes.forEach((size, i) => out.writeBigUInt64LE(size, 1 + i * 8));
        return out;
      }
    }
    const reply = this.replies.get(opcode);
    if (reply) return reply;
    throw new CorosError("The watch didn't answer.");
  }

  async sendFileBlock(header: Uint8Array, block: Uint8Array, fileIndex: number): Promise<void> {
    if (!this.isConnected) throw new CorosError("The watch is disconnected.");
    const h = Buffer.from(header);
    if (h.length !== 21 || h[0] !== 0x78 || h[2] !== fileIndex || u16(h, 13) !== crc16Ccitt(block)) {
      throw new CorosError("The watch rejected the file transfer header.");
    }
    const offset = u32(h, 3), remaining = u32(h, 9), slot = h[16];
    this.offsets.push(offset);
    await Promise.resolve();
    if (fileIndex === 0x14) return this.routeBlock(Buffer.from(block), offset, remaining, slot);
    const outcome = this.script.length > 1 ? this.script.shift()! : this.script[0];
    if (outcome === "lost") this.lost.add(offset); else this.lost.delete(offset);
    if (outcome === "timeout") throw new CorosError("The watch did not acknowledge the file data block.");
    if (outcome === "rejected") throw new CorosError("The watch rejected the file data block.");
    if (outcome !== "stored" || this.lost.size > 0) return;
    // The BIN's face ID sits at byte 4 of the body, after the 16-byte SFT header.
    if (offset === 0 && block.length >= 24) this.pendingFaceId = u32(block, 20);
    if (remaining === block.length && this.pendingFaceId !== null && slot < this.slots.length) {
      this.slots[slot] = this.pendingFaceId;
      this.shownSlot = slot;
      this.pendingFaceId = null;
    }
  }

  /** Routes: the file put together; once whole, its track ID and body CRC go into the library at the header's slot. */
  private routeBlock(block: Buffer, offset: number, remaining: number, slot: number): void {
    this.routeFile = offset === 0 ? block : Buffer.concat([this.routeFile, block]);
    if (remaining !== block.length) return;
    const file = this.routeFile;
    this.routes.set(slot, { trackId: file.readBigUInt64LE(16 + 165), crc16: u16(file, 12) });
  }

  async disconnect(): Promise<void> { this.isConnected = false; }
}
