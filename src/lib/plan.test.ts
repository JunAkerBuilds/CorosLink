import { describe, expect, it } from "vitest";
import { samplePlans } from "@/data/sample/plans";
import { sampleLibrary } from "@/data/sample/workoutLibrary";
import { sampleProfile } from "@/data/sample/workouts";
import {
  activeTrainingPlanCalendarInstall, addRestDay, addTrainingPlanPhase, addTrainingPlanWeek, calendarBlockedEntries, clampPhase, createTrainingPlan, duplicateTrainingPlan, duplicateTrainingPlanWeek,
  durationText, entryDay, entryMeta, insertRecoveryWeek, installStanding, installTrainingPlan, moveTrainingPlanEntry, peakOf, phaseForWeek, planCalendarPreview, planDate, planDayNames,
  planEntryFromWorkout, planFactsLine, planGoalPreset, planNeedsAttention, planScopes, planStatus, planSuggestions, planToday, planView, quickPlanEntry, removeTrainingPlanFromCalendar,
  removeTrainingPlanWeek, reorderTrainingPlanWeek, saveStatus, scheduledWeeks, shiftTrainingPlan, summarizeTrainingPlan, trainingPlanCalendarRevision, trainingPlanEntryMetrics,
  upcomingTrainingPlanCalendarWorkoutCount, updateTrainingPlanPhase, validateTrainingPlan, visiblePlans, withDerivedSportMix, withPhaseKind,
  type PlanEnv, type PlanWorkout, type TrainingPlanDocument, type TrainingPlanEntry,
} from "./plan";

function env(): PlanEnv {
  let n = 0;
  return { newId: (prefix) => `${prefix}:${++n}`, now: () => "2026-11-20T08:00:00.000Z" };
}
const doc = (id: string) => sampleLibrary.find((w) => w.id === id)!.doc;
const workout = (id: string): PlanWorkout => ({ key: id, name: doc(id).name, sport: doc(id).sport, doc: doc(id) });
const TIMED = "sample-lib-sweet"; // 15 + 3 × (15 + 5) + 10 min on the bike
const RUN = "sample-lib-cruise";

/** A four-week plan: week 1 has a workout on Tue and Thu, week 2 on Tue, one waits in the holding area. */
function plan(e = env()): TrainingPlanDocument {
  const p = createTrainingPlan("Block", "local", e);
  const at = (w: number, d: number | undefined, id: string, load?: number): TrainingPlanEntry => ({ ...planEntryFromWorkout(workout(id), w, d, undefined, e), ...(load ? { plannedTrainingLoad: load } : {}) });
  return { ...p, startDate: "2026-11-30", entries: [at(0, 1, TIMED, 100), at(0, 3, RUN, 60), at(1, 1, TIMED, 220), at(0, undefined, RUN)] };
}

describe("a blank plan", () => {
  it("is Untitled plan, four weeks, Custom, local", () => {
    expect(createTrainingPlan(undefined, undefined, env())).toEqual({
      id: "plan:1", name: "Untitled plan", description: "", goal: "", difficulty: "custom", notes: "", source: "local", sportMix: [], weekCount: 4, phases: [], entries: [], tags: [],
      favorite: false, archived: false, syncState: "local", createdAt: "2026-11-20T08:00:00.000Z", updatedAt: "2026-11-20T08:00:00.000Z",
    });
    expect(validateTrainingPlan(createTrainingPlan())).toEqual([]);
  });
});

describe("plan dates", () => {
  it("reads both date spellings and refuses what isn't a day", () => {
    expect(planDate("20261130")).toBe("2026-11-30");
    expect(planDate("2026-11-30")).toBe("2026-11-30");
    expect(planDate("2026-02-30")).toBeUndefined();
    expect(planDate(undefined)).toBeUndefined();
  });
  it("works a workout's day out from the start date", () => {
    const p = plan();
    expect(entryDay(p, p.entries[2])).toBe("2026-12-08");
    expect(entryDay(p, p.entries[3])).toBeUndefined();
    expect(planDayNames(p)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(planDayNames({ startDate: "2026-12-02" })[0]).toBe("Wed");
    expect(planToday(p, "2026-12-09")).toEqual({ week: 1, day: 2 });
    expect(planToday(p, "2026-11-20")).toEqual({ week: -1, day: -1 });
  });
  it("moves every week with the start date; workouts keep their place in the week", () => {
    const p = shiftTrainingPlan(plan(), "20261207", env());
    expect(p.startDate).toBe("2026-12-07");
    expect(entryDay(p, p.entries[0])).toBe("2026-12-08");
    expect(() => shiftTrainingPlan(plan(), "soon")).toThrow("Plan start date must be YYYY-MM-DD or YYYYMMDD.");
  });
});

describe("week operations", () => {
  const phased = (): TrainingPlanDocument => ({ ...plan(), phases: [{ id: "a", name: "Base", kind: "base", startWeek: 1, endWeek: 2 }, { id: "b", name: "Build", kind: "build", startWeek: 3, endWeek: 4 }] });

  it("duplicates a week's scheduled workouts into a new week after it", () => {
    const p = duplicateTrainingPlanWeek(phased(), 0, env());
    expect(p.weekCount).toBe(5);
    expect(p.entries.filter((e) => e.weekIndex === 1 && e.dayIndex !== undefined).map((e) => e.dayIndex)).toEqual([1, 3]);
    expect(p.entries.filter((e) => e.weekIndex === 2).map((e) => e.dayIndex)).toEqual([1]);
    expect(p.entries.filter((e) => e.dayIndex === undefined)).toHaveLength(1);
    expect(p.phases.map((x) => [x.startWeek, x.endWeek])).toEqual([[1, 3], [4, 5]]);
    expect(() => duplicateTrainingPlanWeek(plan(), 4)).toThrow("Week index is outside the plan.");
  });
  it("inserts an empty recovery week with its own phase", () => {
    const p = insertRecoveryWeek(phased(), 0, env());
    expect(p.weekCount).toBe(5);
    expect(p.entries.filter((e) => e.weekIndex === 1 && e.dayIndex !== undefined)).toHaveLength(0);
    expect(p.phases[2]).toMatchObject({ name: "Recovery", kind: "recovery", startWeek: 2, endWeek: 2 });
    expect(phaseForWeek(p, 1)?.kind).toBe("recovery");
    expect(phaseForWeek(p, 0)?.kind).toBe("base");
  });
  it("deletes a week, keeps the holding area and closes the gap", () => {
    const p = removeTrainingPlanWeek(phased(), 0, env());
    expect(p.weekCount).toBe(3);
    expect(p.entries.map((e) => [e.weekIndex, e.dayIndex])).toEqual([[0, 1], [0, undefined]]);
    expect(p.phases.map((x) => [x.startWeek, x.endWeek])).toEqual([[1, 1], [2, 3]]);
    expect(() => removeTrainingPlanWeek({ ...plan(), weekCount: 1 }, 0)).toThrow("A plan needs at least one week.");
  });
  it("moves a week up or down with its workouts and phases", () => {
    const p = reorderTrainingPlanWeek(phased(), 0, 1, env());
    expect(p.entries.filter((e) => e.dayIndex !== undefined).map((e) => e.weekIndex)).toEqual([1, 1, 0]);
    expect(p.phases[0]).toMatchObject({ startWeek: 1, endWeek: 2 });
  });
  it("adds a week, up to 52", () => {
    expect(addTrainingPlanWeek(plan(), env()).weekCount).toBe(5);
    expect(() => addTrainingPlanWeek({ ...plan(), weekCount: 52 })).toThrow("Plans must contain 1 to 52 weeks.");
  });
});

describe("entries", () => {
  it("moves a workout to a day or to the holding area", () => {
    const p = plan();
    const moved = moveTrainingPlanEntry(p, p.entries[3].id, 2, 6);
    expect(moved.entries[3]).toMatchObject({ weekIndex: 2, dayIndex: 6 });
    expect(moveTrainingPlanEntry(moved, p.entries[3].id, 2, undefined).entries[3]).toMatchObject({ weekIndex: 0, dayIndex: undefined });
    expect(() => moveTrainingPlanEntry(p, p.entries[3].id, 9, 0)).toThrow("Week index is outside the plan.");
    expect(() => moveTrainingPlanEntry(p, p.entries[3].id, 0, 7)).toThrow("Plan day must be between Day 1 and Day 7.");
  });
  it("marks a rest day once", () => {
    const p = addRestDay(plan(), 0, 0, env());
    expect(p.entries[4]).toMatchObject({ kind: "rest", weekIndex: 0, dayIndex: 0, title: "Rest day" });
    expect(addRestDay(p, 0, 0)).toBe(p);
  });
  it("makes a quick workout of so many minutes for the holding area", () => {
    const run = quickPlanEntry(" Hill strides ", "run", 45, "s1", env());
    expect(run).toMatchObject({ kind: "workout", weekIndex: 0, title: "Hill strides", workout: { sport: "run", doc: { name: "Hill strides", items: [{ kind: "training", target: "time", seconds: 2700 }] } } });
    expect(run.dayIndex).toBeUndefined();
    expect(trainingPlanEntryMetrics(run).durationSeconds).toBe(2700);
    const gym = quickPlanEntry("Core", "strength", 20, "s2", env());
    expect(gym.workout?.doc?.items[0]).toMatchObject({ target: "time", seconds: 1200, sets: 1, restSeconds: 0, name: "Core" });
    expect(trainingPlanEntryMetrics(gym).durationSeconds).toBe(1200);
  });
  it("follows the workouts for the plan's sports", () => {
    expect(withDerivedSportMix(plan(), env()).sportMix).toEqual(["bike", "run"]);
  });
  it("says which scheduled workouts the calendar would refuse", () => {
    const p = plan();
    const gym = { ...quickPlanEntry("Core", "strength", 20, "s2", env()), dayIndex: 4 };
    const withGym = { ...p, entries: [...p.entries, gym] };
    expect(calendarBlockedEntries(withGym, false)).toEqual([]);
    expect(calendarBlockedEntries(withGym, true)).toEqual([{ entry: gym, why: "its exercises must come from COROS’s list" }]);
  });
});

describe("phases", () => {
  it("holds a phase inside the plan", () => {
    expect(clampPhase({ id: "a", name: "Base", startWeek: 0, endWeek: 9 }, 4)).toMatchObject({ startWeek: 1, endWeek: 4 });
    expect(clampPhase({ id: "a", name: "Base", startWeek: 3, endWeek: 2 }, 4)).toMatchObject({ startWeek: 3, endWeek: 3 });
  });
  it("adds a Peak phase after the last one and renames a default name with its type", () => {
    const p = addTrainingPlanPhase({ ...plan(), phases: [{ id: "a", name: "Base", kind: "base", startWeek: 1, endWeek: 2 }] }, env());
    expect(p.phases[1]).toMatchObject({ name: "Peak", kind: "peak", startWeek: 3, endWeek: 4 });
    expect(withPhaseKind(p.phases[1], "taper")).toMatchObject({ name: "Taper", kind: "taper" });
    expect(withPhaseKind({ ...p.phases[1], name: "Sharpen" }, "taper")).toMatchObject({ name: "Sharpen", kind: "taper" });
    expect(updateTrainingPlanPhase(p, "a", (x) => ({ ...x, endWeek: 30 })).phases[0].endWeek).toBe(4);
  });
});

describe("checks", () => {
  it("finds what blocks saving", () => {
    const p = plan();
    const bad: TrainingPlanDocument = {
      ...p, name: " ", phases: [{ id: "a", name: "Base", startWeek: 3, endWeek: 9 }],
      entries: [...p.entries, { id: "x", kind: "workout", weekIndex: 7, dayIndex: 8, sortOrder: 0 }],
    };
    expect(validateTrainingPlan(bad).map((i) => i.message)).toEqual([
      "Add a plan name.", "A workout is outside the plan range.", "Plan day must be between Day 1 and Day 7.", "Workout entry has no reusable workout definition.", "Phase \"Base\" is outside the plan range.",
    ]);
  });
  it("warns when three items share a day", () => {
    const p = plan();
    const crowded = { ...p, entries: [...p.entries, { ...p.entries[0], id: "b" }, { ...p.entries[0], id: "c" }] };
    expect(validateTrainingPlan(crowded)).toEqual([{ path: "0:1", message: "3 items share one day. Review recovery and scheduling conflicts.", severity: "warning" }]);
  });
  it("advises on load jumps, weeks without a phase and the holding area", () => {
    const p = { ...plan(), phases: [{ id: "a", name: "Base", kind: "base" as const, startWeek: 1, endWeek: 2 }] };
    expect(planSuggestions(p)).toEqual(["Week 2 load jumps 38%", "Week 3, 4 has no phase", "Cruise intervals, 4 × 1 km in the holding area won’t go on the calendar"]);
    expect(planSuggestions({ ...p, phases: [], entries: [...p.entries, { ...p.entries[3], id: "h2" }] })).toEqual(["Week 2 load jumps 38%", "2 in the holding area won’t go on the calendar"]);
  });
  it("words the save state", () => {
    const error = { path: "name", message: "Add a plan name.", severity: "error" as const };
    expect(saveStatus([], [], true)).toEqual({ tone: "ok", text: "Ready to save." });
    expect(saveStatus([], [], false).text).toBe("Saved · everything is up to date");
    expect(saveStatus([], ["a"], true).text).toBe("Ready to save · 1 warning");
    expect(saveStatus([], ["a", "b"], true)).toEqual({ tone: "warning", text: "Ready to save · 2 warnings" });
    expect(saveStatus([error], ["a"], true)).toEqual({ tone: "error", text: "Fix 1 issue before saving" });
    expect(saveStatus([error, error], [], true).text).toBe("Fix 2 issues before saving");
    expect(saveStatus([], [], true, true).text).toBe("Saving…");
  });
});

describe("figures", () => {
  it("takes a workout's time from its steps and its load from what the plan recorded", () => {
    const p = plan();
    expect(trainingPlanEntryMetrics(p.entries[0])).toEqual({ durationSeconds: 5100, distanceMeters: 0, trainingLoad: 100, strengthSets: 0 });
    // A distance run has no time without the athlete's paces, and nothing is guessed.
    expect(trainingPlanEntryMetrics(p.entries[1])).toEqual({ durationSeconds: 0, distanceMeters: 9600, trainingLoad: 60, strengthSets: 0 });
    const paced = trainingPlanEntryMetrics(p.entries[3], sampleProfile.pacing);
    expect(paced.durationSeconds).toBeGreaterThan(0);
    expect(paced.trainingLoad).toBeGreaterThan(0);
    expect(entryMeta(p.entries[0])).toBe("1 h 25 min · 100");
    expect(entryMeta(p.entries[1])).toBe("9.60 km · 60");
  });
  it("sums the plan and its weeks", () => {
    const s = summarizeTrainingPlan(plan());
    expect(s).toMatchObject({ weekCount: 4, workouts: 4, durationSeconds: 10200, distanceMeters: 19200, trainingLoad: 380, restDays: 25, peakWeek: 2, taperDetected: true, conflictCount: 0, sportDistribution: { bike: 2, run: 2 } });
    expect(s.weekly.map((w) => w.trainingLoad)).toEqual([160, 220, 0, 0]);
    expect(planFactsLine(plan(), s)).toBe("4 weeks · 4 workouts · 380 estimated load · start 30 Nov");
  });
  it("counts scheduled workouts only for the week rows and finds the peak", () => {
    const weeks = scheduledWeeks(plan());
    expect(weeks.map((w) => [w.workouts, w.trainingLoad])).toEqual([[2, 160], [1, 220], [0, 0], [0, 0]]);
    expect(peakOf(weeks)).toEqual({ index: 1, load: 220 });
    expect(peakOf([{ trainingLoad: 0 }])).toEqual({ index: -1, load: 0 });
    expect(durationText(90720)).toBe("25 h 12 min");
    expect(durationText(2700)).toBe("45 min");
  });
  it("draws a tile by load, or by sessions when no week has a load", () => {
    const p = { ...plan(), difficulty: "intermediate" as const, sportMix: ["run" as const], goal: "Run a faster 5K", phases: [{ id: "a", name: "Base", kind: "base" as const, startWeek: 1, endWeek: 1 }] };
    const v = planView(p, summarizeTrainingPlan(p));
    expect(v).toMatchObject({ note: "Run a faster 5K", facts: "Run · Intermediate", sessions: 4, peakLoad: 220, chart: "Weekly load", ribbon: [{ label: "Base", weeks: 1, kind: "base" }] });
    expect(v.bars.map((b) => [Math.round(b.share * 100), b.phase])).toEqual([[73, "base"], [100, undefined], [0, undefined], [0, undefined]]);
    const bare = { ...p, entries: p.entries.map((e) => ({ ...e, plannedTrainingLoad: undefined })) };
    expect(planView(bare, summarizeTrainingPlan(bare))).toMatchObject({ chart: "Sessions per week", peakLoad: 0 });
  });
});

describe("the Plans index", () => {
  const today = "2026-11-19";
  it("knows the presets", () => {
    expect(planGoalPreset("half")).toMatchObject({ goal: "Race a half marathon", weeks: 12, sessionsPerWeek: 5 });
    expect(planGoalPreset("5k")).toMatchObject({ goal: "Run a faster 5K", weeks: 8, sessionsPerWeek: 4 });
    expect(planGoalPreset("trail")).toMatchObject({ goal: "Finish a trail ultra strong", weeks: 16, sessionsPerWeek: 5 });
    expect(planGoalPreset("nope")).toBeUndefined();
  });
  it("says where each sample plan stands", () => {
    expect(samplePlans.map((p) => planStatus(p, today))).toEqual([
      { text: "Starts Mon 30 Nov", live: false }, { text: "Week 3 of 12", live: true }, { text: "Starts Mon 4 Jan", live: true },
    ]);
    expect(planStatus(createTrainingPlan(), today)).toEqual({ text: "Unscheduled", live: false });
    expect(samplePlans.every((p) => validateTrainingPlan(p).length === 0)).toBe(true);
    expect(samplePlans.some((p) => planNeedsAttention(p, today))).toBe(false);
  });
  it("offers only the filters that would show something", () => {
    expect(planScopes(samplePlans, today).map((s) => s.label)).toEqual(["All", "On calendar", "COROS", "Local", "Coach"]);
    const more = [...samplePlans, { ...createTrainingPlan(), favorite: true, archived: true, syncState: "failed" as const }];
    expect(planScopes(more, today).map((s) => s.label)).toEqual(["All", "On calendar", "Favorites", "COROS", "Local", "Coach", "Needs attention", "Archived"]);
    expect(planScopes([], today)).toEqual([{ id: "all", label: "All" }]);
  });
  it("filters and searches", () => {
    expect(visiblePlans(samplePlans, "calendar", "", today).map((p) => p.name).sort()).toEqual(["Half marathon build", "Winter strength block"]);
    expect(visiblePlans(samplePlans, "coach", "", today).map((p) => p.name)).toEqual(["5K in 8 weeks"]);
    expect(visiblePlans(samplePlans, "all", "strength", today).map((p) => p.name)).toEqual(["Winter strength block"]);
    const archived = { ...samplePlans[0], archived: true };
    expect(visiblePlans([archived], "all", "", today)).toEqual([]);
    expect(visiblePlans([archived], "archived", "", today)).toEqual([archived]);
  });
  it("duplicates a plan off the calendar with ids of its own", () => {
    const copy = duplicateTrainingPlan(samplePlans[1], env());
    expect(copy).toMatchObject({ name: "Half marathon build copy", source: "local", favorite: false });
    expect(copy.calendarInstalls).toBeUndefined();
    expect(copy.id).not.toBe(samplePlans[1].id);
    expect(copy.entries[0].id).not.toBe(samplePlans[1].entries[0].id);
    expect(copy.entries).toHaveLength(samplePlans[1].entries.length);
  });
});

describe("onto the calendar", () => {
  const today = "2026-12-02";
  const deps = (fail?: string) => {
    const saved: TrainingPlanDocument[] = [], progress: string[] = [], scheduled: string[] = [];
    return {
      saved, progress, scheduled,
      install: {
        env: env(), save: (p: TrainingPlanDocument) => { saved.push(p); }, onProgress: (x: { done: number; total: number }) => { progress.push(`${x.done}/${x.total}`); },
        schedule: async (t: { day: string; name: string }) => {
          if (t.day === fail) throw new Error("COROS said no.");
          scheduled.push(t.day);
          return { where: "coros" as const, ref: `c-${t.day}` };
        },
      },
    };
  };

  it("previews scheduled workouts from today on and leaves past days out", () => {
    const preview = planCalendarPreview(plan(), today);
    expect(preview.targets.map((t) => t.day)).toEqual(["2026-12-03", "2026-12-08"]);
    expect(preview.skipped.map((t) => t.day)).toEqual(["2026-12-01"]);
    expect(preview.blocker).toBeNull();
    expect(planCalendarPreview({ ...plan(), startDate: undefined }, today).blocker).toBe("Set a plan start date first.");
    expect(planCalendarPreview(createTrainingPlan("x", "local", env()), today).blocker).toBe("Set a plan start date first.");
    expect(planCalendarPreview({ ...plan(), entries: [] }, today).blocker).toBe("Put a workout on a day first.");
    expect(planCalendarPreview(plan(), "2027-01-01").blocker).toBe("Every workout in this plan is on a day that has passed.");
  });

  it("adds one workout at a time and records each", async () => {
    const d = deps();
    const done = await installTrainingPlan(plan(), today, d.install);
    expect(d.scheduled).toEqual(["2026-12-03", "2026-12-08"]);
    expect(d.progress).toEqual(["0/2", "1/2", "2/2"]);
    expect(d.saved).toHaveLength(3);
    const install = done.calendarInstalls![0];
    expect(install).toMatchObject({ state: "active", lastOperation: "install", total: 2, fromDate: today, startDate: "2026-11-30", failures: [] });
    expect(install.occurrences.map((o) => [o.happenDay, o.where, o.ref])).toEqual([["2026-12-03", "coros", "c-2026-12-03"], ["2026-12-08", "coros", "c-2026-12-08"]]);
    expect(install.planRevision).toBe(trainingPlanCalendarRevision(done));
    expect(installStanding(done, today)).toMatchObject({ retrying: false, differs: false, added: 2, total: 2 });
    expect(planStatus(done, today)).toEqual({ text: "Week 1 of 4", live: true });
    await expect(installTrainingPlan(done, today, deps().install)).rejects.toThrow("This plan is on your calendar already.");
    expect(installStanding({ ...done, name: "Renamed" }, today).differs).toBe(true);
    expect(planNeedsAttention({ ...done, name: "Renamed" }, today)).toBe(true);
  });

  it("stops at the first refusal with an honest partial state, then carries on when retried", async () => {
    const d = deps("2026-12-08");
    const stopped = await installTrainingPlan(plan(), today, d.install);
    const s = installStanding(stopped, today);
    expect(s).toMatchObject({ retrying: true, added: 1, total: 2 });
    expect(s.install?.failures).toEqual([{ planEntryId: stopped.entries[2].id, happenDay: "2026-12-08", message: "COROS said no." }]);
    expect(planStatus(stopped, today)).toEqual({ text: "Calendar install incomplete · 1 of 2 workouts added", live: false });
    expect(planNeedsAttention(stopped, today)).toBe(true);
    expect(d.saved[d.saved.length - 1]).toBe(stopped);

    const again = deps();
    const done = await installTrainingPlan(stopped, today, again.install);
    expect(again.scheduled).toEqual(["2026-12-08"]);
    expect(installStanding(done, today)).toMatchObject({ retrying: false, added: 2, total: 2 });
    expect(done.calendarInstalls).toHaveLength(1);
  });

  it("records a first workout that is refused, so the plan still says what happened", async () => {
    const stopped = await installTrainingPlan(plan(), today, deps("2026-12-03").install);
    expect(installStanding(stopped, today)).toMatchObject({ retrying: true, added: 0, total: 2 });
    expect(activeTrainingPlanCalendarInstall(stopped, today)).toBeDefined();
  });

  it("removes upcoming workouts one at a time and keeps past days", async () => {
    const on = await installTrainingPlan(plan(), today, deps().install);
    const later = "2026-12-05", removed: string[] = [], saved: TrainingPlanDocument[] = [];
    expect(upcomingTrainingPlanCalendarWorkoutCount(on, later)).toBe(1);
    const off = await removeTrainingPlanFromCalendar(on, later, { env: env(), save: (p) => { saved.push(p); }, remove: async (o) => { removed.push(o.ref); } });
    expect(removed).toEqual(["c-2026-12-08"]);
    const install = off.calendarInstalls![0];
    expect(install.state).toBe("removed");
    expect(install.occurrences.map((o) => Boolean(o.removedAt))).toEqual([false, true]);
    expect(activeTrainingPlanCalendarInstall(off, later)).toBeUndefined();
    expect(planStatus(off, later).live).toBe(false);
  });

  it("says so when a removal stops part-way", async () => {
    const on = await installTrainingPlan(plan(), today, deps().install);
    const stuck = await removeTrainingPlanFromCalendar(on, today, { env: env(), save: () => {}, remove: async (o) => { if (o.happenDay === "2026-12-08") throw new Error("Signed out of COROS."); } });
    expect(installStanding(stuck, today)).toMatchObject({ removing: true, retrying: false, added: 1 });
    expect(stuck.calendarInstalls![0].failures[0].message).toBe("Signed out of COROS.");
    expect(upcomingTrainingPlanCalendarWorkoutCount(stuck, today)).toBe(1);
  });
});
