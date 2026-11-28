// The face's animation playing on the Studio canvas: the frames between the face drawn below them (background and its
// artwork) and above them (time, data, status), the order the watch draws them in. Playing, it shows what the face's
// watch plays: on a memory-in-pixel watch its 64 colors and only the frames that fit, held for the ones left out.
import { useEffect, useMemo, useState } from "react";
import type { CorosWatchfaceAnimation } from "../../watchface/types";
import { animationFrameAt, animationNextChange } from "../../watchface/engine/watchfaceAnimation";
import type { WatchAnimationOutcome } from "../../watchface/engine/watchfaceAnimationOutcome";

/** Playing, or held on frame `still` (picked in the inspector). */
export interface AnimationPlayback { playing: boolean; still: number }

interface Reel { frames: string[]; delays: number[]; box: { left: number; top: number; width: number; height: number } }

/** The fitted frames as pictures, placed where the build puts them, in design pixels. */
function watchReel(animation: CorosWatchfaceAnimation, outcome: Extract<WatchAnimationOutcome, { kind: "fitted" }>): Reel {
  const { scale: s, frames } = outcome;
  const canvas = document.createElement("canvas");
  const urls = frames.map((frame) => {
    canvas.width = frame.width; canvas.height = frame.height;
    canvas.getContext("2d")?.putImageData(frame, 0, 0);
    return canvas.toDataURL("image/png");
  });
  const first = frames[0]!;
  return {
    frames: urls, delays: [...outcome.delays],
    box: { left: (Math.round(animation.x * s) + outcome.x) / s, top: (Math.round(animation.y * s) + outcome.y) / s, width: first.width / s, height: first.height / s }
  };
}

export function AnimationPlayer({ animation, parts, scale, playback, outcome = null }: {
  animation: CorosWatchfaceAnimation; parts: { under: string; over: string }; scale: number; playback: AnimationPlayback;
  /** What the watch plays; null while measuring, when the design's own frames play. */
  outcome?: WatchAnimationOutcome | null;
}) {
  const design = useMemo<Reel>(() => ({
    frames: animation.frames, delays: animation.delays,
    box: { left: animation.x, top: animation.y, width: animation.width, height: animation.height }
  }), [animation]);
  const watch = useMemo<Reel | null>(() => {
    if (outcome?.kind === "fitted") return outcome.frames.length ? watchReel(animation, outcome) : null;
    // A watch that plays nothing of it: the face as it is without the animation.
    if (outcome?.kind === "unsupported" || outcome?.kind === "tooLarge") return { frames: [], delays: [], box: design.box };
    return null;
  }, [animation, outcome, design]);
  // Paused, the frame picked in the inspector shows as drawn; playing, what the watch plays.
  const reel = playback.playing && watch ? watch : design;
  const { frames, delays } = reel;
  const [playingFrame, setPlayingFrame] = useState(0);
  const delayKey = delays.join(",");
  useEffect(() => {
    if (!playback.playing || !frames.length) return;
    // One timer per frame change, the frame worked out from the time gone, so a late timer never drifts.
    const start = performance.now();
    let timer = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      setPlayingFrame(animationFrameAt(delays, elapsed));
      const next = animationNextChange(delays, elapsed);
      if (Number.isFinite(next)) timer = window.setTimeout(tick, next);
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.playing, frames, delayKey]);
  const shown = playback.playing ? Math.min(playingFrame, frames.length - 1) : Math.min(playback.still, frames.length - 1);
  const box = { left: reel.box.left * scale, top: reel.box.top * scale, width: reel.box.width * scale, height: reel.box.height * scale };
  return (
    <div className="st-anim-play" aria-hidden="true">
      <img className="st-face-img" src={parts.under} alt="" draggable={false} />
      {/* Every frame stays decoded; only the one up shows, so playback never waits on an image. */}
      {frames.map((f, i) => <img key={i} className="st-anim-frame" src={f} alt="" draggable={false} style={{ ...box, visibility: i === shown ? "visible" : "hidden" }} />)}
      <img className="st-face-img" src={parts.over} alt="" draggable={false} />
    </div>
  );
}
