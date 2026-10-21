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
}

export interface FitActivity {
  session: FitSession | null;
  laps: FitLap[];
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

function parseSession(message: FitMessage): FitSession | null {
  const startTs = unixTs(message, 2) ?? unixTs(message, 253);
  if (startTs === undefined) return null;
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
    totalStrides: num(message, 10),
    dynamics: dynamicsOf(message, { vo: 89, gct: 91, vr: 132, step: 134 }),
    training: trainingOf(message)
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
    dynamics: dynamicsOf(message, { vo: 77, gct: 79, vr: 118, step: 120 })
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

  return {
    session,
    laps,
    records,
    activeWindows,
    fileCreatedTs,
    manufacturer,
    product
  };
}
