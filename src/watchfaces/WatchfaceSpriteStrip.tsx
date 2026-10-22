import { t, useLanguage, getLocale } from "../i18n/watchfaces";
import { Loader2 } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import {
  fillWatchfaceText,
  hasWatchfaceFontSnapshot,
  isSyntheticWatchfaceWeight,
  isWatchfaceFontInstalled,
  measureWatchfaceText,
  setWatchfaceCanvasFont
} from "./watchfaceFontSnapshots";
import type {
  CorosWatchfaceRasterFont,
  CorosWatchfaceTemplateAsset
} from "../../electron/types";
import {
  rasterFontPreviewCells,
  type WatchfaceTemplateGlyph
} from "./watchfaceSpritePreview";
import {
  normalizeRasterFontGlyphs,
  rasterFontSupportsText,
  type WatchfaceTypography
} from "./watchfaceStudio";

export interface WatchfaceSpriteStripCell {
  key: string;
  /** Shown under the sprite: the digit, label, or state number it stands for. */
  label: string;
  /** A whole PNG. */
  src?: string;
  /** A cell cropped out of a sprite-sheet atlas. */
  atlasStyle?: Record<string, string>;
  /** Dashed placeholder: the set does not provide this glyph yet. */
  missing?: boolean;
  /** An imported PNG stands in for the template's sprite. */
  replaced?: boolean;
  title?: string;
}

interface WatchfaceSpriteStripProps {
  cells: WatchfaceSpriteStripCell[];
  /** One line under the strip: where the sprites come from and their size. */
  summary?: string;
  label: string;
  loading?: boolean;
  /** Shown instead of the strip when there is nothing to draw. */
  emptyText?: string;
  className?: string;
}

/**
 * The sprites a layer actually draws with, one cell each, so an imported PNG
 * set, a template font, or a state folder can be checked without exporting.
 */
export function WatchfaceSpriteStrip({
  cells,
  summary,
  label,
  loading = false,
  emptyText,
  className
}: WatchfaceSpriteStripProps) {
  useLanguage();
  if (cells.length === 0 && !loading) {
    return emptyText ? (
      <p className="wf-sprite-strip-empty">{t(emptyText)}</p>
    ) : null;
  }
  return (
    <div
      className={`wf-sprite-preview${className ? ` ${className}` : ""}`}
      aria-label={t(label)}
      aria-busy={loading}
    >
      <div className="wf-sprite-strip">
        {loading && cells.length === 0 ? (
          <span className="wf-sprite-strip-loading">
            <Loader2 className="spin" size={14} aria-hidden="true" />{" "}{t("Reading sprites")}</span>
        ) : null}
        {cells.map((cell) => (
          <span
            className={[
              "wf-sprite-cell",
              cell.missing ? "is-missing" : "",
              cell.replaced ? "is-replaced" : ""
            ].filter(Boolean).join(" ")}
            key={cell.key}
            title={
              cell.title ??
              (cell.missing
                ? t("No PNG for {{value1}} yet", { value1: t(cell.label) })
                : cell.replaced
                  ? t("{{value1}} · imported", { value1: t(cell.label) })
                  : cell.label)
            }
          >
            {cell.src ? (
              <img src={cell.src} alt="" draggable={false} />
            ) : cell.atlasStyle ? (
              <i style={cell.atlasStyle as CSSProperties} aria-hidden="true" />
            ) : (
              <i className="wf-sprite-cell-empty" aria-hidden="true" />
            )}
            <small>{t(cell.label)}</small>
          </span>
        ))}
      </div>
      {summary ? <span className="wf-sprite-strip-summary" title={t(summary)}>{t(summary)}</span> : null}
    </div>
  );
}

export type WatchfaceTemplateAssetLoader = (
  paths: string[]
) => Promise<CorosWatchfaceTemplateAsset[]>;

/** Decodes template PNGs on demand; the editor's loader caches per archive. */
export function useTemplateSprites(
  loadAssets: WatchfaceTemplateAssetLoader | undefined,
  paths: string[]
): { sprites: Map<string, string>; loading: boolean } {
  const pathKey = paths.join("\n");
  const [state, setState] = useState<{
    key: string;
    sprites: Map<string, string>;
  }>({ key: "", sprites: new Map() });
  useEffect(() => {
    if (!loadAssets || !pathKey) return;
    let cancelled = false;
    void loadAssets(pathKey.split("\n"))
      .then((assets) => {
        if (cancelled) return;
        setState({
          key: pathKey,
          sprites: new Map(assets.map((asset) => [asset.path, asset.dataUrl]))
        });
      })
      .catch(() => {
        // Missing optional sprites leave dashed placeholders in the strip.
        if (!cancelled) setState({ key: pathKey, sprites: new Map() });
      });
    return () => {
      cancelled = true;
    };
  }, [loadAssets, pathKey]);
  const current = state.key === pathKey;
  return {
    sprites: current ? state.sprites : new Map(),
    loading: Boolean(loadAssets) && Boolean(pathKey) && !current
  };
}

interface TemplateSpriteStripProps {
  glyphs: WatchfaceTemplateGlyph[];
  /** Optional display text, while replacement keys retain their original labels. */
  displayLabels?: Record<string, string>;
  loadAssets: WatchfaceTemplateAssetLoader;
  /** Imported PNGs keyed by glyph label; they replace the template cell. */
  replacements?: Record<string, string | undefined>;
  /** Imported states the template folder has no cell for, appended after it. */
  extraCells?: WatchfaceSpriteStripCell[];
  summary?: string;
  label: string;
  emptyText?: string;
}

/** A template sprite folder, with any imported state drawn in its place. */
export function TemplateSpriteStrip({
  glyphs,
  displayLabels,
  loadAssets,
  replacements,
  extraCells = [],
  summary,
  label,
  emptyText
}: TemplateSpriteStripProps) {
  useLanguage();
  const { sprites, loading } = useTemplateSprites(
    loadAssets,
    glyphs.filter((glyph) => !replacements?.[glyph.label]).map((glyph) => glyph.path)
  );
  return (
    <WatchfaceSpriteStrip
      label={t(label)}
      loading={loading}
      summary={summary}
      emptyText={emptyText ? t(emptyText) : undefined}
      cells={[
        ...glyphs.map((glyph) => {
          const replacement = replacements?.[glyph.label];
          const src = replacement ?? sprites.get(glyph.path);
          return {
            key: glyph.path,
            label: displayLabels?.[glyph.label] ?? glyph.label,
            src,
            replaced: Boolean(replacement),
            missing: !src && !loading
          };
        }),
        ...extraCells
      ]}
    />
  );
}

export function describeTemplateGlyphSet(
  folder: string,
  glyphs: WatchfaceTemplateGlyph[]
): string {
  const widths = glyphs.map((glyph) => glyph.width);
  const heights = glyphs.map((glyph) => glyph.height);
  const size = glyphs.length > 0
    ? `${Math.max(...widths)} × ${Math.max(...heights)} px`
    : null;
  return [
    t("Template · {{folder}}", { folder }),
    t("{{value1}} sprite{{value2}}", { value1: glyphs.length, value2: glyphs.length === 1 ? "" : "s" }),
    size
  ].filter(Boolean).join(" · ");
}

export function describeRasterFontSource(font: CorosWatchfaceRasterFont): string {
  const spriteCount = Object.keys(font.sprites ?? {}).length;
  const labelCount = Object.keys(font.labels ?? {}).length;
  const glyphCount = normalizeRasterFontGlyphs(font.glyphs).length;
  const parts: string[] = [];
  if (glyphCount > 0 && font.dataUrl) {
    parts.push(
      t("Sheet · {{glyphCount}} glyphs in {{columns}} columns", { glyphCount, columns: font.columns }) +
        (font.atlasSize ? ` · ${font.atlasSize.width} × ${font.atlasSize.height} px` : "")
    );
  }
  if (spriteCount > 0) parts.push(t("{{spriteCount}} individual PNG{{value2}}", { spriteCount: spriteCount, value2: spriteCount === 1 ? "" : "s" }));
  if (labelCount > 0) parts.push(t("{{labelCount}} label{{value2}}", { labelCount: labelCount, value2: labelCount === 1 ? "" : "s" }));
  return parts.join(" · ") || t("PNG set");
}

/** Cells for an imported PNG set, dashed where a digit is still missing. */
export function rasterFontStripCells(
  font: CorosWatchfaceRasterFont
): WatchfaceSpriteStripCell[] {
  return rasterFontPreviewCells(font).map((cell) =>
    cell.kind === "sprite"
      ? { key: cell.key, label: cell.key, src: cell.src }
      : cell.kind === "atlas"
        ? { key: cell.key, label: cell.key, atlasStyle: cell.style }
        : { key: cell.key, label: cell.key, missing: true }
  );
}

interface WatchfaceFontPreviewProps {
  /** Local font family chosen for rasterization, when any. */
  fontFamily: string;
  typography?: WatchfaceTypography;
  rasterFont?: CorosWatchfaceRasterFont;
  /** Text the PNG set must contain before it counts as this layer's font. */
  rasterFontRequiredText?: string;
  /** The template sprites drawn when nothing replaces them. */
  templateGlyphs?: { folder: string; glyphs: WatchfaceTemplateGlyph[] } | null;
  loadAssets?: WatchfaceTemplateAssetLoader;
  /** What the local-font sample spells; digits by default. */
  sampleText?: string;
}

/**
 * Shows the glyphs a text layer really draws with: the imported PNG set, the
 * template's sprite folder, or a sample of the local font that export will
 * rasterize.
 */
/** Matches `.wf-sprite-strip--sample`: 26 px type, 1.15 line height, 0.04 em tracking. */
const SAMPLE_FONT_SIZE = 26;

/**
 * The sample as Studio draws it on the watch. CSS text cannot show a weight
 * the family has no face for, nor a family that only exists as glyphs embedded
 * in the project, so the canvas draws it and the page paints that ink in the
 * theme's text color.
 */
function CanvasFontSample({ fontFamily, fontWeight, fontStyle, text }: {
  fontFamily: string;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  text: string;
}) {
  const [ink, setInk] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    const density = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
    const size = SAMPLE_FONT_SIZE * density;
    const height = Math.round(SAMPLE_FONT_SIZE * 1.15);
    const face = { family: fontFamily, size, weight: fontWeight, style: fontStyle };
    const font = `${fontStyle} ${fontWeight} ${size}px "${fontFamily.replace(/["\\]/g, "")}"`;
    const prepare = (context: CanvasRenderingContext2D) => {
      setWatchfaceCanvasFont(context, face, font);
      if ("letterSpacing" in context) context.letterSpacing = `${size * 0.04}px`;
      context.textBaseline = "alphabetic";
    };
    const canvas = document.createElement("canvas");
    let context = canvas.getContext("2d");
    if (!context) return;
    prepare(context);
    const metrics = measureWatchfaceText(context, text);
    const left = Math.max(0, metrics.actualBoundingBoxLeft);
    canvas.width = Math.max(1, Math.ceil(left + Math.max(metrics.width, metrics.actualBoundingBoxRight)) + 2);
    canvas.height = height * density;
    // Resizing resets the context, font included.
    context = canvas.getContext("2d")!;
    prepare(context);
    context.fillStyle = "#ffffff";
    const ascent = metrics.fontBoundingBoxAscent || size * 0.8;
    const descent = metrics.fontBoundingBoxDescent || size * 0.2;
    fillWatchfaceText(context, text, left + 1, (canvas.height - ascent - descent) / 2 + ascent);
    setInk({ url: canvas.toDataURL("image/png"), width: canvas.width / density, height });
  }, [fontFamily, fontWeight, fontStyle, text]);
  if (!ink) return <>{text}</>;
  const mask = `url("${ink.url}")`;
  return (
    <span
      className="wf-sprite-strip-sample-ink"
      role="img"
      aria-label={text}
      style={{ width: ink.width, height: ink.height, maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}

export function WatchfaceFontPreview({
  fontFamily,
  typography,
  rasterFont,
  rasterFontRequiredText,
  templateGlyphs,
  loadAssets,
  sampleText = "0123456789"
}: WatchfaceFontPreviewProps) {
  useLanguage();
  const rasterActive = Boolean(
    rasterFont &&
      (!rasterFontRequiredText ||
        rasterFontSupportsText(rasterFont, rasterFontRequiredText))
  );
  if (rasterActive && rasterFont) {
    return (
      <WatchfaceSpriteStrip
        label={t("PNG set glyphs")}
        cells={rasterFontStripCells(rasterFont)}
        summary={`${rasterFont.label} · ${describeRasterFontSource(rasterFont)}`}
      />
    );
  }
  if (fontFamily) {
    const installed = isWatchfaceFontInstalled(fontFamily);
    const embedded = !installed && hasWatchfaceFontSnapshot(fontFamily);
    const summary = installed
      ? t("{{fontFamily}} · rasterized to PNG digits on export", { fontFamily })
      : embedded
        ? t("{{fontFamily}} isn’t installed · sample drawn from the embedded glyphs", { fontFamily })
        : t("{{fontFamily}} is missing · sample shown in a substitute font", { fontFamily: fontFamily });
    const fontWeight = typography?.fontWeight ?? 400;
    const fontStyle = typography?.fontStyle === "italic" ? "italic" : "normal";
    const synthetic = installed &&
      isSyntheticWatchfaceWeight({ family: fontFamily, weight: fontWeight, style: fontStyle });
    return (
      <div className="wf-sprite-preview wf-sprite-preview--font" aria-label={t("Font sample")}>
        <div className="wf-sprite-strip wf-sprite-strip--sample" style={{ fontFamily, fontWeight, fontStyle }}>
          {synthetic || embedded
            ? <CanvasFontSample fontFamily={fontFamily} fontWeight={fontWeight} fontStyle={fontStyle} text={sampleText} />
            : sampleText}
        </div>
        <span className="wf-sprite-strip-summary" title={t(summary)}>
          {t(summary)}
        </span>
      </div>
    );
  }
  if (templateGlyphs && loadAssets && templateGlyphs.glyphs.length > 0) {
    return (
      <TemplateSpriteStrip
        label={t("Template glyphs")}
        glyphs={templateGlyphs.glyphs}
        loadAssets={loadAssets}
        summary={describeTemplateGlyphSet(templateGlyphs.folder, templateGlyphs.glyphs)}
      />
    );
  }
  return null;
}
