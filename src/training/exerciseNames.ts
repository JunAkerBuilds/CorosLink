import exerciseNames from "./exerciseNames.json" with { type: "json" };

const NAME_MAP = exerciseNames as Record<string, string>;
const CODE_RE = /^[TS]\d/;

/**
 * Unstructured (free) strength sessions have no program, so the watch labels
 * each auto-detected segment by the body region worked, using S-codes that are
 * absent from the exercise catalogue. Verified against the COROS app — these are
 * body regions, not specific exercises.
 */
const BODY_REGION_NAMES: Record<string, string> = {
  S4208: "Full Body",
  S4209: "Shoulders",
  S4210: "Arms",
  S4211: "Chest",
  S4212: "Back",
  S4213: "Abs",
  S4214: "Legs & Hips"
};

/**
 * Resolve a COROS strength exercise name for display (English).
 * - Built-in library codes (T####/S####) come from the bundled dictionary.
 * - Unstructured-session body-region S-codes come from BODY_REGION_NAMES.
 * - User-custom exercises carry a readable `rawName` in the payload; use it.
 * - Anything unresolved falls back to the key verbatim (never throws).
 */
export function resolveExerciseName(nameKey: string, rawName?: string): string {
  const mapped = NAME_MAP[nameKey] ?? BODY_REGION_NAMES[nameKey];
  if (mapped) {
    return mapped;
  }
  if (rawName && rawName.trim() && !CODE_RE.test(rawName.trim())) {
    return rawName.trim();
  }
  return nameKey;
}
