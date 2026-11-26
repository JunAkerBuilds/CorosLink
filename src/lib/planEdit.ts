// Coach's plan cards applied to the real plan document. A plan edit (PlanEditCard) runs its changes in order with the
// plan editor's own operations, so it behaves exactly like the buttons; a draft (PlanDraftCard) becomes a plan the
// same way a generated plan does. Pure.
import type { HubSport } from "@/data/hub";
import { docFromHub, legacyDoc, type BuilderDoc } from "@/lib/builder";
import { t } from "@/lib/i18n";
import type { MadeWorkout, PlanDraft, PlanEditOp } from "@/lib/coach/plans";
import {
  addTrainingPlanWeek, moveTrainingPlanEntry, PHASE_LABELS, planEntryFromWorkout, planEnv,
  removeTrainingPlanEntry, removeTrainingPlanWeek, reorderTrainingPlanWeek, type PlanEnv, type TrainingPlanDocument,
} from "@/lib/plan";
import { generatedPlanFromBlocks, trainingPlanFromGenerated } from "@/lib/planGenerate";

const docOf = (w: MadeWorkout, nextId: () => string): BuilderDoc | null =>
  w.hub ? docFromHub(w.hub, nextId, false) : w.workout ? legacyDoc(w.workout, [], nextId) : null;

/** The plan with Coach's changes made, in order. Throws (in words) when the plan has changed since Coach read it. */
export function applyPlanEdit(plan: TrainingPlanDocument, ops: readonly PlanEditOp[], nextId: () => string, env: PlanEnv = planEnv): TrainingPlanDocument {
  let p = plan;
  const has = (id: string) => {
    if (!p.entries.some((e) => e.id === id)) throw new Error(t("This plan changed after Coach read it, so a workout it names isn't there any more. Ask Coach again."));
  };
  const entry = (w: MadeWorkout, week: number, day: number) => {
    const doc = docOf(w, nextId);
    if (!doc) throw new Error(t("Coach's “{name}” came without steps.", { name: w.name }));
    const made = planEntryFromWorkout({ key: `coach-${nextId()}`, name: w.name, sport: doc.sport as HubSport, doc: { ...doc, name: w.name } }, week, day, undefined, env);
    return w.load ? { ...made, plannedTrainingLoad: w.load } : made;
  };
  for (const op of ops) {
    switch (op.op) {
      case "move": has(op.entry); p = moveTrainingPlanEntry(p, op.entry, op.week, op.day); break;
      case "remove": has(op.entry); p = removeTrainingPlanEntry(p, op.entry); break;
      case "replace": {
        has(op.entry);
        const old = p.entries.find((e) => e.id === op.entry)!;
        const next = { ...entry(op, old.weekIndex, old.dayIndex ?? 0), id: old.id, sortOrder: old.sortOrder };
        p = { ...p, entries: p.entries.map((e) => (e.id === old.id ? next : e)) };
        break;
      }
      case "add": {
        if (op.week >= p.weekCount) throw new Error(t("Week {week} isn't in this plan any more. Ask Coach again.", { week: op.week + 1 }));
        p = { ...p, entries: [...p.entries, { ...entry(op, op.week, op.day), sortOrder: p.entries.length }] };
        break;
      }
      case "add_week": {
        // A new week at the end, filled (a copy) or not, then moved to where Coach asked: after week `after`.
        const target = op.after + 1;
        p = addTrainingPlanWeek(p, env);
        const last = p.weekCount - 1;
        if (op.copy !== undefined) {
          const copies = p.entries.filter((e) => e.weekIndex === op.copy && e.dayIndex !== undefined).map((e) => ({ ...structuredClone(e), id: env.newId("entry"), weekIndex: last }));
          p = { ...p, entries: [...p.entries, ...copies] };
        }
        if (target < last) p = reorderTrainingPlanWeek(p, last, target, env);
        if (op.recovery) p = { ...p, phases: [...p.phases.filter((ph) => !(ph.startWeek === target + 1 && ph.endWeek === target + 1)), { id: env.newId("phase"), name: t("Recovery"), kind: "recovery", startWeek: target + 1, endWeek: target + 1 }] };
        break;
      }
      case "remove_week": p = removeTrainingPlanWeek(p, op.week, env); break;
      case "phases":
        p = { ...p, phases: op.phases.map((ph) => ({ id: env.newId("phase"), name: t(PHASE_LABELS[ph.kind]), kind: ph.kind, startWeek: ph.startWeek, endWeek: Math.min(ph.endWeek, p.weekCount) })) };
        break;
      case "rename": p = { ...p, name: op.name }; break;
      case "goal": p = { ...p, goal: op.goal }; break;
    }
  }
  return p;
}

/** A plan Coach built with build_plan, as an unsaved plan document (clean name, phases from the weekly load). */
export function planFromDraft(draft: PlanDraft, nextId: () => string, env: PlanEnv = planEnv): TrainingPlanDocument {
  const day = (offset: number) => {
    const d = new Date(`${draft.start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const made = generatedPlanFromBlocks([{
    kind: "plan", id: "draft", title: draft.name, note: draft.overview, rows: [], week: { label: "", before: 0, after: 0, done: 0 },
    ops: draft.workouts.map((w) => ({ op: "add_workout" as const, day: day(w.offset), name: w.name, sport: "run" as const, workout: w.workout, hub: w.hub, detail: w.detail, ...(w.load ? { load: w.load } : {}) })),
  }], nextId);
  if (!made) throw new Error(t("Coach's plan has no workouts."));
  const sports = [...new Set(made.workouts.map((w) => w.sport))];
  const { plan } = trainingPlanFromGenerated(made, {
    goal: draft.goal || draft.name, sports, difficulty: "intermediate", weeks: draft.weeks, startDate: draft.start,
    sessionsPerWeek: Math.max(1, Math.round(made.workouts.length / Math.max(1, draft.weeks))), availableDayIndexes: [0, 1, 2, 3, 4, 5, 6],
  }, env);
  return { ...plan, description: draft.overview, notes: "" };
}
