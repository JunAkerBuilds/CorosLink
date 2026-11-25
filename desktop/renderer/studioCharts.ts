// The chart as the inspector shows it (the design's "Studio charts" boards): every page the watch can have, in the
// order its Back button goes, each on or off, with what is on it and what the watch hides while it shows. The
// firmware's rules stay in the engine (watchfaceNativeCatalog.ts, engine/chartReadouts.ts, engine/templateChartPages.ts);
// this file only reads them for the panel and turns a click into the design change.
import type { CorosWatchfaceNativeDataStyle, CorosWatchfaceTemplateAsset, CorosWatchfaceTemplateDetails } from "../watchface/types";
import { recoverChartGroup } from "../watchface/engine/recoveredWatchfaceDesign";
import {
  NATIVE_CHART_BAR_PAGES, NATIVE_CHART_FIXED_EQUIVALENTS, NATIVE_CHART_PAGES, NATIVE_DATA_BY_ID, nativeChartReadoutLabel, nativeChartRepresentation,
} from "../watchface/watchfaceNativeCatalog";
import {
  chartReadoutHidden, chartReadoutPage, chartSourceOf, chartStoredReadout, dropChartReadout, removeChartPage, setChartReadoutShown, swapChartReadout,
} from "../watchface/engine/chartReadouts";
import { nativePageRule } from "../watchface/engine/nativeData";
import { templateChartPages } from "../watchface/engine/templateChartPages";
import { pickPreviewResolution, watchfaceFixedMetricDigitSize } from "../watchface/engine/watchfaceStudio";
import { defaultNativeDataStyle, nativePart, nativeParts } from "../watchface/engine/nativeDataParts";
import { deriveEditorLayers } from "../watchface/engine/watchfaceEditorModel";
import { addChartPageField, type LibraryContext } from "./studioLibrary";
import type { Design } from "./studioFace";

type Style = CorosWatchfaceNativeDataStyle;
type Face = { width: number; height: number };

export type ChartGraph = "bars" | "line" | "none";
export const CHART_PAGE_LABEL: Record<string, string> = {
  barometer: "Barometer", tide: "Tide", sun: "Sun", moon: "Moon", "daily-a": "Daily stats", "daily-b": "Daily activity",
};
export const CHART_GRAPH_SHORT: Record<ChartGraph, string> = { bars: "Bars", line: "Line", none: "Numbers" };
export const CHART_GRAPH_ICON: Record<ChartGraph, string> = { bars: "chart", line: "wave", none: "nums" };
export const CHART_GRAPH_LABEL: Record<ChartGraph, string> = { bars: "Bar graph", line: "Line graph", none: "Numbers, no graph" };
/** The chart's own names for its readouts, where the catalog's would repeat the page's. */
const READOUT_LABEL: Record<string, string> = {
  chart_baro: "Pressure reading", chart_tide: "Tide height", chart_sunrise: "Sunrise and sunset", chart_moonrise: "Moonrise and moonset",
};
export const chartReadoutName = (source: string) => READOUT_LABEL[source] ?? nativeChartReadoutLabel(source);

export interface ChartReadoutRow {
  source: string;
  label: string;
  /** The watch keeps the page only with this readout. */
  required: boolean;
  /** shown / hidden: on the chart layer. missing: not on it (an optional one to add, or a needed one export adds
   *  invisibly). template: declared by the template, which Studio doesn't edit here. fixed: moved off its page into
   *  a field that shows on every page. */
  state: "shown" | "hidden" | "missing" | "template" | "fixed";
  /** A field that shows on every page carries the same data ("Make fixed"). */
  hasFixedTwin: boolean;
}

export interface ChartPageRow {
  id: string;
  label: string;
  graph: ChartGraph;
  on: boolean;
  /** Its place in the Back order, from 1; null while off. */
  number: number | null;
  /** The page the watch preview shows (the readout the chart layer edits). */
  shown: boolean;
  /** The preview can switch to it: it has a readout on the chart layer. */
  canShow: boolean;
  /** On only because the template declares it. */
  fromTemplate: boolean;
  /** The chart's last page: it can't be turned off. */
  locked: boolean;
  readouts: ChartReadoutRow[];
  /** Fields on the face the watch doesn't draw while this page shows, and the ones it draws only on pages like it. */
  hides: { id: string; label: string }[];
  shows: { id: string; label: string }[];
}

const isBarPage = (id: string) => (NATIVE_CHART_BAR_PAGES as readonly string[]).includes(id);
const graphOf = (source: string): ChartGraph => { const g = nativeChartRepresentation(source); return g === "curve" ? "line" : g; };
const chartOf = (design: Design): Style | undefined => (design.nativeData?.chart?.enabled ? design.nativeData.chart : undefined);
const barsOn = (chart: Style | undefined) => !!chart && (chart.chartStyle?.barWidth ?? 8) > 0;
/** Readouts on the chart layer: the one it edits and the stored ones, without those made fixed. */
function layerSources(chart: Style | undefined): string[] {
  if (!chart) return [];
  return [chartSourceOf(chart), ...Object.keys(chart.readouts ?? {})].filter((s, i, all) => all.indexOf(s) === i && !chart.removedReadouts?.includes(s));
}
const readoutStyle = (chart: Style, source: string): Style | undefined => (chartSourceOf(chart) === source ? chart : chartStoredReadout(chart, source));

/** The six pages, in Back order, as the face has them. */
export function chartPageRows(design: Design, details: CorosWatchfaceTemplateDetails): ChartPageRow[] {
  const chart = chartOf(design), sources = layerSources(chart), modes = design.chartPageModes ?? {};
  const master = pickPreviewResolution(details);
  const template = new Map((master ? templateChartPages(master, modes) : []).map((page) => [page.id, page]));
  const shownPage = chart ? chartReadoutPage(chartSourceOf(chart)) : undefined;
  // Fields on the face that the watch draws on some pages only.
  const fields = Object.entries(design.nativeData ?? {}).filter(([id, style]) => id !== "chart" && style?.enabled && nativePageRule(id))
    .map(([id]) => ({ id, label: NATIVE_DATA_BY_ID.get(id)?.label ?? id, rule: nativePageRule(id)! }));

  const rows = NATIVE_CHART_PAGES.map((page): ChartPageRow => {
    const onLayer = page.sources.filter((s) => sources.includes(s));
    const declared = template.get(page.id);
    const removed = modes[page.id] === "removed";
    const on = isBarPage(page.id) ? barsOn(chart) || !!declared?.on : !removed && (onLayer.length > 0 || !!declared?.on);
    const readouts = page.sources.map((source): ChartReadoutRow => {
      const style = chart && onLayer.includes(source) ? readoutStyle(chart, source) : undefined;
      const fromTemplate = !style && !!declared?.readouts.some((r) => r.source === source);
      if (chart?.removedReadouts?.includes(source) && readoutStyle(chart, source)) {
        return { source, label: chartReadoutName(source), required: page.required.includes(source), hasFixedTwin: true, state: "fixed" };
      }
      return {
        source, label: chartReadoutName(source), required: page.required.includes(source), hasFixedTwin: source in NATIVE_CHART_FIXED_EQUIVALENTS,
        state: style ? (chartReadoutHidden({ ...style, chartSource: source }) ? "hidden" : "shown") : fromTemplate ? "template" : "missing",
      };
    });
    return {
      id: page.id, label: CHART_PAGE_LABEL[page.id] ?? page.label, graph: graphOf(page.sources[0]!), on, number: null,
      shown: on && shownPage === page.id, canShow: on && onLayer.length > 0, fromTemplate: on && !onLayer.length && !isBarPage(page.id), locked: false, readouts,
      hides: fields.filter((f) => !f.rule(page.id)).map(({ id, label }) => ({ id, label })),
      shows: fields.filter((f) => f.rule(page.id)).map(({ id, label }) => ({ id, label })),
    };
  });
  // Barometer and Tide count as one thing to turn off; the last thing on stays.
  const units = new Set(rows.filter((r) => r.on).map((r) => (isBarPage(r.id) ? "bars" : r.id)));
  let n = 0;
  for (const row of rows) {
    if (!row.on) continue;
    row.number = ++n;
    row.locked = units.size <= 1;
  }
  return rows;
}

/** Which of the two graph styles the face's pages draw. */
export function chartStylesInUse(rows: ChartPageRow[]): { line: boolean; bars: boolean } {
  return { line: rows.some((r) => r.on && r.graph === "line"), bars: rows.some((r) => r.on && r.graph === "bars") };
}

/**
 * Turns a page on or off. Barometer and Tide go together (the watch keeps both while the bars have a width). Off takes
 * the page's readouts off the chart, and a template's own page off the watch; the last page stays.
 */
export function setChartPageOn(design: Design, pageId: string, on: boolean, details: CorosWatchfaceTemplateDetails, face: Face): Design {
  const rows = chartPageRows(design, details), row = rows.find((r) => r.id === pageId);
  const chart = chartOf(design);
  if (!row || !chart || row.on === on) return design;
  const bars = isBarPage(pageId);
  if (on) {
    const ctx: LibraryContext = { details, layers: [], face };
    return addChartPageField(design, bars ? "bars" : pageId, ctx);
  }
  if (row.locked) return design;
  if (bars) {
    // The layer may be editing a barometer or tide number: hand over to another page's readout first.
    let next: Style | null = chart;
    for (const id of NATIVE_CHART_BAR_PAGES) next = next && layerSources(next).some((s) => chartReadoutPage(s) === id) ? removeChartPage(next, id) : next;
    if (!next) return design;
    return withChart(design, { ...next, chartStyle: { ...next.chartStyle, barWidth: 0 } });
  }
  let next: Style | null = chart;
  if (row.canShow) {
    next = removeChartPage(chart, pageId);
    if (!next && barsOn(chart)) {
      // Only the bar pages are left, and the watch draws no graph without a chart number: keep one, hidden.
      const kept = setChartReadoutShown(setChartReadoutShown(chart, "chart_baro", true, face), "chart_baro", false);
      next = removeChartPage(kept, pageId);
    }
    if (!next) return design;
  }
  const page = NATIVE_CHART_PAGES.find((p) => p.id === pageId)!;
  const declared = row.readouts.some((r) => r.state === "template") || row.fromTemplate || templateDeclares(details, pageId);
  const chartPageModes = declared ? { ...design.chartPageModes, [page.id]: "removed" as const } : design.chartPageModes;
  return { ...withChart(design, next ?? chart), ...(chartPageModes ? { chartPageModes } : {}) };
}

function templateDeclares(details: CorosWatchfaceTemplateDetails, pageId: string): boolean {
  const master = pickPreviewResolution(details);
  return !!master && templateChartPages(master, {}).some((p) => p.id === pageId && p.readouts.length > 0);
}

const withChart = (design: Design, chart: Style): Design => ({ ...design, nativeData: { ...design.nativeData, chart } });

/** Shows a page in the preview: the chart layer edits one of that page's readouts. */
export function showChartPage(design: Design, pageId: string): Design {
  const chart = chartOf(design);
  if (!chart || chartReadoutPage(chartSourceOf(chart)) === pageId) return design;
  const page = NATIVE_CHART_PAGES.find((p) => p.id === pageId);
  const source = page?.sources.find((s) => layerSources(chart).includes(s));
  const stored = source ? chartStoredReadout(chart, source) : undefined;
  return stored ? withChart(design, swapChartReadout(chart, stored)) : design;
}

/**
 * The template's readout the preview borrows to show a page only the template has (a face opened from a template keeps
 * one readout on its chart layer; the watch still pages through the rest). Null when the page needs nothing borrowed,
 * or the template has no readout to draw it with.
 */
export function templatePageReadout(row: ChartPageRow): string | null {
  if (!row.on || row.canShow) return null;
  const page = NATIVE_CHART_PAGES.find((p) => p.id === row.id);
  const declared = row.readouts.filter((r) => r.state === "template").map((r) => r.source);
  return declared.find((s) => page?.required.includes(s)) ?? declared[0] ?? null;
}
/** The preview can step to this page: it draws it from the chart layer, or from a readout the template has. */
export const canPreviewPage = (row: ChartPageRow) => row.on && (row.canShow || !!templatePageReadout(row));

/** The page after the shown one among those the preview can show, as the watch's Back button steps. */
export function nextChartPage(rows: ChartPageRow[]): string | null {
  const can = rows.filter(canPreviewPage);
  if (can.length < 2) return null;
  const at = can.findIndex((r) => r.shown);
  return can[(at + 1) % can.length]!.id;
}

/** The chart layer edits `readout` from now on (a stored one, or one recovered from the template); the one it edited is kept. */
export function showTemplateChartPage(design: Design, readout: Style): Design {
  const chart = chartOf(design);
  return chart ? withChart(design, swapChartReadout(chart, readout)) : design;
}

type LoadAssets = (paths: string[]) => Promise<CorosWatchfaceTemplateAsset[]>;
/** The readout for `source` the chart layer can switch to: its stored copy, else the template's own. */
export async function chartReadoutToEdit(design: Design, source: string, details: CorosWatchfaceTemplateDetails, loadAssets: LoadAssets): Promise<Style | null> {
  const chart = chartOf(design);
  if (!chart) return null;
  return chartStoredReadout(chart, source) ?? await recoverChartGroup(details, loadAssets, source).catch(() => null);
}
/**
 * The change that shows `pageId` in the preview. A page only the template has borrows the template's readout for it
 * (a face opened from a template keeps one readout on its chart layer). Null when there is nothing to draw it with.
 */
export async function chartPageChange(design: Design, pageId: string, details: CorosWatchfaceTemplateDetails, loadAssets: LoadAssets): Promise<((design: Design) => Design) | null> {
  const row = chartPageRows(design, details).find((r) => r.id === pageId);
  const borrowed = row ? templatePageReadout(row) : null;
  if (!borrowed) return (x) => showChartPage(x, pageId);
  const readout = await recoverChartGroup(details, loadAssets, borrowed).catch(() => null);
  return readout ? (x) => showTemplateChartPage(x, readout) : null;
}

/** Shows or hides a readout on its page; showing one the chart lacks adds it. */
export function setChartReadout(design: Design, source: string, shown: boolean, face: Face): Design {
  const chart = chartOf(design);
  return chart ? withChart(design, setChartReadoutShown(chart, source, shown, face)) : design;
}

/** Takes an optional readout off its page. A needed one, or the chart's last, stays. */
export function removeChartReadout(design: Design, source: string): Design {
  const chart = chartOf(design);
  const page = NATIVE_CHART_PAGES.find((p) => p.sources.includes(source));
  if (!chart || !page || page.required.includes(source)) return design;
  const next = dropChartReadout(chart, source);
  return next ? withChart(design, next) : design;
}

/** A way to start a chart, for Add: one page, or Barometer and Tide together. `key` is the library's row. */
export interface ChartStartOption {
  key: string;
  label: string;
  /** What the page carries, in a few words. */
  sub: string;
  graph: ChartGraph;
  /** Fields on the face the watch won't draw while this page shows. */
  hides: { id: string; label: string }[];
  note?: string;
}

/** The pages a chart can start from, the ones that need nothing from the phone first. */
export function chartStartOptions(design: Design, details: CorosWatchfaceTemplateDetails): ChartStartOption[] {
  const rows = new Map(chartPageRows(design, details).map((r) => [r.id, r]));
  const one = (id: string, note?: string): ChartStartOption => {
    const row = rows.get(id)!;
    const names = row.readouts.filter((r) => r.required).map((r) => r.label);
    return { key: `chart:${id}`, label: row.label, graph: row.graph, hides: row.hides, note,
      sub: names.length > 1 ? names.map((n, i) => (i ? n.toLowerCase() : n)).join(", ") : names[0] ?? "" };
  };
  const baro = rows.get("barometer")!;
  return [
    one("sun"), one("moon"), one("daily-a"), one("daily-b", "Needs Send from Studio"),
    { key: "chart:bars", label: "Barometer and Tide", sub: "Two pages, always together", graph: "bars", hides: baro.hides, note: "Blank until the phone syncs" },
  ];
}

// ───── On every page: a readout leaves its page for the field that always shows the same data ─────

/**
 * Why a readout can't be shown on every page, or null when it can. Stress, stamina and barometer become the native
 * field with the readout's own parts; steps, calories, elevation and heart rate become the template's own fixed
 * number, so the template has to have one and the face must not show it already.
 */
export function chartFixBlock(design: Design, details: CorosWatchfaceTemplateDetails, source: string): string | null {
  const twin = NATIVE_CHART_FIXED_EQUIVALENTS[source], chart = chartOf(design), label = chartReadoutName(source);
  if (!twin) return "This one only lives on its page.";
  if (!chart || !readoutStyle(chart, source)) return "Add it to the page first.";
  if (layerSources(chart).filter((s) => s !== source).length === 0) return "The chart's last readout stays on it.";
  if ("nativeData" in twin) return design.nativeData?.[twin.nativeData]?.enabled ? `The face already shows ${label}.` : null;
  return deriveEditorLayers(details, design).some((l) => l.metricId === twin.metric && l.visible) ? `The face already shows ${label}.` : null;
}

/**
 * Moves a readout off its page into the field that shows on every page, where the readout was. The readout stays
 * stored, off its page, so it can be put back; the page keeps existing through the invisible readouts export adds.
 */
/** What the page measures of a readout's artwork before it is made fixed (studioChartArt.ts): pixel sizes and digit ink. */
export interface ChartReadoutArt {
  /** The readout's icon image, when it has one. */
  icon?: { width: number; height: number };
  /** One digit image of the readout's digit art. */
  digit?: { width: number; height: number };
  /** The digits' ink in their frame: height and baseline as fractions of the frame height. */
  ink?: { height: number; baseline: number } | null;
  /** Id for the image layer the icon becomes. */
  spriteId: string;
}

/** The readout as the chart stores it, for measuring its artwork. */
export function chartReadoutOf(design: Design, source: string): Style | undefined {
  const chart = chartOf(design);
  return chart ? readoutStyle(chart, source) : undefined;
}

export function fixChartReadout(design: Design, source: string, details: CorosWatchfaceTemplateDetails, art?: ChartReadoutArt): Design {
  if (chartFixBlock(design, details, source)) return design;
  const twin = NATIVE_CHART_FIXED_EQUIVALENTS[source]!;
  let chart = chartOf(design)!;
  const readout = readoutStyle(chart, source)!;
  const scale = readout.scale ?? 1;
  const place = (name: "value" | "icon") => {
    const part = nativePart("chart", readout, name);
    return { ...part, x: readout.x + part.x * scale, y: readout.y + part.y * scale, width: part.width * scale, height: part.height * scale };
  };
  const value = place("value"), icon = place("icon");
  // The layer moves on to another readout first; this one stays stored.
  if (chartSourceOf(chart) === source) {
    const other = layerSources(chart).find((s) => s !== source)!;
    chart = swapChartReadout(chart, chartStoredReadout(chart, other)!);
  }
  chart = { ...chart, removedReadouts: [...new Set([...(chart.removedReadouts ?? []), source])] };
  let next = withChart(design, chart);
  if ("nativeData" in twin) {
    const id = twin.nativeData, base = defaultNativeDataStyle(id);
    const shown = [value, ...(icon.enabled ? [icon] : [])];
    const x = Math.min(...shown.map((p) => p.x)), y = Math.min(...shown.map((p) => p.y));
    const part = (p: typeof value) => ({ enabled: true, x: (p.x - x) / scale, y: (p.y - y) / scale, width: p.width / scale, height: p.height / scale,
      digitWidth: p.digitWidth, align: p.align, ...(readout.parts?.value?.color ? { color: readout.parts.value.color } : {}) });
    const parts: NonNullable<Style["parts"]> = Object.fromEntries(nativeParts(id, base).map((name) => [name, { enabled: false }]));
    parts.value = part(value);
    if (icon.enabled && nativeParts(id, base).includes("icon")) parts.icon = part(icon);
    if (readout.parts?.symbols) parts.symbols = readout.parts.symbols;
    const assets = Object.fromEntries((["digits", "icon", "symbols"] as const).flatMap((role) => (readout.assets?.[role] ? [[role, readout.assets[role]]] : [])));
    next = { ...next, nativeData: { ...next.nativeData, [id]: { ...base, enabled: true, x, y, scale, color: readout.color, fontFamily: readout.fontFamily, parts, assets } },
      removedLayerIds: (next.removedLayerIds ?? []).filter((l) => l !== `native:${id}`) };
    return next;
  }
  // Steps, calories, elevation and heart rate are Studio's fixed metrics: a number only, set in the readout's digit
  // art, with the icon as an image layer (CorosLink's makeChartReadoutFixed, ef45e6e9, line for line).
  const metricId = twin.metric, label = nativeChartReadoutLabel(source);
  const digits = readout.assets?.digits;
  const iconArt = icon.enabled ? readout.assets?.icon?.["0"] : undefined;
  const resolution = pickPreviewResolution(details);
  // Generated digits are the metric's digit cell times its scale: match the readout's digit art.
  const cell = resolution ? watchfaceFixedMetricDigitSize(resolution, metricId) : null;
  const frameHeight = art?.digit ? art.digit.height * scale : value.height;
  // Studio previews metric scales below 0.5 at 0.5, so stay at or above it and let the glyph layout carry the digit
  // size: the copied ink keeps its height and sits where it sat in its frame.
  const metricScale = cell ? Math.max(0.5, Math.round((frameHeight / cell.height) * 100) / 100) : next.metricStyles?.[metricId]?.scale ?? 1;
  const cellHeight = cell ? cell.height * metricScale : frameHeight;
  // Numbers advance by digit PNG width; sprite spacing trims the borrowed cell to the readout's.
  const letterSpacing = cell && art?.digit
    ? Math.max(-0.35, Math.min(0.25, Math.round(((art.digit.width * scale - cell.width * metricScale) / cellHeight) * 1000) / 1000)) : undefined;
  const glyphLayout = art?.digit && art.ink ? {
    height: Math.round(((art.ink.height * frameHeight) / cellHeight) * 1000) / 1000,
    baseline: Math.round((0.5 + ((art.ink.baseline - 0.5) * frameHeight) / cellHeight) * 1000) / 1000,
  } : undefined;
  const sprites = digits && Array.from({ length: 10 }, (_, d) => digits[String(d)]).every(Boolean) ? digits : undefined;
  // An earlier font size would win over the scale measured from the readout.
  const metricStyles = { ...next.metricStyles, [metricId]: { ...next.metricStyles?.[metricId], fontSize: undefined, scale: metricScale,
    align: "center" as const, color: readout.color, fontFamily: sprites ? undefined : readout.fontFamily,
    ...(sprites && letterSpacing !== undefined ? { letterSpacing } : {}),
    rasterFont: sprites ? { label: `${label} chart digits`, dataUrl: "", glyphs: "0123456789", columns: 10,
      sprites: Object.fromEntries(Array.from({ length: 10 }, (_, d) => [String(d), sprites[String(d)]!])), tint: false,
      ...(glyphLayout ? { glyphLayout } : {}) } : undefined } };
  const designSprites = art?.icon && iconArt ? [...(next.designSprites ?? []), {
    id: art.spriteId, name: `${label} icon`, dataUrl: iconArt,
    sourceWidth: art.icon.width, sourceHeight: art.icon.height, width: art.icon.width, height: art.icon.height,
    x: Math.round(icon.x + (art.icon.width * scale) / 2), y: Math.round(icon.y + (art.icon.height * scale) / 2), scale, rotation: 0,
    opacity: 1, aspectLocked: true, origin: { x: 0.5, y: 0.5 }, visible: true,
  }] : next.designSprites;
  next = { ...next, metricStyles, designSprites, metricChanges: { ...next.metricChanges, [metricId]: true },
    removedLayerIds: (next.removedLayerIds ?? []).filter((l) => l !== metricId) };
  // Centre the number on the readout, now that it has its box.
  const placed = deriveEditorLayers(details, next).find((l) => l.metricId === metricId);
  if (placed?.bounds && placed.layoutGroupId) {
    const b = placed.bounds, group = placed.layoutGroupId;
    const dx = Math.round(value.x + value.width / 2 - (b.x0 + b.x1) / 2), dy = Math.round(value.y + value.height / 2 - (b.y0 + b.y1) / 2);
    const offset = next.layoutOffsets?.[group] ?? { dx: 0, dy: 0 };
    if (dx || dy) next = { ...next, layoutOffsets: { ...next.layoutOffsets, [group]: { dx: offset.dx + dx, dy: offset.dy + dy } } };
  }
  return next;
}

/**
 * Puts a readout back on its page. As in CorosLink, the field it became stays on the face: hide that layer if the
 * value shouldn't show twice.
 */
export function unfixChartReadout(design: Design, source: string): Design {
  const chart = chartOf(design);
  if (!chart?.removedReadouts?.includes(source)) return design;
  const removedReadouts = chart.removedReadouts.filter((s) => s !== source);
  const back: Style = { ...chart, removedReadouts };
  if (!removedReadouts.length) delete back.removedReadouts;
  return withChart(design, back);
}

/** The readouts shown on every page, with the page each came from. */
export function fixedChartReadouts(rows: ChartPageRow[]): { source: string; label: string; page: string }[] {
  return rows.flatMap((row) => row.readouts.filter((r) => r.state === "fixed").map((r) => ({ source: r.source, label: r.label, page: row.label })));
}
