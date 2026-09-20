import { CircleAlert, Files, FolderOpen, LayoutGrid, Sparkles, Trash2 } from "lucide-react";
import { OfficialAssetBrowser, officialAssetToSpriteFolder } from "./OfficialAssetBrowser";
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
import {
  describeRasterFontSource,
  rasterFontStripCells,
  WatchfaceSpriteStrip
} from "./WatchfaceSpriteStrip";

interface CustomPngFontPanelProps {
  api: CorosLinkApi;
  /** Target watch; enables browsing the official COROS digit fonts. */
  firmwareType?: string;
  /** The shared face-wide PNG set. */
  rasterFont?: CorosWatchfaceRasterFont;
  onRasterFontChange: (font: CorosWatchfaceRasterFont | undefined) => void;
  /** When supplied, imports can alternatively be isolated to this layer. */
  componentRasterFont?: CorosWatchfaceRasterFont;
  componentLabel?: string;
  onComponentRasterFontChange?: (font: CorosWatchfaceRasterFont | undefined) => void;
  onActivate?: () => void;
  /**
   * The set the font picker above this panel already previews; the panel skips
   * its own strip while that same set is the one being edited.
   */
  previewedFont?: CorosWatchfaceRasterFont;
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
  firmwareType,
  rasterFont,
  onRasterFontChange,
  componentRasterFont,
  componentLabel,
  onComponentRasterFontChange,
  onActivate,
  previewedFont,
  importDisabled = false,
  onImportStart,
  onImportFinish,
  isImportCurrent
}: CustomPngFontPanelProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [officialBrowserOpen, setOfficialBrowserOpen] = useState(false);
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

  async function chooseRasterSpriteFolder(preset?: CorosWatchfaceRasterFontFolder) {
    const request = beginImport();
    if (!request) return;
    try {
      setStatus(preset ? "Importing official font…" : "Reading PNG sprite folder…");
      setError(null);
      const folder = preset ?? await api.chooseCorosWatchfaceRasterFontFolder();
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
  const hasAtlasLayout = Boolean(activeRasterFont?.dataUrl) &&
    normalizeRasterFontGlyphs(activeRasterFont?.glyphs ?? "").length > 0;
  const previewCells = activeRasterFont ? rasterFontStripCells(activeRasterFont) : [];
  const missingDigits = previewCells.filter(
    (cell) => cell.missing && DEFAULT_RASTER_GLYPHS.includes(cell.key)
  ).length;
  const isMonthComponent = scope === "component" && componentLabel === "Date month";
  const isWeekdayComponent = scope === "component" && componentLabel === "Weekday";
  const namingHint = isMonthComponent
    ? "Name files 00.png–11.png or JAN.png–DEC.png"
    : isWeekdayComponent
      ? "Name files MON.png–SUN.png (or 00.png–06.png)"
      : "Name files 00.png–09.png";

  const sourceButtons = (compact: boolean) => (
    <div className={`wf-png-font-sources${compact ? " is-compact" : ""}`}>
      <button
        className="wf-png-font-source"
        type="button"
        disabled={controlsDisabled}
        onClick={() => setOfficialBrowserOpen(true)}
      >
        <span className="wf-png-font-source-icon" aria-hidden="true"><Sparkles size={16} /></span>
        <span className="wf-png-font-source-copy">
          <strong>{compact ? "Official…" : "Official COROS font"}</strong>
          {!compact ? <span>Digit sets unpacked from the official face catalog.</span> : null}
        </span>
      </button>
      <button
        className="wf-png-font-source"
        type="button"
        disabled={controlsDisabled}
        onClick={() => void chooseRasterSpriteFolder()}
      >
        <span className="wf-png-font-source-icon" aria-hidden="true"><FolderOpen size={16} /></span>
        <span className="wf-png-font-source-copy">
          <strong>{compact ? "Folder…" : "Folder of PNGs"}{!compact ? <em>Recommended</em> : null}</strong>
          {!compact ? <span>One file per glyph. {namingHint}.</span> : null}
        </span>
      </button>
      <label className={`wf-png-font-source${controlsDisabled ? " is-disabled" : ""}`}>
        <span className="wf-png-font-source-icon" aria-hidden="true"><LayoutGrid size={16} /></span>
        <span className="wf-png-font-source-copy">
          <strong>{compact ? "Sheet…" : "Sprite sheet"}</strong>
          {!compact ? <span>All glyphs in one PNG grid. You set the column count and glyph order next.</span> : null}
        </span>
        <input
          type="file"
          accept="image/png"
          disabled={controlsDisabled}
          onChange={(event) => void chooseRasterFont(event.currentTarget.files?.[0])}
        />
      </label>
      <label className={`wf-png-font-source${controlsDisabled ? " is-disabled" : ""}`}>
        <span className="wf-png-font-source-icon" aria-hidden="true"><Files size={16} /></span>
        <span className="wf-png-font-source-copy">
          <strong>{compact ? "Files…" : "Individual files"}</strong>
          {!compact ? <span>Pick a few PNGs to add or replace single glyphs. Same names as a folder.</span> : null}
        </span>
        <input
          type="file"
          accept="image/png"
          multiple
          disabled={controlsDisabled}
          onChange={(event) => void chooseIndividualSprites(event.currentTarget.files)}
        />
      </label>
    </div>
  );

  return (
    <section className="wf-png-font" aria-label="Custom PNG font">
      <div className="wf-png-font-head">
        <strong>Custom PNG font</strong>
        {activeRasterFont
          ? null
          : <span>Draw the digits yourself and use the PNGs instead of a font.</span>}
      </div>

      {supportsComponentScope ? (
        <div className="wf-png-font-scope">
          <div className="wf-png-font-segmented" role="group" aria-label="Where this PNG set applies">
            <button
              type="button"
              aria-pressed={scope === "component"}
              disabled={controlsDisabled}
              onClick={() => setScope("component")}
            >
              {componentLabel ?? "This layer"} only
            </button>
            <button
              type="button"
              aria-pressed={scope === "all"}
              disabled={controlsDisabled}
              onClick={() => setScope("all")}
            >
              Whole face
            </button>
          </div>
          <span>
            {scope === "component"
              ? `Only ${componentLabel ?? "this layer"} uses this set. Other layers keep their fonts.`
              : "Every text layer on the face shares this one set."}
            {scope === "component" && rasterFont ? " A whole-face set is also installed." : ""}
            {scope === "all" && componentRasterFont ? ` ${componentLabel ?? "This layer"} has its own set that takes priority.` : ""}
          </span>
        </div>
      ) : null}

      {!activeRasterFont ? (
        sourceButtons(false)
      ) : (
        <>
          {activeRasterFont === previewedFont ? null : (
            <WatchfaceSpriteStrip
              label="Imported glyphs"
              cells={previewCells}
              summary={describeRasterFontSource(activeRasterFont)}
            />
          )}

          {missingDigits > 0 && !isMonthComponent && !isWeekdayComponent ? (
            <p className="wf-png-font-note is-warning">
              <CircleAlert size={13} aria-hidden="true" />
              {missingDigits === 10
                ? "No digits yet. Add PNGs for 0–9 before this set can replace the live digits."
                : `${missingDigits} digit${missingDigits === 1 ? "" : "s"} missing. Add the dashed ones with “Files…” below.`}
            </p>
          ) : null}

          <div className="wf-png-font-fields">
            <label className="wf-png-font-row">
              <span>Name</span>
              <input
                disabled={controlsDisabled}
                value={activeRasterFont.label}
                onChange={(event) => updateRasterFont({ label: event.target.value })}
                placeholder="My pixel font"
              />
            </label>
            {hasAtlasLayout ? (
              <>
                <label className="wf-png-font-row">
                  <span>Columns</span>
                  <input
                    className="wf-png-font-number"
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
                <label className="wf-png-font-row">
                  <span title="One character per cell, left to right, then top to bottom">Glyph order</span>
                  <input
                    className="wf-png-font-mono"
                    disabled={controlsDisabled}
                    value={activeRasterFont.glyphs}
                    onChange={(event) =>
                      updateRasterFont({ glyphs: normalizeRasterFontGlyphs(event.target.value) })
                    }
                    placeholder="0123456789"
                  />
                </label>
                <p className="wf-png-font-note">Order matches the sheet: left to right, then the next row.</p>
              </>
            ) : null}
            <label className="wf-png-font-row wf-png-font-row--toggle">
              <span>Use layer color</span>
              <input
                type="checkbox"
                disabled={controlsDisabled}
                checked={activeRasterFont.tint}
                onChange={(event) => updateRasterFont({ tint: event.target.checked })}
              />
            </label>
            <p className="wf-png-font-note">
              {activeRasterFont.tint
                ? "The PNGs are recolored to match the digit color."
                : "The PNGs keep their own colors. Turn on to recolor them with the digit color."}
            </p>
          </div>

          <div className="wf-png-font-replace">
            <span>Replace with</span>
            {sourceButtons(true)}
            <button
              className="wf-png-font-remove"
              type="button"
              disabled={controlsDisabled}
              onClick={() => setActiveRasterFont(undefined)}
            >
              <Trash2 size={13} aria-hidden="true" /> Remove
            </button>
          </div>
        </>
      )}

      {activeRasterFont && rasterFontHasDigits && isMonthComponent ? (
        <p className="wf-png-font-note">
          This set has 0–9, so the month shows as a number (1–12).
        </p>
      ) : null}
      {activeRasterFont && !rasterFontHasDigits ? (
        rasterFontHasMonth && componentLabel === "Date month" ? (
          <p className="wf-png-font-note">
            This set has JAN–DEC labels, so the month shows as a 12-image set.
          </p>
        ) : rasterFontHasWeekday || rasterFontHasMonth ? (
          <p className="wf-png-font-note">
            This set provides date labels and leaves numeric fields unchanged.
          </p>
        ) : null
      ) : null}
      {error ? (
        <p className="wf-png-font-note is-warning" role="alert">
          <CircleAlert size={13} aria-hidden="true" /> {error}
        </p>
      ) : null}
      {importing ? (
        <p className="wf-png-font-note is-status" role="status">Importing…</p>
      ) : status ? (
        <p className="wf-png-font-note is-status" role="status">{status}</p>
      ) : null}

      <details className="wf-png-font-rules">
        <summary>File naming rules</summary>
        <ul>
          <li>Digits: <code>00.png</code> – <code>09.png</code>.</li>
          <li>Weekdays: <code>MON.png</code> – <code>SUN.png</code>, or <code>00.png</code> – <code>06.png</code>.</li>
          <li>Months: <code>JAN.png</code> – <code>DEC.png</code>, or <code>00.png</code> – <code>11.png</code>. A 0–9 digit folder gives a numeric month instead.</li>
          <li>Individual files take priority over a sheet, so you can fix one glyph without re-importing everything.</li>
        </ul>
      </details>
      {officialBrowserOpen ? (
        <OfficialAssetBrowser
          api={api}
          firmwareType={firmwareType}
          mode="font"
          fontKind={scope === "component" && componentLabel === "Weekday" ? "weekday" : scope === "component" && componentLabel === "Date month" ? "month" : "digits"}
          defaultRole={scope !== "component" || /hour|minute|second/i.test(componentLabel ?? "") ? "time" : /battery/i.test(componentLabel ?? "") ? "battery" : /temp|weather/i.test(componentLabel ?? "") ? "weather" : ""}
          title={componentLabel ? `Official font for ${componentLabel}` : "Official COROS fonts"}
          onClose={() => setOfficialBrowserOpen(false)}
          onPick={(frames) => chooseRasterSpriteFolder(officialAssetToSpriteFolder(frames))}
        />
      ) : null}
    </section>
  );
}
