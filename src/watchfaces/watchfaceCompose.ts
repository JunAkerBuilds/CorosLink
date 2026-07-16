import type {
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceDesignState,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import {
  applyConfigOverridesToDetails,
  applyLayoutToDetails,
  buildAmPmOverrides,
  buildAmPmSpriteReplacements,
  buildControlTemperatureOverrides,
  buildControlTemperatureSpriteReplacements,
  buildControlBatteryVisibilityOverrides,
  buildSelectableMetricSpriteReplacements,
  buildSelectableMetricStyleOverrides,
  buildControlIconPositionOverrides,
  buildWatchfaceConfigAssetOverrides,
  buildWatchfaceConfigAssetReplacements,
  buildDateSpriteReplacements,
  buildDateStyleOverrides,
  buildLayerVisibilityOverrides,
  buildLayerColorOverrides,
  buildLayerColorSpriteReplacements,
  buildLayoutOverrides,
  buildMetricOverrides,
  buildMetricSpriteReplacements,
  buildMetricStyleOverrides,
  buildSeparateTimeOverrides,
  buildStaticSeparatorOverrides,
  buildStudioReplacements,
  buildTimeSpriteReplacements,
  buildTimeTrackingOverrides,
  buildTimeStyleOverrides,
  getAmPmCapability,
  getAvailableComplications,
  mergeAssetReplacements,
  mergeConfigOverrides,
  pickPreviewResolution,
  rasterFontSupportsText,
  rebaseNegativeControlChildren,
  type WatchfaceAssetLoader,
  type WatchfaceDateStyles,
  type WatchfaceMetricStyles,
  type WatchfaceStudioOptions,
  type WatchfaceTimeStyles
} from "./watchfaceStudio.ts";
import {
  renderWatchfaceDataUrlEffects,
  resolveWatchfaceLayerEffects,
  type WatchfaceEffectPadding
} from "./watchfaceEditorEffects.ts";
import { buildWatchfaceEffectPaddingOverrides } from "./watchfaceEffectPadding.ts";
import {
  buildWeatherOverrides,
  buildWeatherSpriteReplacements
} from "./weatherAssets.ts";

/**
 * The template details at each stage of the design pipeline. The editor's
 * canvas draws from `previewDetails`; layout offsets are applied on top of the
 * metric-toggle and component-style overrides so element bounds move correctly.
 */
export interface DesignDetails {
  timeFormatOverrides: CorosWatchfaceConfigOverride[];
  metricOverrides: CorosWatchfaceConfigOverride[];
  metricDetails: CorosWatchfaceTemplateDetails;
  styledMetricDetails: CorosWatchfaceTemplateDetails;
  previewDetails: CorosWatchfaceTemplateDetails;
}

export interface WatchfaceComposeResult {
  assetReplacements: CorosWatchfaceAssetReplacement[];
  configOverrides: CorosWatchfaceConfigOverride[];
  /**
   * Minimum info.json `o_wf_ver` this design needs the exported archive to
   * declare. Weather and temperature are only compiled onto the watch when the
   * template announces a high-enough version, so those features raise it to 4.
   */
  minWatchFaceVersion?: number;
}

/** Official weather-bearing COROS faces ship this watchface version. */
const WEATHER_WATCHFACE_VERSION = 4;

const EFFECT_FOLDER_LAYER: Array<[RegExp, string]> = [
  [/\/cl_battery\//, "battery"],
  [/\/cl_battery_icon\//, "batteryIcon"],
  [/\/cl_hr\//, "heartRate"],
  [/\/cl_steps\//, "steps"],
  [/\/cl_kcal\//, "calories"],
  [/\/cl_elev\//, "elevation"],
  [/\/cl_ftemp\//, "temperature"],
  [/\/cl_(?:hh|hl)\//, "hours"],
  [/\/cl_(?:mh|ml)\//, "minutes"],
  [/\/cl_(?:sh|sl)\//, "seconds"],
  [/\/cl_auto_time\//, "autoTime"],
  [/\/cl_weekday\//, "weekday"],
  [/\/cl_date_month\//, "dateMonth"],
  [/\/cl_date_day\//, "dateDay"],
  [/\/cl_control\//, "complication"]
];

function effectLayerForReplacement(path: string): string | null {
  return EFFECT_FOLDER_LAYER.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

interface EffectedReplacementResult {
  replacements: CorosWatchfaceAssetReplacement[];
  padding: Map<string, Map<string, WatchfaceEffectPadding>>;
}

async function buildBatteryIconEffectSources(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState,
  loadAssets: WatchfaceAssetLoader
): Promise<{
  replacements: CorosWatchfaceAssetReplacement[];
  configOverrides: CorosWatchfaceConfigOverride[];
}> {
  const batteryOverride = design.configAssetOverrides?.["config:battery_icon"];
  if (!hasLayerEffects(design, "batteryIcon")) {
    return { replacements: [], configOverrides: [] };
  }
  if (
    batteryOverride?.replacement ||
    Object.keys(batteryOverride?.stateReplacements ?? {}).length > 0
  ) {
    return {
      replacements: [],
      configOverrides: details.resolutions
        .filter((resolution) => Boolean(resolution.config.battery_icon_dir))
        .map((resolution) => ({
          path: `${resolution.directory}/config.txt`,
          values: { battery_icon_dir: "cl_battery_icon" }
        }))
    };
  }
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  const configOverrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const configured = resolution.config.battery_icon_dir?.replace(/\\/g, "/");
    if (!configured) continue;
    const folder = resolution.spriteFolders.find(
      (candidate) => candidate.folder.replace(/^a\//, "") === configured.replace(/^a\//, "")
    );
    if (!folder || folder.files.length === 0) continue;
    const assets = await loadAssets(folder.files.map((file) => file.path));
    for (const asset of assets) {
      replacements.push({
        path: `${resolution.directory}/cl_battery_icon/${asset.path.split("/").at(-1)}`,
        dataUrl: asset.dataUrl,
        create: true,
        allowDimensionOverride: true
      });
    }
    configOverrides.push({
      path: `${resolution.directory}/config.txt`,
      values: { battery_icon_dir: "cl_battery_icon" }
    });
  }
  return { replacements, configOverrides };
}

function isolateBatteryIconEffectPaths(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState,
  replacements: CorosWatchfaceAssetReplacement[]
): CorosWatchfaceAssetReplacement[] {
  if (!hasLayerEffects(design, "batteryIcon")) return replacements;
  return replacements.map((replacement) => {
    const resolution = details.resolutions.find((candidate) =>
      replacement.path.startsWith(`${candidate.directory}/`)
    );
    const configured = resolution?.config.battery_icon_dir?.replace(/\\/g, "/");
    if (!resolution || !configured) return replacement;
    const prefix = `${resolution.directory}/${configured.replace(/^\.\//, "")}/`;
    if (!replacement.path.startsWith(prefix)) return replacement;
    return {
      ...replacement,
      path: `${resolution.directory}/cl_battery_icon/${replacement.path.split("/").at(-1)}`,
      create: true,
      allowDimensionOverride: true
    };
  });
}

async function applyFirmwareEffects(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState,
  replacements: CorosWatchfaceAssetReplacement[]
): Promise<EffectedReplacementResult> {
  const master = pickPreviewResolution(details);
  const padding = new Map<string, Map<string, WatchfaceEffectPadding>>();
  const effected: CorosWatchfaceAssetReplacement[] = [];
  for (const replacement of replacements) {
    const layerId = effectLayerForReplacement(replacement.path);
    const effects = layerId
      ? resolveWatchfaceLayerEffects(design, layerId).filter(
          (effect) => effect.enabled && effect.opacity > 0
        )
      : [];
    if (!layerId || effects.length === 0) {
      effected.push(replacement);
      continue;
    }
    const directory = replacement.path.split("/", 1)[0]!;
    const resolution = details.resolutions.find(
      (candidate) => candidate.directory === directory
    );
    const scale = resolution && master ? resolution.width / master.width : 1;
    const rendered = await renderWatchfaceDataUrlEffects(
      replacement.dataUrl,
      effects,
      scale
    );
    const byLayer = padding.get(directory) ?? new Map<string, WatchfaceEffectPadding>();
    const existing = byLayer.get(layerId);
    byLayer.set(layerId, existing
      ? {
          left: Math.max(existing.left, rendered.padding.left),
          top: Math.max(existing.top, rendered.padding.top),
          right: Math.max(existing.right, rendered.padding.right),
          bottom: Math.max(existing.bottom, rendered.padding.bottom)
        }
      : rendered.padding);
    padding.set(directory, byLayer);
    effected.push({
      ...replacement,
      dataUrl: rendered.dataUrl,
      create: true,
      allowDimensionOverride: true
    });
  }
  return { replacements: effected, padding };
}

function buildEffectPaddingOverrides(
  details: CorosWatchfaceTemplateDetails,
  paddingByResolution: Map<string, Map<string, WatchfaceEffectPadding>>
): CorosWatchfaceConfigOverride[] {
  return buildWatchfaceEffectPaddingOverrides(details, paddingByResolution);
}

function metricStylesOf(design: CorosWatchfaceDesignState): WatchfaceMetricStyles {
  return (design.metricStyles ?? {}) as WatchfaceMetricStyles;
}

function timeStylesOf(design: CorosWatchfaceDesignState): WatchfaceTimeStyles {
  return (design.timeStyles ?? {}) as WatchfaceTimeStyles;
}

function dateStylesOf(design: CorosWatchfaceDesignState): WatchfaceDateStyles {
  return (design.dateStyles ?? {}) as WatchfaceDateStyles;
}

/** Preview options keep Studio rendering aligned with archive composition. */
export function toStudioOptions(
  design: CorosWatchfaceDesignState
): WatchfaceStudioOptions {
  return {
    fontFamily: design.fontFamily,
    fontWeight: design.fontWeight,
    fontStyle: design.fontStyle,
    letterSpacing: design.letterSpacing,
    rasterFont: design.rasterFont,
    digitColor: design.digitColor,
    accentColor: design.accentColor,
    tintLabels: design.tintLabels,
    tintIcons: design.tintIcons,
    previewComplication: design.previewComplication as WatchfaceStudioOptions["previewComplication"],
    metricStyles: metricStylesOf(design),
    complicationStyle: design.selectableMetricStyle,
    timeStyles: timeStylesOf(design),
    dateStyles: dateStylesOf(design),
    layerColors: design.layerColors ?? {},
    effectStyles: design.effectStyles ?? [],
    layerEffects: design.layerEffects ?? {},
    configAssetOverrides: design.configAssetOverrides ?? {},
    ampmStyle: design.ampmIndicator
  };
}

/**
 * Builds the Studio's derived-details chain as a pure function:
 * metric toggles → component styles → layout offsets.
 */
export function deriveDesignDetails(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState
): DesignDetails {
  const timeFormatOverrides = buildSeparateTimeOverrides(
    details,
    design.separateAutoTime === true
  );
  const timeFormatDetails = applyConfigOverridesToDetails(
    details,
    timeFormatOverrides
  );
  const metricOverrides = buildMetricOverrides(
    timeFormatDetails,
    design.metricChanges ?? {}
  );
  const metricDetails = applyConfigOverridesToDetails(
    timeFormatDetails,
    metricOverrides
  );
  const controlTemperatureStyle = metricStylesOf(design).temperature ?? {
    color: design.digitColor,
    scale: 1
  };
  const controlTemperatureOverrides = getAvailableComplications(metricDetails)
    .some((item) => item.id === "temperature")
      ? buildControlTemperatureOverrides(metricDetails, controlTemperatureStyle)
      : [];
  const selectableMetricDetails = applyConfigOverridesToDetails(
    metricDetails,
    controlTemperatureOverrides
  );
  const componentStyleOverrides = mergeConfigOverrides(
    buildMetricStyleOverrides(metricDetails, metricStylesOf(design)),
    controlTemperatureOverrides,
    design.selectableMetricStyle
      ? buildSelectableMetricStyleOverrides(
          selectableMetricDetails,
          design.selectableMetricStyle
        )
      : [],
    buildTimeStyleOverrides(metricDetails, timeStylesOf(design)),
    buildDateStyleOverrides(metricDetails, dateStylesOf(design)),
    buildLayerColorOverrides(metricDetails, design.layerColors ?? {}),
    buildControlIconPositionOverrides(metricDetails, design.controlIconOffsets ?? {}),
    buildStaticSeparatorOverrides(details, design.staticSeparators),
    buildWatchfaceConfigAssetOverrides(
      details,
      design.configAssetOverrides ?? {}
    )
  );
  const styledMetricDetails = applyConfigOverridesToDetails(
    metricDetails,
    componentStyleOverrides
  );
  const laidOutDetails = applyLayoutToDetails(
    styledMetricDetails,
    design.layoutOffsets ?? {}
  );
  const previewDetails = applyConfigOverridesToDetails(
    laidOutDetails,
    mergeConfigOverrides(
      buildLayerVisibilityOverrides(laidOutDetails, design.layerVisibility ?? {}),
      buildControlBatteryVisibilityOverrides(
        laidOutDetails,
        design.controlBatteryEnabled
      )
    )
  );
  return {
    timeFormatOverrides,
    metricOverrides,
    metricDetails,
    styledMetricDetails,
    previewDetails
  };
}

function hasEntries(record: Record<string, unknown> | undefined): boolean {
  return Boolean(record) && Object.keys(record!).length > 0;
}

function layoutIsActive(design: CorosWatchfaceDesignState): boolean {
  return Object.values(design.layoutOffsets ?? {}).some(
    (offset) => offset.dx !== 0 || offset.dy !== 0
  );
}

function hasLayerEffects(
  design: CorosWatchfaceDesignState,
  layerId: string
): boolean {
  return resolveWatchfaceLayerEffects(design, layerId).some(
    (effect) => effect.enabled && effect.opacity > 0
  );
}

/**
 * Builds the exact sprite-replacement and config-override sets that
 * Studio sends to createCorosWatchfaceArchive, driven purely by a
 * design state so the new editor produces byte-identical archives.
 */
export async function composeWatchfaceReplacements(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState,
  loadAssets: WatchfaceAssetLoader
): Promise<WatchfaceComposeResult> {
  const {
    timeFormatOverrides,
    metricOverrides,
    metricDetails,
    styledMetricDetails
  } =
    deriveDesignDetails(details, design);
  const metricStyles = { ...metricStylesOf(design) };
  for (const layerId of [
    "battery",
    "heartRate",
    "steps",
    "calories",
    "elevation",
    "temperature"
  ] as const) {
    if (!metricStyles[layerId] && hasLayerEffects(design, layerId)) {
      metricStyles[layerId] = { scale: 1 };
    }
  }
  const timeStyles = { ...timeStylesOf(design) };
  for (const layerId of ["hours", "minutes", "seconds", "autoTime"] as const) {
    if (!timeStyles[layerId] && hasLayerEffects(design, layerId)) {
      timeStyles[layerId] = { scale: 1 };
    }
  }
  const dateStyles = { ...dateStylesOf(design) };
  for (const layerId of ["weekday", "dateMonth", "dateDay"] as const) {
    if (!dateStyles[layerId] && hasLayerEffects(design, layerId)) {
      dateStyles[layerId] = { scale: 1 };
    }
  }

  const rasterFontActive = rasterFontSupportsText(design.rasterFont, "0123456789");
  const studioActive =
    Boolean(design.fontFamily) || rasterFontActive || design.tintLabels || design.tintIcons;
  const metricStyleActive = hasEntries(metricStyles);
  const selectableMetricStyle = design.selectableMetricStyle ??
    (hasLayerEffects(design, "complication") ? { scale: 1 } : undefined);
  const selectableMetricStyleActive = Boolean(selectableMetricStyle);
  const timeStyleActive = hasEntries(timeStyles);
  const dateStyleActive = hasEntries(dateStyles);
  const layerColorActive = hasEntries(design.layerColors);
  const typographyActive =
    Boolean(design.fontFamily) ||
    rasterFontActive ||
    Object.values(timeStyles).some(
      (style) => Boolean(style?.fontFamily) || style?.letterSpacing !== undefined
    );
  const ampmStyle = design.ampmIndicator;
  const ampmSupported = Boolean(getAmPmCapability(details) && ampmStyle);
  const ampmActive = Boolean(ampmSupported && ampmStyle?.enabled);
  const weatherStyle = design.weatherIndicator;
  const controlTemperatureActive = getAvailableComplications(details)
    .some((item) => item.id === "temperature");
  const controlTemperatureStyle = metricStyles.temperature ?? {
    color: design.digitColor,
    scale: 1
  };
  const controlTemperatureRasterActive = Boolean(
    controlTemperatureStyle.fontFamily ||
    design.fontFamily ||
    rasterFontActive ||
    rasterFontSupportsText(controlTemperatureStyle.rasterFont, "0123456789") ||
    controlTemperatureStyle.scale !== 1
  );
  const batteryIconEffectSources = await buildBatteryIconEffectSources(
    details,
    design,
    loadAssets
  );

  const baseAssetReplacements = mergeAssetReplacements(
    studioActive
      ? await buildStudioReplacements(details, toStudioOptions(design), loadAssets)
      : [],
    metricStyleActive
      ? await buildMetricSpriteReplacements(
          metricDetails,
          metricStyles,
          design.fontFamily,
          loadAssets,
          toStudioOptions(design)
        )
      : [],
    controlTemperatureActive && controlTemperatureRasterActive
      ? await buildControlTemperatureSpriteReplacements(
          metricDetails,
          controlTemperatureStyle,
          design.fontFamily,
          loadAssets,
          toStudioOptions(design)
        )
      : [],
    selectableMetricStyleActive
      ? await buildSelectableMetricSpriteReplacements(
          metricDetails,
          selectableMetricStyle!,
          design.fontFamily,
          loadAssets,
          toStudioOptions(design)
        )
      : [],
    timeStyleActive
      ? await buildTimeSpriteReplacements(
          metricDetails,
          timeStyles,
          design.fontFamily,
          loadAssets,
          toStudioOptions(design)
        )
      : [],
    dateStyleActive
      ? await buildDateSpriteReplacements(
          details,
          dateStyles,
          toStudioOptions(design),
          loadAssets
        )
      : [],
    layerColorActive
      ? await buildLayerColorSpriteReplacements(
          details,
          design.layerColors ?? {},
          loadAssets
        )
      : [],
    await buildWatchfaceConfigAssetReplacements(
      details,
      design.configAssetOverrides ?? {}
    ),
    batteryIconEffectSources.replacements,
    ampmActive ? await buildAmPmSpriteReplacements(details, ampmStyle!, loadAssets) : [],
    weatherStyle?.enabled
      ? await buildWeatherSpriteReplacements(details, weatherStyle)
      : []
  );

  const timeStyleOverrides = timeStyleActive
    ? buildTimeStyleOverrides(metricDetails, timeStyles, true)
    : [];
  const timePositionDetails = applyConfigOverridesToDetails(
    styledMetricDetails,
    timeStyleActive ? buildTimeStyleOverrides(details, timeStyles) : []
  );
  const timeTrackingOverrides = typographyActive
    ? buildTimeTrackingOverrides(
        timePositionDetails,
        design.letterSpacing ?? 0,
        timeStyles
      )
    : [];
  const trackedDetails = applyConfigOverridesToDetails(
    timePositionDetails,
    timeTrackingOverrides
  );
  const layoutConfigAssetOverrides = buildWatchfaceConfigAssetOverrides(
    trackedDetails,
    design.configAssetOverrides ?? {}
  );
  const layoutDetails = applyConfigOverridesToDetails(
    trackedDetails,
    layoutConfigAssetOverrides
  );
  const layoutOverrides = layoutIsActive(design)
    ? buildLayoutOverrides(layoutDetails, design.layoutOffsets ?? {})
    : [];
  // Config-asset overrides are resolved against the positioned layout so any
  // direct firmware coordinates remain exactly those shown in Studio.
  const configAssetPositionDetails = applyConfigOverridesToDetails(
    layoutDetails,
    layoutOverrides
  );
  const exportedControlTemperatureOverrides = controlTemperatureActive
    ? buildControlTemperatureOverrides(
        metricDetails,
        controlTemperatureStyle,
        controlTemperatureRasterActive
      )
    : [];
  const selectableConfigDetails = applyConfigOverridesToDetails(
    metricDetails,
    exportedControlTemperatureOverrides
  );

  const effectedAssets = await applyFirmwareEffects(
    details,
    design,
    isolateBatteryIconEffectPaths(details, design, baseAssetReplacements)
  );
  const configOverrides = rebaseNegativeControlChildren(
    details,
    mergeConfigOverrides(
      metricOverrides,
      timeFormatOverrides,
      metricStyleActive ? buildMetricStyleOverrides(metricDetails, metricStyles, true) : [],
      exportedControlTemperatureOverrides,
      selectableMetricStyleActive
        ? buildSelectableMetricStyleOverrides(
            selectableConfigDetails,
            selectableMetricStyle!,
            true
          )
        : [],
      timeStyleOverrides,
      dateStyleActive ? buildDateStyleOverrides(details, dateStyles, true) : [],
      timeTrackingOverrides,
      buildLayerColorOverrides(details, design.layerColors ?? {}),
      buildControlIconPositionOverrides(details, design.controlIconOffsets ?? {}),
      buildStaticSeparatorOverrides(details, design.staticSeparators),
      ampmSupported ? buildAmPmOverrides(details, ampmStyle!) : [],
      weatherStyle ? buildWeatherOverrides(details, weatherStyle) : [],
      // Retain synthesized fixed-asset keys (notably battery_icon_dir/pos).
      // The final positioned pass sees those keys in its intermediate details
      // and therefore correctly avoids emitting them a second time.
      layoutConfigAssetOverrides,
      layoutOverrides,
      buildEffectPaddingOverrides(configAssetPositionDetails, effectedAssets.padding),
      buildLayerVisibilityOverrides(details, design.layerVisibility ?? {}),
      buildControlBatteryVisibilityOverrides(details, design.controlBatteryEnabled),
      batteryIconEffectSources.configOverrides,
      buildWatchfaceConfigAssetOverrides(
        configAssetPositionDetails,
        design.configAssetOverrides ?? {},
        true
      )
    )
  );

  const requiresWeatherVersion =
    Boolean(weatherStyle?.enabled) || controlTemperatureActive;

  return {
    assetReplacements: effectedAssets.replacements,
    configOverrides,
    ...(requiresWeatherVersion
      ? { minWatchFaceVersion: WEATHER_WATCHFACE_VERSION }
      : {})
  };
}
