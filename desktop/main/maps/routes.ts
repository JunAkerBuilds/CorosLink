// Saved routes: kept on this computer, one JSON file per route plus an index of summaries (rebuilt from the files
// when it's missing or unreadable). GPX 1.1 in and out. Points are kept exactly as given: 2–40,000 of them, never
// simplified (the watch takes up to 40,000), and anything longer is refused rather than thinned.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  LatLon, RouteKind, RouteList, RouteMakeup, RouteSave, RouteSport, SavedRoute, SavedRouteSummary, TrackPoint,
} from "../../maps/types";
import { climb, isLatLon, lengthOf, meters, trackPoint } from "./routing/geo";
import { RoutingProblem } from "./routing/net";
import { SPORTS } from "./routing/sports";

export const MIN_ROUTE_POINTS = 2;
export const MAX_ROUTE_POINTS = 40_000;
const MAX_NAME = 80;
const LOOP_CLOSE_M = 100;
const SOURCES: readonly SavedRoute["source"][] = ["generate", "draw", "sketch", "import", "explore"];

const ID = /^[A-Za-z0-9-]{1,64}$/;
export const isRouteId = (id: string) => ID.test(id);

/** The points as given (validated, not rounded), or the reason they can't be a route. Never drops or moves a point. */
export function checkPoints(points: unknown): TrackPoint[] {
  if (!Array.isArray(points)) throw new RoutingProblem("The route has no points.", "points");
  if (points.length < MIN_ROUTE_POINTS) throw new RoutingProblem("A route needs at least two points.", "points");
  if (points.length > MAX_ROUTE_POINTS) {
    throw new RoutingProblem(`This route has ${points.length.toLocaleString("en")} points; the watch takes up to 40,000.`, "too_many_points");
  }
  return points.map((p: unknown) => {
    if (!isLatLon(p)) throw new RoutingProblem("The route has a point that isn't on the map.", "points");
    const ele = (p as number[])[2];
    return typeof ele === "number" && Number.isFinite(ele) ? [p[0], p[1], ele] : [p[0], p[1]];
  });
}

export function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return n || null;
}

const defaultName = (distanceM: number, kind: RouteKind) => `${(distanceM / 1000).toFixed(1)} km ${kind === "loop" ? "loop" : "route"}`;

const summaryOf = (r: SavedRoute): SavedRouteSummary =>
  ({ id: r.id, name: r.name, sport: r.sport, kind: r.kind, distanceM: r.distanceM, ascentM: r.ascentM, createdAt: r.createdAt });

export class RouteStore {
  private index: SavedRouteSummary[] | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly folder: string, private readonly now: () => Date = () => new Date()) {}

  private file = (id: string) => path.join(this.folder, `${id}.json`);
  private get indexFile() { return path.join(this.folder, "index.json"); }

  /** Writes one at a time, so two saves can't lose each other's index entry. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async summaries(): Promise<SavedRouteSummary[]> {
    if (this.index) return this.index;
    await mkdir(this.folder, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.indexFile, "utf8")) as unknown;
      if (Array.isArray(parsed)) return (this.index = parsed as SavedRouteSummary[]);
    } catch { /* rebuilt below */ }
    const rebuilt: SavedRouteSummary[] = [];
    for (const name of await readdir(this.folder)) {
      if (!name.endsWith(".json") || name === "index.json") continue;
      try { rebuilt.push(summaryOf(JSON.parse(await readFile(path.join(this.folder, name), "utf8")) as SavedRoute)); } catch { /* skipped */ }
    }
    this.index = rebuilt;
    await this.writeIndex();
    return rebuilt;
  }

  private async writeIndex(): Promise<void> {
    const temp = `${this.indexFile}.tmp`;
    await writeFile(temp, JSON.stringify(this.index ?? []));
    await rename(temp, this.indexFile);
  }

  /** Newest first; `q` matches names, any case. */
  async list(opts: { offset?: number; limit?: number; q?: string } = {}): Promise<RouteList> {
    const q = (opts.q ?? "").trim().toLowerCase();
    const all = [...(await this.summaries())]
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = Math.max(0, Math.floor(opts.offset ?? 0) || 0);
    const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20) || 20));
    return { routes: all.slice(offset, offset + limit), total: all.length };
  }

  async get(id: string): Promise<SavedRoute | null> {
    if (!isRouteId(id)) return null;
    try { return JSON.parse(await readFile(this.file(id), "utf8")) as SavedRoute; } catch { return null; }
  }

  async save(input: RouteSave): Promise<SavedRoute> {
    if (!SPORTS.includes(input.sport)) throw new RoutingProblem("Pick a sport for the route.", "sport");
    if (input.kind !== "loop" && input.kind !== "ab") throw new RoutingProblem("Say whether the route is a loop.", "kind");
    if (!SOURCES.includes(input.source)) throw new RoutingProblem("Unknown route source.", "source");
    const points = checkPoints(input.route?.points);
    const waypoints = Array.isArray(input.waypoints) ? input.waypoints.filter(isLatLon).map((p): LatLon => [p[0], p[1]]) : undefined;
    const measured = Math.round(lengthOf(points));
    const climbed = climb(points);
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback);
    const distanceM = num(input.route.distanceM, measured);
    return this.add({
      id: randomUUID(),
      name: cleanName(input.name) ?? defaultName(distanceM, input.kind),
      sport: input.sport,
      kind: input.kind,
      distanceM,
      ascentM: num(input.route.ascentM, climbed.ascentM),
      descentM: num(input.route.descentM, climbed.descentM),
      createdAt: this.now().toISOString(),
      points,
      ...(waypoints?.length ? { waypoints } : {}),
      ...(input.route.makeup ? { makeup: input.route.makeup as RouteMakeup } : {}),
      source: input.source,
    });
  }

  private add(route: SavedRoute): Promise<SavedRoute> {
    return this.serial(async () => {
      const list = await this.summaries();
      await writeFile(this.file(route.id), JSON.stringify(route));
      this.index = [...list, summaryOf(route)];
      await this.writeIndex();
      return route;
    });
  }

  async rename(id: string, name: unknown): Promise<SavedRoute | null> {
    const clean = cleanName(name);
    if (!clean) throw new RoutingProblem("Give the route a name.", "name");
    return this.serial(async () => {
      const route = await this.get(id);
      if (!route) return null;
      const renamed = { ...route, name: clean };
      await writeFile(this.file(id), JSON.stringify(renamed));
      this.index = (await this.summaries()).map((r) => (r.id === id ? { ...r, name: clean } : r));
      await this.writeIndex();
      return renamed;
    });
  }

  async remove(id: string): Promise<boolean> {
    if (!isRouteId(id)) return false;
    return this.serial(async () => {
      const list = await this.summaries();
      if (!list.some((r) => r.id === id)) return false;
      await rm(this.file(id), { force: true });
      this.index = list.filter((r) => r.id !== id);
      await this.writeIndex();
      return true;
    });
  }

  async removeAll(): Promise<number> {
    return this.serial(async () => {
      const list = await this.summaries();
      for (const r of list) await rm(this.file(r.id), { force: true });
      this.index = [];
      await this.writeIndex();
      return list.length;
    });
  }

  /** One GPX file: each track (or, when it has none, each route) becomes a saved route. */
  async importGpx(text: string, name?: string | null): Promise<SavedRouteSummary[]> {
    const lines = parseGpx(text);
    const fallback = cleanName(name) ?? lines.fileName ?? "Imported route";
    const saved: SavedRouteSummary[] = [];
    for (const [i, line] of lines.lines.entries()) {
      const points = line.points;
      const { ascentM, descentM } = climb(points);
      const route = await this.add({
        id: randomUUID(),
        name: (lines.lines.length === 1 ? cleanName(name) : null) ?? line.name ?? (lines.lines.length > 1 ? `${fallback} ${i + 1}` : fallback),
        sport: line.sport,
        kind: meters(points[0], points[points.length - 1]) <= LOOP_CLOSE_M ? "loop" : "ab",
        distanceM: Math.round(lengthOf(points)),
        ascentM, descentM,
        createdAt: new Date(this.now().getTime() + i).toISOString(),
        points,
        source: "import",
      });
      saved.push(summaryOf(route));
    }
    return saved;
  }
}

// ---- GPX ----

export interface GpxLine { name: string | null; sport: RouteSport; points: TrackPoint[] }

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? cleanName(decode(m[1])) : null;
};
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs)?.[1];

function sportOf(type: string | null): RouteSport {
  const t = (type ?? "").toLowerCase();
  if (/mountain|mtb/.test(t)) return "mtb";
  if (/bik|cycl|ride|road/.test(t)) return "road";
  if (/hik|trek/.test(t)) return "hike";
  if (/walk/.test(t)) return "walk";
  return "run";
}

function pointsIn(xml: string, pt: "trkpt" | "rtept"): TrackPoint[] {
  const out: TrackPoint[] = [];
  const re = new RegExp(`<${pt}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${pt}>)`, "g");
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const lat = Number(attr(m[1], "lat")), lon = Number(attr(m[1], "lon"));
    if (!isLatLon([lat, lon])) continue;
    const ele = m[2] ? Number(/<ele>\s*([^<]*?)\s*<\/ele>/.exec(m[2])?.[1]) : NaN;
    out.push(trackPoint(lat, lon, Number.isFinite(ele) ? ele : undefined));
  }
  return out;
}

/** Tracks when there are any (recorded or planned lines), else routes. Each needs 2–40,000 points. */
export function parseGpx(text: string): { fileName: string | null; lines: GpxLine[] } {
  const xml = text.replace(/<!--[\s\S]*?-->/g, "");
  if (!/<gpx\b/i.test(xml)) throw new RoutingProblem("That isn't a GPX file.", "gpx");
  const metadata = /<metadata\b[\s\S]*?<\/metadata>/.exec(xml)?.[0] ?? "";
  const blocks = (el: "trk" | "rte") => [...xml.matchAll(new RegExp(`<${el}\\b[^>]*>([\\s\\S]*?)</${el}>`, "g"))].map((m) => m[1]);
  const read = (el: "trk" | "rte") => blocks(el).map((body): GpxLine => {
    const head = body.replace(/<trkseg\b[\s\S]*?<\/trkseg>/g, "").replace(/<rtept\b[\s\S]*?(?:\/>|<\/rtept>)/g, "");
    return { name: tag(head, "name"), sport: sportOf(tag(head, "type")), points: pointsIn(body, el === "trk" ? "trkpt" : "rtept") };
  });
  let lines = read("trk").filter((l) => l.points.length >= MIN_ROUTE_POINTS);
  if (!lines.length) lines = read("rte").filter((l) => l.points.length >= MIN_ROUTE_POINTS);
  if (!lines.length) throw new RoutingProblem("No track or route with at least two points is in this GPX file.", "gpx");
  const big = lines.find((l) => l.points.length > MAX_ROUTE_POINTS);
  if (big) {
    throw new RoutingProblem(
      `${big.name ? `“${big.name}”` : "A track in this file"} has ${big.points.length.toLocaleString("en")} points; the watch takes up to 40,000.`,
      "too_many_points",
    );
  }
  return { fileName: tag(metadata, "name"), lines };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const GPX_TYPE: Record<RouteSport, string> = { run: "running", walk: "walking", hike: "hiking", road: "cycling", mtb: "mountain_biking" };

/** GPX 1.1 with every point, as saved. */
export function toGpx(r: SavedRoute): string {
  const pts = r.points.map((p) => `      <trkpt lat="${p[0]}" lon="${p[1]}">${p[2] !== undefined ? `<ele>${p[2]}</ele>` : ""}</trkpt>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="C-LINK Desktop" xmlns="http://www.topografix.com/GPX/1/1">',
    "  <metadata>",
    `    <name>${esc(r.name)}</name>`,
    `    <time>${esc(r.createdAt)}</time>`,
    "  </metadata>",
    "  <trk>",
    `    <name>${esc(r.name)}</name>`,
    `    <type>${GPX_TYPE[r.sport]}</type>`,
    "    <trkseg>",
    ...pts,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
    "",
  ].join("\n");
}

/** A file name for the download. */
export const gpxFileName = (name: string) => `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80) || "route"}.gpx`;
