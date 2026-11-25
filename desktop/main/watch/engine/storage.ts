// How full the watch is, as the COROS app's Storage card shows it. A port of CorosKit's WatchData/WatchStorage.swift.
// Asked with `B6 07` on control (PACE Pro W332 3.2008.0); the watch answers one status byte (1) and six little-endian
// u64 byte counts: maps, music, training programs, routes, free, total (`CRSBleDeviceStorageInfo parseStorageV2:`).
import { CorosError } from "./bytes";

export const STORAGE_OPCODE = 0xb6;
export const STORAGE_REQUEST = Buffer.from([0x07]);

/** Byte counts (as numbers: a watch's flash is far below 2^53). */
export interface WatchStorage {
  maps: number;
  audio: number;
  /** Training plans and structured workouts on the watch. */
  workouts: number;
  routes: number;
  free: number;
  total: number;
}

export function decodeStorage(reply: Uint8Array): WatchStorage {
  if (reply.length < 49 || reply[0] !== 1) throw new CorosError("The watch didn't report its storage.");
  const at = (field: number) => Buffer.from(reply.buffer, reply.byteOffset, reply.byteLength).readBigUInt64LE(1 + field * 8);
  const [maps, audio, workouts, routes, free, total] = [0, 1, 2, 3, 4, 5].map(at);
  // The watch's sum wraps as the Swift's &+ does.
  const known = BigInt.asUintN(64, maps + audio + workouts + routes + free);
  if (total === 0n || free > total || known > total) throw new CorosError("The watch reported storage that doesn't add up.");
  return { maps: Number(maps), audio: Number(audio), workouts: Number(workouts), routes: Number(routes), free: Number(free), total: Number(total) };
}

export const storageUsed = (s: WatchStorage): number => s.total - s.free;

/** The firmware, watch faces, workouts recorded and everything else the watch doesn't list. */
export function storageOther(s: WatchStorage): number {
  const known = s.maps + s.audio + s.workouts + s.routes + s.free;
  return s.total > known ? s.total - known : 0;
}
