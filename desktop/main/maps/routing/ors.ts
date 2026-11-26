// OpenRouteService, for athletes who'd rather use their own key: directions through points and its own round trip
// for loops. Ways and surfaces come from its `extra_info` so the Route makeup panel still works.
import type { LatLon, RouteSport, TrackPoint } from "../../../maps/types";
import { lengthOf, trackPoint } from "./geo";
import { makeupOf, retracedMeters, type Routed, type SurfaceKind, type Tally, type WayKind } from "./makeup";
import { asProblem, RoutingProblem, type Net } from "./net";
import type { Prefs } from "./sports";
import { t } from "@/lib/i18n";

const BASE = "https://api.openrouteservice.org";

export function orsProfile(p: Prefs): string {
  const bySport: Record<RouteSport, string> = { run: "foot-walking", walk: "foot-walking", hike: "foot-hiking", road: "cycling-road", mtb: "cycling-mountain" };
  return (p.sport === "run" || p.sport === "walk") && p.surface === "trail" ? "foot-hiking" : bySport[p.sport];
}

// ORS's extra_info codes.
const WAYTYPE: Record<number, WayKind> = { 1: "busy", 2: "busy", 3: "quiet", 4: "path", 5: "trail", 6: "cycleway", 7: "path", 8: "steps" };
const SURFACE: Record<number, SurfaceKind> = {
  1: "paved", 3: "paved", 4: "paved", 5: "paved", 6: "paved", 7: "paved", 14: "paved",
  2: "gravel", 8: "gravel", 9: "gravel", 10: "gravel", 18: "gravel",
  11: "dirt", 12: "dirt", 15: "dirt", 16: "dirt", 17: "dirt",
};

interface OrsAnswer {
  features?: {
    geometry?: { coordinates?: number[][] };
    properties?: {
      summary?: { distance?: number }; ascent?: number; descent?: number;
      extras?: Record<string, { values?: [number, number, number][] }>;
    };
  }[];
}

export class Ors {
  constructor(private readonly net: Net, private readonly key: string) {}

  route(points: LatLon[], prefs: Prefs): Promise<Routed> {
    if (points.length < 2) throw new RoutingProblem(t("Add at least two points."), "points");
    return this.directions(points, prefs, {});
  }

  roundTrip(start: LatLon, distanceM: number, prefs: Prefs, seed: number): Promise<Routed> {
    const vias = distanceM < 6_000 ? 3 : distanceM < 15_000 ? 4 : 5;
    return this.directions([start], prefs, { round_trip: { length: Math.round(distanceM), points: vias, seed: Math.abs(Math.floor(seed)) % 90 } });
  }

  private async directions(points: LatLon[], prefs: Prefs, options: Record<string, unknown>): Promise<Routed> {
    if (prefs.elevation !== "any") options = { ...options, profile_params: { weightings: { steepness_difficulty: prefs.elevation === "flat" ? 0 : 3 } } };
    const body = {
      coordinates: points.map((p) => [p[1], p[0]]),
      radiuses: points.map(() => -1),
      elevation: true,
      instructions: false,
      extra_info: ["surface", "waytype"],
      ...(Object.keys(options).length ? { options } : {}),
    };
    let res: Response;
    try {
      res = await this.net.fetch(`${BASE}/v2/directions/${orsProfile(prefs)}/geojson`, {
        method: "POST",
        headers: { Authorization: this.key, "Content-Type": "application/json", Accept: "application/geo+json, application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw asProblem(e, "OpenRouteService");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) throw new RoutingProblem(t("OpenRouteService didn't accept your key. Check it in routing settings."), "ors_key", 401);
      if (res.status === 429) throw new RoutingProblem(t("Your OpenRouteService key has used its quota for now. Try later, or switch to keyless routing."), "busy", 503);
      if (/"code"\s*:\s*20(09|10)/.test(text) || res.status === 404) throw new RoutingProblem(t("No path was found near one of your points. Move it closer to a road or trail."), "no_route", 422);
      throw new RoutingProblem(t("OpenRouteService had a problem ({status}).", { status: res.status }), "routing", 502);
    }
    return fromOrs((await res.json()) as OrsAnswer);
  }
}

export function fromOrs(answer: OrsAnswer): Routed {
  const f = answer.features?.[0];
  const coords = f?.geometry?.coordinates?.filter((c) => c.length >= 2) ?? [];
  if (coords.length < 2) throw new RoutingProblem(t("OpenRouteService found no route here."), "no_route", 422);
  const points: TrackPoint[] = coords.map((c) => trackPoint(c[1], c[0], c[2]));
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + lengthOf([points[i - 1], points[i]]));
  const spans = (key: string) => f?.properties?.extras?.[key]?.values ?? [];
  const tally: Tally = { ways: {}, surfaces: {}, retracedM: retracedMeters(points) };
  for (const [from, to, code] of [...spans("waytypes"), ...spans("waytype")]) {
    const kind = WAYTYPE[code] ?? "other";
    tally.ways[kind] = (tally.ways[kind] ?? 0) + Math.max(0, (along[to] ?? 0) - (along[from] ?? 0));
  }
  for (const [from, to, code] of spans("surface")) {
    const kind = SURFACE[code] ?? "unknown";
    tally.surfaces[kind] = (tally.surfaces[kind] ?? 0) + Math.max(0, (along[to] ?? 0) - (along[from] ?? 0));
  }
  return {
    points,
    distanceM: Math.round(f?.properties?.summary?.distance ?? along[along.length - 1]),
    ascentM: Math.round(f?.properties?.ascent ?? 0),
    descentM: Math.round(f?.properties?.descent ?? 0),
    makeup: makeupOf(tally),
    tally,
  };
}
