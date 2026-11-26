/** Maths for the turntable figure: a strip of `frames` views, one every 360/frames degrees. */

/** Any whole or fractional frame number brought back into 0…frames-1, going round in both directions. */
export function wrapFrame(frame: number, frames: number): number {
  if (frames <= 0) return 0;
  return ((Math.round(frame) % frames) + frames) % frames;
}

/** Hovering: the pointer's place across the figure picks the view directly (left edge = first, right edge = last). */
export function frameFromHover(x: number, width: number, frames: number): number {
  if (width <= 0 || frames <= 0) return 0;
  const k = Math.floor((x / width) * frames);
  return Math.max(0, Math.min(frames - 1, k));
}

/** Dragging: every `pxPerFrame` pixels moved turns one view from where the drag began, wrapping round. */
export function frameFromDrag(startFrame: number, dx: number, pxPerFrame: number, frames: number): number {
  if (pxPerFrame <= 0) return wrapFrame(startFrame, frames);
  return wrapFrame(startFrame + Math.round(dx / pxPerFrame), frames);
}

/** The angle a view shows, 0…360 exclusive. */
export function angleOfFrame(frame: number, frames: number): number {
  if (frames <= 0) return 0;
  return (wrapFrame(frame, frames) * 360) / frames;
}

/** How far to shift the strip, as a CSS background-position-x percentage, to show a view. */
export function stripPosition(frame: number, frames: number): string {
  if (frames <= 1) return "0%";
  return `${((wrapFrame(frame, frames) * 100) / (frames - 1)).toFixed(4)}%`;
}
