import { Check, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { WATCHFACE_TARGETS } from "../../electron/watchfaceTargets";
import type {
  CorosOfficialAsset,
  CorosOfficialAssetFrames,
  CorosOfficialAssetLibraryStatus,
  CorosOfficialAssetPage
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

export type OfficialAssetBrowserMode = "image" | "sprites" | "font";

interface OfficialAssetBrowserProps {
  api: CorosLinkApi;
  /** Firmware type of the target watch; the browser offers a model picker when unknown. */
  firmwareType?: string;
  /**
   * `font` lists digit fonts and returns every frame; `sprites` lists
   * multi-frame sets (battery states, weather…); `image` lets the user take
   * one frame from any set.
   */
  mode: OfficialAssetBrowserMode;
  /** Font mode: which glyph set the target needs. Digit fonts have 10 frames, weekday labels 7, month labels 12. */
  fontKind?: "digits" | "weekday" | "month";
  /** Preselected category chip (image/sprites modes), e.g. "weather" for a weather slot. */
  defaultCategory?: string;
  /** Preselected "Used as" font role (font mode); empty means any. */
  defaultRole?: string;
  /** Sprites mode: only sets with exactly this many frames, e.g. 41 for a weather state folder. */
  frameCount?: number;
  /** Only sets bound to this config key in their source face (e.g. weather_dark_icon_dir). */
  configKey?: string;
  title: string;
  onPick: (asset: CorosOfficialAssetFrames, frameIndex?: number) => void | Promise<void>;
  onClose: () => void;
}

const PAGE_SIZE = 36;
const POLL_MS = 1200;

function describeStatus(status: CorosOfficialAssetLibraryStatus): string {
  if (status.state === "building") {
    return status.facesTotal
      ? `Unpacking official faces… ${status.facesDone} of ${status.facesTotal}`
      : "Loading the official catalog…";
  }
  if (status.state === "error") return status.message ?? "The official asset library could not be built.";
  return "";
}

const FONT_KIND_FRAMES = { digits: 10, weekday: 7, month: 12 } as const;

/** Inner width of the detail panel's stage, used to compute the "Fit" zoom. */
const DETAIL_WIDTH = 296;
const CARD_SIZES = { s: { min: 132, peek: 34, preview: 96 }, m: { min: 168, peek: 44, preview: 124 }, l: { min: 232, peek: 64, preview: 176 } } as const;
type CardSize = keyof typeof CARD_SIZES;
const VIEW_STORAGE_KEY = "coroslink.officialAssets.view";

function readStoredView(): { size: CardSize; pixel: boolean } {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIEW_STORAGE_KEY) ?? "") as { size?: CardSize; pixel?: boolean };
    return { size: parsed.size && parsed.size in CARD_SIZES ? parsed.size : "m", pixel: parsed.pixel !== false };
  } catch {
    return { size: "m", pixel: true };
  }
}

export function OfficialAssetBrowser({
  api, firmwareType: initialFirmwareType, mode, fontKind = "digits", defaultCategory, defaultRole, frameCount: spriteFrameCount, configKey, title, onPick, onClose
}: OfficialAssetBrowserProps) {
  const [firmwareType, setFirmwareType] = useState<string>(
    () => WATCHFACE_TARGETS.find((target) => target.firmwareType === initialFirmwareType)?.firmwareType ?? WATCHFACE_TARGETS[0].firmwareType
  );
  const [status, setStatus] = useState<CorosOfficialAssetLibraryStatus | null>(null);
  const [page, setPage] = useState<CorosOfficialAssetPage | null>(null);
  const [category, setCategory] = useState(mode === "font" ? "fonts" : defaultCategory ?? "");
  const [role, setRole] = useState(mode === "font" ? (fontKind === "digits" ? defaultRole ?? "" : "date") : defaultRole ?? "");
  const [query, setQuery] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ asset: CorosOfficialAsset; frames: CorosOfficialAssetFrames } | null>(null);
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [zoom, setZoom] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [picking, setPicking] = useState<string | null>(null);
  const [tag, setTag] = useState("");
  const [frameFilter, setFrameFilter] = useState<"" | "single" | "multi">(mode === "sprites" ? "multi" : "");
  const [view, setView] = useState(readStoredView);
  const requestRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view)); } catch { /* per-viewer convenience only */ }
  }, [view]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Kick off (or resume) the per-model library and poll while it builds.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async (ensure: boolean) => {
      try {
        const next = ensure
          ? await api.ensureCorosOfficialAssetLibrary({ firmwareType })
          : await api.getCorosOfficialAssetLibraryStatus({ firmwareType });
        if (cancelled) return;
        setStatus(next);
        if (next.state === "building") timer = window.setTimeout(() => void poll(false), POLL_MS);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "The official asset library is unavailable.");
      }
    };
    setStatus(null);
    setPage(null);
    setError(null);
    void poll(true);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, firmwareType]);

  useEffect(() => {
    if (status?.state !== "ready") return;
    const request = ++requestRef.current;
    setLoading(true);
    api.listCorosOfficialAssets({
      firmwareType, category: category || undefined, role: role || undefined, query: query || undefined,
      frames: mode === "sprites" ? "multi" : frameFilter || undefined,
      frameCount: mode === "font" ? FONT_KIND_FRAMES[fontKind] : spriteFrameCount,
      configKey, tag: tag || undefined,
      page: pageNumber, pageSize: PAGE_SIZE
    }).then((next) => {
      if (request !== requestRef.current) return;
      setPage(next);
      setError(null);
    }).catch((caught) => {
      if (request !== requestRef.current) return;
      setError(caught instanceof Error ? caught.message : "Official assets could not be listed.");
    }).finally(() => { if (request === requestRef.current) setLoading(false); });
  }, [api, firmwareType, category, role, query, pageNumber, mode, fontKind, spriteFrameCount, configKey, tag, frameFilter, status?.state]);

  useEffect(() => { setPageNumber(1); }, [category, role, query, firmwareType, tag, frameFilter]);
  useEffect(() => { setSelected(null); }, [firmwareType]);
  // A purpose tag only makes sense inside the category it came from.
  useEffect(() => { setTag(""); }, [category, role]);

  /** Clicking a card opens it in the detail panel; Select is a second, explicit step. */
  async function select(asset: CorosOfficialAsset) {
    if (selected?.asset.id === asset.id) return;
    setPicking(asset.id);
    try {
      const frames = await api.readCorosOfficialAssetFrames({ firmwareType, id: asset.id });
      setSelected({ asset, frames });
      setSelectedFrame(0);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The official asset could not be loaded.");
    } finally {
      setPicking(null);
    }
  }

  async function pick(asset: CorosOfficialAsset, frameIndex?: number) {
    setPicking(asset.id);
    try {
      const frames = selected?.asset.id === asset.id ? selected.frames : await api.readCorosOfficialAssetFrames({ firmwareType, id: asset.id });
      await onPick(frames, frameIndex);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The official asset could not be imported.");
    } finally {
      setPicking(null);
    }
  }

  const pageCount = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  const building = status?.state === "building";

  // Portaled to <body> so the dialog sits above the Studio chrome (toolbar,
  // toasts) regardless of which pane opened it; the shell class carries the tokens.
  return createPortal(
    <div className="watchface-shell wf-official-assets-portal">
    <div className="wf-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="wf-modal wf-official-assets" role="dialog" aria-modal="true" aria-labelledby="wf-official-assets-title">
        <div className="wf-modal-header">
          <div>
            <h2 id="wf-official-assets-title">{title}</h2>
            <p>Artwork from the official COROS catalog, unpacked on this computer for your own faces. © COROS.</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="wf-official-assets-body">
        <aside className="wf-official-assets-side" aria-label="Filters and view options">
          <label className="wf-official-assets-field">
            <span>Watch</span>
            <select value={firmwareType} onChange={(event) => setFirmwareType(event.target.value)}>
              {WATCHFACE_TARGETS.map((target) => (
                <option key={target.firmwareType} value={target.firmwareType}>{target.label}</option>
              ))}
            </select>
          </label>

          {mode !== "font" && page && page.categories.length > 0 ? (
            <div className="wf-official-assets-group" role="group" aria-label="Category">
              <span className="wf-official-assets-group-title">Category</span>
              <button type="button" className="wf-official-assets-option" aria-pressed={category === ""} onClick={() => setCategory("")}>
                <span>All</span><small>{page.categories.reduce((sum, entry) => sum + entry.count, 0)}</small>
              </button>
              {page.categories.map((entry) => (
                <button key={entry.id} type="button" className="wf-official-assets-option" aria-pressed={category === entry.id} onClick={() => setCategory(entry.id)}>
                  <span>{entry.label}</span><small>{entry.count}</small>
                </button>
              ))}
            </div>
          ) : null}

          {category === "fonts" && (page?.roles.length ?? 0) > 1 ? (
            <div className="wf-official-assets-group" role="group" aria-label="Used as">
              <span className="wf-official-assets-group-title">Used as</span>
              <button type="button" className="wf-official-assets-option" aria-pressed={role === ""} onClick={() => setRole("")}><span>Any</span></button>
              {page?.roles.map((entry) => (
                <button key={entry.id} type="button" className="wf-official-assets-option" aria-pressed={role === entry.id} onClick={() => setRole(entry.id)}>
                  <span>{entry.label}</span><small>{entry.count}</small>
                </button>
              ))}
            </div>
          ) : null}

          {!configKey && (page?.tags.length ?? 0) > 1 ? (
            <div className="wf-official-assets-group" role="group" aria-label="Purpose">
              <span className="wf-official-assets-group-title">Purpose</span>
              <button type="button" className="wf-official-assets-option" aria-pressed={tag === ""} onClick={() => setTag("")}><span>Any</span></button>
              {page?.tags.slice(0, 12).map((entry) => (
                <button key={entry.id} type="button" className="wf-official-assets-option" aria-pressed={tag === entry.id} onClick={() => setTag(entry.id)}>
                  <span>{entry.label}</span><small>{entry.count}</small>
                </button>
              ))}
            </div>
          ) : null}

          {mode === "image" ? (
            <div className="wf-official-assets-group" role="group" aria-label="Frames">
              <span className="wf-official-assets-group-title">Frames</span>
              <div className="wf-official-assets-segmented">
                {([["", "Any"], ["single", "Single"], ["multi", "Sets"]] as const).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={frameFilter === value} onClick={() => setFrameFilter(value)}>{label}</button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="wf-official-assets-group" role="group" aria-label="View">
            <span className="wf-official-assets-group-title">View</span>
            <div className="wf-official-assets-segmented">
              {(["s", "m", "l"] as CardSize[]).map((size) => (
                <button key={size} type="button" aria-pressed={view.size === size} onClick={() => setView((current) => ({ ...current, size }))}>
                  {size === "s" ? "Small" : size === "m" ? "Medium" : "Large"}
                </button>
              ))}
            </div>
            <label className="wf-official-assets-check">
              <input type="checkbox" checked={view.pixel} onChange={(event) => setView((current) => ({ ...current, pixel: event.target.checked }))} />
              <span>Crisp pixels when zoomed</span>
            </label>
          </div>

          <button
            type="button"
            className="secondary-button wf-official-assets-refresh"
            disabled={building}
            title="Download the catalog again and rebuild the library"
            onClick={() => { setStatus(null); void api.ensureCorosOfficialAssetLibrary({ firmwareType, rebuild: true }).then(setStatus).catch(() => undefined); }}
          >
            <RefreshCw size={14} /> Refresh library
          </button>
        </aside>

        <div className="wf-official-assets-main" style={{ "--wf-official-card-min": `${CARD_SIZES[view.size].min}px`, "--wf-official-preview-h": `${CARD_SIZES[view.size].preview}px` } as CSSProperties}>
        <label className="wf-official-assets-search">
          <span className="wf-official-assets-search-field">
            <Search size={14} />
            <input type="search" value={query} placeholder="Search by face name, config key, or size like 60x80" onChange={(event) => setQuery(event.target.value)} />
          </span>
        </label>

        {status === null || building || status.state === "idle" ? (
          <div className="wf-official-assets-state" role="status">
            <Loader2 className="spin" size={18} />
            <p>{status ? describeStatus(status) : "Checking the local library…"}</p>
            {status?.facesTotal ? (
              <progress max={status.facesTotal} value={status.facesDone} aria-label="Faces unpacked" />
            ) : null}
            <small>The first visit for a watch downloads its official faces once; later visits open instantly.</small>
          </div>
        ) : status.state === "error" ? (
          <div className="wf-official-assets-state" role="alert">
            <p>{describeStatus(status)}</p>
            <button type="button" className="secondary-button" onClick={() => { setStatus(null); void api.ensureCorosOfficialAssetLibrary({ firmwareType, rebuild: true }).then(setStatus).catch(() => undefined); }}>Try again</button>
          </div>
        ) : (
          <>
            {error ? <p className="wf-official-assets-error" role="alert">{error}</p> : null}
            <p className="wf-official-assets-summary" aria-live="polite">
              {page ? `${page.total} ${mode === "font" ? (fontKind === "digits" ? "digit fonts" : `${fontKind} label sets`) : spriteFrameCount ? `${spriteFrameCount}-state sets` : page.total === 1 ? "set" : "sets"} from ${status.facesDone} official faces` : ""}
              {loading ? <Loader2 className="spin" size={12} /> : null}
              {mode === "font" ? (
                <small>
                  {fontKind === "digits"
                    ? "“Used as” is what the source face drew with the font — every set here is the digits 0–9. Weather, battery and status icons are under Add → Official."
                    : `Only ${fontKind} label sets are listed.`}
                </small>
              ) : null}
            </p>
            <div className="wf-official-assets-grid" aria-busy={loading}>
              {page?.assets.map((asset) => {
                const isSelected = selected?.asset.id === asset.id;
                const tags = asset.tags.slice(0, 2).map((entry) => entry.label);
                // Show the first frames at a legible size instead of shrinking a
                // 41-state strip into a thumbnail; the detail panel has them all.
                const peekScale = Math.min(2.4, Math.max(0.35, CARD_SIZES[view.size].peek / asset.height));
                return (
                  <article key={asset.id} className="wf-official-asset" data-selected={isSelected || undefined}>
                    <button
                      type="button"
                      className="wf-official-asset-preview"
                      data-pixel={view.pixel && peekScale >= 1 ? "true" : undefined}
                      disabled={picking !== null && picking !== asset.id}
                      aria-pressed={isSelected}
                      title={`${asset.faces.join(", ")} — click to preview`}
                      onClick={() => void select(asset)}
                      onDoubleClick={() => void pick(asset, mode === "image" ? 0 : undefined)}
                    >
                      {asset.strip.dataUrl ? (
                        <span className="wf-official-asset-peek" style={{ height: Math.round(asset.strip.height * peekScale) }}>
                          <img
                            src={asset.strip.dataUrl}
                            alt=""
                            decoding="async"
                            style={{ width: Math.round(asset.strip.width * peekScale), height: Math.round(asset.strip.height * peekScale) }}
                          />
                        </span>
                      ) : null}
                      {asset.frames > 1 ? <span className="wf-official-asset-count">{asset.frames}</span> : null}
                      {picking === asset.id ? <Loader2 className="spin" size={16} /> : null}
                    </button>
                    <div className="wf-official-asset-meta">
                      <span className="wf-official-asset-meta-row">
                        {tags.map((tag) => <em key={tag}>{tag}</em>)}
                        <strong>{asset.width}×{asset.height}</strong>
                      </span>
                      <span className="wf-official-asset-source" title={asset.faces.join(", ")}>
                        {asset.faces[0]}{asset.faceCount > 1 ? ` +${asset.faceCount - 1}` : ""}
                      </span>
                    </div>
                  </article>
                );
              })}
              {page && page.assets.length === 0 && !loading ? (
                <p className="wf-official-assets-empty">No official assets match these filters.</p>
              ) : null}
            </div>
            {pageCount > 1 ? (
              <div className="wf-official-assets-pager">
                <button type="button" className="secondary-button" disabled={pageNumber <= 1} onClick={() => setPageNumber((n) => n - 1)}><ChevronLeft size={14} /> Previous</button>
                <span>Page {pageNumber} of {pageCount}</span>
                <button type="button" className="secondary-button" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((n) => n + 1)}>Next <ChevronRight size={14} /></button>
              </div>
            ) : null}
          </>
        )}
        </div>

        {selected ? (() => {
          const { asset, frames } = selected;
          const pickFrame = mode === "image" && asset.frames > 1;
          // Fit: a single hero frame fills the stage; a frame grid scales so one strip row fits the panel.
          const hero = pickFrame || asset.frames === 1;
          const perRow = Math.min(asset.frames, Math.max(1, Math.round(asset.strip.width / (asset.width + 2))));
          const fitScale = hero
            ? Math.min(4, Math.max(0.5, Math.floor((DETAIL_WIDTH * 0.85) / Math.max(asset.width, asset.height * 0.75) * 4) / 4))
            : Math.min(4, Math.max(0.5, Math.floor((DETAIL_WIDTH / perRow) / asset.width * 4) / 4));
          const scale = zoom === 0 ? fitScale : zoom;
          const label = mode === "font" ? "Use this font" : mode === "sprites" ? "Use this set" : pickFrame ? `Use frame ${selectedFrame}` : "Use this image";
          return (
            <aside className="wf-official-assets-detail" aria-label="Selected asset">
              <div className="wf-official-assets-detail-head">
                <div>
                  <strong>{asset.width}×{asset.height}</strong>
                  <span>{asset.frames === 1 ? "1 frame" : `${asset.frames} frames`}{asset.tags.length ? ` · ${asset.tags.map((entry) => entry.label).join(", ")}` : ""}</span>
                </div>
                <button type="button" className="icon-button" aria-label="Close preview" onClick={() => setSelected(null)}><X size={14} /></button>
              </div>

              <div className="wf-official-assets-detail-stage" data-pixel={view.pixel && scale >= 1 ? "true" : undefined}>
                {hero ? (
                  <img className="wf-official-assets-detail-hero" src={frames.frames[pickFrame ? selectedFrame : 0]} alt={`Frame ${pickFrame ? selectedFrame : 0}`}
                    style={{ width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) }} />
                ) : (
                  <div className="wf-official-assets-detail-frames" role="list">
                    {frames.frames.map((frame, index) => (
                      <span key={index} role="listitem" title={`Frame ${index}`}>
                        <img src={frame} alt="" style={{ width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) }} />
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="wf-official-assets-zoom" role="group" aria-label="Zoom">
                {([0, 1, 2, 3, 4] as const).map((level) => (
                  <button key={level} type="button" aria-pressed={zoom === level} onClick={() => setZoom(level)}>{level === 0 ? "Fit" : `${level}×`}</button>
                ))}
              </div>

              {pickFrame ? (
                <div className="wf-official-assets-detail-strip" role="radiogroup" aria-label="Frame">
                  {frames.frames.map((frame, index) => (
                    <button key={index} type="button" role="radio" aria-checked={selectedFrame === index} onClick={() => setSelectedFrame(index)} title={`Frame ${index}`}>
                      <img src={frame} alt="" width={asset.width} height={asset.height} /><small>{index}</small>
                    </button>
                  ))}
                </div>
              ) : null}

              <dl className="wf-official-assets-detail-facts">
                <dt>From</dt><dd>{asset.faces.join(", ")}{asset.faceCount > asset.faces.length ? ` and ${asset.faceCount - asset.faces.length} more` : ""}</dd>
                {asset.configKeys.length ? <><dt>Config</dt><dd>{asset.configKeys.slice(0, 3).join(", ")}</dd></> : null}
                <dt>Set</dt><dd className="wf-official-assets-detail-id">{asset.id}</dd>
              </dl>

              <button type="button" className="primary-button wf-official-assets-select" disabled={picking !== null} onClick={() => void pick(asset, pickFrame ? selectedFrame : 0)}>
                {picking === asset.id ? <Loader2 className="spin" size={15} /> : <Check size={15} />} {label}
              </button>
            </aside>
          );
        })() : null}
        </div>
      </section>
    </div>
    </div>,
    document.body
  );
}

/** Adapts a picked set to the PNG sprite-folder shape the editor already imports. */
export function officialAssetToSpriteFolder(frames: CorosOfficialAssetFrames): {
  label: string;
  sprites: { name: string; relativePath: string; dataUrl: string; sizeBytes: number }[];
} {
  return {
    label: frames.label,
    sprites: frames.frames.map((dataUrl, index) => {
      const name = `${String(index).padStart(2, "0")}.png`;
      return { name, relativePath: name, dataUrl, sizeBytes: Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4) };
    })
  };
}
