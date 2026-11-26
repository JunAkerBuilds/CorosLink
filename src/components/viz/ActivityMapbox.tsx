"use client";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PlacedPoint } from "@/data/activities";
import { kmMarkers, routeLngLatAt, routeLngLatSlice, type Span } from "@/lib/activities";
import { baseAlpha, basemapConfig, isStandard, mapStyle, type RouteMapLight, type RouteMapType } from "@/lib/routeMap";
import { useTheme } from "@/lib/theme";
import { t } from "@/lib/i18n";

type LineData = Parameters<mapboxgl.GeoJSONSource["setData"]>[0];
const line = (coordinates: [number, number][]): LineData => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pin = (className: string, text = "") => {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  el.setAttribute("aria-hidden", "true");
  return el;
};
const FIT = { padding: 56, duration: 600 } as const;

/**
 * The route on a real Mapbox map, in one of the phone app's six map types: the line (bright up to the marker),
 * km marks, start and finish, the marker the charts share and, when a split is chosen, that stretch.
 * Scrolling the page never zooms the map (Ctrl or ⌘ with the wheel does).
 */
export default function ActivityMapbox({ accessToken, route, distanceM, at, span, type, timeOfDay, follow, fit, hue, onFail }: {
  accessToken: string; route: readonly PlacedPoint[]; distanceM: number; at: number | null; span: Span | null;
  type: RouteMapType;
  /** The sky when the activity started, or null to follow the app's light or dark look. */
  timeOfDay: RouteMapLight | null;
  /** Keep the marker in the middle as it moves. */
  follow: boolean;
  /** Goes up each time the whole route should be brought back into view. */
  fit: number;
  hue: string;
  onFail: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const shown = useRef<RouteMapType>(type);
  const here = useRef<mapboxgl.Marker | null>(null);
  const first = useRef({ type, timeOfDay });
  /** Goes up each time a style has finished loading: the route's layers are gone and must be put back. */
  const [styleTick, setStyleTick] = useState(0);
  const { theme } = useTheme();
  const dark = theme === "dark";

  useEffect(() => {
    if (!box.current) return;
    const bounds = new mapboxgl.LngLatBounds();
    route.forEach((p) => bounds.extend([p.lon, p.lat]));
    const start = first.current;
    let map: mapboxgl.Map;
    try {
      const config = basemapConfig({ type: start.type, dark: document.documentElement.dataset.theme === "dark", timeOfDay: start.timeOfDay });
      map = new mapboxgl.Map({
        accessToken, container: box.current, style: mapStyle(start.type), ...(config ? { config: { basemap: config } } : {}), bounds,
        fitBoundsOptions: { padding: FIT.padding }, cooperativeGestures: true, pitchWithRotate: false, dragRotate: false, logoPosition: "bottom-right",
      });
    } catch {
      onFail();
      return;
    }
    let loaded = false;
    map.on("style.load", () => { loaded = true; setStyleTick((v) => v + 1); });
    // Before the first style arrives an error means the token or the network: fall back to the sketch.
    map.on("error", () => { if (!loaded) onFail(); });
    kmMarkers(distanceM).forEach((km) => new mapboxgl.Marker({ element: pin("act-pin", String(km)) }).setLngLat(routeLngLatAt(route, km * 1000)).addTo(map));
    const last = route[route.length - 1];
    new mapboxgl.Marker({ element: pin("act-pin-finish") }).setLngLat([last.lon, last.lat]).addTo(map);
    new mapboxgl.Marker({ element: pin("act-pin-start") }).setLngLat([route[0].lon, route[0].lat]).addTo(map);
    mapRef.current = map;
    shown.current = start.type;
    return () => { here.current = null; mapRef.current = null; map.remove(); };
  }, [accessToken, route, distanceM, onFail]);

  // The type: a new style when it needs one, else the basemap's settings changed in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleTick === 0) return;
    const config = basemapConfig({ type, dark, timeOfDay });
    if (mapStyle(shown.current) !== mapStyle(type)) {
      shown.current = type;
      // The typings ask for two font options the library itself treats as optional.
      map.setStyle(mapStyle(type), (config ? { config: { basemap: config } } : {}) as unknown as Parameters<mapboxgl.Map["setStyle"]>[1]);
    } else {
      shown.current = type;
      if (config) for (const [key, value] of Object.entries(config)) map.setConfigProperty("basemap", key, value);
      if (map.getLayer("route-line")) map.setPaintProperty("route-line", "line-opacity", baseAlpha(type));
    }
    map.easeTo({ pitch: type === "city3d" ? 45 : 0, duration: 400 });
  }, [type, dark, timeOfDay, styleTick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleTick === 0) return;
    const whole = line(route.map((p): [number, number] => [p.lon, p.lat]));
    const done = line(at == null ? [] : routeLngLatSlice(route, 0, at));
    const part = line(span ? routeLngLatSlice(route, span.from, span.to) : []);
    const source = map.getSource<mapboxgl.GeoJSONSource>("route");
    if (source) {
      source.setData(whole);
      map.getSource<mapboxgl.GeoJSONSource>("route-done")?.setData(done);
      map.getSource<mapboxgl.GeoJSONSource>("route-span")?.setData(part);
      return;
    }
    const standard = isStandard(shown.current);
    // Standard: in the middle slot, over roads and under labels. Outdoors: under its first label layer.
    const before = standard ? undefined : map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
    const color = token(`--h-${hue}`) || token("--h-mint");
    // Fully lit, so a night preset doesn't dim the route.
    const common = { type: "line" as const, layout: { "line-cap": "round" as const, "line-join": "round" as const }, ...(standard ? { slot: "middle" } : {}) };
    map.addSource("route", { type: "geojson", data: whole });
    map.addSource("route-done", { type: "geojson", data: done });
    map.addSource("route-span", { type: "geojson", data: part });
    map.addLayer({ ...common, id: "route-edge", source: "route", paint: { "line-color": "rgba(0, 0, 0, 0.3)", "line-width": 7, "line-emissive-strength": 1 } }, before);
    map.addLayer({ ...common, id: "route-line", source: "route", paint: { "line-color": color, "line-width": 4, "line-opacity": baseAlpha(shown.current), "line-emissive-strength": 1 } }, before);
    map.addLayer({ ...common, id: "route-done", source: "route-done", paint: { "line-color": color, "line-width": 4, "line-emissive-strength": 1 } }, before);
    map.addLayer({ ...common, id: "route-span", source: "route-span", paint: { "line-color": "#ffffff", "line-width": 2, "line-emissive-strength": 1 } }, before);
  }, [route, at, span, hue, styleTick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (at == null) { here.current?.remove(); here.current = null; return; }
    const where = routeLngLatAt(route, at);
    here.current ??= new mapboxgl.Marker({ element: pin("act-pin-here") }).setLngLat(where).addTo(map);
    here.current.setLngLat(where);
    if (follow) map.easeTo({ center: where, duration: 250 });
  }, [at, route, follow]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || fit === 0) return;
    const bounds = new mapboxgl.LngLatBounds();
    route.forEach((p) => bounds.extend([p.lon, p.lat]));
    map.fitBounds(bounds, { ...FIT, pitch: shown.current === "city3d" ? 45 : 0 });
  }, [fit, route]);

  return (
    <>
      <div ref={box} className="act-map-gl" />
      <div className="ad-map-zoom">
        <button type="button" aria-label={t("Zoom in")} onClick={() => mapRef.current?.zoomIn()}>+</button>
        <button type="button" aria-label={t("Zoom out")} onClick={() => mapRef.current?.zoomOut()}>−</button>
      </div>
    </>
  );
}
