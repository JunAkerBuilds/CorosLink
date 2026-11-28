import { describe, expect, it } from "vitest";
import { COMPUTER } from "./computer";
import { backStep, coachSays, countdown, LIST, listIndex, nextStep, placeHref, readPlace, stepNote } from "./setupFlow";

describe("setup steps", () => {
  it("reads the step and source from the address, starting at the first step", () => {
    expect(readPlace("")).toEqual({ step: "source", source: "phone" });
    expect(readPlace("?step=sports&from=look")).toEqual({ step: "sports", source: "look" });
    expect(readPlace("?step=welcome&from=watch")).toEqual({ step: "source", source: "phone" });
    expect(readPlace(new URL(`clink://app${placeHref({ step: "coach", source: "backup" })}`).search)).toEqual({ step: "coach", source: "backup" });
  });

  it("goes through the phone only when the data comes from it", () => {
    expect(nextStep("source", "phone")).toBe("phone");
    expect(nextStep("source", "look")).toBe("sports");
    expect(nextStep("source", "backup")).toBe("sports");
    expect(nextStep("phone", "phone")).toBe("sports");
    expect(nextStep("sports", "look")).toBe("coach");
    expect(nextStep("mac", "phone")).toBe("done");
    expect(nextStep("done", "phone")).toBe("done");
  });

  it("goes back the way it came", () => {
    expect(backStep("sports", "phone")).toBe("phone");
    expect(backStep("sports", "look")).toBe("source");
    expect(backStep("coach", "look")).toBe("sports");
    expect(backStep("source", "phone")).toBe("source");
  });

  it("marks the steps before the current one done, with a note each", () => {
    expect(LIST.map((l) => l.label)).toEqual(["Your data", "Connect", "Your sports", "Coach", `This ${COMPUTER}`]);
    expect(listIndex("phone")).toBe(1);
    expect(listIndex("done")).toBe(LIST.length);
    const notes = { phone: "iPhone 17 Pro", sports: 3, coach: "ChatGPT" };
    expect(stepNote("source", "phone", notes)).toBe("Your phone");
    expect(stepNote("connect", "phone", notes)).toBe("iPhone 17 Pro");
    expect(stepNote("connect", "phone", { ...notes, phone: null })).toBe("Later");
    expect(stepNote("connect", "look", notes)).toBe("Skipped");
    expect(stepNote("sports", "look", notes)).toBe("3 picked");
    expect(stepNote("coach", "look", { ...notes, coach: null })).toBe("Later");
  });

  it("has a line from Coach for every step, cheering once the phone is paired", () => {
    expect(coachSays("phone", { paired: false, hasData: false }).pose).toBe("listen");
    expect(coachSays("phone", { paired: true, hasData: false }).pose).toBe("cheer");
    expect(coachSays("sports", { paired: false, hasData: true }).line).toMatch(/found in your workouts/);
    for (const step of ["source", "phone", "sports", "coach", "mac", "done"] as const) expect(coachSays(step, { paired: false, hasData: false }).line).not.toBe("");
  });


  it("reads an old COROS-account address as the phone", () => {
    expect(readPlace("?step=phone&from=coros")).toEqual({ step: "phone", source: "phone" });
  });

  it("counts the code down", () => {
    expect(countdown(582)).toBe("9:42");
    expect(countdown(5)).toBe("0:05");
    expect(countdown(-3)).toBe("0:00");
  });
});
