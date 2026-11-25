import { describe, expect, it } from "vitest";
import {
  alertNightsInRow, illnessDay, illnessSince, illnessToggled, lastNight, lookLine, lookOf, nightHue, signalChange, signalChart, signalTitle, signalValue,
  type AlertNight, type BodyAlertData,
} from "./bodyAlert";

const night = (day: string, nightClass: AlertNight["nightClass"], hr = 54, state: AlertNight["state"] = "normal"): AlertNight => ({
  day, state, nightClass, level: nightClass === "strong" ? 4.4 : nightClass === "deviating" ? 3 : 1,
  signals: nightClass === "noData" ? [] : [
    { signal: "heart", channel: "sleepHR", value: hr, usual: 54, spread: 1.5, z: (hr - 54) / 1.5 },
    { signal: "hrv", channel: "lnRMSSD", value: Math.log(80), usual: Math.log(80), spread: 0.08, z: 0 },
    { signal: "breathing", channel: "breathing", value: 14.4, usual: 14.6, spread: 0.4, z: -0.5 },
  ],
});

describe("Body Alert", () => {
  it("maps the phone's states to its looks", () => {
    expect(["learning", "normal", "watch", "strain", "strainHigh", "recovering"].map((s) => lookOf(s as never))).toEqual(["learning", "clear", "watch", "alert", "alert", "settling"]);
  });

  it("shows values the way the phone does", () => {
    expect(signalValue({ signal: "hrv" }, Math.log(80))).toBe("80 ms");
    expect(signalValue({ signal: "breathing" }, 14.44)).toBe("14.4 brpm");
    const n = night("2026-11-20", "strong", 57);
    expect(signalChange(n.signals[0])).toBe("+3 bpm");
    expect(signalChange({ ...n.signals[1], value: Math.log(72) })).toBe("−10%");
    expect(signalChange(n.signals[2])).toBe("−0.2 brpm");
    expect(signalTitle({ signal: "heart", channel: "restingHR" })).toBe("Resting heart rate");
    expect(signalTitle({ signal: "heart", channel: "sleepHR" })).toBe("Sleeping heart rate");
  });

  it("names what was off in the line", () => {
    const d: BodyAlertData = { on: true, state: "strain", nightsLearned: 14, nights: [night("2026-11-19", "deviating", 57), night("2026-11-20", "strong", 57)] };
    expect(lookLine("alert", lastNight(d))).toBe("Your nights have been above your usual: sleeping heart rate +3 bpm. An easy day or rest may help.");
    expect(alertNightsInRow(d)).toBe(2);
  });

  it("colours nights like the phone's trail", () => {
    expect(nightHue(night("d", "strong"))).toBe("rose");
    expect(nightHue(night("d", "deviating"))).toBe("gold");
    expect(nightHue(night("d", "normal", 54, "recovering"))).toBe("violet");
    expect(nightHue(night("d", "normal"))).toBe("mint");
    expect(nightHue(night("d", "noData"))).toBeNull();
  });

  it("draws a signal with a gap where a night had none", () => {
    const c = signalChart([night("a", "normal"), night("b", "noData"), night("c", "normal", 56)], "heart", 100, 40)!;
    expect(c.line.match(/M/g)).toHaveLength(2);
    expect(c.dot?.x).toBe(100);
  });

  it("turns Illness mode on and off, and off by itself after a week", () => {
    const on = illnessToggled([], true, 1000);
    expect(on).toEqual([{ start: 1000 }]);
    expect(illnessToggled(on, true, 2000)).toEqual(on);
    expect(illnessToggled(on, false, 5000)).toEqual([{ start: 1000, end: 5000 }]);
    expect(illnessSince(on, 1000 + 86_400_000)).toBe(1000);
    expect(illnessSince(on, 1000 + 8 * 86_400_000)).toBeNull();
    expect(illnessDay(0, 86_400_000 * 2.5)).toBe(3);
  });
});
