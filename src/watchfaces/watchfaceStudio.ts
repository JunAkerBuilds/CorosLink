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
  const image = await loadStudioImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite tinting is unavailable in this window.");
  }
  context.drawImage(image, 0, 0, width, height);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
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
  | "elevation";

export type WatchfaceComplicationId =
  | "heartRate"
  | "steps"
  | "calories"
  | "floors"
  | "elevation";

interface WatchfaceFixedMetricDefinition {
  id: WatchfaceMetricId;
  label: string;
  rectKey: string;
  fontKey: string;
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
  }
];

export const WATCHFACE_COMPLICATIONS: WatchfaceComplicationDefinition[] = [
  { id: "heartRate", label: "Heart rate", controlPrefix: "hr", sampleValue: "96" },
  { id: "steps", label: "Steps", controlPrefix: "step", sampleValue: "8420" },
  { id: "calories", label: "Calories", controlPrefix: "kcal", sampleValue: "534" },
  { id: "floors", label: "Floors", controlPrefix: "floor", sampleValue: "12" },
  { id: "elevation", label: "Elevation", controlPrefix: "elevation", sampleValue: "1284" }
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
    Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey)
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
        !Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey)
      ) {
        continue;
      }
      if (!enabled) {
        values[metric.rectKey] = "";
        if (Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey)) {
          values[metric.fontKey] = "";
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
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
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
 * Movable element groups, matched against the template's own config keys.
 * Positions (`{x,y}`) and rects (`{x0,y0,x1,y1,align}`) are both shiftable.
 */
export const WATCHFACE_LAYOUT_GROUPS: WatchfaceLayoutGroup[] = [
  {
    id: "time",
    label: "Time digits",
    patterns: [/^time_(hour|minute)_(high|low)_pos$/]
  },
  {
    id: "seconds",
    label: "Seconds",
    patterns: [/^time_second_(high|low)_pos$/]
  },
  {
    id: "date",
    label: "Date & weekday",
    patterns: [/^[a-z_]+_date_(month|day|week)_rect$/]
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

  const wantedSprites = new Map<string, { color: string | null }>();
  const digitPlan: {
    pos: { x: number; y: number } | null;
    source: PreviewDigitSource | null;
    digit: number;
  }[] = [];
  const timeKeys: [string, string, string][] = [
    ["time_hour_high_pos", "time_hour_high_font", hour[0]!],
    ["time_hour_low_pos", "time_hour_low_font", hour[1]!],
    ["time_minute_high_pos", "time_minute_high_font", minute[0]!],
    ["time_minute_low_pos", "time_minute_low_font", minute[1]!]
  ];
  for (const [posKey, fontKey, digitText] of timeKeys) {
    const source = findSpriteFolder(resolution, config[fontKey]);
    digitPlan.push({
      pos: parseConfigPos(config[posKey]),
      source,
      digit: Number(digitText)
    });
  }

  // Weekday label: sprite order inside week folders is firmware-defined, so
  // the preview simply shows one representative label sprite.
  const weekSource = findSpriteFolder(
    resolution,
    config["english_date_week_font"]
  );
  const weekRect = parseConfigRect(config["english_date_week_rect"]);
  const weekFile = weekSource?.files[now.getDay()] ?? weekSource?.files[0];
  const weekColor = options.tintLabels ? options.digitColor : null;
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
      color: options.tintIcons ? options.accentColor : null
    });
  }

  const numberPlans: {
    rect: { x0: number; y0: number; x1: number; y1: number };
    source: PreviewDigitSource;
    value: string;
  }[] = [];
  if (complication && complicationRect && complicationSource) {
    numberPlans.push({
      rect: complicationRect,
      source: complicationSource,
      value: complication.sampleValue
    });
  }
  for (const metric of WATCHFACE_FIXED_METRICS) {
    const rect = parseConfigRect(config[metric.rectKey]);
    const source = findSpriteFolder(resolution, config[metric.fontKey]);
    if (rect && source) {
      numberPlans.push({ rect, source, value: metric.sampleValue });
    }
  }

  // Digits come from the chosen font, or from the template bitmaps otherwise.
  const digitSprites = new Map<string, HTMLImageElement>();
  if (!options.fontFamily) {
    for (const planned of digitPlan) {
      const file = planned.source?.files[planned.digit];
      if (file) {
        wantedSprites.set(file.path, { color: null });
      }
    }
    for (const plan of numberPlans) {
      for (const digit of plan.value) {
        const file = plan.source.files[Number(digit)];
        if (file) {
          wantedSprites.set(file.path, { color: null });
        }
      }
    }
  }

  const loaded = new Map<string, HTMLImageElement>();
  if (wantedSprites.size > 0) {
    const assets = await loadAssets([...wantedSprites.keys()]);
    for (const asset of assets) {
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

  for (const planned of digitPlan) {
    const file = planned.source?.files[planned.digit];
    if (!file || !planned.pos) {
      continue;
    }
    const image = digitSprites.get(file.path) ?? loaded.get(file.path);
    if (image) {
      context.drawImage(
        image,
        planned.pos.x * scale,
        planned.pos.y * scale,
        file.width * scale,
        file.height * scale
      );
    }
  }

  if (weekFile && weekRect) {
    const image = loaded.get(weekFile.path);
    if (image) {
      const centerX = ((weekRect.x0 + weekRect.x1) / 2) * scale;
      const centerY = ((weekRect.y0 + weekRect.y1) / 2) * scale;
      context.drawImage(
        image,
        centerX - (weekFile.width * scale) / 2,
        centerY - (weekFile.height * scale) / 2,
        weekFile.width * scale,
        weekFile.height * scale
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

  for (const plan of numberPlans) {
    const glyphs = [...plan.value].flatMap((digit) => {
      const file = plan.source.files[Number(digit)];
      const image = file
        ? digitSprites.get(file.path) ?? loaded.get(file.path)
        : undefined;
      return file && image ? [{ file, image }] : [];
    });
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
}
