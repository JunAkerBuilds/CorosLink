import { describe, expect, it } from "vitest";
import { seedItems } from "@/data/sampleSeed";
import { alertFromItem, illnessBody, spellsFromItem } from "./bodyAlert";
import type { BodyAlertBody, BodyIllnessBody } from "./native";
import { lastNight, lookOf } from "@/lib/bodyAlert";

const NOW = new Date(2026, 10, 20, 9, 30);
const item = <T,>(c: string) => seedItems(NOW).find((i) => i.collection === c)?.body as T;

describe("body.alert and body.illness", () => {
  it("reads the phone's Body Alert", () => {
    const a = alertFromItem(item<BodyAlertBody>("body.alert"))!;
    expect(a.nights).toHaveLength(28);
    expect(a.nights.at(-1)!.day).toBe("2026-11-20");
    expect(lookOf(a.state)).toBe("alert");
    expect(lastNight(a)!.signals.map((s) => s.signal)).toEqual(["heart", "hrv", "breathing"]);
  });

  it("is null until a phone sends it, and drops what it can't read", () => {
    expect(alertFromItem(undefined)).toBeNull();
    const a = alertFromItem({ on: true, state: "bogus" as never, nightsLearned: 40, nights: [{ day: { year: 2026, month: 11, day: 3 }, state: "normal", nightClass: "normal", level: 1, signals: [{ signal: "nose" as never, channel: "x", value: 1, usual: 1, spread: 1, z: 0 }] }] })!;
    expect(a.state).toBe("learning");
    expect(a.nightsLearned).toBe(14);
    expect(a.nights[0].signals).toEqual([]);
  });

  it("round-trips Illness mode and keeps what the phone stored", () => {
    const had: BodyIllnessBody = { spells: [], confirmedAt: 100 };
    const body = illnessBody([{ start: Date.UTC(2026, 10, 20) }], had);
    expect(body.confirmedAt).toBe(100);
    expect(spellsFromItem(body)).toEqual([{ start: Date.UTC(2026, 10, 20) }]);
  });
});
