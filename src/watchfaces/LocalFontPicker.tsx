import { ChevronDown, ImagePlus, Loader2, Type } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CorosWatchfaceRasterFont,
  CorosWatchfaceRasterFontFolder
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  normalizeRasterFontGlyphs,
  rasterFontSupportsText,
  type WatchfaceTypography
} from "./watchfaceStudio";

interface LocalFontPickerProps {
  api: CorosLinkApi;
  label: string;
  value: string;
  emptyLabel: string;
  onChange: (family: string) => void;
  /** A shared PNG atlas that replaces rasterized text sprites across the face. */
  rasterFont?: CorosWatchfaceRasterFont;
  /** Text the PNG set must contain before this picker shows it as active. */
  rasterFontRequiredText?: string;
  onRasterFontChange?: (font: CorosWatchfaceRasterFont | undefined) => void;
  typography?: WatchfaceTypography;
  onTypographyChange?: (typography: WatchfaceTypography) => void;
  disabled?: boolean;
}

interface FontPickerPopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface RasterSpriteFolderImport
  extends Pick<
    CorosWatchfaceRasterFont,
    "dataUrl" | "glyphs" | "columns" | "labels"
  > {
  importedDigitCount: number;
  importedWeekdayCount: number;
}

const FONT_PICKER_VIEWPORT_MARGIN = 12;
const FONT_PICKER_POPOVER_GAP = 8;
const FONT_PICKER_POPOVER_WIDTH = 420;
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

function numericSpriteIndex(fileName: string): number | null {
  const match = fileName.match(/^(\d{1,2})\.png$/i);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 && index <= 9 ? index : null;
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
): Promise<Pick<CorosWatchfaceRasterFont, "dataUrl" | "glyphs" | "columns">> {
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
  return { dataUrl: canvas.toDataURL("image/png"), glyphs: glyphs.join(""), columns: glyphs.length };
}

async function readRasterSpriteFolder(
  folder: CorosWatchfaceRasterFontFolder,
  currentRasterFont?: CorosWatchfaceRasterFont
): Promise<RasterSpriteFolderImport> {
  const digitSprites = new Map<string, string>();
  const labelSprites = new Map<string, string>();
  const folderIsWeekdays = /^weekdays?$/i.test(folder.label.trim());
  for (const file of folder.sprites) {
    const relativePath = file.relativePath.replace(/\\/g, "/").toLowerCase();
    if (folderIsWeekdays || /(^|\/)weekdays?\//.test(relativePath)) {
      const label = weekdayLabelFor(file.name);
      if (label) {
        labelSprites.set(label, file.dataUrl);
      }
      continue;
    }
    const digit = numericSpriteIndex(file.name);
    if (digit !== null) {
      digitSprites.set(String(digit), file.dataUrl);
    }
  }
  const atlas = digitSprites.size > 0
    ? await createAtlasFromSprites(digitSprites)
    : currentRasterFont?.dataUrl
      ? {
          dataUrl: currentRasterFont.dataUrl,
          glyphs: normalizeRasterFontGlyphs(currentRasterFont.glyphs),
          columns: currentRasterFont.columns
        }
      : labelSprites.size > 0
        ? {
            // Weekday-only folders render through labels. This fallback keeps
            // the project-local font definition valid and portable.
            dataUrl: labelSprites.values().next().value!,
            glyphs: "",
            columns: 1
          }
        : (() => {
            throw new Error(
              "Choose a digits folder, a weekdays folder, or a parent folder containing PNG sprites."
            );
          })();
  const labels = { ...currentRasterFont?.labels, ...Object.fromEntries(labelSprites) };
  return {
    ...atlas,
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    importedDigitCount: digitSprites.size,
    importedWeekdayCount: labelSprites.size
  };
}

function labelFromSpriteFolder(folder: CorosWatchfaceRasterFontFolder): string {
  return folder.label.replace(/[-_]+/g, " ").trim() || "Custom PNG sprites";
}

/**
 * A searchable picker for the font families installed on the current machine.
 * A font is deliberately only applied when the user presses the rasterize
 * button, making the browser-preview → PNG-sprite step explicit.
 */
export function LocalFontPicker({
  api,
  label,
  value,
  emptyLabel,
  onChange,
  rasterFont,
  rasterFontRequiredText,
  onRasterFontChange,
  typography,
  onTypographyChange,
  disabled = false
}: LocalFontPickerProps) {
  const [open, setOpen] = useState(false);
  const [families, setFamilies] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState(value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rasterImportStatus, setRasterImportStatus] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] =
    useState<FontPickerPopoverPosition | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const matchingFamilies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return families ?? [];
    }
    return (families ?? []).filter((family) =>
      family.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [families, query]);
  const exactMatch = matchingFamilies.some(
    (family) => family.localeCompare(query.trim(), undefined, { sensitivity: "accent" }) === 0
  );
  const fontWeight = typography?.fontWeight ?? 400;
  const fontStyle = typography?.fontStyle ?? "normal";
  const letterSpacing = typography?.letterSpacing ?? 0;
  const rasterFontIsActive = Boolean(
    rasterFont &&
      (!rasterFontRequiredText ||
        rasterFontSupportsText(rasterFont, rasterFontRequiredText))
  );
  const typographyDisabled = disabled || (!value && !rasterFontIsActive);
  const fontShapeControlsDisabled = typographyDisabled || rasterFontIsActive;
  const rasterFontHasDigits = rasterFontSupportsText(
    rasterFont,
    DEFAULT_RASTER_GLYPHS
  );
  const sampleStyle: CSSProperties = {
    fontWeight,
    fontStyle,
    letterSpacing: `${letterSpacing}em`
  };

  function updateTypography(patch: WatchfaceTypography) {
    onTypographyChange?.({ ...typography, ...patch });
  }

  async function openPicker() {
    if (disabled) {
      return;
    }
    setCandidate(value);
    setPopoverPosition(null);
    setOpen(true);
    if (families !== null || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextFamilies = await api.listLocalFontFamilies();
      setFamilies(nextFamilies);
      if (nextFamilies.length === 0) {
        setError("No installed font families were found. You can still enter a family name below.");
      }
    } catch {
      setFamilies([]);
      setError("Could not scan installed fonts. You can still enter a family name below.");
    } finally {
      setLoading(false);
    }
  }

  function closePicker() {
    setOpen(false);
    setPopoverPosition(null);
    setQuery("");
  }

  function applyCandidate() {
    if (!candidate.trim()) {
      return;
    }
    onChange(candidate.trim());
    onRasterFontChange?.(undefined);
    closePicker();
  }

  function restoreTemplate() {
    onChange("");
    onRasterFontChange?.(undefined);
    closePicker();
  }

  function updateRasterFont(patch: Partial<CorosWatchfaceRasterFont>) {
    if (!rasterFont || !onRasterFontChange) {
      return;
    }
    onRasterFontChange({ ...rasterFont, ...patch });
  }

  async function chooseRasterFont(file: File | undefined) {
    if (!file || !onRasterFontChange) {
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
    try {
      const dataUrl = await fileToDataUrl(file);
      onChange("");
      onRasterFontChange({
        label: rasterFont?.label || labelFromFileName(file.name),
        dataUrl,
        glyphs: normalizeRasterFontGlyphs(rasterFont?.glyphs || DEFAULT_RASTER_GLYPHS),
        columns: rasterFont?.columns || DEFAULT_RASTER_GLYPHS.length,
        // Custom sprite artwork is normally coloured already. Preserve that
        // artwork unless the user has explicitly opted into a colour override.
        tint: rasterFont?.tint ?? false
      });
      setRasterImportStatus(`Loaded ${file.name}.`);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The PNG font could not be read.");
    }
  }

  async function chooseRasterSpriteFolder() {
    if (!onRasterFontChange) {
      return;
    }
    try {
      setRasterImportStatus("Reading PNG sprite folder…");
      setError(null);
      const folder = await api.chooseCorosWatchfaceRasterFontFolder();
      if (!folder) {
        setRasterImportStatus(null);
        return;
      }
      const raster = await readRasterSpriteFolder(folder, rasterFont);
      onChange("");
      onRasterFontChange({
        label: rasterFont?.label || labelFromSpriteFolder(folder),
        ...raster,
        // Folder sprites preserve their original RGBA colours by default.
        tint: rasterFont?.tint ?? false
      });
      const importSummary = [
        raster.importedDigitCount > 0
          ? String(raster.importedDigitCount) +
            " digit sprite" +
            (raster.importedDigitCount === 1 ? "" : "s")
          : null,
        raster.importedWeekdayCount > 0
          ? String(raster.importedWeekdayCount) +
            " weekday label" +
            (raster.importedWeekdayCount === 1 ? "" : "s")
          : null
      ].filter(Boolean).join(" and ");
      setRasterImportStatus("Imported " + importSummary + ".");
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The PNG sprite folder could not be imported."
      );
      setRasterImportStatus(null);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePress(event: PointerEvent) {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        (!pickerRef.current?.contains(target) && !panelRef.current?.contains(target))
      ) {
        closePicker();
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePicker();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function positionPopover() {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const width = Math.min(
        FONT_PICKER_POPOVER_WIDTH,
        window.innerWidth - FONT_PICKER_VIEWPORT_MARGIN * 2
      );
      const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 440;
      const spaceBelow = Math.max(
        0,
        window.innerHeight - rect.bottom - FONT_PICKER_POPOVER_GAP - FONT_PICKER_VIEWPORT_MARGIN
      );
      const spaceAbove = Math.max(
        0,
        rect.top - FONT_PICKER_POPOVER_GAP - FONT_PICKER_VIEWPORT_MARGIN
      );
      const openAbove = panelHeight > spaceBelow && spaceAbove > spaceBelow;
      const availableHeight = openAbove ? spaceAbove : spaceBelow;
      const left = Math.max(
        FONT_PICKER_VIEWPORT_MARGIN,
        Math.min(rect.left, window.innerWidth - width - FONT_PICKER_VIEWPORT_MARGIN)
      );
      const top = openAbove
        ? Math.max(
            FONT_PICKER_VIEWPORT_MARGIN,
            rect.top - FONT_PICKER_POPOVER_GAP - Math.min(panelHeight, availableHeight)
          )
        : Math.min(
            rect.bottom + FONT_PICKER_POPOVER_GAP,
            window.innerHeight - FONT_PICKER_VIEWPORT_MARGIN
          );

      setPopoverPosition({ top, left, width, maxHeight: availableHeight });
    }

    positionPopover();
    window.addEventListener("resize", positionPopover);
    document.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      document.removeEventListener("scroll", positionPopover, true);
    };
  }, [families, loading, open, query]);

  return (
    <div ref={pickerRef} className="field watchface-font-picker">
      <span className="watchface-font-picker-label">{label}</span>
      <div className="watchface-font-picker-menu">
        <button
          ref={triggerRef}
          className="watchface-font-picker-trigger"
          type="button"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            if (open) {
              closePicker();
            } else {
              void openPicker();
            }
          }}
        >
          <span
            className={value || rasterFontIsActive ? "watchface-font-picker-value" : "watchface-font-picker-placeholder"}
            style={value ? { fontFamily: value, ...sampleStyle } : undefined}
          >
            {rasterFontIsActive && rasterFont ? rasterFont.label + " (PNG)" : value || emptyLabel}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>

        {open && typeof document !== "undefined"
          ? createPortal(
          <div
            ref={panelRef}
            className="watchface-font-picker-panel"
            role="dialog"
            aria-label={`${label} picker`}
            style={{
              top: popoverPosition?.top ?? 0,
              left: popoverPosition?.left ?? 0,
              width: popoverPosition?.width ?? FONT_PICKER_POPOVER_WIDTH,
              maxHeight: popoverPosition?.maxHeight,
              visibility: popoverPosition ? "visible" : "hidden"
            }}
          >
            <div className="watchface-font-picker-search">
              <Type size={15} aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search or enter a font family"
                aria-label="Search installed fonts"
              />
            </div>

            {loading ? (
              <p className="watchface-font-picker-status">
                <Loader2 className="spin" size={14} /> Loading your local font library…
              </p>
            ) : null}
            {error ? <p className="watchface-font-picker-status">{error}</p> : null}
            {families !== null && !loading ? (
              <p className="watchface-font-picker-status">
                {families.length} installed font {families.length === 1 ? "family" : "families"} available locally.
              </p>
            ) : null}

            {query.trim() && !exactMatch ? (
              <button
                className="watchface-font-custom-option"
                type="button"
                onClick={() => setCandidate(query.trim())}
              >
                Use “{query.trim()}” as entered
              </button>
            ) : null}

            {onRasterFontChange ? (
              <section className="watchface-raster-font-panel" aria-label="Custom PNG font">
                <div>
                  <strong>Custom PNG font</strong>
                  <span>Upload a uniformly gridded glyph atlas.</span>
                </div>
                <label className="watchface-raster-font-upload">
                  <ImagePlus size={15} aria-hidden="true" />
                  <span>{rasterFont ? "Replace PNG atlas" : "Upload PNG atlas"}</span>
                  <input
                    type="file"
                    accept="image/png"
                    onChange={(event) => void chooseRasterFont(event.currentTarget.files?.[0])}
                  />
                </label>
                <button
                  className="watchface-raster-font-upload"
                  type="button"
                  onClick={() => void chooseRasterSpriteFolder()}
                >
                  <ImagePlus size={15} aria-hidden="true" />
                  <span>Import PNG sprite folder</span>
                </button>
                {rasterFont ? (
                  <div className="watchface-raster-font-fields">
                    <label>
                      Font label
                      <input
                        value={rasterFont.label}
                        onChange={(event) => updateRasterFont({ label: event.target.value })}
                        placeholder="My pixel font"
                      />
                    </label>
                    <label>
                      Columns
                      <input
                        type="number"
                        min="1"
                        max="64"
                        value={rasterFont.columns}
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
                        value={rasterFont.glyphs}
                        onChange={(event) =>
                          updateRasterFont({ glyphs: normalizeRasterFontGlyphs(event.target.value) })
                        }
                        placeholder="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                      />
                    </label>
                    <label className="watchface-raster-font-tint">
                      <input
                        type="checkbox"
                        checked={rasterFont.tint}
                        onChange={(event) => updateRasterFont({ tint: event.target.checked })}
                      />
                      Apply selected digit color (overrides PNG colors)
                    </label>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => onRasterFontChange(undefined)}
                    >
                      Remove PNG font
                    </button>
                  </div>
                ) : null}
                {rasterFont && !rasterFontHasDigits ? (
                  rasterFontSupportsText(rasterFont, "MON") ? (
                    <p className="watchface-raster-font-status">
                      This PNG set provides weekday labels and leaves numeric fields unchanged.
                    </p>
                  ) : (
                    <p className="watchface-raster-font-warning">
                      Add all of 0123456789 to the glyph labels before this PNG font can replace live watchface digits.
                    </p>
                  )
                ) : null}
                {rasterImportStatus ? (
                  <p className="watchface-raster-font-status">{rasterImportStatus}</p>
                ) : null}
                <p>
                  PNG colors are preserved by default. An atlas needs 0123456789 for live numeric fields. A sprite folder can contain digits/00.png–09.png and optional weekdays/00.png–06.png (Monday to Sunday).
                </p>
              </section>
            ) : null}

            <div className="watchface-font-picker-results" role="listbox" aria-label="Installed font families">
              {matchingFamilies.slice(0, 100).map((family) => (
                <button
                  key={family}
                  className={candidate === family ? "is-selected" : ""}
                  type="button"
                  role="option"
                  aria-selected={candidate === family}
                  onClick={() => setCandidate(family)}
                >
                  <strong style={{ fontFamily: family, ...sampleStyle }}>{family}</strong>
                  <span style={{ fontFamily: family, ...sampleStyle }}>0123456789 · Wed</span>
                </button>
              ))}
            </div>
            {matchingFamilies.length > 100 ? (
              <p className="watchface-font-picker-status">Showing the first 100 matches—keep typing to narrow the list.</p>
            ) : null}

            <div className="watchface-font-picker-actions">
              <button className="secondary-button" type="button" onClick={restoreTemplate}>
                {emptyLabel}
              </button>
              <button className="primary-button" type="button" disabled={!candidate.trim()} onClick={applyCandidate}>
                Rasterize into preview
              </button>
            </div>
            <p className="watchface-font-picker-note">
              Weight and style affect each glyph. Digit spacing adjusts the gap between time digits, then creating the archive bakes the result into watch-ready PNG sprites.
            </p>
          </div>,
          document.body
        )
          : null}
      </div>

      {typography && onTypographyChange ? (
        <div className="watchface-typography-controls">
          <label>
            Weight
            <select
              value={fontWeight}
              disabled={fontShapeControlsDisabled}
              onChange={(event) => updateTypography({ fontWeight: Number(event.target.value) })}
            >
              {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => (
                <option key={weight} value={weight}>
                  {weight}{weight === 400 ? " · Regular" : weight === 700 ? " · Bold" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Style
            <select
              value={fontStyle}
              disabled={fontShapeControlsDisabled}
              onChange={(event) =>
                updateTypography({
                  fontStyle: event.target.value as "normal" | "italic"
                })
              }
            >
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </label>
          <label className="watchface-typography-tracking">
            Digit spacing <span>{Math.round(letterSpacing * 100)}%</span>
            <input
              type="range"
              min="-0.1"
              max="0.25"
              step="0.01"
              value={letterSpacing}
              disabled={typographyDisabled}
              onChange={(event) => updateTypography({ letterSpacing: Number(event.target.value) })}
            />
          </label>
        </div>
      ) : null}
      {typography && !value && !rasterFontIsActive ? (
        <p className="watchface-typography-hint">
          Choose a local font and rasterize it into the preview before adjusting its weight or spacing.
        </p>
      ) : null}
      {typography && rasterFontIsActive ? (
        <p className="watchface-typography-hint">
          The PNG atlas keeps its supplied glyph shapes; digit spacing still applies.
        </p>
      ) : null}

    </div>
  );
}
