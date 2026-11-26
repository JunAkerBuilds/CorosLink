// Studio's right panel, from the design's "Studio inspector by layer type" boards: the header, what a kind of layer
// needs first, then its sections (Position and size, the kind's own, Look and visibility, Advanced), all open unless
// folded by hand. Every control writes the design field CorosLink's editor writes for it (studioEdits.ts).
import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { beginGesture, endGesture } from "../studioGesture";
import { Segmented, Select, Switch } from "@/components/ui";
import { language, locale, msg, t, tx } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import type { CorosWatchfaceArtwork, CorosWatchfaceNativePart, CorosWatchfaceResolutionDetails } from "../../watchface/types";
import { WATCH_LANGUAGE_NAMES } from "../../watchface/engine/watchfaceLanguages";
import { watchThemeSupport, watchThemeSwatch } from "../../watchface/engine/watchfaceThemeColor";
import { defaultNativeDataStyle, nativeComponentFontSize, nativeFontSizePart, nativePart, nativePartForFontSize, nativePartRole, nativeParts, nativeRoleIndices } from "../../watchface/engine/nativeDataParts";
import { nativeDataAsset } from "../../watchface/engine/nativeData";
import { pickPreviewResolution } from "../../watchface/engine/watchfaceStudio";
import { NATIVE_DATA_BY_ID } from "../../watchface/watchfaceNativeCatalog";
import { Icon } from "../parts/StudioIcon";
import type { AnimationPlayback } from "../parts/StudioAnimation";
import { DEFAULT_ANIMATION_DELAY, MAX_ANIMATION_DELAY, MAX_ANIMATION_FRAMES, MIN_ANIMATION_DELAY } from "../../watchface/engine/watchfaceAnimationLimits";
import { OfficialPicker } from "../parts/StudioOfficialPicker";
import { Shadows, Strokes } from "../parts/StudioStacks";
import { ExerciseSeparatorFold } from "../parts/StudioExerciseSeparator";
import { TemplateImageFacts, TemplatePicture } from "../parts/StudioTemplateImage";
import { AmPmPictures } from "../parts/StudioAmPmPictures";
import { SpotHeight } from "../parts/StudioSpotHeight";
import { NativePartLayout, NativePictures } from "../parts/StudioNativePart";
import { animationOutcomeText, droppedFrames, useAnimationOutcome } from "../studioAnimationOutcome";
import { animationOutcomeNeedsNotice } from "../../watchface/engine/watchfaceAnimationOutcome";
import { SlotTop } from "../parts/StudioSlot";
import { officialArtwork, officialBatteryRequest, officialBatteryStates, officialImageRequest, officialWeatherRequest, restoreWeatherSet, setWeatherSet, weatherSetCount } from "../studioOfficial";
import { googleWeights } from "../studioGoogleFonts";
import { WEATHER_ASSET_COUNTS, weatherAssetUrl } from "../../watchface/engine/weatherAssets";
import { FontPicker, LayerFontPicker, loadImage, type LoadAssets } from "./StudioFontPicker";
import {
  addShadow, addStroke, align, assetOf, canMove, distribute, elementOf, familyOf, fontSizeOf, isLocked, nativeOf, panelOf, partsOf,
  progressBarOn, progressColour, progressKind, progressOf, readArtwork, replaceAsset, restoreAsset, scaleOf, setAsset, setBatteryStates, setDate, setSpotScale,
  setDelays, setElement, setFontSize, setLocked, setNative, setPart, setPercent, setProgress, setScale, setShadows, setSprite, setStrokes, setTypo,
  isPercentLayer, percentOf,
  shadowsOf, spriteOf, strokesOf, typoOf, typographyOf, nudge, positionOf, type PanelKind,
} from "../studioEdits";
import { measureChartReadoutArt } from "../studioChartArt";
import { colour, colourChanged, colourOf, hasLayerOpacity, resetColour, opacityOf, setOpacity, spotPicked, type Design, type EditorLayer, type SpotChoice } from "../studioFace";
import {
  CHART_GRAPH_ICON, CHART_GRAPH_LABEL, chartFixBlock, chartPageRows, fixChartReadout, fixedChartReadouts, unfixChartReadout, chartStylesInUse, nextChartPage, removeChartReadout, setChartPageOn, setChartReadout, showChartPage, type ChartPageRow,
  canPreviewPage, chartPageChange, chartReadoutToEdit, showTemplateChartPage,
} from "../studioCharts";
import { chartSourceOf } from "../../watchface/engine/chartReadouts";
import type { CorosWatchfaceTemplateDetails } from "../../watchface/types";

export const PALETTE = ["#ffffff", "#53cba1", "#ff8a3d", "#6aa5ff", "#ff6b9a", "#ffd166"] as const;

export const KIND: Partial<Record<PanelKind, string>> = {
  time: msg("Time digits"), metric: msg("Live data"), date: msg("Date"), selectable: msg("Wearer picks"), ampm: msg("12-hour clock"), separator: msg("Separator"),
  native: msg("Live data"), weather: msg("Day and night"), batteryIcon: msg("12 states"), image: msg("Template image"), animation: msg("Animation"),
  sprite: msg("Image"), shape: msg("Shape"), text: msg("Text"), background: msg("Face"), chart: msg("Chart"), other: msg("Layer"),
};

type Edit = (fn: (d: Design) => Design) => void;

export interface LayerInspectorProps {
  layer: EditorLayer;
  design: Design;
  edit: Edit;
  details: CorosWatchfaceTemplateDetails;
  resolution: CorosWatchfaceResolutionDetails | null;
  master: number;
  icon: string;
  aodNote: boolean;
  /** "Shows on": one chip per display the layer exists on, and whether it shows there. */
  showsOn: { label: string; on: boolean; toggle: () => void }[];
  onHide: () => void;
  onShow: () => void;
  /** Takes the layer off the face for good (artwork, and seconds or a date part Studio added); null where hiding is all there is. */
  onRemove?: (() => void) | null;
  onSplitTime: () => void;
  onHome: (() => void) | null;
  /** The template's PNGs, for the font picker's template digits. */
  loadAssets?: LoadAssets;
  /** The face's watch, which the official library opens on. */
  watch: string;
  say: (text: string) => void;
  /** For a shared spot (Bluetooth, Do Not Disturb): the state shown, picking another, and one state's image on or off. */
  choice?: SpotChoice;
  onState?: (spot: string, key: string) => void;
  onAddState?: (key: string) => void;
  onStateVisible?: (state: EditorLayer, visible: boolean) => void;
  /** Every layer the engine knows on this display (the selectable slot's panel finds its icons among them). */
  allLayers?: EditorLayer[];
  /** The watch's name, for what it plays of an animation. */
  watchLabel?: string;
  /** The animation on the canvas: playing, or held on one frame. */
  playback?: AnimationPlayback;
  onPlayback?: (next: AnimationPlayback) => void;
  /** The face's own artwork: where it stands in the paint order (0 at the back), moving it, and copying it. */
  arrange?: { place: { index: number; count: number }; move: (step: "forward" | "backward" | "front" | "back") => void; copy: () => void };
}

export function LayerInspector(p: LayerInspectorProps) {
  const { layer, design, edit, resolution } = p;
  const kind = panelOf(layer, design);
  const [more, setMore] = useState(false);
  const locked = isLocked(design, layer);
  const fail = (e: unknown) => p.say(e instanceof Error ? e.message : String(e));

  const typo = typoOf(design, layer);
  const fontSize = fontSizeOf(design, layer, resolution);
  const typed = ["time", "metric", "date", "selectable", "ampm", "separator", "native"].includes(kind);
  const position = canMove(layer);
  const at = positionOf(design, layer);
  const progress = progressOf(design, layer, resolution);

  return (
    <div className="st-insp">
      <div className="st-insp-head">
        <span className="st-insp-icon"><Icon name={p.icon} size={19} /></span>
        <span><b>{t(layer.label)}</b><small>{layer.spot ? t("Status") : KIND[kind] ? t(KIND[kind]!) : ""}{p.aodNote ? ` · ${t("always-on")}` : ""}</small></span>
        <div className="st-menu-wrap">
          <button type="button" className="st-icon-btn" aria-label={t("More actions")} title={t("More actions")} aria-expanded={more} onClick={() => setMore((m) => !m)}><Icon name="more" /></button>
          {more ? (
            <div className="st-menu st-menu-down st-insp-more" role="menu" onClick={() => setMore(false)}>
              {p.onHome ? <button type="button" role="menuitem" onClick={p.onHome}><Icon name="refresh" size={16} />{t("Back to the template's place")}</button> : null}
              {p.arrange ? <ArrangeItems {...p.arrange} /> : null}
              <button type="button" role="menuitem" onClick={() => edit((x) => setLocked(x, layer, !locked))}><Icon name="lock" size={16} />{locked ? t("Unlock") : t("Lock")}</button>
              {layer.canHide && layer.visible ? <button type="button" role="menuitem" onClick={p.onHide}><Icon name="eyeOff" size={16} />{t("Hide from the face")}</button> : null}
              {layer.canHide && !layer.visible ? <button type="button" role="menuitem" onClick={p.onShow}><Icon name="eye" size={16} />{t("Show on the face")}</button> : null}
              {p.onRemove ? <button type="button" role="menuitem" onClick={p.onRemove}><Icon name="trash" size={16} />{locked ? t("Unlock and delete") : layer.id === "seconds" ? t("Remove seconds") : t("Delete")}</button> : null}
            </div>
          ) : null}
        </div>
      </div>

      <section className="st-insp-body">
        {kind === "time" && layer.id === "autoTime" ? <div className="st-row"><span>{t("Separate hours and minutes")}</span><Switch label={t("Separate hours and minutes")} checked={false} onChange={(v) => { if (v) p.onSplitTime(); }} /></div> : null}
        {kind === "selectable" ? <SlotTop {...p} fail={fail} /> : null}
        {kind === "date" ? <DateTop {...p} /> : null}
        {typed ? <>
          <LayerFontPicker design={design} layer={layer} edit={edit} resolution={resolution} loadAssets={p.loadAssets} fail={fail} watch={p.watch} />
          {kind === "ampm" ? <ColourRow label={t("Color")} value={colourOf(design, layer)} onPick={(c) => edit((x) => setTypo(x, layer, { color: c }))} />
            : layer.capabilities.color ? <ColourRow label={kind === "selectable" ? t("Values and icons") : t("Color")} {...layerColour(design, layer, edit)} /> : null}
          <TypeFields design={design} layer={layer} edit={edit} kind={kind} fontSize={fontSize} resolution={resolution} />
        </> : null}
        {kind === "ampm" ? <AmPmPictures design={design} edit={edit} fail={fail} /> : null}
        {kind === "native" ? <NativeParts design={design} edit={edit} layer={layer} fail={fail} watch={p.watch} resolution={resolution} /> : null}
        {kind === "weather" ? <WeatherTop {...p} fail={fail} /> : null}
        {kind === "batteryIcon" ? <BatteryTop {...p} fail={fail} /> : null}
        {layer.spot ? <SpotTop {...p} fail={fail} /> : kind === "image" ? <ImageTop {...p} fail={fail} /> : null}
        {kind === "image" && isPercentLayer(layer) ? <PercentLook design={design} edit={edit} replaced={Boolean(assetOf(design, layer)?.replacement)} /> : null}
        {kind === "sprite" ? <SpriteTop {...p} fail={fail} /> : null}
        {kind === "shape" || kind === "text" ? <ElementTop {...p} /> : null}
        {kind === "chart" ? <ChartTop {...p} /> : null}
        {kind === "background" ? <BackgroundFields design={design} edit={edit} fail={fail} /> : null}
        {kind === "other" && layer.capabilities.color ? <ColourRow label={t("Color")} {...layerColour(design, layer, edit)} /> : null}
      </section>

      {kind === "animation" ? <AnimationFolds {...p} fail={fail} /> : null}

      {kind === "metric" && layer.metricId === "battery" && resolution?.config.battery_level_percent_icon ? (
        <Fold title={t("% sign")}>
          <PercentLook design={design} edit={edit}
            replaced={["config", "aod"].some((scope) => design.configAssetOverrides?.[`${scope}:battery_level_percent_icon`]?.replacement)} />
        </Fold>
      ) : null}

      {kind === "metric" && layer.metricId === "exercise" ? <ExerciseSeparatorFold design={design} edit={edit} details={p.details} fail={fail} /> : null}

      {progress ? (
        <Fold title={t("Progress")}>
          <div className="st-nums">
            <Toggle label={t("Arc")} on={progress.arcEnabled} set={(v) => edit((x) => setProgress(x, layer, resolution, { arcEnabled: v }))} />
            <Toggle label={t("Bar")} on={progressBarOn(progress)} set={(v) => edit((x) => setProgress(x, layer, resolution, { barEnabled: v }))} />
          </div>
          <ColourRow label={progressKind(layer) === "kcal" ? t("Arc and bar color") : t("Color")} value={progressColour(progress)} onPick={(c) => edit((x) => setProgress(x, layer, resolution, { color: c }))} />
          {progress.arcEnabled ? <>
            <div className="st-nums">
              <NumberField label={t("Start")} unit="°" value={progress.arc.startAngle} min={-360} max={360} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { arc: { startAngle: v } }))} />
              <NumberField label={t("End")} unit="°" value={progress.arc.endAngle} min={-360} max={360} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { arc: { endAngle: v } }))} />
              <NumberField label={t("Thick")} unit="px" value={progress.arc.strokeWidth} min={1} max={200} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { arc: { strokeWidth: v } }))} />
              <NumberField label="R" value={progress.arc.radiusX} min={1} max={800} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { arc: { radiusX: v, radiusY: v } }))} />
              <NumberField label="CX" value={progress.arc.centerX} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { arc: { centerX: v } }))} />
              <NumberField label="CY" value={progress.arc.centerY} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { arc: { centerY: v } }))} />
            </div>
            <div className="st-row"><span>{t("Draw remaining portion")}</span><Switch label={t("Draw remaining portion")} checked={progress.arc.background} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { arc: { background: v } }))} /></div>
          </> : null}
          {progressBarOn(progress) ? <>
            <div className="st-row"><span>{t("Fills toward")}</span>
              <Segmented small label={t("Fill direction")} value={progress.rect.direction} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { rect: { direction: v } }))}
                options={[{ value: "right", label: "→" }, { value: "left", label: "←" }, { value: "top", label: "↑" }, { value: "bottom", label: "↓" }]} /></div>
            <div className="st-nums">
              <NumberField label="X0" value={progress.rect.x0} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { rect: { x0: v } }))} />
              <NumberField label="Y0" value={progress.rect.y0} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { rect: { y0: v } }))} />
              <NumberField label="X1" value={progress.rect.x1} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { rect: { x1: v } }))} />
              <NumberField label="Y1" value={progress.rect.y1} onChange={(v) => edit((x) => setProgress(x, layer, resolution, { rect: { y1: v } }))} />
            </div>
          </> : null}
          <Slider label={t("Preview fill")} value={Math.round(progress.previewPercent)} min={0} max={100} unit="%" onCommit={(v) => edit((x) => setProgress(x, layer, resolution, { previewPercent: v }))} />
        </Fold>
      ) : null}

      {position || (typo && "rotation" in (typo ?? {})) || kind === "time" || kind === "metric" || kind === "date" || kind === "selectable" ? (
        <Fold title={t("Position and size")} note={at ? `${Math.round(at.x)}, ${Math.round(at.y)}` : undefined}>
          {position && at ? <>
            <div className="st-nums">
              <NumberField label="X" value={Math.round(at.x)} onChange={(v) => edit((x) => nudge(x, layer, v - at.x, 0))} />
              <NumberField label="Y" value={Math.round(at.y)} onChange={(v) => edit((x) => nudge(x, layer, 0, v - at.y))} />
            </div>
            {layer.bounds ? <AlignRow onAlign={(e) => edit((x) => align(x, [layer], e, p.master))} /> : null}
          </> : null}
          {layer.spot && layer.capabilities.scale && layer.bounds ? <SpotHeight layer={layer} scale={scaleOf(design, layer) ?? 1} set={(v) => edit((x) => setSpotScale(x, layer, v))} /> : null}
          {kind === "time" || kind === "metric" || kind === "date" || kind === "selectable" ? (
            <NumberField label={t("Rotation")} unit="°" value={Math.round(typo?.rotation ?? 0)} min={0} max={360} onChange={(v) => edit((x) => setTypo(x, layer, { rotation: ((v % 360) + 360) % 360 }))} />
          ) : null}
          {position ? <span className="st-note">{t("Arrow keys nudge 1 px, Shift 10.")}</span> : null}
        </Fold>
      ) : null}

      {kind === "date" ? <LanguagesFold {...p} /> : null}

      <Fold title={t("Look and visibility")}>
        {hasLayerOpacity(layer) ? <Slider key={`o:${layer.id}`} label={t("Opacity")} value={Math.round(opacityOf(design, layer) * 100)} min={0} max={100} unit="%" onCommit={(v) => edit((x) => setOpacity(x, layer, v / 100))} /> : null}
        {layer.capabilities.stroke ? <Strokes list={strokesOf(design, layer)} add={() => edit((x) => addStroke(x, layer))} set={(list) => edit((x) => setStrokes(x, layer, list))} /> : null}
        {layer.capabilities.effects || layer.capabilities.stroke ? <Shadows list={shadowsOf(design, layer)} add={() => edit((x) => addShadow(x, layer))} set={(list) => edit((x) => setShadows(x, layer, list))} /> : null}
        {p.showsOn.length ? (
          <div className="st-row-col st-shows"><span>{t("Shows on")}</span>
            <div className="st-chips">{p.showsOn.map((s) => <button key={s.label} type="button" className="chip" aria-pressed={s.on} onClick={s.toggle}>{s.label}</button>)}</div>
          </div>
        ) : null}
      </Fold>

      {kind === "time" || kind === "metric" || kind === "date" || kind === "selectable" || kind === "native" ? (
        <Fold title={t("Advanced")}>
          {kind !== "native" ? (
            // Smooth (anti-aliased) edges are how COROS's own faces look; hard 0/255 edges are a pixel-art look that is
            // jagged on AMOLED, so it is tucked away here rather than offered beside the font.
            <div className="st-row"><span>{t("Hard pixel edges")}</span>
              <Switch label={t("Hard pixel edges")} checked={!!typo?.solidAlpha} onChange={(v) => edit((x) => setTypo(x, layer, { solidAlpha: v ? true : undefined }))} /></div>
          ) : null}
          {kind === "native" ? (
            <button type="button" className="chip st-chip-btn" onClick={() => edit((x) => {
              const n = nativeOf(x, layer);
              return n ? setNative(x, layer, { ...defaultNativeDataStyle(layer.nativeDataId!), enabled: n.enabled, x: n.x, y: n.y }) : x;
            })}><Icon name="refresh" size={15} />{t("Restore all appearance defaults")}</button>
          ) : kind === "date" || kind === "selectable" ? null : (
            <button type="button" className="chip st-chip-btn" onClick={() => edit((x) => setTypo(x, layer, { fontFamily: undefined, fontWeight: undefined, fontStyle: undefined, letterSpacing: undefined, rasterFont: undefined, fontSize: undefined, rotation: undefined, solidAlpha: undefined }))}>
              <Icon name="refresh" size={15} />{t("Back to the face's type")}</button>
          )}
        </Fold>
      ) : null}
    </div>
  );
}

/** The More menu's artwork rows: copy, and the paint order (CorosLink's shortcuts beside each). */
function ArrangeItems({ place, move, copy }: NonNullable<LayerInspectorProps["arrange"]>) {
  const top = place.index >= place.count - 1, bottom = place.index <= 0;
  return <>
    <button type="button" role="menuitem" onClick={copy}><Icon name="plus" size={16} />{t("Duplicate")}<kbd>⌘D</kbd></button>
    <button type="button" role="menuitem" disabled={top} onClick={() => move("forward")}><Icon name="chevU" size={16} />{t("Bring forward")}<kbd>⌥↑</kbd></button>
    <button type="button" role="menuitem" disabled={bottom} onClick={() => move("backward")}><Icon name="chevD" size={16} />{t("Send backward")}<kbd>⌥↓</kbd></button>
    <button type="button" role="menuitem" disabled={top} onClick={() => move("front")}><Icon name="chevU" size={16} />{t("Bring to front")}<kbd>⇧⌥↑</kbd></button>
    <button type="button" role="menuitem" disabled={bottom} onClick={() => move("back")}><Icon name="chevD" size={16} />{t("Send to back")}<kbd>⇧⌥↓</kbd></button>
  </>;
}

/* ───────────── Type ───────────── */

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const WEIGHT_NAMES: Record<number, string> = { 100: msg("Thin"), 200: msg("Extra light"), 300: msg("Light"), 400: msg("Regular"), 500: msg("Medium"), 600: msg("Semibold"), 700: msg("Bold"), 800: msg("Extra bold"), 900: msg("Black") };
/** The weights to offer: every one for a font on this computer, the ones it has for a Google family (and the one in use). */
const weightChoices = (family: string | undefined, current: number): number[] => {
  const has = googleWeights(family);
  return has ? [...new Set([...has, current])].sort((a, b) => a - b) : [...WEIGHTS];
};

function TypeFields({ design, layer, edit, kind, fontSize, resolution, onSize }: { design: Design; layer: EditorLayer; edit: Edit; kind: PanelKind; fontSize: number | null; resolution: CorosWatchfaceResolutionDetails | null; onSize?: (v: number) => void }) {
  const tm = typoOf(design, layer);
  const ty = typographyOf(design, layer);
  const sprite = !familyOf(design, layer) && !ty.rasterFont;
  const hasSpacing = kind !== "separator";
  const hasAlign = kind === "metric" || kind === "date" || kind === "selectable";
  const scale = scaleOf(design, layer);
  return <>
    <div className="st-nums">
      {fontSize !== null ? <NumberField label={t("Size")} unit="px" value={fontSize} min={4} max={400} onChange={(v) => (onSize ? onSize(v) : edit((x) => setFontSize(x, layer, v, resolution)))} /> : null}
      {fontSize === null && scale !== null ? <NumberField label={t("Scale")} unit="%" value={Math.round(scale * 100)} min={10} max={400} onChange={(v) => edit((x) => setScale(x, layer, v / 100))} /> : null}
      {hasSpacing && !sprite ? <NumberField label={t("Spacing")} unit="%" value={Math.round((ty.letterSpacing ?? 0) * 100)} min={-35} max={25} onChange={(v) => edit((x) => setTypo(x, layer, { letterSpacing: Math.max(-0.35, Math.min(0.25, v / 100)) }))} /> : null}
    </div>
    {!sprite ? (
      <div className="st-nums">
        <label className="st-select"><span className="sr-only">{tx("font", "Weight")}</span>
          <Select aria-label={tx("font", "Weight")} value={ty.fontWeight ?? 400} onChange={(e) => edit((x) => setTypo(x, layer, { fontWeight: Number(e.target.value) }))}>
            {weightChoices(familyOf(design, layer), ty.fontWeight ?? 400).map((w) => <option key={w} value={w}>{w} {WEIGHT_NAMES[w] ? tx("font weight", WEIGHT_NAMES[w]) : ""}</option>)}
          </Select><Icon name="chevD" size={14} /></label>
        <Segmented small label={t("Style")} value={ty.fontStyle ?? "normal"} onChange={(v) => edit((x) => setTypo(x, layer, { fontStyle: v }))} options={[{ value: "normal", label: t("Normal") }, { value: "italic", label: t("Italic") }]} />
      </div>
    ) : null}
    {hasAlign ? (
      <div className="st-row"><span>{t("Align")}</span>
        <Segmented small label={t("Align")} value={tm?.align ?? "center"} onChange={(v) => edit((x) => setTypo(x, layer, { align: v }))}
          options={[{ value: "left", label: <Icon name="alignL" size={15} /> }, { value: "center", label: <Icon name="alignH" size={15} /> }, { value: "right", label: <span className="st-flip"><Icon name="alignL" size={15} /></span> }]} /></div>
    ) : null}
  </>;
}

/* ───────────── Kinds ───────────── */

function DateTop({ layer, design, edit, resolution }: LayerInspectorProps) {
  const style = design.dateStyles?.[layer.id];
  const words = layer.id === "weekday" || (layer.id === "dateMonth" && style?.monthFormat === "labels");
  const sample = layer.id === "weekday" ? ["SUN", "Sun", "Sunday"] : ["NOV", "Nov", "November"];
  return <>
    {layer.id === "dateMonth" ? (
      <div className="st-row"><span>{t("Show as")}</span>
        <Segmented small label={t("Month format")} value={style?.monthFormat ?? "digits"} onChange={(v) => edit((x) => setDate(x, layer, { monthFormat: v }, resolution))} options={[{ value: "digits", label: t("Number") }, { value: "labels", label: t("Words") }]} /></div>
    ) : null}
    {words ? (
      <Segmented small label={t("Label style")} value={style?.labelStyle ?? "upper"} onChange={(v) => edit((x) => setDate(x, layer, { labelStyle: v }, resolution))}
        options={[{ value: "upper", label: sample[0] }, { value: "title", label: sample[1] }, { value: "full", label: sample[2] }]} />
    ) : null}
  </>;
}

function LanguagesFold({ layer, design, edit, resolution }: LayerInspectorProps) {
  const style = design.dateStyles?.[layer.id];
  const words = layer.id === "weekday" || (layer.id === "dateMonth" && style?.monthFormat === "labels");
  if (!words) return null;
  const all = style?.overwriteAllLanguages ?? false;
  const picked = new Set(style?.overwriteLanguages ?? []);
  const languages = Object.entries(WATCH_LANGUAGE_NAMES).filter(([code]) => code !== "en");
  return (
    <Fold title={t("Languages")} note={style?.translateLabels === false ? t("Off") : all ? t("All") : picked.size ? String(picked.size) : undefined}>
      <div className="st-row"><span>{t("Translate for watch languages")}</span><Switch label={t("Translate for watch languages")} checked={style?.translateLabels !== false} onChange={(v) => edit((x) => setDate(x, layer, { translateLabels: v }, resolution))} /></div>
      <div className="st-row"><span>{t("Use this look in every language")}</span><Switch label={t("Use this look in every language")} checked={all} onChange={(v) => edit((x) => setDate(x, layer, { overwriteAllLanguages: v }, resolution))} /></div>
      {!all ? (
        <div className="st-chips">
          {languages.map(([code, name]) => (
            <button key={code} type="button" className="chip" aria-pressed={picked.has(code)} onClick={() => {
              const next = new Set(picked); if (next.has(code)) next.delete(code); else next.add(code);
              edit((x) => setDate(x, layer, { overwriteLanguages: [...next] }, resolution));
            }}>{name}</button>
          ))}
        </div>
      ) : null}
    </Fold>
  );
}

const PART_LABEL: Partial<Record<CorosWatchfaceNativePart, string>> = { value: msg("Value"), icon: msg("Icon"), unit: msg("Unit"), symbols: msg("Signs"), states: msg("States"), decimal: msg("Decimal"), separator: msg("Separator"), progress: msg("Progress") };

const WEATHER_SETS = [{ set: "day", label: msg("Day icons") }, { set: "night", label: msg("Night icons") }] as const;

function WeatherTop({ design, edit, layer, watch, fail }: LayerInspectorProps & { fail: (e: unknown) => void }) {
  const w = design.weatherIndicator;
  const [browse, setBrowse] = useState<"day" | "night" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<"day" | "night" | null>(null);
  if (!w) return null;
  // A folder of numbered PNGs (00.png, 01.png…) replaces those states; the states left out keep what they show now.
  const load = async (which: "day" | "night", files: FileList | null) => {
    if (!files?.length) return;
    try {
      const count = WEATHER_ASSET_COUNTS[which];
      const picked: Record<string, string> = {};
      for (const f of [...files]) {
        const m = f.name.match(/^(\d{1,2})\.png$/i);
        if (m && Number(m[1]) < count) picked[String(Number(m[1]))] = (await readArtwork(f)).dataUrl;
      }
      if (!Object.keys(picked).length) throw new Error(t("Name the pictures 00.png to {last}.png.", { last: String(count - 1).padStart(2, "0") }));
      edit((x) => ({ ...x, weatherIndicator: { enabled: true, x: 0, y: 0, scale: 1, ...x.weatherIndicator, assets: { ...x.weatherIndicator?.assets, [which]: { ...x.weatherIndicator?.assets?.[which], ...picked } } } }));
    } catch (e) { fail(e); }
  };
  return <>
    <ColourRow label={t("Tint")} value={w.color ?? "#ffffff"} onPick={(c) => edit((x) => (x.weatherIndicator ? { ...x, weatherIndicator: { ...x.weatherIndicator, color: c } } : x))}
      onReset={w.color ? () => edit((x) => (x.weatherIndicator ? { ...x, weatherIndicator: { ...x.weatherIndicator, color: undefined } } : x)) : null} />
    <div className="st-nums"><NumberField label={t("Scale")} unit="%" value={Math.round((scaleOf(design, layer) ?? 1) * 100)} min={10} max={400} onChange={(v) => edit((x) => setScale(x, layer, v / 100))} /></div>
    {WEATHER_SETS.map(({ set, label }) => {
      const count = WEATHER_ASSET_COUNTS[set];
      const replaced = weatherSetCount(design, set);
      return (
        <div key={set} className="st-wx-card">
          <div className="st-wx-head">
            <b>{t(label)}</b>
            <span className="st-wx-badge" data-custom={replaced ? "" : undefined}>{replaced ? t("Custom") : t("Built in")}</span>
            <span className="st-grow" />
            {replaced ? <button type="button" className="st-icon-btn" aria-label={t("Restore the built-in {name}", { name: t(label).toLowerCase() })} title={t("Back to the built-in set")} onClick={() => edit((x) => restoreWeatherSet(x, set))}><Icon name="refresh" size={15} /></button> : null}
          </div>
          <div className="st-wx-grid" role="list" aria-label={t(label)}>
            {Array.from({ length: count }, (_, i) => (
              <span key={i} className="st-wx-cell" role="listitem" title={`${String(i).padStart(2, "0")}.png`}>
                <img src={weatherAssetUrl(set, i, w)} alt="" draggable={false} /><small>{String(i).padStart(2, "0")}</small>
              </span>
            ))}
          </div>
          <span className="st-note">{replaced === count ? t("All {n} replaced", { n: count }) : replaced ? t("{n} of {total} replaced", { n: replaced, total: count }) : t("C-LINK's built-in set")} · {t("PNGs named 00–{last}", { last: String(count - 1).padStart(2, "0") })}</span>
          <div className="st-nums">
            <button type="button" className="chip st-chip-btn" onClick={() => { setImporting(set); input.current?.click(); }}><Icon name="folder" size={15} />{t("Import folder")}</button>
            <button type="button" className="chip st-chip-btn" aria-label={t("Official library for {name}", { name: t(label).toLowerCase() })} onClick={() => setBrowse(set)}><Icon name="spark" size={15} />{t("Official")}</button>
          </div>
        </div>
      );
    })}
    <input ref={input} type="file" hidden multiple accept="image/png" {...{ webkitdirectory: "" }} onChange={(e) => { if (importing) void load(importing, e.target.files); e.target.value = ""; }} />
    <span className="st-note">{t("Simulate shows each of the 41 day and night pictures on the face.")}</span>
    {browse ? <OfficialPicker watch={watch} request={officialWeatherRequest(browse)} onClose={() => setBrowse(null)} onPick={(set) => edit((x) => setWeatherSet(x, browse, set))} /> : null}
  </>;
}

const BATTERY_STATES = [msg("Charging"), "0%", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%"];

/** The template's own battery pictures by state number, from the folder its config names (as the build finds it). */
function templateBatteryFiles(details: CorosWatchfaceTemplateDetails, control: boolean) {
  const r = pickPreviewResolution(details);
  if (!r) return [];
  const named = r.config[control ? "control_battery_icon_dir" : "battery_icon_dir"]?.replace(/\\/g, "/");
  const states = r.spriteFolders.filter((f) => f.kind === "state" && !f.aod);
  const folder = (named ? states.find((f) => f.folder === named) : undefined)
    ?? states.find((f) => f.folder.replace(/^a\//, "") === (control ? "cl_control_battery_icon" : "cl_battery_icon"))
    ?? (control ? undefined : states.find((f) => f.folder.replace(/^a\//, "") === "battery"));
  return (folder?.files ?? []).flatMap((f) => { const m = f.path.match(/(\d{1,2})\.png$/i); return m ? [{ index: Number(m[1]), path: f.path }] : []; });
}

function BatteryTop({ design, edit, layer, fail, watch, details, loadAssets }: LayerInspectorProps & { fail: (e: unknown) => void }) {
  const o = assetOf(design, layer);
  const input = useRef<HTMLInputElement>(null);
  const [official, setOfficial] = useState(false);
  const states = o?.stateReplacements;
  // What the face shows for each state: a picture the face set, else the template's own, else nothing ("?").
  const [template, setTemplate] = useState<Record<number, string>>({});
  const control = layer.kind === "controlBatteryIcon";
  // Keyed by the files, not `details`, which is a new object on every render.
  const filesKey = templateBatteryFiles(details, control).map((f) => `${f.index}=${f.path}`).join("|");
  useEffect(() => {
    const files = filesKey ? filesKey.split("|").map((x) => { const [index, path] = x.split("="); return { index: Number(index), path: path! }; }) : [];
    if (!files.length || !loadAssets) return;
    let live = true;
    void loadAssets(files.map((f) => f.path)).then((assets) => {
      if (!live) return;
      const byPath = new Map(assets.map((a) => [a.path, a.dataUrl]));
      setTemplate(Object.fromEntries(files.flatMap((f) => (byPath.get(f.path) ? [[f.index, byPath.get(f.path)!]] : []))));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [filesKey, loadAssets]);
  const pictureOf = (i: number) => states?.[String(i)]?.dataUrl ?? template[i];
  const missing = BATTERY_STATES.filter((_, i) => !pictureOf(i)).length;
  const load = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const picked: Record<string, CorosWatchfaceArtwork> = {};
      for (const f of [...files]) {
        const m = f.name.match(/^(\d{1,2})\.png$/i);
        if (m) picked[String(Number(m[1]))] = await readArtwork(f);
      }
      if (!Object.keys(picked).length) throw new Error(t("Name battery pictures 00.png (charging), 01.png (empty) to 11.png (full)."));
      edit((x) => setBatteryStates(x, layer, picked));
    } catch (e) { fail(e); }
  };
  const rotation = o?.rotation ?? 0;
  return <>
    <div className="st-states">
      {BATTERY_STATES.map((label, i) => {
        const url = pictureOf(i);
        return (
          <span key={label} className="st-state" data-missing={url ? undefined : ""} title={url ? `${String(i).padStart(2, "0")}.png · ${t(label)}` : t("{state}: no picture. Add {file}.png", { state: t(label), file: String(i).padStart(2, "0") })}>
            {url ? <img src={url} alt="" /> : <b aria-label={t("Missing")}>?</b>}<small>{t(label)}</small>
          </span>
        );
      })}
    </div>
    <span className="st-note">{missing ? `${t("{n} of 12 states have no picture yet.", { n: missing })} ` : ""}{t("One picture per state: 00.png charging, 01.png empty, 02–11.png for 10–100%.")}</span>
    <div className="st-nums">
      <button type="button" className="chip st-chip-btn" onClick={() => input.current?.click()}><Icon name="upload" size={15} />{t("Numbered PNGs")}</button>
      <button type="button" className="chip st-chip-btn" onClick={() => setOfficial(true)}><Icon name="spark" size={15} />{t("Official sprites")}</button>
      {o?.stateReplacements ? <button type="button" className="chip st-chip-btn" onClick={() => edit((x) => restoreAsset(x, layer))}><Icon name="refresh" size={15} />{t("Restore")}</button> : null}
    </div>
    <input ref={input} type="file" hidden multiple accept="image/png" onChange={(e) => { void load(e.target.files); e.target.value = ""; }} />
    {official ? <OfficialPicker watch={watch} request={officialBatteryRequest()} onClose={() => setOfficial(false)} onPick={(set) => edit((x) => setBatteryStates(x, layer, officialBatteryStates(set)))} /> : null}
    <div className="st-nums"><NumberField label={t("Scale")} unit="%" value={Math.round((o?.scale ?? 1) * 100)} min={10} max={400} onChange={(v) => edit((x) => setScale(x, layer, v / 100))} /></div>
    <div className="st-row"><span>{t("Turn")}</span>
      <Segmented small label={t("Rotation")} value={String(rotation)} onChange={(v) => edit((x) => setAsset(x, layer, { rotation: Number(v) }))}
        options={[{ value: "0", label: "0°" }, { value: "90", label: "90°" }, { value: "180", label: "180°" }, { value: "270", label: "270°" }]} /></div>
  </>;
}

/** A shared spot: its states, and the picked state's image. Position, size and look are the spot's, below. */
function SpotTop(p: LayerInspectorProps & { fail: (e: unknown) => void }) {
  const spot = p.layer.spot!;
  const state = spotPicked(spot, p.choice);
  return <>
    <Segmented small label={t("{label} state", { label: t(spot.label) })} value={state.key} onChange={(key) => p.onState?.(spot.id, key)}
      options={spot.states.map((s) => ({ value: s.key, label: t(s.label) }))} />
    {state.layer.present ? <>
      <ImageTop {...p} layer={state.layer} zoom={false} />
      <div className="st-row"><span>{t("Show on the watch")}</span>
        <Switch label={t("Show {spot} {state} on the watch", { spot: t(spot.label), state: t(state.label) })} checked={state.layer.visible} onChange={(v) => p.onStateVisible?.(state.layer, v)} /></div>
    </> : spot.canAdd ? (
      <button type="button" className="chip st-chip-btn" onClick={() => p.onAddState?.(state.key)}><Icon name="plus" size={15} />{t("Add image")}</button>
    ) : null}
  </>;
}

function ImageTop({ design, edit, layer, fail, watch, details, loadAssets, zoom = true }: LayerInspectorProps & { fail: (e: unknown) => void; zoom?: boolean }) {
  const o = assetOf(design, layer);
  const input = useRef<HTMLInputElement>(null);
  const [official, setOfficial] = useState(false);
  return <>
    <div className="st-img-row">
      <TemplatePicture details={details} configAssetId={layer.configAssetId} replacement={o?.replacement?.dataUrl} loadAssets={loadAssets} />
      <span className="st-img-actions">
        <button type="button" className="chip st-chip-btn" onClick={() => input.current?.click()}><Icon name="upload" size={15} />{t("Replace image")}</button>
        <button type="button" className="chip st-chip-btn" onClick={() => setOfficial(true)}><Icon name="spark" size={15} />{t("Official library")}</button>
        {o?.replacement ? <button type="button" className="chip st-chip-btn" onClick={() => edit((x) => restoreAsset(x, layer))}><Icon name="refresh" size={15} />{t("Restore original")}</button> : null}
      </span>
    </div>
    <input ref={input} type="file" hidden accept="image/png" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readArtwork(f).then((art) => edit((x) => replaceAsset(x, layer, art))).catch(fail); }} />
    {official ? <OfficialPicker watch={watch} request={officialImageRequest(layer)} onClose={() => setOfficial(false)} onPick={(set, frame) => edit((x) => replaceAsset(x, layer, officialArtwork(set, frame)))} /> : null}
    <TemplateImageFacts details={details} configAssetId={layer.configAssetId} label={layer.label} replacement={o?.replacement} loadAssets={loadAssets} />
    {layer.capabilities.color ? <ColourRow label={t("Tint")} {...layerColour(design, layer, edit)} /> : null}
    {zoom && layer.capabilities.scale ? <Slider label={t("Zoom")} value={Math.round((o?.scale ?? 1) * 100)} min={10} max={300} unit="%" onCommit={(v) => edit((x) => setScale(x, layer, v / 100))} /> : null}
  </>;
}

/**
 * The battery's "%": drawn in the battery digits' font unless a picture replaces it. The watch puts it straight after the
 * last digit, so its look is colour, size, the gap before it and the height it sits at, all baked into the picture.
 */
function PercentLook({ design, edit, replaced }: { design: Design; edit: Edit; replaced: boolean }) {
  if (replaced) return <p className="st-note">{t("Your picture goes on the watch as it is.")}</p>;
  const look = percentOf(design);
  const digits = design.metricStyles?.battery?.color ?? design.digitColor;
  const size = Math.round((look.size ?? 1) * 100);
  return <>
    <div className="st-row"><span>{t("Same color as the digits")}</span>
      <Switch label={t("Same color as the digits")} checked={!look.color} onChange={(v) => edit((x) => setPercent(x, { color: v ? undefined : digits }))} /></div>
    {look.color ? <ColourRow label={t("Color")} value={look.color} onPick={(c) => edit((x) => setPercent(x, { color: c }))} /> : null}
    <div className="st-nums">
      <Slider label={t("Size")} value={size} min={30} max={150} unit="%" onCommit={(v) => edit((x) => setPercent(x, { size: v / 100 }))} />
      <Slider label={t("Gap")} value={Math.round(look.gap ?? 0)} min={0} max={40} unit="px" onCommit={(v) => edit((x) => setPercent(x, { gap: v }))} />
    </div>
    {size < 100 ? <div className="st-row"><span>{t("Sits at")}</span>
      <Segmented small label={t("Sits at")} value={look.align ?? "middle"} onChange={(v) => edit((x) => setPercent(x, { align: v }))}
        options={[{ value: "top", label: tx("position", "Top") }, { value: "middle", label: t("Middle") }, { value: "bottom", label: t("Bottom") }]} /></div> : null}
  </>;
}

/** A part's name in the switcher: the minus of a temperature reads as what it is. */
const partName = (id: string, part: CorosWatchfaceNativePart) =>
  part === "value" ? t("Digits") : part === "symbols" && id.startsWith("weather_temp") ? t("Minus") : PART_LABEL[part] ? t(PART_LABEL[part]!) : part;

/**
 * A live-data field's parts (digits, minus, unit, icon…) behind one switcher. Each part shows the pictures the watch
 * gets for it, drawn from the font as the build draws them or the PNGs that replace them, and its own fine-tuning.
 */
function NativeParts({ design, edit, layer, fail, watch, resolution }: { design: Design; edit: Edit; layer: EditorLayer; fail: (e: unknown) => void; watch: string; resolution: CorosWatchfaceResolutionDetails | null }) {
  const n = nativeOf(design, layer);
  const id = layer.nativeDataId ?? "";
  const parts = partsOf(design, layer).filter((part) => PART_LABEL[part] && (id !== "chart" || !n || chartReadoutDraws(chartSourceOf(n), part)));
  const [picked, setPicked] = useState<CorosWatchfaceNativePart>(parts[0] ?? "value");
  const part = parts.includes(picked) ? picked : parts[0] ?? "value";
  // A state field (Bluetooth on/off…) shows its state pictures where a number shows digits.
  const role = part === "value" && NATIVE_DATA_BY_ID.get(id)?.kind === "state" ? "states" : nativePartRole(part);
  const indexes = n && role ? nativeRoleIndices(id, n, role) : [];
  const input = useRef<HTMLInputElement>(null);
  const [pictures, setPictures] = useState<{ key: string; urls: string[] } | null>(null);
  const key = `${id}:${role}`;
  useEffect(() => {
    if (!n || !role) return;
    let live = true;
    void Promise.all(nativeRoleIndices(id, n, role).map((i) => nativeDataAsset(id, n, role, i)))
      .then((urls) => { if (live) setPictures({ key: `${id}:${role}`, urls }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [n, id, role]);
  if (!n) return null;
  const ps = n.parts?.[part];
  // Off by default for some parts (stamina, stress, UV, AQI and weekly load states), as the engine draws them.
  const shownOn = part === "value" || nativePart(id, n, part).enabled;
  const urls = pictures?.key === key ? pictures.urls : [];
  const name = (i: number) => String(i).padStart(2, "0");
  const load = async (files: FileList | null) => {
    if (!files?.length || !role) return;
    try {
      const allowed = new Set(indexes);
      const got: Record<string, string> = {};
      for (const f of [...files]) {
        const m = f.name.match(/^(\d{1,2})\.png$/i);
        if (m && allowed.has(Number(m[1]))) got[String(Number(m[1]))] = (await readArtwork(f)).dataUrl;
      }
      if (!Object.keys(got).length) throw new Error(t("Name the pictures {files}.", { files: indexes.map((i) => `${name(i)}.png`).join(", ") }));
      edit((x) => { const cur = nativeOf(x, layer); return cur ? setNative(x, layer, { assets: { ...cur.assets, [role]: { ...cur.assets?.[role], ...got } } }) : x; });
    } catch (e) { fail(e); }
  };
  return <>
    {parts.length > 1 ? <Segmented small label={t("Part")} value={part} onChange={setPicked} options={parts.map((p) => ({ value: p, label: partName(id, p) }))} /> : null}
    {part !== "value" ? <div className="st-row"><span>{t("Show {part}", { part: partName(id, part).toLowerCase() })}</span>
      <Switch label={t("Show {part}", { part: partName(id, part) })} checked={shownOn} onChange={(v) => edit((x) => setPart(x, layer, part, { enabled: v }))} /></div> : null}
    {shownOn && role && indexes.length ? <>
      <NativePictures design={design} edit={edit} layer={layer} part={part} partName={partName(id, part)} role={role} indexes={indexes} urls={urls} watch={watch} fail={fail} onImportFolder={() => input.current?.click()} />
      <input ref={input} type="file" hidden multiple accept="image/png" {...{ webkitdirectory: "" }} onChange={(e) => { void load(e.target.files); e.target.value = ""; }} />
    </> : null}
    {shownOn ? <>
      {part !== "value" ? <ColourRow label={t("{part} color", { part: partName(id, part) })} value={ps?.color ?? n.color} onPick={(c) => edit((x) => setPart(x, layer, part, { color: c }))} /> : null}
      <div className="st-nums">
        <NumberField label={t("Shift X")} value={ps?.x ?? 0} onChange={(v) => edit((x) => setPart(x, layer, part, { x: v }))} />
        <NumberField label={t("Shift Y")} value={ps?.y ?? 0} onChange={(v) => edit((x) => setPart(x, layer, part, { y: v }))} />
        {part === "value" && ps?.digitWidth !== undefined ? <NumberField label={t("Digit width")} unit="px" value={ps.digitWidth} min={1} max={400} onChange={(v) => edit((x) => setPart(x, layer, part, { digitWidth: v }))} /> : null}
      </div>
      <NativePartLayout design={design} edit={edit} layer={layer} part={part} partName={partName(id, part)} role={role} resolution={resolution} />
    </> : null}
    <TextField label={t("Canvas sample")} value={n.previewValue ?? ""} placeholder={t("Live value")} onCommit={(v) => edit((x) => setNative(x, layer, { previewValue: v || undefined }))} />
  </>;
}

function AnimationFolds({ design, edit, fail, watchLabel, watch: model, resolution, playback = { playing: true, still: 0 }, onPlayback }: LayerInspectorProps & { fail: (e: unknown) => void }) {
  const a = design.animation;
  const input = useRef<HTMLInputElement>(null);
  const outcome = useAnimationOutcome(a, model, resolution?.width);
  if (!a) return null;
  const load = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const pngs = [...files].filter((f) => /\.png$/i.test(f.name)).sort((x, y) => x.name.localeCompare(y.name, "en", { numeric: true }));
      if (!pngs.length) throw new Error(t("Choose a folder of numbered PNG frames."));
      if (pngs.length > MAX_ANIMATION_FRAMES) throw new Error(t("The watch plays up to {max} frames; that folder has {n}.", { max: MAX_ANIMATION_FRAMES, n: pngs.length }));
      const frames = await Promise.all(pngs.map(readArtwork));
      if (frames.some((f) => f.width !== frames[0].width || f.height !== frames[0].height)) throw new Error(t("Every frame needs the same size."));
      edit((x) => (x.animation ? { ...x, animation: { ...x.animation, frames: frames.map((f) => f.dataUrl), delays: frames.map((_, i) => x.animation!.delays[i] ?? DEFAULT_ANIMATION_DELAY), width: frames[0].width, height: frames[0].height } } : x));
      onPlayback?.({ playing: playback.playing, still: 0 });
    } catch (e) { fail(e); }
  };
  const delays = a.frames.map((_, i) => a.delays[i] ?? DEFAULT_ANIMATION_DELAY);
  const uniform = delays.every((d) => d === delays[0]);
  const loop = delays.reduce((sum, d) => sum + d, 0) / 1000;
  const setDelay = (index: number, v: number) => edit((x) => setDelays(x, (x.animation?.frames ?? []).map((_, i) => (i === index ? v : x.animation!.delays[i] ?? DEFAULT_ANIMATION_DELAY))));
  const removeFrame = (index: number) => {
    // The last frame goes with the layer itself, not from here.
    if (a.frames.length <= 1) return;
    edit((x) => (x.animation ? { ...x, animation: { ...x.animation, frames: x.animation.frames.filter((_, i) => i !== index), delays: x.animation.delays.filter((_, i) => i !== index) } } : x));
    const still = playback.still > index ? playback.still - 1 : playback.still;
    onPlayback?.({ playing: playback.playing, still: Math.max(0, Math.min(still, a.frames.length - 2)) });
  };
  const watch = watchLabel ?? t("the watch");
  const dropped = droppedFrames(outcome, a.frames.length);
  return <>
    <Fold title={t("Playback")} note={`${a.frames.length === 1 ? t("1 frame") : t("{n} frames", { n: a.frames.length })} · ${t("{s} s loop", { s: loop.toLocaleString(language() === "en" ? undefined : locale(), { maximumFractionDigits: 2 }) })}`}>
      <div className="st-nums">
        <button type="button" className="chip st-chip-btn" onClick={() => onPlayback?.({ ...playback, playing: !playback.playing })}>
          <Icon name={playback.playing ? "pause" : "play"} size={15} />{playback.playing ? t("Pause preview") : t("Play preview")}
        </button>
        <NumberField key={uniform ? `d${delays[0]}` : "mixed"} label={uniform ? t("Delay") : t("Set all")} unit="ms" value={delays[0] ?? DEFAULT_ANIMATION_DELAY} min={MIN_ANIMATION_DELAY} max={MAX_ANIMATION_DELAY}
          onChange={(v) => edit((x) => setDelays(x, (x.animation?.frames ?? []).map(() => v)))} />
      </div>
      <span className="st-note" data-warn={animationOutcomeNeedsNotice(outcome) || undefined}>{a.enabled ? animationOutcomeText(outcome, watch) : t("Hidden: the face is built without the animation.")}</span>
    </Fold>
    <Fold title={t("Frames")} note={`${Math.round(a.width)} × ${Math.round(a.height)} px`}>
      <ol className="st-anim-frames" aria-label={t("Animation frames")}>
        {a.frames.map((f, i) => (
          <li key={i} data-shown={!playback.playing && playback.still === i ? "" : undefined} data-dropped={dropped.has(i) || undefined} title={dropped.has(i) ? t("{watch} leaves this frame out", { watch }) : undefined}>
            <button type="button" className="st-anim-thumb" title={t("Show frame {n}", { n: i + 1 })} aria-label={t("Show frame {n}", { n: i + 1 })}
              onClick={() => onPlayback?.({ playing: false, still: i })}>
              <img src={f} alt="" draggable={false} /><span>{i + 1}</span>
            </button>
            {a.frames.length > 1 ? (
              <button type="button" className="st-anim-del" title={t("Delete frame {n}", { n: i + 1 })} aria-label={t("Delete frame {n}", { n: i + 1 })} onClick={() => removeFrame(i)}>
                <Icon name="close" size={11} width={2.6} />
              </button>
            ) : null}
            <FrameDelay index={i} value={delays[i]!} onChange={(v) => setDelay(i, v)} />
          </li>
        ))}
      </ol>
      <span className="st-note">{t("Each frame's time in ms. Up to {max} frames, all one size.", { max: MAX_ANIMATION_FRAMES })}</span>
      <button type="button" className="chip st-chip-btn" onClick={() => input.current?.click()}><Icon name="folder" size={15} />{t("Replace frames…")}</button>
      <input ref={input} type="file" hidden multiple accept="image/png" {...{ webkitdirectory: "" }} onChange={(e) => { void load(e.target.files); e.target.value = ""; }} />
    </Fold>
  </>;
}

/** One frame's time on screen, typed in; Enter or leaving the field applies it. */
function FrameDelay({ index, value, onChange }: { index: number; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    setText(null);
    if (text.trim() === "" || !Number.isFinite(v)) return;
    const clamped = Math.round(Math.max(MIN_ANIMATION_DELAY, Math.min(MAX_ANIMATION_DELAY, v)));
    if (clamped !== value) onChange(clamped);
  };
  return <input className="st-anim-delay" type="text" inputMode="numeric" aria-label={t("Frame {n} time (ms)", { n: index + 1 })} title={t("Milliseconds on screen")}
    value={text ?? String(value)} onChange={(e) => setText(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}

function SpriteTop({ design, edit, layer, fail }: LayerInspectorProps & { fail: (e: unknown) => void }) {
  const s = spriteOf(design, layer);
  const input = useRef<HTMLInputElement>(null);
  if (!s) return null;
  return <>
    <div className="st-img-row">
      <span className="st-img-prev"><img src={s.dataUrl} alt="" /></span>
      <span className="st-img-actions">
        <button type="button" className="chip st-chip-btn" onClick={() => input.current?.click()}><Icon name="refresh" size={15} />{t("Replace")}</button>
        <button type="button" className="chip st-chip-btn" onClick={() => edit((x) => setSprite(x, layer, (v) => ({ ...v, width: v.sourceWidth, height: v.sourceHeight, scale: 1 })))}>{t("Use imported size")}</button>
      </span>
    </div>
    <input ref={input} type="file" hidden accept="image/png" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readArtwork(f).then((art) => edit((x) => setSprite(x, layer, (v) => ({ ...v, dataUrl: art.dataUrl, sourceWidth: art.width, sourceHeight: art.height, crop: undefined })))).catch(fail); }} />
    <Slider label={t("Scale")} value={Math.round(s.scale * 100)} min={20} max={300} unit="%" onCommit={(v) => edit((x) => setSprite(x, layer, (o) => ({ ...o, scale: v / 100 })))} />
    <div className="st-nums">
      <NumberField label={t("Rotation")} unit="°" value={Math.round(s.rotation)} min={0} max={360} onChange={(v) => edit((x) => setSprite(x, layer, (o) => ({ ...o, rotation: v })))} />
      <span className="st-iconrow">
        <button type="button" className="st-icon-btn" aria-label={t("Flip across")} title={t("Flip across")} aria-pressed={!!s.flipX} onClick={() => edit((x) => setSprite(x, layer, (o) => ({ ...o, flipX: !o.flipX })))}><Icon name="alignH" size={17} /></button>
        <button type="button" className="st-icon-btn" aria-label={t("Flip down")} title={t("Flip down")} aria-pressed={!!s.flipY} onClick={() => edit((x) => setSprite(x, layer, (o) => ({ ...o, flipY: !o.flipY })))}><Icon name="alignV" size={17} /></button>
        {s.crop ? <button type="button" className="st-icon-btn" aria-label={t("Remove the crop")} title={t("Remove the crop")} onClick={() => edit((x) => setSprite(x, layer, (o) => ({ ...o, crop: undefined })))}><Icon name="full" size={17} /></button> : null}
      </span>
    </div>
    <div className="st-nums">
      <NumberField label={t("Skew X")} unit="°" value={Math.round(s.skewX ?? 0)} min={-80} max={80} onChange={(v) => edit((x) => setSprite(x, layer, (o) => ({ ...o, skewX: v })))} />
      <NumberField label={t("Skew Y")} unit="°" value={Math.round(s.skewY ?? 0)} min={-80} max={80} onChange={(v) => edit((x) => setSprite(x, layer, (o) => ({ ...o, skewY: v })))} />
    </div>
    <div className="st-row"><span>{t("Tint image")}</span><Switch label={t("Tint image")} checked={!!s.tintColor} onChange={(v) => edit((x) => setSprite(x, layer, (o) => ({ ...o, tintColor: v ? "#53cba1" : null })))} /></div>
    {s.tintColor ? <ColourRow label={t("Tint")} value={s.tintColor} onPick={(c) => edit((x) => setSprite(x, layer, (o) => ({ ...o, tintColor: c })))} /> : null}
    <Slider label={t("Opacity")} value={Math.round((s.opacity ?? 1) * 100)} min={0} max={100} unit="%" onCommit={(v) => edit((x) => setSprite(x, layer, (o) => ({ ...o, opacity: v / 100 })))} />
  </>;
}

function ElementTop({ design, edit, layer, resolution }: LayerInspectorProps) {
  const e = elementOf(design, layer);
  if (!e) return null;
  const set = (patch: object) => edit((x) => setElement(x, layer, (v) => ({ ...v, ...patch }) as typeof v));
  if (e.kind === "text") {
    const lines = e.text.split(/\r?\n/).length;
    return <>
      <TextArea label={t("Text")} value={e.text} onCommit={(v) => set({ text: v })} />
      <FontPicker label={t("Font")} family={e.fontFamily} weight={e.weight} style={e.fontStyle} sample="Aa" template={false} resolution={resolution} layerId={layer.id}
        onFamily={(f, weight) => set({ fontFamily: f, ...(weight ? { weight } : {}) })} />
      <ColourRow label={t("Color")} value={e.color} onPick={(c) => set({ color: c })} />
      <div className="st-nums"><NumberField label={t("Size")} unit="px" value={e.fontSize} min={12} max={200} onChange={(v) => set({ fontSize: v })} />
        <NumberField label={t("Rotation")} unit="°" value={Math.round(e.rotation)} min={0} max={360} onChange={(v) => set({ rotation: v })} /></div>
      <div className="st-nums">
        <label className="st-select"><Select aria-label={tx("font", "Weight")} value={e.weight} onChange={(ev) => set({ weight: Number(ev.target.value) })}>{WEIGHTS.map((w) => <option key={w} value={w}>{w} {tx("font weight", WEIGHT_NAMES[w]!)}</option>)}</Select><Icon name="chevD" size={14} /></label>
        <Segmented small label={t("Style")} value={e.fontStyle ?? "normal"} onChange={(v) => set({ fontStyle: v })} options={[{ value: "normal", label: t("Normal") }, { value: "italic", label: t("Italic") }]} />
      </div>
      <div className="st-nums">
        <NumberField label={t("Spacing")} unit="px" value={Math.round(e.letterSpacing ?? 0)} min={-40} max={200} onChange={(v) => set({ letterSpacing: v || undefined })} />
        {lines > 1 ? <NumberField label={t("Line")} unit="%" value={Math.round((e.lineHeight ?? 1.2) * 100)} min={50} max={400} onChange={(v) => set({ lineHeight: v / 100 })} /> : null}
      </div>
      <div className="st-row"><span>{t("Align")}</span><Segmented small label={t("Text align")} value={e.align} onChange={(v) => set({ align: v })} options={[{ value: "left", label: t("Left") }, { value: "center", label: t("Center") }, { value: "right", label: t("Right") }]} /></div>
      <div className="st-row"><span>{t("Case")}</span><Segmented small label={t("Letter case")} value={e.textCase ?? "none"} onChange={(v) => set({ textCase: v === "none" ? undefined : v })}
        options={[{ value: "none", label: t("As typed") }, { value: "upper", label: "ABC" }, { value: "lower", label: "abc" }, { value: "title", label: "Abc" }]} /></div>
      <Slider label={t("Opacity")} value={Math.round((e.opacity ?? 1) * 100)} min={0} max={100} unit="%" onCommit={(v) => set({ opacity: v === 100 ? undefined : v / 100 })} />
    </>;
  }
  if (e.kind === "line") return <>
    <ColourRow label={t("Color")} value={e.color} onPick={(c) => set({ color: c })} />
    <div className="st-nums">
      <NumberField label={t("Length")} unit="px" value={Math.round(Math.hypot(e.dx, e.dy))} min={10} max={800} onChange={(v) => { const len = Math.max(1, Math.hypot(e.dx, e.dy)); set({ dx: Math.round((e.dx / len) * v), dy: Math.round((e.dy / len) * v) }); }} />
      <NumberField label={t("Thick")} unit="px" value={e.strokeWidth} min={1} max={60} onChange={(v) => set({ strokeWidth: v })} />
      <NumberField label={t("Rotation")} unit="°" value={Math.round(e.rotation)} min={0} max={360} onChange={(v) => set({ rotation: v })} />
    </div>
  </>;
  const gradient = e.gradient;
  return <>
    <div className="st-row"><span>{t("Fill")}</span>
      <Segmented small label={t("Fill")} value={gradient ? "gradient" : "solid"} onChange={(v) => set({ gradient: v === "gradient" ? { from: e.fill, to: "#6aa5ff", angle: 135 } : undefined })} options={[{ value: "solid", label: t("Solid") }, { value: "gradient", label: t("Gradient") }]} /></div>
    {gradient ? <>
      <div className="st-grad" style={{ background: `linear-gradient(${gradient.angle + 90}deg, ${gradient.from}, ${gradient.to})` }} aria-hidden="true" />
      <div className="st-nums">
        <ColorField label={t("From")} value={gradient.from} onPick={(c) => set({ gradient: { ...gradient, from: c } })} />
        <ColorField label={t("To")} value={gradient.to} onPick={(c) => set({ gradient: { ...gradient, to: c } })} />
        <NumberField label={t("Angle")} unit="°" value={gradient.angle} min={0} max={360} onChange={(v) => set({ gradient: { ...gradient, angle: v } })} />
      </div>
    </> : <ColourRow label={t("Color")} value={e.fill} onPick={(c) => set({ fill: c })} />}
    <div className="st-nums">
      <NumberField label="W" value={Math.round(e.width)} min={1} max={800} onChange={(v) => set({ width: v })} />
      <NumberField label="H" value={Math.round(e.height)} min={1} max={800} onChange={(v) => set({ height: v })} />
      <NumberField label={t("Rotation")} unit="°" value={Math.round(e.rotation)} min={0} max={360} onChange={(v) => set({ rotation: v })} />
    </div>
    {e.kind === "rect" ? <Slider label={t("Corners")} value={e.cornerRadius} min={0} max={200} unit="px" onCommit={(v) => set({ cornerRadius: v })} /> : null}
    <Slider label={t("Opacity")} value={Math.round((e.opacity ?? 1) * 100)} min={0} max={100} unit="%" onCommit={(v) => set({ opacity: v === 100 ? undefined : v / 100 })} />
  </>;
}

/**
 * The look of the readout the chart layer is editing (Stress, Sunrise…), under its row: its font, colour, size and
 * parts, the same fields a live data field has. Size resizes the readout's own boxes, never the layer's scale, which
 * would grow the graph too.
 */
function ReadoutLook(p: LayerInspectorProps) {
  const { design, edit, layer, resolution } = p;
  const n = nativeOf(design, layer);
  if (!n) return null;
  const fail = (e: unknown) => p.say(e instanceof Error ? e.message : String(e));
  const sizePart = nativeFontSizePart("chart", n);
  const size = Math.round(nativeComponentFontSize("chart", n, sizePart));
  const resize = (v: number) => edit((x) => {
    const cur = nativeOf(x, layer);
    if (!cur) return x;
    const factor = Math.max(4, Math.min(400, v)) / Math.max(1, nativeComponentFontSize("chart", cur, nativeFontSizePart("chart", cur)));
    const parts = { ...cur.parts };
    for (const part of nativeParts("chart", cur).filter((q) => CHART_READOUT_PARTS.has(q))) {
      const ps = nativePart("chart", cur, part);
      parts[part] = { ...parts[part], ...nativePartForFontSize("chart", cur, part, nativeComponentFontSize("chart", cur, part) * factor),
        x: Math.round(ps.x * factor), y: Math.round(ps.y * factor) };
    }
    return setNative(x, layer, { parts });
  });
  return (
    <div className="st-ch-look">
      <LayerFontPicker design={design} layer={layer} edit={edit} resolution={resolution} loadAssets={p.loadAssets} fail={fail} watch={p.watch} />
      <ColourRow label={t("Color")} {...layerColour(design, layer, edit)} />
      <TypeFields design={design} layer={layer} edit={edit} kind="native" fontSize={size} resolution={resolution} onSize={resize} />
      <NativeParts design={design} edit={edit} layer={layer} fail={fail} watch={p.watch} resolution={resolution} />
    </div>
  );
}
/**
 * Signs (−, °, %, :) and the decimal point are pictures the whole chart shares; a readout shows their tabs only when
 * it draws them: below-zero elevation and tide, the sun's angle, moon illumination, sunrise and moonrise times, and
 * barometer and tide decimals. Stress, stamina, heart rate, steps and calories are whole numbers with neither.
 */
const CHART_SIGNS = new Set(["chart_elevation", "chart_tide", "chart_sun_angle", "chart_moon_percent", "chart_sunrise", "chart_moonrise"]);
const CHART_DECIMALS = new Set(["chart_baro", "chart_tide"]);
function chartReadoutDraws(source: string, part: CorosWatchfaceNativePart): boolean {
  if (part === "symbols") return CHART_SIGNS.has(source);
  if (part === "decimal") return CHART_DECIMALS.has(source);
  return true;
}
const CHART_READOUT_PARTS = new Set<CorosWatchfaceNativePart>(["icon", "value", "unit", "states", "symbols", "decimal"]);

const READOUT_ICON: Record<string, string> = {
  chart_baro: "gauge", chart_tide: "tide", chart_sunrise: "sun", chart_sun_angle: "arc", chart_moonrise: "moon", chart_moon: "moon", chart_moon_percent: "drop",
  chart_stress: "pulse", chart_stamina: "gauge", chart_elevation: "mountain", chart_kcal: "flame", chart_heart_rate: "heart", chart_step: "steps",
};

/**
 * The chart, from the design's "Studio charts" boards: every page the watch can have in Back order with a switch
 * (Barometer and Tide share one), then the picked page's readouts and what the watch hides while it shows, then the
 * one graph with only the styles the face's pages draw.
 */
function ChartTop(p: LayerInspectorProps) {
  const { design, edit, layer, details, master, onHide, aodNote, loadAssets } = p;
  const n = nativeOf(design, layer);
  const [picked, setPicked] = useState<string | null>(null);
  const [why, setWhy] = useState<{ source: string; text: string } | null>(null); // why a readout can't go on every page
  const [lookShut, setLookShut] = useState(false); // the edited readout's settings folded away
  if (!n) return null;
  // Make fixed is offered on the Current face only, as in CorosLink.
  const pin = (source: string) => {
    const block = aodNote ? t("Switch to Current to show it on every page.") : chartFixBlock(design, details, source);
    if (block) { setWhy({ source, text: block }); return; }
    setWhy(null);
    void measureChartReadoutArt(design, source).then((art) => edit((x) => fixChartReadout(x, source, details, art)));
  };
  const cs = n.chartStyle ?? {};
  const setStyle = (patch: object) => edit((x) => setNative(x, layer, { chartStyle: { ...nativeOf(x, layer)?.chartStyle, ...patch } }));
  const face = { width: master, height: master };
  const rows = chartPageRows(design, details);
  const page = rows.find((r) => r.id === picked) ?? rows.find((r) => r.shown) ?? rows.find((r) => r.on) ?? rows[0]!;
  const styles = chartStylesInUse(rows);
  const bar = (id: string) => id === "barometer" || id === "tide";
  const toggle = (id: string, on: boolean) => { setPicked(id); edit((x) => setChartPageOn(x, id, on, details, face)); };
  // A page only the template has borrows the template's readout to show (studioCharts chartPageChange).
  const showPage = (id: string) => {
    if (!loadAssets) { edit((x) => showChartPage(x, id)); return; }
    void chartPageChange(design, id, details, loadAssets).then((change) => { if (change) edit(change); });
  };
  const pick = (r: ChartPageRow) => { setPicked(r.id); if (canPreviewPage(r) && !r.shown) showPage(r.id); };
  // The chart layer edits one readout at a time: picking another on the shown page switches it, so it can be moved.
  const editing = chartSourceOf(n);
  const editReadout = (source: string) => {
    if (!loadAssets) return;
    void chartReadoutToEdit(design, source, details, loadAssets).then((readout) => { if (readout) edit((x) => showTemplateChartPage(x, readout)); });
  };
  const next = nextChartPage(rows);
  const visible = page.readouts.filter((r) => r.state === "shown" || r.state === "template").length;
  const fixedReadouts = fixedChartReadouts(rows);

  const pageRow = (r: ChartPageRow) => (
    <div key={r.id} className="st-ch-pg" data-on={r.on || undefined} data-cur={r.id === page.id || undefined}>
      <button type="button" className="st-ch-pg-main" aria-current={r.id === page.id ? "true" : undefined} title={r.canShow ? t("Show this page on the watch") : undefined} onClick={() => pick(r)}>
        <span className="st-ch-num">{r.number ?? ""}</span><Icon name={CHART_GRAPH_ICON[r.graph]} size={16} /><span>{t(r.label)}</span>
        {r.shown ? <span className="st-ch-pg-tag">{t("on the watch")}</span> : null}
      </button>
      {bar(r.id) ? null : <Switch label={t("{name} page", { name: t(r.label) })} checked={r.on} disabled={r.locked} onChange={(v) => toggle(r.id, v)} />}
    </div>
  );

  return <>
    <div className="st-row-col">
      <div className="st-ch-label"><span className="st-label">{t("Pages")}</span>
        {next ? <button type="button" className="st-link st-ch-back" title={t("Next page, as the watch's Back button does")} onClick={() => { setPicked(next); showPage(next); }}><Icon name="undo" size={13} width={2.2} />{t("Back")}</button>
          : <span className="st-ch-order" title={t("The watch sets the order")}><Icon name="lock" size={12} width={2.2} />{t("Back order")}</span>}</div>
      <div className="st-ch-pages">
        <div className="st-ch-pair">
          {rows.filter((r) => bar(r.id)).map(pageRow)}
          <Switch label={t("Barometer and Tide pages")} checked={rows[0]!.on} disabled={rows[0]!.locked} onChange={(v) => toggle("barometer", v)} />
        </div>
        {rows.filter((r) => !bar(r.id)).map(pageRow)}
      </div>
      {rows.some((r) => r.locked) ? <p className="st-ch-why"><Icon name="lock" size={14} /><span>{tr("The last page stays. {hide} to take it off the watch.", { hide: <button type="button" className="st-link" onClick={onHide}>{t("Hide the chart")}</button> })}</span></p> : null}
    </div>

    <div className="st-ch-sec">
      <h3><span>{t(page.label)}</span><small>{t(CHART_GRAPH_LABEL[page.graph])}</small></h3>
      {page.on ? <>
        <div className="st-ch-ros">
          {page.readouts.map((r) => {
            const there = r.state === "shown" || r.state === "hidden";
            const sub = r.state === "fixed" ? t("On every page") : r.state === "template" ? t("From the template") : r.state === "hidden" ? (r.required ? t("Hidden, page stays") : t("Hidden"))
              : r.state === "missing" ? (r.required ? t("Kept invisibly") : t("Optional")) : "";
            const label = t(r.label);
            const look = page.shown && r.source === editing;
            return (
              <Fragment key={r.source}>
              <div className="st-ch-ro" data-state={r.state}>
                <Icon name={READOUT_ICON[r.source] ?? "pulse"} size={16} />
                {page.shown && r.source !== editing && (r.state === "shown" || r.state === "template") && loadAssets
                  ? <button type="button" className="st-ch-ro-copy st-ch-ro-pick" title={t("Edit and move this readout on the watch")} onClick={() => editReadout(r.source)}><b>{label}</b>{sub ? <small>{sub}</small> : null}</button>
                  : look ? <button type="button" className="st-ch-ro-copy st-ch-ro-pick" data-editing aria-expanded={!lookShut} title={lookShut ? t("Show its settings") : t("Hide its settings")} onClick={() => setLookShut((v) => !v)}>
                      <b>{label}<span className="st-ch-fold" data-shut={lookShut || undefined}><Icon name="chevD" size={13} /></span></b>{sub ? <small>{sub}</small> : null}</button>
                  : <span className="st-ch-ro-copy"><b>{label}</b>{sub ? <small>{sub}</small> : null}</span>}
                {r.required && r.state !== "template" && r.state !== "fixed" ? <span className="st-ch-need">{t("Needed")}</span> : null}
                {r.state === "fixed" ? <button type="button" className="st-icon-btn" aria-label={t("Put {name} back on its page", { name: label })} title={t("Back to its page")} aria-pressed="true" onClick={() => edit((x) => unfixChartReadout(x, r.source))}><Icon name="pin" size={16} /></button> : null}
                {there ? <button type="button" className="st-icon-btn" aria-label={t("Show {name} on every page", { name: label })} title={t("Show on every page")} onClick={() => pin(r.source)}><Icon name="pin" size={16} /></button> : null}
                {r.state === "missing" ? <button type="button" className="st-icon-btn" aria-label={t("Add {name}", { name: label })} title={t("Add to this page")} onClick={() => edit((x) => setChartReadout(x, r.source, true, face))}><Icon name="plus" size={16} /></button> : null}
                {there ? <button type="button" className="st-icon-btn" aria-label={r.state === "shown" ? t("Hide {name}", { name: label }) : t("Show {name}", { name: label })}
                  title={r.state === "hidden" ? t("Show") : visible <= 1 && page.graph === "none" ? t("Hide. The page stays, with nothing on it.") : t("Hide")}
                  onClick={() => edit((x) => setChartReadout(x, r.source, r.state === "hidden", face))}><Icon name={r.state === "shown" ? "eye" : "eyeOff"} size={16} /></button> : null}
                {there && !r.required ? <button type="button" className="st-icon-btn" aria-label={t("Remove {name}", { name: label })} title={t("Remove from this page")} onClick={() => edit((x) => removeChartReadout(x, r.source))}><Icon name="trash" size={16} /></button> : null}
              </div>
              {look && !lookShut ? <ReadoutLook {...p} /> : null}
              </Fragment>
            );
          })}
        </div>
        {why && page.readouts.some((r) => r.source === why.source) ? <p className="st-ch-why"><Icon name="pin" size={14} /><span>{why.text}</span></p> : null}
        {page.hides.length ? <div className="st-ch-wx"><span className="st-label">{t("Hidden here")}</span>{page.hides.map((f) => <span key={f.id} className="st-ch-tag" data-kind="minus">{t(f.label)}</span>)}</div> : null}
        {!page.canShow && page.graph === "bars" ? <p className="st-ch-why"><Icon name="eye" size={14} /><span>{t("The preview shows this page once it has its reading.")}</span></p> : null}
        {page.graph === "bars" ? <p className="st-ch-why"><Icon name="phone" size={14} /><span>{t("Blank on the watch until the phone has synced.")}</span></p> : null}
        {page.graph === "none" && visible === 0 ? <p className="st-ch-why"><Icon name="eyeOff" size={14} /><span>{t("Nothing visible. Back still stops here.")}</span></p> : null}
      </> : <>
        <div className="st-ch-wx"><span className="st-label">{t("Adds")}</span>
          {bar(page.id) ? <><span className="st-ch-tag" data-kind="plus">{t("Barometer page")}</span><span className="st-ch-tag" data-kind="plus">{t("Tide page")}</span></>
            : page.readouts.filter((r) => r.required).map((r) => <span key={r.source} className="st-ch-tag" data-kind="plus">{t(r.label)}</span>)}</div>
        {page.hides.length ? <div className="st-ch-wx"><span className="st-label">{t("Hides")}</span>{page.hides.map((f) => <span key={f.id} className="st-ch-tag" data-kind="minus">{t(f.label)}</span>)}</div> : null}
        {page.graph === "bars" ? <p className="st-ch-why"><Icon name="phone" size={14} /><span>{t("Blank on the watch until the phone has synced.")}</span></p> : null}
        <button type="button" className="btn btn-primary st-ch-add" onClick={() => toggle(page.id, true)}><Icon name="plus" size={16} width={2.2} />{bar(page.id) ? t("Add Barometer and Tide") : t("Add {name}", { name: t(page.label) })}</button>
      </>}
    </div>

    {fixedReadouts.length ? <div className="st-ch-sec">
      <h3><span>{t("On every page")}</span></h3>
      <div className="st-ch-ros">
        {fixedReadouts.map((f) => (
          <div key={f.source} className="st-ch-ro">
            <Icon name={READOUT_ICON[f.source] ?? "pulse"} size={16} />
            <span className="st-ch-ro-copy"><b>{t(f.label)}</b></span>
            <button type="button" className="btn btn-glass st-ch-putback" onClick={() => edit((x) => unfixChartReadout(x, f.source))}>{t("Put back on {page}", { page: t(f.page) })}</button>
          </div>
        ))}
      </div>
    </div> : null}

    <div className="st-ch-sec">
      <h3><span>{t("Graph")}</span><small>{t("Same on every page")}</small></h3>
      {styles.line ? <div className="st-row-col"><span className="st-label st-ch-for">{t("Line")}<em>{t("Sun, Moon")}</em></span>
        <div className="st-nums">
          <NumberField label={t("Width")} unit="px" value={cs.lineWidth ?? 2} min={1} max={20} onChange={(v) => setStyle({ lineWidth: v })} />
          <span />
          <ColorField label={t("Upper")} value={cs.upperColor ?? "#53cba1"} onPick={(c) => setStyle({ upperColor: c })} />
          <ColorField label={t("Lower")} value={cs.lowerColor ?? "#6aa5ff"} onPick={(c) => setStyle({ lowerColor: c })} />
        </div></div>
        : <div className="st-ch-na"><span><b>{t("Line")}</b>{t("Sun and Moon only")}</span></div>}
      {styles.bars ? <div className="st-row-col"><span className="st-label st-ch-for">{t("Bars")}<em>{t("Barometer, Tide")}</em></span>
        <div className="st-nums">
          <NumberField label={t("Width")} unit="px" value={cs.barWidth ?? 8} min={1} max={40} onChange={(v) => setStyle({ barWidth: v })} />
          <NumberField label={t("Gap")} unit="px" value={cs.barGap ?? 4} min={0} max={40} onChange={(v) => setStyle({ barGap: v })} />
          <ColorField label={t("Selected")} value={cs.selectedBarColor ?? "#53cba1"} onPick={(c) => setStyle({ selectedBarColor: c })} />
          <ColorField label={t("Others")} value={cs.unselectedBarColor ?? "#4b5753"} onPick={(c) => setStyle({ unselectedBarColor: c })} />
        </div></div>
        : <div className="st-ch-na"><span><b>{t("Bars")}</b>{t("Barometer and Tide only")}</span></div>}
    </div>
  </>;
}

/* ───────────── Several layers ───────────── */

export function MultiInspector({ layers, design, edit, master, onClear }: { layers: EditorLayer[]; design: Design; edit: Edit; master: number; onClear: () => void }) {
  const colourable = layers.filter((l) => l.capabilities.color);
  const shared = colourable.length && colourable.every((l) => colourOf(design, l) === colourOf(design, colourable[0])) ? colourOf(design, colourable[0]) : "mixed";
  return (
    <div className="st-insp">
      <div className="st-insp-head">
        <span className="st-insp-icon"><Icon name="layers" size={19} /></span>
        <span><b>{t("{n} layers", { n: layers.length })}</b><small>{t("Selection")}</small></span>
        <button type="button" className="st-icon-btn" aria-label={t("Clear the selection")} title={t("Clear the selection")} onClick={onClear}><Icon name="close" /></button>
      </div>
      <section className="st-insp-body">
        <div className="st-row-col"><span className="st-label">{t("Align")}</span><AlignRow onAlign={(e) => edit((x) => align(x, layers, e, master))} /></div>
        <div className="st-row-col"><span className="st-label">{t("Distribute")}</span>
          <div className="st-nums">
            <button type="button" className="chip st-chip-btn" disabled={layers.length < 3} onClick={() => edit((x) => distribute(x, layers, "x"))}><Icon name="alignV" size={15} />{t("Across")}</button>
            <button type="button" className="chip st-chip-btn" disabled={layers.length < 3} onClick={() => edit((x) => distribute(x, layers, "y"))}><Icon name="alignH" size={15} />{t("Down")}</button>
          </div></div>
        {colourable.length ? <ColourRow label={t("Color")} value={shared} onPick={(c) => edit((x) => colourable.reduce((d, l) => colour(d, l, c), x))} /> : null}
        <span className="st-note">{t("Shift-click layers to add or remove them.")}</span>
      </section>
    </div>
  );
}

/* ───────────── Face ───────────── */

export function FaceInspector({ design, edit, details, watchRow, fail, resolution, loadAssets }: { design: Design; edit: Edit; details: CorosWatchfaceTemplateDetails; watchRow: ReactNode; fail: (e: unknown) => void; resolution: CorosWatchfaceResolutionDetails | null; loadAssets?: LoadAssets }) {
  const theme = watchThemeSupport(details);
  const langs = design.watchLanguages ?? "all";
  return (
    <div className="st-insp">
      <section className="st-insp-sec"><h3>{t("Watch")}</h3>{watchRow}</section>
      <Fold title={t("Colors")}>
        <ColourRow label={t("Face color")} value={design.digitColor} onPick={(c) => edit((x) => ({ ...x, digitColor: c }))} />
        <ColourRow label={t("Accent")} value={design.accentColor} onPick={(c) => edit((x) => ({ ...x, accentColor: c }))} />
        <div className="st-row"><span>{t("Tint labels")}</span><Switch label={t("Tint labels")} checked={design.tintLabels} onChange={(v) => edit((x) => ({ ...x, tintLabels: v }))} /></div>
        <div className="st-row"><span>{t("Tint icons")}</span><Switch label={t("Tint icons")} checked={design.tintIcons} onChange={(v) => edit((x) => ({ ...x, tintIcons: v }))} /></div>
      </Fold>
      <Fold title={t("Font")} note={design.fontFamily || t("Template")}>
        <FontPicker label={t("Face font")} family={design.fontFamily ?? ""} raster={design.rasterFont} weight={design.fontWeight} style={design.fontStyle} sample="10:08" template
          resolution={resolution} layerId="autoTime" loadAssets={loadAssets} onFamily={(f, weight) => edit((x) => ({ ...x, fontFamily: f, rasterFont: undefined, ...(weight ? { fontWeight: weight } : {}) }))} />
        {design.fontFamily ? <div className="st-nums">
          <label className="st-select"><Select aria-label={tx("font", "Weight")} value={design.fontWeight ?? 400} onChange={(e) => edit((x) => ({ ...x, fontWeight: Number(e.target.value) }))}>{weightChoices(design.fontFamily, design.fontWeight ?? 400).map((w) => <option key={w} value={w}>{w} {WEIGHT_NAMES[w] ? tx("font weight", WEIGHT_NAMES[w]) : ""}</option>)}</Select><Icon name="chevD" size={14} /></label>
          <Segmented small label={t("Style")} value={design.fontStyle ?? "normal"} onChange={(v) => edit((x) => ({ ...x, fontStyle: v }))} options={[{ value: "normal", label: t("Normal") }, { value: "italic", label: t("Italic") }]} />
          <NumberField label={t("Spacing")} unit="%" value={Math.round((design.letterSpacing ?? 0) * 100)} min={-35} max={25} onChange={(v) => edit((x) => ({ ...x, letterSpacing: v / 100 }))} />
        </div> : null}
      </Fold>
      <Fold title={t("Background")}><BackgroundFields design={design} edit={edit} fail={fail} /></Fold>
      {theme ? (
        <Fold title={t("Watch theme")} note={t("Memory-in-pixel")}>
          <div className="st-theme" role="group" aria-label={t("Watch theme color")}>
            {Array.from({ length: 14 }, (_, i) => (
              <button key={i} type="button" className="st-theme-dot" style={{ background: watchThemeSwatch(i) }} aria-label={t("Theme {n}", { n: i })} aria-pressed={(design.watchThemeColor ?? theme.templateDefault) === i} onClick={() => edit((x) => ({ ...x, watchThemeColor: i }))} />
            ))}
          </div>
        </Fold>
      ) : null}
      <Fold title={t("Languages")} note={langs === "all" ? t("All") : langs === "english" ? t("English") : String(langs.length)}>
        <Segmented small label={t("Watch languages")} value={langs === "all" || langs === "english" ? langs : "pick"} onChange={(v) => edit((x) => ({ ...x, watchLanguages: v === "pick" ? ["en"] : v }))}
          options={[{ value: "all", label: t("All") }, { value: "english", label: t("English") }, { value: "pick", label: t("Pick") }]} />
        {Array.isArray(langs) ? (
          <div className="st-chips">
            {Object.entries(WATCH_LANGUAGE_NAMES).map(([code, name]) => (
              <button key={code} type="button" className="chip" aria-pressed={langs.includes(code)} onClick={() => edit((x) => {
                const list = Array.isArray(x.watchLanguages) ? x.watchLanguages : [];
                return { ...x, watchLanguages: list.includes(code) ? list.filter((c) => c !== code) : [...list, code] };
              })}>{name}</button>
            ))}
          </div>
        ) : null}
      </Fold>
      <Fold title={t("Advanced")}>
        <label className="st-select st-select-wide"><span>{t("Face version")}</span>
          <Select aria-label={t("Watch-face version")} value={design.archiveWatchFaceVersion ?? ""} onChange={(e) => edit((x) => ({ ...x, archiveWatchFaceVersion: e.target.value === "" ? undefined : Number(e.target.value) }))}>
            <option value="">{t("Auto")}</option>{[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
          </Select><Icon name="chevD" size={14} /></label>
        <div className="st-row"><span>{t("Strip blank config keys")}</span><Switch label={t("Strip blank config keys")} checked={!!design.stripBlankConfigKeys} onChange={(v) => edit((x) => ({ ...x, stripBlankConfigKeys: v || undefined }))} /></div>
      </Fold>
    </div>
  );
}

/* ───────────── Pieces ───────────── */

/** An inspector section, open unless folded by hand. */
export function Fold({ title, children, note, open = true }: { title: string; children: ReactNode; note?: string; open?: boolean }) {
  return (
    <details className="st-fold" open={open}>
      <summary><span>{title}</span><span className="st-fold-note">{note}<Icon name="chevD" size={14} /></span></summary>
      <div className="st-fold-body">{children}</div>
    </details>
  );
}

export function Dots({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="st-dots" role="group" aria-label={t("Colour")}>
      {PALETTE.map((c) => <button key={c} type="button" className="st-dot" style={{ background: c }} aria-label={t("Colour {hex}", { hex: c })} aria-pressed={value.toLowerCase() === c} onClick={() => onPick(c)} />)}
      <label className="st-dot st-dot-custom" title={t("Any colour")} aria-label={t("Any colour")}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

export const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : c === "mixed" ? t("Mixed") : c);

/** A layer's colour row props: its colour, picking one, "Original" while the face changed it, and a note for PNGs. */
function layerColour(design: Design, layer: EditorLayer, edit: Edit) {
  const n = layer.nativeDataId ? design.nativeData?.[layer.nativeDataId] : undefined;
  const pngs = n && (["digits", "symbols", "unit", "icon"] as const).some((r) => Object.keys(n.assets?.[r] ?? {}).length);
  return {
    value: colourOf(design, layer),
    onPick: (c: string) => edit((x) => colour(x, layer, c)),
    onReset: colourChanged(design, layer) ? () => edit((x) => resetColour(x, layer)) : null,
    note: pngs ? t("Pictures you imported keep their own colours; this colours the parts drawn from the font.") : null,
  };
}

/** A colour: the one in use with its hex to type; its chip opens the system picker. No preset swatches: they took room and added little. */
function ColourRow({ label, value, onPick, onReset, note }: { label: string; value: string; onPick: (c: string) => void; onReset?: (() => void) | null; note?: string | null }) {
  const [text, setText] = useState<string | null>(null);
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  const commit = () => {
    if (text === null) return;
    const v = text.trim().replace(/^#?/, "#");
    setText(null);
    if (/^#[0-9a-f]{6}$/i.test(v) && v.toLowerCase() !== value.toLowerCase()) onPick(v.toLowerCase());
  };
  return (
    <div className="st-colour">
      <div className="st-colour-top">
        <span className="st-label">{label}</span>
        <span className="st-grow" />
        {onReset ? <button type="button" className="st-link st-colour-reset" title={t("Back to the original colour")} onClick={onReset}><Icon name="refresh" size={13} />{t("Original")}</button> : null}
        <span className="st-colour-now">
          <label className="st-colour-chip" style={{ background: valid ? value : "transparent" }} title={t("Pick a colour")}>
            <input type="color" aria-label={t("{label}: pick a colour", { label })} value={valid ? value : "#ffffff"} onChange={(e) => onPick(e.target.value)} />
          </label>
          <input type="text" aria-label={t("{label} hex", { label })} spellCheck={false} maxLength={7} value={text ?? hex(value)}
            onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </span>
      </div>
      {note ? <span className="st-note">{note}</span> : null}
    </div>
  );
}

/** A colour as a field: swatch and hex, the system picker on click. */
export function ColorField({ label, value, onPick }: { label: string; value: string; onPick: (c: string) => void }) {
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <label className="st-colorfield" title={label}>
      <span className="st-swatch" style={{ background: safe }} aria-hidden="true" />
      <span>{safe.slice(1).toUpperCase()}</span>
      <input type="color" aria-label={label} value={safe} onChange={(e) => onPick(e.target.value)} />
    </label>
  );
}

/** The face's background: its colour and the picture under it, with zoom. */
export function BackgroundFields({ design, edit, fail }: { design: Design; edit: Edit; fail: (e: unknown) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <ColourRow label={t("Color")} value={design.backgroundColor ?? "#000000"} onPick={(c) => edit((x) => ({ ...x, backgroundColor: c }))} />
    <div className="st-img-row">
      <span className="st-img-prev st-img-round">{design.artwork ? <img src={design.artwork.dataUrl} alt="" /> : <Icon name="image" size={22} />}</span>
      <span className="st-img-actions">
        <button type="button" className="chip st-chip-btn" onClick={() => input.current?.click()}><Icon name="upload" size={15} />{design.artwork ? t("Replace picture") : t("Add a picture")}</button>
        {design.artwork ? <button type="button" className="chip st-chip-btn" onClick={() => edit((x) => ({ ...x, artwork: null }))}><Icon name="trash" size={15} />{t("Remove")}</button> : null}
      </span>
    </div>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg" onChange={(e) => {
      const f = e.target.files?.[0]; e.target.value = "";
      if (f) void readPicture(f).then((art) => edit((x) => ({ ...x, artwork: art, artworkVisible: true, zoom: 1 }))).catch(fail);
    }} />
    {design.artwork ? <>
      <div className="st-row"><span>{t("Show picture")}</span><Switch label={t("Show picture")} checked={design.artworkVisible !== false} onChange={(v) => edit((x) => ({ ...x, artworkVisible: v }))} /></div>
      <Slider label={t("Zoom")} value={Math.round((design.zoom ?? 1) * 100)} min={100} max={225} unit="%" onCommit={(v) => edit((x) => ({ ...x, zoom: v / 100 }))} />
    </> : null}
  </>;
}

/** A photo or PNG for the background, kept at most 1600 px on its long side. */
async function readPicture(file: File): Promise<CorosWatchfaceArtwork> {
  if (!/^image\/(png|jpeg)$/i.test(file.type)) throw new Error(t("{name} isn't a PNG or JPEG.", { name: file.name }));
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}

function AlignRow({ onAlign }: { onAlign: (edge: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => void }) {
  const items = [["left", t("Align left"), "alignL"], ["centerX", t("Centre across"), "alignH"], ["right", t("Align right"), "alignL"], ["top", t("Align top"), "alignL"], ["centerY", t("Centre down"), "alignV"], ["bottom", t("Align bottom"), "alignL"]] as const;
  return (
    <div className="st-align" role="group" aria-label={t("Align")}>
      {items.map(([edge, label, icon]) => (
        <button key={edge} type="button" className="st-icon-btn" aria-label={label} title={label} onClick={() => onAlign(edge)}>
          <span className={`st-al st-al-${edge}`}><Icon name={icon} size={17} /></span>
        </button>
      ))}
    </div>
  );
}

/** How far a Studio slider's mint fill reaches (studio.css reads --fill). */
export function rangeFill(v: number, min: number, max: number): CSSProperties {
  const pct = max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0;
  return { ["--fill" as string]: `${pct}%` } as CSSProperties;
}

/**
 * A percentage or size, shown as the same number field every other value uses (type it, or drag sideways on it) so
 * the panel has one kind of control for numbers, not sliders in some places and boxes in others.
 */
export function Slider({ label, value, min, max, unit, onCommit }: { label: string; value: number; min: number; max: number; unit?: string; onCommit: (v: number) => void }) {
  return <NumberField label={label} value={value} min={min} max={max} unit={unit?.trim() || undefined} onChange={onCommit} />;
}

/**
 * A number typed in; Enter or leaving the field applies it (one undo step). Dragging sideways on the field scrubs it,
 * 1 a pixel (Shift: 10), applied as it goes and undone as one step; a click without a drag types instead.
 */
export function NumberField({ label, value, unit, min, max, onChange }: { label: string; value: number; unit?: string; min?: number; max?: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // X and Y move by the difference from where the layer is drawn now, so a scrub sends its next value only once the
  // field shows the last one (or a moment has passed, for an edit that didn't take), through the latest onChange.
  // Letting go waits the same way for the last value, then closes the gesture, so the whole drag is one undo step.
  const latest = useRef(onChange);
  const scrub = useRef<{ sent: number; at: number; pending: number | null; ending: boolean; timer: number } | null>(null);
  const flush = () => {
    const s = scrub.current;
    if (!s) return;
    window.clearTimeout(s.timer);
    const caughtUp = value === s.sent || performance.now() - s.at >= 120;
    if (caughtUp && s.pending !== null && s.pending !== s.sent) {
      s.sent = s.pending; s.at = performance.now(); s.pending = null;
      latest.current(s.sent);
    } else if (caughtUp && s.ending) {
      scrub.current = null; endGesture(); setScrubbing(false);
      return;
    }
    s.timer = window.setTimeout(() => flushNow.current(), 130);
  };
  const flushNow = useRef(flush);
  useEffect(() => { latest.current = onChange; flushNow.current = flush; flush(); });
  // A field that goes away mid-drag still closes its gesture, or later edits would all fold into one undo step.
  useEffect(() => () => { if (scrub.current) { window.clearTimeout(scrub.current.timer); scrub.current = null; endGesture(); } }, []);
  const clamp = (v: number) => Math.round(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)));
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    setText(null);
    if (text.trim() === "" || !Number.isFinite(v)) return;
    const clamped = clamp(v);
    if (clamped !== value) onChange(clamped);
  };
  const startScrub = (e: ReactPointerEvent<HTMLLabelElement>) => {
    // While typing, the pointer selects text as usual.
    if (e.button !== 0 || document.activeElement === input.current) return;
    e.preventDefault();
    const startX = e.clientX, from = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) { moved = true; beginGesture(); setScrubbing(true); scrub.current = { sent: from, at: 0, pending: null, ending: false, timer: 0 }; }
      // From the start each time, so Shift can be pressed mid-drag without a jump in where the pointer is.
      scrub.current!.pending = clamp(from + Math.round(dx) * (ev.shiftKey ? 10 : 1));
      flushNow.current();
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (moved) { if (scrub.current) { scrub.current.ending = true; flushNow.current(); } return; }
      input.current?.focus(); input.current?.select();
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };
  return (
    <label className="st-num" data-scrub={scrubbing || undefined} onPointerDown={startScrub} title={t("Drag sideways to change (Shift: by 10)")}
      // Focus comes from the pointer letting go without a drag, never from the label's own click.
      onClick={(e) => { if (e.target !== input.current) e.preventDefault(); }}>
      <span>{label}</span>
      <input ref={input} type="text" inputMode="decimal" value={text ?? String(value)} aria-label={label}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1); onChange(Math.round(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value + step)))); }
        }} />
      {unit ? <em>{unit}</em> : null}
    </label>
  );
}

/** Text on one or more lines: Return starts a new line, leaving the field (or ⌘Return) keeps it. */
function TextArea({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { if (text !== null && text !== value) onCommit(text); setText(null); };
  const shown = text ?? value;
  return (
    <label className="st-num st-text st-textarea"><span>{label}</span>
      <textarea value={shown} rows={Math.min(5, Math.max(1, shown.split("\n").length))} aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur(); }} />
    </label>
  );
}

function TextField({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { if (text !== null && text !== value) onCommit(text); setText(null); };
  return (
    <label className="st-num st-text"><span>{label}</span>
      <input type="text" value={text ?? value} placeholder={placeholder} aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <div className="st-row"><span>{label}</span><Switch label={label} checked={on} onChange={set} /></div>;
}


