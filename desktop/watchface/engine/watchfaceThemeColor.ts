import type {
  CorosWatchfaceConfigOverride,
  CorosWatchfaceDesignState,
  CorosWatchfaceResolutionDetails,
  CorosWatchfaceTemplateDetails
} from "../types";
import { WATCHFACE_TARGETS } from "../watchfaceTargets";
import { pickPreviewResolution } from "./watchfaceStudio";

/**
 * MIP watch theme colors. Before drawing a face bitmap, MIP firmware swaps the
 * five rgb222 reds of the face (dark to light: #550000 #aa0000 #ff0000
 * #ff5555 #ffaaaa) for the matching entries of the face's theme row, unless
 * the header turns theming off (`watchface_theme_color_off`). The watch's
 * Theme Color setting picks the row per face; `watchface_default_theme_color`
 * is the row a face starts with. Read from APEX 4 3.2108.0 (table at 0x6b0bd6,
 * swap in draw_watch_face_bmp_with_range); PACE 3 and APEX 2 carry the same
 * table. AMOLED firmware has no such table and draws colors as stored.
 */
export const WATCH_THEME_RAMP = [0x10, 0x20, 0x30, 0x35, 0x3a] as const;

/** One row per theme, five rgb222 bytes in WATCH_THEME_RAMP order. Row 0 is the face as drawn. */
export const WATCH_THEME_ROWS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0x10, 0x20, 0x30, 0x35, 0x3a],
  [0x10, 0x24, 0x34, 0x39, 0x3e],
  [0x10, 0x24, 0x38, 0x3d, 0x3e],
  [0x14, 0x28, 0x3c, 0x3d, 0x3e],
  [0x14, 0x18, 0x2c, 0x2d, 0x3e],
  [0x04, 0x08, 0x0c, 0x1d, 0x2e],
  [0x04, 0x08, 0x18, 0x19, 0x2e],
  [0x04, 0x09, 0x1e, 0x2e, 0x3e],
  [0x05, 0x0a, 0x0f, 0x1f, 0x2f],
  [0x02, 0x03, 0x07, 0x1b, 0x2f],
  [0x01, 0x12, 0x23, 0x27, 0x3b],
  [0x11, 0x22, 0x33, 0x37, 0x3b],
  [0x10, 0x21, 0x32, 0x36, 0x3b],
  [0x00, 0x15, 0x16, 0x3f, 0x3f]
];

export function rgb222Hex(value: number): string {
  const level = (shift: number) => (((value >> shift) & 3) * 85).toString(16).padStart(2, "0");
  return `#${level(4)}${level(2)}${level(0)}`.toUpperCase();
}

/** The color a theme gives pure red, which is what most accents are drawn in. */
export function watchThemeSwatch(theme: number): string {
  return rgb222Hex(WATCH_THEME_ROWS[theme]?.[2] ?? 0x30);
}

const MIP_SIZES = new Set<number>(WATCHFACE_TARGETS.filter((target) => target.display === "mip").map((target) => target.previewSize));

function themeIndex(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 0);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < WATCH_THEME_ROWS.length ? parsed : 0;
}

export interface WatchThemeSupport {
  /** The template's own `watchface_default_theme_color` (0 when absent). */
  templateDefault: number;
}

const themed = (resolution: CorosWatchfaceResolutionDetails) =>
  MIP_SIZES.has(resolution.width) && themeIndex(resolution.config.watchface_theme_color_off) !== 1;

/**
 * Theme support for the watch tree Studio previews (details narrowed to that
 * tree): a MIP screen whose config keeps theming on. A missing
 * `watchface_theme_color_off` compiles as 0, i.e. on.
 */
export function watchThemeSupport(details: CorosWatchfaceTemplateDetails | null | undefined): WatchThemeSupport | null {
  const resolution = details ? pickPreviewResolution(details) : null;
  if (!resolution || !themed(resolution)) return null;
  return { templateDefault: themeIndex(resolution.config.watchface_default_theme_color) };
}

/** The theme row the watch starts this face with, or null where theming does not apply. */
export function effectiveWatchTheme(
  details: CorosWatchfaceTemplateDetails | null | undefined,
  design: Pick<CorosWatchfaceDesignState, "watchThemeColor">
): number | null {
  const support = watchThemeSupport(details);
  if (!support) return null;
  const chosen = design.watchThemeColor;
  return chosen !== undefined && Number.isInteger(chosen) && chosen >= 0 && chosen < WATCH_THEME_ROWS.length
    ? chosen : support.templateDefault;
}

/** The theme a compiled config asks for on a MIP screen (export preview), or null. */
export function compiledWatchTheme(width: number, config: Record<string, string>): number | null {
  if (!MIP_SIZES.has(width) || themeIndex(config.watchface_theme_color_off) === 1) return null;
  return themeIndex(config.watchface_default_theme_color);
}

/**
 * Writes a picked theme into each themed MIP tree's config (a MIP bundle also
 * carries an 800px master and maybe AMOLED trees, which have no theme table).
 * Nothing when left at the template's.
 */
export function buildWatchThemeOverrides(
  details: CorosWatchfaceTemplateDetails,
  design: Pick<CorosWatchfaceDesignState, "watchThemeColor">
): CorosWatchfaceConfigOverride[] {
  const theme = design.watchThemeColor;
  if (theme === undefined || !Number.isInteger(theme) || theme < 0 || theme >= WATCH_THEME_ROWS.length) return [];
  return details.resolutions
    .filter(themed)
    .map((resolution) => ({
      path: `${resolution.directory}/config.txt`,
      values: { watchface_default_theme_color: String(theme) }
    }));
}

// COROS To2222Buffer channel levels: <43, <128, <213, else full.
const LEVEL = new Uint8Array(256).map((_, value) => value < 43 ? 0 : value < 128 ? 1 : value < 213 ? 2 : 3);

/**
 * Recolors RGBA pixels (sRGB, straight alpha) the way the watch would: every
 * pixel that compiles to one of the five reds takes the theme row's entry.
 * Other pixels keep their preview color, so only what the firmware swaps
 * changes. Row 0 is a no-op. Returns whether anything changed.
 */
export function recolorWatchThemePixels(data: Uint8ClampedArray, theme: number | null | undefined): boolean {
  const row = theme ? WATCH_THEME_ROWS[theme] : undefined;
  if (!row) return false;
  const replacement = new Int32Array(64).fill(-1);
  WATCH_THEME_RAMP.forEach((source, index) => {
    const value = row[index]!;
    replacement[source] = (((value >> 4) & 3) * 85 << 16) | (((value >> 2) & 3) * 85 << 8) | ((value & 3) * 85);
  });
  let changed = false;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const color = replacement[(LEVEL[data[index]!]! << 4) | (LEVEL[data[index + 1]!]! << 2) | LEVEL[data[index + 2]!]!]!;
    if (color < 0) continue;
    data[index] = color >> 16;
    data[index + 1] = (color >> 8) & 255;
    data[index + 2] = color & 255;
    changed = true;
  }
  return changed;
}

/** recolorWatchThemePixels over a whole canvas. */
export function applyWatchThemeToCanvas(canvas: HTMLCanvasElement, theme: number | null | undefined): void {
  if (!theme || !WATCH_THEME_ROWS[theme] || canvas.width < 1 || canvas.height < 1) return;
  const context = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!context) return;
  // Read sRGB values: the canvas stores Display P3, which would shift every
  // channel away from COROS's thresholds.
  const image = context.getImageData(0, 0, canvas.width, canvas.height, { colorSpace: "srgb" });
  if (recolorWatchThemePixels(image.data, theme)) context.putImageData(image, 0, 0);
}
