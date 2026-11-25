import { describe, expect, it } from "vitest";
import { netWith } from "./fakes";
import { Nominatim, NOMINATIM_GAP_MS } from "./nominatim";

describe("Nominatim", () => {
  it("leaves at least 1.1 s between calls, even when asked at once (must not regress)", async () => {
    const starts: number[] = [];
    const net = netWith(async () => { starts.push(net.now()); return Response.json([]); });
    const places = new Nominatim(net);
    await Promise.all([places.search("Stanley Park"), places.search("Kitsilano"), places.reverse(49.3, -123.1), places.search("Granville")]);
    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1_100);
    expect(NOMINATIM_GAP_MS).toBeGreaterThanOrEqual(1_100);
  });

  it("sends its own User-Agent and only the search text", async () => {
    let seen: { url: URL; headers: Headers } | null = null;
    const places = new Nominatim(netWith(async (url, init) => {
      seen = { url: new URL(url), headers: new Headers(init?.headers) };
      return Response.json([{ lat: "49.30", lon: "-123.14", name: "Stanley Park", display_name: "Stanley Park, Vancouver, British Columbia, Canada" }]);
    }));
    const found = await places.search("  Stanley Park ");
    expect(found).toEqual([{ name: "Stanley Park", detail: "Vancouver, British Columbia, Canada", lat: 49.3, lon: -123.14 }]);
    const { url, headers } = seen!;
    expect(headers.get("User-Agent")).toBe("C-LINK Desktop");
    expect([...url.searchParams.keys()].sort()).toEqual(["format", "limit", "q"]);
    expect(url.searchParams.get("q")).toBe("Stanley Park");
  });

  it("doesn't call for one letter, and names a point when nothing is there", async () => {
    let calls = 0;
    const places = new Nominatim(netWith(async () => { calls++; return Response.json({ error: "Unable to geocode" }); }));
    expect(await places.search("a")).toEqual([]);
    expect(calls).toBe(0);
    expect(await places.reverse(10, 20)).toEqual({ name: "10.00000, 20.00000", lat: 10, lon: 20 });
  });
});
