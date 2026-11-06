import { t, useLanguage } from "../i18n/watchfaces";
import { useWatchfaceStudioSimple } from "./watchfaceStudioMode";
import { ArrowUpRight, Check, ChevronDown, Globe, Images, Info, Loader2, Monitor, Search, TriangleAlert, Type, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CorosWatchfaceRasterFont } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  WATCHFACE_FONT_DOWNLOAD_URL,
  hasWatchfaceFontSnapshot,
  isWatchfaceFontInstalled
} from "./watchfaceFontSnapshots";
import {
  WATCHFACE_GOOGLE_FONTS,
  WATCHFACE_GOOGLE_FONT_CATEGORIES,
  WATCHFACE_GOOGLE_FONT_SAMPLE,
  isWatchfaceGoogleFont,
  loadWatchfaceGoogleFont,
  loadWatchfaceGoogleFontPreview,
  parseWatchfaceGoogleFontName,
  rememberedWatchfaceGoogleFonts,
  watchfaceGoogleFontPreviewFamily,
  type WatchfaceGoogleFontCategory
} from "./watchfaceGoogleFonts";
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
  /** The glyphs this choice draws with, shown directly under the picker. */
  preview?: ReactNode;
  /**
   * The font drawn while none is picked here, such as the layer's. Weight and
   * style stay editable then, instead of following template artwork.
   */
  inheritedFamily?: string;
  /** False hides Sprite spacing, for single-glyph sprites. */
  showSpacing?: boolean;
  /**
   * The PNG set controls for this layer (Official, folder, sheet, files and
   * which layers use them). Shown as the sheet's PNG set source, so every way
   * to change the digits lives in one place.
   */
  pngPanel?: ReactNode;
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
  disabled = false,
  preview,
  inheritedFamily,
  showSpacing = true,
  pngPanel
}: LocalFontPickerProps) {
  useLanguage();
  const simple = useWatchfaceStudioSimple();
  const [open, setOpen] = useState(false);
  const [families, setFamilies] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState(value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"google" | "local" | "png">("google");
  const [googleCategory, setGoogleCategory] = useState<WatchfaceGoogleFontCategory | "All">("All");
  const [applying, setApplying] = useState(false);
  const [, setPreviewsReady] = useState(0);
  const [popoverPosition, setPopoverPosition] =
    useState<FontPickerPopoverPosition | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const missingFontHintId = useId();

  const matchingFamilies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return families ?? [];
    }
    return (families ?? []).filter((family) =>
      family.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [families, query]);
  // "roboto bold", or a face's own "RobotoBold": Google's Roboto at 700.
  const nameMatch = useMemo(() => {
    const typed = query.trim() ? parseWatchfaceGoogleFontName(query) : null;
    if (typed) return typed;
    const current = !query.trim() && value ? parseWatchfaceGoogleFontName(value) : null;
    return current && current.family.toLocaleLowerCase() !== value.trim().toLocaleLowerCase() ? current : null;
  }, [query, value]);
  const googleFamilies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const catalog = WATCHFACE_GOOGLE_FONTS.filter((font) => googleCategory === "All" || font.category === googleCategory)
      .map((font) => font.family);
    // Fonts loaded by name earlier come first, so they are easy to reuse.
    const recent = googleCategory === "All"
      ? rememberedWatchfaceGoogleFonts().filter((family) => !catalog.some((item) => item.toLocaleLowerCase() === family.toLocaleLowerCase()))
      : [];
    const found = [...recent, ...catalog].filter((family) => !normalizedQuery || family.toLocaleLowerCase().includes(normalizedQuery));
    return nameMatch ? [nameMatch.family, ...found.filter((family) => family !== nameMatch.family)] : found;
    // `open` refreshes the remembered list each time the picker opens.
  }, [googleCategory, query, open, nameMatch]);
  const shownFamilies = source === "google" ? googleFamilies : matchingFamilies;
  const exactMatch = Boolean(source === "google" && nameMatch) || shownFamilies.some(
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
  const drawnFamily = value || inheritedFamily;
  // Simple mode keeps PNG digit sets out of the way, as before.
  const hasPngSource = Boolean(pngPanel) && !simple;
  const fontShapeControlsDisabled =
    disabled || (!drawnFamily && !rasterFontIsActive) || rasterFontIsActive;
  const fontIsMissing = !rasterFontIsActive && !isWatchfaceFontInstalled(value);
  // The project's saved glyphs still draw it: a warning, not an error.
  const fontIsEmbedded = fontIsMissing && hasWatchfaceFontSnapshot(value);
  const spriteSpacingDisabled =
    disabled ||
    (!onLetterSpacingChange && !drawnFamily && !rasterFontIsActive);
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
      // The typography prop contains inherited effective values. Forward only
      // the changed field so editing weight does not pin style (or vice versa).
      const { letterSpacing: _componentSpacing, ...componentPatch } = patch;
      onTypographyChange?.(componentPatch);
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
    setError(null);
    // Open on the source the current font comes from.
    const nextSource = hasPngSource && rasterFontIsActive ? "png" : value && !isWatchfaceGoogleFont(value) ? "local" : "google";
    setSource(nextSource);
    setOpen(true);
    if (nextSource === "local") await loadLocalFamilies();
  }

  async function loadLocalFamilies() {
    if (families !== null || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextFamilies = await api.listLocalFontFamilies();
      setFamilies(nextFamilies);
      if (nextFamilies.length === 0) {
        setError(t("No installed font families were found. You can still enter a family name below."));
      }
    } catch {
      setFamilies([]);
      setError(t("Could not scan installed fonts. You can still enter a family name below."));
    } finally {
      setLoading(false);
    }
  }

  function closePicker() {
    setOpen(false);
    setPopoverPosition(null);
    setQuery("");
  }

  async function applyCandidate() {
    if (!candidate.trim() || applying) {
      return;
    }
    if (source === "google" || isWatchfaceGoogleFont(candidate)) {
      setApplying(true);
      setError(null);
      const ok = await loadWatchfaceGoogleFont(candidate.trim());
      setApplying(false);
      if (!ok && source === "google") {
        setError(t("Couldn’t load “{{family}}” from Google Fonts. Check the name and your connection.", { family: candidate.trim() }));
        return;
      }
    }
    onChange(candidate.trim());
    // A weight read from the name ("Roboto Bold") comes along with the family.
    if (source === "google" && nameMatch && candidate.trim() === nameMatch.family) {
      updateTypography({ fontWeight: nameMatch.weight, ...(nameMatch.italic ? { fontStyle: "italic" as const } : {}) });
    }
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
      // The PNG set source opens its own dialogs (the official browser); using
      // them must not close the sheet that owns them.
      if (target instanceof Element && target.closest(".wf-modal")) return;
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

  // Google rows preview with a tiny download of just their sample glyphs.
  useEffect(() => {
    if (!open || source !== "google") return;
    let cancelled = false;
    void Promise.all(googleFamilies.slice(0, FONT_PICKER_RESULT_LIMIT).map(async (family) => {
      await loadWatchfaceGoogleFontPreview(family, nameMatch?.family === family ? nameMatch.weight : undefined);
      if (!cancelled) setPreviewsReady((count) => count + 1);
    }));
    return () => { cancelled = true; };
  }, [googleFamilies, open, source, nameMatch]);

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
  }, [families, loading, open, query, source, googleCategory]);

  return (
    <div ref={pickerRef} className="field watchface-font-picker">
      <span className="watchface-font-picker-label">{t(label)}</span>
      <div className="watchface-font-picker-menu">
        <button
          ref={triggerRef}
          className={`watchface-font-picker-trigger${fontIsMissing ? " is-missing" : ""}${fontIsEmbedded ? " is-embedded" : ""}`}
          type="button"
          aria-expanded={open}
          aria-describedby={fontIsMissing ? missingFontHintId : undefined}
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
            style={value && !fontIsMissing ? { fontFamily: value, ...pickerPreviewStyle } : undefined}
          >
            {rasterFontIsActive && rasterFont ? rasterFont.label + t(" (PNG)") : value || t(emptyLabel)}
          </span>
          {fontIsMissing ? (
            <span className={`watchface-font-missing-badge${fontIsEmbedded ? " is-embedded" : ""}`}>
              <TriangleAlert size={12} aria-hidden="true" />{fontIsEmbedded ? t("NOT INSTALLED") : t("MISSING FONT")}</span>
          ) : null}
          <ChevronDown size={15} aria-hidden="true" />
        </button>

        {open && typeof document !== "undefined"
          ? createPortal(
          <div
            ref={panelRef}
            className="watchface-font-picker-panel wf-font-picker-panel"
            role="dialog"
            aria-label={t("{{label}} picker", { label: t(label) })}
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
                <strong>{hasPngSource ? t("Change digits") : t("Choose font")}</strong>
                <span>{source === "google" ? t("Free from Google Fonts · drawn into the face on export") : source === "png" ? t("Your own pictures for each digit") : t("Installed on this computer")}</span>
              </div>
              <button
                className="watchface-font-picker-close"
                type="button"
                aria-label={t("Close font picker")}
                onClick={() => {
                  closePicker();
                  triggerRef.current?.focus();
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="watchface-font-picker-browser">
              <div className="wf-font-source" role="tablist" aria-label={t("Font source")}>
                <button type="button" role="tab" aria-selected={source === "google"} onClick={() => { setSource("google"); setError(null); }}>
                  <Globe size={14} aria-hidden="true" />{t("Google Fonts")}
                </button>
                <button type="button" role="tab" aria-selected={source === "local"} onClick={() => { setSource("local"); setError(null); void loadLocalFamilies(); }}>
                  <Monitor size={14} aria-hidden="true" />{t("This computer")}
                </button>
                {hasPngSource ? <button type="button" role="tab" aria-selected={source === "png"} onClick={() => { setSource("png"); setError(null); }}>
                  <Images size={14} aria-hidden="true" />{t("PNG set")}
                </button> : null}
              </div>
              {source === "png" ? <div className="wf-font-png-source watchface-shell">{pngPanel}</div> : <>
              <div className="watchface-font-picker-search-overlay">
                <div className="watchface-font-picker-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("Search fonts")}
                    aria-label={source === "google" ? t("Search Google Fonts") : t("Search installed fonts")}
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label={t("Clear font search")}
                      onClick={() => setQuery("")}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                {source === "google" ? (
                  <div className="wf-font-categories" role="group" aria-label={t("Font styles")}>
                    {(["All", ...WATCHFACE_GOOGLE_FONT_CATEGORIES] as const).map((category) => (
                      <button key={category} type="button" aria-pressed={googleCategory === category} onClick={() => setGoogleCategory(category)}>
                        {t(category)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="watchface-font-picker-meta">
                    <span>{query.trim() ? t("Search results") : t("Local fonts")}</span>
                    {!loading && families !== null ? (
                      <span>
                        {Math.min(matchingFamilies.length, FONT_PICKER_RESULT_LIMIT)}{" "}{t("of")}{" "}
                        {matchingFamilies.length}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="watchface-font-picker-browser-scroll">
                {loading && source === "local" ? (
                  <p className="watchface-font-picker-status">
                    <Loader2 className="spin" size={14} />{" "}{t("Loading your local font library…")}</p>
                ) : null}
                {error ? <p className="watchface-font-picker-status">{t(error)}</p> : null}
                {query.trim() && !exactMatch ? (
                  <button
                    className="watchface-font-custom-option"
                    type="button"
                    onClick={() => setCandidate(query.trim())}
                  >
                    <Type size={15} aria-hidden="true" />
                    <span>
                      <strong>{source === "google" ? t("Load “{{family}}” from Google Fonts", { family: query.trim() }) : <>{t("Use “")}{query.trim()}”</>}</strong>
                      <small>{source === "google" ? t("Any family on fonts.google.com, spelled as it is there") : t("Enter a family name that is not in the local list")}</small>
                    </span>
                    {candidate === query.trim() ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                ) : null}

                <div className={`watchface-font-picker-results${source === "google" ? " wf-font-results-google" : ""}`} role="listbox" aria-label={source === "google" ? t("Google Fonts families") : t("Installed font families")}>
                  {shownFamilies.slice(0, FONT_PICKER_RESULT_LIMIT).map((family) => {
                    const previewFamily = source === "google" ? `"${watchfaceGoogleFontPreviewFamily(family)}", "${family}", sans-serif` : family;
                    const category = WATCHFACE_GOOGLE_FONTS.find((font) => font.family === family)?.category;
                    return (
                    <button
                      key={family}
                      className={candidate === family ? "is-selected" : ""}
                      type="button"
                      role="option"
                      aria-selected={candidate === family}
                      onClick={() => setCandidate(family)}
                    >
                      <span className="watchface-font-picker-result-copy">
                        <span className="wf-font-result-name">{family}{source === "google" ? <small>{nameMatch?.family === family
                          ? t("Weight {{value}}", { value: nameMatch.weight }) + (nameMatch.italic ? ` · ${t("Italic")}` : "")
                          : category ? t(category) : t("Loaded by name")}</small> : null}</span>
                        <span className="wf-font-result-sample" style={{ fontFamily: previewFamily, ...pickerPreviewStyle, ...(source === "google" && nameMatch?.family === family ? { fontWeight: nameMatch.weight, fontStyle: nameMatch.italic ? "italic" : undefined } : {}) }}>{source === "google" ? WATCHFACE_GOOGLE_FONT_SAMPLE : t("Ag 0123456789")}</span>
                      </span>
                      <Check className="watchface-font-picker-result-check" size={15} aria-hidden="true" />
                    </button>
                    );
                  })}
                  {!(loading && source === "local") && shownFamilies.length === 0 ? (
                    <div className="watchface-font-picker-empty">
                      <Type size={18} aria-hidden="true" />
                      <strong>{t("No matching fonts")}</strong>
                      <span>{t("Try another name or use the custom family above.")}</span>
                    </div>
                  ) : null}
                </div>
                {shownFamilies.length > FONT_PICKER_RESULT_LIMIT ? (
                  <p className="watchface-font-picker-status">{t("Keep typing to narrow the list.")}</p>
                ) : null}
              </div>

              </>}
              <div className="watchface-font-picker-actions" role="group" aria-label={t("Font actions")} hidden={source === "png"}>
                <button className="secondary-button" type="button" onClick={restoreTemplate}>
                  {t(emptyLabel)}
                </button>
                <button className="primary-button" type="button" disabled={!candidate.trim() || applying} onClick={() => void applyCandidate()}>{applying ? <><Loader2 className="spin" size={14} aria-hidden="true" />{t("Loading font…")}</> : t("Use this font")}</button>
              </div>
            </div>
          </div>,
          document.body
        )
          : null}
      </div>

      {fontIsMissing ? (
        <p id={missingFontHintId} className={`watchface-font-missing-hint${fontIsEmbedded ? " is-embedded" : ""}`} role="status">
          {fontIsEmbedded
            ? t("“{{family}}” is embedded in this face, so it should look right. Install it to change text with it.", { family: value })
            : t("“{{family}}” isn’t installed. Install it or choose another font.", { family: value })}{" "}
          <a href={WATCHFACE_FONT_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
            {t("Find fonts on dafont.com")}<ArrowUpRight size={11} aria-hidden="true" />
          </a>
        </p>
      ) : null}
      {preview}

      {typography && onTypographyChange ? (
        <div className="watchface-typography-controls">
          {rasterFontIsActive ? null : (
            <FontShapeControls
              fontWeight={fontWeight}
              fontStyle={fontStyle}
              disabled={fontShapeControlsDisabled}
              onChange={updateTypography}
            />
          )}
          {showSpacing ? <label className="watchface-typography-tracking">{t("Spacing")}{" "}<span>{Math.round(letterSpacing * 100)}%</span>
            <input
              type="range"
              min="-0.35"
              max="0.25"
              step="0.01"
              value={letterSpacing}
              disabled={spriteSpacingDisabled}
              onChange={(event) => updateTypography({ letterSpacing: Number(event.target.value) })}
            />
          </label> : null}
        </div>
      ) : null}
      {typography && !drawnFamily && !rasterFontIsActive ? (
        <p className="watchface-typography-hint">
          <Info size={13} aria-hidden="true" />{t("Font shape inherited from template")}</p>
      ) : null}
      {/* Fitting PNG digits into their cells is Advanced. */}
      {!simple && rasterFontIsActive && rasterFont && onRasterFontChange ? (
        <div className="watchface-typography-controls">
          {(["height", "baseline"] as const).map((key) => (
            <label key={key} className="watchface-typography-tracking">
              {key === "height" ? t("Glyph height") : t("Baseline")}
              <span>{Math.round((rasterFont.glyphLayout?.[key] ?? (key === "height" ? 0.94 : 0.97)) * 100)}%</span>
              <input type="range" min="0.1" max="1" step="0.01" disabled={disabled}
                value={rasterFont.glyphLayout?.[key] ?? (key === "height" ? 0.94 : 0.97)}
                onChange={(event) => onRasterFontChange({ ...rasterFont, glyphLayout: {
                  height: rasterFont.glyphLayout?.height ?? 0.94,
                  baseline: rasterFont.glyphLayout?.baseline ?? 0.97,
                  [key]: Number(event.target.value)
                } })} />
            </label>
          ))}
          {rasterFont.glyphLayout ? (
            <p className="watchface-typography-hint">
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => {
                  // Without a layout, PNGs at the cell size are copied as authored.
                  const { glyphLayout: _layout, ...automatic } = rasterFont;
                  onRasterFontChange(automatic);
                }}
              >{t("Reset fit")}</button>
            </p>
          ) : null}
        </div>
      ) : null}
      {!simple && typography && rasterFontIsActive ? (
        <p className="watchface-typography-hint">{t("Spacing changes transparent digit cells. Time spacing keeps the digits beside the colon anchored.")}</p>
      ) : null}

    </div>
  );
}

/** The Weight and Style menus, also used where a glyph inherits another layer's font. */
export function FontShapeControls({ fontWeight, fontStyle, disabled = false, onChange }: {
  fontWeight: number;
  fontStyle: "normal" | "italic";
  disabled?: boolean;
  onChange: (patch: { fontWeight?: number; fontStyle?: "normal" | "italic" }) => void;
}) {
  useLanguage();
  return (
    <>
      <label>{t("Weight")}<select
          value={fontWeight}
          disabled={disabled}
          onChange={(event) => onChange({ fontWeight: Number(event.target.value) })}
        >
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => (
            <option key={weight} value={weight}>
              {weight}{weight === 400 ? t(" · Regular") : weight === 700 ? t(" · Bold") : ""}
            </option>
          ))}
        </select>
      </label>
      <label>{t("Style")}<select
          value={fontStyle}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              fontStyle: event.target.value as "normal" | "italic"
            })
          }
        >
          <option value="normal">{t("Normal")}</option>
          <option value="italic">{t("Italic")}</option>
        </select>
      </label>
    </>
  );
}
