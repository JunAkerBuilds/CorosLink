import { describe, expect, it } from "vitest";
import { countUpFormat } from "./countUp";

const at = (text: string, p: number) => countUpFormat(text)?.(p);

describe("countUpFormat", () => {
  it("ends on the exact original text", () => {
    for (const t of ["1,842", "62 ms", "+4", "−7", "1.12", "4:46 /km", "1:42:31.05", "21:58.13", "7h 42m", "2 h 58", "93%", "36.4", "1,520 kcal"]) {
      expect(at(t, 1)).toBe(t);
    }
  });

  it("starts from zero in the same format", () => {
    expect(at("1,842", 0)).toBe("0");
    expect(at("1.12", 0)).toBe("0.00");
    expect(at("62 ms", 0)).toBe("0 ms");
    expect(at("−7", 0)).toBe("−0");
    expect(at("4:46 /km", 0)).toBe("0:00 /km");
    expect(at("1:42:31.05", 0)).toBe("0:00:00.00");
    expect(at("7h 42m", 0)).toBe("0h 0m");
    expect(at("2 h 58", 0)).toBe("0 h 00");
  });

  it("keeps commas and decimals on the way", () => {
    expect(at("1,842", 0.5)).toBe("921");
    expect(at("12,400", 0.5)).toBe("6,200");
    expect(at("36.4", 0.5)).toBe("18.2");
    expect(at("21:58.13", 0.5)).toMatch(/^10:59\.\d{2}$/);
  });

  it("counts imperial units too", () => {
    for (const t of ["7:40 /mi", "4.98 mi", "1,640 yd", "210 ft", "15.8 mph", "170 lb"]) expect(at(t, 1)).toBe(t);
    expect(at("7:40 /mi", 0)).toBe("0:00 /mi");
    expect(at("4.98 mi", 0)).toBe("0.00 mi");
  });

  it("leaves words, zero and times of day alone", () => {
    expect(countUpFormat("Tempo run")).toBeNull();
    expect(countUpFormat("0")).toBeNull();
    expect(countUpFormat("08:00")).toBeNull();
  });
});
