// Template config files and info.json, edited the way the watch needs them. Moved from CorosLink's
// electron/corosWatchfaceService.ts at c2ff5110 with only imports and limits gathered here (see docs/studio-port.md):
// every byte these write ends up on the watch, so the logic stays as it was there.
import { NATIVE_DATA_CONFIG_KEYS } from "../watchfaceNativeCatalog";
import type { CorosWatchfaceConfigOverride } from "../types";

/** A config override value that removes the key's line. */
export const COROS_CONFIG_DELETE_VALUE = "__COROSLINK_DELETE_CONFIG_KEY__";
export const CONFIG_TEXT_PATH_PATTERN = /^watchface_\d{3,4}x\d{3,4}\/(?:AOD)?config\.txt$/i;
const CONFIG_KEY_PATTERN = /^[a-z0-9_]{1,64}$/i;
// Values stay on one printable-ASCII line, matching the firmware's own syntax.
const CONFIG_VALUE_PATTERN = /^[\x20-\x7e]{0,160}$/;
const MAX_CONFIG_OVERRIDE_FILES = 8;
const MAX_CONFIG_OVERRIDE_KEYS = 512;
const MAX_CONFIG_TEXT_REPLACEMENTS = 8;
export const MAX_INFO_BYTES = 1024 * 1024;

export interface ConfigTextFile { path: string; text: string }


/**
 * Parses the firmware's INI-style layout files: `[key]=value` lines with
 * `//` and `#` comment lines. Values keep their original firmware syntax.
 */
export function parseCorosWatchfaceConfig(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*=\s*(.*?)\s*$/);
    if (match) {
      entries[match[1]!] = match[2]!;
    }
  }
  return entries;
}

const ENGLISH_DATE_KEY = /^english_date_((?:month|day)_(?:rect|font|font_color))$/;
const LANGUAGE_DATE_KEY = /^\s*\[([a-z]+(?:_tw)?)_date_((?:month|day)_(?:rect|font|font_color))\]\s*=/gm;

/**
 * The watch draws the date from the table matching its system language
 * (germany_date_*, french_date_*, …); Studio only edits english_date_*. Copy
 * month/day edits onto every other language table the template declares, so
 * a watch set to another language shows the designed date instead of the
 * template's stock digits at the stock position. Those are numerals in every
 * language; the localized weekday stays with the editor's per-language
 * option (applyWeekdayLanguageOverrides). Explicit per-language overrides win;
 * undeclared keys are never appended.
 */
function mirrorEnglishDateOverrides(
  text: string,
  overrides: Record<string, string>
): Record<string, string> {
  const edited = Object.keys(overrides).filter((key) => ENGLISH_DATE_KEY.test(key));
  if (!edited.length) return overrides;
  const mirrored = { ...overrides };
  for (const [, language, field] of text.matchAll(LANGUAGE_DATE_KEY)) {
    const key = `${language}_date_${field}`;
    const source = `english_date_${field}`;
    if (language === "english" || key in mirrored || !(source in overrides)) continue;
    mirrored[key] = overrides[source]!;
  }
  return mirrored;
}

/**
 * Rewrites `[key]=value` lines in a firmware config file, preserving every
 * other byte (comments, ordering, CRLF). Confirmed optional firmware keys may
 * be appended when a template omits their empty declarations. Every other
 * missing key remains an error so typos cannot silently corrupt an archive.
 */
export function applyCorosWatchfaceConfigOverrides(
  text: string,
  overrides: Record<string, string>
): string {
  const pending = new Map(Object.entries(mirrorEnglishDateOverrides(text, overrides)));
  const matched = new Set<string>();
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\s*)\[([^\]]+)\]\s*=.*$/);
    if (!match || !pending.has(match[2]!)) {
      return [line];
    }
    const value = pending.get(match[2]!)!;
    // Raw config editing can introduce duplicate declarations. Rewrite every
    // occurrence so the last-value-wins parser and the exported file agree.
    matched.add(match[2]!);
    return value === COROS_CONFIG_DELETE_VALUE
      ? []
      : [`${match[1]}[${match[2]}]=${value}`];
  });
  for (const key of matched) {
    pending.delete(key);
  }
  const appendableKeys = new Set([
    ...NATIVE_DATA_CONFIG_KEYS,
    "watchface_id",
    // Studio's native sprite animation (header 0x312); no COROS key exists for it.
    "cl_animation_pos",
    "cl_animation_dir",
    "cl_animation_delays_ms",
    // Studio's MIP theme picker; most DIY templates only declare theme_color_off.
    "watchface_default_theme_color",
    // Independent AOD artwork may add a flattened background to a valid
    // color-only AODconfig that did not originally declare a PNG.
    "background_icon_pos",
    "background_icon",
    // Studio can expose selectable components that the imported template did
    // not originally declare. The renderer only emits this fixed allow-list;
    // arbitrary missing keys remain rejected below.
    "rect_control1_pos",
    // Studio offers these standalone status states even when the template
    // omits them. Custom artwork also synthesizes their shared position.
    "bluetooth_icon_pos",
    "bluetooth_on_icon",
    "bluetooth_off_icon",
    "airplane_icon",
    "no_disturb_icon_pos",
    "no_disturb_on_icon",
    "no_disturb_off_icon",
    "sleep_mode_icon",
    "weather_icon_pos",
    "weather_icon_dir",
    "weather_dark_icon_dir",
    "weather_temp_rect",
    "weather_temp_font",
    "weather_negasign_icon",
    "weather_dgree_icon",
    "weather_temp_max_min_dgree_icon",
    "battery_icon_pos",
    "battery_icon_dir",
    "battery_level_rect",
    "battery_level_font",
    "battery_level_font_color",
    // Fixed metrics can be enabled even when a sparse starter template did
    // not declare them. Watchface Studio synthesizes both their rectangles
    // and font folders from the template's available raster fonts.
    "heartreate_level_rect",
    "heartreate_level_font",
    "step_rect",
    "step_font",
    "kcal_rect",
    "kcal_font",
    "elevation_rect",
    "elevation_font",
    "temperature_rect",
    "temperature_font",
    "temperature_font_color",
    "temperature_negative_sign_icon",
    "exercise_hour_rect",
    "exercise_minute_rect",
    "exercise_font",
    "exercise_font_color",
    "kcal_progress_arc",
    "kcal_progress_arc_color",
    "kcal_progress_rect",
    "kcal_progress_color",
    "exercise_progress_arc",
    "exercise_progress_arc_color",
    "exercise_progress_rect",
    "exercise_progress_color",
    "control_temperature_icon_pos",
    "control_temperature_icon",
    "control_temperature_rect",
    "control_temperature_font",
    "control_temperature_font_color",
    "control_temperature_negative_sign_icon",
    "control_barometer_icon_pos",
    "control_barometer_icon",
    "control_barometer_down_icon",
    "control_barometer_flat_icon",
    "control_barometer_up_icon",
    "control_barometer_integer_rect",
    "control_barometer_decimal_rect",
    "control_barometer_rect",
    "control_barometer_font",
    "control_barometer_font_color",
    "control_point_icon",
    "control_negative_sign_icon",
    "control_hr_font_color",
    "control_step_font_color",
    "control_kcal_font_color",
    "control_floor_font_color",
    "control_elevation_font_color",
    "control_exercise_font_color",
    "control_sunrise_font_color",
    "control_sunset_font_color",
    "control_battery_level_font",
    "control_battery_level_font_color",
    "time_hour_high_pos",
    "time_hour_high_font",
    "time_hour_low_pos",
    "time_hour_low_font",
    "time_minute_high_pos",
    "time_minute_high_font",
    "time_minute_low_pos",
    "time_minute_low_font",
    // Seconds digits, like hours and minutes: a face made on a template with
    // seconds converts onto one without them (the phone's blank local carrier
    // declares none, so without these a seconds face can't convert there).
    "time_second_high_pos",
    "time_second_high_font",
    "time_second_low_pos",
    "time_second_low_font",
    "colon_icon",
    "negative_sign_icon",
    // Weekday/month/day Studio adds to a template that lays out no date.
    // Such templates declare no date table in any language, so only the
    // English one is written (mirrorEnglishDateOverrides finds nothing).
    "english_date_week_rect",
    "english_date_week_font",
    "english_date_month_rect",
    "english_date_month_font",
    "english_date_day_rect",
    "english_date_day_font",
    // Analog hands Studio adds to a template that never declared them. Most
    // DIY templates declare these blank, and the phone compiler's SetPoint
    // stage reads them for every face.
    "time_hour_icon",
    "time_minute_icon",
    "time_second_icon",
    "time_center_polygon_icon1",
    "time_center_polygon_icon2",
    "time_center_pos"
  ]);
  for (const prefix of [
    "hr",
    "step",
    "kcal",
    "floor",
    "elevation",
    "temperature"
  ]) {
    for (const suffix of [
      "icon_pos",
      "icon",
      "rect",
      "font",
      "font_color"
    ]) {
      appendableKeys.add(`control_${prefix}_${suffix}`);
    }
  }
  appendableKeys.add("control_temperature_negative_sign_icon");
  for (const prefix of ["exercise", "sunrise", "sunset"]) {
    for (const suffix of [
      "icon_pos",
      "icon",
      "hour_rect",
      "minute_rect",
      "font",
      "font_color"
    ]) {
      appendableKeys.add(`control_${prefix}_${suffix}`);
    }
  }
  for (const suffix of [
    "icon_dir",
    // The battery choice added to a template without one places its level
    // pictures; without this the build refused the face.
    "icon_pos",
    "level_rect",
    "level_font",
    "level_font_color"
  ]) {
    appendableKeys.add(`control_battery_${suffix}`);
  }
  const appended: string[] = [];
  for (const [key, value] of pending) {
    if (value === COROS_CONFIG_DELETE_VALUE) {
      // Deleting an optional key that is already absent is idempotent.
      pending.delete(key);
      continue;
    }
    if (appendableKeys.has(key)) {
      appended.push(`[${key}]=${value}`);
      pending.delete(key);
    }
  }
  if (pending.size > 0) {
    throw new Error(
      `The template's config does not define: ${[...pending.keys()].join(", ")}.`
    );
  }
  if (appended.length > 0) {
    const insertionIndex = lines.at(-1) === "" ? lines.length - 1 : lines.length;
    lines.splice(insertionIndex, 0, ...appended);
  }
  return lines.join(newline);
}

/**
 * Deletes every `[key]=` declaration whose value is blank. Firmware treats a
 * declared key as feature-present even when its value is empty — a template
 * shipping an empty `control_barometer_*` group still lists barometer in the
 * on-watch selector and renders a blank slot. Removing the whole line is the
 * same mechanism COROS_CONFIG_DELETE_VALUE uses to switch features off.
 */
export function stripBlankCorosWatchfaceConfigKeys(text: string): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[[^\]]+\]\s*=\s*$/.test(line))
    .join(newline);
}

const BAROMETER_DIRECTIONAL_REQUIRED_KEYS = [
  "control_barometer_icon_pos",
  "control_barometer_down_icon",
  "control_barometer_flat_icon",
  "control_barometer_up_icon",
  "control_barometer_integer_rect",
  "control_barometer_decimal_rect",
  "control_barometer_font",
  "control_barometer_font_color",
  "control_point_icon"
] as const;
const BAROMETER_STATIC_REQUIRED_KEYS = [
  "control_barometer_icon_pos",
  "control_barometer_icon",
  "control_barometer_rect",
  "control_barometer_font",
  "control_barometer_font_color",
  "control_point_icon"
] as const;
const BAROMETER_DIRECTIONAL_BRANCH_KEYS = [
  "control_barometer_down_icon",
  "control_barometer_flat_icon",
  "control_barometer_up_icon",
  "control_barometer_integer_rect",
  "control_barometer_decimal_rect"
] as const;

/**
 * Enforces exactly one complete barometer parser branch. Static remains an
 * experimental v4 path because an earlier archive crashed on-watch.
 */
export function finalizeCorosWatchfaceBarometerConfig(text: string): string {
  const config = parseCorosWatchfaceConfig(text);
  const hasValue = (key: string) => Boolean(config[key]?.trim());
  const hasDeclaration = (key: string) =>
    Object.prototype.hasOwnProperty.call(config, key);
  const hasStaticBranch =
    hasValue("control_barometer_icon") ||
    hasValue("control_barometer_rect");
  const hasDirectionalBranch = BAROMETER_DIRECTIONAL_BRANCH_KEYS.some(
    (key) => hasValue(key)
  );
  if (hasStaticBranch && hasDirectionalBranch) {
    throw new Error(
      "The barometer config mixes Static and Directional parser branches. Select exactly one format."
    );
  }

  const hasBarometer = Object.keys(config).some(
    (key) => key.startsWith("control_barometer_") && hasValue(key)
  );
  if (hasBarometer) {
    const requiredKeys = hasStaticBranch
      ? BAROMETER_STATIC_REQUIRED_KEYS
      : BAROMETER_DIRECTIONAL_REQUIRED_KEYS;
    const missing: string[] = requiredKeys.filter(
      (key) => key === "control_barometer_font_color"
        ? !hasDeclaration(key)
        : !hasValue(key)
    );
    if (!hasStaticBranch && !hasDirectionalBranch) {
      missing.push("a Static or Directional barometer branch");
    }
    const hasControlSlot = Object.entries(config).some(
      ([key, value]) =>
        /^rect_control\d+_pos$/.test(key) &&
        /^\{\s*-?\d+\s*,\s*-?\d+\s*\}$/.test(value.trim())
    );
    if (!hasControlSlot) missing.push("rect_controlN_pos");
    if (missing.length > 0) {
      throw new Error(
        `The ${hasStaticBranch ? "static" : "directional"} barometer config is incomplete: ${missing.join(", ")}.`
      );
    }
  }

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s*\[([^\]]+)\]\s*=\s*$/);
      return !match || (
        match[1] === "control_barometer_font_color" ||
        (
          !match[1]!.startsWith("control_barometer_") &&
          match[1] !== "control_point_icon"
        )
      );
    })
    .join(newline);
}

/**
 * Builds an AODconfig for a resolution that lacks one by rescaling another
 * resolution's file. Coordinate fields inside `{...}` tuples are scaled;
 * WFArc angles and flags remain unchanged;
 * font-folder and PNG references are remapped to assets the target tree
 * actually ships (official 800×800 templates reuse main-face assets for AOD
 * instead of shipping `aod_*` copies), trying the literal name first, then
 * with the `aod_`/`a/` prefix removed. Keys whose assets cannot be resolved
 * are dropped rather than left dangling.
 */
export function synthesizeScaledCorosAodConfig(
  sourceText: string,
  scale: number,
  archivePaths: Set<string>,
  targetDirectory: string
): string {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/^\.\//, "");
  const hasFile = (relative: string) =>
    archivePaths.has(`${targetDirectory}/${normalize(relative)}`);
  const folders = new Set<string>();
  for (const archivePath of archivePaths) {
    if (!archivePath.startsWith(`${targetDirectory}/`)) continue;
    const segments = archivePath.slice(targetDirectory.length + 1).split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      folders.add(segments.slice(0, depth).join("/"));
    }
  }
  const resolveFolder = (value: string) =>
    [
      value,
      value.replace(/^aod_/i, ""),
      value.replace(/^a[\\/]/i, "")
    ].find((candidate) => candidate && folders.has(normalize(candidate)));
  const resolveFile = (value: string) =>
    [
      value,
      value.replace(/(^|[\\/])aod_([^\\/]+\.png)$/i, "$1$2"),
      value.replace(/^a[\\/]/i, "")
    ].find((candidate) => hasFile(candidate));
  const newline = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const lines: string[] = [];
  for (const line of sourceText.split(/\r?\n/)) {
    const match = line.match(/^(\s*)\[([^\]]+)\]\s*=(.*)$/);
    if (!match) {
      lines.push(line);
      continue;
    }
    const [, indent, key, rawValue] = match;
    const configKey = key!;
    const value = rawValue!.trim();
    if (!value) {
      lines.push(`${indent}[${configKey}]=`);
      continue;
    }
    const scaled = value.replace(/\{([^}]*)\}/g, (_group, inner: string) =>
      `{${inner
        .split(",")
        .map((part, index) => {
          const token = part.trim();
          const isProgressArcCoordinate =
            !/_progress_arc$/i.test(configKey) ||
            index < 4 ||
            index === 6;
          return /^-?\d+$/.test(token) && isProgressArcCoordinate
            ? String(Math.round(Number(token) * scale))
            : token;
        })
        .join(",")}}`
    );
    if (/\.png$/i.test(normalize(scaled))) {
      const resolved = resolveFile(scaled);
      if (resolved !== undefined) lines.push(`${indent}[${configKey}]=${resolved}`);
      continue;
    }
    if (/_font$/i.test(configKey) || /_icon_dir$/i.test(configKey)) {
      const resolved = resolveFolder(scaled);
      if (resolved !== undefined) lines.push(`${indent}[${configKey}]=${resolved}`);
      continue;
    }
    lines.push(`${indent}[${configKey}]=${scaled}`);
  }
  return lines.join(newline);
}

/** Ensures a composed standalone battery folder is actually referenced. */
export function repairStandaloneBatteryConfigOverrides(
  text: string,
  overrides: Record<string, string>,
  hasStudioBatteryFolder: boolean
): Record<string, string> {
  if (!hasStudioBatteryFolder) return overrides;
  const config = parseCorosWatchfaceConfig(text);
  const position = overrides.battery_icon_pos ?? config.battery_icon_pos ?? "";
  const folder = overrides.battery_icon_dir ?? config.battery_icon_dir ?? "";
  return position.trim() && !folder.trim()
    ? { ...overrides, battery_icon_dir: "cl_battery_icon" }
    : overrides;
}

export function validateConfigOverrides(
  overrides: CorosWatchfaceConfigOverride[] | undefined
): Map<string, Record<string, string>> {
  const validated = new Map<string, Record<string, string>>();
  if (overrides === undefined) {
    return validated;
  }
  if (!Array.isArray(overrides) || overrides.length > MAX_CONFIG_OVERRIDE_FILES) {
    throw new Error("The creator sent an invalid layout override list.");
  }
  for (const override of overrides) {
    if (
      !override ||
      typeof override.path !== "string" ||
      !/(^|\/)(AODconfig|config)\.txt$/i.test(override.path) ||
      !override.values ||
      typeof override.values !== "object" ||
      Array.isArray(override.values)
    ) {
      throw new Error("Layout overrides must target a template config file.");
    }
    if (validated.has(override.path)) {
      throw new Error("Layout overrides contain a duplicated config file.");
    }
    const entries = Object.entries(override.values);
    if (entries.length === 0 || entries.length > MAX_CONFIG_OVERRIDE_KEYS) {
      throw new Error("Layout overrides must change between 1 and 200 keys.");
    }
    for (const [key, value] of entries) {
      if (
        !CONFIG_KEY_PATTERN.test(key) ||
        typeof value !== "string" ||
        !CONFIG_VALUE_PATTERN.test(value)
      ) {
        throw new Error("A layout override key or value is not valid config syntax.");
      }
    }
    validated.set(override.path, { ...override.values });
  }
  return validated;
}

export function validateConfigTextReplacements(
  replacements: ConfigTextFile[] | undefined
): Map<string, string> {
  const validated = new Map<string, string>();
  if (replacements === undefined) {
    return validated;
  }
  if (
    !Array.isArray(replacements) ||
    replacements.length > MAX_CONFIG_TEXT_REPLACEMENTS
  ) {
    throw new Error("The creator sent an invalid config text replacement list.");
  }
  for (const replacement of replacements) {
    if (
      !replacement ||
      typeof replacement.path !== "string" ||
      !CONFIG_TEXT_PATH_PATTERN.test(replacement.path) ||
      typeof replacement.text !== "string"
    ) {
      throw new Error(
        "Config text replacements must target an existing template config file."
      );
    }
    if (validated.has(replacement.path)) {
      throw new Error("Config text replacements contain a duplicated config file.");
    }
    if (Buffer.byteLength(replacement.text, "utf8") > MAX_INFO_BYTES) {
      throw new Error("A replaced config file is unexpectedly large.");
    }
    validated.set(replacement.path, replacement.text);
  }
  return validated;
}


/**
 * Raises info.json's `o_wf_ver` to at least `minimum`, editing the manifest as
 * raw text. The file must never be JSON round-tripped: `o_template_id` exceeds
 * Number.MAX_SAFE_INTEGER (see extractDecimalProperty), so parsing would
 * corrupt it. Only the numeric `o_wf_ver` value is touched.
 */
export function raiseWatchFaceVersion(rawInfo: string, minimum: number): string {
  const match = rawInfo.match(/"o_wf_ver"\s*:\s*(\d+)/);
  if (match) {
    if (Number(match[1]) >= minimum) {
      return rawInfo;
    }
    return rawInfo.replace(/"o_wf_ver"\s*:\s*\d+/, `"o_wf_ver":${minimum}`);
  }
  // Templates without the key predate weather support; declare it up front.
  return rawInfo.replace(/^(\s*\{)/, `$1"o_wf_ver":${minimum},`);
}

export function setWatchFaceVersion(rawInfo: string, version: number): string {
  if (/"o_wf_ver"\s*:\s*\d+/.test(rawInfo)) {
    return rawInfo.replace(/"o_wf_ver"\s*:\s*\d+/, `"o_wf_ver":${version}`);
  }
  return rawInfo.replace(/^(\s*\{)/, `$1"o_wf_ver":${version},`);
}

/** Rewrites the lossless raw numeric template ID without JSON round-tripping. */
export function setWatchfaceTemplateId(
  rawInfo: string,
  templateId: string
): string {
  if (!/^\d{1,20}$/.test(templateId) || /^0+$/.test(templateId)) {
    throw new Error("Template ID overrides must contain 1–20 decimal digits.");
  }
  if (/"o_template_id"\s*:\s*(?:"\d+"|\d+)/.test(rawInfo)) {
    return rawInfo.replace(
      /"o_template_id"\s*:\s*(?:"\d+"|\d+)/,
      `"o_template_id":${templateId}`
    );
  }
  return rawInfo.replace(/^(\s*\{)/, `$1"o_template_id":${templateId},`);
}

/**
 * Normalizes a config `[watchface_id]` override. Decimal stays decimal; hex is
 * uppercased and zero-padded to 8 digits (`0x26` → `0x00000026`).
 */
export function normalizeWatchfaceIdOverride(value: string): string {
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{1,8}$/i.test(trimmed)) {
    return `0x${trimmed.slice(2).toUpperCase().padStart(8, "0")}`;
  }
  if (/^(?:0|[1-9]\d{0,9})$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
      throw new Error(
        "Watch-face ID overrides must be a 32-bit decimal or 0x hex value."
      );
    }
    return trimmed;
  }
  throw new Error(
    "Watch-face ID overrides must be a 32-bit decimal or 0x hex value."
  );
}

/** Rewrites the manifest name while preserving all other raw fields. */
export function setWatchfaceTemplateName(
  rawInfo: string,
  templateName: string
): string {
  const name = templateName.trim();
  if (name.length === 0 || name.length > 64) {
    throw new Error("Template name overrides must contain 1–64 characters.");
  }
  const encoded = JSON.stringify(name);
  if (/"m_name"\s*:\s*"(?:\\.|[^"\\])*"/.test(rawInfo)) {
    return rawInfo.replace(
      /"m_name"\s*:\s*"(?:\\.|[^"\\])*"/,
      `"m_name":${encoded}`
    );
  }
  return rawInfo.replace(/^(\s*\{)/, `$1"m_name":${encoded},`);
}

export function extractDecimalProperty(raw: string, property: string): string | undefined {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`"${escapedProperty}"\\s*:\\s*(\\d+)`));
  return match?.[1];
}
