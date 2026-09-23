import type { CorosWatchfaceAssetReplacement, CorosWatchfaceConfigOverride, CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceTemplateDetails } from "../../electron/types";
import { NATIVE_CHART_SHARED_KEYS, NATIVE_CHART_SOURCES, NATIVE_DATA_BY_ID, nativeChartGroup, nativeChartSourceKeys, nativeFieldKeys, nativeConfigPrefix, nativeHasIcon, nativeStatePositionKey } from "../../electron/watchfaceNativeCatalog";
import { COROS_CONFIG_DELETE_VALUE, loadStudioImage, offsetConfigValue, parseConfigPos, pickPreviewResolution, resizeAndTintSprite } from "./watchfaceStudio";
import { isNativeTime, nativeAssetText, nativePart, nativePartHasPosition, nativeParts, nativeRolePart, nativeRoleIndices, nativeStateCount } from "./nativeDataParts";
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
  if (replacement) return resizeAndTintSprite(replacement, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const text = nativeAssetText(id, style, role, index);
  return canvasImage(width, height, ctx => {
    ctx.fillStyle = part.color;
    if (text !== null) {
      const fontSize = Math.round(height * 0.75);
      setWatchfaceCanvasFont(ctx, { family: part.fontFamily, size: fontSize }, `${fontSize}px ${part.fontFamily}`);
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

export async function composeNativeData(details: CorosWatchfaceTemplateDetails, data: NativeData = {}) {
  const base = pickPreviewResolution(details);
  const assetReplacements: CorosWatchfaceAssetReplacement[] = [];
  const configOverrides: CorosWatchfaceConfigOverride[] = [];
  let minWatchFaceVersion = 0;
  if (!base) return { assetReplacements, configOverrides, minWatchFaceVersion };
  // The firmware shares min/max units and minus artwork. Use minimum when both
  // are enabled, so output is independent of object insertion order.
  const temperatureStyle = data.weather_temp_min?.enabled ? data.weather_temp_min : data.weather_temp_max;
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
        for (const { id: source } of NATIVE_CHART_SOURCES) {
          if (nativeChartSourceKeys(source).some(key => /^cl_nd_/.test(resolution.config[key] ?? ""))) for (const key of nativeChartSourceKeys(source)) values[key] = COROS_CONFIG_DELETE_VALUE;
        }
      } else for (const key of nativeFieldKeys(field)) values[key] = COROS_CONFIG_DELETE_VALUE;
      if (style.enabled) minWatchFaceVersion = Math.max(minWatchFaceVersion, field.version);
    }
    for (const [id, style] of Object.entries(data)) {
      const field = NATIVE_DATA_BY_ID.get(id)!;
      if (!style.enabled) continue;
      const scale = ratio * style.scale;
      const part = (key: Part) => nativePart(id, style, key);
      const point = (key: Part) => `{${Math.round((style.x + part(key).x * style.scale) * ratio)},${Math.round((style.y + part(key).y * style.scale) * ratio)}}`;
      const rect = (key: Part, dx = 0, width = part(key).width) => {
        const p = part(key), x = style.x * ratio, y = style.y * ratio;
        return `{${Math.round(x + (p.x + dx) * scale)},${Math.round(y + p.y * scale)},${Math.round(x + (p.x + dx + width) * scale)},${Math.round(y + (p.y + p.height) * scale)},${p.align === "center" ? "hcenter" : p.align}|vcenter}`;
      };
      const folders: Record<Role, string> = {
        digits: `cl_nd_${id}_d`, icon: `cl_nd_${id}_i`, states: `cl_nd_${id}`, unit: `cl_nd_${id}_u`, symbols: `cl_nd_${id}_s`, progress: `cl_nd_${id}_p`, decimal: `cl_nd_${id}_m`, background: `cl_nd_${id}_bg`, mask: `cl_nd_${id}_mask`, noDataMask: `cl_nd_${id}_nodata`
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
      // The 4.9.9 parser reads each icon+value block only when its `_icon_pos`
      // key exists (LoadConfig 0x1e7e38 for stamina, 0x1e42a8 for UV, likewise
      // wind, rain, humidity, AQI, training load, stress, barometer, activity
      // totals and sunrise/sunset). A missing `_icon` key is skipped on its own,
      // so a hidden icon still writes the position, or the value never reaches
      // the watch. The chart helpers look every key up independently.
      const icon = async (prefix: string, riseKey?: string, setKey?: string) => {
        if (!part("icon").enabled) {
          if (part("value").enabled) values[`${prefix}_icon_pos`] = point("icon");
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
          values.chart_bar_width = String(Math.max(1, Math.round((chart?.barWidth ?? 8) * scale)));
          values.chart_bar_interval = String(Math.max(0, Math.round((chart?.barGap ?? 4) * scale)));
          values.chart_selected_bar_color = `0x${(chart?.selectedBarColor ?? part("plot").color).slice(1)}`;
          values.chart_unselected_bar_color = `0x${(chart?.unselectedBarColor ?? "#555555").slice(1)}`;
          values.chart_curves_upper_color = `0x${(chart?.upperColor ?? part("plot").color).slice(1)}`;
          values.chart_curves_lower_color = `0x${(chart?.lowerColor ?? "#555555").slice(1)}`;
          values.chart_curves_width = String(Math.max(1, Math.round((chart?.lineWidth ?? 2) * scale)));
        }
        for (const [role, imageKey, positionKey] of [
          ["background", "chart_bg", "chart_pos"], ["mask", "chart_bar_mask", "chart_bar_mask_pos"], ["noDataMask", "chart_bar_nodata_mask", "chart_bar_nodata_mask_pos"]
        ] as const) {
          if (part(role).enabled) { values[imageKey] = await sprite(role); values[positionKey] = point(role); }
        }
        if (isNativeTime(id, style)) {
          await time(source);
          await icon(source, `${source}_icon`, source === "chart_sunrise" ? "chart_sunset_icon" : "chart_moonset_icon");
        } else if (source === "chart_moon") {
          if (part("states").enabled) {
            values.chart_moon_icon_pos = point("states"); values.chart_moon_icon = folders.states;
            for (let i = 0; i < 30; i++) await sprite("states", i);
          }
        } else {
          if (part("value").enabled) { values[`${source}_rect`] = rect("value"); values[`${source}_font`] = await font(); }
          await icon(source);
        }
        if (part("value").enabled && source !== "chart_moon") {
          values.chart_point_icon = await sprite("decimal");
          for (const [i, key] of ["chart_negasign_icon", "chart_dgree_icon", "chart_percent_icon", "chart_colon_icon"].entries()) {
            // The solar-angle readout supplies the shared degree artwork when present.
            if (key === "chart_dgree_icon" && data.chart_sun_angle?.enabled) continue;
            values[key] = await sprite("symbols", i);
          }
        }
      }
    }
    if (Object.keys(values).length) configOverrides.push({ path: `${resolution.directory}/config.txt`, values });
  }
  return { assetReplacements, configOverrides, minWatchFaceVersion };
}

/**
 * Layers the watch shows only in some Back-button chart groups. The preview
 * follows the chart layer's group; without a chart layer everything draws.
 * Suppression only applies where the alternatives actually share a slot.
 */
export function nativeLayerHiddenByChartGroup(id: string, data: NativeData): boolean {
  const chart = data.chart?.enabled ? data.chart : undefined;
  const group = nativeChartGroup(chart ? chart.chartSource ?? "chart_stress" : undefined);
  if (!group) return false;
  const bounds = (key: string) => {
    const style = data[key];
    if (!style?.enabled) return null;
    const size = nativeDataSize(key, style);
    return { x0: style.x, y0: style.y, x1: style.x + size.width, y1: style.y + size.height };
  };
  const collides = (a: string, b: string) => {
    const p = bounds(a), q = bounds(b);
    return Boolean(p && q && p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1);
  };
  if (id === "chart_sun_angle") return group !== "sun";
  if (id === "weather_temp") return group === "sun" && collides("weather_temp", "chart_sun_angle");
  // NOMAD keeps min/max temperature and wind in one row; COROS lists wind and
  // direction in every group except general daily data.
  if (id === "weather_temp_min" || id === "weather_temp_max") return group !== "general" && collides(id, "weather_wind");
  if (id === "weather_wind" || id === "weather_direction") return group === "general" && (collides("weather_wind", "weather_temp_min") || collides("weather_wind", "weather_temp_max"));
  return false;
}

const SAMPLE_HISTORY = [0.42, 0.51, 0.37, 0.63, 0.58, 0.75, 0.54, 0.68, 0.61, 0.46, 0.52, 0.35];
/** Sample-only renderer; firmware supplies the live values and chart representation. */
export async function drawNativeDataPreview(canvas: HTMLCanvasElement, width: number, data: NativeData = {}, scenario?: WatchfacePreviewScenario) {
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const ratio = canvas.width / width;
  const history = scenario?.chartHistory ?? SAMPLE_HISTORY;
  for (const [id, style] of Object.entries(data)) {
    const field = NATIVE_DATA_BY_ID.get(id); if (!style.enabled || !field || nativeLayerHiddenByChartGroup(id, data)) continue;
    const scale = style.scale * ratio, x = style.x * ratio, y = style.y * ratio;
    const part = (key: Part) => nativePart(id, style, key);
    const draw = async (role: Role, index = 0, dx = part(nativeRolePart(role)).x, dy = part(nativeRolePart(role)).y, sourceStyle = style) => {
      ctx.drawImage(await loadStudioImage(await nativeDataAsset(id, sourceStyle, role, index, ratio * sourceStyle.scale)), x + dx * scale, y + dy * scale);
    };
    const source = style.chartSource ?? "chart_stress", moon = id === "chart" && source === "chart_moon";
    const available = nativeParts(id, style);
    const value = nativeDataPreviewValue(id, style, scenario);
    if (id === "chart" && part("background").enabled) await draw("background");
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
      const time = isNativeTime(id, style);
      const characters = value.slice(0, time ? 5 : 6);
      const textWidth = [...characters].reduce((sum, char) => sum + (/\d/.test(char) ? digitWidth : char === "." ? part("decimal").width : part("symbols").width), 0);
      let dx = digits.x + (digits.align === "right" ? digits.width - textWidth : digits.align === "center" ? (digits.width - textWidth) / 2 : 0);
      for (const char of characters) {
        if (/\d/.test(char)) { await draw("digits", Number(char), dx, digits.y); dx += digitWidth; }
        else if (char === ".") {
          await draw("decimal", 0, dx, digits.y); dx += part("decimal").width;
        } else {
          const index = char === ":" ? 3 : char === "%" ? 2 : char === "°" ? 1 : 0;
          await draw("symbols", index, dx, digits.y); dx += part("symbols").width;
        }
      }
      if (available.includes("unit")) {
        const shared = id.startsWith("weather_temp_") && data.weather_temp_min?.enabled ? data.weather_temp_min : style;
        await draw("unit", 0, dx, digits.y, shared);
      } else if (id === "chart" && source === "chart_moon_percent") await draw("symbols", 2, dx, digits.y);
      else if (id === "chart" && source === "chart_sun_angle") await draw("symbols", 1, dx, digits.y);
    }
    if (field.kind === "solar" && part("progress").enabled) await draw("progress");
    if (id !== "chart") continue;
    const plot = part("plot"), chart = style.chartStyle;
    if (plot.enabled) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x + plot.x * scale, y + plot.y * scale, plot.width * scale, plot.height * scale); ctx.clip();
      if (chart?.previewType === "curve") {
        // Sample curve using the exported line appearance. Rise/set sources draw
        // a day arc around a horizon like official sun/moon groups; other
        // sources trace the sample history. Upper/lower colors split at the
        // horizon or the plot's midline.
        const upper = chart.upperColor ?? plot.color, lower = chart.lowerColor ?? "#555555", lineWidth = Math.max(1, chart.lineWidth ?? 2) * scale;
        const px = (t: number) => x + (plot.x + t * plot.width) * scale, py = (v: number) => y + (plot.y + (1 - v) * plot.height) * scale;
        const arc = isNativeTime(id, style), split = arc ? 0.45 : 0.5;
        const curve = (t: number) => arc ? split + Math.cos((t - 0.5) * Math.PI * 2) * 0.42 : (() => {
          const position = t * (history.length - 1), index = Math.floor(position), next = Math.min(history.length - 1, index + 1);
          return history[index] + (history[next] - history[index]) * (position - index);
        })();
        if (arc) { ctx.strokeStyle = lower; ctx.lineWidth = Math.max(1, scale); ctx.beginPath(); ctx.moveTo(px(0), py(split)); ctx.lineTo(px(1), py(split)); ctx.stroke(); }
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
        ctx.fillStyle = plot.color; ctx.beginPath(); ctx.arc(px(progress), py(curve(progress)), Math.max(3 * scale, lineWidth * 1.5), 0, Math.PI * 2); ctx.fill();
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
    if (part("mask").enabled && chart?.previewType !== "curve") await draw("mask");
  }
}
