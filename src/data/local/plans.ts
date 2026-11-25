"use client";
import { createStore, type StorageLike } from "@/data/local/store";
import { syncedList } from "@/data/local/synced";
import type { TrainingPlanDocument } from "@/lib/plan";

/** Training plans made on this computer, kept in its store as `training.plan` items (one per plan). */
export const planStore = syncedList<TrainingPlanDocument>("training.plan", (list) => cleanPlans(list));

/** A plan Coach just generated, on its way to the editor and not saved yet. It lasts as long as the tab. */
export interface PlanDraft { plan: TrainingPlanDocument; differences: string[] }

function tabStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export const planDraftStore = createStore<PlanDraft | null>("plan-draft.v1", null, tabStorage);

/** Drops anything in the store that is not a plan (an older or hand-edited value). */
export function cleanPlans(list: unknown): TrainingPlanDocument[] {
  return Array.isArray(list)
    ? (list as TrainingPlanDocument[]).filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.entries) && Array.isArray(p.phases) && Number.isInteger(p.weekCount))
    : [];
}

export function savedPlans(): TrainingPlanDocument[] {
  return cleanPlans(planStore.get());
}

/** Adds the plan, or replaces the saved one with the same id. */
export function putPlan(plan: TrainingPlanDocument): void {
  planStore.set((prev) => [...cleanPlans(prev).filter((p) => p.id !== plan.id), plan]);
}

export function dropPlan(id: string): void {
  planStore.set((prev) => cleanPlans(prev).filter((p) => p.id !== id));
}
