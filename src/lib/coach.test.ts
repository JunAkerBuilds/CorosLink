import { describe, expect, it } from "vitest";
import { answerTime, averageText, lastValues, paceBars, rangeNote, shareOf, weekShares } from "./coach";

describe("Coach card helpers", () => {
  it("says where a reading sits against the usual range", () => {
    expect(rangeNote(44, [54, 66])).toBe("below your range");
    expect(rangeNote(54, [54, 66])).toBe("in range");
    expect(rangeNote(66, [54, 66])).toBe("in range");
    expect(rangeNote(67, [54, 66])).toBe("above your range");
  });

  it("takes the last values without running past the start", () => {
    expect(lastValues([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(lastValues([1, 2], 7)).toEqual([1, 2]);
    expect(lastValues([], 7)).toEqual([]);
  });

  it("writes an average to one decimal and nothing for no values", () => {
    expect(averageText([58, 60])).toBe("59");
    expect(averageText([59, 59, 60])).toBe("59.3");
    expect(averageText([])).toBeNull();
  });

  it("keeps a share inside its scale", () => {
    expect(shareOf(-7, -30, 20)).toBeCloseTo(0.46);
    expect(shareOf(40, -30, 20)).toBe(1);
    expect(shareOf(-90, -30, 20)).toBe(0);
    expect(shareOf(5, 5, 5)).toBe(0);
  });

  it("draws one bar per kilometre, taller for a quicker one", () => {
    const d = paceBars([300, 270], [300, 270], 100, 80, 62, 9);
    const tops = [...d.matchAll(/M(\d+) 100V([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(tops.map((t) => t[0])).toEqual([9, 89]);
    expect(tops[1][1]).toBeLessThan(tops[0][1]);
    expect(paceBars([], [], 100, 80, 62, 9)).toBe("");
    expect(paceBars([300, 270], [300, 270], 100, 80, 62, 9, 4, (k) => k === 1)).toMatch(/^M89 100V/);
  });

  it("shares the week between what is done and what stays planned", () => {
    expect(weekShares({ before: 463, after: 451, done: 253 })).toEqual({ planned: 451 / 463, done: 253 / 463 });
    expect(weekShares({ before: 0, after: 0, done: 0 })).toEqual({ planned: 0, done: 0 });
  });

  it("writes the time an answer was given", () => {
    expect(answerTime(new Date(2026, 10, 19, 9, 21).getTime())).toBe("09:21");
  });
});
