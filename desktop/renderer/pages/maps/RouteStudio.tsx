// Route Studio, from the design's RouteStudio board: a full map with the modes (Generate, Draw, Sketch, Explore) and
// the tools panel over it, the map controls and base-map picker on the right, Saved routes in a drawer, and the stats
// bar with the elevation profile along the bottom. Routes are planned by the main process (BRouter + Nominatim, or
// OpenRouteService with a key), kept on this computer and sent to the watch over Bluetooth.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as maplibregl from "maplibre-gl";
import type {
  Elevation, LatLon, MapsWatch, Place, RouteCandidate, RouteGeometry, RouteKind, RouteSport, RouteSync, RoutingConfig, SavedRoute,
  SavedRouteSummary, Surface, TrailRoute,
} from "../../../maps/types";
import {
  cancelRouteSync, deleteAllRoutes, deleteRoute, generate, gpxHref, heights, importGpx, km, listRoutes, loadRoute, placeAt, renameRoute,
  routeLeg, routeSync, routingConfig, said, saveRoute, searchPlaces, setRouting, shortDate, sketch, syncRoute, trail, trailsIn,
} from "../../maps";
import { MapsIcon } from "./MapsIcon";
import { BASE_MAPS, baseStyle, lngLat, overlayColor, setOverlays, useMap, type BaseMap, type Overlay } from "./basemap";
import { clock, estimate, joinLegs, pointAt, profile, shares, straightLeg, SURFACE_LABEL, terrain, WAY_LABEL } from "./routeMath";
import { place, SHAPES, shapeOutline, TEXT_CHARS, textOutline, type ShapeId, type Unit } from "./sketchShapes";

type Mode = "generate" | "draw" | "sketch" | "explore";
const MODES: { value: Mode; label: string; icon: string }[] = [
  { value: "generate", label: "Generate", icon: "sparkle" },
  { value: "draw", label: "Draw", icon: "pen" },
  { value: "sketch", label: "Sketch", icon: "scribble" },
  { value: "explore", label: "Explore", icon: "compass" },
];
const SPORTS: { value: RouteSport; label: string; icon: string }[] = [
  { value: "run", label: "Run", icon: "run" }, { value: "walk", label: "Walk", icon: "walk" }, { value: "hike", label: "Hike", icon: "hike" },
  { value: "road", label: "Road", icon: "bike" }, { value: "mtb", label: "MTB", icon: "mtb" },
];
const SPORT_LABEL: Record<RouteSport, string> = { run: "Run", walk: "Walk", hike: "Hike", road: "Road", mtb: "MTB" };
const SURFACES: { value: Surface; label: string }[] = [{ value: "road", label: "Road" }, { value: "mixed", label: "Mixed" }, { value: "trail", label: "Trail" }];
const ELEVATIONS: { value: Elevation; label: string }[] = [{ value: "any", label: "Any" }, { value: "flat", label: "Flatter" }, { value: "hilly", label: "Hilly" }];
const ELEVATION_LINE: Record<Elevation, string> = { any: "Any elevation", flat: "Flatter", hilly: "Hilly" };
const PRESETS = [5, 10, 21.1, 42.2];
const PAGE = 6;
const START_VIEW = { center: [-122.335, 47.608] as [number, number], zoom: 12 };

/** The route on show and where it came from. */
interface Current { route: RouteGeometry; source: SavedRoute["source"]; kind: RouteKind; sport: RouteSport; name: string; savedId?: string }

function Seg<T extends string>({ label, value, options, onChange, icons }: {
  label: string; value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void; icons?: boolean;
}) {
  return (
    <div className="seg mp-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {icons && o.icon && <MapsIcon name={o.icon} size={15} />}{o.label}
        </button>
      ))}
    </div>
  );
}

function setLine(map: maplibregl.Map, id: string, lines: [number, number][][]) {
  const data = { type: "FeatureCollection" as const, features: lines.filter((l) => l.length > 1).map((coordinates) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } })) };
  const source = map.getSource<maplibregl.GeoJSONSource>(id);
  if (source) source.setData(data);
}

function addLineLayers(map: maplibregl.Map) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  for (const id of ["rs-alt", "rs-sketch", "rs-route", "rs-peek"]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: empty });
  if (!map.getLayer("rs-alt")) map.addLayer({ id: "rs-alt", type: "line", source: "rs-alt", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#53cba1", "line-width": 4, "line-opacity": 0.35 } });
  if (!map.getLayer("rs-sketch")) map.addLayer({ id: "rs-sketch", type: "line", source: "rs-sketch", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f08c00", "line-width": 3, "line-dasharray": [1.5, 1.5] } });
  if (!map.getLayer("rs-route-case")) map.addLayer({ id: "rs-route-case", type: "line", source: "rs-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0b2b20", "line-width": 8, "line-opacity": 0.55 } });
  if (!map.getLayer("rs-route")) map.addLayer({ id: "rs-route", type: "line", source: "rs-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#53cba1", "line-width": 5 } });
  if (!map.getLayer("rs-peek")) map.addLayer({ id: "rs-peek", type: "line", source: "rs-peek", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 4, "line-dasharray": [2, 1.2] } });
}

function dot(className: string, text = ""): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

export default function RouteStudio({ watch }: { watch: MapsWatch | null | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState<BaseMap>("outdoors");
  const { map, problem: mapProblem, ready } = useMap(box, { style: baseStyle("outdoors"), ...START_VIEW });
  const [mode, setMode] = useState<Mode>("generate");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Settings shared by the modes.
  const [sport, setSport] = useState<RouteSport>("run");
  const [kind, setKind] = useState<RouteKind>("loop");
  const [surface, setSurface] = useState<Surface>("mixed");
  const [elevation, setElevation] = useState<Elevation>("any");
  const [distanceKm, setDistanceKm] = useState(10);
  const [start, setStart] = useState<Place | null>(null);
  const [end, setEnd] = useState<Place | null>(null);
  const [picking, setPicking] = useState<null | "start" | "end">(null);

  // Generate
  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [chosen, setChosen] = useState(0);
  const [peek, setPeek] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const seed = useRef(0);

  // Draw
  const [snap, setSnap] = useState(true);
  const [points, setPoints] = useState<LatLon[]>([]);
  const [legs, setLegs] = useState<RouteGeometry[]>([]);
  type Step = { points: LatLon[]; legs: RouteGeometry[] };
  const [history, setHistory] = useState<{ undo: Step[]; redo: Step[] }>({ undo: [], redo: [] });
  const [pointMenu, setPointMenu] = useState<{ index: number; x: number; y: number } | null>(null);

  // Sketch
  const [sketchTool, setSketchTool] = useState<"free" | "shapes" | "text">("shapes");
  const [shape, setShape] = useState<ShapeId>("heart");
  const [text, setText] = useState("");
  const [sizeM, setSizeM] = useState(2400);
  const [rotation, setRotation] = useState(0);
  const [fidelity, setFidelity] = useState<"loose" | "balanced" | "strict">("balanced");
  const [sketchCenter, setSketchCenter] = useState<LatLon | null>(null);
  const [freeStroke, setFreeStroke] = useState<Unit[]>([]);
  const [match, setMatch] = useState<{ score: number; note: string } | null>(null);

  // Explore
  const [overlays, setOverlayState] = useState<Record<Overlay, boolean>>({ hike: true, cycle: false, mtb: false });
  const [trails, setTrails] = useState<TrailRoute[] | null>(null);

  // What's on show, saved routes, the watch
  const [current, setCurrent] = useState<Current | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState<{ routes: SavedRouteSummary[]; total: number }>({ routes: [], total: 0 });
  const [savedPage, setSavedPage] = useState(0);
  const [savedQuery, setSavedQuery] = useState("");
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [sync, setSync] = useState<RouteSync | null>(null);
  const [baseOpen, setBaseOpen] = useState(false);
  const [makeupOpen, setMakeupOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [routing, setRoutingState] = useState<RoutingConfig | null>(null);
  const [orsKey, setOrsKey] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => setProblem(said(e));
  const act = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setProblem(null);
    try { await work(); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const loadSaved = useCallback((page = savedPage, q = savedQuery) =>
    listRoutes(page * PAGE, PAGE, q).then(setSaved, fail), [savedPage, savedQuery]);
  useEffect(() => { void loadSaved(); }, [loadSaved]);
  useEffect(() => { routingConfig().then(setRoutingState, () => {}); }, []);

  // ---------- the map's own layers ----------
  useEffect(() => {
    if (!map || !ready) return;
    addLineLayers(map);
    setOverlays(map, mode === "explore" || Object.values(overlays).some(Boolean) ? overlays : { hike: false, cycle: false, mtb: false }, "rs-alt");
  }, [map, ready, overlays, mode]);

  const shown: RouteGeometry | null = useMemo(() => {
    if (mode === "draw") return joinLegs(legs);
    return current?.route ?? null;
  }, [mode, legs, current]);

  useEffect(() => {
    if (!map || !ready) return;
    setLine(map, "rs-route", shown ? [shown.points.map(lngLat)] : []);
    const others = mode === "generate" ? candidates.filter((_, i) => i !== chosen).map((c) => c.points.map(lngLat)) : [];
    setLine(map, "rs-alt", others);
    setLine(map, "rs-peek", peek != null && peek !== chosen && candidates[peek] ? [candidates[peek].points.map(lngLat)] : []);
  }, [map, ready, shown, candidates, chosen, peek, mode]);

  // Sketch outline, centred where the map is (or where it was dragged to).
  const outline: Unit[] = useMemo(() => {
    if (sketchTool === "shapes") return shapeOutline(shape);
    if (sketchTool === "text") return textOutline(text);
    return freeStroke;
  }, [sketchTool, shape, text, freeStroke]);
  const placed: LatLon[] = useMemo(() => (sketchCenter && outline.length > 1 ? place(outline, sketchCenter, sizeM, rotation) : []), [outline, sketchCenter, sizeM, rotation]);
  useEffect(() => {
    if (!map || !ready) return;
    setLine(map, "rs-sketch", mode === "sketch" ? [placed.map(lngLat)] : []);
  }, [map, ready, placed, mode]);

  // Markers: start/end (Generate), points (Draw), the elevation cursor.
  const moveRef = useRef<(i: number, ll: LatLon) => Promise<void>>(async () => {});
  const markers = useRef<maplibregl.Marker[]>([]);
  const lib = useRef<typeof maplibregl | null>(null);
  useEffect(() => { void import("maplibre-gl").then((m) => { lib.current = m; }); }, []);
  useEffect(() => {
    if (!map || !lib.current) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const L = lib.current;
    if (mode === "generate") {
      if (start) markers.current.push(new L.Marker({ element: dot("mp-pin mp-pin-start", "A") }).setLngLat([start.lon, start.lat]).addTo(map));
      if (kind === "ab" && end) markers.current.push(new L.Marker({ element: dot("mp-pin mp-pin-end", "B") }).setLngLat([end.lon, end.lat]).addTo(map));
    }
    if (mode === "draw") {
      points.forEach((p, i) => {
        const el = dot(`mp-pin mp-pin-point${i === 0 ? " mp-pin-start" : ""}`, String(i + 1));
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", `Point ${i + 1}`);
        const marker = new L.Marker({ element: el, draggable: true }).setLngLat([p[1], p[0]]).addTo(map);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const r = el.getBoundingClientRect(), host = box.current!.getBoundingClientRect();
          setPointMenu({ index: i, x: r.left - host.left + r.width / 2, y: r.top - host.top });
        });
        marker.on("dragend", () => { const ll = marker.getLngLat(); void moveRef.current(i, [ll.lat, ll.lng]); });
        markers.current.push(marker);
      });
    }
  }, [map, mode, start, end, kind, points, ready]);

  const cursor = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    if (!map || !lib.current) return;
    cursor.current?.remove();
    cursor.current = null;
    if (hover == null || !shown) return;
    const p = shown.points[Math.min(hover, shown.points.length - 1)];
    cursor.current = new lib.current.Marker({ element: dot("mp-pin mp-pin-cursor") }).setLngLat(lngLat(p)).addTo(map);
  }, [hover, shown, map]);

  // ---------- map clicks ----------
  const onMapClick = useRef<(ll: LatLon) => void>(() => {});
  useEffect(() => { onMapClick.current = (ll) => {
    setPointMenu(null); setBaseOpen(false); setMakeupOpen(false);
    if (picking) {
      const which = picking;
      setPicking(null);
      const fallback: Place = { name: `${ll[0].toFixed(4)}, ${ll[1].toFixed(4)}`, lat: ll[0], lon: ll[1] };
      (which === "start" ? setStart : setEnd)(fallback);
      placeAt(ll[0], ll[1]).then((p) => (which === "start" ? setStart : setEnd)({ ...p, lat: ll[0], lon: ll[1] }), () => {});
      return;
    }
    if (mode === "draw") void addPoint(ll);
    if (mode === "sketch" && sketchTool !== "free") setSketchCenter(ll);
  }; });
  useEffect(() => {
    if (!map) return;
    const click = (e: maplibregl.MapMouseEvent) => onMapClick.current([e.lngLat.lat, e.lngLat.lng]);
    map.on("click", click);
    return () => { map.off("click", click); };
  }, [map]);

  // Freehand sketch: drag on the map to draw one stroke.
  useEffect(() => {
    if (!map || mode !== "sketch" || sketchTool !== "free") return;
    map.dragPan.disable();
    let stroke: LatLon[] | null = null;
    const down = (e: maplibregl.MapMouseEvent) => { stroke = [[e.lngLat.lat, e.lngLat.lng]]; };
    const move = (e: maplibregl.MapMouseEvent) => {
      if (!stroke) return;
      stroke.push([e.lngLat.lat, e.lngLat.lng]);
      setLine(map, "rs-sketch", [stroke.map(lngLat)]);
    };
    const up = () => {
      if (!stroke || stroke.length < 3) { stroke = null; return; }
      const lats = stroke.map((p) => p[0]), lons = stroke.map((p) => p[1]);
      const c: LatLon = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
      const cos = Math.cos((c[0] * Math.PI) / 180);
      const spanM = Math.max((Math.max(...lats) - Math.min(...lats)) * 111_320, (Math.max(...lons) - Math.min(...lons)) * 111_320 * cos);
      setFreeStroke(stroke.map((p) => [((p[1] - c[1]) * 111_320 * cos) / (spanM / 2), ((p[0] - c[0]) * 111_320) / (spanM / 2)] as Unit));
      setSketchCenter(c); setSizeM(Math.round(Math.max(200, Math.min(8000, spanM)))); setRotation(0);
      stroke = null;
    };
    map.on("mousedown", down); map.on("mousemove", move); map.on("mouseup", up);
    return () => { map.off("mousedown", down); map.off("mousemove", move); map.off("mouseup", up); map.dragPan.enable(); };
  }, [map, mode, sketchTool]);

  // Base map
  const pickBase = (b: BaseMap) => { setBase(b); map?.setStyle(baseStyle(b)); };

  // ---------- Explore: marked routes in view ----------
  useEffect(() => {
    if (!map || mode !== "explore") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const kinds = (Object.keys(overlays) as Overlay[]).filter((k) => overlays[k]);
        if (map.getZoom() < 10 || !kinds.length) { setTrails(kinds.length ? null : []); return; }
        const b = map.getBounds()!;
        trailsIn({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, kinds).then((a) => setTrails(a.trails), () => setTrails([]));
      }, 500);
    };
    read();
    map.on("moveend", read);
    return () => { clearTimeout(timer); map.off("moveend", read); };
  }, [map, mode, overlays]);

  // ---------- actions ----------
  const fit = useCallback((route: RouteGeometry | null = shown) => {
    if (!map || !lib.current || !route?.points.length) return;
    const b = new lib.current.LngLatBounds();
    route.points.forEach((p) => b.extend(lngLat(p)));
    map.fitBounds(b, { padding: { top: 90, bottom: 210, left: 380, right: 90 }, duration: 600, maxZoom: 15 });
  }, [map, shown]);

  const show = (c: Current | null, fitIt = true) => { setCurrent(c); setHover(null); if (c && fitIt) fit(c.route); };

  const autoSaved = useRef<string | null>(null);
  async function keep(c: Current, replaceAuto = false): Promise<string> {
    if (c.savedId) return c.savedId;
    if (replaceAuto && autoSaved.current) { await deleteRoute(autoSaved.current).catch(() => {}); autoSaved.current = null; }
    const s = await saveRoute({ name: c.name, sport: c.sport, kind: c.kind, source: c.source, route: c.route, waypoints: c.source === "draw" ? points : undefined });
    if (replaceAuto) autoSaved.current = s.id;
    setCurrent({ ...c, savedId: s.id, name: s.name });
    void loadSaved();
    return s.id;
  }

  const locate = (forWhat: "start" | "view") => {
    if (!navigator.geolocation) { setProblem("This computer can't tell where it is."); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const ll: LatLon = [pos.coords.latitude, pos.coords.longitude];
      map?.flyTo({ center: [ll[1], ll[0]], zoom: 14 });
      if (forWhat === "start") {
        setStart({ name: "My location", lat: ll[0], lon: ll[1] });
        placeAt(ll[0], ll[1]).then((p) => setStart({ ...p, lat: ll[0], lon: ll[1] }), () => {});
      }
    }, () => setProblem("Location is off for C-LINK. Pick the start on the map instead."), { timeout: 10_000 });
  };

  const runGenerate = (variation = false) => act("generating", async () => {
    if (!start) { setProblem("Pick where to start first."); return; }
    if (kind === "ab" && !end) { setProblem("Pick where to finish."); return; }
    if (variation) seed.current += 1;
    const { candidates: found } = await generate({
      sport, kind, start: [start.lat, start.lon], end: end ? [end.lat, end.lon] : undefined, distanceKm, surface, elevation, seed: seed.current,
    });
    if (!found.length) { setProblem("No route found here. Try another start or distance."); return; }
    setCandidates(found); setChosen(0); setSettingsOpen(false);
    const c: Current = { route: found[0], source: "generate", kind, sport, name: `${start.name.split(",")[0]} ${kind === "loop" ? "loop" : "to " + (end?.name.split(",")[0] ?? "")}`.trim() };
    show(c);
    await keep(c, true);
  });

  const pickCandidate = (i: number) => {
    setChosen(i);
    const base = current ?? { source: "generate" as const, kind, sport, name: "Route" };
    const c: Current = { ...base, route: candidates[i], savedId: undefined };
    show(c, false);
    void keep(c, true).catch(fail);
  };

  // Draw
  const remember = () => setHistory((h) => ({ undo: [...h.undo.slice(-49), { points, legs }], redo: [] }));
  const leg = (from: LatLon, to: LatLon): Promise<RouteGeometry> =>
    snap ? routeLeg({ sport, surface, from, to, snap: true }) : heights([from, to]).catch(() => straightLeg(from, to));
  async function addPoint(ll: LatLon) {
    remember();
    const next = [...points, ll];
    setPoints(next);
    if (points.length) {
      try { const l = await leg(points.at(-1)!, ll); setLegs((ls) => [...ls, l]); }
      catch (e) { fail(e); setLegs((ls) => [...ls, straightLeg(points.at(-1)!, ll)]); }
    }
    setCurrent(null);
  }
  async function rebuild(next: LatLon[]) {
    setPoints(next);
    const out: RouteGeometry[] = [];
    for (let i = 1; i < next.length; i++) out.push(await leg(next[i - 1], next[i]).catch(() => straightLeg(next[i - 1], next[i])));
    setLegs(out);
    setCurrent(null);
  }
  async function movePoint(i: number, ll: LatLon) {
    remember();
    const next = points.slice(); next[i] = ll;
    const nl = legs.slice();
    if (i > 0) nl[i - 1] = await leg(next[i - 1], ll).catch(() => straightLeg(next[i - 1], ll));
    if (i < next.length - 1) nl[i] = await leg(ll, next[i + 1]).catch(() => straightLeg(ll, next[i + 1]));
    setPoints(next); setLegs(nl); setCurrent(null);
  }
  useEffect(() => { moveRef.current = movePoint; });
  const undo = () => { const s = history.undo.at(-1); if (!s) return; setHistory((h) => ({ undo: h.undo.slice(0, -1), redo: [...h.redo, { points, legs }] })); setPoints(s.points); setLegs(s.legs); };
  const redo = () => { const s = history.redo.at(-1); if (!s) return; setHistory((h) => ({ undo: [...h.undo, { points, legs }], redo: h.redo.slice(0, -1) })); setPoints(s.points); setLegs(s.legs); };
  const closeLoop = () => { if (points.length > 2) void act("routing", async () => addPoint(points[0])); };
  const outAndBack = () => { if (points.length > 1) { remember(); void act("routing", () => rebuild([...points, ...points.slice(0, -1).reverse()])); } };
  const reverse = () => { if (points.length > 1) { remember(); void act("routing", () => rebuild(points.slice().reverse())); } };
  const clearDraw = () => { remember(); setPoints([]); setLegs([]); setCurrent(null); };
  const removePoint = (i: number) => { remember(); setPointMenu(null); void act("routing", () => rebuild(points.filter((_, j) => j !== i))); };
  const startHere = (i: number) => {
    remember(); setPointMenu(null);
    const loop = points.length > 2 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1];
    const ring = loop ? points.slice(0, -1) : points;
    const turned = [...ring.slice(i), ...ring.slice(0, i)];
    void act("routing", () => rebuild(loop ? [...turned, turned[0]] : turned));
  };

  // Sketch
  const runSketch = (auto = false) => act(auto ? "fitting" : "snapping", async () => {
    if (placed.length < 3 || !sketchCenter) { setProblem(sketchTool === "text" ? "Write something to draw first." : "Draw a shape on the map first."); return; }
    const tries = auto ? [[1, 0], [0.9, 0], [1.1, 0], [1, -5], [1, 5]] : [[1, 0]];
    let best: { answer: Awaited<ReturnType<typeof sketch>>; scale: number; turn: number } | null = null;
    for (const [scale, turn] of tries) {
      const answer = await sketch({ sport, outline: place(outline, sketchCenter, sizeM * scale, rotation + turn), fidelity });
      if (!best || answer.match > best.answer.match) best = { answer, scale, turn };
    }
    if (!best) return;
    const outlineM = Math.round(sizeM * best.scale);
    setMatch({ score: best.answer.match, note: auto ? `Best fit: ×${best.scale.toFixed(1)} size, ${best.turn >= 0 ? "+" : ""}${best.turn}° rotation` : "" });
    if (auto) { setSizeM(outlineM); setRotation((r) => (r + best.turn + 360) % 360); }
    const c: Current = { route: best.answer.route, source: "sketch", kind: "loop", sport, name: sketchTool === "text" ? `“${text}” sketch` : `${SHAPES.find((s) => s.id === shape)?.label ?? "Freehand"} sketch` };
    show(c);
  });

  // Explore
  const follow = (t: TrailRoute) => act("loading", async () => {
    const route = await trail(t.id);
    show({ route, source: "explore", kind: "ab", sport: t.kind === "hike" ? "hike" : t.kind === "mtb" ? "mtb" : "road", name: t.name });
  });

  // Saved routes
  const open = (id: string) => act("loading", async () => {
    const r = await loadRoute(id);
    setSavedOpen(false);
    if (r.source === "draw" && r.waypoints?.length) {
      setMode("draw"); setPoints(r.waypoints); setLegs([{ points: r.points, distanceM: r.distanceM, ascentM: r.ascentM, descentM: r.descentM, makeup: r.makeup }]);
      // One leg holds the whole saved line until a point is moved; rebuilding asks the router again only then.
      setHistory({ undo: [], redo: [] });
    }
    show({ route: { points: r.points, distanceM: r.distanceM, ascentM: r.ascentM, descentM: r.descentM, makeup: r.makeup }, source: r.source, kind: r.kind, sport: r.sport, name: r.name, savedId: r.id });
  });

  const onImport = (files: FileList | null) => act("importing", async () => {
    if (!files?.length) return;
    let first: SavedRouteSummary | undefined;
    for (const f of Array.from(files)) { const got = await importGpx(f); first ??= got[0]; }
    await loadSaved(0, "");
    setSavedPage(0);
    if (first) await open(first.id);
  });

  // Sync to watch
  const pollSync = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollSync.current) clearInterval(pollSync.current); }, []);
  const startSync = (id?: string) => act("syncing", async () => {
    const routeId = id ?? (current ? await keep(current) : mode === "draw" && shown ? await keep({ route: shown, source: "draw", kind: "loop", sport, name: "Drawn route" }) : null);
    if (!routeId) return;
    setSync(await syncRoute(routeId));
    if (pollSync.current) clearInterval(pollSync.current);
    pollSync.current = setInterval(async () => {
      const s = await routeSync().catch(() => null);
      if (!s) return;
      setSync(s);
      if (!["connecting", "sending", "checking"].includes(s.state)) { clearInterval(pollSync.current!); pollSync.current = null; void loadSaved(); }
    }, 700);
  });

  const exportGpx = () => act("saving", async () => {
    const source = current ?? (shown ? { route: shown, source: "draw" as const, kind: "loop" as const, sport, name: "Drawn route" } : null);
    if (!source) return;
    const id = await keep(source);
    const a = document.createElement("a");
    a.href = gpxHref(id); a.download = ""; a.click();
  });

  const saveDrawn = () => act("saving", async () => {
    if (!shown) return;
    await keep({ route: shown, source: mode === "sketch" ? "sketch" : "draw", kind: points.length > 2 && points[0] === points.at(-1) ? "loop" : "ab", sport, name: mode === "sketch" ? current?.name ?? "Sketch" : "Drawn route" });
  });

  // ---------- derived ----------
  const prof = useMemo(() => (shown ? profile(shown.points) : null), [shown]);
  const est = shown ? estimate(current?.sport ?? sport, shown.distanceM, shown.ascentM) : null;
  const share = shares(shown?.makeup);
  const isSaved = Boolean(current?.savedId);
  const routeTag = `${SPORT_LABEL[current?.sport ?? sport]} · ${(current?.kind ?? kind) === "loop" ? "Loop" : "A → B"}`;
  const syncing = sync && ["connecting", "sending", "checking"].includes(sync.state);
  const syncShown = sync && sync.state !== "idle";

  const profilePath = useMemo(() => {
    if (!prof) return null;
    const span = Math.max(prof.max - prof.min, 20), W = 1000, H = 100;
    const pts = prof.d.map((d, i) => `${((d / prof.total) * W).toFixed(1)},${(H - ((prof.e[i] - prof.min) / span) * (H - 10) - 4).toFixed(1)}`);
    return { line: `M${pts.join("L")}`, area: `M0,${H}L${pts.join("L")}L${W},${H}Z` };
  }, [prof]);
  const hoverElevation = hover != null && shown ? shown.points[hover]?.[2] : undefined;

  return (
    <section className="mp-studio" aria-label="Route Studio map" data-route={shown ? "" : undefined}>
      <div ref={box} className="mp-studio-map" data-picking={picking ?? undefined} data-free={mode === "sketch" && sketchTool === "free" ? "" : undefined} />
      {mapProblem && <div className="mp-map-problem card"><MapsIcon name="map" size={22} /><span>{mapProblem}</span></div>}

      {mode === "sketch" && placed.length > 1 && sketchTool !== "free" && <span className="mp-float-hint">Click the map to move the shape</span>}
      {mode === "draw" && pointMenu && (
        <div className="mp-pop mp-point-menu" role="menu" aria-label={`Point ${pointMenu.index + 1}`} style={{ left: pointMenu.x, top: pointMenu.y }}>
          <span>Point {pointMenu.index + 1} · drag to adjust</span>
          <button type="button" role="menuitem" onClick={() => removePoint(pointMenu.index)}><MapsIcon name="trash" size={15} />Remove point</button>
          <button type="button" role="menuitem" onClick={() => { setPointMenu(null); closeLoop(); }} disabled={points.length < 3}><MapsIcon name="loop" size={15} />Close loop</button>
          <button type="button" role="menuitem" onClick={() => startHere(pointMenu.index)}><MapsIcon name="pin" size={15} />Start here</button>
        </div>
      )}

      <div className="mp-studio-top">
        <div className="seg mp-modes" role="tablist" aria-label="Route Studio modes">
          {MODES.map((m) => (
            <button key={m.value} type="button" role="tab" aria-selected={mode === m.value} aria-pressed={mode === m.value}
              onClick={() => {
                setMode(m.value); setPointMenu(null); setPicking(null);
                if (m.value === "sketch" && map && !sketchCenter) { const c = map.getCenter(); setSketchCenter([c.lat, c.lng]); }
              }}>
              <MapsIcon name={m.icon} size={15} />{m.label}
            </button>
          ))}
        </div>
        <span className="mp-grow" />
        <div className="mp-glass mp-top-tools">
          <button type="button" className="mp-tool" title="Import one or more GPX files as routes" onClick={() => fileInput.current?.click()}><MapsIcon name="upload" size={15} />Import GPX</button>
          <input ref={fileInput} type="file" accept=".gpx,application/gpx+xml" multiple hidden onChange={(e) => { void onImport(e.target.files); e.target.value = ""; }} />
          <button type="button" className="mp-tool mp-tgl" aria-pressed={savedOpen} onClick={() => setSavedOpen((o) => !o)}><MapsIcon name="bookmark" size={15} />Saved<span className="mp-badge">{saved.total}</span></button>
        </div>
      </div>

      <aside className="mp-glass mp-tools" aria-label="Route tools">
        <h2>{mode === "generate" ? "Generate a route" : mode === "draw" ? "Draw a route" : mode === "sketch" ? "Sketch GPS art" : "Explore trails"}</h2>

        {mode === "generate" && (settingsOpen || !candidates.length ? (
          <div className="mp-steps">
            <div className="mp-step">
              <div className="mp-step-head"><span className="mp-step-n">1</span>Sport &amp; route type</div>
              <div className="mp-opts" role="group" aria-label="Sport">
                {SPORTS.map((s) => <button key={s.value} type="button" className="mp-opt" aria-pressed={sport === s.value} onClick={() => setSport(s.value)}><MapsIcon name={s.icon} size={18} />{s.label}</button>)}
              </div>
              <Seg label="Route type" value={kind} onChange={setKind} options={[{ value: "loop", label: "Loop", icon: "loop" }, { value: "ab", label: "A → B" }]} icons />
            </div>
            <div className="mp-step">
              <div className="mp-step-head"><span className="mp-step-n">2</span>{kind === "loop" ? "Where to start?" : "Start and finish"}</div>
              <PlaceField key={start ? `${start.lat},${start.lon},${start.name}` : "none"} label="Start" value={start} onPick={setStart} picking={picking === "start"} onPickMap={() => setPicking(picking === "start" ? null : "start")} onLocate={() => locate("start")} />
              {kind === "ab" && <PlaceField key={end ? `${end.lat},${end.lon},${end.name}` : "none"} label="Finish" value={end} onPick={setEnd} picking={picking === "end"} onPickMap={() => setPicking(picking === "end" ? null : "end")} />}
            </div>
            <div className="mp-step">
              <div className="mp-step-head"><span className="mp-step-n">3</span>Distance &amp; terrain</div>
              <div className="mp-dist"><span>{distanceKm}</span>km</div>
              <input type="range" min={1} max={sport === "road" || sport === "mtb" ? 150 : 50} step={0.5} value={distanceKm} onChange={(e) => setDistanceKm(Number(e.target.value))} aria-label="Distance" />
              <div className="mp-chips" role="group" aria-label="Distance presets">
                {PRESETS.map((p) => <button key={p} type="button" className="chip" aria-pressed={distanceKm === p} onClick={() => setDistanceKm(p)}>{p === 21.1 ? "21K" : p === 42.2 ? "42K" : `${p}K`}</button>)}
              </div>
              <span className="mp-label">Surface</span>
              <Seg label="Surface" value={surface} onChange={setSurface} options={SURFACES} />
              <span className="mp-label">Elevation</span>
              <Seg label="Elevation" value={elevation} onChange={setElevation} options={ELEVATIONS} />
            </div>
            <div className="mp-row">
              <button type="button" className="btn btn-primary mp-wide" onClick={() => void runGenerate()} disabled={busy === "generating"}>
                <MapsIcon name="sparkle" size={16} />{busy === "generating" ? "Finding routes…" : "Generate route"}
              </button>
              {candidates.length > 0 && <button type="button" className="btn btn-glass mp-icon-btn" aria-label="New variation" title="Try a different loop with the same settings" onClick={() => void runGenerate(true)}><MapsIcon name="refresh" size={16} /></button>}
            </div>
          </div>
        ) : (
          <div className="mp-steps">
            <div className="mp-summary">
              <span className="mp-summary-icon"><MapsIcon name={SPORTS.find((s) => s.value === sport)!.icon} size={18} /></span>
              <span><b>{SPORT_LABEL[sport]} · {kind === "loop" ? "Loop" : "A → B"} · {distanceKm} km</b><small>{start?.name.split(",")[0]} · {SURFACES.find((s) => s.value === surface)!.label} · {ELEVATION_LINE[elevation]}</small></span>
              <button type="button" className="mp-link" onClick={() => setSettingsOpen(true)}>Edit</button>
            </div>
            <div className="mp-pick-head"><span>Pick your loop</span><span className="mp-grow" />
              <button type="button" className="mp-link" title="Try a different loop with the same settings" onClick={() => void runGenerate(true)} disabled={busy === "generating"}><MapsIcon name="refresh" size={14} />New variation</button>
            </div>
            {candidates.map((c, i) => (
              <button key={c.id} type="button" className="mp-opt mp-cand" aria-pressed={chosen === i} onClick={() => pickCandidate(i)} onMouseEnter={() => setPeek(i)} onMouseLeave={() => setPeek(null)}>
                <MapsIcon name={i === 0 ? "sparkle" : c.label === "Flatter" ? "minus" : "mountain"} size={18} />
                <span><b>{c.label}</b><span>{km(c.distanceM)} km <small>↑ {Math.round(c.ascentM)} m</small></span><small>{Math.round(c.carFree * 100)}% car-free · {Math.round(c.paved * 100)}% paved</small></span>
              </button>
            ))}
            <span className="mp-note"><MapsIcon name="info" size={14} />Hover a loop to see it on the map. Saved automatically.</span>
          </div>
        ))}

        {mode === "draw" && (
          <div className="mp-steps">
            <span className="mp-note">Click the map to drop points. Drag any point to reshape, click a point for options.</span>
            <span className="mp-label">Follow paths</span>
            <Seg label="Follow paths" value={snap ? "road" : "free"} onChange={(v) => setSnap(v === "road")} options={[{ value: "road", label: "Snap to roads", icon: "route" }, { value: "free", label: "Freehand", icon: "pen" }]} icons />
            {snap && <><span className="mp-label">Surface</span><Seg label="Surface" value={surface} onChange={setSurface} options={SURFACES} /></>}
            <div className="mp-draw-tools">
              <ToolButton icon="undo" onClick={undo} disabled={!history.undo.length}>Undo</ToolButton>
              <ToolButton icon="redo" onClick={redo} disabled={!history.redo.length}>Redo</ToolButton>
              <ToolButton icon="loop" onClick={closeLoop} disabled={points.length < 3}>Close loop</ToolButton>
              <ToolButton icon="outBack" onClick={outAndBack} disabled={points.length < 2}>Out and back</ToolButton>
              <ToolButton icon="reverse" onClick={reverse} disabled={points.length < 2}>Reverse</ToolButton>
              <ToolButton icon="trash" onClick={clearDraw} disabled={!points.length}>Clear</ToolButton>
            </div>
            <div className="mp-draw-state"><span><b>{points.length} {points.length === 1 ? "point" : "points"}</b>{busy === "routing" ? " · routing…" : points.length > 1 ? " · last change routed" : ""}</span><span className="mp-tag">{snap ? "Snapped" : "Freehand"}</span></div>
          </div>
        )}

        {mode === "sketch" && (
          <div className="mp-steps">
            <Seg label="Sketch tool" value={sketchTool} onChange={(v) => { setSketchTool(v); setMatch(null); }} options={[{ value: "free", label: "Freehand", icon: "pen" }, { value: "shapes", label: "Shapes", icon: "heart" }, { value: "text", label: "Text", icon: "text" }]} icons />
            {sketchTool === "shapes" && (
              <div className="mp-opts mp-shapes" role="group" aria-label="Shape">
                {SHAPES.map((s) => <button key={s.id} type="button" className="mp-opt" aria-label={s.label} title={s.label} aria-pressed={shape === s.id} onClick={() => setShape(s.id)}><MapsIcon name={s.id} size={20} /></button>)}
              </div>
            )}
            {sketchTool === "text" && <input className="field" type="text" aria-label="Text to draw" maxLength={16} placeholder="Write something… (A–Z, 0–9)" value={text} onChange={(e) => { const v = e.target.value.toUpperCase(); if (TEXT_CHARS.test(v)) setText(v); }} />}
            {sketchTool === "free" && <span className="mp-note">Drag on the map. The stroke snaps to streets when you press Snap to streets.</span>}
            <div className="mp-slider"><div><span>Size</span><b>{(sizeM / 1000).toFixed(1)} km</b></div><input type="range" min={200} max={8000} step={100} value={sizeM} onChange={(e) => setSizeM(Number(e.target.value))} aria-label="Size" /></div>
            <div className="mp-slider"><div><span>Rotation</span><b>{rotation}°</b></div><input type="range" min={0} max={355} step={5} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} aria-label="Rotation" /></div>
            <span className="mp-label">Fidelity</span>
            <Seg label="Fidelity" value={fidelity} onChange={setFidelity} options={[{ value: "loose", label: "Loose" }, { value: "balanced", label: "Balanced" }, { value: "strict", label: "Strict" }]} />
            {match && (
              <div className="mp-match">
                <div><span>Shape match</span><span className="mp-grow" /><b>≈ {Math.round(match.score * 100)}%</b></div>
                <div className="mp-bar"><span style={{ width: `${Math.round(match.score * 100)}%` }} /></div>
                {match.note && <small>{match.note}</small>}
              </div>
            )}
            <div className="mp-row">
              <button type="button" className="btn btn-primary mp-wide" onClick={() => void runSketch()} disabled={busy === "snapping" || busy === "fitting"}><MapsIcon name="route" size={16} />{busy === "snapping" ? "Snapping…" : "Snap to streets"}</button>
              <button type="button" className="btn btn-glass" title="Try nearby sizes and rotations, keep the best-matching route" onClick={() => void runSketch(true)} disabled={busy === "snapping" || busy === "fitting"}><MapsIcon name="sparkle" size={16} />{busy === "fitting" ? "Fitting…" : "Auto fit"}</button>
            </div>
          </div>
        )}

        {mode === "explore" && (
          <div className="mp-steps">
            <span className="mp-note">Marked routes from OpenStreetMap.</span>
            {(["hike", "cycle", "mtb"] as Overlay[]).map((k) => {
              const n = trails?.filter((t) => t.kind === k).length;
              return (
                <button key={k} type="button" className="mp-overlay" aria-pressed={overlays[k]} onClick={() => setOverlayState((o) => ({ ...o, [k]: !o[k] }))}>
                  <i style={{ background: overlayColor[k] }} aria-hidden="true" />
                  <span>{k === "hike" ? "Hiking routes" : k === "cycle" ? "Cycle routes" : "MTB routes"}</span>
                  <small>{!overlays[k] ? "Off" : trails == null ? "Zoom in" : n ? `${n} in view` : "None here"}</small>
                </button>
              );
            })}
            <span className="mp-label">In view</span>
            {trails == null ? <span className="mp-note">Zoom in to list the marked routes here.</span> : !trails.length ? <span className="mp-note">No marked routes in view.</span> : (
              <ul className="mp-trails">
                {trails.slice(0, 30).map((t) => (
                  <li key={t.id}>
                    <i style={{ background: overlayColor[t.kind] }} aria-hidden="true" />
                    <span><b>{t.name}</b><small>{[t.distanceKm ? `${t.distanceKm.toFixed(1)} km` : null, t.kind === "hike" ? "hiking" : t.kind === "cycle" ? "cycling" : "MTB", t.network].filter(Boolean).join(" · ")}</small></span>
                    <button type="button" className="mp-link" onClick={() => void follow(t)} disabled={busy === "loading"}>Follow</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode !== "explore" && routing && (
          <details className="mp-advanced">
            <summary><MapsIcon name="gear" size={15} />Advanced routing<span className="mp-grow" /><span className="mp-tag">{routing.engine === "ors" ? "OpenRouteService" : "Keyless"}</span><span className="mp-chev"><MapsIcon name="chevD" size={14} /></span></summary>
            <Seg label="Routing engine" value={routing.engine} onChange={(engine) => { if (engine === "keyless" || routing.hasOrsKey) void setRouting(engine).then(setRoutingState, fail); else setRoutingState({ ...routing, engine }); }}
              options={[{ value: "keyless", label: "Keyless" }, { value: "ors", label: "OpenRouteService" }]} />
            {routing.engine === "keyless" ? <span className="mp-note">Keyless routing uses BRouter &amp; Nominatim — free, no signup.</span> : (
              <div className="mp-row">
                <input className="field" type="password" placeholder={routing.hasOrsKey ? "Key saved" : "OpenRouteService key"} value={orsKey} onChange={(e) => setOrsKey(e.target.value)} aria-label="OpenRouteService key" />
                <button type="button" className="btn btn-glass" disabled={!orsKey.trim()} onClick={() => void setRouting("ors", orsKey.trim()).then((r) => { setRoutingState(r); setOrsKey(""); }, fail)}>Save</button>
              </div>
            )}
          </details>
        )}
        {problem && <p className="mp-problem" role="alert">{problem}</p>}
      </aside>

      <div className="mp-map-controls">
        <div className="mp-glass mp-ctl-col">
          <button type="button" className="mp-ib" aria-label="Zoom in" onClick={() => map?.zoomIn()}><MapsIcon name="plus" size={17} /></button>
          <span aria-hidden="true" />
          <button type="button" className="mp-ib" aria-label="Zoom out" onClick={() => map?.zoomOut()}><MapsIcon name="minus" size={17} /></button>
        </div>
        <div className="mp-glass mp-ctl-col">
          <button type="button" className="mp-ib" aria-label="Fit route to view" onClick={() => fit()} disabled={!shown}><MapsIcon name="fit" size={17} /></button>
          <span aria-hidden="true" />
          <button type="button" className="mp-ib" aria-label="Use my location" onClick={() => locate("view")}><MapsIcon name="locate" size={17} /></button>
        </div>
        <button type="button" className="mp-glass mp-base-btn" aria-label="Change base map" aria-expanded={baseOpen} onClick={() => setBaseOpen((o) => !o)}>
          <MapsIcon name="layers" size={16} />{BASE_MAPS.find((b) => b.value === base)!.label}
        </button>
      </div>
      {baseOpen && (
        <div className="mp-pop mp-base" role="dialog" aria-label="Base map">
          <span className="mp-label">Base map</span>
          <div className="mp-base-grid">
            {BASE_MAPS.map((b) => <button key={b.value} type="button" className="mp-opt" aria-pressed={base === b.value} onClick={() => pickBase(b.value)}><i style={{ background: b.swatch }} aria-hidden="true" />{b.label}</button>)}
          </div>
          <span className="mp-label">Trail overlays</span>
          {(["hike", "cycle", "mtb"] as Overlay[]).map((k) => (
            <label key={k} className="mp-check"><input type="checkbox" checked={overlays[k]} onChange={() => setOverlayState((o) => ({ ...o, [k]: !o[k] }))} />{k === "hike" ? "Hiking routes" : k === "cycle" ? "Cycle routes" : "MTB routes"}</label>
          ))}
        </div>
      )}

      {savedOpen && (
        <aside className="mp-pop mp-saved" aria-label="Saved routes">
          <div className="mp-saved-head">
            <span><b>Saved routes</b><small>{saved.total} {saved.total === 1 ? "route" : "routes"}</small></span>
            <span className="mp-grow" />
            <button type="button" className="mp-link" disabled={!saved.total} onClick={() => { if (confirm("Delete every saved route on this computer? Routes already on your watch stay there.")) void act("deleting", async () => { await deleteAllRoutes(); setSavedPage(0); await loadSaved(0); }); }}>Clear all</button>
            <button type="button" className="mp-ib" aria-label="Close saved routes" onClick={() => setSavedOpen(false)}><MapsIcon name="close" size={16} /></button>
          </div>
          <label className="mp-search"><MapsIcon name="search" size={15} /><input type="search" aria-label="Search saved routes" placeholder="Search saved routes" value={savedQuery} onChange={(e) => { setSavedQuery(e.target.value); setSavedPage(0); }} /></label>
          {saved.routes.length ? (
            <ul className="mp-saved-list">
              {saved.routes.map((r) => (
                <li key={r.id}>
                  <button type="button" className="mp-saved-open" onClick={() => void open(r.id)}>
                    <span className="mp-saved-icon"><MapsIcon name={SPORTS.find((s) => s.value === r.sport)?.icon ?? "route"} size={17} /></span>
                    <span><b>{r.name}</b><small>{km(r.distanceM)} km · {SPORT_LABEL[r.sport]} · {r.kind === "loop" ? "Loop" : "A → B"} · {shortDate(r.createdAt)}</small>
                      {r.onWatch && <small className="mp-on-watch"><MapsIcon name="check" size={12} />On your watch</small>}</span>
                  </button>
                  <span className="mp-row-actions">
                    <button type="button" className="mp-ib" aria-label="Sync to watch" title="Sync to watch" onClick={() => void startSync(r.id)} disabled={Boolean(syncing)}><MapsIcon name="watch" size={16} /></button>
                    <button type="button" className="mp-ib" aria-label="More" aria-expanded={rowMenu === r.id} onClick={() => setRowMenu(rowMenu === r.id ? null : r.id)}><MapsIcon name="more" size={16} /></button>
                    {rowMenu === r.id && (
                      <div className="mp-pop mp-row-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => { setRowMenu(null); void open(r.id); }}><MapsIcon name="map" size={15} />Show on map</button>
                        <button type="button" role="menuitem" onClick={() => { setRowMenu(null); const name = prompt("Route name", r.name)?.trim(); if (name) void renameRoute(r.id, name).then(() => loadSaved(), fail); }}><MapsIcon name="pen" size={15} />Rename</button>
                        <a role="menuitem" href={gpxHref(r.id)} download onClick={() => setRowMenu(null)}><MapsIcon name="download" size={15} />Export GPX</a>
                        <button type="button" role="menuitem" onClick={() => { setRowMenu(null); void deleteRoute(r.id).then(() => loadSaved(), fail); if (current?.savedId === r.id) setCurrent({ ...current, savedId: undefined }); }}><MapsIcon name="trash" size={15} />Delete</button>
                      </div>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="mp-note mp-empty">{savedQuery ? "No routes match." : "Routes you generate, draw or import are kept here."}</p>}
          {saved.total > PAGE && (
            <div className="mp-pager"><span>{savedPage * PAGE + 1}–{Math.min(saved.total, (savedPage + 1) * PAGE)} of {saved.total}</span>
              <span><button type="button" className="mp-ib" aria-label="Previous" disabled={!savedPage} onClick={() => setSavedPage((p) => p - 1)}><MapsIcon name="chevL" size={16} /></button>
                <button type="button" className="mp-ib" aria-label="Next" disabled={(savedPage + 1) * PAGE >= saved.total} onClick={() => setSavedPage((p) => p + 1)}><MapsIcon name="chevR" size={16} /></button></span>
            </div>
          )}
        </aside>
      )}

      {syncShown && sync && (
        <div className="mp-pop mp-sync" role="status">
          <div>
            <span className="mp-sync-icon" data-state={sync.state}><MapsIcon name={sync.state === "done" ? "check" : sync.state === "failed" ? "warn" : "watch"} size={17} /></span>
            <span><b>{sync.state === "done" ? (sync.already ? "Already on your watch" : "On your watch") : sync.state === "failed" ? "Couldn't send the route" : sync.state === "cancelled" ? "Stopped" : `Sending to ${watch?.name ?? "your watch"}`}</b>
              <small>{sync.message ?? sync.name ?? ""}{syncing && sync.percent != null ? ` · ${Math.round(sync.percent)}%` : ""}</small></span>
            <button type="button" className="mp-link" onClick={() => (syncing ? void cancelRouteSync().then(setSync, fail) : setSync(null))}>{syncing ? "Cancel" : "Done"}</button>
          </div>
          {syncing && <div className="mp-bar" role="progressbar" aria-label="Route sync" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sync.percent ?? 0)}><span style={{ width: `${sync.percent ?? 0}%` }} /></div>}
        </div>
      )}

      <section className="mp-glass mp-stats" aria-label="Route stats">
        {shown ? (
          <>
            <div className="mp-stats-row">
              <div className="mp-stat mp-stat-name"><span><MapsIcon name={SPORTS.find((s) => s.value === (current?.sport ?? sport))!.icon} size={14} />{routeTag}</span><b title={current?.name}>{current?.name ?? (mode === "draw" ? "Drawn route" : "Route")}</b></div>
              <Stat label="Distance" value={km(shown.distanceM)} unit=" km" />
              <Stat label="Est. time" value={est!.time} />
              <Stat label={est!.paceUnit.includes("km/h") ? "Speed" : "Pace"} value={est!.pace} unit={est!.paceUnit} />
              <Stat label="Ascent" value={`↑ ${Math.round(shown.ascentM)}`} unit=" m" />
              <Stat label="Descent" value={`↓ ${Math.round(shown.descentM)}`} unit=" m" />
              <Stat label="Terrain" value={terrain(shown.makeup)} />
              {share && (
                <div className="mp-makeup-wrap">
                  <button type="button" className="mp-tgl mp-makeup-btn" aria-pressed={makeupOpen} aria-label="Route makeup" onClick={() => setMakeupOpen((o) => !o)}>
                    <span>Route makeup</span><b>{Math.round(share.carFree * 100)}% car-free</b>
                  </button>
                  {makeupOpen && shown.makeup && (
                    <div className="mp-pop mp-makeup" role="dialog" aria-label="Route makeup">
                      <span className="mp-label">Way types</span>
                      {shown.makeup.ways.filter((w) => w.meters > 0).sort((a, b) => b.meters - a.meters).map((w) => <Share key={w.kind} label={WAY_LABEL[w.kind]} part={w.meters / share.total} />)}
                      <span className="mp-label">Surfaces</span>
                      {shown.makeup.surfaces.filter((s) => s.meters > 0).sort((a, b) => b.meters - a.meters).map((s) => <Share key={s.kind} label={SURFACE_LABEL[s.kind]} part={s.meters / share.surfTotal} />)}
                      <div className="mp-makeup-foot"><span>{shown.makeup.busyMeters < 1000 ? "Low-traffic route" : "Some busy roads"}</span><small>{(shown.makeup.busyMeters / 1000).toFixed(1)} km on busy roads</small><small>{(shown.makeup.retracedMeters / 1000).toFixed(1)} km out-and-back</small></div>
                    </div>
                  )}
                </div>
              )}
              <span className="mp-grow" />
              <div className="mp-stat-actions">
                {(mode === "draw" || mode === "sketch") && !isSaved && <button type="button" className="btn btn-glass" onClick={() => void saveDrawn()} disabled={busy === "saving"}><MapsIcon name="bookmark" size={16} />Save route</button>}
                <button type="button" className="btn btn-primary" onClick={() => void startSync()} disabled={Boolean(syncing) || busy === "syncing"} title={watch?.linked ? undefined : "Turn on Local mode on the Watch page to send routes over Bluetooth"}><MapsIcon name="watch" size={16} />Sync to watch</button>
                <button type="button" className="btn btn-glass mp-icon-btn" aria-label="Export GPX" title="Export GPX" onClick={() => void exportGpx()}><MapsIcon name="download" size={16} /></button>
              </div>
            </div>
            {prof && profilePath ? (
              <div className="mp-elev">
                <div className="mp-elev-head"><span>Elevation</span><small>{Math.round(prof.min)}–{Math.round(prof.max)} m</small><span className="mp-grow" />
                  <small>{hover != null && hoverElevation != null ? `${(prof.total * (hover / Math.max(1, shown.points.length - 1)) / 1000).toFixed(1)} km · ${Math.round(hoverElevation)} m` : `${clock(est!.seconds)} at an easy effort`}</small></div>
                <div className="mp-elev-chart" onMouseLeave={() => setHover(null)}
                  onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(pointAt(shown.points, ((e.clientX - r.left) / r.width) * prof.total)); }}>
                  <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
                    <path d={profilePath.area} className="mp-elev-area" />
                    <path d={profilePath.line} className="mp-elev-line" vectorEffect="non-scaling-stroke" />
                  </svg>
                  {hover != null && <i className="mp-elev-cursor" style={{ left: `${(hoverDistance(shown, hover) / prof.total) * 100}%` }} />}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mp-stats-empty"><MapsIcon name="route" size={18} />{mode === "explore" ? "Follow a marked route to see live stats" : "Pick a start point or draw a route to see live stats"}</div>
        )}
      </section>
    </section>
  );
}

function hoverDistance(route: RouteGeometry, index: number): number {
  return lengthTo(route.points, index);
}
function lengthTo(points: RouteGeometry["points"], index: number): number {
  let run = 0;
  for (let i = 1; i <= index && i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const R = 6_371_000, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    run += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return run;
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div className="mp-stat"><span>{label}</span><b>{value}{unit && <small>{unit}</small>}</b></div>;
}
function Share({ label, part }: { label: string; part: number }) {
  return <div className="mp-share"><span>{label}</span><span className="mp-bar"><span style={{ width: `${Math.round(part * 100)}%` }} /></span><b>{Math.round(part * 100)}%</b></div>;
}
function ToolButton({ icon, onClick, disabled, children }: { icon: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" className="mp-tool" onClick={onClick} disabled={disabled}><span><MapsIcon name={icon} size={16} /></span>{children}</button>;
}

/** A place picked by name (Nominatim, arrows + Enter), on the map, or from this computer's location. */
function PlaceField({ label, value, onPick, picking, onPickMap, onLocate }: {
  label: string; value: Place | null; onPick: (p: Place) => void; picking: boolean; onPickMap: () => void; onLocate?: () => void;
}) {
  const [q, setQ] = useState(value?.name ?? "");
  const [found, setFound] = useState<Place[]>([]);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const asking = open && q.trim().length >= 3 && q !== value?.name;
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => searchPlaces(q.trim()).then((p) => { setFound(p.slice(0, 6)); setAt(0); }, () => setFound([])), 450);
    return () => clearTimeout(timer);
  }, [q, asking]);
  const list = asking ? found : [];
  const choose = (p: Place) => { onPick(p); setQ(p.name); setFound([]); setOpen(false); };
  return (
    <div className="mp-place">
      <span className="mp-place-icon" aria-hidden="true"><MapsIcon name="pin" size={16} /></span>
      <input type="text" aria-label={label} placeholder={label === "Start" ? "Search a place to start" : "Search where to finish"} value={q}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(list.length - 1, i + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
          if (e.key === "Enter" && list[at]) { e.preventDefault(); choose(list[at]); }
        }} />
      {onLocate && <button type="button" className="mp-ib" aria-label="Use my location" title="Use my location" onClick={onLocate}><MapsIcon name="locate" size={16} /></button>}
      <button type="button" className="mp-ib" aria-label="Pick on map" title="Pick on map" aria-pressed={picking} onClick={onPickMap}><MapsIcon name="target" size={16} /></button>
      {list.length > 0 && (
        <ul className="mp-pop mp-place-list" role="listbox" aria-label={`${label} suggestions`}>
          {list.map((p, i) => (
            <li key={`${p.lat},${p.lon}`} role="option" aria-selected={i === at} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
              <b>{p.name.split(",")[0]}</b><small>{p.detail ?? p.name.split(",").slice(1).join(",").trim()}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
