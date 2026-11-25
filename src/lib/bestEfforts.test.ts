import { describe, expect, it } from "vitest";
import { bestEfforts, timesFromDistance } from "./bestEfforts";

describe("best efforts", () => {
  it("finds the quickest stretch, between samples too", () => {
    // 2 km: first km at 5:00, second at 4:00, one sample every 100 m.
    const d = Array.from({ length: 21 }, (_, i) => i * 100);
    const t = d.map((m) => (m <= 1000 ? m * 0.3 : 300 + (m - 1000) * 0.24));
    const e = bestEfforts(t, d);
    expect(e.map((x) => x.name)).toEqual(["400 m", "1 km", "1 mile"]);
    expect(e[0].seconds).toBeCloseTo(96, 6);
    expect(e[1].seconds).toBeCloseTo(240, 6);
    expect(e[2].seconds).toBeCloseTo(240 + 609.344 * 0.3, 6);
  });
  it("gives nothing for samples that go backwards", () => {
    expect(bestEfforts([0, 10, 5], [0, 100, 200])).toEqual([]);
  });
  it("builds times from a distance recording, holding speed through stops", () => {
    expect(timesFromDistance([0, 100, 200, 300], [null, 4, 0, 5])).toEqual([0, 25, 50, 70]);
    expect(timesFromDistance([0], [1])).toBeNull();
  });
});
