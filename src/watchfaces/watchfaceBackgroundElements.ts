import type {
  CorosWatchfaceBackgroundElement,
  CorosWatchfaceGradientFill,
  CorosWatchfaceShadowEffect
} from "../../electron/types";
import { renderWatchfaceCanvasEffects } from "./watchfaceEditorEffects";

/** All background shapes are authored in the 800×800 background pixel space. */
export const BACKGROUND_SPACE = 800;

let elementCounter = 0;

function nextElementId(): string {
  elementCounter += 1;
  return `bg-${Date.now().toString(36)}-${elementCounter}`;
}

export function backgroundElementLabel(
  element: CorosWatchfaceBackgroundElement
): string {
  switch (element.kind) {
    case "rect":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "line":
      return "Line";
    case "text":
      return element.text.trim() ? `Text “${element.text.slice(0, 14)}”` : "Text";
  }
}

/** Creates a new shape centered on a point, with sensible defaults. */
export function createBackgroundElement(
  kind: CorosWatchfaceBackgroundElement["kind"],
  center: { x: number; y: number },
  fontFamily: string
): CorosWatchfaceBackgroundElement {
  const id = nextElementId();
  const base = {
    id,
    x: Math.round(center.x),
    y: Math.round(center.y),
    rotation: 0,
    visible: true
  };
  switch (kind) {
    case "rect":
      return { ...base, kind, width: 200, height: 120, cornerRadius: 12, fill: "#51e0b5" };
    case "ellipse":
      return { ...base, kind, width: 180, height: 180, fill: "#51e0b5" };
    case "line":
      return { ...base, kind, dx: 180, dy: 0, color: "#ffffff", strokeWidth: 6 };
    case "text":
      return {
        ...base,
        kind,
        text: "TEXT",
        fontFamily,
        fontSize: 64,
        color: "#ffffff",
        weight: 700,
        align: "center"
      };
  }
}

/** The axis-aligned bounding box of an element (rotation ignored for hit-tests). */
export function backgroundElementBounds(
  element: CorosWatchfaceBackgroundElement
): { x0: number; y0: number; x1: number; y1: number } {
  switch (element.kind) {
    case "rect":
    case "ellipse":
      return {
        x0: element.x - element.width / 2,
        y0: element.y - element.height / 2,
        x1: element.x + element.width / 2,
        y1: element.y + element.height / 2
      };
    case "line":
      return {
        x0: Math.min(element.x, element.x + element.dx) - element.strokeWidth,
        y0: Math.min(element.y, element.y + element.dy) - element.strokeWidth,
        x1: Math.max(element.x, element.x + element.dx) + element.strokeWidth,
        y1: Math.max(element.y, element.y + element.dy) + element.strokeWidth
      };
    case "text": {
      const halfWidth = Math.max(element.text.length, 1) * element.fontSize * 0.32;
      const halfHeight = element.fontSize * 0.7;
      return {
        x0: element.x - halfWidth,
        y0: element.y - halfHeight,
        x1: element.x + halfWidth,
        y1: element.y + halfHeight
      };
    }
  }
}

/** The top-most element under a point (last drawn wins), in 800px space. */
export function backgroundElementAtPoint(
  elements: CorosWatchfaceBackgroundElement[],
  x: number,
  y: number
): CorosWatchfaceBackgroundElement | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (elements[index]!.visible === false) continue;
    const box = backgroundElementBounds(elements[index]!);
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) {
      return elements[index]!;
    }
  }
  return null;
}

function quoteFamily(family: string): string {
  return family ? `"${family.replace(/["\\]/g, "")}"` : "system-ui, sans-serif";
}

function applyFill(
  context: CanvasRenderingContext2D,
  box: { x0: number; y0: number; x1: number; y1: number },
  fill: string,
  gradient: CorosWatchfaceGradientFill | undefined
): void {
  if (!gradient) {
    context.fillStyle = fill;
    return;
  }
  const angle = (gradient.angle * Math.PI) / 180;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const half = Math.max(box.x1 - box.x0, box.y1 - box.y0) / 2;
  const linear = context.createLinearGradient(
    cx - Math.cos(angle) * half,
    cy - Math.sin(angle) * half,
    cx + Math.cos(angle) * half,
    cy + Math.sin(angle) * half
  );
  linear.addColorStop(0, gradient.from);
  linear.addColorStop(1, gradient.to);
  context.fillStyle = linear;
}

function drawBackgroundElement(
  context: CanvasRenderingContext2D,
  element: CorosWatchfaceBackgroundElement
): void {
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, element.opacity ?? 1));
  context.translate(element.x, element.y);
  context.rotate((element.rotation * Math.PI) / 180);

  if (element.kind === "rect") {
      const w = element.width;
      const h = element.height;
      const r = Math.max(0, Math.min(element.cornerRadius, Math.min(w, h) / 2));
      context.beginPath();
      context.moveTo(-w / 2 + r, -h / 2);
      context.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
      context.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
      context.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
      context.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
      context.closePath();
      applyFill(context, { x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2 }, element.fill, element.gradient);
      context.fill();
      if (element.strokeColor && element.strokeWidth) {
        context.strokeStyle = element.strokeColor;
        context.lineWidth = element.strokeWidth;
        context.stroke();
      }
  } else if (element.kind === "ellipse") {
      context.beginPath();
      context.ellipse(0, 0, element.width / 2, element.height / 2, 0, 0, Math.PI * 2);
      applyFill(
        context,
        { x0: -element.width / 2, y0: -element.height / 2, x1: element.width / 2, y1: element.height / 2 },
        element.fill,
        element.gradient
      );
      context.fill();
      if (element.strokeColor && element.strokeWidth) {
        context.strokeStyle = element.strokeColor;
        context.lineWidth = element.strokeWidth;
        context.stroke();
      }
  } else if (element.kind === "line") {
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(element.dx, element.dy);
      context.strokeStyle = element.color;
      context.lineWidth = element.strokeWidth;
      context.lineCap = "round";
      context.stroke();
  } else {
      context.fillStyle = element.color;
      context.textAlign = element.align;
      context.textBaseline = "middle";
      context.font = `${element.weight} ${element.fontSize}px ${quoteFamily(element.fontFamily)}`;
      context.fillText(element.text, 0, 0);
  }

  context.restore();
}

/** Draws every background element into a context already scaled to 800px. */
export function drawBackgroundElements(
  context: CanvasRenderingContext2D,
  elements: CorosWatchfaceBackgroundElement[],
  effectsForId?: (id: string) => CorosWatchfaceShadowEffect[]
): void {
  for (const element of elements) {
    if (element.visible === false) continue;
    const effects = effectsForId?.(`bgel:${element.id}`) ?? [];
    if (effects.length === 0) {
      drawBackgroundElement(context, element);
      continue;
    }
    const layer = document.createElement("canvas");
    layer.width = BACKGROUND_SPACE;
    layer.height = BACKGROUND_SPACE;
    const layerContext = layer.getContext("2d", { colorSpace: "display-p3" });
    if (!layerContext) continue;
    layerContext.imageSmoothingEnabled = true;
    layerContext.imageSmoothingQuality = "high";
    drawBackgroundElement(layerContext, element);
    context.drawImage(renderWatchfaceCanvasEffects(layer, effects).canvas, 0, 0);
  }
}
