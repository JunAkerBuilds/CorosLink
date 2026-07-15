import { ChevronDown, Loader2, Type } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CorosWatchfaceRasterFont } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
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

const FONT_PICKER_VIEWPORT_MARGIN = 12;
const FONT_PICKER_POPOVER_GAP = 8;
const FONT_PICKER_POPOVER_WIDTH = 420;

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
              min="-0.35"
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
