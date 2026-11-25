import type { BuilderDoc, BuilderItem, BuilderStep } from "@/lib/builder";
import { trainingPlanCalendarRevision, type PhaseKind, type TrainingPlanDocument, type TrainingPlanEntry, type TrainingPlanPhase } from "@/lib/plan";

/* The three plans on the canvas's Plans board, for the sample athlete (dated around 19 November 2026). */

let n = 0;
const step = (row: Omit<BuilderStep, "type" | "id">): BuilderStep => ({ type: "step", id: `sp-${++n}`, ...row });
const km = (kind: BuilderStep["kind"], value: number, pace?: [number, number]): BuilderStep =>
  step({ kind, target: "distance", meters: Math.round(value * 1000), intensity: pace ? { kind: "pace", low: pace[0], high: pace[1] } : { kind: "none" } });
const run = (name: string, items: BuilderItem[]): BuilderDoc => ({ name, sport: "run", description: "", items });

const easy = (d: number) => run(`Easy ${d} km`, [km("training", d)]);
const long = (d: number) => run(`Long ${d} km`, [km("training", d)]);
const tempo = (d: number) => run(`Tempo ${d} km`, [km("warmup", 2), km("training", d, [270, 280]), km("cooldown", 2)]);
const reps = (count: number) => run(`${count} × 800 m`, [km("warmup", 2), { type: "repeat", id: `sp-${++n}`, count, steps: [km("training", 0.8, [240, 250]), km("rest", 0.4)] }, km("cooldown", 2)]);
const lift = (name: string, sets: number, reps: number, kg: number | null): BuilderStep =>
  step({ kind: "training", target: "reps", count: reps, sets, restSeconds: 90, name, intensity: kg === null ? { kind: "bodyweight" } : { kind: "weight", low: kg } });
const gym = (name: string, lifts: BuilderStep[]): BuilderDoc => ({ name, sport: "strength", description: "", items: lifts });

const entry = (planId: string, week: number, day: number, doc: BuilderDoc): TrainingPlanEntry => ({
  id: `${planId}-w${week + 1}d${day + 1}`, kind: "workout", weekIndex: week, dayIndex: day, sortOrder: 0, title: doc.name,
  workout: { key: `${planId}-${week}-${day}`, name: doc.name, sport: doc.sport, doc },
});
const phase = (planId: string, kind: PhaseKind, name: string, startWeek: number, endWeek: number): TrainingPlanPhase => ({ id: `${planId}-${kind}-${startWeek}`, name, kind, startWeek, endWeek });
const STAMP = "2026-11-19T08:00:00.000Z";
const base = { description: "", notes: "", tags: [], favorite: false, archived: false, syncState: "local" as const, createdAt: STAMP, updatedAt: STAMP };

/** How far the long run and the hard day go in each week of the 5K plan: up through Build, down for the taper. */
const FIVE_K = [1, 1.1, 1.2, 1.25, 1.35, 1.6, 1.45, 0.8];
const fiveK: TrainingPlanDocument = {
  ...base, id: "sample-plan-5k", name: "5K in 8 weeks", description: "Eight weeks to a faster 5K on four runs a week.", goal: "Run a faster 5K", difficulty: "intermediate",
  source: "coach", sportMix: ["run"], weekCount: 8, startDate: "2026-11-30",
  phases: [phase("sample-plan-5k", "base", "Base", 1, 3), phase("sample-plan-5k", "build", "Build", 4, 6), phase("sample-plan-5k", "peak", "Peak", 7, 7), phase("sample-plan-5k", "taper", "Taper", 8, 8)],
  entries: FIVE_K.flatMap((f, w) => [
    entry("sample-plan-5k", w, 1, w < 3 ? easy(Math.round(5 * f)) : reps(Math.round(4 * f))),
    entry("sample-plan-5k", w, 3, easy(Math.round(6 * f))),
    entry("sample-plan-5k", w, 5, w % 2 ? tempo(Math.round(4 * f)) : easy(Math.round(5 * f))),
    entry("sample-plan-5k", w, 6, long(Math.round(10 * f))),
  ]),
};

const HALF = [1, 1.08, 1.15, 0.9, 1.2, 1.3, 1.4, 1.05, 1.45, 1.55, 1.2, 0.75];
const halfEntries = HALF.flatMap((f, w) => [
  entry("sample-plan-half", w, 1, reps(Math.round(5 * f))), entry("sample-plan-half", w, 2, easy(Math.round(8 * f))), entry("sample-plan-half", w, 3, tempo(Math.round(6 * f))),
  entry("sample-plan-half", w, 5, easy(Math.round(6 * f))), entry("sample-plan-half", w, 6, long(Math.round(14 * f))),
]);
const half: TrainingPlanDocument = {
  ...base, id: "sample-plan-half", name: "Half marathon build", goal: "Race a half marathon", difficulty: "advanced", source: "coros", sportMix: ["run"], weekCount: 12, startDate: "2026-11-02",
  phases: [phase("sample-plan-half", "base", "Base", 1, 4), phase("sample-plan-half", "build", "Build", 5, 9), phase("sample-plan-half", "peak", "Peak", 10, 10), phase("sample-plan-half", "taper", "Taper", 11, 12)],
  entries: halfEntries,
  calendarInstalls: [{
    id: "sample-install-half", startDate: "2026-11-02", fromDate: "2026-11-02", planRevision: "sample", state: "active", lastOperation: "install", total: halfEntries.length, failures: [], createdAt: STAMP, updatedAt: STAMP,
    occurrences: halfEntries.map((e) => {
      const day = new Date(2026, 10, 2 + e.weekIndex * 7 + (e.dayIndex ?? 0));
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      return { planEntryId: e.id, happenDay: key, where: "coros" as const, ref: `sample-${e.id}`, name: e.title ?? "", createdAt: STAMP };
    }),
  }],
};

const LOWER = gym("Lower body", [lift("Back squat", 4, 6, 80), lift("Romanian deadlift", 3, 8, 70), lift("Walking lunge", 3, 10, null)]);
const UPPER = gym("Upper body", [lift("Bench press", 4, 6, 60), lift("Pull-up", 4, 6, null), lift("Overhead press", 3, 8, 35)]);
const FULL = gym("Full body", [lift("Deadlift", 3, 5, 100), lift("Push-up", 3, 12, null), lift("Goblet squat", 3, 10, 24)]);
const strengthEntries = Array.from({ length: 6 }, (_, w) => [entry("sample-plan-strength", w, 0, LOWER), entry("sample-plan-strength", w, 2, UPPER), ...(w === 1 || w === 2 || w === 4 ? [entry("sample-plan-strength", w, 4, FULL)] : [])]).flat();
const strength: TrainingPlanDocument = {
  ...base, id: "sample-plan-strength", name: "Winter strength block", goal: "Build strength through the off-season", difficulty: "custom", source: "local", sportMix: ["strength"], weekCount: 6, startDate: "2027-01-04",
  phases: [], entries: strengthEntries,
  calendarInstalls: [{
    id: "sample-install-strength", startDate: "2027-01-04", fromDate: "2027-01-04", planRevision: "sample", state: "active", lastOperation: "install", total: strengthEntries.length, failures: [], createdAt: STAMP, updatedAt: STAMP,
    occurrences: strengthEntries.map((e) => {
      const day = new Date(2027, 0, 4 + e.weekIndex * 7 + (e.dayIndex ?? 0));
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      return { planEntryId: e.id, happenDay: key, where: "browser" as const, ref: `sample-${e.id}`, name: e.title ?? "", createdAt: STAMP };
    }),
  }],
};

// Each install matches its plan as it stands, so neither reads as "calendar differs".
for (const plan of [half, strength]) for (const install of plan.calendarInstalls ?? []) install.planRevision = trainingPlanCalendarRevision(plan);

export const samplePlans: TrainingPlanDocument[] = [fiveK, half, strength];
