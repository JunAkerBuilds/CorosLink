import type {
  CorosWatchfaceArchive,
  CorosWatchfaceDesignState
} from "../../electron/types";

export interface PreparedWatchfaceConversion {
  design: CorosWatchfaceDesignState;
  sourceDesign: CorosWatchfaceDesignState;
  omittedRawConfigEditCount: number;
}

/** Electron wraps rejected IPC calls, so match the service's sign-in messages. */
export function isWatchfaceSignInRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Sign in to your COROS mobile account\b|Your COROS mobile session expired\./i.test(message);
}

/**
 * Archive resolution profiles describe canvas dimensions, not device identity.
 * Only trust firmware carried by the archive; otherwise keep the model the user
 * explicitly selected in Watch Studio.
 */
export function firmwareTypeForWatchfaceArchive(
  archive: Pick<CorosWatchfaceArchive, "firmwareType">,
  fallback: string
): string {
  return archive.firmwareType?.trim() || fallback;
}

/**
 * Only clear raw edits after the archive converter has incorporated them into
 * the new baseline. Visual state stays editable in the shared 800px master.
 */
export function prepareWatchfaceConversion(
  design: CorosWatchfaceDesignState,
  options: { rawEditsApplied?: boolean; generatedAod?: boolean; aodDesignScale?: number } = {}
): PreparedWatchfaceConversion {
  const sourceDesign = structuredClone(design);
  const portableDesign = structuredClone(sourceDesign);
  if (options.rawEditsApplied) delete portableDesign.configTextEdits;
  const aodScale = options.aodDesignScale;
  if (aodScale && aodScale !== 1 && portableDesign.modeDesigns?.aod) {
    portableDesign.modeDesigns = { ...portableDesign.modeDesigns, aod: scaleAodDesignSizes(portableDesign.modeDesigns.aod, aodScale) };
  }
  if (options.generatedAod && !portableDesign.modeDesigns?.aod) {
    const { version, modeDesigns, configTextEdits, archiveWatchFaceVersion, stripBlankConfigKeys, watchLanguages, ...visual } = structuredClone(portableDesign);
    portableDesign.modeDesigns = { aod: { ...visual, backgroundEdited: true } };
  }
  return {
    design: portableDesign,
    sourceDesign,
    omittedRawConfigEditCount: 0
  };
}

/**
 * A face whose always-on layout existed only at the watch's own size was laid out against that
 * layout; after Convert the 800px master carries it, so font sizes and nudges (dx/dy) in master
 * pixels grow by `scale` to draw the same. Absolute positions already follow the 800px master and stay.
 */
const AOD_SIZE_KEYS = new Set(["fontSize", "dx", "dy"]);

export function scaleAodDesignSizes<T>(design: T, scale: number): T {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key,
      AOD_SIZE_KEYS.has(key) && typeof entry === "number" && Number.isFinite(entry) ? Math.round(entry * scale * 100) / 100
        : typeof entry === "string" && entry.startsWith("data:") ? entry : walk(entry)]));
  };
  return walk(design) as T;
}
