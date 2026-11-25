import { describe, expect, it } from "vitest";
import type { HubSport, HubWorkout, HubWorkoutStep } from "@/data/hub";
import { bodyKindFor, musclesFor, SPORT_HUE, sportStats, targetWords, workoutBody } from "./sportCard";
import { parseWorkout, workoutCard } from "./workout";
import type { AthleteZones } from "./zones";

const none = { kind: "none" as const };
const one = (step: HubWorkoutStep) => ({ repeats: null, steps: [step] });
const made = (raw: unknown) => {
  const m = parseWorkout(raw, "2026-11-26", "w");
  if ("error" in m) throw new Error(m.error);
  return m;
};
const card = (raw: unknown, zones: AthleteZones | null = null) => workoutCard(made(raw), null, { id: "c", date: "2026-11-26" }, zones);
const ZONES: AthleteZones = {
  source: "coros", ftp: 250, pace: [],
  hr: [{ zone: 1, fromBpm: null, toBpm: 129 }, { zone: 2, fromBpm: 130, toBpm: 149 }, { zone: 3, fromBpm: 150, toBpm: 159 }, { zone: 4, fromBpm: 160, toBpm: 171 }, { zone: 5, fromBpm: 172, toBpm: null }],
};

describe("choosing a workout card's picture by sport", () => {
  it("gives every sport Coach can write its own picture", () => {
    const kinds: Record<HubSport, string> = { run: "intervals", trailRun: "intervals", bike: "intervals", xcSki: "intervals", swim: "swim", strength: "strength", hyrox: "hyrox", indoorClimb: "climb", bouldering: "climb" };
    for (const [sport, kind] of Object.entries(kinds)) expect(bodyKindFor(sport as HubSport, 5)).toBe(kind);
    expect(new Set(Object.values(SPORT_HUE)).size).toBe(9);
  });
  it("says a one-step session plainly instead of drawing one block, except where the sport's list is the point", () => {
    expect(bodyKindFor("run", 1)).toBe("simple");
    expect(bodyKindFor("bike", 1)).toBe("simple");
    expect(bodyKindFor("swim", 1)).toBe("simple");
    expect(bodyKindFor("strength", 1)).toBe("strength");
    expect(bodyKindFor("bouldering", 1)).toBe("climb");
    const easy = card({ name: "Easy 45", sport: "run", blocks: [{ steps: [{ kind: "training", target: "time", seconds: 2700, intensity: { kind: "heartRate", low: 130, high: 145 } }] }] }, ZONES);
    expect(easy.body).toMatchObject({ kind: "simple", list: [{ repeats: 1, rows: [{ amount: "45:00", target: "Z2 · 130–145 bpm" }] }] });
  });
  it("puts the sport, its colour and its body on the card, and leaves what is saved alone", () => {
    const raw = { name: "Legs", sport: "strength", blocks: [{ steps: [{ kind: "training", target: "reps", count: 5, sets: 3, exercise: "Back squat" }] }] };
    const m = made(raw), c = workoutCard(m, null, { id: "c", date: "2026-11-26" });
    expect(c).toMatchObject({ sport: "strength", hue: "pink", eyebrow: "Strength · suggested", body: { kind: "strength" } });
    expect(c.workout).toEqual(m.workout);
    expect(c.hub).toBeUndefined();
    expect(JSON.stringify(c.workout)).not.toContain("muscle");
  });
});

describe("a strength card", () => {
  const GYM = { name: "Lower body", sport: "strength", blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 480, name: "Bike and mobility" }] },
    { steps: [{ kind: "training", target: "reps", count: 6, sets: 4, restSeconds: 150, exercise: "Back squat", intensity: { kind: "weight", low: 82.5 } }] },
    { steps: [{ kind: "training", target: "reps", count: 10, sets: 3, restSeconds: 90, exercise: "Walking lunge", intensity: { kind: "bodyweight" } }] },
    { steps: [{ kind: "training", target: "time", seconds: 45, sets: 3, restSeconds: 45, exercise: "Plank", intensity: { kind: "bodyweight" } }] },
    { steps: [{ kind: "training", target: "open", sets: 2, exercise: "Leg curl" }] },
  ] };
  it("writes each exercise as sets × reps or seconds, its load and its rest, with no interval strip", () => {
    const c = card(GYM), rows = c.body!.list.flatMap((g) => g.rows);
    expect(c.body!.strip).toBeUndefined();
    expect(rows.map((r) => [r.kind, r.name, r.amount, r.target, r.rest])).toEqual([
      ["warmup", "Bike and mobility", "8:00", "", ""],
      ["work", "Back squat", "4 × 6", "82.5 kg", "2:30 rest"],
      ["work", "Walking lunge", "3 × 10", "Bodyweight", "1:30 rest"],
      ["work", "Plank", "3 × 0:45", "Bodyweight", "45 s rest"],
      ["work", "Leg curl", "2 × to lap", "", ""],
    ]);
    expect(c.body).toMatchObject({ unit: "exercises", count: 4 });
  });
  it("counts exercises, sets and an estimated time", () => {
    // 8:00 + (4×18 s + 3×150) + (3×30 + 2×90) + (3×45 + 2×45) + (2×60 + 90) = 28:27
    expect(card(GYM).stats).toEqual([{ label: "Exercises", value: "4" }, { label: "Sets", value: "12" }, { label: "Time, about", value: "28:27" }]);
  });
  it("lists the muscles trained from the app's own table, by effective sets", () => {
    const shares = card(GYM).body!.shares!;
    expect(card(GYM).body!.sharesLabel).toBe("Muscles, by sets");
    expect(shares[0].share).toBe(1);
    expect(shares.map((s) => s.name)).toEqual(expect.arrayContaining(["Quads", "Glutes", "Hamstrings", "Abs"]));
    expect(shares.every((s) => s.share > 0 && s.share <= 1 && Number(s.value) > 0)).toBe(true);
  });
  it("leaves muscles out when one exercise isn't in the table, rather than show part of them", () => {
    const odd = { ...GYM, blocks: [...GYM.blocks, { steps: [{ kind: "training", target: "reps", count: 8, sets: 2, exercise: "Zercher zigzag" }] }] };
    expect(card(odd).body!.shares).toBeUndefined();
  });
  it("finds an exercise's muscles by its nearest name, then by its movement", () => {
    expect(musclesFor("Barbell Bench Press")?.[0][0]).toBe("chest");
    expect(musclesFor("Goblet squats")?.map((m) => m[0])).toContain("quads");
    expect(musclesFor("Seated hamstring curl")?.[0][0]).toBe("hamstrings");
    expect(musclesFor("Zercher zigzag")).toBeNull();
    expect(musclesFor("")).toBeNull();
  });
});

describe("a run, ride or ski card", () => {
  const RUN = { name: "5 × 1 km", sport: "run", blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 900 }] },
    { repeats: 5, steps: [{ kind: "training", target: "distance", meters: 1000, intensity: { kind: "pace", low: 250.5, high: 260 } }, { kind: "rest", target: "time", seconds: 120 }] },
    { steps: [{ kind: "cooldown", target: "distance", meters: 2000, intensity: { kind: "pace", low: 330, high: 345 } }] },
  ] };
  it("draws repeats as one group named by its work step, with the target at full precision", () => {
    const strip = card(RUN).body!.strip!;
    expect(strip.map((g) => [g.repeats, g.amount, g.target, g.segs.length])).toEqual([[1, "15:00", "", 1], [5, "5 × 1.00 km", "4:10.50 to 4:20 /km", 2], [1, "2.00 km", "5:30 to 5:45 /km", 1]]);
    expect(card(RUN).body).toMatchObject({ kind: "intervals", unit: "steps", count: 4 });
  });
  it("makes a block as wide as it is long and as tall as it is hard", () => {
    const [, reps, cool] = card(RUN).body!.strip!;
    // 1 km at the middle of 4:10.5 to 4:20 is 255 s; 2 km at 5:37.5 is 675 s.
    expect(reps.segs.map((s) => s.weight)).toEqual([255, 120]);
    expect(cool.segs[0].weight).toBe(675);
    expect(reps.segs[0].height).toBeGreaterThan(cool.segs[0].height);
    expect(reps.segs[0].height).toBeGreaterThan(reps.segs[1].height);
  });
  it("names heart rate targets by the athlete's own zone when the zones are known", () => {
    const hr = { kind: "heartRate" as const, low: 160, high: 170 };
    expect(targetWords(hr, { zones: ZONES })).toBe("Z4 · 160–170 bpm");
    expect(targetWords(hr)).toBe("160–170 bpm");
    const tall = (zones: AthleteZones | null) => card({ name: "Hills", sport: "trailRun", blocks: [
      { steps: [{ kind: "warmup", target: "time", seconds: 600, intensity: { kind: "heartRate", low: 120, high: 128 } }] },
      { repeats: 4, steps: [{ kind: "training", target: "elevationGain", meters: 120, intensity: hr }, { kind: "rest", target: "hrRecovery", bpm: 120 }] },
    ] }, zones);
    const c = tall(ZONES);
    expect(c.eyebrow).toBe("Trail run · suggested");
    expect(c.body!.list[1].rows.map((r) => [r.amount, r.target])).toEqual([["+120 m climb", "Z4 · 160–170 bpm"], ["Until 120 bpm", ""]]);
    expect(c.body!.strip![1].segs[0].height).toBeGreaterThan(c.body!.strip![0].segs[0].height);
    expect(tall(null).body!.strip![1].segs[0].height).toBe(1);
  });
  it("reads a ride against power: watts with their share of FTP, and time in power zones", () => {
    const RIDE = { name: "Sweet spot", sport: "bike", blocks: [
      { steps: [{ kind: "warmup", target: "time", seconds: 600, intensity: { kind: "power", low: 125, high: 150 } }] },
      { repeats: 3, steps: [{ kind: "training", target: "time", seconds: 720, intensity: { kind: "power", low: 220, high: 235 } }, { kind: "rest", target: "time", seconds: 240, intensity: { kind: "power", low: 100, high: 125 } }] },
    ] };
    const c = card(RIDE, ZONES), body = c.body!;
    expect(c).toMatchObject({ sport: "bike", hue: "cyan", eyebrow: "Ride · suggested" });
    expect(body.strip![1]).toMatchObject({ repeats: 3, amount: "3 × 12:00", target: "220–235 W · 88–94 % FTP" });
    expect(body.sharesLabel).toBe("Time in power zones, FTP 250 W");
    expect(body.shares!.map((z) => [z.name, z.value])).toEqual([["Z1", "22:00"], ["Z4", "36:00"]]);
    expect(body.shares!.reduce((t, z) => t + z.share, 0)).toBeCloseTo(1);
    const plain = card(RIDE).body!;
    expect(plain.shares).toBeUndefined();
    expect(plain.strip![1].target).toBe("220–235 W");
  });
});

describe("a pool swim card", () => {
  const SWIM = { name: "100s", sport: "swim", blocks: [
    { steps: [{ kind: "warmup", target: "distance", meters: 400, intensity: { kind: "stroke", stroke: "freestyle" } }] },
    { repeats: 8, steps: [{ kind: "training", target: "distance", meters: 100, intensity: { kind: "stroke", stroke: "freestyle" } }, { kind: "rest", target: "time", seconds: 20 }] },
    { repeats: 4, steps: [{ kind: "training", target: "distance", meters: 50, intensity: { kind: "stroke", stroke: "drills" } }, { kind: "training", target: "distance", meters: 50, intensity: { kind: "stroke", stroke: "backstroke" } }, { kind: "rest", target: "time", seconds: 90 }] },
    { steps: [{ kind: "cooldown", target: "distance", meters: 200 }] },
  ] };
  it("writes sets as lines, the rest with the repeat it follows", () => {
    const body = card(SWIM).body!;
    expect(body).toMatchObject({ kind: "swim", unit: "sets", count: 4 });
    expect(body.list.map((g) => [g.repeats, g.rows.map((r) => [r.amount, r.name, r.target, r.rest].join("|"))])).toEqual([
      [1, ["400 m|Warm up|freestyle|"]],
      [8, ["100 m|freestyle||20 s rest"]],
      [4, ["50 m|drills||", "50 m|backstroke||1:30 rest"]],
      [1, ["200 m|Cool down||"]],
    ]);
    expect(body.list.map((g) => g.rows[0].bar)).toEqual([0.5, 1, 0.5, 0.25]);
  });
  it("totals metres and lengths for the pool, and metres by stroke", () => {
    const c = card(SWIM);
    expect(c.stats).toEqual([{ label: "Distance", value: "1,800", unit: "m" }, { label: "Lengths, 25 m pool", value: "72" }]);
    expect(c.body!.shares!.map((s) => [s.name, s.value])).toEqual([["Freestyle", "1,200 m"], ["Drills", "200 m"], ["Backstroke", "200 m"], ["Any stroke", "200 m"]]);
    const hub: HubWorkout = { ...made(SWIM).hub!, poolLength: 50 };
    expect(sportStats(hub, workoutBody(hub))![1]).toEqual({ label: "Lengths, 50 m pool", value: "36" });
    const yards: HubWorkout = { ...hub, poolLength: 33.33 };
    expect(sportStats(yards, workoutBody(yards))).toHaveLength(1);
  });
});

describe("HYROX and climbing cards", () => {
  const km = one({ kind: "training", target: "distance", meters: 1000, intensity: none });
  const HYROX: HubWorkout = { name: "Half sim", sport: "hyrox", description: "", blocks: [
    one({ kind: "warmup", target: "time", seconds: 600, intensity: none }),
    km, one({ kind: "training", target: "distance", meters: 1000, intensity: { kind: "rpe", low: 7 }, exercise: { id: "1", name: "SkiErg", kind: 1 } }),
    km, one({ kind: "training", target: "distance", meters: 50, intensity: { kind: "weight", low: 102 }, exercise: { id: "2", name: "Sled Push", kind: 2 } }),
    km, one({ kind: "training", target: "reps", count: 100, intensity: { kind: "weight", low: 6 }, exercise: { id: "8", name: "Wall Balls", kind: 8 } }),
  ] };
  it("numbers the stations in order and keeps the runs between them", () => {
    const body = workoutBody(HYROX), rows = body.list.flatMap((g) => g.rows);
    expect(body).toMatchObject({ kind: "hyrox", unit: "stations", count: 3 });
    expect(rows.map((r) => [r.mark ?? 0, r.name, r.amount, r.target])).toEqual([
      [0, "Warm up", "10:00", ""], [0, "Run", "1.00 km", ""], [1, "SkiErg", "1.00 km", "RPE 7"], [0, "Run", "1.00 km", ""], [2, "Sled Push", "50 m", "102 kg"],
      [0, "Run", "1.00 km", ""], [3, "Wall Balls", "100 reps", "6 kg"],
    ]);
    expect(sportStats(HYROX, body)).toEqual([{ label: "Stations", value: "3" }, { label: "Running", value: "3.00", unit: "km" }]);
  });
  it("names a station Coach wrote without COROS's list, and doesn't count it as running", () => {
    const c = card({ name: "Sim", sport: "hyrox", blocks: [{ steps: [{ kind: "training", target: "distance", meters: 1000 }] }, { steps: [{ kind: "training", target: "distance", meters: 50, exercise: "Sled Push", intensity: { kind: "weight", low: 102 } }] }] });
    expect(c.body!.list.flatMap((g) => g.rows).map((r) => [r.mark ?? 0, r.name])).toEqual([[0, "Run"], [1, "Sled Push"]]);
    expect(c.stats).toEqual([{ label: "Stations", value: "1" }, { label: "Running", value: "1.00", unit: "km" }]);
    expect(JSON.stringify(c.hub)).not.toContain("Sled Push");
  });
  it("writes climbing as routes at a grade and time blocks, with rests that carry no grade", () => {
    const c = card({ name: "Pyramid", sport: "indoorClimb", gradeSystem: "french", blocks: [
      { steps: [{ kind: "warmup", target: "routes", count: 3, intensity: { kind: "grade", grade: "5a" } }] },
      { repeats: 3, steps: [{ kind: "training", target: "routes", count: 2, intensity: { kind: "grade", grade: "6a+" } }, { kind: "rest", target: "time", seconds: 180, intensity: { kind: "grade", grade: "6a+" } }] },
      { steps: [{ kind: "training", target: "time", seconds: 900, intensity: { kind: "grade", gradeOffset: -2 } }] },
    ] });
    expect(c).toMatchObject({ sport: "indoorClimb", eyebrow: "Climb · suggested", body: { kind: "climb" } });
    expect(c.body!.list.map((g) => [g.repeats, g.rows.map((r) => [r.kind, r.name, r.amount, r.target, r.mark ?? 0].join("|"))])).toEqual([
      [1, ["warmup|Warm up|3 routes|5a|3"]],
      [3, ["work|Climb|2 routes|6a+|2", "rest|Rest|3:00||0"]],
      [1, ["work|Climb|15:00|Onsight −2|0"]],
    ]);
    expect(c.stats).toEqual([{ label: "Routes", value: "9" }, { label: "Timed steps", value: "24:00" }]);
    const boulders = card({ name: "Limit", sport: "bouldering", gradeSystem: "vScale", blocks: [{ steps: [{ kind: "training", target: "routes", count: 1, intensity: { kind: "grade", grade: "V4" } }] }] });
    expect(boulders.body).toMatchObject({ kind: "climb", list: [{ rows: [{ name: "Boulders", amount: "1 route", target: "V4" }] }] });
  });
});
