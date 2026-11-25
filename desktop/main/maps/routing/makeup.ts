// What a route runs on, from BRouter's per-segment way tags: the Route makeup panel (way kinds and surfaces in
// metres, busy roads, retraced metres) and, kept finer here, what loop scoring needs (car parks, service roads).
import type { RouteGeometry, RouteMakeup, TrackPoint } from "../../../maps/types";
import { meters } from "./geo";

/** Finer than RouteMakeup: scoring tells car parks and service roads apart from quiet streets. */
export type WayKind = "path" | "trail" | "steps" | "cycleway" | "sidewalk" | "quiet" | "service" | "parking" | "busy" | "other";
export type SurfaceKind = "paved" | "gravel" | "dirt" | "unknown";

export interface Tally {
  ways: Partial<Record<WayKind, number>>;
  surfaces: Partial<Record<SurfaceKind, number>>;
  retracedM: number;
}

/** A routed line as the routers hand it back: the geometry plus what scoring needs, dropped before it's answered. */
export interface Routed extends RouteGeometry {
  tally?: Tally;
  /** Routed with brouter.de's stock profile (ours couldn't be uploaded), which can't see car parks. */
  stock?: boolean;
}

export function publicGeometry(r: Routed): RouteGeometry {
  return { points: r.points, distanceM: r.distanceM, ascentM: r.ascentM, descentM: r.descentM, ...(r.makeup ? { makeup: r.makeup } : {}) };
}

export interface Segment { meters: number; tags: Record<string, string> }

/** BRouter's `messages`: a header row, then one row per way change; `WayTags` is "key=value key=value". */
export function segmentsFrom(messages: unknown): Segment[] {
  if (!Array.isArray(messages) || !Array.isArray(messages[0])) return [];
  const header = messages[0] as unknown[];
  const di = header.indexOf("Distance"), ti = header.indexOf("WayTags");
  if (di < 0 || ti < 0) return [];
  const out: Segment[] = [];
  for (const row of messages.slice(1)) {
    if (!Array.isArray(row)) continue;
    const m = Number(row[di]);
    if (Number.isFinite(m) && m > 0) out.push({ meters: m, tags: wayTags(String(row[ti] ?? "")) });
  }
  return out;
}

export function wayTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of raw.split(/\s+/)) {
    const at = pair.indexOf("=");
    if (at > 0) tags[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return tags;
}

const set = (s: string) => new Set(s.split(" "));
const MAIN = set("tertiary tertiary_link secondary secondary_link primary primary_link trunk trunk_link");
const QUIET = set("residential living_street unclassified road");
const PARKING = set("parking_aisle parking driveway drive-through");
const PAVED = set("paved asphalt concrete paving_stones sett cobblestone metal wood");
const GRAVEL = set("compacted fine_gravel gravel pebblestone unpaved grass_paver");
const DIRT = set("ground dirt earth grass mud sand rock stone clay woodchips");
/** Paved by convention when OSM leaves `surface` out. */
const USUALLY_PAVED = new Set([...MAIN, ...QUIET, "service", "cycleway", "pedestrian", "steps"]);

const besideRoad = (t: Record<string, string>) =>
  /^(yes|both|left|right)$/.test(t.sidewalk ?? "") || t["sidewalk:both"] === "yes" ||
  /^(yes|designated)$/.test(t["sidewalk:left"] ?? "") || /^(yes|designated)$/.test(t["sidewalk:right"] ?? "");

export function surfaceOf(t: Record<string, string>): SurfaceKind {
  if (t.surface) return PAVED.has(t.surface) ? "paved" : GRAVEL.has(t.surface) ? "gravel" : DIRT.has(t.surface) ? "dirt" : "unknown";
  const hw = t.highway ?? "";
  if (hw === "track") return t.tracktype === "grade1" ? "paved" : t.tracktype === "grade2" ? "gravel" : t.tracktype ? "dirt" : "unknown";
  if (USUALLY_PAVED.has(hw)) return "paved";
  if (hw === "footway" && /^(sidewalk|crossing)$/.test(t.footway ?? "")) return "paved";
  return "unknown";
}

export function wayOf(t: Record<string, string>, cycling: boolean): WayKind {
  const hw = t.highway ?? "";
  if (hw === "steps") return "steps";
  if (hw === "cycleway") return "cycleway";
  if (hw === "service") return PARKING.has(t.service ?? "") ? "parking" : "service";
  if (QUIET.has(hw)) return "quiet";
  // Tertiary roads carry most road rides, so only bigger roads are busy for a cyclist; a runner minds the sidewalk.
  if (MAIN.has(hw)) return cycling ? (hw.startsWith("tertiary") ? "quiet" : "busy") : besideRoad(t) ? "sidewalk" : "busy";
  if (hw === "footway" && /^(sidewalk|crossing)$/.test(t.footway ?? "")) return "sidewalk";
  if (/^(footway|pedestrian|path|track|bridleway)$/.test(hw)) {
    const s = surfaceOf(t);
    return s === "paved" || (s === "unknown" && (hw === "footway" || hw === "pedestrian")) ? "path" : "trail";
  }
  return "other";
}

/** Metres covered a second time (either direction): routers repeat the same vertices on an out-and-back. */
export function retracedMeters(points: readonly TrackPoint[]): number {
  const key = (p: TrackPoint) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const seen = new Set<string>();
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = key(points[i - 1]), b = key(points[i]);
    if (a === b) continue;
    const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(edge)) total += meters(points[i - 1], points[i]);
    else seen.add(edge);
  }
  return total;
}

export function tallyOf(segments: Segment[], points: readonly TrackPoint[], cycling: boolean): Tally {
  const ways: Tally["ways"] = {}, surfaces: Tally["surfaces"] = {};
  for (const s of segments) {
    const w = wayOf(s.tags, cycling), f = surfaceOf(s.tags);
    ways[w] = (ways[w] ?? 0) + s.meters;
    surfaces[f] = (surfaces[f] ?? 0) + s.meters;
  }
  return { ways, surfaces, retracedM: retracedMeters(points) };
}

const MAKEUP_WAY: Record<WayKind, RouteMakeup["ways"][number]["kind"]> = {
  path: "path", trail: "path", steps: "path", cycleway: "cycleway", sidewalk: "sidewalk",
  quiet: "quiet", service: "other", parking: "other", busy: "busy", other: "other",
};

export function makeupOf(t: Tally): RouteMakeup {
  const ways = new Map<RouteMakeup["ways"][number]["kind"], number>();
  for (const [k, m] of Object.entries(t.ways) as [WayKind, number][]) ways.set(MAKEUP_WAY[k], (ways.get(MAKEUP_WAY[k]) ?? 0) + m);
  return {
    ways: [...ways].map(([kind, m]) => ({ kind, meters: Math.round(m) })).filter((w) => w.meters > 0).sort((a, b) => b.meters - a.meters),
    surfaces: (Object.entries(t.surfaces) as [SurfaceKind, number][])
      .map(([kind, m]) => ({ kind, meters: Math.round(m) })).filter((s) => s.meters > 0).sort((a, b) => b.meters - a.meters),
    busyMeters: Math.round(t.ways.busy ?? 0),
    retracedMeters: Math.round(t.retracedM),
  };
}

const sum = (o: Partial<Record<string, number>>) => Object.values(o).reduce<number>((a, b) => a + (b ?? 0), 0);

/** Share (0–1) of the classified metres on these way kinds. */
export function wayShare(t: Tally | undefined, kinds: WayKind[]): number {
  const total = t ? sum(t.ways) : 0;
  return t && total > 0 ? kinds.reduce((a, k) => a + (t.ways[k] ?? 0), 0) / total : 0;
}
export function surfaceShare(t: Tally | undefined, kinds: SurfaceKind[]): number {
  const total = t ? sum(t.surfaces) : 0;
  return t && total > 0 ? kinds.reduce((a, k) => a + (t.surfaces[k] ?? 0), 0) / total : 0;
}

/** Away from cars: paths, trails and cycleways; for runners sidewalks and steps too. */
export function carFreeShare(makeup: RouteMakeup | undefined, cycling: boolean): number {
  if (!makeup) return 0;
  const total = makeup.ways.reduce((a, w) => a + w.meters, 0);
  const free = makeup.ways.filter((w) => w.kind === "path" || w.kind === "cycleway" || (!cycling && w.kind === "sidewalk"));
  return total > 0 ? free.reduce((a, w) => a + w.meters, 0) / total : 0;
}
export function pavedShare(makeup: RouteMakeup | undefined): number {
  if (!makeup) return 0;
  const total = makeup.surfaces.reduce((a, s) => a + s.meters, 0);
  return total > 0 ? (makeup.surfaces.find((s) => s.kind === "paved")?.meters ?? 0) / total : 0;
}
/** Unpaved among the surfaces that are known. */
export function unpavedShare(makeup: RouteMakeup | undefined): number {
  if (!makeup) return 0;
  const known = makeup.surfaces.filter((s) => s.kind !== "unknown");
  const total = known.reduce((a, s) => a + s.meters, 0);
  return total > 0 ? known.filter((s) => s.kind !== "paved").reduce((a, s) => a + s.meters, 0) / total : 0;
}
