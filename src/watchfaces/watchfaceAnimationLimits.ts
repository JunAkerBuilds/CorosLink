/**
 * Limits of the native sprite animation record (compiled header 0x312), shared
 * by Studio, the automation schema and Watchmaker. Kept free of editor imports.
 */
/** The firmware record times at most this many frames ((0x94 − 0x3c) / 2). */
export const MAX_ANIMATION_FRAMES = 44;
export const MIN_ANIMATION_DELAY = 1;
export const MAX_ANIMATION_DELAY = 65535;
export const DEFAULT_ANIMATION_DELAY = 100;
