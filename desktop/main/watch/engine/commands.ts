// What the COROS phone app pushes over Protocol V2, encoded as the app encodes it. A port of CorosKit's
// WatchData/WatchCommands.swift. Payloads are little-endian; the watch acknowledges a command with one byte, 1.
import { CorosError, put16, put32 } from "./bytes";
import { COROS_EPOCH } from "./systemBind";

/** SYNC_TIME: the clock, time zone and 12/24-hour display. */
export const SYNC_TIME = 0x8c;

/** The app waits out the first 10 seconds after local midnight, when the watch rolls its day over. */
export function nearLocalMidnight(now: Date): boolean {
  return now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 10;
}

/** u32 seconds since 2014, i8 UTC offset in 30-minute units, i8 in 15-minute units, u8 12-hour flag, u16 ms. */
export function syncTime(now: Date, hour12: boolean, offsetMinutes: number = -now.getTimezoneOffset()): Buffer {
  const ms = now.getTime();
  const payload = Buffer.alloc(9);
  put32(payload, Math.floor(ms / 1000) - COROS_EPOCH, 0);
  // The app's integer division truncates toward zero; the watch expects the same.
  payload[4] = Math.trunc(offsetMinutes / 30) & 0xff;
  payload[5] = Math.trunc(offsetMinutes / 15) & 0xff;
  payload[6] = hour12 ? 1 : 0;
  put16(payload, Math.floor(ms) % 1000, 7);
  return payload;
}

/** A one-byte acknowledgement of 1; anything else is a refusal. */
export function requireAcknowledgement(reply: Uint8Array, refusal: string): void {
  if (reply[0] !== 1) throw new CorosError(refusal);
}
