import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RouteCandidate, SavedRoute } from "../../maps/types";
import type { Sealer } from "../secrets";
import { RoutesService } from "./routesService";
import { brouterAnswer, fakeBrouter, fakeClock, lonlatsOf } from "./routing/fakes";

const sealer: Sealer = {
  encrypt: async (text) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
  decrypt: async (data) => ({ text: Buffer.from(data.toString().slice(7), "base64").toString(), stale: false }),
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "clink-routes-svc-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Handler = (url: string, init?: RequestInit) => Promise<Response>;
function service(handler: Handler, onWatch?: (id: string) => boolean) {
  const seen: string[] = [];
  const svc = new RoutesService({
    folder: dir, sealer, onWatch, clock: fakeClock(),
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => { seen.push(String(input)); return handler(String(input), init); }) as typeof fetch,
  });
  const ask = async (method: string, sub: string, body?: unknown) =>
    svc.answer(new Request(`clink://app/api/desktop/maps${sub}`, { method, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }), sub.split("?")[0]);
  return { svc, ask, seen };
}

describe("Route Studio API", () => {
  it("leaves the watch's paths to areasService", async () => {
    const { ask } = service(async () => new Response("", { status: 500 }));
    for (const [m, p] of [["POST", "/routes/abc/sync"], ["GET", "/sync"], ["POST", "/sync/cancel"], ["GET", "/watch/routes"], ["GET", "/watch"], ["GET", "/areas"], ["GET", "/packages"], ["POST", "/areas/start"]]) {
      expect(await ask(m, p), `${m} ${p}`).toBeNull();
    }
    expect(await ask("GET", "/routes")).not.toBeNull();
  });

  it("keeps the OpenRouteService key sealed and never answers it", async () => {
    const { ask } = service(async () => new Response("", { status: 500 }));
    expect(await (await ask("GET", "/routing"))!.json()).toEqual({ engine: "keyless", hasOrsKey: false });
    const bad = await ask("PUT", "/routing", { engine: "ors" });
    expect(bad!.status).toBe(400);
    const key = "5b3ce3597851110001cf6248abcdef0123456789";
    const ok = await ask("PUT", "/routing", { engine: "ors", orsKey: key });
    expect(await ok!.json()).toEqual({ engine: "ors", hasOrsKey: true });
    const onDisk = readFileSync(path.join(dir, "ors-key.bin"), "utf8");
    expect(onDisk.startsWith("sealed:")).toBe(true);
    expect(onDisk).not.toContain(key);
    expect(await (await ask("PUT", "/routing", { engine: "keyless", orsKey: null }))!.json()).toEqual({ engine: "keyless", hasOrsKey: false });
  });

  it("generates loop candidates with the keyless router", async () => {
    const fake = fakeBrouter({ tags: (url) => (/custom_[0-9]*$/.test(new URL(url).searchParams.get("profile") ?? "") && url.includes("profile=custom_2") ? "highway=path surface=dirt" : "highway=residential") });
    const { ask } = service(fake.handler);
    const res = await ask("POST", "/generate", { sport: "run", kind: "loop", start: [49.28, -123.12], distanceKm: 5, surface: "road", elevation: "any" });
    expect(res!.status).toBe(200);
    const { candidates } = (await res!.json()) as { candidates: RouteCandidate[] };
    expect(candidates[0].label).toBe("Best match");
    expect(candidates[0].points.length).toBeGreaterThan(2);
    expect(candidates[0].carFree).toBe(0);
    expect(fake.maxInFlight).toBeLessThanOrEqual(2);
    const tooFar = await ask("POST", "/generate", { sport: "walk", kind: "loop", start: [49.28, -123.12], distanceKm: 120 });
    expect(tooFar!.status).toBe(400);
    expect(await tooFar!.json()).toMatchObject({ error: { code: "distance" } });
  });

  it("routes a Draw leg, or draws it straight when snap is off", async () => {
    const { ask, seen } = service(fakeBrouter().handler);
    const straight = await (await ask("POST", "/leg", { sport: "run", surface: "road", from: [49.28, -123.12], to: [49.29, -123.12], snap: false }))!.json();
    expect(straight.points).toEqual([[49.28, -123.12], [49.29, -123.12]]);
    expect(seen).toHaveLength(0);
    const snapped = await (await ask("POST", "/leg", { sport: "mtb", surface: "trail", from: [49.28, -123.12], to: [49.29, -123.12], snap: true }))!.json();
    expect(snapped.distanceM).toBeGreaterThan(1000);
    expect(snapped.tally).toBeUndefined();
  });

  it("snaps a sketch and says how well it matches", async () => {
    const { ask, seen } = service(async (url, init) => (url.endsWith("/profile") ? Response.json({ profileid: "custom_9" }) : (void init, brouterAnswer(lonlatsOf(url)))));
    const outline = [[49.28, -123.12], [49.29, -123.12], [49.29, -123.1], [49.28, -123.1], [49.28, -123.12]];
    const answer = await (await ask("POST", "/sketch", { sport: "run", outline, fidelity: "balanced" }))!.json();
    expect(answer.match).toBeGreaterThan(0.9);
    const routeCall = seen.find((u) => u.includes("lonlats"))!;
    expect(lonlatsOf(routeCall).length).toBeLessThanOrEqual(60);
  });

  it("searches places through Nominatim", async () => {
    const { ask } = service(async () => Response.json([{ lat: "49.3", lon: "-123.1", display_name: "Lions Gate Bridge, Vancouver" }]));
    expect(await (await ask("GET", "/places?q=lions%20gate"))!.json()).toEqual([{ name: "Lions Gate Bridge", detail: "Vancouver", lat: 49.3, lon: -123.1 }]);
    expect((await ask("GET", "/places/reverse?lat=abc&lon=1"))!.status).toBe(400);
  });

  it("saves, lists, renames, exports, imports and deletes routes", async () => {
    const { ask, svc } = service(async () => new Response("", { status: 500 }), (id) => id.length > 0);
    const created = (await (await ask("POST", "/routes", { name: "Seawall", sport: "run", kind: "loop", source: "generate", route: { points: [[49.28, -123.12, 5], [49.29, -123.12, 9], [49.28, -123.12, 5]], distanceM: 2200, ascentM: 4, descentM: 4 } }))!.json()) as SavedRoute;
    expect(created.onWatch).toBe(true);
    expect((await svc.route(created.id))!.points).toHaveLength(3);
    const list = await (await ask("GET", "/routes?limit=10&q=sea"))!.json();
    expect(list.total).toBe(1);
    expect((await (await ask("PATCH", `/routes/${created.id}`, { name: "Seawall loop" }))!.json()).name).toBe("Seawall loop");
    const gpx = await ask("GET", `/routes/${created.id}/gpx`);
    expect(gpx!.headers.get("Content-Type")).toContain("gpx");
    expect(gpx!.headers.get("Content-Disposition")).toContain("Seawall loop.gpx");
    const text = await gpx!.text();
    const imported = await (await ask("POST", "/routes/import?name=Again", text))!.json();
    expect(imported.routes).toHaveLength(1);
    expect(imported.routes[0].name).toBe("Again");
    expect((await ask("GET", "/routes/nope!"))!.status).toBe(404);
    expect((await ask("DELETE", `/routes/${created.id}`))!.status).toBe(200);
    expect(await (await ask("DELETE", "/routes"))!.json()).toEqual({ deleted: 1 });
    expect((await ask("POST", "/routes/import", "<html/>"))!.status).toBe(400);
  });

  it("finds marked trails and gives one's line with heights", async () => {
    const { ask } = service(async (url, init) => {
      if (url.includes("overpass")) {
        const q = decodeURIComponent(String(init?.body));
        if (q.includes("out geom")) return Response.json({ elements: [{ type: "relation", id: 7, tags: { route: "hiking", name: "Loop" }, members: [{ type: "way", role: "", geometry: [{ lat: 49.28, lon: -123.12 }, { lat: 49.2805, lon: -123.12 }] }] }] });
        return Response.json({ elements: [{ type: "relation", id: 7, tags: { route: "hiking", name: "Loop" } }] });
      }
      const n = (new URL(url).searchParams.get("latitude") ?? "").split(",").length;
      return Response.json({ elevation: Array.from({ length: n }, (_, i) => 100 + i * 10) });
    });
    expect(await (await ask("GET", "/trails?south=49.2&west=-123.2&north=49.3&east=-123.1&kinds=hike"))!.json()).toEqual({ trails: [{ id: "7", name: "Loop", kind: "hike" }] });
    const line = await (await ask("GET", "/trails/7"))!.json();
    expect(line.points).toEqual([[49.28, -123.12, 100], [49.2805, -123.12, 110]]);
    expect(line.ascentM).toBe(10);
  });
});
