import { describe, expect, it } from "vitest";
import type { NativeActivity } from "@/data/sync/native";
import { cleaned, clock, fingerprint, instructions, languageTag, noteId, readNote, shortened, workoutFacts } from "./workoutNote";

const run = { id: "478812345678901201", name: "Morning tempo", sport: "run", start: 817_000_000, distanceMeters: 10_000, durationSeconds: 3083.1, averageHR: 148, maxHR: 171, elevationGain: 62 } as unknown as NativeActivity;

describe("workout facts", () => {
  it("gives the basics in the athlete's units and leaves out what isn't there", () => {
    const facts = workoutFacts(run, undefined);
    expect(facts).toContain("Sport: run");
    expect(facts).toContain("Distance: 10.00 km");
    expect(facts).toContain("Time: 51:23");
    expect(facts).toContain("Average pace: 5:08 /km");
    expect(facts).toContain("Average heart rate: 148 bpm");
    expect(facts).toContain("Elevation gain: 62 m");
    expect(facts).not.toContain("Pacing");
    expect(facts).not.toContain("power");
    const miles = workoutFacts(run, undefined, { imperial: true });
    expect(miles).toContain("Distance: 6.21 mi");
    expect(miles).toContain("Average pace: 8:16 /mi");
    expect(miles).toContain("Elevation gain: 203 ft");
  });

  it("says when it was, where the athlete is", () => {
    // 817,000,000 s after 2001 is 2026-11-22 00:26:40 UTC.
    expect(workoutFacts(run, undefined)).toContain("When: Sunday, November 22, 00:26");
    expect(workoutFacts(run, undefined, { utcOffsetMinutes: -300 })).toContain("When: Saturday, November 21, 19:26");
  });

  it("works the pacing out from the laps, so the model never subtracts", () => {
    const lap = (durationS: number) => ({ n: 1, distanceM: 1000, durationS });
    expect(workoutFacts(run, { laps: [lap(320), lap(318), lap(300), lap(298)] })).toContain("Pacing: negative split, second half 6.3% faster");
    expect(workoutFacts(run, { laps: [lap(300), lap(301), lap(302), lap(300)] })).toContain("Pacing: even halves");
    expect(workoutFacts(run, { laps: [lap(300), lap(300), lap(330), lap(330)] })).toContain("Pacing: second half 10.0% slower");
    expect(workoutFacts(run, { laps: [lap(300), lap(300)] })).not.toContain("Pacing");
  });

  it("gives the share of time in each heart rate zone", () => {
    const zones = [1, 2, 3, 4, 5].map((zone, i) => ({ zone, fromBpm: null, toBpm: null, seconds: [600, 1200, 900, 300, 0][i] }));
    expect(workoutFacts(run, { zones })).toContain("Time in heart rate zones: easy 20%, aerobic 40%, tempo 30%, threshold 10%");
  });

  it("rides get a speed, not a pace", () => {
    const ride = { ...run, sport: "ride", distanceMeters: 40_000, durationSeconds: 4800 } as unknown as NativeActivity;
    expect(workoutFacts(ride, undefined)).toContain("Average speed: 30.0 km/h");
  });
});

describe("notes", () => {
  it("keep the answer clean and short", () => {
    expect(cleaned('  "**Summary:** Nice and steady."  ')).toBe("Summary: Nice and steady.");
    expect(cleaned("Summary: Nice and steady.")).toBe("Nice and steady.");
    expect(cleaned('  “ ”  ')).toBeNull();
    const long = "A steady one. " + "x".repeat(400);
    expect(shortened(long)).toBe(long);
    expect(shortened("First sentence is long enough to stand. ".repeat(4) + "y".repeat(300)).endsWith("stand.")).toBe(true);
    expect(clock(3723)).toBe("1:02:03");
  });

  it("are named by kind, workout and language, and read back whole or not at all", () => {
    expect(noteId("workout", "478812345678901201", "pt")).toBe("workout.478812345678901201.pt");
    expect(languageTag("zh-Hans")).toBe("zh-Hans");
    expect(languageTag("english please")).toBeNull();
    expect(instructions("fr")).toContain("Write in French");
    expect(fingerprint("a")).toBe(fingerprint("a"));
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
    expect(readNote({ kind: "workout", key: "1", language: "en", text: "Steady.", writer: "phone", model: "onDevice", writtenAt: 5 }))
      .toEqual({ kind: "workout", key: "1", language: "en", text: "Steady.", writer: "phone", model: "onDevice", writtenAt: 5 });
    expect(readNote({ kind: "workout", key: "1", language: "en", text: "" })).toBeNull();
    expect(readNote({ kind: "morning", key: "1", language: "en", text: "x" })).toBeNull();
  });
});
