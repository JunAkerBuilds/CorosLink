import { WatchfaceColorInput } from "./WatchfaceColorInput";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FolderInput, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import type { CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceNativePartStyle } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_BY_ID, nativeDataAsset, nativeDataPreviewValue } from "./nativeData";
import { nativeAssetText, nativePart, nativePartHasPosition, nativeParts, nativeRoleIndices } from "./nativeDataParts";
import { loadStudioImage, resizeAndTintSprite } from "./watchfaceStudio";
import { LocalFontPicker } from "./LocalFontPicker";
import { WatchfaceNumberAlignControl } from "./WatchfaceNumberAlignControl";
import type { WatchfaceInspectorSectionId } from "./watchfaceInspectorSections";

const PART_LABELS: Record<Part, string> = {
  icon: "Label / icon", value: "Number / time", states: "State artwork", unit: "Units", symbols: "Symbols", progress: "Sun / moon progress",
  plot: "Graph", decimal: "Decimal point", background: "Graph background", mask: "Graph mask", noDataMask: "No-data artwork"
};
const SPRITE_LABELS: Partial<Record<Role, string[]>> = {
  icon: ["Main / rise icon", "Set icon"], unit: ["Primary / metric unit", "Alternate / imperial unit"], symbols: ["Minus", "Degree", "Percent", "Colon"], progress: ["Sunrise progress", "Sunset progress"]
};

/** Keep a draft so typing a minus sign or clearing the field is not reset. */
function ComponentOffsetInput({ label, value, coordinateScale, onChange }: {
  label: string; value: number; coordinateScale: number; onChange: (value: number) => void;
}) {
  const displayed = Math.round(value * coordinateScale);
  const [draft, setDraft] = useState<string | null>(null);
  const limit = Math.floor(1600 * coordinateScale);
  return <label>{label}<input aria-label={label} type="number" min={-limit} max={limit} step={1}
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
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    void nativeDataAsset(id, style, role, index).then(image => { if (active) setUrl(image); }).catch(() => { if (active) setUrl(""); });
    return () => { active = false; };
  }, [id, style, role, index]);
  return <span className="wf-native-artwork-stage">{url ? <img src={url} alt="Selected component artwork" /> : null}</span>;
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
export function NativeDataInspector({ id, style, coordinateScale, api, disabled, renderSection, onPatch, onError, onImportStart, onImportFinish, isImportCurrent }: {
  id: string; style: Style; api: CorosLinkApi; disabled: boolean; coordinateScale: number;
  renderSection: RenderSection;
  onPatch: (patch: Partial<Style>) => void; onError: (message: string) => void;
  onImportStart: (target: string) => number | null; onImportFinish: (token: number) => void; isImportCurrent: (token: number) => boolean;
}) {
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
          if (!indices.includes(state)) throw new Error(`Use these numbered PNGs: ${indices.map(i=>String(i).padStart(2,"0")).join(", ")}.`);
          if (states[state]) throw new Error(`Duplicate sprite ${state}.`);
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
      if (!Object.keys(states).length) throw new Error("Select a folder containing numbered PNGs.");
      if (token === importToken.current && isImportCurrent(editorToken)) {
        const current = latestStyle.current;
        onPatch({assets:{...current.assets,[role]:{...current.assets?.[role],...states}}});
      }
    } catch (error) {
      if (token === importToken.current && isImportCurrent(editorToken)) onError(error instanceof Error ? error.message : "Could not import artwork.");
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
    return <label>{label}<input aria-label={label} type="number" min={Math.ceil(min * factor)} max={Math.floor(max * factor)} step={physical ? 1 : 0.1} value={physical ? Math.round(value * factor) : Math.round(value * 100) / 100} onChange={event => {
      if (event.target.value === "") return;
      change(Math.max(min,Math.min(max,Number(event.target.value) / factor)));
    }} /></label>;
  };
  const colorControl = (label: string, value: string, change: (color: string) => void) => <label className="field">{label}<span className="watchface-color-control"><WatchfaceColorInput key={`${id}:${style.chartSource ?? ""}:${partKey}:${label}`} aria-label={label} value={value} onValueChange={(color) => change(color)} /><code>{value}</code></span></label>;

  const notes = [
    definition.kind === "chart" ? <p key="chart" className="watchface-studio-summary" role="note"><strong>Experimental charts.</strong> This preview uses sample data. {style.chartSource !== "chart_moon" && "Line graphs are not available right now."}</p> : null,
    definition.kind === "chart" && style.chartSource !== "chart_moon" ? <p key="chart-pace" className="watchface-studio-summary" role="note">Chart numbers may stay blank on PACE Pro even when Back changes the graph. The sample number here does not confirm watch support. A separate metric layer can show a value, but will not follow chart changes.</p> : null,
    definition.availability ? <p key="availability" className="watchface-studio-summary" role="note"><strong>AQI — {definition.availability.label}.</strong> {definition.availability.message}</p> : null,
    definition.note ? <p key="note" className="watchface-studio-summary" role="note">{definition.note}</p> : null
  ].filter(Boolean);

  const artworkStateLabel = (i: number) => SPRITE_LABELS[role!]?.[i] ?? (role === "digits" ? `Digit ${i}` : `State ${i}`);

  return <>
    {renderSection("appearance", "Appearance", <div className="wf-property-stack">
      {notes}
      {colorControl("Color",style.color,color=>onPatch({color}))}
      <LocalFontPicker api={api} label="Font" value={style.fontFamily ?? ""} emptyLabel="Default" disabled={locked} onChange={fontFamily=>onPatch({fontFamily})} />
      {definition.kind === "chart" && <label className="field">Chart data<select aria-label="Chart data field" value={style.chartSource ?? "chart_stress"} onChange={event=>onPatch({chartSource:event.target.value})}>{NATIVE_CHART_SOURCES.map(source=><option key={source.id} value={source.id}>{source.category} · {source.label}</option>)}</select></label>}
      <p className="watchface-studio-summary">Every component uses this color and font unless it sets its own below.</p>
    </div>, { disabled: locked })}

    {renderSection("specific", "Components", <div className="wf-property-stack wf-native-components">
      <div className="wf-native-parts" role="tablist" aria-label="Component">
        {available.map(part => {
          const enabled = nativePart(id, style, part).enabled;
          return <button key={part} type="button" role="tab" aria-selected={part === partKey} className={`wf-native-part${part === partKey ? " is-active" : ""}${enabled ? "" : " is-off"}`} title={enabled ? PART_LABELS[part] : `${PART_LABELS[part]} · hidden`} onClick={()=>{setSelectedPart(part);setSelectedIndex(0);}}>{PART_LABELS[part]}</button>;
        })}
      </div>
      <section className="wf-native-part-card" aria-label={`${partLabel} settings`}>
        <div className="wf-native-part-head">
          <strong>{partLabel}</strong>
          {customized ? <span className="wf-native-part-badge">Custom</span> : null}
          <label className="watchface-studio-toggle">
            <input aria-label={`Show ${partLabel}`} type="checkbox" checked={component.enabled} onChange={event=>patchPart({enabled:event.target.checked})} />
            <span>Show</span>
          </label>
        </div>
        {!nativePartHasPosition(partKey) && <p className="watchface-studio-summary">The watch places this beside the number; only its size and artwork change.</p>}
        <div className="watchface-position-inputs">
          {nativePartHasPosition(partKey) && <>
            <ComponentOffsetInput key={`${id}:${partKey}:x`} label="Offset X" value={component.x} coordinateScale={coordinateScale} onChange={x=>patchPart({x})} />
            <ComponentOffsetInput key={`${id}:${partKey}:y`} label="Offset Y" value={component.y} coordinateScale={coordinateScale} onChange={y=>patchPart({y})} />
          </>}
          {numberControl("Width",component.width,width=>patchPart({width}),4,800,true)}
          {numberControl("Height",component.height,height=>patchPart({height}),4,800,true)}
          {partKey === "value" && numberControl("Digit width",component.digitWidth,digitWidth=>patchPart({digitWidth}),1,800,true)}
        </div>
        {partKey === "value" && <WatchfaceNumberAlignControl value={component.align} disabled={locked} onChange={align=>patchPart({align:align ?? "left"})} />}
        {colorControl("Color",component.color,color=>patchPart({color}))}
        {role && <LocalFontPicker api={api} label="Font" value={style.parts?.[partKey]?.fontFamily ?? ""} emptyLabel="Layer font" disabled={locked} onChange={fontFamily=>patchPart({fontFamily:fontFamily || undefined})} />}

        {partKey === "plot" && <>
          <label className="field">Graph type<select aria-label="Graph type" value={style.chartStyle?.previewType ?? "bars"} onChange={event=>patchChart({previewType:event.target.value as "curve" | "bars"})}><option value="bars">Bar graph</option><option value="curve">Line graph</option></select></label>
          {(style.chartStyle?.previewType ?? "bars") === "curve" ? <>
            <div className="watchface-position-inputs">{numberControl("Line thickness",style.chartStyle?.lineWidth ?? 2,lineWidth=>patchChart({lineWidth}),1,40,true)}</div>
            {colorControl("Upper curve",style.chartStyle?.upperColor ?? component.color,upperColor=>patchChart({upperColor}))}
            {colorControl("Lower curve",style.chartStyle?.lowerColor ?? "#555555",lowerColor=>patchChart({lowerColor}))}
          </> : <>
            <div className="watchface-position-inputs">
              {numberControl("Bar width",style.chartStyle?.barWidth ?? 8,barWidth=>patchChart({barWidth}),1,80,true)}
              {numberControl("Bar gap",style.chartStyle?.barGap ?? 4,barGap=>patchChart({barGap}),0,80,true)}
            </div>
            {colorControl("Selected bar",style.chartStyle?.selectedBarColor ?? component.color,selectedBarColor=>patchChart({selectedBarColor}))}
            {colorControl("Other bars",style.chartStyle?.unselectedBarColor ?? "#555555",unselectedBarColor=>patchChart({unselectedBarColor}))}
          </>}
          <p className="watchface-studio-summary">Graph type only changes this preview. Bar and line appearance are both exported; the watch draws each chart group's live history in its own representation.</p>
        </>}

        {role && <div className="wf-native-artwork">
          <div className="wf-native-artwork-head">
            <span>Artwork</span>
            {indices.length > 1 && <select aria-label="Artwork state" value={index} onChange={event=>setSelectedIndex(Number(event.target.value))}>{indices.map(i=><option key={i} value={i}>{String(i).padStart(2,"0")} · {artworkStateLabel(i)}</option>)}</select>}
          </div>
          <div className="wf-native-artwork-row">
            <SpritePreview id={id} style={style} role={role} index={index} />
            <div className="wf-native-artwork-copy">
              <label className="field">Text<input aria-label="Artwork text" maxLength={32} value={nativeAssetText(id,style,role,index) ?? ""} placeholder="Generated artwork" onChange={event=>onPatch({assetTexts:{...style.assetTexts,[role]:{...style.assetTexts?.[role],[index]:event.target.value}}})} /></label>
              <span className="watchface-studio-summary">{replacement ? "Custom image in use. Remove it to draw the text again." : "Drawn from the text in the component color and font, or replaced by an image."}</span>
            </div>
          </div>
          <div className="wf-native-artwork-actions">
            <button type="button" className="secondary-button" onClick={()=>void importArtwork(false)}><ImagePlus size={14} /> {replacement ? "Replace image" : "Use an image"}</button>
            {indices.length > 1 && <button type="button" className="secondary-button" onClick={()=>void importArtwork(true)}><FolderInput size={14} /> Import numbered PNGs</button>}
            {replacement && <button type="button" className="secondary-button wf-native-artwork-remove" onClick={removeImage}><Trash2 size={14} /> Remove image</button>}
          </div>
        </div>}

        <button type="button" className="wf-native-part-reset" disabled={!customized} onClick={restoreComponent}><RotateCcw size={13} /> Reset {partLabel.toLowerCase()}</button>
      </section>
      {id.startsWith("weather_temp_") && <p className="watchface-studio-summary">Minimum and maximum temperature share unit and minus artwork. When both are enabled, the minimum-temperature settings supply these shared assets.</p>}
    </div>, { disabled: locked, status: `${available.filter(part => nativePart(id, style, part).enabled).length} of ${available.length} shown` })}

    {renderSection("advanced", "Advanced", <div className="wf-property-stack">
      <label className="field">Preview sample<input aria-label="Preview sample" value={nativeDataPreviewValue(id,style)} maxLength={6} onChange={event=>onPatch({previewValue:event.target.value.replace(/[^0-9.:%−-]/g,"")})} /></label>
      <p className="watchface-studio-summary">The sample only feeds this preview; the watch supplies live values. Firmware support and state ordering still need an on-watch test.</p>
      <button type="button" className="secondary-button wf-native-restore-all" onClick={()=>onPatch({parts:undefined,assets:undefined,assetTexts:undefined,chartStyle:undefined,color:"#ffffff",fontFamily:undefined,scale:1,chartWidth:240,chartHeight:120})}><RotateCcw size={14} /> Restore all appearance defaults</button>
    </div>, { disabled: locked })}
  </>;
}
