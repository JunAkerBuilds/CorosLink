// The strength card's lines: each exercise with its sets, what each set is, the weight and the rest, warm-ups and
// cool-downs on their own, and where today goes up on the athlete's own last logged sets. Pure.
import type { BodyExtra, BodyLift, BodyNumber } from "@/data/coach";
import type { HubWorkout, HubWorkoutStep } from "@/data/hub";
import type { NativeGymWorkout } from "@/data/sync/native";
import { t, tx } from "@/lib/i18n";
import { formatClock } from "@/lib/workout";

/** An exercise's best working set the last time it was logged: its heaviest weight, the most reps at it, the longest hold. */
export interface LastLift { kg: number; reps: number; seconds: number }
/** The athlete's last logged sets, by exercise name written plainly ("romanian deadlift"). */
export type LiftHistory = ReadonlyMap<string, LastLift>;

const plain = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The last logged working sets of every exercise in the gym log, newest workout first. An exercise is known by
 * its name from the phone and by its id written out ("romanian-deadlift-barbell" → "romanian deadlift barbell").
 */
export function liftHistory(workouts: readonly NativeGymWorkout[], names: Readonly<Record<string, string>> = {}): LiftHistory {
  const out = new Map<string, LastLift>();
  const newest = [...workouts].sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  for (const w of newest) {
    for (const e of w.entries ?? []) {
      const keys = [names[e.exerciseID], e.exerciseID].filter((k): k is string => !!k).map(plain).filter(Boolean);
      if (!keys.length || keys.every((k) => out.has(k))) continue;
      const working = (e.sets ?? []).filter((s) => s && s.kind !== "warmUp" && (finite(s.reps) || finite(s.seconds)));
      if (!working.length) continue;
      const kg = Math.max(0, ...working.map((s) => (finite(s.weightKg) ? s.weightKg : 0)));
      const atTop = working.filter((s) => Math.abs((finite(s.weightKg) ? s.weightKg : 0) - kg) < 0.01);
      const last: LastLift = { kg, reps: Math.max(0, ...atTop.map((s) => (finite(s.reps) ? s.reps : 0))), seconds: Math.max(0, ...working.map((s) => (finite(s.seconds) ? s.seconds : 0))) };
      for (const k of keys) if (!out.has(k)) out.set(k, last);
    }
  }
  return out;
}

/** 2.5 → "+2.5", 5 → "+5". */
const plus = (n: number) => `+${Number(n.toFixed(2))}`;
/** "8 min" for whole minutes, else "1:30". */
const minutes = (seconds: number): BodyNumber => (seconds % 60 === 0 ? { value: String(seconds / 60), unit: "min" } : { value: formatClock(seconds), unit: "" });

function each(s: HubWorkoutStep): BodyNumber {
  if (s.target === "reps") return { value: String(s.count ?? 0), unit: s.count === 1 ? t("rep") : t("reps") };
  if (s.target === "time") {
    const sec = s.seconds ?? 0;
    return sec < 60 ? { value: String(sec), unit: t("s hold") } : { value: formatClock(sec), unit: t("hold") };
  }
  return { value: "", unit: t("to lap button") };
}

function load(s: HubWorkoutStep): BodyLift["load"] {
  if (s.intensity.kind === "weight" && finite(s.intensity.low)) return { value: String(Number(s.intensity.low.toFixed(2))), unit: "kg" };
  if (s.intensity.kind === "bodyweight") return "bodyweight";
  return null;
}

/** Where today's sets go past the last logged ones: a heavier weight first, else more reps or a longer hold at it. */
function upOn(s: HubWorkoutStep, name: string, history: LiftHistory | null): BodyLift["up"] {
  const last = history?.get(plain(name));
  if (!last) return undefined;
  const kg = s.intensity.kind === "weight" && finite(s.intensity.low) ? s.intensity.low : 0;
  if (kg > last.kg + 0.01) return { on: "load", by: plus(kg - last.kg) };
  if (Math.abs(kg - last.kg) >= 0.01) return undefined;
  if (s.target === "reps" && last.reps > 0 && (s.count ?? 0) > last.reps) return { on: "each", by: plus((s.count ?? 0) - last.reps) };
  if (s.target === "time" && last.seconds > 0 && (s.seconds ?? 0) > last.seconds) return { on: "each", by: `+${(s.seconds ?? 0) - last.seconds} s` };
  return undefined;
}

const extraName = (s: HubWorkoutStep, fallback: string) => s.exercise?.name ?? s.name ?? fallback;
const extraAmount = (s: HubWorkoutStep): BodyNumber => (s.target === "time" ? minutes(s.seconds ?? 0) : { value: "", unit: t("to lap button") });

/**
 * The strength workout as the card lists it. Warm-ups at the start and cool-downs at the end stand apart; every
 * other step is a line in order. A repeated block (a circuit) counts each exercise's sets once per round.
 */
export function strengthLines(w: HubWorkout, history: LiftHistory | null = null): { lifts: BodyLift[]; before: BodyExtra[]; after: BodyExtra[] } {
  const steps = w.blocks.flatMap((b) => b.steps.map((s) => ({ s, times: b.repeats ?? 1 })));
  let first = 0, last = steps.length;
  while (first < last && steps[first].s.kind === "warmup") first++;
  while (last > first && steps[last - 1].s.kind === "cooldown") last--;
  const before = steps.slice(0, first).map(({ s }) => ({ name: extraName(s, t("Warm-up")), amount: extraAmount(s) }));
  const after = steps.slice(last).map(({ s }) => ({ name: extraName(s, t("Cool-down")), amount: extraAmount(s) }));
  const lifts = steps.slice(first, last).map(({ s, times }): BodyLift => {
    if (s.kind === "rest") return { kind: "rest", name: t("Rest"), sets: 0, each: { value: "", unit: "" }, load: null, rest: s.target === "time" ? formatClock(s.seconds ?? 0) : "" };
    const name = s.exercise?.name ?? s.name ?? (s.kind === "warmup" ? t("Warm-up") : s.kind === "cooldown" ? t("Cool-down") : tx("step", "Exercise"));
    const up = upOn(s, name, history);
    return { kind: "lift", name, sets: (s.sets ?? 1) * times, each: each(s), load: load(s), rest: s.restSeconds ? formatClock(s.restSeconds) : "", ...(up ? { up } : {}) };
  });
  return { lifts, before, after };
}
