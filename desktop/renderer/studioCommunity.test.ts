import { describe, expect, it } from "vitest";
import type { CommunityFace, CommunityPage } from "./studio";
import { downloads, hasMoreAfter, mergePage, modelFor } from "./studioCommunity";

const face = (id: string) => ({ id, slug: id, title: id }) as CommunityFace;
const page = (n: number, count: number, ids: string[]): CommunityPage =>
  ({ schemaVersion: 1, items: ids.map(face), pagination: { page: n, pageSize: 12, total: 99, pageCount: count }, facets: { models: [], styles: [] } });

describe("community list", () => {
  it("never repeats a face the catalog sends again at a page boundary", () => {
    expect(mergePage(page(1, 3, ["a", "b"]), page(2, 3, ["b", "c"])).items.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
  it("stops when the catalog clamps the page or runs out", () => {
    expect(hasMoreAfter(page(2, 3, ["x"]), 2)).toBe(true);
    expect(hasMoreAfter(page(3, 3, ["x"]), 3)).toBe(false);
    expect(hasMoreAfter(page(1, 3, ["x"]), 2)).toBe(false);
    expect(hasMoreAfter(page(2, 3, []), 2)).toBe(false);
  });
  // Must not regress: a face that doesn't list the watch opens only after "Open anyway".
  it("downloads the chosen watch's version, and says when the face doesn't list it", () => {
    expect(modelFor(["PACE 4", "PACE Pro"], "PACE Pro")).toEqual({ model: "PACE Pro", fits: true });
    expect(modelFor(["APEX 4"], "PACE Pro")).toEqual({ model: "APEX 4", fits: false });
  });
  it("shortens download counts", () => {
    expect([downloads(950), downloads(1200), downloads(12_400), downloads(9_999)]).toEqual(["950", "1.2k", "12k", "10k"]);
  });
});
