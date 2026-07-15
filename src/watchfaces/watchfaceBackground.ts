import type { CorosWatchfaceDesignState } from "../../electron/types";
import {
  loadStudioImage,
  resizeAndTintSprite,
  type WatchfaceAmPmStyle,
  type WatchfaceStaticSeparators
} from "./watchfaceStudio";
import { drawBackgroundElements } from "./watchfaceBackgroundElements";

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
  scale: 1
};

/** A blank design used when the editor opens without a saved project. */
export function makeDefaultDesign(): CorosWatchfaceDesignState {
  return {
    version: 1,
    backgroundColor: "#000000",
    accentColor: "#51e0b5",
    artwork: null,
    artworkVisible: true,
    zoom: 1,
    fontFamily: "",
    fontWeight: 400,
    fontStyle: "normal",
    letterSpacing: 0,
    digitColor: "#ffffff",
    tintLabels: false,
    tintIcons: false,
    previewComplication: "heartRate",
    metricChanges: {},
    metricStyles: {},
    controlIconOffsets: {},
    separateAutoTime: false,
    timeStyles: {},
    dateStyles: {},
    staticSeparators: {
      colon: { ...DEFAULT_STATIC_SEPARATORS.colon },
      dateSlash: { ...DEFAULT_STATIC_SEPARATORS.dateSlash }
    },
    ampmIndicator: { ...DEFAULT_AMPM_STYLE },
    weatherIndicator: undefined,
    layoutOffsets: {},
    linkedLayerGroups: [],
    lockedLayerIds: [],
    layerVisibility: {},
    layerColors: {},
    configAssetOverrides: {},
    designSprites: []
  };
}

/**
 * Paints the watch-face background for both preview and export: artwork,
 * imported sprites, and static separators —
 * and returns the 800×800 PNG data URL used as the archive background.
 */
export async function renderDesignBackground(
  design: CorosWatchfaceDesignState,
  previewWidth: number
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = CREATOR_CANVAS_SIZE;
  canvas.height = CREATOR_CANVAS_SIZE;
  // Wide-gamut canvas: an sRGB canvas clamps Display P3 artwork colors to the
  // smaller sRGB gamut, visibly darkening saturated tones on P3 screens.
  const context = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!context) {
    throw new Error("Background rendering is unavailable in this window.");
  }
  const size = CREATOR_CANVAS_SIZE;

  if (design.backgroundColor !== "transparent") {
    context.fillStyle = design.backgroundColor ?? "#000000";
    context.fillRect(0, 0, size, size);
  }

  const backgroundOverride = design.configAssetOverrides?.["config:background_icon"];
  const backgroundArtwork = design.artworkVisible === false
    ? null
    : backgroundOverride?.replacement ?? design.artwork;

  if (backgroundArtwork) {
    const image = await loadStudioImage(backgroundArtwork.dataUrl).catch(() => undefined);
    if (image) {
      const scale =
        Math.max(size / image.naturalWidth, size / image.naturalHeight) * design.zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    }
  }

  // Freeform shapes are authored directly in this 800px space.
  if (design.backgroundElements && design.backgroundElements.length > 0) {
    drawBackgroundElements(context, design.backgroundElements);
  }

  const separatorScale = size / (previewWidth || size);

  for (const sprite of design.designSprites ?? []) {
    if (sprite.visible === false) {
      continue;
    }
    const spriteDataUrl = sprite.tintColor
      ? await resizeAndTintSprite(
          sprite.dataUrl,
          sprite.sourceWidth,
          sprite.sourceHeight,
          sprite.tintColor
        ).catch(() => sprite.dataUrl)
      : sprite.dataUrl;
    const spriteImage = await loadStudioImage(spriteDataUrl).catch(() => undefined);
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
    const separatorFont = separator.fontFamily ?? design.fontFamily;
    const family = separatorFont
      ? `"${separatorFont.replace(/["\\]/g, "")}"`
      : "system-ui, sans-serif";
    context.font = `700 ${Math.round(separator.size * separatorScale)}px ${family}`;
    context.fillStyle = separator.color;
    context.fillText(text, separator.x * separatorScale, separator.y * separatorScale);
  }
  context.textAlign = "start";
  context.textBaseline = "alphabetic";

  return canvas.toDataURL("image/png");
}
