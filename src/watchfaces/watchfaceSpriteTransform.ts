import type {
  CorosWatchfaceDesignSprite,
  CorosWatchfaceSpriteCrop,
  CorosWatchfaceTransformOrigin
} from "../../electron/types";

export type WatchfaceSpriteResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export interface WatchfaceSpriteTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface WatchfaceSpriteRotationTransform {
  x?: number;
  y?: number;
  rotation: number;
  rotationDelta: number;
}

export interface WatchfaceGroupTransformItem extends WatchfaceSpriteTransform {
  id: string;
}

const MIN_SPRITE_SIZE = 8;

/** Creates an independent imported-image copy offset visibly from its source. */
export function duplicateWatchfaceDesignSprite(
  source: CorosWatchfaceDesignSprite,
  id: string,
  bounds: { width: number; height: number },
  offset = 16
): CorosWatchfaceDesignSprite {
  const clone = structuredClone(source);
  const shift = (value: number, maximum: number) => {
    const distance = Math.max(1, Math.round(Math.abs(offset)));
    if (value + distance <= maximum) return value + distance;
    if (value - distance >= 0) return value - distance;
    return value;
  };
  return {
    ...clone,
    id,
    x: shift(source.x, bounds.width),
    y: shift(source.y, bounds.height)
  };
}

/**
 * Reorders imported images using the layer panel's front-to-back display.
 * Later array entries paint above earlier ones on the canvas.
 */
export function reorderWatchfaceDesignSpriteLayer(
  sprites: CorosWatchfaceDesignSprite[],
  draggedSpriteId: string,
  targetSpriteId: string,
  placement: "before" | "after"
): CorosWatchfaceDesignSprite[] {
  if (draggedSpriteId === targetSpriteId) return sprites;
  const dragged = sprites.find((sprite) => sprite.id === draggedSpriteId);
  if (!dragged || !sprites.some((sprite) => sprite.id === targetSpriteId)) {
    return sprites;
  }
  const reordered = sprites.filter((sprite) => sprite.id !== draggedSpriteId);
  const targetIndex = reordered.findIndex(
    (sprite) => sprite.id === targetSpriteId
  );
  // "Before" means visually above the target, which is later in paint order.
  reordered.splice(placement === "before" ? targetIndex + 1 : targetIndex, 0, dragged);
  if (reordered.every((sprite, index) => sprite === sprites[index])) return sprites;
  return reordered;
}

function handleSigns(
  handle: WatchfaceSpriteResizeHandle
): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  switch (handle) {
    case "nw":
      return { x: -1, y: -1 };
    case "n":
      return { x: 0, y: -1 };
    case "ne":
      return { x: 1, y: -1 };
    case "e":
      return { x: 1, y: 0 };
    case "se":
      return { x: 1, y: 1 };
    case "s":
      return { x: 0, y: 1 };
    case "sw":
      return { x: -1, y: 1 };
    case "w":
      return { x: -1, y: 0 };
  }
}

export function normalizeWatchfaceRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

/**
 * Applies a Figma-style corner resize to a centered, rotated sprite. The
 * opposite corner stays fixed while the sprite center follows the handle.
 */
export function resizeWatchfaceSprite(
  initial: WatchfaceSpriteTransform,
  handle: WatchfaceSpriteResizeHandle,
  pointerDx: number,
  pointerDy: number,
  preserveAspectRatio = false,
  fromCenter = false
): WatchfaceSpriteTransform {
  const signs = handleSigns(handle);
  const radians = (initial.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localDx = pointerDx * cosine + pointerDy * sine;
  const localDy = -pointerDx * sine + pointerDy * cosine;
  const resizeFactor = fromCenter ? 2 : 1;
  let width = signs.x === 0
    ? initial.width
    : Math.max(
        MIN_SPRITE_SIZE,
        initial.width + signs.x * localDx * resizeFactor
      );
  let height = signs.y === 0
    ? initial.height
    : Math.max(
        MIN_SPRITE_SIZE,
        initial.height + signs.y * localDy * resizeFactor
      );

  if (preserveAspectRatio) {
    const widthScale = width / initial.width;
    const heightScale = height / initial.height;
    const scale = signs.x === 0
      ? heightScale
      : signs.y === 0
        ? widthScale
        : Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
          ? widthScale
          : heightScale;
    width = Math.max(MIN_SPRITE_SIZE, initial.width * scale);
    height = Math.max(MIN_SPRITE_SIZE, initial.height * scale);
  }

  const centerLocalX = fromCenter
    ? 0
    : (signs.x * (width - initial.width)) / 2;
  const centerLocalY = fromCenter
    ? 0
    : (signs.y * (height - initial.height)) / 2;
  return {
    x: initial.x + centerLocalX * cosine - centerLocalY * sine,
    y: initial.y + centerLocalX * sine + centerLocalY * cosine,
    width,
    height,
    rotation: initial.rotation
  };
}

/** Calculates the signed rotation change from two pointer locations. */
export function rotateWatchfaceSprite(
  initial: WatchfaceSpriteTransform,
  startPointer: { x: number; y: number },
  currentPointer: { x: number; y: number },
  origin: CorosWatchfaceTransformOrigin = { x: 0.5, y: 0.5 },
  snapIncrement = 0
): WatchfaceSpriteRotationTransform {
  const pivot = watchfaceTransformOriginPoint(initial, origin);
  const startAngle = Math.atan2(
    startPointer.y - pivot.y,
    startPointer.x - pivot.x
  );
  const currentAngle = Math.atan2(
    currentPointer.y - pivot.y,
    currentPointer.x - pivot.x
  );
  let rotationDelta = ((currentAngle - startAngle) * 180) / Math.PI;
  if (rotationDelta > 180) rotationDelta -= 360;
  if (rotationDelta < -180) rotationDelta += 360;
  let rotation = normalizeWatchfaceRotation(initial.rotation + rotationDelta);
  if (snapIncrement > 0) {
    rotation = normalizeWatchfaceRotation(
      Math.round(rotation / snapIncrement) * snapIncrement
    );
    rotationDelta = rotation - initial.rotation;
    if (rotationDelta > 180) rotationDelta -= 360;
    if (rotationDelta < -180) rotationDelta += 360;
  }
  const localX = (origin.x - 0.5) * initial.width;
  const localY = (origin.y - 0.5) * initial.height;
  const radians = (rotation * Math.PI) / 180;
  return origin.x === 0.5 && origin.y === 0.5
    ? { rotation, rotationDelta }
    : {
        x: pivot.x - localX * Math.cos(radians) + localY * Math.sin(radians),
        y: pivot.y - localX * Math.sin(radians) - localY * Math.cos(radians),
        rotation,
        rotationDelta
      };
}

export function normalizeWatchfaceSkew(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(-80, Math.min(80, value!)) : 0;
}

export function normalizeWatchfaceOpacity(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 1;
}

export function normalizeWatchfaceTransformOrigin(
  origin: CorosWatchfaceTransformOrigin | undefined
): CorosWatchfaceTransformOrigin {
  return {
    x: Math.max(0, Math.min(1, Number(origin?.x ?? 0.5))),
    y: Math.max(0, Math.min(1, Number(origin?.y ?? 0.5)))
  };
}

export function normalizeWatchfaceCrop(
  crop: CorosWatchfaceSpriteCrop | undefined
): CorosWatchfaceSpriteCrop {
  const minimum = 0.001;
  if (!crop) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.max(0, Math.min(1 - minimum, Number(crop.x) || 0));
  const y = Math.max(0, Math.min(1 - minimum, Number(crop.y) || 0));
  const width = Math.max(
    minimum,
    Math.min(1 - x, Number(crop.width) || minimum)
  );
  const height = Math.max(
    minimum,
    Math.min(1 - y, Number(crop.height) || minimum)
  );
  return { x, y, width, height };
}

export function watchfaceTransformOriginPoint(
  transform: WatchfaceSpriteTransform,
  origin: CorosWatchfaceTransformOrigin | undefined
): { x: number; y: number } {
  const normalized = normalizeWatchfaceTransformOrigin(origin);
  const localX = (normalized.x - 0.5) * transform.width;
  const localY = (normalized.y - 0.5) * transform.height;
  const radians = (transform.rotation * Math.PI) / 180;
  return {
    x: transform.x + localX * Math.cos(radians) - localY * Math.sin(radians),
    y: transform.y + localX * Math.sin(radians) + localY * Math.cos(radians)
  };
}

/** Changes the pivot while preserving the image's current visual position. */
export function rebaseWatchfaceTransformOrigin(
  transform: WatchfaceSpriteTransform,
  previous: CorosWatchfaceTransformOrigin | undefined,
  next: CorosWatchfaceTransformOrigin | undefined
): WatchfaceSpriteTransform {
  const previousPivot = watchfaceTransformOriginPoint(transform, previous);
  const normalizedNext = normalizeWatchfaceTransformOrigin(next);
  const localX = (normalizedNext.x - 0.5) * transform.width;
  const localY = (normalizedNext.y - 0.5) * transform.height;
  const radians = (transform.rotation * Math.PI) / 180;
  return {
    ...transform,
    x: previousPivot.x - localX * Math.cos(radians) + localY * Math.sin(radians),
    y: previousPivot.y - localX * Math.sin(radians) - localY * Math.cos(radians)
  };
}

/**
 * Applies an axis-aligned selection-box resize to freeform children. Child
 * rotations are preserved while their centers and rendered dimensions follow
 * the transformed selection bounds.
 */
export function resizeWatchfaceTransformGroup(
  items: WatchfaceGroupTransformItem[],
  initialBounds: WatchfaceSpriteTransform,
  nextBounds: WatchfaceSpriteTransform
): WatchfaceGroupTransformItem[] {
  const scaleX = nextBounds.width / Math.max(initialBounds.width, 0.001);
  const scaleY = nextBounds.height / Math.max(initialBounds.height, 0.001);
  return items.map((item) => ({
    ...item,
    x: nextBounds.x + (item.x - initialBounds.x) * scaleX,
    y: nextBounds.y + (item.y - initialBounds.y) * scaleY,
    width: Math.max(MIN_SPRITE_SIZE, item.width * Math.abs(scaleX)),
    height: Math.max(MIN_SPRITE_SIZE, item.height * Math.abs(scaleY))
  }));
}

/** Rotates freeform children around the selection center as one transaction. */
export function rotateWatchfaceTransformGroup(
  items: WatchfaceGroupTransformItem[],
  center: { x: number; y: number },
  rotationDelta: number
): WatchfaceGroupTransformItem[] {
  const radians = (rotationDelta * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return items.map((item) => {
    const localX = item.x - center.x;
    const localY = item.y - center.y;
    return {
      ...item,
      x: center.x + localX * cosine - localY * sine,
      y: center.y + localX * sine + localY * cosine,
      rotation: normalizeWatchfaceRotation(item.rotation + rotationDelta)
    };
  });
}
