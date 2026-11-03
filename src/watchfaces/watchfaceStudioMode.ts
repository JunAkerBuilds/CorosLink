import { createContext, useContext } from "react";

/**
 * Simple shows what a first-time designer needs: what is on the face, its
 * color, font, size and position. Advanced adds the template machinery:
 * switched-off template slots, template images, PNG digit sheets, raw config
 * files and per-watch preview sizes.
 */
export type WatchfaceStudioMode = "simple" | "advanced";

const PREFERENCE_KEY = "coroslink.watchface.studioMode";

/** The last mode picked in the editor; everyone starts in Simple. */
export function loadWatchfaceStudioMode(): WatchfaceStudioMode {
  try {
    const stored = localStorage.getItem(PREFERENCE_KEY);
    if (stored === "simple" || stored === "advanced") return stored;
  } catch {
    // Storage may be unavailable; fall through to the default.
  }
  return "simple";
}

export function saveWatchfaceStudioMode(mode: WatchfaceStudioMode): void {
  try {
    localStorage.setItem(PREFERENCE_KEY, mode);
  } catch {
    // Best effort: the mode still applies for this session.
  }
}

/** Components outside the editor keep every control. */
export const WatchfaceStudioModeContext = createContext<WatchfaceStudioMode>("advanced");

export function useWatchfaceStudioSimple(): boolean {
  return useContext(WatchfaceStudioModeContext) === "simple";
}
