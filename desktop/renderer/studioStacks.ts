// Stroke and shadow stack edits (parts/StudioStacks.tsx): move one step, switch a stroke's paint, copy a shadow.
import type { CorosWatchfaceShadowEffect, CorosWatchfaceStroke } from "../watchface/types";
import { createWatchfaceShadowEffect } from "../watchface/engine/watchfaceEditorEffects";

/** One step up (toward the front, index − 1) or down a front-to-back stack. */
export function moveInStack<T>(list: T[], index: number, step: -1 | 1): T[] {
  const to = index + step;
  if (index < 0 || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** A stroke's paint switched between solid and gradient, keeping its colours. */
export function strokePaint(paint: CorosWatchfaceStroke["paint"], kind: "solid" | "linear-gradient"): CorosWatchfaceStroke["paint"] {
  if (paint.kind === kind) return paint;
  return kind === "solid" ? { kind: "solid", color: paint.kind === "linear-gradient" ? paint.from : "#000000" }
    : { kind: "linear-gradient", from: paint.kind === "solid" ? paint.color : "#000000", to: "#6aa5ff", angle: 90 };
}

/** A copy of a shadow, with its own id, just below it in the stack. */
export function duplicateShadow(list: CorosWatchfaceShadowEffect[], index: number): CorosWatchfaceShadowEffect[] {
  const source = list[index];
  if (!source) return list;
  const copy = { ...source, id: createWatchfaceShadowEffect(source.kind).id };
  return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
}
