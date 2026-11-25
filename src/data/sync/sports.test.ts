import { describe, expect, it } from "vitest";
import { isMissing } from "@/data/sports";
import { sampleSports } from "@/data/sample/sports";
import { seedItems } from "@/data/sampleSeed";
import type { SyncBodies } from "./native";
import { actFromNative, plannedFromHub, recordingFrom, sportsFromItems, type SportsItems } from "./sports";

// Tuesday 24 November 2026, mid-afternoon.
const NOW = new Date(2026, 10, 24, 15, 0);
const seeded = seedItems(NOW);
const of = <C extends keyof SyncBodies>(c: C) => seeded.filter((i) => i.collection === c).map((i) => ({ id: i.id, body: i.body as SyncBodies[C] }));
const items = (): SportsItems => ({
  activities: of("activity").map((i) => i.body), details: of("activity.detail"), training: of("view.training")[0]?.body,
  strength: of("view.strength")[0]?.body, body: of("view.body")[0]?.body, gym: of("gym.workout").map((i) => i.body), planned: [],
});

describe("sports from synced items", () => {
  const sports = sportsFromItems(items(), NOW);

  it("works out the seeded athlete's sports and gives each a page", () => {
    expect([...sports.families].sort()).toEqual(["ride", "run", "strength", "swim"]);
    expect(sports.families[0]).toBe("run");
    expect(sports.run && sports.ride && sports.swim).toBeTruthy();
    expect(sports.hub.rings.map((r) => r.family)).toEqual(["run", "ride", "swim", "strength"]);
    expect(sports.hub.cards.map((c) => c.href)).toEqual(["/sports/running", "/sports/riding", "/sports/swimming", "/strength"]);
    expect(sports.hub.hours.weeks).toHaveLength(12);
  });

  it("reads running from the activity list, the recordings and the training view", () => {
    const run = sports.run!;
    const week = of("activity").map((i) => actFromNative(i.body)!).filter((a) => a.family === "run" && a.at >= new Date(2026, 10, 23) && a.at <= NOW);
    const km = week.reduce((s, a) => s + (a.meters ?? 0), 0) / 1000;
    expect(run.hero.figures[0]).toEqual({ value: `${km.toFixed(1)} km`, label: "This week" });
    expect(run.hero.figures[1].value).toBe(String(week.length));
    expect(run.hero.ring!.percent).toBeGreaterThan(0);
    expect(run.much.weeks.bars).toHaveLength(8);
    expect(run.much.weeks.line!.text).toMatch(/^Usual, \d+\.\d km$/);
    expect(run.much.days.bars.map((b) => b.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(run.much.long!.limit).toMatch(/km$/);
    expect(run.tiles.map((t) => t.href)).toEqual(["#much", "#much", "#hard", "#engine"]);
    // The seed's predictions and VO2 max, whole seconds as COROS shows them.
    expect(isMissing(run.engine)).toBe(false);
    if (!isMissing(run.engine)) {
      expect(run.engine.predictions.find((p) => p.focus)).toMatchObject({ name: "10K", time: "43:01" });
      expect(run.engine.vo2).toBe("54");
      expect(run.engine.trend).toBeNull();
      expect(run.engine.marks[0]).toEqual({ value: "4:28.40 /km", label: "Threshold pace" });
      expect(run.engine.bests[0]).toMatchObject({ name: "1K", value: "3:51.84" });
    }
    expect(isMissing(run.hard)).toBe(false);
    // Long runs carry a recording in the seed, so their drift can be read.
    expect(isMissing(run.durability)).toBe(false);
    expect(isMissing(run.efficiency)).toBe(false);
  });

  it("marks what has no synced source as sample, apart from the athlete's own figures", () => {
    const engine = sports.run!.engine, climb = sports.ride!.climb;
    if (!isMissing(engine)) expect(engine.sampleTrend!.chart.label).toMatch(/^Sample data/);
    if (!isMissing(climb)) expect(climb.sampleBiggest).not.toBeNull();
    expect(sports.swim!.swolf.chart.label).toMatch(/^Sample data/);
    expect(sports.swim!.strokes.rows.reduce((s, r) => s + r.percent, 0)).toBe(100);
    // No sample figure reaches the tiles, the hero or the hub.
    expect(JSON.stringify([sports.swim!.tiles, sports.swim!.hero, sports.hub])).not.toContain("41.5");
  });

  it("reads riding power from the rides' recordings", () => {
    const ride = sports.ride!;
    expect(isMissing(ride.hero.curve)).toBe(false);
    if (!isMissing(ride.hero.curve)) {
      expect(ride.hero.curve.tiles.map((t) => t.name)).toEqual(["5 s", "1 min", "5 min", "20 min", "60 min"]);
      // Every seeded ride is inside the last 90 days, so the recent curve is the best ever.
      expect(ride.hero.curve.tiles.every((t) => t.best)).toBe(true);
    }
    expect(ride.hero.figures[0]).toEqual({ value: "236 W", label: "FTP" });
    expect(ride.hero.figures[1]).toEqual({ value: (236 / 72.4).toFixed(2), label: "W/kg" });
    if (!isMissing(ride.zones)) expect(Math.round(ride.zones.rows.reduce((s, z) => s + z.percent, 0))).toBe(100);
    expect(isMissing(ride.zones)).toBe(false);
    expect(isMissing(ride.ftp)).toBe(false);
    expect(isMissing(ride.vo2)).toBe(false);
    expect(isMissing(ride.climb)).toBe(false);
    expect(ride.records.map((r) => r.name)).toEqual(["Longest ride", "Most climbing"]);
  });

  it("reads swimming from the list and the bests", () => {
    const swim = sports.swim!;
    expect(swim.hero.lanes).toHaveLength(8);
    // 200 m in 3:18.36 and 400 m in 6:51.24: (411.24 − 198.36) / 2 = 106.44 s per 100 m.
    expect(swim.css.headline).toBe("Critical swim speed 1:46 /100 m");
    expect(swim.css.sample).toBeUndefined();
    expect(swim.css.sampleTrend).not.toBeNull();
    expect(swim.records.sample).toBeUndefined();
    expect(swim.records.rows.map((r) => r.value)).toEqual(["0:41.82", "1:31.47", "3:18.36", "6:51.24", "14:22.63"]);
  });

  it("hides a sport the athlete does not do", () => {
    const base = items();
    const noSwims = sportsFromItems({ ...base, activities: base.activities.filter((a) => a.sport !== "poolSwim" && a.sport !== "openWater") }, NOW);
    expect(noSwims.families).not.toContain("swim");
    expect(noSwims.swim).toBeNull();
    expect(noSwims.hub.rings.map((r) => r.family)).toEqual(["run", "ride", "strength"]);
    expect(noSwims.hub.cards.map((c) => c.family)).toEqual(["run", "ride", "strength"]);
    expect(noSwims.hub.standouts.some((s) => s.family === "swim")).toBe(false);
  });

  it("leaves a reading out instead of guessing when its input is missing", () => {
    const base = items();
    const bare = sportsFromItems({ ...base, details: [], training: undefined, body: undefined }, NOW);
    expect(bare.run!.engine).toEqual({ missing: "Nothing from your phone yet" });
    expect(isMissing(bare.run!.hard)).toBe(true);
    expect(isMissing(bare.run!.durability)).toBe(true);
    expect(isMissing(bare.ride!.hero.curve)).toBe(true);
    expect(isMissing(bare.ride!.ftp) && isMissing(bare.ride!.zones) && isMissing(bare.ride!.vo2) && isMissing(bare.ride!.balance)).toBe(true);
    // Readings with no synced source at all are the sample athlete's, and say so.
    expect(bare.swim!.css.sample && bare.swim!.records.sample).toBe(true);
    expect(bare.swim!.tiles[0]).toMatchObject({ label: "Speed", value: "–" });
    // The weeks still come from the activity list.
    expect(bare.run!.much.weeks.bars).toHaveLength(8);
  });

  it("draws what is planned for the rest of the week on top of what is done", () => {
    const planned = [
      { day: "2026-11-28", family: "run" as const, name: "Long run", meters: 16000, seconds: 5400 },
      { day: "2026-11-27", family: "ride" as const, name: "Endurance ride", meters: 0, seconds: 10800 },
      { day: "2026-11-23", family: "run" as const, name: "Yesterday's run", meters: 9000, seconds: 3000 },
      { day: "2026-12-02", family: "run" as const, name: "Next week", meters: 9000, seconds: 3000 },
    ];
    const s = sportsFromItems({ ...items(), planned }, NOW);
    const bars = s.run!.much.weeks.bars;
    expect(bars[bars.length - 1].planned).toBe(16000);
    expect(s.run!.much.days.bars.map((b) => b.planned ?? 0)).toEqual([0, 0, 0, 0, 0, 16000, 0]);
    expect(s.run!.hero.text).toContain("16.0 km on Saturday still planned");
    expect(s.run!.coach.next!.title).toBe("Long run on Saturday");
    expect(s.ride!.tiles[0].text).toBe("A 3 h 00 ride is planned for Friday");
    expect(s.hub.hours.weeks[11].planned).toBeCloseTo(4.5);
    expect(s.hub.headline).toContain("Riding is still to come.");
  });
});

describe("recordings", () => {
  const act = actFromNative({ id: "a", name: "Run", sport: "run", start: 0, distanceMeters: 1000, durationSeconds: 300 })!;

  it("keeps a recording over time as it is", () => {
    const rec = recordingFrom(act, { streams: { axis: "time", x: [0, 10, 20], hr: [120, 130, 140], powerW: [1, 2] } })!;
    expect(rec.t).toEqual([0, 10, 20]);
    expect(rec.hr).toEqual([120, 130, 140]);
    // A stream of another length is not trusted.
    expect(rec.power).toBeUndefined();
  });

  it("turns metres into seconds with the speed, or evenly over the activity's time", () => {
    expect(recordingFrom(act, { streams: { axis: "distance", x: [0, 100, 300], speedMps: [5, 5, 5] } })!.t).toEqual([0, 20, 60]);
    expect(recordingFrom(act, { streams: { axis: "distance", x: [0, 500, 1000] } })!.t).toEqual([0, 150, 300]);
    expect(recordingFrom(act, {})).toBeNull();
  });
});

describe("planned workouts", () => {
  it("keeps Training Hub's runs, rides, swims and gym workouts", () => {
    const day = (sport: string | null, name: string, totals: { seconds: number; meters: number; sets: number } | null) =>
      ({ day: "2026-11-28", idInPlan: "1", planId: "", planProgramId: "", name, sportCode: null, sport, workout: null, totals }) as never;
    const out = plannedFromHub([{ day: "2026-11-28", workouts: [day("trailRun", "Trail", { seconds: 3600, meters: 9000, sets: 0 }), day("xcSki", "Ski", null), day("bike", "Ride", null)] }]);
    expect(out).toEqual([{ day: "2026-11-28", family: "run", name: "Trail", meters: 9000, seconds: 3600 }, { day: "2026-11-28", family: "ride", name: "Ride", meters: 0, seconds: 0 }]);
  });
});

describe("the sample athlete", () => {
  it("goes through the same maths", () => {
    const s = sampleSports();
    expect(s.run).not.toBeNull();
    expect(s.hub.day).toBe("Thu 19 Nov");
    expect(s.run!.hero.figures[0].value).toBe("14.1 km");
  });
});
