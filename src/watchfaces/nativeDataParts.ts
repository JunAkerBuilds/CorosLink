import type { CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceNativePartStyle as PartStyle } from "../../electron/types";
import { NATIVE_DATA_BY_ID, nativeHasIcon } from "../../electron/watchfaceNativeCatalog";

export function defaultNativeDataStyle(id: string): Style {
  return { enabled: true, x: 280, y: 500, scale: 1, color: "#ffffff", ...(id === "chart" ? { chartSource: "chart_stress", chartWidth: 240, chartHeight: 120 } : {}) };
}

export function isNativeTime(id: string, style: Style): boolean {
  return id === "sunriseset" || (id === "chart" && ["chart_sunrise", "chart_moonrise"].includes(style.chartSource ?? ""));
}

export function nativeParts(id: string, style: Style): Part[] {
  const field = NATIVE_DATA_BY_ID.get(id);
  if (field?.kind === "state") return ["states"];
  if (id === "chart") {
    const content: Part[] = style.chartSource === "chart_moon" ? ["states"] : ["icon", "value", "symbols"];
    return [...content, "plot", ...(style.chartSource === "chart_moon" ? [] : ["decimal" as const]), "background", "mask", "noDataMask"];
  }
  if (field?.kind === "solar") return ["icon", "value", "symbols", "progress"];
  return [
    ...(field && nativeHasIcon(field) ? ["icon" as const] : []), "value",
    ...(field?.unit || field?.unitKey ? ["unit" as const] : []),
    ...(id.startsWith("weather_temp") ? ["symbols" as const] : []),
    // Drawn between minimum and maximum, which the watch shows as one reading.
    ...(id === "weather_temp_min" ? ["separator" as const] : []),
    ...(field?.stateKey ? ["states" as const] : [])
  ];
}

export function nativePart(id: string, style: Style, part: Part) {
  const width = style.chartWidth ?? 240, height = style.chartHeight ?? 120;
  const chartMoon = id === "chart" && style.chartSource === "chart_moon";
  // The separator defaults to one digit cell, like the official "/" glyphs.
  const valueStyle = style.parts?.value, valueHeight = valueStyle?.height ?? 48;
  const defaults = {
    value: { x: !nativeParts(id, style).includes("icon") || style.parts?.icon?.enabled === false ? 0 : 40, y: 0, width: 96, height: 48 },
    icon: { x: 0, y: 0, width: 36, height: 48 },
    states: { x: 0, y: 0, width: chartMoon ? 48 : 96, height: 48 },
    unit: { x: 0, y: 0, width: 38, height: 48 },
    symbols: { x: 0, y: 0, width: id.startsWith("weather_temp") ? 38 : isNativeTime(id, style) ? 18 : 24, height: 48 },
    progress: { x: 0, y: 58, width: 24, height: 24 },
    plot: { x: 0, y: 58, width, height },
    decimal: { x: 0, y: 0, width: 18, height: 48 },
    background: { x: 0, y: 58, width, height },
    mask: { x: 0, y: 58, width, height },
    noDataMask: { x: 0, y: 58, width, height },
    separator: { x: 0, y: 0, width: valueStyle?.digitWidth ?? (valueStyle?.width ?? 96) / 4, height: valueHeight }
  }[part];
  const custom = style.parts?.[part];
  return {
    enabled: custom?.enabled ?? (!["background", "mask", "noDataMask"].includes(part) && !(chartMoon && part === "plot") && !(["stamina", "weather_uv"].includes(id) && part === "states")),
    color: custom?.color ?? style.color, fontFamily: custom?.fontFamily || style.fontFamily || "Arial",
    fontWeight: custom?.fontWeight ?? style.fontWeight ?? 400,
    fontStyle: custom?.fontStyle ?? style.fontStyle ?? "normal",
    letterSpacing: custom?.letterSpacing ?? style.letterSpacing ?? 0,
    x: custom?.x ?? defaults.x, y: custom?.y ?? defaults.y,
    width: custom?.width ?? defaults.width, height: custom?.height ?? defaults.height,
    digitWidth: custom?.digitWidth ?? (custom?.width ?? defaults.width) / 4,
    align: custom?.align ?? "left"
  };
}

export function nativeRolePart(role: Role): Part { return role === "digits" ? "value" : role; }
export function nativePartRole(part: Part): Role | null { return part === "value" ? "digits" : part === "plot" ? null : part; }

/** Generated text fills this share of its sprite's height (before it shrinks to fit the width). */
const NATIVE_TEXT_EM = 0.75;
export function nativeTextFontSize(spriteHeight: number): number { return Math.round(spriteHeight * NATIVE_TEXT_EM); }

/** Whether a role's sprites are drawn as text in a font, rather than images. */
export function nativeRoleDrawsText(style: Style, role: Role): boolean {
  return !Object.keys(style.assets?.[role] ?? {}).length;
}

/**
 * A component's Font size in master pixels, after the layer's scale: the em
 * its text draws at, or the height of its images (as PNG digits elsewhere).
 */
export function nativeComponentFontSize(id: string, style: Style, part: Part): number {
  const role = nativePartRole(part), height = nativePart(id, style, part).height;
  return (role && nativeRoleDrawsText(style, role) ? nativeTextFontSize(height) : height) * style.scale;
}

/** The component a layer's Font size names: its number, or the state artwork of a field without one. */
export function nativeFontSizePart(id: string, style: Style): Part {
  const parts = nativeParts(id, style);
  return parts.includes("value") ? "value" : parts[0];
}

/** The layer scale that draws that component at `fontSize` master pixels, within the scale's 0.1–4 range. */
export function nativeScaleForFontSize(id: string, style: Style, fontSize: number): number {
  const base = nativeComponentFontSize(id, { ...style, scale: 1 }, nativeFontSizePart(id, style));
  return Math.round(Math.max(0.1, Math.min(4, fontSize / Math.max(1, base))) * 1000) / 1000;
}

/** Resizes a component's sprite box so its text draws at `fontSize` master pixels, keeping the box's shape. */
export function nativePartForFontSize(id: string, style: Style, part: Part, fontSize: number): Pick<PartStyle, "width" | "height" | "digitWidth"> {
  const current = nativePart(id, style, part);
  const factor = fontSize / Math.max(1, nativeComponentFontSize(id, style, part));
  const fit = (value: number) => Math.round(Math.max(4, Math.min(800, value * factor)));
  return { width: fit(current.width), height: fit(current.height), ...(part === "value" ? { digitWidth: Math.max(1, Math.round(current.digitWidth * factor)) } : {}) };
}

/** Glyph artwork a font can draw instead. Icons and state frames stay pictures. */
const FONT_ROLES = ["digits", "symbols", "decimal", "unit", "separator"] as const satisfies readonly Role[];
export function nativeFontRole(role: Role): boolean { return (FONT_ROLES as readonly Role[]).includes(role); }
/** Whether the layer has glyph images (a template's digits, signs or units), drawn or set aside for a font. */
export function nativeHasGlyphArt(style: Style): boolean {
  return FONT_ROLES.some(role => Object.keys(style.assets?.[role] ?? {}).length || Object.keys(style.fontReplacedAssets?.[role] ?? {}).length);
}

/**
 * Picks a font for the layer, or for one component. Images draw instead of
 * text, so a template's digit, sign and unit images would hide any font: the
 * images a font now draws move to `fontReplacedAssets`, and picking the
 * template font again (an empty family) brings them back.
 */
export function withNativeFont(style: Style, fontFamily: string, part?: Part): Pick<Style, "fontFamily" | "parts" | "assets" | "fontReplacedAssets"> {
  const family = fontFamily || undefined;
  const parts = part ? { ...style.parts, [part]: { ...style.parts?.[part], fontFamily: family } } : style.parts;
  const layerFamily = part ? style.fontFamily || undefined : family;
  const assets = { ...style.assets }, replaced = { ...style.fontReplacedAssets };
  for (const role of FONT_ROLES) {
    const owner = nativeRolePart(role);
    // A layer font skips components that keep a font of their own.
    if (part ? owner !== part : style.parts?.[owner]?.fontFamily) continue;
    const [from, to] = parts?.[owner]?.fontFamily || layerFamily ? [assets, replaced] : [replaced, assets];
    if (!from[role]) continue;
    // Images in place were imported after the font set the others aside, so they win.
    to[role] = { ...replaced[role], ...assets[role] };
    delete from[role];
  }
  return { fontFamily: layerFamily, parts, assets: Object.keys(assets).length ? assets : undefined,
    fontReplacedAssets: Object.keys(replaced).length ? replaced : undefined };
}

/** Recovered faces keep their original state-table size (official NOMAD ships eight wind directions). */
export function nativeStateCount(id: string, style: Style): number {
  return style.stateCount ?? NATIVE_DATA_BY_ID.get(id)?.stateCount ?? 1;
}
export function nativePartHasPosition(part: Part): boolean { return !["unit", "symbols", "decimal", "separator"].includes(part); }

const ICON_LABELS: Record<string, string> = {
  weather_temp: "°", weather_temp_min: "↓", weather_temp_max: "↑", weather_wind: "≈", weather_rainfall: "☂", weather_humidity: "%", weather_uv: "UV", weather_aqi: "AQ",
  stamina: "S", stress: "~", heart_rate: "♥", sleep_score: "Z", week_tl: "TL", baro: "P", step: "S", kcal: "K", elevation: "↑", sun_angle: "☀", moon_percent: "☾", tide: "≈"
};
export function nativeAssetText(id: string, style: Style, role: Role, index: number): string | null {
  const custom = style.assetTexts?.[role]?.[String(index)];
  if (custom !== undefined) return custom;
  if (role === "digits") return String(index);
  if (role === "symbols") return ["−", "°", "%", ":"][index] ?? "";
  if (role === "decimal") return ".";
  if (role === "separator") return "/";
  if (role === "progress") return index ? "☾" : "☀";
  if (role === "states") return id === "sleep_hrv_level" ? `HRV ${index}` : null;
  if (role === "unit") {
    if (id.startsWith("weather_temp_")) return index ? "°F" : "°C";
    return NATIVE_DATA_BY_ID.get(id)?.unit ?? (id.endsWith("elev") ? (index ? "ft" : "m") : id.endsWith("swim") ? (index ? "yd" : "m") : (index ? "mi" : "km"));
  }
  if (role !== "icon") return null;
  if (isNativeTime(id, style)) return index ? "↓" : "↑";
  const key = id === "chart" ? style.chartSource?.replace(/^chart_/, "") ?? "stress" : id;
  return ICON_LABELS[key] ?? (id.includes("run") ? "R" : id.includes("swim") ? "S" : id.includes("bike") ? "B" : "↑");
}

export function nativeRoleIndices(id: string, style: Style, role: Role): number[] {
  if (role === "digits") return Array.from({ length: 10 }, (_, i) => i);
  if (role === "states") return Array.from({ length: id === "chart" ? 30 : nativeStateCount(id, style) }, (_, i) => i);
  if (role === "symbols") return id.startsWith("weather_temp") ? [0] : id === "sunriseset" ? [3] : [0, 1, 2, 3];
  if (role === "icon") return isNativeTime(id, style) ? [0, 1] : [0];
  if (role === "progress" || (role === "unit" && (id.startsWith("weather_temp_") || NATIVE_DATA_BY_ID.get(id)?.unitKey))) return [0, 1];
  return [0];
}
