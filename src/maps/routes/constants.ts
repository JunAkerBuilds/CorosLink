import type {
  RouteActivityType,
  RouteElevationPreference
} from "../../../electron/types";
import type { LucideIcon } from "lucide-react";
import {
  Bike,
  Footprints,
  Mountain,
  MountainSnow,
  PersonStanding
} from "lucide-react";

/** A selectable base map style. */
export type RouteBaseLayer =
  | "street"
  | "outdoors"
  | "light"
  | "dark"
  | "topo"
  | "satellite";

export interface TileLayerConfig {
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
  label: string;
  description: string;
}

/**
 * Base tile layers. All are free/keyless. `outdoors` uses CyclOSM, a
 * cycling/outdoor-focused OSM render that pairs well with the Explore overlays.
 */
export const ROUTE_BASE_LAYERS: Record<RouteBaseLayer, TileLayerConfig> = {
  street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    label: "Street",
    description: "Standard OpenStreetMap",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  outdoors: {
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxZoom: 20,
    subdomains: "abc",
    label: "Outdoors",
    description: "CyclOSM — cycling & trails",
    attribution:
      '&copy; <a href="https://www.cyclosm.org">CyclOSM</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    maxZoom: 20,
    subdomains: "abcd",
    label: "Light",
    description: "Clean minimal map",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    maxZoom: 20,
    subdomains: "abcd",
    label: "Dark",
    description: "Low-glare night map",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17,
    subdomains: "abc",
    label: "Topo",
    description: "Contours & terrain",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM, &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    label: "Satellite",
    description: "Aerial imagery",
    attribution:
      'Imagery &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics'
  }
};

export const ROUTE_BASE_LAYER_ORDER: RouteBaseLayer[] = [
  "street",
  "outdoors",
  "topo",
  "satellite",
  "light",
  "dark"
];

/** A discoverable-routes overlay (the "Explore" / Strava-like layer). */
export type RouteOverlayId = "hiking" | "cycling" | "mtb";

export interface OverlayLayerConfig {
  url: string;
  attribution: string;
  maxZoom: number;
  label: string;
  description: string;
  /** Accent colour used in the legend chip. */
  swatch: string;
}

/**
 * Waymarked Trails overlays — free, keyless renders of real-world marked routes
 * from OpenStreetMap. This is the legitimate equivalent of Strava's
 * "here's where people actually go" layer.
 */
export const ROUTE_OVERLAY_LAYERS: Record<RouteOverlayId, OverlayLayerConfig> = {
  hiking: {
    url: "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
    maxZoom: 18,
    label: "Hiking routes",
    description: "Marked walking & hiking trails",
    swatch: "#e2504b",
    attribution:
      '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>'
  },
  cycling: {
    url: "https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png",
    maxZoom: 18,
    label: "Cycle routes",
    description: "National & local cycle networks",
    swatch: "#4b7be2",
    attribution:
      '&copy; <a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a>'
  },
  mtb: {
    url: "https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png",
    maxZoom: 18,
    label: "MTB routes",
    description: "Mountain-bike trail networks",
    swatch: "#d89b22",
    attribution:
      '&copy; <a href="https://mtb.waymarkedtrails.org">Waymarked Trails</a>'
  }
};

export const ROUTE_OVERLAY_ORDER: RouteOverlayId[] = ["hiking", "cycling", "mtb"];

export interface ActivityOption {
  value: RouteActivityType;
  label: string;
  /** Compact label shown in the sport picker cells. */
  shortLabel: string;
  /** Icon shown in the sport picker. */
  icon: LucideIcon;
}

export const ROUTE_ACTIVITY_OPTIONS: ActivityOption[] = [
  { value: "running", label: "Running", shortLabel: "Run", icon: Footprints },
  {
    value: "walking",
    label: "Walking",
    shortLabel: "Walk",
    icon: PersonStanding
  },
  { value: "hiking", label: "Hiking", shortLabel: "Hike", icon: Mountain },
  {
    value: "cycling-road",
    label: "Road cycling",
    shortLabel: "Road",
    icon: Bike
  },
  {
    value: "cycling-mountain",
    label: "Mountain biking",
    shortLabel: "MTB",
    icon: MountainSnow
  }
];

export const ROUTE_ELEVATION_OPTIONS: Array<{
  value: RouteElevationPreference;
  label: string;
}> = [
  { value: "any", label: "Any" },
  { value: "flatter", label: "Flatter" },
  { value: "hilly", label: "Hilly" }
];
