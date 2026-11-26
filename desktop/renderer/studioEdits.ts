// The inspector's edits on the real face model, one per control the design's "Studio inspector by layer type" boards
// show. Each reads or writes the design field CorosLink's editor uses for that layer (its setTimeStyle, setMetricStyle,
// setDateStyle, updateAmPmIndicator, updateConfigAsset, the stroke and shadow stacks, the progress arcs and bars), so a
// face edited here and one edited in CorosLink are the same file. Pure functions over the design; no screen state.
import type {
  CorosWatchfaceArtwork, CorosWatchfaceBackgroundElement, CorosWatchfaceDesignSprite, CorosWatchfaceExerciseProgressStyle,
  CorosWatchfaceKcalProgressStyle, CorosWatchfaceNativeDataStyle, CorosWatchfaceNativePart, CorosWatchfaceNativePartStyle,
  CorosWatchfacePercentStyle as WatchfacePercentStyle, CorosWatchfaceRasterFont, CorosWatchfaceResolutionDetails, CorosWatchfaceShadowEffect, CorosWatchfaceStroke,
} from "../watchface/types";
import {
  dateFontSize, dateMonthShowsLabels, dateSpriteCanvasSize, dateSizeForFontSize, exerciseProgressStyleForResolution, fixedMetricCurrentFontSize,
  kcalProgressStyleForResolution, resolveWatchfaceComponentTypography, shouldRenderWatchfaceText, styleFontSize,
  watchfaceFixedMetricDigitSize, watchfaceTimeDigitSize, type WatchfaceDatePartId, type WatchfaceTimePartId,
} from "../watchface/engine/watchfaceStudio";
import { createWatchfaceStroke, resolveWatchfaceLayerStrokes } from "../watchface/engine/watchfaceEditorStrokes";
import { createWatchfaceShadowEffect, resolveWatchfaceLayerEffects } from "../watchface/engine/watchfaceEditorEffects";
import { nativeComponentFontSize, nativeFontSizePart, nativePart, nativeParts, nativeScaleForFontSize, withNativeFont } from "../watchface/engine/nativeDataParts";
import { clampAnimationDelay } from "../watchface/engine/watchfaceAnimation";
import type { Design, EditorLayer } from "./studioFace";

// ───── Which kind of panel a layer gets ─────

/** The panel a layer opens, after the design's boards (one board per kind). */
export type PanelKind =
  | "time" | "metric" | "date" | "selectable" | "ampm" | "separator" | "native" | "weather" | "batteryIcon" | "image"
  | "animation" | "sprite" | "shape" | "text" | "background" | "chart" | "other";

export function panelOf(layer: EditorLayer, design: Design): PanelKind {
  if (layer.kind === "background") return "background";
  if (layer.timePartId) return "time";
  if (layer.nativeDataId) return layer.nativeDataId === "chart" ? "chart" : "native";
  if (layer.metricId) return "metric";
  if (layer.kind === "date" || layer.kind === "weekday") return "date";
  if (layer.kind === "complication") return "selectable";
  if (layer.ampmIndicator) return "ampm";
  if (layer.staticSeparatorId) return "separator";
  if (layer.weatherIndicator) return "weather";
  if (layer.kind === "batteryIcon" || layer.kind === "controlBatteryIcon") return "batteryIcon";
  if (layer.animation) return "animation";
  if (layer.spriteId) return "sprite";
  if (layer.backgroundElementId) {
    const element = elementOf(design, layer);
    return element?.kind === "text" ? "text" : "shape";
  }
  if (layer.configAssetId) return "image";
  return "other";
}

// ───── Typography (time, fixed data, date, selectable data, AM/PM, separators, live data) ─────

export interface Typo {
  color?: string; fontFamily?: string; fontWeight?: number; fontStyle?: "normal" | "italic"; letterSpacing?: number;
  rotation?: number; solidAlpha?: boolean; align?: "left" | "center" | "right"; fontSize?: number; scale?: number;
  rasterFont?: CorosWatchfaceRasterFont;
}

const DATE_IDS = new Set<string>(["weekday", "dateMonth", "dateDay"]);
/** How many pictures each date part has: weekdays, months, digits. */
const DATE_VALUES: Record<WatchfaceDatePartId, number> = { weekday: 7, dateMonth: 12, dateDay: 10 };

/** The layer's own type settings (what it overrides; the face's settings fill in the rest). */
export function typoOf(design: Design, layer: EditorLayer): Typo | null {
  switch (panelOf(layer, design)) {
    case "time": return design.timeStyles?.[layer.timePartId!] ?? { scale: 1 };
    case "metric": return design.metricStyles?.[layer.metricId!] ?? { scale: 1 };
    case "date": return design.dateStyles?.[layer.id] ?? { scale: 1 };
    case "selectable": return design.selectableMetricStyle ?? { scale: 1 };
    case "ampm": return design.ampmIndicator ?? null;
    case "separator": {
      const s = design.staticSeparators?.[layer.staticSeparatorId!];
      return s ? { color: s.color, fontFamily: s.fontFamily, fontWeight: s.fontWeight, fontStyle: s.fontStyle } : null;
    }
    // The chart layer's type is the readout it edits (its value, icon and unit), so it reads like any live field.
    case "native": case "chart": return design.nativeData?.[layer.nativeDataId!] ?? null;
    default: return null;
  }
}

/** The font family the layer draws with: its own, else the face's; "" is the template's own sprite font. */
export const familyOf = (design: Design, layer: EditorLayer): string => typoOf(design, layer)?.fontFamily ?? design.fontFamily ?? "";

/** Weight, style and spacing as the layer draws them. */
export function typographyOf(design: Design, layer: EditorLayer) {
  return resolveWatchfaceComponentTypography(
    { fontWeight: design.fontWeight, fontStyle: design.fontStyle, letterSpacing: design.letterSpacing, rasterFont: design.rasterFont },
    typoOf(design, layer) ?? undefined,
  );
}

/** Writes a typography patch where CorosLink keeps that layer's style. */
export function setTypo(design: Design, layer: EditorLayer, patch: Typo): Design {
  switch (panelOf(layer, design)) {
    case "time": {
      const id = layer.timePartId!;
      return { ...design, timeStyles: { ...design.timeStyles, [id]: { ...(design.timeStyles?.[id] ?? { scale: 1 }), ...patch } } };
    }
    case "metric": {
      const id = layer.metricId!;
      const next = { ...(design.metricStyles?.[id] ?? { scale: 1 }), ...patch };
      // Editing Scale hands sizing back from an explicit font size.
      if ("fontSize" in patch && patch.fontSize === undefined) delete next.fontSize;
      return { ...design, metricStyles: { ...design.metricStyles, [id]: next } };
    }
    case "date": return setDateStyle(design, layer.id as WatchfaceDatePartId, patch);
    case "selectable": {
      const current = design.selectableMetricStyle ?? { scale: 1 };
      const nativeSize = "fontFamily" in patch ? { nativeSize: Boolean(patch.fontFamily) } : {};
      return { ...design, selectableMetricStyle: { ...current, ...patch, ...nativeSize } };
    }
    case "ampm": return design.ampmIndicator ? { ...design, ampmIndicator: { ...design.ampmIndicator, ...patch } } : design;
    case "separator": {
      const id = layer.staticSeparatorId!;
      const s = design.staticSeparators[id];
      const { color, fontFamily, fontWeight, fontStyle } = patch;
      const next = { ...s, ...(color !== undefined ? { color } : {}), ...("fontFamily" in patch ? { fontFamily } : {}), ...(fontWeight !== undefined ? { fontWeight } : {}), ...(fontStyle !== undefined ? { fontStyle } : {}) };
      return { ...design, staticSeparators: { ...design.staticSeparators, [id]: next } };
    }
    case "native": case "chart": {
      const id = layer.nativeDataId!;
      const current = design.nativeData?.[id];
      if (!current) return design;
      const font = "fontFamily" in patch ? withNativeFont(current, patch.fontFamily ?? "") : {};
      const { fontFamily: _f, rasterFont: _r, rotation: _rot, solidAlpha: _s, align: _a, fontSize: _fs, ...rest } = patch;
      return { ...design, nativeData: { ...design.nativeData, [id]: { ...current, ...rest, ...font } } };
    }
    default: return design;
  }
}

/** CorosLink's setDateStyle: a font size owns the box, so the box is refitted to the font that draws the set. */
function setDateStyle(design: Design, partId: WatchfaceDatePartId, patch: Typo & { labelStyle?: "upper" | "title" | "full"; monthFormat?: "digits" | "labels"; translateLabels?: boolean; overwriteAllLanguages?: boolean; overwriteLanguages?: string[] }, resolution?: CorosWatchfaceResolutionDetails | null): Design {
  const current = design.dateStyles?.[partId] ?? { scale: 1 };
  const next = { ...current, ...patch, ...("fontFamily" in patch && patch.fontFamily ? { nativeSize: true } : {}) };
  const fontSize = styleFontSize(next);
  const family = next.fontFamily ?? design.fontFamily ?? "";
  if (fontSize !== undefined && family && resolution) {
    Object.assign(next, dateSizeForFontSize(partId, partId === "dateMonth" && dateMonthShowsLabels(resolution, next), fontSize, family,
      resolveWatchfaceComponentTypography({ fontWeight: design.fontWeight, fontStyle: design.fontStyle, letterSpacing: design.letterSpacing, rasterFont: design.rasterFont }, next),
      next.labelStyle));
  }
  return { ...design, dateStyles: { ...design.dateStyles, [partId]: next } };
}

/** The date's own settings: label style (TUE / Tue / Tuesday), number or words, and the watch languages it covers. */
export function setDate(design: Design, layer: EditorLayer, patch: Parameters<typeof setDateStyle>[2], resolution: CorosWatchfaceResolutionDetails | null): Design {
  return DATE_IDS.has(layer.id) ? setDateStyle(design, layer.id as WatchfaceDatePartId, patch, resolution) : design;
}

/**
 * The layer's Font size in master pixels (PNG digits read it as their height), or null where the template's
 * sprites can't be measured. The same sums as CorosLink's Font size field for each kind.
 */
export function fontSizeOf(design: Design, layer: EditorLayer, resolution: CorosWatchfaceResolutionDetails | null): number | null {
  const style = typoOf(design, layer);
  const typography = typographyOf(design, layer);
  const family = familyOf(design, layer);
  const drawn = shouldRenderWatchfaceText("0", family, typography) ? family : "";
  const metricStyle = style ? { ...style, scale: style.scale ?? 1 } : undefined;
  switch (panelOf(layer, design)) {
    case "time": {
      const cell = resolution ? watchfaceTimeDigitSize(resolution, layer.timePartId as WatchfaceTimePartId) : null;
      return cell ? Math.round(fixedMetricCurrentFontSize(cell, metricStyle, styleFontSize(metricStyle), drawn, typography)) : null;
    }
    case "metric": {
      const cell = resolution ? watchfaceFixedMetricDigitSize(resolution, layer.metricId!) : null;
      return cell ? Math.round(fixedMetricCurrentFontSize(cell, metricStyle, styleFontSize(metricStyle), drawn, typography)) : null;
    }
    case "date": {
      if (!resolution) return null;
      const size = dateFontSize(resolution, layer.id as WatchfaceDatePartId, design.dateStyles?.[layer.id], family, typography);
      return size === null ? null : Math.round(size);
    }
    case "separator": return design.staticSeparators?.[layer.staticSeparatorId!]?.size ?? null;
    case "native": {
      const native = design.nativeData?.[layer.nativeDataId!];
      return native ? Math.round(nativeComponentFontSize(layer.nativeDataId!, native, nativeFontSizePart(layer.nativeDataId!, native))) : null;
    }
    default: return null;
  }
}

export function setFontSize(design: Design, layer: EditorLayer, fontSize: number, resolution: CorosWatchfaceResolutionDetails | null): Design {
  const size = Math.max(4, Math.min(400, Math.round(fontSize)));
  switch (panelOf(layer, design)) {
    case "time": case "metric": return setTypo(design, layer, { fontSize: size });
    case "date": return setDateStyle(design, layer.id as WatchfaceDatePartId, { fontSize: size }, resolution);
    case "separator": {
      const id = layer.staticSeparatorId!;
      return { ...design, staticSeparators: { ...design.staticSeparators, [id]: { ...design.staticSeparators[id], size } } };
    }
    case "native": {
      const id = layer.nativeDataId!, native = design.nativeData?.[id];
      return native ? { ...design, nativeData: { ...design.nativeData, [id]: { ...native, scale: nativeScaleForFontSize(id, native, size) } } } : design;
    }
    default: return design;
  }
}

/** Scale (AM/PM, the weather icon, the battery icon, template images, selectable data), as a multiplier. */
export function scaleOf(design: Design, layer: EditorLayer): number | null {
  switch (panelOf(layer, design)) {
    case "ampm": return design.ampmIndicator?.scale ?? 1;
    case "weather": return design.weatherIndicator?.scale ?? 1;
    case "selectable": return design.selectableMetricStyle?.scale ?? 1;
    case "batteryIcon": case "image": return design.configAssetOverrides?.[assetKey(layer)]?.scale ?? 1;
    default: return null;
  }
}

export function setScale(design: Design, layer: EditorLayer, scale: number): Design {
  const s = Math.max(0.1, Math.min(4, Math.round(scale * 1000) / 1000));
  switch (panelOf(layer, design)) {
    case "ampm": return design.ampmIndicator ? { ...design, ampmIndicator: { ...design.ampmIndicator, scale: s } } : design;
    case "weather": return design.weatherIndicator ? { ...design, weatherIndicator: { ...design.weatherIndicator, scale: s } } : design;
    case "selectable": return { ...design, selectableMetricStyle: { ...(design.selectableMetricStyle ?? { scale: 1 }), scale: s } };
    case "batteryIcon": case "image": return setAsset(design, layer, { scale: s });
    default: return design;
  }
}

// ───── Resizing any layer from the canvas ─────

/**
 * The layer made `factor` times its size, through whatever field sizes it (Font size for text and digits, Scale for
 * icons and template images, the size of imported images and drawn shapes), or null when nothing sizes it. Always from
 * the design the drag started on, so a corner drag never compounds rounding.
 */
export function resizeBy(design: Design, layer: EditorLayer, factor: number, resolution: CorosWatchfaceResolutionDetails | null): Design | null {
  if (!(factor > 0)) return null;
  const font = fontSizeOf(design, layer, resolution);
  if (font !== null) return setFontSize(design, layer, font * factor, resolution);
  // The template's own PNG letters and numbers (no font): their box, which the letters are stretched to fill.
  if (panelOf(layer, design) === "date" && resolution && DATE_IDS.has(layer.id)) {
    const id = layer.id as WatchfaceDatePartId, style = design.dateStyles?.[id];
    const sizes = Array.from({ length: DATE_VALUES[id] }, (_, v) => dateSpriteCanvasSize(resolution, id, style, v)).filter((x) => !!x);
    if (!sizes.length) return null;
    const w = Math.max(...sizes.map((x) => x.width)), h = Math.max(...sizes.map((x) => x.height));
    const next = { ...(style ?? { scale: 1 }), width: Math.max(2, Math.round(w * factor)), height: Math.max(2, Math.round(h * factor)) };
    return { ...design, dateStyles: { ...design.dateStyles, [id]: next } };
  }
  const scale = scaleOf(design, layer);
  if (scale !== null) return setSpotScale(design, layer, scale * factor);
  if (layer.spriteId && spriteOf(design, layer)) {
    return setSprite(design, layer, (s) => ({ ...s, scale: Math.max(0.05, Math.min(10, Math.round(s.scale * factor * 1000) / 1000)) }));
  }
  const element = layer.backgroundElementId ? elementOf(design, layer) : undefined;
  return element && scaledElement(element, factor) ? setElement(design, layer, (e) => scaledElement(e, factor) ?? e) : null;
}

function scaledElement(e: CorosWatchfaceBackgroundElement, factor: number): CorosWatchfaceBackgroundElement | null {
  const size = (v: number) => Math.max(2, Math.round(v * factor));
  switch (e.kind) {
    case "rect": case "ellipse": return { ...e, width: size(e.width), height: size(e.height) };
    case "text": return { ...e, fontSize: Math.max(4, Math.min(400, Math.round(e.fontSize * factor))) };
    case "line": return { ...e, dx: Math.round(e.dx * factor), dy: Math.round(e.dy * factor) };
    default: return null;
  }
}

/** Whether a corner drag on the canvas can resize it. */
export const canResize = (design: Design, layer: EditorLayer, resolution: CorosWatchfaceResolutionDetails | null) =>
  !!layer.bounds && !isLocked(design, layer) && resizeBy(design, layer, 1.1, resolution) !== null;

// ───── Moving any layer ─────

/** Moves a layer by (dx, dy) master pixels, wherever the design keeps its place. */
export function nudge(design: Design, layer: EditorLayer, dx: number, dy: number): Design {
  dx = Math.round(dx); dy = Math.round(dy);
  if (!dx && !dy) return design;
  if (layer.layoutGroupId && layer.capabilities.position) {
    const o = design.layoutOffsets?.[layer.layoutGroupId] ?? { dx: 0, dy: 0 };
    return { ...design, layoutOffsets: { ...design.layoutOffsets, [layer.layoutGroupId]: { dx: o.dx + dx, dy: o.dy + dy } } };
  }
  if (layer.weatherIndicator && design.weatherIndicator) return { ...design, weatherIndicator: { ...design.weatherIndicator, x: design.weatherIndicator.x + dx, y: design.weatherIndicator.y + dy } };
  if (layer.ampmIndicator && design.ampmIndicator) return { ...design, ampmIndicator: { ...design.ampmIndicator, x: design.ampmIndicator.x + dx, y: design.ampmIndicator.y + dy } };
  if (layer.staticSeparatorId) {
    const s = design.staticSeparators[layer.staticSeparatorId];
    return { ...design, staticSeparators: { ...design.staticSeparators, [layer.staticSeparatorId]: { ...s, x: s.x + dx, y: s.y + dy } } };
  }
  if (layer.nativeDataId) {
    const n = design.nativeData?.[layer.nativeDataId];
    return n ? { ...design, nativeData: { ...design.nativeData, [layer.nativeDataId]: { ...n, x: n.x + dx, y: n.y + dy } } } : design;
  }
  if (layer.animation && design.animation) return { ...design, animation: { ...design.animation, x: design.animation.x + dx, y: design.animation.y + dy } };
  if (layer.spriteId) return setSprite(design, layer, (s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  if (layer.backgroundElementId) return setElement(design, layer, (e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
  return design;
}

/** Whether the inspector can move it (the canvas drag uses the same rule). */
export const canMove = (layer: EditorLayer) => (
  (!!layer.layoutGroupId && layer.capabilities.position && !!layer.bounds) || !!layer.weatherIndicator || !!layer.ampmIndicator || !!layer.staticSeparatorId ||
  !!layer.nativeDataId || !!layer.animation || !!layer.spriteId || !!layer.backgroundElementId);

/** Lines layers up on one edge or centre of the selection, or of the face for one layer. */
export function align(design: Design, layers: EditorLayer[], edge: "left" | "centerX" | "right" | "top" | "centerY" | "bottom", master: number): Design {
  const boxes = layers.filter((l) => l.bounds && canMove(l));
  if (!boxes.length) return design;
  const all = boxes.length === 1 ? { x0: 0, y0: 0, x1: master, y1: master } : {
    x0: Math.min(...boxes.map((l) => l.bounds!.x0)), y0: Math.min(...boxes.map((l) => l.bounds!.y0)),
    x1: Math.max(...boxes.map((l) => l.bounds!.x1)), y1: Math.max(...boxes.map((l) => l.bounds!.y1)),
  };
  let next = design;
  for (const l of boxes) {
    const b = l.bounds!;
    const dx = edge === "left" ? all.x0 - b.x0 : edge === "right" ? all.x1 - b.x1 : edge === "centerX" ? (all.x0 + all.x1) / 2 - (b.x0 + b.x1) / 2 : 0;
    const dy = edge === "top" ? all.y0 - b.y0 : edge === "bottom" ? all.y1 - b.y1 : edge === "centerY" ? (all.y0 + all.y1) / 2 - (b.y0 + b.y1) / 2 : 0;
    next = nudge(next, l, dx, dy);
  }
  return next;
}

/** Even gaps between three or more layers, across or down. */
export function distribute(design: Design, layers: EditorLayer[], axis: "x" | "y"): Design {
  const boxes = layers.filter((l) => l.bounds && canMove(l));
  if (boxes.length < 3) return design;
  const lo = axis === "x" ? "x0" : "y0", hi = axis === "x" ? "x1" : "y1";
  const sorted = [...boxes].sort((a, b) => a.bounds![lo] - b.bounds![lo]);
  const span = sorted[sorted.length - 1].bounds![hi] - sorted[0].bounds![lo];
  const sizes = sorted.reduce((sum, l) => sum + (l.bounds![hi] - l.bounds![lo]), 0);
  const gap = (span - sizes) / (sorted.length - 1);
  let at = sorted[0].bounds![lo], next = design;
  for (const l of sorted) {
    const move = at - l.bounds![lo];
    next = nudge(next, l, axis === "x" ? move : 0, axis === "y" ? move : 0);
    at += l.bounds![hi] - l.bounds![lo] + gap;
  }
  return next;
}

/** Where the layer's box starts, in master pixels: its drawn box, else the place the design stores for it. */
export function positionOf(design: Design, layer: EditorLayer): { x: number; y: number } | null {
  if (layer.bounds) return { x: layer.bounds.x0, y: layer.bounds.y0 };
  const at = layer.weatherIndicator ? design.weatherIndicator : layer.ampmIndicator ? design.ampmIndicator
    : layer.staticSeparatorId ? design.staticSeparators[layer.staticSeparatorId] : layer.nativeDataId ? design.nativeData?.[layer.nativeDataId]
      : layer.animation ? design.animation : layer.spriteId ? spriteOf(design, layer) : layer.backgroundElementId ? elementOf(design, layer) : undefined;
  return at ? { x: at.x, y: at.y } : null;
}

// ───── Stroke and shadows (the design's stacks, keyed by layer id) ─────

/**
 * Where the design keeps a layer's strokes, shadows and opacity. A standalone status spot has one look for all its
 * states, under the layout group the engine draws them with.
 */
export const lookId = (layer: EditorLayer) => (layer.spot?.canAdd ? layer.spot.id : layer.id);

export const strokesOf = (design: Design, layer: EditorLayer): CorosWatchfaceStroke[] => resolveWatchfaceLayerStrokes(design, lookId(layer));

export function setStrokes(design: Design, layer: EditorLayer, strokes: CorosWatchfaceStroke[]): Design {
  const layerStrokes = { ...design.layerStrokes };
  if (strokes.length) layerStrokes[lookId(layer)] = strokes; else delete layerStrokes[lookId(layer)];
  return { ...design, layerStrokes };
}
export const addStroke = (design: Design, layer: EditorLayer) => setStrokes(design, layer, [...strokesOf(design, layer), createWatchfaceStroke("#000000")]);

export const shadowsOf = (design: Design, layer: EditorLayer): CorosWatchfaceShadowEffect[] => resolveWatchfaceLayerEffects(design, lookId(layer));

/** Writes the layer's own shadows (a linked style becomes the layer's own copy, as Detach style does). */
export function setShadows(design: Design, layer: EditorLayer, effects: CorosWatchfaceShadowEffect[]): Design {
  const layerEffects = { ...design.layerEffects };
  if (effects.length) layerEffects[lookId(layer)] = { kind: "local", effects }; else delete layerEffects[lookId(layer)];
  return { ...design, layerEffects };
}
export const addShadow = (design: Design, layer: EditorLayer) => setShadows(design, layer, [...shadowsOf(design, layer), createWatchfaceShadowEffect("outer-shadow")]);

// ───── Lock ─────

/** The ids a lock covers: the layer's, or every image of the spot it stands for. */
const lockIds = (layer: EditorLayer) => (layer.spot ? layer.spot.states.map((s) => s.layer.id) : [layer.id]);
export const isLocked = (design: Design, layer: EditorLayer) => lockIds(layer).some((id) => design.lockedLayerIds?.includes(id));
export function setLocked(design: Design, layer: EditorLayer, locked: boolean): Design {
  const mine = lockIds(layer);
  const ids = (design.lockedLayerIds ?? []).filter((id) => !mine.includes(id));
  return { ...design, lockedLayerIds: locked ? [...ids, ...mine] : ids };
}

// ───── Template images: status icons, hands, colon, battery icon ─────

/** The override key: the reference id for a template image, battery_icon for the battery's states. */
export function assetKey(layer: EditorLayer): string {
  if (layer.kind === "batteryIcon") return "config:battery_icon";
  if (layer.kind === "controlBatteryIcon") return "config:control_battery_icon";
  return layer.configAssetId ?? layer.id;
}

export function setAsset(design: Design, layer: EditorLayer, patch: NonNullable<Design["configAssetOverrides"]>[string]): Design {
  const key = assetKey(layer);
  const next: Design = { ...design, configAssetOverrides: { ...design.configAssetOverrides, [key]: { ...design.configAssetOverrides?.[key], ...patch } } };
  // A colon picture replaces the drawn colon (CorosLink's updateConfigAsset).
  if (key === "config:colon_icon" && (patch.enabled !== undefined || patch.replacement)) {
    next.staticSeparators = { ...design.staticSeparators, colon: { ...design.staticSeparators.colon, enabled: false } };
  }
  return next;
}

export const replaceAsset = (design: Design, layer: EditorLayer, art: CorosWatchfaceArtwork) => setAsset(design, layer, { enabled: true, replacement: art });

/** Back to the template's own picture, keeping whether it shows. */
export function restoreAsset(design: Design, layer: EditorLayer): Design {
  const key = assetKey(layer), current = design.configAssetOverrides?.[key];
  if (!current) return design;
  const configAssetOverrides = { ...design.configAssetOverrides };
  if (current.enabled !== undefined) configAssetOverrides[key] = { enabled: current.enabled }; else delete configAssetOverrides[key];
  return { ...design, configAssetOverrides };
}

export const assetOf = (design: Design, layer: EditorLayer) => design.configAssetOverrides?.[assetKey(layer)];

// ───── The battery's "%" (battery_level_percent_icon) ─────
// The watch puts this one picture right after the battery number, so its look lives on the battery's style
// (WatchfacePercentStyle) and is baked into the picture by the engine.

/** The battery's "%" layer, in the face or always-on. */
export const isPercentLayer = (layer: EditorLayer) => /:battery_level_percent_icon$/.test(assetKey(layer));

export const percentOf = (design: Design): WatchfacePercentStyle => design.metricStyles?.battery?.percent ?? {};

/** Changes the "%" look; a field set to undefined goes back to following the digits. */
export function setPercent(design: Design, patch: WatchfacePercentStyle): Design {
  const battery = design.metricStyles?.battery ?? { scale: 1 };
  const next: WatchfacePercentStyle = { ...battery.percent, ...patch };
  for (const key of Object.keys(next) as (keyof WatchfacePercentStyle)[]) if (next[key] === undefined) delete next[key];
  if (next.size !== undefined && Math.abs(next.size - 1) < 0.005) delete next.size;
  if (next.gap !== undefined && next.gap <= 0) delete next.gap;
  if (next.align === "middle") delete next.align;
  const { percent: _old, ...rest } = battery;
  return { ...design, metricStyles: { ...design.metricStyles, battery: Object.keys(next).length ? { ...rest, percent: next } : rest } };
}

/** One size for every image a spot has on the face (they share a corner, so they scale from it together). */
export function setSpotScale(design: Design, layer: EditorLayer, scale: number): Design {
  if (!layer.spot) return setScale(design, layer, scale);
  return layer.spot.states.filter((s) => s.layer.present).reduce((next, s) => setScale(next, s.layer, scale), design);
}

/** Battery states from numbered PNGs (00 charging, 01 empty, 02–11 the tens), on one shared canvas. */
export function setBatteryStates(design: Design, layer: EditorLayer, states: Record<string, CorosWatchfaceArtwork>): Design {
  const next = setAsset(design, layer, { enabled: true, stateReplacements: states, ownSize: true });
  return layer.kind === "batteryIcon" ? { ...next, layerVisibility: { ...next.layerVisibility, batteryIcon: true } } : next;
}

// ───── Live data drawn by the watch ─────

export const nativeOf = (design: Design, layer: EditorLayer): CorosWatchfaceNativeDataStyle | undefined =>
  layer.nativeDataId ? design.nativeData?.[layer.nativeDataId] : undefined;

export function setNative(design: Design, layer: EditorLayer, patch: Partial<CorosWatchfaceNativeDataStyle>): Design {
  const current = nativeOf(design, layer);
  return current ? { ...design, nativeData: { ...design.nativeData, [layer.nativeDataId!]: { ...current, ...patch } } } : design;
}

export const partsOf = (design: Design, layer: EditorLayer): CorosWatchfaceNativePart[] => {
  const n = nativeOf(design, layer);
  return n ? nativeParts(layer.nativeDataId!, n) : [];
};

export function setPart(design: Design, layer: EditorLayer, part: CorosWatchfaceNativePart, patch: CorosWatchfaceNativePartStyle): Design {
  const n = nativeOf(design, layer);
  if (!n) return design;
  return setNative(design, layer, { parts: { ...n.parts, [part]: { ...n.parts?.[part], ...patch } } });
}

/**
 * Where a native field's icon sits on the face, in master pixels, for dragging it apart from its number (the
 * part's Shift X / Y). Null when the field shows no icon, or nothing beside it that the icon could move against.
 */
export function nativeIconBox(design: Design, layer: EditorLayer): { x0: number; y0: number; x1: number; y1: number } | null {
  const n = nativeOf(design, layer), id = layer.nativeDataId;
  if (!n || !id || isLocked(design, layer)) return null;
  const names = nativeParts(id, n), icon = nativePart(id, n, "icon");
  if (!names.includes("icon") || !icon.enabled) return null;
  if (!names.some((p) => (p === "value" || p === "states") && nativePart(id, n, p).enabled)) return null;
  const x0 = n.x + icon.x * n.scale, y0 = n.y + icon.y * n.scale;
  return { x0, y0, x1: x0 + icon.width * n.scale, y1: y0 + icon.height * n.scale };
}

/** Moves a native field's icon by master pixels on the face; the number and the field stay put. */
export function moveNativeIcon(design: Design, layer: EditorLayer, dx: number, dy: number): Design {
  const n = nativeOf(design, layer);
  if (!n || !layer.nativeDataId || isLocked(design, layer) || (!Math.round(dx) && !Math.round(dy))) return design;
  const icon = nativePart(layer.nativeDataId, n, "icon"), k = n.scale || 1;
  return setPart(design, layer, "icon", { x: Math.round(icon.x + dx / k), y: Math.round(icon.y + dy / k) });
}

// ───── Progress (the calories and exercise layers carry their arc and bar) ─────

export type Progress = CorosWatchfaceKcalProgressStyle | CorosWatchfaceExerciseProgressStyle;
export const progressKind = (layer: EditorLayer): "kcal" | "exercise" | null =>
  layer.metricId === "calories" ? "kcal" : layer.metricId === "exercise" ? "exercise" : null;

export function progressOf(design: Design, layer: EditorLayer, resolution: CorosWatchfaceResolutionDetails | null): Progress | null {
  const kind = progressKind(layer);
  if (!kind || !resolution) return null;
  return kind === "kcal" ? kcalProgressStyleForResolution(resolution, design.kcalProgress) : exerciseProgressStyleForResolution(resolution, design.exerciseProgress);
}

type ProgressPatch = { arcEnabled?: boolean; barEnabled?: boolean; color?: string; previewPercent?: number; arc?: Partial<Progress["arc"]>; rect?: Partial<Progress["rect"]> };

/** CorosLink's updateKcalProgress / updateExerciseProgress, with one colour for the arc and the bar. */
export function setProgress(design: Design, layer: EditorLayer, resolution: CorosWatchfaceResolutionDetails | null, patch: ProgressPatch): Design {
  const kind = progressKind(layer), current = progressOf(design, layer, resolution);
  if (!kind || !current || !resolution) return design;
  const base = { referenceWidth: current.referenceWidth ?? resolution.width, referenceHeight: current.referenceHeight ?? resolution.height };
  const arc = { ...current.arc, ...patch.arc }, rect = { ...current.rect, ...patch.rect };
  const previewPercent = patch.previewPercent ?? current.previewPercent;
  if (kind === "kcal") {
    const k = current as CorosWatchfaceKcalProgressStyle;
    return { ...design, kcalProgress: { ...k, ...base, arc, rect, previewPercent,
      ...(patch.arcEnabled !== undefined ? { arcEnabled: patch.arcEnabled } : {}), ...(patch.barEnabled !== undefined ? { rectEnabled: patch.barEnabled } : {}),
      ...(patch.color ? { arcColor: patch.color, rectColor: patch.color } : {}) } };
  }
  const e = current as CorosWatchfaceExerciseProgressStyle;
  return { ...design, exerciseProgress: { ...e, ...base, arc, rect, previewPercent,
    ...(patch.arcEnabled !== undefined ? { arcEnabled: patch.arcEnabled } : {}), ...(patch.barEnabled !== undefined ? { enabled: patch.barEnabled } : {}),
    ...(patch.color ? { color: patch.color } : {}) } };
}

export const progressColour = (p: Progress) => ("arcColor" in p ? p.arcColor : p.color);
export const progressBarOn = (p: Progress) => ("rectEnabled" in p ? p.rectEnabled : p.enabled);

// ───── Imported images and drawn shapes (faces made in CorosLink carry them) ─────

export const spriteOf = (design: Design, layer: EditorLayer) => design.designSprites?.find((s) => s.id === layer.spriteId);
export function setSprite(design: Design, layer: EditorLayer, fn: (s: CorosWatchfaceDesignSprite) => CorosWatchfaceDesignSprite): Design {
  return { ...design, designSprites: (design.designSprites ?? []).map((s) => (s.id === layer.spriteId ? fn(s) : s)) };
}

export const elementOf = (design: Design, layer: EditorLayer) => design.backgroundElements?.find((e) => e.id === layer.backgroundElementId);
export function setElement(design: Design, layer: EditorLayer, fn: (e: CorosWatchfaceBackgroundElement) => CorosWatchfaceBackgroundElement): Design {
  return { ...design, backgroundElements: (design.backgroundElements ?? []).map((e) => (e.id === layer.backgroundElementId ? fn(e) : e)) };
}

// ───── Animation ─────

export function setDelays(design: Design, delays: number[]): Design {
  return design.animation ? { ...design, animation: { ...design.animation, delays: delays.map(clampAnimationDelay) } } : design;
}

// ───── Files the inspector reads ─────

/** A PNG chosen on this computer, as the engine keeps artwork. */
export async function readArtwork(file: File): Promise<CorosWatchfaceArtwork> {
  if (!/^image\/png$/i.test(file.type) && !/\.png$/i.test(file.name)) throw new Error(`${file.name} isn't a PNG.`);
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is over 5 MB.`);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${file.name} isn't a picture this app can open.`));
    img.src = dataUrl;
  });
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
}

const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
  reader.readAsDataURL(file);
});

/** The longest side a picture keeps: twice the 800 master, so a photo doesn't weigh the project down. */
const PICTURE_MAX = 1600;

/**
 * A PNG, JPEG or WebP chosen on this computer, as the engine keeps artwork: a PNG data URL. A PNG within the limit is
 * kept byte for byte; JPEG and WebP are redrawn as PNG, and anything over 1600 px on a side is scaled down to it.
 */
export async function readPicture(file: File): Promise<CorosWatchfaceArtwork> {
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error(`${file.name} isn't a PNG, JPEG or WebP picture.`);
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is over 25 MB.`);
  const dataUrl = await readDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${file.name} isn't a picture this app can open.`));
    img.src = dataUrl;
  });
  const k = Math.min(1, PICTURE_MAX / Math.max(image.naturalWidth, image.naturalHeight));
  if (k === 1 && /^data:image\/png/i.test(dataUrl)) return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * k));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`Couldn't read ${file.name}.`);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/**
 * The PNGs directly inside a chosen folder, as the engine's importAnimationFrames takes them (it orders them by name
 * and checks their count and size). Only up to the frame limit and a few more are read, enough for its message.
 */
export async function readFrames(files: FileList): Promise<{ name: string; relativePath: string; dataUrl: string }[]> {
  const inFolder = (f: File) => (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name;
  const pngs = [...files].filter((f) => /\.png$/i.test(f.name) && !inFolder(f).includes("/"));
  if (pngs.length > 60) throw new Error(`The folder has ${pngs.length} PNGs; the watch plays up to 44 frames.`);
  if (pngs.some((f) => f.size > 5 * 1024 * 1024)) throw new Error("A frame is over 5 MB.");
  return Promise.all(pngs.map(async (f) => ({ name: f.name, relativePath: inFolder(f), dataUrl: await readDataUrl(f) })));
}
