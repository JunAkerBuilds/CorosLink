import type { CorosWatchfaceDesignState } from "../../electron/types";

/**
 * Removes the full-face canvas backing while preserving foreground layers.
 * Drag previews composite this isolated design over a stationary base frame.
 */
export function makeWatchfaceDragForegroundDesign(
  design: CorosWatchfaceDesignState
): CorosWatchfaceDesignState {
  return {
    ...design,
    backgroundColor: "transparent",
    artwork: null,
    artworkVisible: false
  };
}
