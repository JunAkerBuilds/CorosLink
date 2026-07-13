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
  buildControlIconPositionOverrides,
  buildDateSpriteReplacements,
  buildDateStyleOverrides,
  buildLayerVisibilityOverrides,
  buildLayerColorOverrides,
  buildLayerColorSpriteReplacements,
  buildLayoutOverrides,
  buildMetricOverrides,
  buildMetricSpriteReplacements,
  buildMetricStyleOverrides,
  buildStaticSeparatorOverrides,
  buildStudioReplacements,
  buildTimeSpriteReplacements,
  buildTimeTrackingOverrides,
  buildTimeStyleOverrides,
  getAmPmCapability,
  getAvailableComplications,
  mergeAssetReplacements,
  mergeConfigOverrides,
  rasterFontSupportsText,
  rebaseNegativeControlChildren,
  type WatchfaceAssetLoader,
  type WatchfaceDateStyles,
  type WatchfaceMetricStyles,
  type WatchfaceStudioOptions,
  type WatchfaceTimeStyles
} from "./watchfaceStudio";
import {
  buildWeatherOverrides,
  buildWeatherSpriteReplacements
} from "./weatherAssets";

/**
 * The template details at each stage of the design pipeline. The editor's
 * canvas draws from `previewDetails`; layout offsets are applied on top of the
 * metric-toggle and component-style overrides so element bounds move correctly.
 */
export interface DesignDetails {
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
    timeStyles: timeStylesOf(design),
    dateStyles: dateStylesOf(design),
    layerColors: design.layerColors ?? {},
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
  const metricOverrides = buildMetricOverrides(details, design.metricChanges ?? {});
  const metricDetails = applyConfigOverridesToDetails(details, metricOverrides);
  const controlTemperatureStyle = metricStylesOf(design).temperature ?? {
    color: design.digitColor,
    scale: 1
  };
  const componentStyleOverrides = mergeConfigOverrides(
    buildMetricStyleOverrides(metricDetails, metricStylesOf(design)),
    getAvailableComplications(metricDetails).some((item) => item.id === "temperature")
      ? buildControlTemperatureOverrides(metricDetails, controlTemperatureStyle)
      : [],
    buildTimeStyleOverrides(metricDetails, timeStylesOf(design)),
    buildDateStyleOverrides(metricDetails, dateStylesOf(design)),
    buildLayerColorOverrides(metricDetails, design.layerColors ?? {}),
    buildControlIconPositionOverrides(metricDetails, design.controlIconOffsets ?? {}),
    buildStaticSeparatorOverrides(details, design.staticSeparators)
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
    buildLayerVisibilityOverrides(details, design.layerVisibility ?? {})
  );
  return { metricOverrides, metricDetails, styledMetricDetails, previewDetails };
}

function hasEntries(record: Record<string, unknown> | undefined): boolean {
  return Boolean(record) && Object.keys(record!).length > 0;
}

function layoutIsActive(design: CorosWatchfaceDesignState): boolean {
  return Object.values(design.layoutOffsets ?? {}).some(
    (offset) => offset.dx !== 0 || offset.dy !== 0
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
  const { metricOverrides, metricDetails, styledMetricDetails } =
    deriveDesignDetails(details, design);
  const metricStyles = metricStylesOf(design);
  const timeStyles = timeStylesOf(design);
  const dateStyles = dateStylesOf(design);

  const rasterFontActive = rasterFontSupportsText(design.rasterFont, "0123456789");
  const studioActive =
    Boolean(design.fontFamily) || rasterFontActive || design.tintLabels || design.tintIcons;
  const metricStyleActive = hasEntries(metricStyles);
  const timeStyleActive = hasEntries(timeStyles);
  const dateStyleActive = hasEntries(dateStyles);
  const layerColorActive = hasEntries(design.layerColors);
  const typographyActive =
    Boolean(design.fontFamily) ||
    rasterFontActive ||
    Object.values(timeStyles).some((style) => Boolean(style?.fontFamily));
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
    controlTemperatureStyle.scale !== 1
  );

  const assetReplacements = mergeAssetReplacements(
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
    timeStyleActive
      ? await buildTimeSpriteReplacements(
          details,
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
    ampmActive ? await buildAmPmSpriteReplacements(details, ampmStyle!, loadAssets) : [],
    weatherStyle?.enabled
      ? await buildWeatherSpriteReplacements(details, weatherStyle)
      : []
  );

  const timeStyleOverrides = timeStyleActive
    ? buildTimeStyleOverrides(details, timeStyles, true)
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
  const layoutDetails = applyConfigOverridesToDetails(
    timePositionDetails,
    timeTrackingOverrides
  );

  const configOverrides = rebaseNegativeControlChildren(
    details,
    mergeConfigOverrides(
      metricOverrides,
      metricStyleActive ? buildMetricStyleOverrides(metricDetails, metricStyles, true) : [],
      controlTemperatureActive
        ? buildControlTemperatureOverrides(
            metricDetails,
            controlTemperatureStyle,
            controlTemperatureRasterActive
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
      layoutIsActive(design)
        ? buildLayoutOverrides(layoutDetails, design.layoutOffsets ?? {})
        : [],
      buildLayerVisibilityOverrides(details, design.layerVisibility ?? {})
    )
  );

  const requiresWeatherVersion =
    Boolean(weatherStyle?.enabled) || controlTemperatureActive;

  return {
    assetReplacements,
    configOverrides,
    ...(requiresWeatherVersion
      ? { minWatchFaceVersion: WEATHER_WATCHFACE_VERSION }
      : {})
  };
}
