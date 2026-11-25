import { describe, expect, it } from "vitest";
import { hubDetail, hubEntries } from "./training";

describe("COROS calendar entries", () => {
  it("formats distance and time, or sets", () => {
    expect(hubDetail({ seconds: 2996, meters: 9600, sets: 0 })).toBe("9.60 km · 49:56");
    expect(hubDetail({ seconds: 900, meters: 0, sets: 18 })).toBe("18 sets");
    expect(hubDetail({ seconds: 0, meters: 6000, sets: 0 })).toBe("6.00 km");
    expect(hubDetail(null)).toBe("");
  });

  it("turns each planned workout into a planned COROS entry on its day", () => {
    const entries = hubEntries([
      { day: "2026-11-20", workouts: [{ day: "2026-11-20", idInPlan: "7", planId: "0", planProgramId: "", name: "Easy run", sportCode: 1, sport: "trailRun", workout: null, totals: { seconds: 1800, meters: 6000, sets: 0 } }] },
      { day: "2026-11-21", workouts: [] },
    ]);
    expect(entries).toEqual([
      { id: "coros-2026-11-20-7", date: "2026-11-20", sport: "run", name: "Easy run", detail: "6.00 km · 30:00", status: "planned", source: "coros", metres: 6000, seconds: 1800, workoutId: undefined, coros: { idInPlan: "7", name: "Easy run", workout: null } },
    ]);
  });
});
