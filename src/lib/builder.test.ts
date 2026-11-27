import { afterEach, describe, expect, it } from "vitest";
import { useUnitsNow } from "./units";
import type { HubWorkout } from "@/data/hub";
import { sampleLibrary } from "@/data/sample/workoutLibrary";
import { sampleNumbers, sampleProfile, starterWorkout } from "@/data/sample/workouts";
import { hubWorkoutProblem } from "@/server/hub/rules";
import {
  calendarSport, defaultIntensity, derivedText, DESCRIPTION_MAX, docChecks, docFromHub, docReady, docShape, docSummary, docToHub, docToLegacy, docTotals, docUnwired, fitToSport,
  formatPaceRange, intensitiesFor, INTENSITY_LABEL, isCard, kindsFor, legacyDoc, newDoc, newRepeat, newStep, pacingFor, parseNumber, parsePaceRange, pendingCount,
  percentRange, quickRunDoc, repeatText, setsText, SPORTS, stepProblem, targetsFor, TARGET_LABEL, withGradeSystem, withKind,
  type BuilderDoc, type BuilderStep,
} from "./builder";
import { addItem, moveItem, updateStep } from "./workout";

const ids = () => { let n = 0; return () => `t${++n}`; };
const three = (): [string, string, string] => ["a", "b", "c"];
const lib = (id: string): BuilderDoc => sampleLibrary.find((w) => w.id === id)!.doc;
const step = (over: Partial<BuilderStep>): BuilderStep => ({ type: "step", id: "s", kind: "training", target: "time", seconds: 600, intensity: { kind: "none" }, ...over });
const labels = (sport: BuilderDoc["sport"], s: Partial<BuilderStep> = {}) => intensitiesFor(sport, step(s)).map((k) => INTENSITY_LABEL[k]);

describe("what each sport offers", () => {
  it("lists the sports in the builder's order", () => {
    expect(SPORTS.map((s) => s.label)).toEqual(["Run", "Bike", "Pool Swim", "Strength", "Trail Run", "Indoor Climb", "Bouldering", "XC Ski", "HYROX"]);
  });

  it("offers Send-off only in the pool", () => {
    expect(kindsFor("swim")).toEqual(["warmup", "training", "rest", "cooldown", "sendOff"]);
    expect(kindsFor("run")).toEqual(["warmup", "training", "rest", "cooldown"]);
  });

  it("lists what a step can end on", () => {
    const names = (sport: BuilderDoc["sport"], s: Partial<BuilderStep> = {}) => targetsFor(sport, step(s)).map((t) => TARGET_LABEL[t]);
    expect(names("run")).toEqual(["Distance", "Time", "Training Load", "Open"]);
    expect(names("run", { kind: "rest" })).toEqual(["Distance", "Time", "Training Load", "Open", "HR Recovery"]);
    expect(names("trailRun")).toEqual(["Distance", "Time", "Training Load", "Open", "Elevation Gain"]);
    expect(names("strength")).toEqual(["Reps", "Time", "Open"]);
    expect(names("bouldering")).toEqual(["Routes", "Time", "Open"]);
  });

  it("lists the targets of each sport as CorosLink does", () => {
    expect(labels("run")).toEqual(["Not set", "Heart Rate", "% Heart Rate", "% Threshold Pace", "Pace", "% Effort Pace", "Effort Pace", "Power", "Cadence"]);
    expect(labels("trailRun")).toEqual(labels("run"));
    expect(labels("bike")).toEqual(["Not set", "Heart Rate", "% Heart Rate", "% FTP", "Speed", "Power", "Cadence"]);
    expect(labels("swim")).toEqual(["Not set", "Stroke"]);
    expect(labels("strength")).toEqual(["Not set", "Weight", "Bodyweight"]);
    expect(labels("strength", { kind: "rest" })).toEqual(["Not set"]);
    expect(labels("xcSki")).toEqual(["Not set", "Heart Rate", "% Heart Rate", "Speed"]);
    expect(labels("indoorClimb")).toEqual(["Grade"]);
    expect(labels("hyrox")).toEqual(expect.arrayContaining(["Pace", "% Heart Rate", "Weight", "RPE", "Speed"]));
  });

  it("starts a workout with warm-up, training and cool-down, or one exercise for strength", () => {
    expect(newDoc("run", three()).items.map((i) => i.type === "step" && i.kind)).toEqual(["warmup", "training", "cooldown"]);
    expect(newDoc("swim", three())).toMatchObject({ poolLength: 25 });
    const gym = newDoc("strength", three());
    expect(gym.items).toHaveLength(1);
    expect(gym.items[0]).toMatchObject({ kind: "training", target: "reps", sets: 3, restSeconds: 60 });
    expect(newDoc("bouldering", three())).toMatchObject({ gradeSystem: "vScale" });
  });

  it("makes every new step of every sport one COROS takes, apart from the exercise still to pick", () => {
    for (const { sport } of SPORTS) {
      const doc = newDoc(sport, three());
      const full: BuilderDoc = { ...doc, items: [...doc.items, newRepeat(["r", "r1", "r2"], doc)] };
      const pending = sport === "strength" ? 2 : 0;
      expect([sport, pendingCount(full)]).toEqual([sport, pending]);
    }
  });
});

describe("percentage targets", () => {
  it("reads a zone or a custom range", () => {
    expect(percentRange({ kind: "heartRatePercent", basis: "maxHr", zone: "fatBurn" })).toEqual({ low: 61, high: 70 });
    expect(percentRange({ kind: "heartRatePercent", basis: "lthr", zone: "threshold" })).toEqual({ low: 103, high: 106 });
    expect(percentRange({ kind: "ftpPercent", zone: "custom", low: 88, high: 94 })).toEqual({ low: 88, high: 94 });
    expect(percentRange({ kind: "ftpPercent", zone: "custom", low: 94, high: 88 })).toBeNull();
    expect(percentRange({ kind: "pace", low: 270, high: 280 })).toBeNull();
  });

  it("derives the athlete's own numbers when they are known", () => {
    expect(derivedText({ kind: "heartRatePercent", basis: "maxHr", zone: "fatBurn" }, sampleNumbers)).toBe("117 to 134 bpm");
    expect(derivedText({ kind: "heartRatePercent", basis: "reserve", zone: "custom", low: 50, high: 60 }, { maxHr: 190, restingHr: 50 })).toBe("120 to 134 bpm");
    expect(derivedText({ kind: "ftpPercent", zone: "threshold" }, { ftp: 250 })).toBe("228 to 263 W");
    expect(derivedText({ kind: "thresholdPacePercent", zone: "custom", low: 100, high: 110 }, { thresholdPace: 275 })).toBe("4:10 to 4:35 /km");
    expect(derivedText({ kind: "heartRatePercent", basis: "lthr", zone: "fatBurn" }, { maxHr: 190 })).toBeNull();
    expect(derivedText({ kind: "ftpPercent", zone: "threshold" }, null)).toBeNull();
  });
});

describe("checks", () => {
  it("asks for a warm-up and a cool-down, except in the gym", () => {
    const doc = newDoc("run", three());
    expect(docChecks(doc)).toEqual([{ ok: true, text: "Every step is ready for the watch" }]);
    expect(docChecks({ ...doc, items: doc.items.slice(1, 2) }).map((c) => c.text)).toEqual(["Add a warm-up before the hard work", "Add a cool-down at the end", "Every step is ready for the watch"]);
    expect(docChecks(lib("sample-lib-push"), true)).toEqual([{ ok: true, text: "Every step is ready for the watch" }]);
  });

  it("counts the blocks that need a value", () => {
    const doc = newDoc("run", three());
    const one = { ...doc, items: updateStep(doc.items, "b", { intensity: defaultIntensity("heartRate", doc) }) };
    expect(docChecks(one).at(-1)).toEqual({ ok: false, text: "1 block needs a value" });
    const two = { ...one, items: updateStep(one.items, "a", { meters: undefined }) };
    expect(docChecks(two).at(-1)).toEqual({ ok: false, text: "2 blocks need a value" });
    expect(docReady(two)).toBe(false);
    expect(pendingCount({ ...doc, items: [] })).toBe(1);
  });

  it("keeps the server's limits", () => {
    const doc = newDoc("run", three());
    expect(stepProblem(doc, step({ target: "time", seconds: 86_400 }))).toBe("Each time step needs a duration.");
    expect(stepProblem(doc, step({ kind: "rest", target: "hrRecovery", bpm: 29 }))).toBe("HR recovery goes from 30 to 180 bpm.");
    expect(stepProblem(doc, step({ target: "load", load: 1000 }))).toBe("Training load goes from 0 to 999.");
    expect(stepProblem({ ...doc, sport: "trailRun" }, step({ target: "elevationGain", meters: 19 }))).toBe("Elevation gain goes from 20 to 10,000 m.");
    expect(stepProblem({ ...doc, sport: "indoorClimb" }, step({ target: "routes", count: 21, intensity: { kind: "grade", grade: "5.9" } }))).toBe("Routes go from 1 to 20.");
    expect(stepProblem(doc, step({ intensity: { kind: "stroke", stroke: "freestyle" } }))).toBe("That target isn't available for this step.");
    expect(stepProblem(doc, step({ intensity: { kind: "effortPace", low: 280, high: 270 } }))).toBe("Paces go from 1:00 to 60:00 per km, fast to slow.");
    expect(stepProblem(doc, step({ intensity: { kind: "heartRatePercent", basis: "maxHr", zone: "custom" } }))).toBe("A custom range needs both ends, low then high.");
    expect(stepProblem(doc, step({ intensity: { kind: "thresholdPacePercent", zone: "threshold" } }))).toBeNull();
  });

  it("wants a COROS exercise for COROS and takes a typed name in this browser", () => {
    const doc = newDoc("strength", three());
    const typed = { ...(doc.items[0] as BuilderStep), name: "Bench press" };
    expect(stepProblem(doc, typed)).toBe("Pick an exercise for each strength step.");
    expect(stepProblem(doc, typed, true)).toBeNull();
    expect(stepProblem(doc, { ...typed, exercise: { id: "42", name: "Bench press" } })).toBeNull();
    expect(stepProblem(doc, { ...typed, sets: 100 }, true)).toBe("Sets go from 1 to 99.");
    expect(stepProblem(doc, { ...typed, restSeconds: 3601 }, true)).toBe("Rest between sets goes from 0 to 3600 seconds.");
    expect(stepProblem(doc, { ...typed, count: 501 }, true)).toBe("Reps go from 1 to 500.");
  });
});

describe("to and from COROS", () => {
  const coros: HubWorkout = {
    name: "5 × 1 km", sport: "trailRun", description: "Keep it smooth",
    blocks: [
      { repeats: null, steps: [{ id: "s1", kind: "warmup", target: "distance", meters: 2000, intensity: { kind: "kept" }, name: "Jog" }] },
      { id: "g2", repeats: 5, steps: [
        { id: "s2", kind: "training", target: "distance", meters: 1000, intensity: { kind: "pace", low: 270, high: 280 } },
        { id: "s3", kind: "rest", target: "hrRecovery", bpm: 120, intensity: { kind: "none" } },
      ] },
      { repeats: null, steps: [{ id: "s4", kind: "cooldown", target: "elevationGain", meters: 150, intensity: { kind: "heartRate", low: 120, high: 140 } }] },
    ],
  };

  it("round-trips a COROS workout with its ids", () => {
    const doc = docFromHub(coros, ids());
    expect(doc.items.map((i) => i.type)).toEqual(["step", "repeat", "step"]);
    expect(docUnwired(doc)).toEqual([]);
    expect(docToHub(doc)).toEqual(coros);
  });

  it("round-trips a gym workout", () => {
    const gym: HubWorkout = { name: "Legs", sport: "strength", description: "", blocks: [
      { repeats: null, steps: [{ id: "9", kind: "training", target: "reps", count: 8, intensity: { kind: "weight", low: 82.5 }, exercise: { id: "77", name: "Back Squat", code: "T1101" }, sets: 4, restSeconds: 120 }] },
      { repeats: null, steps: [{ id: "10", kind: "rest", target: "time", seconds: 90, intensity: { kind: "none" } }] },
    ] };
    const doc = docFromHub(gym, ids());
    expect(isCard(doc.items[0] as BuilderStep, "strength")).toBe(true);
    expect(docToHub(doc)).toEqual(gym);
    expect(hubWorkoutProblem(docToHub(doc))).toBeNull();
  });

  it("marks a HYROX station and keeps a pool's length", () => {
    const hyrox = docFromHub({ name: "H", sport: "hyrox", description: "", blocks: [
      { repeats: null, steps: [{ kind: "training", target: "distance", meters: 1000, intensity: { kind: "none" } }] },
      { repeats: null, steps: [{ kind: "training", target: "reps", count: 100, intensity: { kind: "weight", low: 6 }, exercise: { id: "8", name: "Wall Balls", kind: 8 }, sets: 1, restSeconds: 60 }] },
    ] }, ids());
    expect(hyrox.items.map((i) => i.type === "step" && Boolean(i.station))).toEqual([false, true]);
    expect(targetsFor("hyrox", hyrox.items[1] as BuilderStep)).toEqual(["reps", "time", "open"]);
    const swim = docFromHub({ name: "S", sport: "swim", description: "", poolLength: 50, blocks: [] }, ids());
    expect(swim.poolLength).toBe(50);
    expect(docToHub({ ...swim, name: "  " })).toMatchObject({ name: "Structured Workout", poolLength: 50 });
  });

  it("drops COROS's ids for a copy, and then can't carry a target only COROS knows", () => {
    const copy = docFromHub(coros, ids(), false);
    expect(docToHub({ ...copy, items: copy.items.slice(1) }).blocks[0]).not.toHaveProperty("id");
    expect(docUnwired(copy)).toEqual(["Targets only the COROS app can show"]);
  });

  it("says what COROS can't take from here yet", () => {
    const doc = newDoc("swim", three());
    const items = addItem(updateStep(doc.items, "b", { intensity: { kind: "stroke", stroke: "drills" } }), newStep("d", "sendOff", doc));
    expect(docUnwired({ ...doc, items })).toEqual(["Send-off steps"]);
    const run = newDoc("run", three());
    expect(docUnwired({ ...run, items: updateStep(run.items, "a", { intensity: defaultIntensity("heartRatePercent", run) }) })).toEqual(["% Heart Rate targets"]);
  });

  it("makes a quick run COROS takes", () => {
    const quick = docToHub(quickRunDoc(" ", 21.1, 330, "q"));
    expect(quick).toMatchObject({ name: "Quick Run", sport: "run", blocks: [{ repeats: null, steps: [{ kind: "training", target: "distance", meters: 21_100, intensity: { kind: "pace", low: 330, high: 330 } }] }] });
    expect(hubWorkoutProblem(quick)).toBeNull();
    expect(docToHub(quickRunDoc("Easy", 5, null, "q")).blocks[0].steps[0].intensity).toEqual({ kind: "none" });
  });
});

describe("edits", () => {
  it("changes a step's kind, keeping what still fits", () => {
    const doc = newDoc("run", three());
    const training = { ...(doc.items[1] as BuilderStep), intensity: { kind: "pace" as const, low: 270, high: 280 } };
    expect(withKind(doc, training, "rest")).toMatchObject({ kind: "rest", target: "distance", meters: 1000, intensity: { kind: "pace" } });
    const recovery = step({ kind: "rest", target: "hrRecovery", bpm: 120 });
    expect(withKind(doc, recovery, "training")).toMatchObject({ kind: "training", target: "distance", meters: 1000 });
    const gym = newDoc("strength", three());
    expect(withKind(gym, gym.items[0] as BuilderStep, "rest")).toEqual({ type: "step", id: "a", kind: "rest", target: "time", seconds: 60, intensity: { kind: "none" } });
    const hyrox = newDoc("hyrox", three());
    expect(withKind(hyrox, hyrox.items[1] as BuilderStep, "training", true)).toMatchObject({ station: true, sets: 1, target: "time" });
  });

  it("moves a workout to another sport", () => {
    const run = lib("sample-lib-cruise");
    const trail = fitToSport(run, "trailRun", ids());
    expect(trail.items).toEqual(run.items);
    const swim = fitToSport(run, "swim", ids());
    expect(swim.poolLength).toBe(25);
    expect(pendingCount(swim)).toBe(0);
    const gym = fitToSport(run, "strength", ids());
    expect(gym.items.every((i) => i.type === "step")).toBe(true);
    expect(gym.items.map((i) => i.type === "step" && i.kind)).toEqual(["warmup", "training", "rest", "cooldown"]);
    expect(fitToSport(run, "run", ids())).toBe(run);
  });

  it("starts the grades again in another system", () => {
    const doc = newDoc("indoorClimb", three());
    const french = withGradeSystem(doc, "french");
    expect(french.gradeSystem).toBe("french");
    expect(pendingCount(french)).toBe(0);
    expect((french.items[1] as BuilderStep).intensity.grade).not.toBe((doc.items[1] as BuilderStep).intensity.grade);
  });

  it("reorders with the shared edits", () => {
    const doc = lib("sample-lib-cruise");
    const moved = moveItem(doc.items, doc.items[0].id, 1);
    expect(moved[0].type).toBe("repeat");
    expect(moved[0].type === "repeat" && moved[0].steps.map((s) => s.kind)).toEqual(["warmup", "training", "rest"]);
  });
});

describe("totals and shape", () => {
  const run = pacingFor("run", sampleProfile.pacing);

  it("adds up the canvas run", () => {
    const doc = lib("sample-lib-cruise");
    const t = docTotals(doc, run);
    expect(t).toMatchObject({ meters: 9600, metersEstimated: false, secondsEstimated: true, steps: 4, repeats: 1 });
    expect(Math.round(t.seconds!)).toBe(2996);
    expect(docSummary(doc, run)).toBe("49:56 · 9.60 km");
    expect(repeatText(doc.items[1] as never, doc, run)).toBe("5.60 km");
    expect(docShape(doc, run)).toMatchObject({ basis: "time", ticks: ["0:00", "11:00", "38:56", "49:56"] });
  });

  it("doesn't guess a time without a pace to go by", () => {
    const doc = lib("sample-lib-cruise");
    expect(docTotals(doc, null).seconds).toBeNull();
    expect(docSummary(doc, null)).toBe("9.60 km");
    expect(docShape(doc, null).basis).toBe("distance");
    expect(docSummary(lib("sample-lib-long"), null)).toBe("2:06:00 · 24.00 km");
  });

  it("adds up the pool, the ride and the gym", () => {
    const swim = lib("sample-lib-hundreds");
    expect(docTotals(swim, null)).toMatchObject({ meters: 2400, restSeconds: 380, steps: 8, repeats: 3 });
    expect(docSummary(swim, null)).toBe("2,400 m");
    expect(docShape(swim, null)).toMatchObject({ basis: "distance", ticks: ["0 m", "400 m", "2,200 m", "2,400 m"] });
    expect(docSummary(lib("sample-lib-sweet"), null)).toBe("1:25:00");
    const gym = lib("sample-lib-push");
    expect(docTotals(gym, null)).toMatchObject({ exercises: 5, sets: 17, reps: 131 });
    expect(docSummary(gym, null)).toBe("5 exercises · 17 sets");
    expect(gym.items.map((i) => setsText(i as BuilderStep))).toEqual(["24 reps in total", "30 reps in total", "32 reps in total", "45 reps in total", "Each set ends when you press the lap button"]);
  });

  it("draws one width per step when nothing measures them all", () => {
    const doc = newDoc("bouldering", three());
    expect(docShape(doc, null)).toMatchObject({ basis: "steps", ticks: [] });
    expect(docShape(doc, null).paths.hard).not.toBe("");
    expect(docTotals(doc, null)).toMatchObject({ routes: 3, seconds: null });
  });
});

describe("workouts from the first builder", () => {
  it("opens the starter workout with its zones as heart rate ranges", () => {
    const doc = legacyDoc(starterWorkout, sampleProfile.zones, ids());
    expect(doc).toMatchObject({ name: "Cruise intervals, 4 × 1 km", sport: "run" });
    expect(doc.items[0]).toMatchObject({ kind: "warmup", target: "distance", meters: 2000, intensity: { kind: "heartRate", low: 124, high: 143 } });
    expect(doc.items[1]).toMatchObject({ type: "repeat", count: 4, steps: [{ kind: "training", intensity: { kind: "pace", low: 270, high: 280 } }, { kind: "rest", target: "distance", meters: 400 }] });
    expect(pendingCount(doc)).toBe(0);
    expect(docSummary(doc, pacingFor("run", sampleProfile.pacing))).toBe("49:56 · 9.60 km");
  });

  it("opens a gym hour and a swim", () => {
    const gym = legacyDoc({ name: "Strength, lower", sport: "strength", items: [{ type: "step", id: "x", kind: "work", length: { type: "time", seconds: 2700 }, target: { type: "none" }, label: "Back squat · 4 × 6" }] }, [], ids());
    expect(gym.items[0]).toMatchObject({ kind: "training", target: "time", seconds: 2700, sets: 1, name: "Back squat · 4 × 6" });
    expect(pendingCount(gym, true)).toBe(0);
    const swim = legacyDoc({ name: "Pool swim", sport: "swim", items: [{ type: "step", id: "x", kind: "work", length: { type: "distance", metres: 1500, unit: "m" }, target: { type: "hr", zone: 2 } }] }, sampleProfile.zones, ids());
    expect(swim).toMatchObject({ sport: "swim", poolLength: 25, items: [{ meters: 1500, intensity: { kind: "none" } }] });
  });

  it("goes back to the first builder's steps only when they can hold it", () => {
    const items = docToLegacy(lib("sample-lib-cruise"))!;
    expect(items[0]).toMatchObject({ kind: "warmup", length: { type: "distance", metres: 2000, unit: "km" }, target: { type: "none" } });
    expect(items[1]).toMatchObject({ type: "repeat", count: 4, steps: [{ kind: "work", target: { type: "pace", fast: 270, slow: 280 } }, { kind: "recovery" }] });
    expect(docToLegacy(lib("sample-lib-sweet"))![1]).toMatchObject({ steps: [{ target: { type: "kept", label: "Power 230–245 W" } }, { kind: "rest" }] });
    expect(docToLegacy(lib("sample-lib-push"))).toBeNull();
    expect(docToLegacy(newDoc("bouldering", three()))).toBeNull();
    expect(calendarSport("trailRun")).toBe("run");
    expect(calendarSport("hyrox")).toBe("strength");
  });
});

describe("text boxes", () => {
  afterEach(() => useUnitsNow("metric"));
  it("reads and writes a pace range", () => {
    expect(formatPaceRange(270, 280)).toBe("4:30-4:40/km");
    expect(parsePaceRange("4:30-4:40/km")).toEqual({ low: 270, high: 280 });
    expect(parsePaceRange("4:30 – 4:40")).toEqual({ low: 270, high: 280 });
    expect(parsePaceRange("5:30")).toEqual({ low: 330, high: 330 });
    expect(parsePaceRange("4:40-4:30")).toBeNull();
    expect(parsePaceRange("0:30-4:30")).toBeNull();
    expect(parsePaceRange("5")).toBeNull();
    expect(parsePaceRange("")).toBeNull();
  });

  it("reads and writes a pace range per mile, and totals in miles and yards, in imperial", () => {
    useUnitsNow("imperial");
    expect(formatPaceRange(270, 280)).toBe("7:15-7:31/mi");
    const r = parsePaceRange("8:00-8:30/mi")!;
    expect(formatPaceRange(r.low, r.high)).toBe("8:00-8:30/mi");
    expect(r.low).toBeCloseTo(480 / 1.609344, 6);
    expect(parsePaceRange("0:30/mi")).toBeNull();
    // A typed "/km" means per km whatever the page's units.
    expect(parsePaceRange("4:30-4:40/km")).toEqual({ low: 270, high: 280 });
    // A 25 yd pool for a new swim.
    expect(newDoc("swim", three()).poolLength).toBe(22.86);
    expect(docSummary(lib("sample-lib-long"), null)).toBe("2:06:00 · 14.91 mi");
    expect(setsText(step({ target: "distance", meters: 250, sets: 4 }))).toBe("1,000 m in total");
  });

  it("reads numbers inside their limits", () => {
    expect(parseNumber("21,1", 0.1, 1000)).toBe(21.1);
    expect(parseNumber("47.3", 0, 2000, 0.5)).toBe(47.5);
    expect(parseNumber("100", 1, 99)).toBeNull();
    expect(parseNumber("-1", 0, 10)).toBeNull();
    expect(parseNumber("abc", 0, 10)).toBeNull();
  });
});

describe("a long description", () => {
  it("blocks saving with a check line instead of being cut on the way to COROS", () => {
    const doc = { ...newDoc("run", ["a", "b", "c"]), description: "x".repeat(DESCRIPTION_MAX + 1) };
    expect(docChecks(doc).some((c) => !c.ok && c.text.includes("Shorten the description"))).toBe(true);
    expect(docReady(doc)).toBe(false);
    expect(docReady({ ...doc, description: "x".repeat(DESCRIPTION_MAX) })).toBe(docReady({ ...doc, description: "" }));
  });
});
