import { describe, expect, it } from "vitest";
import { columnBars, dayTime, heatIndexAt, heatPaths, hMin, hoursClock, monthCells, openingLine } from "./dashboard";

describe("dashboard time words", () => {
  it("writes hours and minutes the way the board does", () => {
    expect(hMin(178)).toBe("2 h 58");
    expect(hMin(57)).toBe("0 h 57");
    expect(hMin(330)).toBe("5 h 30");
    expect(dayTime(38)).toBe("38 min");
    expect(dayTime(72)).toBe("1 h 12");
    expect(hoursClock(7.25)).toBe("7:15");
    expect(hoursClock(7.7)).toBe("7:42");
  });
});

describe("heat map", () => {
  it("puts each day in its week column and weekday row", () => {
    const [p0, p1] = heatPaths([0, 1, 0, 0, 0, 0, 0, 1]);
    expect(p1).toBe("M2 17h11v11h-11zM17 2h11v11h-11z");
    expect(p0.split("M").length - 1).toBe(6);
  });

  it("finds the day under the pointer and never one past today", () => {
    expect(heatIndexAt(0, 0, 53, 368)).toBe(0);
    expect(heatIndexAt(0.999, 0.999, 53, 368)).toBe(367);
    expect(heatIndexAt(1 / 53 + 0.001, 3 / 7 + 0.001, 53, 368)).toBe(10);
  });
});

describe("month grid", () => {
  it("starts on Monday: November 2026 opens on a Sunday after six blanks", () => {
    const cells = monthCells("2026-11", "2026-11-19", [1, 19], [20]);
    expect(cells.filter((c) => c.day == null)).toHaveLength(6);
    expect(cells).toHaveLength(36);
    expect(cells[6]).toEqual({ day: 1, done: true, planned: false, today: false });
    expect(cells.find((c) => c.day === 19)?.today).toBe(true);
    expect(cells.find((c) => c.day === 20)?.planned).toBe(true);
  });
});

describe("column bars", () => {
  it("stands bars on the bottom of the box", () => {
    expect(columnBars([7, 3.5], 90, (v) => (v / 7) * 90, 25, 19, 3)).toBe("M3 0.0h19v90.0h-19z M28 45.0h19v45.0h-19z");
  });
});

describe("the dashboard's headline", () => {
  it("turns a known readiness word into a sentence, whatever its case", () => {
    expect(openingLine("Ready")).toBe("Ready for today.");
    expect(openingLine(" ready ")).toBe("Ready for today.");
    expect(openingLine("primed")).toBe("Go hard today.");
    expect(openingLine("steady")).toBe("Keep it easy today.");
    expect(openingLine("low")).toBe("Rest or go easy today.");
  });
  it("leaves the date to lead when there is no word, or one it does not know", () => {
    expect(openingLine(undefined)).toBeNull();
    expect(openingLine("")).toBeNull();
    expect(openingLine("Strained")).toBeNull();
  });
});
