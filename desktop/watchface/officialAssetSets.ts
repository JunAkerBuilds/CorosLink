// What a bitmap set from an official COROS face is for: its category, what a digit font was used as, and its purpose
// tags. Rewritten from CorosLink's electron/corosOfficialAssetLibrary.ts: the hosted library is built with the same
// rules, so these must stay in step with it. Pure and free of Node, so the page uses it too (officialFaceSets.ts has
// the part that reads a compiled face).

export const OFFICIAL_CATEGORIES = {
  fonts: "Digit fonts", battery: "Battery", weather: "Weather", "sun-moon": "Sun & moon", glyphs: "Glyphs & units",
  clock: "Clock", status: "Status icons", health: "Health", training: "Training & data", date: "Date",
  charts: "Charts", backgrounds: "Backgrounds", fish: "Fishing", other: "Other",
} as const;
export type OfficialCategory = keyof typeof OFFICIAL_CATEGORIES;

/** What the source face drew with a digit font. */
export const OFFICIAL_FONT_ROLES = {
  time: "Time digits", date: "Date digits", weather: "Temperature digits", complication: "Complication digits",
  battery: "Battery % digits", data: "Data-field digits",
} as const;
export type OfficialFontRole = keyof typeof OFFICIAL_FONT_ROLES;

// By layout element id; the first match wins. Fonts are found first, from the config key.
const BY_ELEMENT: [OfficialCategory, RegExp][] = [
  ["battery", /battery/],
  ["weather", /^weather\./],
  ["sun-moon", /^sunriseset\.|^chart\.(sun|moon)|^control\.sun(rise|set)/],
  ["glyphs", /(^|\.)(colon|negativeSign|percent|unit|minus|degree|separator)$/i],
  ["clock", /^time\./],
  ["status", /^(bluetooth|doNotDisturb|sleepMode|airplane|sedentary)/],
  ["health", /^(stamina|stress|sleepHrv|sleepScore|heartRate|barometer)/],
  ["training", /^(steps|calories|elevation|exercise|weekLoad|todayElevation|weekElevation|(today|week)(Run|Swim|Bike)|control\.)/],
  ["date", /^date\./],
  ["charts", /^chart\./],
  ["backgrounds", /^(background|thumbnail|arcCut)$/],
  ["fish", /^fish\./],
];

const LANGUAGES = "english|chinese|germany|spanish|french|japanese|thai|polish|chinese_tw|portugal|italian|korean|russian";
// Purpose, from the config keys a source face bound the set to (day or night weather, hours or minutes…).
const BY_KEY: [RegExp, string, string][] = [
  [/^weather_dark_icon_dir$/, "night", "Night"], [/^weather_icon_dir$/, "day", "Day"], [/^weather_temp_font$/, "temperature", "Temperature"],
  [/^weather_(wind|rainfall|humidity|uv|aqi)_icon$/, "conditions", "Conditions"],
  [/^battery_icon_dir$/, "battery-main", "Battery"], [/^control_battery_icon_dir$/, "battery-control", "Control battery"],
  [/^battery_level_font$/, "battery-percent", "Battery %"],
  [/^time_hour_(high|low)_font$/, "hours", "Hours"], [/^time_minute_(high|low)_font$/, "minutes", "Minutes"], [/^time_second_(high|low)_font$/, "seconds", "Seconds"],
  [/^time_(hour|minute|second)_icon$/, "hands", "Hands"], [/^am_icon$/, "am", "AM"], [/^pm_icon$/, "pm", "PM"], [/^colon_icon$/, "colon", "Colon"],
  [/^bluetooth_on_icon$/, "bt-on", "Bluetooth on"], [/^bluetooth_off_icon$/, "bt-off", "Bluetooth off"],
  [/^no_disturb_on_icon$/, "dnd-on", "DND on"], [/^no_disturb_off_icon$/, "dnd-off", "DND off"],
  [/^sleep_mode_icon$/, "sleep", "Sleep mode"], [/^airplane_icon$/, "airplane", "Airplane"], [/^sedentary_icon_dir$/, "activity-ring", "Activity ring"],
  [/^background_icon$/, "background", "Background"], [/^watchface_thmb_icon$/, "thumbnail", "Thumbnail"],
  [/^sunriseset_sunrise_icon$/, "sunrise", "Sunrise"], [/^sunriseset_sunset_icon$/, "sunset", "Sunset"],
  [new RegExp(`^(${LANGUAGES})_date_week_font$`), "weekday", "Weekday"],
  [new RegExp(`^(${LANGUAGES})_date_month_font$`), "month", "Month"],
  [new RegExp(`^(${LANGUAGES})_date_day_font$`), "day-of-month", "Day of month"],
  [/^control_(hr|step|kcal|elevation|floor|exercise|temperature|barometer)_icon$/, "complication-icon", "Complication icon"],
  [/^control_\w+_font$/, "complication-font", "Complication digits"],
];

export interface OfficialTag { id: string; label: string }

export function officialTags(configKeys: readonly string[]): OfficialTag[] {
  const tags = new Map<string, string>();
  for (const key of configKeys) for (const [pattern, id, label] of BY_KEY) if (pattern.test(key)) tags.set(id, label);
  return [...tags].map(([id, label]) => ({ id, label }));
}

export function officialCategory(elementIds: readonly string[], configKeys: readonly string[]): OfficialCategory {
  if (configKeys.some((key) => /_font$/.test(key))) return "fonts";
  for (const id of elementIds) for (const [category, pattern] of BY_ELEMENT) if (pattern.test(id)) return category;
  return "other";
}

export function officialFontRole(elementIds: readonly string[]): OfficialFontRole {
  const has = (pattern: RegExp) => elementIds.some((id) => pattern.test(id));
  return has(/^time\./) ? "time" : has(/^date\./) ? "date" : has(/^weather\./) ? "weather" : has(/^control\./) ? "complication" : has(/^battery\./) ? "battery" : "data";
}

/** The library category a template image key belongs to, so the browser opens on the right one. */
export function officialCategoryForConfigKey(configKey: string): OfficialCategory | undefined {
  const key = configKey.toLowerCase();
  if (/weather/.test(key)) return "weather";
  if (/battery/.test(key)) return "battery";
  if (/bluetooth|no_disturb|sleep_mode|airplane|sedentary/.test(key)) return "status";
  if (/^time_|colon|am_icon|pm_icon|_hour_icon|_minute_icon|_second_icon|center_polygon|arc_cut/.test(key)) return "clock";
  if (/background|thmb/.test(key)) return "backgrounds";
  if (/sunrise|sunset|sun_|moon/.test(key)) return "sun-moon";
  if (/negative|percent|unit|dgree|degree/.test(key)) return "glyphs";
  if (/stamina|stress|sleep|baro/.test(key)) return "health";
  if (/chart/.test(key)) return "charts";
  if (/control_|step|kcal|exercise|elev|floor|_hr_|heart/.test(key)) return "training";
  return undefined;
}
