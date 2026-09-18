/** Parser bindings recovered from COROS 4.9.9. State-count defaults await device verification. */
interface NativeDataAvailability {
  status: "unavailable";
  label: string;
  message: string;
}

export interface NativeDataDefinition {
  id: string;
  label: string;
  category: "Weather" | "Astronomy" | "Health" | "Training" | "Charts";
  kind: "number" | "state" | "solar" | "chart";
  sample: string;
  version: number;
  unit?: string;
  percentKey?: string;
  unitKey?: string;
  stateKey?: string;
  stateCount?: number;
  /** Position key of a state table when it is not `${id}_pos`. */
  positionKey?: string;
  availability?: NativeDataAvailability;
  /** Shown in the inspector: scope or runtime caveats that are not an availability problem. */
  note?: string;
}
const number = (id: string, label: string, category: NativeDataDefinition["category"], sample: string, version = 3, extra: Partial<NativeDataDefinition> = {}): NativeDataDefinition => ({ id, label, category, sample, version, kind: "number", ...extra });
export const NATIVE_DATA_FIELDS: readonly NativeDataDefinition[] = [
  number("weather_temp", "Current weather", "Weather", "18", 0, { unit: "°" }),
  number("weather_temp_min", "Minimum temperature", "Weather", "12", 0, { unit: "°" }),
  number("weather_temp_max", "Maximum temperature", "Weather", "24", 0, { unit: "°" }),
  number("weather_wind", "Wind speed", "Weather", "14", 0),
  { id: "weather_direction", label: "Wind direction", category: "Weather", kind: "state", sample: "2", version: 0, stateKey: "weather_direction_icon_dir", positionKey: "weather_direction_icon_pos", stateCount: 16 },
  number("weather_rainfall", "Rain probability", "Weather", "35", 0, { unit: "%", percentKey: "weather_rainfall_percent_icon" }),
  number("weather_humidity", "Humidity", "Weather", "62", 0, { unit: "%", percentKey: "weather_humidity_percent_icon" }),
  // The level artwork is a categorical set: official DASHBOARD ships six frames
  // (unknown, then low → extreme) and no numeric UV readout.
  number("weather_uv", "UV index", "Weather", "4", 0, { stateKey: "weather_uv_level_icon", stateCount: 6 }),
  number("weather_aqi", "Air quality index", "Weather", "32", 0, { availability: {
    status: "unavailable",
    label: "Not available right now",
    message: "Live AQI is unavailable in current PACE Pro testing, including in the watch’s Weather widget. The editor uses a sample value. Availability depends on COROS weather data."
  } }),
  number("week_tl", "Weekly training load", "Training", "420"),
  number("stamina", "Stamina", "Health", "82", 3, { unit: "%", percentKey: "stamina_percent_icon", stateKey: "stamina_level_icon", stateCount: 11 }),
  number("stress", "Stress", "Health", "28"),
  number("sleep_score", "Sleep score", "Health", "86", 6),
  { id: "sleep_hrv_level", label: "Sleep HRV status", category: "Health", kind: "state", sample: "1", version: 3, stateKey: "sleep_hrv_level_icon", stateCount: 8 },
  // WFStatusInfo.sedentary: official DASHBOARD (format 4) ships seven frames —
  // seated with a filling ring, a "move" frame, then a dimmed inactive frame.
  { id: "sedentary", label: "Sedentary reminder", category: "Health", kind: "state", sample: "2", version: 4, stateKey: "sedentary_icon_dir", positionKey: "sedentary_icon_pos", stateCount: 7 },
  number("baro", "Barometer", "Weather", "1013"),
  ...(["today", "week"] as const).flatMap(period => ([
    ["run", "running"], ["bike", "cycling"], ["swim", "swimming"], ["elev", "elevation"]
  ] as const).map(([type, label]) => number(`${period}_${type}`, `${period === "today" ? "Today's" : "Weekly"} ${label}`, "Training", type === "elev" ? "240" : "12", 3, { unitKey: `${period}_${type}_unit_icon` }))),
  { id: "sunriseset", label: "Sunrise / sunset progress", category: "Astronomy", kind: "solar", sample: "06:24", version: 5 },
  // WFChartInfo.sun_angle: a readout of the native chart block that the watch
  // shows in its sun chart group (official NOMAD draws it in the temperature slot).
  number("chart_sun_angle", "Solar angle (chart sun group)", "Astronomy", "36", 2, { unit: "°", percentKey: "chart_dgree_icon",
    note: "Part of the native chart block. The watch shows this readout only while its chart is on the sun group, sharing the chart's degree artwork." }),
  { id: "chart", label: "Native chart", category: "Charts", kind: "chart", sample: "28", version: 2 }
];
export const NATIVE_CHART_SOURCES = [
  { id: "chart_stress", label: "Stress", category: "Health" },
  { id: "chart_stamina", label: "Stamina", category: "Health" },
  { id: "chart_step", label: "Steps", category: "Training" },
  { id: "chart_kcal", label: "Calories", category: "Training" },
  { id: "chart_elevation", label: "Elevation", category: "Training" },
  { id: "chart_baro", label: "Barometer", category: "Weather" },
  { id: "chart_sunrise", label: "Sunrise / sunset", category: "Astronomy" },
  { id: "chart_moonrise", label: "Moonrise / moonset", category: "Astronomy" },
  { id: "chart_moon", label: "Moon phase", category: "Astronomy" },
  { id: "chart_tide", label: "Tide", category: "Astronomy" },
  { id: "chart_sun_angle", label: "Sun angle", category: "Astronomy" },
  { id: "chart_moon_percent", label: "Moon illumination", category: "Astronomy" }
] as const;
export const NATIVE_DATA_BY_ID = new Map(NATIVE_DATA_FIELDS.map(field => [field.id, field]));

/** Graph geometry, styling, masks and glyphs shared by every chart readout. */
export const NATIVE_CHART_SHARED_KEYS = ["chart_pos", "chart_bg", "chart_rect", "chart_bar_width", "chart_bar_interval", "chart_selected_bar_color", "chart_unselected_bar_color", "chart_curves_upper_color", "chart_curves_lower_color", "chart_curves_width", "chart_bar_mask", "chart_bar_mask_pos", "chart_bar_nodata_mask", "chart_bar_nodata_mask_pos", "chart_point_icon", "chart_percent_icon", "chart_dgree_icon", "chart_negasign_icon", "chart_colon_icon"] as const;
/** Config keys of one chart readout (`chart_index` group member). */
export function nativeChartSourceKeys(source: string): string[] {
  if (source === "chart_moon") return ["chart_moon_icon_pos", "chart_moon_icon"];
  if (source === "chart_sunrise" || source === "chart_moonrise") {
    return [`${source}_hour_rect`, `${source}_minute_rect`, `${source}_font`, `${source}_icon_pos`, `${source}_icon`, source === "chart_sunrise" ? "chart_sunset_icon" : "chart_moonset_icon"];
  }
  return [`${source}_icon_pos`, `${source}_icon`, `${source}_rect`, `${source}_font`];
}
/** Which Back-button chart group (documented by COROS for NOMAD) a readout belongs to. */
export function nativeChartGroup(source: string | undefined): "general" | "sun" | "moon" | "barometer" | "tide" | undefined {
  if (!source) return undefined;
  if (["chart_sunrise", "chart_sun_angle"].includes(source)) return "sun";
  if (["chart_moonrise", "chart_moon", "chart_moon_percent"].includes(source)) return "moon";
  if (source === "chart_baro") return "barometer";
  if (source === "chart_tide") return "tide";
  return "general";
}

export function nativeStatePositionKey(field: NativeDataDefinition): string {
  return field.positionKey ?? `${field.id}_pos`;
}
export function nativeFieldKeys(field: NativeDataDefinition): string[] {
  if (field.kind === "state") return [field.stateKey!, nativeStatePositionKey(field)];
  if (field.kind === "solar") return ["sunriseset_hour_rect", "sunriseset_minute_rect", "sunriseset_font", "sunriseset_icon_pos", "sunriseset_sunrise_icon", "sunriseset_sunset_icon", "sunriseset_colon_icon", "sunriseset_progress_pos", "sunrise_progress", "sunset_progress"];
  if (field.kind === "chart") return [...NATIVE_CHART_SHARED_KEYS, "chart_sun_icon_pos", "chart_sun_icon", ...NATIVE_CHART_SOURCES.flatMap(({ id }) => nativeChartSourceKeys(id))];
  return [`${field.id}_rect`, `${field.id}_font`, ...(!field.id.startsWith("weather_temp") ? [`${field.id}_icon_pos`, `${field.id}_icon`] : []), ...(field.percentKey ? [field.percentKey] : []), ...(field.unitKey ? [field.unitKey] : []), ...(field.stateKey ? [`${field.id}_level_pos`, field.stateKey] : [])];
}
export const NATIVE_DATA_CONFIG_KEYS = new Set([
  ...NATIVE_DATA_FIELDS.flatMap(nativeFieldKeys),
  "weather_negasign_icon", "weather_dgree_icon", "weather_temp_max_min_negasign_icon", "weather_temp_max_min_dgree_icon"
]);

export const NATIVE_ASSET_ROLES = ["digits", "icon", "states", "unit", "symbols", "progress", "decimal", "background", "mask", "noDataMask"] as const;
export const NATIVE_PARTS = ["value", "icon", "states", "unit", "symbols", "progress", "plot", "decimal", "background", "mask", "noDataMask"] as const;
export function nativeAssetCount(id: string, role: string): number {
  if (role === "digits") return 10;
  if (role === "states") return id === "chart" ? 30 : NATIVE_DATA_BY_ID.get(id)?.stateCount ?? 1;
  if (role === "icon") return id === "sunriseset" || id === "chart" ? 2 : 1;
  if (role === "unit" || role === "progress") return 2;
  if (role === "symbols") return 4;
  return 1;
}
