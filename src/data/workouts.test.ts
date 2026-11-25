import { describe, expect, it } from "vitest";
import { sampleLibrary } from "@/data/sample/workoutLibrary";
import { sampleProfile } from "@/data/sample/workouts";
import { savedFromDoc, workoutEntries } from "./workouts";

const doc = (id: string) => sampleLibrary.find((w) => w.id === id)!.doc;
const at = new Date("2026-11-20T08:00:00Z");

describe("a builder workout in this browser's calendar", () => {
  it("keeps the builder's workout, its totals and steps Coach can read", () => {
    const saved = savedFromDoc(doc("sample-lib-cruise"), "2026-11-26", "w-1", sampleProfile.pacing, 1, at);
    expect(saved).toMatchObject({ id: "w-1", name: "Cruise intervals, 4 × 1 km", sport: "run", date: "2026-11-26", repeatWeeks: 1, summary: { detail: "49:56 · 9.60 km", metres: 9600 }, savedAt: at.toISOString() });
    expect(saved.doc).toEqual(doc("sample-lib-cruise"));
    expect(saved.items).toHaveLength(3);
    expect(saved.summary.load).toBeGreaterThan(0);
    expect(workoutEntries(saved)).toEqual([expect.objectContaining({ id: "w-1@2026-11-26", sport: "run", detail: "49:56 · 9.60 km", source: "browser", workoutId: "w-1", metres: 9600 })]);
  });

  it("guesses nothing when the athlete's paces aren't known", () => {
    expect(savedFromDoc(doc("sample-lib-cruise"), "2026-11-26", "w-1", null, 1, at).summary).toEqual({ detail: "9.60 km", metres: 9600, load: 0 });
  });

  it("files a gym workout under strength, named when the name is blank", () => {
    const saved = savedFromDoc({ ...doc("sample-lib-push"), name: " " }, "2026-11-23", "w-2", sampleProfile.pacing, 1, at);
    expect(saved).toMatchObject({ name: "Structured Workout", sport: "strength", items: [], summary: { detail: "5 exercises · 17 sets", metres: 0, load: 0 } });
  });

  it("keeps a weekly repeat the first builder set", () => {
    const saved = savedFromDoc(doc("sample-lib-long"), "2026-11-22", "w-3", null, 4, at);
    expect(workoutEntries(saved).map((e) => e.date)).toEqual(["2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13"]);
  });
});
