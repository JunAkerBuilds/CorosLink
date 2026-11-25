import { describe, expect, it } from "vitest";
import { matchPattern, patternOf } from "./routePaths";

describe("routes from the web app's folders", () => {
  it("drops route groups and the page file", () => {
    expect(patternOf("../../src/app/(app)/page.tsx", "../../src/app")).toBe("/");
    expect(patternOf("../../src/app/(app)/activities/[id]/page.tsx", "../../src/app")).toBe("/activities/[id]");
    expect(patternOf("../../src/app/(app)/coach/settings/page.tsx", "../../src/app")).toBe("/coach/settings");
  });
  it("matches paths and reads params", () => {
    expect(matchPattern("/activities/[id]", "/activities/47%2001")).toEqual({ id: "47 01" });
    expect(matchPattern("/calendar", "/calendar/")).toEqual({});
    expect(matchPattern("/calendar", "/calendar/new")).toBeNull();
  });
});
