// A status image's height in px as its scale (parts/StudioSpotHeight.tsx).

/** The scale that draws the image `height` px tall, from its box at `scale`. */
export function scaleForHeight(boxHeight: number, scale: number, height: number): number {
  return Math.max(0.1, Math.min(4, (scale * height) / Math.max(1, boxHeight)));
}
