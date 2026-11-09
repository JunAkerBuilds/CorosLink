/**
 * The workout a watch activity followed, as the watch saved it with the
 * activity: sport info 14 holds, split over records, the same "HF" file
 * (type 41) with a `ProgramLite` protobuf that CorosLink and the COROS app
 * send to the watch (corosBleTrainingProtocol.ts writes it). Its steps come
 * in plan order: a repeat group, then the steps inside it (`groupId`).
 *
 * Steps are given in FIT's order (workout_step): a group's steps, then a
 * repeat step that goes back to the first of them.
 */

/** The watch's stroke codes (laps and workout targets alike) → FIT swim_stroke, as COROS maps them. 0 and 5 have no FIT stroke. */
export const SWIM_STROKES: Readonly<Record<number, number>> = { 1: 0, 2: 2, 3: 1, 4: 3, 6: 4, 7: 6, 0xff: 5 };

export interface CorosWorkoutStep {
  name?: string;
  /** FIT intensity: 0 active, 1 rest, 2 warm-up, 3 cool-down. */
  intensity?: number;
  /** What ends the step. A repeat goes back to step `repeatFrom` until its steps were done `repeatTimes` times. */
  duration: "time" | "distance" | "hrBelow" | "open" | "repeat";
  /** Seconds, metres or bpm. */
  durationValue?: number;
  repeatFrom?: number;
  repeatTimes?: number;
  /** FIT swim_stroke the step asks for. */
  stroke?: number;
  /** The range the step asks to stay in: pace s/km, speed m/s, heart rate bpm, power W, cadence spm. */
  target?: CorosWorkoutTarget;
}

export interface CorosWorkoutTarget {
  kind: "pace" | "speed" | "heartRate" | "power" | "cadence";
  low: number;
  high: number;
}

export interface CorosWorkout {
  name?: string;
  /** The training-calendar entry (`idInPlan`) the workout was scheduled as. */
  calendarEntry?: number;
  steps: CorosWorkoutStep[];
}

/** Watch file header: "HF", flags, file type, created, body length, two CRCs. */
const HEADER_BYTES = 16;
const WORKOUT_FILE = 41;
const MAX_PLAN_BYTES = 65_536;
const MAX_STEPS = 500;
const MAX_NAME_CHARS = 120;
/** The most times a repeat runs; more is a damaged plan. */
const MAX_REPEATS = 999;
/** A name's first field holds 39 UTF-8 bytes; the rest goes to extend_name. */
const NAME_FIELD_BYTES = 39;
/** Lap byte 42 / 51 after the plan ends: no step. */
export const NO_PLAN_STEP = 0xff;
/** Plain ranges a watch can hold; outside them a value is damaged, not a target. */
const RANGE_LIMITS: Readonly<Record<CorosWorkoutTarget["kind"], [number, number]>> = {
  pace: [60, 3600], speed: [0.1, 60], heartRate: [30, 250], power: [1, 3000], cadence: [10, 300]
};
/** Longest time (s) and distance (m) a step can ask for. */
const MAX_STEP_SECONDS = 86_400;
const MAX_STEP_METERS = 1_000_000;

/** COROS targetType → what ends the step. */
const TARGET_TIME = 2;
const TARGET_DISTANCE = 5;
const TARGET_HR_RECOVERY = 7;
/** COROS exerciseType → FIT intensity. */
const INTENSITY_BY_EXERCISE: Readonly<Record<number, number>> = { 1: 2, 2: 0, 3: 3, 4: 1 };
/** COROS intensityType for a swim step's stroke; its value is the watch's stroke code. */
const INTENSITY_STROKE = 5;
/**
 * COROS intensityType → the range a step asks for, as the watch gets it (concrete values; workoutCapabilities.ts
 * encodes them): heart rate in bpm, pace in ms per km (× intensityMultiplier 1000), speed in km/h × 100, power in W,
 * cadence in spm. Effort pace (8) and zone-only targets have no plain range and are left out.
 */
const INTENSITY_TARGETS: Readonly<Record<number, CorosWorkoutTarget["kind"]>> = { 2: "heartRate", 3: "pace", 4: "speed", 6: "power", 7: "cadence" };

type Fields = Map<number, Array<number | Buffer>>;

class ProtoError extends Error {}

function readVarint(bytes: Buffer, at: number): [number, number] {
  let value = 0;
  let scale = 1;
  for (let index = 0; index < 10; index += 1) {
    if (at >= bytes.length) throw new ProtoError();
    const byte = bytes[at++]!;
    value += (byte & 0x7f) * scale;
    scale *= 128;
    if (byte < 0x80) return [value, at];
  }
  throw new ProtoError();
}

/** A message's fields by number: varints as numbers, length-delimited as bytes. Other wire types are skipped. */
function readFields(bytes: Buffer): Fields {
  const fields: Fields = new Map();
  let at = 0;
  while (at < bytes.length) {
    let tag: number;
    [tag, at] = readVarint(bytes, at);
    const field = Math.floor(tag / 8);
    let value: number | Buffer;
    switch (tag & 7) {
      case 0: [value, at] = readVarint(bytes, at); break;
      case 1: at += 8; continue;
      case 2: {
        let length: number;
        [length, at] = readVarint(bytes, at);
        if (at + length > bytes.length) throw new ProtoError();
        value = bytes.subarray(at, at + length);
        at += length;
        break;
      }
      case 5: at += 4; continue;
      default: throw new ProtoError();
    }
    const values = fields.get(field) ?? [];
    values.push(value);
    fields.set(field, values);
  }
  return fields;
}

const numberOf = (fields: Fields, field: number) => {
  const value = fields.get(field)?.[0];
  return typeof value === "number" ? value : undefined;
};
const textOf = (fields: Fields, field: number) => {
  const value = fields.get(field)?.[0];
  return Buffer.isBuffer(value) ? value.toString("utf8").replace(/\0/g, "").trim() : undefined;
};

/**
 * A name past 39 bytes continues in extend_name. Split at a space, the space
 * was dropped, so it comes back; a name with no space in its first 39 bytes
 * (Chinese, one long word) was cut mid-word and joins without one.
 */
function joinedName(fields: Fields, nameField: number, extendField: number): string | undefined {
  const head = textOf(fields, nameField);
  const tail = textOf(fields, extendField);
  const glue = head && !head.includes(" ") && Buffer.byteLength(head, "utf8") >= NAME_FIELD_BYTES - 2 ? "" : " ";
  const name = head && tail ? `${head}${glue}${tail}` : head || tail;
  // Cut by characters, never inside one.
  return name ? Array.from(name).slice(0, MAX_NAME_CHARS).join("") : undefined;
}

interface PlanStep {
  id?: number;
  name?: string;
  isGroup: boolean;
  groupId?: number;
  sets?: number;
  targetType?: number;
  targetValue?: number;
  exerciseType?: number;
  intensityType?: number;
  intensityValue?: number;
  intensityValueExtend?: number;
  intensityMultiplier?: number;
}

/** A step's target range in plain units, or undefined when it has none the watch could use. */
function targetOf(plan: PlanStep): CorosWorkoutTarget | undefined {
  const kind = plan.intensityType === undefined ? undefined : INTENSITY_TARGETS[plan.intensityType];
  const low = plan.intensityValue;
  const high = plan.intensityValueExtend || low;
  if (!kind || !low || !high) return undefined;
  const [a, b] = low <= high ? [low, high] : [high, low];
  // Pace in ms per km (× intensityMultiplier), speed in km/h × 100 → m/s, the rest as they are.
  const scale = kind === "pace" ? plan.intensityMultiplier || 1000 : kind === "speed" ? 360 : 1;
  const range = { kind, low: a / scale, high: b / scale };
  const [min, max] = RANGE_LIMITS[kind];
  return range.low >= min && range.high <= max ? range : undefined;
}

function stepOf(plan: PlanStep, swim: boolean): CorosWorkoutStep {
  const value = plan.targetValue;
  // A time, distance or heart rate past what a step could ask for is damaged: the step is open.
  const duration: CorosWorkoutStep["duration"] = !value ? "open"
    : plan.targetType === TARGET_TIME && value <= MAX_STEP_SECONDS ? "time"
      : plan.targetType === TARGET_DISTANCE && value / 100 <= MAX_STEP_METERS ? "distance"
        : plan.targetType === TARGET_HR_RECOVERY && value >= RANGE_LIMITS.heartRate[0] && value <= RANGE_LIMITS.heartRate[1] ? "hrBelow"
          : "open";
  return {
    ...(plan.name ? { name: plan.name } : {}),
    ...(plan.exerciseType !== undefined && INTENSITY_BY_EXERCISE[plan.exerciseType] !== undefined ? { intensity: INTENSITY_BY_EXERCISE[plan.exerciseType] } : {}),
    duration,
    ...(duration === "open" ? {} : { durationValue: duration === "distance" ? value! / 100 : value }),
    ...(swim && plan.intensityType === INTENSITY_STROKE && plan.intensityValue !== undefined && SWIM_STROKES[plan.intensityValue] !== undefined
      ? { stroke: SWIM_STROKES[plan.intensityValue] } : {}),
    ...(!swim && targetOf(plan) ? { target: targetOf(plan) } : {})
  };
}

/**
 * The workout in an activity's sport info 14 (its parts in order, part byte
 * removed), and for each step the watch counts (lap byte 42 in a swim, 51 in a
 * run: steps that aren't repeat groups, in plan order) its index in `steps`.
 * A swim step's target is a stroke; another sport's, a pace, heart-rate,
 * speed, power or cadence range. Undefined when the bytes aren't a workout.
 */
export function decodeWorkoutPlan(file: Buffer, { swim }: { swim: boolean }): { workout: CorosWorkout; planSteps: number[] } | undefined {
  let body = file;
  if (file.length >= HEADER_BYTES && file[0] === 0x48 && file[1] === 0x46) {
    if (file[3] !== WORKOUT_FILE) return undefined;
    body = file.subarray(HEADER_BYTES, HEADER_BYTES + file.readUInt32LE(8));
  }
  if (!body.length || body.length > MAX_PLAN_BYTES) return undefined;
  try {
    const top = readFields(body);
    const summary = top.get(1)?.find(Buffer.isBuffer);
    const summaryFields = summary ? readFields(summary) : new Map() as Fields;
    const plan: PlanStep[] = (top.get(2) ?? []).filter(Buffer.isBuffer).slice(0, MAX_STEPS).map((bytes) => {
      const fields = readFields(bytes);
      return {
        id: numberOf(fields, 1),
        name: joinedName(fields, 3, 28),
        isGroup: numberOf(fields, 20) === 1,
        groupId: numberOf(fields, 21) || undefined,
        sets: numberOf(fields, 11),
        targetType: numberOf(fields, 4),
        targetValue: numberOf(fields, 5),
        exerciseType: numberOf(fields, 16),
        intensityType: numberOf(fields, 8),
        intensityValue: numberOf(fields, 9),
        intensityValueExtend: numberOf(fields, 10),
        intensityMultiplier: numberOf(fields, 19)
      };
    });
    if (!plan.length) return undefined;
    const groups = new Map<number, PlanStep>();
    for (const step of plan) if (step.isGroup && step.id !== undefined && !groups.has(step.id)) groups.set(step.id, step);
    const steps: CorosWorkoutStep[] = [];
    const indexOf = new Map<PlanStep, number>();
    const placed = new Set<PlanStep>();
    const place = (step: PlanStep) => {
      if (placed.has(step)) return;
      placed.add(step);
      if (!step.isGroup) {
        indexOf.set(step, steps.length);
        steps.push(stepOf(step, swim));
        return;
      }
      const first = steps.length;
      // A group without an id has no steps of its own.
      if (step.id !== undefined) for (const child of plan) if (child !== step && child.groupId === step.id) place(child);
      if (steps.length === first) return;
      steps.push({ ...(step.name ? { name: step.name } : {}), duration: "repeat", repeatFrom: first, repeatTimes: Math.min(MAX_REPEATS, Math.max(1, step.sets ?? 1)) });
    };
    // Top-level steps in plan order; a step whose group isn't in the plan stands on its own.
    for (const step of plan) if (step.groupId === undefined || !groups.has(step.groupId) || groups.get(step.groupId) === step) place(step);
    for (const step of plan) place(step);
    // Byte 0xff means the plan has ended, however many steps it has.
    const planSteps = plan.filter((step) => !step.isGroup).map((step) => indexOf.get(step)!).slice(0, NO_PLAN_STEP);
    const calendarEntry = numberOf(summaryFields, 12);
    return {
      workout: {
        ...(joinedName(summaryFields, 2, 20) ? { name: joinedName(summaryFields, 2, 20) } : {}),
        ...(calendarEntry ? { calendarEntry } : {}),
        steps
      },
      planSteps
    };
  } catch (error) {
    if (error instanceof ProtoError) return undefined;
    throw error;
  }
}
