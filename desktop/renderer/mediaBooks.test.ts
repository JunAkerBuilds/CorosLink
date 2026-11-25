import { describe, expect, it } from "vitest";
import { canContinueFrom, clampMinutes, clockAt, fileStem, length, partName, partsSummary, previewParts, watchState } from "./mediaBooks";

const part = (index: number, onWatch = false) => ({ index, name: `${index}`, bytes: 1, secs: 60, chapter: null, onWatch });

describe("audiobook previews", () => {
  it("shows one part per chapter, or equal parts with a short tail joined to the one before", () => {
    const chapters = [{ title: "One", start: 0, secs: 100 }, { title: "Two", start: 100, secs: 50 }];
    expect(previewParts(chapters, 150, { mode: "chapters", minutes: 10 }).map((p) => p.title)).toEqual(["One", "Two"]);
    expect(previewParts([], 1801, { mode: "minutes", minutes: 10 }).map((p) => p.secs)).toEqual([600, 600, 601]);
    expect(previewParts([], 1500, { mode: "minutes", minutes: 10 }).map((p) => p.secs)).toEqual([600, 600, 300]);
    // A book with one chapter can only be split by length.
    expect(previewParts(chapters.slice(0, 1), 1200, { mode: "chapters", minutes: 10 })).toHaveLength(2);
  });

  it("keeps parts between 3 and 180 minutes", () => {
    expect(clampMinutes(1)).toBe(3);
    expect(clampMinutes(500)).toBe(180);
    expect(clampMinutes(Number.NaN)).toBe(10);
  });

  it("names parts the way the watch shows them", () => {
    expect(partName(fileStem("Dune: Part / One"), 1, 20)).toBe("001 Dune Part One.mp3");
    expect(length(41720)).toBe("11 h 35 min");
    expect(length(2520)).toBe("42 min");
    expect(clockAt(3723)).toBe("1:02:03");
    expect(partsSummary({ parts: [part(1), part(2)], split: { mode: "minutes", minutes: 10 }, note: null })).toBe("2 × 10 min");
  });
});

describe("continuing a book", () => {
  it("only moves forward through parts on the watch; with none there any part can be the start", () => {
    const on = { parts: [part(1, true), part(2, true), part(3)], resume: 1 };
    expect(canContinueFrom(on, on.parts[1])).toBe(true);
    expect(canContinueFrom(on, on.parts[0])).toBe(false);
    expect(canContinueFrom(on, on.parts[2])).toBe(false);
    const off = { parts: [part(1), part(2), part(3)], resume: 2 };
    expect(canContinueFrom(off, off.parts[0])).toBe(true);
    expect(canContinueFrom(off, off.parts[1])).toBe(false);
  });

  it("counts what's left to play from the resume point", () => {
    expect(watchState({ parts: [part(1), part(2, true), part(3, true)], resume: 2, status: "ready" })).toEqual({ toPlay: 2, onWatch: 2, anyOnWatch: true, listened: 1, all: true });
  });
});
