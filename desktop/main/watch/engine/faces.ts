// Watch faces over the link: the slot inventory (0x96), the face on screen (0xB7), and verified installs as SFT file
// index 8 in 4 KB blocks. A port of CorosKit's Protocol/WatchfaceProtocol.swift, Protocol/FaceInstallCheck.swift and
// WatchSession's face methods, with the CorosKit helper's `faces`, `showFace` and `install` answers (Faces in
// the retired clink-watch helper's main.swift).
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CorosError, crc16Ccitt, put16, put32, sum8, u16, u32 } from "./bytes";
import { displayName, magic, TARGETS, targetOf } from "./models";
import { compact, fromRefSeconds, refSeconds } from "./native";
import type { WatchSession } from "./session";

/** A progress line, as the helper wrote it: `{event: "progress", step, …}`. */
export type Emit = (event: Record<string, unknown>) => void;

export const FACE_FILE_INDEX = 8;
export const FACE_MAXIMUM_BYTES = 0x320000;
export const FACE_BLOCK_BYTES = 4096;
export const INVENTORY_OPCODE = 0x96;
export const FACES_OPCODE = 0xb7;
export const EMPTY_SLOT = 0xffffffff;

const magicOf = (bin: Uint8Array): string => Buffer.from(bin.subarray(0, 4)).toString("utf8");

// ── WatchfaceProtocol ──

/**
 * Command 0x96's answer: five or ten little-endian IDs, no result prefix. A PACE Pro answers 20 or 40 bytes and has
 * ten slots; other watches get only the slots they report, so a face never goes to a slot they may not have.
 */
export function decodeInventory(payload: Uint8Array, padsToTen = true): number[] {
  if (padsToTen && (payload.length === 20 || payload.length === 40)) {
    return Array.from({ length: 10 }, (_, slot) => (slot * 4 < payload.length ? u32(payload, slot * 4) : EMPTY_SLOT));
  }
  if (payload.length % 4 !== 0 || payload.length < 4 || payload.length > 40) {
    throw new CorosError(`The watch returned an unsupported watch face inventory (${payload.length} bytes).`);
  }
  return Array.from({ length: payload.length / 4 }, (_, i) => u32(payload, i * 4));
}

export function firstEmptySlot(ids: number[]): number {
  const slot = ids.indexOf(EMPTY_SLOT);
  if (ids.length < 1 || ids.length > 10 || slot < 0) throw new CorosError("All watch face slots are occupied. Choose a face to replace.");
  return slot;
}

/** Rechecks a chosen slot against a fresh inventory before anything is written. */
export function selectSlot(ids: number[], slot: number, expectedFaceId: number | undefined, replaceExisting: boolean): number {
  if (ids.length < 1 || ids.length > 10 || slot < 0 || slot >= ids.length) throw new CorosError("Choose a valid watch face slot.");
  const expected = expectedFaceId ?? EMPTY_SLOT;
  if (ids[slot] !== expected) throw new CorosError("The selected watch face slot changed. Refresh slots and choose it again.");
  if (expected !== EMPTY_SLOT && !replaceExisting) throw new CorosError("Choose the occupied slot for replacement before installing.");
  return slot;
}

/** The face on screen and every slot's ID, from 0xB7 subcommand 0. */
export interface ShownFace { slot: number; faceId: number; slots: number[] }

/** `[1][record count]`, then 5-byte records `[slot][face ID u32]`: the face on screen first, then each slot in order. */
export function decodeShownFace(payload: Uint8Array): ShownFace {
  const count = payload.length >= 2 ? payload[1] : 0;
  const refuse = () => new CorosError("The watch didn't say which face it shows.");
  if (payload[0] !== 1 || count < 2 || payload.length !== 2 + count * 5) throw refuse();
  const records = Array.from({ length: count }, (_, i) => ({ slot: payload[2 + i * 5], id: u32(payload, 3 + i * 5) }));
  const slots = records.slice(1);
  if (slots.length > 10 || !slots.every((r, i) => r.slot === i) || records[0].slot >= slots.length) throw refuse();
  return { slot: records[0].slot, faceId: records[0].id, slots: slots.map((r) => r.id) };
}

/** Subcommand 1: show the face in `slot`; the watch refuses a slot that holds another face. */
export function encodeShowFace(slot: number, faceId: number): Buffer {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 10 || faceId === EMPTY_SLOT) throw new CorosError("Choose a valid watch face slot.");
  const payload = Buffer.from([1, 1, slot, 0, 0, 0, 0]);
  put32(payload, faceId, 3);
  return payload;
}

/** The watch answers 1 once the face is on screen, and 3 for a slot or face ID it refuses. */
export function requireShown(reply: Uint8Array): void {
  if (reply.length !== 1 || reply[0] !== 1) throw new CorosError("The watch didn't switch faces. Refresh the slots and try again.");
}

/** Wraps a compiled BIN in the 16-byte SFT "HF" file header. */
export function encodeFaceFile(body: Uint8Array): { file: Buffer; faceId: number } {
  if (body.length < 0x340 || body.length + 16 > FACE_MAXIMUM_BYTES || !TARGETS.some((t) => magic(t) === magicOf(body))) {
    throw new CorosError("Choose a compiled COROS watch face smaller than 3.2 MB.");
  }
  validateLayoutHeaders(body);
  if (u32(body, 8) !== body.length - 18 || u16(body, 12) !== crc16Ccitt(body.subarray(18))) {
    throw new CorosError("The compiled watch face length or checksum is invalid.");
  }
  const faceId = u32(body, 4);
  if (faceId === EMPTY_SLOT) throw new CorosError("The compiled watch face has an invalid identifier.");
  const header = Buffer.alloc(16);
  header[0] = 0x48; header[1] = 0x46; header[3] = FACE_FILE_INDEX;
  put32(header, body.length, 8);
  put16(header, crc16Ccitt(body), 12);
  put16(header, crc16Ccitt(header.subarray(0, 14)), 14);
  return { file: Buffer.concat([header, body]), faceId };
}

/** The normal (and optional AOD) layout headers must be in bounds. */
function validateLayoutHeaders(body: Uint8Array): void {
  const minimum = 0x340, maximum = 0x2000;
  const header = (offset: number, normal: boolean): number => {
    if (offset < 0 || offset + minimum > body.length || !Buffer.from(body.subarray(offset, offset + 4)).equals(Buffer.from(body.subarray(0, 4)))) {
      throw new CorosError("The compiled watch face has an invalid layout header.");
    }
    const declared = u16(body, offset + 0x138);
    const length = declared !== 0 ? declared : normal ? u32(body, offset + 0x1a) : 0;
    if (length < minimum || length > maximum || offset + length > body.length) {
      throw new CorosError("The compiled watch face has an unsupported layout size.");
    }
    return length;
  };
  const normal = header(0, true);
  const aod = normal >= 0x326 ? u32(body, 0x322) : 0;
  if (aod !== 0) {
    if (aod < normal) throw new CorosError("The compiled watch face has an invalid AOD layout.");
    header(aod, false);
  }
}

/**
 * The 21-byte header that announces one SFT block on the control channel (faces: slot 0–9; routes use the same
 * layout with their own file index and slot range).
 */
export function encodeSftBlockHeader(block: Uint8Array, offset: number, total: number, slot: number, fileIndex: number): Buffer {
  const header = Buffer.alloc(21);
  header[0] = 0x78; header[2] = fileIndex;
  put32(header, offset, 3);
  put16(header, block.length, 7);
  put32(header, total - offset, 9);
  put16(header, crc16Ccitt(block), 13);
  header[15] = sum8(block);
  header[16] = slot;
  header[19] = 3;
  header[20] = sum8(header.subarray(2, 20));
  return header;
}

export function encodeFaceBlockHeader(block: Uint8Array, offset: number, total: number, slot: number): Buffer {
  if (block.length === 0 || block.length > FACE_BLOCK_BYTES || offset < 0 || offset + block.length > total || total > FACE_MAXIMUM_BYTES || slot < 0 || slot >= 10) {
    throw new CorosError("Invalid watch face transfer block.");
  }
  return encodeSftBlockHeader(block, offset, total, slot, FACE_FILE_INDEX);
}

// ── Session operations (WatchSession's face methods) ──

async function slotsNow(session: WatchSession): Promise<number[]> {
  session.requireAuthenticated();
  const reply = await session.link.exchange(INVENTORY_OPCODE, Buffer.from([0]), 20);
  return decodeInventory(reply, targetOf(session.link.info)?.id === "pace-pro");
}

async function shownFaceNow(session: WatchSession): Promise<ShownFace> {
  session.requireAuthenticated();
  return decodeShownFace(await session.link.exchange(FACES_OPCODE, Buffer.from([0]), 20));
}

/** The slot IDs (ten on PACE Pro); EMPTY_SLOT marks a free one. */
export const readSlots = (session: WatchSession): Promise<number[]> => session.exclusively(() => slotsNow(session));

/** The face on screen and the slots (0xB7). An answer not laid out as a PACE Pro's is refused. */
export const readShownFace = (session: WatchSession): Promise<ShownFace> => session.exclusively(() => shownFaceNow(session));

/** Puts the face in `slot` on screen while the slot still holds `faceId`, then reads back what the watch shows. */
export function showFace(session: WatchSession, slot: number, faceId: number): Promise<ShownFace> {
  return session.exclusively(async () => {
    const before = await shownFaceNow(session);
    if (!(slot >= 0 && slot < before.slots.length) || before.slots[slot] !== faceId) {
      throw new CorosError("The selected watch face slot changed. Refresh slots and choose it again.");
    }
    if (before.slot === slot) return before;
    requireShown(await session.link.exchange(FACES_OPCODE, encodeShowFace(slot, faceId), 20));
    const after = await shownFaceNow(session);
    if (after.slot !== slot || after.faceId !== faceId) throw new CorosError("The watch didn't switch faces. Refresh the slots and try again.");
    return after;
  });
}

export interface InstallTarget {
  slot: number;
  /** What the slot held when it was chosen (undefined for empty). */
  expectedFaceId?: number;
  replaceExisting: boolean;
}

export type Verification = "inventoryId" | "transferAcknowledged";

/** How the last install on a session went, kept after it fails (a subset of CorosKit's InstallDiagnostics). */
export interface InstallDiagnostics {
  stage: "preparing" | "sending" | "verifying" | "installed";
  binBytes: number;
  binSHA256: string;
  fileBytes: number;
  slot?: number;
  sentBytes: number;
  /** The block in flight (from zero) and how many the file needs. */
  block: number;
  blockCount: number;
  slotChecks: number;
  /** After the last failure, how the watch answered the block's resend. */
  probe?: string;
  /** Failures the transfer got past by resending the block. */
  recovered: string[];
  /** When the file went through a second time: the blocks (from one) sent then. */
  refilled?: number[];
}

const installs = new WeakMap<WatchSession, InstallDiagnostics>();
export const lastInstall = (session: WatchSession): InstallDiagnostics | undefined => installs.get(session);

/** Waits and retries, in milliseconds. Tests shorten them. */
export const faceTiming = { queuePoll: 250, queueWait: 45_000, verifyPause: 500, resendQuiet: 3000, resendCap: 6000 };
/** Failed blocks an install resends before it gives up. */
const MAXIMUM_RESENDS = 3;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Thrown when an install or a route transfer is cancelled. */
export class Cancelled extends CorosError {
  constructor() { super("Cancelled."); }
}

/** Reading the slots is safe on any watch; writing a face needs a BIN built for this model's screen. */
function requireInstallable(session: WatchSession, bin: Uint8Array): void {
  session.requireAuthenticated();
  const info = session.link.info;
  const watch = targetOf(info);
  if (!watch) throw new CorosError(`C-LINK doesn't support installing faces on ${displayName(info.name)} (model ${info.modelNumber ?? "unknown"}) yet.`);
  const binMagic = magicOf(bin);
  if (binMagic !== magic(watch)) {
    const other = TARGETS.find((t) => magic(t) === binMagic);
    const builtFor = other ? `a ${other.screen} px ${other.label}` : "another watch";
    throw new CorosError(`This face was built for ${builtFor}, not your ${watch.label}. Add it again for this watch.`);
  }
}

/**
 * Sends a compiled BIN in 4 KB blocks, then confirms the slot reports its face ID. The slot is rechecked against a
 * fresh inventory before anything is written. Waits at most `queueWait` for other watch operations, letting Cancel
 * work meanwhile.
 */
export async function installFace(session: WatchSession, bin: Uint8Array, target: InstallTarget | undefined,
  progress: (sent: number, total: number) => void, isCancelled: () => boolean = () => false): Promise<{ slot: number; verification: Verification }> {
  let state: "waiting" | "running" | "abandoned" = "waiting";
  const work = session.exclusively(() => {
    if (state === "abandoned") return Promise.reject(new Cancelled());
    state = "running";
    return installNow(session, bin, target, progress, isCancelled);
  });
  work.catch(() => {});
  const started = Date.now();
  const waiting = (async () => {
    // Let the queue start the work if nothing else holds it.
    await Promise.resolve();
    while (state === "waiting") {
      if (isCancelled()) { state = "abandoned"; throw new Cancelled(); }
      if (!session.link.isConnected) { state = "abandoned"; throw new CorosError("The watch disconnected. Reconnect it, then send the face again."); }
      if (Date.now() - started > faceTiming.queueWait) {
        state = "abandoned";
        throw new CorosError("The watch isn't answering. Reconnect it from the Watch tab, then send the face again.");
      }
      await pause(faceTiming.queuePoll);
    }
  })();
  await waiting;
  return work;
}

async function installNow(session: WatchSession, bin: Uint8Array, target: InstallTarget | undefined,
  progress: (sent: number, total: number) => void, isCancelled: () => boolean): Promise<{ slot: number; verification: Verification }> {
  const link = session.link;
  const report: InstallDiagnostics = { stage: "preparing", binBytes: bin.length, binSHA256: createHash("sha256").update(bin).digest("hex"),
    fileBytes: 0, sentBytes: 0, block: 0, blockCount: 0, slotChecks: 0, recovered: [] };
  installs.set(session, report);
  requireInstallable(session, bin);
  const { file, faceId } = encodeFaceFile(bin);
  const ids = await slotsNow(session);
  const slot = target ? selectSlot(ids, target.slot, target.expectedFaceId, target.replaceExisting) : firstEmptySlot(ids);
  const blockCount = Math.ceil(file.length / FACE_BLOCK_BYTES);
  Object.assign(report, { slot, fileBytes: file.length, blockCount, stage: "sending" });
  progress(0, file.length);
  let offset = 0, started = false, refilling = false;
  try {
    for (;;) {
      while (offset < file.length) {
        if (isCancelled()) throw new Cancelled();
        if (!link.isConnected) throw new CorosError("The watch disconnected during the transfer. Reconnect and install again.");
        const block = file.subarray(offset, Math.min(offset + FACE_BLOCK_BYTES, file.length));
        const header = encodeFaceBlockHeader(block, offset, file.length, slot);
        const index = offset / FACE_BLOCK_BYTES;
        started = true;
        report.block = index;
        try {
          await link.sendFileBlock(header, block, FACE_FILE_INDEX);
        } catch (error) {
          if (error instanceof Cancelled || report.recovered.length >= MAXIMUM_RESENDS || !(await resendAfterFailure(session, report, header, block, index))) throw error;
        }
        if (refilling) report.refilled?.push(index + 1);
        offset += block.length;
        report.sentBytes = offset;
        progress(offset, file.length);
      }
      report.stage = "verifying";
      for (let check = 0; check < 8; check++) {
        report.slotChecks += 1;
        if ((await slotsNow(session))[slot] === faceId) {
          report.stage = "installed";
          return { slot, verification: target?.expectedFaceId === faceId ? "transferAcknowledged" : "inventoryId" };
        }
        await pause(faceTiming.verifyPause);
      }
      // The watch lists a face only once it has every block: go through the file once more (the watch takes what
      // it lacks and says it has the rest), then look again.
      if (refilling || !link.isConnected) throw new CorosError("The watch didn't confirm the new face in its slot list. Check the watch, then try again.");
      refilling = true;
      report.refilled = [];
      report.stage = "sending";
      offset = 0;
    }
  } catch (error) {
    // A partial transfer leaves the watch mid-file; drop the link as the desktop does.
    if (started) await link.disconnect();
    throw error;
  }
}

/**
 * After a block fails: listens for late replies, then resends the block once, giving up on the link if the watch
 * doesn't answer. The watch's replies carry no block number, so one stray reply leaves every answer after it a block
 * off; with the link quiet, the resend puts the two back in step. Returns whether the watch took it.
 */
async function resendAfterFailure(session: WatchSession, report: InstallDiagnostics, header: Uint8Array, block: Uint8Array, index: number): Promise<boolean> {
  const link = session.link;
  await pause(faceTiming.resendQuiet);
  if (!link.isConnected) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<string>((resolve) => {
    timer = setTimeout(() => { void link.disconnect(); resolve("failed (no answer)"); }, faceTiming.resendCap);
  });
  const sent = link.sendFileBlock(header, block, FACE_FILE_INDEX).then(() => "accepted", (e: unknown) => `failed (${e instanceof Error ? e.message : String(e)})`);
  const outcome = await Promise.race([sent, cap]);
  clearTimeout(timer);
  report.probe = `block ${index + 1} ${outcome}`;
  if (outcome !== "accepted") return false;
  report.recovered.push(`block ${index + 1} ${report.stage}`);
  return true;
}

// ── The helper's commands (Faces in the retired helper's main.swift) ──

export interface FaceSlots { slots: ({ slot: number } | { slot: number; faceId: number })[]; shown: number | null; installed?: number }

export const describeFaces = (ids: number[], shown: number | null): FaceSlots => ({
  slots: ids.map((id, slot) => (id === EMPTY_SLOT ? { slot } : { slot, faceId: id })),
  shown,
});

/** The slots and the face on screen; only the slots on a watch whose answer to "what's shown" isn't PACE Pro's. */
export async function readFaces(session: WatchSession): Promise<FaceSlots> {
  let shown: ShownFace | null = null;
  try { shown = await readShownFace(session); } catch { /* read the slots alone */ }
  if (shown) return describeFaces(shown.slots, shown.slot);
  return describeFaces(await readSlots(session), null);
}

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isUInt32 = (value: number) => value >= 0 && value <= 0xffffffff;

/** `showFace`: {slot, faceId}. */
export async function showFaceCommand(session: WatchSession, request: Record<string, unknown>): Promise<FaceSlots> {
  const { slot, faceId } = request;
  if (!isInt(slot) || !isInt(faceId)) throw new CorosError("Pick a face on the watch.");
  if (!isUInt32(faceId)) throw new CorosError("Refresh the slots and choose the face again.");
  const shown = await showFace(session, slot, faceId);
  return describeFaces(shown.slots, shown.slot);
}

/**
 * `install`: a compiled BIN (`path`, which the app removes) into the first empty slot, or into `slot` when it still
 * holds `expectedFaceId` (`replace` to overwrite it). Emits `{event: "progress", step: "face", percent}`.
 */
export async function installCommand(session: WatchSession, request: Record<string, unknown>, emit: Emit, isCancelled?: () => boolean): Promise<FaceSlots> {
  const path = request.path;
  if (typeof path !== "string") throw new CorosError("No watch face to send.");
  let bin: Buffer;
  try { bin = await readFile(path); } catch { throw new CorosError("The watch face file couldn't be read."); }
  return installBin(session, bin, request, emit, isCancelled);
}

/** `install` with the BIN in hand (`request` as for installCommand, without `path`). */
export async function installBin(session: WatchSession, bin: Uint8Array, request: Record<string, unknown>, emit: Emit, isCancelled?: () => boolean): Promise<FaceSlots> {
  let target: InstallTarget | undefined;
  if (isInt(request.slot)) {
    const expected = isInt(request.expectedFaceId) && isUInt32(request.expectedFaceId) ? request.expectedFaceId : undefined;
    target = { slot: request.slot, expectedFaceId: expected, replaceExisting: typeof request.replace === "boolean" ? request.replace : false };
  }
  emit({ event: "progress", step: "face", percent: 0 });
  const done = await installFace(session, bin, target, (sent, total) => {
    if (total > 0) emit({ event: "progress", step: "face", percent: Math.trunc((sent / total) * 100) });
  }, isCancelled);
  return { ...(await readFaces(session)), installed: done.slot };
}

// ── FaceInstallCheck ──

/**
 * Watches a face that installed for signs it crashed the watch: a watch that can't draw a face restarts (dropping the
 * link) and after a few restarts shows another face. The check stays open until C-LINK next sees the watch's faces.
 * Saved as CorosKit's Codable JSON (dates as seconds since 2001, see native.ts).
 */
export interface FaceInstallCheck {
  watchName: string;
  target: string;
  faceName: string;
  catalogSlug?: string;
  slot: number;
  faceId: number;
  installedAt: Date;
  firmware?: string;
  binBytes?: number;
  /** Link drops C-LINK didn't ask for, soon after the install. */
  drops: number;
  lastDropAt?: Date;
}

export const FACE_CHECK = {
  /** Drops this soon after the install count as possible restarts (seconds). */
  dropWindow: 15 * 60,
  /** After a drop, a face still on screen is trusted only once the link has stayed up this long. */
  settleTime: 5 * 60,
  /** This many drops is a restart loop, whatever the screen shows. */
  restartLoop: 3,
  /** An unanswered check is dropped after a day. */
  expiry: 24 * 60 * 60,
};

const secondsBetween = (later: Date, earlier: Date) => (later.getTime() - earlier.getTime()) / 1000;

/** The link dropped without C-LINK asking. */
export function linkDropped(check: FaceInstallCheck, at: Date): void {
  if (secondsBetween(at, check.installedAt) > FACE_CHECK.dropWindow) return;
  check.drops += 1;
  check.lastDropAt = at;
}

export interface CrashSigns {
  /** "restart loop", "face replaced after a restart", "face removed after a restart". */
  reason: string;
  drops: number;
  /** "installed face", "another face", "unknown". */
  screen: string;
  inSlot: boolean;
  secondsAfterInstall: number;
}

export type FaceVerdict = { kind: "waiting" } | { kind: "fine" } | { kind: "crashed"; signs: CrashSigns } | { kind: "expired" };

/** What the watch's slots and the face on its screen (null when the watch doesn't say) tell about the install. */
export function faceVerdict(check: FaceInstallCheck, watchName: string, slots: number[] | null, shown: ShownFace | null, now: Date): FaceVerdict {
  const age = secondsBetween(now, check.installedAt);
  if (age > FACE_CHECK.expiry) return { kind: "expired" };
  if (watchName !== check.watchName || !slots) return { kind: "waiting" };
  const inSlot = slots.includes(check.faceId);
  const onScreen = shown ? shown.faceId === check.faceId : null;
  const crashed = (reason: string): FaceVerdict => ({ kind: "crashed", signs: {
    reason, drops: check.drops, screen: onScreen === null ? "unknown" : onScreen ? "installed face" : "another face",
    inSlot, secondsAfterInstall: Math.trunc(age),
  } });
  if (check.drops >= FACE_CHECK.restartLoop) return crashed("restart loop");
  if (check.drops > 0) {
    if (!inSlot) return crashed("face removed after a restart");
    if (onScreen === false) return crashed("face replaced after a restart");
    // Still on screen: a restarting watch shows it again between restarts, so wait for a steady link.
    if (check.lastDropAt && secondsBetween(now, check.lastDropAt) < FACE_CHECK.settleTime) return { kind: "waiting" };
    return { kind: "fine" };
  }
  // No drop yet: a crash shows within minutes of the face going on screen, so wait that long.
  return age < FACE_CHECK.settleTime ? { kind: "waiting" } : { kind: "fine" };
}

/** The check as CorosKit's JSONEncoder writes it. */
export const encodeFaceCheck = (check: FaceInstallCheck): Record<string, unknown> => compact({
  ...check, installedAt: refSeconds(check.installedAt), lastDropAt: check.lastDropAt && refSeconds(check.lastDropAt),
});

export function decodeFaceCheck(json: Record<string, unknown>): FaceInstallCheck {
  const raw = json as unknown as FaceInstallCheck & { installedAt: number; lastDropAt?: number };
  return compact({ ...raw, drops: raw.drops ?? 0, installedAt: fromRefSeconds(raw.installedAt),
    lastDropAt: raw.lastDropAt === undefined ? undefined : fromRefSeconds(raw.lastDropAt) }) as FaceInstallCheck;
}
