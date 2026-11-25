import type { CorosWatchfaceAnimation, CorosWatchfacePreviewAnimation } from "../types";
import { normalizeAnimationDelays } from "./watchfaceAnimation";
import { watchAnimationOutcome, type WatchAnimationOutcome, type WatchAnimationTarget } from "./watchfaceAnimationOutcome";
import { loadStudioImage } from "./watchfaceStudio";

/** Above this the website's copy is left out; the export itself still goes ahead. */
export const MAX_PREVIEW_ANIMATION_BYTES = 16 * 1024 * 1024;

/**
 * The face's animation as the website plays it over the exported preview, the way the
 * editor's own preview plays it: the frames the target watch plays (none on a watch without
 * animation, its 64 colors and the frames that fit on memory-in-pixel), at the position the
 * build writes. Undefined when there is nothing to play.
 */
export async function buildPreviewAnimation(input: {
  animation: CorosWatchfaceAnimation | undefined;
  /** Preview pixels across the face (the base resolution the design is drawn in). */
  previewWidth: number;
  /** Edge of the exported preview and of `under` and `over`. */
  size: number;
  under: string;
  over: string;
  target: (WatchAnimationTarget & { previewSize: number }) | undefined;
}): Promise<CorosWatchfacePreviewAnimation | undefined> {
  const { animation, previewWidth, size, target } = input;
  if (!animation?.enabled || !animation.frames.length || previewWidth <= 0) return undefined;
  const toOutput = size / previewWidth;
  const watchScale = target ? target.previewSize / previewWidth : 1;
  const outcome: WatchAnimationOutcome = await watchAnimationOutcome(animation, target, watchScale)
    .catch((): WatchAnimationOutcome => ({ kind: "unmeasured" }));
  if (outcome.kind === "unsupported" || outcome.kind === "tooLarge") return undefined;

  let preview: Omit<CorosWatchfacePreviewAnimation, "version" | "size" | "under" | "over" | "watch">;
  if (outcome.kind === "fitted") {
    if (!outcome.kept.length || !outcome.frames.length) return undefined;
    // As the editor draws a kept frame: the build's rounded position plus the trimmed margin, in watch pixels.
    const toCanvas = toOutput / outcome.scale;
    const [first] = outcome.frames;
    preview = {
      x: (Math.round(animation.x * outcome.scale) + outcome.x) * toCanvas,
      y: (Math.round(animation.y * outcome.scale) + outcome.y) * toCanvas,
      width: first!.width * toCanvas,
      height: first!.height * toCanvas,
      delays: [...outcome.delays],
      frames: outcome.frames.map(frameDataUrl)
    };
  } else {
    const image = await loadStudioImage(animation.frames[0]!);
    preview = {
      x: animation.x * toOutput,
      y: animation.y * toOutput,
      width: image.naturalWidth * toOutput,
      height: image.naturalHeight * toOutput,
      delays: normalizeAnimationDelays(animation.delays, animation.frames.length),
      frames: [...animation.frames]
    };
  }
  const result: CorosWatchfacePreviewAnimation = {
    version: 1,
    size,
    ...preview,
    under: input.under,
    over: input.over,
    ...(target ? { watch: target.model } : {})
  };
  const bytes = [result.under, result.over, ...result.frames].reduce((sum, url) => sum + url.length, 0);
  return bytes > MAX_PREVIEW_ANIMATION_BYTES ? undefined : result;
}

function frameDataUrl(frame: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  canvas.getContext("2d")?.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
}
