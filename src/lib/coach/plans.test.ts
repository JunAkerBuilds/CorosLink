import { describe, expect, it } from "vitest";
import type { PlanDraftCard, PlanEditCard } from "@/data/coach";
import { seedItems } from "@/data/sampleSeed";
import { createTrainingPlan, planEntryFromWorkout, type PlanEnv, type TrainingPlanDocument } from "@/lib/plan";
import { applyPlanEdit, planFromDraft } from "@/lib/planEdit";
import { athleteItems, type Clock } from "./items";
import { blockNote } from "./prompt";
import { listPlansText, parsePlans, planBrief, readPlanText } from "./plans";
import { planEntries } from "./read";
import { runTool, type ToolContext } from "./tools";

const NOW = new Date(2026, 10, 25, 10, 0);
const clock: Clock = { nowMs: NOW.getTime(), offsetMin: NOW.getTimezoneOffset() };
const items = athleteItems(seedItems(NOW));
let n = 0;
const env: PlanEnv = { newId: (p) => `${p}-${++n}`, now: () => "2026-11-25T10:00:00.000Z" };
const nextId = () => `x${++n}`;
const EASY = (minutes: number) => ({ name: `Easy run ${minutes} min`, sport: "run", blocks: [{ steps: [{ kind: "training", target: "time", seconds: minutes * 60, intensity: { kind: "heartRate", low: 130, high: 150 } }] }] });

/** A 3-week plan starting Wednesday 25 Nov: Fri easy, Sat long run, each week. */
function plan(): TrainingPlanDocument {
  const p = createTrainingPlan("10K base build", "coach", env);
  p.startDate = "2026-11-25"; p.weekCount = 3; p.goal = "10k end of may"; p.sportMix = ["run"];
  for (let w = 0; w < 3; w++) {
    p.entries.push({ ...planEntryFromWorkout({ key: `e${w}`, name: "Easy + strides", sport: "run" }, w, 2, undefined, env), plannedTrainingLoad: 60 });
    p.entries.push({ ...planEntryFromWorkout({ key: `l${w}`, name: `Long run ${90 + w * 5} min`, sport: "run" }, w, 3, undefined, env), plannedTrainingLoad: 140 });
  }
  return p;
}
const ctx = (plans: TrainingPlanDocument[], open?: string): ToolContext => ({
  items, clock, entries: planEntries(items, null, []), hubNote: "Training Hub isn't connected.", hub: null, browser: [], newId: () => `ID-${++n}`, asked: false,
  plans: parsePlans(JSON.parse(JSON.stringify(plans.map((p) => planBrief(p, p.id === open))))),
});

describe("Coach reads the saved plans", () => {
  it("lists them, marks the open one, and reads one week by week with entry ids", () => {
    const p = plan(), c = ctx([p], p.id);
    expect(listPlansText(c.plans!)).toContain("(OPEN in the plan editor now)");
    const text = readPlanText(c.plans![0]);
    expect(text).toContain("week 1 starts 2026-11-25 (a Wed)");
    expect(text).toContain(`2026-11-28 Sat · Long run 90 min (run, load 140) · entry ${p.entries[1].id}`);
    expect(text).toContain("Week 3 (load 200):");
  });
});

describe("propose_plan_edit", () => {
  it("moves the long runs to Sunday, adds a recovery week, and the app applies exactly that", async () => {
    const p = plan(), c = ctx([p], p.id);
    const longs = p.entries.filter((e) => e.title!.startsWith("Long"));
    const r = await runTool("propose_plan_edit", {
      title: "Long runs on Sunday",
      changes: [
        ...longs.map((e, i) => ({ action: "move", entry: e.id, week: i + 1, weekday: "Sun" })),
        { action: "add_week", recovery: true },
        { action: "add", week: 4, weekday: "Sat", workout: EASY(40) },
        { action: "set_phases", phases: [{ kind: "base", start_week: 1, end_week: 3 }, { kind: "recovery", start_week: 4, end_week: 4 }] },
      ],
    }, c);
    expect(r.isError).toBeFalsy();
    const card = (r as { block: PlanEditCard }).block;
    expect(card.kind).toBe("planEdit");
    expect(card.rows[0].label).toBe("W1 · Sat → Sun");
    expect(card.rows.map((x) => x.label)).toContain("New week 4");
    expect(card.load.weeks).toBe(4);
    expect(card.load.after).toBeGreaterThan(card.load.before);

    const next = applyPlanEdit(p, card.ops, nextId, env);
    expect(next.weekCount).toBe(4);
    for (const e of next.entries.filter((x) => x.title!.startsWith("Long"))) expect(e.dayIndex).toBe(4); // Sun is the 5th day from a Wednesday
    const added = next.entries.find((e) => e.weekIndex === 3 && e.title === "Easy run 40 min");
    expect(added?.dayIndex).toBe(3);
    expect(added?.workout?.doc?.sport).toBe("run");
    expect(next.phases.map((ph) => [ph.kind, ph.startWeek, ph.endWeek])).toEqual([["base", 1, 3], ["recovery", 4, 4]]);
    expect(next.entries.filter((e) => e.title === "Easy + strides")).toHaveLength(3);
  });

  it("puts a new week where it was asked, a copy when asked, and removes weeks", () => {
    const p = plan(), c = ctx([p]);
    return runTool("propose_plan_edit", { plan: p.id, changes: [{ action: "add_week", after_week: 1, copy_week: 1 }, { action: "remove_week", week: 4 }] }, c).then((r) => {
      const card = (r as { block: PlanEditCard }).block;
      const next = applyPlanEdit(p, card.ops, nextId, env);
      expect(next.weekCount).toBe(3);
      expect(next.entries.filter((e) => e.weekIndex === 1).map((e) => e.title).sort()).toEqual(["Easy + strides", "Long run 90 min"]);
      expect(next.entries.filter((e) => e.weekIndex === 2).map((e) => e.title).sort()).toEqual(["Easy + strides", "Long run 95 min"]);
    });
  });

  it("refuses what doesn't fit the plan, in words Coach can fix", async () => {
    const p = plan(), c = ctx([p], p.id);
    expect(await runTool("propose_plan_edit", { changes: [{ action: "move", entry: "nope", week: 1, weekday: "Sun" }] }, c)).toMatchObject({ isError: true });
    expect(await runTool("propose_plan_edit", { changes: [{ action: "add", week: 5, weekday: "Mon", workout: EASY(30) }] }, c)).toMatchObject({ isError: true, text: expect.stringContaining("Add a week first") });
    expect(await runTool("propose_plan_edit", { plan: "missing", changes: [{ action: "rename", name: "x" }] }, c)).toMatchObject({ isError: true });
  });

  it("tells the athlete a plan changed after Coach read it", () => {
    const p = plan();
    expect(() => applyPlanEdit(p, [{ op: "remove", entry: "entry-gone" }], nextId, env)).toThrow(/changed after Coach read it/);
  });
});

describe("build_plan", () => {
  it("joins chunks of one plan into one card and the card becomes a saved plan with phases", async () => {
    const c = ctx([]);
    const chunk = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i).flatMap((w) => [
      { day: w * 7 + 1, workout: EASY(30 + w) }, { day: w * 7 + 4, workout: EASY(60 + w * 3) },
    ]);
    const a = await runTool("build_plan", { name: "10K by 30 May", overview: "Easy first.", start_date: "2026-11-26", weeks: 8, workouts: chunk(0, 3) }, c);
    const b = await runTool("build_plan", { name: "10K by 30 May", start_date: "2026-11-26", weeks: 8, workouts: chunk(4, 7) }, c);
    expect(a.isError).toBeFalsy();
    const first = (a as { block: PlanDraftCard }).block, card = (b as { block: PlanDraftCard }).block;
    expect(card.id).toBe(first.id);
    expect(card.draft.workouts).toHaveLength(16);
    expect(card.draft.weeks).toBe(8);
    expect(a.text).toContain("4 of 8 weeks");
    expect(b.text).toContain("Every week has workouts");

    const saved = planFromDraft(card.draft, nextId, env);
    expect(saved.name).toBe("10K by 30 May");
    expect(saved.weekCount).toBe(8);
    expect(saved.entries).toHaveLength(16);
    expect(saved.phases.length).toBeGreaterThan(0);
    expect(blockNote(card)).toContain("Built a new plan “10K by 30 May”: 8 weeks, 16 workouts");
  });

  it("keeps each chunk to 28 workouts", async () => {
    const many = Array.from({ length: 29 }, (_, i) => ({ day: i + 1, workout: EASY(30) }));
    expect(await runTool("build_plan", { name: "x", start_date: "2026-11-26", weeks: 6, workouts: many }, ctx([]))).toMatchObject({ isError: true });
  });
});
