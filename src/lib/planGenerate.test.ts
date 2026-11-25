import { describe, expect, it } from "vitest";
import type { CoachBlock } from "@/data/coach";
import { seedItems } from "@/data/sampleSeed";
import { mockModel } from "@/server/coach/mockModel";
import { athleteItems, type Clock } from "./coach/items";
import { runCoach } from "./coach/loop";
import { contextText, historyTurns, RULES } from "./coach/prompt";
import { planEntries } from "./coach/read";
import type { ToolContext } from "./coach/tools";
import { entryDay, validateTrainingPlan, type PlanEnv } from "./plan";
import {
  generatedPlanFromBlocks, generationPrompt, maxSessions, newPlanRequest, parseSessionLimit, planSnapshot, requestProblem, trainingPlanFromGenerated,
  type GeneratedPlan, type PlanGenerationRequest,
} from "./planGenerate";

const TODAY = "2026-11-20";
const env = (): PlanEnv => { let n = 0; return { newId: (p) => `${p}:${++n}`, now: () => "2026-11-20T08:00:00.000Z" }; };
const ids = () => { let n = 0; return () => `s${++n}`; };
const request = (over: Partial<PlanGenerationRequest> = {}): PlanGenerationRequest => ({ ...newPlanRequest(TODAY, { goal: "Run a faster 5K", weeks: 2, sessionsPerWeek: 2 }), ...over });
const run = (day: string, name = "Easy 6 km"): GeneratedPlan["workouts"][number] => ({
  day, name, sport: "run", load: 40, doc: { name, sport: "run", description: "", items: [{ type: "step", id: `x-${day}`, kind: "training", target: "time", seconds: 2400, intensity: { kind: "none" } }] },
});

describe("the plan request", () => {
  it("opens with the desktop's defaults, or a preset's goal and length", () => {
    expect(newPlanRequest(TODAY)).toEqual({ goal: "", sports: ["run"], difficulty: "intermediate", weeks: 8, sessionsPerWeek: 4, startDate: TODAY, availableDayIndexes: [0, 1, 2, 3, 4, 5, 6] });
    expect(newPlanRequest(TODAY, { goal: "Race a half marathon", weeks: 12, sessionsPerWeek: 5 })).toMatchObject({ goal: "Race a half marathon", weeks: 12, sessionsPerWeek: 5 });
  });
  it("names the first thing that stops it", () => {
    expect(requestProblem(request(), TODAY)).toBeNull();
    expect(requestProblem(request({ goal: " " }), TODAY)).toBe("Describe your goal to continue.");
    expect(requestProblem(request({ goal: "x".repeat(181) }), TODAY)).toBe("Keep the goal to 180 characters.");
    expect(requestProblem(request({ sports: [] }), TODAY)).toBe("Pick at least one sport.");
    expect(requestProblem(request({ availableDayIndexes: [] }), TODAY)).toBe("Pick at least one available day.");
    expect(requestProblem(request({ weeks: 25 }), TODAY)).toBe("Generated plans must contain 1 to 24 weeks.");
    expect(requestProblem(request({ sessionsPerWeek: 8 }), TODAY)).toBe("Sessions per week must be between 1 and 7.");
    expect(requestProblem(request({ sessionsPerWeek: 3, availableDayIndexes: [1, 5] }), TODAY)).toBe("Choose at least 3 available days.");
    expect(requestProblem(request({ startDate: "2026-11-19" }), TODAY)).toBe("Choose today or a future start date.");
    expect(requestProblem(request({ maxSessionMinutes: 5 }), TODAY)).toBe("A session limit goes from 10 to 600 minutes.");
    expect(requestProblem(request({ maxSessionMinutes: 600 }), TODAY)).toBeNull();
    expect(maxSessions(request({ availableDayIndexes: [1, 5] }))).toBe(2);
    expect(maxSessions(request({ availableDayIndexes: [] }))).toBe(1);
  });
  it("reads the session limit box", () => {
    expect(parseSessionLimit("")).toBeUndefined();
    expect(parseSessionLimit(" 90 ")).toBe(90);
    expect(parseSessionLimit("1.5")).toBeNull();
    expect(parseSessionLimit("abc")).toBeNull();
  });
  it("fills the Plan snapshot", () => {
    expect(planSnapshot({ ...request(), weeks: 12, sessionsPerWeek: 5, startDate: "2026-11-30", availableDayIndexes: [6, 1, 2, 3, 5], maxSessionMinutes: 90 })).toEqual({
      sports: "Run", structure: "12 weeks · 5 / week", total: 60, dates: "30 Nov to 21 Feb", days: "Tue, Wed, Thu, Sat, Sun", cap: "90 min",
    });
    expect(planSnapshot({ ...request(), weeks: 1, sports: [], availableDayIndexes: [] })).toMatchObject({ sports: "—", structure: "1 week · 2 / week", days: "—", cap: null });
    expect(planSnapshot(request()).days).toBe("Every day");
  });
  it("asks Coach in its own tool's terms", () => {
    const text = generationPrompt(request({ sports: ["run", "trailRun"], availableDayIndexes: [5, 1], maxSessionMinutes: 60, constraints: " No track. " }));
    expect(text).toContain("Goal: Run a faster 5K");
    expect(text).toContain("Sports (use only these): run, trailRun");
    expect(text).toContain("Length: exactly 2 weeks");
    expect(text).toContain("Sessions: exactly 2 workouts per week");
    expect(text).toContain("Plan start date (day 1 of week 1): 2026-11-20");
    expect(text).toContain("Available weekdays (use only these): Tue, Sat");
    expect(text).toContain("Maximum duration for every session: 60 minutes");
    expect(text).toContain("Additional constraints: No track.");
    expect(text).toContain("propose_training_plan");
    expect(generationPrompt(request())).toContain("No explicit session-duration cap.");
  });
});

describe("Coach's plan as a plan document", () => {
  it("puts each workout on the day Coach gave it, as an unsaved Coach plan", () => {
    const made: GeneratedPlan = { name: "Two weeks sharp", summary: "Easy first.", left: [], workouts: [run("2026-11-28"), run("2026-11-20"), run("2026-11-24", "Tempo"), run("2026-12-01")] };
    const { plan, differences } = trainingPlanFromGenerated(made, request({ constraints: "No track." }), env());
    expect(differences).toEqual([]);
    expect(plan).toMatchObject({ id: "plan:1", name: "Two weeks sharp", description: "Easy first.", goal: "Run a faster 5K", difficulty: "intermediate", source: "coach", startDate: TODAY, weekCount: 2, sportMix: ["run"], notes: "No track." });
    expect(plan.entries.map((e) => [e.weekIndex, e.dayIndex, e.title, e.plannedTrainingLoad])).toEqual([[0, 0, "Easy 6 km", 40], [0, 4, "Tempo", 40], [1, 1, "Easy 6 km", 40], [1, 4, "Easy 6 km", 40]]);
    expect(plan.entries.map((e) => entryDay(plan, e))).toEqual(["2026-11-20", "2026-11-24", "2026-11-28", "2026-12-01"]);
    expect(validateTrainingPlan(plan)).toEqual([]);
  });
  it("keeps a plan that differs from the request and says how", () => {
    const made: GeneratedPlan = { name: "Short", summary: "", left: ["A routine was left out."], workouts: [run("2026-11-22"), { ...run("2026-12-09", "Long ride"), sport: "bike", doc: { ...run("x").doc, sport: "bike", items: [{ type: "step", id: "r", kind: "training", target: "time", seconds: 7200, intensity: { kind: "none" } }] } }] };
    const { plan, differences } = trainingPlanFromGenerated(made, request({ availableDayIndexes: [0, 1, 2, 3, 4, 5], maxSessionMinutes: 60 }), env());
    expect(plan.weekCount).toBe(3);
    expect(differences).toEqual([
      "A routine was left out.",
      "Coach laid out 2 of the 4 workouts you asked for.",
      "Coach's plan runs 3 weeks, not 2.",
      "Weeks 1, 2 don't have 2 workouts.",
      "“Easy 6 km” is on a day you didn't make available.",
      "Coach used a sport you didn't ask for: Bike.",
      "“Long ride” (2 h 0 min) is over your 60 min session limit.",
    ]);
    expect(plan.notes.split("\n")).toEqual(differences);
  });
  it("starts earlier when Coach's first workout is before the start date, and says so", () => {
    const { plan, differences } = trainingPlanFromGenerated({ name: "Early", summary: "", left: [], workouts: [run("2026-11-21")] }, request({ startDate: "2026-11-23" }), env());
    expect(plan.startDate).toBe("2026-11-21");
    expect(differences[0]).toBe("Coach's first workout is on Sat 21 Nov, before the start date you asked for, so the plan starts there.");
  });
  it("has nothing to open without workouts or a name", () => {
    expect(() => trainingPlanFromGenerated({ name: "x", summary: "", left: [], workouts: [] }, request())).toThrow("Coach's plan held no workouts.");
    expect(() => trainingPlanFromGenerated({ name: " ", summary: "", left: [], workouts: [run("2026-11-21")] }, request())).toThrow("Coach returned a plan without a name.");
  });
  it("finds no plan in an answer without a plan card", () => {
    expect(generatedPlanFromBlocks([{ kind: "text", text: "Here is some advice." }], ids())).toBeNull();
  });
});

describe("Generate plan through Coach's own loop", () => {
  it("turns the scripted dev model's plan card into a plan, and lists how it falls short of the request", async () => {
    const NOW = new Date(2026, 10, 20, 14, 10);
    const clock: Clock = { nowMs: NOW.getTime(), offsetMin: NOW.getTimezoneOffset() };
    const items = athleteItems(seedItems(NOW));
    const entries = planEntries(items, null, []);
    let n = 0;
    const tools: ToolContext = { items, clock, entries, hubNote: null, hub: null, browser: [], newId: () => `ID-${++n}`, asked: false };
    const asked = request({ weeks: 8, sessionsPerWeek: 4 });
    const outcome = await runCoach({
      model: mockModel(0), rules: RULES, context: contextText(items, clock, entries, null, null), tools, emit: () => {},
      history: historyTurns([{ id: "now", from: "you", text: generationPrompt(asked) }]),
    });
    const made = generatedPlanFromBlocks(outcome.blocks as CoachBlock[], ids());
    expect(made).not.toBeNull();
    expect(made!.workouts.map((w) => [w.day, w.name, w.sport])).toEqual([
      ["2026-11-21", "Easy 6 km", "run"], ["2026-11-23", "Tempo 3 × 2 km", "run"], ["2026-11-24", "Lower body strength", "strength"], ["2026-11-26", "Long run", "run"],
    ]);
    const { plan, differences } = trainingPlanFromGenerated(made!, asked, env());
    expect(plan).toMatchObject({ name: "One week back in", source: "coach", weekCount: 8, startDate: TODAY });
    expect(plan.entries).toHaveLength(4);
    expect(plan.entries.every((e) => e.workout?.doc && e.workout.doc.items.length > 0)).toBe(true);
    expect(validateTrainingPlan(plan)).toEqual([]);
    expect(differences).toContain("Coach laid out 4 of the 32 workouts you asked for.");
    expect(differences).toContain("Coach used a sport you didn't ask for: Strength.");
  }, 20_000);
});
