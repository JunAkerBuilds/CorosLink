// Studio's font picker, from the design's "Font picker" panel: a button that shows the current font as digits, and a
// sheet under it listing every font as a sample of the digits in it. Three sources: Fonts (the template's own digits
// first, drawn from its PNGs, then the fonts on this computer), Google (Google Fonts, fetched through the main
// process and drawn in each row once its face has loaded) and, where the layer can take one, a PNG set (a folder of
// digit PNGs, or a digit set from the official COROS library).
// Each list is one listbox: arrows, Home / End and Enter work from the search field or the list, Escape closes.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Segmented, Switch } from "@/components/ui";
import type { CorosWatchfaceRasterFont, CorosWatchfaceRasterFontFolder, CorosWatchfaceResolutionDetails, CorosWatchfaceTemplateAsset } from "../../watchface/types";
import { templateFontGlyphsForLayer } from "../../watchface/engine/watchfaceSpritePreview";
import { createRasterFontFolderReplacement } from "../../watchface/engine/watchfaceRasterFolder";
import { Icon } from "../parts/StudioIcon";
import { OfficialPicker } from "../parts/StudioOfficialPicker";
import { officialFolder, officialFontRequest } from "../studioOfficial";
import { googlePreviewFamily, googleWeightFor, isGoogleFamily, listGoogleFonts, loadGoogleFamily, loadGooglePreview, searchGoogleFonts, weightLabel, weightsFromFaces } from "../studioGoogleFonts";
import { said, type GoogleFontList } from "../studio";
import { familyOf, panelOf, readArtwork, setTypo, typoOf, typographyOf, type PanelKind } from "../studioEdits";
import type { Design, EditorLayer } from "../studioFace";

type Edit = (fn: (d: Design) => Design) => void;
export type LoadAssets = (paths: string[]) => Promise<CorosWatchfaceTemplateAsset[]>;

/* ───────────── Fonts on this computer ───────────── */

const COMMON_FONTS = ["Helvetica Neue", "Avenir Next", "Avenir Next Condensed", "Futura", "Gill Sans", "DIN Alternate", "DIN Condensed", "SF Pro", "SF Pro Rounded", "SF Mono", "Menlo", "Arial", "Arial Rounded MT Bold", "Courier New", "Georgia", "Impact", "Optima", "Rockwell", "Verdana", "Inter", "Nunito"];

let localFonts: Promise<string[]> | null = null;

/** The fonts on this computer: Chromium's Local Font Access where allowed, else a short list of common faces. Asked once. */
function listLocalFonts(): Promise<string[]> {
  localFonts ??= (async () => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    let list: string[] = [];
    try { if (query) list = [...new Set((await query()).map((f) => f.family))].sort((a, b) => a.localeCompare(b)); } catch { /* not allowed: the short list */ }
    return list.length ? list : COMMON_FONTS.filter((f) => document.fonts.check(`16px "${f}"`));
  })();
  return localFonts;
}

function useLocalFonts(): string[] | null {
  const [families, setFamilies] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    void listLocalFonts().then((list) => { if (live) setFamilies(list); });
    return () => { live = false; };
  }, []);
  return families;
}

/* ───────────── The template's own digits ───────────── */

/** What a row shows for a kind of layer: digits as the watch draws them. */
export function sampleOf(kind: PanelKind): string {
  return kind === "time" ? "10:08" : kind === "date" ? "23" : kind === "ampm" ? "AM" : kind === "separator" ? ":" : "128";
}

/**
 * The template's digit PNGs for a layer, spelling `text`, masked so they take the text colour (white digits would
 * vanish on the light theme). Characters the template has no PNG for are drawn as text.
 */
function TemplateSample({ resolution, layerId, loadAssets, text }: { resolution: CorosWatchfaceResolutionDetails | null; layerId: string; loadAssets?: LoadAssets; text: string }) {
  const set = useMemo(() => (resolution ? templateFontGlyphsForLayer(resolution, layerId) : null), [resolution, layerId]);
  const cells = useMemo(() => {
    if (!set?.glyphs.length) return [];
    if (set.kind !== "digits") return [{ ch: set.glyphs[0]!.label, glyph: set.glyphs[0]! }];
    return [...text].map((ch) => ({ ch, glyph: set.glyphs.find((g) => g.label === ch) }));
  }, [set, text]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const paths = [...new Set(cells.flatMap((c) => (c.glyph ? [c.glyph.path] : [])))];
    if (!loadAssets || !paths.length) return;
    let live = true;
    loadAssets(paths).then((found) => { if (live) setUrls(Object.fromEntries(found.map((a) => [a.path, a.dataUrl]))); }).catch(() => { /* text stands in */ });
    return () => { live = false; };
  }, [cells, loadAssets]);
  if (!cells.some((c) => c.glyph && urls[c.glyph.path])) return <span className="st-fp-tpl st-fp-tpl-text">{text}</span>;
  return (
    <span className="st-fp-tpl" aria-hidden="true">
      {cells.map((c, i) => {
        const url = c.glyph ? urls[c.glyph.path] : undefined;
        return url ? <i key={i} style={{ width: `${c.glyph!.width / c.glyph!.height}em`, WebkitMaskImage: `url("${url}")`, maskImage: `url("${url}")` }} /> : <span key={i}>{c.ch}</span>;
      })}
    </span>
  );
}

/* ───────────── The list ───────────── */

interface Choice { key: string; name: string; sample: ReactNode; /** Under the name: the weights a Google family has. */ note?: string }

const ROW = 44;
const SHOWN = 6.5;

/** One listbox of choices, virtualised (a computer can have hundreds of families), driven from the keyboard by `keys`. */
function ChoiceList({ choices, selected, onPick, label, active, setActive, onKeyDown, listRef }: {
  choices: Choice[]; selected: string | null; onPick: (key: string) => void; label: string;
  active: number; setActive: (i: number) => void; onKeyDown: (e: KeyboardEvent) => void; listRef: RefObject<HTMLDivElement | null>;
}) {
  const [top, setTop] = useState(0);
  const height = Math.min(choices.length, SHOWN) * ROW;
  useEffect(() => {
    const el = listRef.current;
    if (!el || active < 0) return;
    if (active * ROW < el.scrollTop) el.scrollTop = active * ROW;
    else if ((active + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (active + 1) * ROW - el.clientHeight;
  }, [active, listRef]);
  const first = Math.max(0, Math.floor(top / ROW) - 3);
  const last = Math.min(choices.length, Math.ceil((top + height) / ROW) + 3);
  const id = (i: number) => `st-fp-${i}`;
  return (
    <div ref={listRef} className="st-fp-list" role="listbox" aria-label={label} tabIndex={0} style={{ height }}
      aria-activedescendant={active >= 0 && active < choices.length ? id(active) : undefined}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
      <div style={{ height: choices.length * ROW }}>
        {choices.slice(first, last).map((c, n) => {
          const i = first + n;
          return (
            <div key={c.key || "\u0000template"} id={id(i)} role="option" aria-selected={c.key === selected} data-active={i === active || undefined}
              className="st-fp-row" style={{ top: i * ROW }} onMouseMove={() => { if (i !== active) setActive(i); }} onClick={() => onPick(c.key)}>
              <span className="st-fp-name">{c.name}{c.note ? <small>{c.note}</small> : null}</span>
              <span className="st-fp-sample">{c.sample}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────── The picker ───────────── */

export interface FontPickerProps {
  /** The family in use; "" for the template's digits. Ignored while `raster` is set. */
  family: string;
  /** A PNG set in use instead of a font. */
  raster?: CorosWatchfaceRasterFont;
  /** Where the font comes from, under its name, when that isn't plain from the name. */
  source?: string;
  weight?: number;
  style?: string;
  sample: string;
  /** Offer the template's digits as the first choice. */
  template: boolean;
  /** What an empty family draws with, by name: the template's ("Template") or the system font. */
  empty?: string;
  resolution: CorosWatchfaceResolutionDetails | null;
  layerId: string;
  loadAssets?: LoadAssets;
  /** A font was picked. A Google family comes with the weight to draw it at when it lacks the current one. */
  onFamily: (family: string, weight?: number) => void;
  /** The PNG set pane; with it the sheet's switch gets a PNG set side. */
  png?: ReactNode;
  label: string;
}

export function FontPicker(p: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); button.current?.focus(); };
  const font = p.family ? { fontFamily: `"${p.family}"`, fontWeight: p.weight, fontStyle: p.style } : undefined;
  // An empty family draws the template's digits where the layer has them, else the system font (text, separators).
  const empty = p.empty ?? (p.template ? "Template" : "System font");
  const tpl = empty === "System font" ? <span style={{ fontFamily: "system-ui, sans-serif" }}>{p.sample}</span>
    : <TemplateSample resolution={p.resolution} layerId={p.layerId} loadAssets={p.loadAssets} text="10" />;
  const source = p.source ?? (!p.raster && isGoogleFamily(p.family) ? "Google Fonts" : undefined);
  return (
    <div className="st-fp">
      <button ref={button} type="button" className="st-pick" aria-expanded={open} aria-label={`${p.label}: ${p.raster?.label ?? (p.family || empty)}`} onClick={() => setOpen((o) => !o)}>
        <span className="st-pick-prev" style={font}>{p.raster ? <img src={p.raster.dataUrl} alt="" /> : p.family ? "10" : tpl}</span>
        <span className="st-pick-name"><b>{p.raster?.label ?? (p.family || empty)}</b>{source ? <small>{source}</small> : null}</span>
        <Icon name={open ? "chevD" : "chevR"} size={15} />
      </button>
      {open ? <FontSheet {...p} close={close} /> : null}
    </div>
  );
}

type Tab = "fonts" | "google" | "png";

function FontSheet(p: FontPickerProps & { close: () => void }) {
  const [tab, setTab] = useState<Tab>(p.raster && p.png ? "png" : isGoogleFamily(p.family) ? "google" : "fonts");
  const options: { value: Tab; label: string }[] = [{ value: "fonts", label: "Fonts" }, { value: "google", label: "Google" }, ...(p.png ? [{ value: "png" as const, label: "PNG set" }] : [])];
  return (
    <div className="st-sheet st-fp-sheet" role="dialog" aria-label={p.label} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); p.close(); } }}>
      <Segmented small label="Font source" className="st-fp-src" value={tab} onChange={setTab} options={options} />
      {tab === "fonts" ? <LocalPane {...p} /> : tab === "google" ? <GooglePane {...p} /> : p.png}
    </div>
  );
}

/** A searchable listbox of choices: the keyboard starts on the current font, a search at its first match. */
function Listing({ choices, selected, onPick, close, label, query, setQuery, search, placeholder, ready }: {
  choices: Choice[]; selected: string | null; onPick: (key: string) => void; close: () => void; label: string;
  query: string; setQuery: (q: string) => void; search: boolean; placeholder: string; ready: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ query: string; i: number } | null>(null);
  const active = cursor?.query === query ? cursor.i : query ? 0 : Math.max(0, choices.findIndex((c) => c.key === selected));
  const setActive = (i: number) => setCursor({ query, i });
  useEffect(() => { if (ready) (input.current ?? list.current)?.focus(); }, [ready]);

  const keys = (e: KeyboardEvent) => {
    const last = choices.length - 1;
    // Handled keys stop here, so the editor's own arrow keys don't also nudge the layer.
    const go = (i: number) => { e.preventDefault(); e.stopPropagation(); setActive(Math.max(0, Math.min(last, i))); };
    if (e.key === "ArrowDown") go(active + 1);
    else if (e.key === "ArrowUp") go(active - 1);
    else if (e.key === "PageDown") go(active + 6);
    else if (e.key === "PageUp") go(active - 6);
    else if ((e.key === "Home" || e.key === "End") && e.currentTarget === list.current) go(e.key === "Home" ? 0 : last);
    else if (e.key === "Enter" && choices[active]) { e.preventDefault(); e.stopPropagation(); onPick(choices[active]!.key); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };

  return <>
    {search ? (
      <label className="st-search"><Icon name="search" size={15} />
        <input ref={input} type="search" placeholder={placeholder} aria-label={`Search ${label.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={keys}
          role="combobox" aria-expanded="true" aria-autocomplete="list" aria-activedescendant={active >= 0 && choices[active] ? `st-fp-${active}` : undefined} /></label>
    ) : null}
    {!ready ? <div className="st-fp-wait" aria-busy="true" /> : choices.length ? (
      <ChoiceList choices={choices} selected={selected} onPick={onPick} label={label} active={active} setActive={setActive} onKeyDown={keys} listRef={list} />
    ) : <p className="st-note">No match.</p>}
  </>;
}

/** The template's own digits, then the fonts on this computer. */
function LocalPane(p: FontPickerProps & { close: () => void }) {
  const families = useLocalFonts();
  const [query, setQuery] = useState("");
  const choices = useMemo<Choice[]>(() => {
    const q = query.trim().toLowerCase();
    const font = (f: string) => ({ fontFamily: `"${f}"`, fontWeight: p.weight, fontStyle: p.style });
    const own: Choice[] = p.template && (!q || "template".includes(q))
      ? [{ key: "", name: "Template", sample: <TemplateSample resolution={p.resolution} layerId={p.layerId} loadAssets={p.loadAssets} text={p.sample} /> }] : [];
    return [...own, ...(families ?? []).filter((f) => !q || f.toLowerCase().includes(q)).map((f) => ({ key: f, name: f, sample: <span style={font(f)}>{p.sample}</span> }))];
  }, [families, query, p.template, p.resolution, p.layerId, p.loadAssets, p.sample, p.weight, p.style]);
  return <Listing choices={choices} selected={p.raster ? null : p.family} onPick={(f) => p.onFamily(f)} close={p.close} label="Fonts"
    query={query} setQuery={setQuery} search={!!families && families.length > 8} placeholder="Search" ready={families !== null} />;
}

/* ───────────── Google Fonts ───────────── */

/** A row's sample, drawn in the family once its preview face has loaded (it loads when the row comes on screen). */
function GoogleSample({ family, text, style }: { family: string; text: string; style?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const { done, cancel } = loadGooglePreview(family);
    void done.then((ok) => { if (live && ok) setLoaded(family); });
    return () => { live = false; cancel(); };
  }, [family]);
  const on = loaded === family;
  return <span className="st-fp-g" data-loaded={on || undefined} style={on ? { fontFamily: `"${googlePreviewFamily(family)}"`, fontStyle: style } : undefined}>{text}</span>;
}

/** Google's families: search, each row in its font with the weights it has. Picking one downloads it, then applies it. */
function GooglePane(p: FontPickerProps & { close: () => void }) {
  const [fonts, setFonts] = useState<GoogleFontList | null>(null);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listGoogleFonts().then((l) => { if (live) setFonts(l); }, (e) => { if (live) { setFonts({ families: [], source: "builtIn" }); setProblem(said(e)); } });
    return () => { live = false; };
  }, []);
  const found = useMemo(() => searchGoogleFonts(fonts?.families ?? [], query), [fonts, query]);
  const choices = useMemo<Choice[]>(() => found.map((f) => ({ key: f.family, name: f.family, note: weightLabel(f), sample: <GoogleSample family={f.family} text={p.sample} style={p.style} /> })), [found, p.sample, p.style]);

  const pick = async (name: string) => {
    const family = fonts?.families.find((f) => f.family === name);
    if (!family || picking) return;
    setPicking(name); setProblem(null);
    try {
      const { faces } = await loadGoogleFamily(name);
      p.onFamily(name, googleWeightFor(weightsFromFaces(faces), family.weights, p.weight));
    } catch (e) { setProblem(said(e)); } finally { setPicking(null); }
  };

  return <>
    <Listing choices={choices} selected={p.raster ? null : p.family} onPick={(f) => void pick(f)} close={p.close} label="Google Fonts"
      query={query} setQuery={setQuery} search placeholder="Search Google Fonts" ready={fonts !== null} />
    {picking ? <p className="st-note" role="status">Downloading {picking}…</p> : null}
    {problem ? <p className="st-note st-fp-problem" role="alert">{problem}</p>
      : fonts && fonts.source !== "google" ? <p className="st-note" role="status">Google Fonts can't be reached. {fonts.source === "saved" ? "This is the list saved on this computer" : "This is a short built-in list"}; fonts already downloaded still work.</p> : null}
  </>;
}

/* ───────────── For a layer ───────────── */

/** The source line under a layer's font name: only when the name doesn't say it. */
function layerSource(design: Design, layer: EditorLayer): string | undefined {
  const t = typoOf(design, layer);
  if (t?.rasterFont) return "PNG set";
  if (t?.fontFamily === undefined && (design.fontFamily || design.rasterFont)) return "Face font";
  return undefined;
}

export function LayerFontPicker({ design, layer, edit, resolution, loadAssets, fail, watch }: { design: Design; layer: EditorLayer; edit: Edit; resolution: CorosWatchfaceResolutionDetails | null; loadAssets?: LoadAssets; fail: (e: unknown) => void; watch: string }) {
  const kind = panelOf(layer, design);
  const t = typoOf(design, layer);
  const ty = typographyOf(design, layer);
  const raster = t?.rasterFont ?? (t?.fontFamily === undefined ? design.rasterFont : undefined);
  const canPng = kind === "time" || kind === "metric" || kind === "date" || kind === "selectable" || kind === "ampm";
  return (
    <FontPicker label="Font" family={familyOf(design, layer) ?? ""} raster={raster} source={layerSource(design, layer)} weight={ty.fontWeight} style={ty.fontStyle}
      sample={sampleOf(kind)} template={kind !== "separator" && kind !== "ampm"} empty={kind === "ampm" ? "Template" : undefined} resolution={resolution} layerId={layer.id} loadAssets={loadAssets}
      onFamily={(f, weight) => edit((x) => setTypo(x, layer, { fontFamily: f, rasterFont: undefined, ...(weight ? { fontWeight: weight } : {}) }))}
      png={canPng ? <PngPane design={design} layer={layer} edit={edit} fail={fail} watch={watch} kind={kind} /> : undefined} />
  );
}

function PngPane({ design, layer, edit, fail, watch, kind }: { design: Design; layer: EditorLayer; edit: Edit; fail: (e: unknown) => void; watch: string; kind: PanelKind }) {
  const t = typoOf(design, layer);
  const [scope, setScope] = useState<"layer" | "face">("layer");
  const [official, setOfficial] = useState(false);
  const folder = useRef<HTMLInputElement>(null);
  const raster = t?.rasterFont ?? design.rasterFont;

  /** A folder of numbered PNGs (chosen on this computer, or a set from the official library) becomes the PNG set. */
  const applyFolder = async (picked: CorosWatchfaceRasterFontFolder) => {
    const replacement = await createRasterFontFolderReplacement(picked, {
      componentKind: scope === "layer" && layer.id === "weekday" ? "weekday" : scope === "layer" && layer.id === "dateMonth" ? "month" : undefined,
      tint: raster?.tint ?? false,
      createDigitAtlas: atlasFromSprites,
      readSpriteSize: async (dataUrl) => { const img = await loadImage(dataUrl); return { width: img.naturalWidth, height: img.naturalHeight }; },
    });
    edit((x) => (scope === "face" ? { ...setTypo(x, layer, { fontFamily: "", rasterFont: undefined }), rasterFont: replacement.rasterFont } : setTypo(x, layer, { fontFamily: "", rasterFont: replacement.rasterFont })));
  };
  const importFolder = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const pngs = [...files].filter((f) => /\.png$/i.test(f.name));
      const sprites = await Promise.all(pngs.map(async (f) => ({
        name: f.name, relativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/").slice(1).join("/") || f.name,
        dataUrl: (await readArtwork(f)).dataUrl, sizeBytes: f.size,
      })));
      await applyFolder({ label: pngs[0]?.webkitRelativePath?.split("/")[0] || "PNG digits", sprites });
    } catch (e) { fail(e); }
  };

  return <>
    {raster ? <div className="st-png-now"><img src={raster.dataUrl} alt="" /><span>{raster.label}</span></div> : null}
    <div className="st-row"><span>Applies to</span><Segmented small label="PNG set applies to" value={scope} onChange={setScope} options={[{ value: "layer", label: "Layer" }, { value: "face", label: "Face" }]} /></div>
    <button type="button" className="chip st-chip-btn" onClick={() => folder.current?.click()}><Icon name="folder" size={15} />{raster ? "Choose another folder" : "Choose a folder"}</button>
    <button type="button" className="chip st-chip-btn" onClick={() => setOfficial(true)}><Icon name="spark" size={15} />Official COROS font</button>
    {official ? <OfficialPicker watch={watch} request={officialFontRequest(layer, kind, scope)} onClose={() => setOfficial(false)} onPick={(set) => applyFolder(officialFolder(set))} /> : null}
    <input ref={folder} type="file" hidden multiple accept="image/png" {...{ webkitdirectory: "" }} onChange={(e) => { void importFolder(e.target.files); e.target.value = ""; }} />
    {raster ? <div className="st-row"><span>Layer color</span><Switch label="Recolor with layer color" checked={raster.tint} onChange={(v) => edit((x) => (t?.rasterFont ? setTypo(x, layer, { rasterFont: { ...t.rasterFont, tint: v } }) : x.rasterFont ? { ...x, rasterFont: { ...x.rasterFont, tint: v } } : x))} /></div> : null}
    <span className="st-note">00.png to 09.png, up to 5 MB each.</span>
  </>;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("A PNG in the folder couldn't be opened.")); img.src = src; });
}

/** Digit PNGs side by side on one canvas, each centred in its cell (CorosLink's createAtlasFromSprites). */
async function atlasFromSprites(digits: Map<string, string>): Promise<Pick<CorosWatchfaceRasterFont, "dataUrl" | "glyphs" | "columns" | "atlasSize">> {
  const glyphs = [...digits.keys()].sort();
  if (!glyphs.length) throw new Error("Choose a folder with digit PNGs named 00.png to 09.png.");
  const images = await Promise.all(glyphs.map((g) => loadImage(digits.get(g)!)));
  const w = Math.max(...images.map((i) => i.naturalWidth)), h = Math.max(...images.map((i) => i.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = w * images.length; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  images.forEach((img, i) => ctx.drawImage(img, i * w + (w - img.naturalWidth) / 2, (h - img.naturalHeight) / 2));
  return { dataUrl: canvas.toDataURL("image/png"), glyphs: glyphs.join(""), columns: glyphs.length, atlasSize: { width: canvas.width, height: canvas.height } };
}
