import type {
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceResolutionDetails,
  CorosWatchfaceSpriteFile,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";

/**
 * Styling choices the studio applies to a template. Digit bitmaps are
 * re-rendered from a locally installed font; weekday labels, battery digits,
 * and icons are recolored in place so their glyph shapes stay intact.
 */
export interface WatchfaceStudioOptions {
  /** Empty string keeps the template's original digit bitmaps. */
  fontFamily: string;
  digitColor: string;
  accentColor: string;
  tintLabels: boolean;
  tintIcons: boolean;
  /** Changes only the studio preview; the watch rotates the control slot. */
  previewComplication?: WatchfaceComplicationId;
  /** Per-fixed-metric bitmap styles, isolated into their own sprite folders. */
  metricStyles?: WatchfaceMetricStyles;
  /** Independent hour/minute bitmap styles. */
  timeStyles?: WatchfaceTimeStyles;
  /** Independent weekday/month/day bitmap scaling. */
  dateStyles?: WatchfaceDateStyles;
  /** Colors for firmware layers without a specialized style object. */
  layerColors?: Record<string, string>;
  /** Live AM/PM indicator sprite styling, when the template supports it. */
  ampmStyle?: WatchfaceAmPmStyle;
}

export type WatchfaceAssetLoader = (
  paths: string[]
) => Promise<CorosWatchfaceTemplateAsset[]>;

/** Always-on-display sprites are dimmed to limit OLED burn-in and drain. */
export const AOD_DIM_FACTOR = 0.55;

export function dimHexColor(hex: string, factor: number): string {
  const normalized = hex.replace("#", "");
  const channel = (offset: number) =>
    Math.round(
      Number.parseInt(normalized.slice(offset, offset + 2), 16) * factor
    )
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** Parses a firmware position value such as `{524,234}`. */
export function parseConfigPos(
  value: string | undefined
): { x: number; y: number } | null {
  const match = value?.match(/^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}$/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** Parses a firmware rect value such as `{582,538,734,587,hcenter|vcenter}`. */
export function parseConfigRect(
  value: string | undefined
): { x0: number; y0: number; x1: number; y1: number } | null {
  const match = value?.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/
  );
  return match
    ? {
        x0: Number(match[1]),
        y0: Number(match[2]),
        x1: Number(match[3]),
        y1: Number(match[4])
      }
    : null;
}

export type WatchfaceStaticSeparatorId = "colon" | "dateSlash";

export interface WatchfaceStaticSeparatorStyle {
  enabled: boolean;
  x: number;
  y: number;
  size: number;
  color: string;
  /** Optional per-separator font; falls back to the design font. */
  fontFamily?: string;
}

export type WatchfaceStaticSeparators = Record<
  WatchfaceStaticSeparatorId,
  WatchfaceStaticSeparatorStyle
>;

/** Suggested separator centers inferred from the surrounding template fields. */
export function inferStaticSeparators(
  details: CorosWatchfaceTemplateDetails,
  color = "#ffffff"
): WatchfaceStaticSeparators {
  const resolution = pickPreviewResolution(details);
  const fallbackWidth = resolution?.width ?? 800;
  const fallbackHeight = resolution?.height ?? 800;
  const fallback: WatchfaceStaticSeparators = {
    colon: {
      enabled: false,
      x: fallbackWidth / 2,
      y: fallbackHeight * 0.4,
      size: Math.round(fallbackHeight * 0.08),
      color
    },
    dateSlash: {
      enabled: false,
      x: fallbackWidth / 2,
      y: fallbackHeight * 0.3,
      size: Math.round(fallbackHeight * 0.06),
      color
    }
  };
  if (!resolution) {
    return fallback;
  }
  const config = resolution.config;
  const hourPos = parseConfigPos(config["time_hour_low_pos"]);
  const minutePos = parseConfigPos(config["time_minute_high_pos"]);
  const hourSource = findSpriteFolder(resolution, config["time_hour_low_font"]);
  const minuteSource = findSpriteFolder(resolution, config["time_minute_high_font"]);
  const hourFile = hourSource?.files[0];
  const minuteFile = minuteSource?.files[0];
  if (hourPos && minutePos && hourFile && minuteFile) {
    fallback.colon.x = Math.round(
      (hourPos.x + hourFile.width + minutePos.x) / 2
    );
    fallback.colon.y = Math.round(
      (hourPos.y + hourFile.height / 2 + minutePos.y + minuteFile.height / 2) / 2
    );
    fallback.colon.size = Math.max(hourFile.height, minuteFile.height);
  }
  const monthRect = parseConfigRect(config["english_date_month_rect"]);
  const dayRect = parseConfigRect(config["english_date_day_rect"]);
  if (monthRect && dayRect) {
    fallback.dateSlash.x = Math.round((monthRect.x1 + dayRect.x0) / 2);
    fallback.dateSlash.y = Math.round(
      (monthRect.y0 + monthRect.y1 + dayRect.y0 + dayRect.y1) / 4
    );
    fallback.dateSlash.size = Math.max(
      12,
      Math.round(Math.max(monthRect.y1 - monthRect.y0, dayRect.y1 - dayRect.y0))
    );
  }
  return fallback;
}

/** Hides the firmware colon when a draggable static replacement is enabled. */
export function buildStaticSeparatorOverrides(
  details: CorosWatchfaceTemplateDetails,
  separators: WatchfaceStaticSeparators
): CorosWatchfaceConfigOverride[] {
  if (!separators.colon.enabled && !separators.dateSlash.enabled) {
    return [];
  }
  return details.resolutions.flatMap((resolution) => {
    const values: Record<string, string> = {};
    if (
      separators.colon.enabled &&
      Object.prototype.hasOwnProperty.call(resolution.config, "colon_icon")
    ) {
      values.colon_icon = "";
    }
    if (
      separators.colon.enabled &&
      separators.dateSlash.enabled &&
      Object.prototype.hasOwnProperty.call(resolution.config, "arc_cut_icon")
    ) {
      values.arc_cut_icon = "";
    }
    return Object.keys(values).length > 0
      ? [{ path: `${resolution.directory}/config.txt`, values }]
      : [];
  });
}

/**
 * The AM/PM indicator stays a live sprite (the firmware swaps am/pm by the
 * clock, in 12-hour mode), so unlike the static separators it cannot be baked
 * into the background. Styling instead re-points the template's am/pm config
 * keys at studio-generated sprites.
 */
export interface WatchfaceAmPmStyle {
  enabled: boolean;
  /** Top-left corner in preview-resolution coordinates (`am_pm_icon_pos`). */
  x: number;
  y: number;
  scale: number;
  color: string;
}

const AMPM_CONFIG_KEYS = ["am_icon", "pm_icon", "am_pm_icon_pos"] as const;
// The main process only accepts created sprites under studio/<name>/NN.png,
// so the AM icon becomes 00.png and the PM icon 01.png of one studio folder.
const AMPM_SPRITE_FILES = { am: "studio/ampm/00.png", pm: "studio/ampm/01.png" };
const AMPM_CONFIG_VALUES = { am: "studio\\ampm\\00.png", pm: "studio\\ampm\\01.png" };

function findAmPmIcons(
  resolution: CorosWatchfaceResolutionDetails
): { am: CorosWatchfaceSpriteFile; pm: CorosWatchfaceSpriteFile } | null {
  const lookup = (name: string) =>
    resolution.icons.find(
      (icon) =>
        icon.path.toLowerCase() ===
        `${resolution.directory}/icon/${name}`.toLowerCase()
    ) ?? null;
  const am = lookup("am.png");
  const pm = lookup("pm.png");
  return am && pm ? { am, pm } : null;
}

function resolutionSupportsAmPm(
  resolution: CorosWatchfaceResolutionDetails
): boolean {
  return (
    AMPM_CONFIG_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(resolution.config, key)
    ) && findAmPmIcons(resolution) !== null
  );
}

export interface WatchfaceAmPmCapability {
  /** The preview resolution's AM icon, for bounds and preview sizing. */
  icon: CorosWatchfaceSpriteFile;
  /** Whether the template ships with the indicator already wired up. */
  active: boolean;
  defaultPos: { x: number; y: number };
}

/** Whether the template can show an AM/PM indicator, and where to start it. */
export function getAmPmCapability(
  details: CorosWatchfaceTemplateDetails
): WatchfaceAmPmCapability | null {
  const resolution = pickPreviewResolution(details);
  if (!resolution || !resolutionSupportsAmPm(resolution)) {
    return null;
  }
  const icons = findAmPmIcons(resolution)!;
  let defaultPos = parseConfigPos(resolution.config["am_pm_icon_pos"]);
  if (!defaultPos) {
    const minutePos = parseConfigPos(resolution.config["time_minute_low_pos"]);
    const minuteFile = findSpriteFolder(
      resolution,
      resolution.config["time_minute_low_font"]
    )?.files[0];
    defaultPos =
      minutePos && minuteFile
        ? {
            x: minutePos.x + minuteFile.width + 12,
            y: Math.round(
              minutePos.y + minuteFile.height / 2 - icons.am.height / 2
            )
          }
        : {
            x: Math.round(resolution.width * 0.6),
            y: Math.round(resolution.height * 0.45)
          };
  }
  return {
    icon: icons.am,
    active: (resolution.config["am_icon"] ?? "") !== "",
    defaultPos
  };
}

/** Points the firmware's AM/PM keys at the studio sprites, or clears them. */
export function buildAmPmOverrides(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceAmPmStyle
): CorosWatchfaceConfigOverride[] {
  const base = pickPreviewResolution(details);
  if (!base) {
    return [];
  }
  return details.resolutions.flatMap((resolution) => {
    if (!resolutionSupportsAmPm(resolution)) {
      return [];
    }
    if (!style.enabled) {
      // Restore the dormant form templates ship with, but only when the
      // template arrived active; otherwise leave the config untouched.
      return (resolution.config["am_icon"] ?? "") !== ""
        ? [
            {
              path: `${resolution.directory}/config.txt`,
              values: { am_icon: "", pm_icon: "", am_pm_icon_pos: "" }
            }
          ]
        : [];
    }
    const scale = resolution.width / base.width;
    return [
      {
        path: `${resolution.directory}/config.txt`,
        values: {
          am_icon: AMPM_CONFIG_VALUES.am,
          pm_icon: AMPM_CONFIG_VALUES.pm,
          am_pm_icon_pos: `{${Math.round(style.x * scale)},${Math.round(style.y * scale)}}`
        }
      }
    ];
  });
}

/** Generates the resized and tinted AM/PM sprites as new studio entries. */
export async function buildAmPmSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceAmPmStyle,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  if (!style.enabled) {
    return [];
  }
  const normalizedScale = Math.max(0.5, Math.min(2, style.scale));
  const jobs: { source: CorosWatchfaceSpriteFile; path: string }[] = [];
  for (const resolution of details.resolutions) {
    if (!resolutionSupportsAmPm(resolution)) {
      continue;
    }
    const icons = findAmPmIcons(resolution)!;
    jobs.push(
      { source: icons.am, path: `${resolution.directory}/${AMPM_SPRITE_FILES.am}` },
      { source: icons.pm, path: `${resolution.directory}/${AMPM_SPRITE_FILES.pm}` }
    );
  }
  const assets = await loadAssets([...new Set(jobs.map((job) => job.source.path))]);
  const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const job of jobs) {
    replacements.push({
      path: job.path,
      dataUrl: await resizeAndTintSprite(
        assetsByPath.get(job.source.path)?.dataUrl ?? "",
        Math.max(1, Math.round(job.source.width * normalizedScale)),
        Math.max(1, Math.round(job.source.height * normalizedScale)),
        style.color
      ),
      create: true
    });
  }
  return replacements;
}

/**
 * Renders one digit into a sprite of the template's exact pixel size. The
 * glyph is measured and centered so mixed fonts still align on the face.
 */
export function renderDigitSprite(
  text: string,
  width: number,
  height: number,
  fontFamily: string,
  color: string
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }

  let fontSize = Math.floor(height * 0.92);
  context.textBaseline = "alphabetic";
  context.fillStyle = color;
  for (; fontSize > 4; fontSize -= 1) {
    context.font = `600 ${fontSize}px ${quoteFontFamily(fontFamily)}`;
    const metrics = context.measureText(text);
    const glyphHeight =
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (metrics.width <= width * 0.96 && glyphHeight <= height * 0.96) {
      break;
    }
  }
  const metrics = context.measureText(text);
  const glyphHeight =
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  context.fillText(
    text,
    (width - metrics.width) / 2,
    (height - glyphHeight) / 2 + metrics.actualBoundingBoxAscent
  );
  return canvas.toDataURL("image/png");
}

/** Recolors a sprite while preserving its alpha silhouette. */
export async function tintSprite(
  dataUrl: string,
  width: number,
  height: number,
  color: string
): Promise<string> {
  return resizeAndTintSprite(dataUrl, width, height, color);
}

/** Resizes a source bitmap and optionally recolors its non-transparent pixels. */
export async function resizeAndTintSprite(
  dataUrl: string,
  width: number,
  height: number,
  color?: string
): Promise<string> {
  const image = await loadStudioImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite tinting is unavailable in this window.");
  }
  context.drawImage(image, 0, 0, width, height);
  if (color) {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  }
  return canvas.toDataURL("image/png");
}

export function loadStudioImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A studio image failed to load."));
    image.src = dataUrl;
  });
}

function isAodSprite(file: CorosWatchfaceSpriteFile): boolean {
  return /\/a\//.test(file.path);
}

function quoteFontFamily(fontFamily: string): string {
  return /[^a-zA-Z0-9-]/.test(fontFamily) ? `"${fontFamily}"` : fontFamily;
}

/**
 * Produces every sprite replacement the selected style implies, across all
 * resolutions and the AOD tree. Untouched template entries are left alone.
 */
export async function buildStudioReplacements(
  details: CorosWatchfaceTemplateDetails,
  options: WatchfaceStudioOptions,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  const tintJobs: { file: CorosWatchfaceSpriteFile; color: string }[] = [];
  const labelColor = options.digitColor;

  for (const resolution of details.resolutions) {
    for (const folder of resolution.spriteFolders) {
      if (folder.kind === "digits" && options.fontFamily) {
        const color = folder.aod
          ? dimHexColor(options.digitColor, AOD_DIM_FACTOR)
          : options.digitColor;
        folder.files.forEach((file, digit) => {
          replacements.push({
            path: file.path,
            dataUrl: renderDigitSprite(
              String(digit),
              file.width,
              file.height,
              options.fontFamily,
              color
            )
          });
        });
      } else if (folder.kind === "week" && options.tintLabels) {
        const color = folder.aod
          ? dimHexColor(labelColor, AOD_DIM_FACTOR)
          : labelColor;
        for (const file of folder.files) {
          tintJobs.push({ file, color });
        }
      }
    }
    if (options.tintIcons) {
      for (const icon of resolution.icons) {
        const color = isAodSprite(icon)
          ? dimHexColor(options.accentColor, AOD_DIM_FACTOR)
          : options.accentColor;
        tintJobs.push({ file: icon, color });
      }
    }
  }

  if (tintJobs.length > 0) {
    const assets = await loadAssets([
      ...new Set(tintJobs.map((job) => job.file.path))
    ]);
    const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
    for (const job of tintJobs) {
      const asset = assetsByPath.get(job.file.path);
      if (!asset) {
        continue;
      }
      replacements.push({
        path: asset.path,
        dataUrl: await tintSprite(
          asset.dataUrl,
          asset.width,
          asset.height,
          job.color
        )
      });
    }
  }
  return replacements;
}

/** Counts what a style selection will regenerate, for the UI summary. */
export function summarizeStudioReplacements(
  details: CorosWatchfaceTemplateDetails,
  options: WatchfaceStudioOptions
): { digits: number; labels: number; icons: number } {
  let digits = 0;
  let labels = 0;
  let icons = 0;
  for (const resolution of details.resolutions) {
    for (const folder of resolution.spriteFolders) {
      if (folder.kind === "digits" && options.fontFamily) {
        digits += folder.files.length;
      } else if (folder.kind === "week" && options.tintLabels) {
        labels += folder.files.length;
      }
    }
    if (options.tintIcons) {
      icons += resolution.icons.length;
    }
  }
  return { digits, labels, icons };
}

export interface WatchfaceLayoutOffset {
  dx: number;
  dy: number;
}

export interface WatchfaceLayoutGroup {
  id: string;
  label: string;
  patterns: RegExp[];
}

export type WatchfaceMetricId =
  | "heartRate"
  | "steps"
  | "calories"
  | "elevation"
  | "temperature";

export interface WatchfaceMetricSpriteStyle {
  color: string;
  /** Scale relative to the source template digit sprites. */
  scale: number;
  /** Optional per-layer font; falls back to the design font. */
  fontFamily?: string;
}

export type WatchfaceMetricStyles = Partial<
  Record<WatchfaceMetricId, WatchfaceMetricSpriteStyle>
>;

export type WatchfaceTimePartId = "hours" | "minutes";

export type WatchfaceTimeStyles = Partial<
  Record<WatchfaceTimePartId, WatchfaceMetricSpriteStyle>
>;

export type WatchfaceDatePartId = "weekday" | "dateMonth" | "dateDay";

export interface WatchfaceDateSpriteStyle {
  /** Scale relative to the source template sprites. */
  scale: number;
  /** Optional per-layer font; falls back to the design font. */
  fontFamily?: string;
  color?: string;
}

export type WatchfaceDateStyles = Partial<
  Record<WatchfaceDatePartId, WatchfaceDateSpriteStyle>
>;

interface WatchfaceDatePartDefinition {
  id: WatchfaceDatePartId;
  rectKey: string;
  fontKey: string;
  studioFolder: string;
  kind: "digits" | "week";
}

export const WATCHFACE_DATE_PARTS: WatchfaceDatePartDefinition[] = [
  {
    id: "weekday",
    rectKey: "english_date_week_rect",
    fontKey: "english_date_week_font",
    studioFolder: "cl_weekday",
    kind: "week"
  },
  {
    id: "dateMonth",
    rectKey: "english_date_month_rect",
    fontKey: "english_date_month_font",
    studioFolder: "cl_date_month",
    kind: "digits"
  },
  {
    id: "dateDay",
    rectKey: "english_date_day_rect",
    fontKey: "english_date_day_font",
    studioFolder: "cl_date_day",
    kind: "digits"
  }
];

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface WatchfaceTimePartDefinition {
  id: WatchfaceTimePartId;
  label: string;
  digits: {
    slot: "high" | "low";
    posKey: string;
    fontKey: string;
  }[];
}

export const WATCHFACE_TIME_PARTS: WatchfaceTimePartDefinition[] = [
  {
    id: "hours",
    label: "Hours",
    digits: [
      { slot: "high", posKey: "time_hour_high_pos", fontKey: "time_hour_high_font" },
      { slot: "low", posKey: "time_hour_low_pos", fontKey: "time_hour_low_font" }
    ]
  },
  {
    id: "minutes",
    label: "Minutes",
    digits: [
      { slot: "high", posKey: "time_minute_high_pos", fontKey: "time_minute_high_font" },
      { slot: "low", posKey: "time_minute_low_pos", fontKey: "time_minute_low_font" }
    ]
  }
];

export type WatchfaceComplicationId =
  | "heartRate"
  | "steps"
  | "calories"
  | "floors"
  | "elevation"
  | "temperature";

interface WatchfaceFixedMetricDefinition {
  id: WatchfaceMetricId;
  label: string;
  rectKey: string;
  fontKey: string;
  /** Some templates omit this otherwise valid key when the metric is inactive. */
  allowMissingFontKey?: boolean;
  fontColorKey?: string;
  negativeSignKey?: string;
  controlPrefix: string;
  sampleValue: string;
  maxDigits: number;
  center: { x: number; y: number };
}

interface WatchfaceComplicationDefinition {
  id: WatchfaceComplicationId;
  label: string;
  controlPrefix: string;
  sampleValue: string;
}

export const WATCHFACE_FIXED_METRICS: WatchfaceFixedMetricDefinition[] = [
  {
    id: "heartRate",
    label: "Heart rate",
    // `heartreate` is the spelling used by COROS's source templates.
    rectKey: "heartreate_level_rect",
    fontKey: "heartreate_level_font",
    controlPrefix: "hr",
    sampleValue: "96",
    maxDigits: 3,
    center: { x: 0.25, y: 0.76 }
  },
  {
    id: "steps",
    label: "Steps",
    rectKey: "step_rect",
    fontKey: "step_font",
    controlPrefix: "step",
    sampleValue: "8420",
    maxDigits: 5,
    center: { x: 0.73, y: 0.76 }
  },
  {
    id: "calories",
    label: "Calories",
    rectKey: "kcal_rect",
    fontKey: "kcal_font",
    controlPrefix: "kcal",
    sampleValue: "534",
    maxDigits: 5,
    center: { x: 0.25, y: 0.86 }
  },
  {
    id: "elevation",
    label: "Elevation",
    rectKey: "elevation_rect",
    fontKey: "elevation_font",
    controlPrefix: "elevation",
    sampleValue: "1284",
    maxDigits: 5,
    center: { x: 0.73, y: 0.86 }
  },
  {
    id: "temperature",
    label: "Temperature",
    rectKey: "temperature_rect",
    fontKey: "temperature_font",
    allowMissingFontKey: true,
    fontColorKey: "temperature_font_color",
    negativeSignKey: "temperature_negative_sign_icon",
    controlPrefix: "temperature",
    sampleValue: "18",
    maxDigits: 3,
    center: { x: 0.5, y: 0.7 }
  }
];

const METRIC_STUDIO_FOLDERS: Record<WatchfaceMetricId, string> = {
  heartRate: "cl_hr",
  steps: "cl_steps",
  calories: "cl_kcal",
  elevation: "cl_elev",
  temperature: "cl_temp"
};

function timeStudioFolder(
  part: WatchfaceTimePartId,
  slot: "high" | "low"
): string {
  return `cl_${part === "hours" ? "h" : "m"}${slot === "high" ? "h" : "l"}`;
}

export const WATCHFACE_COMPLICATIONS: WatchfaceComplicationDefinition[] = [
  { id: "heartRate", label: "Heart rate", controlPrefix: "hr", sampleValue: "96" },
  { id: "steps", label: "Steps", controlPrefix: "step", sampleValue: "8420" },
  { id: "calories", label: "Calories", controlPrefix: "kcal", sampleValue: "534" },
  { id: "floors", label: "Floors", controlPrefix: "floor", sampleValue: "12" },
  { id: "elevation", label: "Elevation", controlPrefix: "elevation", sampleValue: "1284" },
  { id: "temperature", label: "Temperature", controlPrefix: "temperature", sampleValue: "18" }
];

export type WatchfaceMetricChanges = Partial<Record<WatchfaceMetricId, boolean>>;

export interface WatchfaceMetricCapability {
  id: WatchfaceMetricId;
  label: string;
  active: boolean;
}

/** Fixed metrics supported by a template and whether they are already active. */
export function getFixedMetricCapabilities(
  details: CorosWatchfaceTemplateDetails
): WatchfaceMetricCapability[] {
  const resolution = pickPreviewResolution(details);
  if (!resolution) {
    return [];
  }
  return WATCHFACE_FIXED_METRICS.flatMap((metric) =>
    Object.prototype.hasOwnProperty.call(resolution.config, metric.rectKey) &&
    (metric.allowMissingFontKey ||
      Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey))
      ? [{
          id: metric.id,
          label: metric.label,
          active: parseConfigRect(resolution.config[metric.rectKey]) !== null
        }]
      : []
  );
}

/** Complication choices implemented by the template's control slot. */
export function getAvailableComplications(
  details: CorosWatchfaceTemplateDetails
): WatchfaceComplicationDefinition[] {
  const resolution = pickPreviewResolution(details);
  if (!resolution) {
    return [];
  }
  return WATCHFACE_COMPLICATIONS.filter(({ controlPrefix }) =>
    Boolean(
      parseConfigRect(resolution.config[`control_${controlPrefix}_rect`]) &&
      findSpriteFolder(resolution, resolution.config[`control_${controlPrefix}_font`])
    )
  );
}

function metricFontFolder(
  resolution: CorosWatchfaceResolutionDetails,
  metric: WatchfaceFixedMetricDefinition
): PreviewDigitSource | null {
  const candidates = [
    resolution.config[metric.fontKey],
    resolution.config[`control_${metric.controlPrefix}_font`],
    resolution.config["control_step_font"],
    resolution.config["time_second_high_font"],
    resolution.config["time_hour_high_font"]
  ];
  for (const candidate of candidates) {
    const folder = findSpriteFolder(resolution, candidate);
    if (folder) {
      return folder;
    }
  }
  const folder = resolution.spriteFolders.find(
    (candidate) => candidate.kind === "digits" && !candidate.aod
  );
  return folder ? { folder: folder.folder, files: folder.files } : null;
}

function temperatureNegativeSignValue(
  resolution: CorosWatchfaceResolutionDetails
): string | undefined {
  for (const key of [
    "control_temperature_negative_sign_icon",
    "control_negative_sign_icon",
    "negative_sign_icon"
  ]) {
    const value = resolution.config[key];
    if (value) {
      return value;
    }
  }
  const icon = resolution.icons.find((entry) => /negative/i.test(entry.path));
  return icon?.path
    .slice(`${resolution.directory}/`.length)
    .replace(/\//g, "\\");
}

function configHexColor(color: string): string {
  return `0x${color.replace(/^#/, "").toUpperCase()}`;
}

/** Activates or removes fixed live metrics in every template resolution. */
export function buildMetricOverrides(
  details: CorosWatchfaceTemplateDetails,
  changes: WatchfaceMetricChanges
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const metric of WATCHFACE_FIXED_METRICS) {
      const enabled = changes[metric.id];
      if (
        enabled === undefined ||
        !Object.prototype.hasOwnProperty.call(resolution.config, metric.rectKey) ||
        (!metric.allowMissingFontKey &&
          !Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey))
      ) {
        continue;
      }
      if (!enabled) {
        values[metric.rectKey] = "";
        if (
          Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey)
        ) {
          values[metric.fontKey] = "";
        }
        if (metric.negativeSignKey) {
          values[metric.negativeSignKey] = "";
        }
        continue;
      }
      const font = metricFontFolder(resolution, metric);
      const sample = font?.files[0];
      if (!font || !sample) {
        continue;
      }
      const rectWidth = sample.width * metric.maxDigits;
      const rectHeight = sample.height;
      const centerX = Math.round(resolution.width * metric.center.x);
      const centerY = Math.round(resolution.height * metric.center.y);
      const x0 = Math.max(0, Math.round(centerX - rectWidth / 2));
      const y0 = Math.max(0, Math.round(centerY - rectHeight / 2));
      const x1 = Math.min(resolution.width, x0 + rectWidth);
      const y1 = Math.min(resolution.height, y0 + rectHeight);
      values[metric.rectKey] = `{${x0},${y0},${x1},${y1},hcenter|vcenter}`;
      values[metric.fontKey] = font.folder;
      if (metric.negativeSignKey) {
        const negativeSign = temperatureNegativeSignValue(resolution);
        if (negativeSign) {
          values[metric.negativeSignKey] = negativeSign;
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Scales a firmware rect around its center while preserving alignment flags. */
export function scaleConfigRectValue(value: string, scale: number): string | null {
  const match = value.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*((?:,[^}]*)?)\}$/
  );
  if (!match) {
    return null;
  }
  const x0 = Number(match[1]);
  const y0 = Number(match[2]);
  const x1 = Number(match[3]);
  const y1 = Number(match[4]);
  const normalizedScale = Math.max(0.5, Math.min(2, scale));
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;
  const width = Math.max(1, Math.round((x1 - x0) * normalizedScale));
  const height = Math.max(1, Math.round((y1 - y0) * normalizedScale));
  const nextX0 = Math.round(centerX - width / 2);
  const nextY0 = Math.round(centerY - height / 2);
  return `{${nextX0},${nextY0},${nextX0 + width},${nextY0 + height}${match[5]}}`;
}

/**
 * Config changes for per-metric sprite sizes. Export mode also points each
 * metric at its dedicated generated bitmap folder.
 */
export function buildMetricStyleOverrides(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceMetricStyles,
  useStudioFolders = false
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const metric of WATCHFACE_FIXED_METRICS) {
      const style = styles[metric.id];
      const rect = style
        ? scaleConfigRectValue(resolution.config[metric.rectKey] ?? "", style.scale)
        : null;
      if (!style || !rect || !metricFontFolder(resolution, metric)) {
        continue;
      }
      values[metric.rectKey] = rect;
      if (useStudioFolders) {
        values[metric.fontKey] = METRIC_STUDIO_FOLDERS[metric.id];
      }
      if (metric.fontColorKey) {
        values[metric.fontColorKey] = configHexColor(style.color);
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Generates an isolated ten-digit bitmap folder for every customized metric. */
export async function buildMetricSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceMetricStyles,
  fontFamily: string,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  const jobs: {
    source: CorosWatchfaceSpriteFile;
    path: string;
    digit: number;
    width: number;
    height: number;
    color: string;
    fontFamily: string;
  }[] = [];
  for (const resolution of details.resolutions) {
    for (const metric of WATCHFACE_FIXED_METRICS) {
      const style = styles[metric.id];
      const rect = parseConfigRect(resolution.config[metric.rectKey]);
      const source = style ? metricFontFolder(resolution, metric) : null;
      if (!style || !rect || !source) {
        continue;
      }
      const normalizedScale = Math.max(0.5, Math.min(2, style.scale));
      const metricFontFamily = style.fontFamily ?? fontFamily;
      source.files.slice(0, 10).forEach((file, digit) => {
        jobs.push({
          source: file,
          path: `${resolution.directory}/${METRIC_STUDIO_FOLDERS[metric.id]}/${String(digit).padStart(2, "0")}.png`,
          digit,
          width: Math.max(1, Math.round(file.width * normalizedScale)),
          height: Math.max(1, Math.round(file.height * normalizedScale)),
          color: style.color,
          fontFamily: metricFontFamily
        });
      });
    }
  }
  const sourceAssets = await loadAssets([
    ...new Set(
      jobs.filter((job) => !job.fontFamily).map((job) => job.source.path)
    )
  ]);
  const assetsByPath = new Map(sourceAssets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const job of jobs) {
    const dataUrl = job.fontFamily
      ? renderDigitSprite(
          String(job.digit),
          job.width,
          job.height,
          job.fontFamily,
          job.color
        )
      : await resizeAndTintSprite(
          assetsByPath.get(job.source.path)?.dataUrl ?? "",
          job.width,
          job.height,
          job.color
        );
    replacements.push({ path: job.path, dataUrl, create: true });
  }
  return replacements;
}

/** Resizes hour/minute positions around each two-digit group's own center. */
export function buildTimeStyleOverrides(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceTimeStyles,
  useStudioFolders = false
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const part of WATCHFACE_TIME_PARTS) {
      const style = styles[part.id];
      if (!style) {
        continue;
      }
      const planned = part.digits.flatMap((digit) => {
        const pos = parseConfigPos(resolution.config[digit.posKey]);
        const source = findSpriteFolder(resolution, resolution.config[digit.fontKey]);
        const sample = source?.files[0];
        return pos && source && sample ? [{ digit, pos, source, sample }] : [];
      });
      if (planned.length !== part.digits.length) {
        continue;
      }
      const x0 = Math.min(...planned.map((item) => item.pos.x));
      const y0 = Math.min(...planned.map((item) => item.pos.y));
      const x1 = Math.max(...planned.map((item) => item.pos.x + item.sample.width));
      const y1 = Math.max(...planned.map((item) => item.pos.y + item.sample.height));
      const centerX = (x0 + x1) / 2;
      const centerY = (y0 + y1) / 2;
      const normalizedScale = Math.max(0.5, Math.min(2, style.scale));
      for (const item of planned) {
        const x = Math.round(centerX + (item.pos.x - centerX) * normalizedScale);
        const y = Math.round(centerY + (item.pos.y - centerY) * normalizedScale);
        values[item.digit.posKey] = `{${x},${y}}`;
        if (useStudioFolders) {
          values[item.digit.fontKey] = timeStudioFolder(
            part.id,
            item.digit.slot
          );
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Generates isolated high/low digit folders for customized hours and minutes. */
export async function buildTimeSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceTimeStyles,
  fontFamily: string,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  const jobs: {
    source: CorosWatchfaceSpriteFile;
    path: string;
    digit: number;
    width: number;
    height: number;
    color: string;
    fontFamily: string;
  }[] = [];
  for (const resolution of details.resolutions) {
    for (const part of WATCHFACE_TIME_PARTS) {
      const style = styles[part.id];
      if (!style) {
        continue;
      }
      const normalizedScale = Math.max(0.5, Math.min(2, style.scale));
      const partFontFamily = style.fontFamily ?? fontFamily;
      for (const digit of part.digits) {
        const source = findSpriteFolder(resolution, resolution.config[digit.fontKey]);
        if (!source) {
          continue;
        }
        source.files.slice(0, 10).forEach((file, value) => {
          jobs.push({
            source: file,
            path: `${resolution.directory}/${timeStudioFolder(part.id, digit.slot)}/${String(value).padStart(2, "0")}.png`,
            digit: value,
            width: Math.max(1, Math.round(file.width * normalizedScale)),
            height: Math.max(1, Math.round(file.height * normalizedScale)),
            color: style.color,
            fontFamily: partFontFamily
          });
        });
      }
    }
  }
  const sourceAssets = await loadAssets([
    ...new Set(
      jobs.filter((job) => !job.fontFamily).map((job) => job.source.path)
    )
  ]);
  const assetsByPath = new Map(sourceAssets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const job of jobs) {
    const dataUrl = job.fontFamily
      ? renderDigitSprite(
          String(job.digit),
          job.width,
          job.height,
          job.fontFamily,
          job.color
        )
      : await resizeAndTintSprite(
          assetsByPath.get(job.source.path)?.dataUrl ?? "",
          job.width,
          job.height,
          job.color
        );
    replacements.push({ path: job.path, dataUrl, create: true });
  }
  return replacements;
}

/** Scales weekday/month/day layout rectangles and isolates their sprite folders. */
export function buildDateStyleOverrides(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceDateStyles,
  useStudioFolders = false
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const part of WATCHFACE_DATE_PARTS) {
      const style = styles[part.id];
      const rect = style
        ? scaleConfigRectValue(resolution.config[part.rectKey] ?? "", style.scale)
        : null;
      const source = findSpriteFolder(resolution, resolution.config[part.fontKey]);
      if (!style || !rect || !source) {
        continue;
      }
      values[part.rectKey] = rect;
      if (style.color) {
        values[part.fontKey.replace(/_font$/, "_font_color")] =
          configHexColor(style.color);
      }
      if (useStudioFolders) {
        values[part.fontKey] = part.studioFolder;
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Generates isolated, resized sprite folders for weekday/month/day layers. */
export async function buildDateSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceDateStyles,
  options: Pick<WatchfaceStudioOptions, "fontFamily" | "digitColor" | "tintLabels">,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  const jobs: {
    source: CorosWatchfaceSpriteFile;
    path: string;
    value: number;
    width: number;
    height: number;
    kind: "digits" | "week";
    fontFamily: string;
    color?: string;
  }[] = [];
  for (const resolution of details.resolutions) {
    for (const part of WATCHFACE_DATE_PARTS) {
      const style = styles[part.id];
      const source = style
        ? findSpriteFolder(resolution, resolution.config[part.fontKey])
        : null;
      if (!style || !source) {
        continue;
      }
      const normalizedScale = Math.max(0.5, Math.min(2, style.scale));
      const partFontFamily = style.fontFamily ?? options.fontFamily;
      const limit = part.kind === "week" ? 7 : 10;
      source.files.slice(0, limit).forEach((file, value) => {
        jobs.push({
          source: file,
          path: `${resolution.directory}/${part.studioFolder}/${String(value).padStart(2, "0")}.png`,
          value,
          width: Math.max(1, Math.round(file.width * normalizedScale)),
          height: Math.max(1, Math.round(file.height * normalizedScale)),
          kind: part.kind,
          fontFamily: partFontFamily,
          color: style.color
        });
      });
    }
  }
  const assets = await loadAssets([
    ...new Set(
      jobs.filter((job) => !job.fontFamily).map((job) => job.source.path)
    )
  ]);
  const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const job of jobs) {
    const asset = assetsByPath.get(job.source.path);
    if (!asset && !job.fontFamily) {
      continue;
    }
    const dataUrl = job.fontFamily
      ? renderDigitSprite(
          job.kind === "week"
            ? WEEKDAY_LABELS[job.value] ?? String(job.value)
            : String(job.value),
          job.width,
          job.height,
          job.fontFamily,
          job.color ?? options.digitColor
        )
      : await resizeAndTintSprite(
          asset!.dataUrl,
          job.width,
          job.height,
          job.color ??
            (job.kind === "week" && options.tintLabels
              ? options.digitColor
              : undefined)
        );
    replacements.push({ path: job.path, dataUrl, create: true });
  }
  return replacements;
}

/** Applies config overrides to a details copy for live previewing. */
export function applyConfigOverridesToDetails(
  details: CorosWatchfaceTemplateDetails,
  overrides: CorosWatchfaceConfigOverride[]
): CorosWatchfaceTemplateDetails {
  const byPath = new Map(overrides.map((entry) => [entry.path, entry.values]));
  return {
    ...details,
    resolutions: details.resolutions.map((resolution) => {
      const values = byPath.get(`${resolution.directory}/config.txt`);
      return values
        ? { ...resolution, config: { ...resolution.config, ...values } }
        : resolution;
    })
  };
}

/** Combines independent config edits into one entry per config file. */
export function mergeConfigOverrides(
  ...groups: CorosWatchfaceConfigOverride[][]
): CorosWatchfaceConfigOverride[] {
  const merged = new Map<string, Record<string, string>>();
  for (const group of groups) {
    for (const override of group) {
      merged.set(override.path, {
        ...(merged.get(override.path) ?? {}),
        ...override.values
      });
    }
  }
  return [...merged].map(([path, values]) => ({ path, values }));
}

/**
 * Coalesces sprite jobs that target the same archive path. Later groups win,
 * allowing component-specific styling to override a global font/tint pass.
 */
export function mergeAssetReplacements(
  ...groups: CorosWatchfaceAssetReplacement[][]
): CorosWatchfaceAssetReplacement[] {
  const merged = new Map<string, CorosWatchfaceAssetReplacement>();
  for (const group of groups) {
    for (const replacement of group) {
      merged.set(replacement.path, replacement);
    }
  }
  return [...merged.values()];
}

/**
 * Movable element groups, matched against the template's own config keys.
 * Positions (`{x,y}`) and rects (`{x0,y0,x1,y1,align}`) are both shiftable.
 */
export const WATCHFACE_LAYOUT_GROUPS: WatchfaceLayoutGroup[] = [
  {
    id: "hours",
    label: "Hour digits",
    patterns: [/^time_hour_(high|low)_pos$/]
  },
  {
    id: "minutes",
    label: "Minute digits",
    patterns: [/^time_minute_(high|low)_pos$/]
  },
  {
    id: "seconds",
    label: "Seconds",
    patterns: [/^time_second_(high|low)_pos$/]
  },
  {
    id: "weekday",
    label: "Weekday",
    patterns: [/^[a-z_]+_date_week_rect$/]
  },
  {
    id: "dateMonth",
    label: "Date month",
    patterns: [/^[a-z_]+_date_month_rect$/]
  },
  {
    id: "dateDay",
    label: "Date day",
    patterns: [/^[a-z_]+_date_day_rect$/]
  },
  {
    id: "separators",
    label: "Time & date separators",
    patterns: [/^arc_cut_icon_pos$/]
  },
  {
    id: "battery",
    label: "Battery",
    patterns: [/^battery_level_rect$/]
  },
  {
    id: "complication",
    label: "Selectable metric",
    // Child control positions are relative to this origin. Moving both the
    // origin and every child would apply the offset twice on the watch.
    patterns: [/^rect_control\d+_pos$/]
  },
  {
    id: "heartRate",
    label: "Heart rate",
    patterns: [/^heartreate_level_rect$/]
  },
  {
    id: "steps",
    label: "Steps",
    patterns: [/^step_rect$/]
  },
  {
    id: "calories",
    label: "Calories",
    patterns: [/^kcal_rect$/]
  },
  {
    id: "elevation",
    label: "Elevation",
    patterns: [/^elevation_rect$/]
  },
  {
    id: "temperature",
    label: "Temperature",
    patterns: [/^temperature_rect$/]
  }
];

/** Shifts a `{x,y}` or `{x0,y0,x1,y1,…}` config value, keeping other syntax. */
export function offsetConfigValue(
  value: string,
  dx: number,
  dy: number
): string | null {
  const pos = value.match(/^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}$/);
  if (pos) {
    return `{${Number(pos[1]) + dx},${Number(pos[2]) + dy}}`;
  }
  const rect = value.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*((?:,[^}]*)?)\}$/
  );
  if (rect) {
    return `{${Number(rect[1]) + dx},${Number(rect[2]) + dy},${Number(rect[3]) + dx},${Number(rect[4]) + dy}${rect[5]}}`;
  }
  return null;
}

/** The config keys of one resolution that a layout group would move. */
export function layoutGroupKeys(
  resolution: CorosWatchfaceResolutionDetails,
  group: WatchfaceLayoutGroup
): string[] {
  return Object.keys(resolution.config).filter(
    (key) =>
      group.patterns.some((pattern) => pattern.test(key)) &&
      offsetConfigValue(resolution.config[key]!, 0, 0) !== null
  );
}

/**
 * Turns per-group pixel offsets (in the largest resolution's coordinates)
 * into config.txt overrides for every resolution, scaled proportionally.
 * The AOD layout is intentionally left untouched.
 */
export function buildLayoutOverrides(
  details: CorosWatchfaceTemplateDetails,
  offsets: Record<string, WatchfaceLayoutOffset>
): CorosWatchfaceConfigOverride[] {
  const base = pickPreviewResolution(details);
  if (!base) {
    return [];
  }
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const scale = resolution.width / base.width;
    const values: Record<string, string> = {};
    for (const group of WATCHFACE_LAYOUT_GROUPS) {
      const offset = offsets[group.id];
      if (!offset || (offset.dx === 0 && offset.dy === 0)) {
        continue;
      }
      const dx = Math.round(offset.dx * scale);
      const dy = Math.round(offset.dy * scale);
      if (dx === 0 && dy === 0) {
        continue;
      }
      for (const key of layoutGroupKeys(resolution, group)) {
        const shifted = offsetConfigValue(resolution.config[key]!, dx, dy);
        if (shifted !== null) {
          values[key] = shifted;
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Hides firmware-backed editor layers by clearing their position/rect keys. */
export function buildLayerVisibilityOverrides(
  details: CorosWatchfaceTemplateDetails,
  visibility: Record<string, boolean>
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const group of WATCHFACE_LAYOUT_GROUPS) {
      if (visibility[group.id] !== false) {
        continue;
      }
      for (const key of layoutGroupKeys(resolution, group)) {
        values[key] = "";
      }
      if (group.id === "separators") {
        for (const key of ["colon_icon", "arc_cut_icon"]) {
          if (Object.prototype.hasOwnProperty.call(resolution.config, key)) {
            values[key] = "";
          }
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Applies color fields supported directly by COROS firmware config entries. */
export function buildLayerColorOverrides(
  details: CorosWatchfaceTemplateDetails,
  colors: Record<string, string>
): CorosWatchfaceConfigOverride[] {
  const colorKeys: Record<string, RegExp[]> = {
    hours: [/^time_hour_(high|low)_font_color$/],
    minutes: [/^time_minute_(high|low)_font_color$/],
    seconds: [/^time_second_(high|low)_font_color$/],
    weekday: [/^[a-z_]+_date_week_font_color$/],
    dateMonth: [/^[a-z_]+_date_month_font_color$/],
    dateDay: [/^[a-z_]+_date_day_font_color$/],
    battery: [/^battery_level_font_color$/],
    complication: [/^control_[a-z_]+_font_color$/]
  };
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const [layerId, patterns] of Object.entries(colorKeys)) {
      const color = colors[layerId];
      if (!color) {
        continue;
      }
      for (const key of Object.keys(resolution.config)) {
        if (patterns.some((pattern) => pattern.test(key))) {
          values[key] = configHexColor(color);
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Tints icon-backed layers whose firmware config has no direct color field. */
export async function buildLayerColorSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  colors: Record<string, string>,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  const jobs = new Map<string, { file: CorosWatchfaceSpriteFile; color: string }>();
  for (const resolution of details.resolutions) {
    const addIcon = (value: string | undefined, color: string | undefined) => {
      if (!value || !color) {
        return;
      }
      const path = `${resolution.directory}/${value.replace(/\\/g, "/")}`;
      const file = resolution.icons.find((entry) => entry.path === path);
      if (file) {
        jobs.set(file.path, { file, color });
      }
    };
    addIcon(resolution.config["colon_icon"], colors.separators);
    addIcon(resolution.config["arc_cut_icon"], colors.separators);
    if (colors.complication) {
      for (const [key, value] of Object.entries(resolution.config)) {
        if (/^control_[a-z_]+_icon$/.test(key)) {
          addIcon(value, colors.complication);
        }
      }
    }
  }
  const assets = await loadAssets([...jobs.keys()]);
  const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const [path, job] of jobs) {
    const asset = assetsByPath.get(path);
    if (!asset) {
      continue;
    }
    replacements.push({
      path,
      dataUrl: await tintSprite(
        asset.dataUrl,
        job.file.width,
        job.file.height,
        job.color
      )
    });
  }
  return replacements;
}

export interface WatchfaceLayoutGroupBounds {
  id: string;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WatchfaceLayoutOffsetLimits {
  minDx: number;
  maxDx: number;
  minDy: number;
  maxDy: number;
}

/**
 * The screen region each movable group occupies, in resolution coordinates.
 * Rect keys carry their own box; position keys are extended by the sprite
 * size they reference (digit font folder or icon file).
 */
export function computeLayoutGroupBounds(
  resolution: CorosWatchfaceResolutionDetails
): WatchfaceLayoutGroupBounds[] {
  const bounds: WatchfaceLayoutGroupBounds[] = [];
  for (const group of WATCHFACE_LAYOUT_GROUPS) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    if (group.id === "complication") {
      const originKey = Object.keys(resolution.config).find((key) =>
        /^rect_control\d+_pos$/.test(key)
      );
      const origin = parseConfigPos(originKey ? resolution.config[originKey] : undefined);
      if (origin) {
        for (const [key, value] of Object.entries(resolution.config)) {
          if (/^control_[a-z_]+_rect$/.test(key)) {
            const rect = parseConfigRect(value);
            if (rect) {
              x0 = Math.min(x0, origin.x + rect.x0);
              y0 = Math.min(y0, origin.y + rect.y0);
              x1 = Math.max(x1, origin.x + rect.x1);
              y1 = Math.max(y1, origin.y + rect.y1);
            }
          } else if (/^control_[a-z_]+_icon_pos$/.test(key)) {
            const pos = parseConfigPos(value);
            if (pos) {
              const size = spriteSizeForPosKey(resolution, key);
              x0 = Math.min(x0, origin.x + pos.x);
              y0 = Math.min(y0, origin.y + pos.y);
              x1 = Math.max(x1, origin.x + pos.x + size.width);
              y1 = Math.max(y1, origin.y + pos.y + size.height);
            }
          }
        }
      }
      if (x0 < x1 && y0 < y1) {
        bounds.push({ id: group.id, label: group.label, x0, y0, x1, y1 });
      }
      continue;
    }
    for (const key of layoutGroupKeys(resolution, group)) {
      const value = resolution.config[key]!;
      const rect = parseConfigRect(value);
      if (rect) {
        x0 = Math.min(x0, rect.x0);
        y0 = Math.min(y0, rect.y0);
        x1 = Math.max(x1, rect.x1);
        y1 = Math.max(y1, rect.y1);
        continue;
      }
      const pos = parseConfigPos(value);
      if (pos) {
        const size = spriteSizeForPosKey(resolution, key);
        x0 = Math.min(x0, pos.x);
        y0 = Math.min(y0, pos.y);
        x1 = Math.max(x1, pos.x + size.width);
        y1 = Math.max(y1, pos.y + size.height);
      }
    }
    if (x0 < x1 && y0 < y1) {
      bounds.push({ id: group.id, label: group.label, x0, y0, x1, y1 });
    }
  }
  return bounds;
}

/**
 * Per-element movement limits that let a component touch every screen edge
 * while keeping its complete bounding box on the face.
 */
export function computeLayoutOffsetLimits(
  resolution: CorosWatchfaceResolutionDetails
): Record<string, WatchfaceLayoutOffsetLimits> {
  return Object.fromEntries(
    computeLayoutGroupBounds(resolution).map((box) => [
      box.id,
      {
        minDx: -box.x0,
        maxDx: resolution.width - box.x1,
        minDy: -box.y0,
        maxDy: resolution.height - box.y1
      }
    ])
  );
}

/** The smallest movable group containing the point, if any. */
export function layoutGroupAtPoint(
  bounds: WatchfaceLayoutGroupBounds[],
  x: number,
  y: number
): WatchfaceLayoutGroupBounds | null {
  return bounds
    .filter((box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)
    .sort(
      (left, right) =>
        (left.x1 - left.x0) * (left.y1 - left.y0) -
        (right.x1 - right.x0) * (right.y1 - right.y0)
    )[0] ?? null;
}

function spriteSizeForPosKey(
  resolution: CorosWatchfaceResolutionDetails,
  posKey: string
): { width: number; height: number } {
  if (posKey.endsWith("_icon_pos")) {
    const iconValue = resolution.config[posKey.replace(/_pos$/, "")];
    if (iconValue) {
      const iconPath = `${resolution.directory}/${iconValue.replace(/\\/g, "/")}`;
      const icon = resolution.icons.find((entry) => entry.path === iconPath);
      if (icon) {
        return { width: icon.width, height: icon.height };
      }
    }
  } else {
    const fontValue = resolution.config[posKey.replace(/_pos$/, "_font")];
    const folder = fontValue
      ? resolution.spriteFolders.find(
          (candidate) => candidate.folder === fontValue.replace(/\\/g, "/")
        )
      : undefined;
    const file = folder?.files[0];
    if (file) {
      return { width: file.width, height: file.height };
    }
  }
  return { width: 40, height: 40 };
}

/** Applies layout offsets to a copy of the details, for the live preview. */
export function applyLayoutToDetails(
  details: CorosWatchfaceTemplateDetails,
  offsets: Record<string, WatchfaceLayoutOffset>
): CorosWatchfaceTemplateDetails {
  const overrides = buildLayoutOverrides(details, offsets);
  if (overrides.length === 0) {
    return details;
  }
  const overridesByPath = new Map(
    overrides.map((override) => [override.path, override.values])
  );
  return {
    ...details,
    resolutions: details.resolutions.map((resolution) => {
      const values = overridesByPath.get(`${resolution.directory}/config.txt`);
      return values
        ? { ...resolution, config: { ...resolution.config, ...values } }
        : resolution;
    })
  };
}

/** The resolution used for the on-screen preview: the largest one present. */
export function pickPreviewResolution(
  details: CorosWatchfaceTemplateDetails
): CorosWatchfaceResolutionDetails | null {
  return (
    [...details.resolutions].sort((left, right) => right.width - left.width)[0] ??
    null
  );
}

interface PreviewDigitSource {
  folder: string;
  files: CorosWatchfaceSpriteFile[];
}

function findSpriteFolder(
  resolution: CorosWatchfaceResolutionDetails,
  folderName: string | undefined
): PreviewDigitSource | null {
  if (!folderName) {
    return null;
  }
  const normalized = folderName.replace(/\\/g, "/");
  const folder = resolution.spriteFolders.find(
    (candidate) => candidate.folder === normalized
  );
  return folder ? { folder: folder.folder, files: folder.files } : null;
}

/**
 * Draws a live preview of the face: the canvas background plus the actual
 * sprites the watch will render, placed with the template's own layout keys.
 */
export async function drawStudioPreview(
  canvas: HTMLCanvasElement,
  backgroundDataUrl: string,
  details: CorosWatchfaceTemplateDetails,
  options: WatchfaceStudioOptions,
  loadAssets: WatchfaceAssetLoader
): Promise<void> {
  const resolution = pickPreviewResolution(details);
  const context = canvas.getContext("2d");
  if (!resolution || !context) {
    return;
  }
  const scale = canvas.width / resolution.width;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    await loadStudioImage(backgroundDataUrl),
    0,
    0,
    canvas.width,
    canvas.height
  );

  const config = resolution.config;
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  const wantedSprites = new Map<string, { color: string | null }>();
  const digitPlan: {
    pos: { x: number; y: number } | null;
    source: PreviewDigitSource | null;
    digit: number;
    partId?: WatchfaceTimePartId;
    componentId: string;
  }[] = [];
  const timeKeys: [string, string, string, WatchfaceTimePartId][] = [
    ["time_hour_high_pos", "time_hour_high_font", hour[0]!, "hours"],
    ["time_hour_low_pos", "time_hour_low_font", hour[1]!, "hours"],
    ["time_minute_high_pos", "time_minute_high_font", minute[0]!, "minutes"],
    ["time_minute_low_pos", "time_minute_low_font", minute[1]!, "minutes"]
  ];
  for (const [posKey, fontKey, digitText, partId] of timeKeys) {
    const source = findSpriteFolder(resolution, config[fontKey]);
    digitPlan.push({
      pos: parseConfigPos(config[posKey]),
      source,
      digit: Number(digitText),
      partId,
      componentId: partId
    });
  }
  for (const [posKey, fontKey, digitText] of [
    ["time_second_high_pos", "time_second_high_font", second[0]!],
    ["time_second_low_pos", "time_second_low_font", second[1]!]
  ] as const) {
    digitPlan.push({
      pos: parseConfigPos(config[posKey]),
      source: findSpriteFolder(resolution, config[fontKey]),
      digit: Number(digitText),
      componentId: "seconds"
    });
  }
  const colonValue = config["colon_icon"]?.replace(/\\/g, "/");
  const colonPath = colonValue ? `${resolution.directory}/${colonValue}` : null;
  const colonFile = colonPath
    ? resolution.icons.find((icon) => icon.path === colonPath) ?? null
    : null;
  if (colonFile) {
    wantedSprites.set(colonFile.path, {
      color: options.layerColors?.separators ??
        (options.tintIcons ? options.accentColor : null)
    });
  }
  const arcCutValue = config["arc_cut_icon"]?.replace(/\\/g, "/");
  const arcCutPath = arcCutValue
    ? `${resolution.directory}/${arcCutValue}`
    : null;
  const arcCutFile = arcCutPath
    ? resolution.icons.find((icon) => icon.path === arcCutPath) ?? null
    : null;
  const arcCutPos = parseConfigPos(config["arc_cut_icon_pos"]);
  if (arcCutFile) {
    wantedSprites.set(arcCutFile.path, {
      color: options.layerColors?.separators ??
        (options.tintIcons ? options.accentColor : null)
    });
  }

  const ampmIcons = options.ampmStyle?.enabled ? findAmPmIcons(resolution) : null;
  const ampmFile = ampmIcons
    ? now.getHours() < 12
      ? ampmIcons.am
      : ampmIcons.pm
    : null;
  if (ampmFile && !wantedSprites.has(ampmFile.path)) {
    wantedSprites.set(ampmFile.path, { color: null });
  }

  // Weekday label: sprite order inside week folders is firmware-defined, so
  // the preview simply shows one representative label sprite.
  const weekSource = findSpriteFolder(
    resolution,
    config["english_date_week_font"]
  );
  const weekRect = parseConfigRect(config["english_date_week_rect"]);
  const weekFile = weekSource?.files[now.getDay()] ?? weekSource?.files[0];
  const weekColor =
    options.dateStyles?.weekday?.color ??
    options.layerColors?.weekday ??
    (options.tintLabels ? options.digitColor : null);
  if (weekFile) {
    wantedSprites.set(weekFile.path, { color: weekColor });
  }

  const availableComplications = getAvailableComplications(details);
  const complication =
    availableComplications.find((item) => item.id === options.previewComplication) ??
    availableComplications[0] ??
    null;
  const complicationPrefix = complication?.controlPrefix;
  const controlOriginKey = Object.keys(config).find((key) =>
    /^rect_control\d+_pos$/.test(key)
  );
  const controlOrigin = parseConfigPos(
    controlOriginKey ? config[controlOriginKey] : undefined
  ) ?? { x: 0, y: 0 };
  const relativeComplicationRect = complicationPrefix
    ? parseConfigRect(config[`control_${complicationPrefix}_rect`])
    : null;
  const complicationRect = relativeComplicationRect
    ? {
        x0: relativeComplicationRect.x0 + controlOrigin.x,
        y0: relativeComplicationRect.y0 + controlOrigin.y,
        x1: relativeComplicationRect.x1 + controlOrigin.x,
        y1: relativeComplicationRect.y1 + controlOrigin.y
      }
    : null;
  const complicationSource = complicationPrefix
    ? findSpriteFolder(resolution, config[`control_${complicationPrefix}_font`])
    : null;
  const complicationIconValue = complicationPrefix
    ? config[`control_${complicationPrefix}_icon`]?.replace(/\\/g, "/")
    : undefined;
  const complicationIconPath = complicationIconValue
    ? `${resolution.directory}/${complicationIconValue}`
    : null;
  const complicationIcon = complicationIconPath
    ? resolution.icons.find((icon) => icon.path === complicationIconPath) ?? null
    : null;
  const relativeComplicationIconPos = complicationPrefix
    ? parseConfigPos(config[`control_${complicationPrefix}_icon_pos`])
    : null;
  const complicationIconPos = relativeComplicationIconPos
    ? {
        x: relativeComplicationIconPos.x + controlOrigin.x,
        y: relativeComplicationIconPos.y + controlOrigin.y
      }
    : null;
  if (complicationIcon) {
    wantedSprites.set(complicationIcon.path, {
      color: options.layerColors?.complication ??
        (options.tintIcons ? options.accentColor : null)
    });
  }

  const numberPlans: {
    rect: { x0: number; y0: number; x1: number; y1: number };
    source: PreviewDigitSource;
    value: string;
    metricId?: WatchfaceMetricId;
    datePartId?: WatchfaceDatePartId;
    componentId?: string;
  }[] = [];
  if (complication && complicationRect && complicationSource) {
    numberPlans.push({
      rect: complicationRect,
      source: complicationSource,
      value: complication.sampleValue,
      componentId: "complication"
    });
  }
  const batteryRect = parseConfigRect(config["battery_level_rect"]);
  const batterySource = findSpriteFolder(
    resolution,
    config["battery_level_font"]
  );
  if (batteryRect && batterySource) {
    numberPlans.push({
      rect: batteryRect,
      source: batterySource,
      value: "82",
      componentId: "battery"
    });
  }
  const dateFields: [string, string, string, WatchfaceDatePartId][] = [
    [
      "english_date_month_rect",
      "english_date_month_font",
      String(now.getMonth() + 1).padStart(2, "0"),
      "dateMonth"
    ],
    [
      "english_date_day_rect",
      "english_date_day_font",
      String(now.getDate()).padStart(2, "0"),
      "dateDay"
    ]
  ];
  for (const [rectKey, fontKey, value, datePartId] of dateFields) {
    const rect = parseConfigRect(config[rectKey]);
    const source = findSpriteFolder(resolution, config[fontKey]);
    if (rect && source) {
      numberPlans.push({ rect, source, value, datePartId });
    }
  }
  for (const metric of WATCHFACE_FIXED_METRICS) {
    const rect = parseConfigRect(config[metric.rectKey]);
    const source = metricFontFolder(resolution, metric);
    if (rect && source) {
      numberPlans.push({
        rect,
        source,
        value: metric.sampleValue,
        metricId: metric.id
      });
    }
  }

  // Digits come from the chosen font, or from the template bitmaps otherwise.
  const digitSprites = new Map<string, HTMLImageElement>();
  for (const planned of digitPlan) {
    const file = planned.source?.files[planned.digit];
    const fontFamily =
      (planned.partId
        ? options.timeStyles?.[planned.partId]?.fontFamily
        : undefined) ?? options.fontFamily;
    if (file && !fontFamily) {
      wantedSprites.set(file.path, { color: null });
    }
  }
  for (const plan of numberPlans) {
    const fontFamily = plan.datePartId
      ? options.dateStyles?.[plan.datePartId]?.fontFamily ?? options.fontFamily
      : plan.metricId
        ? options.metricStyles?.[plan.metricId]?.fontFamily ?? options.fontFamily
        : options.fontFamily;
    if (fontFamily) {
      continue;
    }
    for (const digit of plan.value) {
      const file = plan.source.files[Number(digit)];
      if (file) {
        wantedSprites.set(file.path, { color: null });
      }
    }
  }

  const loaded = new Map<string, HTMLImageElement>();
  const loadedAssets = new Map<string, CorosWatchfaceTemplateAsset>();
  if (wantedSprites.size > 0) {
    const assets = await loadAssets([...wantedSprites.keys()]);
    for (const asset of assets) {
      loadedAssets.set(asset.path, asset);
      const tintColor = wantedSprites.get(asset.path)?.color ?? null;
      const dataUrl = tintColor
        ? await tintSprite(asset.dataUrl, asset.width, asset.height, tintColor)
        : asset.dataUrl;
      loaded.set(asset.path, await loadStudioImage(dataUrl));
    }
  }

  if (options.fontFamily) {
    for (const planned of digitPlan) {
      const file = planned.source?.files[planned.digit];
      if (file) {
        const dataUrl = renderDigitSprite(
          String(planned.digit),
          file.width,
          file.height,
          options.fontFamily,
          options.digitColor
        );
        digitSprites.set(file.path, await loadStudioImage(dataUrl));
      }
    }
    for (const plan of numberPlans) {
      for (const digit of plan.value) {
        const file = plan.source.files[Number(digit)];
        if (!file || digitSprites.has(file.path)) {
          continue;
        }
        const dataUrl = renderDigitSprite(
          digit,
          file.width,
          file.height,
          options.fontFamily,
          options.digitColor
        );
        digitSprites.set(file.path, await loadStudioImage(dataUrl));
      }
    }
  }

  const styledTimeGlyphs = new Map<string, HTMLImageElement>();
  for (const planned of digitPlan) {
    const file = planned.source?.files[planned.digit];
    if (!file || !planned.pos) {
      continue;
    }
    const timeStyle = planned.partId
      ? options.timeStyles?.[planned.partId]
      : undefined;
    const componentColor = options.layerColors?.[planned.componentId];
    const timeFontFamily = timeStyle?.fontFamily ?? options.fontFamily;
    const timeColor = timeStyle?.color ?? componentColor ?? options.digitColor;
    const timeScale = timeStyle
      ? Math.max(0.5, Math.min(2, timeStyle.scale))
      : 1;
    const width = Math.max(1, Math.round(file.width * timeScale));
    const height = Math.max(1, Math.round(file.height * timeScale));
    let image = digitSprites.get(file.path) ?? loaded.get(file.path);
    if (timeStyle || componentColor) {
      const cacheKey = `${file.path}|${timeFontFamily}|${timeColor}|${timeScale}`;
      image = styledTimeGlyphs.get(cacheKey);
      if (!image) {
        const dataUrl = timeFontFamily
          ? renderDigitSprite(
              String(planned.digit),
              width,
              height,
              timeFontFamily,
              timeColor
            )
          : await resizeAndTintSprite(
              loadedAssets.get(file.path)?.dataUrl ?? "",
              width,
              height,
              timeColor
            );
        image = await loadStudioImage(dataUrl);
        styledTimeGlyphs.set(cacheKey, image);
      }
    }
    if (image) {
      context.drawImage(
        image,
        planned.pos.x * scale,
        planned.pos.y * scale,
        width * scale,
        height * scale
      );
    }
  }

  if (colonFile) {
    const hourLow = digitPlan[1];
    const minuteHigh = digitPlan[2];
    const hourLowFile = hourLow?.source?.files[hourLow.digit];
    const minuteHighFile = minuteHigh?.source?.files[minuteHigh.digit];
    const image = loaded.get(colonFile.path);
    if (
      image &&
      hourLow?.pos &&
      minuteHigh?.pos &&
      hourLowFile &&
      minuteHighFile
    ) {
      const hourScale = Math.max(
        0.5,
        Math.min(2, options.timeStyles?.hours?.scale ?? 1)
      );
      const minuteScale = Math.max(
        0.5,
        Math.min(2, options.timeStyles?.minutes?.scale ?? 1)
      );
      const hourWidth = hourLowFile.width * hourScale;
      const hourHeight = hourLowFile.height * hourScale;
      const minuteHeight = minuteHighFile.height * minuteScale;
      const hourCenterY = hourLow.pos.y + hourHeight / 2;
      const minuteCenterY = minuteHigh.pos.y + minuteHeight / 2;
      const gapCenterX =
        (hourLow.pos.x + hourWidth + minuteHigh.pos.x) / 2;
      const gapCenterY = (hourCenterY + minuteCenterY) / 2;
      context.drawImage(
        image,
        (gapCenterX - colonFile.width / 2) * scale,
        (gapCenterY - colonFile.height / 2) * scale,
        colonFile.width * scale,
        colonFile.height * scale
      );
    }
  }

  if (arcCutFile && arcCutPos) {
    const image = loaded.get(arcCutFile.path);
    if (image) {
      context.drawImage(
        image,
        arcCutPos.x * scale,
        arcCutPos.y * scale,
        arcCutFile.width * scale,
        arcCutFile.height * scale
      );
    }
  }

  if (weekFile && weekRect) {
    const weekStyle = options.dateStyles?.weekday;
    const weekFontFamily = weekStyle?.fontFamily ?? options.fontFamily;
    let image = loaded.get(weekFile.path);
    const weekScale = Math.max(
      0.5,
      Math.min(2, weekStyle?.scale ?? 1)
    );
    const weekWidth = Math.max(1, Math.round(weekFile.width * weekScale));
    const weekHeight = Math.max(1, Math.round(weekFile.height * weekScale));
    if (weekFontFamily) {
      image = await loadStudioImage(
        renderDigitSprite(
          WEEKDAY_LABELS[now.getDay()] ?? "DAY",
          weekWidth,
          weekHeight,
          weekFontFamily,
          weekColor ?? options.digitColor
        )
      );
    }
    if (image) {
      const centerX = ((weekRect.x0 + weekRect.x1) / 2) * scale;
      const centerY = ((weekRect.y0 + weekRect.y1) / 2) * scale;
      context.drawImage(
        image,
        centerX - (weekWidth * scale) / 2,
        centerY - (weekHeight * scale) / 2,
        weekWidth * scale,
        weekHeight * scale
      );
    }
  }

  if (complicationIcon && complicationIconPos) {
    const image = loaded.get(complicationIcon.path);
    if (image) {
      context.drawImage(
        image,
        complicationIconPos.x * scale,
        complicationIconPos.y * scale,
        complicationIcon.width * scale,
        complicationIcon.height * scale
      );
    }
  }

  const styledMetricGlyphs = new Map<string, HTMLImageElement>();
  for (const plan of numberPlans) {
    const metricStyle = plan.metricId
      ? options.metricStyles?.[plan.metricId]
      : undefined;
    const dateStyle = plan.datePartId
      ? options.dateStyles?.[plan.datePartId]
      : undefined;
    const componentColor = plan.componentId
      ? options.layerColors?.[plan.componentId]
      : undefined;
    const glyphFontFamily =
      metricStyle?.fontFamily ?? dateStyle?.fontFamily ?? options.fontFamily;
    const glyphs: {
      file: CorosWatchfaceSpriteFile;
      image: HTMLImageElement;
    }[] = [];
    for (const digit of plan.value) {
      const file = plan.source.files[Number(digit)];
      if (!file) {
        continue;
      }
      if (!metricStyle && !dateStyle && !componentColor) {
        const image = digitSprites.get(file.path) ?? loaded.get(file.path);
        if (image) {
          glyphs.push({ file, image });
        }
        continue;
      }
      const glyphScale = Math.max(
        0.5,
        Math.min(2, metricStyle?.scale ?? dateStyle?.scale ?? 1)
      );
      const styledFile = {
        ...file,
        width: Math.max(1, Math.round(file.width * glyphScale)),
        height: Math.max(1, Math.round(file.height * glyphScale))
      };
      const glyphColor =
        metricStyle?.color ??
        dateStyle?.color ??
        componentColor ??
        options.digitColor;
      const cacheKey = `${file.path}|${glyphFontFamily}|${glyphColor}|${glyphScale}`;
      let image = styledMetricGlyphs.get(cacheKey);
      if (!image) {
        if (glyphFontFamily) {
          image = await loadStudioImage(
            renderDigitSprite(
              digit,
              styledFile.width,
              styledFile.height,
              glyphFontFamily,
              glyphColor
            )
          );
        } else if (metricStyle || dateStyle?.color || componentColor) {
          image = await loadStudioImage(
            await resizeAndTintSprite(
              loadedAssets.get(file.path)?.dataUrl ?? "",
              styledFile.width,
              styledFile.height,
              glyphColor
            )
          );
        } else {
          image = loaded.get(file.path);
        }
        if (image) {
          styledMetricGlyphs.set(cacheKey, image);
        }
      }
      if (image) {
        glyphs.push({ file: styledFile, image });
      }
    }
    if (glyphs.length === 0) {
      continue;
    }
    const totalWidth = glyphs.reduce((sum, glyph) => sum + glyph.file.width, 0);
    const centerX = (plan.rect.x0 + plan.rect.x1) / 2;
    const centerY = (plan.rect.y0 + plan.rect.y1) / 2;
    let x = centerX - totalWidth / 2;
    for (const glyph of glyphs) {
      context.drawImage(
        glyph.image,
        x * scale,
        (centerY - glyph.file.height / 2) * scale,
        glyph.file.width * scale,
        glyph.file.height * scale
      );
      x += glyph.file.width;
    }
  }

  // AM/PM indicator: shows whichever sprite matches the preview time, styled
  // the same way the export will restyle the studio copies.
  const ampmStyle = options.ampmStyle;
  if (ampmStyle?.enabled && ampmFile) {
    const ampmScale = Math.max(0.5, Math.min(2, ampmStyle.scale));
    const width = Math.max(1, Math.round(ampmFile.width * ampmScale));
    const height = Math.max(1, Math.round(ampmFile.height * ampmScale));
    const sourceDataUrl = loadedAssets.get(ampmFile.path)?.dataUrl;
    if (sourceDataUrl) {
      const dataUrl = await resizeAndTintSprite(
        sourceDataUrl,
        width,
        height,
        ampmStyle.color
      );
      context.drawImage(
        await loadStudioImage(dataUrl),
        ampmStyle.x * scale,
        ampmStyle.y * scale,
        width * scale,
        height * scale
      );
    }
  }
}
