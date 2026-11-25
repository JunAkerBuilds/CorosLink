import { describe, expect, it } from "vitest";
import { netWith } from "./fakes";
import { Overpass, stitch } from "./overpass";

describe("Overpass trails", () => {
  it("lists marked routes in the box", async () => {
    let query = "";
    const overpass = new Overpass(netWith(async (_url, init) => {
      query = decodeURIComponent(String(init?.body).slice(5));
      return Response.json({ elements: [
        { type: "relation", id: 11, tags: { route: "hiking", name: "Baden-Powell Trail", network: "rwn", distance: "48" } },
        { type: "relation", id: 12, tags: { route: "mtb", ref: "M7" } },
        { type: "relation", id: 13, tags: { route: "bus", name: "99" } },
      ] });
    }));
    const trails = await overpass.trails({ south: 49.2, west: -123.2, north: 49.4, east: -123 }, ["hike", "mtb"]);
    expect(trails).toEqual([
      { id: "11", name: "Baden-Powell Trail", kind: "hike", distanceKm: 48, network: "rwn" },
      { id: "12", name: "M7", kind: "mtb" },
    ]);
    expect(query).toContain('"route"~"^(hiking|foot|mtb)$"');
  });

  it("asks to zoom in on a wide box", async () => {
    const overpass = new Overpass(netWith(async () => Response.json({ elements: [] })));
    await expect(overpass.trails({ south: 40, west: -125, north: 50, east: -115 }, [])).rejects.toMatchObject({ code: "zoom_in" });
  });

  it("joins a relation's ways end to end", async () => {
    expect(stitch([[[0, 0], [0, 1]], [[0, 2], [0, 1]], [[0, 2], [0, 3]]])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(stitch([[[0, 1], [0, 0]], [[0, 1], [0, 2]]])).toEqual([[0, 0], [0, 1], [0, 2]]);
    const overpass = new Overpass(netWith(async () => Response.json({ elements: [{ type: "relation", id: 5, tags: { route: "bicycle", name: "Seaside" }, members: [
      { type: "way", role: "", geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] },
      { type: "way", role: "alternative", geometry: [{ lat: 5, lon: 5 }, { lat: 6, lon: 6 }] },
      { type: "way", role: "", geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }] },
    ] }] })));
    expect(await overpass.relation("5")).toEqual({ name: "Seaside", kind: "cycle", points: [[1, 1], [1, 2], [1, 3]] });
    await expect(overpass.relation("../x")).rejects.toMatchObject({ status: 404 });
  });
});
