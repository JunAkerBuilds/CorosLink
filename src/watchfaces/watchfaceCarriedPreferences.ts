import type { CorosWatchfaceDesignState } from "../../electron/types";

/**
 * A recovered face converts by baking a final archive for the destination and
 * reopening it as a starter, so only what its config stores survives. The
 * chart group that was open is editor-only; carry it across so the converted
 * face opens on the same group.
 */
export interface WatchfaceCarriedPreferences {
  /** The chart group that was open; the baked face still carries the others. */
  chartSource?: Partial<Record<"current" | "aod", string>>;
}

export function carriedWatchfacePreferences(design: CorosWatchfaceDesignState): WatchfaceCarriedPreferences | undefined {
  const current = design.nativeData?.chart?.chartSource, aod = design.modeDesigns?.aod?.nativeData?.chart?.chartSource;
  return current || aod ? { chartSource: { ...(current ? { current } : {}), ...(aod ? { aod } : {}) } } : undefined;
}
