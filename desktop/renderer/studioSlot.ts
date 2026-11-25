// The selectable data slot: the one place on a face whose content the wearer picks in the watch's face settings
// (`rect_control1_pos` and the `control_*` keys under it). The designer decides which data types the slot offers; each
// type has its own icon, and they all share the value digits, a colon, a minus sign and a tint. Rewritten from
// CorosLink's WatchfaceEditor.tsx (renderComplicationPicker, setControlComplicationEnabled, renderSelectableSlotIcon,
// renderSelectableSlotSharedAssets, renderControlBatteryInspector), writing the design fields its editor writes, so the
// engine builds the same config: a type that is off has every one of its keys deleted, one that is on gets the keys it
// needs. Pure functions over the design; the panel is parts/StudioSlot.tsx.
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import {
  CONTROL_DATE_COMPLICATION, getAvailableComplications, hasControlComplication, isControlComplicationEnabled, parseConfigPos, pickPreviewResolution,
  WATCHFACE_COMPLICATIONS, watchfaceComplicationChoices, type WatchfaceComplicationDefinition, type WatchfaceComplicationId,
} from "../watchface/engine/watchfaceStudio";
import { deriveDesignDetails } from "../watchface/engine/watchfaceCompose";
import { isSelectableSlotConfigAssetKey } from "../watchface/engine/watchfaceSpritePreview";
import type { Design, EditorLayer, Mode } from "./studioFace";

/** The slot's layer, and the key the editor's screen state keeps the barometer trend being looked at under. */
export const SLOT_LAYER = "complication";
/** Studio's one name for it, in Layers, Add and the inspector (the engine's layer is "Data chosen on watch"). */
export const SLOT_LABEL = "Selectable data";
export const SLOT_BATTERY_LAYER = "controlBatteryIcon";
export const TREND_CHOICE = "barometerTrend";
export const BAROMETER_TRENDS = [{ id: "down", label: "Falling" }, { id: "flat", label: "Steady" }, { id: "up", label: "Rising" }] as const;
export type BarometerTrend = (typeof BAROMETER_TRENDS)[number]["id"];
/** What a new slot offers on a template that has none of its own. */
export const SLOT_STARTER: WatchfaceComplicationId[] = ["heartRate", "steps", "calories"];

const LABEL: Partial<Record<WatchfaceComplicationId, string>> = { temperature: "Sensor temperature" };
/** The line under a type that needs one. */
const NOTE: Partial<Record<WatchfaceComplicationId, string>> = {
  temperature: "The watch's own thermometer, warmed by the wrist. For the forecast add Current weather.",
  date: "This template's own. Studio can keep or drop it, not restyle it.",
};
const SAMPLE_UNIT: Partial<Record<WatchfaceComplicationId, string>> = { battery: "%", temperature: "°" };

export const slotLabel = (id: string) => LABEL[id as WatchfaceComplicationId] ?? [CONTROL_DATE_COMPLICATION, ...WATCHFACE_COMPLICATIONS].find((c) => c.id === id)?.label ?? id;

/** A template image's layer id by its config key, in the display being edited. */
const assetLayer = (layers: EditorLayer[], key: string) => layers.find((l) => l.configAssetId === `config:${key}` || l.configAssetId === `aod:${key}`);
const keyOf = (layer: Pick<EditorLayer, "configAssetId">) => layer.configAssetId?.replace(/^(?:config|aod):/, "");
const TREND_KEY = /^control_barometer_(?:down|flat|up)_icon$/;

/**
 * Whether a layer is a piece of the slot, edited in the slot's panel and not a row of its own: each type's icon, the
 * shared colon and minus, the barometer's trend images and decimal point, and the battery choice's pictures.
 */
export function isSlotPart(layer: Pick<EditorLayer, "kind" | "configAssetId">): boolean {
  if (layer.kind === SLOT_BATTERY_LAYER) return true;
  const key = keyOf(layer);
  return !!key && (isSelectableSlotConfigAssetKey(key) || TREND_KEY.test(key) || key === "control_barometer_icon" || key === "control_point_icon");
}

/** Whether the slot stays listed with nothing on: once the designer has set its types, until it is taken off the face. */
export function slotListed(layer: Pick<EditorLayer, "kind" | "present">, design: Design): boolean {
  return layer.kind === SLOT_LAYER && (layer.present || (Object.keys(design.controlComplicationEnabled ?? {}).length > 0 && !design.removedLayerIds?.includes(SLOT_LAYER)));
}

export type SlotIcon =
  /** The template's own picture. */ | "template"
  /** A picture the designer put in. */ | "custom"
  /** There is one, switched off. */ | "hidden"
  /** Nothing to draw: the watch shows the value alone. */ | "none"
  /** The battery choice's level pictures. */ | "states"
  /** The barometer's three trend images. */ | "trend";

export interface SlotType {
  id: WatchfaceComplicationId;
  label: string;
  /** The sample the preview draws, as the wearer would read it. */
  sample: string;
  note?: string;
  on: boolean;
  /** The template already has it on this display; else Studio writes its keys when the face is built. */
  inTemplate: boolean;
  /** Why the switch can't be used here, in one line; null when it can. */
  blocked: string | null;
  icon: SlotIcon;
  /** The icon's config key and its layer (absent for the battery, the barometer and a type that is off). */
  iconKey: string | null;
  iconLayer: EditorLayer | null;
  /** The template's picture, to show beside the type. */
  iconPath: string | null;
  /** The icon has a place of its own that Icon offset can move. */
  canOffset: boolean;
  /** Two values with the shared colon between them (hours and minutes). */
  split: boolean;
}

/** The slot's config as the build will write it, at the master. */
function slotConfig(details: CorosWatchfaceTemplateDetails, design: Design) {
  const built = deriveDesignDetails(details, design).previewDetails;
  const resolution = pickPreviewResolution(built);
  return { built, resolution, config: resolution?.config ?? {} };
}

const iconKeyOf = (c: WatchfaceComplicationDefinition) => (c.id === "battery" || c.id === "barometer" || c.id === "date" ? null : `control_${c.controlPrefix}_icon`);

/**
 * Every data type the slot can offer on this display, in the editor's order, with what the face has for each.
 * `details` is the template as the display sees it (studioFace's detailsOf) and `layers` every layer the engine knows
 * (allLayersOf). Always-on only switches the types its own config carries, as CorosLink does.
 */
export function slotTypes(details: CorosWatchfaceTemplateDetails, design: Design, mode: Mode, layers: EditorLayer[]): SlotType[] {
  const { resolution, config } = slotConfig(details, design);
  const available = new Set(mode === "aod" ? getAvailableComplications(details).map((c) => c.id) : []);
  return watchfaceComplicationChoices(details).map((c): SlotType => {
    const inTemplate = hasControlComplication(details, c.id);
    const blocked = mode === "aod" && !available.has(c.id) ? "Not on this template's always-on screen" : null;
    const on = !blocked && isControlComplicationEnabled(details, design, c.id);
    const iconKey = iconKeyOf(c);
    const iconLayer = on && iconKey ? assetLayer(layers, iconKey) ?? null : null;
    const override = iconKey ? design.configAssetOverrides?.[iconLayer?.configAssetId ?? `config:${iconKey}`] : undefined;
    const relative = iconKey ? config[iconKey]?.trim().replace(/\\/g, "/").replace(/^\.\//, "") : "";
    const file = relative && resolution ? resolution.icons.find((i) => i.path === `${resolution.directory}/${relative}`) : undefined;
    let icon: SlotIcon;
    let iconPath: string | null = null;
    if (c.id === "barometer") icon = "trend";
    else if (c.id === "battery") {
      const folder = config.control_battery_icon_dir?.trim().replace(/\\/g, "/");
      const states = design.configAssetOverrides?.["config:control_battery_icon"];
      const custom = states?.enabled !== false && (!!states?.replacement || Object.keys(states?.stateReplacements ?? {}).length > 0);
      icon = custom || (folder && resolution?.spriteFolders.some((f) => f.folder === folder)) ? "states" : "none";
    } else if (c.id === "date") icon = "template";
    else if (override?.enabled === false) icon = "hidden";
    else if (override?.replacement) icon = "custom";
    else if (file) { icon = "template"; iconPath = file.path; } else icon = "none";
    return {
      id: c.id, label: slotLabel(c.id), sample: `${c.sampleValue}${SAMPLE_UNIT[c.id] ?? ""}`, ...(NOTE[c.id] ? { note: NOTE[c.id] } : {}), on, inTemplate, blocked, icon, iconKey, iconLayer, iconPath,
      canOffset: on && c.id !== "date" && parseConfigPos(config[`control_${c.controlPrefix}_icon_pos`]) !== null && icon !== "none",
      split: c.id === "exercise" || c.id === "sunrise" || c.id === "sunset",
    };
  });
}

/** The type the watch preview draws: the saved one while it is on, else the first that is. "" with nothing on. */
export function slotPreview(types: SlotType[], design: Design): WatchfaceComplicationId | "" {
  const on = types.filter((t) => t.on);
  return (on.find((t) => t.id === design.previewComplication) ?? on[0])?.id ?? "";
}

/** The type after (or before) the one previewed, round the types that are on: what stepping the slot shows next. */
export function nextSlotPreview(types: SlotType[], current: string, step: 1 | -1 = 1): WatchfaceComplicationId | "" {
  const on = types.filter((t) => t.on);
  if (!on.length) return "";
  const at = on.findIndex((t) => t.id === current);
  return on[(Math.max(0, at) + (at < 0 ? 0 : step) + on.length) % on.length].id;
}

/** The sensor temperature needs a style of its own before the engine draws it (CorosLink's Preview data does the same). */
const withTemperatureStyle = (design: Design, id: string): Design =>
  id === "temperature" && !design.metricStyles?.temperature ? { ...design, metricStyles: { ...design.metricStyles, temperature: { scale: 1 } } } : design;

/** Which type the preview draws. Saved with the face: the picture built into the archive shows it too. */
export function setSlotPreview(design: Design, id: string): Design {
  return withTemperatureStyle({ ...design, previewComplication: id }, id);
}

/**
 * Turns a type on or off (CorosLink's setControlComplicationEnabled). On, the preview shows it, and a slot hidden from
 * the face comes back; off, the preview moves to another type that is on. The battery also keeps the older flag
 * CorosLink faces carry.
 */
export function setSlotType(design: Design, details: CorosWatchfaceTemplateDetails, mode: Mode, id: WatchfaceComplicationId, on: boolean): Design {
  const next: Design = {
    ...design,
    controlComplicationEnabled: { ...design.controlComplicationEnabled, [id]: on },
    ...(id === "battery" ? { controlBatteryEnabled: on } : {}),
  };
  const candidates = mode === "aod" ? getAvailableComplications(details) : watchfaceComplicationChoices(details);
  if (!on) {
    if (design.previewComplication !== id) return next;
    return { ...next, previewComplication: candidates.find((c) => c.id !== id && isControlComplicationEnabled(details, next, c.id))?.id ?? "" };
  }
  const layerVisibility = { ...next.layerVisibility };
  delete layerVisibility[SLOT_LAYER];
  return withTemperatureStyle({ ...next, previewComplication: id, layerVisibility, removedLayerIds: (next.removedLayerIds ?? []).filter((x) => x !== SLOT_LAYER && x !== SLOT_BATTERY_LAYER) }, id);
}

/**
 * Puts the slot on the face: shows it again where the template has one the face hides, with the types the face had;
 * on a template without a slot, or with every type off, it starts with heart rate, steps and calories. In always-on
 * only the template's own types come back.
 */
export function showSlot(design: Design, details: CorosWatchfaceTemplateDetails, mode: Mode): Design {
  const layerVisibility = { ...design.layerVisibility };
  delete layerVisibility[SLOT_LAYER];
  let next: Design = { ...design, layerVisibility, removedLayerIds: (design.removedLayerIds ?? []).filter((x) => x !== SLOT_LAYER && x !== SLOT_BATTERY_LAYER) };
  const candidates = mode === "aod" ? getAvailableComplications(details) : watchfaceComplicationChoices(details);
  const anyOn = () => candidates.filter((c) => isControlComplicationEnabled(details, next, c.id));
  if (!anyOn().length) {
    const starter = mode === "aod" ? candidates.map((c) => c.id) : SLOT_STARTER;
    next = { ...next, controlComplicationEnabled: { ...next.controlComplicationEnabled, ...Object.fromEntries(starter.map((id) => [id, true])) } };
  }
  const on = anyOn();
  const preview = on.find((c) => c.id === next.previewComplication) ?? on[0];
  return preview ? setSlotPreview(next, preview.id) : next;
}

/** Whether the slot is on the face and drawn. */
export function slotOnFace(layers: EditorLayer[]): boolean {
  const slot = layers.find((l) => l.kind === SLOT_LAYER);
  return !!slot?.present && slot.visible;
}

// ───── Icon offset ─────

/** How far a type's icon sits from where the template (or Studio) puts it, in master pixels. The value doesn't move. */
export const iconOffsetOf = (design: Design, id: string) => design.controlIconOffsets?.[id] ?? { dx: 0, dy: 0 };

export function setIconOffset(design: Design, id: string, dx: number, dy: number): Design {
  if (design.lockedLayerIds?.includes(SLOT_LAYER)) return design;
  const controlIconOffsets = { ...design.controlIconOffsets };
  if (Math.round(dx) === 0 && Math.round(dy) === 0) delete controlIconOffsets[id];
  else controlIconOffsets[id] = { dx: Math.round(dx), dy: Math.round(dy) };
  return { ...design, controlIconOffsets };
}

// ───── Value tint ─────

/** Selectable value tint: the colour the slot's digits are drawn in; undefined follows the face's colour. */
export const valueTintOf = (design: Design) => design.selectableMetricStyle?.color;

export function setValueTint(design: Design, color: string | undefined): Design {
  if (color) return { ...design, selectableMetricStyle: { ...(design.selectableMetricStyle ?? { scale: 1 }), color } };
  if (!design.selectableMetricStyle) return design;
  const style = { ...design.selectableMetricStyle };
  delete style.color;
  return { ...design, selectableMetricStyle: style };
}

// ───── Shared pieces and the barometer's images ─────

export interface SlotPiece { key: string; label: string; note: string; layer: EditorLayer }

/** The colon and minus every type shares, where the face has them. */
export function slotShared(layers: EditorLayer[]): SlotPiece[] {
  return [
    { key: "control_colon_icon", label: "Colon", note: "Exercise, sunrise and sunset" },
    { key: "control_negative_sign_icon", label: "Minus sign", note: "Values below zero" },
  ].flatMap((p) => { const layer = assetLayer(layers, p.key); return layer?.present ? [{ ...p, layer }] : []; });
}

/** The barometer's images as one set: the three the watch swaps by the pressure's direction, then the decimal point. */
export function barometerPieces(layers: EditorLayer[]): { trends: (SlotPiece & { id: BarometerTrend })[]; point: SlotPiece | null } {
  const trends = BAROMETER_TRENDS.flatMap((t) => {
    const key = `control_barometer_${t.id}_icon`, layer = assetLayer(layers, key);
    return layer ? [{ id: t.id, key, label: t.label, note: "", layer }] : [];
  });
  const point = assetLayer(layers, "control_point_icon");
  return { trends, point: point ? { key: "control_point_icon", label: "Decimal point", note: "Between 1013 and 2", layer: point } : null };
}

/** Where the template keeps the picture a slot key points at, for a thumbnail; absent when it has none. */
export function slotImagePaths(details: CorosWatchfaceTemplateDetails, design: Design, keys: string[]): Record<string, string> {
  const { resolution, config } = slotConfig(details, design);
  if (!resolution) return {};
  return Object.fromEntries(keys.flatMap((key) => {
    const relative = config[key]?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    const path = relative ? `${resolution.directory}/${relative}` : "";
    return path && resolution.icons.some((i) => i.path === path) ? [[key, path]] : [];
  }));
}

/** Whether a slot image is the designer's own picture (else the template's, or the one Studio draws). */
export const pieceIsCustom = (design: Design, layer: EditorLayer) => !!design.configAssetOverrides?.[layer.configAssetId ?? ""]?.replacement;

// ───── What the wearer gets ─────

export interface SlotWarning { kind: "blank" | "noIcon" | "empty"; text: string; ids: string[] }

export interface SlotSelector {
  /** The types the watch's list will offer, in the editor's order (the watch orders its own list). */
  listed: SlotType[];
  warnings: SlotWarning[];
}

const BLANK_OK = /_font_color$/;

/**
 * What the watch's data list will hold for this face, read from the config the build writes, and what is wrong with
 * it: a `control_*` key left declared but empty makes the watch list an entry that draws nothing (CorosLink's "Strip
 * blank config keys" exists for this), and a type with no icon shows its value alone.
 */
export function slotSelector(details: CorosWatchfaceTemplateDetails, design: Design, types: SlotType[], stripBlank = !!design.stripBlankConfigKeys): SlotSelector {
  const { built } = slotConfig(details, design);
  const listed = types.filter((t) => t.on && hasControlComplication(built, t.id));
  const warnings: SlotWarning[] = [];
  if (!stripBlank) {
    // In any of the watch sizes, and only a type's own keys: templates ship other empty control keys of their own
    // (`control_percent_icon`, the year's) that are not entries of the list.
    const owners = WATCHFACE_COMPLICATIONS.filter((c) => built.resolutions.some((r) => Object.keys(r.config).some((key) =>
      key.startsWith(`control_${c.controlPrefix}_`) && !BLANK_OK.test(key) && !(r.config[key] ?? "").trim()))).map((c) => c.id);
    if (owners.length) {
      const names = owners.map(slotLabel);
      warnings.push({ kind: "blank", ids: owners, text: `${names.length === 1 ? `${names[0]} has` : `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""} have`} an empty key: the watch may list a blank entry.` });
    }
  }
  const bare = listed.filter((t) => t.icon === "none" || t.icon === "hidden");
  if (bare.length) warnings.push({ kind: "noIcon", ids: bare.map((t) => t.id), text: `No icon: ${bare.map((t) => t.label).join(", ")}. The watch shows the value alone.` });
  if (!types.some((t) => t.on)) warnings.push({ kind: "empty", ids: [], text: "Nothing is on, so the watch shows nothing here." });
  return { listed, warnings };
}
