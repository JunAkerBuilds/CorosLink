import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceNativeAssetRole,
  CorosWatchfaceNativeDataStyle,
  CorosWatchfaceSpriteFile,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_FIELDS, nativeStatePositionKey } from "../../electron/watchfaceNativeCatalog";
import { parseConfigPos, parseConfigRect, pickPreviewResolution } from "./watchfaceStudio";
import { getWeatherCapability } from "./weatherAssets";

/** Hydrate original sprites instead of the editor's generated weather/data defaults. */
export async function recoverWatchfaceDesign(
  details: CorosWatchfaceTemplateDetails,
  loadAssets: (paths: string[]) => Promise<CorosWatchfaceTemplateAsset[]>
): Promise<Pick<CorosWatchfaceDesignState, "weatherIndicator" | "nativeData"> & Partial<Pick<CorosWatchfaceDesignState, "backgroundColor">>> {
  const resolution = pickPreviewResolution(details);
  if (!resolution) return {};
  const { config } = resolution;
  const files = [...resolution.icons, ...resolution.spriteFolders.flatMap(folder => folder.files)];
  const source = (key: string): CorosWatchfaceSpriteFile[] => {
    const relative = config[key]?.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!relative) return [];
    const path = `${resolution.directory}/${relative}`;
    return files.filter(file => file.path === path || file.path.startsWith(`${path}/`))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  };
  const loaded = new Map<string, CorosWatchfaceTemplateAsset>();
  const sprites = async (key: string): Promise<Record<string, string>> => {
    const selected = source(key);
    const missing = selected.filter(file => !loaded.has(file.path));
    if (missing.length) for (const asset of await loadAssets(missing.map(file => file.path))) loaded.set(asset.path, asset);
    return Object.fromEntries(selected.flatMap((file, index) => {
      const asset = loaded.get(file.path);
      return asset ? [[String(index), asset.dataUrl]] : [];
    }));
  };
  const capability = getWeatherCapability(details);
  const weatherFile = source("weather_icon_dir")[0];
  const weatherIndicator = capability && weatherFile ? {
    enabled: capability.active,
    ...capability.defaultPos,
    scale: weatherFile.width / capability.size.width,
    // The recovered temperature has its own geometry, below or beside the icon.
    temperatureEnabled: false,
    assets: { day: await sprites("weather_icon_dir"), night: await sprites("weather_dark_icon_dir") }
  } : { enabled: false, x: 0, y: 0, scale: 1, temperatureEnabled: false };
  const nativeData: Record<string, CorosWatchfaceNativeDataStyle> = {};
  const positionedIcons = new Set<string>();
  for (const field of NATIVE_DATA_FIELDS) {
    if (field.kind !== "number") continue;
    const rect = parseConfigRect(config[`${field.id}_rect`]);
    const font = source(`${field.id}_font`)[0];
    const hasValue = Boolean(rect && font && rect.x1 > rect.x0 && rect.y1 > rect.y0);
    const iconPosition = source(`${field.id}_icon`).length
      ? parseConfigPos(config[`${field.id}_icon_pos`]) : null;
    const statePosition = field.stateKey && source(field.stateKey).length
      ? parseConfigPos(config[`${field.id}_level_pos`]) : null;
    // Level artwork can stand alone (DASHBOARD's UV arc has no numeric readout).
    if (!hasValue && !statePosition) continue;
    const anchor = hasValue ? rect! : statePosition ?? iconPosition!;
    const anchorX = "x0" in anchor ? anchor.x0 : anchor.x, anchorY = "y0" in anchor ? anchor.y0 : anchor.y;
    // Native parts use nonnegative offsets. Anchor the group at its upper-left
    // so an icon to the left/above its value remains valid and keeps its position.
    const origin = {
      x: Math.min(anchorX, iconPosition?.x ?? anchorX, statePosition?.x ?? anchorX),
      y: Math.min(anchorY, iconPosition?.y ?? anchorY, statePosition?.y ?? anchorY)
    };
    const assets: CorosWatchfaceNativeDataStyle["assets"] = hasValue ? { digits: await sprites(`${field.id}_font`) } : {};
    const parts: NonNullable<CorosWatchfaceNativeDataStyle["parts"]> = {
      value: hasValue ? { x: rect!.x0 - origin.x, y: rect!.y0 - origin.y, width: rect!.x1 - rect!.x0, height: font!.height,
        digitWidth: font!.width, align: /\bright\b/.test(config[`${field.id}_rect`]) ? "right" : /\bhcenter\b/.test(config[`${field.id}_rect`]) ? "center" : "left" } : { enabled: false },
      icon: { enabled: false }, unit: { enabled: false }, symbols: { enabled: false }
    };
    const addPart = async (role: CorosWatchfaceNativeAssetRole, key: string) => {
      const file = source(key)[0];
      if (!file) return;
      assets[role] = await sprites(key);
      const pos = role === "icon" ? iconPosition : role === "states" ? statePosition : null;
      parts[role === "digits" ? "value" : role] = {
        enabled: true, width: file.width, height: file.height,
        x: pos ? pos.x - origin.x : 0, y: pos ? pos.y - origin.y : 0
      };
    };
    await addPart("icon", `${field.id}_icon`);
    if (iconPosition && parts.icon?.enabled) {
      const key = `${config[`${field.id}_icon`]}:${iconPosition.x},${iconPosition.y}`;
      // Daily and weekly totals can share one icon at exactly the same spot.
      if (positionedIcons.has(key)) parts.icon.enabled = false;
      else positionedIcons.add(key);
    }
    if (field.stateKey && statePosition) await addPart("states", field.stateKey);
    const unitKey = field.percentKey ?? field.unitKey ?? (field.id === "weather_temp" ? "weather_dgree_icon" :
      field.id.startsWith("weather_temp_") ? "weather_temp_max_min_dgree_icon" : "");
    if (unitKey && hasValue) await addPart("unit", unitKey);
    if (field.id.startsWith("weather_temp") && hasValue) await addPart("symbols",
      field.id === "weather_temp" ? "weather_negasign_icon" : "weather_temp_max_min_negasign_icon");
    nativeData[field.id] = { enabled: true, ...origin, scale: 1, color: "#ffffff", parts, assets,
      ...(assets.states ? { stateCount: Object.keys(assets.states).length } : {}) };
  }
  // State tables (wind direction) keep the original frame count: official
  // NOMAD ships eight compass points where the catalog default assumes sixteen.
  for (const field of NATIVE_DATA_FIELDS) {
    if (field.kind !== "state" || !field.stateKey) continue;
    const file = source(field.stateKey)[0];
    const position = parseConfigPos(config[nativeStatePositionKey(field)]);
    if (!file || !position) continue;
    const states = await sprites(field.stateKey);
    nativeData[field.id] = { enabled: true, ...position, scale: 1, color: "#ffffff", stateCount: Object.keys(states).length,
      parts: { states: { enabled: true, x: 0, y: 0, width: file.width, height: file.height } }, assets: { states } };
  }
  const chart = await recoverChart(config, source, sprites);
  if (chart) nativeData.chart = chart;
  // Official faces keep alternatives in one slot: wind beside min/max
  // temperature, and NOMAD's solar angle over the weather temperature. With a
  // chart layer the watch cycles them by chart group (COROS documents the
  // groups), the preview follows that group, and every alternative stays
  // enabled so the export keeps them. Without a chart there is no group to
  // follow: start with wind and the temperature, keep the rest as disabled layers.
  if (!nativeData.chart?.enabled) {
    const windRect = parseConfigRect(config.weather_wind_rect);
    if (nativeData.weather_wind?.enabled && windRect && config.weather_direction_icon_dir) {
      for (const id of ["weather_temp_min", "weather_temp_max"]) {
        const rect = parseConfigRect(config[`${id}_rect`]);
        if (nativeData[id] && rect && overlaps(rect, windRect)) nativeData[id].enabled = false;
      }
    }
    const angleRect = parseConfigRect(config.chart_sun_angle_rect), temperatureRect = parseConfigRect(config.weather_temp_rect);
    if (nativeData.chart_sun_angle && nativeData.weather_temp?.enabled && angleRect && temperatureRect && overlaps(angleRect, temperatureRect)) {
      nativeData.chart_sun_angle.enabled = false;
    }
  }
  return { weatherIndicator, nativeData, backgroundColor: config.bg_color?.replace(/^0x/i, "#") ?? "#000000" };
}

type Rect = NonNullable<ReturnType<typeof parseConfigRect>>;
function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * Rebuild the editor's single-source chart layer from a recovered WFChartInfo.
 * The watch cycles chart groups at runtime; every recovered readout stays in
 * the project's config text, and the layer starts on the group the official
 * thumbnail shows (sunrise/sunset first), keeping the original graph artwork.
 */
async function recoverChart(config: Record<string, string>, source: (key: string) => CorosWatchfaceSpriteFile[],
  sprites: (key: string) => Promise<Record<string, string>>): Promise<CorosWatchfaceNativeDataStyle | null> {
  const plot = parseConfigRect(config.chart_rect);
  if (!plot || plot.x1 <= plot.x0 || plot.y1 <= plot.y0) return null;
  const rectKey = (id: string) => ["chart_sunrise", "chart_moonrise"].includes(id) ? `${id}_hour_rect` : `${id}_rect`;
  const chartSource = ["chart_sunrise", "chart_moonrise", "chart_baro", "chart_tide", "chart_stress", "chart_stamina", "chart_step", "chart_kcal", "chart_elevation", "chart_moon_percent", "chart_sun_angle", "chart_moon"]
    .find(id => id === "chart_moon" ? source("chart_moon_icon").length > 0 : Boolean(parseConfigRect(config[rectKey(id)]) && source(`${id}_font`).length));
  if (!chartSource || !NATIVE_CHART_SOURCES.some(item => item.id === chartSource)) return null;
  const moon = chartSource === "chart_moon", isTime = ["chart_sunrise", "chart_moonrise"].includes(chartSource);
  const iconKey = moon ? "chart_moon_icon" : `${chartSource}_icon`, iconFile = source(iconKey)[0];
  const iconPosition = iconFile ? parseConfigPos(config[moon ? "chart_moon_icon_pos" : `${chartSource}_icon_pos`]) : null;
  const valueRect = moon ? null : parseConfigRect(config[rectKey(chartSource)]);
  const minuteRect = isTime ? parseConfigRect(config[`${chartSource}_minute_rect`]) : null;
  const font = moon ? null : source(`${chartSource}_font`)[0];
  const artwork = { background: ["chart_bg", "chart_pos"], mask: ["chart_bar_mask", "chart_bar_mask_pos"], noDataMask: ["chart_bar_nodata_mask", "chart_bar_nodata_mask_pos"] } as const;
  const placed = (Object.entries(artwork) as [keyof typeof artwork, readonly [string, string]][])
    .flatMap(([role, [key, posKey]]) => { const file = source(key)[0], position = parseConfigPos(config[posKey]); return file && position ? [{ role, key, file, position }] : []; });
  // Native parts use nonnegative offsets: anchor the layer at the upper-left of everything it draws.
  const xs = [plot.x0, valueRect?.x0, iconPosition?.x, ...placed.map(p => p.position.x)].filter((n): n is number => n !== undefined && n !== null);
  const ys = [plot.y0, valueRect?.y0, iconPosition?.y, ...placed.map(p => p.position.y)].filter((n): n is number => n !== undefined && n !== null);
  const origin = { x: Math.min(...xs), y: Math.min(...ys) };
  const assets: CorosWatchfaceNativeDataStyle["assets"] = {};
  const parts: NonNullable<CorosWatchfaceNativeDataStyle["parts"]> = {
    plot: { enabled: true, x: plot.x0 - origin.x, y: plot.y0 - origin.y, width: plot.x1 - plot.x0, height: plot.y1 - plot.y0 },
    icon: { enabled: false }, value: { enabled: false }, states: { enabled: false }, symbols: { enabled: false }, decimal: { enabled: false },
    background: { enabled: false }, mask: { enabled: false }, noDataMask: { enabled: false }
  };
  for (const { role, key, file, position } of placed) {
    assets[role] = await sprites(key);
    parts[role] = { enabled: true, x: position.x - origin.x, y: position.y - origin.y, width: file.width, height: file.height };
  }
  if (iconFile && iconPosition) {
    const role = moon ? "states" : "icon";
    assets[role] = await sprites(iconKey);
    // Sunrise/sunset and moonrise/moonset keep their second icon as state 1.
    const setKey = chartSource === "chart_sunrise" ? "chart_sunset_icon" : chartSource === "chart_moonrise" ? "chart_moonset_icon" : "";
    if (setKey && source(setKey).length) assets.icon = { ...assets.icon, 1: (await sprites(setKey))[0] };
    parts[role] = { enabled: true, x: iconPosition.x - origin.x, y: iconPosition.y - origin.y, width: iconFile.width, height: iconFile.height };
  }
  if (font && valueRect) {
    assets.digits = await sprites(`${chartSource}_font`);
    const rectText = config[rectKey(chartSource)];
    // The editor splits one time rectangle into hour/minute halves around the
    // colon; keep the recovered hour width and gap so the export matches.
    parts.value = { enabled: true, x: valueRect.x0 - origin.x, y: valueRect.y0 - origin.y, height: font.height, digitWidth: font.width,
      width: (valueRect.x1 - valueRect.x0) * (minuteRect ? 2 : 1),
      align: /\bright\b/.test(rectText) ? "right" : /\bhcenter\b/.test(rectText) ? "center" : "left" };
    const symbolKeys = ["chart_negasign_icon", "chart_dgree_icon", "chart_percent_icon", "chart_colon_icon"];
    const symbols: Record<string, string> = {};
    for (const [index, key] of symbolKeys.entries()) { const url = (await sprites(key))[0]; if (url) symbols[index] = url; }
    const colon = source("chart_colon_icon")[0], symbol = colon ?? symbolKeys.map(key => source(key)[0]).find(Boolean);
    if (symbol) {
      assets.symbols = symbols;
      parts.symbols = { enabled: true, width: minuteRect && colon ? Math.max(colon.width, minuteRect.x0 - valueRect.x1) : symbol.width, height: symbol.height };
    }
    const point = source("chart_point_icon")[0];
    if (point) { assets.decimal = await sprites("chart_point_icon"); parts.decimal = { enabled: true, width: point.width, height: point.height }; }
  }
  const color = (key: string, fallback: string) => /^0x[0-9a-f]{6}$/i.test(config[key] ?? "") ? `#${config[key].slice(2).toLowerCase()}` : fallback;
  // The preview's curve marker uses the plot color; match it to the curve.
  parts.plot = { ...parts.plot, color: color("chart_curves_upper_color", "#ffffff") };
  return {
    enabled: true, ...origin, scale: 1, color: "#ffffff", chartSource, chartWidth: plot.x1 - plot.x0, chartHeight: plot.y1 - plot.y0, parts, assets,
    chartStyle: {
      barWidth: Number(config.chart_bar_width) || 8, barGap: Number.isFinite(Number(config.chart_bar_interval)) && config.chart_bar_interval !== undefined ? Number(config.chart_bar_interval) : 4,
      selectedBarColor: color("chart_selected_bar_color", "#ffffff"), unselectedBarColor: color("chart_unselected_bar_color", "#555555"),
      upperColor: color("chart_curves_upper_color", "#ffffff"), lowerColor: color("chart_curves_lower_color", "#555555"),
      lineWidth: Number(config.chart_curves_width) || 2,
      previewType: ["chart_sunrise", "chart_moonrise", "chart_baro", "chart_tide"].includes(chartSource) ? "curve" : "bars"
    }
  };
}
