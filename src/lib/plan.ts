/**
 * Training plans, without the screen: the plan document, a blank plan, the week operations, the checks before
 * saving, the summaries the tiles and the editor draw, and what "Add to calendar" would write. Pure.
 * Ported from the desktop app (CorosLink `electron/trainingPlanDomain.ts` and the pure parts of its
 * `PlanEditor.tsx` / `TrainingLibraryView.tsx`), so both apps agree on what a plan is. What differs here:
 * a workout is the web builder's `BuilderDoc` (what `scheduleWorkout` saves), a workout's day is always worked
 * out from the plan's start date, and a calendar occurrence remembers where this app wrote it.
 */
import type { HubSport } from "@/data/hub";
import { defaultTarget, docReady, docToLegacy, docTotals, docUnwired, newDoc, newStep, pacingFor, sportLabel, targetsFor, type BuilderDoc } from "@/lib/builder";
import { addDays, dayMonth, isDayKey, shortDay } from "@/lib/calendar";
import { thousands } from "@/lib/format";
import { totals, type Pacing, type Sport } from "@/lib/workout";

/* ───────────── The document ───────────── */

export type PlanSource = "coros" | "local" | "template" | "coach";
export type PlanDifficulty = "beginner" | "intermediate" | "advanced" | "custom";
export type PlanSyncState = "local" | "synced" | "pending" | "conflicted" | "failed" | "stale";
export type PlanEntryKind = "workout" | "rest" | "note";
export type PhaseKind = "base" | "build" | "peak" | "taper" | "recovery" | "custom";

export interface TrainingPlanPhase {
  id: string;
  name: string;
  /** 1-based, inclusive. */
  startWeek: number;
  endWeek: number;
  kind?: PhaseKind;
}

/** The workout an entry carries: the builder's document, so it saves through the same path as any other workout. */
export interface PlanWorkout {
  key: string;
  name: string;
  sport: HubSport;
  description?: string;
  /** Missing for a COROS library workout whose steps the list didn't carry; it is read when it is scheduled. */
  doc?: BuilderDoc;
}

export interface TrainingPlanEntry {
  id: string;
  kind: PlanEntryKind;
  weekIndex: number;
  /** Zero-based day within the plan week; undefined places the entry in the holding area. */
  dayIndex?: number;
  sortOrder: number;
  title?: string;
  workout?: PlanWorkout;
  /** The library workout it came from. */
  programId?: string;
  plannedDurationSeconds?: number;
  plannedDistanceMeters?: number;
  plannedTrainingLoad?: number;
  plannedStrengthSets?: number;
  notes?: string;
}

/** One workout this app put on a calendar for the plan, and what takes it off again. */
export interface PlanCalendarOccurrence {
  planEntryId: string;
  /** YYYY-MM-DD. */
  happenDay: string;
  where: "coros" | "browser";
  /** COROS's id of the calendar entry, or the id it is saved under in this browser. */
  ref: string;
  name: string;
  createdAt: string;
  removedAt?: string;
}

export interface PlanCalendarFailure {
  planEntryId: string;
  happenDay: string;
  message: string;
}

export interface PlanCalendarInstall {
  id: string;
  startDate: string;
  /** First calendar day written; plan workouts dated earlier were skipped. */
  fromDate?: string;
  planRevision: string;
  state: "active" | "partial" | "removed";
  lastOperation?: "install" | "remove";
  /** How many workouts the install set out to add. */
  total: number;
  occurrences: PlanCalendarOccurrence[];
  failures: PlanCalendarFailure[];
  createdAt: string;
  updatedAt: string;
}

export interface TrainingPlanDocument {
  id: string;
  name: string;
  description: string;
  goal: string;
  difficulty: PlanDifficulty;
  notes: string;
  source: PlanSource;
  sportMix: HubSport[];
  weekCount: number;
  /** Day 1 of week 1, YYYY-MM-DD. */
  startDate?: string;
  phases: TrainingPlanPhase[];
  entries: TrainingPlanEntry[];
  calendarInstalls?: PlanCalendarInstall[];
  tags: string[];
  favorite: boolean;
  archived: boolean;
  syncState: PlanSyncState;
  createdAt: string;
  updatedAt: string;
}

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
  sportDistribution: Partial<Record<HubSport, number>>;
  weekly: TrainingPlanWeekSummary[];
  longestWorkout?: { name: string; durationSeconds: number; distanceMeters: number };
  peakWeek?: number;
  taperDetected: boolean;
  conflictCount: number;
}

/** Ids and the clock, handed in so the tests can fix them. */
export interface PlanEnv {
  newId(prefix: string): string;
  now(): string;
}

export const planEnv: PlanEnv = {
  newId: (prefix) => `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
  now: () => new Date().toISOString(),
};

/** The athlete's usual paces, when they are known: a distance step has a time and a load only with them. */
export type PlanPacing = Record<Sport, Pacing> | null;

export const MAX_PLAN_WEEKS = 52;
export const DAY_NAMES: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ───────────── Dates ───────────── */

/** A plan date as YYYY-MM-DD; COROS's YYYYMMDD is taken too. Undefined when it isn't a day. */
export function planDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) return undefined;
  const day = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  return isDayKey(day) ? day : undefined;
}

const dayNumber = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** Whole days from `from` to `to`. */
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

/** The calendar day `offset` days into the plan, when it has a start date. */
export function planDay(plan: Pick<TrainingPlanDocument, "startDate">, offset: number): string | undefined {
  const start = planDate(plan.startDate);
  return start ? addDays(start, offset) : undefined;
}

/** The day an entry falls on; undefined in the holding area or without a start date. */
export function entryDay(plan: Pick<TrainingPlanDocument, "startDate">, entry: Pick<TrainingPlanEntry, "weekIndex" | "dayIndex">): string | undefined {
  return entry.dayIndex === undefined ? undefined : planDay(plan, entry.weekIndex * 7 + entry.dayIndex);
}

/** The seven column names: the weekdays from the start date on, Monday to Sunday without one. */
export function planDayNames(plan: Pick<TrainingPlanDocument, "startDate">): string[] {
  const start = planDate(plan.startDate);
  return DAY_NAMES.map((name, i) => (start ? shortDay(addDays(start, i)).slice(0, 3) : name));
}

/** Week and day of `today` inside the plan, or -1 when today is before it or it has no start date. */
export function planToday(plan: Pick<TrainingPlanDocument, "startDate">, today: string): { week: number; day: number } {
  const start = planDate(plan.startDate);
  if (!start) return { week: -1, day: -1 };
  const offset = daysBetween(start, today);
  if (offset < 0) return { week: -1, day: -1 };
  return { week: Math.floor(offset / 7), day: offset % 7 };
}

/* ───────────── Making and changing a plan ───────────── */

export function createTrainingPlan(name = "Untitled plan", source: PlanSource = "local", env: PlanEnv = planEnv): TrainingPlanDocument {
  const now = env.now();
  return {
    id: env.newId(source === "template" ? "template" : "plan"),
    name, description: "", goal: "", difficulty: "custom", notes: "", source, sportMix: [], weekCount: 4, phases: [], entries: [], tags: [],
    favorite: false, archived: false, syncState: "local", createdAt: now, updatedAt: now,
  };
}

const touched = (plan: TrainingPlanDocument, env: PlanEnv): Pick<TrainingPlanDocument, "syncState" | "updatedAt"> => ({
  syncState: plan.source === "coros" ? "pending" : "local", updatedAt: env.now(),
});

/** Moves the plan to a new start date. Every entry keeps its week and its day within the week. */
export function shiftTrainingPlan(plan: TrainingPlanDocument, nextStartDate: string, env: PlanEnv = planEnv): TrainingPlanDocument {
  const next = planDate(nextStartDate);
  if (!next) throw new Error("Plan start date must be YYYY-MM-DD or YYYYMMDD.");
  return { ...plan, startDate: next, ...touched(plan, env) };
}

function expandPhasesAfterWeek(phases: readonly TrainingPlanPhase[], weekIndex: number): TrainingPlanPhase[] {
  const humanWeek = weekIndex + 1;
  return phases.map((phase) => ({
    ...phase,
    startWeek: phase.startWeek > humanWeek ? phase.startWeek + 1 : phase.startWeek,
    endWeek: phase.endWeek >= humanWeek ? phase.endWeek + 1 : phase.endWeek,
  }));
}

const inPlan = (plan: TrainingPlanDocument, weekIndex: number) => {
  if (!Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex >= plan.weekCount) throw new Error("Week index is outside the plan.");
};

export function duplicateTrainingPlanWeek(plan: TrainingPlanDocument, weekIndex: number, env: PlanEnv = planEnv): TrainingPlanDocument {
  inPlan(plan, weekIndex);
  const shifted = plan.entries.map((entry) => (entry.weekIndex > weekIndex ? { ...entry, weekIndex: entry.weekIndex + 1 } : entry));
  // The holding area belongs to no week, so its items are not part of a copy.
  const copies = plan.entries
    .filter((entry) => entry.weekIndex === weekIndex && entry.dayIndex !== undefined)
    .map((entry) => ({ ...structuredClone(entry), id: env.newId("entry"), weekIndex: weekIndex + 1 }));
  return { ...plan, weekCount: plan.weekCount + 1, entries: [...shifted, ...copies], phases: expandPhasesAfterWeek(plan.phases, weekIndex), ...touched(plan, env) };
}

/** Adds an empty week after the given one; every existing workout stays. */
export function insertRecoveryWeek(plan: TrainingPlanDocument, afterWeekIndex: number, env: PlanEnv = planEnv): TrainingPlanDocument {
  inPlan(plan, afterWeekIndex);
  return {
    ...plan,
    weekCount: plan.weekCount + 1,
    entries: plan.entries.map((entry) => (entry.weekIndex > afterWeekIndex ? { ...entry, weekIndex: entry.weekIndex + 1 } : entry)),
    phases: [
      ...expandPhasesAfterWeek(plan.phases, afterWeekIndex),
      { id: env.newId("phase"), name: "Recovery", kind: "recovery", startWeek: afterWeekIndex + 2, endWeek: afterWeekIndex + 2 },
    ],
    ...touched(plan, env),
  };
}

/**
 * Removes a week and its scheduled workouts. Held items belong to no week, so they stay, and later weeks and
 * phases move up to close the gap.
 */
export function removeTrainingPlanWeek(plan: TrainingPlanDocument, weekIndex: number, env: PlanEnv = planEnv): TrainingPlanDocument {
  inPlan(plan, weekIndex);
  if (plan.weekCount <= 1) throw new Error("A plan needs at least one week.");
  const humanWeek = weekIndex + 1;
  return {
    ...plan,
    weekCount: plan.weekCount - 1,
    entries: plan.entries
      .filter((entry) => entry.weekIndex !== weekIndex || entry.dayIndex === undefined)
      .map((entry) => {
        if (entry.weekIndex > weekIndex) return { ...entry, weekIndex: entry.weekIndex - 1 };
        return entry.weekIndex === weekIndex ? { ...entry, weekIndex: 0 } : entry;
      }),
    phases: plan.phases
      .map((phase) => ({
        ...phase,
        startWeek: phase.startWeek > humanWeek ? phase.startWeek - 1 : phase.startWeek,
        endWeek: phase.endWeek >= humanWeek ? phase.endWeek - 1 : phase.endWeek,
      }))
      .filter((phase) => phase.startWeek <= phase.endWeek),
    ...touched(plan, env),
  };
}

export function reorderTrainingPlanWeek(plan: TrainingPlanDocument, fromWeekIndex: number, toWeekIndex: number, env: PlanEnv = planEnv): TrainingPlanDocument {
  inPlan(plan, fromWeekIndex);
  inPlan(plan, toWeekIndex);
  const remap = (week: number) => {
    if (week === fromWeekIndex) return toWeekIndex;
    if (fromWeekIndex < toWeekIndex && week > fromWeekIndex && week <= toWeekIndex) return week - 1;
    if (fromWeekIndex > toWeekIndex && week >= toWeekIndex && week < fromWeekIndex) return week + 1;
    return week;
  };
  return {
    ...plan,
    entries: plan.entries.map((entry) => ({ ...entry, weekIndex: remap(entry.weekIndex) })),
    phases: plan.phases.map((phase) => {
      const remapped = Array.from({ length: Math.max(1, phase.endWeek - phase.startWeek + 1) }, (_, index) => remap(phase.startWeek - 1 + index) + 1);
      return { ...phase, startWeek: Math.min(...remapped), endWeek: Math.max(...remapped) };
    }),
    ...touched(plan, env),
  };
}

/** Adds an empty week at the end. */
export function addTrainingPlanWeek(plan: TrainingPlanDocument, env: PlanEnv = planEnv): TrainingPlanDocument {
  if (plan.weekCount >= MAX_PLAN_WEEKS) throw new Error("Plans must contain 1 to 52 weeks.");
  return { ...plan, weekCount: plan.weekCount + 1, ...touched(plan, env) };
}

export function planEntryFromWorkout(workout: PlanWorkout, weekIndex: number, dayIndex?: number, programId?: string, env: PlanEnv = planEnv): TrainingPlanEntry {
  return { id: env.newId("entry"), kind: "workout", weekIndex, dayIndex, sortOrder: 0, title: workout.name, workout: structuredClone(workout), ...(programId ? { programId } : {}) };
}

/**
 * "Create a quick workout": one training step of so many minutes. A sport whose training can't be timed
 * (climbing counts routes) keeps its usual step, and the minutes are recorded on the entry instead.
 */
export function quickPlanEntry(name: string, sport: HubSport, minutes: number, stepId: string, env: PlanEnv = planEnv): TrainingPlanEntry {
  const seconds = Math.max(1, Math.round(minutes) || 1) * 60;
  const shell = newDoc(sport, [stepId, stepId, stepId]);
  let step = newStep(stepId, "training", shell);
  const timed = targetsFor(sport, step).includes("time");
  if (timed) step = { ...step, ...defaultTarget("time", sport, "training"), seconds, ...(step.sets !== undefined ? { sets: 1, restSeconds: 0, name: name.trim() } : {}) };
  const doc: BuilderDoc = { ...shell, name: name.trim(), items: [step] };
  const entry = planEntryFromWorkout({ key: `local:${stepId}`, name: name.trim(), sport, doc }, 0, undefined, undefined, env);
  return timed ? entry : { ...entry, plannedDurationSeconds: seconds };
}

/** Scheduled workouts the calendar would refuse as they are, with the reason: steps missing a value, or a target this app can't write to COROS yet. */
export function calendarBlockedEntries(plan: TrainingPlanDocument, toCoros: boolean): { entry: TrainingPlanEntry; why: string }[] {
  const out: { entry: TrainingPlanEntry; why: string }[] = [];
  for (const entry of plan.entries) {
    const doc = entry.workout?.doc;
    if (entry.kind !== "workout" || entry.dayIndex === undefined || !doc) continue;
    const unwired = toCoros ? docUnwired(doc) : [];
    if (unwired.length) out.push({ entry, why: `not connected yet for COROS: ${unwired.join(", ")}` });
    else if (!docReady(doc, !toCoros)) out.push({ entry, why: toCoros && doc.sport === "strength" ? "its exercises must come from COROS’s list" : "some steps still need a value" });
  }
  return out;
}

/** The plan's sports follow its workouts. */
export function withDerivedSportMix(plan: TrainingPlanDocument, env: PlanEnv = planEnv): TrainingPlanDocument {
  const sports = plan.entries.map((entry) => entry.workout?.sport).filter((sport): sport is HubSport => Boolean(sport));
  return { ...plan, sportMix: [...new Set(sports)], updatedAt: env.now() };
}

/** Puts an entry on a day of a week, or (no day) into the holding area. */
export function moveTrainingPlanEntry(plan: TrainingPlanDocument, entryId: string, weekIndex: number, dayIndex?: number): TrainingPlanDocument {
  if (dayIndex !== undefined) {
    inPlan(plan, weekIndex);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) throw new Error("Plan day must be between Day 1 and Day 7.");
  }
  return { ...plan, entries: plan.entries.map((entry) => (entry.id === entryId ? { ...entry, weekIndex: dayIndex === undefined ? 0 : weekIndex, dayIndex } : entry)) };
}

export function removeTrainingPlanEntry(plan: TrainingPlanDocument, entryId: string): TrainingPlanDocument {
  return { ...plan, entries: plan.entries.filter((entry) => entry.id !== entryId) };
}

/** Marks a day as a rest day. A day that already is one stays as it is. */
export function addRestDay(plan: TrainingPlanDocument, weekIndex: number, dayIndex: number, env: PlanEnv = planEnv): TrainingPlanDocument {
  inPlan(plan, weekIndex);
  if (plan.entries.some((e) => e.kind === "rest" && e.weekIndex === weekIndex && e.dayIndex === dayIndex)) return plan;
  const rest: TrainingPlanEntry = { id: env.newId("rest"), kind: "rest", weekIndex, dayIndex, sortOrder: 0, title: "Rest day" };
  return { ...plan, entries: [...plan.entries, rest] };
}

/* ───────────── Phases ───────────── */

export const PHASE_KINDS: readonly PhaseKind[] = ["base", "build", "peak", "taper", "recovery", "custom"];
export const PHASE_LABELS: Record<PhaseKind, string> = { base: "Base", build: "Build", peak: "Peak", taper: "Taper", recovery: "Recovery", custom: "Custom" };

export const phaseLabel = (phase: TrainingPlanPhase): string => phase.name.trim() || PHASE_LABELS[phase.kind ?? "custom"];

/** A phase after a change, held inside the plan: it starts in the plan and ends on or after its start. */
export function clampPhase(phase: TrainingPlanPhase, weekCount: number): TrainingPlanPhase {
  const whole = (n: number, fallback: number) => (Number.isFinite(n) ? Math.round(n) : fallback);
  const startWeek = Math.max(1, Math.min(whole(phase.startWeek, 1), weekCount));
  const endWeek = Math.max(startWeek, Math.min(whole(phase.endWeek, startWeek), weekCount));
  return { ...phase, startWeek, endWeek };
}

export function updateTrainingPlanPhase(plan: TrainingPlanDocument, phaseId: string, change: (phase: TrainingPlanPhase) => TrainingPlanPhase): TrainingPlanDocument {
  return { ...plan, phases: plan.phases.map((phase) => (phase.id === phaseId ? clampPhase(change(phase), plan.weekCount) : phase)) };
}

/** A phase's type changed. A default name follows the type; a name of your own stays. */
export function withPhaseKind(phase: TrainingPlanPhase, kind: PhaseKind): TrainingPlanPhase {
  const named = phase.name.trim() && phase.name !== PHASE_LABELS[phase.kind ?? "custom"];
  return { ...phase, kind, name: named ? phase.name : PHASE_LABELS[kind] };
}

/** "+ Add phase": a Peak phase from the week after the last phase to the end of the plan. */
export function addTrainingPlanPhase(plan: TrainingPlanDocument, env: PlanEnv = planEnv): TrainingPlanDocument {
  const lastEnd = plan.phases.reduce((end, phase) => Math.max(end, phase.endWeek), 0);
  const phase: TrainingPlanPhase = { id: env.newId("phase"), name: PHASE_LABELS.peak, kind: "peak", startWeek: Math.min(plan.weekCount, lastEnd + 1), endWeek: plan.weekCount };
  return { ...plan, phases: [...plan.phases, phase] };
}

export function removeTrainingPlanPhase(plan: TrainingPlanDocument, phaseId: string): TrainingPlanDocument {
  return { ...plan, phases: plan.phases.filter((phase) => phase.id !== phaseId) };
}

export const sortedPhases = (plan: Pick<TrainingPlanDocument, "phases">): TrainingPlanPhase[] => [...plan.phases].sort((a, b) => a.startWeek - b.startWeek);

/** The phase a week is in: the narrowest match, so a recovery week inside a longer phase reads as recovery. */
export function phaseForWeek(plan: Pick<TrainingPlanDocument, "phases">, weekIndex: number): TrainingPlanPhase | undefined {
  return sortedPhases(plan)
    .filter((phase) => weekIndex + 1 >= phase.startWeek && weekIndex + 1 <= phase.endWeek)
    .sort((a, b) => a.endWeek - a.startWeek - (b.endWeek - b.startWeek))[0];
}

/* ───────────── Figures ───────────── */

export interface EntryMetrics { durationSeconds: number; distanceMeters: number; trainingLoad: number; strengthSets: number }

function workoutMetrics(workout: PlanWorkout | undefined, pacing: PlanPacing): EntryMetrics {
  const doc = workout?.doc;
  if (!doc) return { durationSeconds: 0, distanceMeters: 0, trainingLoad: 0, strengthSets: 0 };
  const own = pacingFor(doc.sport, pacing);
  const t = docTotals(doc, own);
  const items = own ? docToLegacy(doc) : null;
  return {
    durationSeconds: t.seconds ?? 0, distanceMeters: t.meters, strengthSets: t.sets,
    // The load estimate needs the athlete's own paces; without them it is whatever the plan recorded.
    trainingLoad: own && items && items.length > 0 ? totals(items, own).load : 0,
  };
}

/** One entry's figures: its own steps first, then what the plan recorded for it. */
export function trainingPlanEntryMetrics(entry: TrainingPlanEntry, pacing: PlanPacing = null): EntryMetrics {
  const calculated = workoutMetrics(entry.workout, pacing);
  return {
    durationSeconds: calculated.durationSeconds || entry.plannedDurationSeconds || 0,
    distanceMeters: calculated.distanceMeters || entry.plannedDistanceMeters || 0,
    trainingLoad: calculated.trainingLoad || entry.plannedTrainingLoad || 0,
    strengthSets: calculated.strengthSets || entry.plannedStrengthSets || 0,
  };
}

export function validateTrainingPlan(plan: TrainingPlanDocument): TrainingPlanValidationIssue[] {
  const issues: TrainingPlanValidationIssue[] = [];
  if (!plan.name.trim()) issues.push({ path: "name", message: "Add a plan name.", severity: "error" });
  if (plan.weekCount < 1 || plan.weekCount > MAX_PLAN_WEEKS) issues.push({ path: "weekCount", message: "Plans must contain 1 to 52 weeks.", severity: "error" });
  const occupied = new Map<string, number>();
  for (const entry of plan.entries) {
    if (entry.weekIndex < 0 || entry.weekIndex >= plan.weekCount) {
      issues.push({ path: `entries.${entry.id}`, message: "A workout is outside the plan range.", severity: "error" });
    }
    if (entry.dayIndex !== undefined && (entry.dayIndex < 0 || entry.dayIndex > 6)) {
      issues.push({ path: `entries.${entry.id}.dayIndex`, message: "Plan day must be between Day 1 and Day 7.", severity: "error" });
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
    if (count > 2) issues.push({ path: key, message: `${count} items share one day. Review recovery and scheduling conflicts.`, severity: "warning" });
  }
  for (const phase of plan.phases) {
    if (phase.startWeek < 1 || phase.endWeek > plan.weekCount || phase.startWeek > phase.endWeek) {
      issues.push({ path: `phases.${phase.id}`, message: `Phase "${phase.name}" is outside the plan range.`, severity: "error" });
    }
  }
  return issues;
}

export function summarizeTrainingPlan(plan: TrainingPlanDocument, pacing: PlanPacing = null): TrainingPlanSummary {
  const weekly: TrainingPlanWeekSummary[] = Array.from({ length: Math.max(0, plan.weekCount) }, (_, weekIndex) => ({ weekIndex, workouts: 0, durationSeconds: 0, distanceMeters: 0, trainingLoad: 0 }));
  const sportDistribution: Partial<Record<HubSport, number>> = {};
  const occupiedCounts = new Map<string, number>();
  let workouts = 0, durationSeconds = 0, distanceMeters = 0, trainingLoad = 0, strengthSets = 0, conflictCount = 0;
  let longestWorkout: TrainingPlanSummary["longestWorkout"];

  for (const entry of plan.entries) {
    if (entry.kind !== "workout") continue;
    workouts += 1;
    const metrics = trainingPlanEntryMetrics(entry, pacing);
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
    if (!longestWorkout || metrics.durationSeconds > longestWorkout.durationSeconds) {
      longestWorkout = { name: entry.workout?.name ?? entry.title ?? "Workout", durationSeconds: metrics.durationSeconds, distanceMeters: metrics.distanceMeters };
    }
    if (entry.dayIndex !== undefined) {
      const key = `${entry.weekIndex}:${entry.dayIndex}`;
      occupiedCounts.set(key, (occupiedCounts.get(key) ?? 0) + 1);
    }
  }
  for (const count of occupiedCounts.values()) if (count > 1) conflictCount += count - 1;
  const peak = weekly.reduce<TrainingPlanWeekSummary | undefined>((best, week) => (!best || week.trainingLoad > best.trainingLoad ? week : best), undefined);
  const finalWeek = weekly[weekly.length - 1];
  const taperDetected = Boolean(peak && finalWeek && peak.weekIndex < finalWeek.weekIndex && peak.trainingLoad > 0 && finalWeek.trainingLoad <= peak.trainingLoad * 0.8);
  return {
    planId: plan.id, name: plan.name, weekCount: plan.weekCount, workouts, durationSeconds, distanceMeters, trainingLoad, strengthSets,
    restDays: Math.max(0, plan.weekCount * 7 - occupiedCounts.size), sportDistribution, weekly, longestWorkout,
    peakWeek: peak ? peak.weekIndex + 1 : undefined, taperDetected, conflictCount,
  };
}

/* ───────────── The editor ───────────── */

export interface EditorWeek { workouts: number; durationSeconds: number; trainingLoad: number }

/** Per-week figures of scheduled workouts only: the holding area belongs to no week. */
export function scheduledWeeks(plan: TrainingPlanDocument, pacing: PlanPacing = null): EditorWeek[] {
  const weekly: EditorWeek[] = Array.from({ length: Math.max(0, plan.weekCount) }, () => ({ workouts: 0, durationSeconds: 0, trainingLoad: 0 }));
  for (const entry of plan.entries) {
    const week = weekly[entry.weekIndex];
    if (!week || entry.kind !== "workout" || entry.dayIndex === undefined) continue;
    const metrics = trainingPlanEntryMetrics(entry, pacing);
    week.workouts += 1;
    week.durationSeconds += metrics.durationSeconds;
    week.trainingLoad += metrics.trainingLoad;
  }
  return weekly;
}

/** The heaviest week: its index and load, or -1 when no week has a load. */
export function peakOf(weekly: readonly { trainingLoad: number }[]): { index: number; load: number } {
  const load = Math.max(0, ...weekly.map((week) => week.trainingLoad));
  return load > 0 ? { index: weekly.findIndex((week) => week.trainingLoad === load), load } : { index: -1, load: 0 };
}

export const holdingEntries = (plan: Pick<TrainingPlanDocument, "entries">): TrainingPlanEntry[] => plan.entries.filter((entry) => entry.dayIndex === undefined);

/** Advice under Plan checks. It never blocks saving. */
export function planSuggestions(plan: TrainingPlanDocument, pacing: PlanPacing = null): string[] {
  const suggestions: string[] = [];
  const weekly = scheduledWeeks(plan, pacing);
  weekly.forEach((week, index) => {
    const prior = weekly[index - 1]?.trainingLoad ?? 0;
    if (index > 0 && prior > 0 && week.trainingLoad > prior * 1.25) {
      suggestions.push(`Week ${index + 1} load jumps ${Math.round((week.trainingLoad / prior - 1) * 100)}%`);
    }
  });
  const uncovered = weekly.map((_week, index) => index).filter((index) => !phaseForWeek(plan, index));
  if (uncovered.length && plan.phases.length) suggestions.push(`Week ${uncovered.map((index) => index + 1).join(", ")} has no phase`);
  const held = holdingEntries(plan);
  if (held.length === 1) suggestions.push(`${held[0].title ?? "1 workout"} in the holding area won’t go on the calendar`);
  else if (held.length > 1) suggestions.push(`${held.length} in the holding area won’t go on the calendar`);
  return suggestions;
}

export interface SaveStatus { tone: "ok" | "warning" | "error"; text: string }

/** The line beside "Plan checks". Warnings are what validation warns about plus the advice below it. */
export function saveStatus(issues: readonly TrainingPlanValidationIssue[], suggestions: readonly string[], dirty: boolean, saving = false): SaveStatus {
  if (saving) return { tone: "ok", text: "Saving…" };
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors + suggestions.length;
  if (errors) return { tone: "error", text: errors === 1 ? "Fix 1 issue before saving" : `Fix ${errors} issues before saving` };
  if (warnings) return { tone: "warning", text: warnings === 1 ? "Ready to save · 1 warning" : `Ready to save · ${warnings} warnings` };
  return { tone: "ok", text: dirty ? "Ready to save." : "Saved · everything is up to date" };
}

/* ───────────── Words ───────────── */

/** 25 h 12 min; 45 min under an hour. Whole minutes, as the steps are planned in. */
export function durationText(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A workout's line on its card: "45 min · 63" (time, else distance, else sets; then its load). */
export function entryMeta(entry: TrainingPlanEntry, pacing: PlanPacing = null): string {
  const m = trainingPlanEntryMetrics(entry, pacing);
  const parts: string[] = [];
  if (m.durationSeconds) parts.push(durationText(m.durationSeconds));
  else if (m.distanceMeters) parts.push(`${(m.distanceMeters / 1000).toFixed(2)} km`);
  else if (m.strengthSets) parts.push(count(m.strengthSets, "set", "sets"));
  if (m.trainingLoad) parts.push(thousands(m.trainingLoad));
  return parts.join(" · ") || (entry.workout ? sportLabel(entry.workout.sport) : "");
}

/** The line under the plan's name: "8 weeks · 32 workouts · 2,168 estimated load · start 30 Nov". */
export function planFactsLine(plan: TrainingPlanDocument, summary: TrainingPlanSummary): string {
  const start = planDate(plan.startDate);
  return [
    count(summary.weekCount, "week", "weeks"), count(summary.workouts, "workout", "workouts"),
    ...(summary.trainingLoad ? [`${thousands(summary.trainingLoad)} estimated load`] : []),
    ...(start ? [`start ${dayMonth(start)}`] : []),
  ].join(" · ");
}

/* ───────────── The Plans index ───────────── */

/** Goals on the "Build me a plan" tile, each a starting point for the generator. */
export const PLAN_GOAL_PRESETS = [
  { id: "5k", label: "5K", goal: "Run a faster 5K", weeks: 8, sessionsPerWeek: 4 },
  { id: "10k", label: "10K", goal: "Run a faster 10K", weeks: 10, sessionsPerWeek: 4 },
  { id: "half", label: "Half", goal: "Race a half marathon", weeks: 12, sessionsPerWeek: 5 },
  { id: "marathon", label: "Marathon", goal: "Race a marathon", weeks: 16, sessionsPerWeek: 5 },
  { id: "trail", label: "Trail ultra", goal: "Finish a trail ultra strong", weeks: 16, sessionsPerWeek: 5 },
] as const;

export type PlanGoalPreset = (typeof PLAN_GOAL_PRESETS)[number];
export const planGoalPreset = (id: string | null | undefined): PlanGoalPreset | undefined => PLAN_GOAL_PRESETS.find((preset) => preset.id === id);

export const PLAN_SOURCE_LABELS: Record<PlanSource, string> = { coros: "COROS", local: "Local", template: "Template", coach: "Coach" };
const DIFFICULTY_LABELS: Record<PlanDifficulty, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", custom: "" };

export interface PlanView {
  /** What the plan is for, in the author's words. */
  note: string;
  /** "Run · Intermediate" */
  facts: string;
  sessions: number;
  /** The heaviest week's load; 0 when no week has one. */
  peakLoad: number;
  /** "Weekly load", or "Sessions per week" when there is no load to draw. */
  chart: "Weekly load" | "Sessions per week";
  /** One bar per week: its share of the tallest (0 to 1) and the phase it is in. */
  bars: { value: number; share: number; phase?: PhaseKind }[];
  ribbon: { id: string; label: string; weeks: number; kind: PhaseKind }[];
}

/** Everything a plan tile draws, derived once. */
export function planView(plan: TrainingPlanDocument, summary: TrainingPlanSummary): PlanView {
  const hasLoad = summary.weekly.some((week) => week.trainingLoad > 0);
  const values = summary.weekly.map((week) => (hasLoad ? week.trainingLoad : week.workouts));
  const top = Math.max(0, ...values);
  const difficulty = DIFFICULTY_LABELS[plan.difficulty];
  return {
    note: plan.goal || plan.description,
    facts: [plan.sportMix.map(sportLabel).join(", "), difficulty].filter(Boolean).join(" · "),
    sessions: summary.workouts,
    peakLoad: hasLoad ? Math.round(top) : 0,
    chart: hasLoad ? "Weekly load" : "Sessions per week",
    bars: values.map((value, index) => ({ value, share: top > 0 ? value / top : 0, phase: phaseForWeek(plan, index)?.kind ?? (phaseForWeek(plan, index) ? "custom" : undefined) })),
    ribbon: plan.phases.map((phase) => ({ id: phase.id, label: phaseLabel(phase), weeks: Math.max(1, phase.endWeek - phase.startWeek + 1), kind: phase.kind ?? "custom" })),
  };
}

/** Stable hash of only the plan content that changes calendar writes. */
export function trainingPlanCalendarRevision(plan: TrainingPlanDocument): string {
  const serialized = JSON.stringify({
    name: plan.name, startDate: plan.startDate, weekCount: plan.weekCount,
    entries: plan.entries.map((entry) => ({
      id: entry.id, kind: entry.kind, weekIndex: entry.weekIndex, dayIndex: entry.dayIndex, sortOrder: entry.sortOrder, title: entry.title,
      programId: entry.programId, workout: entry.workout,
    })),
  });
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The install whose workouts are still on the calendar from `today` on (or that stopped part-way). */
export function activeTrainingPlanCalendarInstall(plan: Pick<TrainingPlanDocument, "calendarInstalls">, today: string): PlanCalendarInstall | undefined {
  return plan.calendarInstalls?.find((install) =>
    install.state !== "removed" && (
      install.occurrences.some((occurrence) => !occurrence.removedAt && occurrence.happenDay >= today) ||
      (install.state === "partial" && install.failures.some((failure) => failure.happenDay >= today))
    ));
}

/** Recorded calendar workouts, dated today or later, that removing the active install would delete. */
export function upcomingTrainingPlanCalendarWorkoutCount(plan: Pick<TrainingPlanDocument, "calendarInstalls">, today: string): number {
  return activeTrainingPlanCalendarInstall(plan, today)?.occurrences.filter((occurrence) => !occurrence.removedAt && occurrence.happenDay >= today).length ?? 0;
}

export interface InstallStanding {
  install?: PlanCalendarInstall;
  /** An install that stopped part-way: "Retry" continues it, "Remove partial install" takes it back. */
  retrying: boolean;
  /** A removal that stopped part-way. */
  removing: boolean;
  /** The plan changed since it went on the calendar. */
  differs: boolean;
  added: number;
  total: number;
}

export function installStanding(plan: TrainingPlanDocument, today: string): InstallStanding {
  const install = activeTrainingPlanCalendarInstall(plan, today);
  const added = install?.occurrences.filter((occurrence) => !occurrence.removedAt).length ?? 0;
  return {
    install,
    retrying: install?.state === "partial" && install.lastOperation === "install",
    removing: install?.state === "partial" && install.lastOperation === "remove",
    differs: Boolean(install && install.planRevision !== trainingPlanCalendarRevision(plan)),
    added, total: install ? Math.max(install.total, added) : 0,
  };
}

/** Where a plan stands on the calendar: the week it is in, when it starts, or not scheduled. */
export function planStatus(plan: TrainingPlanDocument, today: string): { text: string; live: boolean } {
  const install = activeTrainingPlanCalendarInstall(plan, today);
  const start = planDate(install?.startDate ?? plan.startDate);
  if (!install) return { text: start ? `Starts ${shortDay(start)}` : "Unscheduled", live: false };
  if (install.state === "partial" && install.lastOperation === "install") {
    const s = installStanding(plan, today);
    return { text: `Calendar install incomplete · ${s.added} of ${s.total} workouts added`, live: false };
  }
  if (!start) return { text: "On calendar", live: true };
  const days = daysBetween(start, today), week = Math.floor(days / 7) + 1;
  if (days < 0) return { text: `Starts ${shortDay(start)}`, live: true };
  return { text: week <= plan.weekCount ? `Week ${week} of ${plan.weekCount}` : "On calendar", live: true };
}

/** A plan with a warning to settle: sync trouble, a calendar install that stopped part-way, or one that no longer matches the plan. */
export function planNeedsAttention(plan: TrainingPlanDocument, today: string): boolean {
  const s = installStanding(plan, today);
  return ["pending", "conflicted", "failed", "stale"].includes(plan.syncState) || s.retrying || s.removing || s.differs;
}

export type PlanScope = "all" | "calendar" | "favorite" | "coros" | "local" | "coach" | "unsettled" | "archived";

/** The filter chips, each only while a plan would show under it. */
export function planScopes(plans: readonly TrainingPlanDocument[], today: string): { id: PlanScope; label: string }[] {
  const options: { id: PlanScope; label: string }[] = [{ id: "all", label: "All" }];
  if (plans.some((plan) => activeTrainingPlanCalendarInstall(plan, today))) options.push({ id: "calendar", label: "On calendar" });
  if (plans.some((plan) => plan.favorite)) options.push({ id: "favorite", label: "Favorites" });
  for (const source of ["coros", "local", "coach"] as const) {
    if (plans.some((plan) => plan.source === source)) options.push({ id: source, label: PLAN_SOURCE_LABELS[source] });
  }
  if (plans.some((plan) => planNeedsAttention(plan, today))) options.push({ id: "unsettled", label: "Needs attention" });
  if (plans.some((plan) => plan.archived)) options.push({ id: "archived", label: "Archived" });
  return options;
}

/** The plans a chip and the search box leave, most recently changed first. */
export function visiblePlans(plans: readonly TrainingPlanDocument[], scope: PlanScope, query: string, today: string): TrainingPlanDocument[] {
  const needle = query.trim().toLowerCase();
  return plans.filter((plan) => {
    if (needle) {
      const haystack = `${plan.name} ${plan.description} ${plan.goal} ${plan.tags.join(" ")} ${plan.sportMix.map(sportLabel).join(" ")}`;
      if (!haystack.toLowerCase().includes(needle)) return false;
    }
    if (scope === "calendar") return Boolean(activeTrainingPlanCalendarInstall(plan, today)) && !plan.archived;
    if (scope === "favorite") return plan.favorite;
    if (scope === "unsettled") return planNeedsAttention(plan, today);
    if (scope === "archived") return plan.archived;
    if (scope !== "all") return plan.source === scope && !plan.archived;
    return !plan.archived;
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** A copy to edit freely: new ids, off the calendar, a local plan. */
export function duplicateTrainingPlan(plan: TrainingPlanDocument, env: PlanEnv = planEnv): TrainingPlanDocument {
  const now = env.now();
  const copy = structuredClone(plan);
  delete copy.calendarInstalls;
  return {
    ...copy, id: env.newId("plan"), name: `${plan.name} copy`, source: plan.source === "coach" ? "coach" : "local", favorite: false, archived: false, syncState: "local",
    entries: copy.entries.map((entry) => ({ ...entry, id: env.newId("entry") })), phases: copy.phases.map((phase) => ({ ...phase, id: env.newId("phase") })),
    createdAt: now, updatedAt: now,
  };
}

/* ───────────── Onto the calendar ───────────── */

export interface CalendarTarget { entry: TrainingPlanEntry; day: string; name: string }

export interface CalendarPreview {
  /** Workouts to write, in date order. */
  targets: CalendarTarget[];
  /** Workouts dated before today: they stay off the calendar. */
  skipped: CalendarTarget[];
  /** Why nothing can be written, when it can't. */
  blocker: string | null;
}

/** What "Add to calendar" would write for a plan, from `today` on. Rest days, notes and the holding area are left out. */
export function planCalendarPreview(plan: TrainingPlanDocument, today: string): CalendarPreview {
  if (!planDate(plan.startDate)) return { targets: [], skipped: [], blocker: "Set a plan start date first." };
  const all: CalendarTarget[] = plan.entries
    .filter((entry) => entry.kind === "workout" && entry.dayIndex !== undefined && entry.weekIndex >= 0 && entry.weekIndex < plan.weekCount)
    .map((entry) => ({ entry, day: entryDay(plan, entry)!, name: entry.title ?? entry.workout?.name ?? "Workout" }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.entry.sortOrder - b.entry.sortOrder);
  const targets = all.filter((t) => t.day >= today), skipped = all.filter((t) => t.day < today);
  const blocker = all.length === 0 ? "Put a workout on a day first." : targets.length === 0 ? "Every workout in this plan is on a day that has passed." : null;
  return { targets, skipped, blocker };
}

export interface InstallProgress { done: number; total: number; name: string }

export interface InstallDeps {
  /** Writes one workout to the calendar and says where it went. Throws when the calendar refuses it. */
  schedule(target: CalendarTarget): Promise<{ where: "coros" | "browser"; ref: string }>;
  /** Called with the plan after every step, so a closed tab leaves an honest record. */
  save(plan: TrainingPlanDocument): void;
  onProgress?(progress: InstallProgress): void;
  env?: PlanEnv;
}

const withInstall = (plan: TrainingPlanDocument, install: PlanCalendarInstall): TrainingPlanDocument => ({
  ...plan, calendarInstalls: [install, ...(plan.calendarInstalls ?? []).filter((i) => i.id !== install.id)],
});

/**
 * Puts the plan on the calendar one workout at a time, or carries on an install that stopped. It stops at the
 * first workout the calendar refuses and leaves the install "partial", with what was added and why it stopped.
 */
export async function installTrainingPlan(plan: TrainingPlanDocument, today: string, deps: InstallDeps): Promise<TrainingPlanDocument> {
  const env = deps.env ?? planEnv;
  const preview = planCalendarPreview(plan, today);
  if (preview.blocker) throw new Error(preview.blocker);
  const standing = installStanding(plan, today);
  if (standing.install && !standing.retrying) throw new Error("This plan is on your calendar already.");
  const now = env.now();
  let install: PlanCalendarInstall = standing.install
    ? { ...standing.install, failures: [], lastOperation: "install", updatedAt: now }
    : { id: env.newId("install"), startDate: planDate(plan.startDate)!, fromDate: today, planRevision: trainingPlanCalendarRevision(plan), state: "partial", lastOperation: "install", total: preview.targets.length, occurrences: [], failures: [], createdAt: now, updatedAt: now };
  const have = new Set(install.occurrences.filter((o) => !o.removedAt).map((o) => o.planEntryId));
  const todo = preview.targets.filter((t) => !have.has(t.entry.id));
  install = { ...install, total: have.size + todo.length, state: "partial" };
  let current = plan;
  for (const target of todo) {
    deps.onProgress?.({ done: install.occurrences.filter((o) => !o.removedAt).length, total: install.total, name: target.name });
    try {
      const made = await deps.schedule(target);
      install = { ...install, occurrences: [...install.occurrences, { planEntryId: target.entry.id, happenDay: target.day, where: made.where, ref: made.ref, name: target.name, createdAt: env.now() }], updatedAt: env.now() };
    } catch (error) {
      install = { ...install, failures: [{ planEntryId: target.entry.id, happenDay: target.day, message: error instanceof Error ? error.message : String(error) }], updatedAt: env.now() };
      current = withInstall(plan, install);
      deps.save(current);
      return current;
    }
    current = withInstall(plan, install);
    deps.save(current);
  }
  install = { ...install, state: "active", updatedAt: env.now() };
  current = withInstall(plan, install);
  deps.save(current);
  deps.onProgress?.({ done: install.total, total: install.total, name: "" });
  return current;
}

export interface RemoveDeps {
  remove(occurrence: PlanCalendarOccurrence): Promise<void>;
  save(plan: TrainingPlanDocument): void;
  onProgress?(progress: InstallProgress): void;
  env?: PlanEnv;
}

/**
 * Takes the plan's workouts from `today` on off the calendar, one at a time; past days stay. It stops at the first
 * one that can't be removed and leaves the install "partial", with what is still there.
 */
export async function removeTrainingPlanFromCalendar(plan: TrainingPlanDocument, today: string, deps: RemoveDeps): Promise<TrainingPlanDocument> {
  const env = deps.env ?? planEnv;
  let install = activeTrainingPlanCalendarInstall(plan, today);
  if (!install) return plan;
  const todo = install.occurrences.filter((o) => !o.removedAt && o.happenDay >= today);
  install = { ...install, failures: [], lastOperation: "remove", updatedAt: env.now() };
  let current = plan, done = 0;
  for (const occurrence of todo) {
    deps.onProgress?.({ done, total: todo.length, name: occurrence.name });
    try {
      await deps.remove(occurrence);
    } catch (error) {
      install = { ...install, state: "partial", failures: [{ planEntryId: occurrence.planEntryId, happenDay: occurrence.happenDay, message: error instanceof Error ? error.message : String(error) }], updatedAt: env.now() };
      current = withInstall(plan, install);
      deps.save(current);
      return current;
    }
    done += 1;
    const at = env.now();
    install = { ...install, occurrences: install.occurrences.map((o) => (o === occurrence || (o.ref === occurrence.ref && o.planEntryId === occurrence.planEntryId && o.happenDay === occurrence.happenDay) ? { ...o, removedAt: at } : o)), updatedAt: at };
    current = withInstall(plan, install);
    deps.save(current);
  }
  install = { ...install, state: "removed", updatedAt: env.now() };
  current = withInstall(plan, install);
  deps.save(current);
  deps.onProgress?.({ done: todo.length, total: todo.length, name: "" });
  return current;
}
