import type {
  CorosWatchfaceBackgroundElement,
  CorosWatchfaceDesignSprite
} from "../../electron/types";

export type WatchfaceArtworkLayerPlacement = "before" | "after";
export type WatchfaceArtworkLayerDirection = "forward" | "backward";

export function watchfaceSpriteLayerId(spriteId: string): string {
  return `sprite:${spriteId}`;
}

export function watchfaceBackgroundElementLayerId(elementId: string): string {
  return `bgel:${elementId}`;
}

/**
 * Returns authored artwork in bottom-to-top paint order. Legacy projects did
 * not store an explicit order, so shapes retain their historical position
 * below every imported image until the user rearranges them.
 */
export function resolveWatchfaceArtworkLayerOrder(
  design: {
    artworkLayerOrder?: string[];
    designSprites?: CorosWatchfaceDesignSprite[];
    backgroundElements?: CorosWatchfaceBackgroundElement[];
  }
): string[] {
  const legacyOrder = [
    ...(design.backgroundElements ?? []).map((element) =>
      watchfaceBackgroundElementLayerId(element.id)
    ),
    ...(design.designSprites ?? []).map((sprite) =>
      watchfaceSpriteLayerId(sprite.id)
    )
  ];
  const existing = new Set(legacyOrder);
  const ordered: string[] = [];
  for (const id of design.artworkLayerOrder ?? []) {
    if (existing.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  for (const id of legacyOrder) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

/**
 * Reorders a bottom-to-top paint list from a front-to-back Layers panel drop.
 * “Before” means visually above the target and therefore later in paint order.
 */
export function reorderWatchfaceArtworkLayer(
  order: string[],
  draggedId: string,
  targetId: string,
  placement: WatchfaceArtworkLayerPlacement
): string[] {
  if (draggedId === targetId) return order;
  if (!order.includes(draggedId) || !order.includes(targetId)) return order;
  const reordered = order.filter((id) => id !== draggedId);
  const targetIndex = reordered.indexOf(targetId);
  reordered.splice(placement === "before" ? targetIndex + 1 : targetIndex, 0, draggedId);
  return reordered.every((id, index) => id === order[index])
    ? order
    : reordered;
}

/** Moves one authored layer a single paint-order step. */
export function moveWatchfaceArtworkLayer(
  order: string[],
  layerId: string,
  direction: WatchfaceArtworkLayerDirection
): string[] {
  const index = order.indexOf(layerId);
  const targetIndex = direction === "forward" ? index + 1 : index - 1;
  if (
    index < 0 ||
    targetIndex < 0 ||
    targetIndex >= order.length
  ) return order;
  const moved = [...order];
  [moved[index], moved[targetIndex]] = [moved[targetIndex]!, moved[index]!];
  return moved;
}
