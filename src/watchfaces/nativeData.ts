import type { CorosWatchfaceAssetReplacement, CorosWatchfaceConfigOverride, CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceResolutionDetails, CorosWatchfaceTemplateDetails } from "../../electron/types";
import type { ChartPageCompanions } from "./recoveredWatchfaceDesign";
import { NATIVE_CHART_DAILY_PAGES, NATIVE_CHART_PAGES, NATIVE_CHART_SHARED_KEYS, NATIVE_CHART_SOURCES, NATIVE_DATA_BY_ID, nativeChartDailyPage, nativeChartGroup, nativeChartRepresentation, nativeChartSourceKeys, nativeFieldKeys, nativeConfigPrefix, nativeHasIcon, nativeStatePositionKey } from "../../electron/watchfaceNativeCatalog";
import { COROS_CONFIG_DELETE_VALUE, loadStudioImage, offsetConfigValue, parseConfigPos, parseConfigRect, pickPreviewResolution, resizeAndTintSprite } from "./watchfaceStudio";
import { isNativeTime, nativeAssetText, nativePart, nativePartHasPosition, nativeParts, nativeRolePart, nativeRoleIndices, nativeStateCount } from "./nativeDataParts";
import { chartGraphBounds, chartPageFillers, chartReadoutBounds, chartReadoutFolder, chartReadoutPage, chartSourceOf, storedChartReadouts } from "./chartReadouts";
import { parseSimulationDateTime, type WatchfacePreviewScenario } from "./watchfaceSimulation";
import { fillWatchfaceText, setWatchfaceCanvasFont } from "./watchfaceFontSnapshots";
export { NATIVE_CHART_SOURCES, NATIVE_DATA_FIELDS, NATIVE_DATA_BY_ID } from "../../electron/watchfaceNativeCatalog";
export type NativeData = Record<string, Style>;
export { defaultNativeDataStyle } from "./nativeDataParts";

/** Finalize absolute native year coordinates after control layout and visibility.
 * COROS SetControl skips every child, including year, without a control origin.
 * The year is an independent editor layer even though it shares that container.
 */
export function finalizeNativeControlOverrides(
  details: CorosWatchfaceTemplateDetails,
  overrides: CorosWatchfaceConfigOverride[],
  data: NativeData = {},
  selectableHidden = false
): CorosWatchfaceConfigOverride[] {
  const year = data.date_year;
  if (!year?.enabled || !nativePart("date_year", year, "value").enabled) return overrides;
  const yearKeys = new Set(nativeFieldKeys(NATIVE_DATA_BY_ID.get("date_year")!));
  return overrides.map(override => {
    const resolution = details.resolutions.find(item => `${item.directory}/config.txt` === override.path);
    const yearRect = override.values.control_number_date_year_rect;
    if (!resolution || !yearRect || yearRect === COROS_CONFIG_DELETE_VALUE) return override;
    const values = { ...override.values };
    const effective = { ...resolution.config, ...values };
    const originKey = Object.keys(effective).find(key => /^rect_control\d+_pos$/.test(key)) ?? "rect_control1_pos";
    const origin = selectableHidden ? null : parseConfigPos(effective[originKey]);
    if (selectableHidden) {
      // Restoring the container must not revive the metric the user hid.
      for (const key of Object.keys(effective)) {
        if (key.startsWith("control_") && !yearKeys.has(key)) values[key] = COROS_CONFIG_DELETE_VALUE;
      }
    }
    if (!origin) values[originKey] = "{0,0}";
    values.control_number_date_year_rect = offsetConfigValue(yearRect, -(origin?.x ?? 0), -(origin?.y ?? 0))!;
    return { ...override, values };
  });
}

export function nativeDataPreviewValue(id: string, style: Style, scenario?: WatchfacePreviewScenario): string {
  if (id === "date_year") return String((scenario?.dateTime ? parseSimulationDateTime(scenario.dateTime) : new Date()).getFullYear());
  const sample = scenario?.values?.[id === "chart" ? style.chartSource ?? "chart_stress" : id] ?? scenario?.values?.[id];
  if (sample !== undefined) return sample;
  if (style.previewValue !== undefined) return style.previewValue;
  if (isNativeTime(id, style)) return "06:24";
  if (id === "chart" && style.chartSource === "chart_moon") return "7";
  return NATIVE_DATA_BY_ID.get(id)?.sample ?? "0";
}
/** The value's glyphs and where they start inside the value part, in part units. */
function nativeValueRun(id: string, style: Style, scenario?: WatchfacePreviewScenario) {
  const digits = nativePart(id, style, "value");
  const characters = nativeDataPreviewValue(id, style, scenario).slice(0, isNativeTime(id, style) ? 5 : 6);
  const width = [...characters].reduce((sum, char) => sum + (/\d/.test(char) ? digits.digitWidth : char === "." ? nativePart(id, style, "decimal").width : nativePart(id, style, "symbols").width), 0);
  return { characters, width, x: digits.x + (digits.align === "right" ? digits.width - width : digits.align === "center" ? (digits.width - width) / 2 : 0) };
}

export interface MinMaxTemperatureRun {
  /** The maximum's style, moved to where the watch draws it. */
  max: Style;
  /** Top-left corner and size, in master pixels. */
  separator: { x: number; y: number; width: number; height: number; visible: boolean };
}

/**
 * The watch draws minimum and maximum temperature as one reading: the minimum
 * in its own rectangle, then the separator, the maximum and a single unit,
 * each straight after the glyphs before it. A watch ignored the maximum's
 * rectangle (issue #131, 2026-09-27: "1327°C" at the minimum's position where
 * the editor showed 12°C and 24°C far apart), and every official face places
 * minimum, separator and maximum side by side. Null unless both are shown.
 */
export function minMaxTemperatureRun(data: NativeData, scenario?: WatchfacePreviewScenario): MinMaxTemperatureRun | null {
  const min = data.weather_temp_min, max = data.weather_temp_max;
  if (!min?.enabled || !max?.enabled) return null;
  const minValue = nativePart("weather_temp_min", min, "value"), maxValue = nativePart("weather_temp_max", max, "value");
  if (!minValue.enabled || !maxValue.enabled) return null;
  const text = nativeValueRun("weather_temp_min", min, scenario);
  const part = nativePart("weather_temp_min", min, "separator");
  const width = part.enabled ? part.width * min.scale : 0, height = part.height * min.scale;
  const x = min.x + (text.x + text.width) * min.scale;
  const middle = min.y + (minValue.y + minValue.height / 2) * min.scale;
  return {
    separator: { x, y: middle - height / 2, width, height, visible: part.enabled },
    max: { ...max,
      x: x + width - maxValue.x * max.scale,
      y: middle - (maxValue.y + maxValue.height / 2) * max.scale,
      // The maximum starts right after the separator whatever its own alignment.
      parts: { ...max.parts, value: { ...max.parts?.value, align: "left" } } }
  };
}

/** A layer's style where the watch draws it: with both shown, the maximum follows the minimum. */
export function nativeLayerStyle(id: string, data: NativeData, scenario?: WatchfacePreviewScenario): Style | undefined {
  return (id === "weather_temp_max" ? minMaxTemperatureRun(data, scenario)?.max : undefined) ?? data[id];
}

/** Editor bounds in master pixels; the minimum's box also covers the separator it draws. */
export function nativeDataBounds(id: string, data: NativeData) {
  const style = nativeLayerStyle(id, data);
  if (!style?.enabled) return null;
  if (id === "chart") {
    // The chart layer is the readout it edits, plus the graph on pages that draw one.
    const boxes = [chartReadoutBounds(style), chartGraphBounds(style)].flatMap(box => box ? [box] : []);
    return boxes.length ? { x0: Math.min(...boxes.map(box => box.x0)), y0: Math.min(...boxes.map(box => box.y0)), x1: Math.max(...boxes.map(box => box.x1)), y1: Math.max(...boxes.map(box => box.y1)) } : null;
  }
  const size = nativeDataSize(id, style);
  const separator = id === "weather_temp_min" ? minMaxTemperatureRun(data)?.separator : undefined;
  return {
    x0: style.x, y0: Math.min(style.y, separator?.y ?? Infinity),
    x1: Math.max(style.x + size.width, separator ? separator.x + separator.width : -Infinity),
    y1: Math.max(style.y + size.height, separator ? separator.y + separator.height : -Infinity)
  };
}

export function nativeDataSize(id: string, style: Style) {
  let width = 1, height = 1;
  for (const key of nativeParts(id, style)) {
    const part = nativePart(id, style, key);
    if (!part.enabled || !nativePartHasPosition(key)) continue;
    let partWidth = part.width;
    if (key === "value") {
      if (isNativeTime(id, style)) partWidth += nativePart(id, style, "symbols").width;
      if (nativeParts(id, style).includes("unit")) partWidth += nativePart(id, style, "unit").width;
    }
    width = Math.max(width, part.x + partWidth);
    height = Math.max(height, part.y + part.height);
  }
  return { width: width * style.scale, height: height * style.scale };
}

function canvasImage(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Native data sprite rendering is unavailable.");
  draw(context);
  return canvas.toDataURL("image/png");
}

/** The same sprite renderer feeds the editor, thumbnail and native export. */
export async function nativeDataAsset(id: string, style: Style, role: Role, index: number, scale = 1): Promise<string> {
  const part = nativePart(id, style, nativeRolePart(role));
  const width = (role === "digits" ? part.digitWidth : part.width) * scale;
  const height = part.height * scale;
  if (!part.enabled) return canvasImage(width, height, () => undefined);
  const replacement = style.assets?.[role]?.[String(index)];
  if (replacement) {
    // Keep an imported chart backdrop at native size without another canvas
    // pass, which can change edge pixels and transparent RGB channels.
    const image = id === "chart" && role === "background" ? await loadStudioImage(replacement) : null;
    if (image && image.naturalWidth === Math.round(width) && image.naturalHeight === Math.round(height)) return replacement;
    return resizeAndTintSprite(replacement, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }
  const text = nativeAssetText(id, style, role, index);
  return canvasImage(width, height, ctx => {
    ctx.fillStyle = part.color;
    if (text !== null) {
      const fontSize = Math.round(height * 0.75);
      // Quoted: an unquoted family such as "Bebas Neue 2" is invalid CSS, and the canvas would keep its default font.
      setWatchfaceCanvasFont(ctx, { family: part.fontFamily, size: fontSize }, `${fontSize}px "${part.fontFamily.replace(/["\\]/g, "")}"`);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      fillWatchfaceText(ctx, text, width / 2, height / 2, width);
    } else if (role === "states" && id === "weather_direction") {
      ctx.translate(width / 2, height / 2); ctx.rotate(index * Math.PI / 8);
      const r = Math.min(width, height) * 0.35;
      ctx.strokeStyle = part.color; ctx.lineWidth = Math.max(1, height / 16);
      ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(0, -r); ctx.lineTo(-r / 2, -r / 2);
      ctx.moveTo(0, -r); ctx.lineTo(r / 2, -r / 2); ctx.stroke();
    } else if (role === "states" && id === "chart") {
      const r = Math.min(width, height) * 0.42, cx = width / 2, cy = height / 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      const shift = (index < 15 ? index : index - 30) / 15 * r * 2;
      ctx.beginPath(); ctx.arc(cx + shift, cy, r, 0, Math.PI * 2); ctx.fill();
    } else if (role === "background") {
      ctx.fillRect(0, 0, width, height);
    }
  });
}

export function moonPhaseAsset(style: Style, phase: number, scale: number): Promise<string> {
  return nativeDataAsset("chart", { ...style, chartSource: "chart_moon" }, "states", phase, scale);
}

/** Frames in a COROS weather-condition table (`weather_icon_dir`). */
const WEATHER_CONDITION_FRAMES = 41;

/**
 * @param weatherIconEnabled The design's weather-indicator state; undefined
 * when the design leaves the template's own weather keys untouched.
 */
export async function composeNativeData(details: CorosWatchfaceTemplateDetails, data: NativeData = {}, weatherIconEnabled?: boolean) {
  const base = pickPreviewResolution(details);
  const assetReplacements: CorosWatchfaceAssetReplacement[] = [];
  const configOverrides: CorosWatchfaceConfigOverride[] = [];
  let minWatchFaceVersion = 0;
  if (!base) return { assetReplacements, configOverrides, minWatchFaceVersion };
  // The firmware shares min/max units and minus artwork. Use minimum when both
  // are enabled, so output is independent of object insertion order.
  const temperatureStyle = data.weather_temp_min?.enabled ? data.weather_temp_min : data.weather_temp_max;
  const run = minMaxTemperatureRun(data);
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    const ratio = resolution.width / base.width;
    const existing = new Set([...resolution.icons.map(file => file.path), ...resolution.spriteFolders.flatMap(folder => folder.files.map(file => file.path))]);
    const written = new Set<string>();
    // Clear every field's keys before writing any, so a later field's blanket
    // deletion (the chart owns all chart_* keys) cannot erase an earlier write.
    for (const [id, style] of Object.entries(data)) {
      const field = NATIVE_DATA_BY_ID.get(id);
      if (!field) throw new Error(`Unknown native data field: ${id}`);
      if (field.kind === "chart") {
        // The layer owns the shared graph and its selected readout. Readouts of
        // other chart groups already in the template (recovered official faces)
        // are alternatives the watch cycles through, so they stay; only this
        // editor's own earlier output for another source is cleared.
        for (const key of [...NATIVE_CHART_SHARED_KEYS, ...nativeChartSourceKeys(style.chartSource ?? "chart_stress")]) values[key] = COROS_CONFIG_DELETE_VALUE;
        // A readout in its own stored-readout folders came from an earlier
        // export of several readouts and nothing overwrites it.
        for (const { id: source } of NATIVE_CHART_SOURCES) {
          const own = new RegExp(`^${chartReadoutFolder(source)}(_[a-z]+)?(\\\\|$)`);
          if (nativeChartSourceKeys(source).some(key => { const value = resolution.config[key] ?? ""; return /^cl_nd_/.test(value) && !own.test(value) && !value.startsWith("cl_nd_blank_icon\\"); })) {
            for (const key of nativeChartSourceKeys(source)) values[key] = COROS_CONFIG_DELETE_VALUE;
          }
        }
        // Stored readouts are written below; template readouts made fixed leave their page.
        for (const source of [...Object.keys(style.readouts ?? {}), ...style.removedReadouts ?? []]) for (const key of nativeChartSourceKeys(source)) values[key] = COROS_CONFIG_DELETE_VALUE;
      } else for (const key of nativeFieldKeys(field)) values[key] = COROS_CONFIG_DELETE_VALUE;
      if (style.enabled) minWatchFaceVersion = Math.max(minWatchFaceVersion, field.version);
    }
    // The 4.9.9 parser reads each icon+value block only when its `_icon_pos`
    // key exists (LoadConfig 0x1e7e38 for stamina, 0x1e42a8 for UV, likewise
    // wind, rain, humidity, AQI, training load, stress, barometer, activity
    // totals and sunrise/sunset). A missing `_icon` key is skipped on its own,
    // so a hidden icon still writes the position, or the value never reaches
    // the watch. The chart helpers look every key up independently.
    // Every official humidity readout (and all but two UV ones) carries an
    // icon, blank where the face draws none. A converted SATISFY 3 whose
    // humidity and UV kept only the position showed neither value on a PACE
    // Pro while rainfall, with its icon, did (2026-09-26). So a hidden icon
    // becomes an invisible one rather than a missing key.
    const blankIcon = () => {
      const folder = "cl_nd_blank_icon", path = `${resolution.directory}/${folder}/00.png`;
      if (!written.has(path)) {
        written.add(path);
        assetReplacements.push({ path, dataUrl: canvasImage(1, 1, () => undefined), create: !existing.has(path), allowDimensionOverride: true });
      }
      return `${folder}\\00.png`;
    };
    /** A folder of transparent 1x1 frames: a font or state table that draws nothing. */
    const blankFrames = (folder: string, count: number) => {
      for (let i = 0; i < count; i++) {
        const path = `${resolution.directory}/${folder}/${String(i).padStart(2, "0")}.png`;
        if (written.has(path)) continue;
        written.add(path);
        assetReplacements.push({ path, dataUrl: canvasImage(1, 1, () => undefined), create: !existing.has(path), allowDimensionOverride: true });
      }
      return folder;
    };
    // The chart's stored readouts follow every field, each in its own folders.
    // A source another layer already shows (NOMAD's solar angle) stays with it.
    const chartReadouts = data.chart?.enabled ? storedChartReadouts(data.chart).filter(readout => !data[chartSourceOf(readout)]?.enabled) : [];
    let chartSymbolsWritten = false;
    for (const [id, authored, folderPrefix] of [
      ...Object.entries(data).map(([id, style]) => [id, style, undefined] as const),
      ...chartReadouts.map(readout => ["chart", readout, chartReadoutFolder(chartSourceOf(readout))] as const)
    ]) {
      const field = NATIVE_DATA_BY_ID.get(id)!;
      if (!authored.enabled) continue;
      // Written where the watch draws it, so the config matches the preview.
      const style = id === "weather_temp_max" && run ? run.max : authored;
      const scale = ratio * style.scale;
      const part = (key: Part) => nativePart(id, style, key);
      const point = (key: Part) => `{${Math.round((style.x + part(key).x * style.scale) * ratio)},${Math.round((style.y + part(key).y * style.scale) * ratio)}}`;
      const rect = (key: Part, dx = 0, width = part(key).width) => {
        const p = part(key), x = style.x * ratio, y = style.y * ratio;
        const originalChartAlign = id === "chart" && key === "plot"
          ? /,\s*(hcenter|right)\|vcenter\s*\}$/.exec(resolution.config.chart_rect ?? "")?.[1]
          : undefined;
        const authoredAlign = style.parts?.[key]?.align;
        const align = authoredAlign === "center" ? "hcenter" : authoredAlign ?? originalChartAlign ?? "left";
        return `{${Math.round(x + (p.x + dx) * scale)},${Math.round(y + p.y * scale)},${Math.round(x + (p.x + dx + width) * scale)},${Math.round(y + (p.y + p.height) * scale)},${align}|vcenter}`;
      };
      const prefix = folderPrefix ?? `cl_nd_${id}`;
      const folders: Record<Role, string> = {
        digits: `${prefix}_d`, icon: `${prefix}_i`, states: prefix, unit: `${prefix}_u`, symbols: `${prefix}_s`, progress: `${prefix}_p`, decimal: `${prefix}_m`, background: `${prefix}_bg`, mask: `${prefix}_mask`, noDataMask: `${prefix}_nodata`, separator: "cl_nd_temp_separator"
      };
      const sprite = async (role: Role, index = 0, sourceStyle = style, folder = folders[role]) => {
        const file = `${String(index).padStart(2, "0")}.png`, path = `${resolution.directory}/${folder}/${file}`;
        if (!written.has(path)) {
          written.add(path);
          assetReplacements.push({ path, dataUrl: await nativeDataAsset(id, sourceStyle, role, index, ratio * sourceStyle.scale), create: !existing.has(path), allowDimensionOverride: true });
        }
        return `${folder}\\${file}`;
      };
      const font = async () => { for (let i = 0; i < 10; i++) await sprite("digits", i); return folders.digits; };
      const icon = async (prefix: string, riseKey?: string, setKey?: string, hasValue = part("value").enabled) => {
        if (!part("icon").enabled) {
          if (!hasValue) return;
          values[`${prefix}_icon_pos`] = point("icon");
          values[riseKey ?? `${prefix}_icon`] = blankIcon();
          if (setKey) values[setKey] = blankIcon();
          return;
        }
        values[`${prefix}_icon_pos`] = point("icon");
        values[riseKey ?? `${prefix}_icon`] = await sprite("icon");
        if (setKey) values[setKey] = await sprite("icon", 1);
      };
      const time = async (prefix: string) => {
        if (!part("value").enabled) return;
        const half = part("value").width / 2;
        values[`${prefix}_hour_rect`] = rect("value", 0, half);
        values[`${prefix}_minute_rect`] = rect("value", half + part("symbols").width, half);
        values[`${prefix}_font`] = await font();
      };
      if (field.kind === "state") {
        if (part("states").enabled) {
          values[field.stateKey!] = folders.states;
          values[nativeStatePositionKey(field)] = point("states");
          for (let i = 0; i < nativeStateCount(id, style); i++) await sprite("states", i);
        }
      } else if (field.kind === "number") {
        if (field.stateKey && part("states").enabled) {
          values[`${id}_level_pos`] = point("states");
          values[field.stateKey] = folders.states;
          for (const index of nativeRoleIndices(id, style, "states")) await sprite("states", index);
        }
        if (part("value").enabled) {
          values[`${nativeConfigPrefix(field)}_rect`] = rect("value"); values[`${nativeConfigPrefix(field)}_font`] = await font();
          if (field.percentKey || field.unitKey) {
            const unit = await sprite("unit");
            if (field.unitKey) await sprite("unit", 1);
            values[field.percentKey ?? field.unitKey!] = field.unitKey ? folders.unit : unit;
          }
          if (id === "weather_temp") {
            values.weather_negasign_icon = await sprite("symbols", 0);
            values.weather_dgree_icon = await sprite("unit");
          } else if (id.startsWith("weather_temp_")) {
            const shared = temperatureStyle ?? style;
            values.weather_temp_max_min_negasign_icon = await sprite("symbols", 0, shared, "cl_nd_temp_symbols");
            for (let i = 0; i < 2; i++) await sprite("unit", i, shared, "cl_nd_temp_units");
            values.weather_temp_max_min_dgree_icon = "cl_nd_temp_units";
          }
        }
        if (nativeHasIcon(field)) await icon(id);
      } else if (field.kind === "solar") {
        await time("sunriseset");
        await icon("sunriseset", "sunriseset_sunrise_icon", "sunriseset_sunset_icon");
        if (part("value").enabled) values.sunriseset_colon_icon = await sprite("symbols", 3);
        if (part("progress").enabled) {
          values.sunriseset_progress_pos = point("progress");
          values.sunrise_progress = await sprite("progress", 0); values.sunset_progress = await sprite("progress", 1);
        }
      } else {
        const source = style.chartSource ?? "chart_stress";
        if (!NATIVE_CHART_SOURCES.some(item => item.id === source)) throw new Error("Unsupported native chart source.");
        const chart = style.chartStyle;
        if (part("plot").enabled) {
          values.chart_rect = rect("plot");
          // 0 switches that style off on the watch (official SATISFY faces);
          // any other width stays at least one pixel after scaling.
          const width = (value: number) => value === 0 ? "0" : String(Math.max(1, Math.round(value * scale)));
          values.chart_bar_width = width(chart?.barWidth ?? 8);
          values.chart_bar_interval = String(Math.max(0, Math.round((chart?.barGap ?? 4) * scale)));
          values.chart_selected_bar_color = `0x${(chart?.selectedBarColor ?? part("plot").color).slice(1)}`;
          values.chart_unselected_bar_color = `0x${(chart?.unselectedBarColor ?? "#555555").slice(1)}`;
          values.chart_curves_upper_color = `0x${(chart?.upperColor ?? part("plot").color).slice(1)}`;
          values.chart_curves_lower_color = `0x${(chart?.lowerColor ?? "#555555").slice(1)}`;
          values.chart_curves_width = width(chart?.lineWidth ?? 2);
        }
        for (const [role, imageKey, positionKey] of [
          ["background", "chart_bg", "chart_pos"], ["mask", "chart_bar_mask", "chart_bar_mask_pos"], ["noDataMask", "chart_bar_nodata_mask", "chart_bar_nodata_mask_pos"]
        ] as const) {
          if (part(role).enabled) { values[imageKey] = await sprite(role); values[positionKey] = point(role); }
        }
        // Every official chart face (70 NOMAD, MARK, NIGHT CLIMBER and SATISFY
        // configs) declares chart_bg, so a hidden backdrop becomes an invisible
        // one at the plot, like hidden icons. Adding it did not by itself make
        // a Studio chart page with Back on a PACE Pro (2026-10-20).
        if (!folderPrefix && !part("background").enabled) { values.chart_bg = blankIcon(); values.chart_pos = point("plot"); }
        // The watch draws the graph only when the face declares a chart readout.
        // A graph-only face sent through C-LINK showed no graph until its number
        // was turned on (2026-10-13), although COROS's compiler and ours write the
        // same graph either way. So a hidden number becomes an invisible one,
        // placed inside the plot, as hidden icons become blank ones.
        const invisible = part("plot").enabled && !part(source === "chart_moon" ? "states" : "value").enabled;
        const plotX = Math.round((style.x + part("plot").x * style.scale) * ratio), plotY = Math.round((style.y + part("plot").y * style.scale) * ratio);
        const hiddenRect = (dx = 0) => `{${plotX + dx},${plotY},${plotX + dx + 8},${plotY + 4},left|vcenter}`;
        if (isNativeTime(id, style)) {
          if (invisible) {
            values[`${source}_hour_rect`] = hiddenRect(); values[`${source}_minute_rect`] = hiddenRect(10);
            values[`${source}_font`] = blankFrames("cl_nd_chart_blank_digits", 10);
            values.chart_colon_icon = blankIcon();
          } else await time(source);
          await icon(source, `${source}_icon`, source === "chart_sunrise" ? "chart_sunset_icon" : "chart_moonset_icon", part("value").enabled || invisible);
        } else if (source === "chart_moon") {
          if (part("states").enabled) {
            values.chart_moon_icon_pos = point("states"); values.chart_moon_icon = folders.states;
            for (let i = 0; i < 30; i++) await sprite("states", i);
          } else if (invisible) {
            values.chart_moon_icon_pos = `{${plotX},${plotY}}`; values.chart_moon_icon = blankFrames("cl_nd_chart_blank_moon", 30);
          }
        } else {
          if (part("value").enabled) { values[`${source}_rect`] = rect("value"); values[`${source}_font`] = await font(); }
          else if (invisible) { values[`${source}_rect`] = hiddenRect(); values[`${source}_font`] = blankFrames("cl_nd_chart_blank_digits", 10); }
          await icon(source, undefined, undefined, part("value").enabled || invisible);
        }
        // Every readout shares one set of chart symbols: the edited readout's,
        // or the first stored one with a number.
        if (part("value").enabled && source !== "chart_moon" && !chartSymbolsWritten) {
          chartSymbolsWritten = true;
          values.chart_point_icon = await sprite("decimal");
          for (const [i, key] of ["chart_negasign_icon", "chart_dgree_icon", "chart_percent_icon", "chart_colon_icon"].entries()) {
            // The solar-angle readout supplies the shared degree artwork when present.
            if (key === "chart_dgree_icon" && data.chart_sun_angle?.enabled) continue;
            values[key] = await sprite("symbols", i);
          }
        }
      }
    }
    // Keep every page the face has readouts on (chartPageFillers): invisible
    // readouts at the plot corner, like a hidden chart number.
    const chart = data.chart;
    if (chart?.enabled) {
      const set = (key: string) => {
        const value = key in values ? values[key] : resolution.config[key];
        return Boolean(value?.trim()) && value !== COROS_CONFIG_DELETE_VALUE;
      };
      const time = (source: string) => source === "chart_sunrise" || source === "chart_moonrise";
      const shown = (source: string) => source === "chart_moon" ? set("chart_moon_icon")
        : set(`${source}_${time(source) ? "hour_rect" : "rect"}`) && set(`${source}_font`);
      const missing = chartPageFillers(NATIVE_CHART_PAGES.flatMap(page => page.sources).filter(shown));
      if (missing.length) {
        const plot = nativePart("chart", chart, "plot");
        const x = Math.round((chart.x + plot.x * chart.scale) * ratio), y = Math.round((chart.y + plot.y * chart.scale) * ratio);
        const tiny = (dx = 0) => `{${x + dx},${y},${x + dx + 8},${y + 4},left|vcenter}`;
        for (const source of missing) {
          values[`${source}_icon_pos`] = `{${x},${y}}`;
          values[`${source}_icon`] = blankIcon();
          values[`${source}_font`] = blankFrames("cl_nd_chart_blank_digits", 10);
          if (time(source)) {
            values[`${source}_hour_rect`] = tiny(); values[`${source}_minute_rect`] = tiny(10);
            values[source === "chart_sunrise" ? "chart_sunset_icon" : "chart_moonset_icon"] = blankIcon();
          } else values[`${source}_rect`] = tiny();
        }
      }
    }
    addWeatherConditionCompanion(resolution, weatherIconEnabled, values, assetReplacements, existing);
    await addMinMaxCompanions(resolution, data, run, ratio, values, assetReplacements, existing);
    if (Object.keys(values).length) configOverrides.push({ path: `${resolution.directory}/config.txt`, values });
  }
  return { assetReplacements, configOverrides, minWatchFaceVersion };
}

/**
 * Keep a condition table even when only weather numbers are visible. The
 * working PACE Pro face "1" shared on 2026-09-29 includes 41 transparent
 * condition frames; the failed BOLD exports omitted them. This companion
 * previously existed only for min/max, so current temperature and wind lost
 * it when exported without a visible weather indicator.
 */
function addWeatherConditionCompanion(
  resolution: CorosWatchfaceResolutionDetails,
  weatherIconEnabled: boolean | undefined,
  values: Record<string, string>,
  assetReplacements: CorosWatchfaceAssetReplacement[],
  existing: Set<string>
) {
  const templateIcon = Boolean(resolution.config.weather_icon_dir && parseConfigPos(resolution.config.weather_icon_pos));
  if (weatherIconEnabled ?? templateIcon) return;
  const position = Object.entries(values).flatMap(([key, value]) => {
    if (!key.startsWith("weather_")) return [];
    const rect = key.endsWith("_rect") ? parseConfigRect(value) : null;
    const point = key.endsWith("_pos") ? parseConfigPos(value) : null;
    return rect ? [{ x: rect.x0, y: rect.y0 }] : point ? [point] : [];
  })[0];
  if (!position) return;
  const folder = "cl_nd_weather_blank", dataUrl = canvasImage(1, 1, () => undefined);
  for (let i = 0; i < WEATHER_CONDITION_FRAMES; i++) {
    const path = `${resolution.directory}/${folder}/${String(i).padStart(2, "0")}.png`;
    assetReplacements.push({ path, dataUrl, create: !existing.has(path), allowDimensionOverride: true });
  }
  values.weather_icon_pos = `{${position.x},${position.y}}`;
  values.weather_icon_dir = values.weather_dark_icon_dir = folder;
}

/**
 * Every official face that draws minimum/maximum temperature (NOMAD, GLASS
 * 1–4, NIGHT CLIMBER, V) also has a weather-condition icon and a min/max
 * separator. Without them the values compile but did not appear on a PACE
 * Pro (2026-09-26), so a face that lacks the icon gets an invisible one. With
 * both values shown the separator is the minimum's own component, placed
 * where the run puts it: an invisible one drew "1327°C" on the watch.
 */
async function addMinMaxCompanions(
  resolution: CorosWatchfaceResolutionDetails,
  data: NativeData,
  run: MinMaxTemperatureRun | null,
  ratio: number,
  values: Record<string, string>,
  assetReplacements: CorosWatchfaceAssetReplacement[],
  existing: Set<string>
) {
  const shown = (id: string) => data[id]?.enabled && nativePart(id, data[id]!, "value").enabled;
  const anchor = parseConfigRect(values[shown("weather_temp_min") ? "weather_temp_min_rect" : "weather_temp_max_rect"]);
  if (!anchor || !(shown("weather_temp_min") || shown("weather_temp_max"))) {
    // Their keys were cleared above; a separator an earlier export left in the
    // starter goes with them rather than drawing a stray "/".
    if ((data.weather_temp_min || data.weather_temp_max) && /^cl_nd_temp_separator[\\/]/.test(resolution.config.weather_temp_separator_icon ?? "")) {
      values.weather_temp_separator_icon = values.weather_temp_separator_icon_pos = COROS_CONFIG_DELETE_VALUE;
    }
    return;
  }
  const blank = async (folder: string, count: number) => {
    const dataUrl = canvasImage(1, 1, () => undefined);
    for (let i = 0; i < count; i++) {
      const path = `${resolution.directory}/${folder}/${String(i).padStart(2, "0")}.png`;
      assetReplacements.push({ path, dataUrl, create: !existing.has(path), allowDimensionOverride: true });
    }
  };
  if (run) {
    const min = data.weather_temp_min!, path = `${resolution.directory}/cl_nd_temp_separator/00.png`;
    const dataUrl = run.separator.visible
      ? await nativeDataAsset("weather_temp_min", min, "separator", 0, ratio * min.scale)
      : canvasImage(1, 1, () => undefined);
    assetReplacements.push({ path, dataUrl, create: !existing.has(path), allowDimensionOverride: true });
    values.weather_temp_separator_icon_pos = `{${Math.round(run.separator.x * ratio)},${Math.round(run.separator.y * ratio)}}`;
    values.weather_temp_separator_icon = "cl_nd_temp_separator\\00.png";
  } else if (!resolution.config.weather_temp_separator_icon) {
    await blank("cl_nd_temp_separator", 1);
    values.weather_temp_separator_icon_pos = `{${anchor.x1},${anchor.y0}}`;
    values.weather_temp_separator_icon = "cl_nd_temp_separator\\00.png";
  }
}

/** Keys composeNativeData writes for a field beyond its catalog keys. */
function nativeCompanionKeys(id: string): string[] {
  if (id === "weather_temp") return ["weather_negasign_icon", "weather_dgree_icon"];
  if (id.startsWith("weather_temp_")) return ["weather_temp_max_min_negasign_icon", "weather_temp_max_min_dgree_icon", "weather_temp_separator_icon_pos", "weather_temp_separator_icon"];
  return [];
}

/**
 * Drops deletions of keys an enabled native field writes itself. A hidden
 * template image can share its key with one: Start blank hid SIMPLE's own
 * degree and minus images, Current weather was turned back on and writes its
 * own there, and the editor's final pass over hidden images then deleted them,
 * so every export showed the reading without "°" or a minus (2026-10-20).
 */
export function keepNativeOwnedKeys(overrides: CorosWatchfaceConfigOverride[], data: NativeData = {}): CorosWatchfaceConfigOverride[] {
  const owned = new Set(Object.entries(data).flatMap(([id, style]) => {
    const field = NATIVE_DATA_BY_ID.get(id);
    return field && style.enabled ? [...nativeFieldKeys(field), ...nativeCompanionKeys(id)] : [];
  }));
  return overrides
    .map(({ path, values }) => ({ path, values: Object.fromEntries(Object.entries(values).filter(([key]) => !owned.has(key))) }))
    .filter(({ values }) => Object.keys(values).length > 0);
}

/**
 * Fields the watch draws only on some chart pages, wherever they sit. PACE Pro
 * firmware 3.2008.0 (chart routine around 0x454776): on the sun and moon pages
 * it skips the whole weather block (current, minimum and maximum temperature,
 * rain, humidity, UV and AQI) and draws the page's readouts and wind instead;
 * on the other pages it draws minimum and maximum only on the daily pages and
 * wind only elsewhere. The solar angle field is the sun page's readout.
 */
const PAGE_DEPENDENT_FIELDS: Record<string, (page: string) => boolean> = {
  chart_sun_angle: page => page === "sun",
  ...Object.fromEntries(["weather_temp", "weather_rainfall", "weather_humidity", "weather_uv", "weather_aqi"].map(id => [id, (page: string) => page !== "sun" && page !== "moon"])),
  weather_temp_min: page => page.startsWith("daily-"),
  weather_temp_max: page => page.startsWith("daily-"),
  weather_wind: page => !page.startsWith("daily-"),
  weather_direction: page => !page.startsWith("daily-")
};

/** The chart pages a field shows on; null when the face has no chart or the field shows on every page. */
export function nativeLayerChartPages(id: string, data: NativeData): { pages: string[] } | null {
  const shows = PAGE_DEPENDENT_FIELDS[id];
  if (!data.chart?.enabled || !shows) return null;
  return { pages: NATIVE_CHART_PAGES.map(page => page.id).filter(shows) };
}

/** Layers the watch hides on the chart page the preview shows (the edited readout's page). */
export function nativeLayerHiddenByChartGroup(id: string, data: NativeData): boolean {
  const chart = data.chart?.enabled ? data.chart : undefined, shows = PAGE_DEPENDENT_FIELDS[id];
  const page = chart ? chartReadoutPage(chartSourceOf(chart)) : undefined;
  return Boolean(page && shows && !shows(page));
}

/**
 * A daily-data page shows its other template readouts and divider beside the
 * chart layer's readout: only readouts of the layer's own page, as the watch
 * pages stress/stamina/elevation apart from calories/heart rate/steps.
 */
async function drawChartPageCompanions(canvas: HTMLCanvasElement, width: number, data: NativeData, scenario?: WatchfacePreviewScenario,
  chartPage?: ChartPageCompanions | null) {
  const chart = data.chart;
  if (!chart?.enabled) return;
  const source = chartSourceOf(chart), page = nativeChartDailyPage(source);
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const ratio = canvas.width / width;
  if (chartPage && page) {
    if (chartPage.divider) {
      // The divider PNG is in face pixels; scale it with the canvas like every other part.
      const divider = await loadStudioImage(chartPage.divider.dataUrl);
      ctx.drawImage(divider, chartPage.divider.x * ratio, chartPage.divider.y * ratio, divider.naturalWidth * ratio, divider.naturalHeight * ratio);
    }
    for (const readout of chartPage.readouts) {
      const other = readout.chartSource ?? "";
      // A stored copy (edited or moved in Studio) replaces the template's.
      if (other === source || !page.includes(other) || chart.removedReadouts?.includes(other) || chart.readouts?.[other]) continue;
      await drawNativeDataPreview(canvas, width, { chart: readout }, scenario);
    }
  }
  // Readouts Studio stores beside the edited one, on any page.
  const shown = chartReadoutPage(source);
  for (const readout of storedChartReadouts(chart)) {
    if (chartReadoutPage(chartSourceOf(readout)) !== shown || data[chartSourceOf(readout)]?.enabled) continue;
    await drawNativeDataPreview(canvas, width, { chart: readout }, scenario);
  }
}

const SAMPLE_HISTORY = [0.42, 0.51, 0.37, 0.63, 0.58, 0.75, 0.54, 0.68, 0.61, 0.46, 0.52, 0.35];
/** Sample-only renderer; firmware supplies the live values and chart representation. */
export async function drawNativeDataPreview(canvas: HTMLCanvasElement, width: number, data: NativeData = {}, scenario?: WatchfacePreviewScenario,
  chartPage?: ChartPageCompanions | null) {
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  await drawChartPageCompanions(canvas, width, data, scenario, chartPage);
  const ratio = canvas.width / width;
  const history = scenario?.chartHistory ?? SAMPLE_HISTORY;
  const run = minMaxTemperatureRun(data, scenario);
  for (const [id, authored] of Object.entries(data)) {
    const field = NATIVE_DATA_BY_ID.get(id); if (!authored.enabled || !field || nativeLayerHiddenByChartGroup(id, data)) continue;
    const style = id === "weather_temp_max" && run ? run.max : authored;
    const scale = style.scale * ratio, x = style.x * ratio, y = style.y * ratio;
    const part = (key: Part) => nativePart(id, style, key);
    const draw = async (role: Role, index = 0, dx = part(nativeRolePart(role)).x, dy = part(nativeRolePart(role)).y, sourceStyle = style) => {
      ctx.drawImage(await loadStudioImage(await nativeDataAsset(id, sourceStyle, role, index, ratio * sourceStyle.scale)), x + dx * scale, y + dy * scale);
    };
    const source = style.chartSource ?? "chart_stress", moon = id === "chart" && source === "chart_moon";
    const available = nativeParts(id, style);
    const value = nativeDataPreviewValue(id, style, scenario);
    // The daily-data page shows its readouts without the plot frame (official
    // faces lay them over chart_bg), so only graph pages draw it.
    const graph = id === "chart" ? nativeChartRepresentation(source) : undefined;
    if (graph && graph !== "none" && part("background").enabled) await draw("background");
    if (available.includes("states") && part("states").enabled) {
      // PLANET has eleven stamina frames, from empty (0) to full (100%). UV
      // level artwork is categorical (DASHBOARD: unknown, low, moderate, high,
      // very high, extreme), so the sample index maps through the WHO bands.
      const uv = Number(value);
      const state = id === "stamina" ? Math.floor(Number(value) / 10)
        : id === "weather_uv" ? (!Number.isFinite(uv) || uv < 0 ? 0 : uv < 3 ? 1 : uv < 6 ? 2 : uv < 8 ? 3 : uv < 11 ? 4 : 5)
        : Math.trunc(Number(value));
      await draw("states", Math.max(0, Math.min((moon ? 30 : nativeStateCount(id, style)) - 1, state || 0)));
    }
    if (available.includes("icon") && part("icon").enabled) await draw("icon");
    if (available.includes("value") && part("value").enabled) {
      const digits = part("value"), digitWidth = digits.digitWidth;
      const { characters, x: textX } = nativeValueRun(id, style, scenario);
      let dx = textX;
      for (const char of characters) {
        if (/\d/.test(char)) { await draw("digits", Number(char), dx, digits.y); dx += digitWidth; }
        else if (char === ".") {
          await draw("decimal", 0, dx, digits.y); dx += part("decimal").width;
        } else {
          const index = char === ":" ? 3 : char === "%" ? 2 : char === "°" ? 1 : 0;
          await draw("symbols", index, dx, digits.y); dx += part("symbols").width;
        }
      }
      if (id === "weather_temp_min" && run) {
        // One reading: the separator follows the minimum; the unit comes after the maximum.
        const separator = part("separator");
        if (separator.enabled) await draw("separator", 0, dx, digits.y + (digits.height - separator.height) / 2);
      } else if (available.includes("unit")) {
        const shared = id.startsWith("weather_temp_") && data.weather_temp_min?.enabled ? data.weather_temp_min : style;
        await draw("unit", 0, dx, digits.y, shared);
      } else if (id === "chart" && source === "chart_moon_percent") await draw("symbols", 2, dx, digits.y);
      else if (id === "chart" && source === "chart_sun_angle") await draw("symbols", 1, dx, digits.y);
    }
    if (field.kind === "solar" && part("progress").enabled) await draw("progress");
    if (id !== "chart") continue;
    // The watch picks bars, a line or no graph by chart group, so the preview does too.
    if (graph === "none") continue;
    const plot = part("plot"), chart = style.chartStyle, line = graph === "curve";
    if (plot.enabled) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x + plot.x * scale, y + plot.y * scale, plot.width * scale, plot.height * scale); ctx.clip();
      if (line ? chart?.lineWidth === 0 : chart?.barWidth === 0) {
        // That style is switched off: the watch draws nothing for it.
      } else if (line) {
        // Sample curve using the exported line appearance. Rise/set sources draw
        // a day arc around a horizon like official sun/moon groups; other
        // sources trace the sample history. Upper/lower colors split at the
        // horizon or the plot's midline.
        const upper = chart?.upperColor ?? plot.color, lower = chart?.lowerColor ?? "#555555", lineWidth = Math.max(1, chart?.lineWidth ?? 2) * scale;
        const px = (t: number) => x + (plot.x + t * plot.width) * scale, py = (v: number) => y + (plot.y + (1 - v) * plot.height) * scale;
        const arc = isNativeTime(id, style), split = arc ? 0.45 : 0.5;
        const curve = (t: number) => arc ? split + Math.cos((t - 0.5) * Math.PI * 2) * 0.42 : (() => {
          const position = t * (history.length - 1), index = Math.floor(position), next = Math.min(history.length - 1, index + 1);
          return history[index] + (history[next] - history[index]) * (position - index);
        })();
        // The watch draws the horizon white, like the "now" marker below (PACE Pro, 2026-10-18).
        if (arc) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, scale); ctx.beginPath(); ctx.moveTo(px(0), py(split)); ctx.lineTo(px(1), py(split)); ctx.stroke(); }
        ctx.lineWidth = lineWidth; ctx.lineCap = "round"; ctx.lineJoin = "round";
        const steps = Math.max(2, Math.round(plot.width / 2));
        for (const [color, above] of [[lower, false], [upper, true]] as const) {
          ctx.strokeStyle = color; ctx.beginPath();
          let drawing = false;
          for (let i = 0; i <= steps; i++) {
            const t = i / steps, v = curve(t);
            if ((v >= split) === above) { if (drawing) ctx.lineTo(px(t), py(v)); else { ctx.moveTo(px(t), py(v)); drawing = true; } }
            else drawing = false;
          }
          ctx.stroke();
        }
        const progress = Math.max(0, Math.min(1, scenario?.chartProgress ?? 0.3));
        // The firmware draws this "now" marker white: curve, bar and graph colors
        // don't reach it (PACE Pro, official NOMAD export, 2026-10-18).
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(px(progress), py(curve(progress)), Math.max(3 * scale, lineWidth * 1.5), 0, Math.PI * 2); ctx.fill();
      } else {
        const barWidth = chart?.barWidth ?? 8, gap = chart?.barGap ?? 4;
        const count = Math.ceil(plot.width / (barWidth + gap));
        for (let i = 0; i < count; i++) {
          const h = history[i % history.length] * plot.height;
          ctx.fillStyle = i === Math.floor(count / 2) ? chart?.selectedBarColor ?? plot.color : chart?.unselectedBarColor ?? "#555555";
          ctx.fillRect(x + (plot.x + i * (barWidth + gap)) * scale, y + (plot.y + plot.height - h) * scale, barWidth * scale, h * scale);
        }
      }
      ctx.restore();
    }
    // chart_bar_mask marks the selected bar; official curve groups draw no marker.
    if (part("mask").enabled && !line) await draw("mask");
  }
}
