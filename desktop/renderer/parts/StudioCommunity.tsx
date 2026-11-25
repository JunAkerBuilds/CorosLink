// Studio home's Community tab: reviewed faces from watchfaces.coroslink.com, from the design's StudioCommunity board.
// One toolbar: search (⌘F), order (New first by default), which watch (every watch by default), style. Active filters
// show as pills you can take off. Variants of one design open together. The list loads 12 at a time as you scroll,
// with placeholder cards while the next page comes. "Open" downloads the reviewed package, checks it and opens it as
// a project (desktop/main/watchface/community.ts).
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { WatchfaceTarget } from "../../watchface/watchfaceTargets";
import { FaceView } from "./FaceView";
import { Icon } from "./StudioIcon";
import { communityAnimation, communityPicture, communityProgress, type CommunityFace, type CommunityGroup, type CommunityProgress } from "../studio";
import { downloads, modelFor, useCommunityList } from "../studioCommunity";

type Sort = "newest" | "trending" | "downloads";
const SORTS: { value: Sort; label: string; icon: string }[] = [
  { value: "newest", label: "New", icon: "clock" }, { value: "trending", label: "Popular", icon: "spark" }, { value: "downloads", label: "Most downloaded", icon: "download" },
];
const ORDER_LINE: Record<Sort, string> = { newest: "newest first", trending: "most popular", downloads: "most downloaded" };

/** The catalog's watch names are the app's labels (PACE Pro, APEX 4…); a watch it doesn't know has no filter. */
const COMMUNITY_WATCHES = ["PACE 3", "PACE 4", "PACE 4 Pro", "PACE Pro", "APEX 2", "APEX 2 Pro", "APEX 4", "NOMAD", "VERTIX 2", "VERTIX 2S", "VERTIX 4"];
const DAY = 24 * 60 * 60 * 1000;
const isNew = (face: CommunityFace) => !!face.publishedAt && Date.now() - Date.parse(face.publishedAt) < 3 * DAY;
const isAnimated = (face: CommunityFace) => face.tags.some((t) => /anim/i.test(t));
const ago = (iso: string | null) => {
  if (!iso) return null;
  const days = (Date.now() - Date.parse(iso)) / DAY;
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.floor(days)} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

export function CommunityTab({ target, opening, onOpen }: {
  target: WatchfaceTarget; opening: string | null;
  /** `model` is the version to download; `fits` false asks first. */
  onOpen: (face: CommunityFace, model: string | undefined, fits: boolean) => void;
}) {
  const [sort, setSort] = useState<Sort>("newest");
  /** "" = every watch. */
  const [watch, setWatch] = useState("");
  const [style, setStyle] = useState("");
  const [group, setGroup] = useState<CommunityGroup | null>(null);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState(false);
  const [progress, setProgress] = useState<CommunityProgress | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const known = COMMUNITY_WATCHES.includes(target.label);
  const mine = (w: string) => w.toUpperCase() === target.label.toUpperCase();

  useEffect(() => { const t = setTimeout(() => setSearch(typed.trim()), 300); return () => clearTimeout(t); }, [typed]);
  useEffect(() => {
    if (!opening) return;
    const t = setInterval(() => { communityProgress().then(setProgress, () => {}); }, 250);
    return () => clearInterval(t);
  }, [opening]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); searchBox.current?.focus(); searchBox.current?.select(); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    addEventListener("click", close);
    addEventListener("keydown", key);
    return () => { removeEventListener("click", close); removeEventListener("keydown", key); };
  }, [menu]);

  const list = useCommunityList({ q: search || undefined, model: watch || undefined, style: style || undefined, sort, ...(group ? { group: group.slug } : { view: "designs" as const }) });
  const faces = list.page?.items ?? [];
  const styles = list.page?.facets.styles ?? [];
  const total = list.page?.pagination.total ?? 0;
  const { loadMore, hasMore, loading, error } = list;

  // Endless list: the next page loads while the end of the list is still a screen away.
  useEffect(() => {
    const el = end.current;
    if (!el || !hasMore || loading || error) return;
    const seen = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) loadMore(); }, { rootMargin: "0px 0px 900px 0px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [hasMore, loading, error, faces.length, loadMore]);
  // "Back to top" once the toolbar has scrolled away.
  useEffect(() => {
    const el = top.current;
    if (!el) return;
    const seen = new IntersectionObserver((e) => setScrolled(!e[0].isIntersecting && e[0].boundingClientRect.top < 0));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const toTop = () => top.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const watchLabel = (w: string) => (!w ? "Every watch" : mine(w) ? `Fits my ${target.label}` : w);
  const watchOptions = ["", ...(known ? [target.label] : []), ...COMMUNITY_WATCHES.filter((w) => !mine(w))];
  const styleLabel = styles.find((s) => s.value === style)?.label ?? style;
  const pills = [
    style ? { label: styleLabel, off: () => setStyle("") } : null,
    watch ? { label: watchLabel(watch), off: () => setWatch("") } : null,
    search ? { label: `“${search}”`, off: () => { setTyped(""); setSearch(""); } } : null,
  ].filter((p): p is { label: string; off: () => void } => !!p);
  const clearAll = () => { setStyle(""); setWatch(""); setTyped(""); setSearch(""); };

  const status = (face: CommunityFace) => {
    if (opening !== face.slug) return null;
    if (!progress || progress.slug !== face.slug || progress.receivedBytes === undefined) return "Getting it…";
    if (progress.stage === "verifying") return "Checking…";
    if (progress.stage === "opening") return "Opening…";
    return progress.totalBytes ? `Downloading ${Math.round((progress.receivedBytes / progress.totalBytes) * 100)}%` : "Downloading…";
  };
  const open = (face: CommunityFace) => {
    if (!group && (face.group?.variantCount ?? 0) > 1) { setGroup(face.group!); toTop(); return; }
    const { model: version, fits } = modelFor(face.models, target.label);
    onOpen(face, version, fits);
  };
  const meta = (face: CommunityFace) => [
    `by ${face.creatorHandle || face.creatorName}`,
    sort === "newest" ? ago(face.publishedAt) : face.downloadCount !== undefined ? `${downloads(face.downloadCount)} downloads` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="st-tab stc">
      <div ref={top} className="stc-top" aria-hidden="true" />
      {group ? (
        <div className="st-filter-row">
          <button type="button" className="st-back" onClick={() => setGroup(null)}><Icon name="chevL" size={16} />Community</button>
          <b className="st-group-name">{group.name}</b><span className="st-hint">{group.variantCount} variants</span>
        </div>
      ) : null}

      <section className="stc-tools" aria-label="Find community faces">
        <div className="stc-row">
          <label className="st-search stc-search"><Icon name="search" size={17} />
            <input ref={searchBox} type="search" aria-label="Search community faces" placeholder="Search faces, creators or watches"
              value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && typed) { e.stopPropagation(); setTyped(""); } }} />
            {typed ? <button type="button" className="stc-clear" aria-label="Clear search" onClick={() => { setTyped(""); searchBox.current?.focus(); }}><Icon name="close" size={15} /></button>
              : <kbd className="stc-kbd">⌘F</kbd>}
          </label>
          <div role="group" aria-label="Order" className="seg stc-sort">
            {SORTS.map((s) => <button key={s.value} type="button" aria-pressed={sort === s.value} onClick={() => setSort(s.value)}><Icon name={s.icon} size={15} />{s.label}</button>)}
          </div>
          <div className="stc-menu-wrap">
            <button type="button" className="chip stc-watch" aria-haspopup="listbox" aria-expanded={menu} aria-pressed={!!watch}
              onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>
              <Icon name="watch" size={16} />{watchLabel(watch)}<Icon name="chevD" size={15} />
            </button>
            {menu ? (
              <div className="st-menu st-menu-down stc-menu pop" role="listbox" aria-label="Watch">
                {watchOptions.map((w) => (
                  <button key={w || "all"} type="button" role="option" aria-selected={watch === w} onClick={() => setWatch(w)}>
                    <span>{watchLabel(w)}</span>{watch === w ? <Icon name="check" size={15} width={2.4} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {styles.length ? (
          <div role="group" aria-label="Style" className="stc-chips">
            <button type="button" className="chip" aria-pressed={!style} onClick={() => setStyle("")}>All</button>
            {styles.map((s) => <button key={s.value} type="button" className="chip" aria-pressed={style === s.value} onClick={() => setStyle(style === s.value ? "" : s.value)}>{s.label}</button>)}
          </div>
        ) : null}
        <div className="stc-line">
          {list.page ? <b aria-live="polite">{total.toLocaleString()} {total === 1 ? "face" : "faces"}</b> : null}
          {list.page ? <span>· {ORDER_LINE[list.sort as Sort] ?? ORDER_LINE.newest}</span> : null}
          {pills.map((p) => <button key={p.label} type="button" className="stc-pill" aria-label={`Remove filter ${p.label}`} onClick={p.off}>{p.label}<Icon name="close" size={13} width={2.2} /></button>)}
          {pills.length ? <button type="button" className="stc-clear-all" onClick={clearAll}>Clear all</button> : null}
          <span className="st-grow" />
          <span className="stc-checked"><Icon name="check" size={14} width={2.4} />Every face is reviewed before it&apos;s listed</span>
        </div>
      </section>

      {list.sort !== sort && sort !== "newest" && faces.length ? <p className="st-hint">The catalog can&apos;t sort that way yet; newest first.</p> : null}

      <div className="st-grid">
        {faces.map((face) => {
          const variants = !group && (face.group?.variantCount ?? 0) > 1 ? face.group!.variantCount : 0;
          const busy = status(face);
          const fresh = isNew(face);
          const notListed = !watch && known && !face.models.some(mine);
          const animated = isAnimated(face);
          return (
            <article key={face.id} className="st-card stc-card">
              <button type="button" className="st-stage" disabled={!!opening} onClick={() => open(face)} aria-label={variants ? `${variants} variants of ${face.title}` : `Open ${face.title}`}>
                {animated ? <AnimatedFace face={face} /> : <FaceView src={communityPicture(face)} size={140} label={face.title} />}
                {animated ? <span className="stc-ribbon">Animated</span> : null}
                {fresh ? <span className={`stc-badges${animated ? " stc-badges-after" : ""}`}><span className="stc-badge stc-new">New</span></span> : null}
                {variants ? <span className="st-badge st-badge-right"><Icon name="layers" size={12} />{variants}</span> : null}
                {notListed ? <span className="stc-unlisted"><Icon name="warn" size={12} width={2.2} />Not listed for {target.label}</span> : null}
              </button>
              <div className="st-card-foot">
                <div className="st-card-text">
                  <h3>{face.title}</h3>
                  <span>{busy ?? meta(face)}</span>
                </div>
                <button type="button" className="st-pill" disabled={!!opening} onClick={() => open(face)}>{variants ? "View" : "Open"}</button>
              </div>
            </article>
          );
        })}
        {loading ? Array.from({ length: faces.length ? 6 : 12 }, (_, i) => (
          <div key={`sk${i}`} className="st-card stc-skel" aria-hidden="true">
            <div className="st-stage"><span className="stc-sk stc-sk-face" /></div>
            <div className="st-card-foot"><div className="stc-sk-lines"><span className="stc-sk" /><span className="stc-sk" /></div><span className="stc-sk stc-sk-pill" /></div>
          </div>
        )) : null}
      </div>

      {error ? <div className="notice" role="alert">{error} <Button onClick={loadMore}>Try again</Button></div> : null}
      {!loading && !error && list.page && !faces.length ? (
        <div className="st-empty"><Icon name="search" size={24} /><b>No faces match {search ? `“${search}”` : "these filters"}</b>
          <span>Try another word, or a different watch or style.</span>
          <div className="stc-empty-actions">
            {watch ? <Button onClick={() => setWatch("")}>Show every watch</Button> : null}
            {pills.length ? <Button onClick={clearAll}>Clear filters</Button> : null}
          </div>
        </div>
      ) : null}

      <div ref={end} className="stc-end" aria-live="polite">
        {loading && faces.length ? <><span className="stc-spin" />Loading more faces…</> : null}
        {!loading && !error && hasMore && faces.length ? <span className="stc-faint">Showing {faces.length} of {total.toLocaleString()} · more load as you scroll</span> : null}
        {!loading && !error && !hasMore && faces.length > 12 ? (
          <span className="stc-done"><i />That&apos;s all {total.toLocaleString()} faces<i />
            <Button onClick={toTop}><Icon name="arrowUp" size={14} />Back to top</Button></span>
        ) : null}
      </div>

      {scrolled ? (
        <button type="button" className="stc-to-top pop" onClick={toTop} aria-label="Back to top">
          <Icon name="arrowUp" size={15} />{faces.length} of {total.toLocaleString()}
        </button>
      ) : null}
    </div>
  );
}

/** One download per face per session, kept as a Blob so each play can start from its first frame. */
const animations = new Map<string, Promise<Blob | null>>();
const loadAnimation = (face: CommunityFace) => {
  let p = animations.get(face.id);
  if (!p) {
    p = fetch(communityAnimation(face)).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
    animations.set(face.id, p);
  }
  return p;
};
const PLAY_MS = 3200;

/**
 * An animated face, the way the website plays it: its animated WebP laid over the still. It loads once the card nears
 * the screen, plays a few seconds when it first shows, then rests on the still; hovering the card plays it again.
 * Nothing moves for someone who prefers reduced motion.
 */
function AnimatedFace({ face }: { face: CommunityFace }) {
  const box = useRef<HTMLSpanElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const seen = new IntersectionObserver((e) => {
      if (!e.some((x) => x.isIntersecting)) return;
      seen.disconnect();
      void loadAnimation(face).then((b) => { if (!cancelled && b) setBlob(b); });
    }, { rootMargin: "200px" });
    seen.observe(el);
    return () => { cancelled = true; seen.disconnect(); };
  }, [face]);

  useEffect(() => {
    const card = box.current?.closest(".st-card");
    if (!blob || !card) return;
    let current: string | null = null, rest = 0;
    // A fresh object URL each time, so the animation starts again from its first frame.
    const play = (ms?: number) => {
      clearTimeout(rest);
      if (!current) { current = URL.createObjectURL(blob); setUrl(current); setShown(false); }
      if (ms) rest = window.setTimeout(stop, ms);
    };
    const stop = () => {
      clearTimeout(rest);
      setShown(false);
      const old = current;
      current = null;
      // After the fade back to the still.
      window.setTimeout(() => { if (old) { URL.revokeObjectURL(old); setUrl((u) => (u === old ? null : u)); } }, 300);
    };
    const enter = () => play();
    const leave = () => { if (current) rest = window.setTimeout(stop, 600); };
    play(PLAY_MS);
    card.addEventListener("mouseenter", enter);
    card.addEventListener("mouseleave", leave);
    return () => {
      card.removeEventListener("mouseenter", enter);
      card.removeEventListener("mouseleave", leave);
      clearTimeout(rest);
      if (current) URL.revokeObjectURL(current);
    };
  }, [blob]);

  return (
    <span ref={box} className="stc-anim-box">
      <FaceView src={communityPicture(face)} size={140} label={face.title}
        over={url ? <img className="st-face-img stc-anim" data-shown={shown ? "" : undefined} src={url} alt="" draggable={false} onLoad={() => setShown(true)} /> : null} />
    </span>
  );
}

/** "Compatibility not listed": a face that doesn't name the chosen watch opens only when asked (CorosLink's rule). */
export function FitsDialog({ face, watch, onCancel, onOpen }: { face: CommunityFace; watch: string; onCancel: () => void; onOpen: () => void }) {
  return (
    <div className="st-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="st-dialog st-small-dialog pop" role="dialog" aria-modal="true" aria-labelledby="st-fits-title">
        <div className="st-dialog-head"><h2 id="st-fits-title">Not listed for {watch}</h2></div>
        <div className="st-dialog-stack">
          <p className="st-note">“{face.title}” is made for {face.models.join(", ")}. It opens in Studio, but may not fit your {watch}.</p>
          <div className="st-dialog-actions"><Button onClick={onCancel}>Cancel</Button><Button variant="primary" onClick={onOpen}>Open anyway</Button></div>
        </div>
      </div>
    </div>
  );
}
