// The official COROS library's browser (desktop/main/watchface/officialAssets.ts), in the Studio look: filters on the
// left (watch, category, "Used as", purpose, frames), the sets in the middle a page at a time, and the picked set on
// the right with its frames to step through. Rewritten from CorosLink's OfficialAssetBrowser.tsx. Opened from Add →
// Official, a template image's "Official library", the PNG set's "Official COROS font", the battery icon's "Official
// sprites" and the weather icon's sets (studioOfficial.ts says what each asks for). Loaded only when first opened.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Segmented, Select } from "@/components/ui";
import { language, locale, t } from "@/lib/i18n";
import { WATCHFACE_TARGETS, getWatchfaceTarget } from "../../watchface/watchfaceTargets";
import { Icon } from "./StudioIcon";
import { listOfficial, officialSet, officialStatus, officialStrip, refreshOfficial, said, type OfficialAsset, type OfficialFrames, type OfficialPage, type OfficialStatus } from "../studio";
import { officialQuery, type OfficialRequest } from "../studioOfficial";
import "./studioOfficial.css";

export interface OfficialBrowserProps {
  /** The face's watch; the browser opens on its library. */
  watch: string;
  request: OfficialRequest;
  /** The picked set, and for an image the frame taken from it. The browser closes once this is done. */
  onPick: (set: OfficialFrames, frame: number) => void | Promise<void>;
  onClose: () => void;
}

interface Filters { category: string; role: string; tag: string; frames: "" | "single" | "multi"; frameCount: number; q: string; page: number }

const PAGE = 36;
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

function progressText(s: OfficialStatus): string {
  if (s.unit === "faces") return s.total ? t("Unpacking COROS's official faces: {done} of {total}", { done: s.done, total: s.total }) : t("Asking COROS for its official faces…");
  return s.total ? t("Downloading the library: {done} of {total} MB", { done: mb(s.done), total: mb(s.total) }) : t("Downloading the library…");
}

export default function OfficialBrowser({ watch: faceWatch, request, onPick, onClose }: OfficialBrowserProps) {
  const fixed = officialQuery(request);
  const [watch, setWatch] = useState<string>(() => getWatchfaceTarget(faceWatch)?.model ?? WATCHFACE_TARGETS[0].model);
  const [status, setStatus] = useState<OfficialStatus | null>(null);
  const [page, setPage] = useState<OfficialPage | null>(null);
  const [f, setF] = useState<Filters>({ category: fixed.category ?? "", role: fixed.role ?? "", tag: "", frames: "", frameCount: 0, q: "", page: 1 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ asset: OfficialAsset; set: OfficialFrames | null } | null>(null);
  const [frame, setFrame] = useState(0);
  const [using, setUsing] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const asked = useRef(0);
  /** A filter change goes back to the first page; a category or role change clears the purpose under it. */
  const filter = (patch: Partial<Filters>) => setF((x) => ({ ...x, page: 1, ...("category" in patch || "role" in patch ? { tag: "" } : {}), ...patch }));

  useEffect(() => { closeButton.current?.focus(); }, []);

  // The library for the watch: the first visit downloads it, and this asks again until it's here.
  useEffect(() => {
    let live = true, timer = 0;
    const ask = async () => {
      try {
        const next = await officialStatus(watch);
        if (!live) return;
        setStatus(next);
        if (next.state === "loading") timer = window.setTimeout(() => void ask(), 600);
      } catch (e) { if (live) setStatus({ watch, state: "error", done: 0, total: 0, unit: "bytes", faceCount: 0, assetCount: 0, message: said(e) }); }
    };
    void ask();
    return () => { live = false; clearTimeout(timer); };
  }, [watch]);

  const ready = status?.state === "ready" && status.watch === getWatchfaceTarget(watch)?.firmwareType;
  const fetchedAt = status?.fetchedAt;
  useEffect(() => {
    if (!ready) return;
    const mine = ++asked.current;
    const timer = window.setTimeout(() => {
      setBusy(true);
      listOfficial(watch, {
        ...fixed, category: request.mode === "font" ? "fonts" : f.category || undefined, role: f.role || undefined, tag: f.tag || undefined,
        frames: request.mode === "sprites" ? "multi" : f.frames || undefined, frameCount: fixed.frameCount ?? (f.frameCount || undefined),
        q: f.q || undefined, page: f.page, pageSize: PAGE,
      }).then((next) => { if (mine === asked.current) { setPage(next); setProblem(null); } })
        .catch((e) => { if (mine === asked.current) setProblem(said(e)); })
        .finally(() => { if (mine === asked.current) setBusy(false); });
    }, f.q ? 180 : 0);
    return () => clearTimeout(timer);
    // `fixed` is made from `request`, which doesn't change while the browser is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fetchedAt, watch, f]);

  const changeWatch = (model: string) => { setWatch(model); setStatus(null); setPage(null); setPicked(null); setProblem(null); filter({}); };
  const refresh = () => { setStatus(null); setPage(null); void refreshOfficial(watch).then(setStatus).catch((e) => setProblem(said(e))); };

  /** A card opens in the preview; using it is a second, explicit step. */
  const open = async (asset: OfficialAsset) => {
    if (picked?.asset.id === asset.id) return;
    setPicked({ asset, set: null }); setFrame(0); setProblem(null);
    try {
      const set = await officialSet(watch, asset.id);
      setPicked((now) => (now?.asset.id === asset.id ? { asset, set } : now));
    } catch (e) { setProblem(said(e)); setPicked((now) => (now?.asset.id === asset.id ? null : now)); }
  };
  const use = async () => {
    if (!picked?.set || using) return;
    setUsing(true);
    try { await onPick(picked.set, request.mode === "image" ? frame : 0); onClose(); } catch (e) { setProblem(said(e)); setUsing(false); }
  };
  const count = picked?.set?.frames.length ?? picked?.asset.frames ?? 1;
  const step = (by: number) => setFrame((i) => (i + by + count) % count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if ((e.target as HTMLElement).closest("input, select")) return;
      // The editor behind must not nudge its layer with these.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); if (count > 1) setFrame((i) => (i + (e.key === "ArrowLeft" ? -1 : 1) + count) % count); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Delete" || e.key === "Backspace") e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, count]);

  const pages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  const group = (title: string, children: ReactNode) => <div className="st-off-group" role="group" aria-label={title}><h3>{title}</h3>{children}</div>;
  const option = (key: string, label: string, on: boolean, pick: () => void, n?: number) => (
    <button key={key} type="button" className="st-off-option" aria-pressed={on} onClick={pick}><span>{label}</span>{n !== undefined ? <small>{n}</small> : null}</button>
  );
  const what = request.mode === "font" ? t("Use this font") : request.mode === "sprites" ? t("Use this set") : count > 1 ? t("Use frame {n}", { n: frame + 1 }) : t("Use this image");

  return (
    <div className="st-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-dialog st-off" role="dialog" aria-modal="true" aria-label={request.title}>
        <div className="st-dialog-head">
          <h2>{request.title}</h2>
          <span className="st-off-credit">{t("Artwork © COROS")}</span>
          <span className="st-grow" />
          <button ref={closeButton} type="button" className="st-icon-btn" aria-label={t("Close")} onClick={onClose}><Icon name="close" /></button>
        </div>

        <div className="st-off-body">
          <aside className="st-off-side" aria-label={t("Filters")}>
            <label className="st-select st-select-wide"><span>{t("Watch")}</span>
              <Select aria-label={t("Watch")} value={watch} onChange={(e) => changeWatch(e.target.value)}>
                {WATCHFACE_TARGETS.map((w) => <option key={w.model} value={w.model}>{w.label}</option>)}
              </Select><Icon name="chevD" size={14} /></label>

            {request.mode !== "font" && page?.categories.length ? group(t("Category"), <>
              {option("", t("All"), !f.category, () => filter({ category: "", role: "" }), page.categories.reduce((sum, c) => sum + c.count, 0))}
              {page.categories.map((c) => option(c.id, c.label, f.category === c.id, () => filter({ category: c.id, role: "" }), c.count))}
            </>) : null}

            {(request.mode === "font" || f.category === "fonts") && (page?.roles.length ?? 0) > 1 ? group(t("Used as"), <>
              {option("", t("Any"), !f.role, () => filter({ role: "" }))}
              {page!.roles.map((r) => option(r.id, r.label, f.role === r.id, () => filter({ role: r.id }), r.count))}
            </>) : null}

            {!fixed.configKey && (page?.tags.length ?? 0) > 1 ? group(t("Purpose"), <>
              {option("", t("Any"), !f.tag, () => filter({ tag: "" }))}
              {page!.tags.slice(0, 12).map((tag) => option(tag.id, tag.label, f.tag === tag.id, () => filter({ tag: tag.id }), tag.count))}
            </>) : null}

            {!fixed.frameCount ? group(t("Frames"), <>
              {request.mode === "image" ? (
                <Segmented small label={t("Single pictures or sets")} value={f.frames} onChange={(v) => filter({ frames: v, frameCount: 0 })}
                  options={[{ value: "", label: t("Any") }, { value: "single", label: t("Single") }, { value: "multi", label: t("Sets") }]} />
              ) : null}
              {f.frames !== "single" && page?.frameCounts.length ? (
                <div className="st-chips">
                  {page.frameCounts.map((c) => <button key={c.frames} type="button" className="chip" aria-pressed={f.frameCount === c.frames} title={t("{count} sets with {frames} frames", { count: c.count, frames: c.frames })}
                    onClick={() => filter({ frameCount: f.frameCount === c.frames ? 0 : c.frames })}>{c.frames}</button>)}
                </div>
              ) : null}
            </>) : null}

            <span className="st-grow" />
            <button type="button" className="chip st-chip-btn" disabled={status?.state === "loading"} title={t("Download this watch's library again")} onClick={refresh}><Icon name="refresh" size={15} />{t("Refresh library")}</button>
          </aside>

          <section className="st-off-main" aria-label={t("Official artwork")}>
            <label className="st-search"><Icon name="search" size={15} />
              <input type="search" aria-label={t("Search official artwork")} placeholder={t("Face name, config key, or a size like 60x80")} value={f.q} onChange={(e) => filter({ q: e.target.value })} /></label>

            {!status || status.state === "loading" || status.state === "idle" ? (
              <div className="st-off-state" role="status">
                <p>{status ? progressText(status) : t("Opening the library…")}</p>
                <progress aria-label={t("Library download")} {...(status?.total ? { max: status.total, value: status.done } : {})} />
                <small>{t("The first visit for a watch downloads its library once.")}</small>
              </div>
            ) : status.state === "error" ? (
              <div className="st-off-state" role="alert">
                <p>{status.message ?? t("The official library couldn't be loaded.")}</p>
                <Button onClick={refresh}>{t("Try again")}</Button>
              </div>
            ) : <>
              {problem ? <div className="notice" role="alert">{problem}</div> : null}
              {status.message ? <div className="notice" role="status">{status.message} {t("Showing the library saved on this computer.")}</div> : null}
              <p className="st-off-count" aria-live="polite">{page ? (page.total === 1 ? t("1 set from {faces} official faces", { faces: status.faceCount }) : t("{n} sets from {faces} official faces", { n: page.total.toLocaleString(language() === "en" ? undefined : locale()), faces: status.faceCount })) : " "}</p>
              <div className="st-off-grid" aria-busy={busy}>
                {page?.assets.map((a) => {
                  const k = Math.min(2.4, Math.max(0.35, 44 / a.height));
                  return (
                    <button key={a.id} type="button" className="st-off-card" aria-pressed={picked?.asset.id === a.id} title={a.faces.join(", ")}
                      onClick={() => void open(a)} onDoubleClick={() => { if (picked?.asset.id === a.id) void use(); }}>
                      <span className="st-off-peek" data-crisp={k >= 1 || undefined}>
                        <img src={officialStrip(watch, a.id)} alt="" loading="lazy" decoding="async" width={Math.round(a.strip.width * k)} height={Math.round(a.strip.height * k)} />
                        {a.frames > 1 ? <i>{a.frames}</i> : null}
                      </span>
                      <span className="st-off-meta"><b>{a.tags[0]?.label ?? `${a.width} × ${a.height}`}</b><small>{a.faces[0]}{a.faceCount > 1 ? ` +${a.faceCount - 1}` : ""}</small></span>
                    </button>
                  );
                })}
                {page && !page.assets.length && !busy ? <p className="st-hint">{t("Nothing matches these filters.")}</p> : null}
              </div>
              {pages > 1 ? (
                <div className="st-off-pager">
                  <button type="button" className="st-icon-btn" aria-label={t("Previous page")} disabled={f.page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))}><Icon name="chevL" /></button>
                  <span>{t("Page {n} of {total}", { n: page?.page ?? f.page, total: pages })}</span>
                  <button type="button" className="st-icon-btn" aria-label={t("Next page")} disabled={f.page >= pages} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))}><Icon name="chevR" /></button>
                </div>
              ) : null}
            </>}
          </section>

          {picked ? (
            <aside className="st-off-detail" aria-label={t("Preview")}>
              <div className="st-off-stage">
                {picked.set ? <img src={picked.set.frames[Math.min(frame, picked.set.frames.length - 1)]} alt={t("Frame {n} of {total}", { n: frame + 1, total: count })}
                  style={{ width: picked.asset.width * stageScale(picked.asset), height: picked.asset.height * stageScale(picked.asset) }} data-crisp={stageScale(picked.asset) >= 1 || undefined} /> : <span className="st-off-wait" aria-busy="true" />}
              </div>
              {count > 1 ? <>
                <div className="st-off-step" role="group" aria-label={t("Frame")}>
                  <button type="button" className="st-icon-btn" aria-label={t("Previous frame")} title={t("Previous frame (←)")} onClick={() => step(-1)}><Icon name="chevL" /></button>
                  <span>{t("Frame {n} of {total}", { n: frame + 1, total: count })}</span>
                  <button type="button" className="st-icon-btn" aria-label={t("Next frame")} title={t("Next frame (→)")} onClick={() => step(1)}><Icon name="chevR" /></button>
                </div>
                {picked.set ? (
                  <div className="st-off-frames" role="listbox" aria-label={t("Frames")}>
                    {picked.set.frames.map((src, i) => <button key={i} type="button" role="option" aria-selected={i === frame} aria-label={t("Frame {n}", { n: i + 1 })} onClick={() => setFrame(i)}><img src={src} alt="" /></button>)}
                  </div>
                ) : null}
              </> : null}
              <dl className="st-off-facts">
                <dt>{t("Size")}</dt><dd>{picked.asset.width} × {picked.asset.height}{count > 1 ? ` · ${t("{n} frames", { n: count })}` : ""}</dd>
                <dt>{t("From")}</dt><dd>{picked.asset.faceCount > picked.asset.faces.length ? t("{names} and {n} more", { names: picked.asset.faces.join(", "), n: picked.asset.faceCount - picked.asset.faces.length }) : picked.asset.faces.join(", ")}</dd>
                {picked.asset.tags.length ? <><dt>{t("Used as")}</dt><dd>{picked.asset.tags.map((tag) => tag.label).join(", ")}</dd></> : null}
                {picked.asset.configKeys.length ? <><dt>{t("Config")}</dt><dd className="st-off-keys">{picked.asset.configKeys.slice(0, 3).join(", ")}</dd></> : null}
              </dl>
              <Button variant="primary" className="st-wide" disabled={!picked.set || using} onClick={() => void use()}><Icon name="check" size={16} width={2.4} />{using ? t("Adding…") : what}</Button>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** How much the preview enlarges a frame: whole steps up to 4× for small artwork, shrunk to fit for big. */
function stageScale(a: { width: number; height: number }): number {
  const fit = Math.min(232 / a.width, 200 / a.height);
  return fit >= 1 ? Math.min(4, Math.floor(fit)) : fit;
}
