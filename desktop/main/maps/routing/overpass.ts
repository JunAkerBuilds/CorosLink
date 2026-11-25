// Explore: OpenStreetMap's marked routes (hiking, cycling, mountain-bike route relations) near the map, from the
// Overpass API, and one route's line stitched from its member ways in order.
import type { LatLon, TrailRoute } from "../../../maps/types";
import { meters } from "./geo";
import { asProblem, RoutingProblem, Spacer, USER_AGENT, type Net } from "./net";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
/** Wider than this and Overpass is slow and the list unreadable: zoom in first. */
export const MAX_SPAN_DEG = 0.6;
const MAX_TRAILS = 200;
/** Members that aren't the route itself. */
const SIDE_ROLES = new Set(["alternative", "excursion", "approach", "connection", "link", "platform", "stop"]);

export type TrailKind = TrailRoute["kind"];
const OSM_ROUTES: Record<TrailKind, string[]> = { hike: ["hiking", "foot"], cycle: ["bicycle"], mtb: ["mtb"] };
const kindOf = (route: string | undefined): TrailKind | null =>
  route === "hiking" || route === "foot" ? "hike" : route === "bicycle" ? "cycle" : route === "mtb" ? "mtb" : null;

export interface Bbox { south: number; west: number; north: number; east: number }

interface Element {
  type: string; id: number; tags?: Record<string, string>;
  members?: { type: string; role?: string; geometry?: { lat: number; lon: number }[] }[];
}

export class Overpass {
  private readonly spacer: Spacer;
  constructor(private readonly net: Net) {
    this.spacer = new Spacer(net, 1_000);
  }

  async trails(box: Bbox, kinds: TrailKind[]): Promise<TrailRoute[]> {
    if (![box.south, box.west, box.north, box.east].every(Number.isFinite) || box.south >= box.north || box.west >= box.east) {
      throw new RoutingProblem("Move the map to where you want to look for trails.", "bbox");
    }
    if (box.north - box.south > MAX_SPAN_DEG || box.east - box.west > MAX_SPAN_DEG) {
      throw new RoutingProblem("Zoom in to see marked trails.", "zoom_in");
    }
    const routes = [...new Set((kinds.length ? kinds : (["hike", "cycle", "mtb"] as TrailKind[])).flatMap((k) => OSM_ROUTES[k]))];
    const f = (n: number) => n.toFixed(5);
    const query = `[out:json][timeout:25];relation["type"="route"]["route"~"^(${routes.join("|")})$"](${f(box.south)},${f(box.west)},${f(box.north)},${f(box.east)});out tags ${MAX_TRAILS};`;
    const answer = await this.ask(query);
    return answer.flatMap((e) => {
      const kind = kindOf(e.tags?.route);
      if (e.type !== "relation" || !kind) return [];
      const km = parseFloat((e.tags?.distance ?? "").replace(",", "."));
      const name = e.tags?.name || e.tags?.ref || (kind === "hike" ? "Marked trail" : "Marked bike route");
      return [{ id: String(e.id), name, kind, ...(Number.isFinite(km) && km > 0 ? { distanceKm: km } : {}), ...(e.tags?.network ? { network: e.tags.network } : {}) }];
    });
  }

  /** One route's line, its member ways joined end to end in order. */
  async relation(id: string): Promise<{ name: string; kind: TrailKind | null; points: LatLon[] }> {
    if (!/^\d{1,12}$/.test(id)) throw new RoutingProblem("That trail wasn't found.", "not_found", 404);
    const [rel] = (await this.ask(`[out:json][timeout:25];relation(${id});out geom;`)).filter((e) => e.type === "relation");
    if (!rel) throw new RoutingProblem("That trail wasn't found.", "not_found", 404);
    const ways = (rel.members ?? [])
      .filter((m) => m.type === "way" && m.geometry && m.geometry.length >= 2 && !SIDE_ROLES.has(m.role ?? ""))
      .map((m) => m.geometry!.map((g) => [g.lat, g.lon] as LatLon));
    const points = stitch(ways);
    if (points.length < 2) throw new RoutingProblem("That trail has no line to follow.", "no_route", 422);
    return { name: rel.tags?.name || rel.tags?.ref || "Marked trail", kind: kindOf(rel.tags?.route), points };
  }

  private ask(query: string): Promise<Element[]> {
    return this.spacer.run(async () => {
      let res: Response;
      try {
        res = await this.net.fetch(ENDPOINT, {
          method: "POST",
          headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(40_000),
        });
      } catch (e) {
        throw asProblem(e, "The trails service");
      }
      if (res.status === 429 || res.status === 504) throw new RoutingProblem("The trails service is busy. Try again in a minute.", "busy", 503);
      if (!res.ok) throw new RoutingProblem(`The trails service had a problem (${res.status}).`, "trails", 502);
      const body = (await res.json()) as { elements?: Element[] };
      return Array.isArray(body.elements) ? body.elements : [];
    });
  }
}

/** Joins ways in order, turning each round to meet the line so far; drops the shared joint point. */
export function stitch(ways: LatLon[][]): LatLon[] {
  if (!ways.length) return [];
  let line = ways[0].slice();
  // The first way may run backwards: turn it if its start meets the second way.
  if (ways[1]) {
    const [a, b] = [ways[1][0], ways[1][ways[1].length - 1]];
    const end = Math.min(meters(line[line.length - 1], a), meters(line[line.length - 1], b));
    const start = Math.min(meters(line[0], a), meters(line[0], b));
    if (start < end) line = line.reverse();
  }
  for (const way of ways.slice(1)) {
    const tail = line[line.length - 1];
    const next = meters(tail, way[way.length - 1]) < meters(tail, way[0]) ? way.slice().reverse() : way;
    line.push(...(meters(tail, next[0]) < 1 ? next.slice(1) : next));
  }
  return line;
}
