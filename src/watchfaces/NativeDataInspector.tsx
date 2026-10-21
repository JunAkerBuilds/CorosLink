import { t, useLanguage, getLocale } from "../i18n/watchfaces";
import { WatchfaceColorInput } from "./WatchfaceColorInput";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FolderInput, ImagePlus, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceNativePartStyle } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_BY_ID, nativeDataAsset, nativeDataPreviewValue } from "./nativeData";
import { NATIVE_CHART_BAR_PAGES, NATIVE_CHART_FIXED_EQUIVALENTS, NATIVE_CHART_PAGES, nativeChartReadoutLabel, nativeChartRepresentation } from "../../electron/watchfaceNativeCatalog";
import { nativeAssetText, nativeFontRole, nativeHasGlyphArt, nativePart, nativePartHasPosition, nativeParts, nativeRoleIndices, withNativeFont } from "./nativeDataParts";
import { chartReadoutHidden } from "./chartReadouts";
import { loadStudioImage, resizeAndTintSprite } from "./watchfaceStudio";
import { LocalFontPicker } from "./LocalFontPicker";
import { WatchfaceNumberAlignControl } from "./WatchfaceNumberAlignControl";
import type { WatchfaceInspectorSectionId } from "./watchfaceInspectorSections";

const PART_LABELS: Record<Part, string> = {
  icon: "Label / icon", value: "Number / time", states: "State artwork", unit: "Units", symbols: "Symbols", progress: "Sun / moon progress",
  plot: "Graph", decimal: "Decimal point", background: "Graph background", mask: "Graph mask", noDataMask: "No-data artwork",
  separator: "Min/max separator"
};
const SPRITE_LABELS: Partial<Record<Role, string[]>> = {
  icon: ["Main / rise icon", "Set icon"], unit: ["Primary / metric unit", "Alternate / imperial unit"], symbols: ["Minus", "Degree", "Percent", "Colon"], progress: ["Sunrise progress", "Sunset progress"],
  separator: ["Separator"]
};

const chartSourceLabel = (source: string) => t(nativeChartReadoutLabel(source));
const nativeFieldLabel = (id: string) => t(NATIVE_DATA_BY_ID.get(id)?.label ?? id);
const listLabels = (labels: string[]) => labels.join(getLocale().startsWith("zh") ? "、" : ", ");

/**
 * A field the watch draws only on some chart pages, wherever it sits
 * (nativeLayerChartPages). No face setting changes that, so the panel says
 * where it shows and, for weather the sun page skips, offers the way around.
 */
function FieldPagesPanel({ id, pages }: { id: string; pages: string[] }) {
  useLanguage();
  const label = nativeFieldLabel(id);
  return <div className="wf-field-pages">
    <p><strong>{t("Shows on:")}</strong> {listLabels(pages.map(chartPageLabel))}</p>
    <p>{t("The watch hides {{label}} on the other chart pages wherever it sits. No face setting changes that.", { label })}</p>
    {id !== "chart_sun_angle" && !pages.includes("sun") ? <p>{t("To keep it on screen with sunrise and sunset times, use the Sunrise / sunset field instead of the chart's Sun page.")}</p> : null}
  </div>;
}
const chartPageLabel = (id: string) => id === "daily-a" ? t("Daily data · A") : id === "daily-b" ? t("Daily data · B") : id === "sun" ? t("Sun") : id === "moon" ? t("Moon") : id === "barometer" ? t("Barometer") : t("Tide");

type ChartPage = typeof NATIVE_CHART_PAGES[number];
type ChartSlotState = "shown" | "hidden" | "missing" | "fixed";

/**
 * The chart as the watch shows it: the pages Back steps through, in firmware
 * order (NATIVE_CHART_PAGES), each with its fixed slots. A page in use always
 * carries its required slots, shown or hidden (export keeps hidden ones as
 * invisible readouts); optional slots are added and removed. Barometer and
 * tide come and go together with the bars. Clicking a readout edits it.
 */
function ChartPageStrip({ current, readouts, editable, template, removed, hidden, taken = [], barsOn, disabled, pageFields = {}, onSelectField,
  onEdit, onAdd, onRemove, onShown, onAddPage, onRemovePage, onBars, onMakeFixed, onRestore }: {
  current: string; readouts: string[]; editable: string[]; removed: string[]; disabled: boolean;
  /** Readouts the template declares; the others were added in Studio. */
  template: string[];
  /** Readouts the design keeps on their page but hides. */
  hidden: string[];
  /** Sources another layer already shows (NOMAD's solar angle), which can't be added. */
  taken?: string[];
  /** The watch keeps the barometer and tide pages only while the bar width is above 0. */
  barsOn: boolean; onBars: (on: boolean) => void;
  /** Other layers the watch hides on each page (weather on the sun and moon pages), by page id. */
  pageFields?: Record<string, string[]>; onSelectField?: (id: string) => void;
  onEdit?: (source: string) => void; onAdd?: (source: string) => void; onRemove?: (source: string) => void;
  onShown?: (source: string, shown: boolean) => void; onAddPage?: (page: string) => void; onRemovePage?: (page: string) => void;
  onMakeFixed?: (source: string) => void; onRestore: (source: string) => void;
}) {
  useLanguage();
  const [focused, setFocused] = useState(current);
  useEffect(() => { setFocused(current); }, [current]);
  const present = new Set([...readouts, current]);
  const live = [...present].filter(source => !removed.includes(source));
  const isBarPage = (id: string) => (NATIVE_CHART_BAR_PAGES as readonly string[]).includes(id);
  const pageOf = (source: string) => NATIVE_CHART_PAGES.find(page => page.sources.includes(source));
  // A page is on while it shows something; export adds its hidden required readouts.
  const pageOn = (page: ChartPage) => isBarPage(page.id) ? barsOn : page.sources.some(source => live.includes(source) && !hidden.includes(source));
  const pages = NATIVE_CHART_PAGES.filter(page => pageOn(page) || page.sources.some(source => present.has(source)));
  const addablePages = [...(barsOn ? [] : ["bars"]), ...NATIVE_CHART_PAGES.filter(page => !isBarPage(page.id) && !pageOn(page)).map(page => page.id)];
  const state = (source: string): ChartSlotState => removed.includes(source) ? "fixed" : !present.has(source) ? "missing" : hidden.includes(source) ? "hidden" : "shown";
  // A required slot of a page in use can be focused before it exists.
  const focusable = (source: string) => present.has(source) || Boolean(pageOf(source)?.required.includes(source) && pageOn(pageOf(source)!));
  const focus = focusable(focused) ? focused : current;
  const focusState = state(focus), focusPage = pageOf(focus);
  const label = chartSourceLabel(focus);
  const required = Boolean(focusPage?.required.includes(focus));
  const equivalent = NATIVE_CHART_FIXED_EQUIVALENTS[focus];
  // The chart layer edits one readout, so the last one can't leave.
  const lastReadout = live.length <= 1 && (focusState === "shown" || focusState === "hidden");
  const lastShownOnPage = focusState === "shown" && !!focusPage && focusPage.sources.filter(source => state(source) === "shown").length <= 1;
  const studioAdded = (source: string) => !template.includes(source);
  const pagesInUse = NATIVE_CHART_PAGES.filter(page => !isBarPage(page.id) && pageOn(page));
  const canRemovePage = (page: ChartPage) => !!onRemovePage && !page.sources.some(source => template.includes(source) && present.has(source)) && pagesInUse.length > 1;
  let pageNumber = 0;
  return <div className="wf-chart-pages">
    <div className="wf-chart-pages-head"><span>{t("Watch pages")}</span></div>
    <p className="wf-chart-pages-hint">{t("Back on the watch steps through these pages in this order.")}</p>
    <ol className="wf-chart-page-list">
      {pages.map(page => {
        const isCurrent = page.sources.includes(current), on = pageOn(page);
        const graphOnly = on && isBarPage(page.id) && !page.sources.some(source => present.has(source));
        const someHidden = on && page.required.some(source => state(source) === "hidden" || state(source) === "missing");
        const removable = on && (isBarPage(page.id) || canRemovePage(page));
        return <li key={page.id} className={`wf-chart-page${isCurrent ? " is-current" : ""}${on ? "" : " is-off"}`} aria-current={isCurrent ? "true" : undefined}>
          <span className="wf-chart-page-number" aria-hidden="true">{on ? ++pageNumber : "–"}</span>
          <div className="wf-chart-page-body">
            <div className="wf-chart-page-title">
              <span>{chartPageLabel(page.id)}</span>
              {isCurrent ? <small>{t("Shown in the preview")}</small> : graphOnly ? <small>{t("Graph only")}</small> : null}
              {removable ? <button type="button" className="wf-chart-page-remove" disabled={disabled}
                aria-label={isBarPage(page.id) ? t("Turn bars off") : t("Remove page")}
                title={isBarPage(page.id) ? t("Turn bars off. This removes both the barometer and tide pages.") : t("Remove page")}
                onClick={() => isBarPage(page.id) ? onBars(false) : onRemovePage?.(page.id)}><Trash2 size={13} aria-hidden="true" /></button> : null}
            </div>
            <div className="wf-chart-slots" role="group" aria-label={chartPageLabel(page.id)}>
              {page.sources.map(source => {
                const slot = state(source), isRequired = page.required.includes(source);
                if (slot === "missing") {
                  if (isRequired ? !on : !on || taken.includes(source) || !onAdd) return null;
                  if (!isRequired) return <button key={source} type="button" disabled={disabled} className="wf-chart-slot is-optional"
                    title={t("Add {{label}} to this page", { label: chartSourceLabel(source) })}
                    onClick={() => { setFocused(source); onAdd?.(source); }}><Plus size={12} aria-hidden="true" />{chartSourceLabel(source)}</button>;
                }
                const canEdit = (slot === "shown" || slot === "hidden") && (source === current || editable.includes(source));
                return <button key={source} type="button" disabled={disabled}
                  className={`wf-chart-slot${source === current && slot !== "fixed" ? " is-editing" : ""}${source === focus ? " is-focused" : ""}${slot === "fixed" ? " is-removed" : ""}${slot === "hidden" || slot === "missing" ? " is-hidden" : ""}`}
                  aria-pressed={source === focus}
                  title={slot === "fixed" ? t("Made fixed: it shows on every page now") : slot !== "shown" ? t("Hidden on the watch") : canEdit ? t("Edit this readout") : t("Kept from the official face")}
                  onClick={() => { setFocused(source); if (canEdit && source !== current) onEdit?.(source); }}>
                  {chartSourceLabel(source)}{slot === "fixed" ? <span aria-hidden="true">· {t("Fixed")}</span> : slot !== "shown" ? <span aria-hidden="true">· {t("Hidden")}</span> : null}
                </button>;
              })}
            </div>
            {!on && !isBarPage(page.id) && page.sources.some(source => state(source) === "hidden") ? <p className="wf-chart-page-note">{t("The watch skips this page while all its readouts are hidden.")}</p> : null}
            {!on && isBarPage(page.id) ? <div className="wf-chart-page-off">
              <p className="wf-chart-page-note">{t("The watch skips this page while the bar width is 0.")}</p>
              <button type="button" className="secondary-button" disabled={disabled} onClick={() => onBars(true)}>{t("Turn bars on")}</button>
            </div> : someHidden && page.id.startsWith("daily-") ? <p className="wf-chart-page-note">{t("The watch shows this page only with all three readouts. Hide the ones you don't want.")}</p> : null}
            {on && pageFields[page.id]?.length ? <div className="wf-chart-page-also"><span>{t("Hidden on this page:")}</span>
              {pageFields[page.id]!.map(field => <button key={field} type="button" className="wf-chart-page-field" onClick={() => onSelectField?.(field)}>{nativeFieldLabel(field)}</button>)}
            </div> : null}
          </div>
        </li>;
      })}
    </ol>
    <div className="wf-chart-slot-actions">
      {focusState === "fixed" ? <>
        <p>{t("{{label}} was made fixed, so it shows on every page. Put it back to show it only on its page again.", { label })}</p>
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => onRestore(focus)}>{t("Put back on its page")}</button>
      </> : focusState === "hidden" || focusState === "missing" ? <>
        <p>{required ? t("{{label}} is hidden on the watch. This page needs it, so export keeps it there invisibly.", { label }) : t("{{label}} is hidden on the watch.", { label })}</p>
        <div className="wf-chart-slot-buttons">
          {onShown ? <button type="button" className="secondary-button" disabled={disabled} onClick={() => onShown(focus, true)}>{t("Show {{label}}", { label })}</button> : null}
          {!required && onRemove && studioAdded(focus) ? <button type="button" className="secondary-button" disabled={disabled || lastReadout} onClick={() => onRemove(focus)}>{t("Remove {{label}}", { label })}</button> : null}
        </div>
      </> : <>
        <p>{lastShownOnPage ? t("{{label}} is the last readout this page shows. Remove the page instead.", { label })
          : equivalent && onMakeFixed ? ("metric" in equivalent ? t("Make fixed moves {{label}} off its page into a field that always shows, using the same digits. Its icon becomes an image layer.", { label })
            : t("Make fixed moves {{label}} off its page into a field that always shows, with the same artwork.", { label }))
          : t("{{label}} has no always-shown version on the watch, so it stays on its page.", { label })}</p>
        <div className="wf-chart-slot-buttons">
          {onShown ? <button type="button" className="secondary-button" disabled={disabled || lastShownOnPage} onClick={() => onShown(focus, false)}>{t("Hide {{label}}", { label })}</button> : null}
          {equivalent && onMakeFixed ? <button type="button" className="secondary-button" disabled={disabled || lastReadout} onClick={() => onMakeFixed(focus)}>{t("Make {{label}} fixed", { label })}</button> : null}
          {!required && onRemove && studioAdded(focus) ? <button type="button" className="secondary-button" disabled={disabled || lastReadout} onClick={() => onRemove(focus)}>{t("Remove {{label}}", { label })}</button> : null}
        </div>
      </>}
    </div>
    {onAddPage && addablePages.length ? <label className="field">{t("Add page")}
      <select aria-label={t("Add a watch page")} value="" disabled={disabled} onChange={event => {
        const page = event.target.value;
        if (page === "bars") onBars(true); else if (page) onAddPage(page);
      }}>
        <option value="">{t("Choose a page…")}</option>
        {addablePages.map(id => <option key={id} value={id}>{id === "bars" ? t("Barometer and tide") : chartPageLabel(id)}</option>)}
      </select>
    </label> : null}
  </div>;
}

/** Keep a draft so typing a minus sign or clearing the field is not reset. */
function ComponentOffsetInput({ label, value, coordinateScale, onChange }: {
  label: string; value: number; coordinateScale: number; onChange: (value: number) => void;
}) {
  useLanguage();
  const displayed = Math.round(value * coordinateScale);
  const [draft, setDraft] = useState<string | null>(null);
  const limit = Math.floor(1600 * coordinateScale);
  return <label>{t(label)}<input aria-label={t(label)} type="number" min={-limit} max={limit} step={1}
    value={draft ?? displayed}
    onFocus={() => setDraft(String(displayed))}
    onChange={event => {
      const raw = event.target.value;
      setDraft(raw);
      if (raw === "" || !Number.isFinite(Number(raw))) return;
      onChange(Math.max(-limit, Math.min(limit, Number(raw))) / coordinateScale);
    }}
    onBlur={() => setDraft(null)}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
  /></label>;
}

function SpritePreview({ id, style, role, index }: { id: string; style: Style; role: Role; index: number }) {
  useLanguage();
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    void nativeDataAsset(id, style, role, index).then(image => { if (active) setUrl(image); }).catch(() => { if (active) setUrl(""); });
    return () => { active = false; };
  }, [id, style, role, index]);
  return <span className="wf-native-artwork-stage">{url ? <img src={url} alt={t("Selected component artwork")} /> : null}</span>;
}

type RenderSection = (
  sectionId: WatchfaceInspectorSectionId,
  title: string,
  children: ReactNode,
  options?: { disabled?: boolean; status?: ReactNode }
) => ReactNode;

/**
 * A native data layer is one firmware field drawn from several components
 * (number, icon, unit, …). The inspector splits into the editor's usual
 * sections: Appearance for the shared color and font, Components for the
 * selected part, and Advanced for preview-only settings. The editor renders
 * the Transform section itself so it matches every other layer.
 */
export function NativeDataInspector({ id, style, coordinateScale, api, disabled, renderSection, onPatch, onError, onImportStart, onImportFinish, isImportCurrent, chartGroups = [], chartReadouts = chartGroups, onChartGroup, onAddReadout, onRemoveReadout, takenReadouts, onShowReadout, onAddPage, onRemovePage, onMakeFixed, pageFields, onSelectField, fieldPages }: {
  id: string; style: Style; api: CorosLinkApi; disabled: boolean; coordinateScale: number;
  renderSection: RenderSection;
  /** Template chart readouts the layer can switch to; the watch's Back button cycles between them. */
  chartGroups?: string[]; onChartGroup?: (source: string) => void;
  /** Every chart readout the template carries, including ones only "Make fixed" can edit (heart rate). */
  chartReadouts?: string[];
  /** Optional readouts Studio adds or removes; `takenReadouts` are shown by other layers. */
  onAddReadout?: (source: string) => void; onRemoveReadout?: (source: string) => void; takenReadouts?: string[];
  /** Show or hide a readout on its page; add or remove whole pages. */
  onShowReadout?: (source: string, shown: boolean) => void; onAddPage?: (page: string) => void; onRemovePage?: (page: string) => void;
  onMakeFixed?: (source: string) => void;
  /** Chart: layers the watch hides on each page. Other fields: the pages this one shows on. */
  pageFields?: Record<string, string[]>; onSelectField?: (id: string) => void;
  fieldPages?: { pages: string[] } | null;
  onPatch: (patch: Partial<Style>) => void; onError: (message: string) => void;
  onImportStart: (target: string) => number | null; onImportFinish: (token: number) => void; isImportCurrent: (token: number) => boolean;
}) {
  useLanguage();
  const definition = NATIVE_DATA_BY_ID.get(id)!;
  const [busy, setBusy] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part>("icon");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const importToken = useRef(0), latestStyle = useRef(style);
  latestStyle.current = style;
  useEffect(() => () => { importToken.current++; }, [id, style.chartSource]);
  const available = nativeParts(id, style);
  /** Chart readouts Studio stores beside the edited one, and the ones it keeps hidden. */
  const stored = Object.keys(style.readouts ?? {});
  const hiddenReadouts = definition.kind === "chart" ? [
    ...(chartReadoutHidden(style) ? [style.chartSource ?? "chart_stress"] : []),
    ...Object.entries(style.readouts ?? {}).filter(([source, readout]) => chartReadoutHidden({ ...readout, chartSource: source })).map(([source]) => source)
  ] : [];
  const partKey = available.includes(selectedPart) ? selectedPart : available[0];
  const partLabel = PART_LABELS[partKey];
  const component = nativePart(id, style, partKey);
  const role: Role | null = partKey === "plot" ? null : partKey === "value" ? "digits" : partKey;
  const indices = role ? nativeRoleIndices(id, style, role) : [];
  const index = indices.includes(selectedIndex) ? selectedIndex : indices[0] ?? 0;
  const replacement = role ? style.assets?.[role]?.[String(index)] : undefined;
  const setAside = role && !replacement ? style.fontReplacedAssets?.[role]?.[String(index)] : undefined;
  const customized = Boolean(style.parts?.[partKey]) || (role ? [style.assets, style.assetTexts, style.fontReplacedAssets].some(sets => Object.keys(sets?.[role] ?? {}).length > 0) : Boolean(style.chartStyle));
  const locked = disabled || busy;
  const patchPart = (patch: CorosWatchfaceNativePartStyle) => onPatch({parts:{...style.parts,[partKey]:{...style.parts?.[partKey],...patch}}});
  const patchChart = (patch: NonNullable<Style["chartStyle"]>) => onPatch({chartStyle:{...style.chartStyle,...patch}});

  async function importArtwork(folder: boolean) {
    if (!role) return;
    const editorToken = onImportStart(`native:${id}:${role}`);
    if (editorToken === null) return;
    const token = ++importToken.current;
    setBusy(true);
    try {
      const states: Record<string, string> = {};
      if (folder) {
        const picked = await api.chooseCorosWatchfaceRasterFontFolder();
        if (!picked) return;
        for (const sprite of picked.sprites) {
          if (sprite.relativePath.replace(/\\/g, "/").includes("/")) continue;
          const match = /^(\d{1,2})\.png$/i.exec(sprite.name);
          if (!match) continue;
          const state = Number(match[1]);
          if (!indices.includes(state)) throw new Error(t("Use these numbered PNGs: {{value1}}.", { value1: indices.map(i=>String(i).padStart(2,"0")).join(", ") }));
          if (states[state]) throw new Error(t("Duplicate sprite {{state}}.", { state: state }));
          await loadStudioImage(sprite.dataUrl);
          states[state] = sprite.dataUrl;
        }
      } else {
        const artwork = await api.chooseCorosWatchfaceArtwork();
        if (!artwork) return;
        // Normalize JPEG/WebP too; projects and the compiler use PNGs.
        const ratio = Math.min(1, 1024 / Math.max(artwork.width, artwork.height));
        states[index] = await resizeAndTintSprite(artwork.dataUrl, Math.max(1,Math.round(artwork.width * ratio)), Math.max(1,Math.round(artwork.height * ratio)));
      }
      if (!Object.keys(states).length) throw new Error(t("Select a folder containing numbered PNGs."));
      if (token === importToken.current && isImportCurrent(editorToken)) {
        const current = latestStyle.current;
        onPatch({assets:{...current.assets,[role]:{...current.assets?.[role],...states}}});
      }
    } catch (error) {
      if (token === importToken.current && isImportCurrent(editorToken)) onError(error instanceof Error ? error.message : t("Could not import artwork."));
    } finally {
      onImportFinish(editorToken);
      if (token === importToken.current) setBusy(false);
    }
  }

  function restoreComponent() {
    const parts = {...style.parts}, assets = {...style.assets}, assetTexts = {...style.assetTexts}, fontReplacedAssets = {...style.fontReplacedAssets};
    delete parts[partKey];
    if (role) { delete assets[role]; delete assetTexts[role]; delete fontReplacedAssets[role]; }
    if (partKey === "plot") onPatch({parts,chartStyle:undefined,chartWidth:240,chartHeight:120});
    else onPatch({parts,assets,assetTexts,fontReplacedAssets});
  }
  function removeImage() {
    if (!role) return;
    const states = {...style.assets?.[role]}; delete states[index];
    onPatch({assets:{...style.assets,[role]:states}});
  }
  const numberControl = (label: string, value: number, change: (value: number) => void, min = 0, max = 1600, physical = false) => {
    const factor = physical ? coordinateScale : 1;
    return <label>{t(label)}<input aria-label={t(label)} type="number" min={Math.ceil(min * factor)} max={Math.floor(max * factor)} step={physical ? 1 : 0.1} value={physical ? Math.round(value * factor) : Math.round(value * 100) / 100} onChange={event => {
      if (event.target.value === "") return;
      change(Math.max(min,Math.min(max,Number(event.target.value) / factor)));
    }} /></label>;
  };
  const colorControl = (label: string, value: string, change: (color: string) => void) => <label className="field">{t(label)}<span className="watchface-color-control"><WatchfaceColorInput key={`${id}:${style.chartSource ?? ""}:${partKey}:${label}`} aria-label={t(label)} value={value} onValueChange={(color) => change(color)} /><code>{value}</code></span></label>;

  const notes = [
    definition.kind === "chart" ? <p key="chart" className="watchface-studio-summary" role="note"><strong>{t("Experimental charts.")}</strong>{" "}{t("This preview uses sample data.")}</p> : null,
    definition.kind === "chart" && new Set([...chartReadouts, ...stored, style.chartSource ?? "chart_stress"]).size > 1 ? <p key="chart-groups" className="watchface-studio-summary" role="note">{t("Edits apply to the readout you pick under Watch pages. Each readout keeps its own place and artwork; the graph is shared by every page.")}</p> : null,
    definition.kind === "chart" && nativeChartRepresentation(style.chartSource) === "none" ? <p key="chart-readouts" className="watchface-studio-summary" role="note"><strong>{t("Readouts only.")}</strong>{" "}{t("The watch shows these as two pages of numbers with no graph: stress, stamina and elevation, then calories, heart rate and steps. Bar style applies to the barometer and tide pages.")}</p> : null,
    definition.kind === "chart" && nativePart(id, style, "plot").enabled && !nativePart(id, style, style.chartSource === "chart_moon" ? "states" : "value").enabled
      ? <p key="chart-hidden" className="watchface-studio-summary" role="note"><strong>{t("Graph without a number.")}</strong> {t("The watch only draws a graph when the face has a chart number, so the export adds an invisible one. Experimental: check the graph on your watch.")}</p> : null,
    definition.kind === "chart" && (style.chartStyle?.barWidth ?? 8) > 0 ? <p key="chart-pace" className="watchface-studio-summary" role="note">{t("Barometer and tide numbers stay blank until the watch syncs that data from your phone; their pages show the graph either way.")}</p> : null,
    definition.availability ? <p key="availability" className="watchface-studio-summary" role="note"><strong>{t("AQI —")}{" "}{t(definition.availability.label)}.</strong> {t(definition.availability.message)}</p> : null,
    definition.note ? <p key="note" className="watchface-studio-summary" role="note">{t(definition.note)}</p> : null
  ].filter(Boolean);

  const artworkStateLabel = (i: number) => { const label = SPRITE_LABELS[role!]?.[i]; return label ? t(label) : role === "digits" ? t("Digit {{i}}", { i }) : t("State {{i}}", { i }); };

  // The watch picks bars, a line or no graph per chart page; the face only styles both.
  const graph = nativeChartRepresentation(style.chartSource);
  const graphStyle = (line: boolean, pages: string, controls: ReactNode) => <div key={line ? "line" : "bars"} className="wf-native-graph-style" role="group" aria-label={line ? t("Line style") : t("Bar style")}>
    <div className="wf-native-graph-style-head"><span>{line ? t("Line") : t("Bars")} <small>· {pages}</small></span>{graph === (line ? "curve" : "bars") ? <span className="wf-native-part-badge">{t("This page")}</span> : null}</div>
    {controls}
  </div>;
  const graphStyles = [
    graphStyle(false, t("barometer, tide"), <>
      <div className="watchface-position-inputs">
        {numberControl("Bar width",style.chartStyle?.barWidth ?? 8,barWidth=>patchChart({barWidth}),0,80,true)}
        {numberControl("Bar gap",style.chartStyle?.barGap ?? 4,barGap=>patchChart({barGap}),0,80,true)}
      </div>
      {colorControl("Selected bar",style.chartStyle?.selectedBarColor ?? component.color,selectedBarColor=>patchChart({selectedBarColor}))}
      {colorControl("Other bars",style.chartStyle?.unselectedBarColor ?? "#555555",unselectedBarColor=>patchChart({unselectedBarColor}))}
      <p className="watchface-studio-summary">{t("At width 0 the watch drops the barometer and tide pages.")}</p>
    </>),
    graphStyle(true, t("sun and moon"), <>
      <div className="watchface-position-inputs">{numberControl("Line thickness",style.chartStyle?.lineWidth ?? 2,lineWidth=>patchChart({lineWidth}),0,40,true)}</div>
      {colorControl("Upper curve",style.chartStyle?.upperColor ?? component.color,upperColor=>patchChart({upperColor}))}
      {colorControl("Lower curve",style.chartStyle?.lowerColor ?? "#555555",lowerColor=>patchChart({lowerColor}))}
      <p className="watchface-studio-summary">{t("The watch draws the horizon line and the dot that marks now in white. No face setting changes their color.")}</p>
    </>)
  ];

  return <>
    {renderSection("appearance", "Appearance", <div className="wf-property-stack">
      {notes}
      {colorControl("Color",style.color,color=>onPatch({color}))}
      <LocalFontPicker api={api} label={t("Font")} value={style.fontFamily ?? ""} emptyLabel={nativeHasGlyphArt(style) ? t("Keep template font") : t("Default")} disabled={locked} onChange={fontFamily=>onPatch(withNativeFont(style,fontFamily))} />
      {definition.kind === "chart" && <ChartPageStrip current={style.chartSource ?? "chart_stress"} readouts={[...chartReadouts, ...stored]} editable={[...chartGroups, ...stored]}
        template={chartReadouts} hidden={hiddenReadouts} taken={takenReadouts} removed={style.removedReadouts ?? []} disabled={locked}
        barsOn={(style.chartStyle?.barWidth ?? 8) > 0} onBars={on => patchChart(on ? { barWidth: 8, barGap: style.chartStyle?.barGap || 4 } : { barWidth: 0 })}
        onEdit={onChartGroup} onAdd={onAddReadout} onRemove={onRemoveReadout} onShown={onShowReadout} onAddPage={onAddPage} onRemovePage={onRemovePage} onMakeFixed={onMakeFixed}
        onRestore={source=>onPatch({removedReadouts:(style.removedReadouts ?? []).filter(item=>item!==source)})} pageFields={pageFields} onSelectField={onSelectField} />}
      {definition.kind !== "chart" && fieldPages ? <FieldPagesPanel id={id} pages={fieldPages.pages} /> : null}
      <p className="watchface-studio-summary">{t("Every component uses this color and font unless it sets its own below.")}</p>
    </div>, { disabled: locked })}

    {renderSection("specific", "Components", <div className="wf-property-stack wf-native-components">
      <div className="wf-native-parts" role="tablist" aria-label={t("Component")}>
        {available.map(part => {
          const enabled = nativePart(id, style, part).enabled;
          return <button key={part} type="button" role="tab" aria-selected={part === partKey} className={`wf-native-part${part === partKey ? " is-active" : ""}${enabled ? "" : " is-off"}`} title={enabled ? t(PART_LABELS[part]) : t("{{value1}} · hidden", { value1: t(PART_LABELS[part]) })} onClick={()=>{setSelectedPart(part);setSelectedIndex(0);}}>{t(PART_LABELS[part])}</button>;
        })}
      </div>
      <section className="wf-native-part-card" aria-label={t("{{partLabel}} settings", { partLabel: t(partLabel) })}>
        <div className="wf-native-part-head">
          <strong>{t(partLabel)}</strong>
          {customized ? <span className="wf-native-part-badge">{t("Custom")}</span> : null}
          <label className="watchface-studio-toggle">
            <input aria-label={t("Show {{partLabel}}", { partLabel: t(partLabel) })} type="checkbox" checked={component.enabled} onChange={event=>patchPart({enabled:event.target.checked})} />
            <span>{t("Show")}</span>
          </label>
        </div>
        {!nativePartHasPosition(partKey) && <p className="watchface-studio-summary">{t("The watch places this beside the number; only its size and artwork change.")}</p>}
        <div className="watchface-position-inputs">
          {nativePartHasPosition(partKey) && <>
            <ComponentOffsetInput key={`${id}:${partKey}:x`} label={t("Offset X")} value={component.x} coordinateScale={coordinateScale} onChange={x=>patchPart({x})} />
            <ComponentOffsetInput key={`${id}:${partKey}:y`} label={t("Offset Y")} value={component.y} coordinateScale={coordinateScale} onChange={y=>patchPart({y})} />
          </>}
          {numberControl("Width",component.width,width=>patchPart({width}),4,800,true)}
          {numberControl("Height",component.height,height=>patchPart({height}),4,800,true)}
          {partKey === "value" && numberControl(t("Digit width"),component.digitWidth,digitWidth=>patchPart({digitWidth}),1,800,true)}
        </div>
        {partKey === "value" && <WatchfaceNumberAlignControl value={component.align} disabled={locked} onChange={align=>patchPart({align:align ?? "left"})} />}
        {colorControl("Color",component.color,color=>patchPart({color}))}
        {role && <LocalFontPicker api={api} label={t("Font")} value={style.parts?.[partKey]?.fontFamily ?? ""} emptyLabel={t("Layer font")} disabled={locked} onChange={fontFamily=>onPatch(withNativeFont(style,fontFamily,partKey))} />}

        {partKey === "plot" && <>
          <p className="watchface-studio-summary">
            {graph === "curve"
              ? t("The {{page}} page draws a line.", { page: chartSourceLabel(style.chartSource ?? "chart_stress") })
              : graph === "bars"
                ? t("The {{page}} page draws bars.", { page: chartSourceLabel(style.chartSource ?? "chart_stress") })
                : t("The {{page}} page draws no graph.", { page: chartSourceLabel(style.chartSource ?? "chart_stress") })}{" "}
            {t("Back on the watch switches chart pages, and each page uses one of these styles. Barometer and tide pages need data from the phone and stay empty until it syncs. A width of 0 hides that style's graph.")}
          </p>
          {graph === "curve" ? [graphStyles[1], graphStyles[0]] : graphStyles}
        </>}

        {role && <div className="wf-native-artwork">
          <div className="wf-native-artwork-head">
            <span>{t("Artwork")}</span>
            {indices.length > 1 && <select aria-label={t("Artwork state")} value={index} onChange={event=>setSelectedIndex(Number(event.target.value))}>{indices.map(i=><option key={i} value={i}>{String(i).padStart(2,"0")} · {artworkStateLabel(i)}</option>)}</select>}
          </div>
          <div className="wf-native-artwork-row">
            <SpritePreview id={id} style={style} role={role} index={index} />
            <div className="wf-native-artwork-copy">
              <label className="field">{t("Text")}<input aria-label={t("Artwork text")} maxLength={32} value={nativeAssetText(id,style,role,index) ?? ""} placeholder={t("Generated artwork")} onChange={event=>onPatch({assetTexts:{...style.assetTexts,[role]:{...style.assetTexts?.[role],[index]:event.target.value}}})} /></label>
              <span className="watchface-studio-summary">{replacement
                ? nativeFontRole(role) ? t("Image in use. Pick a font or remove the image to draw the text instead.") : t("Custom image in use. Remove it to draw the text again.")
                : setAside ? t("Drawn in the chosen font. Pick Keep template font to bring back the original image.")
                : t("Drawn from the text in the component color and font, or replaced by an image.")}</span>
            </div>
          </div>
          <div className="wf-native-artwork-actions">
            <button type="button" className="secondary-button" onClick={()=>void importArtwork(false)}><ImagePlus size={14} /> {replacement ? t("Replace image") : t("Use an image")}</button>
            {indices.length > 1 && <button type="button" className="secondary-button" onClick={()=>void importArtwork(true)}><FolderInput size={14} />{" "}{t("Import numbered PNGs")}</button>}
            {replacement && <button type="button" className="secondary-button wf-native-artwork-remove" onClick={removeImage}><Trash2 size={14} />{" "}{t("Remove image")}</button>}
          </div>
        </div>}

        <button type="button" className="wf-native-part-reset" disabled={!customized} onClick={restoreComponent}><RotateCcw size={13} />{" "}{t("Reset")}{" "}{t(partLabel).toLocaleLowerCase(getLocale())}</button>
      </section>
      {id.startsWith("weather_temp_") && <p className="watchface-studio-summary">{t("Minimum and maximum temperature share the separator, unit and minus artwork. When both are enabled, the minimum-temperature settings supply these shared assets.")}</p>}
    </div>, { disabled: locked, status: t("{{shown}} of {{total}} shown", { shown: available.filter(part => nativePart(id, style, part).enabled).length, total: available.length }) })}

    {renderSection("advanced", "Advanced", <div className="wf-property-stack">
      {id !== "date_year" && <label className="field">{t("Preview sample")}<input aria-label={t("Preview sample")} value={nativeDataPreviewValue(id,style)} maxLength={6} onChange={event=>onPatch({previewValue:event.target.value.replace(/[^0-9.:%−-]/g,"")})} /></label>}
      {id === "date_year" && <p className="field-hint">{t("Year follows the date in Preview simulation.")}</p>}
      <p className="watchface-studio-summary">{t("The sample only feeds this preview; the watch supplies live values. Firmware support and state ordering still need an on-watch test.")}</p>
      <button type="button" className="secondary-button wf-native-restore-all" onClick={()=>onPatch({parts:undefined,assets:undefined,assetTexts:undefined,fontReplacedAssets:undefined,chartStyle:undefined,color:"#ffffff",fontFamily:undefined,scale:1,chartWidth:240,chartHeight:120})}><RotateCcw size={14} />{" "}{t("Restore all appearance defaults")}</button>
    </div>, { disabled: locked })}
  </>;
}
