import { describe, expect, it } from "vitest";
import { BRouter, BROUTER_MAX_CONCURRENT, fromGeoJson, PROFILE_TTL_MS } from "./brouter";
import { brouterAnswer, fakeBrouter, lonlatsOf, netWith } from "./fakes";
import { RoutingProblem } from "./net";
import type { ProfileOptions } from "./sports";

const run: ProfileOptions = { sport: "run", surface: "road", elevation: "any", trimVias: false };
const a: [number, number] = [49.28, -123.12], b: [number, number] = [49.29, -123.1];

describe("BRouter", () => {
  it("never has more than two requests out at a time (must not regress)", async () => {
    const fake = fakeBrouter({ delayMs: 5 });
    const router = new BRouter(netWith(fake.handler));
    await Promise.all(Array.from({ length: 6 }, () => router.route([a, b], run)));
    expect(BROUTER_MAX_CONCURRENT).toBe(2);
    expect(fake.maxInFlight).toBe(2);
    expect(fake.calls.filter((u) => !u.endsWith("/profile"))).toHaveLength(6);
  });

  it("uploads a profile once and keeps its id for 6 hours (must not regress)", async () => {
    const fake = fakeBrouter();
    const net = netWith(fake.handler);
    const router = new BRouter(net);
    await router.route([a, b], run);
    net.clock.advance(PROFILE_TTL_MS - 60_000);
    await router.route([a, b], run);
    expect(fake.uploads).toBe(1);
    net.clock.advance(2 * 60_000);
    await router.route([a, b], run);
    expect(fake.uploads).toBe(2);
    expect(PROFILE_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("routes with its own profile and a C-LINK User-Agent", async () => {
    const seen: { url: string; ua: string | null }[] = [];
    const fake = fakeBrouter();
    const router = new BRouter(netWith(async (url, init) => { seen.push({ url, ua: new Headers(init?.headers).get("User-Agent") }); return fake.handler(url, init); }));
    const routed = await router.route([a, b], run);
    const routeCall = seen.find((s) => !s.url.endsWith("/profile"))!;
    expect(new URL(routeCall.url).searchParams.get("profile")).toBe("custom_1");
    expect(routeCall.ua).toBe("C-LINK Desktop");
    expect(routed.stock).toBeUndefined();
    expect(lonlatsOf(routeCall.url)).toEqual([a, b]);
  });

  it("falls back to brouter.de's stock profile when the upload fails", async () => {
    const urls: string[] = [];
    const router = new BRouter(netWith(async (url) => {
      urls.push(url);
      if (url.endsWith("/profile")) return Response.json({ error: "parse error" });
      return brouterAnswer(lonlatsOf(url));
    }));
    const routed = await router.route([a, b], { ...run, sport: "road" });
    expect(routed.stock).toBe(true);
    expect(new URL(urls[urls.length - 1]).searchParams.get("profile")).toBe("fastbike");
  });

  it("stops asking for 30 s after brouter.de says to slow down", async () => {
    let calls = 0;
    const net = netWith(async (url) => { calls++; return url.endsWith("/profile") ? Response.json({ profileid: "custom_x" }) : new Response("Please, retry later!", { status: 403 }); });
    const router = new BRouter(net);
    await expect(router.route([a, b], run)).rejects.toMatchObject({ code: "busy" });
    const before = calls;
    await expect(router.route([a, b], run)).rejects.toBeInstanceOf(RoutingProblem);
    expect(calls).toBe(before);
    expect(router.available()).toBe(0);
    net.clock.advance(31_000);
    expect(router.available()).toBeGreaterThan(0);
  });

  it("spaces calls and keeps to 30 a minute", async () => {
    const fake = fakeBrouter();
    const net = netWith(fake.handler);
    const router = new BRouter(net);
    for (let i = 0; i < 16; i++) await router.route([a, b], run);
    // 1 upload + 16 routes = 17 calls; the 31st would wait for the window.
    expect(router.available()).toBe(30 - 17);
    expect(net.clock.slept.every((ms) => ms <= 150)).toBe(true);
  });

  it("says plainly when there's no path", async () => {
    const router = new BRouter(netWith(async (url) => (url.endsWith("/profile") ? Response.json({ profileid: "custom_1" }) : new Response("target island detected", { status: 400 }))));
    await expect(router.route([a, b], run)).rejects.toMatchObject({ code: "no_route", status: 422 });
  });

  it("reads distance, ascent, descent and the makeup from BRouter's answer", () => {
    const routed = fromGeoJson({
      features: [{
        geometry: { coordinates: [[-123.12, 49.28, 10], [-123.11, 49.285, 40], [-123.1, 49.29, 20]] },
        properties: {
          "track-length": "1800", "filtered ascend": "35",
          messages: [["Distance", "WayTags"], ["1000", "highway=footway surface=gravel"], ["800", "highway=primary sidewalk=no"]],
        },
      }],
    }, false);
    expect(routed).toMatchObject({ distanceM: 1800, ascentM: 35, descentM: 25 });
    expect(routed.points[0]).toEqual([49.28, -123.12, 10]);
    expect(routed.makeup).toMatchObject({ busyMeters: 800, ways: [{ kind: "path", meters: 1000 }, { kind: "busy", meters: 800 }] });
    expect(routed.makeup!.surfaces).toEqual([{ kind: "gravel", meters: 1000 }, { kind: "paved", meters: 800 }]);
  });
});
