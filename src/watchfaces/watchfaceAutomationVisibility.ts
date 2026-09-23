import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import { deriveEditorLayers, type EditorLayer } from "./watchfaceEditorModel";
import { normalizeWatchfaceEditorGroups } from "./watchfaceEditorLayout";
import {
  applyConfigTextEditsToDetails,
  detailsForCompositionMode,
  getAmPmCapability,
  getAvailableComplications,
  inferExerciseSeparatorStyle,
  isControlComplicationEnabled,
  watchfaceArcCutIsDateSlash,
  WATCHFACE_COMPLICATIONS,
  type WatchfacePreviewMode
} from "./watchfaceStudio";
import { getWeatherCapability } from "./weatherAssets";

export class WatchfaceAutomationVisibilityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WatchfaceAutomationVisibilityError";
    this.code = code;
  }
}

function visibilityFail(code: string, message: string): never {
  throw new WatchfaceAutomationVisibilityError(code, message);
}

function withoutLayerVisibility(
  design: CorosWatchfaceDesignState,
  id: string
): Record<string, boolean> {
  const layerVisibility = { ...(design.layerVisibility ?? {}) };
  delete layerVisibility[id];
  return layerVisibility;
}

function setControlBatteryVisible(
  design: CorosWatchfaceDesignState,
  details: CorosWatchfaceTemplateDetails,
  mode: WatchfacePreviewMode,
  visible: boolean
): CorosWatchfaceDesignState {
  const controlComplicationEnabled = {
    ...(design.controlComplicationEnabled ?? {}),
    battery: visible
  };
  const next = {
    ...design,
    controlBatteryEnabled: visible,
    controlComplicationEnabled
  };
  const candidates = mode === "aod"
    ? getAvailableComplications(details)
    : WATCHFACE_COMPLICATIONS;
  const fallbackComplication = candidates.find(
    (complication) =>
      complication.id !== "battery" &&
      isControlComplicationEnabled(details, next, complication.id)
  )?.id ?? "";
  return {
    ...next,
    ...(visible
      ? { previewComplication: "battery" }
      : design.previewComplication === "battery"
        ? { previewComplication: fallbackComplication }
        : {})
  };
}

function applyLayerVisibility(
  design: CorosWatchfaceDesignState,
  details: CorosWatchfaceTemplateDetails,
  mode: WatchfacePreviewMode,
  layer: EditorLayer,
  visible: boolean
): CorosWatchfaceDesignState {
  if (layer.configAssetId) {
    const configAssetOverrides = {
      ...(design.configAssetOverrides ?? {}),
      [layer.configAssetId]: {
        ...(design.configAssetOverrides?.[layer.configAssetId] ?? {}),
        enabled: visible
      }
    };
    const staticSeparatorId = layer.configAssetId === "config:colon_icon"
      ? "colon"
      : layer.configAssetId === "config:arc_cut_icon" &&
          watchfaceArcCutIsDateSlash(details)
        ? "dateSlash"
        : null;
    return {
      ...design,
      configAssetOverrides,
      ...(staticSeparatorId && !visible
        ? {
            staticSeparators: {
              ...design.staticSeparators,
              [staticSeparatorId]: {
                ...design.staticSeparators[staticSeparatorId],
                enabled: false
              }
            }
          }
        : {})
    };
  }

  if (layer.metricId) {
    const metricStyles = { ...(design.metricStyles ?? {}) };
    if (layer.metricId === "temperature" && visible && !metricStyles.temperature) {
      metricStyles.temperature = { scale: 1 };
    }
    return {
      ...design,
      metricChanges: {
        ...(design.metricChanges ?? {}),
        [layer.metricId]: visible
      },
      metricStyles,
      layerVisibility: withoutLayerVisibility(design, layer.layoutGroupId ?? layer.id),
      ...(layer.metricId === "exercise" && visible && !design.exerciseSeparator
        ? {
            exerciseSeparator: inferExerciseSeparatorStyle(
              details,
              metricStyles.exercise?.color ?? design.digitColor
            )
          }
        : {})
    };
  }

  if (layer.nativeDataId && design.nativeData?.[layer.nativeDataId]) {
    return {...design, nativeData: {...design.nativeData, [layer.nativeDataId]: {...design.nativeData[layer.nativeDataId], enabled: visible}}};
  }
  if (layer.weatherIndicator) {
    const capability = getWeatherCapability(details);
    if (!capability) {
      return visibilityFail("layer.missing", "Layer weather is unavailable in this template and mode.");
    }
    return {
      ...design,
      weatherIndicator: {
        ...design.weatherIndicator,
        enabled: visible,
        x: design.weatherIndicator?.x ?? capability.defaultPos.x,
        y: design.weatherIndicator?.y ?? capability.defaultPos.y,
        scale: design.weatherIndicator?.scale ?? 1,
        ...(design.weatherIndicator &&
        Object.prototype.hasOwnProperty.call(design.weatherIndicator, "color")
          ? { color: design.weatherIndicator.color }
          : {})
      }
    };
  }

  if (layer.ampmIndicator) {
    const capability = getAmPmCapability(details);
    if (!capability) {
      return visibilityFail("layer.missing", "Layer ampm is unavailable in this template and mode.");
    }
    return {
      ...design,
      ampmIndicator: {
        enabled: visible,
        x: design.ampmIndicator?.x ?? capability.defaultPos.x,
        y: design.ampmIndicator?.y ?? capability.defaultPos.y,
        scale: design.ampmIndicator?.scale ?? 1,
        color: design.ampmIndicator?.color,
        fontFamily: design.ampmIndicator?.fontFamily,
        rasterFont: design.ampmIndicator?.rasterFont
      }
    };
  }

  if (layer.staticSeparatorId) {
    const separator = design.staticSeparators[layer.staticSeparatorId];
    const configAssetId = layer.staticSeparatorId === "colon"
      ? "config:colon_icon"
      : watchfaceArcCutIsDateSlash(details)
        ? "config:arc_cut_icon"
        : null;
    return {
      ...design,
      staticSeparators: {
        ...design.staticSeparators,
        [layer.staticSeparatorId]: { ...separator, enabled: visible }
      },
      ...(visible && configAssetId
        ? {
            configAssetOverrides: {
              ...(design.configAssetOverrides ?? {}),
              [configAssetId]: {
                ...(design.configAssetOverrides?.[configAssetId] ?? {}),
                enabled: false
              }
            }
          }
        : {})
    };
  }

  if (layer.backgroundElementId) {
    return {
      ...design,
      backgroundElements: (design.backgroundElements ?? []).map((element) =>
        element.id === layer.backgroundElementId
          ? { ...element, visible }
          : element
      )
    };
  }

  if (layer.spriteId) {
    return {
      ...design,
      designSprites: design.designSprites.map((sprite) =>
        sprite.id === layer.spriteId ? { ...sprite, visible } : sprite
      )
    };
  }

  if (layer.kind === "background") {
    return { ...design, artworkVisible: visible };
  }

  if (layer.kind === "batteryIcon") {
    return {
      ...design,
      layerVisibility: {
        ...(design.layerVisibility ?? {}),
        batteryIcon: visible
      },
      configAssetOverrides: {
        ...(design.configAssetOverrides ?? {}),
        "config:battery_icon": {
          ...(design.configAssetOverrides?.["config:battery_icon"] ?? {}),
          enabled: visible
        }
      }
    };
  }

  if (layer.kind === "controlBatteryIcon") {
    return setControlBatteryVisible(design, details, mode, visible);
  }

  if (layer.layoutGroupId) {
    return {
      ...design,
      layerVisibility: {
        ...(design.layerVisibility ?? {}),
        [layer.layoutGroupId]: visible
      }
    };
  }

  return visibilityFail(
    "visibility.unsupported",
    `Layer ${layer.id} does not support visibility changes.`
  );
}

/**
 * Applies the same layer-specific show/hide mutations as the editor's Layers
 * panel. `design` is the already-resolved active-mode state; `mode` selects
 * the matching source config used to discover addressable layers and defaults.
 */
export function setWatchfaceAutomationVisibility(
  design: CorosWatchfaceDesignState,
  details: CorosWatchfaceTemplateDetails,
  mode: WatchfacePreviewMode,
  id: string,
  visible: boolean
): CorosWatchfaceDesignState {
  const modeDetails = detailsForCompositionMode(
    applyConfigTextEditsToDetails(details, design.configTextEdits),
    mode
  );
  const layers = deriveEditorLayers(modeDetails, design);
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));

  const canonicalId = id === "artwork" ? "background" : id;
  const groupId = canonicalId.startsWith("group:")
    ? canonicalId.slice("group:".length)
    : null;
  const memberIds = groupId === null
    ? [canonicalId]
    : normalizeWatchfaceEditorGroups(
        design.editorGroups,
        design.linkedLayerGroups
      ).find((group) => group.id === groupId)?.layerIds;
  if (!memberIds || memberIds.length === 0) {
    return visibilityFail("group.missing", `Group ${groupId ?? canonicalId} does not exist.`);
  }

  const locked = new Set(design.lockedLayerIds ?? []);
  const blocked = memberIds.filter((memberId) => locked.has(memberId));
  if (blocked.length > 0) {
    return visibilityFail(
      "layer.locked",
      `Unlock ${blocked.join(", ")} before editing visibility.`
    );
  }

  const resolved = memberIds.map((memberId) => {
    const layer = layersById.get(memberId);
    if (layer) return layer;
    const backgroundElementId = memberId.startsWith("bgel:")
      ? memberId.slice("bgel:".length)
      : null;
    const element = backgroundElementId
      ? design.backgroundElements?.find((candidate) => candidate.id === backgroundElementId)
      : undefined;
    if (element && backgroundElementId) {
      return {
        id: memberId,
        kind: "backgroundElement",
        label: memberId,
        backgroundElementId,
        visible: element.visible !== false,
        canHide: true,
        present: true,
        bounds: null,
        capabilities: { position: true, color: false, scale: false, font: false }
      } satisfies EditorLayer;
    }
    return visibilityFail(
      "layer.missing",
      `Layer ${memberId} is unavailable in this template and mode.`
    );
  });

  for (const layer of resolved) {
    if (!layer.canHide) {
      return visibilityFail(
        "visibility.unsupported",
        `Layer ${layer.id} does not support visibility changes.`
      );
    }
  }

  return resolved.reduce(
    (next, layer) => applyLayerVisibility(next, modeDetails, mode, layer, visible),
    design
  );
}
