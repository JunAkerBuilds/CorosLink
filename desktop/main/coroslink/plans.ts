// CorosLink's own training plans and Local-Only workouts as C-LINK keeps them. Pure.
//
// C-LINK's plan document (src/lib/plan.ts) is a port of CorosLink's (electron/trainingPlanDomain.ts), so most fields
// carry over as they are. What differs: a workout is the builder's document (made here from the COROS program the
// entry carries, through the Training Hub reader C-LINK already has), and a calendar occurrence remembers the COROS
// calendar entry by its idInPlan (`ref`). Plans COROS has (`source: "coros"`) are left: C-LINK reads them from COROS.
import { randomUUID } from "node:crypto";
import type { HubSport } from "@/data/hub";
import { docFromHub, type BuilderDoc } from "@/lib/builder";
import type { PlanCalendarInstall, PlanDifficulty, PlanSource, TrainingPlanDocument, TrainingPlanEntry, TrainingPlanPhase } from "@/lib/plan";
import type { Json } from "@/server/hub/json";
import { readProgram, toWeb } from "@/server/hub/workout";

const SPORTS = new Set<HubSport>(["run", "trailRun", "bike", "swim", "strength", "hyrox", "xcSki", "indoorClimb", "bouldering"]);
const DIFFICULTY = new Set<PlanDifficulty>(["beginner", "intermediate", "advanced", "custom"]);
const PHASES = new Set(["base", "build", "peak", "taper", "recovery", "custom"]);

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const fin = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
/** CorosLink's days are YYYYMMDD in places and YYYY-MM-DD in others; C-LINK's are YYYY-MM-DD. */
export const isoDay = (v: unknown): string | undefined => {
  const s = String(v ?? "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};

/** A COROS program (CorosLink's plan entries, Local-Only library and calendar keep them whole) as a builder document. */
export function programDoc(program: unknown): BuilderDoc | null {
  try {
    const read = readProgram(program as Json);
    return read ? docFromHub(toWeb(read), () => randomUUID().slice(0, 8)) : null;
  } catch {
    return null;
  }
}

/** A row of `training_plans`. */
export interface PlanRow { id: string; source: string; document_json: string; archived_at: string | null }

export interface PlansOut { plans: TrainingPlanDocument[]; workouts: number; withoutSteps: number }

/** The athlete's own plans (local, template and Coach-made ones); COROS's are left to COROS. */
export function planDocs(rows: readonly PlanRow[]): PlansOut {
  const plans: TrainingPlanDocument[] = [];
  let workouts = 0, withoutSteps = 0;
  for (const row of rows) {
    if (row.source === "coros") continue;
    let doc: Bag;
    try { doc = bag(JSON.parse(row.document_json)); } catch { continue; }
    const id = text(doc.id, row.id), name = text(doc.name).trim();
    const weekCount = int(doc.weekCount);
    if (!id || !name || weekCount === undefined || weekCount < 1 || !Array.isArray(doc.entries)) continue;
    const names = new Map<string, string>();
    const entries: TrainingPlanEntry[] = [];
    for (const raw of doc.entries) {
      const e = bag(raw);
      const kind = e.kind === "rest" || e.kind === "note" ? e.kind : e.kind === "workout" ? "workout" : null;
      const weekIndex = int(e.weekIndex);
      if (!kind || typeof e.id !== "string" || weekIndex === undefined) continue;
      const entry: TrainingPlanEntry = drop({
        id: e.id, kind, weekIndex, dayIndex: int(e.dayIndex), sortOrder: int(e.sortOrder) ?? 0,
        title: typeof e.title === "string" ? e.title : undefined, programId: typeof e.programId === "string" ? e.programId : undefined,
        plannedDurationSeconds: fin(e.plannedDurationSeconds), plannedDistanceMeters: fin(e.plannedDistanceMeters),
        plannedTrainingLoad: fin(e.plannedTrainingLoad), plannedStrengthSets: fin(e.plannedStrengthSets),
        notes: typeof e.notes === "string" ? e.notes : undefined,
      });
      if (kind === "workout") {
        const w = bag(e.workout);
        const built = e.corosProgram ? programDoc(e.corosProgram) : null;
        const sport = built?.sport ?? (SPORTS.has(w.sport as HubSport) ? (w.sport as HubSport) : null);
        const label = text(w.name, built?.name ?? entry.title ?? "Workout");
        if (sport) {
          entry.workout = drop({ key: text(w.key, e.id), name: label, sport, description: typeof w.description === "string" ? w.description : undefined, doc: built ?? undefined });
          workouts++;
          // Without its program the steps stay with COROS's library workout (programId), read when it's scheduled.
          if (!built && !entry.programId) withoutSteps++;
        } else withoutSteps++;
        names.set(e.id, label);
      }
      entries.push(entry);
    }
    const phases: TrainingPlanPhase[] = (Array.isArray(doc.phases) ? doc.phases : []).map(bag).flatMap((p) => {
      const startWeek = int(p.startWeek), endWeek = int(p.endWeek);
      if (typeof p.id !== "string" || startWeek === undefined || endWeek === undefined) return [];
      return [drop({ id: p.id, name: text(p.name, "Phase"), startWeek, endWeek, kind: PHASES.has(p.kind as string) ? (p.kind as TrainingPlanPhase["kind"]) : undefined })];
    });
    const installs: PlanCalendarInstall[] = (Array.isArray(doc.calendarInstalls) ? doc.calendarInstalls : []).map(bag).flatMap((i) => {
      const startDate = isoDay(i.startDate);
      if (typeof i.id !== "string" || !startDate) return [];
      const occurrences = (Array.isArray(i.occurrences) ? i.occurrences : []).map(bag).flatMap((o) => {
        const happenDay = isoDay(o.happenDay), ref = o.scheduleIdInPlan;
        if (typeof o.planEntryId !== "string" || !happenDay || (typeof ref !== "string" && typeof ref !== "number")) return [];
        // COROS's calendar entry, by its idInPlan: what C-LINK's "Remove from calendar" takes off again.
        return [drop({ planEntryId: o.planEntryId, happenDay, where: "coros" as const, ref: String(ref), name: names.get(o.planEntryId) ?? "Workout", createdAt: text(o.createdAt, text(i.createdAt)), removedAt: typeof o.removedAt === "string" ? o.removedAt : undefined })];
      });
      const failures = (Array.isArray(i.failures) ? i.failures : []).map(bag).flatMap((f) => {
        const happenDay = isoDay(f.happenDay);
        return typeof f.planEntryId === "string" && happenDay ? [{ planEntryId: f.planEntryId, happenDay, message: text(f.message) }] : [];
      });
      return [drop({
        id: i.id, startDate, fromDate: isoDay(i.fromDate), planRevision: text(i.planRevision), state: i.state === "partial" || i.state === "removed" ? i.state : "active",
        lastOperation: i.lastOperation === "install" || i.lastOperation === "remove" ? i.lastOperation : undefined,
        total: occurrences.length + failures.length, occurrences, failures, createdAt: text(i.createdAt), updatedAt: text(i.updatedAt),
      } as PlanCalendarInstall)];
    });
    const source: PlanSource = row.source === "template" || row.source === "coach" ? row.source : "local";
    plans.push(drop({
      id, name, description: text(doc.description), goal: text(doc.goal), difficulty: DIFFICULTY.has(doc.difficulty as PlanDifficulty) ? (doc.difficulty as PlanDifficulty) : "custom",
      notes: text(doc.notes), source, sportMix: (Array.isArray(doc.sportMix) ? doc.sportMix : []).filter((s): s is HubSport => SPORTS.has(s as HubSport)),
      weekCount, startDate: isoDay(doc.startDate), phases, entries, calendarInstalls: installs.length ? installs : undefined,
      tags: (Array.isArray(doc.tags) ? doc.tags : []).filter((t): t is string => typeof t === "string"),
      favorite: doc.favorite === true, archived: doc.archived === true || !!row.archived_at, syncState: "local" as const,
      createdAt: text(doc.createdAt), updatedAt: text(doc.updatedAt),
    }));
  }
  return { plans, workouts, withoutSteps };
}

/** A Local-Only workout: kept in the library (no day) or on the calendar (a day), as a builder document. */
export interface LocalWorkout { id: string; date: string | null; doc: BuilderDoc }

/**
 * Local-Only Mode's library (`local_training_programs`) and calendar (`local_training_schedule`), both COROS program
 * JSON. Ids are prefixed so a second move finds them again. Ones the builder can't read are counted, not dropped
 * silently.
 */
export function localWorkouts(programs: readonly { id: string; program: string }[], schedule: readonly { id_in_plan: string | number; happen_day: string | number; program: string }[]): { workouts: LocalWorkout[]; unread: number } {
  const workouts: LocalWorkout[] = [];
  let unread = 0;
  const read = (json: string) => { try { return programDoc(JSON.parse(json)); } catch { return null; } };
  for (const p of programs) {
    const doc = read(p.program);
    if (doc) workouts.push({ id: `coroslink-${p.id}`, date: null, doc }); else unread++;
  }
  for (const s of schedule) {
    const doc = read(s.program), date = isoDay(s.happen_day);
    if (doc && date) workouts.push({ id: `coroslink-day-${s.id_in_plan}`, date, doc }); else unread++;
  }
  return { workouts, unread };
}
