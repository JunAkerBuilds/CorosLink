import { describe, expect, it } from "vitest";
import {
  COACH_KEY_WORDS, coachKeyConnected, connectedCount, hevyCachedLabel, hevyPill, hevyProgress, managedOnPhone,
} from "./connections";

describe("connected count", () => {
  it("counts only what is known to be on", () => {
    expect(connectedCount([true, false, null, undefined, true])).toBe(2);
    expect(connectedCount([])).toBe(0);
  });
  it("counts Coach with a real key, not the scripted model or none", () => {
    expect(coachKeyConnected("own")).toBe(true);
    expect(coachKeyConnected("mock")).toBe(false);
    expect(coachKeyConnected("none")).toBe(false);
    expect(COACH_KEY_WORDS.none).toBe("None yet");
  });
});

describe("the Hevy card", () => {
  it("says what the connection is doing on its pill", () => {
    expect(hevyPill({ connected: false, syncing: false, syncProblem: null })).toEqual({ tone: "quiet", text: "Not connected" });
    expect(hevyPill({ connected: true, syncing: true, syncProblem: "old" })).toEqual({ tone: "quiet", text: "Syncing…" });
    expect(hevyPill({ connected: true, syncing: false, syncProblem: "Hevy couldn't be reached." })).toEqual({ tone: "bad", text: "Couldn't sync" });
    expect(hevyPill({ connected: true, syncing: false, syncProblem: null })).toEqual({ tone: "ok", text: "Connected" });
  });
  it("counts as connected once a key is saved, whatever the last sync did", () => {
    expect(connectedCount([true, true, false, hevyPill({ connected: true, syncing: false, syncProblem: "x" }).text !== "Not connected"])).toBe(3);
  });
  it("words the progress and the cached count", () => {
    expect(hevyProgress(null)).toBeNull();
    expect(hevyProgress(1240)).toBe("Read 1,240 so far");
    expect(hevyCachedLabel(null)).toBeNull();
    expect(hevyCachedLabel(1)).toBe("1 workout");
    expect(hevyCachedLabel(128)).toBe("128 workouts");
  });
});

describe("the lists", () => {
  it("names the watch only when the phone reported one", () => {
    expect(managedOnPhone("PACE Pro")[1].name).toBe("PACE Pro");
    expect(managedOnPhone(undefined)[1].name).toBe("Your watch");
    expect(managedOnPhone("  ")[1].name).toBe("Your watch");
    expect(managedOnPhone(null).map((row) => row.where)).toEqual(["In the C-LINK app", "In the C-LINK app", "In the C-LINK app"]);
  });
});
