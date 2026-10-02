import crypto from "node:crypto";
import { z } from "zod/v4";
import { corosProgramToWorkoutDraft, parseWorkoutEditorContext, type WorkoutEditSource } from "./corosWorkoutEditor";
import { encodeCorosIntensity, decodeCorosIntensity } from "./workoutCapabilities";
import type { StrengthStepPatch, StrengthEditItemPreview } from "./workoutEditTypes";

export const loadSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("bodyweight") }).strict(),
  z.object({ mode: z.literal("weight"), value: z.number().finite().min(0).max(2000), unit: z.enum(["kg", "lb"]) }).strict()
]);
export const strengthPatchSchema = z.object({
  stepId: z.string().min(1).max(200),
  sets: z.number().int().min(1).max(99).optional(),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("reps"), count: z.number().int().min(1).max(999) }).strict(),
    z.object({ type: z.literal("time"), seconds: z.number().int().min(1).max(86400) }).strict(),
    z.object({ type: z.literal("open") }).strict()
  ]).optional(),
  load: loadSchema.optional(),
  restSeconds: z.number().int().min(0).max(3600).optional()
}).strict();

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function sourceRevision(source: WorkoutEditSource): string {
  return crypto.createHash("sha256").update(stableJson(source)).digest("hex");
}
export function weightKg(value: number, unit: "kg" | "lb"): number {
  return Number((unit === "lb" ? value / 2.2046226218 : value).toFixed(2));
}
export function strengthSteps(program: Record<string, unknown>) {
  return corosProgramToWorkoutDraft(program).nodes.flatMap(n => n.nodeType === "repeat" ? n.steps : [n]);
}
function display(value: unknown): string {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.mode === "bodyweight") return "Bodyweight";
    if (v.mode === "weight") return `${v.value} ${v.unit}`;
    if (v.type === "reps") return `${v.count} reps`;
    if (v.type === "time") return `${v.seconds} seconds`;
    if (v.type === "open") return "Open";
  }
  return String(value ?? "Not set");
}

function sameNumber(raw: unknown, expected: number): boolean {
  return (typeof raw === "number" || typeof raw === "string" && raw.trim() !== "") &&
    Number.isFinite(Number(raw)) && Number(raw) === expected;
}

/** Patch the original payload, never round-trip unrelated fields through the editor. */
export function patchStrengthProgram(source: Record<string, unknown>, input: StrengthStepPatch[]) {
  const patches = z.array(strengthPatchSchema).min(1).max(200).parse(input);
  if (Number(source.sportType) !== 4) throw new Error("Only Strength workouts can use this edit tool.");
  const program = structuredClone(source);
  if (!Array.isArray(program.exercises)) throw new Error("Workout exercises are unavailable.");
  const exercises = program.exercises as Record<string, unknown>[];
  for (const exercise of exercises) {
    if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) throw new Error("Malformed exercise data cannot be edited safely.");
    for (const value of [exercise.id, exercise.originId, exercise.groupId]) {
      if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Exercise identity cannot be represented safely.");
    }
  }
  const steps = strengthSteps(source);
  const seen = new Set<string>();
  const changes: StrengthEditItemPreview["changes"] = [];
  const changedGroups = new Set<string>();
  for (const patch of patches) {
    if (seen.has(patch.stepId)) throw new Error("Combine changes to each step into one patch.");
    seen.add(patch.stepId);
    const matches = steps.filter(s => s.id === patch.stepId);
    const step = matches[0];
    if (matches.length !== 1 || !step?.editable || step.kind !== "training" || !step.sourceExerciseId) throw new Error("This strength step cannot be safely edited. Read the workout again.");
    const raws = exercises.filter(e => String(e.id) === step.sourceExerciseId && !e.isGroup);
    if (raws.length !== 1) throw new Error("Exercise identity is missing or ambiguous.");
    const raw = raws[0]!;
    const beforeRaw = stableJson(raw);
    const record = (field: string, before: unknown, after: unknown) => {
      if (stableJson(before) !== stableJson(after)) changes.push({ exercise: step.name, stepId: step.id, field, before: display(before), after: display(after) });
    };
    if (patch.sets !== undefined && !sameNumber(raw.sets, patch.sets)) { record("Sets", raw.sets, patch.sets); raw.sets = patch.sets; }
    if (patch.restSeconds !== undefined) {
      if (Number(raw.restType) !== 1) throw new Error("Only existing timed inter-set rest can be edited.");
      if (!sameNumber(raw.restValue, patch.restSeconds)) {
        record("Rest (seconds)", raw.restValue, patch.restSeconds); raw.restValue = patch.restSeconds;
      }
    }
    if (patch.target !== undefined) {
      const targetType = patch.target.type === "reps" ? 3 : patch.target.type === "time" ? 2 : 1;
      const targetValue = patch.target.type === "reps" ? patch.target.count : patch.target.type === "time" ? patch.target.seconds : 0;
      const same = Number(raw.targetType ?? 1) === targetType && (targetType === 1 || sameNumber(raw.targetValue, targetValue));
      if (!same) {
        const before = Number(raw.targetType) === 3 ? { type: "reps", count: Number(raw.targetValue) } : step.target;
        record("Target", before, patch.target);
        raw.targetType = targetType;
        raw.targetValue = targetValue;
        raw.targetDisplayUnit = 0;
        if (raw.groupId && String(raw.groupId) !== "0") changedGroups.add(String(raw.groupId));
      }
    }
    if (patch.load !== undefined) {
      const old = step.intensity;
      const same = old.type === "weight" && (old.mode === "bodyweight" && patch.load.mode === "bodyweight" || old.mode === "weight" && patch.load.mode === "weight" && Number(raw.intensityValue) === weightKg(patch.load.value, patch.load.unit));
      if (!same) {
        const encoded = encodeCorosIntensity({ type: "weight", ...patch.load }, parseWorkoutEditorContext({}, "metric"));
        // Only strength-load fields; do not reset unrelated intensity metadata.
        for (const key of ["intensityType", "intensityCustom", "intensityValue", "intensityValueExtend", "intensityDisplayUnit"]) {
          if (encoded[key] !== undefined) raw[key] = encoded[key];
        }
        record("Load", old, decodeCorosIntensity(raw).intensity);
      }
    }
    if (beforeRaw === stableJson(raw) && !Object.keys(patch).some(k => k !== "stepId")) throw new Error("A step patch must contain a change.");
  }
  for (const id of changedGroups) {
    const groups = exercises.filter(e => e.isGroup && String(e.id) === id);
    if (groups.length !== 1) throw new Error("Repeat group identity is ambiguous.");
    const children = exercises.filter(e => !e.isGroup && String(e.groupId) === id);
    if (children.some(e => ![1, 2, 3].includes(Number(e.targetType)))) throw new Error("This repeat group has an unsupported target; its targets cannot be changed safely.");
    Object.assign(groups[0]!, { targetType: 2, targetValue: children.reduce((sum, e) => sum + (Number(e.targetType) === 2 ? Number(e.targetValue) : 0), 0), targetDisplayUnit: 0 });
  }
  return { program, changes };
}

/** Ignore server-owned metrics/versions while verifying the entire exercise prescription. */
export function prescriptionMatches(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  const normalize = (program: Record<string, unknown>) => ({
    name: program.name, overview: program.overview, sportType: program.sportType,
    exercises: Array.isArray(program.exercises) ? program.exercises.map(e => {
      const copy = { ...e };
      for (const key of ["version", "updateTimestamp", "modifyTimestamp", "createTimestamp"]) delete copy[key];
      return copy;
    }).sort((a, b) => String(a.id).localeCompare(String(b.id))) : null
  });
  return stableJson(normalize(expected)) === stableJson(normalize(actual));
}

export function classifyStrengthCalendarOwnership(planId: string, inventory: unknown): "independent" | "native" | "unknown" {
  if (!Array.isArray(inventory) || inventory.some(p =>
    !p || typeof p !== "object" || Array.isArray(p) ||
    !(typeof p.id === "string" && p.id.trim() !== "" || typeof p.id === "number" && Number.isSafeInteger(p.id))
  )) return "unknown";
  if (inventory.some(p => String(p.id ?? "") === planId && !["", "0"].includes(planId))) return "native";
  // Without a verified occurrence-level ownership marker, an installed plan makes
  // the join ambiguous. An explicitly unscheduled inventory establishes independence.
  if (inventory.some(p => p.inSchedule !== 0 && p.inSchedule !== "0")) return "unknown";
  return "independent";
}

/** Calculation may only supply the derived fields merged by applyWorkoutCalculation. */
export function calculationPreservesProgram(expected: Record<string, unknown>, calculated: Record<string, unknown>): boolean {
  const withoutDerived = (program: Record<string, unknown>) => {
    const copy = { ...program };
    for (const key of ["distance", "duration", "trainingLoad", "sets", "totalSets", "pitch", "distanceDisplayUnit", "exerciseBarChart"]) delete copy[key];
    return copy;
  };
  return stableJson(withoutDerived(expected)) === stableJson(withoutDerived(calculated));
}
