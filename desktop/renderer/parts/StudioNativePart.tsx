// One part of a live-data field, edited on its own as in CorosLink's NativeDataInspector: its pictures one at a time
// (official set or image, Replace, Remove, the drawn text), and its box, alignment, font size and own font, with
// Reset this part. The edits are studioNativeParts.ts; NativeParts in StudioInspector lays these out per part.
import { useState } from "react";
import { Segmented, Select, Switch } from "@/components/ui";
import type { CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceResolutionDetails } from "../../watchface/types";
import { nativeAssetText, nativeComponentFontSize, nativePart, nativeRoleDrawsText } from "../../watchface/engine/nativeDataParts";
import { nativeOf, readArtwork, setNative } from "../studioEdits";
import type { Design, EditorLayer } from "../studioFace";
import {
  clampBox, nativeOfficialRequest, officialPictures, partCustomized, partHasOwnFont, pictureFit, withPart, withPartFont, withPartFontSize,
  withPictureText, withPictures, withoutPartChanges, withoutPartFont, withoutPicture,
} from "../studioNativeParts";
import { NumberField } from "../pages/StudioInspector";
import { FontPicker } from "../pages/StudioFontPicker";
import { OfficialPicker } from "./StudioOfficialPicker";
import { Icon } from "./StudioIcon";
import "./studioParity.css";

type Edit = (fn: (d: Design) => Design) => void;

/** Applies a patch built from the field's latest style, so edits never work from a stale copy. */
const patchNative = (edit: Edit, layer: EditorLayer, patch: (n: Style) => Partial<Style>) =>
  edit((x) => { const n = nativeOf(x, layer); return n ? setNative(x, layer, patch(n)) : x; });

/** A PNG chosen on this computer, its longest side kept to 1024 px. */
async function readPartPicture(file: File): Promise<string> {
  const art = await readArtwork(file);
  const fit = pictureFit(art.width, art.height);
  if (fit.width === art.width && fit.height === art.height) return art.dataUrl;
  const img = new Image();
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error(`Couldn't open ${file.name}.`)); img.src = art.dataUrl; });
  const canvas = document.createElement("canvas");
  canvas.width = fit.width; canvas.height = fit.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't resize the picture.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, fit.width, fit.height);
  return canvas.toDataURL("image/png");
}

const pad = (i: number) => String(i).padStart(2, "0");

export interface NativePicturesProps {
  design: Design;
  edit: Edit;
  layer: EditorLayer;
  part: Part;
  partName: string;
  role: Role;
  indexes: number[];
  /** The pictures as the build draws them, in `indexes` order. */
  urls: string[];
  watch: string;
  fail: (e: unknown) => void;
  /** Opens the numbered-PNG folder import. */
  onImportFolder: () => void;
}

/** The part's pictures: pick one to replace, remove or retext it; or take a whole official set. */
// What the picture grid sits on. The checkerboard is mid-grey, which hides grey sprites; black and white show them.
type Backdrop = "checker" | "black" | "white";
const BACKDROP: Record<Backdrop, { label: string; icon: "grid" | "moon" | "sun"; next: Backdrop }> = {
  checker: { label: "checkerboard", icon: "grid", next: "black" },
  black: { label: "black", icon: "moon", next: "white" },
  white: { label: "white", icon: "sun", next: "checker" },
};

export function NativePictures({ design, edit, layer, part, partName, role, indexes, urls, watch, fail, onImportFolder }: NativePicturesProps) {
  const n = nativeOf(design, layer);
  const id = layer.nativeDataId ?? "";
  const [chosen, setChosen] = useState<{ key: string; index: number } | null>(null);
  const [official, setOfficial] = useState(false);
  const [backdrop, setBackdrop] = useState<Backdrop>("checker");
  const key = `${id}:${part}`;
  const index = chosen?.key === key && indexes.includes(chosen.index) ? chosen.index : indexes[0] ?? 0;
  if (!n) return null;
  const custom = Object.keys(n.assets?.[role] ?? {}).length;
  const image = n.assets?.[role]?.[String(index)];
  // Digits are the font's; other drawn pictures carry a text of their own (Z, HRV 1, TL…).
  const text = role === "digits" ? null : nativeAssetText(id, n, role, index) ?? "";
  const choose = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/png";
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void readPartPicture(f).then((url) => patchNative(edit, layer, (s) => withPictures(s, role, { [index]: url }))).catch(fail);
    };
    input.click();
  };
  const restore = () => patchNative(edit, layer, (s) => { const assets = { ...s.assets }; delete assets[role]; return { assets: Object.keys(assets).length ? assets : undefined }; });
  return (
    <div className="st-wx-card" data-backdrop={backdrop === "checker" ? undefined : backdrop}>
      <div className="st-wx-head">
        <b>Pictures</b>
        <span className="st-wx-badge" data-custom={custom ? "" : undefined}>{custom ? (custom === indexes.length ? "Your PNGs" : `${custom} of ${indexes.length} yours`) : "Drawn"}</span>
        <span className="st-grow" />
        <button type="button" className="st-icon-btn" aria-label={`Backdrop: ${BACKDROP[backdrop].label}`} title={`Backdrop: ${BACKDROP[backdrop].label}`}
          onClick={() => setBackdrop(BACKDROP[backdrop].next)}><Icon name={BACKDROP[backdrop].icon} size={15} /></button>
        <button type="button" className="st-icon-btn" aria-label="Import numbered PNGs" title={`Import PNGs named ${pad(indexes[0]!)}${indexes.length > 1 ? `–${pad(indexes[indexes.length - 1]!)}` : ""}`} onClick={onImportFolder}><Icon name="folder" size={15} /></button>
        {custom ? <button type="button" className="st-icon-btn" aria-label="Back to the drawn pictures" title="Back to the drawn pictures" onClick={restore}><Icon name="refresh" size={15} /></button> : null}
      </div>
      <div className="st-wx-grid st-glyph-grid st-np-grid" role="listbox" aria-label={`${partName} pictures`}>
        {indexes.map((i, k) => {
          const label = role === "digits" ? null : nativeAssetText(id, n, role, i);
          return (
            <button key={i} type="button" role="option" aria-selected={i === index} className="st-wx-cell st-np-cell" data-custom={n.assets?.[role]?.[String(i)] ? "" : undefined}
              title={`${pad(i)}.png${label ? ` (${label})` : ""}`} onClick={() => setChosen({ key, index: i })}>
              {urls[k] ? <img src={urls[k]} alt="" draggable={false} /> : <i />}<small>{label ? `${pad(i)} · ${label}` : pad(i)}</small>
            </button>
          );
        })}
      </div>
      {text !== null && !image ? (
        <PictureText key={`${key}:${index}`} label={indexes.length > 1 ? `Text ${pad(index)}` : "Text"} value={text}
          onCommit={(v) => patchNative(edit, layer, (s) => withPictureText(s, role, index, v))} />
      ) : null}
      <div className="st-np-actions">
        <button type="button" className="chip st-chip-btn" aria-label={`Official ${partName.toLowerCase()}`} onClick={() => setOfficial(true)}><Icon name="spark" size={15} />Official</button>
        <button type="button" className="chip st-chip-btn" onClick={choose}><Icon name="image" size={15} />{image ? "Replace image" : "Use an image"}</button>
        {image ? <button type="button" className="chip st-chip-btn" onClick={() => patchNative(edit, layer, (s) => withoutPicture(s, role, index))}><Icon name="trash" size={15} />Remove image</button> : null}
      </div>
      {official ? (
        <OfficialPicker watch={watch} request={nativeOfficialRequest(id, n, role, partName)} onClose={() => setOfficial(false)}
          onPick={(set, frame) => patchNative(edit, layer, (s) => withPictures(s, role, officialPictures(indexes, set.frames, index, frame)))} />
      ) : null}
    </div>
  );
}

function PictureText({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { if (text !== null && text !== value) onCommit(text); setText(null); };
  return (
    <label className="st-num st-text"><span>{label}</span>
      <input type="text" maxLength={32} value={text ?? value} aria-label={`Picture ${label.toLowerCase()}`} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const ALIGNS = [{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }] as const;

export interface NativePartLayoutProps {
  design: Design;
  edit: Edit;
  layer: EditorLayer;
  part: Part;
  partName: string;
  role: Role | null;
  resolution: CorosWatchfaceResolutionDetails | null;
}

/** The part's box, alignment and font size, its own font, and Reset this part. */
export function NativePartLayout({ design, edit, layer, part, partName, role, resolution }: NativePartLayoutProps) {
  const n = nativeOf(design, layer);
  const id = layer.nativeDataId ?? "";
  if (!n) return null;
  const c = nativePart(id, n, part);
  const own = partHasOwnFont(n, part);
  // Text a font draws: the part's own pictures (or none) leave nothing for a font to change.
  const drawn = role ? nativeRoleDrawsText(n, role) : false;
  const set = (patch: Parameters<typeof withPart>[2]) => patchNative(edit, layer, (s) => withPart(s, part, patch));
  return <>
    <div className="st-nums">
      <NumberField label="Width" unit="px" value={Math.round(c.width)} min={4} max={800} onChange={(v) => set({ width: clampBox(v) })} />
      <NumberField label="Height" unit="px" value={Math.round(c.height)} min={4} max={800} onChange={(v) => set({ height: clampBox(v) })} />
      {role ? <NumberField label="Font size" unit="px" value={Math.round(nativeComponentFontSize(id, n, part))} min={1} max={800}
        onChange={(v) => patchNative(edit, layer, (s) => withPartFontSize(id, s, part, v))} /> : null}
    </div>
    <Segmented small label={`${partName} alignment`} value={c.align} onChange={(v) => set({ align: v })} options={ALIGNS} />
    {role && drawn ? <>
      <div className="st-row"><span>Own font</span>
        <Switch label={`${partName} own font`} checked={own}
          onChange={(v) => patchNative(edit, layer, (s) => (v ? withPart(s, part, { fontWeight: c.fontWeight }) : withoutPartFont(s, part)))} /></div>
      {own ? <>
        <FontPicker label={`${partName} font`} family={n.parts?.[part]?.fontFamily ?? ""} weight={c.fontWeight} style={c.fontStyle} sample="Aa" template={false}
          resolution={resolution} layerId={layer.id}
          onFamily={(f, weight) => patchNative(edit, layer, (s) => { const font = withPartFont(s, part, f); return weight ? { ...font, parts: { ...font.parts, [part]: { ...font.parts?.[part], fontWeight: weight } } } : font; })} />
        <div className="st-nums">
          <label className="st-select"><Select aria-label={`${partName} weight`} value={c.fontWeight} onChange={(e) => set({ fontWeight: Number(e.target.value) })}>
            {[...new Set([...WEIGHTS, c.fontWeight])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{w}</option>)}</Select><Icon name="chevD" size={14} /></label>
          <Segmented small label={`${partName} style`} value={c.fontStyle} onChange={(v) => set({ fontStyle: v })} options={[{ value: "normal", label: "Normal" }, { value: "italic", label: "Italic" }]} />
        </div>
      </> : null}
    </> : null}
    <button type="button" className="chip st-chip-btn st-np-reset" disabled={!partCustomized(n, part, role)}
      onClick={() => patchNative(edit, layer, (s) => withoutPartChanges(s, part, role))}><Icon name="undo" size={15} />Reset this part</button>
  </>;
}
