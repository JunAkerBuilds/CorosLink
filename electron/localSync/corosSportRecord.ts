import { COROS_MOBILE_EPOCH } from "./activityProtocol";

/**
 * Decoder for the watch's sport-record file (SyncData file 14) as a PACE 4
 * (W336, V3.2008.0) writes it. Written for CorosLink from a description of
 * the format. It was checked against COROS's own decoding of a recorded
 * outdoor run: every heart-rate, GPS, distance, speed, cadence,
 * power and altitude sample, and the session and lap summaries, match.
 *
 * File layout:
 * - 4 KB pages. Each page starts with a block marker (record kind 0x1f whose
 *   body begins a5 5a), which also gives the length unit for the page.
 * - Records follow back to back. A header byte with bit 0 clear is a 1-byte
 *   header: kind = bits 1-3, length = bits 4-7. With bit 0 set the header is
 *   a u16: kind = bits 1-3 | bits 8-9 << 3, length = bits 4-7 | bits 10-15 << 4.
 *   Lengths are multiplied by the page unit, except for kinds 0x1e (padding)
 *   and 0x1f (marker).
 * - Kind 4 holds "sport info" records, dispatched on their first byte:
 *   0 start, 1 pause/stop, 2 resume, 4 lap, 5 session summary, 6 lap
 *   extension (power, running dynamics), 15 science summary (part 2 holds the
 *   watch's training analysis: load, training effect, focus, 7-day load).
 * - Kind 8 holds compressed sample series, one channel per record.
 *
 * Only what has been validated is decoded. Anything else is ignored, never
 * guessed. A file without a block marker is rejected so the raw payload stays
 * archived for a later decoder.
 */

export class CorosSportRecordFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorosSportRecordFormatError";
  }
}

const PAGE_BYTES = 4096;
/**
 * Longest activity accepted, start to stop. A damaged or shifted time stamp can
 * put a stop years after its start; the per-second samples of such a session
 * would not fit in memory, so it is set aside instead (the payload stays
 * archived for a later decoder).
 */
export const MAX_SESSION_SECONDS = 7 * 86_400;
/**
 * Most activity time decoded from one file (start to stop, summed). The file is
 * cumulative, so older activities were decoded by earlier syncs; past this,
 * the oldest are set aside. Bounds the time and memory a forged file can cost.
 */
export const MAX_FILE_SESSION_SECONDS = 1_000 * 3600;
/** Most records read from one file: real files hold tens of thousands; millions of tiny forged ones would exhaust memory. */
const MAX_RECORDS = 1_000_000;
/**
 * How far the timer-running windows may exceed the watch's own timer before
 * they are implausible: auto-pause may stop the timer without a pause record.
 */
const WINDOW_SLACK_SECONDS = 86_400;
const KIND_SPORT_INFO = 4;
const KIND_SERIES = 8;
const KIND_PADDING = 0x1e;
const KIND_MARKER = 0x1f;

const INFO_START = 0;
const INFO_PAUSE = 1;
const INFO_RESUME = 2;
const INFO_LAP = 4;
const INFO_SUMMARY = 5;
const INFO_LAP_EXTENSION = 6;
const INFO_SCIENCE = 0x0f;
const SCIENCE_TRAINING = 2;

/** Series channel types (record byte 1) and the group within a channel (u16 header >> 11). */
const CHANNEL = {
  stepCadence: 0x00,
  heartRate: 0x02,
  altitude: 0x05,
  speed: 0x06,
  distance: 0x07,
  power: 0x08,
  position: 0x28,
  positionWithTime: 0x2c,
  /** Step length, cm. */
  stepLength: 0x01,
  /** Grade-adjusted ("effort") speed, m/s × 360. */
  effortSpeed: 0x11,
  /** Running dynamics: group 1 ground contact (ms), 3 vertical oscillation (mm), 4 vertical ratio (% × 10). */
  dynamics: 0x26
} as const;

/** Device sport type (start record) → COROS sport type, as COROS maps it. */
const DEVICE_SPORT_TYPES: Readonly<Record<number, number>> = {
  0: 100, 1: 101, 2: 301, 3: 300, 4: 200, 5: 102, 6: 201, 7: 105, 8: 104, 9: 400, 10: 401, 11: 501, 12: 500, 13: 502,
  14: 103, 15: 600, 16: 402, 17: 700, 18: 701, 19: 702, 20: 704, 21: 705, 22: 706, 23: 503, 24: 106, 25: 708, 26: 900,
  27: 800, 28: 901, 29: 98, 30: 204, 31: 203, 32: 202, 33: 205, 34: 707, 35: 709, 36: 801, 37: 710, 38: 902, 39: 1000,
  40: 1001, 41: 1002, 42: 1003, 43: 1004, 44: 903, 45: 904, 46: 905, 47: 906, 48: 1100, 49: 1101, 50: 1005, 51: 711,
  52: 712, 53: 713, 54: 714, 55: 715, 56: 802, 57: 1006, 58: 1200
};

/** Run sports, where the step-cadence channel is steps per minute (reported per leg, like FIT). */
const RUN_SPORT_TYPES: ReadonlySet<number> = new Set([100, 101, 102, 103]);

// ----- Compressed series -----

/** LSB-first bit reader. Like the watch's reader, reads past the end or wider than 32 bits yield 0. */
class BitReader {
  private bit = 0;
  constructor(private readonly bytes: Uint8Array) {}

  read(width: number): number {
    if (width <= 0 || width > 32) return 0;
    let value = 0;
    for (let index = 0; index < width; index++) {
      const byte = this.bit >> 3;
      if (byte >= this.bytes.length) return 0;
      if ((this.bytes[byte]! >> (this.bit & 7)) & 1) value += 2 ** index;
      this.bit += 1;
    }
    return value;
  }
}

function zigzag(value: number, bits: number): number {
  const masked = bits === 32 ? value >>> 0 : value & ((1 << bits) - 1);
  return (masked & 1) ? -Math.floor(masked / 2) - 1 : Math.floor(masked / 2);
}

function wrap(value: number, bits: number): number {
  const range = 2 ** bits;
  return ((value % range) + range) % range;
}

/**
 * Delta-packed samples: u16 flags, u8 count, then a bitstream.
 * Flags: bits 0-1 sample size (1 << n bytes), bits 2-7 width - 1, bit 8 variable
 * width / base offset, bits 9-10 mode (0 constant step, 1 deltas, 2 deltas with
 * offset, 3 absolute values; absolute with width 64 and size bits means raw bytes).
 * Returns unsigned sample values of the stated size.
 */
export function decodeDeltaPack(packed: Uint8Array): number[] {
  if (packed.length < 3) throw new CorosSportRecordFormatError("Truncated series.");
  const flags = packed[0]! | (packed[1]! << 8);
  const count = packed[2]!;
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
      if (data.length < count * size) throw new CorosSportRecordFormatError("Truncated series.");
      const raw = Buffer.from(data.subarray(0, count * size));
      // readUIntLE stops at 6 bytes; 8-byte samples are read as 64-bit (above 2^53 they lose precision, never throw).
      return Array.from({ length: count }, (_, index) => size === 8 ? Number(raw.readBigUInt64LE(index * 8)) : raw.readUIntLE(index * size, size));
    }
    const base = variable ? reader.read(reader.read(6) + 1) : 0;
    return Array.from({ length: count }, () => wrap(reader.read(width) + base, bits));
  }

  const first = reader.read(reader.read(6) + 1);
  const offset = mode === 0 || mode === 2 ? reader.read(reader.read(6) + 1) : 0;
  let extraWidth = 0;
  if (variable) {
    const maxExtra = reader.read(reader.read(3) + 1);
    extraWidth = maxExtra === 0 ? 1 : Math.floor(Math.log2(maxExtra)) + 1;
  }
  const values = [wrap(first, bits)];
  let value = first;
  let delta = 0;
  for (let index = 1; index < count; index++) {
    if (mode !== 0) {
      let readWidth = width;
      if (variable && reader.read(1)) readWidth = (reader.read(extraWidth) + width) & 0xff;
      delta = reader.read(readWidth);
    }
    value += zigzag(delta + offset, bits);
    values.push(wrap(value, bits));
  }
  return values;
}

// ----- Record walk -----

export interface CorosRecord {
  offset: number;
  kind: number;
  body: Buffer;
}

function headerAt(file: Buffer, position: number): { kind: number; length: number; headerBytes: number } | undefined {
  const first = file[position]!;
  if ((first & 1) === 0) return { kind: (first & 0xf) >> 1, length: first >> 4, headerBytes: 1 };
  if (position + 2 > file.length) return undefined;
  const header = file.readUInt16LE(position);
  return { kind: ((header & 0xf) >> 1) | ((header >> 5) & 0x18), length: ((header >> 4) & 0xf) | ((header >> 6) & 0xfff0), headerBytes: 2 };
}

function isMarkerAt(file: Buffer, position: number): boolean {
  const header = position + 4 <= file.length ? headerAt(file, position) : undefined;
  return !!header && header.headerBytes === 2 && header.kind === KIND_MARKER && header.length >= 5 && header.length < 15 &&
    file[position + 2] === 0xa5 && file[position + 3] === 0x5a;
}

/** Every record after a block marker; scanning resumes at the next page when a record does not fit. */
export function walkCorosRecords(file: Buffer): CorosRecord[] {
  const records: CorosRecord[] = [];
  let position = 0;
  let unit = 0;
  let markers = 0;
  while (position < file.length) {
    if (unit === 0) {
      if (isMarkerAt(file, position)) unit = -1;
      else { position += 1; continue; }
    }
    const header = headerAt(file, position);
    if (!header) break;
    const length = header.kind === KIND_MARKER || header.kind === KIND_PADDING ? header.length : header.length * Math.max(unit, 0);
    const start = position + header.headerBytes;
    if (start + length > file.length) {
      unit = 0;
      position = Math.floor(position / PAGE_BYTES + 1) * PAGE_BYTES;
      continue;
    }
    const body = file.subarray(start, start + length);
    if (header.kind === KIND_MARKER) {
      if (body[0] !== 0xa5 || body[1] !== 0x5a || body.length < 5) { unit = 0; position += 1; continue; }
      unit = body[4]!;
      markers += 1;
    }
    if (length > 0) {
      if (records.length >= MAX_RECORDS) throw new CorosSportRecordFormatError("The file holds more records than a watch writes.");
      records.push({ offset: position, kind: header.kind, body });
    }
    position = start + length;
  }
  if (markers === 0) throw new CorosSportRecordFormatError("Not a COROS sport-record file.");
  return records;
}

// ----- Sessions -----

export interface CorosSeriesSegment {
  channel: number;
  group: number;
  /** Unix seconds of the first sample. */
  startTs: number;
  interval: number;
  values: number[];
}

interface LapDraft {
  index: number;
  endTs: number;
  timerCs: number;
  distanceCm: number;
  calories: number;
  bestPace: number;
  avgHr: number;
  maxHr: number;
  ascent: number;
  descent: number;
  stepCadence: number;
  minHr: number;
  temperature: number;
  stepLengthCm: number;
}

/** Lap extension (sport info 6): power and running-dynamics averages. */
interface LapExtension {
  avgPower: number;
  maxPower: number;
  verticalRatioX10: number;
  groundTimeMs: number;
  /** Vertical oscillation in 1/16 mm. */
  verticalOscillation16: number;
}

/** The watch's own analysis of the workout (science summary, part 2). Loads are COROS training-load points. */
export interface CorosTraining {
  trainingLoad: number;
  aerobicLoad: number;
  anaerobicLoad: number;
  lowLoad: number;
  midLoad: number;
  highLoad: number;
  /** Training effect × 10 (the COROS app shows one decimal, 0–5.9). */
  aerobicEffect: number;
  anaerobicEffect: number;
  /** 1 Easy, 2 Base, 3 Tempo, 4 Threshold, 5 VO2 Max, 6 Anaerobic; 0 when not given. */
  focus: number;
  /** As the watch reported it; not shown. */
  performance: number;
  /**
   * Seconds from the end of the activity until the watch counts you as fully
   * recovered. The watch stores whole hours × 3600, and its recovery countdown
   * runs from the activity's finish time and caps what is left at 120 h.
   */
  recovery: number;
  sevenDayLoad: number;
  recommendedLoadMin: number;
  recommendedLoadMax: number;
  /**
   * The watch's current VO₂ max (ml/kg/min) once this activity was taken into
   * account: the watch copies it from its VO₂ max log right after updating
   * the log. A ride carries the watch's separate cycling figure
   * (vo2max_input in COROS's naming). Left out
   * while the watch has none (0).
   */
  vo2max?: number;
  /** Training-load points; left out, with the two below, until the watch has a Base Fitness. */
  baseFitness?: number;
  loadImpact?: number;
  /** Load Impact as a percentage of Base Fitness. */
  fatigue?: number;
}

/** Running dynamics averages, as the COROS app reports them. */
export interface CorosDynamics {
  groundTimeMs?: number;
  verticalOscillationMm?: number;
  /** Percent. */
  verticalRatio?: number;
  stepLengthMm?: number;
}

export interface CorosLap {
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
  avgCadence?: number;
  /** Steps per minute as the watch recorded them (avgCadence is per leg, like FIT). */
  avgStepCadence?: number;
  avgPower?: number;
  maxPower?: number;
  minHr?: number;
  avgTemperature?: number;
  ascentM: number;
  descentM: number;
  dynamics: CorosDynamics;
}

export interface CorosSample {
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

export interface CorosSession {
  /** Stable per activity: device start time and sport. */
  watchActivityId: string;
  sportType: number;
  deviceSportType: number;
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
  /** Steps per minute as the watch recorded them (avgCadence/maxCadence are per leg, like FIT). */
  avgStepCadence?: number;
  maxStepCadence?: number;
  minHr?: number;
  avgTemperature?: number;
  /** Strides (steps ÷ 2), as COROS exports total cycles for runs. */
  totalStrides?: number;
  ascentM: number;
  descentM: number;
  dynamics: CorosDynamics;
  training?: CorosTraining;
  /** Timer-running periods, inclusive Unix seconds. */
  activeWindows: Array<[number, number]>;
  laps: CorosLap[];
  samples: CorosSample[];
}

export interface CorosSportRecordFile {
  sessions: CorosSession[];
  /** Sessions skipped because they were still being recorded or had no summary. */
  incomplete: number;
  /** Sessions set aside because their times are implausible (damaged or shifted time stamps) or could not be built. */
  rejected: number;
  /** Damaged sample-series records that were skipped; the rest of their activity is kept. */
  skippedRecords: number;
}

interface SessionDraft {
  startTs: number;
  startMs: number;
  deviceSportType: number;
  pauses: Array<{ ts: number; ms: number }>;
  resumes: number[];
  laps: LapDraft[];
  lapExtensions: Map<number, LapExtension>;
  training?: CorosTraining;
  summary?: Buffer;
  series: CorosSeriesSegment[];
}

const unixTs = (deviceSeconds: number) => deviceSeconds + COROS_MOBILE_EPOCH;
const optional = (value: number) => (value > 0 ? value : undefined);

function decodeSeriesRecord(body: Buffer): CorosSeriesSegment | undefined {
  if (body.length < 10) return undefined;
  let sum = 0;
  for (let index = 1; index < body.length; index++) sum = (sum + body[index]!) & 0xff;
  if (sum !== body[0]) return undefined;
  const packed = body.subarray(7);
  return {
    channel: body[1]!,
    group: packed.readUInt16LE(0) >> 11,
    startTs: unixTs(body.readUInt32LE(3)),
    interval: body[2]!,
    values: decodeDeltaPack(packed)
  };
}

function readLap(info: Buffer): LapDraft | undefined {
  if (info.length < 38) return undefined;
  return {
    endTs: unixTs(info.readUInt32LE(0)),
    index: info.readUInt16LE(4),
    timerCs: info.readUInt32LE(6),
    distanceCm: info.readUInt32LE(10),
    calories: info.readUInt32LE(18),
    bestPace: info.readUInt16LE(24),
    avgHr: info[26]!,
    maxHr: info[27]!,
    ascent: info.readUInt16LE(31),
    descent: info.readUInt16LE(33),
    stepCadence: info[35]!,
    minHr: info[28]!,
    temperature: info.readInt8(29),
    stepLengthCm: info[37]!
  };
}

function readLapExtension(info: Buffer): LapExtension | undefined {
  if (info.length < 14) return undefined;
  return {
    avgPower: info.readUInt16LE(2),
    maxPower: info.readUInt16LE(4),
    verticalRatioX10: info.readUInt16LE(8),
    groundTimeMs: info.readUInt16LE(10),
    verticalOscillation16: info.readUInt16LE(12)
  };
}

/** Science summary part 2 (`info` starts at the part byte). Offsets confirmed against COROS's decoding. */
function readTraining(info: Buffer): CorosTraining | undefined {
  if (info.length < 0x2d || info[0] !== SCIENCE_TRAINING) return undefined;
  const u16 = (offset: number) => info.readUInt16LE(offset);
  return {
    aerobicLoad: u16(1),
    anaerobicLoad: u16(3),
    lowLoad: u16(5),
    midLoad: u16(7),
    highLoad: u16(9),
    trainingLoad: u16(5) + u16(7) + u16(9),
    focus: info[0xb]!,
    aerobicEffect: info[0xc]!,
    anaerobicEffect: info[0xd]!,
    performance: info[0xe]!,
    recovery: info.readUInt32LE(0x13),
    sevenDayLoad: u16(0x17),
    recommendedLoadMin: u16(0x1e),
    recommendedLoadMax: u16(0x20),
    ...(info[0x27] ? { vo2max: info[0x27] } : {}),
    ...readFitnessBalance(info)
  };
}

/**
 * Base Fitness (u16 @0x19) and Load Impact (u16 @0x1b), rounded training-load
 * points as of the activity's day, the same values the watch's Base Fitness /
 * Load Impact screen prints with %d, and fatigue (s16 @0x2d) =
 * round(Load Impact × 100 ÷ Base Fitness), a percentage. Byte 0x1d is never written. Until the watch has
 * a Base Fitness (0), none of the three means anything, so all are left out.
 */
function readFitnessBalance(info: Buffer): Pick<CorosTraining, "baseFitness" | "loadImpact" | "fatigue"> {
  if (info.length < 0x2f) return {};
  const baseFitness = info.readUInt16LE(0x19);
  if (baseFitness === 0) return {};
  return { baseFitness, loadImpact: info.readUInt16LE(0x1b), fatigue: info.readInt16LE(0x2d) };
}

/** Running-dynamics average the way COROS reports it: the floored mean of the samples that have a value. */
function averageOfPresent(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined && value > 0);
  return present.length ? Math.floor(present.reduce((sum, value) => sum + value, 0) / present.length) : undefined;
}

/** Sample value at `ts` from series segments; between samples, distance and speed interpolate linearly, others take the floored mean. */
function seriesLookup(segments: CorosSeriesSegment[], linear: boolean): (ts: number) => number | undefined {
  const points = new Map<number, number>();
  for (const segment of segments) {
    segment.values.forEach((value, index) => points.set(segment.startTs + index * Math.max(segment.interval, 1), value));
  }
  const stamps = [...points.keys()].sort((a, b) => a - b);
  return (ts) => {
    const exact = points.get(ts);
    if (exact !== undefined) return exact;
    let low = 0;
    let high = stamps.length - 1;
    if (high < 0 || ts < stamps[0]! || ts > stamps[high]!) return undefined;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (stamps[middle]! <= ts) low = middle; else high = middle;
    }
    const before = stamps[low]!;
    const after = stamps[high]!;
    if (after - before > 8) return undefined;
    const a = points.get(before)!;
    const b = points.get(after)!;
    return linear ? a + ((b - a) * (ts - before)) / (after - before) : Math.floor((a + b) / 2);
  };
}

function toSigned32(value: number): number {
  return value >= 0x8000_0000 ? value - 0x1_0000_0000 : value;
}

class ImplausibleSessionError extends Error {}

/** The stop record: the last pause, when no resume followed it. */
const stopOf = (draft: SessionDraft) => draft.pauses.length > draft.resumes.length ? draft.pauses[draft.pauses.length - 1] : undefined;
/** A stop before the start, or days after it, is a damaged or shifted time stamp, not an activity. */
const implausibleStop = (draft: SessionDraft, stop: { ts: number }) => stop.ts < draft.startTs || stop.ts - draft.startTs > MAX_SESSION_SECONDS;

function buildSession(draft: SessionDraft): CorosSession | undefined {
  const summary = draft.summary;
  const stop = stopOf(draft);
  if (!summary || summary.length < 47 || !stop) return undefined;
  if (implausibleStop(draft, stop)) throw new ImplausibleSessionError();
  const sportType = DEVICE_SPORT_TYPES[draft.deviceSportType] ?? 98;
  const isRun = RUN_SPORT_TYPES.has(sportType);
  const timerSec = summary.readUInt32LE(4) / 100;
  const distanceM = summary.readUInt32LE(0) / 100;
  const bestPace = summary.readUInt16LE(16);
  const altitudeOffset = summary.readInt16LE(30);

  // Timer windows: start → pause, resume (+1 s: the watch reports whole seconds and resumes within that second) → next pause.
  const activeWindows: Array<[number, number]> = [];
  let openAt: number | undefined = draft.startTs;
  for (let index = 0; index < draft.pauses.length; index++) {
    const pause = draft.pauses[index]!;
    if (openAt !== undefined && pause.ts >= openAt) activeWindows.push([openAt, pause.ts]);
    const resume = draft.resumes[index];
    openAt = resume === undefined ? undefined : resume + 1;
  }
  // One sample is made per running second, so the windows bound the work; they must agree with the watch's timer.
  const activeSeconds = activeWindows.reduce((total, [from, to]) => total + (to - from + 1), 0);
  if (activeSeconds > Math.min(MAX_SESSION_SECONDS, Math.max(timerSec * 4, timerSec + WINDOW_SLACK_SECONDS))) throw new ImplausibleSessionError();

  const byChannel = (channel: number, group: number) => draft.series.filter((segment) => segment.channel === channel && segment.group === group);
  const hr = seriesLookup(byChannel(CHANNEL.heartRate, 0), false);
  const distance = seriesLookup(byChannel(CHANNEL.distance, 0), true);
  const speed = seriesLookup(byChannel(CHANNEL.speed, 0), true);
  const cadence = seriesLookup(byChannel(CHANNEL.stepCadence, 0), false);
  const power = seriesLookup(byChannel(CHANNEL.power, 0), false);
  const altitude = seriesLookup(byChannel(CHANNEL.altitude, 0), false);
  const stepLength = seriesLookup(byChannel(CHANNEL.stepLength, 0), false);
  const effortSpeed = seriesLookup(byChannel(CHANNEL.effortSpeed, 0), true);
  const groundTime = seriesLookup(byChannel(CHANNEL.dynamics, 1), false);
  const oscillation = seriesLookup(byChannel(CHANNEL.dynamics, 3), false);
  const ratio = seriesLookup(byChannel(CHANNEL.dynamics, 4), false);
  // Averages over every recorded sample (not the per-second fill).
  const recorded = (channel: number, group: number) => byChannel(channel, group).flatMap((segment) => segment.values);
  const positions = new Map<number, { lat: number; lon: number }>();
  for (const channel of [CHANNEL.position, CHANNEL.positionWithTime]) {
    const lon = byChannel(channel, 0);
    const lat = byChannel(channel, 1);
    const times = channel === CHANNEL.positionWithTime ? byChannel(channel, 2) : [];
    lon.forEach((lonSegment, segmentIndex) => {
      const latSegment = lat[segmentIndex];
      if (!latSegment || latSegment.values.length !== lonSegment.values.length) return;
      const timeSegment = times[segmentIndex];
      if (channel === CHANNEL.positionWithTime && timeSegment?.values.length !== lonSegment.values.length) return;
      lonSegment.values.forEach((lonValue, index) => {
        const ts = timeSegment ? unixTs(timeSegment.values[index]!) : lonSegment.startTs + index * Math.max(lonSegment.interval, 1);
        const latDeg = toSigned32(latSegment.values[index]!) / 1e7;
        const lonDeg = toSigned32(lonValue) / 1e7;
        if (Math.abs(latDeg) <= 90 && Math.abs(lonDeg) <= 180 && (latDeg !== 0 || lonDeg !== 0)) positions.set(ts, { lat: latDeg, lon: lonDeg });
      });
    });
  }

  const samples: CorosSample[] = [];
  for (const [from, to] of activeWindows) {
    for (let ts = from; ts <= to; ts++) {
      const sample: CorosSample = { ts };
      const position = positions.get(ts);
      if (position) Object.assign(sample, position);
      const values = {
        hr: hr(ts),
        dist: distance(ts),
        speed: speed(ts),
        cadence: isRun ? cadence(ts) : undefined,
        power: power(ts),
        alt: altitude(ts)
      };
      if (values.hr !== undefined && values.hr > 0) sample.hr = values.hr;
      if (values.dist !== undefined) sample.dist = values.dist;
      if (values.speed !== undefined) sample.speed = values.speed / 360;
      if (values.cadence !== undefined) sample.cadence = Math.floor(values.cadence / 2);
      if (values.power !== undefined) sample.power = values.power;
      if (values.alt !== undefined) sample.alt = values.alt + altitudeOffset;
      const dynamics = { stepLength: stepLength(ts), groundTime: groundTime(ts), verticalOscillation: oscillation(ts), verticalRatio: ratio(ts), effortSpeed: effortSpeed(ts) };
      if (dynamics.stepLength) sample.stepLength = dynamics.stepLength * 10;
      if (dynamics.groundTime) sample.groundTime = dynamics.groundTime;
      if (dynamics.verticalOscillation) sample.verticalOscillation = dynamics.verticalOscillation;
      if (dynamics.verticalRatio) sample.verticalRatio = dynamics.verticalRatio / 10;
      if (dynamics.effortSpeed !== undefined) sample.effortSpeed = dynamics.effortSpeed / 360;
      samples.push(sample);
    }
  }

  const sessionStartExact = draft.startTs + draft.startMs / 1000;
  const sessionEndExact = stop.ts + stop.ms / 1000;
  const laps: CorosLap[] = [];
  let lapStart = draft.startTs;
  const sortedLaps = [...draft.laps].sort((a, b) => a.index - b.index);
  sortedLaps.forEach((lap, position) => {
    const last = position === sortedLaps.length - 1;
    const lapTimer = lap.timerCs / 100;
    const extension = draft.lapExtensions.get(lap.index);
    laps.push({
      index: lap.index,
      startTs: lapStart,
      elapsedSec: last ? Math.round((sessionEndExact - (position === 0 ? sessionStartExact : lapStart)) * 100) / 100 : lap.endTs - lapStart,
      timerSec: lapTimer,
      distanceM: lap.distanceCm / 100,
      calories: Math.round(lap.calories / 1000),
      avgSpeed: lapTimer > 0 ? lap.distanceCm / 100 / lapTimer : undefined,
      maxSpeed: lap.bestPace > 0 ? 1000 / lap.bestPace : undefined,
      avgHr: optional(lap.avgHr),
      maxHr: optional(lap.maxHr),
      avgCadence: isRun ? optional(Math.floor(lap.stepCadence / 2)) : undefined,
      avgStepCadence: isRun ? optional(lap.stepCadence) : undefined,
      avgPower: extension?.avgPower,
      maxPower: optional(extension?.maxPower ?? 0),
      minHr: optional(lap.minHr),
      avgTemperature: lap.temperature !== 0 ? lap.temperature : undefined,
      ascentM: lap.ascent,
      descentM: lap.descent,
      dynamics: {
        groundTimeMs: optional(extension?.groundTimeMs ?? 0),
        verticalOscillationMm: optional(Math.floor((extension?.verticalOscillation16 ?? 0) / 16)),
        verticalRatio: optional(extension?.verticalRatioX10 ?? 0) === undefined ? undefined : extension!.verticalRatioX10 / 10,
        stepLengthMm: optional(lap.stepLengthCm * 10)
      }
    });
    lapStart = lap.endTs;
  });

  return {
    watchActivityId: `coros-${draft.startTs}-${draft.deviceSportType}`,
    sportType,
    deviceSportType: draft.deviceSportType,
    startTs: draft.startTs,
    endTs: stop.ts,
    elapsedSec: Math.round((sessionEndExact - sessionStartExact) * 100) / 100,
    timerSec,
    distanceM,
    calories: Math.round(summary.readUInt32LE(10) / 1000),
    avgSpeed: timerSec > 0 ? distanceM / timerSec : undefined,
    maxSpeed: bestPace > 0 ? 1000 / bestPace : undefined,
    avgHr: optional(summary[22]!),
    maxHr: optional(summary[23]!),
    avgCadence: isRun ? optional(Math.floor(summary[36]! / 2)) : undefined,
    maxCadence: isRun ? optional(Math.floor(summary[37]! / 2)) : undefined,
    avgStepCadence: isRun ? optional(summary[36]!) : undefined,
    maxStepCadence: isRun ? optional(summary[37]!) : undefined,
    avgPower: optional(summary.readUInt16LE(45)),
    minHr: optional(summary[24]!),
    avgTemperature: summary.readInt8(25) !== 0 ? summary.readInt8(25) : undefined,
    totalStrides: optional(Math.floor(summary.readUInt16LE(39) / 2)),
    ascentM: summary.readUInt16LE(26),
    descentM: summary.readUInt16LE(28),
    dynamics: {
      groundTimeMs: averageOfPresent(recorded(CHANNEL.dynamics, 1)),
      verticalOscillationMm: averageOfPresent(recorded(CHANNEL.dynamics, 3)),
      verticalRatio: (() => { const value = averageOfPresent(recorded(CHANNEL.dynamics, 4)); return value === undefined ? undefined : value / 10; })(),
      stepLengthMm: optional(summary[43]! * 10)
    },
    ...(draft.training ? { training: draft.training } : {}),
    activeWindows,
    laps,
    samples
  };
}

/**
 * Decodes every finished activity in a sport-record file. Throws
 * CorosSportRecordFormatError when the file is not one. A damaged record or
 * activity is skipped and counted; it never hides the others.
 *
 * With `visit`, each activity is handed over as soon as it is built and not
 * kept (`sessions` stays empty), so only one activity's samples are in memory
 * at a time.
 */
export function decodeCorosSportRecordFile(file: Buffer, visit?: (session: CorosSession) => void): CorosSportRecordFile {
  const records = walkCorosRecords(file);
  const drafts: SessionDraft[] = [];
  let current: SessionDraft | undefined;
  let skippedRecords = 0;
  for (const record of records) {
    if (record.kind === KIND_SPORT_INFO && record.body.length >= 5) {
      const type = record.body[0]!;
      const info = record.body.subarray(1);
      const ts = unixTs(info.readUInt32LE(0));
      if (type === INFO_START && info.length >= 16) {
        // A repeated start record for the same activity (a page read twice) continues it.
        if (current?.startTs === ts) continue;
        current = { startTs: ts, startMs: info.readUInt16LE(14), deviceSportType: info[13]!, pauses: [], resumes: [], laps: [], lapExtensions: new Map(), series: [] };
        drafts.push(current);
      } else if (!current) {
        continue;
      } else if (type === INFO_PAUSE && info.length >= 9) {
        current.pauses.push({ ts, ms: Math.min(info.readUInt32LE(5), 999) });
      } else if (type === INFO_RESUME) {
        current.resumes.push(ts);
      } else if (type === INFO_LAP) {
        const lap = readLap(info);
        if (lap && !current.laps.some((existing) => existing.index === lap.index)) current.laps.push(lap);
      } else if (type === INFO_LAP_EXTENSION) {
        const extension = readLapExtension(info);
        if (extension) current.lapExtensions.set(info.readUInt16LE(0), extension);
      } else if (type === INFO_SCIENCE) {
        current.training = readTraining(info) ?? current.training;
      } else if (type === INFO_SUMMARY) {
        current.summary = info;
      }
    } else if (record.kind === KIND_SERIES && current) {
      let segment: CorosSeriesSegment | undefined;
      try {
        segment = decodeSeriesRecord(record.body);
      } catch {
        skippedRecords += 1;
        continue;
      }
      if (segment) current.series.push(segment);
    }
  }
  const sessions: CorosSession[] = [];
  let incomplete = 0;
  let rejected = 0;
  // Newest first, within the file's budget of activity time; older ones were decoded by earlier syncs.
  // A damaged stop time is set aside without using the budget, so it can't hide the activities before it.
  const decodable = new Set<SessionDraft>();
  let budget = MAX_FILE_SESSION_SECONDS;
  for (const draft of [...drafts].reverse()) {
    const stop = stopOf(draft);
    if (stop && implausibleStop(draft, stop)) continue;
    const span = stop ? stop.ts - draft.startTs : 0;
    if (span > budget) break;
    budget -= span;
    decodable.add(draft);
  }
  let lastEnd = -Infinity;
  for (const draft of drafts) {
    // One activity at a time: one starting inside the previous one is a damaged or forged record.
    if (!decodable.has(draft) || draft.startTs < lastEnd) {
      rejected += 1;
      continue;
    }
    let session: CorosSession | undefined;
    try {
      session = buildSession(draft);
    } catch {
      rejected += 1;
      continue;
    }
    if (!session) incomplete += 1;
    else {
      lastEnd = session.endTs;
      if (visit) visit(session);
      else sessions.push(session);
    }
  }
  return { sessions, incomplete, rejected, skippedRecords };
}
