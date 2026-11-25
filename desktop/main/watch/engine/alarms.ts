// Alarms over the control channel: read as setting 2 with SYSTEM_SETTINGS_GET (0xA7), written one slot at a time with
// opcode 0x87. A port of CorosKit's WatchData/WatchAlarms.swift. EXPERIMENTAL, worked out from PACE Pro firmware (W332
// 3.2008.0) and the COROS iOS app, then tried on a real PACE Pro (2026-10-27). No delete command is known, so C-LINK
// deletes by writing an impossible time (`clearPayload`), untried on a watch.
import { CorosError, sum8 } from "./bytes";
import { decodeSettings, SETTINGS_GET } from "./settings";

/** The days an alarm repeats on: the low seven bits of its repeat byte, bit 0 Monday through bit 6 Sunday. */
export const DAY = { monday: 1, tuesday: 2, wednesday: 4, thursday: 8, friday: 16, saturday: 32, sunday: 64 } as const;
export const EVERY_DAY = 0x7f;

/**
 * One alarm slot as the watch keeps it: a little-endian word of slot, on/off, hour and minute, then the repeat byte:
 * the days plus bit 7, which the watch sets on a repeating alarm it saves (once-only is 0x00, every day 0xFF).
 */
export interface WatchAlarm { slot: number; enabled: boolean; hour: number; minute: number; repeatByte: number }

export const READ_OPCODE = SETTINGS_GET;
export const WRITE_OPCODE = 0x87;
/** The settings type that holds the alarm records. */
export const ALARM_SETTING = 2;
/** The firmware scans this many slots. */
export const ALARM_SLOTS = 10;
/** Setting 2 alone, without the switches `settingsRequest` adds. */
export const READ_REQUEST = Buffer.from([ALARM_SETTING]);

/** Once when `days` is 0, else on those days, with the repeat byte the watch itself writes. */
export const alarm = (slot: number, enabled: boolean, hour: number, minute: number, days = 0): WatchAlarm =>
  ({ slot, enabled, hour, minute, repeatByte: days === 0 ? 0 : 0x80 | (days & 0x7f) });

export const alarmDays = (a: WatchAlarm): number => a.repeatByte & 0x7f;
export const isOnce = (a: WatchAlarm): boolean => alarmDays(a) === 0;
/** A time the watch would list; it leaves out slots without one. */
export const hasValidTime = (a: WatchAlarm): boolean => a.hour >= 0 && a.hour <= 23 && a.minute >= 0 && a.minute <= 59;

const word = (a: WatchAlarm): number => ((a.slot & 0x0f) | ((a.enabled ? 1 : 0) << 4) | ((a.hour & 0x1f) << 5) | ((a.minute & 0x3f) << 10)) & 0xffff;

/** From one three-byte record of setting 2. */
export function alarmFromRecord(record: Uint8Array): WatchAlarm {
  const w = record[0] | (record[1] << 8);
  return { slot: w & 0x0f, enabled: ((w >> 4) & 1) === 1, hour: (w >> 5) & 0x1f, minute: (w >> 10) & 0x3f, repeatByte: record[2] };
}

export function alarmRecord(a: WatchAlarm): Buffer {
  const w = word(a);
  return Buffer.from([w & 0xff, w >> 8, a.repeatByte]);
}

/** The alarms in a settings reply. The firmware returns only slots with a valid time, so a missing slot isn't proof it's free. */
export const decodeAlarms = (payload: Uint8Array): WatchAlarm[] => alarmRecords(decodeSettings(payload).get(ALARM_SETTING) ?? Buffer.alloc(0));

/** Setting 2's value: whole three-byte records. */
export function alarmRecords(records: Uint8Array): WatchAlarm[] {
  if (records.length % 3 !== 0) throw new CorosError(`The watch's alarm list has ${records.length} bytes, not whole 3-byte alarms.`);
  const out: WatchAlarm[] = [];
  for (let i = 0; i < records.length; i += 3) out.push(alarmFromRecord(records.subarray(i, i + 3)));
  return out;
}

const slotChoice = () => new CorosError(`Choose an alarm slot from 0 to ${ALARM_SLOTS - 1}.`);
const validSlot = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < ALARM_SLOTS;

/** The 0x87 payload: the slot again in front of the record, which the firmware uses as an index. */
export function writePayload(a: WatchAlarm): Buffer {
  if (!validSlot(a.slot)) throw slotChoice();
  if (!hasValidTime(a)) throw new CorosError("Choose a time from 00:00 to 23:59.");
  const w = word(a);
  return Buffer.from([a.slot, w & 0xff, w >> 8, a.repeatByte]);
}

/** EXPERIMENTAL: the 0x87 payload that empties a slot, an off, once-only alarm at 31:63, which the watch shouldn't list. */
export function clearPayload(slot: number): Buffer {
  if (!validSlot(slot)) throw slotChoice();
  const w = word({ slot, enabled: false, hour: 31, minute: 63, repeatByte: 0 });
  return Buffer.from([slot, w & 0xff, w >> 8, 0]);
}

/** The single frame a short payload goes out as: opcode, 0 frames left, payload, checksum. */
export const alarmFrame = (opcode: number, payload: Uint8Array): Buffer => Buffer.concat([Buffer.from([opcode, 0]), payload, Buffer.from([sum8(payload)])]);

/** The firmware's common "done": only that the watch answered, not that it kept the alarm. */
export const isAcknowledgement = (reply: Uint8Array): boolean => reply.length === 1 && reply[0] === 1;

/** Contract days (0 = Sunday … 6 = Saturday) from the watch's bits (SyncBodies.days). */
export function contractDays(days: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => days & (1 << ((d + 6) % 7)));
}

/** The watch's day bits from contract days (SyncBodies.alarmDays); days outside 0–6 are dropped. */
export function daysFromContract(days: number[]): number {
  return days.reduce((set, d) => (Number.isInteger(d) && d >= 0 && d <= 6 ? set | (1 << ((d + 6) % 7)) : set), 0);
}
