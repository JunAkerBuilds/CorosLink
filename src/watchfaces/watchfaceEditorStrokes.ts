import type {
  CorosWatchfaceBackgroundElement,
  CorosWatchfaceDesignState,
  CorosWatchfaceShadowEffect,
  CorosWatchfaceStroke,
  CorosWatchfaceStrokePaint
} from "../../electron/types";
import {
  renderWatchfaceCanvasEffects,
  type WatchfaceEffectPadding
} from "./watchfaceEditorEffects.ts";

let strokeCounter = 0;

function finite(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function color(value: string | undefined, fallback = "#51e0b5"): string {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : fallback;
}

export function createWatchfaceStroke(
  fallbackColor = "#51e0b5"
): CorosWatchfaceStroke {
  strokeCounter += 1;
  return {
    id: `stroke-${Date.now().toString(36)}-${strokeCounter}`,
    enabled: true,
    paint: { kind: "solid", color: color(fallbackColor) },
    opacity: 1,
    position: "outside",
    weight: 1
  };
}

export function normalizeWatchfaceStrokePaint(
  paint: CorosWatchfaceStrokePaint | undefined
): CorosWatchfaceStrokePaint {
  if (paint?.kind === "linear-gradient") {
    return {
      kind: "linear-gradient",
      from: color(paint.from),
      to: color(paint.to, "#000000"),
      angle: ((finite(paint.angle, -3600, 3600, 90) % 360) + 360) % 360
    };
  }
  return {
    kind: "solid",
    color: color(paint?.kind === "solid" ? paint.color : undefined)
  };
}

export function normalizeWatchfaceStroke(
  stroke: CorosWatchfaceStroke
): CorosWatchfaceStroke {
  return {
    id: stroke.id || createWatchfaceStroke().id,
    enabled: stroke.enabled !== false,
    paint: normalizeWatchfaceStrokePaint(stroke.paint),
    opacity: finite(stroke.opacity, 0, 1, 1),
    position:
      stroke.position === "inside" || stroke.position === "center"
        ? stroke.position
        : "outside",
    weight: finite(stroke.weight, 1, 64, 1)
  };
}

export function normalizeWatchfaceLayerStrokes(
  strokes: Record<string, CorosWatchfaceStroke[]> | undefined
): Record<string, CorosWatchfaceStroke[]> {
  return Object.fromEntries(
    Object.entries(strokes ?? {}).map(([layerId, values]) => [
      layerId,
      Array.isArray(values) ? values.map(normalizeWatchfaceStroke) : []
    ])
  );
}

export function migrateLegacyBackgroundElementStrokes(
  elements: CorosWatchfaceBackgroundElement[],
  storedStrokes: Record<string, CorosWatchfaceStroke[]> | undefined
): {
  elements: CorosWatchfaceBackgroundElement[];
  layerStrokes: Record<string, CorosWatchfaceStroke[]>;
} {
  const layerStrokes = normalizeWatchfaceLayerStrokes(storedStrokes);
  const elementsWithoutLegacyStroke = elements.map((element) => {
    if (element.kind !== "rect" && element.kind !== "ellipse") return element;
    const layerId = `bgel:${element.id}`;
    const hasStoredStack = Object.prototype.hasOwnProperty.call(
      storedStrokes ?? {},
      layerId
    );
    if (
      !hasStoredStack &&
      element.strokeColor &&
      Number.isFinite(element.strokeWidth) &&
      element.strokeWidth! > 0
    ) {
      layerStrokes[layerId] = [
        normalizeWatchfaceStroke({
          id: `legacy-stroke-${element.id}`,
          enabled: true,
          paint: { kind: "solid", color: element.strokeColor },
          opacity: 1,
          position: "center",
          weight: element.strokeWidth!
        })
      ];
    }
    const {
      strokeColor: _strokeColor,
      strokeWidth: _strokeWidth,
      ...withoutLegacyStroke
    } = element;
    return withoutLegacyStroke;
  });
  return { elements: elementsWithoutLegacyStroke, layerStrokes };
}

export function resolveWatchfaceLayerStrokes(
  design: Pick<CorosWatchfaceDesignState, "layerStrokes">,
  layerId: string
): CorosWatchfaceStroke[] {
  return (design.layerStrokes?.[layerId] ?? []).map(normalizeWatchfaceStroke);
}

export function watchfaceStrokePadding(
  strokes: CorosWatchfaceStroke[],
  scale = 1
): WatchfaceEffectPadding {
  let outward = 0;
  for (const raw of strokes) {
    const stroke = normalizeWatchfaceStroke(raw);
    if (!stroke.enabled || stroke.opacity <= 0) continue;
    const amount =
      stroke.position === "outside"
        ? stroke.weight
        : stroke.position === "center"
          ? stroke.weight / 2
          : 0;
    outward = Math.max(outward, Math.ceil(amount * scale));
  }
  return {
    left: outward,
    top: outward,
    right: outward,
    bottom: outward
  };
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement("canvas");
  result.width = Math.max(1, Math.ceil(width));
  result.height = Math.max(1, Math.ceil(height));
  return result;
}

function context2d(value: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = value.getContext("2d", {
    colorSpace: "display-p3",
    willReadFrequently: true
  });
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

function drawDilatedMask(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  radius: number
): void {
  context.drawImage(source, 0, 0);
  if (radius <= 0) return;
  const samples = Math.max(12, Math.min(48, Math.ceil(radius * 2)));
  for (const ring of [radius / 3, (radius * 2) / 3, radius]) {
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      context.drawImage(
        source,
        Math.cos(angle) * ring,
        Math.sin(angle) * ring
      );
    }
  }
}

function drawErodedMask(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  radius: number
): void {
  context.drawImage(source, 0, 0);
  if (radius <= 0) return;
  const samples = Math.max(12, Math.min(48, Math.ceil(radius * 2)));
  context.globalCompositeOperation = "destination-in";
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    context.drawImage(
      source,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    );
  }
  context.globalCompositeOperation = "source-over";
}

function strokeMask(
  source: HTMLCanvasElement,
  stroke: CorosWatchfaceStroke,
  scale: number
): HTMLCanvasElement {
  const result = canvas(source.width, source.height);
  const resultContext = context2d(result);
  const radius = stroke.weight * scale;
  if (stroke.position === "outside") {
    drawDilatedMask(resultContext, source, radius);
    resultContext.globalCompositeOperation = "destination-out";
    resultContext.drawImage(source, 0, 0);
  } else if (stroke.position === "center") {
    drawDilatedMask(resultContext, source, radius / 2);
    const eroded = canvas(source.width, source.height);
    drawErodedMask(context2d(eroded), source, radius / 2);
    resultContext.globalCompositeOperation = "destination-out";
    resultContext.drawImage(eroded, 0, 0);
  } else {
    resultContext.drawImage(source, 0, 0);
    const eroded = canvas(source.width, source.height);
    drawErodedMask(context2d(eroded), source, radius);
    resultContext.globalCompositeOperation = "destination-out";
    resultContext.drawImage(eroded, 0, 0);
  }
  resultContext.globalCompositeOperation = "source-over";
  return result;
}

function alphaBounds(source: HTMLCanvasElement): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const pixels = context2d(source).getImageData(
    0,
    0,
    source.width,
    source.height
  ).data;
  let x0 = source.width;
  let y0 = source.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[(y * source.width + x) * 4 + 3]! === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x0 < x1 && y0 < y1
    ? { x0, y0, x1, y1 }
    : { x0: 0, y0: 0, x1: source.width, y1: source.height };
}

function paintStyle(
  context: CanvasRenderingContext2D,
  paint: CorosWatchfaceStrokePaint,
  bounds: ReturnType<typeof alphaBounds>
): string | CanvasGradient {
  if (paint.kind === "solid") return paint.color;
  const radians = (paint.angle * Math.PI) / 180;
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  const half = Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) / 2;
  const gradient = context.createLinearGradient(
    cx - Math.cos(radians) * half,
    cy - Math.sin(radians) * half,
    cx + Math.cos(radians) * half,
    cy + Math.sin(radians) * half
  );
  gradient.addColorStop(0, paint.from);
  gradient.addColorStop(1, paint.to);
  return gradient;
}

export function renderWatchfaceCanvasStrokes(
  source: HTMLCanvasElement,
  strokes: CorosWatchfaceStroke[],
  scale = 1,
  includePadding = false
): { canvas: HTMLCanvasElement; padding: WatchfaceEffectPadding } {
  const active = strokes
    .map(normalizeWatchfaceStroke)
    .filter((stroke) => stroke.enabled && stroke.opacity > 0);
  const padding = includePadding
    ? watchfaceStrokePadding(active, scale)
    : { left: 0, top: 0, right: 0, bottom: 0 };
  if (active.length === 0) return { canvas: source, padding };

  const base = canvas(
    source.width + padding.left + padding.right,
    source.height + padding.top + padding.bottom
  );
  const baseContext = context2d(base);
  baseContext.drawImage(source, padding.left, padding.top);
  const bounds = alphaBounds(base);
  const result = canvas(base.width, base.height);
  const resultContext = context2d(result);
  resultContext.drawImage(base, 0, 0);

  for (const stroke of [...active].reverse()) {
    const mask = strokeMask(base, stroke, scale);
    const painted = canvas(base.width, base.height);
    const paintedContext = context2d(painted);
    const outward =
      stroke.position === "outside"
        ? stroke.weight * scale
        : stroke.position === "center"
          ? (stroke.weight * scale) / 2
          : 0;
    paintedContext.fillStyle = paintStyle(paintedContext, stroke.paint, {
      x0: bounds.x0 - outward,
      y0: bounds.y0 - outward,
      x1: bounds.x1 + outward,
      y1: bounds.y1 + outward
    });
    paintedContext.fillRect(0, 0, painted.width, painted.height);
    paintedContext.globalCompositeOperation = "destination-in";
    paintedContext.drawImage(mask, 0, 0);
    resultContext.globalAlpha = stroke.opacity;
    resultContext.drawImage(painted, 0, 0);
    resultContext.globalAlpha = 1;
  }
  return { canvas: result, padding };
}

export function renderWatchfaceCanvasDecorations(
  source: HTMLCanvasElement,
  strokes: CorosWatchfaceStroke[],
  effects: CorosWatchfaceShadowEffect[],
  scale = 1,
  includePadding = false
): { canvas: HTMLCanvasElement; padding: WatchfaceEffectPadding } {
  const stroked = renderWatchfaceCanvasStrokes(
    source,
    strokes,
    scale,
    includePadding
  );
  const effected = renderWatchfaceCanvasEffects(
    stroked.canvas,
    effects,
    scale,
    includePadding
  );
  return {
    canvas: effected.canvas,
    padding: {
      left: stroked.padding.left + effected.padding.left,
      top: stroked.padding.top + effected.padding.top,
      right: stroked.padding.right + effected.padding.right,
      bottom: stroked.padding.bottom + effected.padding.bottom
    }
  };
}

type DataUrlDecorationResult = {
  dataUrl: string;
  padding: WatchfaceEffectPadding;
  width: number;
  height: number;
};

const decorationCache = new Map<string, Promise<DataUrlDecorationResult>>();

function compactHash(value: string): string {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(value.length / 2048));
  for (let index = 0; index < value.length; index += step) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function renderWatchfaceDataUrlDecorations(
  dataUrl: string,
  strokes: CorosWatchfaceStroke[],
  effects: CorosWatchfaceShadowEffect[],
  scale = 1
): Promise<DataUrlDecorationResult> {
  const normalizedStrokes = strokes.map(normalizeWatchfaceStroke);
  const key = [
    compactHash(dataUrl),
    dataUrl.length,
    scale,
    compactHash(JSON.stringify(normalizedStrokes)),
    compactHash(JSON.stringify(effects))
  ].join(":");
  const cached = decorationCache.get(key);
  if (cached) {
    decorationCache.delete(key);
    decorationCache.set(key, cached);
    return cached;
  }
  const rendered = new Promise<DataUrlDecorationResult>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const source = canvas(image.naturalWidth, image.naturalHeight);
        context2d(source).drawImage(image, 0, 0);
        const decorated = renderWatchfaceCanvasDecorations(
          source,
          normalizedStrokes,
          effects,
          scale,
          true
        );
        resolve({
          dataUrl: decorated.canvas.toDataURL("image/png"),
          padding: decorated.padding,
          width: decorated.canvas.width,
          height: decorated.canvas.height
        });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () =>
      reject(new Error("The stroke source image could not be decoded."));
    image.src = dataUrl;
  }).catch((error) => {
    decorationCache.delete(key);
    throw error;
  });
  decorationCache.set(key, rendered);
  while (decorationCache.size > 48) {
    const oldest = decorationCache.keys().next().value as string | undefined;
    if (!oldest) break;
    decorationCache.delete(oldest);
  }
  return rendered;
}
