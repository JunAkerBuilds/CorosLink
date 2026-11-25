import { describe, expect, it } from "vitest";
import { following, needsYou, nextReadIn, promptVersion, statusLine, type UpdateState } from "./updates";

const at = (phase: UpdateState["phase"], more: Partial<UpdateState> = {}): UpdateState => ({
  version: "0.2.0", phase, available: null, percent: null, problem: null, checkedAt: null, auto: { check: true, download: true }, ...more,
});
const found = { version: "0.2.1", date: null, notes: "Fixes" };

describe("updates in the page", () => {
  it("follows the updater only while it's busy, and otherwise reads now and then", () => {
    expect(following(at("checking"))).toBe(true);
    expect(following(at("downloading"))).toBe(true);
    expect(nextReadIn(at("downloading"))).toBe(1000);
    // Before the first check after launch it looks again soon, so the startup check is followed.
    expect(nextReadIn(at("idle"))).toBe(15_000);
    expect(nextReadIn(at("idle", { auto: { check: false, download: true } }))).toBe(30 * 60_000);
    expect(nextReadIn(at("none"))).toBe(30 * 60_000);
    // A development build has no updater: nothing to read again.
    expect(nextReadIn(at("unavailable"))).toBeNull();
    expect(nextReadIn(null)).toBeNull();
  });

  it("shows the sidebar dot only when an update waits for the person", () => {
    expect(needsYou(at("ready", { available: found }))).toBe(true);
    expect(needsYou(at("available", { available: found }))).toBe(true);
    for (const phase of ["idle", "checking", "none", "downloading", "failed", "unavailable"] as const) expect(needsYou(at(phase))).toBe(false);
  });

  it("says where things stand in plain words", () => {
    expect(statusLine(at("unavailable"))).toBe("Updates come with the installed app.");
    expect(statusLine(at("none"))).toBe("C-LINK is up to date.");
    expect(statusLine(at("none", { checkedAt: 1 }), () => "today")).toBe("C-LINK is up to date (checked today).");
    expect(statusLine(at("downloading", { available: found, percent: 42 }))).toBe("Downloading C-LINK 0.2.1… 42%");
    expect(statusLine(at("failed", { problem: "Couldn't reach the update server." }))).toBe("Couldn't reach the update server.");
    expect(statusLine(at("failed"))).toBe("The update didn't work. Try again later.");
  });

  it("prompts once per version, found or downloaded, unless Later was picked for it", () => {
    const none = new Set<string>();
    expect(promptVersion(at("available", { available: found }), null, none)).toBe("0.2.1");
    expect(promptVersion(at("downloading", { available: found }), null, none)).toBe("0.2.1");
    expect(promptVersion(at("ready", { available: found }), null, none)).toBe("0.2.1");
    expect(promptVersion(at("ready", { available: found }), "0.2.1", none)).toBeNull();
    expect(promptVersion(at("ready", { available: found }), "0.2.0", none)).toBe("0.2.1");
    expect(promptVersion(at("ready", { available: found }), null, new Set(["0.2.1"]))).toBeNull();
    expect(promptVersion(at("none"), null, none)).toBeNull();
    expect(promptVersion(at("failed", { available: found }), null, none)).toBeNull();
    expect(promptVersion(null, null, none)).toBeNull();
  });
});
