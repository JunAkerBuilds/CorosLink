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
  buildTimeStyleOverrides,
  getAmPmCapability,
  mergeAssetReplacements,
  mergeConfigOverrides,
  type WatchfaceAssetLoader,
  type WatchfaceDateStyles,
  type WatchfaceMetricStyles,
  type WatchfaceStudioOptions,
  type WatchfaceTimeStyles
} from "./watchfaceStudio";

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

/** Preview options mirror WatchfaceCreator so both views render identically. */
export function toStudioOptions(
  design: CorosWatchfaceDesignState
): WatchfaceStudioOptions {
  return {
    fontFamily: design.fontFamily,
    digitColor: design.digitColor,
    accentColor: design.accentColor,
    tintLabels: design.tintLabels,
    tintIcons: design.tintIcons,
    previewComplication: design.previewComplication as WatchfaceStudioOptions["previewComplication"],
    metricStyles: metricStylesOf(design),
    timeStyles: timeStylesOf(design),
    dateStyles: dateStylesOf(design),
    layerColors: design.layerColors ?? {}
  };
}

/**
 * Reproduces WatchfaceCreator's derived-details chain as a pure function:
 * metric toggles → component styles → layout offsets.
 */
export function deriveDesignDetails(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState
): DesignDetails {
  const metricOverrides = buildMetricOverrides(details, design.metricChanges ?? {});
  const metricDetails = applyConfigOverridesToDetails(details, metricOverrides);
  const componentStyleOverrides = mergeConfigOverrides(
    buildMetricStyleOverrides(metricDetails, metricStylesOf(design)),
    buildTimeStyleOverrides(metricDetails, timeStylesOf(design)),
    buildDateStyleOverrides(metricDetails, dateStylesOf(design)),
    buildLayerColorOverrides(metricDetails, design.layerColors ?? {}),
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
 * WatchfaceCreator sends to createCorosWatchfaceArchive, driven purely by a
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

  const studioActive =
    Boolean(design.fontFamily) || design.tintLabels || design.tintIcons;
  const metricStyleActive = hasEntries(metricStyles);
  const timeStyleActive = hasEntries(timeStyles);
  const dateStyleActive = hasEntries(dateStyles);
  const layerColorActive = hasEntries(design.layerColors);
  const ampmStyle = design.ampmIndicator;
  const ampmActive = Boolean(getAmPmCapability(details) && ampmStyle?.enabled);

  const assetReplacements = mergeAssetReplacements(
    studioActive
      ? await buildStudioReplacements(details, toStudioOptions(design), loadAssets)
      : [],
    metricStyleActive
      ? await buildMetricSpriteReplacements(
          metricDetails,
          metricStyles,
          design.fontFamily,
          loadAssets
        )
      : [],
    timeStyleActive
      ? await buildTimeSpriteReplacements(
          details,
          timeStyles,
          design.fontFamily,
          loadAssets
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
    ampmActive ? await buildAmPmSpriteReplacements(details, ampmStyle!, loadAssets) : []
  );

  const configOverrides = mergeConfigOverrides(
    metricOverrides,
    metricStyleActive ? buildMetricStyleOverrides(metricDetails, metricStyles, true) : [],
    timeStyleActive ? buildTimeStyleOverrides(details, timeStyles, true) : [],
    dateStyleActive ? buildDateStyleOverrides(details, dateStyles, true) : [],
    buildLayerColorOverrides(details, design.layerColors ?? {}),
    buildStaticSeparatorOverrides(details, design.staticSeparators),
    ampmActive ? buildAmPmOverrides(details, ampmStyle!) : [],
    layoutIsActive(design)
      ? buildLayoutOverrides(styledMetricDetails, design.layoutOffsets ?? {})
      : [],
    buildLayerVisibilityOverrides(details, design.layerVisibility ?? {})
  );

  return { assetReplacements, configOverrides };
}
