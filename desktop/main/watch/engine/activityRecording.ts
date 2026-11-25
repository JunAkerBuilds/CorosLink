// Everything the watch recorded through one activity, from its FIT file: a sample about every second, the laps and
// the GPS route. A port of what `activity.detail` needs of CorosKit's ActivityRecording (Training/ActivityRoute.swift),
// with the minimal FIT decoder it reads through (Training/FITFile.swift). Strength sets and swim lengths are left out:
// the detail body doesn't carry them.

// MARK: FIT decoding

/** FIT's message numbers read here. */
export const FIT_RECORD = 20, FIT_LAP = 19, FIT_LENGTH = 101;

export interface FitMessage {
  global: number;
  /** Field number → raw integer value, FIT's "no value" markers dropped. */
  fields: Map<number, number>;
  /** Seconds since the FIT epoch, from field 253 or a compressed-time header. */
  timestamp?: number;
}

/** Whether the bytes start like a FIT file (".FIT" at offset 8). */
export const isFit = (data: Uint8Array): boolean =>
  data.length >= 14 && data[8] === 0x2e && data[9] === 0x46 && data[10] === 0x49 && data[11] === 0x54;

interface FitField { number: number; size: number; baseType: number }
interface Definition { global: number; bigEndian: boolean; fields: FitField[]; developerBytes: number }

/** The data messages of the given types, in file order; stops quietly at the first malformed byte. */
export function fitMessages(data: Uint8Array, types: Set<number>): FitMessage[] {
  if (!isFit(data)) return [];
  const headerSize = data[0];
  const dataSize = data[4] + data[5] * 0x100 + data[6] * 0x10000 + data[7] * 0x1000000;
  const end = Math.min(data.length, headerSize + dataSize);
  let offset = headerSize;
  const definitions = new Map<number, Definition>();
  let lastTimestamp = 0;
  const out: FitMessage[] = [];

  const read = (at: number, size: number, bigEndian: boolean): bigint => {
    let value = 0n;
    for (let i = 0; i < size; i++) value |= BigInt(data[at + i]) << BigInt(8 * (bigEndian ? size - 1 - i : i));
    return value;
  };
  const readNumber = (at: number, size: number, bigEndian: boolean): number => Number(read(at, size, bigEndian));

  /** The value, signed when the base type is, or undefined for FIT's invalid marker. */
  const value = (field: FitField, at: number, bigEndian: boolean): number | undefined => {
    const base = field.baseType & 0x1f;
    let width: number;
    switch (base) {
      case 0x00: case 0x01: case 0x02: case 0x0a: case 0x0d: width = 1; break;
      case 0x03: case 0x04: case 0x0b: width = 2; break;
      case 0x05: case 0x06: case 0x0c: width = 4; break;
      case 0x0e: case 0x0f: case 0x10: width = 8; break;
      default: return undefined; // strings and floats aren't needed
    }
    // Arrays: the first element only.
    if (field.size < width) return undefined;
    const raw = read(at, width, bigEndian);
    switch (base) {
      case 0x01: return raw === 0x7fn ? undefined : Number(BigInt.asIntN(8, raw));
      case 0x03: return raw === 0x7fffn ? undefined : Number(BigInt.asIntN(16, raw));
      case 0x05: return raw === 0x7fff_ffffn ? undefined : Number(BigInt.asIntN(32, raw));
      case 0x0e: return raw === 0x7fff_ffff_ffff_ffffn ? undefined : Number(BigInt.asIntN(64, raw));
      case 0x0a: case 0x0b: case 0x0c: case 0x10: return raw === 0n ? undefined : Number(BigInt.asIntN(64, raw));
      default: {
        const invalid = (1n << BigInt(width * 8)) - 1n;
        return raw === invalid ? undefined : Number(BigInt.asIntN(64, raw));
      }
    }
  };

  /** Reads one data message; returns the offset after it. */
  const message = (definition: Definition, start: number, timestamp: number | undefined): number | undefined => {
    const size = definition.fields.reduce((sum, f) => sum + f.size, 0) + definition.developerBytes;
    if (start + size > end) return undefined;
    const wanted = types.has(definition.global);
    let at = start;
    const fields = new Map<number, number>();
    let time = timestamp;
    for (const field of definition.fields) {
      if (field.number === 253 && field.size === 4) {
        const raw = readNumber(at, 4, definition.bigEndian);
        if (raw !== 0xffff_ffff) { time = raw; lastTimestamp = raw; }
      } else if (wanted) {
        const parsed = value(field, at, definition.bigEndian);
        if (parsed !== undefined) fields.set(field.number, parsed);
      }
      at += field.size;
    }
    if (wanted) out.push({ global: definition.global, fields, timestamp: time });
    return start + size;
  };

  while (offset < end) {
    const head = data[offset];
    offset += 1;
    if (head & 0x80) {
      // Compressed timestamp header: a data message with a 5-bit time offset.
      const definition = definitions.get((head >> 5) & 0x03);
      if (!definition) break;
      const timeOffset = head & 0x1f;
      let timestamp = ((lastTimestamp & ~0x1f) >>> 0) + timeOffset;
      if (timeOffset < (lastTimestamp & 0x1f)) timestamp += 0x20;
      lastTimestamp = timestamp;
      const next = message(definition, offset, timestamp);
      if (next === undefined) break;
      offset = next;
    } else if (head & 0x40) {
      // Definition message.
      const local = head & 0x0f;
      if (offset + 5 > end) break;
      const bigEndian = data[offset + 1] === 1;
      const global = readNumber(offset + 2, 2, bigEndian);
      const count = data[offset + 4];
      offset += 5;
      if (offset + count * 3 > end) break;
      const fields = Array.from({ length: count }, (_, i) => ({ number: data[offset + i * 3], size: data[offset + i * 3 + 1], baseType: data[offset + i * 3 + 2] }));
      offset += count * 3;
      let developerBytes = 0;
      if (head & 0x20) {
        if (offset >= end) break;
        const developerCount = data[offset];
        offset += 1;
        if (offset + developerCount * 3 > end) break;
        for (let i = 0; i < developerCount; i++) developerBytes += data[offset + i * 3 + 1];
        offset += developerCount * 3;
      }
      definitions.set(local, { global, bigEndian, fields, developerBytes });
    } else {
      const definition = definitions.get(head & 0x0f);
      const next = definition && message(definition, offset, undefined);
      if (next === undefined) break;
      offset = next;
    }
  }
  return out;
}

// MARK: Recording

export interface RecordingSample {
  /** Seconds since the first sample, pauses included. */
  elapsed: number;
  /** Metres from the start, as the watch measured it. */
  distance?: number;
  latitude?: number;
  longitude?: number;
  /** Metres above sea level. */
  altitude?: number;
  heartRate?: number;
  /** Metres per second. */
  speed?: number;
  /** As FIT records it: revolutions (one foot's steps, for running) per minute. */
  cadence?: number;
  power?: number;
  temperature?: number;
  /** Running dynamics: millimetres, milliseconds, millimetres. */
  verticalOscillation?: number;
  groundContact?: number;
  stepLength?: number;
}

/** One lap as the watch split it. */
export interface RecordingLap {
  /** Seconds from the first sample to the lap's start. */
  start: number;
  /** Moving time when the watch sends it, else elapsed time. */
  seconds: number;
  meters?: number;
  averageHR?: number;
  maxHR?: number;
  /** As FIT records it, like `RecordingSample.cadence`. */
  averageCadence?: number;
  averagePower?: number;
  maxPower?: number;
  ascent?: number;
  descent?: number;
  /** Start to finish, pauses and all. */
  elapsed?: number;
  verticalOscillation?: number;
  groundContact?: number;
  stepLength?: number;
}

export interface RoutePoint { latitude: number; longitude: number; elapsed?: number; heartRate?: number; altitude?: number; distance?: number }

export interface ActivityRecording {
  samples: RecordingSample[];
  laps: RecordingLap[];
  /** The GPS track, when the activity has one. */
  route?: { points: RoutePoint[] };
}

/** Great-circle metres between two points. */
export function routeMeters(a: RoutePoint, b: RoutePoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** GPS fixes ready to draw: empty fixes and lone jumps dropped, long tracks thinned (CorosTraining.cleaned). */
export function cleanedRoute(raw: RoutePoint[], limit = 1500): { points: RoutePoint[] } | undefined {
  let points = raw.filter((p) => Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && Math.abs(p.latitude) + Math.abs(p.longitude) > 0.0001);
  if (points.length < 2) return undefined;
  // A lone fix far from the rest (a GPS jump) would stretch the map.
  const fixes = points;
  points = fixes.filter((point, index) => {
    if (index === 0 || index === fixes.length - 1) return true;
    const before = routeMeters(fixes[index - 1], point), after = routeMeters(point, fixes[index + 1]);
    const across = routeMeters(fixes[index - 1], fixes[index + 1]);
    return !(before > 2000 && after > 2000 && across < 500);
  });
  if (points.length < 2) return undefined;
  if (points.length > limit) {
    const stride = (points.length - 1) / (limit - 1);
    const all = points;
    points = Array.from({ length: limit }, (_, i) => all[Math.round(i * stride)]);
  }
  return { points };
}

/** A recording from samples and laps, its route from the samples' fixes. */
export function makeRecording(samples: RecordingSample[], laps: RecordingLap[] = []): ActivityRecording {
  const fixes = samples.flatMap((s): RoutePoint[] => s.latitude === undefined || s.longitude === undefined ? [] : [
    { latitude: s.latitude, longitude: s.longitude, elapsed: s.elapsed, heartRate: s.heartRate, altitude: s.altitude, distance: s.distance },
  ]);
  return { samples, laps, route: cleanedRoute(fixes) };
}

/** A pool swim's first length start (SwimLengths.firstLengthStart), when it writes lengths and no records. */
function firstLengthStart(messages: FitMessage[]): number | undefined {
  const starts = messages.filter((m) => m.global === FIT_LENGTH).flatMap((length): number[] => {
    const start = length.fields.get(2);
    if (start !== undefined) return [Math.min(0xffff_ffff, Math.max(0, start))];
    const end = length.timestamp;
    if (end === undefined) return [];
    const seconds = Math.trunc((length.fields.get(3) ?? length.fields.get(4) ?? 0) / 1000);
    return [end > seconds ? end - seconds : end];
  });
  return starts.length ? Math.min(...starts) : undefined;
}

/** From a FIT activity file; null when it holds no samples. */
export function recordingFromFit(data: Uint8Array): ActivityRecording | null {
  const messages = fitMessages(data, new Set([FIT_RECORD, FIT_LAP, FIT_LENGTH]));
  const records = messages.filter((m) => m.global === FIT_RECORD && m.timestamp !== undefined);
  const first = records[0]?.timestamp ?? firstLengthStart(messages);
  if (first === undefined) return null;
  const degrees = 180 / 2_147_483_648;
  const double = (value: number | undefined, scale: number, offset = 0) => (value === undefined ? undefined : value / scale - offset);
  const samples = records.map((record): RecordingSample => {
    const f = (n: number) => record.fields.get(n);
    // Fractional cadence (field 53) is in 1/128ths of a revolution.
    const cadence = f(4) === undefined ? undefined : f(4)! + (f(53) ?? 0) / 128;
    const lat = double(f(0), 1), lon = double(f(1), 1);
    return {
      elapsed: (record.timestamp ?? first) - first,
      distance: double(f(5), 100),
      latitude: lat === undefined ? undefined : lat * degrees,
      longitude: lon === undefined ? undefined : lon * degrees,
      altitude: double(f(78), 5, 500) ?? double(f(2), 5, 500),
      heartRate: f(3),
      speed: double(f(73), 1000) ?? double(f(6), 1000),
      cadence,
      power: f(7),
      temperature: f(13),
      verticalOscillation: double(f(39), 10),
      groundContact: double(f(41), 10),
      stepLength: double(f(85), 10),
    };
  });
  const laps = messages.filter((m) => m.global === FIT_LAP).flatMap((lap): RecordingLap[] => {
    const f = (n: number) => lap.fields.get(n);
    const seconds = double(f(8), 1000) ?? double(f(7), 1000);
    if (seconds === undefined || !(seconds > 0)) return [];
    const start = f(2) !== undefined ? f(2)! - first : lap.timestamp !== undefined ? lap.timestamp - first - seconds : 0;
    // Fractional cadence (field 80) is in 1/128ths, as the records' is.
    return [{
      start: Math.max(0, start), seconds, meters: double(f(9), 100), averageHR: f(15), maxHR: f(16),
      averageCadence: f(17) === undefined ? undefined : f(17)! + (f(80) ?? 0) / 128, averagePower: f(19), maxPower: f(20),
      ascent: double(f(21), 1), descent: double(f(22), 1), elapsed: double(f(7), 1000),
      verticalOscillation: double(f(77), 10), groundContact: double(f(79), 10), stepLength: double(f(120), 10),
    }];
  });
  return makeRecording(samples, laps);
}
