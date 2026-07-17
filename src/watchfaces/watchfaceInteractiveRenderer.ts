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

export function paintWatchfaceMeasurements(
  context: CanvasRenderingContext2D,
  measurements: WatchfaceSnapMeasurement[],
  scaleX: number,
  scaleY: number
): void {
  if (measurements.length === 0) return;
  context.save();
  context.strokeStyle = "rgba(255, 206, 84, 0.95)";
  context.fillStyle = "rgba(255, 222, 132, 0.98)";
  context.lineWidth = 1;
  context.setLineDash([]);
  context.font = `${Math.max(10, Math.round(context.canvas.width / 48))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "center";
  context.textBaseline = "bottom";
  for (const measurement of measurements) {
    if (measurement.axis === "x") {
      const x0 = measurement.start * scaleX;
      const x1 = measurement.end * scaleX;
      const y = measurement.cross * scaleY;
      context.beginPath();
      context.moveTo(x0, y);
      context.lineTo(x1, y);
      context.moveTo(x0, y - 4);
      context.lineTo(x0, y + 4);
      context.moveTo(x1, y - 4);
      context.lineTo(x1, y + 4);
      context.stroke();
      context.fillText(measurement.label, (x0 + x1) / 2, y - 4);
      continue;
    }
    const y0 = measurement.start * scaleY;
    const y1 = measurement.end * scaleY;
    const x = measurement.cross * scaleX;
    context.beginPath();
    context.moveTo(x, y0);
    context.lineTo(x, y1);
    context.moveTo(x - 4, y0);
    context.lineTo(x + 4, y0);
    context.moveTo(x - 4, y1);
    context.lineTo(x + 4, y1);
    context.stroke();
    context.save();
    context.translate(x - 5, (y0 + y1) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(measurement.label, 0, 0);
    context.restore();
  }
  context.restore();
}
