import { t, useLanguage, getLocale } from "../i18n/watchfaces";
import { WatchfaceColorInput } from "./WatchfaceColorInput";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FolderInput, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import type { CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceNativePartStyle } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_BY_ID, nativeDataAsset, nativeDataPreviewValue } from "./nativeData";
import { NATIVE_CHART_FIXED_EQUIVALENTS, NATIVE_CHART_PAGES, nativeChartReadoutLabel, nativeChartRepresentation } from "../../electron/watchfaceNativeCatalog";
import { nativeAssetText, nativePart, nativePartHasPosition, nativeParts, nativeRoleIndices } from "./nativeDataParts";
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
 * A field that shares its slot with another the watch swaps in on other
 * pages. Making it fixed removes those partners, so it has the slot alone.
 */
function FieldPagesPanel({ id, pages, partners, disabled, onMakeFixed }: {
  id: string; pages: string[]; partners: string[]; disabled: boolean; onMakeFixed?: () => void;
}) {
  useLanguage();
  const label = nativeFieldLabel(id), others = listLabels(partners.map(nativeFieldLabel));
  return <div className="wf-field-pages">
    <p><strong>{t("Shows on:")}</strong> {listLabels(pages.map(chartPageLabel))}</p>
    {partners.length ? <p>{t("On the other pages the watch shows {{others}} in this slot.", { others })}</p> : null}
    {onMakeFixed && partners.length ? <>
      <p>{t("Make fixed removes {{others}} from this face, so {{label}} has the slot to itself. Not checked on a watch yet: COROS may still hide it on some pages.", { others, label })}</p>
      <button type="button" className="secondary-button" disabled={disabled} onClick={onMakeFixed}>{t("Make {{label}} fixed", { label })}</button>
    </> : null}
  </div>;
}
const chartPageLabel = (id: string) => id === "daily-a" ? t("Daily data · A") : id === "daily-b" ? t("Daily data · B") : id === "sun" ? t("Sun") : id === "moon" ? t("Moon") : id === "barometer" ? t("Barometer") : t("Tide");

/**
 * The chart as the watch shows it: pages that Back cycles through, each with
 * its readouts in slot order. Clicking a readout edits it on the chart layer;
 * a readout the layer can't edit (heart rate, CorosLink-only keys) can still
 * be made fixed. Pages appear only when the face carries one of their readouts.
 */
function ChartPageStrip({ current, readouts, editable, removed, disabled, onEdit, onOtherData, onMakeFixed, onRestore, pageFields = {}, onSelectField }: {
  current: string; readouts: string[]; editable: string[]; removed: string[]; disabled: boolean;
  /** Other layers that show only on some pages (NOMAD's weather row), by page id. */
  pageFields?: Record<string, string[]>; onSelectField?: (id: string) => void;
  onEdit?: (source: string) => void; onOtherData: (source: string) => void;
  onMakeFixed?: (source: string) => void; onRestore: (source: string) => void;
}) {
  useLanguage();
  const [focused, setFocused] = useState(current);
  useEffect(() => { setFocused(current); }, [current]);
  const present = new Set([...readouts, current]);
  const pages = NATIVE_CHART_PAGES.filter(page => page.sources.some(source => present.has(source)));
  const live = [...present].filter(source => !removed.includes(source));
  const focus = present.has(focused) ? focused : current;
  const isRemoved = removed.includes(focus);
  const equivalent = NATIVE_CHART_FIXED_EQUIVALENTS[focus];
  // The firmware draws no graph without a readout (graph-only faces stay blank).
  const lastReadout = live.length <= 1 && !isRemoved;
  const others = NATIVE_CHART_SOURCES.filter(source => !present.has(source.id));
  return <div className="wf-chart-pages">
    <div className="wf-chart-pages-head"><span>{t("Watch pages")}</span></div>
    <ol className="wf-chart-page-list">
      {pages.map((page, index) => {
        const isCurrent = page.sources.includes(current);
        return <li key={page.id} className={`wf-chart-page${isCurrent ? " is-current" : ""}`} aria-current={isCurrent ? "true" : undefined}>
          <span className="wf-chart-page-number" aria-hidden="true">{index + 1}</span>
          <div className="wf-chart-page-body">
            <div className="wf-chart-page-title">{chartPageLabel(page.id)}{isCurrent ? <small>{t("Shown in the preview")}</small> : null}</div>
            <div className="wf-chart-slots" role="group" aria-label={chartPageLabel(page.id)}>
              {page.sources.filter(source => present.has(source)).map(source => {
                const gone = removed.includes(source), canEdit = !gone && (source === current || editable.includes(source));
                return <button key={source} type="button" disabled={disabled}
                  className={`wf-chart-slot${source === current && !gone ? " is-editing" : ""}${source === focus ? " is-focused" : ""}${gone ? " is-removed" : ""}`}
                  aria-pressed={source === focus}
                  title={gone ? t("Made fixed: it shows on every page now") : canEdit ? t("Edit this readout") : t("Kept from the official face")}
                  onClick={() => { setFocused(source); if (canEdit && source !== current) onEdit?.(source); }}>
                  {chartSourceLabel(source)}{gone ? <span aria-hidden="true">· {t("Fixed")}</span> : null}
                </button>;
              })}
            </div>
            {pageFields[page.id]?.length ? <div className="wf-chart-page-also"><span>{t("Also on this page:")}</span>
              {pageFields[page.id]!.map(field => <button key={field} type="button" className="wf-chart-page-field" onClick={() => onSelectField?.(field)}>{nativeFieldLabel(field)}</button>)}
            </div> : null}
          </div>
        </li>;
      })}
    </ol>
    <div className="wf-chart-slot-actions">
      {isRemoved ? <>
        <p>{t("{{label}} was made fixed, so it shows on every page. Put it back to show it only on its page again.", { label: chartSourceLabel(focus) })}</p>
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => onRestore(focus)}>{t("Put back on its page")}</button>
      </> : equivalent && onMakeFixed ? <>
        <p>{lastReadout ? t("The chart needs at least one readout, so {{label}} can't leave it.", { label: chartSourceLabel(focus) })
          : "metric" in equivalent ? t("Make fixed moves {{label}} off its page into a field that always shows, using the same digits. Its icon becomes an image layer.", { label: chartSourceLabel(focus) })
            : t("Make fixed moves {{label}} off its page into a field that always shows, with the same artwork.", { label: chartSourceLabel(focus) })}</p>
        <button type="button" className="secondary-button" disabled={disabled || lastReadout} onClick={() => onMakeFixed(focus)}>{t("Make {{label}} fixed", { label: chartSourceLabel(focus) })}</button>
      </> : <p>{t("{{label}} has no always-shown version on the watch, so it stays on its page.", { label: chartSourceLabel(focus) })}</p>}
    </div>
    {others.length ? <label className="field">{t("Other data")}
      <select aria-label={t("Show other chart data")} value="" disabled={disabled} onChange={event => { if (event.target.value) onOtherData(event.target.value); }}>
        <option value="">{t("Choose data…")}</option>
        {others.map(source => <option key={source.id} value={source.id}>{t(source.category)} · {t(source.label)}</option>)}
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
export function NativeDataInspector({ id, style, coordinateScale, api, disabled, renderSection, onPatch, onError, onImportStart, onImportFinish, isImportCurrent, chartGroups = [], chartReadouts = chartGroups, onChartGroup, onMakeFixed, pageFields, onSelectField, fieldPages, onMakeFieldFixed }: {
  id: string; style: Style; api: CorosLinkApi; disabled: boolean; coordinateScale: number;
  renderSection: RenderSection;
  /** Chart readouts the layer can switch to; the watch's Back button cycles between them. */
  chartGroups?: string[]; onChartGroup?: (source: string) => void;
  /** Every chart readout the face carries, including ones only "Make fixed" can edit (heart rate). */
  chartReadouts?: string[];
  onMakeFixed?: (source: string) => void;
  /** Chart: page-dependent layers by page. Other fields: the pages this one shows on. */
  pageFields?: Record<string, string[]>; onSelectField?: (id: string) => void;
  fieldPages?: { pages: string[]; partners: string[] } | null; onMakeFieldFixed?: () => void;
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
  const partKey = available.includes(selectedPart) ? selectedPart : available[0];
  const partLabel = PART_LABELS[partKey];
  const component = nativePart(id, style, partKey);
  const role: Role | null = partKey === "plot" ? null : partKey === "value" ? "digits" : partKey;
  const indices = role ? nativeRoleIndices(id, style, role) : [];
  const index = indices.includes(selectedIndex) ? selectedIndex : indices[0] ?? 0;
  const replacement = role ? style.assets?.[role]?.[String(index)] : undefined;
  const customized = Boolean(style.parts?.[partKey]) || (role ? Boolean(style.assets?.[role] && Object.keys(style.assets[role] ?? {}).length) || Boolean(style.assetTexts?.[role] && Object.keys(style.assetTexts[role] ?? {}).length) : Boolean(style.chartStyle));
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
    const parts = {...style.parts}, assets = {...style.assets}, assetTexts = {...style.assetTexts};
    delete parts[partKey];
    if (role) { delete assets[role]; delete assetTexts[role]; }
    if (partKey === "plot") onPatch({parts,chartStyle:undefined,chartWidth:240,chartHeight:120});
    else onPatch({parts,assets,assetTexts});
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
    definition.kind === "chart" && chartReadouts.length > 1 ? <p key="chart-groups" className="watchface-studio-summary" role="note">{t("Edits apply to the readout you pick under Watch pages. The face's other readouts keep their original artwork and don't follow a moved graph.")}</p> : null,
    definition.kind === "chart" && nativeChartRepresentation(style.chartSource) === "none" ? <p key="chart-readouts" className="watchface-studio-summary" role="note"><strong>{t("Readouts only.")}</strong>{" "}{t("The watch shows two pages of numbers with no graph: stress, stamina and elevation, then calories, heart rate and steps. The page's other readouts come from the face. Heart rate comes from the face too; to change it, make it fixed. Bar style applies to the barometer and tide pages.")}</p> : null,
    definition.kind === "chart" && nativePart(id, style, "plot").enabled && !nativePart(id, style, style.chartSource === "chart_moon" ? "states" : "value").enabled
      ? <p key="chart-hidden" className="watchface-studio-summary" role="note"><strong>{t("Graph without a number.")}</strong> {t("The watch only draws a graph when the face has a chart number, so the export adds an invisible one. Experimental: check the graph on your watch.")}</p> : null,
    definition.kind === "chart" && style.chartSource !== "chart_moon" ? <p key="chart-pace" className="watchface-studio-summary" role="note">{t("Chart numbers may stay blank on PACE Pro even when Back changes the graph. The sample number here does not confirm watch support. A separate metric layer can show a value, but will not follow chart changes.")}</p> : null,
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
    </>),
    graphStyle(true, t("sun and moon"), <>
      <div className="watchface-position-inputs">{numberControl("Line thickness",style.chartStyle?.lineWidth ?? 2,lineWidth=>patchChart({lineWidth}),0,40,true)}</div>
      {colorControl("Upper curve",style.chartStyle?.upperColor ?? component.color,upperColor=>patchChart({upperColor}))}
      {colorControl("Lower curve",style.chartStyle?.lowerColor ?? "#555555",lowerColor=>patchChart({lowerColor}))}
    </>)
  ];

  return <>
    {renderSection("appearance", "Appearance", <div className="wf-property-stack">
      {notes}
      {colorControl("Color",style.color,color=>onPatch({color}))}
      <LocalFontPicker api={api} label={t("Font")} value={style.fontFamily ?? ""} emptyLabel={t("Default")} disabled={locked} onChange={fontFamily=>onPatch({fontFamily})} />
      {definition.kind === "chart" && <ChartPageStrip current={style.chartSource ?? "chart_stress"} readouts={chartReadouts} editable={chartGroups}
        removed={style.removedReadouts ?? []} disabled={locked} onEdit={onChartGroup} onOtherData={chartSource=>onPatch({chartSource})} onMakeFixed={onMakeFixed}
        onRestore={source=>onPatch({removedReadouts:(style.removedReadouts ?? []).filter(item=>item!==source)})} pageFields={pageFields} onSelectField={onSelectField} />}
      {definition.kind !== "chart" && fieldPages ? <FieldPagesPanel id={id} pages={fieldPages.pages} partners={fieldPages.partners} disabled={locked} onMakeFixed={onMakeFieldFixed} /> : null}
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
        {role && <LocalFontPicker api={api} label={t("Font")} value={style.parts?.[partKey]?.fontFamily ?? ""} emptyLabel={t("Layer font")} disabled={locked} onChange={fontFamily=>patchPart({fontFamily:fontFamily || undefined})} />}

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
              <span className="watchface-studio-summary">{replacement ? t("Custom image in use. Remove it to draw the text again.") : t("Drawn from the text in the component color and font, or replaced by an image.")}</span>
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
      <button type="button" className="secondary-button wf-native-restore-all" onClick={()=>onPatch({parts:undefined,assets:undefined,assetTexts:undefined,chartStyle:undefined,color:"#ffffff",fontFamily:undefined,scale:1,chartWidth:240,chartHeight:120})}><RotateCcw size={14} />{" "}{t("Restore all appearance defaults")}</button>
    </div>, { disabled: locked })}
  </>;
}
