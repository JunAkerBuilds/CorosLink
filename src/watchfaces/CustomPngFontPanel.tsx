import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  CorosWatchfaceRasterFont,
  CorosWatchfaceRasterFontFolder
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  normalizeRasterFontGlyphs,
  rasterFontSupportsText,
  WATCHFACE_MONTH_LABELS
} from "./watchfaceStudio";
import {
  createRasterFontFolderReplacement,
  type RasterSpriteFolderComponentKind
} from "./watchfaceRasterFolder";

interface CustomPngFontPanelProps {
  api: CorosLinkApi;
  /** The shared face-wide PNG set. */
  rasterFont?: CorosWatchfaceRasterFont;
  onRasterFontChange: (font: CorosWatchfaceRasterFont | undefined) => void;
  /** When supplied, imports can alternatively be isolated to this layer. */
  componentRasterFont?: CorosWatchfaceRasterFont;
  componentLabel?: string;
  onComponentRasterFontChange?: (font: CorosWatchfaceRasterFont | undefined) => void;
  onActivate?: () => void;
  importDisabled?: boolean;
  onImportStart?: (target: string) => number | null;
  onImportFinish?: (importId: number) => void;
  isImportCurrent?: (importId: number) => boolean;
}

const DEFAULT_RASTER_GLYPHS = "0123456789";
const MAX_RASTER_FONT_BYTES = 5 * 1024 * 1024;
const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The PNG font could not be read."));
    reader.onload = () => {
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The PNG font could not be read."));
    };
    reader.readAsDataURL(file);
  });
}

function labelFromFileName(name: string): string {
  return name.replace(/\.png$/i, "").trim() || "Custom PNG font";
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A PNG sprite could not be decoded."));
    image.src = dataUrl;
  });
}

function numericSpriteIndex(fileName: string, maximum = 9): number | null {
  const match = fileName.match(/^(\d{1,2})\.png$/i);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 && index <= maximum ? index : null;
}

function monthLabelFor(fileName: string): string | null {
  const stem = fileName.replace(/\.png$/i, "").toUpperCase();
  if (WATCHFACE_MONTH_LABELS.includes(stem)) {
    return stem;
  }
  const index = numericSpriteIndex(fileName, 11);
  return index === null
    ? null
    : WATCHFACE_MONTH_LABELS[(index + 11) % 12] ?? null;
}

function weekdayLabelFor(fileName: string): string | null {
  const stem = fileName.replace(/\.png$/i, "").toUpperCase();
  if (WEEKDAY_LABELS.includes(stem)) {
    return stem;
  }
  const index = numericSpriteIndex(fileName);
  return index === null ? null : WEEKDAY_LABELS[index] ?? null;
}

async function createAtlasFromSprites(
  digitSprites: Map<string, string>
): Promise<Pick<CorosWatchfaceRasterFont, "dataUrl" | "glyphs" | "columns" | "atlasSize">> {
  const glyphs = [...digitSprites.keys()].sort();
  if (glyphs.length === 0) {
    throw new Error("Choose at least one digit PNG named 00.png through 09.png.");
  }
  const sprites = await Promise.all(
    glyphs.map(async (glyph) => ({
      glyph,
      image: await loadImage(digitSprites.get(glyph)!)
    }))
  );
  const cellWidth = Math.max(...sprites.map((sprite) => sprite.image.naturalWidth));
  const cellHeight = Math.max(...sprites.map((sprite) => sprite.image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = cellWidth * sprites.length;
  canvas.height = cellHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("PNG font atlas creation is unavailable in this window.");
  }
  sprites.forEach((sprite, index) => {
    context.drawImage(
      sprite.image,
      index * cellWidth + (cellWidth - sprite.image.naturalWidth) / 2,
      (cellHeight - sprite.image.naturalHeight) / 2
    );
  });
  return {
    dataUrl: canvas.toDataURL("image/png"),
    glyphs: glyphs.join(""),
    columns: glyphs.length,
    atlasSize: { width: canvas.width, height: canvas.height }
  };
}

async function readRasterSpriteFolder(
  folder: CorosWatchfaceRasterFontFolder,
  componentKind: RasterSpriteFolderComponentKind | undefined,
  tint: boolean
) {
  return createRasterFontFolderReplacement(folder, {
    componentKind,
    tint,
    createDigitAtlas: createAtlasFromSprites,
    readSpriteSize: async (dataUrl) => {
      const image = await loadImage(dataUrl);
      return { width: image.naturalWidth, height: image.naturalHeight };
    }
  });
}

export function CustomPngFontPanel({
  api,
  rasterFont,
  onRasterFontChange,
  componentRasterFont,
  componentLabel,
  onComponentRasterFontChange,
  onActivate,
  importDisabled = false,
  onImportStart,
  onImportFinish,
  isImportCurrent
}: CustomPngFontPanelProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const mountedRef = useRef(false);
  const importRevisionRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importRevisionRef.current += 1;
    };
  }, []);
  const supportsComponentScope = Boolean(onComponentRasterFontChange);
  const [scope, setScope] = useState<"component" | "all">(
    supportsComponentScope ? "component" : "all"
  );
  const activeRasterFont = scope === "component" ? componentRasterFont : rasterFont;
  const setActiveRasterFont = (font: CorosWatchfaceRasterFont | undefined) => {
    if (scope === "component" && onComponentRasterFontChange) {
      onComponentRasterFontChange(font);
    } else {
      onRasterFontChange(font);
    }
  };
  const rasterFontHasDigits = rasterFontSupportsText(
    activeRasterFont,
    DEFAULT_RASTER_GLYPHS
  );
  const rasterFontHasWeekday = WEEKDAY_LABELS.some((label) =>
    rasterFontSupportsText(activeRasterFont, label)
  );
  const rasterFontHasMonth = WATCHFACE_MONTH_LABELS.some((label) =>
    rasterFontSupportsText(activeRasterFont, label)
  );

  function updateRasterFont(patch: Partial<CorosWatchfaceRasterFont>) {
    if (activeRasterFont) {
      setActiveRasterFont({ ...activeRasterFont, ...patch });
    }
  }

  function beginImport(): { importId: number; revision: number } | null {
    if (importDisabled || importing) return null;
    const importId = onImportStart?.(
      scope === "component"
        ? `component:${componentLabel ?? "custom-png-font"}`
        : "global-raster-font"
    ) ?? Date.now();
    if (importId === null) return null;
    const revision = ++importRevisionRef.current;
    setImporting(true);
    return { importId, revision };
  }

  function importCanCommit(importId: number, revision: number): boolean {
    return (
      mountedRef.current &&
      revision === importRevisionRef.current &&
      (isImportCurrent?.(importId) ?? true)
    );
  }

  function finishImport(importId: number, revision: number): void {
    onImportFinish?.(importId);
    if (mountedRef.current && revision === importRevisionRef.current) {
      setImporting(false);
    }
  }

  async function chooseRasterFont(file: File | undefined) {
    if (!file) {
      return;
    }
    if (file.type !== "image/png") {
      setError("Choose a PNG file for the custom raster font.");
      return;
    }
    if (file.size > MAX_RASTER_FONT_BYTES) {
      setError("PNG font files must be 5 MB or smaller.");
      return;
    }
    const request = beginImport();
    if (!request) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const image = await loadImage(dataUrl);
      if (!importCanCommit(request.importId, request.revision)) return;
      onActivate?.();
      setActiveRasterFont({
        label: activeRasterFont?.label || labelFromFileName(file.name),
        dataUrl,
        glyphs: normalizeRasterFontGlyphs(activeRasterFont?.glyphs || DEFAULT_RASTER_GLYPHS),
        columns: activeRasterFont?.columns || DEFAULT_RASTER_GLYPHS.length,
        atlasSize: { width: image.naturalWidth, height: image.naturalHeight },
        tint: activeRasterFont?.tint ?? false
      });
      setStatus(`Loaded ${file.name}.`);
      setError(null);
    } catch (caught) {
      if (importCanCommit(request.importId, request.revision)) {
        setError(caught instanceof Error ? caught.message : "The PNG font could not be read.");
      }
    } finally {
      finishImport(request.importId, request.revision);
    }
  }

  async function chooseRasterSpriteFolder() {
    const request = beginImport();
    if (!request) return;
    try {
      setStatus("Reading PNG sprite folder…");
      setError(null);
      const folder = await api.chooseCorosWatchfaceRasterFontFolder();
      if (!folder) {
        if (importCanCommit(request.importId, request.revision)) setStatus(null);
        return;
      }
      const replacement = await readRasterSpriteFolder(
        folder,
        scope === "component" && componentLabel === "Weekday"
          ? "weekday"
          : scope === "component" && componentLabel === "Date month"
            ? "month"
            : undefined,
        activeRasterFont?.tint ?? false
      );
      if (!importCanCommit(request.importId, request.revision)) return;
      onActivate?.();
      setActiveRasterFont(replacement.rasterFont);
      const importSummary = [
        replacement.importedDigitCount > 0
          ? String(replacement.importedDigitCount) +
            " digit sprite" +
            (replacement.importedDigitCount === 1 ? "" : "s")
          : null,
        replacement.importedWeekdayCount > 0
          ? String(replacement.importedWeekdayCount) +
            " weekday label" +
            (replacement.importedWeekdayCount === 1 ? "" : "s")
          : null,
        replacement.importedMonthCount > 0
          ? String(replacement.importedMonthCount) +
            " month label" +
            (replacement.importedMonthCount === 1 ? "" : "s")
          : null
      ].filter(Boolean).join(" and ");
      setStatus("Imported " + importSummary + ".");
      setError(null);
    } catch (caught) {
      if (importCanCommit(request.importId, request.revision)) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The PNG sprite folder could not be imported."
        );
        setStatus(null);
      }
    } finally {
      finishImport(request.importId, request.revision);
    }
  }

  async function chooseIndividualSprites(files: FileList | null) {
    if (!files?.length) return;
    const request = beginImport();
    if (!request) return;
    const nextSprites: Record<string, string> = { ...(activeRasterFont?.sprites ?? {}) };
    const nextSpriteSizes = { ...(activeRasterFont?.spriteSizes ?? {}) };
    try {
      for (const file of Array.from(files)) {
        if (file.type !== "image/png" || file.size > MAX_RASTER_FONT_BYTES) {
          throw new Error("Each individual sprite must be a PNG no larger than 5 MB.");
        }
        const isWeekdayComponent =
          scope === "component" && componentLabel === "Weekday";
        const isMonthComponent =
          scope === "component" && componentLabel === "Date month";
        const weekday = isWeekdayComponent ? weekdayLabelFor(file.name) : null;
        const month = isMonthComponent ? monthLabelFor(file.name) : null;
        const digit = isWeekdayComponent || isMonthComponent
          ? null
          : numericSpriteIndex(file.name);
        const key = weekday ?? month ?? (digit === null ? file.name.replace(/\.png$/i, "").trim().toUpperCase() : String(digit));
        if (!key) {
          throw new Error(
            "Name each sprite 00.png–09.png, month sprites 00.png–11.png, or use labels such as MON.png or JAN.png."
          );
        }
        const dataUrl = await fileToDataUrl(file);
        const image = await loadImage(dataUrl);
        nextSprites[key] = dataUrl;
        nextSpriteSizes[key] = {
          width: image.naturalWidth,
          height: image.naturalHeight
        };
      }
      if (!importCanCommit(request.importId, request.revision)) return;
      onActivate?.();
      setActiveRasterFont({
        label: activeRasterFont?.label || "Individual PNG sprites",
        dataUrl: activeRasterFont?.dataUrl || Object.values(nextSprites)[0]!,
        // Do not claim that a single imported PNG represents every digit.
        // Direct sprites opt in one glyph/label at a time; an existing atlas
        // remains available when the project already has one.
        glyphs: normalizeRasterFontGlyphs(activeRasterFont?.glyphs || ""),
        columns: activeRasterFont?.columns || 1,
        labels: activeRasterFont?.labels,
        sprites: nextSprites,
        spriteSizes: nextSpriteSizes,
        atlasSize: activeRasterFont?.atlasSize,
        tint: activeRasterFont?.tint ?? false
      });
      setStatus(`Imported ${files.length} independent PNG sprite${files.length === 1 ? "" : "s"}.`);
      setError(null);
    } catch (caught) {
      if (importCanCommit(request.importId, request.revision)) {
        setError(caught instanceof Error ? caught.message : "The PNG sprites could not be imported.");
      }
    } finally {
      finishImport(request.importId, request.revision);
    }
  }

  const controlsDisabled = importDisabled || importing;

  return (
    <section className="watchface-raster-font-panel" aria-label="Custom PNG font">
      <div>
        <strong>Custom PNG font</strong>
        <span>Choose whether this PNG set belongs to one component or the whole face.</span>
      </div>
      {supportsComponentScope ? (
        <label className="field">
          Apply PNG sprites to
          <select disabled={controlsDisabled} value={scope} onChange={(event) => setScope(event.target.value as "component" | "all")}>
            <option value="component">This component{componentLabel ? ` (${componentLabel})` : ""}</option>
            <option value="all">All text components</option>
          </select>
        </label>
      ) : null}
      <label className="watchface-raster-font-upload">
        <ImagePlus size={15} aria-hidden="true" />
        <span>{activeRasterFont ? "Replace PNG atlas" : "Upload PNG atlas"}</span>
        <input
          type="file"
          accept="image/png"
          disabled={controlsDisabled}
          onChange={(event) => void chooseRasterFont(event.currentTarget.files?.[0])}
        />
      </label>
      <button
        className="watchface-raster-font-upload"
        type="button"
        disabled={controlsDisabled}
        onClick={() => void chooseRasterSpriteFolder()}
      >
        <ImagePlus size={15} aria-hidden="true" />
        <span>Import PNG sprite folder</span>
      </button>
      <label className="watchface-raster-font-upload">
        <ImagePlus size={15} aria-hidden="true" />
        <span>Import individual PNG sprites</span>
        <input
          type="file"
          accept="image/png"
          multiple
          disabled={controlsDisabled}
          onChange={(event) => void chooseIndividualSprites(event.currentTarget.files)}
        />
      </label>
      {activeRasterFont ? (
        <div className="watchface-raster-font-fields">
          <label>
            Font label
            <input
              disabled={controlsDisabled}
              value={activeRasterFont.label}
              onChange={(event) => updateRasterFont({ label: event.target.value })}
              placeholder="My pixel font"
            />
          </label>
          <label>
            Columns
            <input
              disabled={controlsDisabled}
              type="number"
              min="1"
              max="64"
              value={activeRasterFont.columns}
              onChange={(event) =>
                updateRasterFont({
                  columns: Math.max(1, Math.min(64, Number(event.target.value) || 1))
                })
              }
            />
          </label>
          <label className="watchface-raster-font-glyphs">
            Glyph labels (left-to-right, then top-to-bottom)
            <input
              disabled={controlsDisabled}
              value={activeRasterFont.glyphs}
              onChange={(event) =>
                updateRasterFont({ glyphs: normalizeRasterFontGlyphs(event.target.value) })
              }
              placeholder="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            />
          </label>
          <label className="watchface-raster-font-tint">
            <input
              type="checkbox"
              disabled={controlsDisabled}
              checked={activeRasterFont.tint}
              onChange={(event) => updateRasterFont({ tint: event.target.checked })}
            />
            Apply selected digit color (overrides PNG colors)
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={controlsDisabled}
            onClick={() => setActiveRasterFont(undefined)}
          >
            Remove PNG font
          </button>
        </div>
      ) : null}
      {activeRasterFont && rasterFontHasDigits &&
        scope === "component" && componentLabel === "Date month" ? (
        <p className="watchface-raster-font-status">
          This PNG set provides 0–9 digits. Date Month will export as a numeric month (1–12).
        </p>
      ) : null}
      {activeRasterFont && !rasterFontHasDigits ? (
        rasterFontHasMonth && componentLabel === "Date month" ? (
          <p className="watchface-raster-font-status">
            This PNG set provides JAN–DEC labels. Date Month will export as a 12-image month set.
          </p>
        ) : rasterFontHasWeekday || rasterFontHasMonth ? (
          <p className="watchface-raster-font-status">
            This PNG set provides date labels and leaves numeric fields unchanged.
          </p>
        ) : (
          <p className="watchface-raster-font-warning">
            Add all of 0123456789 to the glyph labels before this PNG font can replace live watchface digits.
          </p>
        )
      ) : null}
      {error ? <p className="watchface-raster-font-warning">{error}</p> : null}
      {status ? <p className="watchface-raster-font-status">{status}</p> : null}
      {importing ? (
        <p className="watchface-raster-font-status">Importing sprites…</p>
      ) : null}
      <p>
        PNG colors are preserved by default. Import individual sprites named 00.png–09.png or by label (for example MON.png or JAN.png); each is retained independently and takes priority over the atlas. Month components accept either a 00.png–09.png digit folder (numeric month) or 00.png–11.png / JAN.png-style labels for JAN–DEC.
      </p>
    </section>
  );
}
