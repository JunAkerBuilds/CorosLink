/**
 * Watch settings and data the COROS phone app pushes over Protocol V2, encoded
 * the way the app encodes them. Payloads are little-endian; the watch
 * acknowledges with one status byte, 1 for success.
 */

/** Seconds between the Unix epoch and 2014-01-01 UTC, the watch's epoch. */
export const WATCH_EPOCH = 1_388_534_400;

/** SYNC_TIME, opcode 140: set the clock, time zone and 12/24-hour display. */
export const SYNC_TIME_OPCODE = 0x8c;

/** The app waits out the first 10 seconds after local midnight, when the watch rolls its day over. */
export function nearLocalMidnight(now: Date): boolean {
  return now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 10;
}

/**
 * u32 seconds since 2014, i8 UTC offset in 30-minute units, i8 UTC offset in
 * 15-minute units, u8 time format (1 = 12-hour, 0 = 24-hour), u16 milliseconds.
 * The offset is the one in force at `now`, so daylight-saving time is included.
 */
export function encodeSyncTime(now: Date, hour12: boolean): Buffer {
  const ms = now.getTime();
  const offsetMinutes = -now.getTimezoneOffset();
  const payload = Buffer.alloc(9);
  payload.writeUInt32LE(Math.floor(ms / 1000) - WATCH_EPOCH, 0);
  // The app's integer division truncates toward zero; the watch expects the same.
  payload.writeInt8(Math.trunc(offsetMinutes / 30), 4);
  payload.writeInt8(Math.trunc(offsetMinutes / 15), 5);
  payload[6] = hour12 ? 1 : 0;
  payload.writeUInt16LE(ms % 1000, 7);
  return payload;
}

/** Whether this computer shows a 12-hour clock (the phone app sends the phone's setting). */
export function systemUsesHour12(): boolean {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 === true;
}

/** A one-byte acknowledgement of 1; anything else is a refusal. */
export function requireWatchAcknowledgement(reply: Buffer, what: string): void {
  if (reply.length < 1 || reply[0] !== 1) throw new Error(`The watch did not accept the ${what}.`);
}
