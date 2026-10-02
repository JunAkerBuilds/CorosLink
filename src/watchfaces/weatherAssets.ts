import type {
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceResolutionDetails,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import {
  COROS_CONFIG_DELETE_VALUE,
  loadStudioImage,
  parseConfigPos,
  pickPreviewResolution,
  resizeAndTintSprite
} from "./watchfaceStudio";

export interface WatchfaceWeatherStyle {
  enabled: boolean;
  /** Top-left corner in preview-resolution coordinates. */
  x: number;
  y: number;
  scale: number;
  /** Optional tint applied consistently to all 41 states. */
  color?: string;
  temperatureEnabled?: boolean;
  assets?: Partial<Record<WeatherAssetSet, Record<string, string>>>;
}

const bundled = import.meta.glob(
  "../assets/watchfaces/weather/simple/**/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

export type WeatherAssetSet = "day" | "night" | "digits" | "symbols" | "units";
const sourceFolders: Record<WeatherAssetSet, string> = {
  day: "weather", night: "weather2", digits: "38x38", symbols: "symbols", units: "dgree_unit"
};
const outputFolders: Record<WeatherAssetSet, string> = {
  day: "weather", night: "weather2", digits: "cl_weather_temp", symbols: "cl_weather_symbols", units: "cl_weather_units"
};
export const WEATHER_ASSET_COUNTS: Record<WeatherAssetSet, number> = {
  day: 41, night: 41, digits: 10, symbols: 2, units: 2
};

export interface WeatherAssetSetInfo {
  set: WeatherAssetSet;
  label: string;
  /** What each numbered state stands for, or how to name the files. */
  hint: string;
  /** The official COROS library carries this set; symbols and units are SIMPLE-only. */
  official: boolean;
}

/** The sprite sets in inspector order: the condition icon first, then the temperature reading. */
export const WEATHER_ICON_SETS: readonly WeatherAssetSetInfo[] = [
  { set: "day", label: "Day icons", hint: "PNGs named 00–40", official: true },
  { set: "night", label: "Night icons", hint: "PNGs named 00–40", official: true }
];
export const WEATHER_TEMPERATURE_SETS: readonly WeatherAssetSetInfo[] = [
  { set: "digits", label: "Temperature digits", hint: "PNGs named 00–09", official: true },
  { set: "symbols", label: "Minus & degree", hint: "00 = minus, 01 = degree", official: false },
  { set: "units", label: "°C / °F", hint: "00 = °C, 01 = °F", official: false }
];

export function weatherAssetUrl(set: WeatherAssetSet, index: number, style?: WatchfaceWeatherStyle): string {
  return style?.assets?.[set]?.[String(index)] ??
    bundled[`../assets/watchfaces/weather/simple/${sourceFolders[set]}/${String(index).padStart(2, "0")}.png`] ?? "";
}

// SIMPLE uses an 89px square icon on its 800px design canvas.
function weatherSpriteSize(resolution: CorosWatchfaceResolutionDetails): number {
  return Math.max(1, Math.round(89 * resolution.width / 800));
}

export function weatherTemperatureGeometry(width: number, style: WatchfaceWeatherStyle) {
  const scale = width / 800 * style.scale;
  // Keep temperature attached above the icon, matching SIMPLE's layout.
  return { x: Math.max(0, Math.min(width - 138 * scale, style.x + 10 * scale)),
    y: Math.max(0, style.y - 89 * scale), scale };
}

export function getWeatherCapability(details: CorosWatchfaceTemplateDetails): {
  active: boolean;
  defaultPos: { x: number; y: number };
  size: { width: number; height: number };
} | null {
  const resolution = pickPreviewResolution(details);
  if (!resolution) {
    return null;
  }
  const scale = resolution.width / 416;
  return {
    active: Boolean(
      parseConfigPos(resolution.config.weather_icon_pos) &&
      resolution.config.weather_icon_dir
    ),
    defaultPos:
      parseConfigPos(resolution.config.weather_icon_pos) ?? {
        x: Math.round(187 * scale),
        y: Math.round(57 * scale)
      },
    size: {
      width: weatherSpriteSize(resolution),
      height: weatherSpriteSize(resolution)
    }
  };
}

export function buildWeatherOverrides(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceWeatherStyle
): CorosWatchfaceConfigOverride[] {
  const base = pickPreviewResolution(details);
  if (!base) {
    return [];
  }
  return details.resolutions.flatMap((resolution) => {
    const scale = resolution.width / base.width;
    // When weather is turned off the keys are deleted (not left blank) so the
    // exported config omits them entirely, matching faces without weather.
    const values = style.enabled
      ? {
          weather_icon_pos: `{${Math.round(style.x * scale)},${Math.round(style.y * scale)}}`,
          weather_icon_dir: "weather",
          weather_dark_icon_dir: "weather2"
        }
      : {
          weather_icon_pos: COROS_CONFIG_DELETE_VALUE,
          weather_icon_dir: COROS_CONFIG_DELETE_VALUE,
          weather_dark_icon_dir: COROS_CONFIG_DELETE_VALUE
        };
    const temperature = weatherTemperatureGeometry(resolution.width, {
      ...style, x: style.x * scale, y: style.y * scale
    });
    const temperatureValues: Record<string, string> = style.enabled && style.temperatureEnabled !== false
      ? {
          weather_temp_rect: `{${Math.round(temperature.x)},${Math.round(temperature.y)},${Math.round(temperature.x + 84 * temperature.scale)},${Math.round(temperature.y + 95 * temperature.scale)},left|vcenter}`,
          weather_temp_font: "cl_weather_temp",
          weather_negasign_icon: "cl_weather_symbols\\00.png",
          weather_dgree_icon: "cl_weather_symbols\\01.png",
          weather_temp_max_min_dgree_icon: "cl_weather_units"
        }
      : Object.fromEntries(["weather_temp_rect", "weather_temp_font", "weather_negasign_icon", "weather_dgree_icon", "weather_temp_max_min_dgree_icon"].map(key => [key, COROS_CONFIG_DELETE_VALUE]));
    Object.assign(values, temperatureValues);
    const hasWeatherKeys = (config: Record<string, string>) =>
      Object.prototype.hasOwnProperty.call(config, "weather_icon_pos") ||
      Object.prototype.hasOwnProperty.call(config, "weather_icon_dir");
    const overrides: CorosWatchfaceConfigOverride[] = [];

    // AODconfig uses the same weather source folder. COROS compiles it into a
    // separate dimmed 41-frame table, so do not add a second `a/weather` tree.
    if (style.enabled || hasWeatherKeys(resolution.config) || resolution.config.weather_temp_rect) {
      overrides.push({
        path: `${resolution.directory}/config.txt`,
        values
      });
    }
    if (
      Object.keys(resolution.aodConfig).length > 0 &&
      (style.enabled || hasWeatherKeys(resolution.aodConfig) || Boolean(resolution.aodConfig.weather_temp_rect))
    ) {
      overrides.push({
        path: `${resolution.directory}/AODconfig.txt`,
        values
      });
    }
    return overrides;
  });
}

export function weatherPreviewUrl(_width: number, style?: WatchfaceWeatherStyle, sample?: { condition: number; night: boolean }): string {
  return weatherAssetUrl(sample?.night ? "night" : "day", sample?.condition ?? 0, style);
}

export async function weatherPreviewDataUrl(width: number, color?: string, style?: WatchfaceWeatherStyle, sample?: { condition: number; night: boolean }): Promise<string> {
  const url = weatherPreviewUrl(width, style, sample);
  const edge = Math.max(1, Math.round(89 * width / 800));
  return resizeAndTintSprite(url, edge, edge, color);
}

/** Preview uses the same raster digits and placement as the exported native field. */
export async function drawWeatherTemperaturePreview(canvas: HTMLCanvasElement, width: number, style: WatchfaceWeatherStyle, value = "18"): Promise<void> {
  if (!style.enabled || style.temperatureEnabled === false) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const geometry = weatherTemperatureGeometry(width, style);
  const previewScale = canvas.width / width;
  const scale = geometry.scale * previewScale;
  let x = geometry.x * previewScale;
  const temperature = Number.isFinite(Number(value)) ? Math.max(-999, Math.min(999, Math.round(Number(value)))) : 18;
  const glyphs: Array<[WeatherAssetSet, number, number]> = [...String(temperature)].map(char => char === "-" ? ["symbols", 0, 54] : ["digits", Number(char), 42]);
  glyphs.push(["symbols", 1, 54]);
  for (const [set, index, glyphWidth] of glyphs) {
    const url = await resizeAndTintSprite(weatherAssetUrl(set, index, style), Math.max(1, Math.round(glyphWidth * scale)), Math.max(1, Math.round(95 * scale)), style.color);
    const image = await loadStudioImage(url);
    context.drawImage(image, x, geometry.y * previewScale);
    x += glyphWidth * scale;
  }
}

export async function buildWeatherSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceWeatherStyle
): Promise<CorosWatchfaceAssetReplacement[]> {
  if (!style.enabled) return [];
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const resolution of details.resolutions) {
    const scale = resolution.width / 800 * style.scale;
    for (const set of Object.keys(sourceFolders) as WeatherAssetSet[]) {
      if (style.temperatureEnabled === false && !["day", "night"].includes(set)) continue;
      for (let index = 0; index < WEATHER_ASSET_COUNTS[set]; index++) {
        const url = weatherAssetUrl(set, index, style);
        if (!url) throw new Error(`Missing ${set} weather asset ${index}.`);
        // Custom artwork uses the same firmware frame as the default sprite.
        const original = await loadStudioImage(weatherAssetUrl(set, index));
        const dataUrl = await resizeAndTintSprite(url,
          Math.max(1, Math.round(original.naturalWidth * scale)),
          Math.max(1, Math.round(original.naturalHeight * scale)), style.color);
        const path = `${resolution.directory}/${outputFolders[set]}/${String(index).padStart(2, "0")}.png`;
        replacements.push({ path, dataUrl, create: !resolution.icons.some(file => file.path === path) && !resolution.spriteFolders.some(folder => folder.files.some(file => file.path === path)) });
      }
    }
  }
  return replacements;
}
