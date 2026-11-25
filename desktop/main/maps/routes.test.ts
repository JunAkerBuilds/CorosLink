import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RouteSave, TrackPoint } from "../../maps/types";
import { MAX_ROUTE_POINTS, parseGpx, RouteStore, toGpx } from "./routes";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "clink-routes-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const line = (n: number, ele = true): TrackPoint[] =>
  Array.from({ length: n }, (_, i) => (ele ? [49 + i * 1e-5, -123 + (i % 7) * 1e-6, 10 + (i % 50)] : [49 + i * 1e-5, -123]) as TrackPoint);
const save = (points: TrackPoint[], name?: string): RouteSave =>
  ({ name, sport: "run", kind: "ab", source: "draw", route: { points, distanceM: 1234, ascentM: 5, descentM: 4 } });

function clock() {
  let t = Date.parse("2026-11-24T08:00:00Z");
  return () => new Date((t += 60_000));
}

describe("saved routes", () => {
  it("keeps 2–40,000 points exactly as given, with no simplification (must not regress)", async () => {
    const store = new RouteStore(dir);
    const points = line(MAX_ROUTE_POINTS);
    const saved = await store.save(save(points, "Long one"));
    const back = await new RouteStore(dir).get(saved.id);
    expect(back!.points).toHaveLength(40_000);
    expect(back!.points).toEqual(points);
    expect((await store.save(save(line(2)))).points).toHaveLength(2);
    await expect(store.save(save(line(40_001)))).rejects.toMatchObject({ code: "too_many_points" });
    await expect(store.save(save(line(1)))).rejects.toMatchObject({ code: "points" });
    await expect(store.save(save([[95, 0], [0, 0]]))).rejects.toMatchObject({ code: "points" });
  });

  it("lists newest first, pages, searches names, renames and deletes", async () => {
    const store = new RouteStore(dir, clock());
    for (const name of ["Seawall", "Grouse Grind", "Seawall long", "Lighthouse"]) await store.save(save(line(3), name));
    const page = await store.list({ limit: 2 });
    expect(page.total).toBe(4);
    expect(page.routes.map((r) => r.name)).toEqual(["Lighthouse", "Seawall long"]);
    expect((await store.list({ offset: 2, limit: 2 })).routes.map((r) => r.name)).toEqual(["Grouse Grind", "Seawall"]);
    expect((await store.list({ q: "seaWALL" })).routes.map((r) => r.name)).toEqual(["Seawall long", "Seawall"]);
    const grind = (await store.list({ q: "grouse" })).routes[0];
    expect((await store.rename(grind!.id, "  Grind\n "))!.name).toBe("Grind");
    await expect(store.rename(grind!.id, "   ")).rejects.toMatchObject({ code: "name" });
    expect(await store.remove(grind!.id)).toBe(true);
    expect(await store.remove(grind!.id)).toBe(false);
    expect(await store.get(grind!.id)).toBeNull();
    expect(await store.removeAll()).toBe(3);
    expect(await store.list()).toEqual({ routes: [], total: 0 });
  });

  it("rebuilds a lost index from the route files", async () => {
    const store = new RouteStore(dir);
    const saved = await store.save(save(line(3), "Keep me"));
    writeFileSync(path.join(dir, "index.json"), "not json");
    expect((await new RouteStore(dir).list()).routes.map((r) => r.id)).toEqual([saved.id]);
  });

  it("names a route from its distance when it has no name", async () => {
    const saved = await new RouteStore(dir).save({ ...save(line(3)), kind: "loop" });
    expect(saved.name).toBe("1.2 km loop");
  });
});

describe("GPX", () => {
  const gpx = (body: string) => `<?xml version="1.0"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Weekend</name></metadata>${body}</gpx>`;
  const pts = (tag: string, n: number, lat0 = 49) =>
    Array.from({ length: n }, (_, i) => `<${tag} lon="${-123 + i * 0.001}" lat='${lat0 + i * 0.001}'><ele>${100 + i}</ele><name>pt</name></${tag}>`).join("");

  it("imports each track as its own route, every point kept", async () => {
    const store = new RouteStore(dir, clock());
    const text = gpx(`<trk><name>Sat &amp; Sun</name><type>running</type><trkseg>${pts("trkpt", 3)}</trkseg><trkseg>${pts("trkpt", 2, 49.1)}</trkseg></trk>` +
      `<trk><type>cycling</type><trkseg>${pts("trkpt", 4)}</trkseg></trk><rte>${pts("rtept", 9)}</rte>`);
    const routes = await store.importGpx(text);
    expect(routes.map((r) => [r.name, r.sport])).toEqual([["Sat & Sun", "run"], ["Weekend 2", "road"]]);
    const first = await store.get(routes[0].id);
    expect(first!.points).toHaveLength(5);
    expect(first!.points[0]).toEqual([49, -123, 100]);
    expect(first!.source).toBe("import");
  });

  it("falls back to routes, takes the given name for one line, and reads self-closed points", async () => {
    const store = new RouteStore(dir);
    const text = gpx(`<rte><rtept lat="49" lon="-123"/><rtept lat="49.01" lon="-123"/></rte>`);
    const [route] = await store.importGpx(text, "Commute");
    expect(route.name).toBe("Commute");
    expect((await store.get(route.id))!.points).toEqual([[49, -123], [49.01, -123]]);
  });

  it("refuses a track over 40,000 points rather than thinning it, and files that aren't GPX", () => {
    const big = Array.from({ length: 40_001 }, (_, i) => `<trkpt lat="${49 + i * 1e-6}" lon="-123"/>`).join("");
    expect(() => parseGpx(gpx(`<trk><name>Huge</name><trkseg>${big}</trkseg></trk>`))).toThrow(/40,001 points/);
    expect(() => parseGpx("<html></html>")).toThrow(/isn't a GPX/);
    expect(() => parseGpx(gpx("<trk><trkseg><trkpt lat='1' lon='1'/></trkseg></trk>"))).toThrow(/at least two points/);
  });

  it("exports GPX 1.1 that reads back the same", async () => {
    const store = new RouteStore(dir);
    const saved = await store.save({ ...save(line(500), "Out <& back>"), sport: "hike" });
    const text = toGpx(saved);
    expect(text).toContain('<gpx version="1.1"');
    expect(text).toContain("<name>Out &lt;&amp; back&gt;</name>");
    const [again] = parseGpx(text).lines;
    expect(again.name).toBe("Out <& back>");
    expect(again.sport).toBe("hike");
    expect(again.points).toEqual(saved.points);
  });
});
