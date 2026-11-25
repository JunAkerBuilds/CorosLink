// The face's animation playing on the Studio canvas: the frames between the face drawn below them (background and its
// artwork) and above them (time, data, status), the order the watch draws them in.
import { useEffect, useState } from "react";
import type { CorosWatchfaceAnimation } from "../../watchface/types";
import { animationFrameAt, animationNextChange } from "../../watchface/engine/watchfaceAnimation";

/** Playing, or held on frame `still` (picked in the inspector). */
export interface AnimationPlayback { playing: boolean; still: number }

export function AnimationPlayer({ animation, parts, scale, playback }: {
  animation: CorosWatchfaceAnimation; parts: { under: string; over: string }; scale: number; playback: AnimationPlayback;
}) {
  const { frames, delays } = animation;
  const [playingFrame, setPlayingFrame] = useState(0);
  const delayKey = delays.join(",");
  useEffect(() => {
    if (!playback.playing) return;
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
  }, [playback.playing, frames.length, delayKey]);
  const shown = playback.playing ? playingFrame : Math.min(playback.still, frames.length - 1);
  const box = { left: animation.x * scale, top: animation.y * scale, width: animation.width * scale, height: animation.height * scale };
  return (
    <div className="st-anim-play" aria-hidden="true">
      <img className="st-face-img" src={parts.under} alt="" draggable={false} />
      {/* Every frame stays decoded; only the one up shows, so playback never waits on an image. */}
      {frames.map((f, i) => <img key={i} className="st-anim-frame" src={f} alt="" draggable={false} style={{ ...box, visibility: i === shown ? "visible" : "hidden" }} />)}
      <img className="st-face-img" src={parts.over} alt="" draggable={false} />
    </div>
  );
}
