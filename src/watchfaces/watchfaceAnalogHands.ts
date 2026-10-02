import type { CorosWatchfaceArtwork } from "../../electron/types";

/** The analog assets Studio can generate, keyed by their config entry. */
export type WatchfaceDefaultAnalogKey =
  | "time_hour_icon"
  | "time_minute_icon"
  | "time_second_icon"
  | "time_center_polygon_icon2";

interface HandShape {
  /** Pivot to tip, as a fraction of the face width. */
  length: number;
  /** Pivot to the far end of the counterweight. */
  tail: number;
  base: number;
  tip: number;
}

const HAND_SHAPES: Record<Exclude<WatchfaceDefaultAnalogKey, "time_center_polygon_icon2">, HandShape> = {
  time_hour_icon: { length: 0.25, tail: 0.045, base: 0.042, tip: 0.03 },
  time_minute_icon: { length: 0.39, tail: 0.045, base: 0.032, tip: 0.02 },
  time_second_icon: { length: 0.43, tail: 0.11, base: 0.009, tip: 0.009 }
};

function artworkCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Analog hand drawing is unavailable in this window.");
  return { canvas, context };
}

/**
 * A tapered baton hand pointing at 12. The PNG is symmetric around the pivot
 * because the firmware rotates every hand around its image center.
 */
function renderHand(faceWidth: number, shape: HandShape, color: string): CorosWatchfaceArtwork {
  const length = shape.length * faceWidth;
  const tail = shape.tail * faceWidth;
  const base = Math.max(2, shape.base * faceWidth);
  const tip = Math.max(2, shape.tip * faceWidth);
  const padding = 2;
  const width = Math.ceil(base + padding * 2);
  const height = Math.ceil(Math.max(length, tail) + padding) * 2;
  const { canvas, context } = artworkCanvas(width, height);
  const cx = width / 2;
  const cy = height / 2;
  // Stroking the outline with the tip width rounds both ends, so the polygon
  // is inset by half of it: a point at the tip, base - tip wide at the tail.
  const inset = tip / 2;
  context.beginPath();
  context.moveTo(cx - (base - tip) / 2, cy + tail - inset);
  context.lineTo(cx, cy - length + inset);
  context.lineTo(cx + (base - tip) / 2, cy + tail - inset);
  context.closePath();
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineJoin = "round";
  context.lineWidth = tip;
  context.fill();
  context.stroke();
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

/** A fixed cap that hides where the hands meet. */
function renderCap(faceWidth: number, color: string, accent: string): CorosWatchfaceArtwork {
  const radius = Math.max(3, 0.028 * faceWidth);
  const size = Math.ceil(radius * 2 + 4);
  const { canvas, context } = artworkCanvas(size, size);
  const center = size / 2;
  context.fillStyle = color;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = accent;
  context.beginPath();
  context.arc(center, center, radius * 0.45, 0, Math.PI * 2);
  context.fill();
  return { dataUrl: canvas.toDataURL("image/png"), width: size, height: size };
}

/**
 * Default analog artwork drawn at the template's master resolution. Studio
 * rescales it for every other resolution tree on export.
 */
export function renderDefaultAnalogHands(
  faceWidth: number,
  handColor: string,
  accentColor: string
): Record<WatchfaceDefaultAnalogKey, CorosWatchfaceArtwork> {
  return {
    time_hour_icon: renderHand(faceWidth, HAND_SHAPES.time_hour_icon, handColor),
    time_minute_icon: renderHand(faceWidth, HAND_SHAPES.time_minute_icon, handColor),
    time_second_icon: renderHand(faceWidth, HAND_SHAPES.time_second_icon, accentColor),
    time_center_polygon_icon2: renderCap(faceWidth, handColor, accentColor)
  };
}
