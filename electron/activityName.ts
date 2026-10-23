/**
 * Activity names as COROS Training Hub takes them: trimmed, never empty and
 * at most 150 UTF-8 bytes, the limit of Training Hub's own rename field.
 * Shared by the main process and the renderer, so no Node imports.
 */
export const ACTIVITY_NAME_MAX_BYTES = 150;

const encoder = new TextEncoder();

export function activityNameBytes(name: string): number {
  return encoder.encode(name).length;
}

/** Drops whole characters from the end until the name fits, as Training Hub's field does. */
export function clipActivityName(name: string): string {
  if (activityNameBytes(name) <= ACTIVITY_NAME_MAX_BYTES) return name;
  let clipped = "";
  let bytes = 0;
  for (const character of name) {
    bytes += activityNameBytes(character);
    if (bytes > ACTIVITY_NAME_MAX_BYTES) break;
    clipped += character;
  }
  return clipped;
}

/** The name to save, or undefined when nothing is left once trimmed. */
export function normalizeActivityName(name: string): string | undefined {
  const trimmed = clipActivityName(name.trim()).trim();
  return trimmed || undefined;
}
