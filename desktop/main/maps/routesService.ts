// Route Studio's side of /api/desktop/maps: routing settings, place search, Generate / Draw / Sketch / Explore, and
// the saved routes. Sending a route to the watch (/routes/:id/sync, /sync, /watch/routes) belongs to areasService.
//
// Routing is keyless by default (BRouter + Nominatim, both free OpenStreetMap services); with an OpenRouteService key
// (kept sealed with the OS keychain, never sent to the page) Generate, Draw and Sketch use it instead.
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  GenerateRequest, LatLon, LegRequest, RouteGeometry, RouteSave, RoutingConfig, RoutingEngine, SavedRoute, SketchAnswer, SketchRequest,
} from "../../maps/types";
import type { Sealer } from "../secrets";
import { checkPoints, gpxFileName, isRouteId, RouteStore, toGpx } from "./routes";
import { BRouter } from "./routing/brouter";
import { Elevations } from "./routing/elevation";
import { isLatLon, lengthOf, lineGeometry, meters, trackPoint } from "./routing/geo";
import { generateCandidates, type Engine } from "./routing/loop";
import { publicGeometry, type Routed } from "./routing/makeup";
import { Nominatim } from "./routing/nominatim";
import { makeNet, RoutingProblem, type Net } from "./routing/net";
import { Ors } from "./routing/ors";
import { Overpass, type TrailKind } from "./routing/overpass";
import { shapeMatch, sketchWaypoints } from "./routing/sketch";
import { checkDistance, ELEVATIONS, SPORTS, SURFACES, type Prefs } from "./routing/sports";
import { t } from "@/lib/i18n";

export interface RoutesHost {
  /** Route Studio's own folder (saved routes, routing settings, the sealed key). */
  folder: string;
  sealer: Sealer;
  fetch?: typeof fetch;
  /** Whether the watch holds this saved route as it is now (same track ID and CRC). */
  onWatch?: (id: string) => boolean;
  /** Tests pass a fake clock and sleep. */
  clock?: Partial<Pick<Net, "now" | "sleep">>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const problem = (message: string, code = "problem", status = 400) => json({ error: { code, message } }, status);
const MAX_GPX_BYTES = 64 * 1024 * 1024;
const MAX_OUTLINE = 5_000;

export class RoutesService {
  private readonly net: Net;
  private readonly store: RouteStore;
  private readonly brouter: BRouter;
  private readonly places: Nominatim;
  private readonly overpass: Overpass;
  private readonly heights: Elevations;
  private readonly configFile: string;
  private readonly keyFile: string;
  private engine: RoutingEngine | null = null;

  constructor(private readonly host: RoutesHost) {
    mkdirSync(host.folder, { recursive: true });
    this.net = makeNet(host.fetch, host.clock);
    this.store = new RouteStore(path.join(host.folder, "saved"));
    this.brouter = new BRouter(this.net);
    this.places = new Nominatim(this.net);
    this.overpass = new Overpass(this.net);
    this.heights = new Elevations(this.net);
    this.configFile = path.join(host.folder, "routing.json");
    this.keyFile = path.join(host.folder, "ors-key.bin");
  }

  async answer(request: Request, sub: string): Promise<Response | null> {
    const parts = sub.split("?")[0].split("/").filter(Boolean);
    const [head, id, tail] = parts;
    const owned = ["routing", "places", "generate", "leg", "sketch", "elevation", "trails", "routes"];
    if (!head || !owned.includes(head) || parts.length > 3) return null;
    // /routes/:id/sync is the watch's (areasService), as is anything else under a route but the GPX.
    if (head === "routes" && parts.length === 3 && tail !== "gpx") return null;
    if (head !== "routes" && head !== "places" && head !== "trails" && parts.length > 1) return null;
    if ((head === "places" && id && id !== "reverse") || (head === "trails" && parts.length > 2)) return null;
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    try {
      const answer = await this.dispatch(method, head, id, tail, url, request);
      return answer ?? problem(t("That isn't something this page can do."), "method", 405);
    } catch (e) {
      if (e instanceof RoutingProblem) return problem(e.message, e.code, e.status);
      if (e instanceof SyntaxError) return problem(t("The request wasn't readable."), "bad_request");
      return problem(t("Something went wrong planning the route. Try again."), "internal", 500);
    }
  }

  /** One saved route, as kept (for the watch side to send it). */
  route(id: string): Promise<SavedRoute | null> {
    return this.store.get(id);
  }

  /** Saves a route made elsewhere (CorosLink's, when its data is brought over: coroslink/move.ts). */
  save(input: RouteSave): Promise<SavedRoute> {
    return this.store.save(input);
  }

  private async dispatch(method: string, head: string, id: string | undefined, tail: string | undefined, url: URL, request: Request): Promise<Response | null> {
    const q = url.searchParams;
    switch (head) {
      case "routing":
        if (method === "GET") return json(await this.config());
        if (method === "PUT") return json(await this.setConfig(await body(request)));
        return null;
      case "places":
        if (method !== "GET") return null;
        if (id === "reverse") {
          const point: LatLon = [Number(q.get("lat")), Number(q.get("lon"))];
          if (!isLatLon(point)) throw new RoutingProblem(t("Pick a point on the map."), "point");
          return json(await this.places.reverse(point[0], point[1]));
        }
        return json(await this.places.search(q.get("q") ?? ""));
      case "generate":
        if (method !== "POST") return null;
        return json({ candidates: await generateCandidates(checkGenerate(await body(request)), await this.pickEngine()) });
      case "leg":
        if (method !== "POST") return null;
        return json(await this.leg(await body(request)));
      case "sketch":
        if (method !== "POST") return null;
        return json(await this.sketch(await body(request)));
      case "elevation": {
        if (method !== "POST") return null;
        const points = checkPoints((await body(request)).points).map((p): LatLon => [p[0], p[1]]);
        return json(await this.heights.line(points));
      }
      case "trails":
        if (method !== "GET") return null;
        if (id) return json(await this.trail(id));
        return json({ trails: await this.overpass.trails(
          { south: Number(q.get("south")), west: Number(q.get("west")), north: Number(q.get("north")), east: Number(q.get("east")) },
          (q.get("kinds") ?? "").split(",").filter((k): k is TrailKind => k === "hike" || k === "cycle" || k === "mtb"),
        ) });
      case "routes":
        return this.routes(method, id, tail, q, request);
    }
    return null;
  }

  private async routes(method: string, id: string | undefined, tail: string | undefined, q: URLSearchParams, request: Request): Promise<Response | null> {
    if (!id) {
      if (method === "GET") {
        const list = await this.store.list({ offset: Number(q.get("offset") ?? 0), limit: Number(q.get("limit") ?? 20), q: q.get("q") ?? "" });
        return json({ ...list, routes: list.routes.map((r) => this.marked(r)) });
      }
      if (method === "POST") return json(this.marked(await this.store.save((await body(request)) as unknown as RouteSave)));
      if (method === "DELETE") return json({ deleted: await this.store.removeAll() });
      return null;
    }
    if (id === "import" && !tail) {
      if (method !== "POST") return null;
      const size = Number(request.headers.get("content-length") ?? 0);
      if (size > MAX_GPX_BYTES) throw new RoutingProblem(t("That GPX file is too big."), "too_big", 413);
      const text = await request.text();
      if (text.length > MAX_GPX_BYTES) throw new RoutingProblem(t("That GPX file is too big."), "too_big", 413);
      return json({ routes: (await this.store.importGpx(text, q.get("name"))).map((r) => this.marked(r)) });
    }
    if (!isRouteId(id)) return problem(t("That route wasn't found."), "not_found", 404);
    if (tail === "gpx") {
      if (method !== "GET") return null;
      const route = await this.store.get(id);
      if (!route) return problem(t("That route wasn't found."), "not_found", 404);
      return new Response(toGpx(route), {
        headers: {
          "Content-Type": "application/gpx+xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${gpxFileName(route.name).replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(gpxFileName(route.name))}`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (method === "GET") {
      const route = await this.store.get(id);
      return route ? json(this.marked(route)) : problem(t("That route wasn't found."), "not_found", 404);
    }
    if (method === "PATCH") {
      const route = await this.store.rename(id, (await body(request)).name);
      return route ? json(this.marked(route)) : problem(t("That route wasn't found."), "not_found", 404);
    }
    if (method === "DELETE") {
      return (await this.store.remove(id)) ? json({ deleted: 1 }) : problem(t("That route wasn't found."), "not_found", 404);
    }
    return null;
  }

  private marked<T extends { id: string }>(r: T): T & { onWatch?: boolean } {
    const on = this.host.onWatch?.(r.id);
    return on ? { ...r, onWatch: true } : r;
  }

  // ---- Routing settings ----

  private async savedEngine(): Promise<RoutingEngine> {
    if (this.engine) return this.engine;
    try {
      const saved = JSON.parse(await readFile(this.configFile, "utf8")) as { engine?: unknown };
      this.engine = saved.engine === "ors" ? "ors" : "keyless";
    } catch {
      this.engine = "keyless";
    }
    return this.engine;
  }

  private async orsKey(): Promise<string | null> {
    if (!existsSync(this.keyFile)) return null;
    try {
      const { text, stale } = await this.host.sealer.decrypt(await readFile(this.keyFile));
      if (stale) await writeFile(this.keyFile, await this.host.sealer.encrypt(text), { mode: 0o600 });
      return text || null;
    } catch {
      return null;
    }
  }

  /** Keeps an OpenRouteService key brought from CorosLink (coroslink/move.ts) when none is saved. The engine stays. */
  async adoptOrsKey(key: string): Promise<boolean> {
    const clean = key.trim();
    if (!/^[\x21-\x7e]{16,400}$/.test(clean) || (await this.orsKey())) return false;
    await writeFile(this.keyFile, await this.host.sealer.encrypt(clean), { mode: 0o600 });
    return true;
  }

  async config(): Promise<RoutingConfig> {
    return { engine: await this.savedEngine(), hasOrsKey: (await this.orsKey()) !== null };
  }

  private async setConfig(b: Record<string, unknown>): Promise<RoutingConfig> {
    if (b.engine !== "keyless" && b.engine !== "ors") throw new RoutingProblem(t("Pick keyless routing or OpenRouteService."), "engine");
    if (typeof b.orsKey === "string" || b.orsKey === null) {
      const key = typeof b.orsKey === "string" ? b.orsKey.trim() : "";
      if (key && !/^[\x21-\x7e]{16,400}$/.test(key)) throw new RoutingProblem(t("That doesn't look like an OpenRouteService key."), "ors_key");
      if (key) await writeFile(this.keyFile, await this.host.sealer.encrypt(key), { mode: 0o600 });
      else await rm(this.keyFile, { force: true });
    }
    if (b.engine === "ors" && !(await this.orsKey())) throw new RoutingProblem(t("Add your OpenRouteService key first."), "ors_key");
    this.engine = b.engine;
    await writeFile(this.configFile, JSON.stringify({ engine: b.engine }));
    return this.config();
  }

  /** OpenRouteService when chosen and keyed; BRouter otherwise. */
  private async pickEngine(): Promise<Engine> {
    const key = (await this.savedEngine()) === "ors" ? await this.orsKey() : null;
    if (key) {
      const ors = new Ors(this.net, key);
      return { route: (points, prefs) => ors.route(points, prefs), roundTrip: (s, m, p, seed) => ors.roundTrip(s, m, p, seed) };
    }
    return {
      route: (points, prefs, placed) => this.brouter.route(points, { ...prefs, trimVias: placed }),
      available: () => this.brouter.available(),
    };
  }

  // ---- Draw, Sketch, Explore ----

  private async leg(b: Record<string, unknown>): Promise<RouteGeometry> {
    const req = b as unknown as LegRequest;
    const prefs = checkPrefs({ ...b, elevation: "any" });
    if (!isLatLon(req.from) || !isLatLon(req.to)) throw new RoutingProblem(t("Pick two points on the map."), "points");
    const from: LatLon = [req.from[0], req.from[1]], to: LatLon = [req.to[0], req.to[1]];
    checkDistance(prefs.sport, Math.max(0.001, meters(from, to) / 1000));
    if (req.snap === false) return lineGeometry([trackPoint(from[0], from[1]), trackPoint(to[0], to[1])]);
    return publicGeometry(await (await this.pickEngine()).route([from, to], prefs, false));
  }

  private async sketch(b: Record<string, unknown>): Promise<SketchAnswer> {
    const req = b as unknown as SketchRequest;
    const prefs = checkPrefs({ ...b, elevation: "any" });
    const fidelity = req.fidelity === "loose" || req.fidelity === "strict" ? req.fidelity : "balanced";
    if (!Array.isArray(req.outline) || req.outline.length < 2 || req.outline.length > MAX_OUTLINE || !req.outline.every(isLatLon)) {
      throw new RoutingProblem(t("Place a shape on the map first."), "outline");
    }
    const outline = req.outline.map((p): LatLon => [p[0], p[1]]);
    checkDistance(prefs.sport, Math.max(0.001, lengthOf(outline) / 1000));
    const routed: Routed = await (await this.pickEngine()).route(sketchWaypoints(outline, fidelity), prefs, true);
    return { route: publicGeometry(routed), match: shapeMatch(routed.points, outline) };
  }

  private async trail(id: string): Promise<RouteGeometry> {
    const { points } = await this.overpass.relation(id);
    if (points.length > 40_000) throw new RoutingProblem(t("This trail is too long for the watch (over 40,000 points)."), "too_many_points");
    // Heights are a nice-to-have here: without them the line still shows.
    return this.heights.line(points).catch(() => lineGeometry(points.map((p) => trackPoint(p[0], p[1]))));
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed = (await request.json()) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RoutingProblem(t("The request wasn't readable."), "bad_request");
  return parsed as Record<string, unknown>;
}

function checkPrefs(b: Record<string, unknown>): Prefs {
  if (!SPORTS.includes(b.sport as Prefs["sport"])) throw new RoutingProblem(t("Pick a sport."), "sport");
  const sport = b.sport as Prefs["sport"];
  const surface = SURFACES.includes(b.surface as Prefs["surface"]) ? (b.surface as Prefs["surface"]) : sport === "hike" || sport === "mtb" ? "trail" : "road";
  const elevation = ELEVATIONS.includes(b.elevation as Prefs["elevation"]) ? (b.elevation as Prefs["elevation"]) : "any";
  return { sport, surface, elevation };
}

function checkGenerate(b: Record<string, unknown>): GenerateRequest {
  const prefs = checkPrefs(b);
  if (b.kind !== "loop" && b.kind !== "ab") throw new RoutingProblem(t("Pick a loop or A to B."), "kind");
  if (!isLatLon(b.start)) throw new RoutingProblem(t("Pick where the route starts."), "start");
  if (b.kind === "ab" && !isLatLon(b.end)) throw new RoutingProblem(t("Pick where the route ends."), "end");
  const seed = typeof b.seed === "number" && Number.isFinite(b.seed) ? b.seed : undefined;
  return {
    ...prefs,
    kind: b.kind,
    start: [b.start[0], b.start[1]],
    ...(b.kind === "ab" ? { end: [(b.end as LatLon)[0], (b.end as LatLon)[1]] as LatLon } : {}),
    distanceKm: Number(b.distanceKm),
    ...(seed !== undefined ? { seed } : {}),
  };
}

