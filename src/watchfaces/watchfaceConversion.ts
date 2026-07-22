import type {
  CorosWatchfaceArchive,
  CorosWatchfaceDesignState
} from "../../electron/types";

export interface PreparedWatchfaceConversion {
  design: CorosWatchfaceDesignState;
  sourceDesign: CorosWatchfaceDesignState;
  omittedRawConfigEditCount: number;
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
 * Keeps a lossless source snapshot for cancellation and removes only raw
 * archive-path edits from the portable copy. Semantic Studio edits are authored
 * against the shared 800px master and can be recomposed on the target template.
 */
export function prepareWatchfaceConversion(
  design: CorosWatchfaceDesignState
): PreparedWatchfaceConversion {
  const sourceDesign = structuredClone(design);
  const portableDesign = structuredClone(sourceDesign);
  const omittedRawConfigEditCount = Object.keys(
    portableDesign.configTextEdits ?? {}
  ).length;
  delete portableDesign.configTextEdits;
  return {
    design: portableDesign,
    sourceDesign,
    omittedRawConfigEditCount
  };
}
