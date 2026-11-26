// The map Maps draws on: MapLibre GL over OpenStreetMap data (OpenFreeMap's vector tiles, OpenTopoMap, Esri imagery),
// with no account or token. One map per screen. Also the OpenStreetMap trail overlays (Waymarked Trails).
import { useEffect, useRef, useState, type RefObject } from "react";
import type * as maplibregl from "maplibre-gl";
import { t, tx } from "@/lib/i18n";

export type BaseMap = "street" | "outdoors" | "topo" | "satellite" | "light" | "dark";
export const BASE_MAPS: { value: BaseMap; swatch: string }[] = [
  { value: "street", swatch: "#e9e3d6" },
  { value: "outdoors", swatch: "#b9d3a5" },
  { value: "topo", swatch: "#e5dcbf" },
  { value: "satellite", swatch: "#3d4a33" },
  { value: "light", swatch: "#eceeee" },
  { value: "dark", swatch: "#262a2b" },
];
/** A base map's name, in the app's language (read when shown). */
export const baseMapName = (b: BaseMap) => ({
  street: tx("base map", "Street"), outdoors: tx("base map", "Outdoors"), topo: tx("base map", "Topo"),
  satellite: tx("base map", "Satellite"), light: tx("base map", "Light"), dark: tx("base map", "Dark"),
})[b];

type Style = NonNullable<maplibregl.MapOptions["style"]>;
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
/** The font our own labels use; OpenFreeMap serves it for every style here. */
export const LABEL_FONT = ["Noto Sans Bold"];

const raster = (id: string, tiles: string[], attribution: string, maxzoom: number): Style => ({
  version: 8,
  glyphs: GLYPHS,
  sources: { [id]: { type: "raster", tiles, tileSize: 256, maxzoom, attribution } },
  layers: [{ id, type: "raster", source: id }],
});

export function baseStyle(base: BaseMap): Style {
  switch (base) {
    case "street": return "https://tiles.openfreemap.org/styles/bright";
    case "outdoors": return "https://tiles.openfreemap.org/styles/liberty";
    case "topo": return raster("topo", ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), "© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors", 17);
    case "satellite": return raster("imagery", ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], "Imagery © Esri, Maxar, Earthstar Geographics", 19);
    case "light": return "https://tiles.openfreemap.org/styles/positron";
    case "dark": return "https://tiles.openfreemap.org/styles/dark";
  }
}

export type Overlay = "hike" | "cycle" | "mtb";
const OVERLAY_TILES: Record<Overlay, string> = { hike: "hiking", cycle: "cycling", mtb: "mtb" };
export const overlayColor: Record<Overlay, string> = { hike: "#e8590c", cycle: "#1c7ed6", mtb: "#9c36b5" };

/** Puts the chosen trail overlays on the map (and takes the others off). Call again after every style change. */
export function setOverlays(map: maplibregl.Map, on: Record<Overlay, boolean>, before?: string) {
  for (const kind of Object.keys(OVERLAY_TILES) as Overlay[]) {
    const id = `trails-${kind}`;
    if (on[kind] && !map.getSource(id)) {
      map.addSource(id, { type: "raster", tiles: [`https://tile.waymarkedtrails.org/${OVERLAY_TILES[kind]}/{z}/{x}/{y}.png`], tileSize: 256, attribution: "© waymarkedtrails.org" });
      map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.85 } }, before && map.getLayer(before) ? before : undefined);
    } else if (!on[kind] && map.getSource(id)) {
      map.removeLayer(id);
      map.removeSource(id);
    }
  }
}

export type MapState = { map: maplibregl.Map | null; problem: string | null; ready: number };

/**
 * A map in `box`, made once. `ready` goes up each time a style has finished loading (the screen's own layers must
 * then be added again).
 */
export function useMap(box: RefObject<HTMLDivElement | null>, options: { style: Style; center: [number, number]; zoom: number }): MapState {
  const [state, setState] = useState<MapState>({ map: null, problem: null, ready: 0 });
  const first = useRef(options);
  useEffect(() => {
    let live = true;
    let map: maplibregl.Map | null = null;
    void (async () => {
      const [lib, worker] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"), import("maplibre-gl/dist/maplibre-gl.css")]);
      if (!live || !box.current) return;
      // MapLibre finds its worker next to its own file, which isn't where the build puts it: hand it the bundled one.
      if (lib.getWorkerUrl() !== worker.default) lib.setWorkerUrl(worker.default);
      try {
        map = new lib.Map({
          container: box.current, style: first.current.style, center: first.current.center, zoom: first.current.zoom,
          dragRotate: false, pitchWithRotate: false, attributionControl: { compact: true },
        });
      } catch {
        setState((s) => ({ ...s, problem: t("This computer can't draw the map (WebGL is off).") }));
        return;
      }
      const made = map, el = box.current;
      made.on("style.load", () => live && setState((s) => ({ ...s, ready: s.ready + 1 })));
      // The box gets its size after the map is made (and changes with the window): keep the canvas filling it.
      const fit = new ResizeObserver(() => made.resize());
      fit.observe(el);
      made.once("remove", () => fit.disconnect());
      // Says when every tile on screen has drawn (screenshots and checks wait for it).
      made.on("idle", () => { el.dataset.map = "idle"; });
      made.on("movestart", () => { el.dataset.map = "busy"; });
      setState((s) => ({ ...s, map: made }));
    })();
    return () => { live = false; map?.remove(); };
  }, [box]);
  return state;
}

export const lngLat = (p: [number, number] | [number, number, number]): [number, number] => [p[1], p[0]];
