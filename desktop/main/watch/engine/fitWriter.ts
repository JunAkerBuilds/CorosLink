// A minimal FIT activity writer (FIT protocol 2.0): file_id, timer events, records, laps, one session and the
// activity message, for workouts read from the watch. A port of CorosKit's WatchData/FITWriter.swift (itself CorosLink's
// fitWriter.ts), byte for byte. Values FIT has no field for are developer fields: "Effort Pace" on records, as the
// COROS app exports it, and the watch's training analysis on the session.
import { jsRound, type Dynamics, type Session, type Training } from "./sportRecord";

const FIT_EPOCH = 631_065_600;
const MANUFACTURER_COROS = 294;
const STRING_BYTES = 32;

/** FIT base types this writer uses. */
const T = { enumeration: 0x00, sint8: 0x01, uint8: 0x02, string: 0x07, sint16: 0x83, uint16: 0x84, sint32: 0x85, uint32: 0x86, float32: 0x88 } as const;
type BaseType = (typeof T)[keyof typeof T];

const size = (type: BaseType): number =>
  type === T.string ? STRING_BYTES : type === T.sint16 || type === T.uint16 ? 2 : type === T.sint32 || type === T.uint32 || type === T.float32 ? 4 : 1;

const invalid = (type: BaseType): number => {
  switch (type) {
    case T.enumeration: case T.uint8: return 0xff;
    case T.sint8: return 0x7f;
    case T.sint16: return 0x7fff;
    case T.uint16: return 0xffff;
    case T.sint32: return 0x7fff_ffff;
    case T.uint32: return 0xffff_ffff;
    default: return 0;
  }
};

/** A field's value: a number (undefined for "none") or, for string fields, text. */
type Value = number | undefined | string;
type Field = [number: number, type: BaseType];
/** A developer field: its number in the field_description, its base type, the developer data index. */
type DeveloperField = [number: number, type: BaseType, index: number];

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

/** FIT's CRC-16. */
export function fitCrc(bytes: Uint8Array, start = 0): number {
  let crc = start;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

export class TooManyDefinitions extends Error {}

/** Grows a byte list; numbers are written little-endian. */
class Out {
  private bytes: number[] = [];
  get length(): number { return this.bytes.length; }
  push(...values: number[]): void { for (const v of values) this.bytes.push(v); }
  /** An integer that fits `count` (≤ 4) bytes, as little-endian two's complement. */
  le(value: number, count: number): void {
    let v = value < 0 ? value + 2 ** (8 * count) : value;
    for (let i = 0; i < count; i++) { this.bytes.push(v % 256); v = Math.floor(v / 256); }
  }
  append(other: Uint8Array): void { for (const b of other) this.bytes.push(b); }
  done(): Uint8Array { return Uint8Array.from(this.bytes); }
}

class Builder {
  private data = new Out();
  private definitions = new Map<string, number>();

  message(global: number, fields: Field[], values: Value[], developer: DeveloperField[] = [], developerValues: Value[] = []): void {
    const key = `${global}:` + fields.map(([n, t]) => `${n}/${t}`).join(",") + "|" + developer.map(([n, t, i]) => `${n}/${t}/${i}`).join(",");
    let local = this.definitions.get(key);
    if (local === undefined) {
      if (this.definitions.size > 15) throw new TooManyDefinitions();
      local = this.definitions.size;
      this.definitions.set(key, local);
      this.data.push(0x40 | (developer.length === 0 ? 0 : 0x20) | local, 0, 0, global & 0xff, global >> 8, fields.length);
      for (const [number, type] of fields) this.data.push(number, size(type), type);
      if (developer.length > 0) {
        this.data.push(developer.length);
        for (const [number, type, index] of developer) this.data.push(number, size(type), index);
      }
    }
    this.data.push(local);
    const types = [...fields.map((f) => f[1]), ...developer.map((f) => f[1])];
    const all = [...values, ...developerValues];
    for (let i = 0; i < Math.min(types.length, all.length); i++) this.append(all[i], types[i]);
  }

  private append(value: Value, type: BaseType): void {
    if (type === T.string) {
      const bytes = new Uint8Array(STRING_BYTES);
      if (typeof value === "string") bytes.set(Buffer.from(value, "utf8").subarray(0, STRING_BYTES - 1));
      this.data.append(bytes);
      return;
    }
    if (type === T.float32) {
      if (typeof value === "number" && Number.isFinite(value)) {
        const b = Buffer.alloc(4);
        b.writeFloatLE(value, 0);
        this.data.append(b);
      } else {
        this.data.le(0xffff_ffff, 4);
      }
      return;
    }
    let number = invalid(type);
    if (typeof value === "number" && Number.isFinite(value)) number = jsRound(value);
    const clamp = (low: number, high: number) => Math.min(high, Math.max(low, number));
    switch (type) {
      case T.enumeration: case T.uint8: this.data.le(clamp(0, 0xff), 1); break;
      case T.sint8: this.data.le(clamp(-0x80, 0x7f), 1); break;
      case T.uint16: this.data.le(clamp(0, 0xffff), 2); break;
      case T.sint16: this.data.le(clamp(-0x8000, 0x7fff), 2); break;
      case T.uint32: this.data.le(clamp(0, 0xffff_ffff), 4); break;
      case T.sint32: this.data.le(clamp(-0x8000_0000, 0x7fff_ffff), 4); break;
    }
  }

  finish(): Uint8Array {
    const data = this.data.done();
    const header = new Out();
    header.push(14, 0x20);
    header.le(2132, 2);
    header.le(data.length, 4);
    header.append(Buffer.from(".FIT", "ascii"));
    header.le(fitCrc(header.done()), 2);
    const file = new Out();
    file.append(header.done());
    file.append(data);
    file.le(fitCrc(file.done()), 2);
    return file.done();
  }
}

const fitTime = (unix: number): Value => unix - FIT_EPOCH;
const semicircles = (degrees?: number): Value => (degrees === undefined ? undefined : (degrees * 2_147_483_648) / 180);
const scaled = (value: number | undefined, scale: number, offset = 0): Value => (value === undefined ? undefined : (value + offset) * scale);

const FILE_ID: Field[] = [[0, T.enumeration], [1, T.uint16], [2, T.uint16], [4, T.uint32]];
const EVENT: Field[] = [[253, T.uint32], [0, T.enumeration], [1, T.enumeration], [4, T.uint8]];
const DEVELOPER_DATA_ID: Field[] = [[3, T.uint8]];
const FIELD_DESCRIPTION: Field[] = [[0, T.uint8], [1, T.uint8], [2, T.uint8], [3, T.string], [8, T.string]];
const RECORD: Field[] = [
  [253, T.uint32], [0, T.sint32], [1, T.sint32], [2, T.uint16], [3, T.uint8], [4, T.uint8], [5, T.uint32], [6, T.uint16], [7, T.uint16],
  [39, T.uint16], [41, T.uint16], [83, T.uint16], [85, T.uint16],
];
const LAP: Field[] = [
  [253, T.uint32], [254, T.uint16], [0, T.enumeration], [1, T.enumeration], [2, T.uint32], [7, T.uint32], [8, T.uint32], [9, T.uint32],
  [11, T.uint16], [13, T.uint16], [14, T.uint16], [15, T.uint8], [16, T.uint8], [17, T.uint8], [19, T.uint16], [20, T.uint16], [21, T.uint16],
  [22, T.uint16], [50, T.sint8], [63, T.uint8], [77, T.uint16], [79, T.uint16], [118, T.uint16], [120, T.uint16], [80, T.uint8],
];
const SESSION: Field[] = [
  [253, T.uint32], [0, T.enumeration], [1, T.enumeration], [2, T.uint32], [5, T.enumeration], [6, T.enumeration], [7, T.uint32], [8, T.uint32],
  [9, T.uint32], [10, T.uint32], [11, T.uint16], [14, T.uint16], [15, T.uint16], [16, T.uint8], [17, T.uint8], [18, T.uint8], [19, T.uint8],
  [20, T.uint16], [22, T.uint16], [23, T.uint16], [24, T.uint8], [25, T.uint16], [26, T.uint16], [57, T.sint8], [64, T.uint8], [89, T.uint16],
  [91, T.uint16], [132, T.uint16], [134, T.uint16], [137, T.uint8], [92, T.uint8], [93, T.uint8],
];
const ACTIVITY: Field[] = [[253, T.uint32], [0, T.uint32], [1, T.uint16], [2, T.enumeration], [3, T.enumeration], [4, T.enumeration]];

const DEVELOPER_INDEX = 0;
/** Developer fields, named so readers can find them; the record field keeps COROS's own name. */
const EFFORT_PACE = { number: 0, type: T.float32 as BaseType, name: "Effort Pace", units: "m/s" };
const TRAINING_FIELDS: { number: number; type: BaseType; name: string; units: string; value: (t: Training) => number | undefined }[] = [
  { number: 1, type: T.uint16, name: "Training Load", units: "", value: (t) => t.trainingLoad },
  { number: 2, type: T.uint16, name: "Aerobic Training Load", units: "", value: (t) => t.aerobicLoad },
  { number: 3, type: T.uint16, name: "Anaerobic Training Load", units: "", value: (t) => t.anaerobicLoad },
  { number: 4, type: T.uint8, name: "Training Focus", units: "", value: (t) => t.focus },
  { number: 5, type: T.uint16, name: "7-Day Training Load", units: "", value: (t) => t.sevenDayLoad },
  { number: 6, type: T.uint16, name: "Recommended Load Min", units: "", value: (t) => t.recommendedLoadMin },
  { number: 7, type: T.uint16, name: "Recommended Load Max", units: "", value: (t) => t.recommendedLoadMax },
  { number: 8, type: T.uint8, name: "VO2 Max", units: "ml/kg/min", value: (t) => t.vo2max },
  { number: 9, type: T.uint32, name: "Recovery Time", units: "s", value: (t) => t.recovery },
  { number: 10, type: T.uint16, name: "Base Fitness", units: "", value: (t) => t.baseFitness },
  { number: 11, type: T.uint16, name: "Load Impact", units: "", value: (t) => t.loadImpact },
  { number: 12, type: T.sint16, name: "Fatigue", units: "%", value: (t) => t.fatigue },
];

const EVENT_TIMER = 0, EVENT_TYPE_START = 0, EVENT_TYPE_STOP = 1, EVENT_TYPE_STOP_ALL = 4;
const EVENT_LAP = 9, EVENT_SESSION = 8, EVENT_ACTIVITY = 26;

/** FIT fractional cadence (1/128 rpm) for a steps-per-minute value, beyond the per-leg whole number. */
const fractionalCadence = (stepsPerMinute?: number): Value =>
  stepsPerMinute === undefined ? undefined : jsRound((stepsPerMinute / 2 - Math.floor(stepsPerMinute / 2)) * 128);

const dynamics = (d: Dynamics): Value[] =>
  [scaled(d.verticalOscillationMm, 10), scaled(d.groundTimeMs, 10), scaled(d.verticalRatio, 100), scaled(d.stepLengthMm, 10)];

/** FIT sport / sub_sport for a COROS sport code (CorosLink's `fitSportFromCorosType`). */
export function fitSport(sportType: number): { sport: number; subSport?: number } {
  const table: Record<number, [number, number?]> = {
    100: [1], 101: [1, 1], 102: [1, 3], 103: [1, 4], 104: [17], 106: [31], 200: [2], 201: [2, 6], 202: [2, 28], 203: [2, 46], 204: [2, 8],
    300: [5, 17], 301: [5, 18], 400: [4], 402: [10, 20], 500: [13], 501: [14], 502: [12], 700: [15], 701: [15, 14], 900: [11], 902: [4, 16],
  };
  const [sport, subSport] = table[sportType] ?? [0];
  return { sport, subSport };
}

/** One workout from the watch as a FIT file; the same workout always gives the same bytes. */
export function writeFit(session: Session): Uint8Array {
  const fit = new Builder();
  const sport = fitSport(session.sportType);
  fit.message(0, FILE_ID, [4, MANUFACTURER_COROS, 0, fitTime(session.endTs)]);
  const hasEffort = session.samples.some((s) => s.effortSpeed !== undefined);
  const training = session.training;
  if (hasEffort || training) {
    fit.message(207, DEVELOPER_DATA_ID, [DEVELOPER_INDEX]);
    const described: { number: number; type: BaseType; name: string; units: string }[] = [];
    if (hasEffort) described.push(EFFORT_PACE);
    if (training) described.push(...TRAINING_FIELDS);
    for (const { number, type, name, units } of described) fit.message(206, FIELD_DESCRIPTION, [DEVELOPER_INDEX, number, type, name, units]);
  }

  const events = session.activeWindows.flatMap((w) => [{ ts: w.lower, type: EVENT_TYPE_START }, { ts: w.upper, type: EVENT_TYPE_STOP_ALL }]);
  let eventIndex = 0;
  const writeEvent = (e: { ts: number; type: number }) => fit.message(21, EVENT, [fitTime(e.ts), EVENT_TIMER, e.type, 0]);
  const recordDeveloper: DeveloperField[] = hasEffort ? [[EFFORT_PACE.number, EFFORT_PACE.type, DEVELOPER_INDEX]] : [];
  for (const sample of session.samples) {
    // A start goes before records at its second, a stop after them.
    while (eventIndex < events.length) {
      const e = events[eventIndex];
      if (e.ts > sample.ts || (e.ts === sample.ts && e.type !== EVENT_TYPE_START)) break;
      writeEvent(e);
      eventIndex += 1;
    }
    fit.message(20, RECORD, [
      fitTime(sample.ts), semicircles(sample.lat), semicircles(sample.lon), scaled(sample.alt, 5, 500), sample.hr,
      sample.cadence, scaled(sample.dist, 100), scaled(sample.speed, 1000), sample.power,
      scaled(sample.verticalOscillation, 10), scaled(sample.groundTime, 10), scaled(sample.verticalRatio, 100), scaled(sample.stepLength, 10),
    ], recordDeveloper, hasEffort ? [sample.effortSpeed] : []);
  }
  while (eventIndex < events.length) writeEvent(events[eventIndex++]);

  session.laps.forEach((lap, index) => {
    const endTs = index + 1 < session.laps.length ? session.laps[index + 1].startTs : session.endTs;
    fit.message(19, LAP, [
      fitTime(endTs), index, EVENT_LAP, EVENT_TYPE_STOP, fitTime(lap.startTs),
      scaled(lap.elapsedSec, 1000), scaled(lap.timerSec, 1000), scaled(lap.distanceM, 100), lap.calories,
      scaled(lap.avgSpeed, 1000), scaled(lap.maxSpeed, 1000), lap.avgHr, lap.maxHr, lap.avgCadence,
      lap.avgPower, lap.maxPower, lap.ascentM, lap.descentM, lap.avgTemperature, lap.minHr,
      ...dynamics(lap.dynamics), fractionalCadence(lap.avgStepCadence),
    ]);
  });
  fit.message(18, SESSION, [
    fitTime(session.endTs), EVENT_SESSION, EVENT_TYPE_STOP, fitTime(session.startTs), sport.sport, sport.subSport,
    scaled(session.elapsedSec, 1000), scaled(session.timerSec, 1000), scaled(session.distanceM, 100), session.totalStrides,
    session.calories, scaled(session.avgSpeed, 1000), scaled(session.maxSpeed, 1000), session.avgHr, session.maxHr,
    session.avgCadence, session.maxCadence, session.avgPower, session.ascentM, session.descentM,
    training?.aerobicEffect, 0, session.laps.length, session.avgTemperature, session.minHr,
    ...dynamics(session.dynamics),
    training?.anaerobicEffect, fractionalCadence(session.avgStepCadence), fractionalCadence(session.maxStepCadence),
  ], training ? TRAINING_FIELDS.map((f): DeveloperField => [f.number, f.type, DEVELOPER_INDEX]) : [],
  training ? TRAINING_FIELDS.map((f) => f.value(training)) : []);
  fit.message(34, ACTIVITY, [fitTime(session.endTs), scaled(session.timerSec, 1000), 1, 0, EVENT_ACTIVITY, EVENT_TYPE_STOP]);
  return fit.finish();
}
