import { describe, expect, it } from "vitest";
import { backgroundElementBounds, backgroundTextLines, backgroundTextLineY, createBackgroundElement } from "../watchface/engine/watchfaceBackgroundElements";

const text = (patch: object = {}) => ({ ...createBackgroundElement("text", { x: 400, y: 400 }, "Inter"), ...patch }) as Extract<ReturnType<typeof createBackgroundElement>, { kind: "text" }>;

describe("Plain text options", () => {
  it("draws the text in the case picked, whatever was typed", () => {
    expect(backgroundTextLines(text({ text: "good morning" }))).toEqual(["good morning"]);
    expect(backgroundTextLines(text({ text: "good morning", textCase: "upper" }))).toEqual(["GOOD MORNING"]);
    expect(backgroundTextLines(text({ text: "GOOD Morning", textCase: "lower" }))).toEqual(["good morning"]);
    expect(backgroundTextLines(text({ text: "gOOD morning-run", textCase: "title" }))).toEqual(["Good Morning-Run"]);
  });

  it("splits at line breaks, the block centred on the text's point", () => {
    const t = text({ text: "RUN\nFAR\nFAST", fontSize: 50, lineHeight: 1.2 });
    expect(backgroundTextLines(t)).toEqual(["RUN", "FAR", "FAST"]);
    expect([0, 1, 2].map((i) => backgroundTextLineY(t, i, 3))).toEqual([-60, 0, 60]);
    // More lines and wider letters make the box bigger.
    const one = backgroundElementBounds(text({ text: "RUN", fontSize: 50 }));
    const three = backgroundElementBounds(t);
    expect(three.y1 - three.y0).toBeGreaterThan(one.y1 - one.y0 + 100);
    const spaced = backgroundElementBounds(text({ text: "RUN", fontSize: 50, letterSpacing: 20 }));
    expect(spaced.x1 - spaced.x0).toBeCloseTo(one.x1 - one.x0 + 60);
  });
});
