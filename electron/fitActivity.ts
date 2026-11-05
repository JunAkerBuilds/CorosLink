import {
  decodeFit,
  fitTimestampToUnixSeconds,
  semicirclesToDegrees,
  FIT_MSG,
  type FitMessage
} from "./fitDecoder";

/** One record sample, already scaled to SI units. */
export interface FitRecord {
  /** Unix seconds. */
  ts: number;
  /** Moving (timer) seconds since the session start, pauses removed. */
  t: number;
  lat?: number;
  lon?: number;
  /** Metres. */
  alt?: number;
  /** Cumulative metres. */
  dist?: number;
  /** m/s. */
  speed?: number;
  hr?: number;
  /** rpm (bike) or spm (run, per leg as the watch records it). */
  cadence?: number;
  /** Watts. */
  power?: number;
  /** °C. */
  temp?: number;
  /** Running dynamics: step length (mm), ground contact (ms), vertical oscillation (mm), vertical ratio (%). */
  stepLength?: number;
  groundTime?: number;
  verticalOscillation?: number;
  verticalRatio?: number;
  /** Grade-adjusted speed, m/s (COROS developer field "Effort Pace"). */
  effortSpeed?: number;
}

/** Running-dynamics averages: mm, ms, mm, %. */
export interface FitDynamics {
  stepLengthMm?: number;
  groundTimeMs?: number;
  verticalOscillationMm?: number;
  verticalRatio?: number;
}

/** The watch's training analysis (developer fields CorosLink writes, plus the standard training effect). */
export interface FitTraining {
  trainingLoad?: number;
  aerobicLoad?: number;
  anaerobicLoad?: number;
  aerobicEffect?: number;
  anaerobicEffect?: number;
  focus?: number;
  sevenDayLoad?: number;
  recommendedLoadMin?: number;
  recommendedLoadMax?: number;
  /** The watch's VO₂ max, ml/kg/min. */
  vo2max?: number;
  /** Seconds from the end of the activity until fully recovered, as the watch worked it out. */
  recovery?: number;
  /** The watch's Base Fitness and Load Impact (training-load points) and fatigue (%). */
  baseFitness?: number;
  loadImpact?: number;
  fatigue?: number;
}

/** A swim lap's strokes. */
export interface FitSwimLap {
  /** A rest: no lengths swum. */
  rest: boolean;
  /** FIT swim_stroke (0 freestyle, 1 backstroke, 2 breaststroke, 3 butterfly, 4 drill, 5 mixed, 6 IM). */
  stroke?: number;
  strokes?: number;
  swolf?: number;
  /** Pool swims: the lap's range of `FitActivity.lengths`. */
  firstLength?: number;
  lengths?: number;
  activeLengths?: number;
}

/** One pool length; an idle one is a rest. */
export interface FitLength {
  startTs: number;
  endTs: number;
  elapsedSec?: number;
  timerSec?: number;
  active: boolean;
  strokes?: number;
  /** m/s. */
  avgSpeed?: number;
  stroke?: number;
  /** Strokes per minute. */
  strokeRate?: number;
  calories?: number;
  swolf?: number;
  avgHr?: number;
  maxHr?: number;
}

/** A swim's totals. */
export interface FitSwimSummary {
  poolLengthM?: number;
  /** The pool's own unit (FIT pool_length_unit). */
  poolLengthUnit?: "m" | "yd";
  lengths?: number;
  activeLengths?: number;
  strokes?: number;
  avgSwolf?: number;
  bestSwolf?: number;
}

export interface FitLap {
  index: number;
  startTs: number;
  elapsedSec?: number;
  timerSec?: number;
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgPower?: number;
  maxPower?: number;
  avgCadence?: number;
  ascentM?: number;
  descentM?: number;
  calories?: number;
  minHr?: number;
  avgTemperature?: number;
  dynamics?: FitDynamics;
  swim?: FitSwimLap;
}

export interface FitSession {
  startTs: number;
  /** FIT sport enum (1 running, 2 cycling, 5 swimming, 11 walking, 17 hiking …). */
  sport?: number;
  subSport?: number;
  elapsedSec?: number;
  timerSec?: number;
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  avgCadence?: number;
  maxCadence?: number;
  ascentM?: number;
  descentM?: number;
  calories?: number;
  trainingStressScore?: number;
  minHr?: number;
  avgTemperature?: number;
  totalStrides?: number;
  dynamics?: FitDynamics;
  training?: FitTraining;
  swimTotals?: FitSwimSummary;
}

export interface FitActivity {
  session: FitSession | null;
  laps: FitLap[];
  /** Pool swims. */
  lengths: FitLength[];
  records: FitRecord[];
  /** Timer start/stop windows in unix seconds, derived from event messages. */
  activeWindows: Array<[number, number]>;
  fileCreatedTs?: number;
  manufacturer?: number;
  product?: number;
}

function num(message: FitMessage, field: number): number | undefined {
  const value = message.fields.get(field);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function scaled(
  value: number | undefined,
  scale: number,
  offset = 0
): number | undefined {
  return value === undefined ? undefined : value / scale - offset;
}

/** Cadence plus FIT's fractional part (1/128). */
function withFraction(whole: number | undefined, fraction: number | undefined): number | undefined {
  return whole === undefined ? undefined : whole + (fraction ?? 0) / 128;
}

function developerNumber(message: FitMessage, name: string): number | undefined {
  const value = message.developerFields?.get(name);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Dynamics averages from session fields (89/91/132/134) or lap fields (77/79/118/120). */
function dynamicsOf(message: FitMessage, fields: { vo: number; gct: number; vr: number; step: number }): FitDynamics | undefined {
  const dynamics: FitDynamics = {
    verticalOscillationMm: scaled(num(message, fields.vo), 10),
    groundTimeMs: scaled(num(message, fields.gct), 10),
    verticalRatio: scaled(num(message, fields.vr), 100),
    stepLengthMm: scaled(num(message, fields.step), 10)
  };
  return Object.values(dynamics).some((value) => value !== undefined) ? dynamics : undefined;
}

function trainingOf(message: FitMessage): FitTraining | undefined {
  const training: FitTraining = {
    trainingLoad: developerNumber(message, "Training Load"),
    aerobicLoad: developerNumber(message, "Aerobic Training Load"),
    anaerobicLoad: developerNumber(message, "Anaerobic Training Load"),
    aerobicEffect: scaled(num(message, 24), 10),
    anaerobicEffect: scaled(num(message, 137), 10),
    focus: developerNumber(message, "Training Focus"),
    sevenDayLoad: developerNumber(message, "7-Day Training Load"),
    recommendedLoadMin: developerNumber(message, "Recommended Load Min"),
    recommendedLoadMax: developerNumber(message, "Recommended Load Max")
  };
  const vo2max = developerNumber(message, "VO2 Max");
  if (vo2max !== undefined && vo2max > 0) training.vo2max = vo2max;
  const recovery = developerNumber(message, "Recovery Time");
  if (recovery !== undefined) training.recovery = recovery;
  const baseFitness = developerNumber(message, "Base Fitness");
  if (baseFitness !== undefined && baseFitness > 0) {
    training.baseFitness = baseFitness;
    const loadImpact = developerNumber(message, "Load Impact");
    const fatigue = developerNumber(message, "Fatigue");
    if (loadImpact !== undefined) training.loadImpact = loadImpact;
    if (fatigue !== undefined) training.fatigue = fatigue;
  }
  return Object.values(training).some((value) => value !== undefined) ? training : undefined;
}

function unixTs(message: FitMessage, field: number): number | undefined {
  const raw = num(message, field);
  return raw === undefined ? undefined : fitTimestampToUnixSeconds(raw);
}

/**
 * Prefer the enhanced (32-bit) field when present; the 16-bit speed/altitude
 * fields saturate on fast descents and above ~6.5 km altitude.
 */
function pickSpeed(message: FitMessage, enhanced: number, basic: number) {
  return scaled(num(message, enhanced) ?? num(message, basic), 1000);
}

function pickAltitude(message: FitMessage, enhanced: number, basic: number) {
  return scaled(num(message, enhanced) ?? num(message, basic), 5, 500);
}

const FIT_SPORT_SWIMMING = 5;
const INTENSITY_REST = 1;
const LENGTH_ACTIVE = 1;

/** Present values only; undefined when there are none. */
function defined<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) as T : undefined;
}

/** Session swim fields: total_cycles (strokes), num_lengths, pool_length and its unit, num_active_lengths, avg_swolf, and CorosLink's best SWOLF. */
function swimSummaryOf(message: FitMessage): FitSwimSummary | undefined {
  const unit = num(message, 46);
  return defined({
    poolLengthM: scaled(num(message, 44), 100),
    poolLengthUnit: unit === 0 ? "m" as const : unit === 1 ? "yd" as const : undefined,
    lengths: num(message, 33),
    activeLengths: num(message, 47),
    strokes: num(message, 10),
    avgSwolf: num(message, 80),
    bestSwolf: developerNumber(message, "Best SWOLF")
  });
}

function parseSession(message: FitMessage): FitSession | null {
  const startTs = unixTs(message, 2) ?? unixTs(message, 253);
  if (startTs === undefined) return null;
  const swim = num(message, 5) === FIT_SPORT_SWIMMING;
  return {
    startTs,
    sport: num(message, 5),
    subSport: num(message, 6),
    elapsedSec: scaled(num(message, 7), 1000),
    timerSec: scaled(num(message, 8), 1000),
    distanceM: scaled(num(message, 9), 100),
    calories: num(message, 11),
    avgSpeed: pickSpeed(message, 124, 14),
    maxSpeed: pickSpeed(message, 125, 15),
    avgHr: num(message, 16),
    maxHr: num(message, 17),
    avgCadence: withFraction(num(message, 18), num(message, 92)),
    maxCadence: withFraction(num(message, 19), num(message, 93)),
    avgPower: num(message, 20),
    maxPower: num(message, 21),
    ascentM: num(message, 22),
    descentM: num(message, 23),
    normalizedPower: num(message, 34),
    trainingStressScore: scaled(num(message, 35), 10),
    minHr: num(message, 64),
    avgTemperature: num(message, 57),
    // A swim's cycles are strokes.
    totalStrides: swim ? undefined : num(message, 10),
    dynamics: dynamicsOf(message, { vo: 89, gct: 91, vr: 132, step: 134 }),
    training: trainingOf(message),
    swimTotals: swim ? swimSummaryOf(message) : undefined
  };
}

/** Lap swim fields, when the lap has any: strokes, stroke, lengths, intensity (rest). */
function swimLapOf(message: FitMessage): FitSwimLap | undefined {
  const fields = defined({
    stroke: num(message, 38),
    strokes: num(message, 10),
    swolf: num(message, 73),
    firstLength: num(message, 35),
    lengths: num(message, 32),
    activeLengths: num(message, 40)
  });
  const rest = num(message, 23) === INTENSITY_REST;
  if (!fields && !rest) return undefined;
  return { rest: rest || (fields?.activeLengths === 0 && !(num(message, 9) ?? 0)), ...fields };
}

/** Lap and session SWOLF a file leaves out: the mean of their lengths', as the watch averages them. */
function fillSwolf(session: FitSession, laps: FitLap[], lengths: FitLength[]): void {
  const mean = (from: FitLength[]) => {
    const values = from.filter((length) => length.active && length.swolf !== undefined).map((length) => length.swolf!);
    return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : undefined;
  };
  for (const lap of laps) {
    const swim = lap.swim;
    if (!swim || swim.swolf !== undefined || swim.firstLength === undefined || !swim.lengths) continue;
    const swolf = mean(lengths.slice(swim.firstLength, swim.firstLength + swim.lengths));
    if (swolf !== undefined) swim.swolf = swolf;
  }
  if (session.swimTotals && session.swimTotals.avgSwolf === undefined) {
    const swolf = mean(lengths);
    if (swolf !== undefined) session.swimTotals.avgSwolf = swolf;
  }
}

function parseLength(message: FitMessage): FitLength | null {
  const endTs = unixTs(message, 253);
  const startTs = unixTs(message, 2) ?? endTs;
  if (startTs === undefined || endTs === undefined) return null;
  const active = num(message, 12) === LENGTH_ACTIVE;
  return {
    startTs,
    endTs,
    elapsedSec: scaled(num(message, 3), 1000),
    timerSec: scaled(num(message, 4), 1000),
    active,
    ...defined({
      strokes: active ? num(message, 5) : undefined,
      avgSpeed: active ? scaled(num(message, 6), 1000) : undefined,
      stroke: active ? num(message, 7) : undefined,
      strokeRate: active ? num(message, 9) : undefined,
      calories: num(message, 11),
      // SWOLF is a length's seconds plus its strokes; files without CorosLink's field get it worked out.
      swolf: developerNumber(message, "SWOLF") ?? (active && num(message, 5) !== undefined && num(message, 4) !== undefined
        ? Math.round(num(message, 4)! / 1000 + num(message, 5)!) : undefined),
      avgHr: developerNumber(message, "Avg Heart Rate"),
      maxHr: developerNumber(message, "Max Heart Rate")
    })
  };
}

function parseLap(message: FitMessage, index: number): FitLap | null {
  const startTs = unixTs(message, 2) ?? unixTs(message, 253);
  if (startTs === undefined) return null;
  return {
    index,
    startTs,
    elapsedSec: scaled(num(message, 7), 1000),
    timerSec: scaled(num(message, 8), 1000),
    distanceM: scaled(num(message, 9), 100),
    calories: num(message, 11),
    avgSpeed: pickSpeed(message, 110, 13),
    maxSpeed: pickSpeed(message, 111, 14),
    avgHr: num(message, 15),
    maxHr: num(message, 16),
    avgCadence: withFraction(num(message, 17), num(message, 80)),
    avgPower: num(message, 19),
    maxPower: num(message, 20),
    ascentM: num(message, 21),
    descentM: num(message, 22),
    minHr: num(message, 63),
    avgTemperature: num(message, 50),
    dynamics: dynamicsOf(message, { vo: 77, gct: 79, vr: 118, step: 120 }),
    swim: swimLapOf(message)
  };
}

/**
 * Timer windows from event messages (event 0 = timer; type 0 start, 4 stop_all,
 * 1 stop). Falls back to a single window spanning all records when a file has
 * no usable timer events.
 */
function buildActiveWindows(
  events: FitMessage[],
  firstTs: number | undefined,
  lastTs: number | undefined
): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  let openAt: number | undefined;
  for (const event of events) {
    if (num(event, 0) !== 0) continue; // only timer events
    const ts = unixTs(event, 253);
    const type = num(event, 1);
    if (ts === undefined || type === undefined) continue;
    if (type === 0) {
      if (openAt === undefined) openAt = ts;
    } else if (type === 1 || type === 4) {
      if (openAt !== undefined && ts >= openAt) {
        windows.push([openAt, ts]);
      }
      openAt = undefined;
    }
  }
  if (openAt !== undefined && lastTs !== undefined && lastTs >= openAt) {
    windows.push([openAt, lastTs]);
  }
  if (windows.length === 0 && firstTs !== undefined && lastTs !== undefined) {
    windows.push([firstTs, lastTs]);
  }
  return windows;
}

/** Moving seconds elapsed at `ts`, counting only time inside active windows. */
export function timerSecondsAt(
  windows: Array<[number, number]>,
  ts: number
): number | null {
  let total = 0;
  for (const [start, end] of windows) {
    if (ts < start) return total > 0 ? total : null;
    if (ts <= end) return total + (ts - start);
    total += end - start;
  }
  // After the last window: clamp to total moving time.
  return total;
}

function isInsideWindows(windows: Array<[number, number]>, ts: number): boolean {
  return windows.some(([start, end]) => ts >= start && ts <= end);
}

/** Decode a FIT buffer into scaled records, laps, and session. */
export function parseFitActivity(input: Uint8Array | ArrayBuffer): FitActivity {
  const decoded = decodeFit(input);
  let session: FitSession | null = null;
  const laps: FitLap[] = [];
  const lengths: FitLength[] = [];
  const events: FitMessage[] = [];
  const rawRecords: FitMessage[] = [];
  let fileCreatedTs: number | undefined;
  let manufacturer: number | undefined;
  let product: number | undefined;

  for (const message of decoded.messages) {
    switch (message.globalNum) {
      case FIT_MSG.FILE_ID:
        fileCreatedTs = unixTs(message, 4);
        manufacturer = num(message, 1);
        product = num(message, 2);
        break;
      case FIT_MSG.SESSION:
        // Multisport files carry several sessions; keep the longest.
        {
          const parsed = parseSession(message);
          if (
            parsed &&
            (!session || (parsed.timerSec ?? 0) > (session.timerSec ?? 0))
          ) {
            session = parsed;
          }
        }
        break;
      case FIT_MSG.LAP: {
        const lap = parseLap(message, laps.length + 1);
        if (lap) laps.push(lap);
        break;
      }
      case FIT_MSG.LENGTH: {
        const length = parseLength(message);
        if (length) lengths.push(length);
        break;
      }
      case FIT_MSG.RECORD:
        rawRecords.push(message);
        break;
      case FIT_MSG.EVENT:
        events.push(message);
        break;
      default:
        break;
    }
  }

  // A loop, not Math.min(...stamps): a day and a half of per-second records overflows the argument list.
  let firstTs: number | undefined;
  let lastTs: number | undefined;
  for (const message of rawRecords) {
    const ts = unixTs(message, 253);
    if (ts === undefined) continue;
    if (firstTs === undefined || ts < firstTs) firstTs = ts;
    if (lastTs === undefined || ts > lastTs) lastTs = ts;
  }
  const activeWindows = buildActiveWindows(events, firstTs, lastTs);

  const records: FitRecord[] = [];
  let lastT = -1;
  for (const message of rawRecords) {
    const ts = unixTs(message, 253);
    if (ts === undefined) continue;
    // Drop samples recorded while the timer was paused.
    if (!isInsideWindows(activeWindows, ts)) continue;
    const t = timerSecondsAt(activeWindows, ts);
    if (t === null || t < lastT) continue;
    lastT = t;
    const lat = num(message, 0);
    const lon = num(message, 1);
    records.push({
      ts,
      t,
      lat: lat === undefined ? undefined : semicirclesToDegrees(lat),
      lon: lon === undefined ? undefined : semicirclesToDegrees(lon),
      alt: pickAltitude(message, 78, 2),
      dist: scaled(num(message, 5), 100),
      speed: pickSpeed(message, 73, 6),
      hr: num(message, 3),
      cadence: num(message, 4),
      power: num(message, 7),
      temp: num(message, 13),
      verticalOscillation: scaled(num(message, 39), 10),
      groundTime: scaled(num(message, 41), 10),
      verticalRatio: scaled(num(message, 83), 100),
      stepLength: scaled(num(message, 85), 10),
      effortSpeed: developerNumber(message, "Effort Pace")
    });
  }

  // Strokes, rests and lengths are a swim's; another sport's cycles and recovery steps are not.
  if (session?.sport !== FIT_SPORT_SWIMMING) for (const lap of laps) delete lap.swim;
  else fillSwolf(session, laps, lengths);

  return {
    session,
    laps,
    lengths,
    records,
    activeWindows,
    fileCreatedTs,
    manufacturer,
    product
  };
}
