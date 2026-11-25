// The watch's storage and its own Wi-Fi map downloads, both on command B6: storage (B6 07, CorosKit's
// WatchData/WatchStorage.swift), the task list (B6 0B FF), the readiness check (B6 19), start (B6 0A + id) and remove
// (B6 05 + id), as CorosLink's corosBleWifiProtocol.ts reads them from PACE Pro firmware W332 3.2008.0. A port of the
// CorosKit helper's MapTasks and MapCommands (the retired clink-watch helper's Maps.swift).
import { CorosError } from "./bytes";
import type { WatchSession } from "./session";

export const MAP_OPCODE = 0xb6;
const LIST_REQUEST = Buffer.from([0x0b, 0xff]);
const READY_REQUEST = Buffer.from([0x19]);
const STORAGE_REQUEST = Buffer.from([0x07]);
const INT64_MAX = (1n << 63n) - 1n;

const u64 = (b: Uint8Array, at: number): bigint => Buffer.from(b.buffer, b.byteOffset, b.byteLength).readBigUInt64LE(at);

// ── Storage ──

/** How full the watch is, as the COROS app's Storage card shows it, in bytes. */
export interface WatchStorage { maps: bigint; audio: bigint; workouts: bigint; routes: bigint; free: bigint; total: bigint }

/** Status 1 and six little-endian u64 byte counts: maps, music, training programs, routes, free, total. */
export function decodeStorage(reply: Uint8Array): WatchStorage {
  if (reply.length < 49 || reply[0] !== 1) throw new CorosError("The watch didn't report its storage.");
  const field = (i: number) => u64(reply, 1 + i * 8);
  const s = { maps: field(0), audio: field(1), workouts: field(2), routes: field(3), free: field(4), total: field(5) };
  // Swift's &+: the sum wraps at 64 bits.
  const known = BigInt.asUintN(64, s.maps + s.audio + s.workouts + s.routes + s.free);
  if (s.total === 0n || s.free > s.total || known > s.total) throw new CorosError("The watch reported storage that doesn't add up.");
  return s;
}

export const storageUsed = (s: WatchStorage): bigint => s.total - s.free;
/** The firmware, faces, recorded workouts and everything else the watch doesn't list. */
export function storageOther(s: WatchStorage): bigint {
  const known = BigInt.asUintN(64, s.maps + s.audio + s.workouts + s.routes + s.free);
  return s.total > known ? s.total - known : 0n;
}

/** The watch's storage, alone on the link. */
export function readStorage(session: WatchSession): Promise<WatchStorage> {
  session.requireAuthenticated();
  return session.exclusively(async () => decodeStorage(await session.link.exchange(MAP_OPCODE, STORAGE_REQUEST, 20)));
}

// ── Map tasks (pure codecs) ──

/**
 * COROS's task ids: eight ASCII letters, digits, "_" or "-". Never empty and never eight 0xFF bytes, which the
 * firmware reads as "every task".
 */
export const isTaskId = (id: string): boolean => /^[0-9A-Za-z_-]{8}$/.test(id);

export interface MapTask { id: string; state: string; status: number; downloadedBytes: number; totalBytes: number; errorCode: number }

/**
 * Status 1, a count up to 100, then 39-byte rows: status, 8-byte id, a byte, downloaded and total (u64 LE), and a
 * 16-bit little-endian error at 33–34.
 */
export function decodeTasks(reply: Uint8Array): MapTask[] {
  if (reply.length < 2 || reply[0] !== 1 || reply[1] > 100 || reply.length !== 2 + reply[1] * 39) {
    throw new CorosError("The watch returned an unsupported map-task list.");
  }
  return Array.from({ length: reply[1] }, (_, index) => {
    const row = reply.subarray(2 + index * 39, 2 + (index + 1) * 39);
    const id = Buffer.from(row.subarray(1, 9)).toString("utf8");
    if (!isTaskId(id)) throw new CorosError("The watch returned an invalid map-task id.");
    const downloaded = u64(row, 10), total = u64(row, 18);
    if (downloaded > total || total > INT64_MAX) throw new CorosError("The watch returned invalid map-download sizes.");
    const status = row[0], error = row[33] | (row[34] << 8);
    const state = error !== 0 ? "failed" : status === 3 && downloaded === total ? "complete" : status === 2 ? "queued" : status === 0 ? "downloading" : "unknown";
    return { id, state, status, downloadedBytes: Number(downloaded), totalBytes: Number(total), errorCode: error };
  });
}

/** What each readiness bit means, as the COROS app words it. */
export const READINESS_REASONS = [
  "Charge the watch before downloading maps.", "Stop music playback on the watch.", "Unplug the watch's USB cable.",
  "Finish the current activity on the watch.", "Charge the watch before downloading maps.", "Exit navigation on the watch.",
  "Finish the call on the watch.", "Wait for the watch to finish switching maps.",
  "The watch is busy with its screen. Keep it awake and try again shortly.",
];

/** Status 1 and a 32-bit little-endian flag word (5 or 17 bytes); no flags means ready. */
export function decodeReadiness(reply: Uint8Array): { flags: number; reasons: string[] } {
  if ((reply.length !== 5 && reply.length !== 17) || reply[0] !== 1) throw new CorosError("The watch couldn't check whether it can download maps.");
  const flags = (reply[1] | (reply[2] << 8) | (reply[3] << 16) | (reply[4] << 24)) >>> 0;
  const reasons: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (!((flags >>> bit) & 1)) continue;
    const reason = bit < READINESS_REASONS.length ? READINESS_REASONS[bit] : "The watch says downloads aren't available now. Keep it awake and try again shortly.";
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return { flags, reasons };
}

export function startPayload(id: string): Buffer {
  if (!isTaskId(id)) throw new CorosError("COROS returned an invalid map download id.");
  return Buffer.concat([Buffer.from([0x0a]), Buffer.from(id, "latin1"), Buffer.from([0, 0xff, 0xff])]);
}

export function removePayload(id: string): Buffer {
  if (!isTaskId(id)) throw new CorosError("Choose a download from the watch's list.");
  return Buffer.concat([Buffer.from([0x05]), Buffer.from(id, "latin1")]);
}

export function requireStarted(reply: Uint8Array): void {
  if (reply.length !== 1 || reply[0] !== 1) throw new CorosError("The watch didn't take the map download.");
}

export function requireRemoved(reply: Uint8Array): void {
  if (reply.length === 1 && reply[0] === 1) return;
  // 0x1A: the watch refuses while its USB cable is in.
  if (reply[0] === 0x1a) throw new CorosError("Unplug the watch's USB cable, then cancel the download again.");
  throw new CorosError(reply.length === 0 ? "The watch couldn't cancel the download." : `The watch couldn't cancel the download (code ${reply[0]}).`);
}

// ── The helper's commands (MapCommands) ──
// The helper ran one command at a time; here each runs alone on the link through `exclusively`.

const exchange = (session: WatchSession, payload: Uint8Array) => session.link.exchange(MAP_OPCODE, payload, 20);
const tasksNow = async (session: WatchSession) => ({ tasks: decodeTasks(await exchange(session, LIST_REQUEST)) });

/** `mapTasks`. */
export const mapTasks = (session: WatchSession): Promise<{ tasks: MapTask[] }> => session.exclusively(() => tasksNow(session));

/** `mapReady`. */
export function mapReady(session: WatchSession): Promise<{ ready: boolean; flags: number; reasons: string[] }> {
  return session.exclusively(async () => {
    const readiness = decodeReadiness(await exchange(session, READY_REQUEST));
    return { ready: readiness.flags === 0, flags: readiness.flags, reasons: readiness.reasons };
  });
}

/** `mapStart`: hands the watch COROS's task id; it then downloads over its own Wi-Fi. Refused unless the watch is ready. */
export function mapStart(session: WatchSession, request: Record<string, unknown>): Promise<{ tasks: MapTask[] }> {
  const id = request.taskId;
  if (typeof id !== "string") return Promise.reject(new CorosError("No map download to start."));
  return session.exclusively(async () => {
    const payload = startPayload(id);
    const readiness = decodeReadiness(await exchange(session, READY_REQUEST));
    if (readiness.reasons.length) throw new CorosError(readiness.reasons[0]);
    requireStarted(await exchange(session, payload));
    return tasksNow(session);
  });
}

/** `mapRemove`. */
export function mapRemove(session: WatchSession, request: Record<string, unknown>): Promise<{ tasks: MapTask[] }> {
  const id = request.taskId;
  if (typeof id !== "string") return Promise.reject(new CorosError("Choose a download from the watch's list."));
  return session.exclusively(async () => {
    requireRemoved(await exchange(session, removePayload(id)));
    return tasksNow(session);
  });
}

/** `storage`, in bytes. */
export async function storageCommand(session: WatchSession): Promise<{ maps: number; audio: number; workouts: number; routes: number; free: number; total: number }> {
  const s = await readStorage(session);
  // Swift's Int(clamping:) on 64-bit: anything past Int64.max is Int64.max.
  const n = (v: bigint) => Number(v > INT64_MAX ? INT64_MAX : v);
  return { maps: n(s.maps), audio: n(s.audio), workouts: n(s.workouts), routes: n(s.routes), free: n(s.free), total: n(s.total) };
}
