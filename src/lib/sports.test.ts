import { describe, expect, it } from "vitest";
import { useUnitsNow } from "./units";
import {
  atBest, bestPower, cogganZones, criticalSwimPace, cyclingVo2Estimate, decoupling, detectSports, efficiencyTrend, estimatedKind, ftpTrend, hoursText,
  includesSport, intensityBalance, orderSports, paletteSports, savedSportOrder, shownSports, sportTabs, intensityOf, isSpike, kmText, polarizationIndex, powerCurve, powerZoneSeconds, rideClimbing, runDurability, runTypes, sharePercents,
  shortfall, spikeCheck, sportVolume, standing, swimBands, volumeChange, wattsPerBeat, weekStart, type Family, type Recording, type SportAct,
} from "./sports";

// Thursday 19 November 2026, 20:00. The week began on Monday 16 November.
const NOW = new Date(2026, 10, 19, 20, 0);
const daysAgo = (d: number, h = 8) => new Date(2026, 10, 19 - d, h, 0);
let n = 0;
const act = (family: Family, d: number, km: number, minutes: number, more: Partial<SportAct> = {}): SportAct => ({
  id: `a${++n}`, at: daysAgo(d), family, kind: family === "ride" ? "bike" : family, name: family, meters: km > 0 ? km * 1000 : null, seconds: minutes * 60,
  avgHr: null, climbM: null, avgPowerW: null, ...more,
});
/** One sample every 10 s. */
const recording = (d: number, seconds: number, at: (t: number) => { hr?: number; power?: number; speed?: number }): Recording => {
  const t: number[] = [], hr: number[] = [], power: number[] = [], speed: number[] = [];
  for (let s = 0; s <= seconds; s += 10) { const v = at(s); t.push(s); hr.push(v.hr ?? 0); power.push(v.power ?? 0); speed.push(v.speed ?? 0); }
  return { id: `r${++n}`, at: daysAgo(d), t, hr, power, speed };
};

describe("which sports", () => {
  it("counts a family with 15% of the time or four sessions, most time first", () => {
    const acts = [
      ...[1, 8, 15, 22].map((d) => act("run", d, 10, 60)),
      act("ride", 3, 60, 150), act("ride", 10, 60, 150),
      act("swim", 5, 1, 20),
      ...[2, 9, 16, 23].map((d) => act("strength", d, 0, 15)),
    ];
    // Riding 300 min, running 240, strength 60 (four sessions), swimming 20 of 620 (3%, one session).
    expect(detectSports(acts, NOW)).toEqual(["ride", "run", "strength"]);
    expect(includesSport(["ride", "run"], "swim")).toBe(false);
  });

  it("shows everything while nothing is known, and ignores what is older than 90 days", () => {
    expect(detectSports([act("run", 120, 10, 60)], NOW)).toEqual([]);
    expect(includesSport([], "swim")).toBe(true);
  });

  it("finds walking, snow sports and climbing like any other sport", () => {
    const acts = [
      ...[1, 8, 15, 22].map((d) => act("climb", d, 0, 90)),
      act("snow", 4, 30, 360),
      act("walk", 6, 4, 50),
      act("run", 3, 10, 60),
    ];
    // Climbing and snow 360 min each (46%); a tie goes to more sessions. Walking 50 min (6%, one session) and one run are out.
    expect(detectSports(acts, NOW)).toEqual(["climb", "snow"]);
  });

  it("lists the person's sports in detection order, the main four while nothing is known", () => {
    expect(shownSports([])).toEqual(["run", "ride", "swim", "strength"]);
    // "other" has no page of its own.
    expect(shownSports(["walk", "other", "run", "climb"])).toEqual(["walk", "run", "climb"]);
    expect(sportTabs(["snow", "strength"], null).map((t) => t.href)).toEqual(["/sports", "/sports/skiing", "/strength"]);
    // A page open for a sport that isn't one of the person's keeps its own tab, last.
    expect(sportTabs(["snow"], "walk").map((t) => t.href)).toEqual(["/sports", "/sports/skiing", "/sports/walking"]);
    expect(sportTabs(["hike", "walk"], null).map((t) => t.label)).toEqual(["All sports", "Hiking", "Walking"]);
  });

  it("keeps the order the person dragged their sports into", () => {
    // Saved order first; a sport they never placed keeps detection's order after it.
    expect(orderSports(["run", "hike", "walk"], ["walk", "run"])).toEqual(["walk", "run", "hike"]);
    // Whatever storage holds that isn't one of the sports, or isn't a sport at all, is skipped.
    expect(orderSports(["run", "hike"], ["snow", 7, null, "hike", "hike"])).toEqual(["hike", "run"]);
    expect(orderSports(["run", "hike"], "junk" as unknown as string[])).toEqual(["run", "hike"]);
    expect(sportTabs(["run", "hike", "walk"], null, ["hike", "walk"]).map((t) => t.label)).toEqual(["All sports", "Hiking", "Walking", "Running"]);
    expect(paletteSports(["run", "hike"], ["hike"]).map((p) => p.href)).toEqual(["/sports/hiking", "/sports/running"]);
    // The main four while nothing is known follow it too.
    expect(shownSports([], ["swim"])).toEqual(["swim", "run", "ride", "strength"]);
  });

  it("saves the dragged order without losing a sport placed before that isn't shown now", () => {
    expect(savedSportOrder(["snow", "run", "hike"], ["hike", "run"])).toEqual(["hike", "run", "snow"]);
    expect(savedSportOrder([], ["walk", "run"])).toEqual(["walk", "run"]);
    expect(savedSportOrder(["bogus", "climb"], ["run"])).toEqual(["run", "climb"]);
    expect(sportTabs([], null).map((t) => t.label)).toEqual(["All sports", "Running", "Riding", "Swimming", "Strength"]);
    // The palette's chips leave out Strength, which has its own sidebar item.
    expect(paletteSports(["strength", "climb", "run"]).map((p) => p.href)).toEqual(["/sports/climbing", "/sports/running"]);
    expect(paletteSports([]).map((p) => p.href)).toEqual(["/sports/running", "/sports/riding", "/sports/swimming"]);
  });
});

describe("weeks", () => {
  it("starts the week on Monday", () => {
    expect(weekStart(NOW)).toEqual(new Date(2026, 10, 16));
    expect(weekStart(new Date(2026, 10, 22, 23, 0))).toEqual(new Date(2026, 10, 16));
  });

  it("totals each calendar week and averages the four before this one", () => {
    const runs = [act("run", 1, 8, 40), act("run", 3, 6, 30), act("run", 7, 10, 50), act("run", 14, 20, 100), act("run", 21, 30, 150), act("run", 28, 40, 200), act("run", 0, 0, 0.1)];
    const v = sportVolume(runs, NOW);
    expect(v.weeks).toHaveLength(8);
    expect(v.weeks[7]).toMatchObject({ start: new Date(2026, 10, 16), meters: 14000, sessions: 2, longestMeters: 8000 });
    expect(v.weeks.slice(3, 7).map((w) => w.meters)).toEqual([40000, 30000, 20000, 10000]);
    expect(v.usualMeters).toBe(25000);
    expect(v.usualSeconds).toBe(125 * 60);
    expect(v.todayIndex).toBe(3);
    expect(v.days.map((d) => d.meters)).toEqual([6000, 0, 8000, 0, 0, 0, 0]);
    expect(v.yearLongest).toMatchObject({ seconds: 200 * 60, meters: 40000 });
  });

  it("has no usual week until two of the four before had a session", () => {
    expect(sportVolume([act("run", 1, 8, 40), act("run", 8, 8, 40)], NOW).usualMeters).toBeNull();
  });

  it("reads a week against the usual one, and waits for Sunday before calling it short", () => {
    expect(standing(0, 40000, 3, 1000)).toEqual({ kind: "none" });
    expect(standing(12000, null, 3, 1000)).toEqual({ kind: "soFar" });
    expect(standing(46000, 40000, 3, 1000)).toEqual({ kind: "more", by: 6000 });
    expect(standing(20000, 40000, 3, 1000)).toEqual({ kind: "soFar" });
    expect(standing(20000, 40000, 0, 1000)).toEqual({ kind: "less", by: 20000 });
    expect(standing(38000, 40000, 0, 1000)).toEqual({ kind: "level" });
    // Within the margin when the margin is larger than 10% (15 minutes of a 2-hour week).
    expect(standing(7900, 7200, 0, 900)).toEqual({ kind: "level" });
  });
});

describe("long runs", () => {
  it("allows 10% over the longest run of the last 30 days and flags a run that went past its own limit", () => {
    const runs = [act("run", 40, 12, 70), act("run", 20, 15, 90), act("run", 10, 10, 60), act("run", 2, 18, 110)];
    const check = spikeCheck(runs, NOW)!;
    expect(check.recentLongest).toBe(18000);
    expect(check.nextLimit).toBeCloseTo(19800);
    // 15 km against 12 km before it is 25% longer; 18 km against 15 km is 20% longer; 10 km is inside.
    expect(check.runs.map(isSpike)).toEqual([false, true, false, true]);
    expect(check.runs[0].priorLongest).toBeNull();
  });

  it("is nothing without a run in the last eight weeks", () => {
    expect(spikeCheck([act("run", 70, 10, 60)], NOW)).toBeNull();
  });
});

describe("easy and hard", () => {
  it("bands heart rate at 90% and 100% of threshold", () => {
    const rec = recording(1, 600, (t) => ({ hr: t <= 300 ? 140 : t <= 480 ? 160 : 172 }));
    // Threshold 168: 140 is 83% (low), 160 is 95% (moderate), 172 is 102% (high).
    expect(intensityOf(rec, 168)).toEqual({ low: 300, moderate: 180, high: 120 });
    expect(intensityOf({ t: [0, 10] }, 168)).toBeNull();
  });

  it("uses the recording when there is one and the average heart rate otherwise", () => {
    const read = act("run", 2, 10, 60, { avgHr: 175 });
    const rec = { ...recording(2, 3600, () => ({ hr: 140 })), id: read.id };
    const acts = [read, act("run", 4, 8, 40, { avgHr: 160 }), act("run", 6, 5, 20, { avgHr: 170 }), act("run", 40, 10, 60, { avgHr: 170 })];
    const b = intensityBalance(acts, new Map([[rec.id, rec]]), 168, NOW)!;
    expect(b).toMatchObject({ low: 3600, moderate: 2400, high: 1200, measured: 1, estimated: 2 });
    expect(sharePercents(b)).toEqual([50, 33, 17]);
    expect(b.pattern).toBe("pyramidal");
  });

  it("needs three activities, an hour, and a threshold", () => {
    const two = [act("run", 2, 10, 60, { avgHr: 140 }), act("run", 4, 10, 60, { avgHr: 140 })];
    expect(intensityBalance(two, new Map(), 168, NOW)).toBeNull();
    expect(intensityBalance([...two, act("run", 5, 10, 60, { avgHr: 140 })], new Map(), null, NOW)).toBeNull();
    expect(intensityBalance([...two, act("run", 5, 10, 60, { avgHr: 140 })], new Map(), 168, NOW)!.pattern).toBe("base");
  });

  it("works out the polarization index only for easy > hard > moderate", () => {
    expect(polarizationIndex(0.8, 0.05, 0.15)).toBeCloseTo(Math.log10((0.8 / 0.05) * 0.15 * 100));
    expect(polarizationIndex(0.8, 0.15, 0.05)).toBeNull();
  });

  it("types a run from its average heart rate", () => {
    expect(estimatedKind({ avgHr: 170, seconds: 2400 }, 168)).toBe("hard");
    expect(estimatedKind({ avgHr: 155, seconds: 2400 }, 168)).toBe("tempo");
    expect(estimatedKind({ avgHr: 140, seconds: 80 * 60 }, 168)).toBe("long");
    expect(estimatedKind({ avgHr: 140, seconds: 40 * 60 }, 168)).toBe("easy");
    expect(estimatedKind({ avgHr: null, seconds: 2400 }, 168)).toBeNull();
  });

  it("counts quality runs in the last four weeks and the weeks since one", () => {
    const runs = [
      act("run", 1, 6, 35, { avgHr: 140 }), act("run", 8, 6, 35, { avgHr: 141 }), act("run", 10, 16, 90, { avgHr: 142 }),
      act("run", 17, 8, 40, { avgHr: 158 }), act("run", 24, 8, 40, { avgHr: 171 }), act("run", 45, 8, 40, { avgHr: 171 }),
    ];
    const types = runTypes(runs, 168, NOW)!;
    expect(types.weeks).toHaveLength(6);
    expect(types.weeks[5].runs.map((r) => r.kind)).toEqual(["easy"]);
    expect(types.weeks[4].runs.map((r) => r.kind)).toEqual(["long", "easy"]);
    expect(types).toMatchObject({ quality: 2, known: 5, weeksWithoutQuality: 2 });
    expect(runTypes([], 168, NOW)).toBeNull();
  });
});

describe("efficiency and durability", () => {
  it("reads metres per heartbeat on easy runs, the last four weeks against the eight before", () => {
    // 10 km in 50 min is 200 m/min; at 140 bpm that is 1.4286 m a beat, at 133 bpm 1.5038.
    const before = [35, 42, 49].map((d) => act("run", d, 10, 50, { avgHr: 140 }));
    const recent = [3, 10, 17].map((d) => act("run", d, 10, 50, { avgHr: 133 }));
    const hard = act("run", 5, 10, 40, { avgHr: 170 });
    const trend = efficiencyTrend([...before, ...recent, hard], 168, NOW)!;
    expect(trend.before).toBeCloseTo(200 / 140);
    expect(trend.recent).toBeCloseTo(200 / 133);
    expect(trend.change).toBeCloseTo((140 / 133 - 1) * 100);
    expect(trend.points).toHaveLength(6);
    expect(efficiencyTrend(recent, 168, NOW)!.change).toBeNull();
  });

  it("measures how far speed per heartbeat fell from the first half to the second", () => {
    // Same speed, heart rate 140 then 147: 1/140 against 1/147 is 4.76% lower.
    const rec = recording(3, 4000, (t) => ({ hr: t <= 2000 ? 140 : 147, speed: 3 }));
    expect(decoupling(rec)).toBeCloseTo((1 - 140 / 147) * 100, 1);
    expect(decoupling({ t: [0, 10], hr: [140, 140], speed: [3, 3] })).toBeNull();
  });

  it("needs three long runs and counts the newest in a row under 5%", () => {
    const drift = (d: number, late: number) => recording(d, 4000, (t) => ({ hr: t <= 2000 ? 140 : late, speed: 3 }));
    const short = recording(1, 1800, () => ({ hr: 140, speed: 3 }));
    expect(runDurability([drift(30, 150), drift(20, 144), short], NOW)).toBeNull();
    const d = runDurability([drift(30, 150), drift(20, 144), drift(10, 143), short], NOW)!;
    expect(d.points.map((p) => Math.round(p.percent * 10) / 10)).toEqual([6.7, 2.8, 2.1]);
    expect(d.heldInARow).toBe(2);
  });
});

describe("riding", () => {
  it("adds up the climbing of outdoor rides by week", () => {
    const rides = [act("ride", 1, 40, 90, { climbM: 600 }), act("ride", 8, 40, 90, { climbM: 400 }), act("ride", 15, 40, 90, { climbM: 700 }), act("ride", 2, 30, 60, { climbM: 900, kind: "indoorBike" })];
    const c = rideClimbing(rides, NOW)!;
    expect(c.weeks.slice(-3).map((w) => w.meters)).toEqual([700, 400, 600]);
    expect(c.isNotable).toBe(false);
    expect(c.moreBefore).toEqual(new Date(2026, 10, 2));
    expect(rideClimbing([act("ride", 2, 30, 60, { kind: "indoorBike" })], NOW)).toBeNull();
  });

  it("finds the best average power for a duration", () => {
    // 200 W with five minutes at 300 W from the tenth minute.
    const rec = recording(2, 3600, (t) => ({ power: t >= 600 && t < 900 ? 300 : 200 }));
    expect(bestPower(rec, 300)).toBeCloseTo(300, 0);
    expect(bestPower(rec, 600)).toBeCloseTo(250, 0);
    expect(bestPower(rec, 3600)).toBeCloseTo((300 * 300 + 3300 * 200) / 3600, 0);
    expect(bestPower(rec, 7200)).toBeNull();
  });

  it("sets the last 90 days against the best ever", () => {
    const old = recording(200, 1800, () => ({ power: 320 }));
    const recent = recording(5, 4000, (t) => ({ power: t < 300 ? 320 : 220 }));
    const curve = powerCurve([old, recent], NOW)!;
    expect(curve.map((r) => r.seconds)).toEqual([5, 60, 300, 1200, 3600]);
    const twenty = curve[3], hour = curve[4];
    expect(twenty.best).toBeCloseTo(320, 0);
    expect(twenty.recent).toBeCloseTo((300 * 320 + 900 * 220) / 1200, 0);
    expect(shortfall(twenty)).toBeCloseTo(23.4, 0);
    // Only the recent ride lasted an hour, so it holds that best.
    expect(shortfall(hour)).toBe(0);
    expect(atBest(curve).map((r) => r.seconds)).toEqual([5, 60, 300, 3600]);
    expect(powerCurve([recording(2, 600, () => ({ hr: 120 })) as Recording].map((r) => ({ ...r, power: undefined })), NOW)).toBeNull();
  });

  it("tracks 95% of the best 20 minutes in each four weeks", () => {
    const trend = ftpTrend([recording(60, 1800, () => ({ power: 240 })), recording(30, 1800, () => ({ power: 250 })), recording(3, 1800, () => ({ power: 260 }))], NOW, 3);
    expect(trend.map((p) => Math.round(p.watts * 10) / 10)).toEqual([228, 237.5, 247]);
  });

  it("cuts Coggan's seven zones from FTP and shares riding time between them", () => {
    const zones = cogganZones(250);
    expect(zones.map((z) => [z.from, z.to])).toEqual([[null, 138], [139, 188], [189, 225], [226, 263], [264, 300], [301, 375], [376, null]]);
    const ride = recording(3, 3600, (t) => ({ power: t <= 1800 ? 150 : t <= 2700 ? 240 : 320 }));
    expect(powerZoneSeconds([ride], 250, NOW)).toEqual([0, 1800, 0, 900, 0, 900, 0]);
    expect(powerZoneSeconds([recording(60, 3600, () => ({ power: 150 }))], 250, NOW)).toBeNull();
  });

  it("estimates Cycling VO2 max from five-minute power and weight", () => {
    expect(cyclingVo2Estimate(318, 68)).toBeCloseTo(16.6 + (8.87 * 318) / 68);
    expect(cyclingVo2Estimate(318, 0)).toBeNull();
    expect(cyclingVo2Estimate(900, 50)).toBeNull();
  });

  it("divides power by heart rate on rides of half an hour or more", () => {
    const points = wattsPerBeat([recording(9, 3600, () => ({ power: 180, hr: 120 })), recording(2, 3600, () => ({ power: 200, hr: 125 })), recording(1, 900, () => ({ power: 200, hr: 125 }))], NOW);
    expect(points.map((p) => p.value)).toEqual([1.5, 1.6]);
  });
});

describe("swimming", () => {
  it("takes critical swim speed from the best 200 and 400", () => {
    // 3:18.4 and 6:51.2: the second 200 took 212.8 s, 1:46.4 per 100.
    expect(criticalSwimPace(198.4, 411.2)).toBeCloseTo(106.4);
    expect(criticalSwimPace(198.4, 190)).toBeNull();
    expect(swimBands(106)).toEqual({ easyFrom: 116, thresholdFrom: 104, thresholdTo: 108, fastTo: 100 });
  });

  it("compares four weeks of distance with the four before", () => {
    const swims = [act("swim", 3, 2.6, 50), act("swim", 10, 2.2, 45), act("swim", 31, 2, 40), act("swim", 38, 2, 40)];
    expect(volumeChange(swims, NOW)).toBeCloseTo(0.2);
    expect(volumeChange(swims.slice(0, 2), NOW)).toBeNull();
  });
});

describe("words", () => {
  it("writes hours as the pages do", () => {
    expect(hoursText(70 * 60)).toBe("1 h 10");
    expect(hoursText(365 * 60, true)).toBe("6 h 05 min");
    expect(hoursText(48 * 60)).toBe("48 min");
  });
});

describe("kmText", () => {
  it("prints kilometres, or miles in imperial, to one decimal", () => {
    expect(kmText(30_600)).toBe("30.6 km");
    useUnitsNow("imperial");
    try { expect(kmText(30_600)).toBe("19.0 mi"); } finally { useUnitsNow("metric"); }
  });
});
