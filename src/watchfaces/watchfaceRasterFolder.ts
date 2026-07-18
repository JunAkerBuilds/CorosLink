import type {
  CorosWatchfaceRasterFont,
  CorosWatchfaceRasterFontFolder,
  CorosWatchfaceRasterFontSprite
} from "../../electron/types";

export type RasterSpriteFolderComponentKind = "weekday" | "month";

export interface ClassifiedRasterSpriteFolder {
  digitSprites: Map<string, CorosWatchfaceRasterFontSprite>;
  labelSprites: Map<string, CorosWatchfaceRasterFontSprite>;
  importedDigitCount: number;
  importedWeekdayCount: number;
  importedMonthCount: number;
}

export interface RasterSpriteFolderReplacement {
  rasterFont: CorosWatchfaceRasterFont;
  importedDigitCount: number;
  importedWeekdayCount: number;
  importedMonthCount: number;
}

export interface RasterSpriteFolderReplacementOptions {
  componentKind?: RasterSpriteFolderComponentKind;
  tint: boolean;
  createDigitAtlas: (
    digitSprites: Map<string, string>
  ) => Promise<
    Pick<
      CorosWatchfaceRasterFont,
      "dataUrl" | "glyphs" | "columns" | "atlasSize"
    >
  >;
  readSpriteSize: (
    dataUrl: string
  ) => Promise<{ width: number; height: number }>;
}

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTH_LABELS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC"
];

function numericSpriteIndex(fileName: string, maximum = 9): number | null {
  const match = fileName.match(/^(\d{1,2})\.png$/i);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 && index <= maximum
    ? index
    : null;
}

function monthLabelFor(fileName: string): string | null {
  const stem = fileName.replace(/\.png$/i, "").toUpperCase();
  if (MONTH_LABELS.includes(stem)) return stem;
  const index = numericSpriteIndex(fileName, 11);
  return index === null ? null : MONTH_LABELS[(index + 11) % 12] ?? null;
}

function weekdayLabelFor(fileName: string): string | null {
  const stem = fileName.replace(/\.png$/i, "").toUpperCase();
  if (WEEKDAY_LABELS.includes(stem)) return stem;
  const index = numericSpriteIndex(fileName);
  return index === null ? null : WEEKDAY_LABELS[index] ?? null;
}

function normalizedRelativePath(
  sprite: CorosWatchfaceRasterFontSprite
): string {
  return sprite.relativePath.replace(/\\/g, "/");
}

function addUniqueSprite(
  target: Map<string, CorosWatchfaceRasterFontSprite>,
  key: string,
  sprite: CorosWatchfaceRasterFontSprite,
  displayKey = key
): void {
  const existing = target.get(key);
  if (existing) {
    throw new Error(
      `Duplicate PNG sprite “${displayKey}” was found in “${normalizedRelativePath(existing)}” and “${normalizedRelativePath(sprite)}”. Choose a folder with only one file for each sprite.`
    );
  }
  target.set(key, sprite);
}

/**
 * Classifies one selected folder without decoding its images. Paths are sorted
 * first so validation and error messages never depend on filesystem order.
 */
export function classifyRasterSpriteFolder(
  folder: CorosWatchfaceRasterFontFolder,
  componentKind?: RasterSpriteFolderComponentKind
): ClassifiedRasterSpriteFolder {
  const digitSprites = new Map<string, CorosWatchfaceRasterFontSprite>();
  const labelSprites = new Map<string, CorosWatchfaceRasterFontSprite>();
  const folderIsWeekdays =
    componentKind === "weekday" || /^weekdays?$/i.test(folder.label.trim());
  const folderIsMonths =
    componentKind === "month" || /months?$/i.test(folder.label.trim());
  const sprites = [...folder.sprites].sort((left, right) =>
    normalizedRelativePath(left).localeCompare(
      normalizedRelativePath(right),
      "en",
      { sensitivity: "base", numeric: true }
    )
  );
  // Month components accept two firmware formats: a 0–9 digit font the watch
  // composes into 1–12, or one label sprite per month (00=DEC, 01–11=JAN–NOV).
  // A set consisting solely of 00.png–09.png (no 10/11, no JAN-style names)
  // can only be a digit font, so it must not be coerced into label slots.
  const monthDigitFont =
    folderIsMonths &&
    sprites.length > 0 &&
    sprites.every((sprite) => numericSpriteIndex(sprite.name) !== null);

  for (const sprite of sprites) {
    const relativePath = normalizedRelativePath(sprite).toLowerCase();
    if (
      !monthDigitFont &&
      (folderIsMonths || /(^|\/)months?\//.test(relativePath))
    ) {
      const label = monthLabelFor(sprite.name);
      if (label) addUniqueSprite(labelSprites, label, sprite);
      continue;
    }
    if (folderIsWeekdays || /(^|\/)weekdays?\//.test(relativePath)) {
      const label = weekdayLabelFor(sprite.name);
      if (label) addUniqueSprite(labelSprites, label, sprite);
      continue;
    }
    const digit = numericSpriteIndex(sprite.name);
    if (digit !== null) {
      const key = String(digit);
      addUniqueSprite(digitSprites, key, sprite, key.padStart(2, "0"));
    }
  }

  return {
    digitSprites,
    labelSprites,
    importedDigitCount: digitSprites.size,
    importedWeekdayCount: [...labelSprites.keys()].filter((label) =>
      WEEKDAY_LABELS.includes(label)
    ).length,
    importedMonthCount: [...labelSprites.keys()].filter((label) =>
      MONTH_LABELS.includes(label)
    ).length
  };
}

function labelFromSpriteFolder(folder: CorosWatchfaceRasterFontFolder): string {
  return folder.label.replace(/[-_]+/g, " ").trim() || "Custom PNG sprites";
}

/**
 * Produces a complete replacement value. The existing raster font is
 * intentionally not accepted, so stale atlas, glyph, sprite, label, and size
 * data cannot leak into the new folder import. Tint is the sole presentation
 * setting supplied explicitly by the caller.
 */
export async function createRasterFontFolderReplacement(
  folder: CorosWatchfaceRasterFontFolder,
  options: RasterSpriteFolderReplacementOptions
): Promise<RasterSpriteFolderReplacement> {
  const classified = classifyRasterSpriteFolder(
    folder,
    options.componentKind
  );
  const digitSprites = new Map(
    [...classified.digitSprites].map(([key, sprite]) => [key, sprite.dataUrl])
  );
  const labelSprites = new Map(
    [...classified.labelSprites].map(([key, sprite]) => [key, sprite.dataUrl])
  );
  if (digitSprites.size === 0 && labelSprites.size === 0) {
    throw new Error(
      "Choose a digits folder, a weekdays folder, or a parent folder containing PNG sprites."
    );
  }
  const atlas = digitSprites.size > 0
    ? await options.createDigitAtlas(digitSprites)
    : {
        dataUrl: labelSprites.values().next().value!,
        glyphs: "",
        columns: 1
      };
  const sprites = {
    ...Object.fromEntries(digitSprites),
    ...Object.fromEntries(labelSprites)
  };
  const spriteSizes = Object.fromEntries(
    await Promise.all(
      Object.entries(sprites).map(async ([key, dataUrl]) => [
        key,
        await options.readSpriteSize(dataUrl)
      ] as const)
    )
  );
  const labels = Object.fromEntries(labelSprites);
  return {
    rasterFont: {
      label: labelFromSpriteFolder(folder),
      ...atlas,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
      sprites,
      spriteSizes,
      tint: options.tint
    },
    importedDigitCount: classified.importedDigitCount,
    importedWeekdayCount: classified.importedWeekdayCount,
    importedMonthCount: classified.importedMonthCount
  };
}
