import { t, getLocale } from "../../i18n/toolsLocale";
import type {
  RouteActivityType,
  RouteInsights,
  RouteSurfaceType,
  RouteWayType
} from "../../../electron/types";

/**
 * Pure view-model for the route makeup readout: groups the router's way
 * types into athlete-facing rows and decides which callouts deserve a chip.
 */

export interface MakeupRow {
  id: string;
  label: string;
  meters: number;
  /** Share of the classified distance, 0–1. */
  share: number;
}

export interface MakeupCallout {
  tone: "warning" | "good" | "info";
  text: string;
  /** Longer explanation for the tooltip / popover. */
  detail: string;
}

export interface RouteMakeup {
  wayRows: MakeupRow[];
  surfaceRows: MakeupRow[];
  /** Share separated from motor traffic (paths, trails, sidewalks, cycleways). */
  carFreeShare: number;
  pavedShare: number;
  unpavedShare: number;
  retracedMeters: number;
  parkingMeters: number;
  busyRoadMeters: number;
  callouts: MakeupCallout[];
}

const WAY_GROUPS: Array<{ id: string; types: RouteWayType[]; foot: string; bike: string }> = [
  { id: "path", types: ["path", "trail"], foot: "Path & trail", bike: "Path & trail" },
  { id: "sidewalk", types: ["sidewalk"], foot: "Sidewalk", bike: "Sidewalk" },
  { id: "cycleway", types: ["cycleway"], foot: "Cycleway", bike: "Cycleway" },
  { id: "quietStreet", types: ["quietStreet"], foot: "Quiet street", bike: "Minor road" },
  { id: "serviceRoad", types: ["serviceRoad"], foot: "Service road", bike: "Service road" },
  { id: "parkingLot", types: ["parkingLot"], foot: "Parking & driveways", bike: "Parking & driveways" },
  { id: "busyRoad", types: ["busyRoad"], foot: "Busy road", bike: "Main road" },
  { id: "other", types: ["steps", "other"], foot: "Steps & other", bike: "Steps & other" }
];

const SURFACE_ROWS: Array<{ id: RouteSurfaceType; label: string }> = [
  { id: "paved", label: "Paved" },
  { id: "gravel", label: "Gravel" },
  { id: "natural", label: "Dirt & grass" },
  { id: "unknown", label: "Not mapped" }
];

/** Below these, a parking aisle or busy stretch is just getting to the start. */
const PARKING_CALLOUT_METERS = 40;
const BUSY_ROAD_CALLOUT_METERS = 150;
const MAIN_ROAD_CALLOUT_SHARE = 0.25;
const RETRACE_CALLOUT_SHARE = 0.08;
const RETRACE_CALLOUT_METERS = 200;

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function summarizeRouteMakeup(
  insights: RouteInsights,
  activityType: RouteActivityType,
  formatDistance: (meters: number) => string
): RouteMakeup {
  const cycling = activityType.startsWith("cycling");
  const wayTotal = sum(Object.values(insights.wayTypes));
  const surfaceTotal = sum(Object.values(insights.surfaces));

  const wayRows = WAY_GROUPS.map((group) => {
    const meters = sum(group.types.map((type) => insights.wayTypes[type]));
    return {
      id: group.id,
      label: cycling ? group.bike : group.foot,
      meters,
      share: wayTotal > 0 ? meters / wayTotal : 0
    };
  })
    .filter((row) => row.meters > 0)
    .sort((a, b) => b.meters - a.meters);

  const surfaceRows = SURFACE_ROWS.map((row) => {
    const meters = insights.surfaces[row.id] ?? 0;
    return {
      id: row.id,
      label: t(row.label),
      meters,
      share: surfaceTotal > 0 ? meters / surfaceTotal : 0
    };
  }).filter((row) => row.meters > 0);

  const carFreeTypes: RouteWayType[] = cycling
    ? ["path", "trail", "cycleway"]
    : ["path", "trail", "sidewalk", "cycleway", "steps"];
  const carFreeShare =
    wayTotal > 0 ? sum(carFreeTypes.map((type) => insights.wayTypes[type])) / wayTotal : 0;
  const pavedShare = surfaceTotal > 0 ? (insights.surfaces.paved ?? 0) / surfaceTotal : 0;
  const unpavedShare =
    surfaceTotal > 0
      ? ((insights.surfaces.gravel ?? 0) + (insights.surfaces.natural ?? 0)) / surfaceTotal
      : 0;

  const parkingMeters = insights.wayTypes.parkingLot ?? 0;
  const busyRoadMeters = insights.wayTypes.busyRoad ?? 0;
  const callouts: MakeupCallout[] = [];

  if (parkingMeters >= PARKING_CALLOUT_METERS) {
    callouts.push({
      tone: "warning",
      text: t("{{p0}} in parking lots", { p0: String(formatDistance(parkingMeters)) }),
      detail:
        t("Parking aisles or driveways are on this route, usually because the start or a point you placed is inside a lot. Move the point onto a street or path to avoid them.")
    });
  }
  if (cycling) {
    if (wayTotal > 0 && busyRoadMeters / wayTotal >= MAIN_ROAD_CALLOUT_SHARE) {
      callouts.push({
        tone: "warning",
        text: t("{{p0}}% on main roads", { p0: String(Math.round((busyRoadMeters / wayTotal) * 100)) }),
        detail: t("A large share follows secondary or bigger roads. Try another variation or the Mixed surface for quieter options.")
      });
    }
  } else if (busyRoadMeters >= BUSY_ROAD_CALLOUT_METERS) {
    callouts.push({
      tone: "warning",
      text: t("{{p0}} on busy roads", { p0: String(formatDistance(busyRoadMeters)) }),
      detail: t("Part of the route runs on a busy road with no mapped sidewalk. Stay alert, or drag the route onto a parallel street.")
    });
  }
  const retraced = insights.retracedMeters;
  if (
    retraced >= RETRACE_CALLOUT_METERS &&
    wayTotal > 0 &&
    retraced / wayTotal >= RETRACE_CALLOUT_SHARE
  ) {
    callouts.push({
      tone: "info",
      text: t("{{p0}} out-and-back", { p0: String(formatDistance(retraced)) }),
      detail: t("Some sections are covered twice. They're highlighted on the map; try New variation for a cleaner loop.")
    });
  }
  if (insights.profile === "standard") {
    callouts.push({
      tone: "info",
      text: t("Standard routing"),
      detail:
        t("CorosLink's athlete routing was unavailable, so this route used the routing service's general profile. It may cut through parking lots or service roads; regenerate to try again.")
    });
  } else if (
    insights.profile === "athlete" &&
    parkingMeters < PARKING_CALLOUT_METERS &&
    !callouts.some((callout) => callout.tone === "warning")
  ) {
    callouts.push({
      tone: "good",
      text: cycling ? t("Low-traffic route") : t("Clean route"),
      detail: cycling
        ? t("Athlete routing kept this ride off parking lots, driveways and trunk roads, and favoured low-traffic roads.")
        : t("Athlete routing kept this route out of parking lots and driveways and off busy roads without sidewalks.")
    });
  }

  return {
    wayRows,
    surfaceRows,
    carFreeShare,
    pavedShare,
    unpavedShare,
    retracedMeters: retraced,
    parkingMeters,
    busyRoadMeters,
    callouts
  };
}

export function formatShare(share: number): string {
  if (share > 0 && share < 0.01) {
    return "<1%";
  }
  return `${Math.round(share * 100)}%`;
}
