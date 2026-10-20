/**
 * Minimal FIT activity writer (FIT protocol 2.0): file_id, timer events,
 * records, laps, one session and the activity message. Used to store
 * activities decoded from the watch in the same format as imported files, so
 * the existing detail, GPX and export paths apply unchanged.
 *
 * Values FIT has no standard field for are written as developer fields
 * (named in field_description messages): "Effort Pace" on records, as the
 * COROS app exports it, and the watch's training analysis on the session.
 */

const FIT_EPOCH = 631_065_600;
const MANUFACTURER_COROS = 294;

const BaseType = { enum: 0x00, sint8: 0x01, uint8: 0x02, string: 0x07, sint16: 0x83, uint16: 0x84, sint32: 0x85, uint32: 0x86, float32: 0x88 } as const;
type BaseType = (typeof BaseType)[keyof typeof BaseType];
type NumericType = Exclude<BaseType, typeof BaseType.string>;

const SIZES: Record<NumericType, number> = { 0x00: 1, 0x01: 1, 0x02: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4, 0x88: 4 };
const INVALID: Record<NumericType, number> = { 0x00: 0xff, 0x01: 0x7f, 0x02: 0xff, 0x83: 0x7fff, 0x84: 0xffff, 0x85: 0x7fff_ffff, 0x86: 0xffff_ffff, 0x88: Number.NaN };
const STRING_BYTES = 32;

type FieldSpec = readonly [fieldNumber: number, type: BaseType];
/** A developer field: its number in the field_description, its base type, the developer data index. */
type DeveloperFieldSpec = readonly [fieldNumber: number, type: NumericType, developerIndex: number];
type FieldValue = number | string | undefined;

const fieldSize = (type: BaseType) => (type === BaseType.string ? STRING_BYTES : SIZES[type]);

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

export function fitCrc(bytes: Uint8Array, crc = 0): number {
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc;
}

class FitBuilder {
  private readonly chunks: Buffer[] = [];
  private readonly definitions = new Map<string, number>();

  message(
    globalNumber: number,
    fields: readonly FieldSpec[],
    values: readonly FieldValue[],
    developerFields: readonly DeveloperFieldSpec[] = [],
    developerValues: readonly FieldValue[] = []
  ): void {
    const key = `${globalNumber}:${fields.map(([number, type]) => `${number}/${type}`).join(",")}|${developerFields.map((field) => field.join("/")).join(",")}`;
    let local = this.definitions.get(key);
    if (local === undefined) {
      local = this.definitions.size;
      if (local > 15) throw new Error("Too many FIT message definitions.");
      this.definitions.set(key, local);
      const developer = developerFields.length > 0;
      const definition = Buffer.alloc(6 + fields.length * 3 + (developer ? 1 + developerFields.length * 3 : 0));
      definition[0] = 0x40 | (developer ? 0x20 : 0) | local;
      definition.writeUInt16LE(globalNumber, 3);
      definition[5] = fields.length;
      fields.forEach(([number, type], index) => {
        definition[6 + index * 3] = number;
        definition[7 + index * 3] = fieldSize(type);
        definition[8 + index * 3] = type;
      });
      if (developer) {
        const at = 6 + fields.length * 3;
        definition[at] = developerFields.length;
        developerFields.forEach(([number, type, developerIndex], index) => {
          definition[at + 1 + index * 3] = number;
          definition[at + 2 + index * 3] = SIZES[type];
          definition[at + 3 + index * 3] = developerIndex;
        });
      }
      this.chunks.push(definition);
    }
    const all: Array<[BaseType, FieldValue]> = [
      ...fields.map(([, type], index): [BaseType, FieldValue] => [type, values[index]]),
      ...developerFields.map(([, type], index): [BaseType, FieldValue] => [type, developerValues[index]])
    ];
    const record = Buffer.alloc(1 + all.reduce((total, [type]) => total + fieldSize(type), 0));
    record[0] = local;
    let offset = 1;
    for (const [type, raw] of all) {
      if (type === BaseType.string) {
        // Null-terminated UTF-8 in a fixed-size field.
        Buffer.from(typeof raw === "string" ? raw : "", "utf8").subarray(0, STRING_BYTES - 1).copy(record, offset);
      } else if (type === BaseType.float32) {
        record.writeFloatLE(typeof raw === "number" && Number.isFinite(raw) ? raw : Number.NaN, offset);
        if (typeof raw !== "number" || !Number.isFinite(raw)) record.writeUInt32LE(0xffff_ffff, offset);
      } else {
        const value = typeof raw !== "number" || !Number.isFinite(raw) ? INVALID[type] : Math.round(raw);
        switch (type) {
          case BaseType.enum: case BaseType.uint8: record.writeUInt8(clamp(value, 0, 0xff), offset); break;
          case BaseType.sint8: record.writeInt8(clamp(value, -0x80, 0x7f), offset); break;
          case BaseType.uint16: record.writeUInt16LE(clamp(value, 0, 0xffff), offset); break;
          case BaseType.sint16: record.writeInt16LE(clamp(value, -0x8000, 0x7fff), offset); break;
          case BaseType.uint32: record.writeUInt32LE(clamp(value, 0, 0xffff_ffff), offset); break;
          case BaseType.sint32: record.writeInt32LE(clamp(value, -0x8000_0000, 0x7fff_ffff), offset); break;
        }
      }
      offset += fieldSize(type);
    }
    this.chunks.push(record);
  }

  finish(): Buffer {
    const data = Buffer.concat(this.chunks);
    const header = Buffer.alloc(14);
    header[0] = 14;
    header[1] = 0x20;
    header.writeUInt16LE(2132, 2);
    header.writeUInt32LE(data.length, 4);
    header.write(".FIT", 8, "ascii");
    header.writeUInt16LE(fitCrc(header.subarray(0, 12)), 12);
    const body = Buffer.concat([header, data]);
    const crc = Buffer.alloc(2);
    crc.writeUInt16LE(fitCrc(body));
    return Buffer.concat([body, crc]);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const fitTime = (unixSeconds: number) => unixSeconds - FIT_EPOCH;
const semicircles = (degrees: number | undefined) => (degrees === undefined ? undefined : (degrees * 2 ** 31) / 180);
const scaled = (value: number | undefined, scale: number, offset = 0) => (value === undefined ? undefined : (value + offset) * scale);

export interface FitWriterSample {
  ts: number;
  lat?: number;
  lon?: number;
  alt?: number;
  dist?: number;
  speed?: number;
  hr?: number;
  cadence?: number;
  power?: number;
  /** Step length, mm. */
  stepLength?: number;
  /** Ground contact time, ms. */
  groundTime?: number;
  /** Vertical oscillation, mm. */
  verticalOscillation?: number;
  /** Vertical ratio, %. */
  verticalRatio?: number;
  /** Grade-adjusted speed, m/s (developer field "Effort Pace", as COROS exports it). */
  effortSpeed?: number;
}

/** Running-dynamics averages (mm, ms, %). */
export interface FitWriterDynamics {
  groundTimeMs?: number;
  verticalOscillationMm?: number;
  verticalRatio?: number;
  stepLengthMm?: number;
}

export interface FitWriterLap {
  startTs: number;
  endTs: number;
  elapsedSec?: number;
  timerSec?: number;
  distanceM?: number;
  calories?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgHr?: number;
  maxHr?: number;
  minHr?: number;
  avgCadence?: number;
  /** Steps per minute; when given, FIT's fractional cadence keeps the half step that per-leg cadence drops. */
  avgStepCadence?: number;
  avgPower?: number;
  maxPower?: number;
  avgTemperature?: number;
  ascentM?: number;
  descentM?: number;
  dynamics?: FitWriterDynamics;
}

/** The watch's training analysis, written as session developer fields (effects use the standard fields). */
export interface FitWriterTraining {
  trainingLoad: number;
  aerobicLoad: number;
  anaerobicLoad: number;
  /** × 10. */
  aerobicEffect: number;
  anaerobicEffect: number;
  focus: number;
  sevenDayLoad: number;
  recommendedLoadMin: number;
  recommendedLoadMax: number;
  /** The watch's VO₂ max, ml/kg/min. */
  vo2max?: number;
  /** Seconds from the end of the activity until fully recovered. */
  recovery?: number;
  baseFitness?: number;
  loadImpact?: number;
  /** Percent. */
  fatigue?: number;
}

export interface FitWriterActivity extends FitWriterLap {
  /** FIT sport / sub_sport enums. */
  sport: number;
  subSport?: number;
  maxCadence?: number;
  maxStepCadence?: number;
  totalStrides?: number;
  training?: FitWriterTraining;
  activeWindows: Array<[number, number]>;
  laps: FitWriterLap[];
  samples: FitWriterSample[];
  createdTs: number;
}

const FILE_ID: readonly FieldSpec[] = [[0, BaseType.enum], [1, BaseType.uint16], [2, BaseType.uint16], [4, BaseType.uint32]];
const EVENT: readonly FieldSpec[] = [[253, BaseType.uint32], [0, BaseType.enum], [1, BaseType.enum], [4, BaseType.uint8]];
const DEVELOPER_DATA_ID: readonly FieldSpec[] = [[3, BaseType.uint8]];
const FIELD_DESCRIPTION: readonly FieldSpec[] = [[0, BaseType.uint8], [1, BaseType.uint8], [2, BaseType.uint8], [3, BaseType.string], [8, BaseType.string]];
const RECORD: readonly FieldSpec[] = [
  [253, BaseType.uint32], [0, BaseType.sint32], [1, BaseType.sint32], [2, BaseType.uint16], [3, BaseType.uint8],
  [4, BaseType.uint8], [5, BaseType.uint32], [6, BaseType.uint16], [7, BaseType.uint16],
  [39, BaseType.uint16], [41, BaseType.uint16], [83, BaseType.uint16], [85, BaseType.uint16]
];
const LAP: readonly FieldSpec[] = [
  [253, BaseType.uint32], [254, BaseType.uint16], [0, BaseType.enum], [1, BaseType.enum], [2, BaseType.uint32], [7, BaseType.uint32],
  [8, BaseType.uint32], [9, BaseType.uint32], [11, BaseType.uint16], [13, BaseType.uint16], [14, BaseType.uint16], [15, BaseType.uint8],
  [16, BaseType.uint8], [17, BaseType.uint8], [19, BaseType.uint16], [20, BaseType.uint16], [21, BaseType.uint16], [22, BaseType.uint16],
  [50, BaseType.sint8], [63, BaseType.uint8], [77, BaseType.uint16], [79, BaseType.uint16], [118, BaseType.uint16], [120, BaseType.uint16],
  [80, BaseType.uint8]
];
const SESSION: readonly FieldSpec[] = [
  [253, BaseType.uint32], [0, BaseType.enum], [1, BaseType.enum], [2, BaseType.uint32], [5, BaseType.enum], [6, BaseType.enum],
  [7, BaseType.uint32], [8, BaseType.uint32], [9, BaseType.uint32], [10, BaseType.uint32], [11, BaseType.uint16], [14, BaseType.uint16],
  [15, BaseType.uint16], [16, BaseType.uint8], [17, BaseType.uint8], [18, BaseType.uint8], [19, BaseType.uint8], [20, BaseType.uint16],
  [22, BaseType.uint16], [23, BaseType.uint16], [24, BaseType.uint8], [25, BaseType.uint16], [26, BaseType.uint16], [57, BaseType.sint8],
  [64, BaseType.uint8], [89, BaseType.uint16], [91, BaseType.uint16], [132, BaseType.uint16], [134, BaseType.uint16], [137, BaseType.uint8],
  [92, BaseType.uint8], [93, BaseType.uint8]
];
const ACTIVITY: readonly FieldSpec[] = [[253, BaseType.uint32], [0, BaseType.uint32], [1, BaseType.uint16], [2, BaseType.enum], [3, BaseType.enum], [4, BaseType.enum]];

const DEVELOPER_INDEX = 0;
/** Developer fields, named so readers can find them; the record field keeps COROS's own name. */
const FIT_DEVELOPER_FIELDS = {
  effortPace: { number: 0, type: BaseType.float32, name: "Effort Pace", units: "m/s" },
  trainingLoad: { number: 1, type: BaseType.uint16, name: "Training Load", units: "" },
  aerobicLoad: { number: 2, type: BaseType.uint16, name: "Aerobic Training Load", units: "" },
  anaerobicLoad: { number: 3, type: BaseType.uint16, name: "Anaerobic Training Load", units: "" },
  focus: { number: 4, type: BaseType.uint8, name: "Training Focus", units: "" },
  sevenDayLoad: { number: 5, type: BaseType.uint16, name: "7-Day Training Load", units: "" },
  recommendedLoadMin: { number: 6, type: BaseType.uint16, name: "Recommended Load Min", units: "" },
  recommendedLoadMax: { number: 7, type: BaseType.uint16, name: "Recommended Load Max", units: "" },
  vo2max: { number: 8, type: BaseType.uint8, name: "VO2 Max", units: "ml/kg/min" },
  recovery: { number: 9, type: BaseType.uint32, name: "Recovery Time", units: "s" },
  baseFitness: { number: 10, type: BaseType.uint16, name: "Base Fitness", units: "" },
  loadImpact: { number: 11, type: BaseType.uint16, name: "Load Impact", units: "" },
  fatigue: { number: 12, type: BaseType.sint16, name: "Fatigue", units: "%" }
} as const;
const SESSION_TRAINING_FIELDS = [
  "trainingLoad", "aerobicLoad", "anaerobicLoad", "focus", "sevenDayLoad", "recommendedLoadMin", "recommendedLoadMax", "vo2max",
  "recovery", "baseFitness", "loadImpact", "fatigue"
] as const;
const developerSpec = (key: keyof typeof FIT_DEVELOPER_FIELDS): DeveloperFieldSpec =>
  [FIT_DEVELOPER_FIELDS[key].number, FIT_DEVELOPER_FIELDS[key].type, DEVELOPER_INDEX];

const EVENT_TIMER = 0;
const EVENT_TYPE_START = 0;
const EVENT_TYPE_STOP_ALL = 4;
const EVENT_LAP = 9;
const EVENT_SESSION = 8;
const EVENT_ACTIVITY = 26;
const EVENT_TYPE_STOP = 1;

/** FIT fractional cadence (1/128 rpm) for a steps-per-minute value, beyond the per-leg whole number. */
const fractionalCadence = (stepsPerMinute: number | undefined) =>
  stepsPerMinute === undefined ? undefined : Math.round((stepsPerMinute / 2 - Math.floor(stepsPerMinute / 2)) * 128);

const dynamicsValues = (dynamics: FitWriterDynamics | undefined) => [
  scaled(dynamics?.verticalOscillationMm, 10), scaled(dynamics?.groundTimeMs, 10), scaled(dynamics?.verticalRatio, 100), scaled(dynamics?.stepLengthMm, 10)
];

export function writeFitActivity(activity: FitWriterActivity): Buffer {
  const fit = new FitBuilder();
  fit.message(0, FILE_ID, [4, MANUFACTURER_COROS, 0, fitTime(activity.createdTs)]);
  const hasEffort = activity.samples.some((sample) => sample.effortSpeed !== undefined);
  if (hasEffort || activity.training) {
    fit.message(207, DEVELOPER_DATA_ID, [DEVELOPER_INDEX]);
    const used = [...(hasEffort ? ["effortPace" as const] : []), ...(activity.training ? SESSION_TRAINING_FIELDS : [])];
    for (const key of used) {
      const field = FIT_DEVELOPER_FIELDS[key];
      fit.message(206, FIELD_DESCRIPTION, [DEVELOPER_INDEX, field.number, field.type, field.name, field.units]);
    }
  }

  const events = activity.activeWindows.flatMap(([start, end]) => [
    { ts: start, type: EVENT_TYPE_START }, { ts: end, type: EVENT_TYPE_STOP_ALL }
  ]);
  let eventIndex = 0;
  const writeEvent = (event: { ts: number; type: number }) => fit.message(21, EVENT, [fitTime(event.ts), EVENT_TIMER, event.type, 0]);
  const recordDeveloper = hasEffort ? [developerSpec("effortPace")] : [];
  for (const sample of activity.samples) {
    // A start goes before records at its second, a stop after them.
    while (eventIndex < events.length) {
      const event = events[eventIndex]!;
      if (event.ts > sample.ts || (event.ts === sample.ts && event.type !== EVENT_TYPE_START)) break;
      writeEvent(event);
      eventIndex += 1;
    }
    fit.message(20, RECORD, [
      fitTime(sample.ts), semicircles(sample.lat), semicircles(sample.lon), scaled(sample.alt, 5, 500), sample.hr,
      sample.cadence, scaled(sample.dist, 100), scaled(sample.speed, 1000), sample.power,
      scaled(sample.verticalOscillation, 10), scaled(sample.groundTime, 10), scaled(sample.verticalRatio, 100), scaled(sample.stepLength, 10)
    ], recordDeveloper, hasEffort ? [sample.effortSpeed] : []);
  }
  for (; eventIndex < events.length; eventIndex++) writeEvent(events[eventIndex]!);

  activity.laps.forEach((lap, index) => {
    fit.message(19, LAP, [
      fitTime(lap.endTs), index, EVENT_LAP, EVENT_TYPE_STOP, fitTime(lap.startTs), scaled(lap.elapsedSec, 1000), scaled(lap.timerSec, 1000),
      scaled(lap.distanceM, 100), lap.calories, scaled(lap.avgSpeed, 1000), scaled(lap.maxSpeed, 1000), lap.avgHr, lap.maxHr,
      lap.avgCadence, lap.avgPower, lap.maxPower, lap.ascentM, lap.descentM, lap.avgTemperature, lap.minHr, ...dynamicsValues(lap.dynamics),
      fractionalCadence(lap.avgStepCadence)
    ]);
  });
  const training = activity.training;
  fit.message(18, SESSION, [
    fitTime(activity.endTs), EVENT_SESSION, EVENT_TYPE_STOP, fitTime(activity.startTs), activity.sport, activity.subSport,
    scaled(activity.elapsedSec, 1000), scaled(activity.timerSec, 1000), scaled(activity.distanceM, 100), activity.totalStrides, activity.calories,
    scaled(activity.avgSpeed, 1000), scaled(activity.maxSpeed, 1000), activity.avgHr, activity.maxHr, activity.avgCadence,
    activity.maxCadence, activity.avgPower, activity.ascentM, activity.descentM, training?.aerobicEffect, 0, activity.laps.length,
    activity.avgTemperature, activity.minHr, ...dynamicsValues(activity.dynamics), training?.anaerobicEffect,
    fractionalCadence(activity.avgStepCadence), fractionalCadence(activity.maxStepCadence)
  ], training ? SESSION_TRAINING_FIELDS.map(developerSpec) : [], training ? SESSION_TRAINING_FIELDS.map((key) => training[key]) : []);
  fit.message(34, ACTIVITY, [fitTime(activity.endTs), scaled(activity.timerSec, 1000), 1, 0, EVENT_ACTIVITY, EVENT_TYPE_STOP]);
  return fit.finish();
}
