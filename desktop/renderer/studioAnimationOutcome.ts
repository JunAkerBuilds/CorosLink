// What the face's watch plays of its animation, worked out with the compiler's own rules (watchfaceAnimationOutcome.ts),
// in words for the Animation inspector, and which frames it leaves out. CorosLink's animation outcome notice.
import { useEffect, useState } from "react";
import type { CorosWatchfaceAnimation } from "../watchface/types";
import { getWatchfaceTarget } from "../watchface/watchfaceTargets";
import { quickAnimationOutcome, watchAnimationOutcome, type WatchAnimationOutcome } from "../watchface/engine/watchfaceAnimationOutcome";

/** One sentence on what `watch` plays; null while it is being measured. */
export function animationOutcomeText(outcome: WatchAnimationOutcome | null, watch: string): string {
  if (!outcome) return `Checking what ${watch} plays…`;
  switch (outcome.kind) {
    case "unsupported": return `${watch} doesn't play animations, so its face is built without this one.`;
    case "tooLarge": return `One frame alone is too large for ${watch}, so the face is built without it. Use smaller frames.`;
    case "unmeasured": return `Couldn't check what ${watch} plays. Building the face will say.`;
    case "fitted": {
      const { kept, total } = outcome;
      if (kept.length === 1 && total > 1) return `Too large for ${watch}: it shows the first frame only, as a still.`;
      if (kept.length < total) {
        return `Too large for ${watch} with all ${total} frames: it plays ${kept.length}, each held longer so the loop keeps its length.${outcome.capped ? " The loop is shorter too: a frame stays up 65.5 s at most." : ""}`;
      }
      return `Plays all ${total} frames on ${watch}, in its 64 colors (${Math.max(1, Math.round(outcome.bytes / 65535 * 100))}% of its animation memory).`;
    }
    default: return `Plays on ${watch} while the face is lit. Always-on shows no animation.`;
  }
}

/** Frame indexes the watch leaves out (dimmed in the frame list). */
export function droppedFrames(outcome: WatchAnimationOutcome | null, total: number): Set<number> {
  if (!outcome) return new Set();
  if (outcome.kind === "unsupported" || outcome.kind === "tooLarge") return new Set(Array.from({ length: total }, (_, i) => i));
  if (outcome.kind !== "fitted") return new Set();
  const kept = new Set(outcome.kept);
  return new Set(Array.from({ length: total }, (_, i) => i).filter((i) => !kept.has(i)));
}

/**
 * The outcome for the face's watch (`model`), measured after edits settle. `previewWidth` is the template's preview
 * resolution: the build scales frames by the watch's screen over it.
 */
export function useAnimationOutcome(animation: CorosWatchfaceAnimation | undefined, model: string, previewWidth: number | undefined): WatchAnimationOutcome | null {
  const target = getWatchfaceTarget(model);
  const frames = animation?.enabled ? animation.frames : undefined, delays = animation?.delays;
  const scale = target && previewWidth ? target.previewSize / previewWidth : 1;
  const quick = frames?.length ? quickAnimationOutcome(target) : null;
  const hasQuick = quick !== null;
  const [measured, setMeasured] = useState<{ frames: string[]; delays: number[]; scale: number; outcome: WatchAnimationOutcome } | null>(null);
  useEffect(() => {
    if (!frames?.length || !delays || hasQuick) return;
    let live = true;
    // Reading every frame's pixels waits for edits (delays, new frames) to settle.
    const timer = setTimeout(() => {
      void watchAnimationOutcome({ enabled: true, x: 0, y: 0, width: 0, height: 0, frames, delays }, target, scale)
        .catch((): WatchAnimationOutcome => ({ kind: "unmeasured" }))
        .then((outcome) => { if (live) setMeasured({ frames, delays, scale, outcome }); });
    }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [frames, delays, hasQuick, target, scale]);
  if (!frames?.length) return null;
  if (quick) return quick;
  // An answer for other frames or delays is stale: none until this one is measured.
  return measured && measured.frames === frames && measured.delays === delays && measured.scale === scale ? measured.outcome : null;
}
