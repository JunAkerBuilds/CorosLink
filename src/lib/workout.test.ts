import { describe as suite, expect, it } from "vitest";
import { useUnitsNow } from "./units";
import {
  addItem, canMove, defaultTarget, describe, expand, findItem, formatClock,
  locate, moveItem, moveNear, moveTo, newRepeat, newStep, paceIntensity, parseClock, removeItem,
  segments, setRepeatCount, shapePaths, stepIntensity, stepMetres, stepPace, stepSeconds, totals, updateStep,
  type Pacing, type RepeatBlock, type StepKind, type StepLength, type StepTarget, type WorkoutItem, type WorkoutStep,
} from "./workout";

const pacing: Pacing = { zonePace: [370, 330, 305, 288, 275], easyPace: 360 };

const step = (id: string, kind: StepKind, length: StepLength, target: StepTarget = { type: "none" }): WorkoutStep =>
  ({ type: "step", id, kind, length, target });
const km = (n: number): StepLength => ({ type: "distance", metres: n * 1000, unit: "km" });
const m = (n: number): StepLength => ({ type: "distance", metres: n, unit: "m" });
const secs = (n: number): StepLength => ({ type: "time", seconds: n });

/** The workout on the canvas: 2 km warm up, 4 × (1 km at 4:30 to 4:40 + 400 m jog), 2 km cool down. */
const cruise = (): WorkoutItem[] => [
  step("wu", "warmup", km(2), { type: "hr", zone: 2 }),
  { type: "repeat", id: "rep", count: 4, steps: [step("run", "work", km(1), { type: "pace", fast: 270, slow: 280 }), step("rec", "recovery", m(400))] },
  step("cd", "cooldown", km(2), { type: "hr", zone: 2 }),
];
const ids = (items: readonly WorkoutItem[]) => items.map((i) => (i.type === "repeat" ? `${i.id}[${i.steps.map((s) => s.id).join(",")}]` : i.id)).join(" ");

suite("estimates", () => {
  it("takes the middle of a pace range", () => {
    expect(stepPace(step("a", "work", km(1), { type: "pace", fast: 270, slow: 280 }), pacing)).toBe(275);
  });
  it("uses the zone's usual pace for a heart rate target", () => {
    expect(stepPace(step("a", "warmup", km(2), { type: "hr", zone: 2 }), pacing)).toBe(330);
    expect(stepPace(step("a", "warmup", km(2), { type: "hr", zone: 9 }), pacing)).toBe(275);
    expect(stepPace(step("a", "warmup", km(2), { type: "hr", zone: 0 }), pacing)).toBe(370);
  });
  it("falls back by kind without a target", () => {
    expect(stepPace(step("a", "recovery", m(400)), pacing)).toBe(360);
    expect(stepPace(step("a", "work", km(1)), pacing)).toBe(305);
    expect(stepPace(step("a", "warmup", km(1)), pacing)).toBe(330);
    expect(stepPace(step("a", "rest", secs(60)), pacing)).toBeNull();
  });
  it("estimates time from distance", () => {
    expect(stepSeconds(step("a", "warmup", km(2), { type: "hr", zone: 2 }), pacing)).toBe(660);
    expect(stepSeconds(step("a", "work", km(1), { type: "pace", fast: 270, slow: 280 }), pacing)).toBe(275);
    expect(stepSeconds(step("a", "recovery", m(400)), pacing)).toBe(144);
    expect(stepSeconds(step("a", "rest", m(100)), pacing)).toBe(36);
  });
  it("estimates distance from time", () => {
    expect(stepMetres(step("a", "work", secs(275), { type: "pace", fast: 270, slow: 280 }), pacing)).toBeCloseTo(1000);
    expect(stepMetres(step("a", "warmup", secs(660), { type: "hr", zone: 2 }), pacing)).toBeCloseTo(2000);
    expect(stepMetres(step("a", "rest", secs(90)), pacing)).toBe(0);
    expect(stepSeconds(step("a", "rest", secs(90)), pacing)).toBe(90);
  });
  it("reads intensity from the zone or the pace", () => {
    expect(stepIntensity(step("a", "warmup", km(2), { type: "hr", zone: 2 }), pacing)).toBe(0.42);
    expect(stepIntensity(step("a", "work", km(1), { type: "pace", fast: 270, slow: 280 }), pacing)).toBeCloseTo(0.92);
    expect(stepIntensity(step("a", "recovery", m(400)), pacing)).toBe(0.28);
    expect(stepIntensity(step("a", "rest", secs(60)), pacing)).toBe(0.15);
  });
  it("keeps pace intensity monotonic and inside 0.2 to 1", () => {
    expect(paceIntensity(330, pacing)).toBeCloseTo(0.42);
    expect(paceIntensity(1000, pacing)).toBe(0.2);
    expect(paceIntensity(100, pacing)).toBe(1);
    let last = 0;
    for (let p = 600; p >= 200; p -= 5) {
      const v = paceIntensity(p, pacing);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(1);
      last = v;
    }
    expect(paceIntensity(0, pacing)).toBe(0.7);
  });
});

suite("totals", () => {
  it("writes repeat blocks out", () => {
    expect(expand(cruise()).map((s) => s.id)).toEqual(["wu", "run", "rec", "run", "rec", "run", "rec", "run", "rec", "cd"]);
    expect(expand([{ type: "repeat", id: "r", count: 0, steps: [step("a", "work", km(1))] }])).toEqual([]);
    expect(expand([])).toEqual([]);
  });
  it("matches the canvas workout: 9.60 km, 49:56, load 104", () => {
    const t = totals(cruise(), pacing);
    expect(t.metres).toBe(9600);
    expect(t.seconds).toBe(2996);
    expect(t.load).toBe(104);
    expect(describe(cruise(), pacing)).toBe("9.60 km · 49:56");
  });
  it("prints the line in miles in imperial", () => {
    useUnitsNow("imperial");
    try { expect(describe(cruise(), pacing)).toBe("5.97 mi · 49:56"); } finally { useUnitsNow("metric"); }
  });
  it("follows the repeat count", () => {
    const six = setRepeatCount(cruise(), "rep", 6);
    expect(totals(six, pacing).metres).toBe(4000 + 6 * 1400);
    expect(totals(six, pacing).seconds).toBe(1320 + 6 * 419);
  });
  it("is zero for an empty workout and prints time alone when nothing is covered", () => {
    expect(totals([], pacing)).toEqual({ seconds: 0, metres: 0, load: 0 });
    expect(describe([step("a", "rest", secs(2700))], pacing)).toBe("45:00");
  });
  it("covers no ground in a sport done on the spot, and loads it lightly", () => {
    const gym: Pacing = { ...pacing, still: true };
    const session = [step("a", "work", secs(2700)), step("b", "rest", secs(120))];
    expect(totals(session, gym).metres).toBe(0);
    expect(totals(session, gym).seconds).toBe(2820);
    expect(totals([session[0]], gym).load).toBe(42);
    expect(describe(session, gym)).toBe("47:00");
    expect(stepMetres(step("c", "work", m(200)), gym)).toBe(200);
    expect(stepIntensity(step("d", "work", secs(60), { type: "hr", zone: 4 }), gym)).toBe(0.78);
  });
  it("mixes time and distance steps", () => {
    const t = totals([step("a", "work", secs(600), { type: "pace", fast: 300, slow: 300 }), step("b", "rest", secs(60))], pacing);
    expect(t.seconds).toBe(660);
    expect(t.metres).toBeCloseTo(2000);
  });
});

suite("shape", () => {
  it("draws the canvas paths", () => {
    // The canvas maths, verbatim.
    const segs: [string, number, number][] = [["easy", 660, 0.42]];
    for (let k = 0; k < 4; k++) { segs.push(["hard", 275, 0.92]); segs.push(["rest", 144, 0.28]); }
    segs.push(["easy", 660, 0.42]);
    const out: Record<string, string> = { easy: "", hard: "", rest: "" };
    let x = 0;
    segs.forEach((s) => {
      const w = (s[1] / 2996) * 500, h = s[2] * 120;
      out[s[0]] += "M" + x.toFixed(1) + " " + (120 - h).toFixed(1) + "h" + (w - 2).toFixed(1) + "v" + h.toFixed(1) + "h-" + (w - 2).toFixed(1) + "z";
      x += w;
    });
    expect(shapePaths(segments(cruise(), pacing))).toEqual(out);
  });
  it("gives one segment per step done, skipping empty ones", () => {
    expect(segments(cruise(), pacing)).toHaveLength(10);
    expect(segments([step("a", "rest", secs(0))], pacing)).toEqual([]);
  });
  it("draws nothing for an empty workout and never a negative width", () => {
    expect(shapePaths([])).toEqual({ easy: "", hard: "", rest: "" });
    const thin = shapePaths([{ bucket: "hard", seconds: 1, intensity: 2 }, { bucket: "easy", seconds: 9999, intensity: 0.4 }]);
    expect(thin.hard).toBe("M0.0 0.0h0.5v120.0h-0.5z");
  });
});

suite("edits", () => {
  it("finds where things are", () => {
    expect(locate(cruise(), "rep")).toEqual({ blockId: null, index: 1 });
    expect(locate(cruise(), "rec")).toEqual({ blockId: "rep", index: 1 });
    expect(locate(cruise(), "nope")).toBeNull();
    expect(findItem(cruise(), "rec")?.id).toBe("rec");
    expect(findItem(cruise(), "nope")).toBeNull();
  });
  it("adds at the end, or inside a block", () => {
    const s = step("new", "rest", secs(60));
    expect(ids(addItem(cruise(), s))).toBe("wu rep[run,rec] cd new");
    expect(ids(addItem(cruise(), s, "rep"))).toBe("wu rep[run,rec,new] cd");
    expect(ids(addItem(cruise(), s, "missing"))).toBe("wu rep[run,rec] cd new");
  });
  it("never nests blocks", () => {
    const block = newRepeat(["b", "b1", "b2"], "run", pacing);
    expect(ids(addItem(cruise(), block, "rep"))).toBe("wu rep[run,rec] cd b[b1,b2]");
    expect(ids(moveTo(addItem(cruise(), block), "b", "rep", 0))).toBe("wu rep[run,rec] cd b[b1,b2]");
  });
  it("removes a step anywhere, or a whole block", () => {
    expect(ids(removeItem(cruise(), "wu"))).toBe("rep[run,rec] cd");
    expect(ids(removeItem(cruise(), "rec"))).toBe("wu rep[run] cd");
    expect(ids(removeItem(cruise(), "rep"))).toBe("wu cd");
    expect(ids(removeItem(cruise(), "nope"))).toBe("wu rep[run,rec] cd");
  });
  it("does not change the list it was given", () => {
    const before = cruise();
    const copy = JSON.stringify(before);
    removeItem(before, "rec"); moveItem(before, "wu", 1); addItem(before, step("n", "rest", secs(1)), "rep");
    setRepeatCount(before, "rep", 9); updateStep(before, "rec", { kind: "rest" }); moveNear(before, "cd", "run", false);
    expect(JSON.stringify(before)).toBe(copy);
  });
  it("updates a step in place", () => {
    const next = updateStep(cruise(), "rec", { length: secs(90), kind: "rest" });
    expect(findItem(next, "rec")).toMatchObject({ id: "rec", kind: "rest", length: { type: "time", seconds: 90 } });
    expect(findItem(updateStep(cruise(), "wu", { target: { type: "none" } }), "wu")).toMatchObject({ target: { type: "none" } });
  });
  it("keeps the repeat count between 1 and 99, whole", () => {
    const count = (n: number) => (setRepeatCount(cruise(), "rep", n)[1] as RepeatBlock).count;
    expect(count(6)).toBe(6);
    expect(count(0)).toBe(1);
    expect(count(-3)).toBe(1);
    expect(count(2.6)).toBe(3);
    expect(count(500)).toBe(99);
    expect(count(NaN)).toBe(1);
  });

  it("moves a step up and down inside a block", () => {
    expect(ids(moveItem(cruise(), "rec", -1))).toBe("wu rep[rec,run] cd");
    expect(ids(moveItem(cruise(), "run", 1))).toBe("wu rep[rec,run] cd");
  });
  it("steps out of a block at its edges", () => {
    expect(ids(moveItem(cruise(), "run", -1))).toBe("wu run rep[rec] cd");
    expect(ids(moveItem(cruise(), "rec", 1))).toBe("wu rep[run] rec cd");
  });
  it("steps into a neighbouring block", () => {
    expect(ids(moveItem(cruise(), "wu", 1))).toBe("rep[wu,run,rec] cd");
    expect(ids(moveItem(cruise(), "cd", -1))).toBe("wu rep[run,rec,cd]");
  });
  it("swaps plain neighbours and moves blocks whole", () => {
    const block = cruise()[1] as RepeatBlock;
    const flat = [cruise()[0], ...block.steps, cruise()[2]];
    expect(ids(moveItem(flat, "run", -1))).toBe("run wu rec cd");
    expect(ids(moveItem(flat, "run", 1))).toBe("wu rec run cd");
    expect(ids(moveItem(cruise(), "rep", -1))).toBe("rep[run,rec] wu cd");
    expect(ids(moveItem(cruise(), "rep", 1))).toBe("wu cd rep[run,rec]");
  });
  it("stops at the ends", () => {
    expect(ids(moveItem(cruise(), "wu", -1))).toBe("wu rep[run,rec] cd");
    expect(ids(moveItem(cruise(), "cd", 1))).toBe("wu rep[run,rec] cd");
    expect(ids(moveItem(cruise(), "nope", 1))).toBe("wu rep[run,rec] cd");
    expect(canMove(cruise(), "wu", -1)).toBe(false);
    expect(canMove(cruise(), "wu", 1)).toBe(true);
    expect(canMove(cruise(), "cd", 1)).toBe(false);
    expect(canMove(cruise(), "run", -1)).toBe(true);
    expect(canMove(cruise(), "nope", 1)).toBe(false);
  });
  it("round-trips: down then up restores the order", () => {
    for (const id of ["wu", "run", "rec", "rep"]) {
      expect(ids(moveItem(moveItem(cruise(), id, 1), id, -1))).toBe("wu rep[run,rec] cd");
    }
  });

  it("drops a step at an index, counting positions before the move", () => {
    expect(ids(moveTo(cruise(), "wu", null, 3))).toBe("rep[run,rec] cd wu");
    expect(ids(moveTo(cruise(), "cd", null, 0))).toBe("cd wu rep[run,rec]");
    expect(ids(moveTo(cruise(), "wu", null, 1))).toBe("wu rep[run,rec] cd");
    expect(ids(moveTo(cruise(), "cd", "rep", 1))).toBe("wu rep[run,cd,rec]");
    expect(ids(moveTo(cruise(), "run", "rep", 2))).toBe("wu rep[rec,run] cd");
    expect(ids(moveTo(cruise(), "run", null, 99))).toBe("wu rep[rec] cd run");
    expect(ids(moveTo(cruise(), "rep", "rep", 0))).toBe("wu rep[run,rec] cd");
    expect(ids(moveTo(cruise(), "wu", "missing", 0))).toBe("wu rep[run,rec] cd");
  });
  it("drops beside a target", () => {
    expect(ids(moveNear(cruise(), "cd", "run", false))).toBe("wu rep[cd,run,rec]");
    expect(ids(moveNear(cruise(), "cd", "rec", true))).toBe("wu rep[run,rec,cd]");
    expect(ids(moveNear(cruise(), "run", "wu", false))).toBe("run wu rep[rec] cd");
    expect(ids(moveNear(cruise(), "wu", "cd", true))).toBe("rep[run,rec] cd wu");
    expect(ids(moveNear(cruise(), "wu", "wu", true))).toBe("wu rep[run,rec] cd");
    expect(ids(moveNear(cruise(), "rep", "run", true))).toBe("wu rep[run,rec] cd");
  });
  it("lands a dragged block beside the block its target is in", () => {
    const two = addItem(cruise(), newRepeat(["b", "b1", "b2"], "run", pacing));
    expect(ids(moveNear(two, "b", "run", false))).toBe("wu b[b1,b2] rep[run,rec] cd");
    expect(ids(moveNear(two, "b", "rec", true))).toBe("wu rep[run,rec] b[b1,b2] cd");
  });
});

suite("units and text", () => {
  it("formats clocks", () => {
    expect(formatClock(2996)).toBe("49:56");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(59.6)).toBe("1:00");
    expect(formatClock(-5)).toBe("0:00");
  });
  it("parses clocks and bare minutes", () => {
    expect(parseClock("4:30")).toBe(270);
    expect(parseClock(" 1:02:03 ")).toBe(3723);
    expect(parseClock("5")).toBe(300);
    expect(parseClock("1.5")).toBe(90);
    expect(parseClock("1,5")).toBe(90);
    expect(parseClock("0:45")).toBe(45);
  });
  it("rejects what is not a time", () => {
    for (const bad of ["", "abc", "4:75", "1:2:3:4", "-3", "4:", ":30", "4:3x"]) expect(parseClock(bad)).toBeNull();
  });
});

suite("new steps", () => {
  it("makes the canvas's steps by default", () => {
    expect(newStep("a", "work", "run", pacing)).toMatchObject({ length: km(1), target: { type: "pace", fast: 270, slow: 280 } });
    expect(newStep("a", "recovery", "run", pacing)).toMatchObject({ length: m(400), target: { type: "none" } });
    expect(newStep("a", "rest", "run", pacing)).toMatchObject({ length: secs(60) });
    expect(newStep("a", "warmup", "run", pacing)).toMatchObject({ length: km(2), target: { type: "hr", zone: 2 } });
    expect(newStep("a", "work", "strength", pacing)).toMatchObject({ length: secs(300), target: { type: "none" } });
    const block = newRepeat(["b", "b1", "b2"], "run", pacing);
    expect(block.count).toBe(4);
    expect(block.steps.map((s) => s.kind)).toEqual(["work", "recovery"]);
    expect(formatClock(totals([block], pacing).seconds)).toBe("27:56");
  });
  it("picks a target when the target type changes", () => {
    const run = step("a", "work", km(1));
    expect(defaultTarget("none", run, pacing)).toEqual({ type: "none" });
    expect(defaultTarget("hr", run, pacing)).toEqual({ type: "hr", zone: 4 });
    expect(defaultTarget("hr", step("w", "warmup", km(1)), pacing)).toEqual({ type: "hr", zone: 2 });
    expect(defaultTarget("pace", run, pacing)).toEqual({ type: "pace", fast: 300, slow: 310 });
  });
});
