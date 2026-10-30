import { getLocale, useLanguage, t } from "../../i18n/training";
import { useCartoApiKey } from "../../maps/routes/useCartoApiKey";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Maximize2, X } from "lucide-react";
import type { TrainingHubActivityTrack } from "../../../electron/types";
import {
  resolveBaseLayer,
  ROUTE_OVERLAY_LAYERS,
  type RouteBaseLayer,
  type RouteOverlayId
} from "../../maps/routes/constants";
import { MapLayerControl } from "../../maps/routes/panels";
import { useTheme } from "../../theme/ThemeProvider";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import type { RouteCursor } from "../routeCursor";
import type { ActivityStreams } from "../activityStreams";
import { ActivityRouteReadout } from "./ActivityRouteReadout";
import { routeDistanceMarkers, type RouteDistanceMarker } from "../routeDistanceMarkers";
import "../activityRouteMarkers.css";
import {
  defineSelectionPreference,
  selectionIsArrayOf,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";

interface ActivityRouteMapProps {
  track?: TrainingHubActivityTrack;
  /** Controlled expansion: a host can open the full-screen map from its own controls. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Chart hover point and selected stretch to mirror on the inline map. */
  cursor?: RouteCursor;
  /** Per-second samples with GPS: hovering the route reads them out at that spot. */
  probe?: ActivityStreams;
}

/** How close (px) the pointer must come to the line before the readout snaps to it. */
const PROBE_SNAP_PX = 28;
/** Points tested per pointer move; longer tracks are thinned evenly. */
const PROBE_MAX_POINTS = 4000;

interface RouteProbeHit {
  index: number;
  x: number;
  y: number;
  width: number;
}

interface RouteGeometry {
  latLngs: [number, number][];
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

const ROUTE_COLOR = "#74c08f";
const ROUTE_COLOR_PAPER = "#0f7f5f";
const START_COLOR = "#34d399";
const END_COLOR = "#f26d6d";
const MARKER_RING = "#ffffff";
// Gold reads on street, satellite and dark tiles alike, and is not a route colour.
const CURSOR_SEGMENT_COLOR = "#ffc857";
const CURSOR_DOT_RING = "#0b1015";
const ROUTE_ANIMATION_MS = 2200;
// Above the distance chips in the marker pane (600), so the chart cursor
// never hides under one.
const CURSOR_PANE = "activity-route-cursor";
const ACTIVITY_BASE_LAYERS: RouteBaseLayer[] = ["street", "outdoors", "topo", "satellite", "light", "dark"];

const ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE =
  defineSelectionPreference<RouteBaseLayer>({
    key: "training.activityRoute.baseLayer",
    defaultValue: "street",
    validate: selectionIsOneOf(ACTIVITY_BASE_LAYERS)
  });

const ACTIVITY_ROUTE_OVERLAYS_PREFERENCE =
  defineSelectionPreference<RouteOverlayId[]>({
    key: "training.activityRoute.overlays",
    defaultValue: [],
    validate: selectionIsArrayOf(
      selectionIsOneOf(["hiking", "cycling", "mtb"]),
      { unique: true }
    )
  });

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function getPartialRoute(
  latLngs: [number, number][],
  progress: number
): [number, number][] {
  if (latLngs.length === 0) {
    return [];
  }

  if (progress <= 0) {
    return [latLngs[0]!];
  }

  if (progress >= 1) {
    return latLngs;
  }

  let totalDistance = 0;
  const cumulativeDistances = [0];

  for (let index = 1; index < latLngs.length; index += 1) {
    totalDistance += L.latLng(latLngs[index - 1]!).distanceTo(
      L.latLng(latLngs[index]!)
    );
    cumulativeDistances.push(totalDistance);
  }

  if (totalDistance === 0) {
    return latLngs;
  }

  const targetDistance = totalDistance * progress;
  const partialRoute: [number, number][] = [latLngs[0]!];

  for (let index = 1; index < latLngs.length; index += 1) {
    const segmentEnd = cumulativeDistances[index]!;

    if (segmentEnd <= targetDistance) {
      partialRoute.push(latLngs[index]!);
      continue;
    }

    const segmentStart = cumulativeDistances[index - 1]!;
    const segmentLength = segmentEnd - segmentStart;
    const segmentProgress =
      segmentLength > 0 ? (targetDistance - segmentStart) / segmentLength : 1;
    const from = latLngs[index - 1]!;
    const to = latLngs[index]!;

    partialRoute.push([
      from[0] + (to[0] - from[0]) * segmentProgress,
      from[1] + (to[1] - from[1]) * segmentProgress
    ]);
    break;
  }

  return partialRoute;
}

function buildRouteGeometry(
  points: TrainingHubActivityTrack["points"]
): RouteGeometry | null {
  const routePoints = points.filter(
    (point) => point.lat !== undefined && point.lon !== undefined
  );

  if (routePoints.length < 2) {
    return null;
  }

  const lats = routePoints.map((point) => point.lat!);
  const lons = routePoints.map((point) => point.lon!);

  return {
    latLngs: routePoints.map((point) => [point.lat!, point.lon!]),
    bounds: {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons)
    }
  };
}

interface MapStyle {
  tile: { url: string; maxZoom: number; subdomains?: string; attribution: string };
  routeColor: string;
  ghostOpacity: number;
}

function resolveMapStyle(theme: string, baseLayer?: RouteBaseLayer, cartoApiKey = ""): MapStyle {
  const layer = baseLayer ?? "street";
  const isDarkGround = layer === "dark" || layer === "satellite" || (layer === "street" && theme !== "paper");
  return {
    tile: resolveBaseLayer(layer, cartoApiKey),
    routeColor: isDarkGround ? ROUTE_COLOR : ROUTE_COLOR_PAPER,
    ghostOpacity: isDarkGround ? 0.18 : 0.28
  };
}

function distanceMarkerIcon(label: string): L.DivIcon {
  // A zero-size anchor; the chip centres itself so two-digit labels stay on the point.
  return L.divIcon({
    className: "activity-route-distance-marker",
    html: `<span>${label}</span>`,
    iconSize: [0, 0]
  });
}

function RouteMapCanvas({
  route,
  distanceMarkers,
  scrollWheelZoom = false,
  baseLayer,
  overlays,
  ariaLabel,
  cursor,
  probe
}: {
  route: RouteGeometry;
  distanceMarkers: RouteDistanceMarker[];
  scrollWheelZoom?: boolean;
  baseLayer?: RouteBaseLayer;
  overlays?: RouteOverlayId[];
  ariaLabel: string;
  cursor?: RouteCursor;
  probe?: ActivityStreams;
}) {
  useLanguage();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const ghostLineRef = useRef<L.Polyline | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const overlayLayersRef = useRef(new Map<RouteOverlayId, L.TileLayer>());
  // Read by the init effect without retriggering it: layer switches swap
  // tiles in place instead of rebuilding the map.
  const baseLayerPropRef = useRef(baseLayer);
  const appliedBaseLayerRef = useRef(baseLayer);
  const { theme } = useTheme();
  const cartoApiKey = useCartoApiKey();
  const [hit, setHit] = useState<RouteProbeHit | null>(null);

  baseLayerPropRef.current = baseLayer;

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !route) {
      return;
    }

    const initialLayer = baseLayerPropRef.current;
    const { tile, routeColor, ghostOpacity } = resolveMapStyle(
      theme,
      initialLayer, cartoApiKey
    );

    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom
    });
    map.createPane(CURSOR_PANE).style.zIndex = "650";

    const tileLayer = L.tileLayer(tile.url, {
      className: "activity-route-base-tile",
      maxZoom: tile.maxZoom,
      attribution: tile.attribution,
      ...(tile.subdomains ? { subdomains: tile.subdomains } : {})
    }).addTo(map);

    const ghostLine = L.polyline(route.latLngs, {
      color: routeColor,
      weight: 4,
      opacity: ghostOpacity,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    const routeLine = L.polyline([route.latLngs[0]!], {
      color: routeColor,
      weight: 4,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    const start = route.latLngs[0]!;
    const end = route.latLngs[route.latLngs.length - 1]!;

    L.circleMarker(start, {
      radius: 6,
      color: MARKER_RING,
      fillColor: START_COLOR,
      fillOpacity: 1,
      weight: 2
    }).addTo(map);

    // A map mounted inside a closed <dialog> (or any display:none host) has
    // no size yet, so defer the fit until the container is actually laid out.
    let fitted = false;
    const fitRoute = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        map.fitBounds(L.latLngBounds(route.latLngs), { padding: [24, 24] });
        fitted = true;
      }
    };
    fitRoute();
    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    ghostLineRef.current = ghostLine;
    routeLineRef.current = routeLine;
    appliedBaseLayerRef.current = initialLayer;

    let animationFrame = 0;
    let animationStart: number | undefined;
    let endMarker: L.CircleMarker | undefined;
    // Shown with the finish dot: chips ahead of the drawing line look stray.
    const distanceLayer = L.layerGroup(
      distanceMarkers.map((marker) =>
        L.marker(marker.latLng, {
          icon: distanceMarkerIcon(marker.label),
          interactive: false,
          keyboard: false
        })
      )
    );

    const animateRoute = (timestamp: number) => {
      if (animationStart === undefined) {
        animationStart = timestamp;
      }

      const elapsed = timestamp - animationStart;
      const progress = Math.min(elapsed / ROUTE_ANIMATION_MS, 1);
      routeLine.setLatLngs(
        getPartialRoute(route.latLngs, easeOutCubic(progress))
      );

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(animateRoute);
        return;
      }

      if (!endMarker) {
        endMarker = L.circleMarker(end, {
          radius: 6,
          color: MARKER_RING,
          fillColor: END_COLOR,
          fillOpacity: 1,
          weight: 2
        }).addTo(map);
        distanceLayer.addTo(map);
      }
    };

    animationFrame = window.requestAnimationFrame(animateRoute);

    let cursorDot: L.CircleMarker | undefined;
    let cursorSegment: L.Polyline | undefined;
    const applyCursor = () => {
      const { point, segment } = cursor?.get() ?? { point: null, segment: null };
      if (segment && segment.length > 1) {
        if (cursorSegment) {
          cursorSegment.setLatLngs(segment);
        } else {
          cursorSegment = L.polyline(segment, {
            pane: CURSOR_PANE,
            color: CURSOR_SEGMENT_COLOR,
            weight: 6,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
            interactive: false
          }).addTo(map);
        }
        cursorSegment.bringToFront();
      } else if (cursorSegment) {
        cursorSegment.remove();
        cursorSegment = undefined;
      }
      if (point) {
        if (cursorDot) {
          cursorDot.setLatLng(point);
        } else {
          cursorDot = L.circleMarker(point, {
            pane: CURSOR_PANE,
            radius: 7,
            color: CURSOR_DOT_RING,
            weight: 3,
            fillColor: MARKER_RING,
            fillOpacity: 1,
            interactive: false
          }).addTo(map);
        }
        cursorDot.bringToFront();
      } else if (cursorDot) {
        cursorDot.remove();
        cursorDot = undefined;
      }
    };
    const unsubscribeCursor = cursor?.subscribe(applyCursor);
    applyCursor();

    // Route hover: snap the pointer to the nearest sample and read it out. Layer
    // points only change with zoom, so they are projected once per zoom level.
    let probeIndices: number[] = [];
    let probePoints: L.Point[] | null = null;
    let probeFrame = 0;
    let probeEvent: L.LeafletMouseEvent | null = null;
    if (probe?.hasGps) {
      const step = Math.max(1, Math.ceil(probe.length / PROBE_MAX_POINTS));
      for (let index = 0; index < probe.length; index += step) {
        if (Number.isFinite(probe.lat[index]!) && Number.isFinite(probe.lon[index]!)) probeIndices.push(index);
      }
    }
    const clearProbe = () => {
      window.cancelAnimationFrame(probeFrame);
      probeFrame = 0;
      probeEvent = null;
      setHit(null);
      cursor?.set({ point: null });
    };
    const runProbe = () => {
      probeFrame = 0;
      const event = probeEvent;
      if (!event || !probe) return;
      probePoints ??= probeIndices.map((index) => map.latLngToLayerPoint([probe.lat[index]!, probe.lon[index]!]));
      let best = -1;
      let bestDistance = PROBE_SNAP_PX * PROBE_SNAP_PX;
      for (let at = 0; at < probePoints.length; at += 1) {
        const dx = probePoints[at]!.x - event.layerPoint.x;
        const dy = probePoints[at]!.y - event.layerPoint.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = at;
        }
      }
      if (best < 0) {
        setHit(null);
        cursor?.set({ point: null });
        return;
      }
      const index = probeIndices[best]!;
      const latLng: [number, number] = [probe.lat[index]!, probe.lon[index]!];
      const point = map.latLngToContainerPoint(latLng);
      setHit({ index, x: point.x, y: point.y, width: container.clientWidth });
      cursor?.set({ point: latLng });
    };
    const onProbeMove = (event: L.LeafletMouseEvent) => {
      probeEvent = event;
      if (!probeFrame) probeFrame = window.requestAnimationFrame(runProbe);
    };
    const onProbeZoom = () => {
      probePoints = null;
      clearProbe();
    };
    if (probeIndices.length) {
      map.on("mousemove", onProbeMove);
      map.on("mouseout", clearProbe);
      map.on("zoomstart", onProbeZoom);
      map.on("dragstart", clearProbe);
    }

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      if (!fitted) {
        fitRoute();
      }
    });
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(probeFrame);
      setHit(null);
      unsubscribeCursor?.();
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      ghostLineRef.current = null;
      routeLineRef.current = null;
      overlayLayersRef.current.clear();
    };
  }, [route, distanceMarkers, theme, scrollWheelZoom, cartoApiKey, cursor, probe]);

  // Swap the base tile layer in place so zoom/pan and the route animation
  // survive a layer change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !baseLayer || appliedBaseLayerRef.current === baseLayer) {
      return;
    }

    const { tile, routeColor, ghostOpacity } = resolveMapStyle(
      theme,
      baseLayer, cartoApiKey
    );
    const next = L.tileLayer(tile.url, {
      className: "activity-route-base-tile",
      maxZoom: tile.maxZoom,
      attribution: tile.attribution,
      ...(tile.subdomains ? { subdomains: tile.subdomains } : {})
    });
    next.addTo(map);
    next.bringToBack();
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = next;
    map.setMaxZoom(tile.maxZoom);
    ghostLineRef.current?.setStyle({ color: routeColor, opacity: ghostOpacity });
    routeLineRef.current?.setStyle({ color: routeColor });
    appliedBaseLayerRef.current = baseLayer;
  }, [baseLayer, theme, cartoApiKey]);

  // Sync Waymarked Trails overlays with the selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const wanted = overlays ?? [];
    const active = overlayLayersRef.current;

    for (const [id, layer] of active) {
      if (!wanted.includes(id)) {
        map.removeLayer(layer);
        active.delete(id);
      }
    }

    for (const id of wanted) {
      if (active.has(id)) {
        continue;
      }
      const config = ROUTE_OVERLAY_LAYERS[id];
      const layer = L.tileLayer(config.url, {
        maxZoom: config.maxZoom,
        attribution: config.attribution,
        opacity: 0.85
      });
      layer.addTo(map);
      active.set(id, layer);
    }
  }, [overlays, route, theme, scrollWheelZoom, cartoApiKey]);

  const canvas = (
    <div
      ref={mapContainerRef}
      className={`activity-route-map-canvas${(baseLayer ?? "street") === "street" && theme !== "paper" ? " is-dark-street" : ""}${hit ? " is-probing" : ""}`}
      aria-label={ariaLabel}
    />
  );
  if (!probe?.hasGps) return canvas;
  // Leaflet owns the canvas's children, so the readout floats in a wrapper beside it.
  return (
    <div className="activity-route-map-stage">
      {canvas}
      {hit ? <ActivityRouteReadout streams={probe} index={hit.index} x={hit.x} y={hit.y} width={hit.width} /> : null}
    </div>
  );
}

function RouteLegend() {
  useLanguage();
  return (
    <span className="activity-route-legend">
      <span className="activity-route-dot is-start" aria-hidden="true" />
      {t("Start")} <span className="activity-route-dot is-end" aria-hidden="true" />
      {t("Finish")} </span>
  );
}

export function ActivityRouteMap({
  track,
  expanded: expandedProp,
  onExpandedChange,
  cursor,
  probe
}: ActivityRouteMapProps) {
  useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedState, setExpandedState] = useState(false);
  const expanded = expandedProp ?? expandedState;
  const setExpanded = (value: boolean) => {
    setExpandedState(value);
    onExpandedChange?.(value);
  };
  const [savedBaseLayer, setBaseLayer] = useSelectionPreference(
    ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE
  );
  const cartoApiKey = useCartoApiKey();
  const availableLayers = ACTIVITY_BASE_LAYERS.filter(layer => cartoApiKey || (layer !== "light" && layer !== "dark"));
  const baseLayer = availableLayers.includes(savedBaseLayer) ? savedBaseLayer : "street";
  const [overlays, setOverlays] = useSelectionPreference(
    ACTIVITY_ROUTE_OVERLAYS_PREFERENCE
  );
  const route = useMemo(
    () => (track?.points ? buildRouteGeometry(track.points) : null),
    [track, getLocale()]
  );
  const { unitSystem } = useUnitSystem();
  const distanceMarkers = useMemo(
    () => (track?.points ? routeDistanceMarkers(track.points, unitSystem) : []),
    [track, unitSystem]
  );

  useEffect(() => {
    if (!expanded) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  if (!route) {
    return (
      <div className="activity-route-empty">
        <MapPin size={18} aria-hidden="true" />
        <p>{t("No GPS track available for this activity.")}</p>
      </div>
    );
  }

  return (
    <div className="activity-route-map" ref={containerRef}>
      <RouteMapCanvas route={route} distanceMarkers={distanceMarkers} baseLayer={baseLayer} ariaLabel="Activity route map" cursor={cursor} probe={probe} />
      <div className="activity-route-footer">
        <RouteLegend />
        <button
          type="button"
          className="activity-route-expand"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={13} aria-hidden="true" />
          {t("Expand")} </button>
      </div>
      {expanded &&
        createPortal(
          <div
            className="activity-route-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-route-modal-title"
            onClick={() => setExpanded(false)}
          >
            <section
              className="panel activity-route-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="activity-route-modal-header">
                <div className="activity-route-modal-title">
                  <MapPin size={16} aria-hidden="true" />
                  <h2 id="activity-route-modal-title">{t("Route")}</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("Close expanded map")}
                  onClick={() => setExpanded(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <div className="activity-route-modal-body">
                <div className="activity-route-modal-map">
                  <RouteMapCanvas
                    route={route}
                    distanceMarkers={distanceMarkers}
                    scrollWheelZoom
                    baseLayer={baseLayer}
                    overlays={overlays}
                    ariaLabel="Expanded activity route map"
                    probe={probe}
                  />
                  <MapLayerControl
                    layers={availableLayers}
                    value={baseLayer}
                    onChange={setBaseLayer}
                    overlays={overlays}
                    onToggleOverlay={(id) =>
                      setOverlays((prev) =>
                        prev.includes(id)
                          ? prev.filter((overlay) => overlay !== id)
                          : [...prev, id]
                      )
                    }
                  />
                </div>
                <div className="activity-route-footer">
                  <RouteLegend />
                </div>
              </div>
            </section>
          </div>,
          containerRef.current?.closest("dialog") ?? document.body
        )}
    </div>
  );
}
