// The Add library. Artwork (an image, text, shapes: baked into the face's picture, each click another one), the time
// and date parts Studio can add to a template without them (seconds, analog hands, weekday, month, day), the negative
// sign, an animation, and live data: every native field the watch firmware draws (CorosLink's watchfaceNativeCatalog), the
// chart pages, the status indicators and the battery icon Studio draws for a face that lacks them, and the template's
// own data layers the face hides. Each row becomes a real layer the engine composes and the archive build exports.
// Rewritten from CorosLink's WatchfaceAddMenu.tsx (its Live data list) and WatchfaceEditor.tsx (addNativeData,
// addChartPageFromAddMenu, addStatusIndicator, addDefaultBatteryIcon, restoreFirmwareLayer, addElement, chooseSprite,
// addSeconds, addDatePart, addAnalogHands, addNegativeSign, chooseAnimationFrames and their removals), keeping their rules.
import { msg, t } from "@/lib/i18n";
import type {
  CorosWatchfaceAnimation, CorosWatchfaceArtwork, CorosWatchfaceBackgroundElement, CorosWatchfaceDesignSprite,
  CorosWatchfaceNativeDataStyle, CorosWatchfaceTemplateDetails,
} from "../watchface/types";
import {
  NATIVE_CHART_PAGES, NATIVE_DATA_FIELDS, nativeChartReadoutLabel, type NativeDataDefinition,
} from "../watchface/watchfaceNativeCatalog";
import { nativeDataSize } from "../watchface/engine/nativeData";
import { defaultNativeDataStyle } from "../watchface/engine/nativeDataParts";
import { addChartPage, chartReadoutPage, chartSourceOf } from "../watchface/engine/chartReadouts";
import { onChartPageIds, templateChartPages } from "../watchface/engine/templateChartPages";
import {
  ADDED_DATE_PART_FLAGS, ADDED_WEEKDAY_FALLBACK_FONT, canAddDatePart, configAssetCanUseNativeSize, configAssetDefaultsToNativeSize,
  controlStatusLayoutGroupId, isVirtualStandaloneStatusIconKey, pickPreviewResolution, templateHasSeconds, WATCHFACE_DATE_PARTS,
  watchfaceControlStatusPosition, type WatchfaceDatePartId,
} from "../watchface/engine/watchfaceStudio";
import { createBackgroundElement } from "../watchface/engine/watchfaceBackgroundElements";
import { resolveWatchfaceArtworkLayerOrder, watchfaceBackgroundElementLayerId, watchfaceSpriteLayerId } from "../watchface/engine/watchfaceArtworkLayers";
import { MAX_DESIGN_SPRITES } from "../watchface/engine/watchfaceBackground";
import { DEFAULT_ANIMATION_DELAY, MAX_ANIMATION_FRAMES, normalizeAnimationDelays } from "../watchface/engine/watchfaceAnimation";
import { watchfaceMasterPixelsFromDevice } from "../watchface/engine/watchfaceDimensions";
import { resolveWatchfaceModeDesign, writeWatchfaceModeDesign } from "../watchface/engine/watchfaceDisplayModes";
import type { WatchfaceDefaultAnalogKey } from "../watchface/engine/watchfaceAnalogHands";
import { deriveDesignDetails } from "../watchface/engine/watchfaceCompose";
import { setWatchfaceAutomationVisibility } from "../watchface/engine/watchfaceAutomationVisibility";
import { WATCHFACE_STATUS_GROUPS, watchfaceStatusGroupOf } from "../watchface/engine/watchfaceStatusPairs";
import type { CorosWatchfaceDesignState as Design } from "../watchface/types";
import { deriveEditorLayers, type EditorLayer } from "../watchface/engine/watchfaceEditorModel";
import type { WatchfacePreviewMode as Mode } from "../watchface/engine/watchfaceStudio";
import { faceLayers, groupOf, type EditorLayer as Row, type LayerGroup } from "./studioFace";
import { isSlotPart, showSlot, SLOT_LABEL, SLOT_LAYER } from "./studioSlot";

type Box = { x0: number; y0: number; x1: number; y1: number };
type Point = { x: number; y: number };
type Face = { width: number; height: number };

/** One row of the library. `layerId` is the layer it becomes (or already is) on the face. */
export interface LibraryItem {
  key: string;
  label: string;
  group: LayerGroup;
  icon: string;
  /** A sample of what it shows, for the tile. */
  sample?: string;
  added: boolean;
  layerId: string;
  /** "Experimental", "Not confirmed" or "Not available": the firmware caveat CorosLink marks. */
  tag?: string;
  /** The caveat in full, for the tile's tooltip. */
  hint?: string;
  /** Where the template puts it (a drop spot on the watch), master pixels. */
  bounds?: Box | null;
  /** Extra search words. */
  words: string;
  /** Several icons side by side in place of `icon`: a status indicator's states, in order. */
  icons?: string[];
  /** Artwork: every click adds another one, so the row is never ticked. */
  repeat?: boolean;
}

/** What the library needs from the face: its template (as the mode sees it), all its layers and the master size. */
export interface LibraryContext {
  details: CorosWatchfaceTemplateDetails;
  /** deriveEditorLayers' full list, template parts the face lacks included. */
  layers: EditorLayer[];
  face: Face;
  /** The display being edited; Current when absent. Seconds, date parts and an animation are added on Current only. */
  mode?: Mode;
  /** The watch's own width in pixels, for an imported image's size (one image pixel per watch pixel). */
  watchWidth?: number;
}

const CATEGORY_GROUP: Record<NativeDataDefinition["category"], LayerGroup> = {
  Calendar: "time", Weather: "weather", Astronomy: "weather", Health: "health", Training: "training", Charts: "charts",
};
const FIELD_ICON: Record<string, string> = {
  date_year: "cal", lunar_year: "moon", lunar_month: "moon", lunar_day: "moon", weather_temp: "sun", weather_temp_min: "sun",
  weather_wind: "wind", weather_direction: "wind", weather_rainfall: "rain", weather_humidity: "rain", weather_uv: "sun",
  weather_aqi: "cloud", baro: "gauge", week_tl: "flame", stamina: "bar", stress: "pulse", sleep_score: "bed",
  sleep_hrv_level: "heart", sedentary: "hand", sunriseset: "sun", chart_sun_angle: "sun",
};
const PAGE_ICON: Record<string, string> = { bars: "chart", sun: "sun", moon: "moon", "daily-a": "chart", "daily-b": "chart" };
const PAGE_LABEL: Record<string, string> = { bars: msg("Barometer and tide"), sun: msg("Sun"), moon: msg("Moon"), "daily-a": msg("Daily stats"), "daily-b": msg("Daily activity") };

/** The firmware caveat a field carries, short for the tile and whole for its tooltip. */
export function fieldCaveat(field: NativeDataDefinition): { tag?: string; hint?: string } {
  if (field.availability) return { tag: "Not available", hint: field.availability.message };
  if (field.kind === "chart") return { tag: "Experimental", hint: field.note };
  if (field.note && /not (yet )?confirmed|unverified|requires on-watch/i.test(field.note)) return { tag: "Not confirmed", hint: field.note };
  return field.note ? { hint: field.note } : {};
}

/** The chart pages the face shows, in Back order: its chart layer's readouts and bars, and the template's own pages. */
export function chartPagesOnFace(design: Design, details: CorosWatchfaceTemplateDetails): string[] {
  const on = new Set<string>();
  const chart = design.nativeData?.chart;
  if (chart?.enabled) {
    const sources = [chartSourceOf(chart), ...Object.keys(chart.readouts ?? {})].filter((s) => !chart.removedReadouts?.includes(s));
    for (const source of sources) { const page = chartReadoutPage(source); if (page) on.add(page); }
    if ((chart.chartStyle?.barWidth ?? 8) > 0) { on.add("barometer"); on.add("tide"); }
  }
  const master = pickPreviewResolution(details);
  if (master) for (const id of onChartPageIds(templateChartPages(master, design.chartPageModes ?? {}))) on.add(id);
  for (const [id, mode] of Object.entries(design.chartPageModes ?? {})) if (mode === "removed") on.delete(id);
  return NATIVE_CHART_PAGES.map((p) => p.id).filter((id) => on.has(id));
}

/** The Add tile of each status indicator: one per indicator, its states (airplane mode, sleep mode…) edited in its panel. */
const STATUS_ICON: Record<string, string> = { bluetooth: "bt", doNotDisturb: "moon" };
/** The states' icons, in the order WATCHFACE_STATUS_GROUPS lists them: on, off, then airplane or sleep mode. */
const STATUS_ICONS: Record<string, string[]> = { bluetooth: ["bt", "btOff", "plane"], doNotDisturb: ["moon", "moonOff", "bed"] };
const STATUS_HINT: Record<string, string> = {
  bluetooth: msg("On, off and airplane mode: one indicator, edited in its panel."),
  doNotDisturb: msg("On, off and sleep mode: one indicator, edited in its panel."),
};
const statusLayerId = (key: string) => `configAsset:config:${key}`;
const configKeyOf = (layer: EditorLayer) => layer.configAssetId?.startsWith("config:") ? layer.configAssetId.slice("config:".length) : undefined;

const LAYER_ICON: Partial<Record<EditorLayer["kind"], string>> = {
  time: "clock", seconds: "clock", date: "cal", weekday: "cal", separators: "line", battery: "battery", batteryIcon: "battery",
  controlBatteryIcon: "battery", complication: "gauge", metric: "pulse", weather: "sun", configAsset: "image", arcCut: "arc",
};
const METRIC_ICON: Record<string, string> = { heartRate: "heart", steps: "steps", calories: "flame", exercise: "timer", elevation: "mountain", floors: "mountain", temperature: "sun" };

/** What Add → Artwork offers. Baked into the face's picture: it doesn't change on the watch. */
export const ARTWORK_ROWS = [
  { kind: "image", label: msg("Image"), icon: "image", words: "picture photo png jpeg jpg webp artwork sprite" },
  { kind: "text", label: msg("Text"), icon: "text", words: "label words type artwork" },
  { kind: "rect", label: msg("Rectangle"), icon: "rect", words: "shape box square artwork" },
  { kind: "ellipse", label: msg("Ellipse"), icon: "ellipse", words: "shape circle oval round artwork" },
  { kind: "line", label: msg("Line"), icon: "minus", words: "shape rule divider stroke artwork" },
] as const;
export type ArtworkKind = (typeof ARTWORK_ROWS)[number]["kind"];

const HAND_KEYS: WatchfaceDefaultAnalogKey[] = ["time_hour_icon", "time_minute_icon", "time_second_icon", "time_center_polygon_icon2"];
const HAND_ASSETS = new Set(HAND_KEYS.map((key) => `config:${key}`));
/** The layer Analog hands selects once they're on the face. */
export const HOUR_HAND_LAYER = "configAsset:config:time_hour_icon";
export const NEGATIVE_SIGN_LAYER = "configAsset:config:negative_sign_icon";
const DATE_ROWS: Record<WatchfaceDatePartId, { label: string; sample: string }> = {
  weekday: { label: msg("Weekday"), sample: "TUE" }, dateMonth: { label: msg("Month"), sample: "11" }, dateDay: { label: msg("Day"), sample: "23" },
};

/** Whether Studio adds the seconds: on Current, on a template with none of its own. */
export function canAddSeconds(ctx: LibraryContext): boolean {
  const master = pickPreviewResolution(ctx.details);
  return (ctx.mode ?? "current") === "current" && !!master && !templateHasSeconds(master);
}

/** The date parts Studio adds (from the template's digits, the weekday from a font): on Current, where the template lacks them. */
export function addableDateParts(ctx: LibraryContext): WatchfaceDatePartId[] {
  const master = pickPreviewResolution(ctx.details);
  if ((ctx.mode ?? "current") !== "current" || !master) return [];
  return WATCHFACE_DATE_PARTS.filter((part) => canAddDatePart(master, part.id)).map((part) => part.id);
}

/** A seconds or date layer Studio added (not the template's own), which Remove takes off the face again. */
export function addedByStudio(design: Design, layerId: string, ctx: LibraryContext): boolean {
  if (layerId === "seconds") return !!design.addSeconds && canAddSeconds(ctx);
  const part = addableDateParts(ctx).find((id) => id === layerId);
  return !!part && design[ADDED_DATE_PART_FLAGS[part]] === true;
}

/**
 * Every row of the library for the face as the mode being edited has it. Native fields come from the catalog (minimum
 * and maximum temperature as one row, the chart as pages); template parts the face hides come back from here too.
 */
export function libraryItems(design: Design, ctx: LibraryContext): LibraryItem[] {
  const items: LibraryItem[] = [];
  const present = ctx.layers.filter((l) => l.present);
  const current = (ctx.mode ?? "current") === "current";
  const seconds = canAddSeconds(ctx), dateParts = addableDateParts(ctx);

  for (const row of ARTWORK_ROWS) {
    items.push({ key: `art:${row.kind}`, label: row.label, group: "basic", icon: row.icon, added: false, layerId: "", repeat: true, words: row.words });
  }

  // Time and date parts Studio makes for a template without them. Hidden with the eye, they come back from here.
  if (seconds) {
    items.push({ key: "time:seconds", label: msg("Seconds"), group: "time", icon: "clock", sample: ":42", layerId: "seconds",
      added: !!design.addSeconds && design.layerVisibility?.seconds !== false,
      hint: t("Uses the minute digits: this template has no seconds of its own."), words: "seconds time clock" });
  }
  items.push({ key: "time:analog", label: msg("Analog hands"), group: "time", icon: "clock", layerId: HOUR_HAND_LAYER,
    added: present.some((l) => l.visible && (l.configAssetId === "config:time_hour_icon" || l.configAssetId === "config:time_minute_icon")),
    hint: t("Hour, minute and second hands and a centre cap. Always-on gets no second hand."), words: "analog analogue hands hour minute second cap time clock" });
  for (const id of dateParts) {
    items.push({ key: `date:${id}`, label: DATE_ROWS[id].label, group: "time", icon: "cal", sample: DATE_ROWS[id].sample, layerId: id,
      added: design[ADDED_DATE_PART_FLAGS[id]] === true && design.layerVisibility?.[id] !== false, words: `${id} date calendar` });
  }

  // The template's own data layers (heart rate, steps, date, the selectable slot…), shown or not. A metric the
  // template implements but doesn't show has no box yet (present is false), and still belongs here.
  for (const l of ctx.layers.filter((y) => y.present || (y.metricId && y.kind !== "battery"))) {
    if (!l.canHide || l.kind === "background" || l.nativeDataId) continue;
    // Artwork and the animation stay in Layers; the parts Studio adds have their own rows above.
    if (l.spriteId || l.backgroundElementId || l.animation || (l.id === "seconds" && seconds) || dateParts.some((id) => id === l.id) || HAND_ASSETS.has(l.configAssetId ?? "")) continue;
    if (l.id === NEGATIVE_SIGN_LAYER && !l.present) continue;
    // The selectable slot has its own row below; its pieces are edited in its panel.
    if (l.kind === SLOT_LAYER || isSlotPart(l)) continue;
    const group = groupOf(l);
    // Once shown, only data stays listed (ticked): the clock, separators and images are in Layers.
    const data = !!l.metricId || ["complication", "weather", "battery", "batteryIcon", "controlBatteryIcon"].includes(l.kind);
    if (group === "background" || (l.visible && !data)) continue;
    // Each status indicator is one tile, below, however many state images it has.
    if (watchfaceStatusGroupOf(configKeyOf(l))) continue;
    items.push({
      key: `layer:${l.id}`, label: l.label, group,
      icon: (l.metricId && METRIC_ICON[l.metricId]) || (LAYER_ICON[l.kind] ?? "rect"),
      added: l.visible, layerId: l.id, bounds: l.bounds ?? hiddenMetricBounds(design, ctx, l), words: `${l.id} ${l.metricId ?? ""} ${l.kind}`,
    });
  }

  // The selectable slot: the one place whose data the wearer picks on the watch. A template without one gets
  // Studio's (the engine writes `rect_control1_pos` and the types' keys); always-on only has the template's own.
  const slot = ctx.layers.find((l) => l.kind === SLOT_LAYER);
  if (slot && (current || slot.present)) {
    items.push({ key: "slot", label: SLOT_LABEL, group: "activity", icon: "gauge", sample: "96", added: slot.present && slot.visible, layerId: slot.id,
      bounds: slot.present && !slot.visible ? slot.bounds : null, hint: t("One place whose data the wearer picks in the watch's face settings."),
      words: "selectable metric slot complication control wearer picks chooses data chosen on watch" });
  }

  // Native data, every field the catalog knows.
  for (const field of NATIVE_DATA_FIELDS) {
    if (field.kind === "chart" || field.id === "weather_temp_max") continue;
    const pair = field.id === "weather_temp_min";
    const style = design.nativeData?.[field.id];
    const added = !!style?.enabled && (!pair || !!design.nativeData?.weather_temp_max?.enabled);
    items.push({
      key: `native:${field.id}`, label: pair ? msg("Min / max temperature") : field.label, group: CATEGORY_GROUP[field.category],
      icon: FIELD_ICON[field.id] ?? (field.category === "Training" ? "watch" : "gauge"),
      sample: pair ? "12/24°" : field.kind === "state" ? undefined : `${field.sample}${field.unit ?? ""}`,
      added, layerId: `native:${field.id}`, ...fieldCaveat(field),
      words: `${field.id} ${field.category}${pair ? " weather_temp_max minimum maximum low high" : ""}`,
    });
  }

  // Charts, a page at a time: each is a screen the watch's Back button steps to.
  const pages = new Set(chartPagesOnFace(design, ctx.details));
  for (const page of ["bars", "sun", "moon", "daily-a", "daily-b"]) {
    const def = NATIVE_CHART_PAGES.find((p) => p.id === page);
    const sources = page === "bars" ? ["chart_baro", "chart_tide"] : [...(def?.sources ?? [])];
    items.push({
      key: `chart:${page}`, label: PAGE_LABEL[page], group: "charts", icon: PAGE_ICON[page], added: pages.has(page === "bars" ? "barometer" : page),
      layerId: "native:chart", tag: "Experimental",
      hint: `${page === "bars" ? t("Bars") : page === "sun" || page === "moon" ? t("Line") : t("No graph")} · ${sources.map((x) => t(nativeChartReadoutLabel(x))).join(", ")}${page === "bars" ? ` · ${t("two pages, needs phone data")}` : ""}`,
      words: `chart page ${sources.join(" ")} ${sources.map(nativeChartReadoutLabel).join(" ")}`,
    });
  }

  // Status indicators: one tile each (Bluetooth with airplane mode, Do Not Disturb with sleep mode). On a face with any
  // of its images the tile is the template's indicator (ticked when shown); without, Studio draws one.
  for (const group of WATCHFACE_STATUS_GROUPS) {
    const words = `${group.states.map((st) => `${st.key} ${st.label}`).join(" ")} status indicator`;
    const tile = { label: group.label, group: "device" as const, icon: STATUS_ICON[group.id] ?? "bt", icons: STATUS_ICONS[group.id], hint: STATUS_HINT[group.id], words };
    const on = present.filter((l) => l.kind === "configAsset" && group.states.some((st) => st.key === configKeyOf(l)));
    if (on.length) {
      const shown = on.find((l) => l.visible);
      const layer = shown ?? on.find((l) => configKeyOf(l) === group.primary) ?? on[0];
      items.push({ ...tile, key: `layer:${layer.id}`, added: !!shown, layerId: layer.id, bounds: layer.bounds });
      continue;
    }
    const layer = ctx.layers.find((l) => l.id === statusLayerId(group.primary));
    if (layer && isVirtualStandaloneStatusIconKey(group.primary)) items.push({ ...tile, key: `status:${group.primary}`, added: false, layerId: layer.id });
  }
  // The minus the watch puts before negative and missing values, on a template without one.
  if (!present.some((l) => l.id === NEGATIVE_SIGN_LAYER)) {
    items.push({ key: "sign", label: msg("Negative sign"), group: "device", icon: "minus", added: false, layerId: NEGATIVE_SIGN_LAYER,
      hint: t("The minus the watch draws before negative and missing values."), words: "negative_sign_icon minus dash temperature" });
  }
  // A face without an animation makes one from a folder of PNG frames. Always-on never animates.
  if (current && !design.animation?.frames.length) {
    items.push({ key: "animation", label: msg("Animation"), group: "device", icon: "spark", added: false, layerId: "animation",
      hint: t("A folder of PNG frames, up to {max}, all one size. Plays while the face is lit.", { max: MAX_ANIMATION_FRAMES }), words: "animation frames gif motion" });
  }
  const battery = ctx.layers.find((l) => l.id === "batteryIcon");
  if (battery && !battery.present && !design.configAssetOverrides?.["config:battery_icon"]?.replacement &&
    !Object.keys(design.configAssetOverrides?.["config:battery_icon"]?.stateReplacements ?? {}).length) {
    items.push({ key: "battery", label: msg("Battery icon"), group: "device", icon: "battery", added: false, layerId: "batteryIcon", words: "battery_icon level charge" });
  }
  return items;
}

/** Where the template draws a metric it implements but the face hides: its box once shown. */
function hiddenMetricBounds(design: Design, ctx: LibraryContext, layer: EditorLayer): Box | null {
  if (!layer.metricId || layer.visible) return null;
  const shown = { ...design, metricChanges: { ...design.metricChanges, [layer.metricId]: true } };
  // Only this layer's box is wanted: the other hidden metrics' boxes would each be one more derivation.
  return deriveEditorLayers(ctx.details, shown, { hiddenBounds: false }).find((l) => l.id === layer.id)?.bounds ?? null;
}

/** Rows matching a search, by label, group or the words they carry. */
export function searchLibrary(items: LibraryItem[], query: string): LibraryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const parts = q.split(/\s+/);
  return items.filter((i) => { const text = `${i.label} ${t(i.label)} ${i.group} ${i.words} ${i.tag ?? ""}`.toLowerCase(); return parts.every((p) => text.includes(p)); });
}

// ───── Placing ─────

const overlaps = (a: Box, b: Box, gap: number) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * A top-left corner for a `size` box: the given centre, or the free spot nearest the middle of the round screen
 * that keeps clear of what's on the face, inside the dial. The middle when nothing is free.
 */
export function freeSpot(size: Face, face: Face, taken: Box[], at?: Point): Point {
  const clamp = (p: Point) => ({ x: Math.round(Math.max(0, Math.min(face.width - size.width, p.x))), y: Math.round(Math.max(0, Math.min(face.height - size.height, p.y))) });
  if (at) return clamp({ x: at.x - size.width / 2, y: at.y - size.height / 2 });
  const cx = face.width / 2, cy = face.height / 2, radius = Math.min(cx, cy) * 0.9;
  const step = Math.max(8, Math.round(face.width / 40));
  const spots: (Point & { d: number })[] = [];
  for (let y = 0; y + size.height <= face.height; y += step) {
    for (let x = 0; x + size.width <= face.width; x += step) {
      const corners = [[x, y], [x + size.width, y], [x, y + size.height], [x + size.width, y + size.height]];
      if (!corners.every(([px, py]) => Math.hypot(px - cx, py - cy) <= radius)) continue;
      spots.push({ x, y, d: Math.hypot(x + size.width / 2 - cx, y + size.height / 2 - cy) });
    }
  }
  spots.push({ x: Math.round(cx - size.width / 2), y: Math.round(cy - size.height / 2), d: -1 });
  spots.sort((a, b) => a.d - b.d);
  const gap = Math.round(face.width / 100);
  const free = spots.find((s) => !taken.some((b) => overlaps({ x0: s.x, y0: s.y, x1: s.x + size.width, y1: s.y + size.height }, b, gap)));
  return clamp(free ?? { x: cx - size.width / 2, y: cy - size.height / 2 });
}

const takenBy = (layers: EditorLayer[]): Box[] => layers.filter((l) => l.visible && l.bounds && l.kind !== "background").map((l) => l.bounds!);
const unremoved = (design: Design, ...ids: string[]) => (design.removedLayerIds ?? []).filter((id) => !ids.includes(id));

/**
 * Adds the selectable slot (studioSlot's showSlot), at `at` when dropped. A slot Studio makes for a template without
 * one starts under the middle of the dial; when that is taken it goes to the free spot nearest the middle.
 */
export function addSlotField(design: Design, ctx: LibraryContext, at?: Point): Design {
  const mode = ctx.mode ?? "current";
  let next = showSlot(design, ctx.details, mode);
  const shown = deriveEditorLayers(ctx.details, next).find((l) => l.kind === SLOT_LAYER);
  const b = shown?.bounds;
  if (!shown || !b) return next;
  const own = ctx.layers.find((l) => l.kind === SLOT_LAYER)?.present;
  const o = next.layoutOffsets?.[SLOT_LAYER] ?? { dx: 0, dy: 0 };
  const size = { width: b.x1 - b.x0, height: b.y1 - b.y0 };
  const taken = takenBy(ctx.layers);
  const target = at ? { x: at.x - size.width / 2, y: at.y - size.height / 2 }
    : !own && taken.some((t) => overlaps(b, t, 0)) ? freeSpot(size, ctx.face, taken) : null;
  if (target) next = { ...next, layoutOffsets: { ...next.layoutOffsets, [SLOT_LAYER]: { dx: Math.round(o.dx + target.x - b.x0), dy: Math.round(o.dy + target.y - b.y0) } } };
  return next;
}

/** Adds a native field (minimum and maximum together: the watch draws neither alone) at `at` or a free spot. */
export function addNativeField(design: Design, id: string, ctx: LibraryContext, at?: Point): Design {
  const ids = id === "weather_temp_min" || id === "weather_temp_max" ? ["weather_temp_min", "weather_temp_max"] : [id];
  let next = design;
  let taken = takenBy(ctx.layers);
  for (const each of ids) {
    const previous = next.nativeData?.[each];
    if (previous?.enabled && each !== id) continue;
    const initial = { ...defaultNativeDataStyle(each), ...previous, enabled: true };
    const size = nativeDataSize(each, initial);
    const keep = previous && !at;
    const spot = keep ? { x: previous.x, y: previous.y } : freeSpot(size, ctx.face, taken, each === ids[0] ? at : undefined);
    taken = [...taken, { x0: spot.x, y0: spot.y, x1: spot.x + size.width, y1: spot.y + size.height }];
    next = {
      ...next,
      // Current weather takes the weather icon's temperature over.
      ...(each === "weather_temp" && next.weatherIndicator ? { weatherIndicator: { ...next.weatherIndicator, temperatureEnabled: false } } : {}),
      nativeData: { ...next.nativeData, [each]: { ...initial, x: spot.x, y: spot.y } },
      removedLayerIds: unremoved(next, `native:${each}`),
    };
  }
  return next;
}

/**
 * Adds a chart page. On a face with a chart, the page's required readouts join it (a template page the face took off
 * comes back); otherwise a chart starts with that page. A new chart draws bars, which brings the barometer and tide
 * pages, so a chart started from another page turns them off.
 */
export function addChartPageField(design: Design, page: string, ctx: LibraryContext, at?: Point): Design {
  const chart = design.nativeData?.chart;
  const modes = { ...design.chartPageModes };
  const bars = page === "bars";
  for (const id of bars ? ["barometer", "tide"] : [page]) delete modes[id];
  const chartPageModes = Object.keys(modes).length ? modes : undefined;
  if (chart?.enabled) {
    const next = bars
      ? { ...chart, chartStyle: { ...chart.chartStyle, barWidth: chart.chartStyle?.barWidth || 8, barGap: chart.chartStyle?.barGap || 4 } }
      : addChartPage(chart, page, ctx.face);
    return { ...design, chartPageModes, nativeData: { ...design.nativeData, chart: next } };
  }
  const def = NATIVE_CHART_PAGES.find((p) => p.id === (bars ? "barometer" : page));
  const first = bars ? "chart_baro" : def?.required[0] ?? def?.sources[0];
  if (!first) return design;
  const base = { ...defaultNativeDataStyle("chart"), ...chart, enabled: true, chartSource: first };
  const size = nativeDataSize("chart", base);
  const spot = freeSpot(size, ctx.face, takenBy(ctx.layers), at);
  let style: CorosWatchfaceNativeDataStyle = { ...base, x: spot.x, y: spot.y, ...(bars ? {} : { chartStyle: { ...base.chartStyle, barWidth: 0 } }) };
  if (!bars) style = addChartPage(style, page, ctx.face);
  return { ...design, chartPageModes, nativeData: { ...design.nativeData, chart: style }, removedLayerIds: unremoved(design, "native:chart") };
}

/** Turns a template layer the face hides back on, the way the Layers panel's eye does, and moves it to `at`. */
export function restoreTemplateLayer(design: Design, layer: EditorLayer, details: CorosWatchfaceTemplateDetails, mode: Mode, at?: Point): Design {
  let next = layer.visible ? design : setWatchfaceAutomationVisibility(design, details, mode, layer.id, true);
  next = { ...next, removedLayerIds: unremoved(next, layer.id) };
  // A metric gets its box once it shows; `details` is the template as the mode sees it.
  const shown = deriveEditorLayers(details, next).find((l) => l.id === layer.id) ?? layer;
  if (at && shown.bounds && shown.layoutGroupId && shown.capabilities.position) {
    const b = shown.bounds, o = next.layoutOffsets?.[shown.layoutGroupId] ?? { dx: 0, dy: 0 };
    next = { ...next, layoutOffsets: { ...next.layoutOffsets, [shown.layoutGroupId]: {
      dx: Math.round(o.dx + at.x - (b.x0 + b.x1) / 2), dy: Math.round(o.dy + at.y - (b.y0 + b.y1) / 2) } } };
  }
  return next;
}

/**
 * Adds a Bluetooth, Do Not Disturb, airplane or sleep image the template lacks, with Studio's artwork (drawn by the
 * page: watchfaceDefaultIndicators). An indicator group already on the face stays where it is; otherwise the image goes
 * to `at`, or stays at the template's fallback when that's inside the dial and clear of other layers, or moves to its
 * default spot.
 */
export function addStatusField(design: Design, key: string, artwork: CorosWatchfaceArtwork, ctx: LibraryContext, at?: Point,
  defaultSpot?: (groupId: string, master: Face, size: Face) => Point): Design {
  const groupId = controlStatusLayoutGroupId(key);
  const id = `config:${key}`;
  if (!groupId) return design;
  const override = { ...design.configAssetOverrides?.[id], enabled: true, replacement: artwork,
    ...(configAssetDefaultsToNativeSize(key) ? { nativeSize: configAssetCanUseNativeSize(key, false) } : {}) };
  const next: Design = { ...design, configAssetOverrides: { ...design.configAssetOverrides, [id]: override }, removedLayerIds: unremoved(design, statusLayerId(key)) };
  if (ctx.layers.some((l) => l.layoutGroupId === groupId && l.present && l.visible)) return next;
  const master = pickPreviewResolution(deriveDesignDetails(ctx.details, next).previewDetails);
  const placed = master ? watchfaceControlStatusPosition(master, key)?.position : null;
  if (!master || !placed) return next;
  const radius = Math.min(master.width, master.height) / 2;
  const inside = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([fx, fy]) =>
    Math.hypot(placed.x + fx * artwork.width - master.width / 2, placed.y + fy * artwork.height - master.height / 2) <= radius);
  // The template's fallback spot can sit under other data (PACE Pro's blank template puts Bluetooth on heart rate).
  const box = { x0: placed.x, y0: placed.y, x1: placed.x + artwork.width, y1: placed.y + artwork.height };
  const clear = !takenBy(ctx.layers).some((b) => overlaps(box, b, 0));
  if (inside && clear && !at) return next;
  const target = at ? { x: at.x - artwork.width / 2, y: at.y - artwork.height / 2 } : defaultSpot?.(groupId, master, artwork) ?? placed;
  const current = next.layoutOffsets?.[groupId] ?? { dx: 0, dy: 0 };
  return { ...next, layoutOffsets: { ...next.layoutOffsets, [groupId]: { dx: Math.round(current.dx + target.x - placed.x), dy: Math.round(current.dy + target.y - placed.y) } } };
}

/** A twelve-state battery icon (COROS order: charging, empty, 10–100 %) for a template without one. */
export function addBatteryField(design: Design, states: Record<string, CorosWatchfaceArtwork>): Design {
  return {
    ...design,
    configAssetOverrides: { ...design.configAssetOverrides, "config:battery_icon": { ...design.configAssetOverrides?.["config:battery_icon"], enabled: true, stateReplacements: states } },
    layerVisibility: { ...design.layerVisibility, batteryIcon: true },
    removedLayerIds: unremoved(design, "batteryIcon"),
  };
}

// ───── Artwork: text, shapes and images ─────

/**
 * Where a layer just put on the face should move: centred on `at`, or (when it lies on other layers) to the free spot
 * nearest the middle. Nothing when it is clear where it is.
 */
function shiftFor(next: Design, layerId: string, ctx: LibraryContext, at?: Point): { dx: number; dy: number } {
  const layers = faceLayers(ctx.details, next);
  const b = layers.find((l) => l.id === layerId)?.bounds;
  if (!b) return { dx: 0, dy: 0 };
  const others = takenBy(layers.filter((l) => l.id !== layerId));
  if (!at && !others.some((o) => overlaps(b, o, 0))) return { dx: 0, dy: 0 };
  const spot = freeSpot({ width: b.x1 - b.x0, height: b.y1 - b.y0 }, ctx.face, others, at);
  return { dx: Math.round(spot.x - b.x0), dy: Math.round(spot.y - b.y0) };
}

const withElement = (design: Design, element: CorosWatchfaceBackgroundElement): Design => ({
  ...design,
  backgroundElements: [...(design.backgroundElements ?? []).filter((e) => e.id !== element.id), element],
  artworkLayerOrder: [...resolveWatchfaceArtworkLayerOrder(design).filter((id) => id !== watchfaceBackgroundElementLayerId(element.id)), watchfaceBackgroundElementLayerId(element.id)],
});
const withSprite = (design: Design, sprite: CorosWatchfaceDesignSprite): Design => ({
  ...design,
  designSprites: [...(design.designSprites ?? []).filter((s) => s.id !== sprite.id), sprite],
  artworkLayerOrder: [...resolveWatchfaceArtworkLayerOrder(design).filter((id) => id !== watchfaceSpriteLayerId(sprite.id)), watchfaceSpriteLayerId(sprite.id)],
});

/**
 * A new text, rectangle, ellipse or line with CorosLink's defaults, in the face's font, at `at` or the free spot
 * nearest the middle. Made once, outside the undo step, so the layer keeps one id however often the step is replayed.
 */
export function newShape(design: Design, kind: CorosWatchfaceBackgroundElement["kind"], ctx: LibraryContext, at?: Point): CorosWatchfaceBackgroundElement {
  const element = createBackgroundElement(kind, { x: ctx.face.width / 2, y: ctx.face.height / 2 }, design.fontFamily);
  const { dx, dy } = shiftFor(withElement(design, element), watchfaceBackgroundElementLayerId(element.id), ctx, at);
  return { ...element, x: element.x + dx, y: element.y + dy };
}

/** Puts a shape made by newShape on the face, in front of the other artwork. Its layer is `bgel:<id>`. */
export const addShape = withElement;
export const shapeLayerId = watchfaceBackgroundElementLayerId;

/**
 * A picture as a free image layer: one of its pixels per watch pixel (so its size on the 800 master is scaled up),
 * shrunk to fit when it is larger than the face, at `at` or the free spot nearest the middle.
 */
export function newImage(design: Design, art: CorosWatchfaceArtwork, id: string, ctx: LibraryContext, at?: Point): CorosWatchfaceDesignSprite {
  if ((design.designSprites ?? []).length >= MAX_DESIGN_SPRITES) throw new Error(t("A face can hold up to {max} imported images.", { max: MAX_DESIGN_SPRITES }));
  const width = watchfaceMasterPixelsFromDevice(art.width, ctx.face.width, ctx.watchWidth ?? ctx.face.width);
  const height = watchfaceMasterPixelsFromDevice(art.height, ctx.face.width, ctx.watchWidth ?? ctx.face.width);
  const sprite: CorosWatchfaceDesignSprite = {
    id, dataUrl: art.dataUrl, sourceWidth: art.width, sourceHeight: art.height, width, height,
    x: Math.round(ctx.face.width / 2), y: Math.round(ctx.face.height / 2),
    scale: Math.min(1, ctx.face.width / width, ctx.face.height / height), rotation: 0, opacity: 1, flipX: false, flipY: false, skewX: 0, skewY: 0,
    aspectLocked: true, crop: { x: 0, y: 0, width: 1, height: 1 }, origin: { x: 0.5, y: 0.5 }, visible: true, tintColor: null,
  };
  const { dx, dy } = shiftFor(withSprite(design, sprite), watchfaceSpriteLayerId(id), ctx, at);
  return { ...sprite, x: sprite.x + dx, y: sprite.y + dy };
}

/** Puts an image made by newImage on the face, in front of the other artwork. Its layer is `sprite:<id>`. */
export const addImage = withSprite;
export const imageLayerId = watchfaceSpriteLayerId;

// ───── Time and date parts Studio adds ─────

/** Moves a layout group so its layer is centred on `at`, or off the layers it landed on. */
function settle(next: Design, layerId: string, ctx: LibraryContext, at?: Point): Design {
  const layer = faceLayers(ctx.details, next).find((l) => l.id === layerId);
  if (!layer?.layoutGroupId || !layer.capabilities.position) return next;
  const { dx, dy } = shiftFor(next, layerId, ctx, at);
  if (!dx && !dy) return next;
  const o = next.layoutOffsets?.[layer.layoutGroupId] ?? { dx: 0, dy: 0 };
  return { ...next, layoutOffsets: { ...next.layoutOffsets, [layer.layoutGroupId]: { dx: o.dx + dx, dy: o.dy + dy } } };
}
const without = <T,>(record: Record<string, T> | undefined, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record ?? {}).filter(([k]) => k !== key));

/**
 * Seconds on a template without them: the engine draws them with the minute digits, under the minutes, and they start
 * at half the minutes' size. Adding again brings back seconds hidden with the eye.
 */
export function addSeconds(design: Design, ctx: LibraryContext, at?: Point): Design {
  if (!canAddSeconds(ctx)) return design;
  const fresh = !design.addSeconds;
  const next: Design = {
    ...design, addSeconds: true, layerVisibility: without(design.layerVisibility, "seconds"),
    timeStyles: { ...design.timeStyles, seconds: design.timeStyles?.seconds ?? { scale: 0.5 } },
    removedLayerIds: unremoved(design, "seconds"),
  };
  return fresh || at ? settle(next, "seconds", ctx, at) : next;
}

/** Takes Studio's seconds off again, with their style and place. */
export function removeSeconds(design: Design): Design {
  return { ...design, addSeconds: false, timeStyles: without(design.timeStyles, "seconds") as Design["timeStyles"],
    layoutOffsets: without(design.layoutOffsets, "seconds"), layerVisibility: without(design.layerVisibility, "seconds") };
}

/**
 * Weekday, month or day on a template without it. Month and day use a digit folder the template has; the weekday has
 * no label artwork to borrow, so it is drawn from the face's font (Arial when the face names none).
 */
export function addDatePart(design: Design, part: WatchfaceDatePartId, ctx: LibraryContext, at?: Point): Design {
  if (!addableDateParts(ctx).includes(part)) return design;
  const flag = ADDED_DATE_PART_FLAGS[part];
  const fresh = design[flag] !== true;
  const weekday = design.dateStyles?.weekday;
  const next: Design = {
    ...design, [flag]: true, layerVisibility: without(design.layerVisibility, part), removedLayerIds: unremoved(design, part),
    ...(part === "weekday" && !weekday?.fontFamily
      ? { dateStyles: { ...design.dateStyles, weekday: { scale: 1, ...weekday, fontFamily: design.fontFamily || ADDED_WEEKDAY_FALLBACK_FONT, nativeSize: true } } } : {}),
  };
  return fresh || at ? settle(next, part, ctx, at) : next;
}

export function removeDatePart(design: Design, part: WatchfaceDatePartId): Design {
  return { ...design, [ADDED_DATE_PART_FLAGS[part]]: false, dateStyles: without(design.dateStyles, part) as Design["dateStyles"],
    layoutOffsets: without(design.layoutOffsets, part), layerVisibility: without(design.layerVisibility, part) };
}

/**
 * Analog hands, on the whole face (`root`), from the display being edited. Hands the template has are switched back
 * on as they are; the others get Studio's artwork (`render`, drawn by the page in the display's own colours). Added on
 * Current, the always-on layout gets hour and minute hands and the cap too, and no second hand: it refreshes once a
 * minute. `details` is the template with the face's config edits, not narrowed to a display.
 */
export function addAnalogHands(root: Design, mode: Mode, details: CorosWatchfaceTemplateDetails,
  render: (design: Design) => Record<WatchfaceDefaultAnalogKey, CorosWatchfaceArtwork>): Design {
  const master = pickPreviewResolution(details);
  if (!master) return root;
  const withHands = (design: Design, config: Record<string, string>, keys: WatchfaceDefaultAnalogKey[]): Design => {
    let artwork: Record<WatchfaceDefaultAnalogKey, CorosWatchfaceArtwork> | undefined;
    const overrides = { ...design.configAssetOverrides };
    for (const key of keys) {
      const id = `config:${key}`;
      const own = /\.png$/i.test(config[key]?.trim() ?? "");
      overrides[id] = own || overrides[id]?.replacement ? { ...overrides[id], enabled: true } : { enabled: true, replacement: (artwork ??= render(design))[key] };
    }
    return { ...design, configAssetOverrides: overrides, removedLayerIds: unremoved(design, ...keys.map((key) => `configAsset:config:${key}`)) };
  };
  let next = writeWatchfaceModeDesign(root, mode, withHands(resolveWatchfaceModeDesign(root, mode), mode === "aod" ? master.aodConfig : master.config, HAND_KEYS));
  if (mode === "current" && next.modeDesigns?.aod) {
    const aod = withHands(resolveWatchfaceModeDesign(next, "aod"), master.aodConfig, HAND_KEYS.filter((key) => key !== "time_second_icon"));
    next = { ...next, modeDesigns: { ...next.modeDesigns, aod: { ...next.modeDesigns.aod, configAssetOverrides: aod.configAssetOverrides, removedLayerIds: aod.removedLayerIds } } };
  }
  return next;
}

/** The minus sign's size on a face `width` wide (CorosLink's 14 × 6 at 800); the page fills it with the digit colour. */
export const negativeSignSize = (width: number): Face => ({ width: Math.max(1, Math.round(width * 14 / 800)), height: Math.max(1, Math.round(width * 6 / 800)) });

/** A negative sign on a template without one, with Studio's artwork. */
export function addNegativeSign(design: Design, artwork: CorosWatchfaceArtwork): Design {
  return {
    ...design,
    configAssetOverrides: { ...design.configAssetOverrides, "config:negative_sign_icon": { enabled: true, replacement: artwork } },
    removedLayerIds: unremoved(design, NEGATIVE_SIGN_LAYER),
  };
}

// ───── Animation ─────

/**
 * An animation from frames already read (importAnimationFrames: up to 44 PNGs of one size, in master pixels), centred
 * on `at` or on the face. A face that had frames keeps their place, and their timing when the count matches.
 */
export function addAnimation(design: Design, imported: { frames: string[]; width: number; height: number }, ctx: LibraryContext, at?: Point): Design {
  if (!imported.frames.length) return design;
  const previous = design.animation;
  const keep = !!previous?.frames.length && !at;
  const centre = at ?? { x: ctx.face.width / 2, y: ctx.face.height / 2 };
  const animation: CorosWatchfaceAnimation = {
    enabled: true,
    x: keep ? previous!.x : Math.round(centre.x - imported.width / 2),
    y: keep ? previous!.y : Math.round(centre.y - imported.height / 2),
    ...imported,
    delays: previous && previous.delays.length === imported.frames.length ? previous.delays
      : normalizeAnimationDelays([previous?.delays[0] ?? DEFAULT_ANIMATION_DELAY], imported.frames.length),
  };
  return { ...design, animation, removedLayerIds: unremoved(design, "animation") };
}

// ───── Taking things off again ─────

/** The live data fields a delete takes off: minimum and maximum temperature go together (the watch draws neither alone). */
function nativeIdsOf(design: Design, layer: EditorLayer): string[] {
  const id = layer.nativeDataId;
  // The chart has its own pages to see to (its panel hides it).
  if (!id || id === "chart" || !design.nativeData?.[id]) return [];
  return id === "weather_temp_min" || id === "weather_temp_max" ? ["weather_temp_min", "weather_temp_max"] : [id];
}

/** Whether Remove applies: artwork, live data from Add, and the seconds and date parts Studio added. Everything else hides. */
export function canRemove(design: Design, layer: EditorLayer, ctx: LibraryContext): boolean {
  return !!layer.spriteId || !!layer.backgroundElementId || nativeIdsOf(design, layer).length > 0 || addedByStudio(design, layer.id, ctx);
}

/** Removes a layer the way the Layers row's trash and the Delete key do: unlocked first (CorosLink's "Unlock and delete"). */
export function deleteLayer(design: Design, layer: Row, ctx: LibraryContext): Design {
  if (!canRemove(design, layer, ctx)) return design;
  const ids = layer.spot ? layer.spot.states.map((s) => s.layer.id) : [layer.id];
  return removeLayer(design.lockedLayerIds ? { ...design, lockedLayerIds: design.lockedLayerIds.filter((id) => !ids.includes(id)) } : design, layer, ctx);
}

export function removeLayer(design: Design, layer: EditorLayer, ctx: LibraryContext): Design {
  if (layer.spriteId) {
    return { ...design, designSprites: (design.designSprites ?? []).filter((s) => s.id !== layer.spriteId),
      artworkLayerOrder: design.artworkLayerOrder?.filter((id) => id !== layer.id), lockedLayerIds: design.lockedLayerIds?.filter((id) => id !== layer.id) };
  }
  if (layer.backgroundElementId) {
    return { ...design, backgroundElements: (design.backgroundElements ?? []).filter((e) => e.id !== layer.backgroundElementId),
      artworkLayerOrder: design.artworkLayerOrder?.filter((id) => id !== layer.id), lockedLayerIds: design.lockedLayerIds?.filter((id) => id !== layer.id) };
  }
  const native = nativeIdsOf(design, layer);
  if (native.length) {
    const nativeData = { ...design.nativeData };
    for (const id of native) delete nativeData[id];
    return { ...design, nativeData, lockedLayerIds: design.lockedLayerIds?.filter((id) => !native.some((n) => id === `native:${n}`)) };
  }
  if (!addedByStudio(design, layer.id, ctx)) return design;
  return layer.id === "seconds" ? removeSeconds(design) : removeDatePart(design, layer.id as WatchfaceDatePartId);
}
