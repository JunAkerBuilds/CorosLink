import { MAX_CUSTOM_COACH_INSTRUCTIONS } from "./types";

/** Apply the same limit to saved preferences and request-time prompt input. */
export function normalizeCustomCoachInstructions(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_CUSTOM_COACH_INSTRUCTIONS).trimEnd()
    : "";
}
