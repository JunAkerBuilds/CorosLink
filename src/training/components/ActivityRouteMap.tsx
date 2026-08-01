import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Maximize2, X } from "lucide-react";
import type { TrainingHubActivityTrack } from "../../../electron/types";
import {
  ROUTE_BASE_LAYERS,
  ROUTE_OVERLAY_LAYERS,
  type RouteBaseLayer,
  type RouteOverlayId
} from "../../maps/routes/constants";
import { MapLayerControl } from "../../maps/routes/panels";
import { useTheme } from "../../theme/ThemeProvider";
import {
  defineSelectionPreference,
  selectionIsArrayOf,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";

interface ActivityRouteMapProps {
  track?: TrainingHubActivityTrack;
}

interface RouteGeometry {
  latLngs: [number, number][];
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

const ROUTE_COLOR = "#74c08f";
const ROUTE_COLOR_PAPER = "#0f7f5f";
const START_COLOR = "#4da3ff";
const END_COLOR = "#d89b22";
const ROUTE_ANIMATION_MS = 2200;

const ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE =
  defineSelectionPreference<RouteBaseLayer>({
    key: "training.activityRoute.baseLayer",
    defaultValue: "outdoors",
    validate: selectionIsOneOf([
      "street",
      "outdoors",
      "light",
      "dark",
      "topo",
      "satellite"
    ])
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

/** The theme-matched CARTO layer used when no explicit layer is chosen. */
function themeBaseLayer(theme: string): RouteBaseLayer {
  return theme === "paper" ? "light" : "dark";
}

function resolveMapStyle(theme: string, baseLayer?: RouteBaseLayer): MapStyle {
  const layer = baseLayer ?? themeBaseLayer(theme);
  const isDarkGround = layer === "dark" || layer === "satellite";
  return {
    tile: ROUTE_BASE_LAYERS[layer],
    routeColor: isDarkGround ? ROUTE_COLOR : ROUTE_COLOR_PAPER,
    ghostOpacity: isDarkGround ? 0.18 : 0.28
  };
}

function RouteMapCanvas({
  route,
  scrollWheelZoom = false,
  baseLayer,
  overlays,
  ariaLabel
}: {
  route: RouteGeometry;
  scrollWheelZoom?: boolean;
  baseLayer?: RouteBaseLayer;
  overlays?: RouteOverlayId[];
  ariaLabel: string;
}) {
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

  baseLayerPropRef.current = baseLayer;

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !route) {
      return;
    }

    const initialLayer = baseLayerPropRef.current;
    const { tile, routeColor, ghostOpacity } = resolveMapStyle(
      theme,
      initialLayer
    );

    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom
    });

    const tileLayer = L.tileLayer(tile.url, {
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
      color: START_COLOR,
      fillColor: START_COLOR,
      fillOpacity: 1,
      weight: 2
    }).addTo(map);

    map.fitBounds(L.latLngBounds(route.latLngs), { padding: [24, 24] });
    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    ghostLineRef.current = ghostLine;
    routeLineRef.current = routeLine;
    appliedBaseLayerRef.current = initialLayer;

    let animationFrame = 0;
    let animationStart: number | undefined;
    let endMarker: L.CircleMarker | undefined;

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
          color: END_COLOR,
          fillColor: END_COLOR,
          fillOpacity: 1,
          weight: 2
        }).addTo(map);
      }
    };

    animationFrame = window.requestAnimationFrame(animateRoute);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      ghostLineRef.current = null;
      routeLineRef.current = null;
      overlayLayersRef.current.clear();
    };
  }, [route, theme, scrollWheelZoom]);

  // Swap the base tile layer in place so zoom/pan and the route animation
  // survive a layer change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !baseLayer || appliedBaseLayerRef.current === baseLayer) {
      return;
    }

    const { tile, routeColor, ghostOpacity } = resolveMapStyle(
      theme,
      baseLayer
    );
    const next = L.tileLayer(tile.url, {
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
  }, [baseLayer, theme]);

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
  }, [overlays, route, theme, scrollWheelZoom]);

  return (
    <div
      ref={mapContainerRef}
      className="activity-route-map-canvas"
      aria-label={ariaLabel}
    />
  );
}

function RouteLegend() {
  return (
    <span className="activity-route-legend">
      <span className="activity-route-dot is-start" aria-hidden="true" />
      Start
      <span className="activity-route-dot is-end" aria-hidden="true" />
      Finish
    </span>
  );
}

export function ActivityRouteMap({ track }: ActivityRouteMapProps) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [baseLayer, setBaseLayer] = useSelectionPreference(
    ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE,
    themeBaseLayer(theme)
  );
  const [overlays, setOverlays] = useSelectionPreference(
    ACTIVITY_ROUTE_OVERLAYS_PREFERENCE
  );
  const route = useMemo(
    () => (track?.points ? buildRouteGeometry(track.points) : null),
    [track]
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
        <p>No GPS track available for this activity.</p>
      </div>
    );
  }

  return (
    <div className="activity-route-map">
      <RouteMapCanvas route={route} ariaLabel="Activity route map" />
      <div className="activity-route-footer">
        <RouteLegend />
        <button
          type="button"
          className="activity-route-expand"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={13} aria-hidden="true" />
          Expand
        </button>
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
                  <h2 id="activity-route-modal-title">Route</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close expanded map"
                  onClick={() => setExpanded(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <div className="activity-route-modal-body">
                <div className="activity-route-modal-map">
                  <RouteMapCanvas
                    route={route}
                    scrollWheelZoom
                    baseLayer={baseLayer}
                    overlays={overlays}
                    ariaLabel="Expanded activity route map"
                  />
                  <MapLayerControl
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
          document.body
        )}
    </div>
  );
}
