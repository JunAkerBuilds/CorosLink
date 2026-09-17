import type { CorosWatchfaceNativeAssetRole, CorosWatchfaceNativeDataStyle } from "../../electron/types";
import { NATIVE_CHART_LINE_AVAILABILITY, NATIVE_CHART_SOURCES, NATIVE_DATA_FIELDS } from "../../electron/watchfaceNativeCatalog";
import { defaultNativeDataStyle, nativePart, nativePartHasPosition, nativeParts, nativeRoleIndices } from "./nativeDataParts";

/** Uses the same component/default rules as the inspector and exporter. */
export function describeNativeDataComponents(id: string, style: CorosWatchfaceNativeDataStyle) {
  return nativeParts(id, style).map(part => {
    const assetRole: CorosWatchfaceNativeAssetRole | null = part === "plot" ? null : part === "value" ? "digits" : part;
    return {
      id: part,
      stylePath: `/design/nativeData/${id}/parts/${part}`,
      positionEditable: nativePartHasPosition(part),
      effectiveStyle: nativePart(id, style, part),
      assetRole,
      ...(assetRole ? {
        assetsPath: `/design/nativeData/${id}/assets/${assetRole}`,
        textPath: `/design/nativeData/${id}/assetTexts/${assetRole}`,
        stateIndices: nativeRoleIndices(id, style, assetRole).map(String)
      } : { chartStylePath: `/design/nativeData/${id}/chartStyle` })
    };
  });
}

export function getNativeDataAutomationCatalog() {
  return {
    path: "/design/nativeData",
    layerIdPrefix: "native:",
    coordinates: "Layer x/y use capabilities.placement master pixels. Part offsets, dimensions, line widths and bar spacing use master pixels before the layer scale. Units, symbols and decimal points have firmware-controlled positions.",
    editing: "Use set/merge/unset via apply_commands. Initialize nativeData when absent; set a field to its defaults before editing. Pointer parents must exist and merge is shallow. Unset optional overrides to restore defaults. Use mode:'aod' with the same /design paths for AOD.",
    artwork: "assets[role][stateIndex] accepts a PNG assetId from import_asset or get_document. State keys are canonical unpadded strings such as '0'. Missing states use defaults. assetTexts uses the same role/index map. Replacement images take precedence over text. Decimal is a numeric decimal point.",
    lineGraphAvailability: NATIVE_CHART_LINE_AVAILABILITY,
    chartPreviewTypes: ["bars"],
    limits: [
      "One slot per fixed data field and one shared chart layer per display mode.",
      "Charts are experimental. Bar rendering has been reported on PACE Pro, but history selection and live updates remain unverified. chartSource selects a numeric/icon data field to export, not a confirmed firmware history selector. A successful preview/export does not prove live chart support.",
      "PACE Pro testing reports chart changes on Back while the chart number remains absent. Do not treat cycling as proof of numeric-readout support or a fix for missing numbers. A separate metric layer is independent and will not follow chart changes.",
      "Chart previews are bars-only. Use chartStyle.barWidth, barGap, selectedBarColor and unselectedBarColor. Legacy curve preview and line-style values remain accepted for project compatibility but cannot enable a line preview. Firmware still chooses the live graph representation.",
      "Minimum/maximum temperature share units and minus artwork; minimum supplies them when both are enabled.",
      "AQI availability depends on region and synced weather data. A blank weather_aqi layer does not by itself establish an export bug; check whether the watch's built-in Weather widget has an AQI reading. Preview and simulation values are samples, not supplied live data.",
      "weather_temp owns the weather companion temperature slot when configured. Remove it to restore companion control.",
      "weather_temp is labeled Current weather and displays weather temperature. The separate temperature metric and selectable control use the watch's temperature sensor, which is affected by body heat. Preserve both when requested; their simulation values are independent.",
      "Format versions are raised automatically. Device support, units and state ordering still require on-watch verification."
    ],
    fields: NATIVE_DATA_FIELDS.map(field => {
      const defaults = defaultNativeDataStyle(field.id);
      return {
        id: field.id, layerId: `native:${field.id}`, label: field.label, category: field.category,
        kind: field.kind, minimumFormatVersion: field.version, sample: field.sample,
        ...(field.availability ? { availability: field.availability } : {}),
        defaults, components: describeNativeDataComponents(field.id, defaults)
      };
    }),
    chartSources: NATIVE_CHART_SOURCES.map(source => ({
      ...source,
      components: describeNativeDataComponents("chart", { ...defaultNativeDataStyle("chart"), chartSource: source.id })
    }))
  };
}
