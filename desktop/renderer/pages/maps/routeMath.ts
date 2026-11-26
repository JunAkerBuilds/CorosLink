// Route Studio's sums: joining drawn legs, the elevation profile, estimated time and the makeup line. Pure.
import type { RouteGeometry, RouteMakeup, RouteSport, TrackPoint } from "../../../maps/types";
import { msg, t, tx } from "@/lib/i18n";
import { haversine } from "./sketchShapes";

/** Legs end where the next starts: joined without repeating that point. */
export function joinLegs(legs: readonly RouteGeometry[]): RouteGeometry | null {
  if (!legs.length) return null;
  const points: TrackPoint[] = [];
  let distanceM = 0, ascentM = 0, descentM = 0;
  const ways = new Map<string, number>(), surfaces = new Map<string, number>();
  let busy = 0, retraced = 0, haveMakeup = false;
  for (const leg of legs) {
    points.push(...(points.length ? leg.points.slice(1) : leg.points));
    distanceM += leg.distanceM; ascentM += leg.ascentM; descentM += leg.descentM;
    if (leg.makeup) {
      haveMakeup = true;
      for (const w of leg.makeup.ways) ways.set(w.kind, (ways.get(w.kind) ?? 0) + w.meters);
      for (const s of leg.makeup.surfaces) surfaces.set(s.kind, (surfaces.get(s.kind) ?? 0) + s.meters);
      busy += leg.makeup.busyMeters; retraced += leg.makeup.retracedMeters;
    }
  }
  const makeup: RouteMakeup | undefined = haveMakeup ? {
    ways: [...ways].map(([kind, meters]) => ({ kind: kind as RouteMakeup["ways"][number]["kind"], meters })),
    surfaces: [...surfaces].map(([kind, meters]) => ({ kind: kind as RouteMakeup["surfaces"][number]["kind"], meters })),
    busyMeters: busy, retracedMeters: retraced,
  } : undefined;
  return { points, distanceM, ascentM, descentM, makeup };
}

/** A straight leg (Freehand), without heights. */
export function straightLeg(from: [number, number], to: [number, number]): RouteGeometry {
  return { points: [from, to], distanceM: haversine(from, to), ascentM: 0, descentM: 0 };
}

export interface Profile { d: number[]; e: number[]; min: number; max: number; total: number }
/** Distance (m) and height (m) along the route, for the points that have a height. Null without heights. */
export function profile(points: readonly TrackPoint[]): Profile | null {
  const d: number[] = [], e: number[] = [];
  let run = 0;
  for (let i = 0; i < points.length; i++) {
    if (i) run += haversine(points[i - 1] as [number, number], points[i] as [number, number]);
    const h = points[i][2];
    if (h != null && Number.isFinite(h)) { d.push(run); e.push(h); }
  }
  if (e.length < 2) return null;
  return { d, e, min: Math.min(...e), max: Math.max(...e), total: run };
}

/** Index of the point nearest `meters` along the line. */
export function pointAt(points: readonly TrackPoint[], meters: number): number {
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    run += haversine(points[i - 1] as [number, number], points[i] as [number, number]);
    if (run >= meters) return i;
  }
  return points.length - 1;
}

/** Flat pace (s/km) and extra seconds per metre climbed, per sport. */
const PACE: Record<RouteSport, { flat: number; climb: number; speed: boolean }> = {
  run: { flat: 360, climb: 3, speed: false },
  walk: { flat: 660, climb: 6, speed: false },
  hike: { flat: 780, climb: 6, speed: false },
  road: { flat: 144, climb: 1.2, speed: true },
  mtb: { flat: 240, climb: 2, speed: true },
};
export function estimate(sport: RouteSport, distanceM: number, ascentM: number) {
  const p = PACE[sport];
  const seconds = (distanceM / 1000) * p.flat + ascentM * p.climb;
  const perKm = distanceM > 0 ? seconds / (distanceM / 1000) : 0;
  return {
    seconds,
    time: clock(seconds),
    pace: p.speed ? `${(3600 / Math.max(perKm, 1)).toFixed(1)}` : `${Math.floor(perKm / 60)}:${String(Math.round(perKm % 60)).padStart(2, "0")}`,
    paceUnit: p.speed ? " km/h" : " /km",
  };
}
export const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}` : `${m} min`;
};

export function shares(makeup: RouteMakeup | undefined) {
  if (!makeup) return null;
  const total = makeup.ways.reduce((a, w) => a + w.meters, 0) || 1;
  const surfTotal = makeup.surfaces.reduce((a, s) => a + s.meters, 0) || 1;
  const busy = makeup.ways.find((w) => w.kind === "busy")?.meters ?? 0;
  const paved = makeup.surfaces.find((s) => s.kind === "paved")?.meters ?? 0;
  const unpaved = makeup.surfaces.filter((s) => s.kind === "gravel" || s.kind === "dirt").reduce((a, s) => a + s.meters, 0);
  return { carFree: 1 - busy / total, paved: paved / surfTotal, unpaved: unpaved / surfTotal, total, surfTotal };
}

export function terrain(makeup: RouteMakeup | undefined): string {
  const s = shares(makeup);
  if (!s) return "–";
  if (s.paved >= 0.8) return t("Paved");
  if (s.unpaved >= 0.6) return t("Trail");
  return tx("surface", "Mixed");
}

export const WAY_LABEL: Record<RouteMakeup["ways"][number]["kind"], string> = {
  path: msg("Path & trail"), cycleway: msg("Cycleway"), sidewalk: msg("Sidewalk"), quiet: msg("Quiet street"), busy: msg("Busy road"), other: msg("Steps & other"),
};
export const SURFACE_LABEL: Record<RouteMakeup["surfaces"][number]["kind"], string> = {
  paved: msg("Paved"), gravel: msg("Gravel"), dirt: msg("Dirt & grass"), unknown: msg("Unknown"),
};
