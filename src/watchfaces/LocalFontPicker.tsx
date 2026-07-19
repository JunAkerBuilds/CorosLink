import { Check, ChevronDown, Info, Loader2, Search, Type, X } from "lucide-react";
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
  /**
   * Routes the sprite-spacing slider to this component's own style instead of
   * the shared design typography; weight and style still edit the design.
   */
  onLetterSpacingChange?: (letterSpacing: number) => void;
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
const FONT_PICKER_POPOVER_WIDTH = 392;
const FONT_PICKER_RESULT_LIMIT = 100;

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
  onLetterSpacingChange,
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
  const fontShapeControlsDisabled =
    disabled || (!value && !rasterFontIsActive) || rasterFontIsActive;
  const spriteSpacingDisabled =
    disabled ||
    (!onLetterSpacingChange && !value && !rasterFontIsActive);
  // Keep picker labels and samples at natural tracking. Component-specific
  // spacing belongs to the exported watch glyphs, not the font-selection UI.
  const pickerPreviewStyle: CSSProperties = {
    fontWeight,
    fontStyle
  };

  function updateTypography(patch: WatchfaceTypography) {
    if (onLetterSpacingChange) {
      if (patch.letterSpacing !== undefined) {
        onLetterSpacingChange(patch.letterSpacing);
        return;
      }
      // The typography prop carries this component's effective spacing;
      // writing it back would pin the design-wide value to it.
      const { letterSpacing: _componentSpacing, ...shared } = {
        ...typography,
        ...patch
      };
      onTypographyChange?.(shared);
      return;
    }
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
      const inspector = trigger.closest<HTMLElement>(
        ".watchface-editor-inspector, .wf-properties-pane"
      );
      const inspectorRect = inspector?.getBoundingClientRect();
      const sideAnchorLeft = inspectorRect?.left ?? rect.left;
      const sideAnchorRight = inspectorRect?.right ?? rect.right;
      const spaceLeft =
        sideAnchorLeft -
        FONT_PICKER_POPOVER_GAP -
        FONT_PICKER_VIEWPORT_MARGIN;
      const spaceRight =
        window.innerWidth -
        sideAnchorRight -
        FONT_PICKER_POPOVER_GAP -
        FONT_PICKER_VIEWPORT_MARGIN;
      const openLeft = spaceLeft >= width || spaceLeft >= spaceRight;
      const unclampedLeft = openLeft
        ? sideAnchorLeft - FONT_PICKER_POPOVER_GAP - width
        : sideAnchorRight + FONT_PICKER_POPOVER_GAP;
      const left = Math.max(
        FONT_PICKER_VIEWPORT_MARGIN,
        Math.min(
          unclampedLeft,
          window.innerWidth - width - FONT_PICKER_VIEWPORT_MARGIN
        )
      );
      const visiblePanelHeight = Math.min(
        panelHeight,
        window.innerHeight - FONT_PICKER_VIEWPORT_MARGIN * 2
      );
      const desiredTop = rect.top + rect.height / 2 - 26;
      const top = Math.max(
        FONT_PICKER_VIEWPORT_MARGIN,
        Math.min(
          desiredTop,
          window.innerHeight -
            visiblePanelHeight -
            FONT_PICKER_VIEWPORT_MARGIN
        )
      );
      const availableHeight = Math.max(
        0,
        window.innerHeight - top - FONT_PICKER_VIEWPORT_MARGIN
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
            style={value ? { fontFamily: value, ...pickerPreviewStyle } : undefined}
          >
            {rasterFontIsActive && rasterFont ? rasterFont.label + " (PNG)" : value || emptyLabel}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>

        {open && typeof document !== "undefined"
          ? createPortal(
          <div
            ref={panelRef}
            className="watchface-font-picker-panel wf-font-picker-panel"
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
            <div className="watchface-font-picker-panel-header">
              <div className="watchface-font-picker-panel-icon" aria-hidden="true">
                <Type size={16} />
              </div>
              <div>
                <strong>Choose font</strong>
                <span>Installed on this computer</span>
              </div>
              <button
                className="watchface-font-picker-close"
                type="button"
                aria-label="Close font picker"
                onClick={() => {
                  closePicker();
                  triggerRef.current?.focus();
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="watchface-font-picker-browser">
              <div className="watchface-font-picker-search-overlay">
                <div className="watchface-font-picker-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search fonts"
                    aria-label="Search installed fonts"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Clear font search"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="watchface-font-picker-meta">
                  <span>{query.trim() ? "Search results" : "Local fonts"}</span>
                  {!loading && families !== null ? (
                    <span>
                      {Math.min(matchingFamilies.length, FONT_PICKER_RESULT_LIMIT)} of{" "}
                      {matchingFamilies.length}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="watchface-font-picker-browser-scroll">
                {loading ? (
                  <p className="watchface-font-picker-status">
                    <Loader2 className="spin" size={14} /> Loading your local font library…
                  </p>
                ) : null}
                {error ? <p className="watchface-font-picker-status">{error}</p> : null}
                {query.trim() && !exactMatch ? (
                  <button
                    className="watchface-font-custom-option"
                    type="button"
                    onClick={() => setCandidate(query.trim())}
                  >
                    <Type size={15} aria-hidden="true" />
                    <span>
                      <strong>Use “{query.trim()}”</strong>
                      <small>Enter a family name that is not in the local list</small>
                    </span>
                    {candidate === query.trim() ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                ) : null}

                <div className="watchface-font-picker-results" role="listbox" aria-label="Installed font families">
                  {matchingFamilies.slice(0, FONT_PICKER_RESULT_LIMIT).map((family) => (
                    <button
                      key={family}
                      className={candidate === family ? "is-selected" : ""}
                      type="button"
                      role="option"
                      aria-selected={candidate === family}
                      onClick={() => setCandidate(family)}
                    >
                      <span className="watchface-font-picker-result-copy">
                        <strong style={{ fontFamily: family, ...pickerPreviewStyle }}>{family}</strong>
                        <span style={{ fontFamily: family, ...pickerPreviewStyle }}>Ag 0123456789</span>
                      </span>
                      <Check className="watchface-font-picker-result-check" size={15} aria-hidden="true" />
                    </button>
                  ))}
                  {!loading && matchingFamilies.length === 0 ? (
                    <div className="watchface-font-picker-empty">
                      <Type size={18} aria-hidden="true" />
                      <strong>No matching fonts</strong>
                      <span>Try another name or use the custom family above.</span>
                    </div>
                  ) : null}
                </div>
                {matchingFamilies.length > FONT_PICKER_RESULT_LIMIT ? (
                  <p className="watchface-font-picker-status">Keep typing to narrow the list.</p>
                ) : null}
              </div>

              <div className="watchface-font-picker-actions" role="group" aria-label="Font actions">
                <button className="secondary-button" type="button" onClick={restoreTemplate}>
                  {emptyLabel}
                </button>
                <button className="primary-button" type="button" disabled={!candidate.trim()} onClick={applyCandidate}>
                  Rasterize preview
                </button>
              </div>
            </div>
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
            Sprite spacing <span>{Math.round(letterSpacing * 100)}%</span>
            <input
              type="range"
              min="-0.35"
              max="0.25"
              step="0.01"
              value={letterSpacing}
              disabled={spriteSpacingDisabled}
              onChange={(event) => updateTypography({ letterSpacing: Number(event.target.value) })}
            />
          </label>
        </div>
      ) : null}
      {typography && !value && !rasterFontIsActive ? (
        <p className="watchface-typography-hint">
          <Info size={13} aria-hidden="true" />
          Font shape inherited from template
        </p>
      ) : null}
      {typography && rasterFontIsActive ? (
        <p className="watchface-typography-hint">
          The PNG atlas keeps its supplied glyph shapes; sprite spacing still applies.
        </p>
      ) : null}

    </div>
  );
}
