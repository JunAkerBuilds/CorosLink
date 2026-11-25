import { describe, expect, it } from "vitest";
import { mapVersionFor } from "../../../maps/types";
import { isOfficialUrl, mapVersionOf, packagesOf, parseManifest, parsePackageId, regionName } from "./manifest";

// Rows as COROS's regions_v6.json has them (2026-11): v6 landscape zips, topo rows still pointing at the v5 zips.
const v6 = {
  v: "6", host: "https://map-oss-us.coros.com/", updatedAt: "2026-10-27 04:49:55", bundleVersion: "6.0.0",
  mapData: [
    { region: "asia", title: "map.asia", parent: "global", type: "landscape", data: { size: 100, link: "/regionMap/v6/asia_landscape_6.0.0.zip" } },
    { region: "asia", title: "map.asia", parent: "global", type: "topo", data: { size: 200, link: "/regionMap/v5/asia_topo_5.0.3.zip" } },
    { region: "asia1", title: "map.asia1", parent: "asia", type: "topo", data: { size: 300, link: "/regionMap/v5/asia1_topo_5.0.3.zip" } },
    { region: "australia-oceania", parent: "global", type: "topo", data: { size: 1, link: "/regionMap/v5/australia-oceania_topo_5.0.3.zip" } },
    { region: "evil", parent: "global", type: "topo", data: { size: 1, link: "https://example.com/evil.zip" } },
    { region: "broken", parent: "global", type: "satellite", data: { size: 1, link: "/x.zip" } },
  ],
};

describe("COROS map list", () => {
  it("parses regions with their parent, continent and both layers", () => {
    const m = parseManifest(v6, 6);
    expect(m.version).toBe(6);
    expect(m.release).toBe("6.0.0");
    expect(m.updatedAt).toBe("2026-10-26T20:49:55.000Z");
    expect(m.regions.map((r) => r.id)).toEqual(["asia", "asia1", "australia-oceania"]);
    const asia1 = m.regions.find((r) => r.id === "asia1")!;
    expect(asia1).toMatchObject({ name: "Asia 1", parent: "asia", continent: "Asia" });
    expect(m.regions[0].landscape).toEqual({ id: "v6:landscape:asia", layer: "landscape", sizeBytes: 100, url: "https://map-oss-us.coros.com/regionMap/v6/asia_landscape_6.0.0.zip" });
    expect(regionName("australia-oceania")).toBe("Australia & Oceania");
  });

  it("gives a zip the id of the folder it lives in, so v5 and v6 lists share the v5 topo download", () => {
    const m = parseManifest(v6, 6);
    expect(m.regions[0].topo?.id).toBe("v5:topo:asia");
    expect(packagesOf(m).has("v5:topo:asia1")).toBe(true);
    expect(parsePackageId("v5:topo:asia1")).toEqual({ version: 5, layer: "topo", region: "asia1" });
    expect(parsePackageId("v5:topo:../x")).toBeNull();
  });

  it("only takes COROS's own map host over HTTPS", () => {
    expect(isOfficialUrl("https://map-oss-us.coros.com/regionMap/v5/a.zip")).toBe(true);
    expect(isOfficialUrl("http://map-oss-us.coros.com/regionMap/v5/a.zip")).toBe(false);
    expect(isOfficialUrl("https://map-oss-us.coros.com.evil.com/a.zip")).toBe(false);
  });

  it("asks for a known version, v5 otherwise", () => {
    expect(mapVersionOf("6")).toBe(6);
    expect(mapVersionOf("4")).toBe(4);
    expect(mapVersionOf("9")).toBe(5);
    expect(mapVersionOf(null)).toBe(5);
  });

  it("picks the map version per model", () => {
    expect(mapVersionFor("PACE 4 Pro")).toBe(6);
    for (const w of ["APEX 4 46mm", "PACE 4", "NOMAD", "PACE Pro"]) expect(mapVersionFor(w)).toBe(5);
    expect(mapVersionFor("VERTIX 4")).toBe(6);
    for (const w of ["VERTIX 2S", "VERTIX 2", "VERTIX", "APEX 2 Pro", "APEX 2", "APEX Pro"]) expect(mapVersionFor(w)).toBe(4);
    expect(mapVersionFor(undefined)).toBe(5);
    expect(mapVersionFor("PACE 3")).toBe(5);
  });
});
