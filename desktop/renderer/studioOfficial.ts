// What a pick from the official COROS library writes into a face: an image layer (Add → Official), a template image's
// replacement, a PNG digit set, the battery icon's states and the weather icon's day, night and temperature sets.
// Each is the edit CorosLink's editor makes for the same pick (its chooseSprite, chooseConfigAsset,
// chooseRasterSpriteFolder, chooseBatterySpriteFolder and chooseWeatherSpriteFolder with an official preset), so a face
// set up here and one set up there are the same file. Pure functions over the design.
import type { CorosWatchfaceArtwork, CorosWatchfaceDesignSprite, CorosWatchfaceRasterFontFolder } from "../watchface/types";
import { resolveWatchfaceArtworkLayerOrder, watchfaceSpriteLayerId } from "../watchface/engine/watchfaceArtworkLayers";
import { MAX_DESIGN_SPRITES } from "../watchface/engine/watchfaceBackground";
import { WEATHER_ASSET_COUNTS, type WeatherAssetSet } from "../watchface/engine/weatherAssets";
import { officialCategoryForConfigKey } from "../watchface/officialAssetSets";
import type { OfficialFrames, OfficialQuery } from "./studio";
import type { PanelKind } from "./studioEdits";
import type { Design, EditorLayer } from "./studioFace";

/** How the browser is opened: any image (one frame is taken), a whole set of states, or a digit or label font. */
export type OfficialMode = "image" | "sprites" | "font";
/** What an entry point asks the browser for. */
export interface OfficialRequest {
  mode: OfficialMode;
  title: string;
  /** The filters it opens on; the person can change the ones the mode leaves free. */
  category?: string;
  role?: string;
  /** Only sets with exactly this many frames (10 digits, 7 weekdays, 12 months, 41 weather states). */
  frameCount?: number;
  /** Only sets a source face bound to this config key. */
  configKey?: string;
}

/** The filters a request fixes or starts on, as the library is asked. */
export function officialQuery(request: OfficialRequest): OfficialQuery {
  return {
    ...(request.mode === "font" ? { category: "fonts" } : request.category ? { category: request.category } : {}),
    ...(request.role ? { role: request.role } : {}),
    ...(request.frameCount ? { frameCount: request.frameCount } : {}),
    ...(request.configKey ? { configKey: request.configKey } : {}),
    ...(request.mode === "sprites" ? { frames: "multi" as const } : {}),
  };
}

/** One frame of a set, as the engine keeps artwork. */
export function officialArtwork(set: OfficialFrames, frame = 0): CorosWatchfaceArtwork {
  return { dataUrl: set.frames[frame] ?? set.frames[0], width: set.width, height: set.height };
}

/** A set as the folder of numbered PNGs the PNG-font and state imports already take. */
export function officialFolder(set: OfficialFrames): CorosWatchfaceRasterFontFolder {
  return {
    label: set.label,
    sprites: set.frames.map((dataUrl, i) => {
      const name = `${String(i).padStart(2, "0")}.png`;
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      return { name, relativePath: name, dataUrl, sizeBytes: Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0) };
    }),
  };
}

/**
 * Add → Official: the picked frame as an image layer in the middle of the face, in front of the other artwork.
 * `watchScale` is master pixels per watch pixel, so the image goes out 1:1 on the watch it was drawn for.
 */
export function addOfficialImage(design: Design, art: CorosWatchfaceArtwork, face: { width: number; height: number }, watchScale: number, id: string): Design {
  if ((design.designSprites ?? []).length >= MAX_DESIGN_SPRITES) throw new Error(`A face can hold up to ${MAX_DESIGN_SPRITES} images.`);
  const sprite: CorosWatchfaceDesignSprite = {
    id, dataUrl: art.dataUrl, sourceWidth: art.width, sourceHeight: art.height,
    width: Math.round(art.width * watchScale), height: Math.round(art.height * watchScale),
    x: Math.round(face.width / 2), y: Math.round(face.height / 2),
    scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false, skewX: 0, skewY: 0, aspectLocked: true,
    crop: { x: 0, y: 0, width: 1, height: 1 }, origin: { x: 0.5, y: 0.5 }, visible: true, tintColor: null,
  };
  return { ...design, designSprites: [...(design.designSprites ?? []), sprite], artworkLayerOrder: [...resolveWatchfaceArtworkLayerOrder(design), watchfaceSpriteLayerId(id)] };
}

/** The battery icon's states from a set: frame 0 charging, 1 empty, then the tens (the order COROS's own faces use). */
export function officialBatteryStates(set: OfficialFrames): Record<string, CorosWatchfaceArtwork> {
  if (set.frames.length < 2) throw new Error("Choose a set with a picture for each battery level.");
  return Object.fromEntries(set.frames.map((_, i) => [String(i), officialArtwork(set, i)]));
}

/** The weather icon's day or night pictures, or its temperature digits, from a set; states it lacks keep the built-in ones. */
export function setWeatherSet(design: Design, which: WeatherAssetSet, set: OfficialFrames): Design {
  if (set.frames.length > WEATHER_ASSET_COUNTS[which]) throw new Error(`That set has ${set.frames.length} pictures; ${which} takes ${WEATHER_ASSET_COUNTS[which]}.`);
  const states = Object.fromEntries(set.frames.map((dataUrl, i) => [String(i), dataUrl]));
  return { ...design, weatherIndicator: { enabled: true, x: 0, y: 0, scale: 1, ...design.weatherIndicator, assets: { ...design.weatherIndicator?.assets, [which]: states } } };
}

/** Back to the built-in pictures for one weather set. */
export function restoreWeatherSet(design: Design, which: WeatherAssetSet): Design {
  if (!design.weatherIndicator?.assets?.[which]) return design;
  const assets = { ...design.weatherIndicator.assets };
  delete assets[which];
  return { ...design, weatherIndicator: { ...design.weatherIndicator, assets } };
}

/** How many states of a weather set the face has replaced. */
export const weatherSetCount = (design: Design, which: WeatherAssetSet) => Object.keys(design.weatherIndicator?.assets?.[which] ?? {}).length;

// ───── What each entry point asks for ─────

/** The official digit (or weekday, month) sets for a layer's PNG font, opened on what the layer shows. */
export function officialFontRequest(layer: EditorLayer, kind: PanelKind, scope: "layer" | "face"): OfficialRequest {
  const labels = scope === "layer" && layer.id === "weekday" ? "weekday" : scope === "layer" && layer.id === "dateMonth" ? "month" : null;
  if (labels) return { mode: "font", title: `Official ${labels} labels`, role: "date", frameCount: labels === "weekday" ? 7 : 12 };
  const role = scope === "face" || kind === "time" ? "time" : kind === "date" ? "date"
    : /battery/i.test(`${layer.id} ${layer.metricId ?? ""}`) ? "battery" : /temp|weather/i.test(`${layer.id} ${layer.metricId ?? ""}`) ? "weather" : undefined;
  return { mode: "font", title: scope === "face" ? "Official COROS fonts" : `Official font for ${layer.label}`, ...(role ? { role } : {}), frameCount: 10 };
}

/** Official library for a template image: any single picture, opened on the category of the image being replaced. */
export function officialImageRequest(layer: EditorLayer): OfficialRequest {
  const key = (layer.configAssetId ?? layer.id).replace(/^(?:aod:)?config:/, "");
  const category = officialCategoryForConfigKey(key);
  return { mode: "image", title: `Official image for ${layer.label}`, ...(category ? { category } : {}) };
}

export function officialBatteryRequest(): OfficialRequest {
  return { mode: "sprites", title: "Official battery sprites", category: "battery" };
}

/** Day and night icons are 41-state sets; the temperature digits are a 10-frame weather font. */
export function officialWeatherRequest(which: "day" | "night" | "digits"): OfficialRequest {
  return which === "digits"
    ? { mode: "sprites", title: "Official temperature digits", category: "fonts", role: "weather", frameCount: WEATHER_ASSET_COUNTS.digits, configKey: "weather_temp_font" }
    : { mode: "sprites", title: `Official ${which} weather icons`, category: "weather", frameCount: WEATHER_ASSET_COUNTS[which], configKey: which === "day" ? "weather_icon_dir" : "weather_dark_icon_dir" };
}
