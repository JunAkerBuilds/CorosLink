// The watch's sport-record file (SyncData file 14): every workout still on the watch, in COROS's own format.
// A port of CorosKit's WatchData/SportRecord.swift (itself a port of CorosLink's corosSportRecord.ts); the arithmetic
// follows it exactly, JavaScript rounding included, so the FIT file written from a session is the same bytes.
//
// Layout: 4 KB pages, each starting with a block marker (kind 0x1f, body a5 5a…) that gives the page's length unit.
// Records follow back to back: a 1-byte header (bit 0 clear: kind bits 1-3, length bits 4-7) or a u16 one (kind bits
// 1-3 | bits 8-9 << 3, length bits 4-7 | bits 10-15 << 4). Kind 4 is "sport info" (start, pause, resume, lap, summary,
// lap extension, science summary, protobuf with the gear, planned workout pieces); kind 8 a compressed sample series.
// Only what has been validated is decoded; anything else is ignored, never guessed.

/** Seconds from the Unix epoch to the watch's (2014-01-01). */
export const SPORT_EPOCH = 1_388_534_400;
const PAGE_BYTES = 4096;
/** Longest activity accepted, start to stop: a damaged time stamp can put a stop years after its start. */
const MAX_SESSION_SECONDS = 7 * 86_400;
/** Most activity time decoded from one file (start to stop, summed); past this the oldest are set aside. */
const MAX_FILE_SESSION_SECONDS = 1_000 * 3600;
const MAX_RECORDS = 1_000_000;
/** How far the timer-running windows may exceed the watch's own timer before they are implausible. */
const WINDOW_SLACK_SECONDS = 86_400;

export const KIND_SPORT_INFO = 4;
const KIND_SERIES = 8, KIND_PADDING = 0x1e, KIND_MARKER = 0x1f;
export const INFO_START = 0, INFO_SUMMARY = 5;
const INFO_PAUSE = 1, INFO_RESUME = 2, INFO_LAP = 4, INFO_LAP_EXTENSION = 6;
const INFO_SCIENCE = 0x0f, INFO_PROTOBUF = 0x14, INFO_WORKOUT = 0x0e, SCIENCE_TRAINING = 2;

/** Series channel types (record byte 1); the group within a channel is the u16 header >> 11. */
const Channel = {
  stepCadence: 0x00, stepLength: 0x01, heartRate: 0x02, altitude: 0x05, speed: 0x06,
  distance: 0x07, power: 0x08, effortSpeed: 0x11, dynamics: 0x26, position: 0x28, positionWithTime: 0x2c,
} as const;

/** Device sport type (start record) → COROS sport type, as COROS maps it. */
const DEVICE_SPORT_TYPES: Record<number, number> = {
  0: 100, 1: 101, 2: 301, 3: 300, 4: 200, 5: 102, 6: 201, 7: 105, 8: 104, 9: 400, 10: 401, 11: 501, 12: 500, 13: 502,
  14: 103, 15: 600, 16: 402, 17: 700, 18: 701, 19: 702, 20: 704, 21: 705, 22: 706, 23: 503, 24: 106, 25: 708, 26: 900,
  27: 800, 28: 901, 29: 98, 30: 204, 31: 203, 32: 202, 33: 205, 34: 707, 35: 709, 36: 801, 37: 710, 38: 902, 39: 1000,
  40: 1001, 41: 1002, 42: 1003, 43: 1004, 44: 903, 45: 904, 46: 905, 47: 906, 48: 1100, 49: 1101, 50: 1005, 51: 711,
  52: 712, 53: 713, 54: 714, 55: 715, 56: 802, 57: 1006, 58: 1200,
};
/** Run sports, where the step-cadence channel is steps per minute (reported per leg, like FIT). */
export const RUN_SPORT_TYPES = new Set([100, 101, 102, 103]);
/** Fastest average speed a summary's distance may give, m/s. */
export const MAX_SUMMARY_SPEED = 100;
/** Sports whose session summary isn't laid out like a run's (a strength workout's read that way gave 6,239 km). */
const OTHER_SUMMARY_SPORTS = new Set([402]);

export class SportRecordFormatError extends Error {
  constructor() { super("Not a sport-record file."); }
}
class Implausible extends Error {}

// MARK: Types

export interface Dynamics {
  groundTimeMs?: number;
  verticalOscillationMm?: number;
  /** Percent. */
  verticalRatio?: number;
  stepLengthMm?: number;
}

/** The watch's own analysis of the workout (science summary, part 2). Loads are COROS training-load points. */
export interface Training {
  trainingLoad: number; aerobicLoad: number; anaerobicLoad: number; lowLoad: number; midLoad: number; highLoad: number;
  /** Training effect × 10. */
  aerobicEffect: number; anaerobicEffect: number;
  /** 1 Easy … 6 Anaerobic; 0 when not given. */
  focus: number;
  performance: number;
  /** Seconds from the end of the activity until fully recovered. */
  recovery: number;
  sevenDayLoad: number; recommendedLoadMin: number; recommendedLoadMax: number;
  vo2max?: number;
  baseFitness?: number;
  loadImpact?: number;
  /** Load Impact as a percentage of Base Fitness. */
  fatigue?: number;
}

/** The gear picked in the watch's "Select Shoes", with COROS's gear ID (a u64, hence bigint). */
export interface Gear { id: bigint; name: string }

export interface Lap {
  index: number;
  startTs: number;
  elapsedSec: number;
  timerSec: number;
  distanceM: number;
  calories: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgHr?: number;
  maxHr?: number;
  /** Per leg, like FIT; `avgStepCadence` is steps per minute as recorded. */
  avgCadence?: number;
  avgStepCadence?: number;
  avgPower?: number;
  maxPower?: number;
  minHr?: number;
  avgTemperature?: number;
  ascentM: number;
  descentM: number;
  dynamics: Dynamics;
}

export interface Sample {
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
  groundTime?: number;
  verticalOscillation?: number;
  /** Percent. */
  verticalRatio?: number;
  /** Grade-adjusted speed, m/s. */
  effortSpeed?: number;
}

/** A timer-running period, inclusive Unix seconds. */
export interface Window { lower: number; upper: number }

export interface Session {
  /** Stable per activity: device start time and sport. */
  watchActivityId: string;
  /** COROS's sport code (100 = outdoor run). */
  sportType: number;
  deviceSportType: number;
  /** Unix seconds. */
  startTs: number;
  endTs: number;
  elapsedSec: number;
  timerSec: number;
  distanceM: number;
  calories: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  maxCadence?: number;
  avgPower?: number;
  avgStepCadence?: number;
  maxStepCadence?: number;
  minHr?: number;
  avgTemperature?: number;
  /** Strides (steps ÷ 2). */
  totalStrides?: number;
  ascentM: number;
  descentM: number;
  dynamics: Dynamics;
  training?: Training;
  gear?: Gear;
  activeWindows: Window[];
  laps: Lap[];
  samples: Sample[];
  /** The planned workout's name when the activity followed one ("6km Long Run"). */
  workoutName?: string;
}

export interface SportRecordFile {
  sessions: Session[];
  /** Sessions skipped because they were still being recorded or had no summary. */
  incomplete: number;
  /** Sessions set aside because their times are implausible or could not be built. */
  rejected: number;
  /** Damaged sample-series records that were skipped. */
  skippedRecords: number;
}

// MARK: Protobuf (only reading, as SportRecord needs it)

export interface ProtoField { number: number; varint?: bigint; bytes?: Uint8Array }

class ProtoError extends Error {}
const MAX_PROTO_FIELDS = 100_000;

/** A message's fields in order (CorosKit's ProtoReader.fields); throws on damaged bytes. */
export function protoFields(data: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  const varint = (): bigint => {
    let value = 0n, shift = 0n;
    while (offset < data.length) {
      const byte = data[offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return value;
      shift += 7n;
      if (shift > 63n) break;
    }
    throw new ProtoError();
  };
  while (offset < data.length) {
    if (fields.length >= MAX_PROTO_FIELDS) throw new ProtoError();
    const key = varint();
    const number = Number(key >> 3n);
    if (number <= 0) throw new ProtoError();
    switch (Number(key & 7n)) {
      case 0: fields.push({ number, varint: varint() }); break;
      case 1: if (offset + 8 > data.length) throw new ProtoError(); offset += 8; fields.push({ number }); break;
      case 2: {
        const length = varint();
        if (length > BigInt(data.length - offset)) throw new ProtoError();
        fields.push({ number, bytes: data.subarray(offset, offset + Number(length)) });
        offset += Number(length);
        break;
      }
      case 5: if (offset + 4 > data.length) throw new ProtoError(); offset += 4; fields.push({ number }); break;
      default: throw new ProtoError();
    }
  }
  return fields;
}

const utf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// MARK: Compressed series

/** LSB-first bit reader. Like the watch's reader, reads past the end or wider than 32 bits yield 0. */
class BitReader {
  bit = 0;
  constructor(private readonly bytes: Uint8Array) {}

  read(width: number): number {
    if (width <= 0 || width > 32) return 0;
    let value = 0;
    for (let index = 0; index < width; index++) {
      const byte = this.bit >> 3;
      if (byte >= this.bytes.length) return 0;
      if ((this.bytes[byte] >> (this.bit & 7)) & 1) value += 2 ** index;
      this.bit += 1;
    }
    return value;
  }
}

/** As CorosLink's TypeScript computes it, 32-bit shift wrap included (a 64-bit mask is 0 there). Values are ≥ 0. */
export function zigzag(value: number, bits: number): number {
  const masked = bits === 32 ? value % 2 ** 32 : bits % 32 === 0 ? 0 : value % 2 ** (bits % 32);
  const half = Math.floor(masked / 2);
  return masked % 2 === 1 ? -half - 1 : half;
}

function wrap(value: number, bits: number): number {
  if (bits >= 63) return value;
  const range = 2 ** bits;
  return ((value % range) + range) % range;
}

/**
 * Delta-packed samples: u16 flags, u8 count, then a bitstream. Flags: bits 0-1 sample size (1 << n bytes), bits 2-7
 * width - 1, bit 8 variable width / base offset, bits 9-10 mode (0 constant step, 1 deltas, 2 deltas with offset,
 * 3 absolute values; absolute with width 64 and size bits means raw bytes).
 */
export function decodeDeltaPack(packed: Uint8Array): number[] {
  if (packed.length < 3) throw new SportRecordFormatError();
  const flags = packed[0] | (packed[1] << 8);
  const count = packed[2];
  const sizeShift = flags & 3;
  const bits = 8 << sizeShift;
  const width = ((flags & 0xff) >> 2) + 1;
  const mode = (flags >> 9) & 3;
  const variable = (flags & 0x100) !== 0;
  const data = packed.subarray(3);
  const reader = new BitReader(data);
  if (count === 0) return [];

  if (mode === 3) {
    const size = 1 << sizeShift;
    if ((flags & 0x1fc) === 0x1fc) {
      if (data.length < count * size) throw new SportRecordFormatError();
      return Array.from({ length: count }, (_, index) => {
        let value = 0n;
        for (let byte = 0; byte < size; byte++) value |= BigInt(data[index * size + byte]) << BigInt(8 * byte);
        // Int(truncatingIfNeeded:) of a u64: a signed 64-bit value (exact only up to 2^53 here).
        return Number(BigInt.asIntN(64, value));
      });
    }
    const base = variable ? reader.read(reader.read(6) + 1) : 0;
    return Array.from({ length: count }, () => wrap(reader.read(width) + base, bits));
  }

  const first = reader.read(reader.read(6) + 1);
  const offset = mode === 0 || mode === 2 ? reader.read(reader.read(6) + 1) : 0;
  let extraWidth = 0;
  if (variable) {
    const maxExtra = reader.read(reader.read(3) + 1);
    extraWidth = maxExtra === 0 ? 1 : 32 - Math.clz32(maxExtra);
  }
  const values = [wrap(first, bits)];
  let value = first;
  let delta = 0;
  for (let i = 1; i < count; i++) {
    if (mode !== 0) {
      let readWidth = width;
      if (variable && reader.read(1) !== 0) readWidth = (reader.read(extraWidth) + width) & 0xff;
      delta = reader.read(readWidth);
    }
    value += zigzag(delta + offset, bits);
    values.push(wrap(value, bits));
  }
  return values;
}

// MARK: Record walk

export interface SportRecordEntry { offset: number; kind: number; /** Absolute start of the body in the file. */ start: number; body: Uint8Array }

function header(file: Uint8Array, position: number): { kind: number; length: number; headerBytes: number } | null {
  const first = file[position];
  if ((first & 1) === 0) return { kind: (first & 0xf) >> 1, length: first >> 4, headerBytes: 1 };
  if (position + 2 > file.length) return null;
  const h = first | (file[position + 1] << 8);
  return { kind: ((h & 0xf) >> 1) | ((h >> 5) & 0x18), length: ((h >> 4) & 0xf) | ((h >> 6) & 0xfff0), headerBytes: 2 };
}

function isMarker(file: Uint8Array, position: number): boolean {
  if (position + 4 > file.length) return false;
  const h = header(file, position);
  return !!h && h.headerBytes === 2 && h.kind === KIND_MARKER && h.length >= 5 && h.length < 15 &&
    file[position + 2] === 0xa5 && file[position + 3] === 0x5a;
}

/** Every record after a block marker; scanning resumes at the next page when a record does not fit. */
export function walk(file: Uint8Array): SportRecordEntry[] {
  const records: SportRecordEntry[] = [];
  let position = 0, unit = 0, markers = 0;
  while (position < file.length) {
    if (unit === 0) {
      if (isMarker(file, position)) unit = -1;
      else { position += 1; continue; }
    }
    const h = header(file, position);
    if (!h) break;
    const length = h.kind === KIND_MARKER || h.kind === KIND_PADDING ? h.length : h.length * Math.max(unit, 0);
    const start = position + h.headerBytes;
    if (start + length > file.length) {
      unit = 0;
      position = (Math.floor(position / PAGE_BYTES) + 1) * PAGE_BYTES;
      continue;
    }
    const body = file.subarray(start, start + length);
    if (h.kind === KIND_MARKER) {
      if (body.length < 5 || body[0] !== 0xa5 || body[1] !== 0x5a) { unit = 0; position += 1; continue; }
      unit = body[4];
      markers += 1;
    }
    if (length > 0) {
      if (records.length >= MAX_RECORDS) throw new SportRecordFormatError();
      records.push({ offset: position, kind: h.kind, start, body });
    }
    position = start + length;
  }
  if (markers === 0) throw new SportRecordFormatError();
  return records;
}

// MARK: Sessions

interface SeriesSegment { channel: number; group: number; /** Unix seconds of the first sample. */ startTs: number; interval: number; values: number[] }

interface LapDraft {
  index: number; endTs: number; timerCs: number; distanceCm: number; calories: number; bestPace: number;
  avgHr: number; maxHr: number; ascent: number; descent: number; stepCadence: number; minHr: number; temperature: number; stepLengthCm: number;
}

interface LapExtension { avgPower: number; maxPower: number; verticalRatioX10: number; groundTimeMs: number; /** 1/16 mm. */ verticalOscillation16: number }

interface Stop { ts: number; ms: number }

class Draft {
  pauses: Stop[] = [];
  resumes: number[] = [];
  laps: LapDraft[] = [];
  lapExtensions = new Map<number, LapExtension>();
  training?: Training;
  gear?: Gear;
  /** The planned workout's file, piece by piece; the first copy of each piece is kept. */
  workoutPieces = new Map<number, Uint8Array>();
  summary?: Uint8Array;
  series: SeriesSegment[] = [];

  constructor(readonly startTs: number, readonly startMs: number, readonly deviceSportType: number) {}

  /** The stop record: the last pause, when no resume followed it. */
  get stop(): Stop | undefined { return this.pauses.length > this.resumes.length ? this.pauses[this.pauses.length - 1] : undefined; }
  /** A stop before the start, or days after it, is a damaged or shifted time stamp. */
  implausible(stop: Stop): boolean { return stop.ts < this.startTs || stop.ts - this.startTs > MAX_SESSION_SECONDS; }
}

/** Little-endian reads relative to a slice's start; all unsigned values non-negative. */
class Bytes {
  constructor(readonly slice: Uint8Array) {}
  get count(): number { return this.slice.length; }
  at(offset: number): number { return this.slice[offset]; }
  u16(offset: number): number { return this.slice[offset] | (this.slice[offset + 1] << 8); }
  i16(offset: number): number { const v = this.u16(offset); return v >= 0x8000 ? v - 0x10000 : v; }
  i8(offset: number): number { const v = this.slice[offset]; return v >= 0x80 ? v - 0x100 : v; }
  u32(offset: number): number { return this.u16(offset) + this.u16(offset + 2) * 65536; }
  from(offset: number): Uint8Array { return this.slice.subarray(offset); }
}

const unixTs = (deviceSeconds: number): number => deviceSeconds + SPORT_EPOCH;
const optional = (value: number): number | undefined => (value > 0 ? value : undefined);
/** JavaScript's Math.round as CorosKit spells it: halves go up. */
export const jsRound = (value: number): number => Math.floor(value + 0.5);

function series(body: Uint8Array): SeriesSegment | null {
  if (body.length < 10) return null;
  const b = new Bytes(body);
  let sum = 0;
  for (let index = 1; index < body.length; index++) sum = (sum + body[index]) & 0xff;
  if (sum !== body[0]) return null;
  const packed = b.from(7);
  return { channel: body[1], group: new Bytes(packed).u16(0) >> 11, startTs: unixTs(b.u32(3)), interval: body[2], values: decodeDeltaPack(packed) };
}

function lap(info: Bytes): LapDraft | null {
  if (info.count < 38) return null;
  return {
    index: info.u16(4), endTs: unixTs(info.u32(0)), timerCs: info.u32(6), distanceCm: info.u32(10), calories: info.u32(18),
    bestPace: info.u16(24), avgHr: info.at(26), maxHr: info.at(27), ascent: info.u16(31), descent: info.u16(33), stepCadence: info.at(35),
    minHr: info.at(28), temperature: info.i8(29), stepLengthCm: info.at(37),
  };
}

function lapExtension(info: Bytes): LapExtension | null {
  if (info.count < 14) return null;
  return { avgPower: info.u16(2), maxPower: info.u16(4), verticalRatioX10: info.u16(8), groundTimeMs: info.u16(10), verticalOscillation16: info.u16(12) };
}

/** Science summary part 2 (`info` starts at the part byte). */
function training(info: Bytes): Training | null {
  if (info.count < 0x2d || info.at(0) !== SCIENCE_TRAINING) return null;
  const t: Training = {
    trainingLoad: info.u16(5) + info.u16(7) + info.u16(9), aerobicLoad: info.u16(1), anaerobicLoad: info.u16(3),
    lowLoad: info.u16(5), midLoad: info.u16(7), highLoad: info.u16(9),
    aerobicEffect: info.at(0xc), anaerobicEffect: info.at(0xd), focus: info.at(0xb), performance: info.at(0xe),
    recovery: info.u32(0x13), sevenDayLoad: info.u16(0x17), recommendedLoadMin: info.u16(0x1e), recommendedLoadMax: info.u16(0x20),
  };
  if (info.at(0x27) !== 0) t.vo2max = info.at(0x27);
  // Base Fitness, Load Impact and fatigue mean nothing until the watch has a Base Fitness.
  if (info.count >= 0x2f && info.u16(0x19) !== 0) {
    t.baseFitness = info.u16(0x19);
    t.loadImpact = info.u16(0x1b);
    t.fatigue = info.i16(0x2d);
  }
  return t;
}

const last = <T>(items: T[], test: (item: T) => boolean): T | undefined => [...items].reverse().find(test);

/** `[length u16][SportInfoPb]`: field 5 is `SportGearInfo {multi_index = 1, gear_id = 2, gear_name = 3}`. */
function gear(info: Bytes): Gear | null {
  if (info.count < 2) return null;
  const length = info.u16(0);
  if (length <= 0 || 2 + length > info.count) return null;
  try {
    const message = last(protoFields(info.from(2).subarray(0, length)), (f) => f.number === 5)?.bytes;
    if (!message) return null;
    const inner = protoFields(message);
    const id = last(inner, (f) => f.number === 2)?.varint;
    if (id === undefined || id === 0n) return null;
    const name = last(inner, (f) => f.number === 3)?.bytes;
    return { id, name: name ? utf8(name) : "" };
  } catch {
    return null;
  }
}

/**
 * The name of the planned workout an activity followed, from its pieces joined in order: the workout file's 16-byte
 * header ("HF", type 41, size @8) and `ProgramLite`, whose summary (field 1) holds the name (2) and its overflow past
 * 39 bytes (20), joined with a space. A name the watch translates itself ("T3001") or a file that isn't whole gives none.
 */
export function workoutName(pieces: Map<number, Uint8Array>): string | undefined {
  const parts: Uint8Array[] = [];
  for (let index = 0; pieces.has(index); index++) parts.push(pieces.get(index)!);
  const file = Buffer.concat(parts);
  if (file.length < 16 || file[0] !== 0x48 || file[1] !== 0x46 || file[3] !== 41) return undefined;
  const size = new Bytes(file).u32(8);
  if (size <= 0 || 16 + size > file.length) return undefined;
  let fields: ProtoField[];
  try {
    const summary = protoFields(file.subarray(16, 16 + size)).find((f) => f.number === 1)?.bytes;
    if (!summary) return undefined;
    fields = protoFields(summary);
  } catch {
    return undefined;
  }
  const headBytes = fields.find((f) => f.number === 2)?.bytes;
  if (!headBytes) return undefined;
  const head = utf8(headBytes);
  const tailBytes = fields.find((f) => f.number === 20)?.bytes;
  const tail = tailBytes ? utf8(tailBytes) : "";
  const name = (tail === "" ? head : `${head} ${tail}`).trim();
  if (name === "" || /^T\p{Nd}{4,9}$/u.test(name)) return undefined;
  return name;
}

/** The floored mean of the samples that have a value, as COROS reports running dynamics. */
function averageOfPresent(values: number[]): number | undefined {
  const present = values.filter((v) => v > 0);
  return present.length === 0 ? undefined : Math.floor(present.reduce((a, b) => a + b, 0) / present.length);
}

/** Sample value at `ts`; between samples (up to 8 s apart), distance and speed interpolate, others take the floored mean. */
function lookup(segments: SeriesSegment[], linear: boolean): (ts: number) => number | undefined {
  const points = new Map<number, number>();
  for (const segment of segments) {
    segment.values.forEach((value, index) => points.set(segment.startTs + index * Math.max(segment.interval, 1), value));
  }
  const stamps = [...points.keys()].sort((a, b) => a - b);
  return (ts) => {
    const exact = points.get(ts);
    if (exact !== undefined) return exact;
    let low = 0, high = stamps.length - 1;
    if (high < 0 || ts < stamps[0] || ts > stamps[high]) return undefined;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (stamps[middle] <= ts) low = middle; else high = middle;
    }
    const before = stamps[low], after = stamps[high];
    if (after - before > 8) return undefined;
    const a = points.get(before)!, b = points.get(after)!;
    return linear ? a + ((b - a) * (ts - before)) / (after - before) : Math.floor((a + b) / 2);
  };
}

const signed32 = (value: number): number => (value >= 0x8000_0000 ? value - 0x1_0000_0000 : value);

/**
 * Whether the summary reads as laid out for runs and rides, checked against the workout itself: a timer no longer than
 * its start-to-stop time (to the second) and a distance covered at under 100 m/s.
 */
function summaryFits(summary: Bytes, sportType: number, elapsed: number): boolean {
  if (OTHER_SUMMARY_SPORTS.has(sportType)) return false;
  const timer = summary.u32(4) / 100, distance = summary.u32(0) / 100;
  return timer <= elapsed + 1 && distance <= Math.max(timer, elapsed) * MAX_SUMMARY_SPEED;
}

function build(draft: Draft): Session | null {
  const summaryBytes = draft.summary;
  const stop = draft.stop;
  if (!summaryBytes || summaryBytes.length < 47 || !stop) return null;
  if (draft.implausible(stop)) throw new Implausible();
  const summary = new Bytes(summaryBytes);
  const sportType = DEVICE_SPORT_TYPES[draft.deviceSportType] ?? 98;
  const isRun = RUN_SPORT_TYPES.has(sportType);
  const startExact = draft.startTs + draft.startMs / 1000;
  const endExact = stop.ts + stop.ms / 1000;
  const elapsedSec = jsRound((endExact - startExact) * 100) / 100;
  // A summary in another layout gives nothing: the figures come from the recorded samples instead.
  const fits = summaryFits(summary, sportType, elapsedSec);
  const summaryTimer = summary.u32(4) / 100;
  const bestPace = fits ? summary.u16(16) : 0;
  const altitudeOffset = fits ? summary.i16(30) : 0;

  // Timer windows: start → pause, resume (+1 s: the watch reports whole seconds) → next pause.
  const windows: Window[] = [];
  let openAt: number | undefined = draft.startTs;
  draft.pauses.forEach((pause, index) => {
    if (openAt !== undefined && pause.ts >= openAt) windows.push({ lower: openAt, upper: pause.ts });
    openAt = index < draft.resumes.length ? draft.resumes[index] + 1 : undefined;
  });
  const activeSeconds = windows.reduce((sum, w) => sum + (w.upper - w.lower + 1), 0);
  if (fits && activeSeconds > Math.min(MAX_SESSION_SECONDS, Math.max(summaryTimer * 4, summaryTimer + WINDOW_SLACK_SECONDS))) throw new Implausible();

  const channel = (c: number, group: number) => draft.series.filter((s) => s.channel === c && s.group === group);
  const hr = lookup(channel(Channel.heartRate, 0), false);
  const distance = lookup(channel(Channel.distance, 0), true);
  const speed = lookup(channel(Channel.speed, 0), true);
  const cadence = lookup(channel(Channel.stepCadence, 0), false);
  const power = lookup(channel(Channel.power, 0), false);
  const altitude = lookup(channel(Channel.altitude, 0), false);
  const stepLength = lookup(channel(Channel.stepLength, 0), false);
  const effortSpeed = lookup(channel(Channel.effortSpeed, 0), true);
  const groundTime = lookup(channel(Channel.dynamics, 1), false);
  const oscillation = lookup(channel(Channel.dynamics, 3), false);
  const ratio = lookup(channel(Channel.dynamics, 4), false);
  const recorded = (c: number, group: number) => channel(c, group).flatMap((s) => s.values);

  const positions = new Map<number, { lat: number; lon: number }>();
  for (const kind of [Channel.position, Channel.positionWithTime]) {
    const lon = channel(kind, 0), lat = channel(kind, 1);
    const times = kind === Channel.positionWithTime ? channel(kind, 2) : [];
    lon.forEach((lonSegment, segmentIndex) => {
      if (segmentIndex >= lat.length || lat[segmentIndex].values.length !== lonSegment.values.length) return;
      const timeSegment = segmentIndex < times.length ? times[segmentIndex] : undefined;
      if (kind === Channel.positionWithTime && timeSegment?.values.length !== lonSegment.values.length) return;
      lonSegment.values.forEach((lonValue, index) => {
        const ts = timeSegment ? unixTs(timeSegment.values[index]) : lonSegment.startTs + index * Math.max(lonSegment.interval, 1);
        const latDeg = signed32(lat[segmentIndex].values[index]) / 1e7;
        const lonDeg = signed32(lonValue) / 1e7;
        if (Math.abs(latDeg) <= 90 && Math.abs(lonDeg) <= 180 && (latDeg !== 0 || lonDeg !== 0)) positions.set(ts, { lat: latDeg, lon: lonDeg });
      });
    });
  }

  const samples: Sample[] = [];
  for (const window of windows) {
    for (let ts = window.lower; ts <= window.upper; ts++) {
      const sample: Sample = { ts };
      const position = positions.get(ts);
      if (position) { sample.lat = position.lat; sample.lon = position.lon; }
      let value = hr(ts);
      if (value !== undefined && value > 0) sample.hr = value;
      if ((value = distance(ts)) !== undefined) sample.dist = value;
      if ((value = speed(ts)) !== undefined) sample.speed = value / 360;
      if (isRun && (value = cadence(ts)) !== undefined) sample.cadence = Math.floor(value / 2);
      if ((value = power(ts)) !== undefined) sample.power = value;
      if ((value = altitude(ts)) !== undefined) sample.alt = value + altitudeOffset;
      if ((value = stepLength(ts)) !== undefined && value !== 0) sample.stepLength = value * 10;
      if ((value = groundTime(ts)) !== undefined && value !== 0) sample.groundTime = value;
      if ((value = oscillation(ts)) !== undefined && value !== 0) sample.verticalOscillation = value;
      if ((value = ratio(ts)) !== undefined && value !== 0) sample.verticalRatio = value / 10;
      if ((value = effortSpeed(ts)) !== undefined) sample.effortSpeed = value / 360;
      samples.push(sample);
    }
  }

  // Without the summary: the timer from the timer-running windows, the rest from the samples.
  const timerSec = fits ? summaryTimer : Math.min(activeSeconds, elapsedSec);
  const distances = samples.flatMap((s) => (s.dist === undefined ? [] : [s.dist]));
  const distanceM = fits ? summary.u32(0) / 100 : distances.length ? distances.reduce((a, b) => Math.max(a, b)) : 0;
  const rates = samples.flatMap((s) => (s.hr === undefined ? [] : [s.hr]));

  const laps: Lap[] = [];
  let lapStart = draft.startTs;
  // Laps in another layout (a strength workout's sets) end at no time inside the workout.
  const sortedLaps = fits ? draft.laps.filter((l) => l.endTs >= draft.startTs && l.endTs <= stop.ts + 60).sort((a, b) => a.index - b.index) : [];
  sortedLaps.forEach((l, position) => {
    const isLast = position === sortedLaps.length - 1;
    const lapTimer = l.timerCs / 100;
    const ext = draft.lapExtensions.get(l.index);
    const elapsed = isLast ? jsRound((endExact - (position === 0 ? startExact : lapStart)) * 100) / 100 : l.endTs - lapStart;
    laps.push({
      index: l.index, startTs: lapStart, elapsedSec: elapsed, timerSec: lapTimer, distanceM: l.distanceCm / 100,
      calories: jsRound(l.calories / 1000),
      avgSpeed: lapTimer > 0 ? l.distanceCm / 100 / lapTimer : undefined,
      maxSpeed: l.bestPace > 0 ? 1000 / l.bestPace : undefined,
      avgHr: optional(l.avgHr), maxHr: optional(l.maxHr),
      avgCadence: isRun ? optional(Math.floor(l.stepCadence / 2)) : undefined, avgStepCadence: isRun ? optional(l.stepCadence) : undefined,
      avgPower: ext?.avgPower, maxPower: optional(ext?.maxPower ?? 0), minHr: optional(l.minHr),
      avgTemperature: l.temperature !== 0 ? l.temperature : undefined, ascentM: l.ascent, descentM: l.descent,
      dynamics: {
        groundTimeMs: optional(ext?.groundTimeMs ?? 0),
        verticalOscillationMm: optional(Math.floor((ext?.verticalOscillation16 ?? 0) / 16)),
        verticalRatio: ((v) => (v === undefined ? undefined : v / 10))(optional(ext?.verticalRatioX10 ?? 0)),
        stepLengthMm: optional(l.stepLengthCm * 10),
      },
    });
    lapStart = l.endTs;
  });

  const avgPower = fits ? optional(summary.u16(45)) : averageOfPresent(recorded(Channel.power, 0));
  const ratioAverage = averageOfPresent(recorded(Channel.dynamics, 4));
  return {
    watchActivityId: `coros-${draft.startTs}-${draft.deviceSportType}`, sportType, deviceSportType: draft.deviceSportType,
    startTs: draft.startTs, endTs: stop.ts, elapsedSec, timerSec,
    distanceM, calories: fits ? jsRound(summary.u32(10) / 1000) : 0,
    avgSpeed: timerSec > 0 ? distanceM / timerSec : undefined, maxSpeed: bestPace > 0 ? 1000 / bestPace : undefined,
    avgHr: fits ? optional(summary.at(22)) : rates.length === 0 ? undefined : jsRound(rates.reduce((a, b) => a + b, 0) / rates.length),
    maxHr: fits ? optional(summary.at(23)) : rates.length ? Math.trunc(rates.reduce((a, b) => Math.max(a, b))) : undefined,
    avgCadence: fits && isRun ? optional(Math.floor(summary.at(36) / 2)) : undefined,
    maxCadence: fits && isRun ? optional(Math.floor(summary.at(37) / 2)) : undefined,
    // 0xffff is the watch's "no power".
    avgPower: fits && avgPower === 0xffff ? undefined : avgPower,
    avgStepCadence: fits && isRun ? optional(summary.at(36)) : undefined, maxStepCadence: fits && isRun ? optional(summary.at(37)) : undefined,
    minHr: fits ? optional(summary.at(24)) : rates.length ? Math.trunc(rates.reduce((a, b) => Math.min(a, b))) : undefined,
    avgTemperature: fits && summary.i8(25) !== 0 ? summary.i8(25) : undefined,
    totalStrides: fits ? optional(Math.floor(summary.u16(39) / 2)) : undefined,
    ascentM: fits ? summary.u16(26) : 0, descentM: fits ? summary.u16(28) : 0,
    dynamics: {
      groundTimeMs: averageOfPresent(recorded(Channel.dynamics, 1)),
      verticalOscillationMm: averageOfPresent(recorded(Channel.dynamics, 3)),
      verticalRatio: ratioAverage === undefined ? undefined : ratioAverage / 10,
      stepLengthMm: fits ? optional(summary.at(43) * 10) : undefined,
    },
    training: draft.training, gear: draft.gear, activeWindows: windows, laps, samples,
    workoutName: workoutName(draft.workoutPieces),
  };
}

/**
 * Decodes every finished activity in a sport-record file; throws when the file isn't one. A damaged record or
 * activity is skipped and counted; it never hides the others. With `visit`, each activity is handed over as soon as
 * it's built and not kept, so one activity's samples are in memory at a time.
 */
export function decodeSportRecord(data: Uint8Array, visit?: (session: Session) => void): SportRecordFile {
  // A watch with nothing recorded (or everything synced) sends an empty file: no workouts, not a bad file.
  if (data.length === 0) return { sessions: [], incomplete: 0, rejected: 0, skippedRecords: 0 };
  const records = walk(data);
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  let skippedRecords = 0;
  for (const record of records) {
    if (record.kind === KIND_SPORT_INFO && record.body.length >= 5) {
      const type = record.body[0];
      const info = new Bytes(record.body.subarray(1));
      const ts = unixTs(info.u32(0));
      if (type === INFO_START && info.count >= 16) {
        // A repeated start record for the same activity (a page read twice) continues it.
        if (current?.startTs === ts) continue;
        current = new Draft(ts, info.u16(14), info.at(13));
        drafts.push(current);
      } else if (current) {
        if (type === INFO_PAUSE && info.count >= 9) {
          current.pauses.push({ ts, ms: Math.min(info.u32(5), 999) });
        } else if (type === INFO_RESUME) {
          current.resumes.push(ts);
        } else if (type === INFO_LAP) {
          const l = lap(info);
          if (l && !current.laps.some((x) => x.index === l.index)) current.laps.push(l);
        } else if (type === INFO_LAP_EXTENSION) {
          const ext = lapExtension(info);
          if (ext) current.lapExtensions.set(info.u16(0), ext);
        } else if (type === INFO_SCIENCE) {
          current.training = training(info) ?? current.training;
        } else if (type === INFO_SUMMARY) {
          current.summary = info.slice;
        } else if (type === INFO_PROTOBUF) {
          current.gear = gear(info) ?? current.gear;
        } else if (type === INFO_WORKOUT && !current.workoutPieces.has(info.at(0))) {
          current.workoutPieces.set(info.at(0), info.from(1));
        }
      }
    } else if (record.kind === KIND_SERIES && current) {
      try {
        const segment = series(record.body);
        if (segment) current.series.push(segment);
      } catch {
        skippedRecords += 1;
      }
    }
  }

  // Newest first, within the file's budget of activity time; a damaged stop is set aside without using it.
  const decodable = new Set<Draft>();
  let budget = MAX_FILE_SESSION_SECONDS;
  for (const draft of [...drafts].reverse()) {
    const stop = draft.stop;
    if (stop && draft.implausible(stop)) continue;
    const span = stop ? stop.ts - draft.startTs : 0;
    if (span > budget) break;
    budget -= span;
    decodable.add(draft);
  }
  const sessions: Session[] = [];
  let incomplete = 0, rejected = 0;
  let lastEnd = -Infinity;
  for (const draft of drafts) {
    // One activity at a time: one starting inside the previous one is damaged.
    if (!decodable.has(draft) || draft.startTs < lastEnd) { rejected += 1; continue; }
    let session: Session | null;
    try { session = build(draft); } catch { rejected += 1; continue; }
    if (!session) { incomplete += 1; continue; }
    lastEnd = session.endTs;
    if (visit) visit(session); else sessions.push(session);
  }
  return { sessions, incomplete, rejected, skippedRecords };
}
