import { t, useLanguage, getLocale, midSentence } from "../i18n/watchfaces";
import { WatchfaceColorInput } from "./WatchfaceColorInput";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronDown, Eye, EyeOff, FolderInput, ImagePlus, Pin, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceNativePartStyle } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { NATIVE_DATA_BY_ID, nativeDataAsset, nativeDataPreviewValue } from "./nativeData";
import { NATIVE_CHART_BAR_PAGES, NATIVE_CHART_FIXED_EQUIVALENTS, NATIVE_CHART_PAGES, nativeChartReadoutLabel, nativeChartRepresentation } from "../../electron/watchfaceNativeCatalog";
import { nativeAssetText, nativeComponentFontSize, nativeFontRole, nativeFontSizePart, nativeHasGlyphArt, nativePart, nativePartForFontSize, nativePartHasPosition, nativeParts, nativeRoleDrawsText, nativeRoleIndices, nativeScaleForFontSize, withNativeFont } from "./nativeDataParts";
import { chartReadoutHidden } from "./chartReadouts";
import { loadStudioImage, resizeAndTintSprite, type WatchfaceTypography } from "./watchfaceStudio";
import { LocalFontPicker } from "./LocalFontPicker";
import { WatchfaceNumberAlignControl } from "./WatchfaceNumberAlignControl";
import { WatchfaceHint } from "./WatchfaceHint";
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
/** The watch picks the temperature unit image by its own °C/°F setting (W332 3.2008.0, 0x454f76). */
const TEMPERATURE_UNIT_LABELS = ["Celsius (°C)", "Fahrenheit (°F)"];

const chartSourceLabel = (source: string) => t(nativeChartReadoutLabel(source));
const nativeFieldLabel = (id: string) => t(NATIVE_DATA_BY_ID.get(id)?.label ?? id);
const listLabels = (labels: string[]) => labels.join(getLocale().startsWith("zh") ? "、" : ", ");

/**
 * A field the watch draws only on some chart pages, wherever it sits
 * (nativeLayerChartPages). The face's pages show as numbered tiles in Back
 * order, the same numbers as the stage's Screens strip: lit where the field
 * shows, ringed on the page the canvas shows. Clicking one shows that page.
 */
function FieldPagesPanel({ onAddDailyPage }: {
  pages: string[]; facePages: string[]; shownPage?: string; onShowPage?: (page: string) => void; onAddDailyPage?: () => void;
}) {
  useLanguage();
  return <div className="wf-field-pages">
    <p>{t("The watch draws it only on a daily page, and this face has none.")}</p>
    {onAddDailyPage ? <button type="button" className="secondary-button" onClick={onAddDailyPage}>
      <Plus size={13} aria-hidden="true" />{t("Add a Daily stats page")}
    </button> : null}
  </div>;
}
/** The ⓘ beside "Watch pages": why the field skips some pages, and the way around. */
function fieldPagesHint(id: string, pages: string[]) {
  const label = nativeFieldLabel(id);
  if (!pages.length) return <WatchfaceHint label={t("Why none")}>
    {t("This face has chart pages but no daily data page, and the watch draws {{label}} only on that one.", { label })}{" "}
    {t("A hidden daily page shows nothing of its own, and {{label}} shows while the watch is on it.", { label })}
  </WatchfaceHint>;
  return <WatchfaceHint label={t("Why some pages")}>
    {t("The watch hides {{label}} on the other chart pages wherever it sits. No face setting changes that.", { label })}
    {id !== "chart_sun_angle" && !pages.includes("sun") ? <>{" "}{t("To keep it on screen with sunrise and sunset times, use the Sunrise / sunset field instead of the chart's Sun page.")}</> : null}
  </WatchfaceHint>;
}
/**
 * PACE Pro firmware draws minimum and maximum only together, as one reading
 * (min, separator, max, unit). With one alone, export adds the other
 * invisibly, which leaves a small gap before the unit; adding it back is the
 * clean way.
 */
function MinMaxPartnerPanel({ id, onAdd }: { id: string; onAdd: () => void }) {
  useLanguage();
  const label = nativeFieldLabel(id), other = nativeFieldLabel(id === "weather_temp_min" ? "weather_temp_max" : "weather_temp_min");
  return <div className="wf-field-pages">
    <p><strong>{t("The watch shows minimum and maximum as one reading.")}</strong> {t("With {{label}} alone, the export adds an invisible {{other}}, which leaves a small gap before the unit on the watch.", { label, other })}</p>
    <button type="button" className="secondary-button" onClick={onAdd}><Plus size={13} aria-hidden="true" />{t("Add {{other}}", { other })}</button>
  </div>;
}
export const chartPageLabel = (id: string) => id === "daily-a" ? t("Daily stats") : id === "daily-b" ? t("Daily activity") : id === "sun" ? t("Sun") : id === "moon" ? t("Moon") : id === "barometer" ? t("Barometer") : t("Tide");

type ChartSlotState = "shown" | "hidden" | "missing" | "fixed";
const isBarPage = (id: string) => (NATIVE_CHART_BAR_PAGES as readonly string[]).includes(id);
const pageOfSource = (source: string) => NATIVE_CHART_PAGES.find(page => page.sources.includes(source));

/** What the page the chart layer shows draws: bars, a line or numbers only. */
export function chartPageGraphLabel(pageId: string) {
  const graph = nativeChartRepresentation(NATIVE_CHART_PAGES.find(page => page.id === pageId)?.sources[0]);
  return graph === "bars" ? t("Bars") : graph === "curve" ? t("Line graph") : t("No graph");
}
function chartPageHint(pageId: string) {
  return <WatchfaceHint label={t("About this page")}>
    {isBarPage(pageId)
      ? t("The watch draws bars here. Barometer and tide numbers stay blank until the watch syncs that data from your phone; the graph shows either way.")
      : pageId === "sun" || pageId === "moon"
        ? t("The watch draws a line here, with the horizon and the dot that marks now in white, and skips the weather block for wind.")
        : t("A page of numbers with no graph. The watch shows it only with all three readouts, so hidden ones stay on it invisibly.")}
  </WatchfaceHint>;
}

/**
 * The page the chart layer shows (the edited readout's page): its readouts,
 * the weather fields the watch switches on it, and Remove page. Pages
 * themselves are picked and added in the stage's Screens strip.
 */
function ChartPagePanel({ current, readouts, editable, template, removed, hidden, taken = [], barsOn, disabled, pageFields = [], onSelectField,
  removedPages = [], onEdit, onAdd, onRemove, onShown, onRemovePage, onBars, onMakeFixed, onRestore, onDelete, pageId }: {
  current: string; readouts: string[]; editable: string[]; removed: string[]; disabled: boolean;
  removedPages?: string[]; template: string[]; hidden: string[]; taken?: string[];
  barsOn: boolean; onBars: (on: boolean) => void;
  /** Page-switched fields on the face, and whether the watch draws each on this page. */
  pageFields?: Array<{ id: string; shows: boolean }>; onSelectField?: (id: string) => void;
  onEdit?: (source: string) => void; onAdd?: (source: string) => void; onRemove?: (source: string) => void;
  onShown?: (source: string, shown: boolean) => void; onRemovePage?: (page: string) => void;
  onMakeFixed?: (source: string) => void; onRestore: (source: string) => void;
  /** Delete: removes a readout Studio added, hides a template one, or offers to remove the page. */
  onDelete?: (source: string) => void;
  /** A graph-only page the canvas shows instead of the edited readout's. */
  pageId?: string;
}) {
  useLanguage();
  const page = pageId ? NATIVE_CHART_PAGES.find(item => item.id === pageId) : pageOfSource(current);
  if (!page) return null;
  const present = new Set([...readouts, current]);
  const live = [...present].filter(source => !removed.includes(source));
  const state = (source: string): ChartSlotState => removed.includes(source) ? "fixed" : !present.has(source) ? "missing" : hidden.includes(source) ? "hidden" : "shown";
  const pageOn = (item: typeof page) => isBarPage(item.id) ? barsOn : !removedPages.includes(item.id) && item.sources.some(source => live.includes(source));
  const pagesInUse = NATIVE_CHART_PAGES.filter(item => !isBarPage(item.id) && pageOn(item));
  const empty = !isBarPage(page.id) && !page.sources.some(source => state(source) === "shown");
  const removable = isBarPage(page.id) ? barsOn : !!onRemovePage && pagesInUse.length > 1;
  const lastReadout = live.length <= 1;
  const pageLabel = chartPageLabel(page.id);
  return <div className="wf-chart-page-panel">
    <div className="wf-chart-readouts" role="list" aria-label={t("Readouts on this page")}>
      {page.sources.map(source => {
        const slot = state(source), label = chartSourceLabel(source), required = page.required.includes(source);
        if (slot === "missing" && !required) {
          if (taken.includes(source) || !onAdd) return null;
          return <button key={source} type="button" role="listitem" className="wf-chart-readout is-add" disabled={disabled}
            title={t("Add {{label}} to this page", { label })} onClick={() => onAdd(source)}>
            <span className="wf-chart-readout-glyph" aria-hidden="true"><Plus size={14} /></span>
            <span className="wf-chart-readout-copy"><strong>{label}</strong><small>{t("Optional")}</small></span>
          </button>;
        }
        const editing = source === current && slot !== "fixed";
        const canEdit = (slot === "shown" || slot === "hidden") && (source === current || editable.includes(source));
        const equivalent = NATIVE_CHART_FIXED_EQUIVALENTS[source];
        const status = editing ? t("Editing below") : slot === "fixed" ? t("Made fixed · shows on every page")
          : slot === "shown" ? (canEdit ? t("Click to edit") : t("Kept from the official face"))
          : required ? t("Hidden · kept invisibly") : t("Hidden");
        const shownOnPage = page.sources.filter(item => state(item) === "shown").length;
        return <div key={source} role="listitem" className={`wf-chart-readout${editing ? " is-editing" : ""}${slot === "shown" ? "" : " is-hidden"}`}>
          <button type="button" className="wf-chart-readout-main" disabled={disabled || !canEdit || editing} aria-current={editing ? "true" : undefined}
            onClick={() => onEdit?.(source)}>
            <span className="wf-chart-readout-copy"><strong>{label}</strong><small>{status}</small></span>
          </button>
          {slot === "fixed" ? <button type="button" className="secondary-button wf-chart-readout-restore" disabled={disabled} onClick={() => onRestore(source)}>{t("Put back")}</button> : <>
            {(slot === "hidden" || slot === "missing") && required ? <WatchfaceHint label={t("Why it stays")}>{t("{{label}} is hidden on the watch. This page needs it, so export keeps it there invisibly.", { label })}</WatchfaceHint> : null}
            {equivalent && onMakeFixed && slot === "shown" ? <button type="button" className="wf-chart-readout-action" disabled={disabled || lastReadout}
              aria-label={t("Make {{label}} fixed", { label })}
              title={"metric" in equivalent ? t("Make fixed: moves {{label}} off its page into a field that always shows, using the same digits.", { label }) : t("Make fixed: moves {{label}} off its page into a field that always shows, with the same artwork.", { label })}
              onClick={() => onMakeFixed(source)}><Pin size={14} aria-hidden="true" /></button> : null}
            {onDelete ? <button type="button" className="wf-chart-readout-action" disabled={disabled || lastReadout}
              aria-label={t("Delete {{label}}", { label })}
              title={!template.includes(source) && !required ? t("Delete {{label}}", { label })
                : required ? t("Delete: this page needs {{label}}, so the watch keeps it invisibly.", { label })
                : t("Delete: the template's own readout is hidden on the watch.")}
              onClick={() => onDelete(source)}><Trash2 size={14} aria-hidden="true" /></button>
              : !required && onRemove && !template.includes(source) ? <button type="button" className="wf-chart-readout-action" disabled={disabled || lastReadout}
              aria-label={t("Remove {{label}}", { label })} title={t("Remove {{label}}", { label })} onClick={() => onRemove(source)}><X size={14} aria-hidden="true" /></button> : null}
            {onShown ? <button type="button" className="wf-chart-readout-action" disabled={disabled} aria-pressed={slot !== "shown"}
              aria-label={slot === "shown" ? t("Hide {{label}}", { label }) : t("Show {{label}}", { label })}
              title={slot === "shown" ? (shownOnPage <= 1 && !isBarPage(page.id) ? t("Hide. This is the last readout the page shows: the watch still stops here with nothing visible.") : t("Hide {{label}}", { label })) : t("Show {{label}}", { label })}
              onClick={() => onShown(source, slot !== "shown")}>{slot === "shown" ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}</button> : null}
          </>}
        </div>;
      })}
    </div>
    {pageId && isBarPage(pageId) ? <p className="wf-chart-page-quiet">{t("Graph only: the watch draws the bars with no number. Add the reading to show one.")}</p> : null}
    {empty ? <p className="wf-chart-page-quiet">{t("Nothing visible. The watch still stops here when you press Back; remove the page to skip it.")}</p> : null}
    {pageFields.length ? <div className="wf-chart-page-fields" role="group" aria-label={t("Weather on this page")}>
      <span className="wf-chart-page-fields-label">{t("Weather here")}</span>
      {pageFields.map(field => <button key={field.id} type="button" className={`wf-chart-weather-chip${field.shows ? "" : " is-hidden"}`}
        title={field.shows ? t("Shows on this page") : t("Hidden on this page")} onClick={() => onSelectField?.(field.id)}>
        {field.shows ? null : <EyeOff size={12} aria-hidden="true" />}{nativeFieldLabel(field.id)}
      </button>)}
      <WatchfaceHint label={t("About weather on pages")}>{t("The watch hides temperature, rain, humidity, UV and AQI on Sun and Moon and shows wind instead; min and max show only on the daily pages. Wherever the fields sit.")}</WatchfaceHint>
    </div> : null}
    {removable ? <div className="wf-chart-page-foot">
      <button type="button" className="wf-chart-page-remove-button" disabled={disabled}
        title={isBarPage(page.id) ? t("Turns the bars off, which removes both the barometer and tide pages.") : t("The watch skips a removed page.")}
        onClick={() => isBarPage(page.id) ? onBars(false) : onRemovePage?.(page.id)}>
        <Trash2 size={14} aria-hidden="true" />{isBarPage(page.id) ? t("Remove Barometer and Tide") : t("Remove {{page}} page", { page: pageLabel })}
      </button>
    </div> : null}
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

function SpritePreview({ id, style, role, index, className = "wf-native-artwork-stage" }: { id: string; style: Style; role: Role; index: number; className?: string }) {
  useLanguage();
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    void nativeDataAsset(id, style, role, index).then(image => { if (active) setUrl(image); }).catch(() => { if (active) setUrl(""); });
    return () => { active = false; };
  }, [id, style, role, index]);
  return <span className={className}>{url ? <img src={url} alt="" /> : null}</span>;
}

/** Look settings a part can set for itself instead of following the field. */
const OWN_LOOK_KEYS = ["color", "fontFamily", "fontWeight", "fontStyle", "letterSpacing"] as const;

type RenderSection = (
  sectionId: WatchfaceInspectorSectionId,
  title: string,
  children: ReactNode,
  options?: { disabled?: boolean; status?: ReactNode; actions?: ReactNode }
) => ReactNode;

/**
 * A native data layer is one firmware field drawn from several components
 * (number, icon, unit, …). The inspector splits into the editor's usual
 * sections: Appearance for the shared color and font, Components for the
 * selected part, and Advanced for preview-only settings. The editor renders
 * the Transform section itself so it matches every other layer.
 */
export function NativeDataInspector({ id, style, coordinateScale, api, disabled, renderSection, renderFontSizeField, onPatch, onError, onImportStart, onImportFinish, isImportCurrent, chartGroups = [], chartReadouts = chartGroups, onChartGroup, onAddReadout, onRemoveReadout, takenReadouts, onShowReadout, onAddPage, onRemovePage, onMakeFixed, onDeleteReadout, pageFields, onSelectField, fieldPages, facePages = [], shownPage, onShowPage, graphOnlyPage, onAddDailyPage, removedPages, onAddMinMaxPartner, pairPartner, embeddedParts, partLabels }: {
  id: string; style: Style; api: CorosLinkApi; disabled: boolean; coordinateScale: number;
  renderSection: RenderSection;
  /** The editor's shared Font size field, in master pixels. */
  renderFontSizeField: (value: number, onChange: (fontSize: number) => void) => ReactNode;
  /** Template chart readouts the layer can switch to; the watch's Back button cycles between them. */
  chartGroups?: string[]; onChartGroup?: (source: string) => void;
  /** Every chart readout the template carries, including ones only "Make fixed" can edit (heart rate). */
  chartReadouts?: string[];
  /** Optional readouts Studio adds or removes; `takenReadouts` are shown by other layers. */
  onAddReadout?: (source: string) => void; onRemoveReadout?: (source: string) => void; takenReadouts?: string[];
  /** Show or hide a readout on its page; add or remove whole pages. */
  onShowReadout?: (source: string, shown: boolean) => void; onAddPage?: (page: string) => void; onRemovePage?: (page: string) => void;
  onMakeFixed?: (source: string) => void;
  onDeleteReadout?: (source: string) => void;
  /** Chart: the page-switched fields on the face, and whether each shows on the page the chart shows. */
  pageFields?: Array<{ id: string; shows: boolean }>; onSelectField?: (id: string) => void;
  /** Other fields: the pages this one shows on. */
  fieldPages?: { pages: string[] } | null;
  /** The face's chart pages in Back order, and the one the canvas shows. */
  facePages?: string[]; shownPage?: string; onShowPage?: (page: string) => void;
  /** Chart: a graph-only page on screen, which has no readout to edit. */
  graphOnlyPage?: string | null;
  /** Chart: pages the design removes although the template declares them. */
  removedPages?: string[];
  /** Min or max alone: adds the other, since the watch draws them as one reading. */
  onAddMinMaxPartner?: () => void;
  /**
   * Minimum temperature edited as "Min / max temperature": the maximum's
   * number shows as a part of this panel, drawn by an embedded inspector.
   */
  pairPartner?: { id: string; style: Style; onPatch: (patch: Partial<Style>) => void };
  /** Embedded: render only these parts' rows, without sections. */
  embeddedParts?: Part[];
  /** Part names that differ in this panel ("Min number", "Max number"). */
  partLabels?: Partial<Record<Part, string>>;
  /** Adds a hidden daily page, for min/max on a face without one. */
  onAddDailyPage?: () => void;
  onPatch: (patch: Partial<Style>) => void; onError: (message: string) => void;
  onImportStart: (target: string) => number | null; onImportFinish: (token: number) => void; isImportCurrent: (token: number) => boolean;
}) {
  useLanguage();
  const definition = NATIVE_DATA_BY_ID.get(id)!;
  const [busy, setBusy] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part>("value");
  // Parts open in place; null folds every part.
  const [partOpen, setPartOpen] = useState(!embeddedParts);
  // Own look switched on for a part that has no look of its own yet.
  const [ownLookParts, setOwnLookParts] = useState<Part[]>([]);
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
  const labelOf = (part: Part) => partLabels?.[part] ?? PART_LABELS[part];
  const partLabel = labelOf(partKey);
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
  // The picker sends only the weight or style that changed; spacing comes separately.
  const shapePatch = ({ rasterFont: _rasterFont, letterSpacing: _spacing, ...shape }: WatchfaceTypography) => shape;
  /** Master pixels, like every other layer's Font size, so equal sizes read the same across layers. */
  const fontSizeField = (fontSize: number, change: (fontSize: number) => void) =>
    <div className="watchface-position-inputs">{renderFontSizeField(Math.round(fontSize), change)}</div>;

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
    definition.availability ? <p key="availability" className="watchface-studio-summary" role="note"><strong>{t("AQI —")}{" "}{t(definition.availability.label)}.</strong> {t(definition.availability.message)}</p> : null,
    definition.note && !pairPartner ? <p key="note" className="watchface-studio-summary" role="note">{t(definition.note)}</p> : null
  ].filter(Boolean);

  const artworkStateLabel = (i: number) => { const label = role === "unit" && id.startsWith("weather_temp") ? TEMPERATURE_UNIT_LABELS[i] : SPRITE_LABELS[role!]?.[i]; return label ? t(label) : role === "digits" ? t("Digit {{i}}", { i }) : t("State {{i}}", { i }); };

  // The watch picks bars, a line or no graph per chart page; the face only styles both.
  const graph = nativeChartRepresentation(style.chartSource);
  const [graphStyleTab, setGraphStyleTab] = useState<"line" | "bars">(graph === "curve" ? "line" : "bars");
  useEffect(() => { setGraphStyleTab(graph === "curve" ? "line" : "bars"); }, [graph]);
  const barControls = <>
    <div className="watchface-position-inputs">
      {numberControl("Bar width",style.chartStyle?.barWidth ?? 8,barWidth=>patchChart({barWidth}),0,80,true)}
      {numberControl("Bar gap",style.chartStyle?.barGap ?? 4,barGap=>patchChart({barGap}),0,80,true)}
    </div>
    {colorControl("Selected bar",style.chartStyle?.selectedBarColor ?? component.color,selectedBarColor=>patchChart({selectedBarColor}))}
    {colorControl("Other bars",style.chartStyle?.unselectedBarColor ?? "#555555",unselectedBarColor=>patchChart({unselectedBarColor}))}
  </>;
  const lineControls = <>
    <div className="watchface-position-inputs">{numberControl("Line thickness",style.chartStyle?.lineWidth ?? 2,lineWidth=>patchChart({lineWidth}),0,40,true)}</div>
    {colorControl("Upper curve",style.chartStyle?.upperColor ?? component.color,upperColor=>patchChart({upperColor}))}
    {colorControl("Lower curve",style.chartStyle?.lowerColor ?? "#555555",lowerColor=>patchChart({lowerColor}))}
  </>;
  const graphWithoutNumber = definition.kind === "chart" && nativePart(id, style, "plot").enabled && !nativePart(id, style, style.chartSource === "chart_moon" ? "states" : "value").enabled;

  // The reading as the watch builds it, from this field's own pictures:
  // icon, minus, the sample digits, unit. Each piece opens its part below.
  const previewValue = nativeDataPreviewValue(id, style);
  const readingPieces: Array<{ part: Part; role: Role; index: number; key: string }> = [];
  const shows = (part: Part) => available.includes(part) && nativePart(id, style, part).enabled;
  if (definition.kind !== "chart" && definition.kind !== "state") {
    if (shows("icon")) readingPieces.push({ part: "icon", role: "icon", index: 0, key: "icon" });
    const chars = [...previewValue];
    chars.forEach((char, position) => {
      if ((char === "-" || char === "−") && shows("symbols")) readingPieces.push({ part: "symbols", role: "symbols", index: 0, key: `minus${position}` });
      else if (/\d/.test(char) && shows("value")) readingPieces.push({ part: "value", role: "digits", index: Number(char), key: `digit${position}` });
    });
    if (shows("unit")) readingPieces.push({ part: "unit", role: "unit", index: 0, key: "unit" });
  }
  const partList = (parts: Part[]) => <div className="wf-native-part-list">
      {parts.map(part => {
        const partComponent = nativePart(id, style, part);
        const partRole: Role | null = part === "plot" ? null : part === "value" ? "digits" : part;
        const partIndices = partRole ? nativeRoleIndices(id, style, partRole) : [];
        const replaced = partRole ? Object.keys(style.assets?.[partRole] ?? {}).length : 0;
        const open = partOpen && part === partKey;
        const status = !partComponent.enabled ? t("Hidden")
          : partRole ? (partIndices.length === 1 ? t("1 picture") : t("{{value1}} pictures", { value1: partIndices.length })) + (replaced ? " · " + t("{{value1}} replaced", { value1: replaced }) : "")
          : t("Graph");
        const ownLook = OWN_LOOK_KEYS.some(key => style.parts?.[part]?.[key] !== undefined) || ownLookParts.includes(part);
        return <section key={part} className={`wf-native-part-item${open ? " is-open" : ""}${partComponent.enabled ? "" : " is-off"}`} aria-label={t("{{partLabel}} settings", { partLabel: t(labelOf(part)) })}>
          <div className="wf-native-part-row">
            <button type="button" className="wf-native-part-toggle" aria-expanded={open} onClick={() => { if (part === partKey) setPartOpen(!open); else { setSelectedPart(part); setSelectedIndex(0); setPartOpen(true); } }}>
              {partRole ? <SpritePreview id={id} style={style} role={partRole} index={partIndices[0] ?? 0} className="wf-native-part-thumb" /> : <span className="wf-native-part-thumb is-graph" aria-hidden="true" />}
              <span className="wf-native-part-copy">
                <span className="wf-native-part-name">{t(labelOf(part))}{(Boolean(style.parts?.[part]) || replaced > 0) ? <span className="wf-native-part-badge">{t("Custom")}</span> : null}</span>
                <small>{status}</small>
              </span>
              <ChevronDown className="wf-native-part-chevron" size={15} aria-hidden="true" />
            </button>
            <button type="button" className="wf-native-part-eye" disabled={locked} aria-pressed={!partComponent.enabled}
              aria-label={partComponent.enabled ? t("Hide {{value1}}", { value1: t(labelOf(part)) }) : t("Show {{value1}}", { value1: t(labelOf(part)) })}
              title={partComponent.enabled ? t("Hide {{value1}}", { value1: t(labelOf(part)) }) : t("Show {{value1}}", { value1: t(labelOf(part)) })}
              onClick={() => onPatch({parts:{...style.parts,[part]:{...style.parts?.[part],enabled:!partComponent.enabled}}})}>
              {partComponent.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
          </div>
          {open ? <div className="wf-native-part-body">
            {!nativePartHasPosition(partKey) && <div className="wf-native-part-hint"><span>{t("Placed by the watch")}</span><WatchfaceHint>{t("The watch places this beside the number; only its size and artwork change.")}</WatchfaceHint></div>}
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
            {role && fontSizeField(nativeComponentFontSize(id, style, partKey), fontSize=>patchPart(nativePartForFontSize(id, style, partKey, fontSize)))}
            {role || partKey === "plot" ? <label className="wf-native-own-look">
              <span><strong>{t("Own look")}</strong><small>{ownLook ? t("Its own color and font") : t("Follows the field")}</small></span>
              <input type="checkbox" role="switch" checked={ownLook} disabled={locked} onChange={event => {
                if (event.target.checked) { setOwnLookParts(list => [...list, partKey]); return; }
                setOwnLookParts(list => list.filter(item => item !== partKey));
                // Back to the field's look: drop this part's color and font.
                const fontReset = role ? withNativeFont(style, "", partKey) : {};
                const parts = { ...(fontReset.parts ?? style.parts) };
                const own = { ...parts[partKey] };
                for (const key of OWN_LOOK_KEYS) delete own[key];
                parts[partKey] = own;
                onPatch({ ...fontReset, parts });
              }} />
            </label> : null}
            {ownLook ? <>
              {colorControl("Color",component.color,color=>patchPart({color}))}
              {role && <LocalFontPicker api={api} label={t("Font")} value={style.parts?.[partKey]?.fontFamily ?? ""} emptyLabel={t("Layer font")} disabled={locked} onChange={fontFamily=>onPatch(withNativeFont(style,fontFamily,partKey))}
                inheritedFamily={nativeRoleDrawsText(style, role) ? component.fontFamily : undefined}
                typography={{ fontWeight: component.fontWeight, fontStyle: component.fontStyle, letterSpacing: component.letterSpacing }}
                onTypographyChange={typography=>patchPart(shapePatch(typography))} onLetterSpacingChange={letterSpacing=>patchPart({letterSpacing})}
                showSpacing={role === "icon" || role === "unit" || role === "states"} />}
            </> : null}

            {role && <div className="wf-native-artwork">
              <div className="wf-native-artwork-head">
                <span className="wf-native-part-hint">{t("Pictures")}{role === "unit" && id === "weather_temp" ? <WatchfaceHint>{t("The watch shows 00 in Celsius and 01 in Fahrenheit. Leave 01 untouched to show 00 in both, which suits a plain °.")}</WatchfaceHint> : null}</span>
                {indices.length > 1 ? <small>{t("Click one to edit it")}</small> : null}
              </div>
              <div className={`wf-native-frames${indices.length > 5 ? " is-many" : ""}`} role="listbox" aria-label={t("Artwork state")}>
                {indices.map(i => <button key={i} type="button" role="option" aria-selected={i === index} className={`wf-native-frame${i === index ? " is-selected" : ""}${style.assets?.[role]?.[String(i)] ? " is-custom" : ""}`}
                  title={`${String(i).padStart(2,"0")} · ${artworkStateLabel(i)}`} onClick={() => setSelectedIndex(i)}>
                  <SpritePreview id={id} style={style} role={role} index={i} className="wf-native-frame-art" />
                  <small>{role === "digits" ? String(i) : artworkStateLabel(i)}</small>
                </button>)}
              </div>
              <div className="wf-native-artwork-row">
                <div className="wf-native-artwork-copy">
                  <label className="field">{indices.length > 1 ? t("Text for {{value1}}", { value1: artworkStateLabel(index) }) : t("Text")}<input aria-label={t("Artwork text")} maxLength={32} value={nativeAssetText(id,style,role,index) ?? ""} placeholder={t("Generated artwork")} onChange={event=>onPatch({assetTexts:{...style.assetTexts,[role]:{...style.assetTexts?.[role],[index]:event.target.value}}})} /></label>
                  <span className="wf-native-part-hint wf-native-picture-state">
                    <span>{replacement ? t("Your image") : setAside ? t("Drawn in your font") : t("Drawn from text")}</span>
                    <WatchfaceHint>{replacement
                      ? nativeFontRole(role) ? t("Image in use. Pick a font or remove the image to draw the text instead.") : t("Custom image in use. Remove it to draw the text again.")
                      : setAside ? t("Drawn in the chosen font. Pick Keep template font to bring back the original image.")
                      : t("Drawn from the text in the component color and font, or replaced by an image.")}</WatchfaceHint>
                  </span>
                </div>
              </div>
              <div className="wf-native-artwork-actions">
                <button type="button" className="secondary-button" onClick={()=>void importArtwork(false)}><ImagePlus size={14} /> {replacement ? t("Replace image") : t("Use an image")}</button>
                {indices.length > 1 && <button type="button" className="secondary-button" onClick={()=>void importArtwork(true)}><FolderInput size={14} />{" "}{t("Import numbered PNGs")}</button>}
                {replacement && <button type="button" className="secondary-button wf-native-artwork-remove" onClick={removeImage}><Trash2 size={14} />{" "}{t("Remove image")}</button>}
              </div>
            </div>}

            <button type="button" className="wf-native-part-reset" disabled={!customized} onClick={restoreComponent}><RotateCcw size={13} />{" "}{t("Reset {{value1}}", { value1: midSentence(t(partLabel)) })}</button>
          </div> : null}
        </section>;
      })}
      </div>;
  const openPart = (part: Part) => { setSelectedPart(part); setSelectedIndex(0); setPartOpen(true); };

  const isChart = definition.kind === "chart";
  const chartSource = style.chartSource ?? "chart_stress";
  const chartPage = isChart ? NATIVE_CHART_PAGES.find(page => graphOnlyPage ? page.id === graphOnlyPage : page.sources.includes(chartSource)) : undefined;
  // A chart layer splits its parts: the edited readout's own, then the graph every page shares.
  const graphParts: Part[] = ["plot", "background", "mask", "noDataMask"];
  const readoutParts = available.filter(part => !graphParts.includes(part));
  const shownGraphParts = available.filter(part => graphParts.includes(part));
  // Embedded in the pair's panel: just these parts' rows.
  if (embeddedParts) return partList(embeddedParts.filter(part => available.includes(part)));
  return <>
    {isChart && chartPage ? renderSection("page", t("On the {{page}} page", { page: chartPageLabel(chartPage.id) }), <ChartPagePanel current={chartSource} readouts={[...chartReadouts, ...stored]} editable={[...chartGroups, ...stored]}
      template={chartReadouts} hidden={hiddenReadouts} taken={takenReadouts} removed={style.removedReadouts ?? []} disabled={locked}
      barsOn={(style.chartStyle?.barWidth ?? 8) > 0} onBars={on => patchChart(on ? { barWidth: 8, barGap: style.chartStyle?.barGap || 4 } : { barWidth: 0 })}
      onEdit={onChartGroup} onAdd={onAddReadout} onRemove={onRemoveReadout} onShown={onShowReadout} onRemovePage={onRemovePage} onMakeFixed={onMakeFixed} onDelete={onDeleteReadout} pageId={graphOnlyPage ?? undefined}
      onRestore={source=>onPatch({removedReadouts:(style.removedReadouts ?? []).filter(item=>item!==source)})} pageFields={pageFields} onSelectField={onSelectField} removedPages={removedPages} />,
      { disabled: locked, status: chartPageGraphLabel(chartPage.id), actions: chartPageHint(chartPage.id) }) : null}
    {/* Which pages show a field is a tag under its name and marks in the
        Screens strip; only a field no page shows needs room here. */}
    {!isChart && fieldPages && facePages.length && !fieldPages.pages.some(page => facePages.includes(page)) ? renderSection("page", "Not shown on the watch", <FieldPagesPanel pages={[]} facePages={facePages} onAddDailyPage={onAddDailyPage} />,
      { actions: fieldPagesHint(id, []) }) : null}

    {/* A graph-only page has no readout: only the graph below applies. */}
    {isChart && graphOnlyPage ? null : renderSection("appearance", isChart ? chartSourceLabel(chartSource) : "Look · all parts", <div className={`wf-property-stack${isChart ? " wf-native-components" : ""}`}>
      {readingPieces.length ? <div className="wf-native-reading" role="group" aria-label={t("Reading preview: {{value1}}", { value1: previewValue })}>
        {readingPieces.map((piece) => <button key={piece.key} type="button" className={`wf-native-reading-piece${piece.part === partKey && partOpen ? " is-active" : ""}`}
          title={t(labelOf(piece.part))} aria-label={t("Open {{value1}}", { value1: t(labelOf(piece.part)) })} onClick={() => openPart(piece.part)}>
          <SpritePreview id={id} style={style} role={piece.role} index={piece.index} className="wf-native-reading-art" />
        </button>)}
      </div> : null}
      {notes}
      {colorControl("Color",style.color,color=>onPatch({color}))}
      <LocalFontPicker api={api} label={t("Font")} value={style.fontFamily ?? ""} emptyLabel={nativeHasGlyphArt(style) ? t("Keep template font") : t("Default")} disabled={locked} onChange={fontFamily=>onPatch(withNativeFont(style,fontFamily))}
        inheritedFamily={nativeHasGlyphArt(style) ? undefined : nativePart(id, style, "value").fontFamily}
        typography={{ fontWeight: style.fontWeight ?? 400, fontStyle: style.fontStyle ?? "normal", letterSpacing: style.letterSpacing ?? 0 }}
        onTypographyChange={typography=>onPatch(shapePatch(typography))} onLetterSpacingChange={letterSpacing=>onPatch({letterSpacing})} />
      {fontSizeField(nativeComponentFontSize(id, style, nativeFontSizePart(id, style)), fontSize=>onPatch({scale:nativeScaleForFontSize(id, style, fontSize)}))}
      {onAddMinMaxPartner ? <MinMaxPartnerPanel id={id} onAdd={onAddMinMaxPartner} /> : null}
      {isChart ? partList(readoutParts) : null}
    </div>, { disabled: locked, ...(isChart ? { status: t("This readout") } : {}) })}

    {isChart ? renderSection("graph", "Graph", <div className="wf-property-stack wf-native-components">
      <div className="wf-graph-style-switch" role="group" aria-label={t("Graph style")}>
        <button type="button" aria-pressed={graphStyleTab === "line"} onClick={() => setGraphStyleTab("line")}>{t("Line · Sun, Moon")}</button>
        <button type="button" aria-pressed={graphStyleTab === "bars"} onClick={() => setGraphStyleTab("bars")}>{t("Bars · Baro, Tide")}</button>
      </div>
      {graphStyleTab === "line" ? lineControls : barControls}
      {graphWithoutNumber ? <p className="wf-graph-warning"><span>{t("Graph without a number")}</span><WatchfaceHint>{t("The watch only draws a graph when the face has a chart number, so the export adds an invisible one. Experimental: check the graph on your watch.")}</WatchfaceHint></p> : null}
      {partList(shownGraphParts)}
    </div>, { disabled: locked, status: t("Every page"), actions: <WatchfaceHint label={t("About the graph")}>{t("Experimental charts. This preview uses sample data.")} {t("Every page shares one graph area. The watch draws a line on Sun and Moon, bars on Barometer and Tide, and no graph on the daily pages. At bar width 0 it drops the barometer and tide pages.")}</WatchfaceHint> }) : renderSection("specific", "Parts", <div className="wf-property-stack wf-native-components">
      {pairPartner ? <>
        {/* One reading, in the order the watch draws it: min, separator, max, then the shared unit and minus. */}
        {partList(available.filter(part => part === "value" || part === "separator"))}
        <NativeDataInspector id={pairPartner.id} style={pairPartner.style} coordinateScale={coordinateScale} api={api} disabled={disabled}
          renderSection={renderSection} renderFontSizeField={renderFontSizeField} onPatch={pairPartner.onPatch} onError={onError}
          onImportStart={onImportStart} onImportFinish={onImportFinish} isImportCurrent={isImportCurrent}
          embeddedParts={["value"]} partLabels={{ value: "Max number" }} />
        {partList(available.filter(part => part !== "value" && part !== "separator"))}
      </> : partList(available)}
      {id.startsWith("weather_temp_") && !pairPartner && <p className="watchface-studio-summary">{t("Minimum and maximum temperature share the separator, unit and minus artwork. When both are enabled, the minimum-temperature settings supply these shared assets.")}</p>}
    </div>, { disabled: locked, status: t("{{shown}} of {{total}} shown", { shown: available.filter(part => nativePart(id, style, part).enabled).length + (pairPartner && nativePart(pairPartner.id, pairPartner.style, "value").enabled ? 1 : 0), total: available.length + (pairPartner ? 1 : 0) }) })}

    {renderSection("advanced", "Advanced", <div className="wf-property-stack">
      {id !== "date_year" && <label className="field">{t("Preview sample")}<input aria-label={t("Preview sample")} value={nativeDataPreviewValue(id,style)} maxLength={6} onChange={event=>onPatch({previewValue:event.target.value.replace(/[^0-9.:%−-]/g,"")})} /></label>}
      {id === "date_year" && <p className="field-hint">{t("Year follows the date in Preview simulation.")}</p>}
      <p className="watchface-studio-summary">{t("The sample only feeds this preview; the watch supplies live values. Firmware support and state ordering still need an on-watch test.")}</p>
      <button type="button" className="secondary-button wf-native-restore-all" onClick={()=>onPatch({parts:undefined,assets:undefined,assetTexts:undefined,fontReplacedAssets:undefined,chartStyle:undefined,color:"#ffffff",fontFamily:undefined,fontWeight:undefined,fontStyle:undefined,letterSpacing:undefined,scale:1,chartWidth:240,chartHeight:120})}><RotateCcw size={14} />{" "}{t("Restore all appearance defaults")}</button>
    </div>, { disabled: locked })}
  </>;
}
