import type { CorosWatchfaceAssetReplacement, CorosWatchfaceConfigOverride, CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceTemplateDetails } from "../../electron/types";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_BY_ID, nativeFieldKeys } from "../../electron/watchfaceNativeCatalog";
import { COROS_CONFIG_DELETE_VALUE, loadStudioImage, pickPreviewResolution, resizeAndTintSprite } from "./watchfaceStudio";
import { isNativeTime, nativeAssetText, nativePart, nativePartHasPosition, nativeParts, nativeRolePart } from "./nativeDataParts";
import type { WatchfacePreviewScenario } from "./watchfaceSimulation";
export { NATIVE_CHART_SOURCES, NATIVE_DATA_FIELDS, NATIVE_DATA_BY_ID } from "../../electron/watchfaceNativeCatalog";
export type NativeData = Record<string, Style>;
export { defaultNativeDataStyle } from "./nativeDataParts";
export function nativeDataPreviewValue(id: string, style: Style): string {
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
  const width = (role === "digits" ? part.width / 4 : part.width) * scale;
  const height = part.height * scale;
  if (!part.enabled) return canvasImage(width, height, () => undefined);
  const replacement = style.assets?.[role]?.[String(index)];
  if (replacement) return resizeAndTintSprite(replacement, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const text = nativeAssetText(id, style, role, index);
  return canvasImage(width, height, ctx => {
    ctx.fillStyle = part.color;
    if (text !== null) {
      ctx.font = `${Math.round(height * 0.75)}px ${part.fontFamily}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, width / 2, height / 2, width);
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
    for (const [id, style] of Object.entries(data)) {
      const field = NATIVE_DATA_BY_ID.get(id);
      if (!field) throw new Error(`Unknown native data field: ${id}`);
      for (const key of nativeFieldKeys(field)) values[key] = COROS_CONFIG_DELETE_VALUE;
      if (field.kind === "chart") {
        values.chart_bg = COROS_CONFIG_DELETE_VALUE;
        for (const key of Object.keys(resolution.config)) if (key.startsWith("chart_")) values[key] = COROS_CONFIG_DELETE_VALUE;
      }
      if (!style.enabled) continue;
      minWatchFaceVersion = Math.max(minWatchFaceVersion, field.version);
      const scale = ratio * style.scale;
      const part = (key: Part) => nativePart(id, style, key);
      const point = (key: Part) => `{${Math.round((style.x + part(key).x * style.scale) * ratio)},${Math.round((style.y + part(key).y * style.scale) * ratio)}}`;
      const rect = (key: Part, dx = 0, width = part(key).width) => {
        const p = part(key), x = style.x * ratio, y = style.y * ratio;
        return `{${Math.round(x + (p.x + dx) * scale)},${Math.round(y + p.y * scale)},${Math.round(x + (p.x + dx + width) * scale)},${Math.round(y + (p.y + p.height) * scale)},left|vcenter}`;
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
      const icon = async (prefix: string, riseKey?: string, setKey?: string) => {
        if (!part("icon").enabled) return;
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
          values[id === "weather_direction" ? "weather_direction_icon_pos" : `${id}_pos`] = point("states");
          for (let i = 0; i < field.stateCount!; i++) await sprite("states", i);
        }
      } else if (field.kind === "number") {
        if (part("value").enabled) {
          values[`${id}_rect`] = rect("value"); values[`${id}_font`] = await font();
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
        if (!id.startsWith("weather_temp")) await icon(id);
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
          for (const [i, key] of ["chart_negasign_icon", "chart_dgree_icon", "chart_percent_icon", "chart_colon_icon"].entries()) values[key] = await sprite("symbols", i);
        }
      }
    }
    if (Object.keys(values).length) configOverrides.push({ path: `${resolution.directory}/config.txt`, values });
  }
  return { assetReplacements, configOverrides, minWatchFaceVersion };
}

const SAMPLE_HISTORY = [0.42, 0.51, 0.37, 0.63, 0.58, 0.75, 0.54, 0.68, 0.61, 0.46, 0.52, 0.35];
/** Sample-only renderer; firmware supplies the live values and chart representation. */
export async function drawNativeDataPreview(canvas: HTMLCanvasElement, width: number, data: NativeData = {}, scenario?: WatchfacePreviewScenario) {
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const ratio = canvas.width / width;
  const history = scenario?.chartHistory ?? SAMPLE_HISTORY;
  for (const [id, style] of Object.entries(data)) {
    const field = NATIVE_DATA_BY_ID.get(id); if (!style.enabled || !field) continue;
    const scale = style.scale * ratio, x = style.x * ratio, y = style.y * ratio;
    const part = (key: Part) => nativePart(id, style, key);
    const draw = async (role: Role, index = 0, dx = part(nativeRolePart(role)).x, dy = part(nativeRolePart(role)).y, sourceStyle = style) => {
      ctx.drawImage(await loadStudioImage(await nativeDataAsset(id, sourceStyle, role, index, ratio * sourceStyle.scale)), x + dx * scale, y + dy * scale);
    };
    const source = style.chartSource ?? "chart_stress", moon = id === "chart" && source === "chart_moon";
    const available = nativeParts(id, style);
    const value = scenario?.values?.[id === "chart" ? source : id] ?? scenario?.values?.[id] ?? nativeDataPreviewValue(id, style);
    if (id === "chart" && part("background").enabled) await draw("background");
    if (available.includes("states") && part("states").enabled) {
      await draw("states", Math.max(0, Math.min((moon ? 30 : field.stateCount!) - 1, Math.trunc(Number(value)) || 0)));
    }
    if (available.includes("icon") && part("icon").enabled) await draw("icon");
    if (available.includes("value") && part("value").enabled) {
      const digits = part("value"), digitWidth = digits.width / 4;
      let dx = digits.x;
      const time = isNativeTime(id, style);
      for (const char of value.slice(0, time ? 5 : 4)) {
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
      // Line previews are disabled, including legacy projects saved as "curve".
      const barWidth = chart?.barWidth ?? 8, gap = chart?.barGap ?? 4;
      const count = Math.ceil(plot.width / (barWidth + gap));
      for (let i = 0; i < count; i++) {
        const h = history[i % history.length] * plot.height;
        ctx.fillStyle = i === Math.floor(count / 2) ? chart?.selectedBarColor ?? plot.color : chart?.unselectedBarColor ?? "#555555";
        ctx.fillRect(x + (plot.x + i * (barWidth + gap)) * scale, y + (plot.y + plot.height - h) * scale, barWidth * scale, h * scale);
      }
      ctx.restore();
    }
    if (part("mask").enabled) await draw("mask");
  }
}
