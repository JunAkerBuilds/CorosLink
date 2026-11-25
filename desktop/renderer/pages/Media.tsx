// Media (desktop only): the music library on this computer on the left and the watch as a USB drive on the right,
// so what is on each is seen side by side. MP3s are added here, then copied to the watch in order; the music services download into the library;
// Audiobooks turns books into short parts the watch plays in order.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { Button, Card, Field } from "@/components/ui";
import { useStore } from "@/data/local/store";
import {
  cancelSend, deleteFromLibrary, dismissSend, ejectWatch, fixExtension, importFile, MediaProblem, readMedia, refreshMedia,
  MEDIA_TABS, removeFromWatch, revealTrack, sendToWatch, type MediaState,
} from "../media";
import { canHideTab, carriesFiles, clickSelect, droppedFiles, hiddenTabsStore, splitMp3s, stepSelect, tabStore, TRACKS_TYPE, visibleTabs } from "../mediaInput";
import { navigate } from "../router";
import { clock, filterRows, gigabytes, mediaRows, megabytes, sortRows, type Row, type SortKey } from "../mediaRows";
import "./media.css";
import { PlugInArt } from "./PlugInArt";

const MusicSourcePanel = lazy(() => import("./MediaSources").then((m) => ({ default: m.MusicSourcePanel })));
const PodcastsPanel = lazy(() => import("./MediaSources").then((m) => ({ default: m.PodcastsPanel })));
const YouTubePanel = lazy(() => import("./MediaYouTube"));
const BooksPanel = lazy(() => import("./MediaBooks"));


const ROW = 44;
const VIEW_ROWS = 12;
const said = (e: unknown) => (e instanceof MediaProblem || e instanceof Error ? e.message : "That didn't work.");

export default function Media() {
  const [state, setState] = useState<MediaState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const tab = useStore(tabStore, "library");

  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);

  const sending = !!state?.job?.running;
  // Checks for the watch every few seconds; while sending, often enough for the progress bar.
  useEffect(() => {
    let live = true;
    const read = () => readMedia().then((s) => { if (live) setState(s); }, (e) => { if (live) setProblem(said(e)); });
    void read();
    const timer = setInterval(read, sending ? 500 : 3000);
    return () => { live = false; clearInterval(timer); };
  }, [sending]);

  const act = (work: () => Promise<MediaState>) => {
    setProblem(null);
    void work().then(setState, (e) => setProblem(said(e)));
  };

  /**
   * Adds files one at a time, in the order given (a folder's own order); anything that isn't an MP3 is left out and
   * counted. With `toWatch`, what was added then goes to the watch, in the same order.
   */
  const add = async (list: File[], toWatch = false) => {
    if (!list.length) return;
    setProblem(null); setNote(null);
    const { mp3s, skipped } = splitMp3s(list);
    const ids: string[] = [];
    if (mp3s.length) setAdding({ done: 0, total: mp3s.length });
    for (const [i, file] of mp3s.entries()) {
      try {
        ids.push((await importFile(file)).track.id);
      } catch (e) {
        setProblem(`${file.name}: ${said(e)}`);
      }
      setAdding({ done: i + 1, total: mp3s.length });
    }
    setAdding(null);
    if (skipped) setNote(`Added ${ids.length}. ${skipped} ${skipped === 1 ? "wasn't an MP3" : "weren't MP3s"}, so ${skipped === 1 ? "it was" : "they were"} left out.`);
    if (toWatch && ids.length) act(() => sendToWatch(ids));
    else void readMedia().then(setState);
  };

  // Drops: files and folders from Finder anywhere in the window go into the library (onto the watch, they're sent
  // too); library rows dragged onto the watch are sent. Anything else dropped is ignored, so the window never opens it.
  /** Which watch drop zone the drag is over ("chip", "guide", "storage"), so only that one lights up. */
  const [overZone, setOverZone] = useState<string | null>(null);
  const overWatch = !!overZone;
  useEffect(() => {
    const zoneOf = (e: DragEvent) => (e.target as Element | null)?.closest?.<HTMLElement>("[data-watch-drop]")?.dataset.watchDrop ?? null;
    const onWatch = (e: DragEvent) => !!zoneOf(e);
    const over = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      const files = carriesFiles(types), rows = !!types?.includes(TRACKS_TYPE);
      if (!files && !rows) return;
      const watchZone = onWatch(e) && !!state?.watch.connected;
      if (files || watchZone) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }
      setDragging(files);
      setOverZone(watchZone ? zoneOf(e) : null);
    };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) { setDragging(false); setOverZone(null); } };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const watchZone = onWatch(e) && !!state?.watch.connected;
      setDragging(false); setOverZone(null);
      const rows = e.dataTransfer?.getData(TRACKS_TYPE);
      if (rows) {
        if (!watchZone) return;
        const ids = (JSON.parse(rows) as unknown[]).filter((x): x is string => typeof x === "string");
        if (ids.length) act(() => sendToWatch(ids));
        return;
      }
      if (!carriesFiles(e.dataTransfer?.types)) return;
      // Audiobooks reads its own drops: the files are one book.
      if (tab === "books" && !watchZone) return;
      tabStore.set("library");
      void droppedFiles(e.dataTransfer).then((list) => add(list, watchZone));
    };
    const end = () => { setDragging(false); setOverZone(null); };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", end);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); window.removeEventListener("dragend", end); };
  });

  const hiddenTabs = useStore(hiddenTabsStore, []);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string | null } | null>(null);

  const watch = state?.watch;
  const model = watch?.model ?? "your watch";

  return (
    <main className="page md-page">
      <div className="page-head md-head">
        <h1>Media</h1>
        <nav className="seg" aria-label="Media sections" onContextMenu={(e) => {
          e.preventDefault();
          const id = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab ?? null;
          setTabMenu({ x: e.clientX, y: e.clientY, id: id && canHideTab(id) && !hiddenTabs.includes(id) ? id : null });
        }}>
          {visibleTabs(MEDIA_TABS, hiddenTabs, tab).map((t) => (
            <button key={t.id} type="button" data-tab={t.id} aria-pressed={tab === t.id} onClick={() => tabStore.set(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="actions">
          {watch?.connected ? (
            <span className="md-watch" data-watch-drop="chip" data-over={overZone === "chip" || undefined}>
              <span className="md-watch-icon" data-on><WatchIcon /></span>
              <span className="md-watch-name">{watch.model}<small>USB</small></span>
              <button type="button" className="md-eject" aria-label={`Eject ${watch.model}`} title="Eject" disabled={sending} onClick={() => act(ejectWatch)}><EjectIcon /></button>
            </span>
          ) : <span className="md-watch" data-off><span className="md-watch-icon"><WatchIcon /></span><span className="md-watch-name">No watch</span></span>}
        </div>
      </div>

      <input ref={files} type="file" accept=".mp3,audio/mpeg" multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <input ref={folder} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />

      {problem ? <p className="notice" role="alert">{problem}</p> : null}
      {note ? <p className="notice" role="status">{note}</p> : null}

      {tab === "spotify" || tab === "ytmusic" || tab === "apple" ? <Suspense fallback={null}><MusicSourcePanel key={tab} name={tab} /></Suspense>
        : tab === "podcasts" ? <Suspense fallback={null}><PodcastsPanel /></Suspense>
        : tab === "youtube" ? <Suspense fallback={null}><YouTubePanel /></Suspense>
        : tab === "books" ? <Suspense fallback={null}><BooksPanel /></Suspense>
        : !state ? null : (
        <Library state={state} model={model} adding={adding} act={act} onAdd={() => files.current?.click()} onAddFolder={() => folder.current?.click()} overZone={overZone} />
      )}

      {dragging ? <div className="md-drop" aria-hidden="true"><span>{overWatch ? `Drop to send to ${model}` : tab === "books" ? "Drop a book's files to convert them" : state?.watch.connected ? "Drop to add · on the watch to send it" : "Drop MP3s or folders to add them"}</span></div> : null}
      {tabMenu ? (
        <Menu x={tabMenu.x} y={tabMenu.y} onClose={() => setTabMenu(null)} label="Media sections" items={[
          ...(tabMenu.id ? [{ label: `Hide ${MEDIA_TABS.find((t) => t.id === tabMenu.id)?.label}`, run: () => {
            hiddenTabsStore.set((h) => [...h, tabMenu.id!]);
            if (tab === tabMenu.id) tabStore.set("library");
          } }] : []),
          ...MEDIA_TABS.filter((t) => hiddenTabs.includes(t.id)).map((t) => ({ label: `Show ${t.label}`, run: () => hiddenTabsStore.set((h) => h.filter((x) => x !== t.id)) })),
          { label: "Customize Media…", run: () => navigate("/settings/sidebar") },
        ]} />
      ) : null}
    </main>
  );
}

type Side = "computer" | "watch";

function Library({ state, model, adding, act, onAdd, onAddFolder, overZone }: {
  state: MediaState; model: string; adding: { done: number; total: number } | null;
  act: (work: () => Promise<MediaState>) => void; onAdd: () => void; onAddFolder: () => void; overZone: string | null;
}) {
  const { watch, library, job } = state;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "addedAt", dir: -1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** The pane the selection is in: picking in the other one starts over there. */
  const [side, setSide] = useState<Side>("computer");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => mediaRows(library, watch.tracks), [library, watch.tracks]);
  const found = useMemo(() => filterRows(rows, "all", query), [rows, query]);
  // Left: what is on this computer, sorted as asked. Right: what is on the watch, in the order it plays.
  const here = useMemo(() => sortRows(found.filter((r) => r.id), sort.key, sort.dir), [found, sort]);
  const there = useMemo(() => sortRows(found.filter((r) => r.watchPath), "order", 1), [found]);
  const lists: Record<Side, Row[]> = { computer: here, watch: there };
  const waiting = library.filter((t) => !t.onWatch);
  const waitingBytes = waiting.reduce((a, t) => a + t.bytes, 0);
  const libraryBytes = library.reduce((a, t) => a + t.bytes, 0);
  const chosen = rows.filter((r) => picked.has(r.key));
  const toSend = chosen.filter((r) => r.id && !r.watchPath);
  const onWatch = chosen.filter((r) => r.watchPath);
  const onComputer = chosen.filter((r) => r.id);
  const clear = () => { setPicked(new Set()); setAnchor(null); };
  const busy = !!job?.running;
  const tracks = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "track" : "tracks"}`;

  const send = (list: Row[]) => { if (list.length && watch.connected) { act(() => sendToWatch(list.map((r) => r.id!))); } };
  const remove = (list: Row[]) => {
    if (!list.length || !confirm(`Remove ${list.length} from ${model}?`)) return;
    act(() => removeFromWatch(list.map((r) => r.watchPath!))); clear();
  };
  const del = (list: Row[]) => {
    if (!list.length || !confirm(`Delete ${list.length} from this computer? Copies on the watch stay.`)) return;
    act(() => deleteFromLibrary(list.map((r) => r.id!))); clear();
  };

  const click = (e: ReactMouseEvent, key: string, s: Side) => {
    const mine = s === side;
    const next = clickSelect(lists[s].map((r) => r.key), mine ? picked : new Set<string>(), mine ? anchor : null, key, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
    setSide(s); setPicked(next.picked); setAnchor(next.anchor); setFocus(key);
  };
  const rightClick = (e: ReactMouseEvent, key: string, s: Side) => {
    e.preventDefault();
    if (s !== side || !picked.has(key)) { setPicked(new Set([key])); setAnchor(key); }
    setSide(s); setFocus(key);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // ⌘F finds; the rest work while a list has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); search.current?.focus(); search.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const onListKey = (s: Side) => (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey, order = lists[s].map((r) => r.key), mine = s === side;
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSide(s); setPicked(new Set(order)); return; }
    if (e.key === "Escape") { clear(); setMenu(null); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = stepSelect(order, mine ? picked : new Set<string>(), mine ? anchor : null, mine ? focus : null, e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
      if (next) { setSide(s); setPicked(next.picked); setAnchor(next.anchor); setFocus(next.focus); }
      return;
    }
    if (!mine) return;
    if (e.key === "Enter" && toSend.length) { e.preventDefault(); send(toSend); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && chosen.length) {
      e.preventDefault();
      if (s === "computer") del(onComputer); else remove(onWatch);
      return;
    }
    if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && chosen.length) {
      e.preventDefault();
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ x: box.left + 80, y: box.top + 60 });
    }
  };
  const one = chosen.length === 1 ? chosen[0] : null;

  const head = (key: SortKey, label: string, end?: boolean) => (
    <button type="button" className="md-th" data-end={end || undefined} aria-pressed={sort.key === key}
      onClick={() => setSort((x) => ({ key, dir: x.key === key ? (-x.dir as 1 | -1) : key === "addedAt" || key === "bytes" || key === "secs" ? -1 : 1 }))}>
      {label}{sort.key === key ? <span aria-hidden="true">{sort.dir > 0 ? "↑" : "↓"}</span> : null}
    </button>
  );
  const all = (s: Side) => (
    <input type="checkbox" aria-label="Select all" checked={s === side && lists[s].length > 0 && lists[s].every((r) => picked.has(r.key))}
      onChange={(e) => { setSide(s); setPicked(e.target.checked ? new Set(lists[s].map((r) => r.key)) : new Set()); setAnchor(null); }} />
  );
  const list = (s: Side, empty: string) => (
    <div className="md-pane-body">
      {lists[s].length ? <Rows side={s} rows={lists[s]} picked={picked} focus={s === side ? focus : null} onClick={(e, key) => click(e, key, s)} onRightClick={(e, key) => rightClick(e, key, s)} act={act} busy={busy} />
        : <p className="md-none muted">{empty}</p>}
    </div>
  );

  return (<>
    <Guide state={state} model={model} waiting={waiting.length} waitingBytes={waitingBytes} adding={adding} act={act} onAdd={onAdd}
      sendAll={() => act(() => sendToWatch(waiting.map((t) => t.id)))} overWatch={overZone === "guide"} />

    <div className="md-filters">
      {chosen.length ? (
        <div className="md-bulk">
          <strong>{chosen.length} selected</strong><span>{megabytes(chosen.reduce((a, r) => a + r.bytes, 0))}</span>
          <span className="actions">
            {toSend.length && watch.connected ? <Button variant="ink" disabled={busy} onClick={() => { send(toSend); clear(); }}>Send {toSend.length} to watch</Button> : null}
            {onWatch.length ? <Button disabled={busy} onClick={() => remove(onWatch)}>Remove {onWatch.length} from watch</Button> : null}
            {onComputer.length ? <Button onClick={() => del(onComputer)}>Delete from computer</Button> : null}
            <Button variant="plain" onClick={clear}>Clear</Button>
          </span>
        </div>
      ) : <p className="md-foot muted">MP3 only. The watch plays files in the order they were copied.</p>}
      <Field ref={search} type="search" className="md-search" aria-label="Search title, artist or album" placeholder="Title, artist or album" value={query} onChange={(e) => setQuery(e.target.value)} />
    </div>

    <div className="md-split">
      <Card clip className="md-pane" aria-label="On this computer">
        <div className="md-pane-head">
          <span className="md-pane-icon" aria-hidden="true"><ComputerIcon /></span>
          <div className="md-pane-title">
            <h2>This computer</h2>
            <span>{tracks(library.length)} · {megabytes(libraryBytes)}{waiting.length ? ` · ${waiting.length} not on the watch` : ""}</span>
          </div>
          <div className="actions">
            <Button onClick={onAddFolder} disabled={!!adding}>Add a folder</Button>
            <Button variant="primary" onClick={onAdd} disabled={!!adding}><PlusIcon />Add music</Button>
          </div>
        </div>
        <div className="md-table" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label="Tracks on this computer" onKeyDown={onListKey("computer")}>
          <div className="md-tr md-thead" data-side="computer">
            {all("computer")}{head("title", "Title")}{head("artist", "Artist")}{head("secs", "Length", true)}{head("bytes", "Size", true)}<span className="md-th">On watch</span>
          </div>
          {list("computer", library.length ? "No tracks match" : "Drop MP3s or a folder here")}
        </div>
      </Card>

      <Card clip className="md-pane" aria-label={watch.connected ? `On ${model}` : "On your watch"} data-watch-drop={watch.connected ? "storage" : undefined} data-over={(watch.connected && overZone === "storage") || undefined}>
        <div className="md-pane-head">
          <span className="md-pane-icon" data-kind="watch" data-on={watch.connected || undefined} aria-hidden="true"><WatchIcon /></span>
          <div className="md-pane-title">
            <h2>{watch.connected ? model : "Your watch"}</h2>
            <span>{watch.connected ? `${tracks(watch.tracks.length)} · ${megabytes(watch.musicBytes ?? 0)} · plays top to bottom` : "Not plugged in"}</span>
          </div>
          {watch.connected && waiting.length ? <div className="actions"><Button variant="ink" disabled={busy} onClick={() => act(() => sendToWatch(waiting.map((t) => t.id)))}>Send {waiting.length} here</Button></div> : null}
        </div>
        {watch.connected ? (<>
          <WatchStore state={state} />
          <div className="md-table" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={`Tracks on ${model}`} onKeyDown={onListKey("watch")}>
            <div className="md-tr md-thead" data-side="watch">
              {all("watch")}<span className="md-th">#</span><span className="md-th">Title</span><span className="md-th">Artist</span><span className="md-th" data-end>Length</span><span className="md-th" data-end>Size</span><span className="md-th">On computer</span>
            </div>
            {list("watch", watch.tracks.length ? "No tracks match" : "Nothing on the watch yet. Drag tracks here from the left.")}
          </div>
        </>) : (
          <div className="md-pane-body md-unplugged">
            <PlugInArt held={!!watch.waiting} />
            <strong>{watch.waiting ? "Connected, but not as a drive" : "Plug in your watch to see what's on it"}</strong>
            {waiting.length ? <span className="muted">{tracks(waiting.length)} will go on it, {megabytes(waitingBytes)}</span> : null}
            <Button onClick={() => act(refreshMedia)}>Check again</Button>
          </div>
        )}
      </Card>
    </div>
    {menu && chosen.length ? (
      <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="Track actions" items={[
        ...(toSend.length && watch.connected ? [{ label: `Send ${toSend.length === 1 ? "" : `${toSend.length} `}to watch`, run: () => send(toSend), disabled: busy }] : []),
        ...(one?.capital ? [{ label: "Rename to .mp3", run: () => act(() => fixExtension(one.watchPath!)), disabled: busy }] : []),
        ...(one?.id ? [{ label: "Show in Finder", run: () => void revealTrack(one.id!) }] : []),
        ...(onWatch.length ? [{ label: `Remove ${onWatch.length === 1 ? "" : `${onWatch.length} `}from watch`, run: () => remove(onWatch), disabled: busy }] : []),
        ...(onComputer.length ? [{ label: `Delete ${onComputer.length === 1 ? "" : `${onComputer.length} `}from computer`, run: () => del(onComputer), danger: true }] : []),
      ]} />
    ) : null}
  </>);
}

/**
 * One pane's rows. Only the rows in view are drawn, so a library of thousands scrolls smoothly. Rows on this computer
 * that aren't on the watch yet drag onto it.
 */
function Rows({ side, rows, picked, focus, onClick, onRightClick, act, busy }: {
  side: Side; rows: Row[]; picked: Set<string>; focus: string | null;
  onClick: (e: ReactMouseEvent, key: string) => void; onRightClick: (e: ReactMouseEvent, key: string) => void;
  act: (work: () => Promise<MediaState>) => void; busy: boolean;
}) {
  const [top, setTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const first = Math.max(0, Math.floor(top / ROW) - 4);
  // The list can stretch past VIEW_ROWS to the bottom of the window, so draw enough rows to fill a tall one.
  const last = Math.min(rows.length, first + VIEW_ROWS + 32);
  // The row the arrow keys moved to stays in view.
  useEffect(() => {
    const el = scroller.current, i = rows.findIndex((r) => r.key === focus);
    if (!el || i < 0) return;
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW;
    else if ((i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW - el.clientHeight;
  }, [focus, rows]);
  const dragStart = (e: React.DragEvent, r: Row) => {
    const set = picked.has(r.key) ? rows.filter((x) => picked.has(x.key)) : [r];
    const ids = set.filter((x) => x.id && !x.watchPath).map((x) => x.id!);
    if (!ids.length) { e.preventDefault(); return; }
    e.dataTransfer.setData(TRACKS_TYPE, JSON.stringify(ids));
    e.dataTransfer.setData("text/plain", `${ids.length} ${ids.length === 1 ? "track" : "tracks"}`);
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <div ref={scroller} className="md-scroll" style={{ height: Math.min(rows.length, VIEW_ROWS) * ROW }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: rows.length * ROW, position: "relative" }}>
        {rows.slice(first, last).map((r, i) => (
          <div key={r.key} className="md-tr" data-side={side} role="option" aria-selected={picked.has(r.key)} data-picked={picked.has(r.key) || undefined} data-focus={r.key === focus || undefined}
            draggable={side === "computer" && !r.watchPath} onDragStart={(e) => dragStart(e, r)}
            onClick={(e) => { if (!(e.target as HTMLElement).closest("button, input")) onClick(e, r.key); }}
            onContextMenu={(e) => onRightClick(e, r.key)}
            style={{ position: "absolute", top: (first + i) * ROW, left: 0, right: 0, height: ROW }}>
            <input type="checkbox" tabIndex={-1} aria-label={`Select ${r.title}`} checked={picked.has(r.key)} onChange={() => {}}
              onClick={(e) => onClick({ ...e, metaKey: !e.shiftKey, ctrlKey: false } as ReactMouseEvent, r.key)} />
            {side === "watch" ? <span className="md-num">{r.order ?? "—"}</span> : null}
            <span className="md-title" title={r.title}>{r.title}</span>
            <span className="md-cell muted">{r.artist}</span>
            <span className="md-end">{clock(r.secs)}</span>
            <span className="md-end muted">{megabytes(r.bytes)}</span>
            <span className="md-state">
              {side === "watch"
                ? (r.capital ? <button type="button" className="md-link" disabled={busy} onClick={() => act(() => fixExtension(r.watchPath!))}>Rename to .mp3</button>
                  : r.id ? <><i data-on="true" />On computer</> : <><i />Only on watch</>)
                : r.watchPath ? <><i data-on="true" />On watch</> : <><i />Not sent yet</>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A right-click menu: closes on a click elsewhere, Escape, or scrolling; the arrow keys move through it. */
function Menu({ x, y, items, onClose, label }: {
  x: number; y: number; label: string; onClose: () => void;
  items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[];
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); window.removeEventListener("scroll", onClose, true); };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 240), topY = Math.min(y, window.innerHeight - 40 * items.length - 16);
  return (
    <div ref={box} className="md-menu" role="menu" aria-label={label} style={{ left, top: topY }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const all = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
      }}>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" disabled={it.disabled} data-danger={it.danger || undefined} onClick={() => { onClose(); it.run(); }}>{it.label}</button>
      ))}
    </div>
  );
}

function Guide({ state, model, waiting, waitingBytes, adding, act, onAdd, sendAll, overWatch }: {
  state: MediaState; model: string; waiting: number; waitingBytes: number; adding: { done: number; total: number } | null;
  act: (work: () => Promise<MediaState>) => void; onAdd: () => void; sendAll: () => void; overWatch: boolean;
}) {
  const { watch, job, library, ejected } = state;
  const done = [library.length > 0, watch.connected, watch.connected && library.length > 0 && !waiting && !job?.running];
  const step = done.findIndex((d) => !d) + 1;
  let title: string, detail: ReactNode = null, actions: ReactNode = null, progress: number | null = null;
  if (adding) {
    title = `Adding ${adding.done + 1 > adding.total ? adding.total : adding.done + 1} of ${adding.total}`;
    progress = adding.done / adding.total;
  } else if (job?.running) {
    title = `Sending to ${model}`;
    detail = `${job.done + 1} of ${job.total}${job.current ? ` · ${job.current}` : ""}. Keep the watch plugged in.`;
    progress = job.totalBytes ? job.sentBytes / job.totalBytes : 0;
    actions = <Button disabled={job.cancelled} onClick={() => act(cancelSend)}>{job.cancelled ? "Stopping…" : "Stop after this track"}</Button>;
  } else if (job) {
    title = job.error ? "Sending stopped" : `Sent ${job.done} to ${model}`;
    detail = job.error ?? (job.cancelled ? `${job.total - job.done} not sent.` : null);
    actions = <>{watch.connected && !job.error ? <Button onClick={() => act(ejectWatch)}>Eject</Button> : null}<Button variant="plain" onClick={() => act(dismissSend)}>Done</Button></>;
  } else if (ejected && !watch.connected) {
    title = "Safe to unplug";
    detail = "The watch shows a loading icon for about a minute while it reads the new files.";
  } else if (!watch.connected && watch.waiting) {
    title = "Connected, but not as a drive";
    detail = "Allow the USB connection on the watch, or try another cable or port.";
    actions = <Button onClick={() => act(refreshMedia)}>Check again</Button>;
  } else if (!watch.connected) {
    title = "Plug in your watch";
    detail = waiting ? `${waiting} ${waiting === 1 ? "track is" : "tracks are"} waiting, ${megabytes(waitingBytes)}.` : null;
    actions = <Button onClick={() => act(refreshMedia)}>Check again</Button>;
  } else if (!library.length) {
    title = "Add MP3s to send them";
    actions = <Button variant="primary" onClick={onAdd}>Add music</Button>;
  } else if (waiting) {
    title = `${waiting} ${waiting === 1 ? "track is" : "tracks are"} ready for your watch`;
    detail = megabytes(waitingBytes);
    actions = <Button variant="ink" onClick={sendAll}>Send {waiting} to watch</Button>;
  } else {
    title = `Everything is on ${model}`;
  }
  return (
    <section className="md-guide" aria-label="Put it on your watch" data-watch-drop={watch.connected ? "guide" : undefined} data-over={(watch.connected && overWatch) || undefined}>
      <div className="md-steps">
        <span className="md-steps-title">Put it on your watch</span>
        {["Choose", "Connect", "Send"].map((s, i) => (
          <span key={s} className="md-step" data-done={done[i] || undefined} aria-current={i + 1 === step ? "step" : undefined}>
            <b>{done[i] ? "✓" : i + 1}</b>{s}
          </span>
        ))}
      </div>
      <div className="md-banner">
        <span className="md-banner-icon" aria-hidden="true"><NoteIcon /></span>
        <div className="md-banner-text"><strong>{title}</strong>{detail ? <span>{detail}</span> : null}
          {progress != null ? <span className="md-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(progress * 100)}%` }} /></span> : null}
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
    </section>
  );
}

/** How full the watch is, at the top of its pane: free space, then maps, music and the rest on one bar. */
function WatchStore({ state }: { state: MediaState }) {
  const { watch, library } = state;
  const total = watch.totalBytes ?? 0, free = watch.freeBytes ?? 0, used = Math.max(0, total - free);
  const music = watch.musicBytes ?? 0, maps = watch.mapBytes ?? 0, other = Math.max(0, used - music - maps);
  const known = [...watch.tracks.map((t) => t.bytes), ...library.map((t) => t.bytes)];
  const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const parts = [{ label: "Maps", bytes: maps, kind: "maps" }, { label: "Music", bytes: music, kind: "music" }, { label: "Other", bytes: other, kind: "other" }];
  return (
    <div className="md-pane-store" aria-label="Watch storage">
      <div className="md-pane-free">
        <strong>{gigabytes(free)} GB free</strong><span className="muted">of {gigabytes(total)} GB</span>
        {average ? <span className="muted md-pane-room">Room for about {Math.floor(free / average).toLocaleString("en-US")} tracks</span> : null}
      </div>
      <div className="md-meter" role="img" aria-label={`Storage: ${parts.map((p) => `${p.label} ${gigabytes(p.bytes)} GB`).join(", ")}`}>
        {parts.map((p) => <span key={p.kind} data-kind={p.kind} style={{ flexBasis: total ? `${(p.bytes / total) * 100}%` : 0 }} />)}
      </div>
      <div className="md-pane-legend">
        {parts.map((p) => <span key={p.kind}><i data-kind={p.kind} />{p.label} {gigabytes(p.bytes)} GB</span>)}
      </div>
    </div>
  );
}

const EjectIcon = () => <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 14.5L12 6l7 8.5zM5 19h14" /></svg>;
const WatchIcon = () => <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM9.4 7.7l.8-4.2h3.6l.8 4.2M9.4 16.3l.8 4.2h3.6l.8-4.2" /></svg>;
const ComputerIcon = () => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5.5h14v10H5zM2.5 19h19" /></svg>;
const PlusIcon = () => <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
const NoteIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z" /></svg>;
