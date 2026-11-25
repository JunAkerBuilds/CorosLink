import { describe, expect, it } from "vitest";
import type { SleepRecord } from "@/data/sleep";
import { sampleSleep } from "@/data/sample/sleep";
import { coachQuestions, eveningMinute, hm, nightFacts, period, quality, signedHm, stressStats, summarise, tonightPlan, trainingSplit } from "./sleep";

const base = (over: Partial<SleepRecord>): SleepRecord => ({
  day: "2026-11-19", score: 80, nightScore: 80, startMinute: 23 * 60, segments: [], heartRateAsleep: 50,
  naps: [], hrv: 60, restingHR: 48, stress: null, dayBefore: null, ...over,
});

describe("sleep maths", () => {
  it("names score ranges like the phone", () => {
    expect([90, 85, 84, 70, 69, 55, 54].map(quality)).toEqual(["Excellent", "Excellent", "Good", "Good", "Fair", "Fair", "Low"]);
  });

  it("formats minutes", () => {
    expect(hm(462)).toBe("7h 42m");
    expect(hm(14)).toBe("14m");
    expect(signedHm(-65)).toBe("−1h 5m");
    expect(signedHm(0)).toBe("±0m");
  });

  it("counts bedtimes after midnight as the same evening", () => {
    expect(eveningMinute(23 * 60 + 10)).toBe(1390);
    expect(eveningMinute(20)).toBe(1460);
  });

  it("reads a night's facts from its stages", () => {
    const f = nightFacts(base({ segments: [
      { stage: "light", minutes: 60 }, { stage: "awake", minutes: 6 }, { stage: "deep", minutes: 40 },
      { stage: "awake", minutes: 2 }, { stage: "rem", minutes: 30 },
    ] }));
    expect(f.asleep).toBe(130);
    expect(f.inBed).toBe(138);
    expect(f.wakings).toBe(1);
    expect(f.longestAwake).toBe(6);
    expect(f.wake).toBe(23 * 60 + 138);
  });

  it("leaves awake readings and missing readings out of sleep stress", () => {
    const s = stressStats(base({
      segments: [{ stage: "deep", minutes: 10 }, { stage: "awake", minutes: 10 }, { stage: "rem", minutes: 10 }],
      stress: { startOffset: 0, readings: [10, 20, 90, 90, 0, 60] },
    }))!;
    expect(s.average).toBe(Math.round((10 + 20 + 60) / 3));
    expect(s.peak).toBe(60);
    expect(s.peakOffset).toBe(25);
    expect(s.bands).toEqual([2, 0, 1, 0]);
    expect(s.byStage).toEqual({ deep: 15, light: null, rem: 60 });
  });

  it("builds weeks from Monday and whole months", () => {
    const w = period("week", "2026-11-19", 0);
    expect(w.days[0]).toBe("2026-11-16");
    expect(w.days).toHaveLength(7);
    expect(period("week", "2026-11-19", -1).days[0]).toBe("2026-11-09");
    expect(period("month", "2026-11-19", -1).days).toHaveLength(31);
    expect(period("month", "2026-01-10", -1).title).toBe("December 2025");
    expect(period("year", "2026-11-19", 0).days).toHaveLength(365);
  });

  it("sums a period", () => {
    const s = summarise([
      base({ score: 80, segments: [{ stage: "light", minutes: 400 }] }),
      base({ score: 60, segments: [{ stage: "light", minutes: 300 }] }),
    ]);
    expect(s.score).toBe(70);
    expect(s.debt).toBe(20 + 120);
    expect(s.shortNights).toBe(1);
    expect(s.best?.score).toBe(80);
  });

  it("splits nights after training from nights after rest, skipping unknown days", () => {
    const t = trainingSplit([base({ dayBefore: ["Run"], score: 80 }), base({ dayBefore: [], score: 70 }), base({ dayBefore: null, score: 10 })]);
    expect(t.trained).toMatchObject({ nights: 1, score: 80 });
    expect(t.rest).toMatchObject({ nights: 1, score: 70 });
  });

  it("plans tonight as the phone does: 8 h plus the debt top-up, at the usual efficiency, 15 min to fall asleep", () => {
    const plan = tonightPlan(sampleSleep().nights)!;
    expect(plan.asleep).toBe(480 + plan.catchUp);
    expect([0, 15, 30]).toContain(plan.catchUp);
    // In bed longer than asleep (efficiency 80–98%), plus 15 minutes.
    expect(plan.wake - plan.bed).toBeGreaterThanOrEqual(Math.round(plan.asleep / 0.98 + 15));
    expect(plan.wake - plan.bed).toBeLessThanOrEqual(Math.round(plan.asleep / 0.8 + 15));
    expect(plan.fromSchedule).toBe(false);
  });

  it("wakes at the watch's sleep schedule when there is one, and names tomorrow's workout", () => {
    const plan = tonightPlan(sampleSleep().nights, { scheduleWake: 6 * 60, workout: "Long Run 8 km" })!;
    expect(plan.wake).toBe(eveningMinute(6 * 60)); // 6:00 the next morning
    expect(plan.fromSchedule).toBe(true);
    expect(plan.workout).toBe("Long Run 8 km");
  });

  it("keeps the sample's last night equal to the Health page's", () => {
    const last = sampleSleep().nights.at(-1)!;
    expect(last.score).toBe(84);
    expect(nightFacts(last).asleep).toBe(462);
    expect(last.day).toBe("2026-11-19");
  });
});

describe("questions for Coach", () => {
  it("asks about what stands out and always about the night", () => {
    const n = base({
      score: 60,
      segments: [{ stage: "light", minutes: 300 }, { stage: "deep", minutes: 20 }, { stage: "rem", minutes: 80 }],
      stress: { startOffset: 0, readings: Array.from({ length: 80 }, (_, i) => (i === 40 ? 70 : 20)) },
    });
    const q = coachQuestions(n, 460, "Fri 20 Nov");
    expect(q.map((x) => x.label)).toEqual(["Why was deep sleep short?", "What raised stress at 02:20?", "How was this night?"]);
    expect(q[0].ask).toContain("Fri 20 Nov");
  });
});
