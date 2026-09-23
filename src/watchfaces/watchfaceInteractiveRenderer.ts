import type { WatchfaceSnapMeasurement } from "./watchfaceEditorSnapping";

/** Keeps all stacked canvases at CSS pixels × capped device-pixel ratio. */
export function resizeWatchfaceCanvasBackings(
  canvases: Array<HTMLCanvasElement | null>,
  devicePixelRatio: number
): boolean {
  const dpr = Math.min(Math.max(1, devicePixelRatio || 1), 2);
  let changed = false;
  for (const canvas of canvases) {
    if (!canvas) continue;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width === width && canvas.height === height) continue;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { colorSpace: "display-p3" });
    if (context) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
    }
    changed = true;
  }
  return changed;
}

/** Figma-style placement accent shared by snap lines, markers, and distance pills. */
export const WATCHFACE_PLACEMENT_ACCENT = "rgb(255, 76, 110)";
const PLACEMENT_LABEL_TEXT = "rgb(255, 255, 255)";

function placementFontSize(context: CanvasRenderingContext2D): number {
  return Math.max(10, Math.round(context.canvas.width / 52));
}

/** Rounded label pill centred on (x, y), nudged to stay inside the canvas. */
export function paintWatchfaceLabelPill(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  background = WATCHFACE_PLACEMENT_ACCENT,
  foreground = PLACEMENT_LABEL_TEXT
): void {
  const fontSize = placementFontSize(context);
  context.save();
  context.font = `600 ${fontSize}px ui-sans-serif, -apple-system, "SF Pro Text", system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const paddingX = fontSize * 0.5;
  const width = context.measureText(text).width + paddingX * 2;
  const height = fontSize * 1.6;
  const margin = 4;
  const cx = Math.max(width / 2 + margin, Math.min(context.canvas.width - width / 2 - margin, x));
  const cy = Math.max(height / 2 + margin, Math.min(context.canvas.height - height / 2 - margin, y));
  context.beginPath();
  context.roundRect(cx - width / 2, cy - height / 2, width, height, height * 0.28);
  context.fillStyle = background;
  context.shadowColor = "rgba(0, 0, 0, 0.35)";
  context.shadowBlur = fontSize * 0.5;
  context.shadowOffsetY = 1;
  context.fill();
  context.shadowColor = "transparent";
  context.fillStyle = foreground;
  context.fillText(text, cx, cy + 0.5);
  context.restore();
}

/** Small "×" marks where the moving selection touches an active snap line. */
export function paintWatchfaceSnapMarker(
  context: CanvasRenderingContext2D,
  x: number,
  y: number
): void {
  const size = Math.max(3, context.canvas.width / 260);
  context.moveTo(x - size, y - size);
  context.lineTo(x + size, y + size);
  context.moveTo(x + size, y - size);
  context.lineTo(x - size, y + size);
}

export function paintWatchfaceMeasurements(
  context: CanvasRenderingContext2D,
  measurements: WatchfaceSnapMeasurement[],
  scaleX: number,
  scaleY: number
): void {
  if (measurements.length === 0) return;
  context.save();
  context.strokeStyle = WATCHFACE_PLACEMENT_ACCENT;
  context.lineWidth = Math.max(1, context.canvas.width / 900);
  context.setLineDash([]);
  const tick = Math.max(3, context.canvas.width / 220);
  const pillOffset = placementFontSize(context) * 1.3;
  // Equal-spacing gaps get a soft band across the shared extent first.
  for (const measurement of measurements) {
    if (measurement.kind !== "spacing" || !measurement.span) continue;
    context.fillStyle = "rgba(255, 76, 110, 0.16)";
    if (measurement.axis === "x") {
      context.fillRect(
        measurement.start * scaleX,
        measurement.span[0] * scaleY,
        (measurement.end - measurement.start) * scaleX,
        (measurement.span[1] - measurement.span[0]) * scaleY
      );
    } else {
      context.fillRect(
        measurement.span[0] * scaleX,
        measurement.start * scaleY,
        (measurement.span[1] - measurement.span[0]) * scaleX,
        (measurement.end - measurement.start) * scaleY
      );
    }
  }
  for (const measurement of measurements) {
    if (Math.abs(measurement.end - measurement.start) < 0.5) continue;
    if (measurement.axis === "x") {
      const x0 = measurement.start * scaleX;
      const x1 = measurement.end * scaleX;
      const y = measurement.cross * scaleY;
      context.beginPath();
      context.moveTo(x0, y);
      context.lineTo(x1, y);
      context.moveTo(x0, y - tick);
      context.lineTo(x0, y + tick);
      context.moveTo(x1, y - tick);
      context.lineTo(x1, y + tick);
      context.stroke();
      paintWatchfaceLabelPill(context, measurement.label, (x0 + x1) / 2, y - pillOffset);
      continue;
    }
    const y0 = measurement.start * scaleY;
    const y1 = measurement.end * scaleY;
    const x = measurement.cross * scaleX;
    context.beginPath();
    context.moveTo(x, y0);
    context.lineTo(x, y1);
    context.moveTo(x - tick, y0);
    context.lineTo(x + tick, y0);
    context.moveTo(x - tick, y1);
    context.lineTo(x + tick, y1);
    context.stroke();
    paintWatchfaceLabelPill(context, measurement.label, x, (y0 + y1) / 2);
  }
  context.restore();
}
