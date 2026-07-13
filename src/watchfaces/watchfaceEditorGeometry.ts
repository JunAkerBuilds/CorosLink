export interface WatchfaceEditorBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WatchfaceEditorHitLayer {
  kind: string;
  visible: boolean;
  bounds: WatchfaceEditorBounds | null;
}

export function rotatedCenterBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number
): WatchfaceEditorBounds {
  const radians = (rotation * Math.PI) / 180;
  const rotatedWidth =
    Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const rotatedHeight =
    Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
  return {
    x0: x - rotatedWidth / 2,
    y0: y - rotatedHeight / 2,
    x1: x + rotatedWidth / 2,
    y1: y + rotatedHeight / 2
  };
}

export function editorLayerAtPoint<T extends WatchfaceEditorHitLayer>(
  layers: T[],
  x: number,
  y: number
): T | null {
  const hits = layers.filter(
    (layer) =>
      layer.kind !== "background" &&
      layer.visible &&
      layer.bounds !== null &&
      x >= layer.bounds.x0 &&
      x <= layer.bounds.x1 &&
      y >= layer.bounds.y0 &&
      y <= layer.bounds.y1
  );
  if (hits.length === 0) {
    return layers.find((layer) => layer.kind === "background") ?? null;
  }
  return hits.sort((left, right) => boxArea(left) - boxArea(right))[0]!;
}

function boxArea(layer: WatchfaceEditorHitLayer): number {
  const box = layer.bounds!;
  return (box.x1 - box.x0) * (box.y1 - box.y0);
}
