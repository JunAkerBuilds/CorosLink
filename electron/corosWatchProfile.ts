import { ProtoWriter } from "./corosBleTrainingProtocol";
import { moveHeartRateZones, scaleZones } from "./watchProfileZones";

/**
 * The training profile the watch keeps: heart-rate, pace and power thresholds
 * and zones (`LitePb.UserInfo`).
 * The phone app writes it with SYSTEM_SETTINGS_SET (0xA6) as setting 10; the
 * watch also returns it to SYSTEM_SETTINGS_GET (0xA7). Settings travel as
 * `[type][length][value]` entries, values longer than 255 bytes split into
 * several entries of the same type.
 */

export const SETTINGS_SET_OPCODE = 0xa6;
export const SETTINGS_GET_OPCODE = 0xa7;
export const SETTING_SWITCH = 0;
export const SETTING_USER_INFO = 10;

export interface WatchProfile {
  /** Lower bounds of zones 1–5 (bpm); zone 5 runs to max HR. */
  maxHrZones: number[];
  reserveHrZones: number[];
  thresholdHrZones: number[];
  /** Lower bounds of the pace zones, ms per km (slowest first). */
  paceZones: number[];
  runPowerZones: number[];
  ftpZones: number[];
  maxHr: number;
  restingHr: number;
  thresholdHr: number;
  /** Zones the watch uses: 1 % of max HR, 2 heart-rate reserve, 3 threshold HR. */
  hrZoneType: number;
  /** ms per km */
  thresholdPace: number;
  criticalPower: number;
  ftp: number;
  /** Fields CorosLink doesn't edit (user id, nickname, climbing grades), kept as the watch sent them. */
  passthrough: Array<{ field: number; bytes: Buffer }>;
}

/** Splits a settings reply (or request) into setting type → value, joining chunks. */
export function decodeSettings(payload: Buffer): Map<number, Buffer> {
  const settings = new Map<number, Buffer>();
  for (let offset = 0; offset + 2 <= payload.length;) {
    const type = payload[offset]!;
    const length = payload[offset + 1]!;
    if (offset + 2 + length > payload.length) throw new Error("The watch returned truncated settings.");
    settings.set(type, Buffer.concat([settings.get(type) ?? Buffer.alloc(0), payload.subarray(offset + 2, offset + 2 + length)]));
    offset += 2 + length;
  }
  return settings;
}

export function encodeSettings(settings: Array<[number, Buffer]>): Buffer {
  const parts: Buffer[] = [];
  for (const [type, value] of settings) {
    for (let offset = 0; offset < value.length || offset === 0; offset += 255) {
      const chunk = value.subarray(offset, offset + 255);
      parts.push(Buffer.from([type, chunk.length]), chunk);
      if (!value.length) break;
    }
  }
  return Buffer.concat(parts);
}

/** The read request: one setting is asked for alongside the switches, as the app does. */
export function encodeSettingsRequest(types: number[]): Buffer {
  return Buffer.from(types.length === 1 ? [SETTING_SWITCH, ...types] : types);
}

// ----- minimal protobuf reader -----

function readVarint(buffer: Buffer, offset: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  for (let i = offset; i < buffer.length; i++) {
    const byte = buffer[i]!;
    value |= BigInt(byte & 0x7f) << shift;
    if (byte < 0x80) return [value, i + 1];
    shift += 7n;
    if (shift > 63n) break;
  }
  throw new Error("The watch's profile is damaged.");
}

/** int32 as protobuf writes negatives (64-bit two's complement). */
const int32 = (value: bigint) => Number(BigInt.asIntN(32, value));

export function decodeWatchProfile(bytes: Buffer): WatchProfile {
  const profile: WatchProfile = {
    maxHrZones: [], reserveHrZones: [], thresholdHrZones: [], paceZones: [], runPowerZones: [], ftpZones: [],
    maxHr: 0, restingHr: 0, thresholdHr: 0, hrZoneType: 0, thresholdPace: 0, criticalPower: 0, ftp: 0, passthrough: []
  };
  const lists: Record<number, number[]> = { 1: profile.maxHrZones, 2: profile.reserveHrZones, 3: profile.thresholdHrZones, 4: profile.paceZones, 5: profile.runPowerZones, 16: profile.ftpZones };
  const scalars: Record<number, keyof WatchProfile> = { 9: "maxHr", 10: "restingHr", 11: "thresholdHr", 12: "hrZoneType", 13: "thresholdPace", 14: "criticalPower", 15: "ftp" };
  for (let offset = 0; offset < bytes.length;) {
    const start = offset;
    const [tag, afterTag] = readVarint(bytes, offset);
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      const [value, next] = readVarint(bytes, afterTag);
      offset = next;
      if (lists[field]) lists[field]!.push(int32(value));
      else if (scalars[field]) (profile as unknown as Record<string, number>)[scalars[field]!] = int32(value);
      else profile.passthrough.push({ field, bytes: bytes.subarray(start, offset) });
    } else if (wire === 2) {
      const [length, next] = readVarint(bytes, afterTag);
      offset = next + Number(length);
      if (offset > bytes.length) throw new Error("The watch's profile is damaged.");
      const body = bytes.subarray(next, offset);
      if (lists[field]) {
        // Packed repeated values (the app writes them packed; the watch sends them one by one).
        for (let i = 0; i < body.length;) { const [value, after] = readVarint(body, i); lists[field]!.push(int32(value)); i = after; }
      } else {
        profile.passthrough.push({ field, bytes: bytes.subarray(start, offset) });
      }
    } else {
      throw new Error("The watch's profile has an unexpected field.");
    }
  }
  return profile;
}

export function encodeWatchProfile(profile: WatchProfile): Buffer {
  const writer = new ProtoWriter()
    .packed(1, profile.maxHrZones).packed(2, profile.reserveHrZones).packed(3, profile.thresholdHrZones)
    .packed(4, profile.paceZones).packed(5, profile.runPowerZones);
  const tail = new ProtoWriter()
    .int(9, profile.maxHr).int(10, profile.restingHr).int(11, profile.thresholdHr).int(12, profile.hrZoneType)
    .int(13, profile.thresholdPace).int(14, profile.criticalPower).int(15, profile.ftp).packed(16, profile.ftpZones);
  // Fields 6–8 (user id, nickname, picture) and 17–18 (climbing grades) go back exactly as the watch sent them.
  const kept = profile.passthrough.sort((a, b) => a.field - b.field);
  return Buffer.concat([writer.toBuffer(), ...kept.filter(item => item.field < 9).map(item => item.bytes), tail.toBuffer(), ...kept.filter(item => item.field >= 9).map(item => item.bytes)]);
}

export interface WatchProfileEdits {
  maxHr?: number;
  restingHr?: number;
  thresholdHr?: number;
  hrZoneType?: number;
  thresholdPace?: number;
}

/**
 * Applies new thresholds and moves each zone set with its reference, keeping
 * the zones' proportions: % of max HR, % of heart-rate reserve, % of threshold
 * HR, and pace relative to threshold pace.
 */
export function editWatchProfile(profile: WatchProfile, edits: WatchProfileEdits): WatchProfile {
  const check = (value: number | undefined, low: number, high: number, label: string) => {
    if (value !== undefined && (!Number.isInteger(value) || value < low || value > high)) throw new Error(`${label} must be between ${low} and ${high}.`);
  };
  check(edits.maxHr, 100, 240, "Max heart rate");
  check(edits.restingHr, 25, 120, "Resting heart rate");
  check(edits.thresholdHr, 80, 230, "Threshold heart rate");
  check(edits.hrZoneType, 1, 3, "Heart-rate zone type");
  check(edits.thresholdPace, 120_000, 900_000, "Threshold pace");
  const maxHr = edits.maxHr ?? profile.maxHr;
  const restingHr = edits.restingHr ?? profile.restingHr;
  const thresholdHr = edits.thresholdHr ?? profile.thresholdHr;
  if (restingHr >= thresholdHr || thresholdHr >= maxHr) throw new Error("Resting, threshold and max heart rate must increase in that order.");
  const thresholdPace = edits.thresholdPace ?? profile.thresholdPace;
  return {
    ...profile,
    maxHr, restingHr, thresholdHr, thresholdPace,
    hrZoneType: edits.hrZoneType ?? profile.hrZoneType,
    ...moveHeartRateZones(profile, { maxHr, restingHr, thresholdHr }),
    paceZones: scaleZones(profile.paceZones, profile.thresholdPace, thresholdPace),
    passthrough: profile.passthrough.map(item => ({ ...item }))
  };
}

/** The COROS account fields the workout editor reads (trainingHubService `/account/query`), from the watch's profile. */
export function accountFromWatchProfile(profile: WatchProfile): Record<string, unknown> {
  const zones = (values: number[]) => values.map((value, index) => ({ index: index + 1, hr: value }));
  return {
    maxHr: profile.maxHr || undefined,
    restingHr: profile.restingHr || undefined,
    lthr: profile.thresholdHr || undefined,
    thresholdPace: profile.thresholdPace || undefined,
    ftp: profile.ftp || undefined,
    criticalPower: profile.criticalPower || undefined,
    maxHrZone: zones(profile.maxHrZones),
    rhrZone: zones(profile.reserveHrZones),
    lthrZone: zones(profile.thresholdHrZones)
  };
}
