/** Where a walkthrough card sits relative to the part of the editor it explains. */
export type WatchfaceTourPlacement = "right" | "left" | "bottom" | "top";

export interface WatchfaceTourBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatchfaceTourCardPosition {
  x: number;
  y: number;
  placement: WatchfaceTourPlacement | "center";
}

/** Space between the spotlight ring and the card, and between the card and the window edge. */
export const WATCHFACE_TOUR_GAP = 14;
export const WATCHFACE_TOUR_MARGIN = 16;

/**
 * The first preferred side the card fits on whole, slid along that side to
 * stay inside the window. A card that fits nowhere (or has no target) is
 * centered.
 */
export function placeWatchfaceTourCard(
  target: WatchfaceTourBox | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  order: WatchfaceTourPlacement[]
): WatchfaceTourCardPosition {
  const centered: WatchfaceTourCardPosition = {
    x: Math.max(WATCHFACE_TOUR_MARGIN, (viewport.width - card.width) / 2),
    y: Math.max(WATCHFACE_TOUR_MARGIN, (viewport.height - card.height) / 2),
    placement: "center"
  };
  if (!target) return centered;
  const clampX = (x: number) => Math.min(Math.max(x, WATCHFACE_TOUR_MARGIN), viewport.width - WATCHFACE_TOUR_MARGIN - card.width);
  const clampY = (y: number) => Math.min(Math.max(y, WATCHFACE_TOUR_MARGIN), viewport.height - WATCHFACE_TOUR_MARGIN - card.height);
  const centerX = target.x + target.width / 2 - card.width / 2;
  const centerY = target.y + target.height / 2 - card.height / 2;
  for (const placement of order) {
    if (placement === "right") {
      const x = target.x + target.width + WATCHFACE_TOUR_GAP;
      if (x + card.width <= viewport.width - WATCHFACE_TOUR_MARGIN) return { x, y: clampY(centerY), placement };
    } else if (placement === "left") {
      const x = target.x - WATCHFACE_TOUR_GAP - card.width;
      if (x >= WATCHFACE_TOUR_MARGIN) return { x, y: clampY(centerY), placement };
    } else if (placement === "bottom") {
      const y = target.y + target.height + WATCHFACE_TOUR_GAP;
      if (y + card.height <= viewport.height - WATCHFACE_TOUR_MARGIN) return { x: clampX(centerX), y, placement };
    } else {
      const y = target.y - WATCHFACE_TOUR_GAP - card.height;
      if (y >= WATCHFACE_TOUR_MARGIN) return { x: clampX(centerX), y, placement };
    }
  }
  return centered;
}

/** The spotlight hole: the target grown by `pad`, kept inside the window. */
export function watchfaceTourSpot(target: WatchfaceTourBox, viewport: { width: number; height: number }, pad: number): WatchfaceTourBox {
  const x = Math.max(4, target.x - pad);
  const y = Math.max(4, target.y - pad);
  const right = Math.min(viewport.width - 4, target.x + target.width + pad);
  const bottom = Math.min(viewport.height - 4, target.y + target.height + pad);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}
