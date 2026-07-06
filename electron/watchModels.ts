export type WatchModelId =
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "nomad"
  | "vertix-2"
  | "vertix-2s"
  | "apex-2-pro";

export const PACE_PRO_BYTES = 32 * 1024 * 1024 * 1024;
export const PACE_4_BYTES = 4 * 1024 * 1024 * 1024;
export const PACE_3_BYTES = PACE_4_BYTES;
export const NOMAD_BYTES = PACE_PRO_BYTES;
export const VERTIX_2_BYTES = PACE_PRO_BYTES;
export const VERTIX_2S_BYTES = PACE_PRO_BYTES;
export const APEX_2_PRO_BYTES = PACE_PRO_BYTES;

export function normalizeVolumeName(name?: string): string {
  return (name ?? "")
    .trim()
    .toUpperCase()
    .replace(/^COROS\s+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/PACE(\d)/g, "PACE $1")
    .replace(/\s+/g, " ")
    .trim();
}

function matchWatchModelFromName(
  normalized: string
): WatchModelId | undefined {
  if (/\bPACE\s*PRO\b/.test(normalized)) {
    return "pace-pro";
  }

  if (/\bPACE\s*4\b/.test(normalized)) {
    return "pace-4";
  }

  if (/\bPACE\s*3\b/.test(normalized)) {
    return "pace-3";
  }

  if (/\bNOMAD\b/.test(normalized)) {
    return "nomad";
  }

  if (/\bVERTIX\s*2\s*S\b/.test(normalized)) {
    return "vertix-2s";
  }

  if (/\bVERTIX\s*2\b/.test(normalized)) {
    return "vertix-2";
  }

  if (/\bAPEX\s*2\s*PRO\b/.test(normalized)) {
    return "apex-2-pro";
  }

  return undefined;
}

export function resolveWatchModel(
  name?: string,
  _totalBytes?: number
): WatchModelId | undefined {
  return matchWatchModelFromName(normalizeVolumeName(name));
}

export function fallbackBytesForModel(model?: WatchModelId): number {
  if (
    model === "pace-pro" ||
    model === "nomad" ||
    model === "vertix-2" ||
    model === "vertix-2s" ||
    model === "apex-2-pro"
  ) {
    return PACE_PRO_BYTES;
  }

  if (model === "pace-4" || model === "pace-3") {
    return PACE_4_BYTES;
  }

  return PACE_PRO_BYTES;
}
