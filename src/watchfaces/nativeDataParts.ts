import type { CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part } from "../../electron/types";
import { NATIVE_DATA_BY_ID } from "../../electron/watchfaceNativeCatalog";

export function defaultNativeDataStyle(id: string): Style {
  return { enabled: true, x: 280, y: 500, scale: 1, color: "#ffffff", ...(id === "chart" ? { chartSource: "chart_stress", chartWidth: 240, chartHeight: 120, chartStyle: { previewType: "bars" as const } } : {}) };
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
    ...(!id.startsWith("weather_temp") ? ["icon" as const] : []), "value",
    ...(field?.unit || field?.unitKey ? ["unit" as const] : []),
    ...(id.startsWith("weather_temp") ? ["symbols" as const] : []),
    ...(field?.stateKey ? ["states" as const] : [])
  ];
}

export function nativePart(id: string, style: Style, part: Part) {
  const width = style.chartWidth ?? 240, height = style.chartHeight ?? 120;
  const chartMoon = id === "chart" && style.chartSource === "chart_moon";
  const defaults = {
    value: { x: id.startsWith("weather_temp") || style.parts?.icon?.enabled === false ? 0 : 40, y: 0, width: 96, height: 48 },
    icon: { x: 0, y: 0, width: 36, height: 48 },
    states: { x: 0, y: 0, width: chartMoon ? 48 : 96, height: 48 },
    unit: { x: 0, y: 0, width: 38, height: 48 },
    symbols: { x: 0, y: 0, width: id.startsWith("weather_temp") ? 38 : isNativeTime(id, style) ? 18 : 24, height: 48 },
    progress: { x: 0, y: 58, width: 24, height: 24 },
    plot: { x: 0, y: 58, width, height },
    decimal: { x: 0, y: 0, width: 18, height: 48 },
    background: { x: 0, y: 58, width, height },
    mask: { x: 0, y: 58, width, height },
    noDataMask: { x: 0, y: 58, width, height }
  }[part];
  const custom = style.parts?.[part];
  return {
    enabled: custom?.enabled ?? (!["background", "mask", "noDataMask"].includes(part) && !(chartMoon && part === "plot") && !(["stamina", "weather_uv"].includes(id) && part === "states")),
    color: custom?.color ?? style.color, fontFamily: custom?.fontFamily || style.fontFamily || "Arial",
    x: custom?.x ?? defaults.x, y: custom?.y ?? defaults.y,
    width: custom?.width ?? defaults.width, height: custom?.height ?? defaults.height,
    digitWidth: custom?.digitWidth ?? (custom?.width ?? defaults.width) / 4,
    align: custom?.align ?? "left"
  };
}

export function nativeRolePart(role: Role): Part { return role === "digits" ? "value" : role; }
/** Recovered faces keep their original state-table size (official NOMAD ships eight wind directions). */
export function nativeStateCount(id: string, style: Style): number {
  return style.stateCount ?? NATIVE_DATA_BY_ID.get(id)?.stateCount ?? 1;
}
export function nativePartHasPosition(part: Part): boolean { return !["unit", "symbols", "decimal"].includes(part); }

const ICON_LABELS: Record<string, string> = {
  weather_temp: "°", weather_temp_min: "↓", weather_temp_max: "↑", weather_wind: "≈", weather_rainfall: "☂", weather_humidity: "%", weather_uv: "UV", weather_aqi: "AQ",
  stamina: "S", stress: "~", sleep_score: "Z", week_tl: "TL", baro: "P", step: "S", kcal: "K", elevation: "↑", sun_angle: "☀", moon_percent: "☾", tide: "≈"
};
export function nativeAssetText(id: string, style: Style, role: Role, index: number): string | null {
  const custom = style.assetTexts?.[role]?.[String(index)];
  if (custom !== undefined) return custom;
  if (role === "digits") return String(index);
  if (role === "symbols") return ["−", "°", "%", ":"][index] ?? "";
  if (role === "decimal") return ".";
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
