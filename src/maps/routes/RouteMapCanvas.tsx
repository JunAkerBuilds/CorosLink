import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

export type RouteStudioMode = "generate" | "draw" | "explore";

interface RouteMapCanvasProps {
  mode: RouteStudioMode;
  baseLayer: RouteBaseLayer;
  overlays: RouteOverlayId[];
  /** Preview route shown in Generate / Explore (and when reviewing saved). */
  route: GeneratedRoute | null;
  /** Live drawn geometry (Draw mode). */
  drawGeometry: RouteGeometry | null;
  /** Draggable draw waypoints (Draw mode). */
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
}

const START_COLOR = "#4da3ff";
const END_COLOR = "#d89b22";
// Vivid line + white casing so the route pops on any base map rather than
// blending into the teal accent. On the dark map the green already stands out,
// so we keep it there and use red everywhere else.
const ROUTE_COLOR = "#ff3b3b";
const ROUTE_COLOR_DARK = "#2fbe91";
const ROUTE_CASING = "#ffffff";

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
  onWaypointRemove
}: RouteMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayersRef = useRef<Map<RouteOverlayId, L.TileLayer>>(new Map());
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const waypointLayerRef = useRef<L.LayerGroup | null>(null);
  const lastFitRef = useRef(fitRequestId);
  const fitSignatureRef = useRef<string>("");

  // Keep interaction callbacks in refs so the map is built exactly once.
  const clickRef = useRef(onMapClick);
  const moveRef = useRef(onWaypointMove);
  const removeRef = useRef(onWaypointRemove);
  const interactiveRef = useRef(false);
  clickRef.current = onMapClick;
  moveRef.current = onWaypointMove;
  removeRef.current = onWaypointRemove;
  // A click adds/moves a point in Draw mode, or drops a pin in Generate mode.
  interactiveRef.current = mode === "draw" || pinTarget !== null;

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
    mapRef.current = map;
    routeLayerRef.current = L.layerGroup().addTo(map);
    waypointLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (event: L.LeafletMouseEvent) => {
      if (!interactiveRef.current) {
        return;
      }
      clickRef.current({ lat: event.latlng.lat, lon: event.latlng.lng });
    });

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
      waypointLayerRef.current = null;
      baseLayerRef.current = null;
      overlayLayersRef.current.clear();
    };
  }, []);

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

    const source = mode === "draw" ? drawGeometry?.points : route?.points;
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
      addEndpoint(layer, linePoints[0]!, START_COLOR);
      addEndpoint(layer, linePoints[linePoints.length - 1]!, END_COLOR);
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
      linePoints.length >= 2 && fitSignatureRef.current === "" && mode !== "draw";
    const routeChanged =
      mode !== "draw" && signature !== fitSignatureRef.current && Boolean(route);
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

  // Draggable draw waypoints (Draw mode only).
  useEffect(() => {
    const layer = waypointLayerRef.current;
    if (!layer) {
      return;
    }
    layer.clearLayers();
    if (mode !== "draw") {
      return;
    }

    waypoints.forEach((waypoint, index) => {
      const isFirst = index === 0;
      const isLast = index === waypoints.length - 1;
      const marker = L.circleMarker([waypoint.lat, waypoint.lon], {
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
      const dragState = makeDraggable(marker, mapRef.current, (lat, lon) =>
        moveRef.current(index, { lat, lon })
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

  const interactive = mode === "draw" || pinTarget !== null;
  return (
    <div
      ref={containerRef}
      className={`route-canvas${interactive ? " is-interactive" : ""}`}
    />
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
  onMove: (lat: number, lon: number) => void
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
    map.dragging.enable();
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
