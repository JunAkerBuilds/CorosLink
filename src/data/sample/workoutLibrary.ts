import type { BuilderDoc, BuilderIntensity, BuilderItem, BuilderKind, BuilderStep } from "@/lib/builder";

/** A saved workout of the sample athlete, with the extras the library table shows for it. */
export interface SampleLibraryWorkout {
  id: string;
  doc: BuilderDoc;
  tags: string[];
  load: number;
  /** "6 uses · 12 Nov", or null when it has never been planned. */
  used: string | null;
}

type Row = Omit<BuilderStep, "type" | "id" | "intensity"> & { intensity?: BuilderIntensity };

function build(id: string, rows: (Row | { repeat: number; steps: Row[] })[]): BuilderItem[] {
  let n = 0;
  const step = (row: Row): BuilderStep => ({ ...row, type: "step", id: `${id}-${++n}`, intensity: row.intensity ?? { kind: "none" } });
  return rows.map((row) => ("repeat" in row ? { type: "repeat", id: `${id}-${++n}`, count: row.repeat, steps: row.steps.map(step) } : step(row)));
}

const km = (kind: BuilderKind, value: number, intensity?: BuilderIntensity): Row => ({ kind, target: "distance", meters: Math.round(value * 1000), intensity });
const m = (kind: BuilderKind, meters: number, intensity?: BuilderIntensity): Row => ({ kind, target: "distance", meters, intensity });
const time = (kind: BuilderKind, seconds: number, intensity?: BuilderIntensity): Row => ({ kind, target: "time", seconds, intensity });
const pace = (low: number, high: number): BuilderIntensity => ({ kind: "pace", low, high });
const power = (low: number, high: number): BuilderIntensity => ({ kind: "power", low, high });
const stroke = (s: NonNullable<BuilderIntensity["stroke"]>): BuilderIntensity => ({ kind: "stroke", stroke: s });
const lift = (name: string, sets: number, count: number, kg: number | null, restSeconds: number): Row => ({
  kind: "training", target: "reps", count, sets, restSeconds, name, intensity: kg === null ? { kind: "bodyweight" } : { kind: "weight", low: kg },
});

/** The workouts on the canvas's "From library" table. */
export const sampleLibrary: SampleLibraryWorkout[] = [
  {
    id: "sample-lib-cruise", tags: ["threshold"], load: 104, used: "6 uses · 12 Nov",
    doc: { name: "Cruise intervals, 4 × 1 km", sport: "run", description: "Hold the same pace on all four. Jog the rests.", items: build("sl1", [
      km("warmup", 2), { repeat: 4, steps: [km("training", 1, pace(270, 280)), km("rest", 0.4)] }, km("cooldown", 2),
    ]) },
  },
  {
    id: "sample-lib-long", tags: ["long"], load: 212, used: "9 uses · 15 Nov",
    doc: { name: "Long run, steady finish", sport: "run", description: "", items: build("sl2", [km("warmup", 16, pace(325, 335)), km("training", 8, pace(280, 290))]) },
  },
  {
    id: "sample-lib-sweet", tags: ["indoor"], load: 92, used: "4 uses · 10 Nov",
    doc: { name: "Sweet spot, 3 × 15 min", sport: "bike", description: "", items: build("sl3", [
      time("warmup", 900), { repeat: 3, steps: [time("training", 900, power(230, 245)), time("rest", 300)] }, time("cooldown", 600),
    ]) },
  },
  {
    id: "sample-lib-hundreds", tags: [], load: 58, used: "3 uses · 13 Nov",
    doc: { name: "Hundreds, 12 × 100 m", sport: "swim", description: "Even splits on the hundreds.", poolLength: 25, items: build("sl4", [
      m("warmup", 400, stroke("freestyle")),
      { repeat: 4, steps: [m("training", 50, stroke("drills")), time("rest", 15)] },
      { repeat: 12, steps: [m("training", 100, stroke("freestyle")), time("rest", 20)] },
      { repeat: 4, steps: [m("training", 100, stroke("backstroke")), time("rest", 20)] },
      m("cooldown", 200, stroke("mix")),
    ]) },
  },
  {
    id: "sample-lib-push", tags: ["gym"], load: 47, used: null,
    doc: { name: "Push day", sport: "strength", description: "Leave a rep in the tank on bench.", items: build("sl5", [
      lift("Bench press", 4, 6, 80, 150), lift("Incline dumbbell press", 3, 10, 26, 90), lift("Overhead press", 4, 8, 47.5, 120),
      lift("Lateral raise", 3, 15, 9, 60), { kind: "training", target: "open", sets: 3, restSeconds: 90, name: "Dips", intensity: { kind: "bodyweight" } },
    ]) },
  },
];
