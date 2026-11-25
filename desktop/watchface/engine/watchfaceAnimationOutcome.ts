import type { CorosWatchfaceAnimation } from "../types";
import { mip2222, mip2222ToRgba, planMipAnimation, watchPlaysAnimation } from "../compiler/animationFit";
import { loadStudioImage } from "./watchfaceStudio";

/**
 * What the target watch does with the design's animation, worked out with the compiler's own
 * rules (animationFit.ts) so Studio shows what the built face will play.
 */
export type WatchAnimationOutcome =
  /** An AMOLED watch: every frame, as drawn. */
  | { kind: "plays" }
  /** The watch's firmware has no animation; the face is built without it. */
  | { kind: "unsupported" }
  /** A memory-in-pixel watch whose 64 KB frame list cannot hold even one frame. */
  | { kind: "tooLarge" }
  /** The frames could not be read to measure them; only the build will tell. */
  | { kind: "unmeasured" }
  /** A memory-in-pixel watch: frames in its 64 colors, margin cut off, and frames left out if they do not all fit. */
  | {
    kind: "fitted";
    /** Frames the design has. */
    total: number;
    /** The design frames that play, in order. */
    kept: number[];
    /** One delay per kept frame, the left-out frames' time added to the frame before them. */
    delays: number[];
    /** A kept frame's time passed the longest delay, so the loop is shorter than the design's. */
    capped: boolean;
    /** Bytes used of the watch's 65,535. */
    bytes: number;
    /** The kept frames as the watch draws them, in watch pixels. */
    frames: ImageData[];
    /** Where those frames sit relative to the animation's own top-left, in watch pixels. */
    x: number;
    y: number;
    /** Watch pixels per preview pixel the frames were scaled by. */
    scale: number;
  };

export interface WatchAnimationTarget { display: "amoled" | "mip"; model: string }

/** The quick answer that needs no pixels: null when the frames have to be measured. */
export function quickAnimationOutcome(target: WatchAnimationTarget | undefined): WatchAnimationOutcome | null {
  if (!target || target.display === "amoled") return { kind: "plays" };
  return watchPlaysAnimation(target) ? null : { kind: "unsupported" };
}

/** A frame at the watch's size, scaled as the export scales it (see `scaledFrame`), as sRGB pixels. */
async function watchFramePixels(url: string, scale: number): Promise<ImageData> {
  const image = await loadStudioImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  // A plain canvas, like the export's own (`scaledFrame`), so both read the same pixels.
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot read an animation frame.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * What `target` plays of `animation`. `scale` is watch pixels per preview pixel, the factor the
 * export scales this watch's frames by.
 */
export async function watchAnimationOutcome(
  animation: CorosWatchfaceAnimation,
  target: WatchAnimationTarget | undefined,
  scale: number
): Promise<WatchAnimationOutcome> {
  const quick = quickAnimationOutcome(target);
  if (quick) return quick;
  if (!animation.frames.length) return { kind: "plays" };
  const pixels = await Promise.all(animation.frames.map(url => watchFramePixels(url, scale)));
  const { width, height } = pixels[0]!;
  // Mixed sizes are an export error of their own (animationProblem); nothing to fit yet.
  if (pixels.some(frame => frame.width !== width || frame.height !== height)) return { kind: "plays" };
  const plan = planMipAnimation(pixels.map(frame => mip2222(frame.data, width, height)), width, height, animation.delays);
  if (!plan) return { kind: "tooLarge" };
  return {
    kind: "fitted", total: animation.frames.length, kept: plan.kept, delays: plan.delays, capped: plan.capped, bytes: plan.bytes,
    frames: plan.frames.map(frame => new ImageData(mip2222ToRgba(frame) as Uint8ClampedArray<ArrayBuffer>, plan.width, plan.height)),
    x: plan.x, y: plan.y, scale
  };
}

/** Whether the outcome is something the designer should be told about. */
export function animationOutcomeNeedsNotice(outcome: WatchAnimationOutcome | null): boolean {
  return Boolean(outcome && (outcome.kind === "unsupported" || outcome.kind === "tooLarge" || outcome.kind === "unmeasured"
    || (outcome.kind === "fitted" && outcome.kept.length < outcome.total)));
}
