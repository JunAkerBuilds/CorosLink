import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import {
  applyConfigOverridesToDetails,
  applyLayoutToDetails,
  buildDateStyleOverrides,
  buildMetricOverrides,
  buildMetricStyleOverrides,
  buildTimeStyleOverrides,
  computeLayoutGroupBounds,
  getFixedMetricCapabilities,
  getAmPmCapability,
  listWatchfaceConfigAssets,
  mergeConfigOverrides,
  pickPreviewResolution,
  WATCHFACE_LAYOUT_GROUPS,
  type WatchfaceDateStyles,
  type WatchfaceLayoutGroupBounds,
  type WatchfaceMetricId,
  type WatchfaceMetricStyles,
  type WatchfaceStaticSeparatorId,
  type WatchfaceTimeStyles,
  type WatchfaceTimePartId
} from "./watchfaceStudio";
import { getWeatherCapability } from "./weatherAssets";
import { rotatedCenterBounds } from "./watchfaceEditorGeometry";

export { editorLayerAtPoint } from "./watchfaceEditorGeometry";

/**
 * The editor treats the watchface as a stack of layers. Unlike a freeform
 * design tool, most layers are the firmware-defined elements the template
 * actually renders — enumerated here, never invented. The background and any
 * imported sprites are the only freely-authored layers.
 */
export type EditorLayerKind =
  | "background"
  | "time"
  | "date"
  | "weekday"
  | "seconds"
  | "separators"
  | "battery"
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
}

export interface EditorLayer {
  id: string;
  kind: EditorLayerKind;
  label: string;
  /** The layout-group id used for canvas drag + position offsets, when movable. */
  layoutGroupId?: string;
  /** Set for the four fixed metrics, for style + visibility controls. */
  metricId?: WatchfaceMetricId;
  /** Set for hour/minute digit layers, for independent style controls. */
  timePartId?: WatchfaceTimePartId;
  /** Set for imported sprite layers. */
  spriteId?: string;
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
  "hours",
  "minutes",
  "seconds",
  "separators",
  "weekday",
  "dateMonth",
  "dateDay",
  "battery",
  "complication",
  "heartRate",
  "steps",
  "calories",
  "elevation",
  "temperature"
];

const METRIC_IDS = new Set<WatchfaceMetricId>([
  "heartRate",
  "steps",
  "calories",
  "elevation",
  "temperature"
]);

const TIME_GROUP_PARTS: Record<string, WatchfaceTimePartId> = {
  hours: "hours",
  minutes: "minutes"
};

function labelForGroup(groupId: string): string {
  return (
    WATCHFACE_LAYOUT_GROUPS.find((group) => group.id === groupId)?.label ?? groupId
  );
}

function capabilitiesForGroup(groupId: string): EditorLayerCapabilities {
  if (groupId in TIME_GROUP_PARTS) {
    return { position: true, color: true, scale: true, font: true };
  }
  if (METRIC_IDS.has(groupId as WatchfaceMetricId)) {
    return { position: true, color: true, scale: true, font: false };
  }
  if (groupId === "weekday" || groupId === "dateMonth" || groupId === "dateDay") {
    return { position: true, color: true, scale: true, font: false };
  }
  return { position: true, color: true, scale: false, font: false };
}

function kindForGroup(groupId: string): EditorLayerKind {
  if (groupId in TIME_GROUP_PARTS || groupId === "seconds") {
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
  const metricDetails = applyConfigOverridesToDetails(
    details,
    buildMetricOverrides(details, design.metricChanges ?? {})
  );
  const styledDetails = applyConfigOverridesToDetails(
    metricDetails,
    mergeConfigOverrides(
      buildMetricStyleOverrides(
        metricDetails,
        (design.metricStyles ?? {}) as WatchfaceMetricStyles
      ),
      buildTimeStyleOverrides(
        metricDetails,
        (design.timeStyles ?? {}) as WatchfaceTimeStyles
      ),
      buildDateStyleOverrides(
        metricDetails,
        (design.dateStyles ?? {}) as WatchfaceDateStyles
      )
    )
  );
  const offsetDetails = applyLayoutToDetails(
    styledDetails,
    design.layoutOffsets ?? {}
  );
  const resolution = pickPreviewResolution(offsetDetails);
  const boundsById = new Map<string, WatchfaceLayoutGroupBounds>();
  if (resolution) {
    for (const box of computeLayoutGroupBounds(resolution)) {
      boundsById.set(box.id, box);
    }
  }

  const metricActivity = new Map(
    getFixedMetricCapabilities(details).map((metric) => [metric.id, metric])
  );

  const layers: EditorLayer[] = [];

  for (const groupId of LAYER_ORDER) {
    const bounds = boundsById.get(groupId) ?? null;

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
      capabilities: { position: true, color: true, scale: true, font: true }
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
      capabilities: { position: true, color: true, scale: true, font: false }
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
      capabilities: { position: true, color: false, scale: true, font: false }
    });
  }

  for (const reference of listWatchfaceConfigAssets(details)) {
    // The current-face background_icon is the source behind the editable
    // Artwork → Background layer below. Exposing it again as a template asset
    // creates two controls for the same on-watch image. Keep AOD background
    // assets visible because those are independent of the current artwork.
    if (reference.id === "config:background_icon") {
      continue;
    }
    const override = design.configAssetOverrides?.[reference.id];
    layers.push({
      id: `configAsset:${reference.id}`,
      kind: "configAsset",
      label: reference.label,
      configAssetId: reference.id,
      configAssetReplaced: Boolean(override?.replacement),
      visible: override?.enabled !== false,
      canHide: true,
      present: true,
      bounds: null,
      capabilities: NO_CAPABILITIES
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
      sprite.rotation
    );
    layers.push({
      id: `sprite:${sprite.id}`,
      kind: "customSprite",
      label: "Imported sprite",
      spriteId: sprite.id,
      visible: sprite.visible !== false,
      canHide: true,
      present: true,
      bounds: {
        id: `sprite:${sprite.id}`,
        label: "Imported sprite",
        ...bounds
      },
      capabilities: { position: true, color: false, scale: true, font: false }
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
    capabilities: NO_CAPABILITIES
  });

  return layers;
}
