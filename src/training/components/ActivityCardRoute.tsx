import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPin, Mountain } from "lucide-react";
import type { TrainingHubActivity, TrainingHubActivityDetail, TrainingHubActivityTrack } from "../../../electron/types";
import { ROUTE_BASE_LAYERS } from "../../maps/routes/constants";
import { useTheme } from "../../theme/ThemeProvider";

export type ActivityPreviewLoader = (activity: TrainingHubActivity) => Promise<TrainingHubActivityDetail>;

/** Bound background detail requests, and share results when changing views. */
export function createActivityPreviewLoader(load: ActivityPreviewLoader): ActivityPreviewLoader {
  const cache = new Map<string, Promise<TrainingHubActivityDetail>>();
  const queue: (() => void)[] = [];
  let active = 0;
  function drain() {
    while (active < 3 && queue.length) queue.shift()!();
  }
  return activity => {
    const key = `${activity.sportType}:${activity.activityId}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const result = new Promise<TrainingHubActivityDetail>((resolve, reject) => {
      queue.push(() => {
        active++;
        Promise.resolve().then(() => load(activity)).then(resolve, error => {
          cache.delete(key);
          reject(error);
        }).finally(() => { active--; drain(); });
      });
    });
    cache.set(key, result);
    drain();
    return result;
  };
}

function MiniMap({ track }: { track: TrainingHubActivityTrack }) {
  const container = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const points = track.points.filter(point =>
      Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
      Math.abs(point.lat!) <= 90 && Math.abs(point.lon!) <= 180
    ).map(point => [point.lat!, point.lon!] as [number, number]);
    if (points.length < 2) return;
    const map = L.map(element, { zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, touchZoom: false, zoomAnimation: false,
      fadeAnimation: false });
    const layer = ROUTE_BASE_LAYERS.street;
    L.tileLayer(layer.url, { subdomains: layer.subdomains ?? "abc", maxZoom: layer.maxZoom }).addTo(map);
    const color = getComputedStyle(element).getPropertyValue("--activity-color").trim();
    L.polyline(points, { color: theme === "paper" ? "#fff" : "#081012", weight: 5, interactive: false }).addTo(map);
    L.polyline(points, { color, weight: 2.5, interactive: false }).addTo(map);
    for (const [point, fillColor] of [[points[0]!, color], [points.at(-1)!, "#ffb84d"]] as const) {
      L.circleMarker(point, { radius: 4, color: "#fff", weight: 1.5, fillColor, fillOpacity: 1, interactive: false }).addTo(map);
    }
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(points), { padding: [16, 16], maxZoom: 15, animate: false });
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(element);
    return () => { resize.disconnect(); map.remove(); };
  }, [track, theme]);
  return <div className={`activity-card-map${theme === "paper" ? "" : " is-dark"}`} ref={container} aria-hidden="true" />;
}

export function ActivityCardRoute({ activity, load, indoor }: {
  activity: TrainingHubActivity; load: ActivityPreviewLoader; indoor: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ track?: TrainingHubActivityTrack; failed?: boolean } | null>(null);
  useEffect(() => {
    if (indoor) return;
    let cancelled = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      load(activity).then(detail => {
        if (!cancelled) setResult({ track: detail.track });
      }).catch(() => { if (!cancelled) setResult({ failed: true }); });
    }, { rootMargin: "100px" });
    if (container.current) observer.observe(container.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [activity, load, indoor]);
  const validTrack = result?.track && result.track.points.filter(point =>
    Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat!) <= 90 && Math.abs(point.lon!) <= 180
  ).length >= 2 ? result.track : undefined;
  return <div className={`activity-card-route${validTrack ? " has-route" : ""}`} ref={container}>
    {validTrack ? <MiniMap track={validTrack} /> : <div className="activity-card-route-placeholder">
      {indoor ? <Mountain size={26} /> : result ? <MapPin size={23} /> : <Loader2 size={20} className="spin" />}
      <span>{indoor ? "Indoor session" : result?.failed ? "Route preview unavailable" : result ? "No GPS track recorded" : "Loading route…"}</span>
    </div>}
  </div>;
}
