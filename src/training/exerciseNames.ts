import exerciseNames from "./exerciseNames.json" with { type: "json" };

const NAME_MAP = exerciseNames as Record<string, string>;
const CODE_RE = /^[TS]\d/;

/**
 * Resolve a COROS strength exercise name for display (English).
 * - Built-in library codes (T####/S####) come from the bundled dictionary.
 * - User-custom exercises carry a readable `rawName` in the payload; use it.
 * - Anything unresolved falls back to the key verbatim (never throws).
 */
export function resolveExerciseName(nameKey: string, rawName?: string): string {
  const mapped = NAME_MAP[nameKey];
  if (mapped) {
    return mapped;
  }
  if (rawName && rawName.trim() && !CODE_RE.test(rawName.trim())) {
    return rawName.trim();
  }
  return nameKey;
}
