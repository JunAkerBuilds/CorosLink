import type {
  CorosWatchfaceBackgroundElement,
  CorosWatchfaceDesignState,
  CorosWatchfaceExerciseSeparatorStyle
} from "../../electron/types";
import { resolveWatchfaceArtworkLayerOrder } from "./watchfaceArtworkLayers";
import { resolveWatchfaceLayerEffects } from "./watchfaceEditorEffects";
import { normalizeWatchfaceEditorGroups, syncLegacyWatchfaceGroups } from "./watchfaceEditorLayout";
import {
  migrateLegacyBackgroundElementStrokes,
  renderWatchfaceCanvasDecorations,
  resolveWatchfaceLayerStrokes
} from "./watchfaceEditorStrokes";
import { withoutWatchfaceFontSnapshots } from "./watchfaceFontSnapshots";
import { normalizeWatchfaceLayerOpacity } from "./watchfaceLayerOpacity";
import {
  normalizeWatchfaceCrop,
  normalizeWatchfaceOpacity,
  normalizeWatchfaceSkew,
  normalizeWatchfaceTransformOrigin
} from "./watchfaceSpriteTransform";
import { corosConfigColorToCss } from "./watchfaceStudio";

/*
 * Export-time helpers shared by Studio (WatchfaceEditor) and the headless
 * export that CorosLink for iPhone runs (headlessStudioExport.ts).
 */

export function drawWeatherPreviewLayer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  design: Pick<
    CorosWatchfaceDesignState,
    "weatherIndicator" | "layerStrokes" | "layerEffects" | "effectStyles"
  >,
  previewWidth: number
): void {
  const indicator = design.weatherIndicator;
  if (!indicator?.enabled) return;
  const context = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!context) return;
  const previewScale = canvas.width / previewWidth;
  const width = Math.max(
    1,
    Math.round(image.naturalWidth * indicator.scale * previewScale)
  );
  const height = Math.max(
    1,
    Math.round(image.naturalHeight * indicator.scale * previewScale)
  );
  const strokes = resolveWatchfaceLayerStrokes(design, "weather");
  const effects = resolveWatchfaceLayerEffects(design, "weather");
  if (strokes.length === 0 && effects.length === 0) {
    context.drawImage(
      image,
      indicator.x * previewScale,
      indicator.y * previewScale,
      width,
      height
    );
    return;
  }
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  source.getContext("2d")?.drawImage(image, 0, 0, width, height);
  const rendered = renderWatchfaceCanvasDecorations(
    source,
    strokes,
    effects,
    canvas.width / 800,
    true
  );
  context.drawImage(
    rendered.canvas,
    indicator.x * previewScale - rendered.padding.left,
    indicator.y * previewScale - rendered.padding.top
  );
}

export function maskCanvasToCircle(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.save();
  context.globalCompositeOperation = "destination-in";
  context.beginPath();
  context.arc(
    canvas.width / 2,
    canvas.height / 2,
    Math.min(canvas.width, canvas.height) / 2,
    0,
    Math.PI * 2
  );
  context.fill();
  context.restore();
}

/** Fills defaults and migrates older saved designs; Studio applies it when opening a design. */
export function normalizeEditorDesign(
  design: CorosWatchfaceDesignState
): CorosWatchfaceDesignState {
  const legacyBackgroundOverride =
    design.configAssetOverrides?.["config:background_icon"];
  const normalizeBackgroundElements = (
    elements: CorosWatchfaceBackgroundElement[] | undefined
  ) =>
    (elements ?? []).map((element) => ({
      ...element,
      visible: element.visible !== false,
      opacity: normalizeWatchfaceOpacity(element.opacity)
    }));
  const normalizeLayerOpacities = (
    opacities: Record<string, number> | undefined
  ) =>
    Object.fromEntries(
      Object.entries(opacities ?? {}).map(([layerId, opacity]) => [
        layerId,
        normalizeWatchfaceLayerOpacity(opacity)
      ])
    );
  const normalizeExerciseSeparator = (
    separator: CorosWatchfaceExerciseSeparatorStyle | undefined
  ): CorosWatchfaceExerciseSeparatorStyle | undefined => separator
    ? {
        ...separator,
        enabled: separator.enabled !== false,
        x: Number.isFinite(separator.x) ? separator.x : 400,
        y: Number.isFinite(separator.y) ? separator.y : 640,
        size: Math.max(1, Number.isFinite(separator.size) ? separator.size : 64),
        scale: Math.max(0.01, Number.isFinite(separator.scale) ? separator.scale : 1),
        color: /^#[0-9a-f]{6}$/i.test(separator.color)
          ? separator.color
          : design.digitColor,
        artwork: separator.artwork ?? null
      }
    : undefined;
  const normalizedBackgroundElements = normalizeBackgroundElements(
    design.backgroundElements
  );
  const migratedStrokes = migrateLegacyBackgroundElementStrokes(
    normalizedBackgroundElements,
    design.layerStrokes
  );
  const aodMode = design.modeDesigns?.aod;
  const migratedAodStrokes = aodMode
    ? migrateLegacyBackgroundElementStrokes(
        normalizeBackgroundElements(aodMode.backgroundElements),
        aodMode.layerStrokes
      )
    : null;
  const normalizedModeDesigns: CorosWatchfaceDesignState["modeDesigns"] =
    aodMode && migratedAodStrokes
      ? {
          ...design.modeDesigns,
          aod: {
            ...aodMode,
            // Older imports stored the starter's raw COROS value (0x000000).
            ...(typeof aodMode.backgroundColor === "string"
              ? { backgroundColor: corosConfigColorToCss(aodMode.backgroundColor) }
              : {}),
            exerciseSeparator: normalizeExerciseSeparator(
              aodMode.exerciseSeparator
            ),
            backgroundElements: migratedAodStrokes.elements,
            layerOpacities: normalizeLayerOpacities(aodMode.layerOpacities),
            layerStrokes: migratedAodStrokes.layerStrokes
          }
        }
      : design.modeDesigns;
  const normalized: CorosWatchfaceDesignState = {
    // Saved font snapshots are loaded separately and re-attached on save.
    ...withoutWatchfaceFontSnapshots(design),
    ...(typeof design.backgroundColor === "string"
      ? { backgroundColor: corosConfigColorToCss(design.backgroundColor) }
      : {}),
    artworkVisible:
      design.artworkVisible ?? legacyBackgroundOverride?.enabled !== false,
    exerciseSeparator: normalizeExerciseSeparator(design.exerciseSeparator),
    configAssetOverrides: design.configAssetOverrides ?? {},
    controlComplicationEnabled: design.controlComplicationEnabled ?? {},
    editorGroups: normalizeWatchfaceEditorGroups(
      design.editorGroups,
      design.linkedLayerGroups
    ),
    editorGuides: (design.editorGuides ?? []).filter(
      (guide) => guide.axis === "x" || guide.axis === "y"
    ),
    effectStyles: design.effectStyles ?? [],
    layerEffects: design.layerEffects ?? {},
    layerOpacities: normalizeLayerOpacities(design.layerOpacities),
    layerStrokes: migratedStrokes.layerStrokes,
    designSprites: (design.designSprites ?? []).map((sprite) => ({
      ...sprite,
      opacity: normalizeWatchfaceOpacity(sprite.opacity),
      flipX: sprite.flipX === true,
      flipY: sprite.flipY === true,
      skewX: normalizeWatchfaceSkew(sprite.skewX),
      skewY: normalizeWatchfaceSkew(sprite.skewY),
      aspectLocked: sprite.aspectLocked !== false,
      crop: normalizeWatchfaceCrop(sprite.crop),
      origin: normalizeWatchfaceTransformOrigin(sprite.origin)
    })),
    artworkLayerOrder: resolveWatchfaceArtworkLayerOrder(design),
    backgroundElements: migratedStrokes.elements,
    lockedLayerIds: [...new Set((design.lockedLayerIds ?? []).filter(Boolean))],
    modeDesigns: normalizedModeDesigns,
    // Global tinting has been replaced by explicit controls in each layer.
    tintLabels: false,
    tintIcons: false
  };
  if (
    normalized.metricChanges?.temperature !== true ||
    normalized.metricStyles?.temperature
  ) {
    return syncLegacyWatchfaceGroups(normalized);
  }
  return syncLegacyWatchfaceGroups({
    ...normalized,
    metricStyles: {
      ...normalized.metricStyles,
      temperature: {
        scale: 1
      }
    }
  });
}
