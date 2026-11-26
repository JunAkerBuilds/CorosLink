"use client";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { angleOfFrame, frameFromDrag, frameFromHover, stripPosition, wrapFrame } from "@/lib/turntable";
import { t } from "@/lib/i18n";
import "./TurntableFigure.css";

/**
 * A figure photographed all the way round, as one horizontal strip of `frames` views per theme.
 * Turn it by moving the mouse across it, by dragging (mouse or finger; it goes round and round),
 * or with the left and right arrow keys.
 */
export function TurntableFigure({ light, dark, label, frames = 12, width = 176, height = 550, startFrame = 0 }: {
  /** Strip for the light look. */
  light: string;
  /** Strip for the dark look. */
  dark: string;
  /** What the figure shows, for screen readers. */
  label: string;
  frames?: number;
  width?: number;
  height?: number;
  startFrame?: number;
}) {
  const [frame, setFrame] = useState(() => wrapFrame(startFrame, frames));
  const drag = useRef<{ x: number; frame: number; pointer: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, frame, pointer: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const held = drag.current;
    if (held && held.pointer === e.pointerId) {
      setFrame(frameFromDrag(held.frame, e.clientX - held.x, rect.width / frames, frames));
    } else if (e.pointerType === "mouse") {
      setFrame(frameFromHover(e.clientX - rect.left, rect.width, frames));
    }
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setFrame((f) => wrapFrame(f + 1, frames));
    else if (e.key === "ArrowLeft") setFrame((f) => wrapFrame(f - 1, frames));
    else if (e.key === "Home") setFrame(0);
    else return;
    e.preventDefault();
  };

  const position = stripPosition(frame, frames);
  const box = { width, height, "--tt-frames": frames } as CSSProperties;
  return (
    <div
      className="tt"
      role="img"
      aria-roledescription={t("turntable figure")}
      aria-label={`${label} ${t("Turned {deg}°. Left and right arrow keys turn it.", { deg: angleOfFrame(frame, frames) })}`}
      tabIndex={0}
      style={box}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={onKeyDown}
    >
      <div className="tt-strip" data-look="light" style={{ backgroundImage: `url(${light})`, backgroundPositionX: position }} />
      <div className="tt-strip" data-look="dark" style={{ backgroundImage: `url(${dark})`, backgroundPositionX: position }} />
    </div>
  );
}
