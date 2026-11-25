// The watch link over clink-ble (native/ble): CorosKit's WatchTransport — control exchanges, SFT file blocks and
// SyncData reads — as clink-ble's JSON-lines operations. clink-ble only moves GATT frames; the watch key never
// reaches it (the engine signs the watch's challenge and sends the answer through `exchange`).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { CorosError, u32 } from "./bytes";
import type { DeviceInfo } from "./models";

/** Starts clink-ble; tests give a fake one. */
export type BleSpawner = () => ChildProcessWithoutNullStreams;
export const spawnBle = (binary: string): BleSpawner => () => spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });

/** What clink-ble answers (CorosLink's helper protocol). */
interface BleState {
  phase?: string;
  connected?: boolean;
  bluetoothState?: string;
  deviceName?: string;
  deviceId?: string;
  maximumWriteBytes?: number;
  batteryPercent?: number;
  modelNumber?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  softwareRevision?: string;
  discoveredDevices?: { deviceId: string; deviceName: string; rssiDbm?: number }[];
  [key: string]: unknown;
}
interface BleAnswer { id: number; result?: BleState; payload?: string; error?: string; detail?: Record<string, unknown> }

export class BleProblem extends CorosError {
  constructor(message: string, readonly detail?: Record<string, unknown>) { super(message); }
}

/**
 * The watch answered a SyncData read with a short header (CorosKit's WatchSyncFile.Refused): a code at @12 and no
 * size. 0x16 = busy (a workout starting, another sync), 0 = another client's sync got in the way (C-LINK's own code),
 * 0x14 = nothing to give.
 */
export class SyncRefused extends CorosError {
  static readonly anotherSync = 0;
  constructor(readonly code: number) {
    super(code === SyncRefused.anotherSync ? "Another app is syncing with the watch. C-LINK reads it again later."
      : code === 0x16 ? "The watch is busy with a workout or another sync. C-LINK reads it again later."
      : `The watch refused the read (code ${code}).`);
  }
  get isBusy(): boolean { return this.code === 0x16 || this.code === SyncRefused.anotherSync; }
  get isNothing(): boolean { return this.code === 0x14; }
}

/**
 * Unasked lines from clink-ble: the link dropping, the watch's USB prompt, and `interactive` (an unasked control
 * 0x0D message such as live workout data: `subtype` and base64 `payload`, the body after the subtype).
 */
export type BleEvent = { event: string; detail?: Record<string, unknown>; subtype?: number; payload?: string };

/** SFT file indexes and the clink-ble operation that sends each. */
const FILE_OPERATIONS: Record<number, string> = { 8: "watchfaceBlock", 0x14: "routeBlock", 93: "musicDelete" };

export class BleLink {
  private child: ChildProcessWithoutNullStreams | null = null;
  private next = 1;
  private readonly waiting = new Map<number, { resolve: (a: BleAnswer) => void; reject: (e: Error) => void }>();
  private state: BleState = {};
  /** Called with each unasked line and when clink-ble stops. */
  onEvent: (event: BleEvent) => void = () => {};

  constructor(private readonly start: BleSpawner, private readonly log: (line: string) => void = () => {}) {}

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = this.start();
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.take(line));
    createInterface({ input: child.stderr }).on("line", (line) => this.log(line.slice(0, 300)));
    const ended = (why: string) => {
      if (this.child !== child) return;
      this.child = null;
      this.state = {};
      for (const w of this.waiting.values()) w.reject(new BleProblem(why));
      this.waiting.clear();
      this.onEvent({ event: "disconnected", detail: { reason: why } });
    };
    child.on("exit", (code, signal) => ended(signal === "SIGTERM" ? "Stopped." : `The Bluetooth helper stopped (${signal ?? code}).`));
    child.on("error", (error) => ended(`The Bluetooth helper couldn't start: ${error.message}`));
    return child;
  }

  private take(line: string): void {
    let message: Record<string, unknown>;
    try { message = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    if (message.ready) return;
    if (typeof message.event === "string") {
      if (message.event === "disconnected") this.state = { ...this.state, connected: false, phase: "disconnected" };
      this.onEvent(message as BleEvent);
      return;
    }
    const answer = message as unknown as BleAnswer;
    const waiting = this.waiting.get(answer.id);
    if (!waiting) return;
    this.waiting.delete(answer.id);
    if (answer.result) this.state = answer.result;
    waiting.resolve(answer);
  }

  /** One clink-ble operation; it runs them one at a time, in order. */
  private async request(operation: string, fields: Record<string, unknown> = {}): Promise<BleAnswer> {
    const child = this.ensure();
    const id = this.next++;
    const answer = await new Promise<BleAnswer>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ ...fields, id, operation }) + "\n");
    });
    if (typeof answer.error === "string") throw new BleProblem(answer.error, answer.detail);
    return answer;
  }

  private payload(answer: BleAnswer): Buffer {
    if (typeof answer.payload !== "string") throw new CorosError("The watch didn't answer.");
    return Buffer.from(answer.payload, "base64");
  }

  // ── The link ──

  /** Bluetooth's state: ready, off, denied, unsupported or unknown. */
  async hello(): Promise<string> {
    try {
      const answer = await this.request("hello");
      return answer.result?.bluetoothState === "powered_on" ? "ready" : "unknown";
    } catch (error) {
      const state = error instanceof BleProblem ? error.detail?.bluetoothState : undefined;
      return state === "powered_off" ? "off" : state === "unauthorized" ? "denied" : state === "unsupported" ? "unsupported" : "unknown";
    }
  }

  async scan(): Promise<{ name: string; rssi?: number; id: string }[]> {
    const answer = await this.request("scan");
    return (answer.result?.discoveredDevices ?? []).map((d) => ({ name: d.deviceName, rssi: d.rssiDbm, id: d.deviceId }));
  }

  /** Connects to the watch advertising `name` (or remembered as `pinnedId`, checked by `pinnedSerial`). */
  async connect(name: string, pinned?: { id?: string; serial?: string }): Promise<DeviceInfo> {
    const fields: Record<string, unknown> = { deviceName: name };
    if (pinned?.id) { fields.deviceId = pinned.id; fields.pinnedId = pinned.id; }
    if (pinned?.serial) fields.pinnedSerial = pinned.serial;
    await this.request("connect", fields);
    return this.info;
  }

  get info(): DeviceInfo {
    const s = this.state;
    return {
      name: s.deviceName ?? "",
      modelNumber: s.modelNumber || undefined,
      firmwareRevision: s.firmwareRevision || undefined,
      softwareRevision: s.softwareRevision || undefined,
      serialNumber: s.serialNumber || undefined,
      batteryPercent: typeof s.batteryPercent === "number" ? s.batteryPercent : undefined,
      maximumWriteBytes: typeof s.maximumWriteBytes === "number" ? s.maximumWriteBytes : 20,
    };
  }

  /** The identity clink-ble connected to, to remember for next time. */
  get deviceId(): string | null { return this.state.deviceId ?? null; }

  get isConnected(): boolean { return this.child !== null && this.state.connected === true; }

  async refreshBattery(): Promise<void> {
    if (this.isConnected) await this.request("refresh").catch(() => {});
  }

  async disconnect(): Promise<void> {
    if (this.child) await this.request("disconnect").catch(() => {});
  }

  /** Stops clink-ble: whatever it was doing ends, and it lets go of the watch. */
  stop(): void {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    child.kill("SIGTERM");
  }

  // ── CorosKit's WatchTransport ──

  /** Sends a framed control message and returns the reassembled response for `opcode`. */
  async exchange(opcode: number, payload: Uint8Array, maximumWrite: number): Promise<Buffer> {
    const answer = await this.request("exchange", { opcode, payload: Buffer.from(payload).toString("base64"), maximumWriteBytes: maximumWrite });
    return this.payload(answer);
  }

  /**
   * Sends control frames exactly as given and returns the reassembled response for `opcode`, for a command the COROS
   * app frames its own way (CorosKit's `exchange(frames:opcode:)`; WatchFinding has no data, so no checksum).
   */
  async exchangeFrames(frames: Uint8Array[], opcode: number, timeoutMs?: number): Promise<Buffer> {
    const fields: Record<string, unknown> = { opcode, frames: frames.map((f) => Buffer.from(f).toString("base64")) };
    if (timeoutMs !== undefined) fields.timeoutMs = timeoutMs;
    return this.payload(await this.request("exchangeFrames", fields));
  }

  /** Sends one SFT file block: header on the control channel, data frames on bulk. */
  async sendFileBlock(header: Uint8Array, block: Uint8Array, fileIndex: number): Promise<void> {
    const operation = FILE_OPERATIONS[fileIndex] ?? "dataFileBlock";
    const fields: Record<string, unknown> = { header: Buffer.from(header).toString("base64"), block: Buffer.from(block).toString("base64") };
    if (operation === "dataFileBlock") fields.fileId = fileIndex;
    await this.request(operation, fields);
  }

  /** One block of a watch file, CRC-checked and never acknowledged: the bytes remaining from `offset`, and the block. */
  async readSyncBlock(fileIndex: number, offset: number): Promise<{ remaining: number; block: Buffer }> {
    let answer: BleAnswer;
    try {
      answer = await this.request("syncFileBlock", { fileIndex, offset, selector: 0 });
    } catch (error) {
      // clink-ble names the watch's short refusal header's code (@12) in `detail.refusedCode`.
      const code = error instanceof BleProblem ? error.detail?.refusedCode : undefined;
      if (typeof code === "number") throw new SyncRefused(code);
      throw error;
    }
    const data = this.payload(answer);
    if (data.length < 4) throw new CorosError("The watch returned invalid or incomplete records.");
    return { remaining: u32(data, 0), block: data.subarray(4) };
  }
}
