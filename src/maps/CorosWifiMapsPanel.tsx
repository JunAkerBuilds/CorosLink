import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./wifiMaps.css";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Bluetooth, CircleCheck, Download, Loader2, MapPin, Search, SquareMousePointer, TriangleAlert, Wifi, X, ZoomIn
} from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { CorosWifiMapPreview, CorosWifiMapStatus, CorosWifiMapTask, CorosWifiMapTile } from "../../electron/corosWifiMapTypes";
import type { RouteGeocodeResult } from "../../electron/types";
import { formatBytes } from "../media/libraryUtils";
import { apiErrorMessage, watchDisplayName } from "../watchfaces/watchLink";
import { defineSelectionPreference, useSelectionPreference } from "../preferences/selectionPreferences";
import { ROUTE_BASE_LAYERS } from "./routes/constants";
import { corosMapTileAt, corosMapTileBounds } from "../../electron/corosMapGrid";

interface Props {
  api: CorosLinkApi;
  /** Opens the toolbar watch menu, where every Bluetooth connection starts. */
  onOpenWatchMenu?: () => void;
}

const MAX_AREAS = 16;
/** Below this zoom a COROS tile is under ~32 px wide: too small to aim at. */
const GRID_MIN_ZOOM = 4;
/** COROS previews expire after ten minutes; re-check before they do. */
const PREVIEW_MAX_AGE_MS = 8 * 60_000;
const DEFAULT_VIEW: SavedView = { lat: 40, lon: -95, zoom: 4 };

interface SavedSelection { tiles: CorosWifiMapTile[]; names: Record<string, string> }
interface SavedView { lat: number; lon: number; zoom: number }
type SizeCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ready"; preview: CorosWifiMapPreview; checkedAt: number }
  | { state: "error"; message: string };
type Notice = { tone: "success" | "error" | "info"; text: string };
type FocusRequest = { id: number; tiles: CorosWifiMapTile[] } | { id: number; lat: number; lon: number };

const isTile = (value: unknown): value is CorosWifiMapTile => {
  const tile = value as CorosWifiMapTile | null;
  return Boolean(tile) && [tile!.x, tile!.y].every(n => Number.isInteger(n) && n >= 0 && n <= 127);
};
const SELECTION_PREFERENCE = defineSelectionPreference<SavedSelection>({
  key: "maps.wifiAreas",
  defaultValue: { tiles: [], names: {} },
  validate: (value): value is SavedSelection => {
    const saved = value as SavedSelection | null;
    return Boolean(saved) && Array.isArray(saved!.tiles) && saved!.tiles.length <= MAX_AREAS && saved!.tiles.every(isTile) &&
      Boolean(saved!.names) && typeof saved!.names === "object" && Object.values(saved!.names).every(name => typeof name === "string");
  }
});
const VIEW_PREFERENCE = defineSelectionPreference<SavedView | null>({
  key: "maps.wifiView",
  defaultValue: null,
  validate: (value): value is SavedView | null => value === null || (typeof value === "object" &&
    [(value as SavedView).lat, (value as SavedView).lon, (value as SavedView).zoom].every(Number.isFinite))
});

const TASK_NAMES_KEY = "coroslink.wifiMaps.taskNames.v1";
function readTaskNames(): Record<string, string> {
  try { return JSON.parse(window.localStorage.getItem(TASK_NAMES_KEY) ?? "{}") ?? {}; } catch { return {}; }
}
function rememberTaskName(id: string, name: string) {
  try {
    const entries = Object.entries({ ...readTaskNames(), [id]: name }).slice(-24);
    window.localStorage.setItem(TASK_NAMES_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* names are a nicety */ }
}

const key = (tile: CorosWifiMapTile) => `${tile.x},${tile.y}`;
const hemisphere = (value: number, positive: string, negative: string) => `${Math.abs(value).toFixed(1)}°${value >= 0 ? positive : negative}`;
function tileCenter(tile: CorosWifiMapTile) {
  const area = corosMapTileBounds(tile);
  return { lat: (area.north + area.south) / 2, lon: (area.east + area.west) / 2 };
}
const pointLabel = (tile: CorosWifiMapTile) => {
  const center = tileCenter(tile);
  return `${hemisphere(center.lat, "N", "S")} ${hemisphere(center.lon, "E", "W")}`;
};
/** "41.0–43.1°N · 87.2–90.0°W" */
function extentLabel(tile: CorosWifiMapTile) {
  const area = corosMapTileBounds(tile);
  const span = (a: number, b: number, positive: string, negative: string) => {
    const [low, high] = [Math.abs(a), Math.abs(b)].sort((x, y) => x - y);
    return Math.sign(a) === Math.sign(b) || a === 0 || b === 0
      ? `${low.toFixed(1)}–${high.toFixed(1)}°${a + b >= 0 ? positive : negative}`
      : `${hemisphere(a, positive, negative)}–${hemisphere(b, positive, negative)}`;
  };
  return `${span(area.south, area.north, "N", "S")} · ${span(area.west, area.east, "E", "W")}`;
}
const placeParts = (label: string) => {
  const [primary = label, ...rest] = label.split(", ");
  return { primary, secondary: rest.join(", ") };
};
const summarize = (names: string[]) =>
  names.length <= 2 ? names.join(" & ") : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;

function linkState(status: CorosWifiMapStatus | null): { tone: "ok" | "warn" | "off" | "busy"; label: string } {
  if (!status) return { tone: "busy", label: "Checking watch…" };
  if (!status.connected) return { tone: "off", label: "Not connected" };
  if (!status.supported) return { tone: "warn", label: "Not supported" };
  return status.authenticated ? { tone: "ok", label: "Connected" } : { tone: "warn", label: "Sign-in needed" };
}

/** In-progress and failed downloads; finished ones are summarised separately. */
function taskView(task: CorosWifiMapTask): { tone: "warn" | "busy" | "error" | "off"; label: string } {
  switch (task.state) {
    case "failed": return { tone: "error", label: "Failed" };
    case "queued": return { tone: "warn", label: "Waiting for Wi-Fi" };
    case "downloading": return { tone: "busy", label: "Downloading" };
    default: return { tone: "off", label: "Waiting for watch" };
  }
}

export function CorosWifiMapsPanel({ api, onOpenWatchMenu }: Props) {
  const [status, setStatus] = useState<CorosWifiMapStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [selection, setSelection] = useSelectionPreference(SELECTION_PREFERENCE);
  const [savedView, setSavedView] = useSelectionPreference(VIEW_PREFERENCE);
  const [size, setSize] = useState<SizeCheck>({ state: "idle" });
  const [connecting, setConnecting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [zoom, setZoom] = useState(savedView?.zoom ?? DEFAULT_VIEW.zoom);
  const [hoverTile, setHoverTile] = useState<CorosWifiMapTile | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [sizeRetry, setSizeRetry] = useState(0);
  const focusSequence = useRef(0);
  const sizeSequence = useRef(0);
  const naming = useRef(new Set<string>());
  const { tiles, names } = selection;
  const tilesKey = tiles.map(key).join("|");
  const ready = Boolean(status?.supported && status.connected && status.authenticated);
  const full = tiles.length >= MAX_AREAS;
  const link = linkState(status);
  const taskNames = readTaskNames();
  const doneTasks = status?.tasks.filter(task => task.state === "complete") ?? [];

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await api.getCorosWifiMapStatus(); if (!stopped) { setStatus(next); setPollError(null); } }
      catch (error) { if (!stopped) setPollError(apiErrorMessage(error, "Could not read watch map progress.")); }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [api]);

  // The size check is free and side-effect-free, so run it whenever the plan settles.
  useEffect(() => {
    const sequence = ++sizeSequence.current;
    if (!ready || !tiles.length) { setSize({ state: "idle" }); return; }
    setSize({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const preview = await api.previewCorosWifiMap(tiles);
        if (sequence === sizeSequence.current) setSize({ state: "ready", preview, checkedAt: Date.now() });
      } catch (error) {
        if (sequence === sizeSequence.current) setSize({ state: "error", message: apiErrorMessage(error, "Could not check the map size.") });
      }
    }, 450);
    return () => clearTimeout(timer);
    // tilesKey captures every change to `tiles`.
  }, [api, ready, tilesKey, sizeRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameArea = (tile: CorosWifiMapTile) => {
    const id = key(tile);
    if (naming.current.has(id)) return;
    naming.current.add(id);
    const center = tileCenter(tile);
    void api.reverseGeocodeRouteLocation(center.lat, center.lon).then(place => {
      // "" records "no place here" (open water) so the lookup isn't repeated.
      const name = place.city || (/^-?\d/.test(place.label) ? "" : placeParts(place.label).primary);
      setSelection(current => current.tiles.some(value => key(value) === id) && !current.names[id]
        ? { ...current, names: { ...current.names, [id]: name } } : current);
    }).catch(() => { /* coordinates stay as the label; retried next visit */ }).finally(() => naming.current.delete(id));
  };
  // Name areas restored from an earlier visit whose lookup never finished.
  useEffect(() => {
    tiles.forEach(tile => { if (names[key(tile)] === undefined) nameArea(tile); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addTile = (tile: CorosWifiMapTile, name?: string): boolean => {
    const id = key(tile);
    if (tiles.some(value => key(value) === id)) {
      if (name && !names[id]) setSelection(current => ({ ...current, names: { ...current.names, [id]: name } }));
      return true;
    }
    if (full) {
      setNotice({ tone: "info", text: `You can send up to ${MAX_AREAS} areas at a time. Remove one to add ${name ?? "another"}.` });
      return false;
    }
    setNotice(null);
    setSelection(current => ({ tiles: [...current.tiles, tile], names: name ? { ...current.names, [id]: name } : current.names }));
    if (!name) nameArea(tile);
    return true;
  };
  const removeTile = (tile: CorosWifiMapTile) => {
    const id = key(tile);
    setNotice(null);
    setHighlight(current => current === id ? null : current);
    setSelection(current => {
      const { [id]: _removed, ...rest } = current.names;
      return { tiles: current.tiles.filter(value => key(value) !== id), names: rest };
    });
  };
  const toggleTile = (tile: CorosWifiMapTile) => {
    if (downloading) return;
    if (tiles.some(value => key(value) === key(tile))) removeTile(tile); else addTile(tile);
  };
  const clearAll = () => { setNotice(null); setHighlight(null); setSelection({ tiles: [], names: {} }); };
  const requestFocus = (target: { tiles: CorosWifiMapTile[] } | { lat: number; lon: number }) =>
    setFocus({ ...target, id: ++focusSequence.current });

  const pickPlace = (place: RouteGeocodeResult) => {
    const tile = corosMapTileAt(place.lat, place.lon);
    const name = place.city || placeParts(place.label).primary;
    addTile(tile, name);
    requestFocus({ tiles: [tile] });
  };

  const connect = async () => {
    if (onOpenWatchMenu) { onOpenWatchMenu(); return; }
    setConnecting(true); setNotice(null);
    try {
      const previous = await api.getCorosNativeBleStatus();
      if (previous.connected && previous.systemBind !== "authenticated") await api.disconnectCorosNativeBle();
      const connected = await api.connectCorosNativeBle({ backend: "system" });
      setStatus(await api.getCorosWifiMapStatus());
      if (connected.systemBind !== "authenticated") {
        setNotice({ tone: "error", text: connected.authenticationError ?? "Sign in to your COROS account in Watch Faces, then reconnect before downloading maps." });
      }
    } catch (error) { setNotice({ tone: "error", text: apiErrorMessage(error, "Could not connect the watch.") }); }
    finally { setConnecting(false); }
  };

  const download = async () => {
    if (size.state !== "ready" || !size.preview.fileCount) return;
    setDownloading(true); setNotice(null);
    try {
      const preview = Date.now() - size.checkedAt > PREVIEW_MAX_AGE_MS ? await api.previewCorosWifiMap(tiles) : size.preview;
      if (!preview.fileCount) throw new Error("COROS has no map files for these areas.");
      const result = await api.downloadCorosWifiMap(preview.id);
      const label = summarize(tiles.map(tile => names[key(tile)] || pointLabel(tile)));
      rememberTaskName(result.taskId, label);
      setStatus(result.status);
      setSelection({ tiles: [], names: {} });
      setNotice({ tone: "success", text: `Your watch accepted ${label} (${formatBytes(preview.sizeBytes)}). It downloads over its saved Wi-Fi — keep it on the watch face, ideally charging.` });
    } catch (error) {
      setNotice({ tone: "error", text: apiErrorMessage(error, "Could not start the map download.") });
    } finally { setDownloading(false); }
  };

  const hint = zoom < GRID_MIN_ZOOM ? { icon: <ZoomIn size={14} aria-hidden="true" />, text: "Zoom in or click the map to choose areas" }
    : hoverTile ? (() => {
      const id = key(hoverTile), selected = tiles.some(value => key(value) === id);
      return selected ? { icon: <X size={14} aria-hidden="true" />, text: `Remove ${names[id] || pointLabel(hoverTile)}` }
        : full ? { icon: <TriangleAlert size={14} aria-hidden="true" />, text: `${MAX_AREAS} of ${MAX_AREAS} areas chosen — remove one first` }
          : { icon: <SquareMousePointer size={14} aria-hidden="true" />, text: `Add area around ${pointLabel(hoverTile)}` };
    })()
      : !tiles.length ? { icon: <SquareMousePointer size={14} aria-hidden="true" />, text: "Click squares to add map areas" } : null;

  const eyebrowWatch = status?.supported ? status.watchLabel ?? watchDisplayName(status.deviceName).replace(/^COROS\s+/i, "") : "COROS";

  return <section className="panel wifi-maps-panel">
    <div className="section-heading wifi-maps-heading">
      <div><p className="eyebrow">{eyebrowWatch} · Wireless maps</p><h2>Download maps to your watch</h2></div>
      <span className={`wifi-maps-link is-${link.tone}`} role="status">{link.label}</span>
    </div>
    <p className="wifi-maps-lede">Pick the areas you train in. The watch fetches them over its own Wi-Fi; CorosLink starts the download and follows progress over Bluetooth.</p>

    <div className="wifi-maps-workspace">
      <div className="wifi-maps-stage">
        <WifiAreaPicker tiles={tiles} highlight={highlight} full={full} locked={downloading} focus={focus}
          initialView={savedView} onToggle={toggleTile} onHover={setHoverTile} onZoom={setZoom} onViewChange={setSavedView} />
        <PlaceSearch api={api} onPick={pickPlace} />
        {hint ? <div className="wifi-maps-hint" aria-hidden="true">{hint.icon}<span>{hint.text}</span></div> : null}
      </div>

      <aside className="wifi-maps-aside" aria-label="Map download plan">
        <div className="wifi-maps-plan">
          <div className="wifi-maps-plan-head">
            <h3>Selected areas</h3>
            <span className={full ? "wifi-maps-count is-full" : "wifi-maps-count"}>{tiles.length} / {MAX_AREAS}</span>
            {tiles.length ? <>
              {tiles.length > 1 ? <button type="button" className="wifi-maps-text-button" onClick={() => requestFocus({ tiles })}>Show all</button> : null}
              <button type="button" className="wifi-maps-text-button" disabled={downloading} onClick={clearAll}>Clear</button>
            </> : null}
          </div>
          <div className="wifi-maps-capacity" aria-hidden="true"><span style={{ width: `${(tiles.length / MAX_AREAS) * 100}%` }} /></div>
          {tiles.length ? <ol className="wifi-maps-area-list">
            {tiles.map((tile, index) => {
              const id = key(tile), name = names[id];
              return <li key={id} className={highlight === id ? "wifi-maps-area is-highlighted" : "wifi-maps-area"}
                onMouseEnter={() => setHighlight(id)} onMouseLeave={() => setHighlight(current => current === id ? null : current)}>
                <button type="button" className="wifi-maps-area-main" onClick={() => requestFocus({ tiles: [tile] })}
                  onFocus={() => setHighlight(id)} onBlur={() => setHighlight(current => current === id ? null : current)}>
                  <span className="wifi-maps-area-badge" aria-hidden="true">{index + 1}</span>
                  <span className="wifi-maps-area-text">
                    <strong>{name || pointLabel(tile)}</strong>
                    <small>{extentLabel(tile)}</small>
                  </span>
                </button>
                <button type="button" className="wifi-maps-area-remove" disabled={downloading} onClick={() => removeTile(tile)}
                  aria-label={`Remove ${name || pointLabel(tile)}`} title="Remove area"><X size={14} aria-hidden="true" /></button>
              </li>;
            })}
          </ol> : <div className="wifi-maps-empty">
            <SquareMousePointer size={22} aria-hidden="true" />
            <strong>No areas yet</strong>
            <p>Search for a place or click squares on the map. Each square is one COROS map tile.</p>
          </div>}

          <div className="wifi-maps-plan-foot">
            {ready ? <>
              <SizeSummary size={size} hasTiles={tiles.length > 0} onRetry={() => setSizeRetry(count => count + 1)} />
              <button type="button" className="primary-button wifi-maps-download"
                disabled={downloading || size.state !== "ready" || !size.preview.fileCount}
                onClick={() => void download()}>
                {downloading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                {downloading ? "Starting download…" : "Download to watch"}
              </button>
            </> : <ConnectCallout status={status} connecting={connecting} onConnect={() => void connect()} viaMenu={Boolean(onOpenWatchMenu)} />}
            {ready && status?.validated === false ? <p className="wifi-maps-notice" role="note">
              <TriangleAlert size={15} aria-hidden="true" />
              <span>Map downloads on {status.watchLabel ?? "this watch"} are in beta: they were tested on PACE Pro. If the watch refuses the download, it may not support Wi-Fi maps.</span>
            </p> : null}
            {notice ? <p className={`wifi-maps-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
              {notice.tone === "success" ? <CircleCheck size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
              <span>{notice.text}</span>
            </p> : <p className="wifi-maps-foot-note"><Wifi size={14} aria-hidden="true" />
              <span>The watch needs a saved Wi-Fi network. Keep it on the watch face while it downloads.</span></p>}
          </div>
        </div>

        {status?.tasks.length || pollError ? <section className="wifi-maps-tasks" aria-live="polite" aria-label="Downloads on watch">
          <h3><Wifi size={15} aria-hidden="true" />On your watch</h3>
          {pollError ? <p className="wifi-maps-notice is-error" role="alert"><TriangleAlert size={15} aria-hidden="true" /><span>{pollError}</span></p> : null}
          {status?.tasks.map((task, index) => {
            if (task.state === "complete") return null;
            const view = taskView(task);
            const percent = task.totalBytes ? Math.round((task.downloadedBytes / task.totalBytes) * 100) : 0;
            return <div key={task.id} className="wifi-maps-task">
              <div className="wifi-maps-task-head">
                <strong>{taskNames[task.id] ?? `Map download ${index + 1}`}</strong>
                <span className={`wifi-maps-task-state is-${view.tone}`}>{view.label}</span>
              </div>
              <div className={`wifi-maps-task-bar is-${view.tone}`} role="progressbar" aria-label={`${taskNames[task.id] ?? `Map download ${index + 1}`} progress`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
              <small>{task.totalBytes ? `${formatBytes(task.downloadedBytes)} of ${formatBytes(task.totalBytes)} · ${percent}%` : "Size pending"}
                {task.errorCode ? ` · Watch error ${task.errorCode}` : ""}</small>
            </div>;
          })}
          {doneTasks.length ? <p className="wifi-maps-tasks-done"><CircleCheck size={15} aria-hidden="true" />
            <span>{doneTasks.length === 1 ? `${taskNames[doneTasks[0]!.id] ?? "1 map download"} is on your watch`
              : `${doneTasks.length} map downloads are on your watch`}</span></p> : null}
        </section> : null}
      </aside>
    </div>
  </section>;
}

function SizeSummary({ size, hasTiles, onRetry }: { size: SizeCheck; hasTiles: boolean; onRetry: () => void }) {
  if (!hasTiles) return <div className="wifi-maps-size is-empty"><span>Download size</span><em>Add an area to check</em></div>;
  if (size.state === "checking" || size.state === "idle") {
    return <div className="wifi-maps-size"><span>Download size</span><em><Loader2 size={14} className="spin" aria-hidden="true" />Checking…</em></div>;
  }
  if (size.state === "error") {
    return <div className="wifi-maps-size-error" role="alert"><TriangleAlert size={15} aria-hidden="true" /><span>{size.message}</span>
      <button type="button" className="wifi-maps-text-button" onClick={onRetry}>Try again</button></div>;
  }
  if (!size.preview.fileCount) {
    return <div className="wifi-maps-size-error"><TriangleAlert size={15} aria-hidden="true" /><span>COROS has no map data for these areas. Choose areas with land.</span></div>;
  }
  return <div className="wifi-maps-size">
    <span>Download size<small>{size.preview.fileCount} map file{size.preview.fileCount === 1 ? "" : "s"}</small></span>
    <strong>{formatBytes(size.preview.sizeBytes)}</strong>
  </div>;
}

function ConnectCallout({ status, connecting, viaMenu, onConnect }: { status: CorosWifiMapStatus | null; connecting: boolean; viaMenu: boolean; onConnect: () => void }) {
  if (!status) return <div className="wifi-maps-connect"><Loader2 size={18} className="spin" aria-hidden="true" /><div><strong>Checking your watch…</strong></div></div>;
  const [title, body, action] = !status.connected
    ? ["Connect your watch", "Plan areas now. Connect to check the size and send them to the watch.", "Connect watch"]
    : !status.supported
      ? [`${watchDisplayName(status.deviceName)} isn’t supported`, "CorosLink doesn't recognize this watch model yet. Use COROS Maps for it.", null]
      : ["Sign in to COROS", "The watch only accepts map downloads from a signed-in COROS account.", viaMenu ? "Open watch menu" : "Reconnect"];
  return <>
    <div className="wifi-maps-connect">
      <Bluetooth size={18} aria-hidden="true" />
      <div><strong>{title}</strong><p>{body}</p></div>
    </div>
    {action ? <button type="button" className="primary-button wifi-maps-download" disabled={connecting} onClick={onConnect}>
      {connecting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Bluetooth size={16} aria-hidden="true" />}{action}
    </button> : null}
  </>;
}

function PlaceSearch({ api, onPick }: { api: CorosLinkApi; onPick: (place: RouteGeocodeResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RouteGeocodeResult[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sequence = useRef(0);

  const close = () => { setResults([]); setMessage(null); };
  const pick = (place: RouteGeocodeResult) => { close(); setQuery(placeParts(place.label).primary); onPick(place); };
  const search = async () => {
    const text = query.trim();
    if (text.length < 3) { setResults([]); setMessage("Type at least three letters."); return; }
    const id = ++sequence.current;
    setSearching(true); setMessage(null);
    try {
      const found = await api.searchRouteLocations(text);
      if (id !== sequence.current) return;
      if (found.length === 1) { pick(found[0]!); return; }
      setResults(found.slice(0, 6)); setActive(0);
      if (!found.length) setMessage(`No places found for “${text}”.`);
    } catch (error) {
      if (id === sequence.current) { setResults([]); setMessage(apiErrorMessage(error, "Could not search for this place.")); }
    } finally { if (id === sequence.current) setSearching(false); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { close(); return; }
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(current => (current + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    } else if (event.key === "Enter") { event.preventDefault(); pick(results[active]!); }
  };

  return <form className="wifi-maps-search" role="search" onSubmit={event => { event.preventDefault(); void search(); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
    <div className="wifi-maps-search-field">
      <Search size={16} aria-hidden="true" />
      <input aria-label="Find a city or place" placeholder="Find a city or place" value={query} onKeyDown={onKeyDown}
        role="combobox" aria-expanded={results.length > 0} aria-controls="wifi-maps-results" aria-autocomplete="list"
        aria-activedescendant={results.length ? `wifi-maps-result-${active}` : undefined}
        onChange={event => { setQuery(event.target.value); setMessage(null); }} />
      {searching ? <Loader2 size={15} className="spin wifi-maps-search-spinner" aria-label="Searching" />
        : query ? <button type="button" className="wifi-maps-search-icon" aria-label="Clear search" onClick={() => { setQuery(""); close(); }}><X size={15} aria-hidden="true" /></button> : null}
      <button type="submit" className="wifi-maps-search-submit" disabled={searching || !query.trim()}>Find</button>
    </div>
    {results.length ? <ul className="wifi-maps-results" id="wifi-maps-results" role="listbox" aria-label="Places">
      {results.map((place, index) => {
        const parts = placeParts(place.label);
        return <li key={`${place.lat},${place.lon},${index}`} id={`wifi-maps-result-${index}`} role="option" aria-selected={index === active}>
          <button type="button" tabIndex={-1} className={index === active ? "wifi-maps-result is-active" : "wifi-maps-result"}
            onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => pick(place)}>
            <MapPin size={15} aria-hidden="true" />
            <span><strong>{parts.primary}</strong>{parts.secondary ? <small>{parts.secondary}</small> : null}</span>
          </button>
        </li>;
      })}
    </ul> : message ? <p className="wifi-maps-search-message" role="status">{message}</p> : null}
  </form>;
}

interface PickerProps {
  tiles: CorosWifiMapTile[];
  highlight: string | null;
  full: boolean;
  locked: boolean;
  focus: FocusRequest | null;
  initialView: SavedView | null;
  onToggle: (tile: CorosWifiMapTile) => void;
  onHover: (tile: CorosWifiMapTile | null) => void;
  onZoom: (zoom: number) => void;
  onViewChange: (view: SavedView) => void;
}

// Fixed colours: the OSM base map is light in both app themes.
const GRID_LINE = "#34444e";
const PICK_STROKE = "#0f8a66";
const PICK_FILL = "#2fbe91";
const BLOCKED = "#7d868e";

function tileLatLngBounds(tiles: CorosWifiMapTile[]) {
  return L.latLngBounds(tiles.flatMap(tile => {
    const area = corosMapTileBounds(tile);
    return [[area.south, area.west], [area.north, area.east]] as [number, number][];
  }));
}

function WifiAreaPicker(props: PickerProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const redraw = useRef<() => void>(() => {});
  const latest = useRef(props); latest.current = props;
  const [picking, setPicking] = useState((props.initialView?.zoom ?? DEFAULT_VIEW.zoom) >= GRID_MIN_ZOOM);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      zoomControl: false, maxZoom: 12, minZoom: 2, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 0.9
    });
    map.current = instance;
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    const base = ROUTE_BASE_LAYERS.street;
    L.tileLayer(base.url, { attribution: base.attribution, maxZoom: base.maxZoom }).addTo(instance);
    const renderer = L.canvas({ padding: 0.25 });
    const gridLayer = L.layerGroup().addTo(instance);
    const selectedLayer = L.layerGroup().addTo(instance);
    const hoverLayer = L.layerGroup().addTo(instance);
    let hoverKey = "";
    let pointer: L.LatLng | null = null;

    const drawGrid = () => {
      gridLayer.clearLayers();
      if (instance.getZoom() < GRID_MIN_ZOOM) return;
      const view = instance.getBounds().pad(0.15);
      const start = corosMapTileAt(view.getNorth(), Math.max(-180, view.getWest()));
      const end = corosMapTileAt(view.getSouth(), Math.min(179.999, view.getEast()));
      const north = corosMapTileBounds({ x: 0, y: start.y }).north, south = corosMapTileBounds({ x: 0, y: end.y }).south;
      const west = corosMapTileBounds({ x: start.x, y: 0 }).west, east = corosMapTileBounds({ x: end.x, y: 0 }).east;
      const lines: [number, number][][] = [];
      for (let x = start.x; x <= end.x + 1; x++) { const lon = corosMapTileBounds({ x, y: 0 }).west; lines.push([[north, lon], [south, lon]]); }
      for (let y = start.y; y <= end.y + 1; y++) { const lat = corosMapTileBounds({ x: 0, y }).north; lines.push([[lat, west], [lat, east]]); }
      L.polyline(lines, { renderer, interactive: false, color: GRID_LINE, weight: 1, opacity: 0.32 }).addTo(gridLayer);
    };
    const drawSelection = () => {
      selectedLayer.clearLayers();
      const { tiles, highlight } = latest.current;
      const badges = instance.getZoom() >= GRID_MIN_ZOOM;
      tiles.forEach((tile, index) => {
        const area = corosMapTileBounds(tile), lit = key(tile) === highlight;
        L.rectangle([[area.south, area.west], [area.north, area.east]], {
          renderer, interactive: false, color: PICK_STROKE, weight: lit ? 3 : 2, fillColor: PICK_FILL, fillOpacity: lit ? 0.45 : 0.3
        }).addTo(selectedLayer);
        if (badges) L.marker([(area.north + area.south) / 2, (area.east + area.west) / 2], {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: lit ? "wifi-maps-badge is-highlighted" : "wifi-maps-badge", html: `<span>${index + 1}</span>`, iconSize: [24, 24] })
        }).addTo(selectedLayer);
      });
    };
    const drawHover = (force = false) => {
      const { tiles, full, locked, onHover } = latest.current;
      if (!pointer || locked || instance.getZoom() < GRID_MIN_ZOOM) {
        if (hoverKey) { hoverKey = ""; hoverLayer.clearLayers(); onHover(null); }
        return;
      }
      const tile = corosMapTileAt(pointer.lat, pointer.lng), id = key(tile);
      if (id === hoverKey && !force) return;
      hoverKey = id;
      hoverLayer.clearLayers();
      const selected = tiles.some(value => key(value) === id), blocked = !selected && full, area = corosMapTileBounds(tile);
      L.rectangle([[area.south, area.west], [area.north, area.east]], {
        renderer, interactive: false, color: blocked ? BLOCKED : PICK_STROKE, weight: 2, dashArray: selected ? "6 4" : undefined,
        fillColor: blocked ? BLOCKED : PICK_FILL, fillOpacity: selected ? 0.08 : blocked ? 0.1 : 0.18
      }).addTo(hoverLayer);
      onHover(tile);
    };
    redraw.current = () => { drawSelection(); drawHover(true); };

    instance.on("zoomend", () => {
      const zoom = instance.getZoom();
      setPicking(zoom >= GRID_MIN_ZOOM);
      latest.current.onZoom(zoom);
      drawSelection();
    });
    instance.on("moveend", () => {
      drawGrid(); drawHover(true);
      const center = instance.getCenter();
      latest.current.onViewChange({ lat: +center.lat.toFixed(4), lon: +center.lng.toFixed(4), zoom: instance.getZoom() });
    });
    instance.on("mousemove", event => { pointer = event.latlng; drawHover(); });
    instance.on("mouseout", () => { pointer = null; drawHover(); });
    instance.on("click", event => {
      if (latest.current.locked) return;
      if (instance.getZoom() < GRID_MIN_ZOOM) { instance.setView(event.latlng, GRID_MIN_ZOOM + 1); return; }
      latest.current.onToggle(corosMapTileAt(event.latlng.lat, event.latlng.lng));
    });

    const { initialView, tiles } = latest.current;
    if (initialView) instance.setView([initialView.lat, initialView.lon], initialView.zoom);
    else if (tiles.length) instance.fitBounds(tileLatLngBounds(tiles), { padding: [48, 48], maxZoom: 7 });
    else instance.setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
    latest.current.onZoom(instance.getZoom());
    drawGrid(); drawSelection();

    const observer = new ResizeObserver(() => instance.invalidateSize()); observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; redraw.current = () => {}; };
  }, []);

  useEffect(() => { redraw.current(); }, [props.tiles, props.highlight, props.full, props.locked]);
  useEffect(() => {
    const instance = map.current, focus = props.focus;
    if (!instance || !focus) return;
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if ("tiles" in focus) {
      if (focus.tiles.length) instance.flyToBounds(tileLatLngBounds(focus.tiles), { padding: [64, 64], maxZoom: 7, animate, duration: 0.6 });
    } else instance.flyTo([focus.lat, focus.lon], Math.max(instance.getZoom(), 7), { animate, duration: 0.6 });
  }, [props.focus]);

  return <div className={picking ? "wifi-maps-canvas is-picking" : "wifi-maps-canvas is-zoomed-out"} ref={container}
    role="application" aria-label="Map of download areas. Click a square to add or remove it." />;
}
