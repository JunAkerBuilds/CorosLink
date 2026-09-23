import type { CorosWatchfaceNativeAssetRole, CorosWatchfaceNativeDataStyle } from "../../electron/types";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_BY_ID, NATIVE_DATA_FIELDS } from "../../electron/watchfaceNativeCatalog";
import { defaultNativeDataStyle, isNativeTime, nativeAssetText, nativePart, nativePartHasPosition, nativeParts, nativeRoleIndices } from "./nativeDataParts";

/** Distinguish exporter-defined roles from sample artwork and unverified firmware states. */
function nativeSpriteMeaning(id: string, style: CorosWatchfaceNativeDataStyle, role: CorosWatchfaceNativeAssetRole, index: number, count: number) {
  const known = (meaning: string) => ({ meaning, meaningSource: "exporter" as const });
  const preview = (meaning: string) => ({ meaning, meaningSource: "editor-preview" as const });
  const unknown = () => ({ meaning: `State ${index}: firmware meaning unknown; preserve the original artwork/order`, meaningSource: "unknown" as const });
  if (role === "digits") return known(`Digit ${index}`);
  if (role === "symbols") return known(["Minus sign", "Degree sign", "Percent sign", "Time colon"][index]);
  if (role === "decimal") return known("Decimal point");
  if (role === "progress") return known(index === 0 ? "Sunrise progress artwork" : "Sunset progress artwork");
  if (role === "unit") {
    const text = nativeAssetText(id, { ...style, assetTexts: undefined }, role, index);
    return known(`Unit ${text}${count === 2 ? index === 0 ? " (metric)" : " (imperial)" : ""}`);
  }
  if (role === "icon") {
    if (isNativeTime(id, style)) {
      const moon = style.chartSource === "chart_moonrise";
      return known(moon ? index === 0 ? "Moonrise" : "Moonset" : index === 0 ? "Sunrise" : "Sunset");
    }
    return known(`${id === "chart" ? NATIVE_CHART_SOURCES.find(source => source.id === style.chartSource)?.label ?? "Stress" : NATIVE_DATA_BY_ID.get(id)?.label ?? id} icon`);
  }
  if (role === "background") return known("Chart background");
  if (role === "mask") return known("Chart bar mask");
  if (role === "noDataMask") return known("Chart no-data mask");
  if (role === "states") {
    // These mappings are shared with nativeData.ts preview behavior. They are
    // not a claim that every template/device has the same firmware ordering.
    if (id === "weather_uv" && count === 6) return preview(["Unknown UV", "Low UV (0–2)", "Moderate UV (3–5)", "High UV (6–7)", "Very high UV (8–10)", "Extreme UV (11+)"][index]);
    if (id === "stamina" && count === 11) return preview(`Stamina ${index * 10}%`);
    if (id === "weather_direction" && count === 16) return preview(`Direction arrow rotated ${index * 22.5}° clockwise from up; firmware direction mapping unverified`);
    if (id === "chart" && style.chartSource === "chart_moon") return preview(`Moon phase index ${index} of 30; editor cycle starts dark at 0, full at 15; firmware phase mapping unverified`);
    if (id === "sedentary" && count === 7) return { meaning: index < 5 ? `Seated with filling ring, state ${index}; timing threshold unknown` : index === 5 ? "Move reminder" : "Inactive (dimmed)", meaningSource: "recovered-template" as const };
  }
  return unknown();
}

/** Preview selectors are known independently of the firmware meaning of a state. */
function nativeStateVerification(id: string, style: CorosWatchfaceNativeDataStyle, indices: string[]) {
  const limitation = id === "weather_uv" && indices.length !== 6
    ? "The editor UV selector implements six categorical states; this template has a different state count. State behavior cannot be verified with these scenarios."
    : id === "stamina" && indices.length !== 11
      ? "The editor stamina selector implements eleven 10-percent states; this template has a different state count. State behavior cannot be verified with these scenarios."
      : indices.length < 2 ? "This component does not expose multiple selectable states." : undefined;
  const sampled = [...new Set([indices[0], indices[Math.floor(indices.length / 2)], indices.at(-1)])].filter((index): index is string => index !== undefined);
  const key = id === "chart" ? style.chartSource ?? "chart_stress" : id;
  return {
    tool: "render_preview", supported: !limitation, scope: "editor-state-selection",
    ...(limitation ? { limitation } : {}),
    scenarios: limitation ? [] : sampled.map(index => ({
      scenario: { values: { [key]: id === "stamina" ? String(Number(index) * 10) : id === "weather_uv" ? ["-1", "0", "3", "6", "8", "11"][Number(index)] : index } },
      expectedPreviewStateIndex: index
    })),
    note: "Verify complete installed artwork and distinct rendered sample states. This proves editor state selection only, not firmware timing, health-category meaning or live on-watch behavior. Unknown state meanings must remain explicitly unknown."
  };
}

/** Uses the same component/default rules as the inspector and exporter. */
export function describeNativeDataComponents(id: string, style: CorosWatchfaceNativeDataStyle) {
  return nativeParts(id, style).map(part => {
    const assetRole: CorosWatchfaceNativeAssetRole | null = part === "plot" ? null : part === "value" ? "digits" : part;
    const effectiveStyle = nativePart(id, style, part);
    const stateIndices = assetRole ? nativeRoleIndices(id, style, assetRole).map(String) : [];
    return {
      id: part,
      stylePath: `/design/nativeData/${id}/parts/${part}`,
      positionEditable: nativePartHasPosition(part),
      effectiveStyle,
      assetRole,
      ...(assetRole ? {
        assetsPath: `/design/nativeData/${id}/assets/${assetRole}`,
        textPath: `/design/nativeData/${id}/assetTexts/${assetRole}`,
        stateIndices,
        spriteCount: stateIndices.length,
        ...(["digits", "symbols", "decimal", "unit"].includes(assetRole) ? { orderedValues: stateIndices.map(index => nativeAssetText(id, style, assetRole, Number(index))) } : {}),
        countSource: assetRole === "states" && id !== "chart" ? style.stateCount !== undefined ? "recovered-or-configured-stateCount" : "catalog-default; confirm against template" : "exporter",
        states: stateIndices.map(index => ({ index, ...nativeSpriteMeaning(id, style, assetRole, Number(index), stateIndices.length) })),
        stateOrder: "Each state is a separate PNG at its exact canonical index key. Indices may be sparse (the sunrise colon is key '3'); never renumber. Export filenames are zero-padded indices. Preserve unknown template states rather than guessing or repeating one image.",
        requiredImageSize: { width: Math.max(1, Math.round((assetRole === "digits" ? effectiveStyle.digitWidth : effectiveStyle.width) * style.scale)), height: Math.max(1, Math.round(effectiveStyle.height * style.scale)), coordinateSpace: "master pixels; exporter scales for each resolution" },
        ...(assetRole === "states" ? { verification: nativeStateVerification(id, style, stateIndices) } : {}),
        installedStateIndices: stateIndices.filter(index => Boolean(style.assets?.[assetRole]?.[index])),
        replacementNote: "Provide every required index for a complete custom set. Missing images fall back to generated text/default artwork, not another installed state. assetTexts overrides appearance, not a state's firmware meaning. Preview mappings do not establish on-watch behavior."
      } : { spriteCount: 0, chartStylePath: `/design/nativeData/${id}/chartStyle`, stateOrder: "Firmware draws the plot; chart appearance settings are not a sprite sequence." })
    };
  });
}

export function getNativeDataAutomationCatalog() {
  return {
    path: "/design/nativeData",
    layerIdPrefix: "native:",
    coordinates: "Layer x/y use capabilities.placement master pixels. Part offsets, dimensions, line widths and bar spacing use master pixels before the layer scale. Units, symbols and decimal points have firmware-controlled positions.",
    editing: "Use add_native_field with id, x, y and optional style to create any catalog field absent from the current mode, even when the starting template has no corresponding config or sprites. Export creates these bindings and assets. Use set/merge/unset for existing fields. Pointer parents must exist and merge is shallow. Unset optional overrides to restore defaults. Use mode:'aod' with the same /design paths for AOD.",
    artwork: "assets[role][stateIndex] accepts a PNG assetId from import_asset or get_document. State keys are canonical unpadded strings such as '0'. Missing states use defaults. assetTexts uses the same role/index map. Replacement images take precedence over text. Decimal is a numeric decimal point.",
    chartPreviewTypes: ["bars", "curve"],
    limits: [
      "One slot per fixed data field and one shared chart layer per display mode.",
      "Charts are experimental. Bar rendering has been reported on PACE Pro, but history selection and live updates remain unverified. chartSource selects a numeric/icon data field to export, not a confirmed firmware history selector. A successful preview/export does not prove live chart support.",
      "PACE Pro testing reports chart changes on Back while the chart number remains absent. Do not treat cycling as proof of numeric-readout support or a fix for missing numbers. A separate metric layer is independent and will not follow chart changes.",
      "chartStyle.previewType selects the sample preview only: 'bars' uses barWidth, barGap, selectedBarColor and unselectedBarColor; 'curve' uses lineWidth, upperColor and lowerColor. Both appearance sets are exported. Firmware still chooses the live graph representation per chart group; sunrise, moonrise, barometer and tide groups draw curves on official faces.",
      "The watch cycles chart groups with Back (general, sun, moon, barometer, tide). Readouts of other groups already in a recovered official face's config are kept on export; the chart layer replaces only the shared graph and its selected source. The preview follows the chart layer's group: chart_sun_angle draws only in the sun group, and weather_temp, weather_temp_min/max, weather_wind and weather_direction are hidden only where they share a slot with the group's alternative. Hidden-by-group layers remain enabled and exported.",
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
        creation: { op: "add_native_field", requiresTemplateField: false },
        ...(field.note ? { note: field.note } : {}),
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
