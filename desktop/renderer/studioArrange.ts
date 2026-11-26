// Arranging the face's own artwork (imported images, text and shapes): its paint order and duplicates. CorosLink's
// Move backward / forward (Alt+↑ / Alt+↓, with Shift to the back or front) and ⌘D. Template parts have a fixed order
// on the watch, so only artwork moves.
import { t } from "@/lib/i18n";
import {
  moveWatchfaceArtworkLayer, resolveWatchfaceArtworkLayerOrder, watchfaceBackgroundElementLayerId, watchfaceSpriteLayerId,
} from "../watchface/engine/watchfaceArtworkLayers";
import { MAX_DESIGN_SPRITES } from "../watchface/engine/watchfaceBackground";
import type { Design } from "./studioFace";

export type ArrangeStep = "forward" | "backward" | "front" | "back";

/** Whether the layer is the face's own artwork, which has a paint order. */
export const isArtwork = (layerId: string) => layerId.startsWith("sprite:") || layerId.startsWith("bgel:");

/** Moves artwork one step, or to the front or back, of the artwork paint order. */
export function arrange(design: Design, layerId: string, step: ArrangeStep): Design {
  const order = resolveWatchfaceArtworkLayerOrder(design);
  if (!order.includes(layerId)) return design;
  let next: string[];
  if (step === "front" || step === "back") {
    const rest = order.filter((id) => id !== layerId);
    next = step === "front" ? [...rest, layerId] : [layerId, ...rest];
  } else next = moveWatchfaceArtworkLayer(order, layerId, step);
  return next.every((id, i) => id === order[i]) ? design : { ...design, artworkLayerOrder: next };
}

/** Where the layer stands in the artwork order, 0 at the back, and how many there are. */
export function artworkPlace(design: Design, layerId: string): { index: number; count: number } {
  const order = resolveWatchfaceArtworkLayerOrder(design);
  return { index: order.indexOf(layerId), count: order.length };
}

const OFFSET = 16;
const freshId = (taken: Set<string>, base: string) => {
  for (let i = 2; ; i++) { const id = `${base}-${i}`; if (!taken.has(id)) return id; }
};

/**
 * A copy of an image, text or shape, 16 px down and right, just above the original. Returns the design and the copy's
 * layer id, or null for anything that isn't the face's own artwork.
 */
export function duplicate(design: Design, layerId: string): { design: Design; layerId: string } | null {
  const order = resolveWatchfaceArtworkLayerOrder(design);
  const above = (id: string) => { const at = order.indexOf(layerId); const next = [...order]; next.splice(at + 1, 0, id); return next; };
  if (layerId.startsWith("sprite:")) {
    const sprites = design.designSprites ?? [];
    const source = sprites.find((s) => watchfaceSpriteLayerId(s.id) === layerId);
    if (!source) return null;
    if (sprites.length >= MAX_DESIGN_SPRITES) throw new Error(t("A face can hold up to {max} imported images.", { max: MAX_DESIGN_SPRITES }));
    const id = freshId(new Set(sprites.map((s) => s.id)), source.id.replace(/-\d+$/, ""));
    const copy = { ...source, id, x: source.x + OFFSET, y: source.y + OFFSET, ...(source.name ? { name: `${source.name} copy` } : {}) };
    const at = sprites.indexOf(source);
    const lid = watchfaceSpriteLayerId(id);
    return { design: { ...design, designSprites: [...sprites.slice(0, at + 1), copy, ...sprites.slice(at + 1)], artworkLayerOrder: above(lid) }, layerId: lid };
  }
  if (layerId.startsWith("bgel:")) {
    const elements = design.backgroundElements ?? [];
    const source = elements.find((e) => watchfaceBackgroundElementLayerId(e.id) === layerId);
    if (!source) return null;
    const id = freshId(new Set(elements.map((e) => e.id)), source.id.replace(/-\d+$/, ""));
    const copy = { ...source, id, x: source.x + OFFSET, y: source.y + OFFSET };
    const at = elements.indexOf(source);
    const lid = watchfaceBackgroundElementLayerId(id);
    return { design: { ...design, backgroundElements: [...elements.slice(0, at + 1), copy, ...elements.slice(at + 1)], artworkLayerOrder: above(lid) }, layerId: lid };
  }
  return null;
}
