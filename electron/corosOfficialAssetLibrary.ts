import { createHash } from "node:crypto";
import { decodeCorosBitmapFrame, decodeCorosLayout, findCorosBitmapBlocks, parseCorosFaceMagic, readLayoutHeaders } from "./corosBinLayout";

/**
 * Pure extraction and classification of the bitmap sets inside an official
 * compiled COROS face. Shared by the in-app asset library service and the
 * offline `scripts/build-coros-asset-library.mjs` generator; no Electron or
 * filesystem access here.
 */

export type OfficialAssetCategory =
  | "fonts" | "battery" | "weather" | "sun-moon" | "glyphs" | "clock" | "status"
  | "health" | "training" | "date" | "charts" | "backgrounds" | "fish" | "other";

export type OfficialFontRole = "time" | "date" | "weather" | "complication" | "battery" | "data";

export const OFFICIAL_ASSET_CATEGORY_LABELS: Record<OfficialAssetCategory, string> = {
  fonts: "Digit fonts", battery: "Battery", weather: "Weather", "sun-moon": "Sun & moon", glyphs: "Glyphs & units",
  clock: "Clock", status: "Status icons", health: "Health", training: "Training & data", date: "Date",
  charts: "Charts", backgrounds: "Backgrounds", fish: "Fishing", other: "Other"
};

export const OFFICIAL_FONT_ROLE_LABELS: Record<OfficialFontRole, string> = {
  time: "Time digits", date: "Date digits", weather: "Temperature digits", complication: "Complication digits",
  battery: "Battery % digits", data: "Data-field digits"
};

// Category by element id prefix; first match wins. Fonts are detected first
// from the config key so time/date/weather digit sets all land in "fonts".
const CATEGORIES: [OfficialAssetCategory, RegExp][] = [
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
  ["fish", /^fish\./]
];

/** Purpose tags derived from the config keys a source face bound a set to (day vs night weather, hours vs minutes…). */
const KEY_TAGS: [RegExp, string, string][] = [
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
  [/^(english|chinese|germany|spanish|french|japanese|thai|polish|chinese_tw|portugal|italian|korean|russian)_date_week_font$/, "weekday", "Weekday"],
  [/^(english|chinese|germany|spanish|french|japanese|thai|polish|chinese_tw|portugal|italian|korean|russian)_date_month_font$/, "month", "Month"],
  [/^(english|chinese|germany|spanish|french|japanese|thai|polish|chinese_tw|portugal|italian|korean|russian)_date_day_font$/, "day-of-month", "Day of month"],
  [/^control_(hr|step|kcal|elevation|floor|exercise|temperature|barometer)_icon$/, "complication-icon", "Complication icon"],
  [/^control_\w+_font$/, "complication-font", "Complication digits"]
];

export interface OfficialAssetTag { id: string; label: string }

export function officialAssetTags(configKeys: string[]): OfficialAssetTag[] {
  const tags = new Map<string, string>();
  for (const key of configKeys) for (const [pattern, id, label] of KEY_TAGS) if (pattern.test(key)) tags.set(id, label);
  return [...tags].map(([id, label]) => ({ id, label }));
}

export function classifyOfficialAsset(elementIds: string[], configKeys: string[]): OfficialAssetCategory {
  if (configKeys.some((key) => /_font$/.test(key))) return "fonts";
  for (const id of elementIds) for (const [category, pattern] of CATEGORIES) if (pattern.test(id)) return category;
  return "other";
}

export function officialFontRole(elementIds: string[]): OfficialFontRole {
  if (elementIds.some((id) => /^time\./.test(id))) return "time";
  if (elementIds.some((id) => /^date\./.test(id))) return "date";
  if (elementIds.some((id) => /^weather\./.test(id))) return "weather";
  if (elementIds.some((id) => /^control\./.test(id))) return "complication";
  if (elementIds.some((id) => /^battery\./.test(id))) return "battery";
  return "data";
}

export interface ExtractedOfficialAssetSet {
  /** Bitmap group index inside the face. */
  group: number;
  /** Content hash: identical pixels across faces and resolutions share one id. */
  id: string;
  width: number;
  height: number;
  frameCount: number;
  encoding: string;
  elementIds: string[];
  configKeys: string[];
  /** Decoded straight-alpha RGBA, one buffer per frame. */
  frames: Buffer[];
}

export interface ExtractedOfficialFace {
  screen: number;
  display: "amoled" | "mip";
  sets: ExtractedOfficialAssetSet[];
  /** Groups whose frames could not be decoded. */
  failures: string[];
}

/** Decodes every bitmap set of a compiled face and records which layout elements use it. */
export function extractOfficialFaceAssets(bytes: Buffer): ExtractedOfficialFace {
  const magic = bytes.toString("latin1", 0, 4);
  const size = parseCorosFaceMagic(magic);
  if (!size) throw new Error(`Unsupported watch-face magic ${JSON.stringify(magic)}.`);
  const headers = readLayoutHeaders(bytes);
  const layoutEnd = Math.max(...headers.map((h) => h.offset + h.length));
  const blocks = findCorosBitmapBlocks(bytes, layoutEnd);
  let layout: ReturnType<typeof decodeCorosLayout> | null = null;
  try { layout = decodeCorosLayout(bytes, blocks); } catch { /* keep the raw bitmaps */ }

  // Which layout elements point at each bitmap group, across normal + AOD modes.
  const references = new Map<number, { ids: Set<string>; keys: Set<string> }>();
  for (const mode of layout?.modes ?? []) {
    for (const element of mode.elements) {
      const groups = [element.asset?.group, ...(element.assets ?? []).map((ref) => ref?.group)]
        .filter((group): group is number => group != null);
      for (const group of groups) {
        const entry = references.get(group) ?? { ids: new Set<string>(), keys: new Set<string>() };
        entry.ids.add(element.id);
        if (element.config?.asset) entry.keys.add(element.config.asset);
        references.set(group, entry);
      }
    }
  }

  const sets: ExtractedOfficialAssetSet[] = [];
  const failures: string[] = [];
  for (const block of blocks) {
    let frames: Buffer[];
    try {
      frames = Array.from({ length: block.frameCount }, (_, frame) => decodeCorosBitmapFrame(bytes, block, frame));
    } catch (error) {
      failures.push(`group ${block.index}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const reference = references.get(block.index);
    sets.push({
      group: block.index,
      id: createHash("sha256").update(`${block.width}x${block.height}`).update(Buffer.concat(frames)).digest("hex").slice(0, 16),
      width: block.width, height: block.height, frameCount: block.frameCount, encoding: `0x${block.encoding.toString(16)}`,
      elementIds: [...(reference?.ids ?? [])].sort(), configKeys: [...(reference?.keys ?? [])].sort(), frames
    });
  }
  return { screen: size.size, display: size.variant === "A" ? "amoled" : "mip", sets, failures };
}

/** Frames laid out left to right with a 2px gap, wrapping so the strip stays roughly square. */
export function composeOfficialAssetStrip(width: number, height: number, frames: Buffer[]): { rgba: Buffer; width: number; height: number } {
  const gap = 2;
  const perRow = frames.length <= 1
    ? 1
    : Math.max(1, Math.min(frames.length, Math.ceil(Math.sqrt(frames.length * height / Math.max(width, 1))), Math.floor(2048 / (width + gap))));
  const rows = Math.ceil(frames.length / perRow);
  const stripWidth = perRow * width + (perRow - 1) * gap;
  const stripHeight = rows * height + (rows - 1) * gap;
  const rgba = Buffer.alloc(stripWidth * stripHeight * 4);
  frames.forEach((frame, index) => {
    const ox = (index % perRow) * (width + gap);
    const oy = Math.floor(index / perRow) * (height + gap);
    for (let y = 0; y < height; y++) frame.copy(rgba, ((oy + y) * stripWidth + ox) * 4, y * width * 4, (y + 1) * width * 4);
  });
  return { rgba, width: stripWidth, height: stripHeight };
}
