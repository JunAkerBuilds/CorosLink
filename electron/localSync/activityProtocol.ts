/**
 * COROS Protocol V2 SyncData (0x7C) for reading files *from* the watch,
 * generalised from CorosLink's validated music-inventory reader (file 93) to
 * the sport-record file (index 14).
 *
 * Wire shape (identical to the music reader, see scripts/coros_ble_music.py):
 *   request  0x7C control, SUM-8 framed in 18-byte fragments:
 *            [file u8][offset u32][0][secs since 2014 u32][utc/15min i8][3][u32 0][selector u32]
 *   header   0x7C control reply: block size @4 (u16), bytes remaining @6 (u32),
 *            CRC16 @10, category @12 (0), packet size @13, window @14, file @15, 3 @16
 *   data     bulk notifications [0x7C][seq][file][bytes…]; the phone re-arms each
 *            window with [0x7C, 0, file] on the bulk channel (no SUM)
 *
 * The transports encode the request and check each header and block
 * (scripts/coros_ble_activity.py, native/corebluetooth/main.swift), tested
 * against the shared vectors in scripts/fixtures/coros-sync-file-vectors.json.
 *
 * CorosLink never acknowledges (the phone app's 0x7D): acknowledging moves the
 * watch's sync pointer, and the COROS app would then never upload those
 * records. No transport has an acknowledge operation; each block is read with
 * `syncFileBlock` (read + verify). A PACE 4 (V3.2008.0) serves any offset
 * without acknowledgements, so the watch's sync state is never changed. Every
 * bound below is enforced on both transports. The file's contents are decoded
 * by `corosSportRecord.ts`.
 *
 * An unacknowledged read needs no close and no disconnect (PACE 4, W336
 * firmware 3.2008.0): the watch keeps each transfer in one of six slots that a
 * new 0x7C for the same file reuses, never refuses a request because a slot is
 * open, clears a slot left waiting for its ack after about ten heartbeat ticks
 * without committing, and moves its sync pointer only on a 0x7D with the flag
 * byte set. The protocol's cancel, 0x41 `[2, file]`, also closes a read without
 * committing; the COROS app has it but never sends it, and CorosLink
 * doesn't either.
 */

export const PEDOMETER_OPCODE = 0x90;
export const SPORT_RECORD_FILE = 14;
/** All-day health history: steps and calories per minute, heart rate, sleep, HRV, stress. */
export const DAILY_DATA_FILE = 5;
/** Only these indexes may be requested through `syncFileBlock`; never a write or delete file. */
export const READ_ONLY_SYNC_FILES: ReadonlySet<number> = new Set([SPORT_RECORD_FILE, DAILY_DATA_FILE]);
const SYNC_MAX_BLOCK_BYTES = 12_288;
export const SYNC_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const COROS_MOBILE_EPOCH = 1_388_534_400;

export class SyncProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncProtocolError";
  }
}

export function assertReadableSyncFile(fileIndex: number): void {
  if (!READ_ONLY_SYNC_FILES.has(fileIndex)) throw new SyncProtocolError(`File ${fileIndex} is not a read-only sync file.`);
}

/**
 * Tracks one file across blocks on the Electron side: the first header fixes
 * the total; every later header must agree (`offset + remaining === total`),
 * otherwise the watch's file changed underneath us and the read restarts.
 */
export class SyncFileCursor {
  private totalBytes?: number;

  constructor(private offsetBytes = 0, total?: number) {
    this.totalBytes = total;
  }

  get offset(): number { return this.offsetBytes; }
  get total(): number | undefined { return this.totalBytes; }
  get complete(): boolean { return this.totalBytes !== undefined && this.offsetBytes === this.totalBytes; }

  /** Validates a block before it is written; returns the block's offset in the file. */
  accept(block: Uint8Array, remaining: number): number {
    if (block.byteLength <= 0 || block.byteLength > SYNC_MAX_BLOCK_BYTES || block.byteLength > remaining) {
      throw new SyncProtocolError("The watch sent a block that does not fit the file.");
    }
    const total = this.offsetBytes + remaining;
    if (total > SYNC_MAX_FILE_BYTES) throw new SyncProtocolError("The watch file exceeds the supported size.");
    if (this.totalBytes === undefined) this.totalBytes = total;
    else if (this.totalBytes !== total) throw new SyncFileChangedError();
    const start = this.offsetBytes;
    this.offsetBytes += block.byteLength;
    return start;
  }
}

export class SyncFileChangedError extends SyncProtocolError {
  constructor() {
    super("The watch's records changed during the transfer. The sync restarts from the beginning.");
    this.name = "SyncFileChangedError";
  }
}

// ----- Pedometer (0x90): today's running totals -----

export interface PedometerTotals {
  steps: number;
  distanceMeters: number;
  /** Kilocalories (the watch reports small calories). */
  calories: number;
  activeSeconds?: number;
  month?: number;
  day?: number;
}

/**
 * `GetPedometer` (0x90) reply, little-endian, as a PACE 4 on V3.2008.0 sends
 * it (captured 2026-10-18; there is no leading status byte):
 * int32 steps, int32 distance (cm), int32 calories (small cal), int32 active
 * seconds, uint8 month, uint8 day, 2 padding bytes.
 */
export function decodePedometer(payload: Buffer): PedometerTotals {
  if (payload.length < 12 || payload.length > 64) throw new SyncProtocolError("The watch returned an invalid step summary.");
  const body = payload;
  const steps = body.readInt32LE(0);
  const distanceCm = body.readInt32LE(4);
  const smallCalories = body.readInt32LE(8);
  if (steps < 0 || steps > 500_000 || distanceCm < 0 || distanceCm > 50_000_000 || smallCalories < 0 || smallCalories > 100_000_000) {
    throw new SyncProtocolError("The watch returned an implausible step summary.");
  }
  const totals: PedometerTotals = { steps, distanceMeters: distanceCm / 100, calories: Math.round(smallCalories / 1000) };
  if (body.length >= 18) {
    const activeSeconds = body.readInt32LE(12);
    const month = body[16]!, day = body[17]!;
    if (activeSeconds >= 0 && activeSeconds <= 86_400) totals.activeSeconds = activeSeconds;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) Object.assign(totals, { month, day });
  }
  return totals;
}
