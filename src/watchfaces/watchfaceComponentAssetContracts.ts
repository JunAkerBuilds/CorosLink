import { batteryStateMeaning, COROS_BATTERY_STATE_ORDER } from "./watchfaceBatteryStates";
import type { CorosWatchfaceDesignState, CorosWatchfaceResolutionDetails } from "../../electron/types";
import {
  WATCHFACE_TIME_PARTS, WATCHFACE_DATE_PARTS, WATCHFACE_FIXED_METRICS,
  corosMonthLabelForSpriteIndex, listWatchfaceConfigAssets
} from "./watchfaceStudio";
import { WEATHER_ASSET_COUNTS, WEATHER_ICON_SETS, WEATHER_TEMPERATURE_SETS } from "./weatherAssets";
import { describeNativeDataComponents } from "./nativeDataAutomation";
import { nativeLayerHiddenByChartGroup } from "./nativeData";

const digits = Array.from({ length: 10 }, (_, index) => String(index));
const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Compact role-aware asset inventory; no bitmap payloads or guessed firmware meanings. */
export function watchfaceComponentAssetContracts(
  resolution: CorosWatchfaceResolutionDetails | null,
  design: CorosWatchfaceDesignState,
  mode: "current" | "aod"
): Array<Record<string, unknown>> {
  const root = mode === "aod" ? "/design/modeDesigns/aod" : "/design";
  const config = resolution?.config ?? {};
  const folders = resolution?.spriteFolders ?? [];
  const frame = resolution ? { directory: resolution.directory, width: resolution.width, height: resolution.height } : null;
  const folderFor = (key: string) => folders.find(folder => folder.folder === config[key]?.replace(/\\/g, "/"));
  const result: Array<Record<string, unknown>> = [];

  // Expose each physical set once; components refer to these folder names.
  // Preserve file array ordering, which is the order the importer/exporter uses.
  for (const folder of folders) {
    const keys = Object.keys(config).filter(key => config[key]?.replace(/\\/g, "/") === folder.folder);
    if (!keys.length) continue;
    const isCorosBattery = folder.kind === "state" && folder.files.length === 12 && keys.some(key => key === "battery_icon_dir" || key === "control_battery_icon_dir");
    const first = folder.files[0];
    const uniform = folder.files.every(file => file.width === first?.width && file.height === first?.height);
    result.push({
      id: `template:${folder.folder}`, kind: "template-sprite-set", mode, configKeys: keys,
      templateFolder: folder.folder, sourceDirectory: resolution?.directory, spriteCount: folder.files.length,
      sourceSize: uniform && first ? { width: first.width, height: first.height } : null,
      frames: folder.files.map((file, index) => ({
        index: String(index), file: file.path.split("/").at(-1),
        meaning: isCorosBattery ? batteryStateMeaning(folder.files.length, index) : folder.kind === "digits" && index < 10 ? String(index)
          : folder.kind === "week" && index < 7 ? weekdays[index]
          : folder.kind === "month" && index < 12 ? corosMonthLabelForSpriteIndex(index) : null,
        ...(!uniform ? { width: file.width, height: file.height } : {})
      })),
      ordering: isCorosBattery ? COROS_BATTERY_STATE_ORDER : folder.kind === "state" ? "Exact template file order. Meanings are unknown unless a specialized component contract defines them; inspect existing assets and preserve indices."
        : folder.kind === "month" ? "00=DEC, 01=JAN through 11=NOV; retain the template language."
        : folder.kind === "week" ? "00=Monday through 06=Sunday; retain the template language."
        : "Digit index 0–9; any extra frames have unknown firmware semantics.",
      installation: "Use the component-specific contract below. A source folder path is not a JSON edit path; arbitrary folders do not have a generic state replacement command."
    });
  }

  const typography = (id: string, label: string, path: string, keys: string[], labels: string[], kind: string) => {
    const sets = [...new Set(keys.map(key => folderFor(key)?.folder).filter(Boolean))];
    result.push({
      id: `typography:${id}`, layerId: id === "control" ? "complication" : id, label, kind, mode, spriteCount: labels.length,
      stateIndices: labels.map((_, index) => String(index)), orderedValues: labels, configKeys: keys,
      templateFolders: sets, templateKnown: sets.length > 0,
      countSource: "The editor's complete live typography set. Physical template folder counts are listed separately.",
      rasterFontPath: `${root}${path}/rasterFont`, editRasterFontPath: `/design${path}/rasterFont`,
      fontFamilyPath: `${root}${path}/fontFamily`,
      imageValueShape: "rasterFont.dataUrl is a PNG assetId; glyphs defines row-major atlas character order, columns defines the grid. sprites/labels can map exact characters or labels to individual PNG assetIds.",
      installation: "Fetch get_schema section:document for rasterFont. Include all required characters/labels, not just the preview reading. Clear the applicable fontFamily override so the renderer uses rasterFont. Atlas glyph order is declared by glyphs; do not confuse it with firmware label-file order.",
      ordering: kind === "weekday-labels" ? "Firmware order Monday through Sunday. Supply all seven labels or every glyph needed to compose them."
        : kind === "month-labels" ? "Firmware order DEC, JAN, FEB, MAR, APR, MAY, JUN, JUL, AUG, SEP, OCT, NOV; an atlas may use a different declared glyph order."
        : "Complete digits 0 through 9. Punctuation and units are separate components unless the selected raster font explicitly includes them.",
      referenceFrame: frame
    });
  };
  typography("autoTime", "Auto-aligned time", "/timeStyles/autoTime", ["autoalign_time_font"], digits, "digit-font");
  for (const part of WATCHFACE_TIME_PARTS) typography(part.id, part.label, `/timeStyles/${part.id}`, part.digits.map(digit => digit.fontKey), digits, "digit-font");
  for (const part of WATCHFACE_DATE_PARTS) {
    const style = design.dateStyles?.[part.id];
    const monthLabels = part.id === "dateMonth" && (style?.monthFormat === "labels" || (style?.monthFormat !== "digits" && folderFor(part.fontKey)?.kind === "month"));
    const values = part.id === "weekday" ? weekdays : monthLabels ? Array.from({ length: 12 }, (_, i) => corosMonthLabelForSpriteIndex(i)!) : digits;
    typography(part.id, part.id, `/dateStyles/${part.id}`, [part.fontKey], values, part.id === "weekday" ? "weekday-labels" : monthLabels ? "month-labels" : "digit-font");
  }
  for (const metric of WATCHFACE_FIXED_METRICS) typography(metric.id, metric.label, `/metricStyles/${metric.id}`, metric.fontKey ? [metric.fontKey] : [], digits, "digit-font");
  const controlKeys = Object.keys(config).filter(key => /^control_.*font$/.test(key));
  typography("control", "Selectable metric digits", "/selectableMetricStyle", controlKeys, digits, "digit-font");

  for (const set of [...WEATHER_ICON_SETS, ...WEATHER_TEMPERATURE_SETS]) {
    const count = WEATHER_ASSET_COUNTS[set.set];
    result.push({
      id: `weather:${set.set}`, layerId: "weather", kind: "weather-assets", mode,
      label: set.label, enabled: design.weatherIndicator?.enabled === true && (["day", "night"].includes(set.set) || design.weatherIndicator.temperatureEnabled !== false), spriteCount: count, countSource: "Studio weather component exporter (not an inferred template count)",
      stateIndices: Array.from({ length: count }, (_, i) => String(i)),
      orderedValues: set.set === "digits" ? digits : set.set === "symbols" ? ["minus", "degree"] : set.set === "units" ? ["°C", "°F"] : null,
      assetsPath: `${root}/weatherIndicator/assets/${set.set}`, editAssetsPath: `/design/weatherIndicator/assets/${set.set}`,
      imageValueShape: "assets[stateIndex] = {assetId}; state keys are unpadded strings.",
      ordering: set.set === "day" || set.set === "night" ? "Conditions 00–40 in COROS order. Same index addresses the matching day/night condition. Human weather names are not established in the catalog: inspect the official/original state images, preserve all indices, never guess a sunny/cloudy order." : set.hint,
      replacementBehavior: "Missing overrides use bundled defaults; one overridden state is not a complete custom set.",
      verification: set.set === "day" || set.set === "night" ? {
        tool: "render_preview", supported: true, scope: "editor-state-selection",
        scenarios: [0, Math.floor(count / 2), count - 1].map(condition => ({ scenario: { weather: { condition, night: set.set === "night" } }, expectedPreviewStateIndex: String(condition) })),
        note: "Verify each requested day/night set separately. Conditions are indices; their human/firmware meanings remain unverified."
      } : { tool: "render_preview", supported: false, limitation: "Temperature glyphs are composed text, not condition states. Unit alternatives are not selectable in the preview; do not claim dynamic state verification for these sets." }
    });
  }

  // The same native component descriptions serve schema lookup and the live inventory.
  for (const [id, style] of Object.entries(design.nativeData ?? {})) {
    for (const component of describeNativeDataComponents(id, style)) {
      const path = (value: string) => mode === "aod" ? value.replace(/^\/design/, root) : value;
      result.push({
        ...component, id: `native:${id}:${component.id}`, layerId: `native:${id}`, mode,
        kind: component.assetRole ? "native-component-assets" : "native-graph",
        enabled: style.enabled && component.effectiveStyle.enabled && !nativeLayerHiddenByChartGroup(id, design.nativeData ?? {}),
        hiddenByChartGroup: nativeLayerHiddenByChartGroup(id, design.nativeData ?? {}),
        ...("assetsPath" in component ? { assetsPath: path(component.assetsPath), editAssetsPath: component.assetsPath } : {}),
        stylePath: path(component.stylePath), editStylePath: component.stylePath,
        ...("textPath" in component ? { textPath: path(component.textPath), editTextPath: component.textPath } : {}),
        ...("chartStylePath" in component ? { chartStylePath: path(component.chartStylePath), editChartStylePath: component.chartStylePath } : {}),
        imageValueShape: "assets[role][index] = {assetId}. Native digits use per-index PNGs, not a rasterFont object. Missing states use defaults."
      });
    }
  }

  if (resolution) {
    // DIY templates declare the analog keys blank, so they are not listed as
    // template PNGs, yet a replacement override alone adds the hand.
    const templateHands = new Set(Object.keys(config).filter(key => /\.png$/i.test(config[key]?.trim() ?? "")));
    for (const [configKey, label, layerId] of [
      ["time_hour_icon", "Analog hour hand", "analogHour"], ["time_minute_icon", "Analog minute hand", "analogMinute"],
      ["time_second_icon", "Analog second hand", "analogSecond"], ["time_center_polygon_icon2", "Analog center cap", null]
    ] as const) {
      if (templateHands.has(configKey)) continue;
      const id = `config:${configKey}`;
      const override = design.configAssetOverrides?.[id];
      result.push({
        id, label, ...(layerId ? { layerId } : {}), kind: layerId ? "rotating-sprite" : "single-image", mode, configKey, spriteCount: 1,
        templateKnown: false, added: Boolean(override?.enabled && override.replacement),
        overridePath: `${root}/configAssetOverrides/${pointer(id)}`, editOverridePath: `/design/configAssetOverrides/${pointer(id)}`,
        imageValueShape: "{enabled:true, replacement:{dataUrl:{assetId},width,height}} merged into /design/configAssetOverrides; width/height in master pixels.",
        behavior: layerId
          ? "Adds a live analog hand. Firmware rotates the whole PNG around its center, so draw the hand pointing at 12 with the pivot exactly at the image center (extend a counterweight or transparent padding below so the canvas stays symmetric). Hour ≈25%, minute ≈39%, second ≈43% of face width from pivot to tip. All hands share one pivot (time_center_pos, default screen center); moving any hand layer moves that shared center. Always-on refreshes once a minute: give AOD hour and minute hands but no second hand."
          : "Fixed cap drawn at the shared hand pivot, covering where the hands meet. Square PNG centered on the pivot."
      });
    }
    for (const asset of listWatchfaceConfigAssets({ archiveId: "", resolutions: [resolution] }, resolution.directory).filter(asset => asset.scope === "config")) {
      result.push({
        id: asset.id, label: asset.label, typography: /colon/.test(asset.configKey), ...(/colon/.test(asset.configKey) ? { layerId: asset.configKey.startsWith("control_") ? "complication" : "separators", enabled: asset.configKey.startsWith("control_") || !design.staticSeparators?.colon?.enabled } : {}), kind: /^time_(hour|minute|second)_icon$/.test(asset.configKey) ? "rotating-sprite" : "single-image",
        mode, configKey: asset.configKey, spriteCount: 1, sourcePath: asset.archivePath,
        sourceSize: asset.source ? { width: asset.source.width, height: asset.source.height } : null,
        replacementPath: `${root}/configAssetOverrides/${pointer(asset.id)}/replacement`,
        editReplacementPath: `/design/configAssetOverrides/${pointer(asset.id)}/replacement`,
        imageValueShape: "replacement = {dataUrl:{assetId},width,height}; dimensions describe the authored PNG.",
        behavior: /^time_(hour|minute|second)_icon$/.test(asset.configKey) ? "One hand image; firmware rotates it using live time. Do not generate one frame per angle."
          : /bluetooth|disturb|touch_lock/.test(asset.configKey) ? "One conditional status image for this exact config key; retain separate on/off keys present in the template."
          : "One image for this slot. Decorations and masks do not supply live values or progress by themselves."
      });
    }
  }
  result.push({
    id: "background", kind: "background-artwork", mode, spriteCount: 1,
    artworkPath: `${root}/artwork`, editArtworkPath: "/design/artwork",
    imageValueShape: "artwork = {dataUrl:{assetId},width,height}; retain authored source dimensions.",
    behavior: "Static background only. Keep live digits, conditional icons, progress and state sets in their own component slots."
  });
  for (const id of ["colon", "dateSlash"]) result.push({
    id: `separator:${id}`, layerId: id === "colon" ? "staticColon" : "staticDateSlash", enabled: design.staticSeparators?.[id as "colon" | "dateSlash"]?.enabled === true, kind: "drawn-separator", mode, spriteCount: 0,
    propertiesPath: `${root}/staticSeparators/${id}`, editPropertiesPath: `/design/staticSeparators/${id}`,
    behavior: "Editor-drawn punctuation. Template PNG separator slots, when present, have their own single-image replacement contracts."
  });
  result.push({
    id: "ampm", layerId: "ampm", enabled: design.ampmIndicator?.enabled === true, kind: "paired-labels", mode, spriteCount: 2, orderedValues: ["AM", "PM"],
    rasterFontPath: `${root}/ampmIndicator/rasterFont`, fontFamilyPath: `${root}/ampmIndicator/fontFamily`,
    configKeys: ["am_icon", "pm_icon"], propertiesPath: `${root}/ampmIndicator`,
    installation: "Install ampmIndicator.rasterFont with both AM and PM labels (or all required glyphs), and clear its fontFamily override. The live indicator selects the label by time. Config image overrides do not replace the Studio-generated label copies.",
    templateKnown: Boolean(config.am_icon && config.pm_icon)
  });
  for (const id of ["kcalProgress", "exerciseProgress"]) result.push({
    id, kind: "live-progress", mode, spriteCount: 0,
    propertiesPath: `${root}/${id}`, editPropertiesPath: `/design/${id}`,
    behavior: "Firmware draws the live bar/arc from numeric parameters. Background tracks and cut masks are optional separate static images; a generated ring is not live progress.",
    verification: "Fetch get_geometry for arc/bar placement, read get_schema section:document for supported fields, then preview low/middle/high metric scenarios."
  });
  for (const [index, sprite] of (design.designSprites ?? []).entries()) result.push({
    id: `sprite:${sprite.id}`, kind: "decorative-image", mode, spriteCount: 1,
    imagePath: `${root}/designSprites/${index}/dataUrl`, sourceSize: { width: sprite.sourceWidth, height: sprite.sourceHeight },
    behavior: "A standalone static image, not a firmware-selected state set. Use update_sprite with this sprite id."
  });
  for (const [index, element] of (design.backgroundElements ?? []).entries()) result.push({
    id: `bgel:${element.id}`, layerId: `bgel:${element.id}`, kind: "drawn-element", elementKind: element.kind, mode, spriteCount: 0,
    elementPath: `${root}/backgroundElements/${index}`,
    behavior: "Editor-drawn text or geometry; edit with update_element. Any text here is static, not live watch data."
  });
  return result;
}
