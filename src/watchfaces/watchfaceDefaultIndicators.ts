import type { CorosWatchfaceArtwork } from "../../electron/types";
import { loadStudioImage } from "./watchfaceStudio.ts";

/**
 * Studio's own artwork for the device indicators a template does not ship, so
 * the Add menu puts one on the face in a click. The shapes follow COROS's
 * stock icons: a Bluetooth rune and a bell, struck through in red while
 * disconnected or muted, a plane and a bed. The face's digit colour draws the
 * symbol; the strike stays pure red, which every COROS display shows as is.
 */

const STRIKE_COLOR = "#ff0000";

interface IndicatorGlyph {
  viewBox: [number, number, number, number];
  body: (color: string) => string;
  struck?: [number, number, number, number];
}

const BLUETOOTH_RUNE = (color: string) =>
  `<path d="M7 7l10 10-5 5V2l5 5L7 17" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
const BELL = (color: string) =>
  `<path fill="${color}" d="M12 3a1.6 1.6 0 0 1 1.6 1.6v.6A6 6 0 0 1 18 11v4.2l1.8 2.3c.3.4 0 .9-.5.9H4.7c-.5 0-.8-.5-.5-.9L6 15.2V11a6 6 0 0 1 4.4-5.8v-.6A1.6 1.6 0 0 1 12 3zM9.6 19.6h4.8a2.4 2.4 0 0 1-4.8 0z"/>`;

const GLYPHS: Record<string, IndicatorGlyph> = {
  bluetooth_on_icon: { viewBox: [4.5, 0.5, 15, 23], body: BLUETOOTH_RUNE },
  bluetooth_off_icon: { viewBox: [4.5, 0.5, 15, 23], body: BLUETOOTH_RUNE, struck: [5.6, 4, 18.4, 20] },
  no_disturb_on_icon: { viewBox: [3.5, 2.5, 17, 20.5], body: BELL, struck: [5, 4, 19, 21] },
  no_disturb_off_icon: { viewBox: [3.5, 2.5, 17, 20.5], body: BELL },
  airplane_icon: {
    viewBox: [2.5, 1.5, 19, 20.2],
    body: (color) => `<path fill="${color}" d="M12 1.8c.9 0 1.6.9 1.6 2.1v5.3l7.6 4.4v2.2l-7.6-2.4v4.7l2.2 1.6v1.7L12 20.4l-3.8 1v-1.7l2.2-1.6v-4.7l-7.6 2.4v-2.2l7.6-4.4V3.9c0-1.2.7-2.1 1.6-2.1z"/>`
  },
  sleep_mode_icon: {
    viewBox: [2, 5, 20, 14.5],
    // A bed seen from the foot: headboard with two pillows, mattress, legs.
    body: (color) => `<path fill="${color}" fill-rule="evenodd" d="M2.5 8.5a3 3 0 0 1 3-3h13a3 3 0 0 1 3 3V19h-2.6v-2.5H5.1V19H2.5zM5.4 9.2h5.3v3.3H5.4zM13.3 9.2h5.3v3.3h-5.3z"/>`
  }
};

/** The indicator as a standalone SVG, for tests and previews. */
export function defaultStatusIndicatorSvg(configKey: string, color: string): string | null {
  const glyph = GLYPHS[configKey];
  if (!glyph) return null;
  const strike = glyph.struck
    ? `<line x1="${glyph.struck[0]}" y1="${glyph.struck[1]}" x2="${glyph.struck[2]}" y2="${glyph.struck[3]}" stroke="${STRIKE_COLOR}" stroke-width="2.4" stroke-linecap="round"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${glyph.viewBox.join(" ")}">${glyph.body(color)}${strike}</svg>`;
}

/**
 * Renders the indicator 7% of the face tall in master pixels, the size of
 * COROS's own status icons. Export scales it for every watch size.
 */
export async function renderDefaultStatusIndicator(
  configKey: string,
  masterHeight: number,
  color: string
): Promise<CorosWatchfaceArtwork | null> {
  const glyph = GLYPHS[configKey];
  const svg = defaultStatusIndicatorSvg(configKey, color);
  if (!glyph || !svg) return null;
  const height = Math.max(8, Math.round(masterHeight * 0.07));
  const width = Math.max(4, Math.round(height * glyph.viewBox[2] / glyph.viewBox[3]));
  const image = await loadStudioImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

/**
 * A twelve-frame battery set in COROS's standard order (00 charging, 01 empty,
 * 02–11 for 10–100%), sized for the master resolution. Levels of 20% and
 * below fill red like the watch's own low-battery icon.
 */
export function renderDefaultBatteryStates(
  masterWidth: number,
  color: string
): Record<string, CorosWatchfaceArtwork> {
  const width = Math.max(12, Math.round(masterWidth * 0.075));
  const height = Math.max(6, Math.round(width * 0.5));
  const stroke = Math.max(2, Math.round(height * 0.14));
  const tip = Math.max(2, Math.round(width * 0.08));
  const bodyWidth = width - tip;
  const radius = Math.max(1, Math.round(height * 0.18));
  const states: Record<string, CorosWatchfaceArtwork> = {};
  for (let state = 0; state < 12; state++) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) continue;
    const level = state <= 1 ? 0 : (state - 1) / 10;
    const outline = state === 1 ? STRIKE_COLOR : color;
    context.strokeStyle = outline;
    context.fillStyle = outline;
    context.lineWidth = stroke;
    context.beginPath();
    context.roundRect(stroke / 2, stroke / 2, bodyWidth - stroke, height - stroke, radius);
    context.stroke();
    const tipHeight = Math.max(2, Math.round(height * 0.42));
    context.fillRect(bodyWidth, Math.round((height - tipHeight) / 2), tip, tipHeight);
    const inset = stroke * 2;
    const innerWidth = bodyWidth - inset * 2;
    const innerHeight = height - inset * 2;
    if (level > 0 && innerWidth > 0 && innerHeight > 0) {
      context.fillStyle = level <= 0.2 ? STRIKE_COLOR : color;
      context.fillRect(inset, inset, Math.max(1, Math.round(innerWidth * level)), innerHeight);
    }
    if (state === 0) {
      // Charging: a bolt across the empty body.
      const cx = bodyWidth / 2;
      const top = inset * 0.6;
      const bottom = height - inset * 0.6;
      const half = Math.max(2, innerWidth * 0.16);
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(cx + half * 0.4, top);
      context.lineTo(cx - half, height / 2 + 1);
      context.lineTo(cx, height / 2 + 1);
      context.lineTo(cx - half * 0.4, bottom);
      context.lineTo(cx + half, height / 2 - 1);
      context.lineTo(cx, height / 2 - 1);
      context.closePath();
      context.fill();
    }
    states[String(state)] = { dataUrl: canvas.toDataURL("image/png"), width, height };
  }
  return states;
}

/**
 * Where a new indicator starts on the master face: inside the round dial near
 * ten o'clock (Bluetooth and airplane) or two o'clock (Do Not Disturb and
 * sleep), clear of the bezel that hides the screen's corners.
 */
export function defaultStatusIndicatorPosition(
  layoutGroupId: string,
  master: { width: number; height: number },
  size: { width: number; height: number }
): { x: number; y: number } {
  const y = Math.round(master.height * 0.22);
  return layoutGroupId === "doNotDisturbStatus"
    ? { x: Math.round(master.width * 0.82 - size.width), y }
    : { x: Math.round(master.width * 0.18), y };
}
