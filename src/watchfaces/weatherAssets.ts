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
  parseConfigRect,
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
}

const weather416 = import.meta.glob(
  "../assets/watchfaces/weather/416/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;
const weather800 = import.meta.glob(
  "../assets/watchfaces/weather/800/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

function orderedUrls(files: Record<string, string>): string[] {
  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, url]) => url);
}

const urls416 = orderedUrls(weather416);
const urls800 = orderedUrls(weather800);

/**
 * Existing weather-enabled templates dictate their own frame dimensions. For
 * example, the decoded PLANET and GO FISHING binaries both target 416px
 * screens but use 76px and 42px frames respectively. Keep an existing weather
 * folder's dimensions exact; only use our bundled-art dimensions when adding
 * weather to a template that does not already have the feature.
 */
function weatherSpriteSize(resolution: CorosWatchfaceResolutionDetails): number {
  const folder = resolution.spriteFolders.find(
    (item) =>
      item.folder.replace(/^a\//i, "").toLowerCase() === "weather" &&
      item.files.length === 41 &&
      item.files.every((file) => file.width === file.height)
  );
  if (folder?.files[0]) {
    return folder.files[0].width;
  }
  return resolution.width >= 800 ? 123 : 64;
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
          weather_icon_dir: "weather"
        }
      : {
          weather_icon_pos: COROS_CONFIG_DELETE_VALUE,
          weather_icon_dir: COROS_CONFIG_DELETE_VALUE
        };
    const hasWeatherKeys = (config: Record<string, string>) =>
      Object.prototype.hasOwnProperty.call(config, "weather_icon_pos") ||
      Object.prototype.hasOwnProperty.call(config, "weather_icon_dir");
    const overrides: CorosWatchfaceConfigOverride[] = [];

    // AODconfig uses the same weather source folder. COROS compiles it into a
    // separate dimmed 41-frame table, so do not add a second `a/weather` tree.
    if (style.enabled || hasWeatherKeys(resolution.config)) {
      overrides.push({
        path: `${resolution.directory}/config.txt`,
        values
      });
    }
    if (
      Object.keys(resolution.aodConfig).length > 0 &&
      (style.enabled || hasWeatherKeys(resolution.aodConfig))
    ) {
      overrides.push({
        path: `${resolution.directory}/AODconfig.txt`,
        values
      });
    }
    return overrides;
  });
}

/**
 * Auto-places the fixed temperature element beside the weather icon when both
 * are enabled. `buildMetricOverrides` emits `temperature_rect` at a default
 * spot; this reads that existing rect (for its size and alignment) and moves it
 * to sit just right of the weather icon, vertically centered on it. It targets
 * only resolutions where the fixed temperature is active, and no-ops otherwise,
 * so it never invents a temperature element the design did not ask for.
 */
export function buildWeatherTemperaturePlacementOverrides(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceWeatherStyle
): CorosWatchfaceConfigOverride[] {
  if (!style.enabled) {
    return [];
  }
  const base = pickPreviewResolution(details);
  if (!base) {
    return [];
  }
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const rawValue = resolution.config.temperature_rect;
    const rect = parseConfigRect(rawValue);
    if (!rect) {
      // Temperature is not active on this resolution; leave it untouched.
      continue;
    }
    const resScale = resolution.width / base.width;
    const iconSize = weatherSpriteSize(resolution) * style.scale;
    const iconX = style.x * resScale;
    const iconY = style.y * resScale;
    const width = rect.x1 - rect.x0;
    const height = rect.y1 - rect.y0;
    const gap = Math.max(2, Math.round(iconSize * 0.12));
    const x0 = Math.max(
      0,
      Math.min(Math.round(iconX + iconSize + gap), resolution.width - width)
    );
    const y0 = Math.max(
      0,
      Math.min(
        Math.round(iconY + iconSize / 2 - height / 2),
        resolution.height - height
      )
    );
    const suffix =
      rawValue?.match(
        /^\{\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*((?:,[^}]*)?)\}$/
      )?.[1] || ",hcenter|vcenter";
    overrides.push({
      path: `${resolution.directory}/config.txt`,
      values: {
        temperature_rect: `{${x0},${y0},${x0 + width},${y0 + height}${suffix}}`
      }
    });
  }
  return overrides;
}

async function imageUrlToDataUrl(url: string, edge: number): Promise<string> {
  const image = await loadStudioImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(edge));
  canvas.height = Math.max(1, Math.round(edge));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Weather sprite rendering is unavailable in this window.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function weatherPreviewUrl(width: number): string {
  return (width >= 800 ? urls800 : urls416)[0] ?? "";
}

export async function weatherPreviewDataUrl(
  width: number,
  color?: string
): Promise<string> {
  const url = weatherPreviewUrl(width);
  if (!url || !color) return url;
  const edge = width >= 800 ? 123 : 64;
  return resizeAndTintSprite(url, edge, edge, color);
}

export async function buildWeatherSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceWeatherStyle
): Promise<CorosWatchfaceAssetReplacement[]> {
  if (!style.enabled) {
    return [];
  }
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const resolution of details.resolutions) {
    const urls = resolution.width >= 800 ? urls800 : urls416;
    if (urls.length !== 41) {
      throw new Error("The stored weather set must contain exactly 41 sprites.");
    }
    const edge = weatherSpriteSize(resolution) * style.scale;
    const dataUrls = await Promise.all(
      urls.map(async (url) => {
        const dataUrl = await imageUrlToDataUrl(url, edge);
        return style.color
          ? resizeAndTintSprite(dataUrl, Math.round(edge), Math.round(edge), style.color)
          : dataUrl;
      })
    );
    dataUrls.forEach((dataUrl, index) => {
      const path = `${resolution.directory}/weather/${String(index).padStart(2, "0")}.png`;
      replacements.push({
        path,
        dataUrl,
        // A weather-enabled starter already has these assets. Replace them
        // in place; marking them as new makes archive validation reject the
        // collision before COROS gets a chance to compile the face.
        create: !resolution.spriteFolders.some((folder) =>
          folder.files.some((file) => file.path === path)
        )
      });
    });
  }
  return replacements;
}
