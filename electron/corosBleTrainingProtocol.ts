import { createHash } from "node:crypto";
import { WATCH_EPOCH } from "./corosWatchCommands";
import { crc16Ccitt } from "./corosBleRouteProtocol";
import type { WatchCalendarSkipped } from "./localSync/localDataTypes";

/**
 * Workouts on the watch, as the COROS phone app sends them:
 * - a workout is a `LitePb.ProgramLite` protobuf (summary + flat step list)
 *   in an "HF" file of type 41, sent over SendFile into a numbered slot;
 * - CONFIG_TRAINING (0xAF) lists the slots and deletes from them.
 */

export const WORKOUT_FILE = 41;
export const WEATHER_FILE = 80;
/** GPS assistance: the main COROS ELPO or LTO file (corosWatchCep.ts). */
const EPO_FILE = 13;
/** The second ELPO file (from 72 hours ahead) and the short-term ephemeris (RTO). */
const ELPO_AHEAD_FILE = 68;
const RTO_FILE = 70;
/** Satellite files: the 3 extra header bytes carry a 24-bit hour, and the watch takes up to 256 KB (SendFile descriptors). */
const SATELLITE_FILES: ReadonlySet<number> = new Set([EPO_FILE, ELPO_AHEAD_FILE, RTO_FILE]);
export const SATELLITE_FILE_LIMIT = 262_144;
/** The training plan. File 83 is the app's "today's advice", which the PACE 4 firmware has no slot for. */
export const TRAINING_PLAN_FILE = 42;
/** Largest file CorosLink pushes; the helper and the Python fallback use the same limit. */
const DATA_FILE_LIMIT = 65_536;
export const CONFIG_TRAINING_OPCODE = 0xaf;
export const TRAINING_BLOCK_BYTES = 4096;
/** CONFIG_TRAINING `type`: the workout library, or the training-calendar plan. */
export const TRAINING_KIND = { workouts: 0, plan: 1 } as const;

export class WorkoutNotSendableError extends Error {}
/** The workout has zone or percentage targets, which the watch can't resolve. */
class ZoneTargetsError extends WorkoutNotSendableError {}

const INT64_MIN = -(1n << 63n);
const UINT64_LIMIT = 1n << 64n;

/** A protobuf integer: finite, and within int64/uint64 (anything else would not end or would not fit). */
function wireInteger(value: number | bigint): bigint {
  if (typeof value === "number" && !Number.isFinite(value)) throw new WorkoutNotSendableError("This workout has a value the watch can't take. Check its steps, then send it again.");
  const big = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (big < INT64_MIN || big >= UINT64_LIMIT) throw new WorkoutNotSendableError("This workout has a value the watch can't take. Check its steps, then send it again.");
  return big;
}

function varint(value: bigint): number[] {
  // Negative int32/int64 values are written as 64-bit two's complement.
  let v = wireInteger(value);
  if (v < 0n) v += UINT64_LIMIT;
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return out;
}

export class ProtoWriter {
  private readonly parts: Buffer[] = [];

  private tag(field: number, wire: number): void { this.parts.push(Buffer.from(varint(BigInt(field * 8 + wire)))); }

  int(field: number, value: number | bigint | undefined): this {
    if (value === undefined) return this;
    const big = wireInteger(value);
    if (big === 0n) return this;
    this.tag(field, 0); this.parts.push(Buffer.from(varint(big)));
    return this;
  }

  bool(field: number, value: boolean | undefined): this { return value ? this.int(field, 1) : this; }

  string(field: number, value: string | undefined): this {
    if (!value) return this;
    const bytes = Buffer.from(value, "utf8");
    this.tag(field, 2); this.parts.push(Buffer.from(varint(BigInt(bytes.length))), bytes);
    return this;
  }

  /** sint32/sint64 (zigzag). */
  sint(field: number, value: number | undefined): this {
    if (value === undefined) return this;
    const v = wireInteger(value);
    if (v >= 1n << 63n) throw new WorkoutNotSendableError("This workout has a value the watch can't take. Check its steps, then send it again.");
    return this.int(field, v < 0n ? -2n * v - 1n : 2n * v);
  }

  packed(field: number, values: number[] | undefined): this {
    if (!values?.length) return this;
    const body = Buffer.from(values.flatMap(value => varint(wireInteger(value))));
    this.tag(field, 2); this.parts.push(Buffer.from(varint(BigInt(body.length))), body);
    return this;
  }

  message(field: number, body: Buffer): this {
    this.tag(field, 2); this.parts.push(Buffer.from(varint(BigInt(body.length))), body);
    return this;
  }

  toBuffer(): Buffer { return Buffer.concat(this.parts); }
}

// ----- COROS program JSON → ProgramLite -----

type Json = Record<string, unknown>;

/** A workout number; one too large to hold exactly (beyond 2^53) is refused rather than written wrong. */
const num = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return undefined;
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER) throw new WorkoutNotSendableError("This workout has a value the watch can't take. Check its steps, then send it again.");
  return parsed;
};
const id64 = (value: unknown): bigint | undefined => {
  const text = typeof value === "bigint" ? String(value) : typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : typeof value === "string" ? value.trim() : "";
  return /^-?\d+$/.test(text) ? BigInt(text) : undefined;
};
const ints = (value: unknown): number[] | undefined => Array.isArray(value) ? value.map(num).filter((item): item is number => item !== undefined) : undefined;

/** Cuts a string to `limit` UTF-8 bytes without splitting a character. */
export function cutUtf8(text: string, limit: number): string {
  let out = "";
  for (const char of text) {
    if (Buffer.byteLength(out + char, "utf8") > limit) break;
    out += char;
  }
  return out;
}

/**
 * Names longer than 39 bytes continue in `extend_name` (51 bytes). The watch
 * joins the two with a space ("…W3D4: Recovery Run" was recorded as
 * "…W3D4: Reco very Run"), so the split takes the last space that fits and
 * leaves it out. A name with no space in its first 39 bytes is cut mid-word.
 */
function splitName(name: string): { name: string; extendName?: string } {
  const head = cutUtf8(name, 39);
  if (head.length === name.length) return { name: head };
  const space = name.lastIndexOf(" ", head.length);
  return space > 0
    ? { name: name.slice(0, space), extendName: cutUtf8(name.slice(space + 1), 51) }
    : { name: head, extendName: cutUtf8(name.slice(head.length), 51) };
}

/** The app tracks the highest built-in name key ("T1234") the watch must translate. */
function nameKey(name: string): number {
  const match = /^T(\d{4,9})$/.exec(name);
  return match ? Number(match[1]) : 0;
}

/**
 * Targets the app turns into numbers from the user's zones, threshold pace or
 * power before sending (zone or percentage intensities). The watch gets only
 * concrete values; such steps need those settings, which this computer may not have.
 */
function needsUserZones(step: Json): boolean {
  const type = num(step.intensityType) ?? 0;
  const custom = num(step.intensityCustom) ?? 0;
  const percent = step.isIntensityPercent === true;
  if (type === 2 || type === 3 || type === 8 || type === 9) return custom !== 0 || percent;
  if (type === 6) return custom !== 0;
  return false;
}

function encodeStep(step: Json): { bytes: Buffer; key: number } {
  const intensityType = num(step.targetType) === 7 ? 0 : num(step.intensityType);
  // "Intensity 5 at value 5" is the app's placeholder for none.
  const intensityValue = intensityType === 5 && num(step.intensityValue) === 5 ? 0 : num(step.intensityValue);
  const { name, extendName } = splitName(String(step.name ?? ""));
  const writer = new ProtoWriter()
    .int(1, id64(step.id)).int(2, id64(step.originId)).string(3, name)
    .int(4, num(step.targetType)).int(5, num(step.targetValue)).int(6, num(step.restType)).int(7, num(step.restValue))
    .int(8, intensityType).int(9, intensityValue).int(10, num(step.intensityValueExtend)).int(11, num(step.sets))
    .int(12, num(step.access)).packed(13, ints(step.part)).packed(14, ints(step.muscle)).packed(15, ints(step.equipment))
    .int(16, num(step.exerciseType)).int(17, num(step.unit)).int(18, num(step.intensityCustom)).int(19, num(step.intensityMultiplier))
    .bool(20, step.isGroup === true).int(21, id64(step.groupId)).int(22, num(step.hrType)).bool(23, step.isIntensityPercent === true)
    .int(24, num(step.intensityPercent)).int(25, num(step.intensityPercentExtend)).int(26, num(step.targetDisplayUnit))
    .int(27, num(step.intensityDisplayUnit)).string(28, extendName).int(29, num(step.gradeSystem)).int(30, num(step.onsightGradeOffset))
    .int(31, num(step.packageTime)).int(32, num(step.subType)).packed(33, ints(step.muscleRelevance)).int(34, num(step.animationId));
  return { bytes: writer.toBuffer(), key: nameKey(String(step.name ?? "")) };
}

/**
 * Builds the watch's ProgramLite from a COROS program (the JSON the Training
 * Library stores). Repeat groups are kept: the PACE watches run them natively.
 */
export function encodeProgramLite(program: Json): Buffer {
  const exercises = Array.isArray(program.exercises) ? program.exercises.filter((item): item is Json => Boolean(item) && typeof item === "object") : [];
  if (!exercises.length) throw new WorkoutNotSendableError("This workout has no steps.");
  const blocked = exercises.find(needsUserZones);
  if (blocked) {
    throw new ZoneTargetsError("This workout uses zone or percentage targets. Set exact paces, heart rates or power for its steps, then send it again.");
  }
  const steps = exercises.map(encodeStep);
  const { name, extendName } = splitName(String(program.name ?? "Workout"));
  const keyMax = Math.max(nameKey(String(program.name ?? "")), ...steps.map(step => step.key));
  const summary = new ProtoWriter()
    .int(1, id64(program.id)).string(2, name).int(3, num(program.sportType)).int(4, num(program.subType))
    .int(5, num(program.exerciseNum) ?? exercises.length).int(6, num(program.totalSets) ?? exercises.length)
    .int(7, num(program.targetType)).int(8, num(program.targetValue)).int(9, num(program.version)).int(10, num(program.unit))
    .int(11, keyMax).int(12, id64(program.idInPlan)).bool(13, program.simple === true).int(14, num(program.pbVersion))
    .int(15, num(program.estimatedType)).int(16, num(program.estimatedValue)).int(17, num(program.planIdIndex))
    .int(18, num(program.thirdPartyId)).int(19, num(program.distanceDisplayUnit)).string(20, extendName)
    .int(21, num(program.estimatedTime) ?? num(program.duration)).int(22, num(program.estimatedDistance) ?? num(program.distance))
    .int(23, num(program.estimatedTrainingLoad) ?? num(program.trainingLoad)).int(24, num(program.gradeSystemVersion))
    .int(25, num(program.pitch)).int(27, num(program.poolLength)).int(28, num(program.poolLengthUnit))
    .int(29, num(program.poolLengthId)).int(30, num(program.functionVersion))
    .toBuffer();
  const lite = new ProtoWriter().message(1, summary);
  for (const step of steps) lite.message(2, step.bytes);
  return lite.toBuffer();
}

/** The 16-byte "HF" file header the watch expects around a body. */
export function encodeWatchFile(body: Buffer, fileId: number, createdUnixSeconds = 0): Buffer {
  const file = Buffer.alloc(16 + body.length);
  file.write("HF", 0, "ascii");
  file[2] = 0; // not compressed
  file[3] = fileId;
  file.writeUInt32LE(createdUnixSeconds >= WATCH_EPOCH ? createdUnixSeconds - WATCH_EPOCH : Math.max(0, createdUnixSeconds), 4);
  file.writeUInt32LE(body.length, 8);
  file.writeUInt16LE(crc16Ccitt(body), 12);
  file.writeUInt16LE(crc16Ccitt(file.subarray(0, 14)), 14);
  body.copy(file, 16);
  return file;
}

/** SendFile block header: [0x78 0][file][offset u32][len u16][remaining u32][crc16][sum][slot 0 0][3][sum]. */
/** `extra` is the header's 3 file-specific bytes: a slot or flag byte, or (EPO) a 24-bit GPS hour. */
export function encodeTrainingBlockHeader(fileId: number, block: Buffer, offset: number, totalBytes: number, extra: number | [number, number, number]): Buffer {
  const bytes = typeof extra === "number" ? [extra, 0, 0] : extra;
  const satellite = SATELLITE_FILES.has(fileId);
  if ((fileId !== WORKOUT_FILE && fileId !== TRAINING_PLAN_FILE && fileId !== WEATHER_FILE && !satellite) || !block.length || block.length > TRAINING_BLOCK_BYTES ||
      !Number.isInteger(offset) || offset < 0 || offset + block.length > totalBytes || totalBytes > (satellite ? SATELLITE_FILE_LIMIT : DATA_FILE_LIMIT) ||
      !Number.isInteger(bytes[0]) || bytes[0] < 0 || (!satellite && bytes[0] > 254) || !bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error("Invalid COROS workout block.");
  }
  const header = Buffer.alloc(21);
  header[0] = 0x78; header[2] = fileId;
  header.writeUInt32LE(offset, 3); header.writeUInt16LE(block.length, 7);
  header.writeUInt32LE(totalBytes - offset, 9); header.writeUInt16LE(crc16Ccitt(block), 13);
  header[15] = block.reduce((sum, byte) => (sum + byte) & 255, 0);
  header.set(bytes, 16); header[19] = 3;
  header[20] = header.subarray(2, 20).reduce((sum, byte) => (sum + byte) & 255, 0);
  return header;
}

// ----- CONFIG_TRAINING (0xAF) -----

export interface WatchTrainingSlot { id: string; slot: number; version: number }
export interface WatchTrainingList { kind: number; maxBytes: number; maxCount: number; entries: WatchTrainingSlot[] }

export function encodeTrainingListRequest(kind: number): Buffer { return Buffer.from([kind, 0]); }

/** opcode 1 deletes; each entry is i64 id + u8 slot. */
export function encodeTrainingDeleteRequest(kind: number, entries: Array<{ id: string; slot: number }>): Buffer {
  const body = Buffer.alloc(2 + entries.length * 9);
  body[0] = kind; body[1] = 1;
  entries.forEach((entry, index) => {
    body.writeBigInt64LE(BigInt(entry.id), 2 + index * 9);
    body[10 + index * 9] = entry.slot;
  });
  return body;
}

/** Reply without the frame header: [status][kind][opcode][max size u32][max count][count][{id i64, slot, version}…][u16]. */
export function decodeTrainingList(reply: Buffer): WatchTrainingList {
  if (reply.length < 1 || reply[0] !== 1) throw new Error("The watch did not return its workout list.");
  if (reply.length < 9) return { kind: reply[1] ?? 0, maxBytes: 0, maxCount: 0, entries: [] };
  const maxBytes = reply.readUInt32LE(3);
  const maxCount = reply[7]!;
  const count = reply[8]!;
  const entries: WatchTrainingSlot[] = [];
  for (let index = 0, offset = 9; index < count && offset + 10 <= reply.length; index++, offset += 10) {
    entries.push({ id: reply.readBigInt64LE(offset).toString(), slot: reply[offset + 8]!, version: reply[offset + 9]! });
  }
  return { kind: reply[1]!, maxBytes, maxCount, entries };
}

/** The workout's own slot when it is already on the watch, else the lowest free one. */
export function workoutSlot(list: WatchTrainingList, programId: string): number {
  const existing = list.entries.find(entry => entry.id === programId);
  if (existing) return existing.slot;
  const used = new Set(list.entries.map(entry => entry.slot));
  for (let slot = 0; slot < (list.maxCount || 20); slot++) if (!used.has(slot)) return slot;
  throw new WorkoutNotSendableError(`Your watch already holds ${list.entries.length} workouts. Remove one from the watch, then send this one again.`);
}

// ----- the training calendar (SendFile 42), as the app's training-plan sync builds it -----

/** The days the watch gets: from Monday of this week, 35 days. */
const PLAN_WINDOW_DAYS = 35;
/** CorosLink's calendar as one plan on the watch. */
export const LOCAL_PLAN_ID = 1n;
/** The header's extra byte for a plan: 1, as the app's automatic training-plan sync sends it. */
const PLAN_SYNC_FLAG = 1;
const PLAN_RECORDS_LIMIT = 8176;
const PLAN_WORKOUT_LIMIT = 4080;
const MAX_WORKOUTS_PER_DAY = 11;

export interface ScheduledWorkoutForWatch {
  idInPlan: number;
  /** YYYYMMDD */
  happenDay: string;
  program: Json;
}

const dayKey = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8)) - Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8))) / 86_400_000);

/** Monday of the week `now` falls in, and the last day of the 35-day window. */
export function planWindow(now: Date): { startDay: string; endDay: string } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + PLAN_WINDOW_DAYS - 1);
  return { startDay: dayKey(monday), endDay: dayKey(end) };
}

function planRecord(bytes: Buffer): Buffer {
  if (bytes.length > 255) throw new Error("A training-calendar record is too large for the watch.");
  return Buffer.concat([Buffer.from([2, bytes.length]), bytes]);
}

/**
 * The calendar file: an "HF" file 42 of `[2][length][protobuf]` records (the
 * PlanSummaryLite, then one VersionObject per scheduled workout: type 0 (the
 * app writes 0 for the watch, 1 only for the server; the firmware skips the
 * others), status 1 = add, day number from the plan's Monday), followed by each
 * workout as its own "HF" file 41. Everything is sent as new, as the app does
 * for a watch without the plan, so the previous copy is removed first.
 * Returns the file, the workouts it holds and, by reason, those left off.
 */
function encodeTrainingPlanFile(entries: ScheduledWorkoutForWatch[], now: Date, version: number): { file: Buffer; workouts: number; skipped: WatchCalendarSkipped } {
  const { startDay, endDay } = planWindow(now);
  const skipped = { zoneTargets: 0, invalid: 0, perDay: 0, fileSize: 0 };
  const inWindow = entries
    .filter(entry => /^\d{8}$/.test(entry.happenDay) && entry.happenDay >= startDay && entry.happenDay <= endDay && Number.isSafeInteger(entry.idInPlan) && entry.idInPlan > 0)
    .sort((a, b) => a.happenDay.localeCompare(b.happenDay) || a.idInPlan - b.idInPlan);
  const perDay = new Map<string, number>();
  const workouts: Buffer[] = [];
  const kept: ScheduledWorkoutForWatch[] = [];
  for (const entry of inWindow) {
    const steps = Array.isArray(entry.program.exercises) ? (entry.program.exercises as Json[]).map(step => step && typeof step === "object" && !String(step.name ?? "")
      ? { ...step, name: num(step.exerciseType) === 1 ? "Warm-up" : num(step.exerciseType) === 3 ? "Cool-down" : "Training" } : step) : [];
    let body: Buffer;
    try {
      body = encodeProgramLite({ ...entry.program, exercises: steps, idInPlan: entry.idInPlan, planIdIndex: 0 });
    } catch (error) {
      // A workout the watch can't take (zone targets, no steps) stays off the calendar.
      skipped[error instanceof ZoneTargetsError ? "zoneTargets" : "invalid"] += 1;
      continue;
    }
    if (body.length > PLAN_WORKOUT_LIMIT) { skipped.fileSize += 1; continue; }
    // Only workouts that go on the watch count toward the day's limit.
    const count = (perDay.get(entry.happenDay) ?? 0) + 1;
    if (count > MAX_WORKOUTS_PER_DAY) { skipped.perDay += 1; continue; }
    perDay.set(entry.happenDay, count);
    workouts.push(encodeWatchFile(body, WORKOUT_FILE));
    kept.push(entry);
  }
  const { name, extendName } = splitName("CorosLink");
  const summary = new ProtoWriter()
    .int(1, LOCAL_PLAN_ID).string(2, name).int(3, PLAN_WINDOW_DAYS).int(4, Number(startDay)).int(5, version)
    .int(6, 1 /* running */).int(8, Number(endDay)).int(9, 2).string(12, extendName).toBuffer();
  const records = [planRecord(summary)];
  let size = records[0]!.length;
  for (const entry of kept) {
    const record = planRecord(new ProtoWriter()
      .int(1, 0 /* workout on the watch */).int(2, entry.idInPlan).int(3, num(entry.program.version) ?? 1).int(4, 1 /* add */)
      .int(5, daysBetween(startDay, entry.happenDay)).int(10, entry.idInPlan).toBuffer());
    // Plan records and workouts share the file's size limit; later days drop first.
    const fileBytes = 16 + size + record.length + workouts.slice(0, records.length).reduce((sum, workout) => sum + workout.length, 0);
    if (size + record.length > PLAN_RECORDS_LIMIT || fileBytes > DATA_FILE_LIMIT) break;
    records.push(record);
    size += record.length;
  }
  skipped.fileSize += kept.length - (records.length - 1);
  const reasons = Object.fromEntries(Object.entries(skipped).filter(([, count]) => count > 0)) as WatchCalendarSkipped;
  return { file: Buffer.concat([encodeWatchFile(Buffer.concat(records), TRAINING_PLAN_FILE), ...workouts.slice(0, records.length - 1)]), workouts: records.length - 1, skipped: reasons };
}

export const TRAINING_PLAN_SYNC_FLAG = PLAN_SYNC_FLAG;

/** CorosLink's plan as the watch lists it (CONFIG_TRAINING ids are decimal strings). */
export const LOCAL_PLAN_ENTRY_ID = LOCAL_PLAN_ID.toString();

/**
 * The calendar file, with its version taken from its content: the same calendar
 * always gives the same bytes and the same `contentHash`, so an unchanged one
 * doesn't need sending again. (The window's Monday is part of the content.)
 */
export function encodeTrainingPlan(entries: ScheduledWorkoutForWatch[], now: Date): { file: Buffer; workouts: number; skipped: WatchCalendarSkipped; contentHash: string } {
  // Version 0 isn't written (proto3), so this is the content alone.
  const contentHash = createHash("sha256").update(encodeTrainingPlanFile(entries, now, 0).file).digest("hex");
  const version = (Number.parseInt(contentHash.slice(0, 8), 16) >>> 1) || 1;
  return { ...encodeTrainingPlanFile(entries, now, version), contentHash };
}
