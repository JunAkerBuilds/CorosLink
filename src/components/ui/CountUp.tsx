"use client";
import { useLayoutEffect, useRef } from "react";
import { COUNT_DELAY_MS, COUNT_DURATION_MS, countUpFormat, easeOut } from "@/lib/countUp";

/**
 * A big figure that counts up from zero once when it first appears, then ends on exactly `text`.
 * Later changes (a food added, a new hover) just show. Text that isn't a figure, or is a time of day, shows as it is.
 * Holds still for people who ask for less motion. Only for figures 20 px and larger.
 */
export function CountUp({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const played = useRef(false);

  useLayoutEffect(() => {
    if (played.current) return;
    const node = ref.current?.firstChild;
    const fmt = countUpFormat(text);
    if (!node || node.nodeType !== Node.TEXT_NODE || !fmt) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    played.current = true;
    let last = fmt(0);
    let done = false;
    node.nodeValue = last;
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      // React wrote a new value meanwhile: stop and leave it.
      if (node.nodeValue !== last) { done = true; return; }
      start ??= now;
      const p = Math.min(1, Math.max(0, (now - start - COUNT_DELAY_MS) / COUNT_DURATION_MS));
      last = p >= 1 ? text : fmt(easeOut(p));
      node.nodeValue = last;
      if (p < 1) frame = requestAnimationFrame(tick);
      else done = true;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (!done) {
        if (node.nodeValue === last) node.nodeValue = text;
        // Unmounted or re-run before finishing (React's strict mode does this): let the next run play it.
        played.current = false;
      }
    };
  }, [text]);

  return <span ref={ref} className={className} style={style}>{text}</span>;
}
