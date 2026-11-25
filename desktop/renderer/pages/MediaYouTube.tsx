// Media → YouTube: YouTube itself, right in the tab, with its audio downloaded into the Library as MP3s (a video, a
// playlist's videos, or a playlist joined into one MP3). The main process lays YouTube (its own sandboxed view and
// session, desktop/main/media/youtube.ts) over a slot this page keeps for it, and the page says where that slot is.
import { useEffect, useRef, useState } from "react";
import { Button, Card, Field } from "@/components/ui";
import {
  combineYouTube, downloadYouTube, MediaProblem, openYouTubeBrowser, placeYouTubeBrowser, readDownloads,
  addressFor, readYouTube, resetYouTubeBrowser, steerYouTubeBrowser, takeFromYouTubeBrowser, youTubeListing,
  type YouTubeBrowser, type YouTubeItem, type YouTubeListing,
} from "../media";
import { clock } from "../mediaRows";
import { Combined, DownloadsCard, JobState, NeedsYtDlp, useDownloads, useTools } from "./MediaSources";

const said = (e: unknown) => (e instanceof MediaProblem || e instanceof Error ? e.message : "That didn't work.");
const ROW = 44, VIEW = 12;
/** Something drawn over the page (⌘K, a dialog): YouTube sits on top of the page, so it steps aside for these. */
const OVERLAY = 'dialog[open], [role="dialog"], [aria-modal="true"]';

/**
 * Keeps YouTube laid over the returned element while `on`: its place is sent whenever it moves (layout, scrolling,
 * resizing), it's hidden while something is drawn over the page, and when this page goes away.
 */
function useSlot(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    let frame = 0, last = "";
    const send = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
      const rect = document.hidden || document.querySelector(OVERLAY) || bottom - top < 40 ? null : { x: r.left, y: top, width: r.width, height: bottom - top };
      const now = JSON.stringify(rect);
      if (now === last) return;
      last = now;
      void placeYouTubeBrowser(rect).catch(() => {});
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(send); };
    const sizes = new ResizeObserver(later);
    sizes.observe(el);
    sizes.observe(document.body);
    window.addEventListener("scroll", later, true);
    window.addEventListener("resize", later);
    document.addEventListener("visibilitychange", later);
    // Cards above it growing, and overlays opening, move nothing this hears about: look a few times a second (only
    // while the window is showing).
    const timer = setInterval(() => { if (!document.hidden) later(); }, 250);
    later();
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      clearInterval(timer);
      window.removeEventListener("scroll", later, true);
      window.removeEventListener("resize", later);
      document.removeEventListener("visibilitychange", later);
      void placeYouTubeBrowser(null).catch(() => {});
    };
  }, [on]);
  return ref;
}

const videoOf = (url: string) => { try { return new URL(url).searchParams.get("v"); } catch { return null; } };

export default function MediaYouTube() {
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<YouTubeListing | null>(null);
  const [browser, setBrowser] = useState<YouTubeBrowser | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobs, setJobs] = useDownloads();
  const tools = useTools();
  const slot = useSlot(!!browser);

  // The tab is YouTube: it opens as soon as the tab does, where it was last. (Out of sight for a while, the main
  // process closes it; showing the tab again opens it again.)
  const browsing = !!browser;
  useEffect(() => {
    if (browsing) return;
    let live = true;
    void readYouTube().then(async (y) => {
      if (!live) return;
      const b = y.browser ?? (await openYouTubeBrowser()).browser;
      if (live) setBrowser(b);
    }, (e) => setProblem(said(e)));
    return () => { live = false; };
  }, [browsing]);

  // Follow where YouTube is.
  useEffect(() => {
    if (!browsing) return;
    const timer = setInterval(() => { if (!document.hidden) void readYouTube().then((y) => setBrowser(y.browser), () => {}); }, 1000);
    return () => clearInterval(timer);
  }, [browsing]);

  // While anything downloads, the listing's states follow along.
  const active = jobs.some((j) => j.state === "waiting" || j.state === "working");
  const key = listing?.key;
  useEffect(() => {
    if (!key || !active) return;
    const timer = setInterval(() => void youTubeListing(key).then((r) => { if (r.listing) setListing(r.listing); }, () => {}), 1000);
    return () => clearInterval(timer);
  }, [key, active]);

  // A playlist taken from YouTube shows below it: bring it into view.
  const jump = useRef(false);
  useEffect(() => {
    if (!key || !jump.current) return;
    jump.current = false;
    document.querySelector(".yt-listing")?.scrollIntoView({ block: "start" });
  }, [key]);

  const steer = (work: () => Promise<{ browser: YouTubeBrowser | null }>) => {
    setProblem(null);
    void work().then((r) => setBrowser(r.browser), (e) => setProblem(said(e)));
  };
  const go = (text: string) => { if (text.trim()) steer(() => openYouTubeBrowser(addressFor(text))); };
  const refresh = async (k: string) => { const r = await youTubeListing(k); if (r.listing) setListing(r.listing); };
  const queued = (work: Promise<{ queued: number }>, k = key) => {
    setProblem(null);
    void work.then(async () => {
      setJobs((await readDownloads()).jobs);
      if (k) await refresh(k);
    }, (e) => setProblem(said(e)));
  };
  /** Reads what YouTube shows; a video is downloaded straight away, a playlist is listed below. */
  const take = () => {
    if (!browser) return;
    const kind = browser.kind;
    setBusy("take"); setProblem(null);
    void takeFromYouTubeBrowser().then((r) => {
      setBusy(null);
      setListing(r.listing);
      if (kind === "video") queued(downloadYouTube(r.listing.key), r.listing.key);
      else jump.current = true;
    }, (e) => { setProblem(said(e)); setBusy(null); });
  };

  const canDownload = !!tools?.ytDlp;
  // The video YouTube shows, as last read: whether it's downloading or in the library.
  const video = browser?.kind === "video" ? videoOf(browser.url) : null;
  const shown = video && listing?.kind === "video" && listing.items[0]?.id === video ? listing.items[0] : null;
  const job = video ? [...jobs].reverse().find((j) => j.origin === `yt:${video}`) : undefined;
  const videoState = shown?.inLibrary || job?.state === "done" ? "In library"
    : job?.state === "working" ? (job.progress != null ? `Downloading ${Math.round(job.progress * 100)}%` : "Downloading…")
    : job?.state === "waiting" ? "Waiting" : null;

  return (<>
    <Card pad className="yt-browser" aria-label="YouTube">
      <span className="yt-nav">
        <button type="button" className="yt-icon" aria-label="Back" disabled={!browser?.canBack} onClick={() => steer(() => steerYouTubeBrowser("back"))}>‹</button>
        <button type="button" className="yt-icon" aria-label="Forward" disabled={!browser?.canForward} onClick={() => steer(() => steerYouTubeBrowser("forward"))}>›</button>
        <button type="button" className="yt-icon" aria-label="Reload" disabled={!browser} onClick={() => steer(() => steerYouTubeBrowser("reload"))}>↻</button>
      </span>
      <form className="yt-search" onSubmit={(e) => { e.preventDefault(); go(query); }}>
        <Field type="search" aria-label="Search YouTube or paste a link" placeholder="Search YouTube or paste a link" value={query} onChange={(e) => setQuery(e.target.value)} />
      </form>
      <span className="actions">
        {browser?.kind === "video" ? (
          videoState ? <span className="md-state" data-on={videoState === "In library" || undefined}>{videoState === "In library" ? <i data-on="true" /> : null}{videoState}</span>
            : <Button variant="primary" disabled={!!busy || !canDownload} onClick={take}>{busy === "take" ? "Reading…" : "Download MP3"}</Button>
        ) : browser?.kind === "playlist" ? (
          <Button variant="primary" disabled={!!busy || !canDownload} onClick={take}>{busy === "take" ? "Reading…" : "Download playlist"}</Button>
        ) : null}
        <Button variant="plain" disabled={!browser} onClick={() => steer(resetYouTubeBrowser)} title="Signs out of YouTube here and clears its cookies">Reset session</Button>
      </span>
      {browser ? <div ref={slot} className="yt-view" aria-label="YouTube page" /> : <div className="yt-view" aria-busy="true" />}
    </Card>

    {problem ? <p className="notice" role="alert">{problem}</p> : null}
    {tools && !tools.ytDlp ? <NeedsYtDlp /> : null}

    {listing?.kind === "playlist" ? <ListingCard listing={listing} canDownload={canDownload} onBack={() => setListing(null)}
      onDownload={(ids) => queued(downloadYouTube(listing.key, ids))} onCombine={() => queued(combineYouTube(listing.key))} /> : null}

    <DownloadsCard jobs={jobs} setJobs={setJobs} />

    <p className="md-foot muted">Saved as MP3s in your Library. Only download what you have the right to use.</p>
  </>);
}

function ListingCard({ listing, canDownload, onBack, onDownload, onCombine }: {
  listing: YouTubeListing; canDownload: boolean; onBack: () => void; onDownload: (ids?: string[]) => void; onCombine: () => void;
}) {
  const missing = listing.items.filter((i) => !i.inLibrary && !(i.job && (i.job.state === "waiting" || i.job.state === "working")));
  const here = listing.items.filter((i) => i.inLibrary).length;
  return (
    <Card pad className="ms-main yt-listing" aria-label={listing.title}>
      <div className="ms-main-head">
        <div>
          <button type="button" className="md-link" onClick={onBack}>Back</button>
          <h3>{listing.kind === "search" ? `“${listing.title}”` : listing.title}</h3>
          <span className="muted">{listing.items.length} {listing.items.length === 1 ? "video" : "videos"}{here ? ` · ${here} in your library` : ""}</span>
        </div>
        <span className="actions">
          {listing.combined ? <Combined state={listing.combined} canDownload={canDownload && listing.items.length > 0} onCombine={onCombine} /> : null}
          {listing.kind === "playlist" && missing.length ? <Button variant="primary" disabled={!canDownload} onClick={() => onDownload()}>Download {missing.length === listing.items.length ? "all" : missing.length}</Button> : null}
        </span>
      </div>
      <ItemList items={listing.items} canDownload={canDownload} onDownload={(id) => onDownload([id])} />
    </Card>
  );
}


function ItemList({ items, canDownload, onDownload }: { items: YouTubeItem[]; canDownload: boolean; onDownload: (id: string) => void }) {
  const [top, setTop] = useState(0);
  if (!items.length) return <p className="muted">Nothing found</p>;
  const first = Math.max(0, Math.floor(top / ROW) - 4), last = Math.min(items.length, first + VIEW + 8);
  return (
    <div className="md-scroll yt-scroll" style={{ height: Math.min(items.length, VIEW) * ROW }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <ul className="ms-episodes yt-items" style={{ height: items.length * ROW, position: "relative" }}>
        {items.slice(first, last).map((item, i) => (
          <li key={item.id} style={{ position: "absolute", top: (first + i) * ROW, left: 0, right: 0, height: ROW }}>
            <span className="md-title" title={item.title}>{item.title}</span>
            <span className="muted md-cell">{item.channel ?? ""}</span>
            <span className="md-end">{clock(item.secs)}</span>
            <span className="ms-dl"><JobState job={item.job} inLibrary={item.inLibrary} onDownload={() => onDownload(item.id)} canDownload={canDownload} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
