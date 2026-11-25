// Map areas, from the design's MapAreas board: COROS's zoom-7 map squares over a real map (click to pick, 16 at
// most), and on the right the watch, how the maps get there (the watch's own Wi-Fi, or the USB cable), the picked
// areas with their size, what the watch needs before it downloads, and the button. Below the map: what the watch is
// downloading and what's already on it.
import { useEffect, useMemo, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import { MAX_AREA_TILES, quadkey, tileAt, tileBounds, type AreaPreview, type AreasStatus, type MapsWatch, type Tile } from "../../../maps/types";
import { areas, bytes, cancelAreas, placeAt, previewAreas, removeAreas, said, searchPlaces, shortDate, startAreas } from "../../maps";
import { navigate } from "../../router";
import { MapsIcon } from "./MapsIcon";
import { baseStyle, LABEL_FONT, useMap } from "./basemap";
import { StorageBar } from "./StorageBar";
import { watchLine } from "./watchLine";

const key = (t: Tile) => `${t.x},${t.y}`;
const centre = (t: Tile) => { const b = tileBounds(t); return [(b.north + b.south) / 2, (b.west + b.east) / 2] as [number, number]; };
const extent = (t: Tile) => { const b = tileBounds(t); return `${b.south.toFixed(1)}° to ${b.north.toFixed(1)}°, ${b.west.toFixed(1)}° to ${b.east.toFixed(1)}°`; };
const poly = (t: Tile) => { const b = tileBounds(t); return [[[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south], [b.west, b.north]]]; };

function useAreas() {
  const [status, setStatus] = useState<AreasStatus | null>(null);
  const [tick, setTick] = useState(0);
  const active = Boolean(status?.tasks.some((t) => t.state === "downloading" || t.state === "queued") || status?.copy?.state === "copying");
  useEffect(() => {
    let live = true;
    const read = () => areas().then((s) => live && setStatus(s), () => {});
    void read();
    const timer = setInterval(read, active ? 3000 : 15_000);
    return () => { live = false; clearInterval(timer); };
  }, [active, tick]);
  return [status, setStatus, () => setTick((t) => t + 1)] as const;
}

export default function MapAreas({ watch }: { watch: MapsWatch | null | undefined; readWatch: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const { map, problem: mapProblem, ready } = useMap(box, { style: baseStyle("outdoors"), center: [-122.3, 47.6], zoom: 5 });
  const [status, setStatus, reread] = useAreas();
  const [picked, setPicked] = useState<Tile[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [via, setVia] = useState<"wifi" | "usb">("wifi");
  const [previewed, setPreviewed] = useState<{ sig: string; preview: AreaPreview | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [doneNote, setDoneNote] = useState<{ title: string; line: string } | null>(null);

  const onWatch = useMemo(() => new Set(status?.history.flatMap((h) => h.tiles.map(key)) ?? []), [status]);
  const pickedKeys = useMemo(() => new Set(picked.map(key)), [picked]);
  const supports = watch ? watch.areas : true;

  const toggle = (t: Tile) => {
    setProblem(null); setDoneNote(null);
    setPicked((p) => {
      if (p.some((q) => key(q) === key(t))) return p.filter((q) => key(q) !== key(t));
      if (p.length >= MAX_AREA_TILES) { setProblem(`Up to ${MAX_AREA_TILES} areas at a time.`); return p; }
      return [...p, t];
    });
  };

  const toggleRef = useRef(toggle);
  useEffect(() => { toggleRef.current = toggle; });

  // Names for the picked squares, from the place at their middle.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const t of picked) {
      const k = key(t);
      if (asked.current.has(k)) continue;
      asked.current.add(k);
      const [lat, lon] = centre(t);
      placeAt(lat, lon).then((p) => setNames((n) => ({ ...n, [k]: p.name.split(",").slice(0, 2).join(",").trim() || `Area ${quadkey(t)}` })),
        () => setNames((n) => ({ ...n, [k]: `Area ${quadkey(t)}` })));
    }
  }, [picked]);

  // The size COROS gives for the picked squares, checked again a moment after each change.
  const sig = picked.map(key).join(";");
  const preview = previewed?.sig === sig ? previewed.preview : null;
  const checking = picked.length > 0 && previewed?.sig !== sig;
  useEffect(() => {
    if (!picked.length) return;
    let live = true;
    const timer = setTimeout(() => previewAreas(picked).then((p) => live && setPreviewed({ sig, preview: p }),
      (e) => { if (live) { setProblem(said(e)); setPreviewed({ sig, preview: null }); } }), 600);
    return () => { live = false; clearTimeout(timer); };
  }, [picked, sig]);

  // The grid over the map.
  useEffect(() => {
    if (!map || !ready) return;
    const empty = { type: "FeatureCollection" as const, features: [] };
    if (!map.getSource("ma-grid")) map.addSource("ma-grid", { type: "geojson", data: empty });
    if (!map.getSource("ma-nums")) map.addSource("ma-nums", { type: "geojson", data: empty });
    if (!map.getLayer("ma-fill")) map.addLayer({ id: "ma-fill", type: "fill", source: "ma-grid", paint: {
      "fill-color": "#53cba1",
      "fill-opacity": ["case", ["get", "on"], 0.3, ["get", "have"], 0.14, 0],
    } });
    if (!map.getLayer("ma-line")) map.addLayer({ id: "ma-line", type: "line", source: "ma-grid", paint: {
      "line-color": ["case", ["get", "on"], "#53cba1", "#1f2d28"],
      "line-width": ["case", ["get", "on"], 2.5, 1],
      "line-opacity": ["case", ["get", "on"], 1, 0.35],
    } });
    if (!map.getLayer("ma-num")) map.addLayer({ id: "ma-num", type: "symbol", source: "ma-nums", layout: {
      "text-field": ["get", "label"], "text-size": 12, "text-font": LABEL_FONT, "text-allow-overlap": true,
    }, paint: { "text-color": "#04261b", "text-halo-color": "#53cba1", "text-halo-width": 6 } });
  }, [map, ready]);

  const drawGrid = useRef<() => void>(() => {});
  useEffect(() => { drawGrid.current = () => {
    if (!map || !map.getSource("ma-grid")) return;
    const b = map.getBounds()!;
    const nw = tileAt(Math.min(85, b.getNorth()), Math.max(-180, b.getWest())), se = tileAt(Math.max(-85, b.getSouth()), Math.min(179.999, b.getEast()));
    const features = [];
    if ((se.x - nw.x + 1) * (se.y - nw.y + 1) <= 1600) {
      for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) {
        const t = { x, y }, k = key(t);
        features.push({ type: "Feature" as const, properties: { on: pickedKeys.has(k), have: onWatch.has(k) }, geometry: { type: "Polygon" as const, coordinates: poly(t) } });
      }
    }
    for (const t of picked) if (!features.some((f) => f.properties.on && f.geometry.coordinates[0][0][0] === poly(t)[0][0][0] && f.geometry.coordinates[0][0][1] === poly(t)[0][0][1])) {
      features.push({ type: "Feature" as const, properties: { on: true, have: onWatch.has(key(t)) }, geometry: { type: "Polygon" as const, coordinates: poly(t) } });
    }
    map.getSource<maplibregl.GeoJSONSource>("ma-grid")!.setData({ type: "FeatureCollection", features });
    map.getSource<maplibregl.GeoJSONSource>("ma-nums")!.setData({ type: "FeatureCollection", features: [
      ...picked.map((t, i) => ({ type: "Feature" as const, properties: { label: String(i + 1) }, geometry: { type: "Point" as const, coordinates: [centre(t)[1], centre(t)[0]] } })),
      ...[...onWatch].filter((k) => !pickedKeys.has(k)).map((k) => { const [x, y] = k.split(",").map(Number); const c = centre({ x, y }); return { type: "Feature" as const, properties: { label: "On watch" }, geometry: { type: "Point" as const, coordinates: [c[1], c[0]] } }; }),
    ] });
  }; drawGrid.current(); }, [map, ready, picked, onWatch, pickedKeys]);
  useEffect(() => {
    if (!map) return;
    const moved = () => drawGrid.current();
    const click = (e: maplibregl.MapMouseEvent) => toggleRef.current(tileAt(e.lngLat.lat, e.lngLat.lng));
    map.on("moveend", moved); map.on("click", click);
    return () => { map.off("moveend", moved); map.off("click", click); };
  }, [map]);

  const find = async () => {
    if (!query.trim()) return;
    setProblem(null);
    try {
      const [p] = await searchPlaces(query.trim());
      if (!p) { setProblem("No place found by that name."); return; }
      map?.flyTo({ center: [p.lon, p.lat], zoom: 6.5 });
      const t = tileAt(p.lat, p.lon);
      if (!pickedKeys.has(key(t))) toggle(t);
      setNames((n) => ({ ...n, [key(t)]: p.name.split(",").slice(0, 2).join(",").trim() }));
    } catch (e) { setProblem(said(e)); }
  };

  const label = picked.length ? (picked.length === 1 ? names[key(picked[0])] : `${(names[key(picked[0])] ?? "").split(",")[0]} & ${picked.length - 1} more`) ?? "Map areas" : "";
  const copying = status?.copy?.state === "copying";
  const task = status?.tasks.find((t) => t.state === "downloading" || t.state === "queued") ?? status?.tasks[0];
  const linkReady = via === "wifi" ? Boolean(watch?.linked) : Boolean(watch?.usb);
  const needed = via === "usb" && preview?.neededBytes != null ? preview.neededBytes : preview?.sizeBytes;
  const free = watch?.storage?.freeBytes;
  const tooBig = needed != null && free != null && needed > free;
  const blocked = via === "wifi" && status?.readiness && !status.readiness.ready;
  const ctaOff = !picked.length || !preview || busy || !linkReady || !supports || tooBig || Boolean(blocked) || copying;

  const start = async () => {
    if (!preview) return;
    setBusy(true); setProblem(null);
    try {
      const next = await startAreas(preview.id, label || "Map areas", via);
      setStatus(next);
      if (via === "wifi") setDoneNote({ title: "Sent to your watch", line: "It downloads over its saved Wi-Fi network. Keep it charging; progress shows below." });
      setPicked([]);
    } catch (e) { setProblem(said(e)); } finally { setBusy(false); }
  };

  const shown = showAll ? picked : picked.slice(0, 6);

  return (
    <div className="mp-areas">
      <div className="mp-areas-main">
        <section className="card card-clip mp-areas-map" aria-label="Map areas">
          <div ref={box} className="mp-areas-canvas" />
          {mapProblem && <div className="mp-map-problem"><MapsIcon name="map" size={22} /><span>{mapProblem}</span></div>}
          <form role="search" className="mp-glass mp-find" onSubmit={(e) => { e.preventDefault(); void find(); }}>
            <MapsIcon name="search" size={16} />
            <input type="search" aria-label="Find a city or place" placeholder="Find a city or place" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="submit" className="btn btn-glass">Find</button>
          </form>
          <div className="mp-glass mp-ctl-col mp-areas-zoom">
            <button type="button" className="mp-ib" aria-label="Zoom in" onClick={() => map?.zoomIn()}><MapsIcon name="plus" size={17} /></button>
            <span aria-hidden="true" />
            <button type="button" className="mp-ib" aria-label="Zoom out" onClick={() => map?.zoomOut()}><MapsIcon name="minus" size={17} /></button>
          </div>
          <div className="mp-glass mp-areas-hint"><MapsIcon name="info" size={15} /><span>{problem ?? (supports ? "Click squares to add or remove them. Each square is one COROS map tile." : `${watch?.name ?? "This watch"} doesn't take map areas. Use COROS Maps instead.`)}</span></div>
          <div className="mp-glass mp-legend" aria-hidden="true">
            <span><i className="mp-legend-on" />Chosen</span>
            <span><i className="mp-legend-have" />On watch</span>
            <span>1 square = 1 COROS map tile</span>
          </div>
        </section>

        <section className="card card-pad mp-on-watch-card" aria-label="On your watch">
          <div className="mp-card-head"><h2>On your watch</h2><span className="mp-grow" />{status && <small>Checked {new Date(status.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>}</div>
          {task && task.state !== "complete" && (
            <div className="mp-task">
              <div className="mp-task-row">
                <span className="mp-task-icon"><MapsIcon name="wifi" size={17} /></span>
                <span><b>{task.label ?? "Map download"}</b><small>{bytes(task.downloadedBytes)} of {bytes(task.totalBytes)} · Watch Wi-Fi</small></span>
                <span className="mp-tag" data-state={task.state}>{task.state === "queued" ? "Waiting for Wi-Fi" : task.state === "downloading" ? "Downloading" : task.state === "failed" ? `Failed (${task.errorCode})` : "Unknown"}</span>
                <button type="button" className="btn btn-glass" onClick={() => void cancelAreas(task.id).then(setStatus, (e) => setProblem(said(e)))}>Cancel</button>
              </div>
              <div className="mp-bar" role="progressbar" aria-label="Map download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.totalBytes ? Math.round((task.downloadedBytes / task.totalBytes) * 100) : 0}>
                <span style={{ width: `${task.totalBytes ? (task.downloadedBytes / task.totalBytes) * 100 : 0}%` }} />
              </div>
              <small className="mp-note">The watch downloads on its own Wi-Fi, even with C-LINK closed. Keep it charging.</small>
            </div>
          )}
          {doneNote && !task && (
            <div className="mp-done">
              <span className="mp-done-icon"><MapsIcon name="check" size={17} /></span>
              <span><b>{doneNote.title}</b><small>{doneNote.line}</small></span>
              <button type="button" className="btn btn-glass" onClick={() => setDoneNote(null)}>Plan more</button>
            </div>
          )}
          {status?.history.length ? (
            <ul className="mp-history">
              {status.history.map((h) => (
                <li key={h.id}>
                  <span className="mp-task-icon"><MapsIcon name={h.via === "wifi" ? "wifi" : "usb"} size={16} /></span>
                  <span><b>{h.label} is on your watch</b><small>{h.fileCount} map files · {bytes(h.sizeBytes)} · {h.via === "wifi" ? "Watch Wi-Fi" : "USB cable"} · {shortDate(h.at)}</small></span>
                  <button type="button" className="mp-ib" aria-label="Remove from watch" title={watch?.usb ? "Remove from watch" : "Plug the watch in to remove maps"} disabled={!watch?.usb}
                    onClick={() => { if (confirm(`Remove ${h.label} from the watch?`)) void removeAreas(h.id).then(setStatus, (e) => setProblem(said(e))); }}><MapsIcon name="trash" size={16} /></button>
                </li>
              ))}
            </ul>
          ) : !task && <p className="mp-note">Map areas you send from here show up here.</p>}
        </section>
      </div>

      <aside className="mp-areas-side" aria-label="Map plan">
        <section className="card card-pad mp-watch-card" aria-label="Watch">
          <div className="mp-watch-row">
            <span className="mp-watch-icon"><MapsIcon name="watch" size={22} /></span>
            <span><b>{watch?.name ?? "No watch"}<i data-on={watch && (watch.linked || watch.usb) ? "" : undefined} aria-hidden="true" /></b><small>{!watch ? "Turn on Local mode or plug the watch in" : [watchLine(watch), watch.battery != null && `${watch.battery}%${watch.charging ? " · charging" : ""}`].filter(Boolean).join(" · ")}</small></span>
            {watch && <span className="mp-tag">Maps v{watch.mapVersion}</span>}
          </div>
          {watch?.storage && <StorageBar storage={watch.storage} />}
        </section>

        <section className="card card-pad mp-plan" aria-label="Plan">
          <div className="mp-plan-block">
            <span className="mp-label">How the maps get to the watch</span>
            <div className="seg mp-seg" role="group" aria-label="How the maps get to the watch">
              <button type="button" aria-pressed={via === "wifi"} onClick={() => setVia("wifi")}><MapsIcon name="wifi" size={15} />Watch Wi-Fi</button>
              <button type="button" aria-pressed={via === "usb"} onClick={() => setVia("usb")}><MapsIcon name="usb" size={15} />USB cable</button>
            </div>
            <small className="mp-note">{via === "wifi" ? "The watch downloads the maps itself from COROS on its saved Wi-Fi. Nothing big goes through this computer." : watch?.linked && !watch.usb ? "This computer downloads the maps, then copies them over the USB cable. Your Bluetooth link is too slow for maps, so plug the watch in." : "This computer downloads the maps, then copies them onto the plugged-in watch."}</small>
          </div>
          <div className="mp-plan-block">
            <div className="mp-card-head"><h2>Selected areas</h2><small>{picked.length} / {MAX_AREA_TILES}</small><span className="mp-grow" />
              {picked.length > 6 && <button type="button" className="mp-link" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : "Show all"}</button>}
              <button type="button" className="mp-link" onClick={() => setPicked([])} disabled={!picked.length}>Clear</button></div>
            <div className="mp-cap" aria-hidden="true">{Array.from({ length: MAX_AREA_TILES }, (_, i) => <span key={i} data-on={i < picked.length ? "" : undefined} />)}</div>
            {picked.length ? (
              <ol className="mp-sel">
                {shown.map((t, i) => (
                  <li key={key(t)}>
                    <span className="mp-sel-n" aria-hidden="true">{i + 1}</span>
                    <span><b>{names[key(t)] ?? "…"}</b><small>{extent(t)}</small></span>
                    <button type="button" className="mp-ib" aria-label="Remove area" onClick={() => toggle(t)}><MapsIcon name="close" size={15} /></button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mp-empty-sel"><MapsIcon name="map" size={22} /><b>No areas yet</b><small>Search for a place or click squares on the map. Each square is one COROS map tile.</small></div>
            )}
          </div>
          <div className="mp-size">
            <span><b>{via === "usb" && preview?.neededBytes != null ? "To copy" : "Download size"}</b><small>{checking ? "Asking COROS…" : preview ? `${preview.fileCount} map files${free != null ? ` · ${bytes(free)} free on the watch` : ""}` : picked.length ? " " : "Pick areas to see the size"}</small></span>
            <b className="mp-size-big">{preview ? bytes(needed) : "–"}</b>
          </div>
          {tooBig && <p className="mp-problem">More than the watch's free space. Remove some areas or make room first.</p>}
          {via === "wifi" && (
            <div className="mp-checks">
              <span className="mp-label">Before the watch downloads</span>
              <ul>
                <Check ok={Boolean(watch?.linked)} label="Watch linked over Bluetooth" />
                <Check ok={null} label="Saved Wi-Fi network on the watch" />
                <Check ok={status?.readiness ? status.readiness.ready : null} label={status?.readiness && !status.readiness.ready ? status.readiness.reasons[0] : "No USB cable, no activity running"} />
                <Check ok={watch?.charging ?? null} label="Charging" note="Recommended" />
              </ul>
            </div>
          )}
          {copying && status?.copy ? (
            <div className="mp-copy">
              <div className="mp-copy-head"><span>Copying {status.copy.label}</span><b>{status.copy.totalBytes ? Math.round((status.copy.copiedBytes / status.copy.totalBytes) * 100) : 0}%</b></div>
              <div className="mp-bar" role="progressbar" aria-label="Copy progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.copy.totalBytes ? Math.round((status.copy.copiedBytes / status.copy.totalBytes) * 100) : 0}>
                <span style={{ width: `${status.copy.totalBytes ? (status.copy.copiedBytes / status.copy.totalBytes) * 100 : 0}%` }} />
              </div>
              <small>{status.copy.filesDone} of {status.copy.files} files · {bytes(status.copy.copiedBytes)} of {bytes(status.copy.totalBytes)}</small>
              <div className="mp-copy-foot"><small>Keep the watch connected until the copy finishes.</small><button type="button" className="btn btn-glass" onClick={() => void cancelAreas().then(setStatus, (e) => setProblem(said(e)))}>Cancel</button></div>
            </div>
          ) : !linkReady ? (
            <div className="mp-connect">
              <div><MapsIcon name={via === "wifi" ? "watch" : "usb"} size={17} /><b>{via === "wifi" ? "Link the watch first" : "Plug the watch in"}</b></div>
              <small>{via === "wifi" ? watch?.linkNote ?? "Map areas go to the watch over Bluetooth. Turn on Local mode on the Watch page to link it to this computer." : watch?.linked ? "Bluetooth is linked, but maps copy only over the USB cable. Plug the watch in and allow the computer on the watch." : "Connect the watch with its USB cable and allow the computer on the watch."}</small>
              {via === "wifi" ? <button type="button" className="btn btn-glass" onClick={() => navigate("/watch")}>Open Watch</button> : <button type="button" className="btn btn-glass" onClick={reread}>Check again</button>}
            </div>
          ) : (
            <>
              <button type="button" className="btn btn-primary mp-wide" onClick={() => void start()} disabled={ctaOff}>
                <MapsIcon name={via === "wifi" ? "wifi" : "usb"} size={16} />{busy ? "Starting…" : via === "wifi" ? "Send to watch" : "Copy to watch"}
              </button>
              <small className="mp-note mp-center">{via === "wifi" ? "The watch starts when it's on Wi-Fi and idle." : "Only files the watch doesn't have yet are copied."}</small>
            </>
          )}
          {problem && picked.length > 0 && <p className="mp-problem" role="alert">{problem}</p>}
        </section>
      </aside>
    </div>
  );
}

function Check({ ok, label, note }: { ok: boolean | null; label: string; note?: string }) {
  return (
    <li data-ok={ok === true ? "" : undefined} data-bad={ok === false ? "" : undefined}>
      <span aria-hidden="true"><MapsIcon name={ok === false ? "warn" : ok ? "check" : "info"} size={14} /></span>
      <span>{label}</span>{note && <small>{note}</small>}
    </li>
  );
}
