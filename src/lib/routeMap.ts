// How the activity map looks: its type, and the light at the activity's start. Ported from the phone app's
// RouteMapView.swift (RouteMapType, RouteMapLight, RouteMapLook), so both draw the same map for the same choice.
import { msg } from "@/lib/i18n";

export type RouteMapType = "standard" | "city3d" | "monochrome" | "outdoors" | "satellite" | "hybrid";

export const ROUTE_MAP_TYPES: readonly { value: RouteMapType; label: string }[] = [
  { value: "standard", label: msg("Standard") },
  { value: "city3d", label: msg("3D city") },
  { value: "monochrome", label: msg("Monochrome") },
  { value: "outdoors", label: msg("Outdoors") },
  { value: "satellite", label: msg("Satellite") },
  { value: "hybrid", label: msg("Hybrid") },
];

/** Mapbox Standard for the drawn maps, Standard Satellite for imagery, and the classic Outdoors. */
export function mapStyle(type: RouteMapType): string {
  if (type === "outdoors") return "mapbox://styles/mapbox/outdoors-v12";
  return type === "satellite" || type === "hybrid" ? "mapbox://styles/mapbox/standard-satellite" : "mapbox://styles/mapbox/standard";
}

/** Standard's styles have slots for the route and a basemap configuration; the classic Outdoors has neither. */
export const isStandard = (type: RouteMapType): boolean => type !== "outdoors";
export const isImagery = (type: RouteMapType): boolean => type === "satellite" || type === "hybrid";
/** Lit by Standard's light presets: the drawn Standard maps only. */
export const takesLighting = (type: RouteMapType): boolean => isStandard(type) && !isImagery(type);
/** The route still to come: faint on a drawn map, stronger over imagery, where a faint line disappears. */
export const baseAlpha = (type: RouteMapType): number => (isImagery(type) ? 0.55 : 0.3);

export type RouteMapLight = "dawn" | "day" | "dusk" | "night";

const remainder = (a: number, b: number) => a - b * Math.round(a / b);

/**
 * The sun's elevation in degrees, and whether it is before solar noon: NOAA's general solar position
 * formulas, good to a fraction of a degree, from the UTC time alone.
 */
export function sunAt(date: Date, latitude: number, longitude: number): { elevation: number; morning: boolean } {
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const gamma = ((2 * Math.PI) / 365) * (day - 1 + (minutes / 60 - 12) / 24);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const hourAngle = remainder((minutes + equationOfTime + 4 * longitude) / 4 - 180, 360);
  const lat = (latitude * Math.PI) / 180, angle = (hourAngle * Math.PI) / 180;
  const cosZenith = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(angle);
  return { elevation: 90 - (Math.acos(Math.min(Math.max(cosZenith, -1), 1)) * 180) / Math.PI, morning: hourAngle < 0 };
}

/** The sky at `date` over a place: day with the sun 6° up or more, night below civil twilight, dawn or dusk in between. */
export function lightAt(date: Date, latitude: number, longitude: number): RouteMapLight {
  const sun = sunAt(date, latitude, longitude);
  return sun.elevation >= 6 ? "day" : sun.elevation < -6 ? "night" : sun.morning ? "dawn" : "dusk";
}

export interface RouteMapLook {
  type: RouteMapType;
  dark: boolean;
  /** The sky when the activity started, or null to follow the app's appearance. */
  timeOfDay: RouteMapLight | null;
}

/** Drawn maps follow dark mode unless lit by the time of day; imagery stays in daylight. */
export function lookLight(look: RouteMapLook): RouteMapLight {
  if (look.timeOfDay && takesLighting(look.type)) return look.timeOfDay;
  return isImagery(look.type) || !look.dark ? "day" : "night";
}

/**
 * The basemap's configuration. Types that share a style switch in place, so each sets every property another
 * one changes. Points of interest are off throughout. Null for Outdoors, which takes none.
 */
export function basemapConfig(look: RouteMapLook): Record<string, string | boolean> | null {
  const light = lookLight(look);
  const drawn = (theme: string, threeD: boolean) => ({ theme, lightPreset: light, show3dObjects: threeD, showLandmarkIcons: threeD, showPointOfInterestLabels: false });
  switch (look.type) {
    case "standard": return drawn("faded", false);
    case "city3d": return drawn("default", true);
    case "monochrome": return drawn("monochrome", false);
    case "outdoors": return null;
    default: {
      const streets = look.type === "hybrid";
      return {
        lightPreset: light, showPointOfInterestLabels: false, showRoadsAndTransit: streets, showPedestrianRoads: streets,
        showPlaceLabels: streets, showRoadLabels: streets, showTransitLabels: streets, showAdminBoundaries: streets,
      };
    }
  }
}
