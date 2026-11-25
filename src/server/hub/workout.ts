// A workout turned into the program COROS Training Hub stores, and read back. Ported from HubWorkout.swift
// (itself a port of CorosLink for Mac's corosWorkoutBuilder.ts / corosWorkoutEditor.ts).
//
// The browser never holds COROS's own exercise rows. A step read from COROS carries its row's `id`; when an edit
// comes back, `attachSources` finds the rows again in the program COROS has now, so the fields this editor
// doesn't know survive a save exactly as they do in the phone app.
import type {
  HubClimbSystem, HubExercise, HubIntensity, HubSport, HubStepKind, HubStepTarget, HubStroke, HubWorkout, HubWorkoutBlock, HubWorkoutStep,
} from "@/data/hub";
import { HubProblem } from "./errors";
import { at, int, isObject, list, num, round, word, type Json, type JsonObject } from "./json";
import {
  CLIMB_SYSTEM_ID, HUB_CLIMB_GRADES, SPORT_CODE, defaultGradeSystem, hubWorkoutProblem, isClimb, isFunctional, sportOfCode, usesExercises,
} from "./rules";

/** A step with the COROS exercise it was read from. */
export type SourcedStep = HubWorkoutStep & { source?: JsonObject };
export type SourcedBlock = Omit<HubWorkoutBlock, "steps"> & { steps: SourcedStep[]; source?: JsonObject };
export type SourcedWorkout = Omit<HubWorkout, "blocks"> & { blocks: SourcedBlock[] };

const GROUP_SPACING = 16_777_216;
const CHILD_SPACING = 65_536;

const PB_VERSION: Record<HubSport, number> = {
  run: 2, bike: 2, swim: 2, strength: 2, trailRun: 4, indoorClimb: 7, bouldering: 7, xcSki: 9, hyrox: 9,
};
/** Training Hub's exerciseType (3 is cool-down and 4 rest here, unlike MCP's sectionType). */
const EXERCISE_TYPE: Record<HubStepKind, number> = { warmup: 1, training: 2, cooldown: 3, rest: 4 };
/** COROS's targetType. */
const TARGET_CODE: Record<HubStepTarget, number> = { open: 1, time: 2, reps: 3, distance: 5, load: 6, hrRecovery: 7, elevationGain: 8, routes: 9 };
/** `SWIM_STROKE_IDS`. */
const STROKE_ID: Record<HubStroke, number> = { freestyle: 1, breaststroke: 2, backstroke: 3, butterfly: 4, drills: 6, individualMedley: 7, mix: 255 };

const systemOf = (workout: { sport: HubSport; gradeSystem?: HubClimbSystem }): HubClimbSystem => workout.gradeSystem ?? defaultGradeSystem(workout.sport);
const climbSystem = (id: number | undefined): HubClimbSystem | undefined =>
  (Object.keys(CLIMB_SYSTEM_ID) as HubClimbSystem[]).find((system) => CLIMB_SYSTEM_ID[system] === id);

// MARK: Writing a COROS program

export interface Units {
  /** Miles, yards and feet for the units COROS shows distances and paces in. */
  imperial?: boolean;
  /** Pounds for weights; as `imperial` when left out. */
  pounds?: boolean;
}

/**
 * The program for `/training/program/calculate` and `/training/schedule/update`. With `source` (the program
 * COROS has), its own fields stay (IDs, plan links, anything this editor doesn't know), and so does each
 * step's own exercise where it came from one.
 */
export function buildProgram(workout: SourcedWorkout, source: JsonObject | null = null, units: Units = {}): JsonObject {
  const imperial = units.imperial ?? false;
  const pounds = units.pounds ?? imperial;
  const problem = hubWorkoutProblem(workout, (step) => (step as SourcedStep).source !== undefined);
  if (problem) throw new HubProblem(problem, "workout");
  const sport = workout.sport;

  const exercises: JsonObject[] = [];
  let nextID = 0;
  const usedIDs = new Set<number>();
  const existing = list(at(source ?? undefined, "exercises"));
  if (existing) nextID = Math.max(0, ...existing.map((row) => int(at(row, "id")) ?? 0));
  const allocate = (reused: JsonObject | undefined): number => {
    const id = reused ? int(reused.id) : undefined;
    if (id !== undefined && !usedIDs.has(id)) { usedIDs.add(id); return id; }
    nextID += 1;
    while (usedIDs.has(nextID)) nextID += 1;
    usedIDs.add(nextID);
    return nextID;
  };

  let totalDistance = 0, totalTime = 0;
  workout.blocks.forEach((block, index) => {
    const sortBase = GROUP_SPACING * (index + 1);
    if (block.repeats !== null && block.repeats !== undefined) {
      const groupID = allocate(block.source);
      const children: JsonObject[] = [];
      let groupDistance = 0, groupTime = 0;
      block.steps.forEach((step, childIndex) => {
        const built = buildExercise(workout, step, allocate(step.source), sortBase + CHILD_SPACING * (childIndex + 1), String(groupID), imperial, pounds);
        children.push(built.exercise);
        groupDistance += built.distance;
        groupTime += built.time;
      });
      const byDistance = groupDistance > 0;
      const group: JsonObject = { ...(block.source ?? {}) };
      Object.assign(group, {
        id: groupID, name: word(group.name) ?? "Interval Group",
        exerciseType: 0, sportType: SPORT_CODE[sport],
        intensityType: 0, intensityValue: 0,
        targetType: byDistance ? 5 : 2, targetValue: byDistance ? groupDistance : groupTime,
        targetDisplayUnit: byDistance ? distanceUnit(sport, groupDistance / 100, imperial) : 0,
        sets: block.repeats, sortNo: sortBase,
        restType: num(group.restType) ?? 3, restValue: num(group.restValue) ?? 0,
        groupId: "0", isGroup: true, originId: group.originId ?? "0",
        overview: word(group.overview) ?? overview(sport, "training", byDistance ? "distance" : "time"),
      });
      exercises.push(group, ...children);
      totalDistance += groupDistance * block.repeats;
      totalTime += groupTime * block.repeats;
    } else if (block.steps.length > 0) {
      const step = block.steps[0];
      const built = buildExercise(workout, step, allocate(step.source), sortBase, "0", imperial, pounds);
      exercises.push(built.exercise);
      totalDistance += built.distance;
      totalTime += built.time;
    }
  });

  const byDistance = totalDistance > 0;
  const sourcePB = (source ? int(source.pbVersion) : undefined) ?? 0;
  const pbVersion = Math.max(
    sourcePB, PB_VERSION[sport],
    exercises.some((row) => int(row.intensityType) === 8) ? 3 : 0,
    exercises.some((row) => [6, 7].includes(int(row.intensityCustom) ?? 0)) ? 5 : 0,
    exercises.some((row) => int(row.intensityType) === 9) ? 6 : 0,
  );
  let referExercise: JsonObject =
    sport === "swim" || sport === "strength" ? { intensityType: 0, hrType: 0 }
    : isClimb(sport) ? { intensityType: 10, hrType: 0 }
    : { intensityType: 0, hrType: 0, valueType: 0 };
  let program: JsonObject;
  if (source) {
    program = { ...source };
    const kept = source.referExercise;
    if (isObject(kept) && int(source.sportType) === SPORT_CODE[sport]) referExercise = { ...kept };
  } else {
    program = {
      id: "0", idInPlan: "0", authorId: "0", userId: "0",
      createTimestamp: 0, deleted: 0, status: 1, version: 0,
      subType: 65535,
      simple: false, access: 1, essence: 0, originEssence: 0,
      type: 0, unit: 0,
    };
  }
  if (isClimb(sport)) {
    referExercise.gradeSystem = CLIMB_SYSTEM_ID[systemOf(workout)];
    program.gradeSystemVersion = num(program.gradeSystemVersion) ?? 1;
  }
  program.referExercise = referExercise;
  if (sport === "swim" && workout.poolLength !== undefined) {
    // Centimetres of the length in metres, as CorosLink's builder writes a pool the athlete typed.
    program.poolLengthId = 0;
    program.poolLength = round(workout.poolLength * 100);
    program.poolLengthUnit = num(program.poolLengthUnit) ?? 2;
  } else if (sport === "swim" && (!source || program.poolLength === undefined)) {
    program.poolLengthId = 0;
    program.poolLength = imperial ? 2286 : 2500;
    program.poolLengthUnit = imperial ? 4 : 2;
  }
  program.name = prefix(workout.name.trim(), 80);
  program.sportType = SPORT_CODE[sport];
  program.pbVersion = pbVersion;
  program.estimatedTime = totalTime;
  program.estimatedDistance = totalDistance;
  program.distanceDisplayUnit = sport === "swim" ? (imperial ? 4 : 2) : (imperial ? 3 : 1);
  program.estimatedType = byDistance ? 6 : 0;
  program.targetType = byDistance ? 5 : 2;
  program.targetValue = byDistance ? totalDistance : totalTime;
  program.overview = prefix(workout.description.trim(), 300);
  program.exerciseNum = exercises.length;
  program.totalSets = exercises.length;
  program.exercises = exercises;
  return program;
}

/** The first `count` characters, never cutting a character in two. */
function prefix(value: string, count: number): string {
  return Array.from(value).slice(0, count).join("");
}

function buildExercise(workout: SourcedWorkout, step: SourcedStep, id: number, sortNo: number, groupID: string, imperial: boolean, pounds: boolean):
  { exercise: JsonObject; distance: number; time: number } {
  const sport = workout.sport;
  let targetValue: number, targetUnit: number;
  switch (step.target) {
    case "distance": {
      const meters = step.meters ?? 0;
      targetValue = round(meters * 100); targetUnit = distanceUnit(sport, meters, imperial);
      break;
    }
    case "elevationGain": targetValue = round((step.meters ?? 0) * 100); targetUnit = imperial ? 5 : 2; break;
    case "time": targetValue = round(step.seconds ?? 0); targetUnit = 0; break;
    case "open": targetValue = 0; targetUnit = 0; break;
    case "reps": case "routes": targetValue = step.count ?? 1; targetUnit = 0; break;
    case "load": targetValue = step.load ?? 0; targetUnit = 0; break;
    case "hrRecovery": targetValue = step.bpm ?? 0; targetUnit = 0; break;
  }
  const functional = isFunctional(step, sport);
  // Strength steps all rest COROS's way (rest type 1, seconds), as `buildRunExercise` writes them.
  const strengthLike = sport === "strength" || functional;
  const exercise: JsonObject = step.source ? { ...step.source } : {
    access: 0, createTimestamp: 0, deleted: 0, equipment: [1],
    part: [0], sourceId: "0", sourceUrl: "", status: 1,
    userId: 0, videoUrl: "", originId: "0", sets: 1,
    restType: strengthLike ? 1 : 3, restValue: strengthLike ? 60 : 0,
  };
  const defaultName = { warmup: "Warm-up", cooldown: "Cool-down", rest: "Rest", training: "Training" }[step.kind];
  const sourceOrigin = step.source ? word(step.source.originId) : undefined;
  const sameExercise = step.exercise !== undefined && step.exercise.id === sourceOrigin;
  // The step had a catalog exercise and no longer does (made a rest, or a HYROX station made a run): drop it.
  const droppedExercise = usesExercises(sport) && step.exercise === undefined && (sourceOrigin ?? "0") !== "0";
  if (droppedExercise) {
    exercise.originId = "0";
    exercise.overview = strengthLike ? "sid_strength_training" : overview(sport, step.kind, step.target);
  }
  // A catalog exercise keeps COROS's own name (a code the watch translates) while it stays the same exercise.
  const name: string = (step.name?.trim() || undefined)
    ?? (sameExercise || (step.source !== undefined && step.exercise === undefined && !droppedExercise) ? word(exercise.name) : undefined)
    ?? (droppedExercise ? defaultName : undefined)
    ?? step.exercise?.code ?? step.exercise?.name
    ?? (step.source === undefined ? defaultName : word(exercise.name) ?? defaultName);
  Object.assign(exercise, {
    id, defaultOrder: sortNo,
    isDefaultAdd: step.kind === "training" ? 1 : 0, name: prefix(name, 60),
    exerciseType: EXERCISE_TYPE[step.kind], sportType: SPORT_CODE[sport],
    subType: sport === "hyrox" && functional ? 2 : 0,
    targetType: TARGET_CODE[step.target], targetValue,
    targetDisplayUnit: targetUnit, sortNo,
    groupId: groupID, isGroup: false,
  });
  if (step.exercise && !sameExercise) exercise.originId = step.exercise.id;
  if (usesExercises(sport)) {
    if (step.exercise?.kind !== undefined) exercise.exerciseKind = step.exercise.kind;
    if (sport === "hyrox") {
      if (functional) exercise.hyroxTrainingMode = "strength";
      else {
        delete exercise.hyroxTrainingMode;
        exercise.exerciseKind = 0;
      }
    }
  }
  if (functional) {
    exercise.sets = step.sets ?? 1;
    exercise.restType = 1;
    exercise.restValue = round(step.restSeconds ?? 60);
  } else if (step.kind === "rest") {
    exercise.sets = 1;
    exercise.restType = 3;
  } else {
    exercise.sets = 1;
  }
  if (strengthLike && step.exercise) {
    // The exercise's own description code. COROS reads `sid_strength_training` as its nameless "Training"
    // placeholder, whatever the name says, so a real exercise never carries it.
    if (!sameExercise || word(exercise.overview) === "sid_strength_training") exercise.overview = step.exercise.overview ?? "";
  } else if (step.source === undefined || word(exercise.overview) === undefined) {
    exercise.overview = strengthLike ? "sid_strength_training" : overview(sport, step.kind, step.target);
  }
  if (step.intensity.kind !== "kept") Object.assign(exercise, encodeIntensity(step.intensity, systemOf(workout), imperial, pounds));
  return { exercise, distance: step.target === "distance" ? targetValue : 0, time: step.target === "time" ? targetValue : 0 };
}

/** COROS's targetDisplayUnit: 1 km, 2 m, 3 mi, 4 yd. */
function distanceUnit(sport: HubSport, meters: number, imperial: boolean): number {
  if (sport === "swim") return imperial ? 4 : 2;
  if (imperial) return 3;
  return meters < 1000 ? 2 : 1;
}

function overview(sport: HubSport, kind: HubStepKind, target: HubStepTarget): string {
  const byDistance = target === "distance";
  switch (sport) {
    case "swim":
      return kind === "warmup" ? "sid_poolswim_warm_up_dist" : kind === "training" ? "sid_poolswim_dist_default" : "sid_poolswim_cool_down_dist";
    case "bike":
      return kind === "warmup" ? "sid_bike_warm_up_dist" : kind === "training" ? "sid_bike_dist_speed" : "sid_bike_cool_down_dist";
    case "strength":
      return "sid_strength_training";
    default:
      switch (kind) {
        case "warmup": return byDistance ? "sid_run_warm_up_dist" : "sid_run_warm_up";
        case "cooldown": return byDistance ? "sid_run_cool_down_dist" : "sid_run_cool_down";
        case "rest": return byDistance ? "sid_run_rest_dist" : "sid_run_rest";
        case "training": return "sid_run_training";
      }
  }
}

/** `encodeCorosIntensity` for the kinds this editor writes. */
export function encodeIntensity(intensity: HubIntensity, system: HubClimbSystem, imperial: boolean, pounds: boolean): JsonObject {
  const fields: JsonObject = {
    intensityType: 0, hrType: 0, intensityCustom: 0, intensityValue: 0, intensityValueExtend: 0,
    intensityDisplayUnit: 0, intensityMultiplier: 0, intensityPercent: 0, intensityPercentExtend: 0,
    isIntensityPercent: false,
  };
  const a = intensity.low ?? 0, b = intensity.high ?? intensity.low ?? 0;
  const low = Math.min(a, b), high = Math.max(a, b);
  switch (intensity.kind) {
    case "none": case "kept": break;
    case "heartRate":
      // 2 is absolute heart rate as well as HR reserve; the percent flag tells them apart.
      fields.intensityType = 2; fields.hrType = 2;
      fields.intensityValue = round(low); fields.intensityValueExtend = round(high);
      break;
    case "pace":
      fields.intensityType = 3; fields.intensityMultiplier = 1000; fields.intensityDisplayUnit = imperial ? 2 : 1;
      fields.intensityValue = round(low * 1000); fields.intensityValueExtend = round(high * 1000);
      break;
    case "power":
      fields.intensityType = 6; fields.intensityValue = round(low); fields.intensityValueExtend = round(high);
      break;
    case "speed":
      fields.intensityType = 4; fields.intensityDisplayUnit = imperial ? 5 : 4;
      fields.intensityValue = round(low * 100); fields.intensityValueExtend = round(high * 100);
      break;
    case "cadence":
      fields.intensityType = 7; fields.intensityValue = round(low); fields.intensityValueExtend = round(high);
      fields.intensityPercent = round(low * 1000); fields.intensityPercentExtend = round(high * 1000);
      break;
    case "stroke":
      fields.intensityType = 5; fields.intensityValue = STROKE_ID[intensity.stroke ?? "freestyle"];
      break;
    case "bodyweight":
      fields.intensityType = 1; fields.intensityCustom = 1;
      break;
    case "weight": {
      // COROS keeps a weight in grams, whichever unit it shows.
      fields.intensityType = 1; fields.intensityValue = round((intensity.low ?? 0) * 1000);
      fields.intensityDisplayUnit = pounds ? 7 : 6;
      break;
    }
    case "rpe":
      fields.intensityType = 11; fields.intensityValue = round(intensity.low ?? 5);
      break;
    case "grade":
      fields.intensityType = 10;
      fields.gradeSystem = CLIMB_SYSTEM_ID[system];
      if (intensity.gradeOffset !== undefined) {
        fields.onsightGradeOffset = 32 + intensity.gradeOffset;
      } else {
        fields.onsightGradeOffset = 0;
        fields.intensityValue = HUB_CLIMB_GRADES[system].indexOf(intensity.grade ?? "") + 1;
      }
      break;
  }
  return fields;
}

// MARK: Reading a COROS program

/**
 * The workout a COROS program holds, for editing; null when it has a sport or steps this editor can't write
 * (swim send-offs…). Steps keep their COROS exercise, so what the editor can't show survives a save.
 */
export function readProgram(program: Json | undefined): SourcedWorkout | null {
  const sport = sportOfCode(int(at(program, "sportType")));
  if (!sport) return null;
  const exercises = (list(at(program, "exercises")) ?? []).filter(isObject)
    .sort((x, y) => (num(x.sortNo) ?? 0) - (num(y.sortNo) ?? 0));
  const groups: SourcedBlock[] = [];
  const groupIndex = new Map<string, number>();
  for (const exercise of exercises) {
    if (exercise.isGroup !== true) continue;
    const id = word(exercise.id);
    if (id === undefined) continue;
    groupIndex.set(id, groups.length);
    groups.push({ id, repeats: Math.max(1, Math.min(99, int(exercise.sets) ?? 1)), steps: [], source: exercise });
  }
  let system: HubClimbSystem | undefined;
  if (isClimb(sport)) {
    system = climbSystem(int(at(at(program, "referExercise"), "gradeSystem")))
      ?? exercises.map((row) => climbSystem(int(row.gradeSystem))).find((found) => found !== undefined)
      ?? defaultGradeSystem(sport);
  }
  const ordered: { sort: number; block: SourcedBlock }[] = [];
  for (const exercise of exercises) {
    if (exercise.isGroup === true) continue;
    const step = readStep(exercise, sport, system ?? "yds");
    if (!step) return null;
    const group = word(exercise.groupId) ?? "0";
    const index = group !== "0" ? groupIndex.get(group) : undefined;
    if (index !== undefined) groups[index].steps.push(step);
    else ordered.push({ sort: num(exercise.sortNo) ?? 0, block: { repeats: null, steps: [step] } });
  }
  for (const [id, index] of groupIndex) {
    if (groups[index].steps.length === 0) continue;
    const row = exercises.find((exercise) => word(exercise.id) === id);
    ordered.push({ sort: (row ? num(row.sortNo) : undefined) ?? 0, block: groups[index] });
  }
  ordered.sort((x, y) => x.sort - y.sort);
  const pool = sport === "swim" ? num(at(program, "poolLength")) : undefined;
  return {
    name: word(at(program, "name")) ?? "", sport, description: word(at(program, "overview")) ?? "",
    blocks: ordered.map((entry) => entry.block), ...(system ? { gradeSystem: system } : {}),
    ...(pool !== undefined && pool > 0 ? { poolLength: pool / 100 } : {}),
  };
}

function readStep(exercise: JsonObject, sport: HubSport, system: HubClimbSystem): SourcedStep | null {
  const exerciseType = int(exercise.exerciseType) ?? 2;
  // Swim send-offs aren't editable here.
  if (sport === "swim" && (exerciseType === 5 || (exerciseType === 2 && int(exercise.subType) === 1))) return null;
  const kind = (Object.keys(EXERCISE_TYPE) as HubStepKind[]).find((candidate) => EXERCISE_TYPE[candidate] === exerciseType);
  if (!kind) return null;
  const value = num(exercise.targetValue) ?? 0;
  const base = { kind, intensity: { kind: "none" } as HubIntensity };
  let step: SourcedStep;
  switch (int(exercise.targetType) ?? 1) {
    case 1: step = { ...base, target: "open" }; break;
    case 2: step = { ...base, target: "time", seconds: value }; break;
    case 3: step = { ...base, target: "reps", count: round(value) }; break;
    case 5: step = { ...base, target: "distance", meters: value / 100 }; break;
    case 6: step = { ...base, target: "load", load: round(value) }; break;
    case 7:
      if (kind !== "rest") return null;
      step = { ...base, target: "hrRecovery", bpm: round(value) };
      break;
    case 8: step = { ...base, target: "elevationGain", meters: value / 100 }; break;
    case 9: step = { ...base, target: "routes", count: round(value) }; break;
    default: return null;
  }
  // COROS's catalog names are codes ("T1234") the watch translates; show the exercise's own name instead.
  const rawName = word(exercise.name);
  if (rawName !== undefined && !isCatalogCode(rawName)) step.name = rawName;
  const origin = word(exercise.originId);
  if (usesExercises(sport) && kind === "training" && origin !== undefined && origin !== "0") {
    const kindCode = int(exercise.exerciseKind);
    step.exercise = { id: origin, name: exerciseName(exercise) ?? rawName ?? origin, ...(kindCode !== undefined && kindCode > 0 ? { kind: kindCode } : {}) };
    if (step.name === step.exercise.name) delete step.name;
  }
  if (isFunctional(step, sport)) {
    step.sets = Math.max(1, int(exercise.sets) ?? 1);
    const rest = int(exercise.restType) === 1 ? num(exercise.restValue) : undefined;
    if (rest !== undefined) step.restSeconds = rest;
  }
  step.intensity = decodeIntensity(exercise, system);
  step.source = exercise;
  const id = word(exercise.id);
  if (id !== undefined) step.id = id;
  return step;
}

/** The intensity this editor can show, or `kept`. */
export function decodeIntensity(exercise: JsonObject, system: HubClimbSystem = "yds"): HubIntensity {
  const type = int(exercise.intensityType) ?? 0;
  const percent = exercise.isIntensityPercent === true;
  const custom = int(exercise.intensityCustom) ?? 0;
  const low = num(exercise.intensityValue) ?? 0, high = num(exercise.intensityValueExtend) ?? low;
  switch (type) {
    case 0: return { kind: "none" };
    case 1: {
      if (custom === 1) return { kind: "bodyweight" };
      // Grams. A value too small to be grams is plain kilograms from a save made before this was known.
      const smallest = int(exercise.intensityDisplayUnit) === 7 ? 226 : 500;
      return { kind: "weight", low: low > 0 && low < smallest ? low : round(low / 10) / 100 };
    }
    case 2: if (!percent && low > 0) return { kind: "heartRate", low, high }; break;
    case 3: if (!percent && low > 0) {
      const given = num(exercise.intensityMultiplier);
      const multiplier = given !== undefined && given > 0 ? given : 1000;
      const divisor = [multiplier, 1].find((d) => [low, high].every((v) => v / d >= 60 && v / d <= 3600));
      if (divisor === undefined) return { kind: "kept" };
      return { kind: "pace", low: Math.min(low, high) / divisor, high: Math.max(low, high) / divisor };
    } break;
    case 4: if (low > 0) return { kind: "speed", low: low / 100, high: high / 100 }; break;
    case 5: {
      const stroke = (Object.keys(STROKE_ID) as HubStroke[]).find((candidate) => STROKE_ID[candidate] === Math.trunc(low));
      return stroke ? { kind: "stroke", stroke } : { kind: "kept" };
    }
    case 6: if (custom === 0 && low > 0) return { kind: "power", low, high }; break;
    case 7: if (low > 0) return { kind: "cadence", low, high }; break;
    case 10: {
      const offset = int(exercise.onsightGradeOffset) ?? 0;
      if (offset !== 0) return { kind: "grade", gradeOffset: offset - 32 };
      const grades = HUB_CLIMB_GRADES[climbSystem(int(exercise.gradeSystem)) ?? system];
      const grade = grades[round(low) - 1];
      return grade !== undefined ? { kind: "grade", grade } : { kind: "kept" };
    }
    case 11: return { kind: "rpe", low: round(low > 0 ? low : custom > 0 ? custom : 5) };
  }
  return { kind: "kept" };
}

export function isCatalogCode(name: string): boolean {
  return /^[TS]\d+$/i.test(name);
}

/** A catalog row's readable name: a display name, else its `sid_strength_…` overview made into words. */
export function exerciseName(row: Json): string | undefined {
  const humanized = (value: string | undefined): string | undefined => {
    const found = value === undefined ? null : /^sid_[a-z]+_/i.exec(value);
    if (!found || value === undefined) return undefined;
    const words = value.slice(found[0].length).replace(/_/g, " ").trim();
    return words === "" ? undefined : words.replace(/\S+/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  };
  for (const key of ["displayName", "exerciseName", "nameText", "name"]) {
    const value = word(at(row, key))?.trim();
    if (!value) continue;
    const words = humanized(value);
    if (words) return words;
    if (!isCatalogCode(value)) return value;
  }
  return humanized(word(at(row, "overview"))) ?? word(at(row, "name"));
}

/** The exercises in a `/training/exercise/query` answer, by readable name, one per ID. */
export function readCatalog(raw: Json | undefined): HubExercise[] {
  const rows: JsonObject[] = [];
  const walk = (value: Json | undefined, depth: number): void => {
    if (depth >= 6 || value === undefined) return;
    if (Array.isArray(value)) { value.forEach((item) => walk(item, depth + 1)); return; }
    if (!isObject(value)) return;
    const hasID = ["id", "originId", "exerciseId"].some((key) => at(value, key) !== undefined);
    const hasName = ["name", "nameText", "displayName", "exerciseName"].some((key) => at(value, key) !== undefined);
    if (hasID && hasName) rows.push(value);
    for (const key of ["list", "rows", "data", "exercises", "records"]) walk(at(value, key), depth + 1);
  };
  walk(raw, 0);
  const seen = new Set<string>();
  const result: HubExercise[] = [];
  for (const row of rows) {
    const id = [row.originId, row.exerciseId, row.id].map((value) => word(value)).find((value) => value !== undefined && value !== "0");
    const name = exerciseName(row);
    if (id === undefined || name === undefined || seen.has(id)) continue;
    seen.add(id);
    const kind = int(row.exerciseKind);
    const code = word(row.name), described = word(row.overview);
    result.push({
      id, name, ...(kind !== undefined && kind > 0 ? { kind } : {}),
      ...(code !== undefined && isCatalogCode(code) ? { code } : {}),
      ...(described !== undefined && described.startsWith("sid_") && described !== "sid_strength_training" ? { overview: described } : {}),
    });
  }
  return result.sort((x, y) => x.name.localeCompare(y.name, "en", { sensitivity: "accent" }));
}

// MARK: Between the browser's workout and COROS's rows

/** The workout as the browser gets it: COROS's rows left behind, each step and repeat keeping its row's `id`. */
export function toWeb(workout: SourcedWorkout): HubWorkout {
  return {
    ...workout,
    blocks: workout.blocks.map((block) => {
      const { source: _group, steps, ...rest } = block;
      void _group;
      return {
        ...rest,
        steps: steps.map((step) => {
          const { source: _row, ...plain } = step;
          void _row;
          return plain;
        }),
      };
    }),
  };
}

/**
 * An edited workout from the browser with COROS's rows put back: a step or repeat whose `id` is a row of
 * `program` (the program COROS has now) takes that row as its source; the rest are new.
 */
export function attachSources(workout: HubWorkout, program: Json | undefined): SourcedWorkout {
  const rows = new Map<string, JsonObject>();
  for (const row of list(at(program, "exercises")) ?? []) {
    const id = isObject(row) ? word(row.id) : undefined;
    if (isObject(row) && id !== undefined && !rows.has(id)) rows.set(id, row);
  }
  const find = (id: string | undefined, group: boolean): JsonObject | undefined => {
    const row = id === undefined ? undefined : rows.get(id);
    return row && (row.isGroup === true) === group ? row : undefined;
  };
  return {
    ...workout,
    blocks: workout.blocks.map((block): SourcedBlock => {
      const source = block.repeats !== null && block.repeats !== undefined ? find(block.id, true) : undefined;
      return {
        ...block,
        ...(source ? { source } : {}),
        steps: block.steps.map((step): SourcedStep => {
          const row = find(step.id, false);
          return row ? { ...step, source: row } : { ...step };
        }),
      };
    }),
  };
}
