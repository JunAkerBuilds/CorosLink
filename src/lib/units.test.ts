import { afterEach, describe, expect, it } from "vitest";
import {
  bodyHeight, bodyHeightFromInput, bodyHeightIn, bodyHeightUnit, distance, distanceFromInput, distanceIn, height, paceFromInput, paceGap, paceText, shortDistance, speedText,
  swimDistance, swimPaceText, useUnitsNow, weight, weightFromInput, weightTotal,
} from "./units";

afterEach(() => useUnitsNow("metric"));

describe("metric", () => {
  it("shows what the data holds", () => {
    expect(distance(24_650, 1)).toBe("24.7 km");
    expect(distance(8020)).toBe("8.02 km");
    expect(paceText(308)).toBe("5:08 /km");
    expect(paceText(308.31, 2)).toBe("5:08.31 /km");
    expect(speedText(25.4)).toBe("25.4 km/h");
    expect(swimDistance(1500)).toBe("1,500 m");
    expect(swimPaceText(125)).toBe("2:05 /100 m");
    expect(height(1234)).toBe("1,234 m");
    expect(shortDistance(350)).toBe("350 m");
    expect(shortDistance(4500)).toBe("4.5 km");
    expect(weight(72.4)).toBe("72.4 kg");
    expect(weightTotal(12_340)).toBe("12,340 kg");
    expect(bodyHeight(180)).toBe("180 cm");
    expect(paceGap(11)).toBe("11 s/km");
  });
});

describe("imperial", () => {
  it("converts what is shown", () => {
    useUnitsNow("imperial");
    expect(distance(1609.344)).toBe("1.00 mi");
    expect(distance(42_195, 2)).toBe("26.22 mi");
    expect(distanceIn(1609.344 * 3)).toBeCloseTo(3);
    expect(paceText(300)).toBe("8:03 /mi");
    expect(speedText(1.609344 * 20)).toBe("20.0 mph");
    expect(swimDistance(91.44)).toBe("100 yd");
    expect(swimPaceText(100)).toBe("1:31 /100 yd");
    expect(height(100)).toBe("328 ft");
    expect(shortDistance(100)).toBe("328 ft");
    expect(shortDistance(MILE())).toBe("1.0 mi");
    expect(weight(100)).toBe("220.5 lb");
    expect(weightTotal(1000)).toBe("2,205 lb");
    expect(bodyHeight(180)).toBe("5′ 11″");
    expect(paceGap(10)).toBe("16 s/mi");
  });

  it("reads typed numbers back to metric", () => {
    useUnitsNow("imperial");
    expect(distanceFromInput(1)).toBeCloseTo(1609.344);
    expect(paceFromInput(482.8032)).toBeCloseTo(300);
    expect(weightFromInput(220.462)).toBeCloseTo(100, 2);
  });

  it("types a body height in inches", () => {
    expect(bodyHeightUnit()).toBe("cm");
    expect(bodyHeightIn(180)).toBe(180);
    useUnitsNow("imperial");
    expect(bodyHeightUnit()).toBe("in");
    expect(bodyHeightIn(182.88)).toBeCloseTo(72);
    expect(bodyHeightFromInput(72)).toBeCloseTo(182.88);
  });
});

const MILE = () => 1609.344;

describe("inUnits", () => {
  it("draws in the asked units and puts the page's back", async () => {
    const { inUnits, units } = await import("./units");
    useUnitsNow("metric");
    expect(inUnits("imperial", () => distance(1609.344))).toBe("1.00 mi");
    expect(units()).toBe("metric");
    expect(inUnits(undefined, () => distance(1000))).toBe("1.00 km");
  });
});
