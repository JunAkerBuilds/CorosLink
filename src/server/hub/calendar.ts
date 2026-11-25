// The COROS calendar and saved-workout library on a Training Hub session. Ported from TrainingHubCalendar.swift
// (schedule read, add, edit, move, remove, exercise catalog) and CoachLibrary.swift (library list and detail).
import type { HubDay, HubExercise, HubMoveProgress, HubPlannedWorkout, HubSavedWorkout, HubSport, HubWorkout } from "@/data/hub";
import type { HubSession, TrainingHub } from "./client";
import { HubMoveFailed, HubProblem } from "./errors";
import { at, int, isObject, list, num, text, word, type Json, type JsonObject } from "./json";
import { hubTotals, sportOfCode, usesExercises } from "./rules";
import { attachSources, buildProgram, readCatalog, readProgram, toWeb, type Units } from "./workout";

/** A workout on the COROS calendar as Training Hub lists it: the entry (`entity`) and its program. */
export interface ScheduledEntry {
  planId: string;
  idInPlan: string;
  planProgramId: string;
  day: HubDay;
  name: string;
  sportCode: number | null;
  entity: JsonObject;
  program: JsonObject;
}

/** `YYYYMMDD`, as Training Hub writes days, from `YYYY-MM-DD`. */
export const dayCode = (day: HubDay): string => day.replace(/-/g, "");

/** `YYYY-MM-DD` from Training Hub's `YYYYMMDD`. */
export function dayOfCode(code: string): HubDay | null {
  return /^\d{8}$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}` : null;
}

/** The workouts scheduled from `first` to `last`, and the highest `idInPlan` COROS has handed out. */
export async function scheduled(hub: TrainingHub, session: HubSession, first: HubDay, last: HubDay): Promise<{ workouts: ScheduledEntry[]; maxIdInPlan: number }> {
  const raw = await hub.get("training/schedule/query", { startDate: dayCode(first), endDate: dayCode(last), supportRestExercise: "1" }, session) ?? {};
  return { workouts: parseSchedule(raw), maxIdInPlan: int(at(raw, "maxIdInPlan")) ?? 0 };
}

export function parseSchedule(raw: Json): ScheduledEntry[] {
  const entities = list(at(raw, "entities")) ?? [];
  const programs = list(at(raw, "programs")) ?? [];
  const result: ScheduledEntry[] = [];
  entities.forEach((entity, index) => {
    // Status 3 is a removed entry.
    const day = dayOfCode(text(at(entity, "happenDay")) ?? "");
    if (!isObject(entity) || int(entity.status) === 3 || !day) return;
    const idInPlan = text(entity.idInPlan) ?? "";
    const planProgramId = text(entity.planProgramId) ?? "";
    const found = programs.find((program) => idInPlan !== "" && text(at(program, "idInPlan")) === idInPlan)
      ?? programs.find((program) => planProgramId !== "" && text(at(program, "id")) === planProgramId)
      ?? programs[index];
    const program = isObject(found) ? found : {};
    result.push({
      planId: text(entity.planId) ?? "", idInPlan, planProgramId, day,
      name: word(program.name) ?? word(entity.name) ?? "",
      sportCode: int(program.sportType ?? entity.sportType) ?? null, entity, program,
    });
  });
  const order = (entry: ScheduledEntry) => int(entry.entity.sortNoInSchedule) ?? 0;
  return result.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : order(x) - order(y)));
}

/** The calendar entry for the browser: COROS's rows left behind, the editable workout when this editor can write it. */
export function toPlanned(entry: ScheduledEntry): HubPlannedWorkout {
  const read = readProgram(entry.program);
  const workout = read ? toWeb(read) : null;
  // COROS's own figures count every step (a distance step's time too); the steps' sums only what each step is set by.
  const sport = sportOfCode(entry.sportCode ?? undefined);
  const own = programTotals(entry.program);
  // A program's set count only means something for a gym workout.
  const ownSets = sport && usesExercises(sport) ? own.sets : 0;
  const steps = workout ? hubTotals(workout) : null;
  const totals = steps || own.seconds || own.meters || ownSets
    ? { seconds: own.seconds || steps?.seconds || 0, meters: own.meters || steps?.meters || 0, sets: steps ? steps.sets : ownSets }
    : null;
  return {
    day: entry.day, idInPlan: entry.idInPlan, planId: entry.planId, planProgramId: entry.planProgramId, name: entry.name,
    sportCode: entry.sportCode, sport,
    workout, totals, load: own.load || null,
  };
}

const positive = (value: number | undefined) => (value !== undefined && Number.isFinite(value) && value > 0 ? value : 0);

/** COROS's totals on a program: seconds, distance (stored in centimetres), sets and training load. */
export function programTotals(program: Json): { seconds: number; meters: number; sets: number; load: number } {
  return {
    seconds: positive(num(at(program, "duration"))), meters: positive(num(at(program, "distance"))) / 100,
    sets: positive(int(at(program, "exerciseNum")) ?? int(at(program, "totalSets")) ?? int(at(program, "sets"))),
    load: Math.round(positive(num(at(program, "trainingLoad")))),
  };
}

/** The scheduled workout listed as `idInPlan` on `day`, matched by name when the ID alone doesn't settle it. */
export async function scheduledOne(hub: TrainingHub, session: HubSession, day: HubDay, idInPlan: string | null, name: string): Promise<ScheduledEntry> {
  const entries = (await scheduled(hub, session, day, day)).workouts;
  const byID = entries.filter((entry) => idInPlan !== null && entry.idInPlan === idInPlan);
  if (byID.length === 1) return byID[0];
  const byName = (byID.length === 0 ? entries : byID).filter((entry) => entry.name === name);
  if (byName.length === 1) return byName[0];
  throw new HubProblem(entries.length === 0 ? "COROS has no workout on that day any more. Refresh the calendar."
    : "C-LINK couldn't tell which workout on that day this is. Refresh the calendar and try again.");
}

/** COROS's exercise catalog for strength and HYROX (HYROX stations are in Strength's), with the athlete's own exercises. */
export async function exercises(hub: TrainingHub, session: HubSession, sport: HubSport): Promise<HubExercise[]> {
  if (!usesExercises(sport)) return [];
  const raw = await hub.get("training/exercise/query", { sportType: "4", userId: session.userId, keyword: "" }, session);
  return readCatalog(raw ?? []);
}

/** COROS's distance, time and load for a program, folded into it (`/training/program/calculate`). */
async function calculate(hub: TrainingHub, session: HubSession, program: JsonObject): Promise<JsonObject> {
  const calculation = await hub.post("training/program/calculate", program, session);
  if (calculation === undefined) throw new HubProblem("COROS didn't work out the workout's totals.");
  const result = { ...program };
  for (const [from, to] of [["planDistance", "distance"], ["planDuration", "duration"], ["planTrainingLoad", "trainingLoad"], ["planPitch", "pitch"],
    ["distanceDisplayUnit", "distanceDisplayUnit"], ["exerciseBarChart", "exerciseBarChart"]]) {
    const value = at(calculation, from);
    if (value !== undefined && value !== null) result[to] = value;
  }
  const sets = at(calculation, "planSets");
  if (sets !== undefined && sets !== null) { result.sets = sets; result.totalSets = sets; }
  return result;
}

/** A new program's IDs, as `resetProgramForCreate` sets them before COROS calculates it. */
export function resetForCreate(program: JsonObject): JsonObject {
  const result = { ...program };
  delete result.exerciseBarChart;
  Object.assign(result, { id: "0", idInPlan: "0", authorId: "0", userId: "0", createTimestamp: 0, deleted: 0, status: 1, version: 0, star: 0, nickname: "" });
  const rows = (list(result.exercises) ?? []).map((row) => (isObject(row) ? { ...row } : {}));
  const ids = new Map<string, string>();
  rows.forEach((row, index) => {
    ids.set(text(row.id) ?? String(index + 1), String(index + 1));
    Object.assign(row, { id: String(index + 1), programId: "0", userId: 0, createTimestamp: 0, deleted: 0, status: 1, defaultOrder: index });
  });
  for (const row of rows) {
    const group = text(row.groupId) ?? "0";
    row.groupId = ids.get(group) ?? group;
  }
  result.exercises = rows;
  return result;
}

/** Puts a new workout on `day`; returns its `idInPlan`. COROS takes days from today on. */
export async function schedule(hub: TrainingHub, session: HubSession, workout: HubWorkout, day: HubDay, units: Units): Promise<string> {
  const program = await calculate(hub, session, resetForCreate(buildProgram(workout, null, units)));
  return put(hub, session, program, day);
}

/** Puts a program on `day` as a new calendar entry; returns its `idInPlan`. */
async function put(hub: TrainingHub, session: HubSession, program: JsonObject, day: HubDay): Promise<string> {
  const existing = await scheduled(hub, session, day, day);
  const idInPlan = existing.maxIdInPlan + 1;
  const entity: JsonObject = { happenDay: dayCode(day), idInPlan, sortNoInSchedule: existing.workouts.length + 1 };
  if (Array.isArray(program.exerciseBarChart)) entity.exerciseBarChart = program.exerciseBarChart;
  await hub.post("training/schedule/update", {
    entities: [entity], programs: [{ ...program, idInPlan }],
    versionObjects: [{ id: idInPlan, status: 1 }],
    pbVersion: int(program.pbVersion) ?? 2,
  }, session);
  return String(idInPlan);
}

/**
 * Replaces a scheduled workout's steps, name and description, keeping its place, plan and IDs. The entry is
 * read again from COROS first, so the edit lands on the program COROS has now.
 */
export async function update(hub: TrainingHub, session: HubSession, where: { day: HubDay; idInPlan: string; name: string }, workout: HubWorkout, units: Units): Promise<void> {
  const entry = await scheduledOne(hub, session, where.day, where.idInPlan, where.name);
  const program = await calculate(hub, session, buildProgram(attachSources(workout, entry.program), entry.program, units));
  await hub.post("training/schedule/update", {
    entities: [entry.entity], programs: [program],
    versionObjects: [{ id: entry.idInPlan, status: 2, planProgramId: entry.planProgramId, planId: entry.planId }],
    pbVersion: int(program.pbVersion) ?? 2,
  }, session);
}

/** Takes a workout off the calendar. Its library copy, if any, stays. */
export async function remove(hub: TrainingHub, session: HubSession, entry: ScheduledEntry): Promise<void> {
  await hub.post("training/schedule/update", {
    versionObjects: [{ id: entry.idInPlan, planProgramId: entry.planProgramId === "" ? entry.idInPlan : entry.planProgramId, planId: entry.planId, status: 3 }],
    pbVersion: int(entry.program.pbVersion) ?? 2,
  }, session);
}

export const moveDone = (move: HubMoveProgress): boolean => move.newIdInPlan !== null && move.removed;

/**
 * Takes `move` one step on, writing to COROS at most once, so a retry never repeats a write that went through:
 * it finds the workout, notes what's on the new day, copies it there, then removes it from the old day. A copy
 * whose answer was lost (a timeout after COROS took it) is recognised on the next try as the same-named workout
 * that wasn't on the new day before. Returns the progress after the step.
 */
export async function moveStep(hub: TrainingHub, session: HubSession, move: HubMoveProgress): Promise<HubMoveProgress> {
  if (move.newIdInPlan !== null) {
    if (move.removed) return move;
    const left = (await scheduled(hub, session, move.from, move.from)).workouts;
    const id = move.idInPlan ?? "";
    const old = left.find((entry) => (id === "" ? entry.name === move.name : entry.idInPlan === id));
    if (old) await remove(hub, session, old);
    return { ...move, removed: true };
  }
  const target = (await scheduled(hub, session, move.to, move.to)).workouts;
  const before = move.targetBefore;
  const copy = before ? target.find((entry) => entry.name === move.name && !before.includes(entry.idInPlan)) : undefined;
  if (copy) return { ...move, newIdInPlan: copy.idInPlan };
  const entry = await scheduledOne(hub, session, move.from, move.idInPlan, move.name);
  const found = { ...move, idInPlan: entry.idInPlan };
  if (entry.program.exercises === undefined) {
    throw new HubMoveFailed(new HubProblem(`COROS gave no steps for ${entry.name}, so C-LINK can't move it. Move it in the COROS app.`), found);
  }
  // Noted before the copy goes up, so a lost answer can be recognised.
  if (!before) return { ...found, targetBefore: target.map((other) => other.idInPlan) };
  try {
    return { ...found, newIdInPlan: await put(hub, session, entry.program, move.to) };
  } catch (error) {
    throw new HubMoveFailed(error, found);
  }
}

/**
 * Moves a scheduled workout to another day, keeping its program as COROS has it (any sport, plan workouts
 * too). Training Hub has no move, so it is added on the new day first and only then taken off its old day: a
 * failure part-way can leave it on both days but never loses it. A failure throws `HubMoveFailed` with the
 * progress; send that back as `move` to pick up where it stopped.
 */
export async function moveScheduled(hub: TrainingHub, session: HubSession, start: HubMoveProgress): Promise<HubMoveProgress> {
  let move = start;
  if (move.from === move.to) return { ...move, newIdInPlan: move.idInPlan, removed: true };
  for (let steps = 0; !moveDone(move); steps++) {
    if (steps > 8) throw new HubMoveFailed(new HubProblem("The move didn't finish. Try again."), move);
    try {
      move = await moveStep(hub, session, move);
    } catch (error) {
      throw error instanceof HubMoveFailed ? error : new HubMoveFailed(error, move);
    }
  }
  return move;
}

export function newMove(from: HubDay, to: HubDay, name: string, idInPlan: string | null): HubMoveProgress {
  return { from, to, name, idInPlan: idInPlan || null, targetBefore: null, newIdInPlan: null, removed: false };
}

// MARK: The COROS library

/** The athlete's saved workouts: a summary of each, sometimes without its steps (`/training/program/query`). */
export async function library(hub: TrainingHub, session: HubSession): Promise<HubSavedWorkout[]> {
  const programs = list(await hub.post("training/program/query", {}, session)) ?? [];
  return programs.map(toSaved).filter((saved): saved is HubSavedWorkout => saved !== null);
}

export function toSaved(program: Json): HubSavedWorkout | null {
  const id = word(at(program, "id"));
  if (id === undefined) return null;
  const sportCode = int(at(program, "sportType")) ?? null;
  const hasSteps = (list(at(program, "exercises")) ?? []).length > 0;
  const read = hasSteps ? readProgram(program) : null;
  const workout = read ? toWeb(read) : null;
  // Without readable steps, COROS's own totals for the program.
  const { seconds, meters, sets } = programTotals(program);
  const summary = { seconds, meters, sets };
  return {
    id, name: word(at(program, "name")) ?? "Workout", sportCode, sport: sportOfCode(sportCode ?? undefined),
    hasSteps, workout, totals: workout ? hubTotals(workout) : summary,
  };
}

/** One saved workout with its steps (`/training/program/detail`). */
export async function libraryProgram(hub: TrainingHub, session: HubSession, id: string): Promise<HubSavedWorkout> {
  const program = await hub.get("training/program/detail", { id, supportRestExercise: "1" }, session);
  const saved = isObject(program) && Array.isArray(program.exercises) ? toSaved({ ...program, id: word(program.id) ?? id }) : null;
  if (!saved) throw new HubProblem("COROS gave no steps for that saved workout.");
  return saved;
}

/**
 * Saves a new workout to the COROS workout library and returns its ID. COROS answers with the ID, or with
 * nothing: then the newest saved workout of that name is the one.
 */
export async function addToLibrary(hub: TrainingHub, session: HubSession, workout: HubWorkout, units: Units): Promise<string> {
  const program = await calculate(hub, session, resetForCreate(buildProgram(workout, null, units)));
  const answer = await hub.post("training/program/add", program, session);
  const given = word(answer) ?? word(at(answer, "id"));
  if (given !== undefined && given !== "0" && given !== "") return given;
  const named = (list(await hub.post("training/program/query", {}, session)) ?? []).filter((saved) => text(at(saved, "name")) === workout.name);
  const id = named.map((saved) => word(at(saved, "id"))).filter((value): value is string => value !== undefined).sort((x, y) => (x.length - y.length) || (x < y ? -1 : 1)).pop();
  if (id === undefined) throw new HubProblem("COROS took the workout but didn't say where it saved it. Look in your COROS workout library.");
  return id;
}

/** Takes a workout out of the COROS workout library. Calendar entries made from it stay. */
export async function removeFromLibrary(hub: TrainingHub, session: HubSession, id: string): Promise<void> {
  await hub.post("training/program/delete", [id] as unknown as JsonObject, session);
}
