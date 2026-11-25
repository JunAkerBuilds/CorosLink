import { describe, expect, it } from "vitest";
import { createTrainingPlan, planEntryFromWorkout, type PlanEnv } from "./plan";
import { cleanPlanName, inferPhaseKinds, inferPhases, requestFromPlan, revisionPrompt } from "./planGenerate";

let n = 0;
const env: PlanEnv = { newId: (prefix) => `${prefix}:${++n}`, now: () => "2026-11-25T00:00:00.000Z" } as PlanEnv;

describe("the plan's name", () => {
  it("drops the chunk Coach put in its first card title", () => {
    expect(cleanPlanName("10K base build – weeks 1–4")).toBe("10K base build");
    expect(cleanPlanName("Marathon plan (part 1 of 3)")).toBe("Marathon plan");
    expect(cleanPlanName("Half marathon: Weeks 1-6")).toBe("Half marathon");
    expect(cleanPlanName("Spring 10K block")).toBe("Spring 10K block");
    expect(cleanPlanName("Weeks 1–4")).toBe("Weeks 1–4");
  });
});

describe("phases from the weekly load", () => {
  it("marks an easier week as Recovery, the heavy back half as Peak and a lighter last week as Taper", () => {
    expect(inferPhaseKinds([384, 395, 428, 288, 426, 450, 479, 380])).toEqual(["base", "base", "build", "recovery", "build", "peak", "peak", "taper"]);
  });
  it("gives a short plan no phases and a flat one base then build", () => {
    expect(inferPhaseKinds([100, 100])).toEqual([]);
    expect(inferPhaseKinds([100, 110, 120])).toEqual(["base", "base", "base"]);
  });
  it("joins weeks of one kind into one phase", () => {
    const plan = createTrainingPlan("p", "coach", env);
    plan.weekCount = 8;
    [384, 395, 428, 288, 426, 450, 479, 380].forEach((load, week) => {
      plan.entries.push({ ...planEntryFromWorkout({ key: `k${week}`, name: "Run", sport: "run" }, week, 2, undefined, env), plannedTrainingLoad: load });
    });
    expect(inferPhases(plan, env).map((p) => [p.kind, p.startWeek, p.endWeek])).toEqual([
      ["base", 1, 2], ["build", 3, 3], ["recovery", 4, 4], ["build", 5, 5], ["peak", 6, 7], ["taper", 8, 8],
    ]);
  });
});

describe("asking Coach to change a plan", () => {
  it("lists the plan week by week with the ask, and keeps the plan's own settings as the request", () => {
    const plan = createTrainingPlan("10K base build", "coach", env);
    plan.startDate = "2026-11-25";
    plan.weekCount = 2;
    plan.goal = "10k end of may";
    plan.sportMix = ["run"];
    plan.entries.push({ ...planEntryFromWorkout({ key: "a", name: "Long run", sport: "run" }, 0, 3, undefined, env), plannedTrainingLoad: 141 });
    const text = revisionPrompt(plan, "Long runs on Sunday");
    expect(text).toContain("Week 1:\n  2026-11-28 Long run (run, load 141)");
    expect(text).toContain("Week 2:\n  (empty)");
    expect(text).toContain("My ask: Long runs on Sunday");
    expect(text).toContain("“10K base build”");
    expect(requestFromPlan(plan)).toMatchObject({ goal: "10k end of may", weeks: 2, sessionsPerWeek: 1, startDate: "2026-11-25", sports: ["run"] });
  });
});
