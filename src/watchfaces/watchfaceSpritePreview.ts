import type {
  CorosWatchfaceRasterFont,
  CorosWatchfaceResolutionDetails,
  CorosWatchfaceSpriteFolder
} from "../../electron/types";
import {
  corosMonthLabelForSpriteIndex,
  normalizeRasterFontGlyphs,
  WATCHFACE_COMPLICATIONS,
  WATCHFACE_DATE_PARTS,
  WATCHFACE_FIXED_METRICS,
  WATCHFACE_TIME_PARTS,
  type WatchfaceComplicationId
} from "./watchfaceStudio.ts";

/** COROS weekday sprites are indexed Monday=0 through Sunday=6. */
const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DIGIT_GLYPHS = "0123456789";
export const RASTER_FONT_PREVIEW_CELL_HEIGHT = 34;

/** The config key that stores a selectable complication's slot icon. */
export function controlIconConfigKey(
  complicationId: WatchfaceComplicationId
): string | null {
  const complication = WATCHFACE_COMPLICATIONS.find(
    (candidate) => candidate.id === complicationId
  );
  return complication ? `control_${complication.controlPrefix}_icon` : null;
}

/**
 * Control-slot images that belong to the Selectable metric inspector: one
 * icon per data choice plus the colon and negative sign shared by every
 * choice. They are edited beside the metric instead of in the Template
 * assets list. The battery choice keeps its own stateful sprite layer, and
 * the barometer is not offered by the editor.
 */
export function isSelectableSlotConfigAssetKey(configKey: string): boolean {
  if (
    configKey === "control_colon_icon" ||
    configKey === "control_negative_sign_icon"
  ) {
    return true;
  }
  return WATCHFACE_COMPLICATIONS.some(
    (complication) =>
      complication.id !== "battery" &&
      complication.id !== "barometer" &&
      `control_${complication.controlPrefix}_icon` === configKey
  );
}

export interface WatchfaceTemplateGlyph {
  /** Zip entry path, loadable through the template asset API. */
  path: string;
  /** What the sprite stands for on the watch: a digit, MON, JAN, or a state. */
  label: string;
  width: number;
  height: number;
}

export interface WatchfaceTemplateGlyphSet {
  folder: string;
  kind: CorosWatchfaceSpriteFolder["kind"];
  glyphs: WatchfaceTemplateGlyph[];
}

function findTemplateSpriteFolder(
  resolution: CorosWatchfaceResolutionDetails,
  folderName: string | undefined
): CorosWatchfaceSpriteFolder | null {
  if (!folderName) return null;
  const normalized = folderName.replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    resolution.spriteFolders.find((folder) => folder.folder === normalized) ??
    null
  );
}

function templateGlyphLabel(
  kind: CorosWatchfaceSpriteFolder["kind"],
  path: string,
  index: number
): string {
  const stem = path.split("/").pop()?.replace(/\.png$/i, "") ?? String(index);
  if (kind === "week") return WEEKDAY_LABELS[index] ?? stem;
  if (kind === "month") return corosMonthLabelForSpriteIndex(index) ?? stem;
  if (kind === "state") return stem.padStart(2, "0");
  return /^\d+$/.test(stem) ? String(Number(stem)) : stem;
}

/** Every sprite in a template folder, labelled the way the firmware reads it. */
export function templateFolderGlyphs(
  folder: CorosWatchfaceSpriteFolder
): WatchfaceTemplateGlyphSet {
  return {
    folder: folder.folder,
    kind: folder.kind,
    glyphs: folder.files.map((file, index) => ({
      path: file.path,
      label: templateGlyphLabel(folder.kind, file.path, index),
      width: file.width,
      height: file.height
    }))
  };
}

function firstTemplateFolder(
  resolution: CorosWatchfaceResolutionDetails,
  config: Record<string, string>,
  keys: ReadonlyArray<string | undefined>
): CorosWatchfaceSpriteFolder | null {
  for (const key of keys) {
    const folder = key
      ? findTemplateSpriteFolder(resolution, config[key])
      : null;
    if (folder) return folder;
  }
  return null;
}

/**
 * The template PNG set a text layer draws with when no local font or PNG set
 * replaces it. Mirrors the export fallbacks: a metric without its own font
 * borrows the step or hour digits, and the selectable slot uses the chosen
 * data type's font.
 */
export function templateFontGlyphsForLayer(
  resolution: CorosWatchfaceResolutionDetails,
  layerId: string,
  options: { aod?: boolean; complicationId?: WatchfaceComplicationId } = {}
): WatchfaceTemplateGlyphSet | null {
  const config = options.aod ? resolution.aodConfig : resolution.config;
  const anyDigits = () =>
    resolution.spriteFolders.find(
      (folder) => folder.kind === "digits" && folder.aod === Boolean(options.aod)
    ) ?? resolution.spriteFolders.find((folder) => folder.kind === "digits") ?? null;
  let folder: CorosWatchfaceSpriteFolder | null = null;
  const timePart = WATCHFACE_TIME_PARTS.find((part) => part.id === layerId);
  if (timePart || layerId === "autoTime") {
    const digits = (timePart ?? WATCHFACE_TIME_PARTS[0]!).digits;
    folder = firstTemplateFolder(
      resolution,
      config,
      digits.map((digit) => digit.fontKey)
    );
  } else if (layerId === "complication") {
    const complication = options.complicationId
      ? WATCHFACE_COMPLICATIONS.find(
          (candidate) => candidate.id === options.complicationId
        )
      : undefined;
    folder = firstTemplateFolder(resolution, config, [
      complication ? `control_${complication.controlPrefix}_font` : undefined,
      ...Object.keys(config).filter((key) =>
        /^control_[a-z0-9_]+_font$/.test(key)
      )
    ]);
  } else {
    const datePart = WATCHFACE_DATE_PARTS.find((part) => part.id === layerId);
    const metric = WATCHFACE_FIXED_METRICS.find(
      (candidate) => candidate.id === layerId
    );
    if (datePart) {
      folder = firstTemplateFolder(resolution, config, [datePart.fontKey]);
      if (!folder) return null;
    } else if (metric) {
      folder = firstTemplateFolder(resolution, config, [
        metric.fontKey,
        `control_${metric.controlPrefix}_font`,
        "control_step_font",
        "time_second_high_font",
        "time_hour_high_font"
      ]);
    } else {
      return null;
    }
  }
  folder ??= anyDigits();
  return folder ? templateFolderGlyphs(folder) : null;
}

/** The firmware-swapped state folder behind a `*_icon_dir` config entry. */
export function templateStateGlyphs(
  resolution: CorosWatchfaceResolutionDetails,
  folderName: string | undefined
): WatchfaceTemplateGlyphSet | null {
  const folder = findTemplateSpriteFolder(resolution, folderName);
  return folder ? templateFolderGlyphs(folder) : null;
}

export type RasterFontPreviewCell =
  | { key: string; kind: "sprite"; src: string }
  | { key: string; kind: "atlas"; style: Record<string, string> }
  | { key: string; kind: "missing" };

/**
 * One cell per digit plus any imported label, so the person can see at a
 * glance which glyphs the PNG set actually provides.
 */
export function rasterFontPreviewCells(
  font: CorosWatchfaceRasterFont,
  cellHeight = RASTER_FONT_PREVIEW_CELL_HEIGHT
): RasterFontPreviewCell[] {
  const glyphs = normalizeRasterFontGlyphs(font.glyphs);
  const columns = Math.max(1, font.columns);
  const rows = Math.max(1, Math.ceil(glyphs.length / columns));
  const atlas = font.dataUrl && glyphs.length > 0 && font.atlasSize ? font.atlasSize : null;
  const cellWidth = atlas ? atlas.width / columns : 0;
  const atlasCellHeight = atlas ? atlas.height / rows : 0;
  const scale = atlas && atlasCellHeight > 0 ? cellHeight / atlasCellHeight : 1;
  const keys = [
    ...DIGIT_GLYPHS,
    ...[...glyphs].filter((glyph) => !DIGIT_GLYPHS.includes(glyph)),
    ...Object.keys(font.labels ?? {}),
    ...Object.keys(font.sprites ?? {})
  ];
  const seen = new Set<string>();
  return keys.flatMap((key): RasterFontPreviewCell[] => {
    const normalized = key.toUpperCase();
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    const sprite = font.sprites?.[normalized] ?? font.labels?.[normalized];
    if (sprite) return [{ key: normalized, kind: "sprite", src: sprite }];
    const index = glyphs.indexOf(normalized);
    if (atlas && index >= 0) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return [{
        key: normalized,
        kind: "atlas",
        style: {
          width: `${Math.max(12, Math.round(cellWidth * scale))}px`,
          height: `${cellHeight}px`,
          backgroundImage: `url(${font.dataUrl})`,
          backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
          backgroundPosition: `${-column * cellWidth * scale}px ${-row * atlasCellHeight * scale}px`
        }
      }];
    }
    return [{ key: normalized, kind: "missing" }];
  });
}
