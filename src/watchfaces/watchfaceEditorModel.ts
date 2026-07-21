import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import {
  analogCenterLayoutGroupId,
  applyConfigOverridesToDetails,
  applyLayoutToDetails,
  batteryPreviewStateIndex,
  configAssetCanvasSize,
  controlStatusLayoutGroupId,
  scaledBatterySpriteCanvasSize,
  computeLayoutGroupBounds,
  getFixedMetricCapabilities,
  getAmPmCapability,
  getWatchfaceAnalogPreviewLayers,
  getWatchfaceControlStatusPreviewLayers,
  hasControlBattery,
  isControlComplicationEnabled,
  pickPreviewResolution,
  watchfaceControlStatusPosition,
  WATCHFACE_COMPLICATIONS,
  WATCHFACE_LAYOUT_GROUPS,
  type WatchfaceLayoutGroupBounds,
  type WatchfaceMetricId,
  type WatchfaceStaticSeparatorId,
  type WatchfaceTimePartId
} from "./watchfaceStudio";
import { deriveDesignDetails } from "./watchfaceCompose";
import { getWeatherCapability } from "./weatherAssets";
import { rotatedCenterBounds } from "./watchfaceEditorGeometry";
import { watchfaceDesignSpriteName } from "./watchfaceSpriteTransform";
import {
  listWatchfaceEditorConfigAssets,
  watchfaceEditorControlBatteryIsListed,
  watchfaceEditorSelectableParentState
} from "./watchfaceEditorVisibility";

export { editorLayerAtPoint } from "./watchfaceEditorGeometry";

/**
 * The editor treats the watchface as a stack of layers. Unlike a freeform
 * design tool, most layers are the firmware-defined elements the template
 * actually renders — enumerated here, never invented. The background and any
 * imported sprites are the only freely-authored layers.
 */
export type EditorLayerKind =
  | "background"
  | "backgroundElement"
  | "time"
  | "date"
  | "weekday"
  | "seconds"
  | "separators"
  | "battery"
  | "batteryIcon"
  | "controlBatteryIcon"
  | "complication"
  | "metric"
  | "weather"
  | "configAsset"
  | "customSprite";

/** Which inspector controls a layer supports. */
export interface EditorLayerCapabilities {
  /** Can be repositioned on the canvas (writes design.layoutOffsets). */
  position: boolean;
  /** Has an editable sprite color. */
  color: boolean;
  /** Has an editable sprite scale. */
  scale: boolean;
  /** Participates in the global digit-font choice. */
  font: boolean;
  resize?: boolean;
  rotate?: boolean;
  crop?: boolean;
  skew?: boolean;
  opacity?: boolean;
  grouping?: boolean;
  effects?: boolean;
  stroke?: boolean;
}

export interface EditorLayer {
  id: string;
  kind: EditorLayerKind;
  label: string;
  /** The layout-group id used for canvas drag + position offsets, when movable. */
  layoutGroupId?: string;
  /** Set for fixed metrics, for style + visibility controls. */
  metricId?: WatchfaceMetricId;
  /** Set for hour/minute digit layers, for independent style controls. */
  timePartId?: WatchfaceTimePartId;
  /** Set for imported sprite layers. */
  spriteId?: string;
  /** Set for editor-created shapes, lines, and text. */
  backgroundElementId?: string;
  /** Set for editor-authored colon and date-slash layers. */
  staticSeparatorId?: WatchfaceStaticSeparatorId;
  /** Set for a direct PNG reference parsed from config.txt/AODconfig.txt. */
  configAssetId?: string;
  configAssetReplaced?: boolean;
  /** Set for the firmware-swapped AM/PM sprite pair. */
  ampmIndicator?: true;
  /** Set for the dynamic 41-state weather sprite folder. */
  weatherIndicator?: true;
  visible: boolean;
  /** Whether the user may hide/remove this layer. */
  canHide: boolean;
  /** Whether the element currently has renderable bounds on the face. */
  present: boolean;
  /** Selection/drag box in preview-resolution pixels, with offsets applied. */
  bounds: WatchfaceLayoutGroupBounds | null;
  capabilities: EditorLayerCapabilities;
}

const NO_CAPABILITIES: EditorLayerCapabilities = {
  position: false,
  color: false,
  scale: false,
  font: false
};

/** Panel order, top (front-most overlay) to bottom (background). */
const LAYER_ORDER: string[] = [
  "autoTime",
  "hours",
  "minutes",
  "seconds",
  "separators",
  "weekday",
  "dateMonth",
  "dateDay",
  "battery",
  "batteryIcon",
  "controlBatteryIcon",
  "complication",
  "heartRate",
  "steps",
  "calories",
  "exercise",
  "elevation",
  "temperature"
];

const METRIC_IDS = new Set<WatchfaceMetricId>([
  "heartRate",
  "steps",
  "calories",
  "exercise",
  "elevation",
  "temperature"
]);

const TIME_GROUP_PARTS: Record<string, WatchfaceTimePartId> = {
  autoTime: "autoTime",
  hours: "hours",
  minutes: "minutes",
  seconds: "seconds"
};

function labelForGroup(groupId: string): string {
  return (
    WATCHFACE_LAYOUT_GROUPS.find((group) => group.id === groupId)?.label ?? groupId
  );
}

function capabilitiesForGroup(groupId: string): EditorLayerCapabilities {
  if (groupId in TIME_GROUP_PARTS) {
    return {
      position: true,
      color: true,
      scale: true,
      font: true,
      rotate: true,
      grouping: true,
      effects: true,
      stroke: true
    };
  }
  if (METRIC_IDS.has(groupId as WatchfaceMetricId)) {
    return {
      position: true,
      color: true,
      scale: true,
      font: false,
      rotate: true,
      grouping: true,
      effects: true,
      stroke: true
    };
  }
  if (groupId === "battery") {
    return {
      position: true,
      color: true,
      scale: true,
      font: true,
      rotate: true,
      grouping: true,
      effects: true,
      stroke: true
    };
  }
  if (groupId === "weekday" || groupId === "dateMonth" || groupId === "dateDay") {
    return {
      position: true,
      color: true,
      scale: true,
      font: false,
      rotate: true,
      grouping: true,
      effects: true,
      stroke: true
    };
  }
  if (groupId === "batteryIcon") {
    return {
      position: true,
      color: false,
      scale: true,
      font: false,
      grouping: true,
      effects: true,
      stroke: true
    };
  }
  if (groupId === "controlBatteryIcon") {
    return {
      position: false,
      color: false,
      scale: true,
      font: false
    };
  }
  return {
    position: true,
    color: true,
    scale: false,
    font: false,
    grouping: true,
    effects: true,
    stroke: groupId === "complication"
  };
}

function kindForGroup(groupId: string): EditorLayerKind {
  if (groupId in TIME_GROUP_PARTS) {
    return groupId === "seconds" ? "seconds" : "time";
  }
  if (METRIC_IDS.has(groupId as WatchfaceMetricId)) {
    return "metric";
  }
  if (groupId === "weekday") {
    return "weekday";
  }
  if (groupId === "dateMonth" || groupId === "dateDay") {
    return "date";
  }
  if (groupId === "battery") {
    return "battery";
  }
  if (groupId === "batteryIcon") {
    return "batteryIcon";
  }
  if (groupId === "controlBatteryIcon") {
    return "controlBatteryIcon";
  }
  if (groupId === "complication") {
    return "complication";
  }
  return "separators";
}

/**
 * Builds the ordered layer list for the editor from a template and the current
 * design. Bounds already reflect the design's layout offsets, so the canvas can
 * draw selection boxes and hit-test drags directly against them.
 */
export function deriveEditorLayers(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState
): EditorLayer[] {
  // Keep selection geometry aligned with selectable styling and layout while
  // retaining hidden top-level layers in the layer list so users can re-enable
  // them. Control-battery is different: disabling it removes only children of
  // the still-visible selectable layer, so omit those children from its bounds.
  const styledDetails = deriveDesignDetails(details, design).styledMetricDetails;
  const laidOutDetails = applyLayoutToDetails(
    styledDetails,
    design.layoutOffsets ?? {}
  );
  const offsetDetails = laidOutDetails;
  const resolution = pickPreviewResolution(offsetDetails);
  const boundsById = new Map<string, WatchfaceLayoutGroupBounds>();
  if (resolution) {
    for (const box of computeLayoutGroupBounds(resolution, {
      timeStyles: design.timeStyles,
      letterSpacing: design.letterSpacing
    })) {
      if (box.id === "batteryIcon") {
        const batteryOverride = design.configAssetOverrides?.["config:battery_icon"];
        const batteryScale = batteryOverride?.scale ?? 1;
        const configuredFolder = resolution.config.battery_icon_dir?.replace(/\\/g, "/");
        const batteryFolder =
          (configuredFolder
            ? resolution.spriteFolders.find(
                (folder) =>
                  folder.kind === "state" && folder.folder === configuredFolder
              )
            : undefined);
        const templateStateIndex = batteryPreviewStateIndex(
          batteryFolder?.files.length ?? 0
        );
        const templateState = batteryFolder?.files[templateStateIndex];
        const importedStates = Object.entries(
          batteryOverride?.stateReplacements ?? {}
        )
          .filter(([key]) => /^\d+$/.test(key))
          .sort(([left], [right]) => Number(left) - Number(right));
        const importedPreviewState = importedStates[
          batteryPreviewStateIndex(importedStates.length)
        ];
        const artwork =
          batteryOverride?.stateReplacements?.[String(templateStateIndex)] ??
          importedPreviewState?.[1] ??
          batteryOverride?.replacement;
        const canvas = artwork && !templateState
          ? {
              width: artwork.width * batteryScale,
              height: artwork.height * batteryScale
            }
          : artwork && templateState
            ? scaledBatterySpriteCanvasSize(
              artwork.width,
              artwork.height,
              templateState.width,
              templateState.height,
              batteryScale
            )
            : {
              width: templateState?.width ?? box.x1 - box.x0,
              height: templateState?.height ?? box.y1 - box.y0
            };
        // The selection represents the full exported bitmap canvas, including
        // its intentional transparent/black padding.
        boundsById.set(box.id, {
          ...box,
          x1: box.x0 + canvas.width,
          y1: box.y0 + canvas.height
        });
      } else {
        boundsById.set(box.id, box);
      }
    }
  }

  const metricActivity = new Map(
    getFixedMetricCapabilities(details).map((metric) => [metric.id, metric])
  );

  const layers: EditorLayer[] = [];

  for (const groupId of LAYER_ORDER) {
    const bounds = boundsById.get(groupId) ?? null;

    // Battery data is a fixed metric even though it has a dedicated inspector.
    // Keep it available when the starter template omits its config keys: turning
    // it on creates battery_level_rect/font through buildMetricOverrides.
    if (groupId === "battery") {
      const capability = metricActivity.get("battery");
      const visible = design.metricChanges?.battery ?? capability?.active ?? false;
      layers.push({
        id: groupId,
        kind: "battery",
        label: capability?.label ?? "Battery data",
        layoutGroupId: groupId,
        metricId: "battery",
        visible,
        canHide: true,
        present: bounds !== null,
        bounds,
        capabilities: capabilitiesForGroup(groupId)
      });
      continue;
    }

    if (groupId === "batteryIcon") {
      layers.push({
        id: groupId,
        kind: "batteryIcon",
        label: labelForGroup(groupId),
        layoutGroupId: groupId,
        visible: bounds !== null && design.layerVisibility?.batteryIcon !== false,
        canHide: true,
        present: bounds !== null,
        bounds,
        capabilities: capabilitiesForGroup(groupId)
      });
      continue;
    }

    if (groupId === "controlBatteryIcon") {
      if (!watchfaceEditorControlBatteryIsListed(
        hasControlBattery(details),
        isControlComplicationEnabled(details, design, "battery"),
        design.controlComplicationEnabled?.battery,
        design.controlBatteryEnabled
      )) {
        continue;
      }
      layers.push({
        id: groupId,
        kind: "controlBatteryIcon",
        label: "Control battery icon",
        visible: isControlComplicationEnabled(details, design, "battery"),
        canHide: true,
        present: true,
        bounds: null,
        capabilities: capabilitiesForGroup(groupId)
      });
      continue;
    }

    if (groupId === "complication") {
      const selectableState = watchfaceEditorSelectableParentState(
        details,
        design,
        bounds !== null
      );
      // The selector's geometry disappears when its last choice is disabled.
      // Keep the parent layer addressable so users can reopen its inspector and
      // turn choices back on instead of losing the only recovery path.
      layers.push({
        id: groupId,
        kind: "complication",
        label: labelForGroup(groupId),
        layoutGroupId: groupId,
        visible: selectableState.visible,
        canHide: true,
        present: selectableState.present,
        bounds,
        capabilities: capabilitiesForGroup(groupId)
      });
      continue;
    }

    if (METRIC_IDS.has(groupId as WatchfaceMetricId)) {
      const metricId = groupId as WatchfaceMetricId;
      const capability = metricActivity.get(metricId);
      if (!capability) {
        continue; // Template does not implement this metric at all.
      }
      const overridden = design.metricChanges?.[metricId];
      const visible = overridden ?? capability.active;
      layers.push({
        id: groupId,
        kind: "metric",
        label:
          metricId === "temperature"
            ? "Temperature (always visible)"
            : capability.label,
        layoutGroupId: groupId,
        metricId,
        visible,
        canHide: true,
        present: bounds !== null,
        bounds,
        capabilities: capabilitiesForGroup(groupId)
      });
      continue;
    }

    // Non-metric elements only appear when the template lays them out.
    if (!bounds) {
      continue;
    }
    layers.push({
      id: groupId,
      kind: kindForGroup(groupId),
      label: labelForGroup(groupId),
      layoutGroupId: groupId,
      ...(groupId in TIME_GROUP_PARTS ? { timePartId: TIME_GROUP_PARTS[groupId] } : {}),
      visible: design.layerVisibility?.[groupId] ?? true,
      canHide: true,
      present: true,
      bounds,
      capabilities: capabilitiesForGroup(groupId)
    });
  }

  const staticSeparatorLayers: EditorLayer[] = [];
  for (const [staticSeparatorId, id, label] of [
    ["colon", "staticColon", "Custom time colon"],
    ["dateSlash", "staticDateSlash", "Custom date slash"]
  ] as const) {
    const separator = design.staticSeparators?.[staticSeparatorId];
    const visible = Boolean(separator?.enabled);
    const width = separator ? Math.max(24, separator.size * 0.65) : 24;
    const height = separator ? Math.max(24, separator.size * 1.15) : 24;
    staticSeparatorLayers.push({
      id,
      kind: "separators",
      label,
      staticSeparatorId,
      visible,
      canHide: true,
      present: true,
      bounds: visible && separator
        ? {
            id,
            label,
            x0: separator.x - width / 2,
            y0: separator.y - height / 2,
            x1: separator.x + width / 2,
            y1: separator.y + height / 2
          }
        : null,
      capabilities: {
        position: true,
        color: true,
        scale: true,
        font: true,
        stroke: true
      }
    });
  }
  const separatorIndex = layers.findIndex((layer) => layer.id === "separators");
  layers.splice(
    separatorIndex >= 0 ? separatorIndex + 1 : Math.min(2, layers.length),
    0,
    ...staticSeparatorLayers
  );

  const ampmCapability = getAmPmCapability(details);
  if (ampmCapability) {
    const style = design.ampmIndicator ?? {
      enabled: ampmCapability.active,
      ...ampmCapability.defaultPos,
      scale: 1
    };
    const width = ampmCapability.icon.width * style.scale;
    const height = ampmCapability.icon.height * style.scale;
    const ampmLayer: EditorLayer = {
      id: "ampm",
      kind: "separators",
      label: "AM/PM indicator",
      ampmIndicator: true,
      visible: style.enabled,
      canHide: true,
      present: true,
      bounds: style.enabled
        ? {
            id: "ampm",
            label: "AM/PM indicator",
            x0: style.x,
            y0: style.y,
            x1: style.x + width,
            y1: style.y + height
          }
        : null,
      capabilities: {
        position: true,
        color: true,
        scale: true,
        font: false,
        stroke: true
      }
    };
    const dateSlashIndex = layers.findIndex((layer) => layer.id === "staticDateSlash");
    layers.splice(dateSlashIndex >= 0 ? dateSlashIndex + 1 : 2, 0, ampmLayer);
  }

  const weatherCapability = getWeatherCapability(details);
  if (weatherCapability) {
    const style = design.weatherIndicator ?? {
      enabled: weatherCapability.active,
      ...weatherCapability.defaultPos,
      scale: 1
    };
    const width = weatherCapability.size.width * style.scale;
    const height = weatherCapability.size.height * style.scale;
    layers.splice(1, 0, {
      id: "weather",
      kind: "weather",
      label: "Weather icon",
      weatherIndicator: true,
      visible: style.enabled,
      canHide: true,
      present: true,
      bounds: style.enabled
        ? {
            id: "weather",
            label: "Weather icon",
            x0: style.x,
            y0: style.y,
            x1: style.x + width,
            y1: style.y + height
          }
        : null,
      capabilities: {
        position: true,
        color: false,
        scale: true,
        font: false,
        stroke: true
      }
    });
  }

  const enabledControlIcons = WATCHFACE_COMPLICATIONS
    .filter(
      (complication) =>
        complication.id !== "battery" &&
        isControlComplicationEnabled(details, design, complication.id)
    )
    .map((complication) => complication.id);
  for (const reference of listWatchfaceEditorConfigAssets(
    details,
    offsetDetails,
    enabledControlIcons
  )) {
    // The current-face background_icon is the source behind the editable
    // Artwork → Background layer below. Exposing it again as a template asset
    // creates two controls for the same on-watch image. Keep AOD background
    // assets visible because those are independent of the current artwork.
    if (reference.id === "config:background_icon") {
      continue;
    }
    const override = design.configAssetOverrides?.[reference.id];
    const statusLayoutGroupId =
      reference.scope === "config"
        ? controlStatusLayoutGroupId(reference.configKey)
        : null;
    const analogLayoutGroupId =
      reference.scope === "config"
        ? analogCenterLayoutGroupId(reference.configKey)
        : null;
    const statusPreviewLayer =
      statusLayoutGroupId && resolution
        ? getWatchfaceControlStatusPreviewLayers(resolution).find(
            (layer) => layer.configKey === reference.configKey
          ) ?? null
        : null;
    const statusPosition =
      statusPreviewLayer
        ? {
            position: statusPreviewLayer.position,
            controlRelative: statusPreviewLayer.controlRelative
          }
        : statusLayoutGroupId && resolution
          ? watchfaceControlStatusPosition(resolution, reference.configKey)
          : null;
    const analogPreviewLayer =
      analogLayoutGroupId && resolution
        ? getWatchfaceAnalogPreviewLayers(resolution, new Date()).find(
            (layer) => layer.configKey === reference.configKey
          ) ?? null
        : null;
    const statusFallback =
      statusPreviewLayer?.source ??
      override?.replacement ??
      null;
    const statusCanvas =
      statusPosition && statusFallback
        ? configAssetCanvasSize(
            reference.configKey,
            override,
            {
              width: statusFallback.width,
              height: statusFallback.height
            }
          )
        : null;
    const statusBounds =
      statusPosition && statusCanvas && override?.enabled !== false
        ? {
            id: `configAsset:${reference.id}`,
            label: reference.label,
            x0: statusPosition.position.x,
            y0: statusPosition.position.y,
            x1: statusPosition.position.x + statusCanvas.width,
            y1: statusPosition.position.y + statusCanvas.height
          }
        : null;
    const analogBounds =
      analogPreviewLayer && override?.enabled !== false
        ? {
            id: `configAsset:${reference.id}`,
            label: reference.label,
            ...rotatedCenterBounds(
              analogPreviewLayer.center.x,
              analogPreviewLayer.center.y,
              analogPreviewLayer.source.width,
              analogPreviewLayer.source.height,
              analogPreviewLayer.rotationDegrees ?? 0,
              0,
              0
            )
          }
        : null;
    const movableLayoutGroupId =
      statusLayoutGroupId ?? analogLayoutGroupId;
    const assetAvailable =
      reference.source !== null || Boolean(override?.replacement);
    layers.push({
      id: `configAsset:${reference.id}`,
      kind: "configAsset",
      label: reference.label,
      ...(movableLayoutGroupId
        ? { layoutGroupId: movableLayoutGroupId }
        : {}),
      configAssetId: reference.id,
      configAssetReplaced: Boolean(override?.replacement),
      visible: assetAvailable && override?.enabled !== false,
      canHide: true,
      present:
        statusLayoutGroupId || analogLayoutGroupId
          ? assetAvailable
          : true,
      bounds: statusBounds ?? analogBounds,
      capabilities: movableLayoutGroupId
        ? {
            position: true,
            color: false,
            scale: true,
            font: false,
            grouping: true,
            effects: true,
            stroke: true
          }
        : {
            ...NO_CAPABILITIES,
            effects: true,
            stroke: true
          }
    });
  }

  for (const sprite of design.designSprites ?? []) {
    // Sprites are drawn centered on (x, y); use a rotation-aware bounding box
    // so the selection outline hugs the image.
    const width = sprite.width * sprite.scale;
    const height = sprite.height * sprite.scale;
    const bounds = rotatedCenterBounds(
      sprite.x,
      sprite.y,
      width,
      height,
      sprite.rotation,
      sprite.skewX,
      sprite.skewY
    );
    const label = watchfaceDesignSpriteName(sprite);
    layers.push({
      id: `sprite:${sprite.id}`,
      kind: "customSprite",
      label,
      spriteId: sprite.id,
      visible: sprite.visible !== false,
      canHide: true,
      present: true,
      bounds: {
        id: `sprite:${sprite.id}`,
        label,
        ...bounds
      },
      capabilities: {
        position: true,
        color: false,
        scale: true,
        font: false,
        resize: true,
        rotate: true,
        crop: true,
        skew: true,
        opacity: true,
        grouping: true,
        effects: true,
        stroke: true
      }
    });
  }

  layers.push({
    id: "background",
    kind: "background",
    label: "Background",
    visible: design.artworkVisible !== false,
    canHide: true,
    present: true,
    bounds: resolution
      ? { id: "background", label: "Background", x0: 0, y0: 0, x1: resolution.width, y1: resolution.height }
      : null,
    capabilities: {
      ...NO_CAPABILITIES,
      stroke: Boolean(
        design.configAssetOverrides?.["config:background_icon"]?.replacement ??
          design.artwork
      )
    }
  });

  return layers.map((layer) => ({
    ...layer,
    capabilities: {
      ...layer.capabilities,
      opacity: true
    }
  }));
}
