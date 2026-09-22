import type { WorkoutEditRef } from "./types";

export type StrengthLoad = { mode: "bodyweight" } | { mode: "weight"; value: number; unit: "kg" | "lb" };
export interface StrengthStepPatch {
  stepId: string;
  sets?: number;
  target?: { type: "reps"; count: number } | { type: "time"; seconds: number } | { type: "open" };
  load?: StrengthLoad;
  restSeconds?: number;
}
export type WorkoutEditItemState = "prepared" | "writing" | "verified" | "saved_unverified" | "conflicted" | "unknown_outcome" | "cancelled";
export interface StrengthEditItemPreview {
  id: string;
  name: string;
  ref: WorkoutEditRef;
  changes: Array<{ exercise: string; stepId: string; field: string; before: string; after: string }>;
  state: WorkoutEditItemState;
  message?: string;
}
export interface StrengthEditPreview {
  proposalId: string;
  reviewHash: string;
  createdAt: number;
  expiresAt: number;
  origin: "coach" | "external";
  state: "awaiting_confirmation" | "saving" | "finished" | "cancelled" | "expired";
  scope: string;
  items: StrengthEditItemPreview[];
  exclusions: string[];
  message?: string;
}
