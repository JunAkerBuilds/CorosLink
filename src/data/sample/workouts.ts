import type { AthleteProfile, Workout } from "@/data/workouts";
import type { AthleteNumbers } from "@/lib/builder";
import type { Sport, StepKind, StepLength, StepTarget, WorkoutItem, WorkoutStep } from "@/lib/workout";

/** The sample athlete's zones and the pace they usually hold in each. */
export const sampleProfile: AthleteProfile = {
  zones: [
    { zone: 1, low: 105, high: 123 },
    { zone: 2, low: 124, high: 143 },
    { zone: 3, low: 144, high: 157 },
    { zone: 4, low: 158, high: 171 },
    { zone: 5, low: 172, high: 186 },
  ],
  pacing: {
    run: { zonePace: [370, 330, 305, 288, 275], easyPace: 360 },
    ride: { zonePace: [160, 140, 125, 115, 105], easyPace: 170 },
    swim: { zonePace: [1500, 1320, 1200, 1110, 1020], easyPace: 1560 },
    strength: { zonePace: [370, 330, 305, 288, 275], easyPace: 360, still: true },
  },
};

/** The sample athlete's own numbers, for the "Derived:" line under a percentage target. */
export const sampleNumbers: AthleteNumbers = { maxHr: 191, restingHr: 48, lthr: 172, thresholdPace: 288, ftp: 265 };

const km = (n: number): StepLength => ({ type: "distance", metres: Math.round(n * 1000), unit: "km" });
const m = (n: number): StepLength => ({ type: "distance", metres: n, unit: "m" });
const time = (seconds: number): StepLength => ({ type: "time", seconds });
const zone = (z: number): StepTarget => ({ type: "hr", zone: z });
const pace = (fast: number, slow: number): StepTarget => ({ type: "pace", fast, slow });
const none: StepTarget = { type: "none" };

type Draft = [StepKind, StepLength, StepTarget] | { repeat: number; steps: [StepKind, StepLength, StepTarget][] };

function workout(id: string, date: string, sport: Sport, name: string, drafts: Draft[]): Workout {
  let n = 0;
  const step = (d: [StepKind, StepLength, StepTarget]): WorkoutStep => ({ type: "step", id: `${id}-${++n}`, kind: d[0], length: d[1], target: d[2] });
  const items: WorkoutItem[] = drafts.map((d) =>
    Array.isArray(d) ? step(d) : { type: "repeat", id: `${id}-${++n}`, count: d.repeat, steps: d.steps.map(step) });
  return { id, name, sport, date, repeatWeeks: 1, items };
}

/** What "Plan a workout" opens with: the workout on the canvas (9.60 km, 49:56). */
export const starterWorkout: Workout = workout("new", "2026-11-26", "run", "Cruise intervals, 4 × 1 km", [
  ["warmup", km(2), zone(2)],
  { repeat: 4, steps: [["work", km(1), pace(270, 280)], ["recovery", m(400), none]] },
  ["cooldown", km(2), zone(2)],
]);

const ride = (date: string) => workout(`plan-${date}`, date, "ride", "Recovery ride", [["work", km(25), zone(2)]]);
const gym = (date: string, name: string) => workout(`plan-${date}`, date, "strength", name, [["work", time(45 * 60), none]]);
const easy = (date: string) => workout(`plan-${date}`, date, "run", "Easy run", [["work", km(6), pace(325, 335)]]);
const long = (date: string, distance: number) => workout(`plan-${date}`, date, "run", "Long run", [["work", km(distance), pace(315, 325)]]);

/** The workouts behind the sample calendar's planned days, by entry id. */
export const sampleWorkouts: Workout[] = [
  easy("2026-11-20"),
  gym("2026-11-21", "Strength, lower"),
  long("2026-11-22", 18),
  ride("2026-11-23"),
  gym("2026-11-24", "Strength, upper"),
  easy("2026-11-25"),
  workout("plan-2026-11-26", "2026-11-26", "run", "Intervals, 5 × 1 km", [
    ["warmup", km(1.5), zone(2)],
    { repeat: 5, steps: [["work", km(1), pace(260, 270)], ["recovery", m(400), none]] },
    ["cooldown", km(1.5), zone(2)],
  ]),
  workout("plan-2026-11-28", "2026-11-28", "swim", "Pool swim", [["work", m(1500), none]]),
  long("2026-11-29", 20),
  ride("2026-11-30"),
  gym("2026-12-01", "Strength, upper"),
  easy("2026-12-02"),
  workout("plan-2026-12-03", "2026-12-03", "run", "Tempo run", [
    ["warmup", km(2), zone(2)],
    ["work", km(5), pace(270, 280)],
    ["cooldown", km(2), zone(2)],
  ]),
  gym("2026-12-05", "Strength, lower"),
  long("2026-12-06", 16),
];
