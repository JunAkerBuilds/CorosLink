import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { MapPin } from "lucide-react";
import type { TrainingHubActivityTrack } from "../../../electron/types";

interface ActivityRouteMapProps {
  track?: TrainingHubActivityTrack;
}

interface RouteGeometry {
  latLngs: [number, number][];
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

const ROUTE_COLOR = "#74c08f";
const START_COLOR = "#4da3ff";
const END_COLOR = "#d89b22";
const ROUTE_ANIMATION_MS = 2200;

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

export function ActivityRouteMap({ track }: ActivityRouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const route = useMemo(
    () => (track?.points ? buildRouteGeometry(track.points) : null),
    [track]
  );

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !route) {
      return;
    }

    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);

    L.polyline(route.latLngs, {
      color: ROUTE_COLOR,
      weight: 4,
      opacity: 0.18,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    const routeLine = L.polyline([route.latLngs[0]!], {
      color: ROUTE_COLOR,
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
    };
  }, [route]);

  if (!route) {
    return (
      <div className="activity-route-empty">
        <MapPin size={18} aria-hidden="true" />
        <p>No GPS track available for this activity.</p>
      </div>
    );
  }

  const centerLat = (route.bounds.minLat + route.bounds.maxLat) / 2;
  const centerLon = (route.bounds.minLon + route.bounds.maxLon) / 2;
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${centerLat}&mlon=${centerLon}#map=14/${centerLat}/${centerLon}`;

  return (
    <div className="activity-route-map">
      <div
        ref={mapContainerRef}
        className="activity-route-map-canvas"
        aria-label="Activity route map"
      />
      <div className="activity-route-footer">
        <span className="activity-route-legend">
          <span className="activity-route-dot is-start" aria-hidden="true" />
          Start
          <span className="activity-route-dot is-end" aria-hidden="true" />
          Finish
        </span>
        <a href={mapsUrl} target="_blank" rel="noreferrer">
          Open in OpenStreetMap
        </a>
      </div>
    </div>
  );
}
