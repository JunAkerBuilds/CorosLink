import type { CorosWatchfaceDesignState } from "../../electron/types";
import {
  loadStudioImage,
  type WatchfaceAmPmStyle,
  type WatchfaceStaticSeparators
} from "./watchfaceStudio";

export const CREATOR_CANVAS_SIZE = 800;
export const MAX_DESIGN_SPRITES = 12;

export const DEFAULT_STATIC_SEPARATORS: WatchfaceStaticSeparators = {
  colon: { enabled: false, x: 400, y: 320, size: 64, color: "#ffffff" },
  dateSlash: { enabled: false, x: 400, y: 240, size: 48, color: "#ffffff" }
};

export const DEFAULT_AMPM_STYLE: WatchfaceAmPmStyle = {
  enabled: false,
  x: 480,
  y: 360,
  scale: 1,
  color: "#ffffff"
};

/** A blank design used when the editor opens without a saved project. */
export function makeDefaultDesign(): CorosWatchfaceDesignState {
  return {
    version: 1,
    backgroundColor: "#081116",
    accentColor: "#51e0b5",
    artwork: null,
    zoom: 1,
    fontFamily: "",
    digitColor: "#ffffff",
    tintLabels: false,
    tintIcons: false,
    previewComplication: "heartRate",
    metricChanges: {},
    metricStyles: {},
    timeStyles: {},
    staticSeparators: {
      colon: { ...DEFAULT_STATIC_SEPARATORS.colon },
      dateSlash: { ...DEFAULT_STATIC_SEPARATORS.dateSlash }
    },
    ampmIndicator: { ...DEFAULT_AMPM_STYLE },
    layoutOffsets: {},
    designSprites: []
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Paints the watchface background exactly as WatchfaceCreator does — base
 * color, artwork, shade gradient, imported sprites, and static separators —
 * and returns the 800×800 PNG data URL used as the archive background.
 */
export async function renderDesignBackground(
  design: CorosWatchfaceDesignState,
  previewWidth: number
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = CREATOR_CANVAS_SIZE;
  canvas.height = CREATOR_CANVAS_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Background rendering is unavailable in this window.");
  }
  const size = CREATOR_CANVAS_SIZE;

  context.clearRect(0, 0, size, size);
  context.fillStyle = design.backgroundColor;
  context.fillRect(0, 0, size, size);

  if (design.artwork) {
    const image = await loadStudioImage(design.artwork.dataUrl).catch(() => undefined);
    if (image) {
      const scale =
        Math.max(size / image.naturalWidth, size / image.naturalHeight) * design.zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    }
  }

  const shade = context.createLinearGradient(0, 0, size, size);
  shade.addColorStop(0, hexToRgba(design.backgroundColor, 0.3));
  shade.addColorStop(0.46, "rgba(0, 0, 0, 0.06)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.56)");
  context.fillStyle = shade;
  context.fillRect(0, 0, size, size);

  const separatorScale = size / (previewWidth || size);

  for (const sprite of design.designSprites ?? []) {
    const spriteImage = await loadStudioImage(sprite.dataUrl).catch(() => undefined);
    if (!spriteImage) {
      continue;
    }
    const width = sprite.width * sprite.scale * separatorScale;
    const height = sprite.height * sprite.scale * separatorScale;
    context.save();
    context.translate(sprite.x * separatorScale, sprite.y * separatorScale);
    context.rotate((sprite.rotation * Math.PI) / 180);
    context.drawImage(spriteImage, -width / 2, -height / 2, width, height);
    context.restore();
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const [separatorId, text] of [
    ["colon", ":"],
    ["dateSlash", "/"]
  ] as const) {
    const separator = design.staticSeparators[separatorId];
    if (!separator?.enabled) {
      continue;
    }
    const family = design.fontFamily
      ? `"${design.fontFamily.replace(/["\\]/g, "")}"`
      : "system-ui, sans-serif";
    context.font = `700 ${Math.round(separator.size * separatorScale)}px ${family}`;
    context.fillStyle = separator.color;
    context.fillText(text, separator.x * separatorScale, separator.y * separatorScale);
  }
  context.textAlign = "start";
  context.textBaseline = "alphabetic";

  return canvas.toDataURL("image/png");
}
