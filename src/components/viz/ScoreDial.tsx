import type { ReactNode } from "react";
import { dialArc } from "@/lib/health";
import "./ScoreDial.css";

/**
 * The open-bottom dial: a three-quarter ring that starts bottom-left, runs over the top and ends bottom-right,
 * filled to `value` out of `max`, with a soft glow under the filled part. Children sit in the middle.
 */
export function ScoreDial({ value, max = 100, size, radius, stroke, color, glow, glowBlur, trackOpacity = 0.1, label, overlay, children }: {
  value: number;
  max?: number;
  /** Width and height in px. */
  size: number;
  radius: number;
  stroke: number;
  /** Colour of the filled arc, normally a hue token. */
  color: string;
  /** Colour of the blurred copy under it. */
  glow: string;
  glowBlur: number;
  trackOpacity?: number;
  label: string;
  /** Drawn on top of the dial inside its SVG (Energy's waking mark). */
  overlay?: ReactNode;
  children?: ReactNode;
}) {
  const arc = dialArc(radius, max > 0 ? value / max : 0);
  const c = size / 2;
  const ring = { cx: c, cy: c, r: radius, fill: "none", transform: `rotate(135 ${c} ${c})` };
  const dash = (length: number) => `${length.toFixed(1)} ${arc.circumference.toFixed(1)}`;
  return (
    <div style={{ position: "relative", width: size, height: size, maxWidth: "100%" }}>
      {/* No wipe here: the track draws in, the value sweeps round it, then its glow blooms underneath. */}
      <svg role="img" aria-label={label} className="no-wipe" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible", maxWidth: "100%" }}>
        {arc.value > 0 ? (
          <circle {...ring} className="dial-glow" style={{ stroke: glow, strokeWidth: stroke, strokeLinecap: "round", strokeDasharray: dash(arc.value), filter: `blur(${glowBlur}px)` }} />
        ) : null}
        <circle {...ring} className="dial-track" style={{ stroke: `rgba(var(--fg-rgb), ${trackOpacity})`, strokeWidth: stroke, strokeLinecap: "round", strokeDasharray: dash(arc.track) }} />
        {arc.value > 0 ? (
          <circle {...ring} className="dial-value" style={{ stroke: color, strokeWidth: stroke, strokeLinecap: "round", strokeDasharray: dash(arc.value) }} />
        ) : null}
        {overlay}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}
