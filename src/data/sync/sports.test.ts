import { describe, expect, it } from "vitest";
import { useUnitsNow } from "@/lib/units";
import { isMissing } from "@/data/sports";
import { sampleSports } from "@/data/sample/sports";
import { seedItems } from "@/data/sampleSeed";
import type { SyncBodies } from "./native";
import { sportTabs } from "@/lib/sports";
import { dateToRef, type NativeActivity, type NativeSport } from "./native";
import { actFromNative, familyOf, kindOf, plannedFromHub, recordingFrom, sportsFromItems, type SportsItems } from "./sports";

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
    // The hub follows the detected order.
    expect(sports.hub.rings.map((r) => r.family)).toEqual(sports.families);
    expect(sports.hub.cards.map((c) => c.family)).toEqual(sports.families);
    expect(new Set(sports.hub.cards.map((c) => c.href))).toEqual(new Set(["/sports/running", "/sports/riding", "/sports/swimming", "/strength"]));
    expect(sports.walk ?? sports.snow ?? sports.climb).toBeNull();
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
    expect(noSwims.hub.rings.map((r) => r.family)).toEqual(noSwims.families);
    expect(noSwims.hub.cards.map((c) => c.family)).toEqual(noSwims.families);
    expect([...noSwims.families].sort()).toEqual(["ride", "run", "strength"]);
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

describe("sports in imperial", () => {
  it("shows miles, feet, yards and /100 yd", () => {
    useUnitsNow("imperial");
    try {
      const sports = sportsFromItems(items(), NOW);
      expect(sports.run!.hero.figures[0].value).toMatch(/^\d+\.\d mi$/);
      expect(sports.run!.much.weeks.line!.text).toMatch(/^Usual, \d+\.\d mi$/);
      expect(sports.run!.tiles[0].unit).toBe("mi");
      expect(sports.ride!.tiles.find((x) => x.href === "#climb")!.unit).toBe("ft");
      expect(sports.swim!.hero.figures[0].value).toMatch(/ yd$/);
      expect(sports.swim!.tiles.find((x) => x.href === "#now")!.unit).toBe("yd");
    } finally { useUnitsNow("metric"); }
  });
});

describe("sport kinds", () => {
  it("files each of the phone's sports under a family", () => {
    const families = (["run", "indoorRun", "trailRun", "track", "bike", "indoorBike", "poolSwim", "openWater", "strength", "walk", "hike", "ski", "cardio", "row", "multisport", "other"] as NativeSport[])
      .map((s) => familyOf(s));
    expect(families).toEqual(["run", "run", "run", "run", "ride", "ride", "swim", "swim", "strength", "walk", "hike", "snow", "other", "other", "other", "other"]);
  });

  it("tells climbing and the snow sports apart by COROS's code", () => {
    // Indoor climbing and bouldering come over from the phone as "other".
    expect([kindOf("other", 800), familyOf("other", 800)]).toEqual(["indoorClimb", "climb"]);
    expect([kindOf("other", 801), familyOf("other", 801)]).toEqual(["bouldering", "climb"]);
    expect([kindOf("ski", 500), kindOf("ski", 501), kindOf("ski", 502), kindOf("ski", 503), kindOf("ski")]).toEqual(["ski", "snowboard", "xcSki", "ski", "ski"]);
    expect(familyOf("ski", 501)).toBe("snow");
    // A code is only read for the sport it belongs to, and an unknown one leaves the phone's sport.
    expect([familyOf("run", 800), familyOf("other", 1200), familyOf("other")]).toEqual(["run", "other", "other"]);
    expect(actFromNative({ id: "c", name: "", sport: "other", sportCode: 801, start: dateToRef(NOW), durationSeconds: 3600 })).toMatchObject({ family: "climb", kind: "bouldering", name: "Workout" });
  });
});

describe("walking, hiking, skiing and climbing pages", () => {
  let k = 0;
  const day = (d: number, h = 10) => new Date(2026, 10, 24 - d, h, 0);
  const activity = (sport: NativeSport, d: number, minutes: number, more: Partial<NativeActivity> = {}): NativeActivity => ({
    id: `x${++k}`, name: `${sport} ${d}`, sport, start: dateToRef(day(d)), durationSeconds: minutes * 60, ...more,
  });
  const walks = [
    activity("walk", 0, 50, { distanceMeters: 4200, elevationGain: 30, averageHR: 98 }),
    activity("walk", 7, 40, { distanceMeters: 3100 }),
    activity("walk", 14, 45, { distanceMeters: 3600 }),
    activity("walk", 40, 45, { distanceMeters: 3600 }),
  ];
  const hikes = [
    activity("hike", 2, 240, { distanceMeters: 14000, elevationGain: 900 }),
    activity("hike", 9, 180, { distanceMeters: 10000, elevationGain: 600 }),
    activity("hike", 16, 300, { distanceMeters: 18000, elevationGain: 1200 }),
    activity("hike", 23, 200, { distanceMeters: 12000, elevationGain: 700 }),
  ];
  const climbs = [1, 8, 15, 22].map((d) => activity("other", d, 90, { sportCode: d === 22 ? 801 : 800, averageHR: 128 }));
  const base = items();
  const sports = sportsFromItems({ ...base, activities: [...base.activities, ...walks, ...hikes, ...climbs] }, NOW);

  it("gives a page to a sport the athlete does, and lists it where detection puts it", () => {
    expect(sports.families).toContain("walk");
    expect(sports.families).toContain("hike");
    expect(sports.families).toContain("climb");
    expect(sports.families).not.toContain("snow");
    expect(sports.walk && sports.hike && sports.climb).toBeTruthy();
    expect(sports.snow).toBeNull();
    expect(sports.hub.rings.map((r) => r.family)).toEqual(sports.families);
    expect(sports.hub.cards.find((c) => c.family === "walk")?.href).toBe("/sports/walking");
    expect(sports.hub.cards.find((c) => c.family === "hike")?.href).toBe("/sports/hiking");
    expect(sports.hub.standouts.some((s) => s.family === "climb")).toBe(true);
    // Walks, hikes and climbs have their own place now, not "Also in the last 90 days".
    expect(sports.hub.also.map((a) => a.name)).not.toContain("Workout");
    expect(sportTabs(sports.families, null).map((t) => t.href)).toEqual(["/sports", ...sports.families.map((f) => sports.hub.rings.find((r) => r.family === f)!.href)]);
  });

  it("reads walking from the activity list: time, distance and climb", () => {
    const walk = sports.walk!;
    expect(walk.hero.figures).toEqual([
      { value: "50 min", label: "This week" }, { value: "1", label: "Sessions" }, { value: "4.2 km", label: "Distance" }, { value: "30 m", label: "Climb" },
    ]);
    expect(walk.hero.chart.bars).toHaveLength(12);
    // The last 28 days: three walks, 2 h 15, 10.9 km. Hikes are not walks.
    expect(walk.month.headline).toBe("3 walks");
    expect(walk.month.figures.slice(0, 2).map((f) => f.value)).toEqual(["2 h 15", "10.9 km"]);
    expect(isMissing(walk.climb)).toBe(false);
    expect(walk.recent[0]).toMatchObject({ id: walks[0].id, kind: "Walk", figures: ["50 min", "4.2 km", "30 m", "98 bpm"] });
    expect(walk.recent.every((r) => r.kind === "Walk")).toBe(true);
  });

  it("gives hiking a page of its own: time, distance and climb", () => {
    const hike = sports.hike!;
    expect(hike.family).toBe("hike");
    // The last 28 days: four hikes, 15 h 20, 54.0 km, 3,400 m.
    expect(hike.month.headline).toBe("4 hikes");
    expect(hike.month.figures.slice(0, 3).map((f) => f.value)).toEqual(["15 h 20", "54.0 km", "3,400 m"]);
    expect(hike.recent.map((r) => r.id)).toEqual(hikes.map((h) => h.id));
    expect(hike.records.map((r) => [r.name, r.value])).toEqual([["Longest", "5 h 00 min"], ["Farthest", "18.0 km"], ["Most climbing", "1,200 m"], ["Biggest week, last 12", "5 h 00 min"]]);
  });

  it("puts Hiking first and leaves Running out for someone who mostly hikes", () => {
    const run = activity("run", 5, 30, { distanceMeters: 5000 });
    const hiker = sportsFromItems({ ...base, activities: [...hikes, run] }, NOW);
    expect(hiker.families[0]).toBe("hike");
    expect(hiker.families).not.toContain("run");
    expect(sportTabs(hiker.families, null).map((t) => t.label)).toEqual(["All sports", "Hiking"]);
  });

  it("reads climbing without distance or climb, and splits it by kind", () => {
    const climb = sports.climb!;
    expect(climb.climb).toBeNull();
    expect(climb.hero.figures.map((f) => f.label)).toEqual(["This week", "Sessions", "Avg heart rate"]);
    expect(climb.month.kinds!.map((x) => x.name)).toEqual(["Indoor climb", "Bouldering"]);
    expect(climb.recent.every((r) => r.figures.length === 2)).toBe(true);
    expect(climb.records.map((r) => r.name)).toEqual(["Longest", "Biggest week, last 12"]);
  });

  it("says so when a skier has no climb in the list", () => {
    const skis = [0, 1, 2, 3].map((d) => activity("ski", d, 180, { sportCode: d % 2 ? 501 : 500, distanceMeters: 30000 }));
    const s = sportsFromItems({ ...base, activities: [...base.activities, ...skis] }, NOW);
    expect(s.families).toContain("snow");
    expect(s.snow!.climb).toEqual({ missing: "Needs a session with its climb from the watch." });
    expect(s.snow!.month.kinds!.map((x) => x.name).sort()).toEqual(["Ski", "Snowboard"]);
  });

  it("keeps a page for a sport the athlete doesn't do closed, and with nothing known shows the main four", () => {
    const one = sportsFromItems({ ...base, activities: [...base.activities, activity("hike", 3, 120)] }, NOW);
    expect(one.families).not.toContain("hike");
    expect(one.hike).toBeNull();
    expect(one.hub.rings.some((r) => r.family === "hike")).toBe(false);
    const none = sportsFromItems({ ...base, activities: [] }, NOW);
    expect(none.families).toEqual([]);
    expect(none.hub.rings.map((r) => r.family)).toEqual(["run", "ride", "swim", "strength"]);
    expect(none.walk ?? none.hike ?? none.snow ?? none.climb).toBeNull();
  });
});
