// The selectable data slot's panel: the list the wearer picks from on the watch (a switch a type, its icon and the
// sample the preview draws), the type being previewed with its icon, and what every type shares. Rewritten from
// CorosLink's renderComplicationPicker, renderSelectableSlotIcon, renderSelectableSlotSharedAssets and
// renderControlBatteryInspector in the Studio look; every control writes through studioSlot.ts and studioEdits.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented, Switch } from "@/components/ui";
import { msg, t } from "@/lib/i18n";
import type { CorosWatchfaceArtwork } from "../../watchface/types";
import { Icon } from "./StudioIcon";
import { OfficialPicker } from "./StudioOfficialPicker";
import { officialArtwork, officialBatteryRequest, officialBatteryStates, officialImageRequest } from "../studioOfficial";
import { assetOf, readArtwork, replaceAsset, restoreAsset, setAsset, setBatteryStates, setScale } from "../studioEdits";
import type { Design, EditorLayer } from "../studioFace";
import {
  BAROMETER_TRENDS, barometerPieces, iconOffsetOf, nextSlotPreview, setIconOffset, setSlotPreview, setSlotType, setValueTint, SLOT_BATTERY_LAYER,
  slotImagePaths, slotPreview, slotSelector, slotShared, slotTypes, TREND_CHOICE, valueTintOf, type BarometerTrend,
} from "../studioSlot";
import { Dots, hex, NumberField, type LayerInspectorProps } from "../pages/StudioInspector";
import "./studioSlot.css";

type Props = LayerInspectorProps & { fail: (e: unknown) => void };
type Edit = Props["edit"];

const TYPE_ICON: Record<string, string> = {
  heartRate: "heart", steps: "steps", calories: "flame", floors: "bar", elevation: "mountain", barometer: "gauge", exercise: "timer", sunrise: "sun",
  sunset: "sun", battery: "battery", temperature: "drop", date: "cal",
};
const BATTERY_STATES = [msg("Charging"), "0%", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%"];

/** The template's pictures by path, loaded once each, as data URLs. */
function useTemplateImages(paths: string[], load: Props["loadAssets"]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = [...new Set(paths)].sort().join("\n");
  useEffect(() => {
    if (!load || !key) return;
    let live = true;
    void load(key.split("\n")).then((assets) => { if (live) setUrls((u) => ({ ...u, ...Object.fromEntries(assets.map((a) => [a.path, a.dataUrl])) })); }).catch(() => undefined);
    return () => { live = false; };
  }, [key, load]);
  return urls;
}

export function SlotTop(p: Props) {
  const { design, edit, details } = p;
  const mode = p.aodNote ? "aod" : "current";
  const layers = useMemo(() => p.allLayers ?? [], [p.allLayers]);
  const types = useMemo(() => slotTypes(details, design, mode, layers), [details, design, mode, layers]);
  const selector = useMemo(() => slotSelector(details, design, types), [details, design, types]);
  const previewed = slotPreview(types, design);
  const open = types.find((ty) => ty.id === previewed) ?? null;
  const { shared, baro, piecePaths } = useMemo(() => {
    const shared = slotShared(layers), baro = barometerPieces(layers);
    const keys = [...shared.map((s) => s.key), ...baro.trends.map((ty) => ty.key), ...(baro.point ? [baro.point.key] : [])];
    return { shared, baro, piecePaths: slotImagePaths(details, design, keys) };
  }, [details, design, layers]);
  const urls = useTemplateImages([...types.flatMap((ty) => (ty.iconPath ? [ty.iconPath] : [])), ...Object.values(piecePaths)], p.loadAssets);
  const thumbOf = (layer: EditorLayer | null, path: string | null | undefined) =>
    (layer ? assetOf(design, layer)?.replacement?.dataUrl : undefined) ?? (path ? urls[path] : undefined);

  const show = (id: string) => edit((x) => setSlotPreview(x, id));
  const step = (by: 1 | -1) => { const next = nextSlotPreview(types, previewed, by); if (next) show(next); };
  const onCount = types.filter((ty) => ty.on).length;
  const tint = valueTintOf(design);
  const trend = (p.choice?.[TREND_CHOICE] as BarometerTrend | undefined) ?? "flat";

  return <>
    <div className="st-row-col">
      <div className="st-sl-head">
        <span className="st-label">{t("The wearer picks from")}</span>
        <span className="st-sl-count">{t("{on} of {total}", { on: onCount, total: types.length })}</span>
        <button type="button" className="st-icon-btn" aria-label={t("Preview the type before")} title={t("Preview the type before")} disabled={onCount < 2} onClick={() => step(-1)}><Icon name="chevL" size={15} width={2.2} /></button>
        <button type="button" className="st-icon-btn" aria-label={t("Preview the next type")} title={t("Preview the next type")} disabled={onCount < 2} onClick={() => step(1)}><Icon name="chevR" size={15} width={2.2} /></button>
      </div>
      <div className="st-ch-pages" role="list" aria-label={t("Data types the wearer can pick")}>
        {types.map((ty) => {
          const src = thumbOf(ty.iconLayer, ty.iconPath);
          const noIcon = ty.on && !ty.blocked && (ty.icon === "none" || ty.icon === "hidden");
          const sub = ty.blocked ?? (!ty.on ? null : noIcon ? t("No icon") : !ty.inTemplate ? t("Added by Studio") : null);
          return (
            <div key={ty.id} role="listitem" className="st-ch-pg st-sl-row" data-on={ty.on || undefined} data-cur={(ty.on && ty.id === previewed) || undefined}>
              <button type="button" className="st-ch-pg-main" disabled={!ty.on} aria-pressed={ty.on && ty.id === previewed} aria-label={t("Preview {label}", { label: t(ty.label) })}
                title={ty.on ? t("Show on the watch preview") : ty.blocked ?? undefined} onClick={() => show(ty.id)}>
                <span className="st-sl-thumb" data-empty={(ty.on && (ty.icon === "none" || ty.icon === "hidden")) || undefined}>{src ? <img src={src} alt="" draggable={false} /> : <Icon name={TYPE_ICON[ty.id] ?? "gauge"} size={15} />}</span>
                <span className="st-sl-copy"><span>{t(ty.label)}</span>{sub ? <small data-warn={noIcon || undefined}>{sub}</small> : null}</span>
                <span className="st-sl-sample">{ty.sample}</span>
              </button>
              <Switch label={t("{label} on the watch's list", { label: t(ty.label) })} checked={ty.on} disabled={!!ty.blocked} onChange={(v) => edit((x) => setSlotType(x, details, mode, ty.id, v))} />
            </div>
          );
        })}
      </div>
      {selector.warnings.map((w) => (
        <p key={w.kind} className="st-ch-why st-sl-why" data-warn><Icon name="warn" size={14} /><span>{w.text}
          {w.kind === "blank" && mode === "current" ? <button type="button" className="st-link" onClick={() => edit((x) => ({ ...x, stripBlankConfigKeys: true }))}>{t("Strip blank keys")}</button> : null}</span></p>
      ))}
    </div>

    {open ? (
      <div className="st-ch-sec">
        <h3><span>{t(open.label)}</span><small>{open.sample}</small></h3>
        {open.note ? <span className="st-note">{t(open.note)}</span> : null}
        {open.id === "battery" ? <BatteryChoice {...p} layers={layers} />
          : open.id === "barometer" ? <>
            <div className="st-row-col"><span className="st-label">{t("Trend shown")}</span>
              <Segmented small label={t("Barometer trend shown")} value={trend} onChange={(v) => p.onState?.(TREND_CHOICE, v)} options={BAROMETER_TRENDS.map((ty) => ({ value: ty.id, label: t(ty.label) }))} /></div>
            <div className="st-sl-pieces">
              {baro.trends.map((ty) => <Piece key={ty.key} {...p} layer={ty.layer} label={ty.label} src={thumbOf(ty.layer, piecePaths[ty.key])} glyph="gauge" fallback={t("Studio's arrow")} onLook={() => p.onState?.(TREND_CHOICE, ty.id)} />)}
              {baro.point ? <Piece {...p} layer={baro.point.layer} label={baro.point.label} src={thumbOf(baro.point.layer, piecePaths[baro.point.key])} glyph="minus" fallback={t("Studio's dot")} /> : null}
            </div>
          </> : open.iconLayer ? (
            <div className="st-sl-pieces"><Piece {...p} layer={open.iconLayer} label={msg("Icon")} src={thumbOf(open.iconLayer, open.iconPath)} glyph={TYPE_ICON[open.id] ?? "image"} fallback={t("None: import one")} /></div>
          ) : null}
        {open.canOffset ? <Offset design={design} edit={edit} id={open.id} /> : null}
      </div>
    ) : null}

    <div className="st-ch-sec">
      <h3><span>{t("Every type")}</span></h3>
      {shared.length ? (
        <div className="st-sl-pieces">
          {shared.map((s) => <Piece key={s.key} {...p} layer={s.layer} label={s.label} sub={t(s.note)} src={thumbOf(s.layer, piecePaths[s.key])} glyph="minus" fallback="" />)}
        </div>
      ) : null}
      <div className="st-row-col"><span className="st-label">{t("Value tint")}</span>
        <div className="st-sl-tint"><Dots value={tint ?? design.digitColor} onPick={(c) => edit((x) => setValueTint(x, c))} />
          <span className="st-hex">{tint ? hex(tint) : t("Face color")}</span>
          {tint ? <button type="button" className="st-icon-btn" aria-label={t("Clear the value tint")} title={t("Back to the face's color")} onClick={() => edit((x) => setValueTint(x, undefined))}><Icon name="refresh" size={15} /></button> : null}
        </div></div>
    </div>
  </>;
}

/** One of the slot's pictures: what it is now, and replace, the official library, restore and show or hide. */
function Piece({ design, edit, fail, watch, layer, label, sub, src, glyph, fallback, onLook }: Props & { layer: EditorLayer; label: string; sub?: string; src?: string; glyph: string; fallback: string; onLook?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [official, setOfficial] = useState(false);
  const o = assetOf(design, layer);
  const custom = !!o?.replacement, shown = o?.enabled !== false;
  const put = (art: CorosWatchfaceArtwork) => { edit((x) => replaceAsset(x, layer, art)); onLook?.(); };
  const state = !shown ? t("Hidden") : custom ? t("Yours") : src ? sub : fallback || sub;
  const name = t(label).toLowerCase();
  return (
    <div className="st-ch-ro" data-state={shown ? undefined : "hidden"}>
      <span className="st-sl-thumb" data-empty={!src || undefined}>{src ? <img src={src} alt="" draggable={false} /> : <Icon name={glyph} size={16} />}</span>
      <span className="st-ch-ro-copy"><b>{t(label)}</b>{state ? <small>{state}</small> : null}</span>
      <button type="button" className="st-icon-btn" aria-label={src ? t("Replace the {name} image", { name }) : t("Import the {name} image", { name })} title={src ? t("Replace with a PNG") : t("Import a PNG")} onClick={() => input.current?.click()}><Icon name="upload" size={16} /></button>
      <button type="button" className="st-icon-btn" aria-label={t("Official library for the {name} image", { name })} title={t("Official library")} onClick={() => setOfficial(true)}><Icon name="spark" size={16} /></button>
      {custom ? <button type="button" className="st-icon-btn" aria-label={t("Restore the {name} image", { name })} title={t("Restore")} onClick={() => edit((x) => restoreAsset(x, layer))}><Icon name="refresh" size={16} /></button> : null}
      {src || !shown ? <button type="button" className="st-icon-btn" aria-label={shown ? t("Hide the {name} image", { name }) : t("Show the {name} image", { name })} title={shown ? t("Hide") : t("Show")} onClick={() => edit((x) => setAsset(x, layer, { enabled: !shown }))}><Icon name={shown ? "eye" : "eyeOff"} size={16} /></button> : null}
      <input ref={input} type="file" hidden accept="image/png" aria-label={t("{label} PNG", { label: t(label) })} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readArtwork(f).then(put).catch(fail); }} />
      {official ? <OfficialPicker watch={watch} request={officialImageRequest({ ...layer, label: t("{name} image", { name }) })} onClose={() => setOfficial(false)} onPick={(set, frame) => put(officialArtwork(set, frame))} /> : null}
    </div>
  );
}

/** Icon offset: moves a type's icon alone; the slot's own position moves icon and value together. */
function Offset({ design, edit, id }: { design: Design; edit: Edit; id: string }) {
  const o = iconOffsetOf(design, id);
  return (
    <div className="st-row-col"><span className="st-label">{t("Icon offset")}</span>
      <div className="st-sl-offset">
        <NumberField label="X" value={o.dx} min={-800} max={800} onChange={(v) => edit((x) => setIconOffset(x, id, v, iconOffsetOf(x, id).dy))} />
        <NumberField label="Y" value={o.dy} min={-800} max={800} onChange={(v) => edit((x) => setIconOffset(x, id, iconOffsetOf(x, id).dx, v))} />
        <button type="button" className="st-icon-btn" aria-label={t("Reset the icon offset")} title={t("Back beside the value")} disabled={!o.dx && !o.dy} onClick={() => edit((x) => setIconOffset(x, id, 0, 0))}><Icon name="refresh" size={15} /></button>
      </div></div>
  );
}

/** The battery choice's level pictures: its own set, apart from the fixed battery icon. */
function BatteryChoice({ design, edit, fail, watch, layers }: Props & { layers: EditorLayer[] }) {
  const layer = layers.find((l) => l.kind === SLOT_BATTERY_LAYER);
  const input = useRef<HTMLInputElement>(null);
  const [official, setOfficial] = useState(false);
  if (!layer) return null;
  const o = assetOf(design, layer), states = o?.stateReplacements;
  const load = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const picked: Record<string, CorosWatchfaceArtwork> = {};
      for (const f of [...files]) { const m = f.name.match(/^(\d{1,2})\.png$/i); if (m) picked[String(Number(m[1]))] = await readArtwork(f); }
      if (!Object.keys(picked).length) throw new Error(t("Name battery pictures 00.png (charging), 01.png (empty) to 11.png (full)."));
      edit((x) => setBatteryStates(x, layer, picked));
    } catch (e) { fail(e); }
  };
  return <>
    {states ? (
      <div className="st-states">
        {BATTERY_STATES.map((label, i) => <span key={label} className="st-state" title={t(label)}>{states[String(i)] ? <img src={states[String(i)].dataUrl} alt="" /> : <i />}<small>{t(label)}</small></span>)}
      </div>
    ) : null}
    <div className="st-nums">
      <button type="button" className="chip st-chip-btn" onClick={() => input.current?.click()}><Icon name="upload" size={15} />{t("Numbered PNGs")}</button>
      <button type="button" className="chip st-chip-btn" onClick={() => setOfficial(true)}><Icon name="spark" size={15} />{t("Official sprites")}</button>
      {states || o?.replacement ? <button type="button" className="chip st-chip-btn" onClick={() => edit((x) => restoreAsset(x, layer))}><Icon name="refresh" size={15} />{t("Restore")}</button> : null}
      <NumberField label={t("Scale")} unit="%" value={Math.round((o?.scale ?? 1) * 100)} min={10} max={400} onChange={(v) => edit((x) => setScale(x, layer, v / 100))} />
    </div>
    <input ref={input} type="file" hidden multiple accept="image/png" aria-label={t("Battery level PNGs")} onChange={(e) => { void load(e.target.files); e.target.value = ""; }} />
    {official ? <OfficialPicker watch={watch} request={officialBatteryRequest()} onClose={() => setOfficial(false)} onPick={(set) => edit((x) => setBatteryStates(x, layer, officialBatteryStates(set)))} /> : null}
  </>;
}
