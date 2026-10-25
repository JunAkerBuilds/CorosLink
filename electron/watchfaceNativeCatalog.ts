/** Parser bindings recovered from COROS 4.9.9. State-count defaults await device verification. */
interface NativeDataAvailability {
  status: "unavailable";
  label: string;
  message: string;
}

export interface NativeDataDefinition {
  id: string;
  label: string;
  category: "Calendar" | "Weather" | "Astronomy" | "Health" | "Training" | "Charts";
  kind: "number" | "state" | "solar" | "chart";
  sample: string;
  version: number;
  /** Native config name when the editor ID differs from the compiler binding. */
  configPrefix?: string;
  /** Some numeric bindings (including calendar year) have digits only. */
  valueOnly?: boolean;
  unit?: string;
  percentKey?: string;
  unitKey?: string;
  /** CorosLink-only decimal point of an activity total (watchfaceCompiler/studioFields.ts). */
  decimalKey?: string;
  /** Whether that point shows unless the layer turns it off. */
  decimalShown?: boolean;
  stateKey?: string;
  stateCount?: number;
  /** Position key of a state table when it is not `${id}_pos`, or of a number's level artwork when it is not `${id}_level_pos`. */
  positionKey?: string;
  availability?: NativeDataAvailability;
  /** Shown in the inspector: scope or runtime caveats that are not an availability problem. */
  note?: string;
}
const number = (id: string, label: string, category: NativeDataDefinition["category"], sample: string, version = 3, extra: Partial<NativeDataDefinition> = {}): NativeDataDefinition => ({ id, label, category, sample, version, kind: "number", ...extra });
const SWIM_NOTE = "In metric units the watch counts swims in kilometres, like runs, and in imperial units in yards. Without the decimal point it rounds to whole kilometres, so 750 m shows 1; with it, 0.75. The decimal point needs CorosLink's compiler and is not yet confirmed on a watch.";
const DISTANCE_NOTE = "The watch rounds to whole kilometres or miles. Turn on the decimal point to show hundredths, such as 12.34. The decimal point needs CorosLink's compiler and is not yet confirmed on a watch.";
export const NATIVE_DATA_FIELDS: readonly NativeDataDefinition[] = [
  number("date_year", "Year", "Calendar", "2026", 3, { configPrefix: "control_number_date_year", valueOnly: true,
    note: "Live calendar year binding recovered from COROS 4.9.9. Independently positioned and visible in the editor; it does not require a visible selectable metric. Unlike month/day, COROS stores it in the shared control container. Export preserves the required origin and converts editor coordinates automatically; do not enable or move the selectable metric to place the year. Preview follows the simulation date; device support requires on-watch verification." }),
  number("weather_temp", "Current weather", "Weather", "18", 0, { unit: "°" }),
  // A PACE-series watch drew min/max as one run from the minimum's position
  // (issue #131, 2026-09-27): "1327°C", with the maximum's own rectangle ignored.
  number("weather_temp_min", "Minimum temperature", "Weather", "12", 0, { unit: "°",
    note: "The watch draws minimum and maximum temperature as one reading: minimum, separator, maximum, then one unit. With both shown, this layer places the reading and supplies the separator, unit and minus artwork." }),
  number("weather_temp_max", "Maximum temperature", "Weather", "24", 0, { unit: "°",
    note: "The watch draws the maximum straight after the minimum and its separator, not at a position of its own. With both shown, move the minimum to place the reading." }),
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
  // The 4.9.9 parser reads stress_level_icon as a categorical level at
  // stress_level_icon_pos (not stress_level_pos). The watch reports stress as
  // level 1–4 (corosDailyRecord.ts), so five frames: no data, then those four.
  // No official face with this artwork has been found to confirm the count.
  number("stress", "Stress", "Health", "28", 3, { stateKey: "stress_level_icon", positionKey: "stress_level_icon_pos", stateCount: 5,
    note: "State artwork has five frames: no data, then Relaxed (0–25), Low (26–50), Medium (51–75) and High (76–100). The order is not yet confirmed on a watch." }),
  number("sleep_score", "Sleep score", "Health", "86", 6),
  { id: "sleep_hrv_level", label: "Sleep HRV status", category: "Health", kind: "state", sample: "1", version: 3, stateKey: "sleep_hrv_level_icon", stateCount: 8 },
  // WFStatusInfo.sedentary: official DASHBOARD (format 4) ships seven frames —
  // seated with a filling ring, a "move" frame, then a dimmed inactive frame.
  { id: "sedentary", label: "Sedentary reminder", category: "Health", kind: "state", sample: "2", version: 4, stateKey: "sedentary_icon_dir", positionKey: "sedentary_icon_pos", stateCount: 7 },
  number("baro", "Barometer", "Weather", "1013"),
  // PACE Pro 3.2008.0 gets distances in hundredths of a km or mile (of a yard
  // for imperial swims) and rounds them to whole units unless the face gives
  // the total a decimal point (studioFields.ts). So a metric swim counts in
  // kilometres too: 750 m showed 1 and 300 m showed 0 (issue #153).
  ...(["today", "week"] as const).flatMap(period => ([
    ["run", "running"], ["bike", "cycling"], ["swim", "swimming"], ["elev", "elevation"]
  ] as const).map(([type, label]) => number(`${period}_${type}`, `${period === "today" ? "Today's" : "Weekly"} ${label}`, "Training",
    type === "elev" ? "240" : type === "swim" ? "1.85" : "12.34", 3, { unitKey: `${period}_${type}_unit_icon`,
      ...(type === "elev" ? {} : { decimalKey: `${period}_${type}_point_icon`, decimalShown: type === "swim", note: type === "swim" ? SWIM_NOTE : DISTANCE_NOTE }) }))),
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
  // CorosLink-only keys (compiler/studioFields.ts): COROS's own compiler drops them.
  { id: "chart_heart_rate", label: "Heart rate", category: "Health" },
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
/**
 * How the watch plots a chart group's history; nothing in the face selects it.
 * With bars and a line both configured, a PACE Pro drew SATISFY 1's sun group
 * as a line and its barometer group as bars (2026-10-12). Official SATISFY 1/2
 * (sun and moon groups) set only a line width; SATISFY 3 sets only a bar width
 * for its barometer and tide groups. Barometer and tide pages stay blank until
 * the phone syncs their data, so a blank page says nothing about the style.
 * The daily-data group (stress, stamina, steps, calories, elevation) is a page
 * of readouts with no graph: official NOMAD, MARK and NIGHT CLIMBER lay those
 * readouts across chart_rect and over the chart_bg plot frame, and NOMAD gives
 * that page its own chart_item3_bg divider.
 */
export function nativeChartRepresentation(source: string | undefined): "bars" | "curve" | "none" {
  const group = nativeChartGroup(source ?? "chart_stress");
  return group === "sun" || group === "moon" ? "curve" : group === "general" ? "none" : "bars";
}

/**
 * The daily-data group is two readout pages under one divider, each with a
 * left, right and lower slot (PACE Pro, official NOMAD, 2026-10-16):
 * stress / stamina / elevation, then calories / heart rate / steps.
 */
export const NATIVE_CHART_DAILY_PAGES = [["chart_stress", "chart_stamina", "chart_elevation"], ["chart_kcal", "chart_heart_rate", "chart_step"]] as const;
/**
 * Chart readouts with CorosLink-only config keys (compiler/studioFields.ts).
 * BIN WFChartInfo.heart_rate has no 4.9.9 key: Studio writes chart_heart_rate_*,
 * which the built-in compiler keeps and COROS's compiler ignores. Daily page B
 * needs it, so faces compiled by the COROS app never show that page.
 */
export const NATIVE_CHART_STUDIO_READOUTS = ["chart_heart_rate"] as const;
export function nativeChartDailyPage(source: string | undefined): readonly string[] | undefined {
  return NATIVE_CHART_DAILY_PAGES.find(page => (page as readonly string[]).includes(source ?? "chart_stress"));
}

/**
 * Every page the watch's Back button cycles through, in firmware order. PACE
 * Pro 3.2008.0 builds a seven-entry page table (function at 0x4544a0, read
 * 2026-10-20): barometer and tide whenever the bar width is not 0, readout or
 * not; fishing with its font; sun with a sunrise readout; moon with a
 * moonrise readout; each daily page only when all three of its readouts have a
 * font. Back skips missing entries. Studio has no fishing page.
 */
export const NATIVE_CHART_PAGES: ReadonlyArray<{ id: string; label: string; sources: readonly string[]; required: readonly string[] }> = [
  { id: "barometer", label: "Barometer", sources: ["chart_baro"], required: [] },
  { id: "tide", label: "Tide", sources: ["chart_tide"], required: [] },
  { id: "sun", label: "Sun", sources: ["chart_sunrise", "chart_sun_angle"], required: ["chart_sunrise"] },
  { id: "moon", label: "Moon", sources: ["chart_moonrise", "chart_moon", "chart_moon_percent"], required: ["chart_moonrise"] },
  { id: "daily-a", label: "Daily data · A", sources: NATIVE_CHART_DAILY_PAGES[0], required: NATIVE_CHART_DAILY_PAGES[0] },
  { id: "daily-b", label: "Daily data · B", sources: NATIVE_CHART_DAILY_PAGES[1], required: NATIVE_CHART_DAILY_PAGES[1] }
];
/** Pages the firmware keeps only while the chart draws bars (bar width above 0). */
export const NATIVE_CHART_BAR_PAGES = ["barometer", "tide"] as const;
export function nativeChartReadoutLabel(source: string): string {
  return NATIVE_CHART_SOURCES.find(item => item.id === source)?.label ?? source;
}

/**
 * The always-shown field that carries the same data as a chart readout, for
 * "Make fixed": a native data field (same parts and artwork), or one of
 * Studio's fixed metrics (a number only, so its icon becomes an image layer).
 */
export const NATIVE_CHART_FIXED_EQUIVALENTS: Readonly<Record<string, { nativeData: string } | { metric: "steps" | "calories" | "elevation" | "heartRate" }>> = {
  chart_stress: { nativeData: "stress" },
  chart_stamina: { nativeData: "stamina" },
  chart_baro: { nativeData: "baro" },
  chart_step: { metric: "steps" },
  chart_kcal: { metric: "calories" },
  chart_elevation: { metric: "elevation" },
  chart_heart_rate: { metric: "heartRate" }
};

/** Where a state table, or a number's level artwork, is placed. */
export function nativeStatePositionKey(field: NativeDataDefinition): string {
  return field.positionKey ?? (field.kind === "state" ? `${field.id}_pos` : `${field.id}_level_pos`);
}
export function nativeConfigPrefix(field: NativeDataDefinition): string { return field.configPrefix ?? field.id; }
export function nativeHasIcon(field: NativeDataDefinition): boolean { return !field.valueOnly && !field.id.startsWith("weather_temp"); }
export function nativeFieldKeys(field: NativeDataDefinition): string[] {
  if (field.kind === "state") return [field.stateKey!, nativeStatePositionKey(field)];
  if (field.kind === "solar") return ["sunriseset_hour_rect", "sunriseset_minute_rect", "sunriseset_font", "sunriseset_icon_pos", "sunriseset_sunrise_icon", "sunriseset_sunset_icon", "sunriseset_colon_icon", "sunriseset_progress_pos", "sunrise_progress", "sunset_progress"];
  if (field.kind === "chart") return [...NATIVE_CHART_SHARED_KEYS, "chart_sun_icon_pos", "chart_sun_icon", ...NATIVE_CHART_SOURCES.flatMap(({ id }) => nativeChartSourceKeys(id))];
  return [`${nativeConfigPrefix(field)}_rect`, `${nativeConfigPrefix(field)}_font`, ...(nativeHasIcon(field) ? [`${field.id}_icon_pos`, `${field.id}_icon`] : []), ...(field.percentKey ? [field.percentKey] : []), ...(field.unitKey ? [field.unitKey] : []), ...(field.decimalKey ? [field.decimalKey] : []), ...(field.stateKey ? [nativeStatePositionKey(field), field.stateKey] : [])];
}
export const NATIVE_DATA_CONFIG_KEYS = new Set([
  ...NATIVE_DATA_FIELDS.flatMap(nativeFieldKeys),
  "weather_negasign_icon", "weather_dgree_icon", "weather_temp_max_min_negasign_icon", "weather_temp_max_min_dgree_icon",
  // Min/max companions (nativeData.ts addMinMaxCompanions).
  "weather_temp_separator_icon_pos", "weather_temp_separator_icon"
]);

export const NATIVE_ASSET_ROLES = ["digits", "icon", "states", "unit", "symbols", "progress", "decimal", "background", "mask", "noDataMask", "separator"] as const;
export const NATIVE_PARTS = ["value", "icon", "states", "unit", "symbols", "progress", "plot", "decimal", "background", "mask", "noDataMask", "separator"] as const;
export function nativeAssetCount(id: string, role: string): number {
  if (role === "digits") return 10;
  if (role === "states") return id === "chart" ? 30 : NATIVE_DATA_BY_ID.get(id)?.stateCount ?? 1;
  if (role === "icon") return id === "sunriseset" || id === "chart" ? 2 : 1;
  if (role === "unit" || role === "progress") return 2;
  if (role === "symbols") return 4;
  return 1;
}
