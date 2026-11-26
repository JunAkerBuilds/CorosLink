// A Studio face on the real model: a COROS template (its layouts, sprites and config texts, read from the main
// process) and CorosLink's design state over it. This file is the glue between Studio's screens and the moved engine
// (desktop/watchface/engine): set a design up from its template the way CorosLink's editor does when a face first
// opens, list its layers, draw it at the 800 master, apply the edits the screens offer, and compose what the main
// process builds into the watch's archive. Rewritten from CorosLink's WatchfaceEditor.tsx (its template-loading
// effect, setDesign, renderExportPreview and createArchive), keeping their order of steps.
import type { WatchfaceCarriedPreferences } from "../watchface/engine/watchfaceCarriedPreferences";
import type {
  CorosWatchfaceAssetReplacement, CorosWatchfaceConfigOverride, CorosWatchfaceDesignState, CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails,
} from "../watchface/types";
import type { WatchfaceBuildInput } from "../watchface/archive/build";
import { getWatchfaceTarget, type WatchfaceTarget } from "../watchface/watchfaceTargets";
import {
  applyConfigTextEditsToDetails, buildDisabledControlComplicationOverrides, buildDisabledWatchfaceConfigAssetOverrides,
  corosConfigColorToCss, detailsForCompositionMode, detailsForPreviewResolution, drawStudioPreview, getAmPmCapability,
  getFixedMetricCapabilities, getTemplateBackgroundAssetPaths, hasWatchfaceAod, inferExerciseSeparatorStyle,
  inferStaticSeparators, loadStudioImage, mergeAssetReplacements, mergeConfigOverrides, pickPreviewResolution,
  pickWatchPreviewResolution, retargetWatchfaceCompositionToAod, retargetWatchfaceCompositionToCurrent,
  type WatchfacePreviewMode,
} from "../watchface/engine/watchfaceStudio";
import { buildAodBackgroundComposition, buildAodSafeSpriteReplacements, composeWatchfaceReplacements, deriveDesignDetails, toStudioOptions } from "../watchface/engine/watchfaceCompose";
import { isTemplateBackgroundUntouched, makeDefaultDesign, renderDesignBackground } from "../watchface/engine/watchfaceBackground";
import { dimExerciseSeparator, materializeLegacyAodDesign, resolveWatchfaceModeDesign, writeWatchfaceModeDesign } from "../watchface/engine/watchfaceDisplayModes";
import { maskCanvasToCircle, drawWeatherPreviewLayer, normalizeEditorDesign } from "../watchface/engine/watchfaceExportPipeline";
import { blankWatchfaceDesign } from "../watchface/engine/watchfaceBlankStart";
import { recoverChartPageCompanions, recoverGraphlessChart, recoverWatchfaceDesign, type ChartPageCompanions } from "../watchface/engine/recoveredWatchfaceDesign";
import { readTemplateAnimation } from "../watchface/engine/watchfaceAnimation";
import { normalizeWatchfaceLayerOpacity, resolveWatchfaceLayerOpacity } from "../watchface/engine/watchfaceLayerOpacity";
import { getWeatherCapability, drawWeatherTemperaturePreview, weatherAssetUrl, weatherPreviewDataUrl, weatherTemperatureGeometry } from "../watchface/engine/weatherAssets";
import { defaultNativeDataStyle } from "../watchface/engine/nativeDataParts";
import { deriveEditorLayers, type EditorLayer as EngineLayer } from "../watchface/engine/watchfaceEditorModel";
import { WATCHFACE_STATUS_GROUPS } from "../watchface/engine/watchfaceStatusPairs";
import { drawNativeDataPreview, keepNativeOwnedKeys } from "../watchface/engine/nativeData";
import { finalizeWatchfaceStatusIcons } from "../watchface/engine/watchfaceStatusExport";
import { simulationStudioOptions, type WatchfacePreviewScenario } from "../watchface/engine/watchfaceSimulation";
import { rememberWatchfaceFontSnapshots } from "../watchface/engine/watchfaceFontSnapshots";
import { setWatchfaceAutomationVisibility } from "../watchface/engine/watchfaceAutomationVisibility";
import { NATIVE_DATA_BY_ID, type NativeDataDefinition } from "../watchface/watchfaceNativeCatalog";
import { backgroundElementLabel } from "../watchface/engine/watchfaceBackgroundElements";
import { backgroundElementSnapBounds } from "../watchface/engine/watchfaceEditorSnapping";
import { resolveWatchfaceArtworkLayerOrder, watchfaceBackgroundElementLayerId } from "../watchface/engine/watchfaceArtworkLayers";
import { templateDetails, templateConfigTexts, templateAssets } from "./studio";
import { isSlotPart, SLOT_LABEL, SLOT_LAYER, slotListed, TREND_CHOICE } from "./studioSlot";

export type Design = CorosWatchfaceDesignState;
export type Mode = WatchfacePreviewMode;
/** A layer as the engine lists it. The row that stands for a shared spot (below) carries the spot. */
export type EditorLayer = EngineLayer & { spot?: Spot };

/** The 800 px master every face is authored on (the canvas shows it, the watch gets it scaled). */
export const MASTER = 800;

/** A project's template, ready for the engine: layouts, config texts and a cached PNG loader. */
export interface FaceSource {
  projectId: string;
  details: CorosWatchfaceTemplateDetails;
  /** config.txt / AODconfig.txt as the template has them, by path. */
  baselines: Record<string, string>;
  loadAssets: (paths: string[]) => Promise<CorosWatchfaceTemplateAsset[]>;
  watch: WatchfaceTarget;
}

export async function openFaceSource(projectId: string, firmwareType: string | undefined): Promise<FaceSource> {
  const cache = new Map<string, CorosWatchfaceTemplateAsset>();
  const missing = new Set<string>();
  const loadAssets = async (paths: string[]) => {
    const wanted = paths.filter((p) => !cache.has(p) && !missing.has(p));
    if (wanted.length) {
      for (let i = 0; i < wanted.length; i += 400) {
        const chunk = wanted.slice(i, i + 400);
        const found = await templateAssets(projectId, chunk);
        for (const asset of found) cache.set(asset.path, asset);
      }
    }
    return paths.map((p) => cache.get(p)).filter((a): a is CorosWatchfaceTemplateAsset => !!a);
  };
  const [details, texts] = await Promise.all([templateDetails(projectId), templateConfigTexts(projectId)]);
  return {
    projectId, details, loadAssets,
    baselines: Object.fromEntries(texts.map((f) => [f.path, f.text])),
    watch: getWatchfaceTarget(firmwareType) ?? getWatchfaceTarget("pace-pro")!,
  };
}

/** The first background PNG the template has: its own background, then the preview variants. */
async function templateBackground(source: FaceSource): Promise<CorosWatchfaceTemplateAsset | undefined> {
  for (const assetPath of getTemplateBackgroundAssetPaths(source.details)) {
    try {
      const [asset] = await templateAssets(source.projectId, [assetPath], true);
      if (asset) return asset;
    } catch { /* an undecodable candidate falls through to the next */ }
  }
  return undefined;
}

/**
 * The design a face opens with. A saved design is cleaned and topped up with what newer versions add; a face made from
 * a template and not opened yet (`startedFrom`) is set up from the template: its background, separators, AM/PM,
 * weather, the exercise divider, its own always-on layout and any data sprites it carries. "blank" then switches
 * everything off, before the first undo step, so Undo never returns to the template's design.
 */
export async function initialDesign(source: FaceSource, saved: Design | undefined, startedFrom?: "template" | "blank", carried?: WatchfaceCarriedPreferences): Promise<Design> {
  const { details: described, loadAssets, watch } = source;
  const fresh = !!startedFrom || !saved || Object.keys(saved).length <= 1;
  const initial = fresh ? undefined : saved;
  await rememberWatchfaceFontSnapshots(initial?.fontSnapshots);
  let design = normalizeEditorDesign(initial ?? makeDefaultDesign());
  const templateArtwork = initial ? undefined : await templateBackground(source);
  let aodArtwork: CorosWatchfaceTemplateAsset | undefined;
  if (hasWatchfaceAod(described) && !initial?.modeDesigns?.aod) {
    const preferred = pickWatchPreviewResolution(described, watch.model);
    for (const resolution of [...(preferred ? [preferred] : []), ...described.resolutions.filter((r) => r !== preferred)]) {
      const relative = resolution.aodConfig.background_icon?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
      if (!relative) continue;
      try {
        const [asset] = await loadAssets([`${resolution.directory}/${relative}`]);
        if (asset) { aodArtwork = asset; break; }
      } catch { /* always-on may use only bg_color */ }
    }
  }
  // A template that carries its own weather or data sprites keeps them instead of the generated defaults.
  const hydrated = initial ? undefined : await recoverWatchfaceDesign(described, loadAssets, carried?.chartSource?.current).catch(() => undefined);
  const carriesOwnAssets = Boolean(hydrated?.weatherIndicator?.assets) || Object.keys(hydrated?.nativeData ?? {}).length > 0;
  const recoveredCurrent = carriesOwnAssets ? hydrated : undefined;
  const recoveredAod = recoveredCurrent && hasWatchfaceAod(described)
    ? await recoverWatchfaceDesign(detailsForCompositionMode(described, "aod"), loadAssets, carried?.chartSource?.aod).catch(() => undefined) : undefined;
  const graphlessChart = initial && !initial.nativeData?.chart
    ? await recoverGraphlessChart(applyConfigTextEditsToDetails(described, initial.configTextEdits), loadAssets).catch(() => null) : null;
  const templateAnimation = initial?.animation ? undefined
    : await readTemplateAnimation(applyConfigTextEditsToDetails(described, initial?.configTextEdits), loadAssets).catch(() => undefined);

  if (!initial) {
    design = {
      ...design,
      ...(templateArtwork ? { artwork: { dataUrl: templateArtwork.dataUrl, width: templateArtwork.width, height: templateArtwork.height }, zoom: 1 } : {}),
      staticSeparators: inferStaticSeparators(described, design.digitColor),
    };
  }
  if (graphlessChart) design = { ...design, nativeData: { ...design.nativeData, chart: graphlessChart } };
  if (templateAnimation) design = { ...design, animation: templateAnimation };
  if (!initial?.ampmIndicator) {
    const capability = getAmPmCapability(described);
    if (capability) design = { ...design, ampmIndicator: { enabled: capability.active, ...capability.defaultPos, scale: 1, color: undefined } };
  }
  if (!initial?.weatherIndicator) {
    const capability = getWeatherCapability(described);
    if (capability) design = { ...design, weatherIndicator: { enabled: capability.active, ...capability.defaultPos, scale: 1 } };
  }
  const exercise = getFixedMetricCapabilities(described).find((c) => c.id === "exercise");
  const aodExerciseActive = hasWatchfaceAod(described) &&
    getFixedMetricCapabilities(detailsForCompositionMode(described, "aod")).find((c) => c.id === "exercise")?.active === true;
  if (!design.exerciseSeparator && (design.metricChanges?.exercise === true || (design.metricChanges?.exercise !== false && exercise?.active === true))) {
    design = { ...design, exerciseSeparator: inferExerciseSeparatorStyle(described, design.metricStyles?.exercise?.color ?? design.digitColor) };
  }
  if (design.exerciseSeparator && design.modeDesigns?.aod && !design.modeDesigns.aod.exerciseSeparator &&
    (aodExerciseActive || design.modeDesigns.aod.metricChanges?.exercise === true)) {
    design = { ...design, modeDesigns: { ...design.modeDesigns, aod: { ...design.modeDesigns.aod, exerciseSeparator: dimExerciseSeparator(design.exerciseSeparator) } } };
  }
  if (hasWatchfaceAod(described) && !design.modeDesigns?.aod) {
    const sourceResolution = pickWatchPreviewResolution(described, watch.model) ?? described.resolutions.find((r) => Object.keys(r.aodConfig).length > 0);
    const notAod = <T,>(record: Record<string, T> | undefined) => Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => !key.startsWith("aod:")));
    design = {
      ...design,
      configAssetOverrides: notAod(design.configAssetOverrides),
      layerEffects: notAod(design.layerEffects),
      layerStrokes: notAod(design.layerStrokes),
      modeDesigns: {
        ...(design.modeDesigns ?? {}),
        aod: materializeLegacyAodDesign(
          aodExerciseActive ? design : { ...design, exerciseSeparator: undefined },
          aodArtwork ? { dataUrl: aodArtwork.dataUrl, width: aodArtwork.width, height: aodArtwork.height } : null,
          corosConfigColorToCss(sourceResolution?.aodConfig.bg_color ?? "#000000"),
        ),
      },
    };
  }
  if (recoveredCurrent) {
    design = { ...design, ...recoveredCurrent };
    if (recoveredAod && design.modeDesigns?.aod) design = { ...design, modeDesigns: { aod: { ...design.modeDesigns.aod, ...recoveredAod } } };
  }
  if (startedFrom === "blank" && !initial) design = blankWatchfaceDesign(design, described);
  return oneTemperature(design, pickPreviewResolution(described)?.width ?? MASTER);
}

// ───── One temperature ─────
//
// The watch has one current-temperature reading (weather_temp_rect, its font, minus and degree). The engine can write it
// two ways: the weather icon's own copy (weatherIndicator.temperatureEnabled, SIMPLE's sprites beside the icon) or the
// Weather data live-data layer (weather_temp). Both write the same keys, so Studio keeps only the layer: a face that uses the
// icon's copy gets it as the layer, where it was and with the pictures it had, and the icon's copy goes off.

/** Where the icon's own temperature sits, as a Weather data layer style. */
export function temperatureBesideIcon(design: Design, width: number) {
  const w = design.weatherIndicator;
  const at = w ? weatherTemperatureGeometry(width, w) : { x: 280, y: 500 };
  return { ...defaultNativeDataStyle("weather_temp"), ...design.nativeData?.weather_temp, enabled: true, x: Math.round(at.x), y: Math.round(at.y), color: w?.color ?? "#ffffff" };
}

/** Turns the Weather data layer on or off; the weather icon never draws a copy of its own. */
export function setTemperature(design: Design, on: boolean, width: number): Design {
  const now = design.nativeData?.weather_temp;
  const style = on ? (now ? { ...now, enabled: true } : temperatureBesideIcon(design, width)) : now ? { ...now, enabled: false } : undefined;
  return {
    ...design,
    ...(design.weatherIndicator ? { weatherIndicator: { ...design.weatherIndicator, temperatureEnabled: false } } : {}),
    ...(style ? { nativeData: { ...design.nativeData, weather_temp: style } } : {}),
    ...(on ? { removedLayerIds: (design.removedLayerIds ?? []).filter((id) => id !== "native:weather_temp") } : {}),
  };
}

const asDataUrl = async (url: string) => {
  if (!url || url.startsWith("data:")) return url;
  const blob = await (await fetch(url)).blob();
  return await new Promise<string>((done, fail) => { const r = new FileReader(); r.onload = () => done(String(r.result)); r.onerror = () => fail(r.error); r.readAsDataURL(blob); });
};

async function oneTemperatureIn(design: Design, width: number): Promise<Design> {
  const w = design.weatherIndicator;
  if (!w || w.temperatureEnabled === false) return design;
  if (!w.enabled || design.nativeData?.weather_temp?.enabled) return { ...design, weatherIndicator: { ...w, temperatureEnabled: false } };
  // The pictures the icon's reading drew (its own, or SIMPLE's built-in ones) become the layer's; one that can't be
  // read leaves the layer's own picture in its place.
  const pictures = async (set: "digits" | "symbols" | "units", indexes: number[]) => Object.fromEntries((await Promise.all(indexes.map(async (i) =>
    [String(i), await asDataUrl(weatherAssetUrl(set, i, w)).catch(() => "")] as const))).filter(([, url]) => url));
  const [digits, symbols, units] = await Promise.all([pictures("digits", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), pictures("symbols", [0, 1]),
    w.assets?.units ? pictures("units", [0, 1]) : Promise.resolve({} as Record<string, string>)]);
  const unit = units["0"] && units["1"] ? units : symbols["1"] ? { "0": symbols["1"], "1": symbols["1"] } : undefined;
  const style = temperatureBesideIcon(design, width);
  const assets = { ...style.assets, ...(Object.keys(digits).length === 10 ? { digits } : {}), ...(symbols["0"] ? { symbols: { "0": symbols["0"] } } : {}), ...(unit ? { unit } : {}) };
  return setTemperature({ ...design, nativeData: { ...design.nativeData, weather_temp: { ...style, assets } } }, true, width);
}

/** Moves the weather icon's own temperature onto the Weather data layer, on both displays. */
export async function oneTemperature(design: Design, width: number): Promise<Design> {
  let next = await oneTemperatureIn(design, width);
  if (next.modeDesigns?.aod) {
    const aod = resolveWatchfaceModeDesign(next, "aod"), changed = await oneTemperatureIn(aod, width);
    if (changed !== aod) next = writeWatchfaceModeDesign(next, "aod", changed);
  }
  return next;
}

/** The template as a mode sees it, with the face's config text edits. */
function modeDetails(source: FaceSource, design: Design, mode: Mode): CorosWatchfaceTemplateDetails {
  return detailsForCompositionMode(applyConfigTextEditsToDetails(source.details, design.configTextEdits), mode);
}

export const supportsAlwaysOn = (source: FaceSource) => hasWatchfaceAod(source.details);

/** The template as the mode being edited sees it (for choices that depend on what the template carries). */
export const detailsOf = (source: FaceSource, root: Design, mode: Mode) => modeDetails(source, root, mode);

/** The master resolution the inspector measures sizes in (CorosLink's previewResolution). */
export function resolutionOf(source: FaceSource, root: Design, mode: Mode) {
  return pickPreviewResolution(deriveDesignDetails(modeDetails(source, root, mode), resolveWatchfaceModeDesign(root, mode)).previewDetails);
}

/**
 * The engine's layers for a design, with its text and shapes. The engine lists imported images but not the shapes
 * baked into the artwork (CorosLink's editor adds those itself), so they join here: each a layer with the box it
 * draws in, and all the artwork in paint order, front first, where the images were.
 */
/** The temperature's minus, degree and min/max separator pictures: part of the Temperature layers, not rows of their own. */
const TEMPERATURE_PART = /(^|:)weather_(temp_max_min_)?(negasign|dgree)_icon$|(^|:)weather_temp_separator_icon$/;

export function faceLayers(details: CorosWatchfaceTemplateDetails, design: Design): EngineLayer[] {
  const layers = deriveEditorLayers(details, design).filter((l) => !TEMPERATURE_PART.test(l.configAssetId ?? l.id));
  const elements = design.backgroundElements ?? [];
  if (!elements.length) return layers;
  const shapes = elements.map((element): EngineLayer => {
    const id = watchfaceBackgroundElementLayerId(element.id), label = backgroundElementLabel(element);
    return {
      id, kind: "backgroundElement", label, backgroundElementId: element.id, visible: element.visible !== false, canHide: true, present: true,
      bounds: { id, label, ...backgroundElementSnapBounds(element) },
      capabilities: { position: true, color: false, scale: false, font: element.kind === "text", resize: element.kind === "rect" || element.kind === "ellipse",
        rotate: true, opacity: true, grouping: true, effects: true, stroke: true },
    };
  });
  const order = resolveWatchfaceArtworkLayerOrder(design);
  const artwork = [...layers.filter((l) => l.kind === "customSprite"), ...shapes].sort((a, b) => order.indexOf(b.id) - order.indexOf(a.id));
  const rest = layers.filter((l) => l.kind !== "customSprite");
  const at = Math.max(0, rest.findIndex((l) => l.kind === "background"));
  return [...rest.slice(0, at), ...artwork, ...rest.slice(at)];
}

/** The template with the face's config text edits, not narrowed to a display (analog hands read both configs). */
export const sourceDetailsOf = (source: FaceSource, root: Design) => applyConfigTextEditsToDetails(source.details, root.configTextEdits);

/** The face's layers in panel order (front first), with their boxes in master pixels. */
export function layersOf(source: FaceSource, design: Design, mode: Mode): EngineLayer[] {
  const active = resolveWatchfaceModeDesign(design, mode);
  // The selectable slot stays listed with every type off, so its panel can turn one back on.
  return faceLayers(modeDetails(source, design, mode), active)
    .filter((layer) => layer.present || layer.kind === "background" || slotListed(layer, active));
}

/** Every layer the engine knows for the face, template parts it lacks included (the Add library's status images). */
export function allLayersOf(source: FaceSource, design: Design, mode: Mode): EngineLayer[] {
  return faceLayers(modeDetails(source, design, mode), resolveWatchfaceModeDesign(design, mode));
}

// ───── Spots: several images at one place on the watch ─────
//
// The firmware keeps one position for a set of images and shows one of them at a time: Bluetooth on, off and airplane
// mode at `bluetooth_icon_pos`; Do Not Disturb on, off and sleep mode at `no_disturb_icon_pos`; and the same on / off
// pairs inside the selectable data slot. The engine lists each image as its own layer in one layout group. Studio
// shows each set as one row and one box (CorosLink's status groups, watchfaceStatusPairs.ts): the row is the layer of
// the state being previewed, carrying its spot, so moving it moves them all and hiding or locking it covers them all.
// Nothing about a spot is saved: the design keeps what it always kept for each image.

export interface SpotState {
  /** The image's config key (`bluetooth_off_icon`). */
  key: string;
  label: string;
  /** The engine's layer for the image; `present` is false while the face has no image for the state. */
  layer: EngineLayer;
}
export interface Spot {
  /** The layout group the states share (`bluetoothStatus`), which is also where the design keeps their offset. */
  id: string;
  label: string;
  /** The state a new indicator starts with, and the one previewed until another is picked. */
  primary: string;
  states: SpotState[];
  /** Whether Studio can draw an image for a state the face lacks (the standalone indicators). */
  canAdd: boolean;
}
/**
 * Which state of each spot the watch preview draws and the inspector edits, by spot id; also the barometer trend the
 * selectable slot draws (`barometerTrend`). Screen state, never saved.
 */
export type SpotChoice = Readonly<Record<string, string>>;

const SPOT_DEFS: { id: string; label: string; primary: string; canAdd: boolean; states: { key: string; label: string }[] }[] = [
  ...WATCHFACE_STATUS_GROUPS.map((g) => ({
    id: g.id === "bluetooth" ? "bluetoothStatus" : "doNotDisturbStatus", label: g.label, primary: g.primary, canAdd: true,
    states: g.states.map((s) => ({ key: s.key, label: s.label })),
  })),
  { id: "bluetoothOff", label: "Bluetooth (data slot)", primary: "control_bluetooth_off_icon", canAdd: false,
    states: [{ key: "control_bluetooth_on_icon", label: "On" }, { key: "control_bluetooth_off_icon", label: "Off" }] },
  { id: "doNotDisturbOn", label: "Do Not Disturb (data slot)", primary: "control_no_disturb_on_icon", canAdd: false,
    states: [{ key: "control_no_disturb_on_icon", label: "On" }, { key: "control_no_disturb_off_icon", label: "Off" }] },
];

/** The spots a face has: every set with at least one image on the face. `all` is the engine's full list (allLayersOf). */
export function spotsOf(all: EngineLayer[]): Spot[] {
  const byAsset = new Map(all.filter((l) => l.kind === "configAsset" && l.configAssetId).map((l) => [l.configAssetId!, l]));
  return SPOT_DEFS.flatMap((def) => {
    const states = def.states.flatMap((s) => { const layer = byAsset.get(`config:${s.key}`); return layer?.layoutGroupId === def.id ? [{ ...s, layer }] : []; });
    return states.some((s) => s.layer.present) ? [{ id: def.id, label: def.label, primary: def.primary, canAdd: def.canAdd, states }] : [];
  });
}

/** The spot a layer belongs to (by the row that stands for it, or by any of its images' ids). */
export function spotOf(spots: Spot[], layer: Pick<EditorLayer, "id" | "spot"> | string | null | undefined): Spot | undefined {
  if (!layer) return undefined;
  const id = typeof layer === "string" ? layer : layer.id;
  return (typeof layer === "string" ? undefined : layer.spot) ?? spots.find((s) => s.states.some((st) => st.layer.id === id));
}

/** The spot and state an image's layer id (`configAsset:config:<key>`) belongs to, whether or not the face has it. */
export function spotKeyOf(layerId: string): { spot: string; key: string } | null {
  const key = layerId.startsWith("configAsset:config:") ? layerId.slice("configAsset:config:".length) : "";
  const def = key ? SPOT_DEFS.find((d) => d.states.some((s) => s.key === key)) : undefined;
  return def ? { spot: def.id, key } : null;
}

/** A spot's state by a layer id. */
export const spotStateOf = (spot: Spot, layerId: string) => spot.states.find((s) => s.layer.id === layerId);

/**
 * The state the preview draws: the picked one when the face has an image for it, else the primary one when that
 * shows, else the first that shows (the watch falls back the same way when a face has no airplane or sleep image).
 */
export function spotActive(spot: Spot, choice: SpotChoice = {}): SpotState {
  const shows = (s: SpotState) => s.layer.present && s.layer.visible;
  const picked = spot.states.find((s) => s.key === choice[spot.id] && s.layer.present);
  return picked ?? spot.states.find((s) => s.key === spot.primary && shows(s)) ?? spot.states.find(shows)
    ?? spot.states.find((s) => s.layer.present) ?? spot.states[0];
}

/** The state the inspector edits: the picked one even when the face has no image for it yet (it offers to add one). */
export const spotPicked = (spot: Spot, choice: SpotChoice = {}): SpotState =>
  spot.states.find((s) => s.key === choice[spot.id]) ?? spotActive(spot, choice);

/** The images the preview leaves out, so each spot draws one state. */
export function hiddenSpotKeys(spots: Spot[], choice: SpotChoice = {}): string[] {
  return SPOT_DEFS.flatMap((def) => {
    const spot = spots.find((s) => s.id === def.id);
    const active = spot ? spotActive(spot, choice).key : def.primary;
    return def.states.map((s) => s.key).filter((key) => key !== active);
  });
}

/**
 * The layers as Studio lists them: each spot is one row, where its first image was. The row is the previewed state's
 * layer under the spot's name; it shows while any state does, and its box is the previewed state's (another state's
 * when that one is switched off, so the spot can still be picked on the watch).
 */
export function rowsOf(layers: EngineLayer[], spots: Spot[], choice: SpotChoice = {}): EditorLayer[] {
  const member = new Map<string, Spot>();
  for (const spot of spots) for (const s of spot.states) member.set(s.layer.id, spot);
  const done = new Set<string>();
  // The selectable slot's icons, colon, minus and battery pictures are edited in the slot's panel (studioSlot.ts).
  const slot = layers.some((l) => l.kind === SLOT_LAYER);
  return layers.flatMap((layer): EditorLayer[] => {
    const spot = member.get(layer.id);
    if (!spot) return slot && isSlotPart(layer) ? [] : layer.kind === SLOT_LAYER ? [{ ...layer, label: SLOT_LABEL, bounds: layer.bounds ? { ...layer.bounds, label: SLOT_LABEL } : null }] : [layer];
    if (done.has(spot.id)) return [];
    done.add(spot.id);
    const lead = spotActive(spot, choice).layer;
    const visible = spot.states.some((s) => s.layer.present && s.layer.visible);
    const bounds = lead.bounds ?? spot.states.find((s) => s.layer.visible && s.layer.bounds)?.layer.bounds ?? null;
    return [{ ...lead, label: spot.label, visible, canHide: true, present: true, bounds: bounds ? { ...bounds, label: spot.label } : null, spot }];
  });
}

/** The row a layer id stands under: itself, or its spot's row. */
export function rowOf(rows: EditorLayer[], id: string | null | undefined): EditorLayer | undefined {
  if (!id) return undefined;
  return rows.find((r) => r.id === id) ?? rows.find((r) => r.spot?.states.some((s) => s.layer.id === id))
    // One of the selectable slot's images leads to the slot.
    ?? (/^controlBatteryIcon$|^configAsset:(?:config|aod):control_/.test(id) ? rows.find((r) => r.kind === SLOT_LAYER) : undefined);
}

/** The Layers panel's and the Add library's categories, from the design's Studio boards, in panel order. */
export const LAYER_GROUPS = [
  { id: "basic", label: "Text and shapes" },
  { id: "time", label: "Time and date" },
  { id: "health", label: "Health" },
  { id: "activity", label: "Activity" },
  { id: "weather", label: "Weather" },
  { id: "training", label: "Training" },
  { id: "charts", label: "Charts" },
  { id: "device", label: "Status" },
  { id: "background", label: "Background" },
] as const;
export type LayerGroup = (typeof LAYER_GROUPS)[number]["id"];

const WORDS: [LayerGroup, RegExp][] = [
  ["weather", /weather|temperature|negasign|dgree|degree|tide|sun(rise|set)?\b|moon|uv|aqi|air|barometer|wind|altitude/i],
  ["health", /heart|\bhr\b|^hr|hrv|sleep_?score|stress|spo2|oxygen|breath|resting/i],
  ["training", /training|load|recovery|vo2|stamina|fitness|marathon|threshold|base/i],
  ["device", /battery|bluetooth|disturb|airplane|sleep|alarm|notification|status|gps/i],
  ["activity", /step|calor|kcal|exercise|floor|elevation|distance|active|progress/i],
  ["time", /time|hour|minute|second|date|day|week|month|year|colon|slash|am\/?pm|lunar/i],
];

const NATIVE_GROUP: Record<NativeDataDefinition["category"], LayerGroup> = {
  Calendar: "time", Weather: "weather", Astronomy: "weather", Health: "health", Training: "training", Charts: "charts",
};

/** Which category a layer sits in. Kinds decide first; template images and live data go by what they show. */
export function groupOf(layer: EditorLayer): LayerGroup {
  if (layer.spot) return "device";
  switch (layer.kind) {
    case "background": return "background";
    case "time": case "seconds": case "date": case "weekday": case "separators": case "arcCut": return "time";
    case "battery": case "batteryIcon": case "controlBatteryIcon": return "device";
    case "weather": return "weather";
    case "backgroundElement": case "customSprite": case "animation": return "basic";
    default: break;
  }
  if (layer.nativeDataId) return NATIVE_GROUP[NATIVE_DATA_BY_ID.get(layer.nativeDataId)?.category ?? "Training"];
  if (layer.metricId === "heartRate") return "health";
  if (layer.metricId === "temperature") return "weather";
  if (layer.metricId) return "activity";
  // The template's chart pictures (each page's icons, the graph's masks, its colon and degree) belong to the chart,
  // not to whatever their data's name suggests.
  if (isChartPart(layer)) return "charts";
  const text = `${layer.nativeDataId ?? ""} ${layer.configAssetId ?? ""} ${layer.label}`;
  if (/thumbnail|background|customize/i.test(text)) return "background";
  return WORDS.find(([, words]) => words.test(text))?.[0] ?? (layer.kind === "configAsset" ? "basic" : "activity");
}

/** Layers in their categories, panel order kept inside each; empty categories left out. */
export function grouped(layers: EditorLayer[]): { id: LayerGroup; label: string; layers: EditorLayer[] }[] {
  // With a Chart layer, its template pictures (icons, masks, colon, degree) are edited from the Chart panel, not listed.
  const chart = layers.some((l) => l.nativeDataId === "chart");
  const listed = chart ? layers.filter((l) => !isChartPart(l)) : layers;
  return LAYER_GROUPS.map((g) => ({ ...g, layers: listed.filter((l) => groupOf(l) === g.id) })).filter((g) => g.layers.length);
}

/** One of the template's chart pictures: a page's icon, the graph's masks, its colon and degree. */
export function isChartPart(layer: EditorLayer): boolean {
  return layer.kind === "configAsset" && /^(config|aod):chart_/.test(layer.configAssetId ?? "");
}

/** The master's size for this template (800 when it has one). */
export function masterSize(source: FaceSource): number {
  return pickPreviewResolution(source.details)?.width ?? MASTER;
}

/**
 * Draws the face at the master as the watch would show it, into an `size` × `size` PNG data URL, cut to the round
 * screen. The time, date and data come from `scenario` (the simulation) or the engine's sample values.
 */
/**
 * The template's other readouts on a daily page (stamina and elevation beside stress), which the watch draws with the
 * one the chart layer edits. Loaded once per face and config edits.
 */
const companionCache = new WeakMap<FaceSource, { key: string; value: Promise<ChartPageCompanions | null> }>();
function chartCompanions(source: FaceSource, root: Design): Promise<ChartPageCompanions | null> {
  const key = JSON.stringify(root.configTextEdits ?? null), hit = companionCache.get(source);
  if (hit?.key === key) return hit.value;
  const value = recoverChartPageCompanions(sourceDetailsOf(source, root), source.loadAssets).catch(() => null);
  companionCache.set(source, { key, value });
  return value;
}

/** The face as a PNG data URL, `size` px square, masked to the round screen unless `round` is false (drag sprites). */
/**
 * The face drawn at `size`. `part` splits it around the animation, so the editor can play the frames between the two
 * as the watch layers them: "under" is the background and its artwork, "over" everything the watch draws on top.
 */
export async function renderFace(source: FaceSource, root: Design, mode: Mode, size: number, scenario?: WatchfacePreviewScenario, round = true, choice?: SpotChoice, part?: "under" | "over"): Promise<string> {
  const design = resolveWatchfaceModeDesign(root, mode);
  const sourceDetails = modeDetails(source, root, mode);
  // One state of each shared spot, as the watch shows it (Bluetooth's on, off and airplane images are one place).
  const hiddenStatusKeys = hiddenSpotKeys(spotsOf(deriveEditorLayers(sourceDetails, design)), choice);
  const previewDetails = deriveDesignDetails(sourceDetails, design).previewDetails;
  const master = pickPreviewResolution(previewDetails);
  const width = master?.width ?? MASTER;
  const details = master ? detailsForPreviewResolution(previewDetails, master.directory) : previewDetails;
  const background = await renderDesignBackground(design, width);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  if (part === "under") {
    canvas.getContext("2d", { colorSpace: "display-p3" })!.drawImage(await loadStudioImage(background, false), 0, 0, size, size);
    if (round) maskCanvasToCircle(canvas);
    return canvas.toDataURL("image/png");
  }
  await drawStudioPreview(canvas, background, details, {
    ...toStudioOptions(design),
    ...(part === "over" ? { transparentBackground: true, animationStill: null } : {}),
    previewMode: hasWatchfaceAod(source.details) ? mode : "current",
    ...simulationStudioOptions(scenario),
    hiddenStatusKeys,
    // The barometer trend being looked at in the selectable slot (screen state; the watch picks by the pressure).
    ...(choice?.[TREND_CHOICE] ? { previewBarometerTrend: choice[TREND_CHOICE] as "down" | "flat" | "up" } : {}),
  }, source.loadAssets);
  await drawNativeDataPreview(canvas, width, design.nativeData, scenario, mode === "current" ? await chartCompanions(source, root) : null);
  if (mode === "current" && design.weatherIndicator?.enabled) {
    if (!design.nativeData?.weather_temp) await drawWeatherTemperaturePreview(canvas, width, design.weatherIndicator, scenario?.values?.weather_temp);
    const url = await weatherPreviewDataUrl(width, design.weatherIndicator.color, design.weatherIndicator, scenario?.weather);
    if (url) drawWeatherPreviewLayer(canvas, await loadStudioImage(url), design, width);
  }
  if (round) maskCanvasToCircle(canvas);
  return canvas.toDataURL("image/png");
}

// ───── Edits ─────

/** Applies `change` to the design of the mode being edited; the always-on layout is its own design. */
export function editMode(root: Design, mode: Mode, change: (design: Design) => Design): Design {
  return writeWatchfaceModeDesign(root, mode, change(resolveWatchfaceModeDesign(root, mode)));
}

/** The time is one auto-aligned block on some templates; this makes hours and minutes their own layers. */
export function separateTime(design: Design): Design {
  const timeStyles = { ...design.timeStyles };
  const auto = timeStyles.autoTime;
  delete timeStyles.autoTime;
  if (auto) { timeStyles.hours = { ...auto }; timeStyles.minutes = { ...auto }; }
  const layoutOffsets = { ...design.layoutOffsets };
  const autoOffset = layoutOffsets.autoTime;
  delete layoutOffsets.autoTime;
  if (autoOffset) { layoutOffsets.hours = { ...autoOffset }; layoutOffsets.minutes = { ...autoOffset }; }
  const layerVisibility = { ...design.layerVisibility };
  const autoVisible = layerVisibility.autoTime;
  delete layerVisibility.autoTime;
  if (autoVisible !== undefined) { layerVisibility.hours = autoVisible; layerVisibility.minutes = autoVisible; }
  return { ...design, separateAutoTime: true, timeStyles, layoutOffsets, layerVisibility };
}

/** Where a movable layer sits relative to the template, in master pixels. */
export function offsetOf(design: Design, layer: EditorLayer): { dx: number; dy: number } {
  return (layer.layoutGroupId && design.layoutOffsets?.[layer.layoutGroupId]) || { dx: 0, dy: 0 };
}

export function moveTo(design: Design, layer: EditorLayer, dx: number, dy: number): Design {
  if (!layer.capabilities.position || !layer.layoutGroupId) return design;
  return { ...design, layoutOffsets: { ...design.layoutOffsets, [layer.layoutGroupId]: { dx: Math.round(dx), dy: Math.round(dy) } } };
}

const DATE_PARTS = new Set(["weekday", "dateMonth", "dateDay"]);

/** A layer's colour as the design has it, the face's digit colour when it follows that. */
export function colourOf(design: Design, layer: EditorLayer): string {
  if (layer.timePartId) return design.timeStyles?.[layer.timePartId]?.color ?? design.digitColor;
  if (layer.metricId) return design.metricStyles?.[layer.metricId]?.color ?? design.digitColor;
  if (DATE_PARTS.has(layer.id)) return design.dateStyles?.[layer.id as "weekday"]?.color ?? design.digitColor;
  if (layer.nativeDataId) return design.nativeData?.[layer.nativeDataId]?.color ?? "#ffffff";
  return design.layerColors?.[layer.id] ?? design.digitColor;
}

/** Whether the layer's colour is one the face set, which "Original" takes away again. */
export function colourChanged(design: Design, layer: EditorLayer): boolean {
  if (layer.timePartId) return !!design.timeStyles?.[layer.timePartId]?.color;
  if (layer.metricId) return !!design.metricStyles?.[layer.metricId]?.color;
  if (DATE_PARTS.has(layer.id)) return !!design.dateStyles?.[layer.id as "weekday"]?.color;
  if (layer.nativeDataId) return (design.nativeData?.[layer.nativeDataId]?.color ?? "#ffffff").toLowerCase() !== "#ffffff";
  return !!design.layerColors?.[layer.id];
}

/** Back to the colour the layer had: the face's digit colour, the template picture untinted, or a live field's white. */
export function resetColour(design: Design, layer: EditorLayer): Design {
  const drop = <T extends { color?: string }>(style: T | undefined) => { if (!style) return style; const { color: _, ...rest } = style; return rest as T; };
  if (layer.timePartId) return { ...design, timeStyles: { ...design.timeStyles, [layer.timePartId]: drop(design.timeStyles?.[layer.timePartId])! } };
  if (layer.metricId) return { ...design, metricStyles: { ...design.metricStyles, [layer.metricId]: drop(design.metricStyles?.[layer.metricId])! } };
  if (DATE_PARTS.has(layer.id)) return { ...design, dateStyles: { ...design.dateStyles, [layer.id]: drop(design.dateStyles?.[layer.id as "weekday"])! } };
  if (layer.nativeDataId) { const n = design.nativeData?.[layer.nativeDataId]; return n ? { ...design, nativeData: { ...design.nativeData, [layer.nativeDataId]: { ...n, color: "#ffffff" } } } : design; }
  if (!design.layerColors?.[layer.id]) return design;
  const layerColors = { ...design.layerColors };
  delete layerColors[layer.id];
  return { ...design, layerColors };
}

export function colour(design: Design, layer: EditorLayer, color: string): Design {
  if (!layer.capabilities.color) return design;
  if (layer.timePartId) return { ...design, timeStyles: { ...design.timeStyles, [layer.timePartId]: { ...design.timeStyles?.[layer.timePartId], scale: design.timeStyles?.[layer.timePartId]?.scale ?? 1, color } } };
  if (layer.metricId) return { ...design, metricStyles: { ...design.metricStyles, [layer.metricId]: { ...design.metricStyles?.[layer.metricId], scale: design.metricStyles?.[layer.metricId]?.scale ?? 1, color } } };
  if (DATE_PARTS.has(layer.id)) return { ...design, dateStyles: { ...design.dateStyles, [layer.id]: { ...design.dateStyles?.[layer.id as "weekday"], scale: design.dateStyles?.[layer.id as "weekday"]?.scale ?? 1, color } } };
  // A live field keeps its colour in its own style; layerColors is only read for template layers.
  if (layer.nativeDataId) { const n = design.nativeData?.[layer.nativeDataId]; return n ? { ...design, nativeData: { ...design.nativeData, [layer.nativeDataId]: { ...n, color } } } : design; }
  return { ...design, layerColors: { ...design.layerColors, [layer.id]: color } };
}

/**
 * Shows or hides a layer the way the engine does (native fields switch `enabled`, template images their override,
 * metrics `metricChanges`…), for the template as `mode` sees it. Falls back to the plain switch when the engine
 * has no rule for the layer.
 */
export function setVisible(design: Design, layer: EditorLayer, visible: boolean, source?: FaceSource, mode: Mode = "current"): Design {
  // A spot's row: every image the face has for it, so the watch shows nothing there (or all of it again).
  if (layer.spot) {
    return layer.spot.states.filter((s) => s.layer.present && s.layer.visible !== visible)
      .reduce((next, s) => setVisible(next, s.layer, visible, source, mode), design);
  }
  // A weather icon coming onto the face brings its temperature: the reading shows unless "Icon only" is picked.
  if (layer.weatherIndicator && visible && !resolveWatchfaceModeDesign(design, mode).nativeData?.weather_temp) {
    const width = (source && pickPreviewResolution(modeDetails(source, design, mode))?.width) || MASTER;
    return editMode(setVisible(design, { ...layer, weatherIndicator: undefined }, visible, source, mode), mode, (d) => setTemperature(d, true, width));
  }
  if (!layer.canHide) return design;
  if (source && layer.kind !== "background") {
    try { return setWatchfaceAutomationVisibility(design, source.details, mode, layer.id, visible); } catch { /* falls through */ }
  }
  // The background layer is the template's picture, which the design switches with artworkVisible.
  if (layer.kind === "background") return { ...design, artworkVisible: visible };
  if (layer.nativeDataId && design.nativeData?.[layer.nativeDataId]) return { ...design, nativeData: { ...design.nativeData, [layer.nativeDataId]: { ...design.nativeData[layer.nativeDataId], enabled: visible } } };
  if (layer.metricId) return { ...design, metricChanges: { ...design.metricChanges, [layer.metricId]: visible } };
  return { ...design, layerVisibility: { ...design.layerVisibility, [layer.id]: visible } };
}

/** Whether the layer's opacity is the design's per-layer one (images and shapes keep their own, a later phase). */
export const hasLayerOpacity = (layer: EditorLayer) => !!layer.capabilities.opacity && !layer.spriteId && !layer.backgroundElementId;

/** A standalone status spot has one opacity, under the layout group the engine draws its states with. */
const opacityId = (layer: EditorLayer) => (layer.spot?.canAdd ? layer.spot.id : layer.id);

export function opacityOf(design: Design, layer: EditorLayer): number {
  return resolveWatchfaceLayerOpacity(design, opacityId(layer));
}

/** CorosLink's setOpacity for template layers: 1 drops the entry, so an untouched face stays as it was. */
export function setOpacity(design: Design, layer: EditorLayer, value: number): Design {
  if (!hasLayerOpacity(layer)) return design;
  const next = normalizeWatchfaceLayerOpacity(value);
  const layerOpacities = { ...design.layerOpacities };
  if (next === 1) delete layerOpacities[opacityId(layer)];
  else layerOpacities[opacityId(layer)] = next;
  return { ...design, layerOpacities };
}

/** Centres a movable layer across (x) or down (y) the master. */
export function centre(design: Design, layer: EditorLayer, axis: "x" | "y", master: number): Design {
  if (!layer.bounds) return design;
  const o = offsetOf(design, layer), b = layer.bounds;
  return axis === "x"
    ? moveTo(design, layer, o.dx + master / 2 - (b.x0 + b.x1) / 2, o.dy)
    : moveTo(design, layer, o.dx, o.dy + master / 2 - (b.y0 + b.y1) / 2);
}

// ───── Building ─────

/**
 * What the main process needs to build the face's archive: the composed sprites and config for the current layout
 * and its own always-on one, the 800 px background and preview, and config texts edited by hand. CorosLink's
 * createArchive, step for step.
 */
export async function buildInput(source: FaceSource, root: Design): Promise<WatchfaceBuildInput> {
  const sourceDetails = applyConfigTextEditsToDetails(source.details, root.configTextEdits);
  const configTextReplacements = Object.entries(root.configTextEdits ?? {})
    .filter(([p, text]) => Object.prototype.hasOwnProperty.call(source.baselines, p) && source.baselines[p] !== text)
    .map(([p, text]) => ({ path: p, text }));
  const current = resolveWatchfaceModeDesign(root, "current");
  const currentDetails = detailsForCompositionMode(sourceDetails, "current");
  const [rawCurrent, background] = await Promise.all([
    composeWatchfaceReplacements(currentDetails, current, source.loadAssets),
    renderDesignBackground(current, pickPreviewResolution(currentDetails)?.width ?? MASTER),
  ]);
  const currentComposition = hasWatchfaceAod(sourceDetails) ? retargetWatchfaceCompositionToCurrent(currentDetails, rawCurrent) : rawCurrent;
  let aod: { assetReplacements: CorosWatchfaceAssetReplacement[]; configOverrides: CorosWatchfaceConfigOverride[]; minWatchFaceVersion?: number } | undefined;
  if (hasWatchfaceAod(sourceDetails) && root.modeDesigns?.aod) {
    const aodDetails = detailsForCompositionMode(sourceDetails, "aod");
    const aodDesign = resolveWatchfaceModeDesign(root, "aod");
    const retargeted = retargetWatchfaceCompositionToAod(aodDetails, await composeWatchfaceReplacements(aodDetails, aodDesign, source.loadAssets));
    aod = { ...retargeted, assetReplacements: await buildAodSafeSpriteReplacements(retargeted.assetReplacements) };
    const visibleDivider = Boolean(aodDesign.exerciseSeparator?.enabled && aodDesign.metricChanges?.exercise !== false && aodDesign.layerVisibility?.exercise !== false);
    if (root.modeDesigns.aod.backgroundEdited || visibleDivider) {
      const aodBackground = await renderDesignBackground(aodDesign, pickPreviewResolution(aodDetails)?.width ?? MASTER);
      const extra = await buildAodBackgroundComposition(aodDetails, aodBackground);
      aod = { ...aod, assetReplacements: mergeAssetReplacements(aod.assetReplacements, extra.assetReplacements), configOverrides: mergeConfigOverrides(aod.configOverrides, extra.configOverrides) };
    }
  }
  const minWatchFaceVersion = Math.max(currentComposition.minWatchFaceVersion ?? 0, aod?.minWatchFaceVersion ?? 0) || undefined;
  const [preview, exportBackground, templateArtwork] = await Promise.all([
    renderFace(source, root, "current", MASTER),
    maskedMaster(background),
    templateBackground(source).catch(() => undefined),
  ]);
  // An untouched template background ships as its own files rather than the 800 px render scaled back down.
  const keepTemplateBackground = Boolean(templateArtwork && /(?:^|\/)background\.png$/i.test(templateArtwork.path)) &&
    isTemplateBackgroundUntouched(current, templateArtwork?.dataUrl);
  // Direct-asset visibility is enforced again at the boundary; keys a native field writes stay its own.
  const visible = mergeConfigOverrides(
    mergeConfigOverrides(currentComposition.configOverrides, aod?.configOverrides ?? []),
    keepNativeOwnedKeys(buildDisabledWatchfaceConfigAssetOverrides(currentDetails, current.configAssetOverrides ?? {}), current.nativeData),
    buildDisabledControlComplicationOverrides(currentDetails, current),
  );
  const { assetReplacements, configOverrides } = await finalizeWatchfaceStatusIcons(sourceDetails,
    mergeAssetReplacements(currentComposition.assetReplacements, aod?.assetReplacements ?? []), visible, source.loadAssets);
  return {
    backgroundDataUrl: exportBackground,
    previewDataUrl: preview,
    ...(keepTemplateBackground ? { keepTemplateBackground: true } : {}),
    ...(root.archiveWatchFaceVersion !== undefined ? { watchFaceVersion: root.archiveWatchFaceVersion } : {}),
    ...(root.stripBlankConfigKeys ? { stripBlankConfigKeys: true } : {}),
    ...(root.archiveOverrides?.templateId ? { templateIdOverride: root.archiveOverrides.templateId } : {}),
    ...(root.archiveOverrides?.watchfaceId ? { watchfaceIdOverride: root.archiveOverrides.watchfaceId } : {}),
    ...(root.archiveOverrides?.templateName ? { templateNameOverride: root.archiveOverrides.templateName } : {}),
    ...(assetReplacements.length ? { assetReplacements: assetReplacements.map(({ path, dataUrl, create, allowDimensionOverride }) => ({ path, dataUrl, ...(create ? { create } : {}), ...(allowDimensionOverride ? { allowDimensionOverride } : {}) })) } : {}),
    ...(configOverrides.length ? { configOverrides } : {}),
    ...(configTextReplacements.length ? { configTextReplacements } : {}),
    ...(minWatchFaceVersion !== undefined ? { minWatchFaceVersion } : {}),
  };
}

/** The background at 800 px, cut to the round screen. */
async function maskedMaster(background: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = MASTER;
  canvas.height = MASTER;
  canvas.getContext("2d", { colorSpace: "display-p3" })!.drawImage(await loadStudioImage(background, false), 0, 0, MASTER, MASTER);
  maskCanvasToCircle(canvas);
  return canvas.toDataURL("image/png");
}
