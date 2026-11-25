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

/**
 * Freeform background elements are displayed as sub-layers instead of being
 * returned by the firmware-layer model. Selection validation must still
 * recognize them, or their inspector is replaced with Background immediately.
 */
export function watchfaceEditorSelectionExists(
  selectedId: string,
  layers: ReadonlyArray<{ id: string }>,
  backgroundElements: ReadonlyArray<{ id: string }>
): boolean {
  if (layers.some((layer) => layer.id === selectedId)) return true;
  if (!selectedId.startsWith("bgel:")) return false;
  return backgroundElements.some(
    (element) => `bgel:${element.id}` === selectedId
  );
}

export function rotatedCenterBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  skewX = 0,
  skewY = 0
): WatchfaceEditorBounds {
  if (Math.abs(skewX) > 0.001 || Math.abs(skewY) > 0.001) {
    const radians = (rotation * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const tangentX = Math.tan((Math.max(-80, Math.min(80, skewX)) * Math.PI) / 180);
    const tangentY = Math.tan((Math.max(-80, Math.min(80, skewY)) * Math.PI) / 180);
    const points = [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2, height / 2],
      [-width / 2, height / 2]
    ].map(([localX, localY]) => {
      const skewedX = localX! + localY! * tangentX;
      const skewedY = localY! + localX! * tangentY;
      return {
        x: x + skewedX * cosine - skewedY * sine,
        y: y + skewedX * sine + skewedY * cosine
      };
    });
    return {
      x0: Math.min(...points.map((point) => point.x)),
      y0: Math.min(...points.map((point) => point.y)),
      x1: Math.max(...points.map((point) => point.x)),
      y1: Math.max(...points.map((point) => point.y))
    };
  }
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
