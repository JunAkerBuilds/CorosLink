// Heights for lines that weren't routed (freehand draw, marked trails): Open-Meteo's elevation API, at most 100
// points per call. Long legs are filled every ~100 m first so a hill between two clicks isn't missed; very long
// lines are asked at up to 1,000 spots and the rest filled in between.
import type { LatLon, RouteGeometry, TrackPoint } from "../../../maps/types";
import { lengthOf, lineGeometry, meters, trackPoint } from "./geo";
import { asProblem, RoutingProblem, type Net } from "./net";
import { t } from "@/lib/i18n";

const ENDPOINT = "https://api.open-meteo.com/v1/elevation";
export const ELEVATION_BATCH = 100;
export const MAX_ELEVATION_ASKS = 1_000;
const MAX_POINTS = 40_000;

export class Elevations {
  constructor(private readonly net: Net) {}

  /** Heights in metres, one per point (NaN where there's none). */
  async heights(points: LatLon[]): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < points.length; i += ELEVATION_BATCH) {
      const batch = points.slice(i, i + ELEVATION_BATCH);
      const url = new URL(ENDPOINT);
      url.searchParams.set("latitude", batch.map((p) => p[0].toFixed(5)).join(","));
      url.searchParams.set("longitude", batch.map((p) => p[1].toFixed(5)).join(","));
      let res: Response;
      try {
        res = await this.net.fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
      } catch (e) {
        throw asProblem(e, "The heights service");
      }
      if (res.status === 429) throw new RoutingProblem(t("The heights service is busy. Try again later."), "busy", 503);
      if (!res.ok) throw new RoutingProblem(t("The heights service had a problem ({status}).", { status: res.status }), "elevation", 502);
      const body = (await res.json()) as { elevation?: unknown[] };
      const got = Array.isArray(body.elevation) ? body.elevation : [];
      out.push(...batch.map((_, j) => (typeof got[j] === "number" ? (got[j] as number) : NaN)));
    }
    return out;
  }

  /** The line with heights, ascent and descent. */
  async line(points: LatLon[]): Promise<RouteGeometry> {
    if (points.length < 2) throw new RoutingProblem(t("Add at least two points."), "points");
    if (points.length > MAX_POINTS) throw new RoutingProblem(t("A route can have up to 40,000 points."), "points");
    const dense = densify(points);
    const along = [0];
    for (let i = 1; i < dense.length; i++) along.push(along[i - 1] + meters(dense[i - 1], dense[i]));
    const asked = spots(along, MAX_ELEVATION_ASKS);
    const got = await this.heights(asked.map((i) => dense[i]));
    const known = asked.map((i, k) => ({ at: along[i], ele: got[k] })).filter((k) => Number.isFinite(k.ele));
    const out: TrackPoint[] = dense.map((p, i) => trackPoint(p[0], p[1], known.length ? heightAt(known, along[i]) : undefined));
    return lineGeometry(out);
  }
}

/** Adds points along legs longer than the spacing, keeping every original point, within 40,000 points. */
export function densify(points: LatLon[]): LatLon[] {
  const total = lengthOf(points);
  const spacing = Math.max(100, total / MAX_ELEVATION_ASKS);
  const extra = points.slice(1).reduce((a, p, i) => a + Math.max(0, Math.ceil(meters(points[i], p) / spacing) - 1), 0);
  if (points.length + extra > MAX_POINTS) return points.slice();
  const out: LatLon[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], parts = Math.max(1, Math.ceil(meters(a, b) / spacing));
    for (let s = 1; s < parts; s++) out.push([a[0] + ((b[0] - a[0]) * s) / parts, a[1] + ((b[1] - a[1]) * s) / parts]);
    out.push(b);
  }
  return out;
}

/** Indexes to ask: all when few, else evenly by distance (first and last always). */
function spots(along: number[], max: number): number[] {
  if (along.length <= max) return along.map((_, i) => i);
  const total = along[along.length - 1];
  const out = new Set<number>([0, along.length - 1]);
  let j = 0;
  for (let k = 1; k < max - 1; k++) {
    const target = (total * k) / (max - 1);
    while (j < along.length - 1 && along[j] < target) j++;
    out.add(j);
  }
  return [...out].sort((a, b) => a - b);
}

function heightAt(known: { at: number; ele: number }[], at: number): number {
  if (at <= known[0].at) return known[0].ele;
  for (let k = 1; k < known.length; k++) {
    if (at <= known[k].at) {
      const a = known[k - 1], b = known[k];
      return b.at === a.at ? b.ele : a.ele + ((b.ele - a.ele) * (at - a.at)) / (b.at - a.at);
    }
  }
  return known[known.length - 1].ele;
}
