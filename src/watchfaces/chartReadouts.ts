import type { CorosWatchfaceNativeDataStyle as Style } from "../../electron/types";
import { NATIVE_CHART_PAGES, NATIVE_CHART_SOURCES, nativeChartRepresentation } from "../../electron/watchfaceNativeCatalog";
import { isNativeTime, nativePart, nativePartHasPosition, nativeParts } from "./nativeDataParts";

/**
 * A chart layer is one graph shared by every page plus the readouts the watch
 * pages through with Back (official NOMAD carries nine). The layer edits one
 * readout at a time (chartSource); the others wait in `readouts`, each in face
 * coordinates, and swap in when picked. Export writes all of them, each into
 * its own sprite folders.
 */

const GRAPH_PARTS = ["plot", "background", "mask", "noDataMask"] as const;
const GRAPH_ROLES = ["background", "mask", "noDataMask"] as const;
/** Artwork that names a readout's data, which a new readout doesn't copy. */
const NAMING_ROLES = ["icon", "states"] as const;

const round = (value: number) => Math.round(value * 1000) / 1000;
function omit<K extends string, V>(record: Partial<Record<K, V>> | undefined, keys: readonly K[]): Partial<Record<K, V>> | undefined {
  if (!record) return undefined;
  const kept = { ...record };
  for (const key of keys) delete kept[key];
  return Object.keys(kept).length ? kept : undefined;
}
function withEntries(style: Style, entries: Pick<Style, "parts" | "assets" | "assetTexts" | "readouts" | "removedReadouts">): Style {
  const next = { ...style, ...entries };
  for (const key of ["parts", "assets", "assetTexts", "readouts"] as const) if (!next[key] || !Object.keys(next[key]!).length) delete next[key];
  if (!next.removedReadouts?.length) delete next.removedReadouts;
  return next;
}

export function chartSourceOf(style: Style): string { return style.chartSource ?? "chart_stress"; }
/** A stored readout, sourced by its `readouts` key (an AI-written entry may omit chartSource). */
export function chartStoredReadout(layer: Style, source: string): Style | undefined {
  const stored = layer.readouts?.[source];
  return stored && { ...stored, chartSource: source };
}
export function isChartSource(source: string): boolean { return NATIVE_CHART_SOURCES.some(item => item.id === source); }
/** The watch page (NATIVE_CHART_PAGES id) a readout shows on. */
export function chartReadoutPage(source: string): string | undefined {
  return NATIVE_CHART_PAGES.find(page => page.sources.includes(source))?.id;
}
/**
 * Readouts export adds invisibly so the watch keeps every page the face shows
 * something on. PACE Pro firmware 3.2008.0 keeps a page only with its required
 * readouts (NATIVE_CHART_PAGES `required`): all three on a daily page, sunrise
 * on the sun page, moonrise on the moon page. Confirmed on the watch: stress,
 * stamina and steps never paged; with invisible elevation, calories and heart
 * rate added, Back paged (2026-10-20). A page that shows nothing stays off.
 */
export function chartPageFillers(shown: Iterable<string>): string[] {
  const present = new Set(shown);
  return NATIVE_CHART_PAGES.flatMap(page => page.required.length && page.sources.some(source => present.has(source))
    ? page.required.filter(source => !present.has(source)) : []);
}

/** A readout the design keeps on its page but the watch doesn't show. */
export function chartReadoutHidden(style: Style): boolean {
  return chartSourceOf(style) === "chart_moon" ? !nativePart("chart", style, "states").enabled
    : !nativePart("chart", style, "value").enabled && !nativePart("chart", style, "icon").enabled;
}
function withReadoutShown(style: Style, shown: boolean): Style {
  const names = chartSourceOf(style) === "chart_moon" ? ["states"] as const : ["value", "icon"] as const;
  const parts = { ...style.parts };
  for (const name of names) parts[name] = { ...parts[name], enabled: shown };
  return { ...style, parts };
}

/** A template readout copied in hidden, so export can drop its keys for an invisible one. */
export function hiddenChartReadout(readout: Style): Style { return withReadoutShown(chartReadoutOnly(readout), false); }

/**
 * Shows or hides a readout on its page. Hiding keeps its place and artwork,
 * and export keeps the page with an invisible readout. Showing a readout the
 * face doesn't have yet adds it beside its page's others, and the layer edits it.
 */
export function setChartReadoutShown(layer: Style, source: string, shown: boolean, face?: { width: number; height: number }): Style {
  if (chartSourceOf(layer) === source) return withReadoutShown(layer, shown);
  const stored = layer.readouts?.[source];
  if (stored) return withEntries(layer, { readouts: { ...layer.readouts, [source]: withReadoutShown(stored, shown) }, removedReadouts: layer.removedReadouts });
  return shown ? swapChartReadout(layer, newChartReadout(layer, source, face)) : layer;
}

/** Adds a page's required readouts (visible), then edits the first of them. */
export function addChartPage(layer: Style, pageId: string, face?: { width: number; height: number }): Style {
  const page = NATIVE_CHART_PAGES.find(item => item.id === pageId);
  if (!page?.required.length) return layer;
  let next = layer;
  for (const source of page.required) next = setChartReadoutShown(next, source, true, face);
  const first = page.required[0]!;
  const stored = chartStoredReadout(next, first);
  return chartSourceOf(next) === first || !stored ? next : swapChartReadout(next, stored);
}

/** Takes a page's Studio readouts off the chart. Null when no readout would be left. */
export function removeChartPage(layer: Style, pageId: string): Style | null {
  const page = NATIVE_CHART_PAGES.find(item => item.id === pageId);
  let next: Style | null = layer;
  for (const source of page?.sources ?? []) {
    if (!next) return null;
    if (chartSourceOf(next) === source || next.readouts?.[source]) next = dropChartReadout(next, source);
  }
  return next;
}

/** Sprite folder prefix of a stored readout. The edited one keeps `cl_nd_chart`. */
export function chartReadoutFolder(source: string): string { return `cl_nd_cr_${source.replace(/^chart_/, "")}`; }

/** A readout without the layer's graph, as `readouts` stores it. */
export function chartReadoutOnly(style: Style): Style {
  const readout: Style = { ...style, enabled: true, chartSource: chartSourceOf(style) };
  for (const key of ["readouts", "removedReadouts", "chartStyle", "chartWidth", "chartHeight", "parts", "assets", "assetTexts"] as const) delete readout[key];
  return withEntries(readout, { parts: omit(style.parts, GRAPH_PARTS), assets: omit(style.assets, GRAPH_ROLES), assetTexts: omit(style.assetTexts, GRAPH_ROLES) });
}

/** A stored readout drawn or exported on its own, with no graph. */
export function chartReadoutStyle(readout: Style): Style {
  return { ...readout, enabled: true, parts: { ...readout.parts, ...Object.fromEntries(GRAPH_PARTS.map(part => [part, { enabled: false }])) } };
}

/** The layer's stored readouts the watch shows: made-fixed ones have left their page. */
export function storedChartReadouts(layer: Style): Style[] {
  const current = chartSourceOf(layer);
  return Object.entries(layer.readouts ?? {}).flatMap(([source, readout]) =>
    source !== current && isChartSource(source) && !layer.removedReadouts?.includes(source)
      ? [chartReadoutStyle({ ...readout, chartSource: source })] : []);
}

/** Where a readout's icon, number or moon frames sit on the face, in master pixels. */
export function chartReadoutBounds(style: Style): { x0: number; y0: number; x1: number; y1: number } | null {
  const placed = (["icon", "value", "states"] as const).filter(name => nativeParts("chart", style).includes(name))
    .map(name => [name, nativePart("chart", style, name)] as const).filter(([, part]) => part.enabled);
  if (!placed.length) return null;
  const boxes = placed.map(([name, part]) => {
    // Rise/set times draw hour, colon and minute across the value part and a colon cell.
    const width = part.width + (name === "value" && isNativeTime("chart", style) ? nativePart("chart", style, "symbols").width : 0);
    return { x0: style.x + part.x * style.scale, y0: style.y + part.y * style.scale, x1: style.x + (part.x + width) * style.scale, y1: style.y + (part.y + part.height) * style.scale };
  });
  return { x0: Math.min(...boxes.map(box => box.x0)), y0: Math.min(...boxes.map(box => box.y0)), x1: Math.max(...boxes.map(box => box.x1)), y1: Math.max(...boxes.map(box => box.y1)) };
}

/** The graph's plot on the face, in master pixels; null when the shown page draws no graph. */
export function chartGraphBounds(layer: Style): { x0: number; y0: number; x1: number; y1: number } | null {
  const plot = nativePart("chart", layer, "plot");
  if (!plot.enabled || nativeChartRepresentation(chartSourceOf(layer)) === "none") return null;
  return { x0: layer.x + plot.x * layer.scale, y0: layer.y + plot.y * layer.scale, x1: layer.x + (plot.x + plot.width) * layer.scale, y1: layer.y + (plot.y + plot.height) * layer.scale };
}

/** Native parts sit at nonnegative offsets: the origin is the upper-left of everything drawn. */
function withNonnegativeParts(style: Style): Style {
  const names = nativeParts("chart", style).filter(nativePartHasPosition);
  const shown = names.map(name => nativePart("chart", style, name)).filter(part => part.enabled);
  const dx = Math.min(0, ...shown.map(part => part.x)), dy = Math.min(0, ...shown.map(part => part.y));
  if (!dx && !dy) return style;
  const parts = { ...style.parts };
  for (const name of names) {
    const part = nativePart("chart", style, name);
    parts[name] = { ...parts[name], x: round(part.x - dx), y: round(part.y - dy) };
  }
  return { ...style, x: round(style.x + dx * style.scale), y: round(style.y + dy * style.scale), parts };
}

/** `readout` with the layer's graph, which stays where it is on the face. */
function withLayerGraph(readout: Style, layer: Style, readouts: Record<string, Style>): Style {
  const sameFrame = readout.x === layer.x && readout.y === layer.y && readout.scale === layer.scale;
  const parts = { ...readout.parts }, assets = { ...readout.assets }, assetTexts = { ...readout.assetTexts };
  for (const name of GRAPH_PARTS) {
    const custom = layer.parts?.[name];
    if (sameFrame) {
      if (custom) parts[name] = custom; else delete parts[name];
    } else {
      const part = nativePart("chart", layer, name);
      parts[name] = { ...custom, enabled: part.enabled,
        x: round((layer.x + part.x * layer.scale - readout.x) / readout.scale), y: round((layer.y + part.y * layer.scale - readout.y) / readout.scale),
        width: round(part.width * layer.scale / readout.scale), height: round(part.height * layer.scale / readout.scale) };
    }
    // Uncolored graph parts follow the layer color; keep the graph's own.
    if (readout.color !== layer.color && !custom?.color) parts[name] = { ...parts[name], color: layer.color };
  }
  for (const role of GRAPH_ROLES) {
    if (layer.assets?.[role]) assets[role] = layer.assets[role]; else delete assets[role];
    if (layer.assetTexts?.[role]) assetTexts[role] = layer.assetTexts[role]; else delete assetTexts[role];
  }
  const next: Style = { ...readout, enabled: layer.enabled, chartStyle: layer.chartStyle, chartWidth: layer.chartWidth, chartHeight: layer.chartHeight };
  for (const key of ["chartStyle", "chartWidth", "chartHeight"] as const) if (next[key] === undefined) delete next[key];
  return withNonnegativeParts(withEntries(next, { parts, assets, assetTexts, readouts, removedReadouts: layer.removedReadouts }));
}

/** Moves the edited readout (the layer origin to x, y); the graph stays where it is. */
export function moveChartReadout(layer: Style, x: number, y: number): Style {
  if (x === layer.x && y === layer.y) return layer;
  return withLayerGraph({ ...chartReadoutOnly(layer), x, y }, layer, { ...layer.readouts });
}

/** Moves the graph so its plot's upper-left lands at (x, y); the readouts stay. */
export function moveChartGraph(layer: Style, x: number, y: number): Style {
  const plot = nativePart("chart", layer, "plot");
  const dx = (x - (layer.x + plot.x * layer.scale)) / layer.scale, dy = (y - (layer.y + plot.y * layer.scale)) / layer.scale;
  if (!dx && !dy) return layer;
  const parts = { ...layer.parts };
  for (const name of GRAPH_PARTS) {
    const part = nativePart("chart", layer, name);
    parts[name] = { ...parts[name], x: round(part.x + dx), y: round(part.y + dy) };
  }
  return withNonnegativeParts({ ...layer, parts });
}

const READOUT_PARTS = ["icon", "value", "states", "symbols", "decimal"] as const;
/**
 * The chart split for a drag preview: the part being dragged (`moving`), or
 * everything else. The moving half drops the other readouts and the
 * template's page companions so only the dragged part follows the pointer.
 */
export function chartDragSplit(layer: Style, part: "readout" | "graph", moving: boolean): Style {
  const off = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, { ...layer.parts?.[name as keyof NonNullable<Style["parts"]>], enabled: false }]));
  const dropped = part === "readout" ? (moving ? GRAPH_PARTS : READOUT_PARTS) : (moving ? READOUT_PARTS : GRAPH_PARTS);
  const next: Style = { ...layer, parts: { ...layer.parts, ...off(dropped) } };
  if (!moving) return next;
  delete next.readouts;
  return { ...next, removedReadouts: [...NATIVE_CHART_SOURCES.map(source => source.id)] };
}

/** The layer edits `readout` from now on; the readout it edited joins `readouts`. */
export function swapChartReadout(layer: Style, readout: Style): Style {
  const from = chartSourceOf(layer), to = chartSourceOf(readout);
  const readouts = { ...layer.readouts };
  delete readouts[to];
  if (from !== to) readouts[from] = chartReadoutOnly(layer);
  return withLayerGraph(chartReadoutOnly(readout), layer, readouts);
}

/**
 * Takes a readout Studio added off the chart. The layer moves on to another
 * stored readout when it was editing this one; null when none is left, since
 * the watch draws no graph without a readout.
 */
export function dropChartReadout(layer: Style, source: string): Style | null {
  const removedReadouts = layer.removedReadouts?.filter(item => item !== source);
  if (chartSourceOf(layer) !== source) {
    const readouts = { ...layer.readouts };
    delete readouts[source];
    return withEntries(layer, { readouts, removedReadouts });
  }
  const next = Object.keys(layer.readouts ?? {}).find(item => item !== source && isChartSource(item) && !layer.removedReadouts?.includes(item));
  if (!next) return null;
  const swapped = swapChartReadout(layer, chartStoredReadout(layer, next)!);
  const readouts = { ...swapped.readouts };
  delete readouts[source];
  return withEntries(swapped, { readouts, removedReadouts });
}

/**
 * A readout for `source` styled like the layer's own: same digits, color and
 * sizes, with generated icon art for its data. Beside the readouts already on
 * its page (below them for a daily page's lower slot, as on official NOMAD);
 * on a page of its own it takes the edited readout's spot, since Back shows
 * one page at a time.
 */
export function newChartReadout(layer: Style, source: string, face?: { width: number; height: number }): Style {
  const base = chartReadoutOnly(layer);
  const readout: Style = { ...base, chartSource: source };
  for (const key of ["previewValue", "stateCount", "assets", "assetTexts"] as const) delete readout[key];
  // Shown even when the edited readout is hidden: Add data / Show adds it to its page.
  const created = withReadoutShown(withEntries(readout, { assets: omit(base.assets, NAMING_ROLES), assetTexts: omit(base.assetTexts, NAMING_ROLES) }), true);
  const page = NATIVE_CHART_PAGES.find(item => item.sources.includes(source));
  const shown = [layer, ...Object.entries(layer.readouts ?? {}).map(([key, stored]) => ({ ...stored, chartSource: key }))]
    .filter(item => page?.sources.includes(chartSourceOf(item)) && !layer.removedReadouts?.includes(chartSourceOf(item)));
  const boxes = shown.flatMap(item => chartReadoutBounds(item) ?? []);
  const own = chartReadoutBounds(created);
  if (!page || !boxes.length || !own) return created;
  const box = { x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)), x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)) };
  const gap = Math.max(8, Math.round((own.y1 - own.y0) / 4));
  const lower = page.sources.length > 2 && page.sources.indexOf(source) === page.sources.length - 1;
  const beside = { x: box.x1 + gap, y: box.y0 }, below = { x: box.x0, y: box.y1 + gap };
  const target = lower || (face && beside.x + own.x1 - own.x0 > face.width) ? below : beside;
  return { ...created, x: Math.round(created.x + target.x - own.x0), y: Math.round(created.y + target.y - own.y0) };
}
