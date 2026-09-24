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
  options: { rawEditsApplied?: boolean; generatedAod?: boolean } = {}
): PreparedWatchfaceConversion {
  const sourceDesign = structuredClone(design);
  const portableDesign = structuredClone(sourceDesign);
  if (options.rawEditsApplied) delete portableDesign.configTextEdits;
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
