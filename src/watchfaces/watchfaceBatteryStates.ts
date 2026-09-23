/** COROS's standard twelve-frame battery folder, in firmware order. */
export const COROS_BATTERY_STATE_ORDER = "00 = charging; 01 = 0% (empty/critical); 02–11 = 10–100% in 10% steps.";

export function batteryStateMeaning(stateCount: number, index: number): string | null {
  if (stateCount !== 12 || index < 0 || index > 11) return null;
  return index === 0 ? "Charging" : `${(index - 1) * 10}%`;
}

/** Unknown template counts retain the legacy approximate preview mapping. */
export function batteryPreviewStateIndex(stateCount: number, percentage?: number): number {
  const charge = percentage === undefined || !Number.isFinite(percentage) ? 82 : percentage;
  const clamped = Math.max(0, Math.min(100, charge));
  if (stateCount === 12) return 1 + Math.floor(clamped / 10);
  if (percentage === undefined || !Number.isFinite(percentage)) return Math.min(8, Math.max(0, stateCount - 1));
  const levels = Math.max(1, Math.min(10, stateCount));
  return Math.min(levels - 1, Math.floor(clamped / 100 * levels));
}

/** Sparse replacement keys are firmware positions, never a compacted list. */
export function batteryReplacementStateCount(states: Record<string, unknown> | undefined): number {
  return Math.max(0, ...Object.keys(states ?? {}).filter(key => /^\d+$/.test(key)).map(key => Number(key) + 1));
}
