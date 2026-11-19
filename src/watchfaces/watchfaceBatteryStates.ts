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

interface BatteryFrameSize { width: number; height: number }

/**
 * Whether artwork has (within 5%) the same proportions as a fixed frame, so it
 * may be stretched to fill it. Otherwise callers fit it inside, centered.
 */
export function artworkMatchesFrame(
  frame: BatteryFrameSize,
  artwork: BatteryFrameSize
): boolean {
  if (frame.width <= 0 || frame.height <= 0 || artwork.width <= 0 || artwork.height <= 0) return true;
  const shapeRatio = (frame.width / frame.height) / (artwork.width / artwork.height);
  return Math.abs(shapeRatio - 1) <= 0.05;
}

/**
 * The bitmap frame a fixed-battery state is exported into. Artwork shaped like
 * the template's frame fills that frame (official sets, resized templates).
 * Artwork of another shape keeps its own proportions, at the target
 * resolution's scale, so a wide 125×30 set is never squeezed into a tall
 * template frame. `coversTemplate` is false when some template states keep
 * their original PNGs; the frame then stays the template's so one folder never
 * mixes PNG sizes. `scalesFromArtwork` (see `batteryScalesFromArtwork`) is
 * false for a battery whose saved scale was set against the template frame;
 * it keeps that frame, where the scale already preserves its proportions.
 */
export function batteryStateFrameSize(
  template: BatteryFrameSize | null | undefined,
  artwork: BatteryFrameSize,
  resolutionScale = 1,
  coversTemplate = true,
  scalesFromArtwork = true
): BatteryFrameSize & { native: boolean } {
  const own = {
    width: Math.max(1, Math.round(artwork.width * resolutionScale)),
    height: Math.max(1, Math.round(artwork.height * resolutionScale))
  };
  if (!template || template.width <= 0 || template.height <= 0) return { ...own, native: true };
  const templateFrame = { width: template.width, height: template.height, native: false };
  if (!coversTemplate || !scalesFromArtwork || artwork.width <= 0 || artwork.height <= 0) return templateFrame;
  const shapeRatio = (template.width / template.height) / (artwork.width / artwork.height);
  return Math.abs(shapeRatio - 1) <= 0.05 ? templateFrame : { ...own, native: true };
}

/** Whether every template state has imported artwork (or a single fallback). */
export function batteryStatesCoverTemplate(
  templateStateCount: number,
  states: Record<string, unknown> | undefined,
  hasFallback = false
): boolean {
  if (hasFallback) return true;
  for (let index = 0; index < templateStateCount; index += 1) {
    if (!states?.[String(index)]) return false;
  }
  return true;
}

/**
 * Whether a fixed battery's `scale` multiplies the artwork's own size rather
 * than the artwork fitted into the template frame. Projects saved before own
 * sizing existed hold a scale against the fitted size (a 242×51 set at scale 5
 * was five times its fit in a small frame, not 1210×255), so only a battery
 * marked `ownSize`, or one still at scale 1 where the two differ by the
 * stretch alone, takes its own size.
 */
export function batteryScalesFromArtwork(
  override: { scale?: number; ownSize?: boolean } | undefined
): boolean {
  if (override?.ownSize) return true;
  const scale = override?.scale ?? 1;
  return !Number.isFinite(scale) || scale === 1;
}
