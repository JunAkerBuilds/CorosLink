import type {
  CorosWatchfaceArtwork,
  CorosWatchfaceDesignState,
  CorosWatchfaceModeDesignState
} from "../../electron/types";
import {
  AOD_DIM_FACTOR,
  dimHexColor,
  type WatchfacePreviewMode
} from "./watchfaceStudio.ts";

const DEFAULT_STATIC_SEPARATORS = {
  colon: { enabled: false, x: 400, y: 320, size: 64, color: "#ffffff" },
  dateSlash: { enabled: false, x: 400, y: 240, size: 48, color: "#ffffff" }
};
const DEFAULT_AMPM_STYLE = {
  enabled: false,
  x: 480,
  y: 360,
  scale: 1
};

function makeModeDefaultDesign(): CorosWatchfaceDesignState {
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
    previewComplication: "",
    metricChanges: {},
    metricStyles: {},
    controlComplicationEnabled: {},
    controlIconOffsets: {},
    separateAutoTime: false,
    timeStyles: {},
    dateStyles: {},
    staticSeparators: {
      colon: { ...DEFAULT_STATIC_SEPARATORS.colon },
      dateSlash: { ...DEFAULT_STATIC_SEPARATORS.dateSlash }
    },
    ampmIndicator: { ...DEFAULT_AMPM_STYLE },
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
    designSprites: [],
    artworkLayerOrder: [],
    backgroundElements: []
  };
}

const MODE_DESIGN_KEYS = [
  "backgroundColor",
  "accentColor",
  "artwork",
  "artworkVisible",
  "zoom",
  "fontFamily",
  "rasterFont",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "digitColor",
  "tintLabels",
  "tintIcons",
  "previewComplication",
  "metricChanges",
  "metricStyles",
  "selectableMetricStyle",
  "controlComplicationEnabled",
  "controlIconOffsets",
  "separateAutoTime",
  "timeStyles",
  "dateStyles",
  "staticSeparators",
  "ampmIndicator",
  "weatherIndicator",
  "layoutOffsets",
  "linkedLayerGroups",
  "editorGroups",
  "editorGuides",
  "lockedLayerIds",
  "effectStyles",
  "layerEffects",
  "layerVisibility",
  "layerColors",
  "configAssetOverrides",
  "designSprites",
  "artworkLayerOrder",
  "backgroundElements"
] as const satisfies ReadonlyArray<keyof CorosWatchfaceModeDesignState>;

function scopedRecord<T>(
  record: Record<string, T> | undefined,
  prefix: string
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record ?? {}).flatMap(([key, value]) =>
      key.startsWith(prefix) ? [[key.slice(prefix.length), value]] : []
    )
  );
}

function dimStyleRecord<T extends { color?: string }>(
  record: Record<string, T> | undefined
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record ?? {}).map(([key, style]) => [
      key,
      style.color
        ? { ...style, color: dimHexColor(style.color, AOD_DIM_FACTOR) }
        : { ...style }
    ])
  );
}

/** Produces the legacy auto-dimmed AOD appearance as independent mode state. */
export function materializeLegacyAodDesign(
  design: CorosWatchfaceDesignState,
  artwork: CorosWatchfaceArtwork | null,
  backgroundColor = "#000000"
): CorosWatchfaceModeDesignState {
  const configAssetOverrides = Object.fromEntries(
    Object.entries(design.configAssetOverrides ?? {}).flatMap(([key, value]) =>
      key.startsWith("aod:")
        ? [[`config:${key.slice("aod:".length)}`, value]]
        : []
    )
  );
  const layerEffects = scopedRecord(design.layerEffects, "aod:");
  return {
    backgroundColor,
    accentColor: dimHexColor(design.accentColor, AOD_DIM_FACTOR),
    artwork,
    artworkVisible:
      configAssetOverrides["config:background_icon"]?.enabled !== false,
    zoom: 1,
    fontFamily: design.fontFamily,
    rasterFont: design.rasterFont,
    fontWeight: design.fontWeight,
    fontStyle: design.fontStyle,
    letterSpacing: design.letterSpacing,
    digitColor: dimHexColor(design.digitColor, AOD_DIM_FACTOR),
    tintLabels: design.tintLabels,
    tintIcons: design.tintIcons,
    previewComplication: "",
    metricChanges: {},
    metricStyles: dimStyleRecord(design.metricStyles),
    controlComplicationEnabled: {},
    controlIconOffsets: {},
    separateAutoTime: false,
    timeStyles: dimStyleRecord(design.timeStyles),
    dateStyles: dimStyleRecord(design.dateStyles),
    staticSeparators: {
      colon: { ...DEFAULT_STATIC_SEPARATORS.colon },
      dateSlash: { ...DEFAULT_STATIC_SEPARATORS.dateSlash }
    },
    ampmIndicator: { ...DEFAULT_AMPM_STYLE, enabled: false },
    weatherIndicator: undefined,
    layoutOffsets: {},
    linkedLayerGroups: [],
    editorGroups: [],
    editorGuides: [],
    lockedLayerIds: [],
    effectStyles: [...(design.effectStyles ?? [])],
    layerEffects,
    layerVisibility: {},
    layerColors: Object.fromEntries(
      Object.entries(design.layerColors ?? {}).map(([key, color]) => [
        key,
        dimHexColor(color, AOD_DIM_FACTOR)
      ])
    ),
    configAssetOverrides,
    designSprites: [],
    artworkLayerOrder: [],
    backgroundElements: []
  };
}

export function resolveWatchfaceModeDesign(
  design: CorosWatchfaceDesignState,
  mode: WatchfacePreviewMode
): CorosWatchfaceDesignState {
  if (mode === "current" || !design.modeDesigns?.aod) return design;
  const defaults = makeModeDefaultDesign();
  return {
    ...defaults,
    ...design.modeDesigns.aod,
    version: 1,
    archiveWatchFaceVersion: design.archiveWatchFaceVersion,
    stripBlankConfigKeys: design.stripBlankConfigKeys,
    configTextEdits: design.configTextEdits,
    modeDesigns: design.modeDesigns
  };
}

/**
 * Writes an active mode design back into the project while keeping archive
 * settings and raw config edits global.
 */
export function writeWatchfaceModeDesign(
  root: CorosWatchfaceDesignState,
  mode: WatchfacePreviewMode,
  active: CorosWatchfaceDesignState
): CorosWatchfaceDesignState {
  const global = {
    archiveWatchFaceVersion: active.archiveWatchFaceVersion,
    stripBlankConfigKeys: active.stripBlankConfigKeys,
    configTextEdits: active.configTextEdits
  };
  if (mode === "current") {
    return {
      ...active,
      ...global,
      modeDesigns: root.modeDesigns
    };
  }
  const previous = resolveWatchfaceModeDesign(root, "aod");
  const backgroundKeys = [
    "backgroundColor",
    "artwork",
    "artworkVisible",
    "zoom",
    "staticSeparators",
    "designSprites",
    "artworkLayerOrder",
    "backgroundElements"
  ] as const;
  const backgroundEdited =
    root.modeDesigns?.aod?.backgroundEdited === true ||
    backgroundKeys.some(
      (key) =>
        JSON.stringify(previous[key]) !== JSON.stringify(active[key])
    );
  const aod: CorosWatchfaceModeDesignState = {};
  for (const key of MODE_DESIGN_KEYS) {
    (aod as Record<string, unknown>)[key] = active[key];
  }
  return {
    ...root,
    ...global,
    modeDesigns: {
      ...(root.modeDesigns ?? {}),
      aod: {
        ...aod,
        ...(backgroundEdited ? { backgroundEdited: true } : {})
      }
    }
  };
}
