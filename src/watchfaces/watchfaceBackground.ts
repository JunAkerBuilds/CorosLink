import type { CorosWatchfaceDesignState } from "../../electron/types";
import {
  loadStudioImage,
  resizeAndTintSprite,
  type WatchfaceAmPmStyle,
  type WatchfaceStaticSeparators
} from "./watchfaceStudio";
import { drawBackgroundElements } from "./watchfaceBackgroundElements";
import {
  renderWatchfaceCanvasEffects,
  resolveWatchfaceLayerEffects
} from "./watchfaceEditorEffects";
import { watchfaceBitmapCache } from "./watchfaceBitmapCache";
import {
  normalizeWatchfaceCrop,
  normalizeWatchfaceOpacity,
  normalizeWatchfaceSkew
} from "./watchfaceSpriteTransform";

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
    editorGroups: [],
    editorGuides: [],
    lockedLayerIds: [],
    effectStyles: [],
    layerEffects: {},
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
      const effects = resolveWatchfaceLayerEffects(design, "background");
      if (effects.length === 0) {
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      } else {
        const layer = document.createElement("canvas");
        layer.width = size;
        layer.height = size;
        const layerContext = layer.getContext("2d", { colorSpace: "display-p3" });
        if (layerContext) {
          layerContext.imageSmoothingEnabled = true;
          layerContext.imageSmoothingQuality = "high";
          layerContext.drawImage(
            image,
            (size - width) / 2,
            (size - height) / 2,
            width,
            height
          );
          context.drawImage(renderWatchfaceCanvasEffects(layer, effects).canvas, 0, 0);
        }
      }
    }
  }

  // Freeform shapes are authored directly in this 800px space.
  if (design.backgroundElements && design.backgroundElements.length > 0) {
    drawBackgroundElements(
      context,
      design.backgroundElements,
      (id) => resolveWatchfaceLayerEffects(design, id)
    );
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
    const spriteImage = await watchfaceBitmapCache.decode(
      `sprite:${sprite.id}:${sprite.tintColor ?? "none"}:${spriteDataUrl.length}:${spriteDataUrl.slice(-32)}`,
      spriteDataUrl
    ) ?? await loadStudioImage(spriteDataUrl).catch(() => undefined);
    if (!spriteImage) {
      continue;
    }
    const sourceWidth = "naturalWidth" in spriteImage
      ? spriteImage.naturalWidth
      : spriteImage.width;
    const sourceHeight = "naturalHeight" in spriteImage
      ? spriteImage.naturalHeight
      : spriteImage.height;
    const width = sprite.width * sprite.scale * separatorScale;
    const height = sprite.height * sprite.scale * separatorScale;
    const crop = normalizeWatchfaceCrop(sprite.crop);
    const layer = document.createElement("canvas");
    layer.width = size;
    layer.height = size;
    const layerContext = layer.getContext("2d", { colorSpace: "display-p3" });
    if (!layerContext) continue;
    layerContext.imageSmoothingEnabled = true;
    layerContext.imageSmoothingQuality = "high";
    layerContext.save();
    layerContext.globalAlpha = normalizeWatchfaceOpacity(sprite.opacity);
    layerContext.translate(sprite.x * separatorScale, sprite.y * separatorScale);
    layerContext.rotate((sprite.rotation * Math.PI) / 180);
    layerContext.transform(
      1,
      Math.tan((normalizeWatchfaceSkew(sprite.skewY) * Math.PI) / 180),
      Math.tan((normalizeWatchfaceSkew(sprite.skewX) * Math.PI) / 180),
      1,
      0,
      0
    );
    layerContext.scale(sprite.flipX ? -1 : 1, sprite.flipY ? -1 : 1);
    layerContext.drawImage(
      spriteImage,
      crop.x * sourceWidth,
      crop.y * sourceHeight,
      crop.width * sourceWidth,
      crop.height * sourceHeight,
      -width / 2,
      -height / 2,
      width,
      height
    );
    layerContext.restore();
    const effects = resolveWatchfaceLayerEffects(design, `sprite:${sprite.id}`);
    context.drawImage(
      effects.length > 0
        ? renderWatchfaceCanvasEffects(layer, effects).canvas
        : layer,
      0,
      0
    );
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
    const effects = resolveWatchfaceLayerEffects(
      design,
      separatorId === "colon" ? "staticColon" : "staticDateSlash"
    );
    if (effects.length === 0) {
      context.fillText(text, separator.x * separatorScale, separator.y * separatorScale);
    } else {
      const layer = document.createElement("canvas");
      layer.width = size;
      layer.height = size;
      const layerContext = layer.getContext("2d", { colorSpace: "display-p3" });
      if (!layerContext) continue;
      layerContext.textAlign = "center";
      layerContext.textBaseline = "middle";
      layerContext.font = context.font;
      layerContext.fillStyle = separator.color;
      layerContext.fillText(
        text,
        separator.x * separatorScale,
        separator.y * separatorScale
      );
      context.drawImage(renderWatchfaceCanvasEffects(layer, effects).canvas, 0, 0);
    }
  }
  context.textAlign = "start";
  context.textBaseline = "alphabetic";

  return canvas.toDataURL("image/png");
}
