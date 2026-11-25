// A watch stand-in for the data tests: the parts of CorosKit's Bluetooth/SimulatedWatch.swift the settings, goals,
// alarms, storage, Find Watch and SyncData reads use, behind BleLink's methods. PACE Pro unless told otherwise.
import { CorosError, crc16Ccitt, u16, u32 } from "./bytes";
import type { DeviceInfo } from "./models";
import { ProtoWriter } from "./protobuf";
import { decodeSettings, encodeSettings, EXTENDED_SWITCHES, SETTINGS_GET, SETTINGS_SET, SWITCHES, USER_INFO } from "./settings";
import { encodeSettingsFile, USER_INFO_BYTES } from "./settingsFile";
import { alarmFromRecord, alarmRecord, alarmRecords, ALARM_SETTING, ALARM_SLOTS, hasValidTime, WRITE_OPCODE } from "./alarms";
import { STORAGE_OPCODE } from "./storage";
import { SYNC_USER_INFO } from "./userInfo";
import { WatchSession } from "./session";
import type { BleLink } from "./transport";

export const SAMPLE_PROFILE = new ProtoWriter().packed(1, [114, 133, 152, 171, 181]).packed(2, [129, 144, 156, 168, 180]).packed(3, [138, 151, 160, 169, 178])
  .packed(4, [390_000, 345_000, 315_000, 294_000, 275_000, 258_000]).int(9, 190).int(10, 52).int(11, 172).int(12, 1).int(13, 285_000).data;

/** 175 cm, 70 kg, 35 years, a 500 kcal goal, max and resting HR 190 and 52, sleep 23:00–07:00. */
export const SAMPLE_USER_INFO = (() => {
  const info = Buffer.alloc(USER_INFO_BYTES);
  info[0] = 175; info[1] = 70; info[2] = 35; info[53] = 190; info[54] = 52;
  info.writeUInt32LE(500, 7);
  info.set([23, 0, 7, 0], 55);
  return info;
})();

export class FakeWatch {
  info: DeviceInfo;
  isConnected = true;
  rings = 0;
  settings = new Map<number, Buffer>([
    [SWITCHES, Buffer.from([0x04, 0x20, 0x20, 0x40])],
    [EXTENDED_SWITCHES, Buffer.from([0, 0, 0, 0x40, 0x01, 0, 0x10, 0x10])],
    [USER_INFO, SAMPLE_PROFILE],
  ]);
  settingsFile: Buffer = encodeSettingsFile(SAMPLE_USER_INFO);
  dailyHistory: Buffer = Buffer.alloc(0);
  sportRecordFile: Buffer = Buffer.alloc(0);
  /** Files received over SendFile, by file index. */
  receivedFiles = new Map<number, Buffer>();
  /** Every SyncData read asked for, as [file, offset]. */
  reads: [number, number][] = [];
  /** Errors to throw from the next SyncData reads, in turn. */
  failReads: Error[] = [];
  /** What a received settings file does to `settingsFile` (a real watch restores the chunks it's sent). */
  onSettingsFile: (file: Buffer) => void = () => {};
  /** When set, a settings write's reply is lost after the watch has taken it. */
  loseNextWriteReply = false;

  constructor(name = "COROS PACE Pro 2F1A6C", modelNumber: string | null = "W332") {
    this.info = { name, modelNumber: modelNumber ?? undefined, firmwareRevision: "V3.2008.0", softwareRevision: "V3.2008.0", serialNumber: "SIM-0001", batteryPercent: 82, maximumWriteBytes: 244 };
  }

  async exchange(opcode: number, payload: Uint8Array): Promise<Buffer> {
    if (!this.isConnected) throw new CorosError("The watch is disconnected.");
    const request = Buffer.from(payload);
    switch (opcode) {
      case SETTINGS_GET:
        return encodeSettings([...request].flatMap((type) => (this.settings.has(type) ? [[type, this.settings.get(type)!] as [number, Buffer]] : [])));
      case SETTINGS_SET:
        for (const [type, value] of decodeSettings(request)) this.settings.set(type, value);
        if (this.loseNextWriteReply) { this.loseNextWriteReply = false; throw new CorosError("The watch didn't answer."); }
        return Buffer.from([1]);
      case WRITE_OPCODE: {
        if (request.length !== 4 || request[0] >= ALARM_SLOTS) break;
        const written = alarmFromRecord(request.subarray(1));
        const alarms = alarmRecords(this.settings.get(ALARM_SETTING) ?? Buffer.alloc(0)).filter((a) => a.slot !== written.slot);
        if (hasValidTime(written)) alarms.push(written);
        this.settings.set(ALARM_SETTING, Buffer.concat(alarms.sort((a, b) => a.slot - b.slot).map(alarmRecord)));
        return Buffer.from([1]);
      }
      case SYNC_USER_INFO:
        if (request.length !== USER_INFO_BYTES) break;
        this.settingsFile = encodeSettingsFile(request);
        return Buffer.from([1]);
      case 0x90: {
        const totals = Buffer.alloc(20);
        [8_412, 612_300, 386_000, 3_240].forEach((v, i) => totals.writeUInt32LE(v, i * 4));
        const now = new Date();
        totals[16] = now.getMonth() + 1; totals[17] = now.getDate();
        return totals;
      }
      case STORAGE_OPCODE: {
        if (!request.equals(Buffer.from([7]))) break;
        // 32 GB of flash as a PACE Pro reports it: maps, music, training plans, routes, free, total.
        const sizes = [6_120_000_000n, 412_000_000n, 2_400_000n, 18_600_000n, 22_350_000_000n, 34_359_738_368n];
        const storage = Buffer.alloc(49);
        storage[0] = 1;
        sizes.forEach((s, i) => storage.writeBigUInt64LE(s, 1 + i * 8));
        return storage;
      }
    }
    throw new CorosError("The watch didn't answer.");
  }

  /** Only Find Watch's request goes out unframed; anything else gets no answer. */
  async exchangeFrames(frames: Uint8Array[], opcode: number): Promise<Buffer> {
    if (!this.isConnected) throw new CorosError("The watch is disconnected.");
    if (opcode !== 0xb4 || frames.length !== 1 || !Buffer.from(frames[0]).equals(Buffer.from([0xb4, 0]))) throw new CorosError("The watch didn't answer.");
    this.rings += 1;
    return Buffer.from([1]);
  }

  async sendFileBlock(header: Uint8Array, block: Uint8Array, fileIndex: number): Promise<void> {
    if (!this.isConnected) throw new CorosError("The watch is disconnected.");
    if (header.length !== 21 || header[0] !== 0x78 || header[2] !== fileIndex || u16(header, 13) !== crc16Ccitt(block)) {
      throw new CorosError("The watch rejected the file transfer header.");
    }
    const offset = u32(header, 3), remaining = u32(header, 9);
    const file = offset === 0 ? Buffer.from(block) : Buffer.concat([this.receivedFiles.get(fileIndex) ?? Buffer.alloc(0), block]);
    this.receivedFiles.set(fileIndex, file);
    if (fileIndex === 54 && remaining === block.length) this.onSettingsFile(file);
  }

  async readSyncBlock(fileIndex: number, offset: number): Promise<{ remaining: number; block: Buffer }> {
    if (!this.isConnected) throw new CorosError("The watch is disconnected.");
    this.reads.push([fileIndex, offset]);
    const failure = this.failReads.shift();
    if (failure) throw failure;
    const file = fileIndex === 5 ? this.dailyHistory : fileIndex === 54 ? this.settingsFile : fileIndex === 14 ? this.sportRecordFile : undefined;
    // An empty file reads as a real watch's: a header with no records.
    if (file && file.length === 0 && offset === 0) return { remaining: 0, block: Buffer.alloc(0) };
    if (!file || offset >= file.length) throw new CorosError("The watch returned invalid or incomplete records.");
    return { remaining: file.length - offset, block: Buffer.from(file.subarray(offset, Math.min(offset + 4096, file.length))) };
  }

  async disconnect(): Promise<void> { this.isConnected = false; }
}

/** A session over the fake, already past SystemBind (the bind is phase A's, tested in engine.test.ts). */
export function fakeSession(watch = new FakeWatch()): { watch: FakeWatch; session: WatchSession } {
  const session = new WatchSession(watch as unknown as BleLink);
  session.authenticatedAt = new Date();
  return { watch, session };
}
