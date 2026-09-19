import { Loader2 } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
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
  if (cells.length === 0 && !loading) {
    return emptyText ? (
      <p className="wf-sprite-strip-empty">{emptyText}</p>
    ) : null;
  }
  return (
    <div
      className={`wf-sprite-preview${className ? ` ${className}` : ""}`}
      aria-label={label}
      aria-busy={loading}
    >
      <div className="wf-sprite-strip">
        {loading && cells.length === 0 ? (
          <span className="wf-sprite-strip-loading">
            <Loader2 className="spin" size={14} aria-hidden="true" /> Reading sprites
          </span>
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
                ? `No PNG for ${cell.label} yet`
                : cell.replaced
                  ? `${cell.label} · imported`
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
            <small>{cell.label}</small>
          </span>
        ))}
      </div>
      {summary ? <span className="wf-sprite-strip-summary" title={summary}>{summary}</span> : null}
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
  loadAssets,
  replacements,
  extraCells = [],
  summary,
  label,
  emptyText
}: TemplateSpriteStripProps) {
  const { sprites, loading } = useTemplateSprites(
    loadAssets,
    glyphs.filter((glyph) => !replacements?.[glyph.label]).map((glyph) => glyph.path)
  );
  return (
    <WatchfaceSpriteStrip
      label={label}
      loading={loading}
      summary={summary}
      emptyText={emptyText}
      cells={[
        ...glyphs.map((glyph) => {
          const replacement = replacements?.[glyph.label];
          const src = replacement ?? sprites.get(glyph.path);
          return {
            key: glyph.path,
            label: glyph.label,
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
    `Template · ${folder}`,
    `${glyphs.length} sprite${glyphs.length === 1 ? "" : "s"}`,
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
      `Sheet · ${glyphCount} glyph${glyphCount === 1 ? "" : "s"} in ${font.columns} column${font.columns === 1 ? "" : "s"}` +
        (font.atlasSize ? ` · ${font.atlasSize.width} × ${font.atlasSize.height} px` : "")
    );
  }
  if (spriteCount > 0) parts.push(`${spriteCount} individual PNG${spriteCount === 1 ? "" : "s"}`);
  if (labelCount > 0) parts.push(`${labelCount} label${labelCount === 1 ? "" : "s"}`);
  return parts.join(" · ") || "PNG set";
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
export function WatchfaceFontPreview({
  fontFamily,
  typography,
  rasterFont,
  rasterFontRequiredText,
  templateGlyphs,
  loadAssets,
  sampleText = "0123456789"
}: WatchfaceFontPreviewProps) {
  const rasterActive = Boolean(
    rasterFont &&
      (!rasterFontRequiredText ||
        rasterFontSupportsText(rasterFont, rasterFontRequiredText))
  );
  if (rasterActive && rasterFont) {
    return (
      <WatchfaceSpriteStrip
        label="PNG set glyphs"
        cells={rasterFontStripCells(rasterFont)}
        summary={`${rasterFont.label} · ${describeRasterFontSource(rasterFont)}`}
      />
    );
  }
  if (fontFamily) {
    return (
      <div className="wf-sprite-preview wf-sprite-preview--font" aria-label="Font sample">
        <div
          className="wf-sprite-strip wf-sprite-strip--sample"
          style={{
            fontFamily,
            fontWeight: typography?.fontWeight ?? 400,
            fontStyle: typography?.fontStyle ?? "normal"
          }}
        >
          {sampleText}
        </div>
        <span className="wf-sprite-strip-summary" title={`${fontFamily} · rasterized to PNG digits on export`}>
          {fontFamily} · rasterized to PNG digits on export
        </span>
      </div>
    );
  }
  if (templateGlyphs && loadAssets && templateGlyphs.glyphs.length > 0) {
    return (
      <TemplateSpriteStrip
        label="Template glyphs"
        glyphs={templateGlyphs.glyphs}
        loadAssets={loadAssets}
        summary={describeTemplateGlyphSet(templateGlyphs.folder, templateGlyphs.glyphs)}
      />
    );
  }
  return null;
}
