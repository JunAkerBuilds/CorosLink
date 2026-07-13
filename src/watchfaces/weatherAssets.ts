import type {
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceResolutionDetails,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import { loadStudioImage, parseConfigPos, pickPreviewResolution } from "./watchfaceStudio";

export interface WatchfaceWeatherStyle {
  enabled: boolean;
  /** Top-left corner in preview-resolution coordinates. */
  x: number;
  y: number;
  scale: number;
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
    const values = style.enabled
      ? {
          weather_icon_pos: `{${Math.round(style.x * scale)},${Math.round(style.y * scale)}}`,
          weather_icon_dir: "weather"
        }
      : { weather_icon_pos: "", weather_icon_dir: "" };
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
      urls.map((url) => imageUrlToDataUrl(url, edge))
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
