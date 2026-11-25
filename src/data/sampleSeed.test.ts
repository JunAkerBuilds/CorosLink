import { describe, expect, it } from "vitest";
import { seedItems } from "./sampleSeed";

const NOW = new Date(2026, 10, 20, 14, 10);

describe("the seed", () => {
  const items = seedItems(NOW);
  const count = (c: string) => items.filter((i) => i.collection === c).length;

  it("holds what a phone would have sent", () => {
    expect(count("activity")).toBeGreaterThanOrEqual(30);
    expect(count("activity.detail")).toBeGreaterThan(4);
    expect(count("health.day")).toBe(60);
    expect(count("health.night")).toBe(60);
    expect(count("energy.day")).toBe(14);
    expect(count("gym.workout")).toBe(12);
    expect(count("gym.routine")).toBe(3);
    for (const c of ["fuel.profile", "watch.state", "view.training", "view.strength", "view.body", "body.goals"]) expect(count(c)).toBe(1);
    expect(count("fuel.entry")).toBeGreaterThan(30);
  });

  it("uses the contract's ids and dates", () => {
    for (const i of items) {
      expect(i.collection).toMatch(/^[a-z][a-z0-9.]{0,39}$/);
      expect(i.id).toMatch(/^[A-Za-z0-9._:\-]{1,128}$/);
      expect(JSON.stringify(i.body).length).toBeLessThan(256 * 1024);
    }
    const entry = items.find((i) => i.collection === "fuel.entry")!.body as { id: string; time: number };
    expect(entry.id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
    // Reference-date seconds: November 2026 is about 815 million seconds after 2001.
    expect(entry.time).toBeGreaterThan(8.1e8);
    expect(entry.time).toBeLessThan(8.2e8);
    expect(items.some((i) => i.collection === "health.day" && i.id === "2026-11-20")).toBe(true);
  });

  it("is the same for the same day", () => {
    expect(JSON.stringify(seedItems(NOW))).toBe(JSON.stringify(items));
  });
});
