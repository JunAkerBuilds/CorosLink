import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  GeneratedRoute,
  RouteGeometry,
  RouteWaypoint
} from "../../../electron/types";
import {
  ROUTE_BASE_LAYERS,
  ROUTE_OVERLAY_LAYERS,
  type RouteBaseLayer,
  type RouteOverlayId
} from "./constants";

export type RouteStudioMode = "generate" | "draw" | "explore" | "sketch";
export type SketchCanvasTool = "freehand" | "template" | "text";

interface RouteMapCanvasProps {
  mode: RouteStudioMode;
  baseLayer: RouteBaseLayer;
  overlays: RouteOverlayId[];
  /** Preview route shown in Generate / Explore (and when reviewing saved). */
  route: GeneratedRoute | null;
  /** Live drawn geometry (Draw / Sketch modes). */
  drawGeometry: RouteGeometry | null;
  /** Draggable draw waypoints (Draw / Sketch modes). */
  waypoints: RouteWaypoint[];
  startPin: RouteWaypoint | null;
  destinationPin: RouteWaypoint | null;
  currentLocation: RouteWaypoint | null;
  /** When set, a map click is interpreted as placing this pin. */
  pinTarget: "start" | "destination" | null;
  fitRequestId: number;
  onMapClick: (point: RouteWaypoint) => void;
  onWaypointMove: (index: number, point: RouteWaypoint) => void;
  onWaypointRemove: (index: number) => void;
  /** Active Sketch-mode tool; null outside Sketch mode. */
  sketchTool?: SketchCanvasTool | null;
  /** The original sketch shown as a dashed guide over the snapped route. */
  sketchGhost?: RouteWaypoint[];
  /** Draggable anchor for template/text placement. */
  sketchCenter?: RouteWaypoint | null;
  onSketchStroke?: (points: RouteWaypoint[]) => void;
  onSketchCenterMove?: (point: RouteWaypoint) => void;
}

const START_COLOR = "#4da3ff";
const END_COLOR = "#d89b22";
// Vivid line + white casing so the route pops on any base map rather than
// blending into the teal accent. On the dark map the green already stands out,
// so we keep it there and use red everywhere else.
const ROUTE_COLOR = "#ff3b3b";
const ROUTE_COLOR_DARK = "#2fbe91";
const ROUTE_CASING = "#ffffff";
// Dashed sky-blue guide so the original sketch reads apart from the route.
const SKETCH_GHOST_COLOR = "#7dd3fc";
/** Ignore mousemove samples closer than this (px) to bound stroke size. */
const SKETCH_SAMPLE_MIN_PX = 3;
/** Keeps draggable handles above route paths regardless of redraw order. */
const INTERACTIVE_MARKER_PANE = "route-interactive-markers";

export function RouteMapCanvas({
  mode,
  baseLayer,
  overlays,
  route,
  drawGeometry,
  waypoints,
  startPin,
  destinationPin,
  currentLocation,
  pinTarget,
  fitRequestId,
  onMapClick,
  onWaypointMove,
  onWaypointRemove,
  sketchTool = null,
  sketchGhost = [],
  sketchCenter = null,
  onSketchStroke,
  onSketchCenterMove
}: RouteMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayersRef = useRef<Map<RouteOverlayId, L.TileLayer>>(new Map());
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const waypointLayerRef = useRef<L.LayerGroup | null>(null);
  const sketchLayerRef = useRef<L.LayerGroup | null>(null);
  const lastFitRef = useRef(fitRequestId);
  const fitSignatureRef = useRef<string>("");

  // Keep interaction callbacks in refs so the map is built exactly once.
  const clickRef = useRef(onMapClick);
  const moveRef = useRef(onWaypointMove);
  const removeRef = useRef(onWaypointRemove);
  const strokeRef = useRef(onSketchStroke);
  const centerMoveRef = useRef(onSketchCenterMove);
  const interactiveRef = useRef(false);
  const sketchToolRef = useRef<SketchCanvasTool | null>(null);
  clickRef.current = onMapClick;
  moveRef.current = onWaypointMove;
  removeRef.current = onWaypointRemove;
  strokeRef.current = onSketchStroke;
  centerMoveRef.current = onSketchCenterMove;
  // A click adds/moves a point in Draw mode, drops a pin in Generate mode, or
  // places the shape anchor in Sketch mode (template/text tools).
  interactiveRef.current =
    mode === "draw" ||
    pinTarget !== null ||
    (mode === "sketch" && sketchTool !== "freehand");
  sketchToolRef.current = mode === "sketch" ? sketchTool : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const map = L.map(container, {
      // Floating UI owns the corners; rely on scroll/pinch + double-click zoom.
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: true
    });
    map.setView([39.5, -98.35], 4);
    const markerPane = map.createPane(INTERACTIVE_MARKER_PANE);
    markerPane.style.zIndex = "450";
    mapRef.current = map;
    routeLayerRef.current = L.layerGroup().addTo(map);
    sketchLayerRef.current = L.layerGroup().addTo(map);
    waypointLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (event: L.LeafletMouseEvent) => {
      if (!interactiveRef.current) {
        return;
      }
      clickRef.current({ lat: event.latlng.lat, lon: event.latlng.lng });
    });

    // Freehand sketch capture: with map dragging off, a drag becomes a stroke.
    let sketching = false;
    let strokeSamples: RouteWaypoint[] = [];
    let lastSamplePx: L.Point | null = null;
    let strokePreview: L.Polyline | null = null;

    map.on("mousedown", (event: L.LeafletMouseEvent) => {
      if (sketchToolRef.current !== "freehand") {
        return;
      }
      // Defensive: a waypoint drag's mouseup re-enables map dragging.
      map.dragging.disable();
      sketching = true;
      strokeSamples = [{ lat: event.latlng.lat, lon: event.latlng.lng }];
      lastSamplePx = map.latLngToContainerPoint(event.latlng);
      strokePreview = L.polyline([event.latlng], {
        color: SKETCH_GHOST_COLOR,
        weight: 3,
        opacity: 0.9,
        dashArray: "6 8",
        interactive: false
      }).addTo(map);
    });

    map.on("mousemove", (event: L.LeafletMouseEvent) => {
      if (!sketching) {
        return;
      }
      const px = map.latLngToContainerPoint(event.latlng);
      if (lastSamplePx && px.distanceTo(lastSamplePx) < SKETCH_SAMPLE_MIN_PX) {
        return;
      }
      lastSamplePx = px;
      strokeSamples.push({ lat: event.latlng.lat, lon: event.latlng.lng });
      strokePreview?.addLatLng(event.latlng);
    });

    map.on("mouseup", () => {
      if (!sketching) {
        return;
      }
      sketching = false;
      strokePreview?.remove();
      strokePreview = null;
      if (strokeSamples.length >= 2) {
        strokeRef.current?.(strokeSamples);
      }
      strokeSamples = [];
    });

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
      waypointLayerRef.current = null;
      sketchLayerRef.current = null;
      baseLayerRef.current = null;
      overlayLayersRef.current.clear();
    };
  }, []);

  // Freehand strokes need the pan gesture; give it back on tool/mode change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (mode === "sketch" && sketchTool === "freehand") {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [mode, sketchTool]);

  // Dashed ghost of the original sketch + draggable template/text anchor.
  useEffect(() => {
    const layer = sketchLayerRef.current;
    if (!layer) {
      return;
    }
    layer.clearLayers();
    if (mode !== "sketch") {
      return;
    }
    if (sketchGhost.length >= 2) {
      L.polyline(
        sketchGhost.map((point) => [point.lat, point.lon] as [number, number]),
        {
          color: SKETCH_GHOST_COLOR,
          weight: 3,
          opacity: 0.8,
          dashArray: "6 8",
          lineCap: "round",
          interactive: false
        }
      ).addTo(layer);
    }
    if ((sketchTool === "template" || sketchTool === "text") && sketchCenter) {
      const handle = L.circleMarker([sketchCenter.lat, sketchCenter.lon], {
        pane: INTERACTIVE_MARKER_PANE,
        radius: 9,
        color: "#05080b",
        fillColor: SKETCH_GHOST_COLOR,
        fillOpacity: 0.95,
        weight: 2,
        bubblingMouseEvents: false
      });
      handle.bindTooltip("Drag to move the shape", { direction: "top" });
      makeDraggable(handle, mapRef.current, (lat, lon) =>
        centerMoveRef.current?.({ lat, lon })
      );
      handle.addTo(layer);
    }
  }, [mode, sketchTool, sketchGhost, sketchCenter]);

  // Swap the base tile layer in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const config = ROUTE_BASE_LAYERS[baseLayer];
    const next = L.tileLayer(config.url, {
      maxZoom: config.maxZoom,
      attribution: config.attribution,
      ...(config.subdomains ? { subdomains: config.subdomains } : {})
    });
    // Base layer sits beneath route/overlay panes.
    next.addTo(map);
    next.bringToBack();
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }
    baseLayerRef.current = next;
  }, [baseLayer]);

  // Sync discoverable-route overlays (Waymarked Trails).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const active = overlayLayersRef.current;
    const wanted = new Set(overlays);

    for (const [id, layer] of active) {
      if (!wanted.has(id)) {
        map.removeLayer(layer);
        active.delete(id);
      }
    }
    for (const id of overlays) {
      if (!active.has(id)) {
        const config = ROUTE_OVERLAY_LAYERS[id];
        const layer = L.tileLayer(config.url, {
          maxZoom: config.maxZoom,
          attribution: config.attribution,
          opacity: 0.85
        }).addTo(map);
        active.set(id, layer);
      }
    }
  }, [overlays]);

  // Redraw the route polyline + endpoint markers.
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) {
      return;
    }
    layer.clearLayers();

    const editing = mode === "draw" || mode === "sketch";
    const source = editing ? drawGeometry?.points : route?.points;
    const linePoints = (source ?? [])
      .filter((point) => point.lat !== undefined && point.lon !== undefined)
      .map((point) => [point.lat!, point.lon!] as [number, number]);
    const boundsPoints: Array<[number, number]> = [];

    if (linePoints.length >= 2) {
      // White casing underneath keeps the line readable on light and dark tiles.
      L.polyline(linePoints, {
        color: ROUTE_CASING,
        weight: 8,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(layer);
      L.polyline(linePoints, {
        color: baseLayer === "dark" ? ROUTE_COLOR_DARK : ROUTE_COLOR,
        weight: 4.5,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(layer);
      if (!editing) {
        addEndpoint(layer, linePoints[0]!, START_COLOR);
        addEndpoint(layer, linePoints[linePoints.length - 1]!, END_COLOR);
      }
      boundsPoints.push(...linePoints);
    }

    if (startPin) {
      addPinMarker(layer, startPin, START_COLOR, "Start");
      boundsPoints.push([startPin.lat, startPin.lon]);
    }
    if (destinationPin) {
      addPinMarker(layer, destinationPin, END_COLOR, "Destination");
      boundsPoints.push([destinationPin.lat, destinationPin.lon]);
    }
    if (currentLocation) {
      L.circleMarker([currentLocation.lat, currentLocation.lon], {
        radius: 8,
        color: "#0f172a",
        fillColor: "#7dd3fc",
        fillOpacity: 0.92,
        weight: 3
      })
        .bindTooltip("You are here")
        .addTo(layer);
      boundsPoints.push([currentLocation.lat, currentLocation.lon]);
    }

    // Fit when the user asks (fitRequestId) or the drawn/routed geometry changes
    // meaningfully — but never yank the map on every waypoint tweak.
    const signature = `${mode}:${linePoints.length}:${route?.id ?? ""}`;
    const fitRequested = fitRequestId !== lastFitRef.current;
    const geometryAppeared =
      linePoints.length >= 2 && fitSignatureRef.current === "" && !editing;
    const routeChanged =
      !editing && signature !== fitSignatureRef.current && Boolean(route);
    lastFitRef.current = fitRequestId;
    fitSignatureRef.current = linePoints.length >= 2 ? signature : "";

    if (
      boundsPoints.length > 0 &&
      (fitRequested || geometryAppeared || routeChanged)
    ) {
      map.fitBounds(L.latLngBounds(boundsPoints), {
        padding: [40, 40],
        maxZoom: 15
      });
    }
  }, [
    mode,
    route,
    drawGeometry,
    startPin,
    destinationPin,
    currentLocation,
    fitRequestId,
    baseLayer
  ]);

  // Draggable draw waypoints (Draw / Sketch modes).
  useEffect(() => {
    const layer = waypointLayerRef.current;
    if (!layer) {
      return;
    }
    layer.clearLayers();
    if (mode !== "draw" && mode !== "sketch") {
      return;
    }

    waypoints.forEach((waypoint, index) => {
      const isFirst = index === 0;
      const isLast = index === waypoints.length - 1;
      const marker = L.circleMarker([waypoint.lat, waypoint.lon], {
        pane: INTERACTIVE_MARKER_PANE,
        radius: isFirst || isLast ? 7 : 5,
        color: "#05080b",
        fillColor: isFirst ? START_COLOR : isLast ? END_COLOR : "#f5f5f7",
        fillOpacity: 1,
        weight: 2,
        // Keep marker clicks (remove) from also firing a map click (add point).
        bubblingMouseEvents: false
      });
      marker.bindTooltip(
        `Point ${index + 1} · drag to adjust, click to remove`,
        { direction: "top" }
      );
      const dragState = makeDraggable(
        marker,
        mapRef.current,
        (lat, lon) => moveRef.current(index, { lat, lon }),
        () => sketchToolRef.current === "freehand"
      );
      marker.on("click", (event) => {
        L.DomEvent.stop(event);
        // A click always trails a drag's mouseup — don't treat it as a remove.
        if (dragState.justDragged) {
          dragState.justDragged = false;
          return;
        }
        removeRef.current(index);
      });
      marker.addTo(layer);
    });
  }, [mode, waypoints]);

  const interactive =
    mode === "draw" ||
    pinTarget !== null ||
    (mode === "sketch" && sketchTool !== "freehand");
  const sketching = mode === "sketch" && sketchTool === "freehand";

  /** Fit the map around whatever content is currently on it. */
  const fitToContent = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const points: Array<[number, number]> = [];
    const source =
      mode === "draw" || mode === "sketch" ? drawGeometry?.points : route?.points;
    for (const point of source ?? []) {
      if (point.lat !== undefined && point.lon !== undefined) {
        points.push([point.lat, point.lon]);
      }
    }
    for (const waypoint of waypoints) {
      points.push([waypoint.lat, waypoint.lon]);
    }
    for (const pin of [startPin, destinationPin, currentLocation, sketchCenter]) {
      if (pin) {
        points.push([pin.lat, pin.lon]);
      }
    }
    if (points.length === 0) {
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`route-canvas${interactive ? " is-interactive" : ""}${
          sketching ? " is-sketching" : ""
        }`}
      />
      <div className="route-map-controls">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={fitToContent}
          title="Fit route to view"
          aria-label="Fit route to view"
        >
          <Maximize2 size={15} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

function addEndpoint(
  layer: L.LayerGroup,
  point: [number, number],
  color: string
) {
  L.circleMarker(point, {
    radius: 6,
    color: "#05080b",
    fillColor: color,
    fillOpacity: 1,
    weight: 2
  }).addTo(layer);
}

function addPinMarker(
  layer: L.LayerGroup,
  point: RouteWaypoint,
  color: string,
  label: string
) {
  L.circleMarker([point.lat, point.lon], {
    radius: 7,
    color: "#05080b",
    fillColor: color,
    fillOpacity: 0.95,
    weight: 2
  })
    .bindTooltip(label, { direction: "top" })
    .addTo(layer);
}

/**
 * Leaflet's CircleMarker isn't draggable out of the box; we emulate dragging by
 * following the mouse between mousedown and mouseup while the map drag is off.
 */
interface DragState {
  /** True immediately after a real drag so the trailing click is ignored. */
  justDragged: boolean;
}

function makeDraggable(
  marker: L.CircleMarker,
  map: L.Map | null,
  onMove: (lat: number, lon: number) => void,
  keepMapDraggingDisabled?: () => boolean
): DragState {
  const state: DragState = { justDragged: false };
  if (!map) {
    return state;
  }
  let dragging = false;
  let moved = false;

  marker.on("mousedown", () => {
    dragging = true;
    moved = false;
    map.dragging.disable();
  });

  const onMouseMove = (event: L.LeafletMouseEvent) => {
    if (!dragging) {
      return;
    }
    moved = true;
    marker.setLatLng(event.latlng);
  };

  const onMouseUp = (event: L.LeafletMouseEvent) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    // The freehand sketch tool owns the drag gesture; don't hand it back.
    if (!keepMapDraggingDisabled?.()) {
      map.dragging.enable();
    }
    if (moved) {
      state.justDragged = true;
      onMove(event.latlng.lat, event.latlng.lng);
    }
  };

  map.on("mousemove", onMouseMove);
  map.on("mouseup", onMouseUp);
  marker.on("remove", () => {
    map.off("mousemove", onMouseMove);
    map.off("mouseup", onMouseUp);
  });
  return state;
}
