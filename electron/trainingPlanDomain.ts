import type {
  PlanWorkoutEntryInput,
  PlanDraftPreview,
  RunWorkoutCreateRepeatGroup,
  RunWorkoutCreateStep,
  RunWorkoutStepInput,
  TrainingPlanDocument,
  TrainingPlanEntry,
  TrainingPlanGenerationRequest,
  TrainingPlanPhase,
  WorkoutSport
} from "./types";

export interface TrainingPlanValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface TrainingPlanWeekSummary {
  weekIndex: number;
  workouts: number;
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
}

export interface TrainingPlanSummary {
  planId: string;
  name: string;
  weekCount: number;
  workouts: number;
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
  strengthSets: number;
  restDays: number;
  sportDistribution: Partial<Record<WorkoutSport, number>>;
  intensityDistribution: Record<string, number>;
  weekly: TrainingPlanWeekSummary[];
  longestWorkout?: { name: string; durationSeconds: number; distanceMeters: number };
  peakWeek?: number;
  taperDetected: boolean;
  conflictCount: number;
}

export interface TrainingPlanComparison {
  summaries: TrainingPlanSummary[];
  sharedWorkoutNames: string[];
  insights: string[];
}

const SPORT_BY_TYPE: Record<number, WorkoutSport> = {
  1: "run",
  2: "bike",
  3: "swim",
  4: "strength",
  5: "trailRun",
  6: "indoorClimb",
  7: "bouldering",
  8: "xcSki",
  9: "hyrox"
};

export function workoutSportFromType(value?: number): WorkoutSport | undefined {
  return value === undefined ? undefined : SPORT_BY_TYPE[value];
}

function isoNow(): string {
  return new Date().toISOString();
}

function uniqueId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}

function normalizedPlanDate(value: string): Date | undefined {
  const digits = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) return undefined;
  const date = new Date(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)) - 1,
    Number(digits.slice(6, 8)),
    12
  );
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function dayOffset(startDate: string, value: string): number | undefined {
  const start = normalizedPlanDate(startDate);
  const date = normalizedPlanDate(value);
  if (!start || !date) return undefined;
  return Math.round((date.valueOf() - start.valueOf()) / 86_400_000);
}

export function trainingPlanFromDraftPreview(
  preview: PlanDraftPreview,
  request: TrainingPlanGenerationRequest
): TrainingPlanDocument {
  if (!request.goal.trim()) throw new Error("Add a training goal before generating a plan.");
  if (request.weeks < 1 || request.weeks > 24) throw new Error("Generated plans must contain 1 to 24 weeks.");
  if (request.sessionsPerWeek < 1 || request.sessionsPerWeek > 7) throw new Error("Sessions per week must be between 1 and 7.");
  if (request.sports.length === 0) throw new Error("Choose at least one sport.");
  if (request.availableDayIndexes.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Available days must be Monday through Sunday.");
  if (request.availableDayIndexes.length < request.sessionsPerWeek) throw new Error("Choose at least as many available days as weekly sessions.");
  if (request.maxSessionMinutes !== undefined && request.maxSessionMinutes <= 0) throw new Error("The session-duration limit must be greater than zero.");
  const start = normalizedPlanDate(request.startDate);
  if (!start || start.getDay() !== 1) throw new Error("Week 1 must start on a Monday.");
  if (!preview.name.trim()) throw new Error("Training Coach returned a plan without a name.");

  const document = createTrainingPlan(preview.name, "coach");
  document.id = `plan:coach:${preview.draftId}`;
  document.description = preview.summary.trim() || "Generated with Training Coach from your current training context.";
  document.goal = request.goal.trim();
  document.difficulty = request.difficulty;
  document.notes = [request.constraints?.trim(), ...preview.warnings].filter(Boolean).join("\n");
  document.startDate = request.startDate;
  document.weekCount = request.weeks;
  document.entries = preview.entries.map((entry, index) => {
    if (!entry.source) throw new Error(`Generated workout "${entry.name}" is missing its structured definition.`);
    const scheduleDate = entry.source.schedule_date ?? entry.scheduleDate;
    if (!scheduleDate) throw new Error(`Generated workout "${entry.name}" is missing a schedule date.`);
    const offset = dayOffset(request.startDate, scheduleDate);
    if (offset === undefined || offset < 0 || offset >= request.weeks * 7) {
      throw new Error(`Generated workout "${entry.name}" falls outside the requested plan dates.`);
    }
    const dayIndex = offset % 7;
    if (!request.availableDayIndexes.includes(dayIndex)) {
      throw new Error(`Generated workout "${entry.name}" was placed on an unavailable day.`);
    }
    const sport = entry.source.sport ?? "run";
    if (!request.sports.includes(sport)) {
      throw new Error(`Generated workout "${entry.name}" uses a sport that was not requested.`);
    }
    return {
      id: `entry:${preview.draftId}:${entry.key || index}`,
      kind: "workout" as const,
      weekIndex: Math.floor(offset / 7),
      dayIndex,
      sortOrder: entry.source.sort_no ?? index,
      title: entry.name,
      workout: {
        ...structuredClone(entry.source),
        schedule_date: scheduleDate,
        save_to_library: false
      }
    };
  });
  const weekCounts = new Map<number, number>();
  for (const entry of document.entries) {
    weekCounts.set(entry.weekIndex, (weekCounts.get(entry.weekIndex) ?? 0) + 1);
  }
  for (let weekIndex = 0; weekIndex < request.weeks; weekIndex += 1) {
    const count = weekCounts.get(weekIndex) ?? 0;
    if (count !== request.sessionsPerWeek) {
      throw new Error(`Generated week ${weekIndex + 1} has ${count} workouts instead of ${request.sessionsPerWeek}.`);
    }
  }
  if (request.maxSessionMinutes) {
    const overLimit = document.entries.find((entry) => workoutMetrics(entry.workout).durationSeconds > request.maxSessionMinutes! * 60);
    if (overLimit) {
      throw new Error(`Generated workout "${overLimit.title ?? "Untitled workout"}" exceeds the session-duration limit.`);
    }
  }
  document.sportMix = [...new Set(document.entries.map((entry) => entry.workout?.sport).filter((sport): sport is WorkoutSport => Boolean(sport)))];
  return document;
}

/** Convert an arbitrary Coach plan card into an unsaved, editable library plan. */
export function trainingPlanFromCoachDraftPreview(
  preview: PlanDraftPreview
): TrainingPlanDocument {
  if (!preview.name.trim()) throw new Error("Training Coach returned a plan without a name.");
  const datedEntries = preview.entries
    .map((entry) => entry.source?.schedule_date ?? entry.scheduleDate)
    .map((value) => value ? normalizedPlanDate(value) : undefined)
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.valueOf() - right.valueOf());
  const firstDate = datedEntries[0];
  const start = firstDate ? new Date(firstDate) : undefined;
  if (start) start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

  const document = createTrainingPlan(preview.name, "coach");
  document.id = `plan:coach:${preview.draftId}`;
  document.description = preview.summary.trim() || "Created in Training Coach for review in the Training Library.";
  document.notes = [
    ...preview.warnings,
    ...preview.conflicts.map((conflict) => `Calendar conflict: ${conflict}`)
  ].join("\n");
  document.startDate = start ? formatPlanDate(start, true) : undefined;
  document.entries = preview.entries.map((entry, index) => {
    const source: PlanWorkoutEntryInput = entry.source
      ? structuredClone(entry.source)
      : {
          key: entry.key || `coach-${index + 1}`,
          name: entry.name,
          sport: entry.sport ?? "run",
          save_to_library: false
        };
    const rawDate = source.schedule_date ?? entry.scheduleDate;
    const date = rawDate ? normalizedPlanDate(rawDate) : undefined;
    const offset = start && date
      ? Math.max(0, Math.round((date.valueOf() - start.valueOf()) / 86_400_000))
      : undefined;
    return {
      id: `entry:${preview.draftId}:${entry.key || index}`,
      kind: "workout" as const,
      weekIndex: offset === undefined ? 0 : Math.floor(offset / 7),
      dayIndex: offset === undefined ? undefined : offset % 7,
      sortOrder: source.sort_no ?? index,
      title: entry.name,
      workout: {
        ...source,
        name: entry.name,
        ...(rawDate ? { schedule_date: rawDate } : {}),
        save_to_library: false
      }
    };
  });
  document.weekCount = Math.max(1, ...document.entries.map((entry) => entry.weekIndex + 1));
  document.sportMix = [...new Set(document.entries.map((entry) => entry.workout?.sport ?? "run"))];
  return document;
}

/** Stable hash of only the plan content that changes calendar writes. */
export function trainingPlanCalendarRevision(plan: TrainingPlanDocument): string {
  const serialized = JSON.stringify({
    name: plan.name,
    startDate: plan.startDate,
    weekCount: plan.weekCount,
    entries: plan.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      weekIndex: entry.weekIndex,
      dayIndex: entry.dayIndex,
      sortOrder: entry.sortOrder,
      title: entry.title,
      programId: entry.programId,
      workout: entry.workout
    }))
  });
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function activeTrainingPlanCalendarInstall(
  plan: TrainingPlanDocument,
  today = formatPlanDate(new Date(), false)
) {
  return plan.calendarInstalls?.find((install) =>
    install.state !== "removed" && (
      install.occurrences.some((occurrence) => !occurrence.removedAt && occurrence.happenDay >= today) ||
      install.failures.some((failure) => failure.happenDay >= today && failure.writeMayHaveSucceeded)
    )
  );
}

export function createTrainingPlan(
  name = "Untitled plan",
  source: TrainingPlanDocument["source"] = "local"
): TrainingPlanDocument {
  const now = isoNow();
  return {
    id: uniqueId(source === "template" ? "template" : "plan"),
    name,
    description: "",
    goal: "",
    difficulty: "custom",
    notes: "",
    source,
    sportMix: [],
    weekCount: 4,
    phases: [],
    entries: [],
    tags: [],
    favorite: false,
    archived: false,
    syncState: "local",
    createdAt: now,
    updatedAt: now
  };
}

function dateFromPlanValue(value: string): Date | undefined {
  const normalized = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(normalized)) return undefined;
  const date = new Date(
    Number(normalized.slice(0, 4)),
    Number(normalized.slice(4, 6)) - 1,
    Number(normalized.slice(6, 8))
  );
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function formatPlanDate(date: Date, dashed: boolean): string {
  const value = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return dashed ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
}

export function shiftTrainingPlan(
  plan: TrainingPlanDocument,
  nextStartDate: string
): TrainingPlanDocument {
  const nextStart = dateFromPlanValue(nextStartDate);
  if (!nextStart) throw new Error("Plan start date must be YYYY-MM-DD or YYYYMMDD.");
  const previousStart = plan.startDate ? dateFromPlanValue(plan.startDate) : undefined;
  const shiftDays = previousStart
    ? Math.round((nextStart.valueOf() - previousStart.valueOf()) / 86_400_000)
    : 0;
  const entries = plan.entries.map((entry) => {
    const workout = entry.workout;
    const scheduleDate = workout?.schedule_date;
    if (!workout || (entry.dayIndex === undefined && !scheduleDate)) return entry;
    const date = entry.dayIndex !== undefined
      ? new Date(nextStart)
      : scheduleDate
        ? dateFromPlanValue(scheduleDate)
        : undefined;
    if (!date) return entry;
    if (entry.dayIndex !== undefined) {
      date.setDate(date.getDate() + entry.weekIndex * 7 + entry.dayIndex);
    } else {
      date.setDate(date.getDate() + shiftDays);
    }
    return {
      ...entry,
      workout: {
        ...workout,
        schedule_date: formatPlanDate(date, scheduleDate?.includes("-") ?? true)
      }
    };
  });
  return {
    ...plan,
    startDate: formatPlanDate(nextStart, true),
    entries,
    syncState: plan.source === "coros" ? "pending" : "local",
    updatedAt: isoNow()
  };
}

export function duplicateTrainingPlanWeek(
  plan: TrainingPlanDocument,
  weekIndex: number
): TrainingPlanDocument {
  if (weekIndex < 0 || weekIndex >= plan.weekCount) {
    throw new Error("Week index is outside the plan.");
  }
  const shifted = plan.entries.map((entry) =>
    entry.weekIndex > weekIndex ? { ...entry, weekIndex: entry.weekIndex + 1 } : entry
  );
  const copies = plan.entries
    .filter((entry) => entry.weekIndex === weekIndex)
    .map((entry) => ({
      ...structuredClone(entry),
      id: uniqueId("entry"),
      weekIndex: weekIndex + 1,
      remotePlanProgramId: undefined
    }));
  return {
    ...plan,
    weekCount: plan.weekCount + 1,
    entries: [...shifted, ...copies],
    phases: expandPhasesAfterWeek(plan.phases, weekIndex),
    syncState: plan.source === "coros" ? "pending" : "local",
    updatedAt: isoNow()
  };
}

function expandPhasesAfterWeek(
  phases: TrainingPlanPhase[],
  weekIndex: number
): TrainingPlanPhase[] {
  const humanWeek = weekIndex + 1;
  return phases.map((phase) => ({
    ...phase,
    startWeek: phase.startWeek > humanWeek ? phase.startWeek + 1 : phase.startWeek,
    endWeek: phase.endWeek >= humanWeek ? phase.endWeek + 1 : phase.endWeek
  }));
}

export function insertRecoveryWeek(
  plan: TrainingPlanDocument,
  afterWeekIndex: number
): TrainingPlanDocument {
  const next = duplicateTrainingPlanWeek(
    { ...plan, entries: plan.entries.filter((entry) => entry.weekIndex !== afterWeekIndex) },
    afterWeekIndex
  );
  return {
    ...next,
    phases: [
      ...next.phases,
      {
        id: uniqueId("phase"),
        name: "Recovery",
        kind: "recovery",
        startWeek: afterWeekIndex + 2,
        endWeek: afterWeekIndex + 2
      }
    ]
  };
}

export function reorderTrainingPlanWeek(
  plan: TrainingPlanDocument,
  fromWeekIndex: number,
  toWeekIndex: number
): TrainingPlanDocument {
  if (
    fromWeekIndex < 0 ||
    toWeekIndex < 0 ||
    fromWeekIndex >= plan.weekCount ||
    toWeekIndex >= plan.weekCount
  ) {
    throw new Error("Week index is outside the plan.");
  }
  const remap = (week: number) => {
    if (week === fromWeekIndex) return toWeekIndex;
    if (fromWeekIndex < toWeekIndex && week > fromWeekIndex && week <= toWeekIndex) {
      return week - 1;
    }
    if (fromWeekIndex > toWeekIndex && week >= toWeekIndex && week < fromWeekIndex) {
      return week + 1;
    }
    return week;
  };
  return {
    ...plan,
    entries: plan.entries.map((entry) => ({ ...entry, weekIndex: remap(entry.weekIndex) })),
    phases: plan.phases.map((phase) => {
      const remapped = Array.from(
        { length: phase.endWeek - phase.startWeek + 1 },
        (_, index) => remap(phase.startWeek - 1 + index) + 1
      );
      return {
        ...phase,
        startWeek: Math.min(...remapped),
        endWeek: Math.max(...remapped)
      };
    }),
    syncState: plan.source === "coros" ? "pending" : "local",
    updatedAt: isoNow()
  };
}

function isRepeatGroup(step: RunWorkoutStepInput): step is RunWorkoutCreateRepeatGroup {
  return typeof step === "object" && step !== null && "repeat" in step && "steps" in step;
}

function workoutMetrics(workout?: PlanWorkoutEntryInput): {
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
  strengthSets: number;
  intensityDistribution: Record<string, number>;
} {
  let durationSeconds = 0;
  let distanceMeters = (workout?.distance_km ?? 0) * 1000;
  let trainingLoad = 0;
  let strengthSets = 0;
  const intensityDistribution: Record<string, number> = {};
  const count = (step: RunWorkoutCreateStep, multiplier: number) => {
    durationSeconds += (step.target_duration_seconds ?? 0) * multiplier;
    if (!workout?.distance_km) {
      distanceMeters += (step.target_distance_meters ?? 0) * multiplier;
    }
    trainingLoad += (step.target_load ?? 0) * multiplier;
    strengthSets += (step.sets ?? (step.target_reps ? 1 : 0)) * multiplier;
    const intensity = step.intensity?.type ?? "notSet";
    intensityDistribution[intensity] = (intensityDistribution[intensity] ?? 0) + multiplier;
  };
  for (const node of workout?.steps ?? []) {
    if (isRepeatGroup(node)) {
      for (const step of node.steps) count(step, Math.max(1, node.repeat));
    } else {
      count(node, 1);
    }
  }
  return { durationSeconds, distanceMeters, trainingLoad, strengthSets, intensityDistribution };
}

export function validateTrainingPlan(
  plan: TrainingPlanDocument
): TrainingPlanValidationIssue[] {
  const issues: TrainingPlanValidationIssue[] = [];
  if (!plan.name.trim()) {
    issues.push({ path: "name", message: "Add a plan name.", severity: "error" });
  }
  if (plan.weekCount < 1 || plan.weekCount > 52) {
    issues.push({ path: "weekCount", message: "Plans must contain 1 to 52 weeks.", severity: "error" });
  }
  const occupied = new Map<string, number>();
  for (const entry of plan.entries) {
    if (entry.weekIndex < 0 || entry.weekIndex >= plan.weekCount) {
      issues.push({ path: `entries.${entry.id}`, message: "A workout is outside the plan range.", severity: "error" });
    }
    if (entry.dayIndex !== undefined && (entry.dayIndex < 0 || entry.dayIndex > 6)) {
      issues.push({ path: `entries.${entry.id}.dayIndex`, message: "Day must be Monday through Sunday.", severity: "error" });
    }
    if (entry.kind === "workout" && !entry.workout && !entry.programId) {
      issues.push({ path: `entries.${entry.id}`, message: "Workout entry has no reusable workout definition.", severity: "error" });
    }
    if (entry.dayIndex !== undefined) {
      const key = `${entry.weekIndex}:${entry.dayIndex}`;
      occupied.set(key, (occupied.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of occupied) {
    if (count > 2) {
      issues.push({ path: key, message: `${count} items share one day. Review recovery and scheduling conflicts.`, severity: "warning" });
    }
  }
  for (const phase of plan.phases) {
    if (phase.startWeek < 1 || phase.endWeek > plan.weekCount || phase.startWeek > phase.endWeek) {
      issues.push({ path: `phases.${phase.id}`, message: `Phase "${phase.name}" is outside the plan range.`, severity: "error" });
    }
  }
  return issues;
}

export function summarizeTrainingPlan(plan: TrainingPlanDocument): TrainingPlanSummary {
  const weekly: TrainingPlanWeekSummary[] = Array.from({ length: plan.weekCount }, (_, weekIndex) => ({
    weekIndex,
    workouts: 0,
    durationSeconds: 0,
    distanceMeters: 0,
    trainingLoad: 0
  }));
  const sportDistribution: Partial<Record<WorkoutSport, number>> = {};
  const intensityDistribution: Record<string, number> = {};
  const occupiedDays = new Set<string>();
  let workouts = 0;
  let durationSeconds = 0;
  let distanceMeters = 0;
  let trainingLoad = 0;
  let strengthSets = 0;
  let longestWorkout: TrainingPlanSummary["longestWorkout"];
  let conflictCount = 0;
  const occupiedCounts = new Map<string, number>();

  for (const entry of plan.entries) {
    if (entry.kind !== "workout") continue;
    workouts += 1;
    const calculated = workoutMetrics(entry.workout);
    const metrics = {
      ...calculated,
      durationSeconds: calculated.durationSeconds || entry.plannedDurationSeconds || 0,
      distanceMeters: calculated.distanceMeters || entry.plannedDistanceMeters || 0,
      trainingLoad: calculated.trainingLoad || entry.plannedTrainingLoad || 0,
      strengthSets: calculated.strengthSets || entry.plannedStrengthSets || 0
    };
    durationSeconds += metrics.durationSeconds;
    distanceMeters += metrics.distanceMeters;
    trainingLoad += metrics.trainingLoad;
    strengthSets += metrics.strengthSets;
    const week = weekly[entry.weekIndex];
    if (week) {
      week.workouts += 1;
      week.durationSeconds += metrics.durationSeconds;
      week.distanceMeters += metrics.distanceMeters;
      week.trainingLoad += metrics.trainingLoad;
    }
    const sport = entry.workout?.sport;
    if (sport) sportDistribution[sport] = (sportDistribution[sport] ?? 0) + 1;
    for (const [intensity, count] of Object.entries(metrics.intensityDistribution)) {
      intensityDistribution[intensity] = (intensityDistribution[intensity] ?? 0) + count;
    }
    if (!longestWorkout || metrics.durationSeconds > longestWorkout.durationSeconds) {
      longestWorkout = {
        name: entry.workout?.name ?? entry.title ?? "Workout",
        durationSeconds: metrics.durationSeconds,
        distanceMeters: metrics.distanceMeters
      };
    }
    if (entry.dayIndex !== undefined) {
      const key = `${entry.weekIndex}:${entry.dayIndex}`;
      occupiedDays.add(key);
      occupiedCounts.set(key, (occupiedCounts.get(key) ?? 0) + 1);
    }
  }
  for (const count of occupiedCounts.values()) if (count > 1) conflictCount += count - 1;
  const peak = weekly.reduce((best, week) =>
    week.trainingLoad > best.trainingLoad ? week : best, weekly[0] ?? { weekIndex: 0, trainingLoad: 0, workouts: 0, durationSeconds: 0, distanceMeters: 0 });
  const finalWeek = weekly.at(-1);
  const taperDetected = Boolean(peak && finalWeek && peak.weekIndex < finalWeek.weekIndex && peak.trainingLoad > 0 && finalWeek.trainingLoad <= peak.trainingLoad * 0.8);
  return {
    planId: plan.id,
    name: plan.name,
    weekCount: plan.weekCount,
    workouts,
    durationSeconds,
    distanceMeters,
    trainingLoad,
    strengthSets,
    restDays: Math.max(0, plan.weekCount * 7 - occupiedDays.size),
    sportDistribution,
    intensityDistribution,
    weekly,
    longestWorkout,
    peakWeek: peak ? peak.weekIndex + 1 : undefined,
    taperDetected,
    conflictCount
  };
}

export function compareTrainingPlans(plans: TrainingPlanDocument[]): TrainingPlanComparison {
  const summaries = plans.slice(0, 3).map(summarizeTrainingPlan);
  const namesByPlan = plans.slice(0, 3).map((plan) =>
    new Set(plan.entries.filter((entry) => entry.kind === "workout").map((entry) => entry.workout?.name ?? entry.title).filter((name): name is string => Boolean(name)))
  );
  const sharedWorkoutNames = namesByPlan.length < 2
    ? []
    : [...namesByPlan[0]!].filter((name) => namesByPlan.slice(1).every((set) => set.has(name)));
  const insights: string[] = [];
  for (const summary of summaries) {
    for (let index = 1; index < summary.weekly.length; index += 1) {
      const prior = summary.weekly[index - 1]!.trainingLoad;
      const current = summary.weekly[index]!.trainingLoad;
      if (prior > 0 && current > prior * 1.15) {
        insights.push(`${summary.name}: week ${index + 1} increases planned load by more than 15%.`);
      }
    }
    if (summary.peakWeek && !summary.taperDetected && summary.peakWeek === summary.weekCount) {
      insights.push(`${summary.name}: planned load peaks in the final week with no clear taper.`);
    }
    if (summary.conflictCount > 0) {
      insights.push(`${summary.name}: ${summary.conflictCount} same-day scheduling conflict${summary.conflictCount === 1 ? "" : "s"}.`);
    }
  }
  if (summaries.length > 1) {
    const mostLoad = [...summaries].sort((a, b) => b.trainingLoad - a.trainingLoad)[0]!;
    const leastLoad = [...summaries].sort((a, b) => a.trainingLoad - b.trainingLoad)[0]!;
    if (mostLoad.planId !== leastLoad.planId) {
      insights.push(`${mostLoad.name} carries ${Math.round(mostLoad.trainingLoad - leastLoad.trainingLoad)} more estimated training load than ${leastLoad.name}.`);
    }
  }
  return { summaries, sharedWorkoutNames, insights };
}

export function planEntryFromWorkout(
  workout: PlanWorkoutEntryInput,
  weekIndex: number,
  dayIndex?: number,
  programId?: string
): TrainingPlanEntry {
  return {
    id: uniqueId("entry"),
    kind: "workout",
    weekIndex,
    dayIndex,
    sortOrder: 0,
    title: workout.name,
    workout: structuredClone(workout),
    programId
  };
}
