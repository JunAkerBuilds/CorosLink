// A workout Coach wrote, checked and turned into the two shapes the web holds: the builder's `Workout` (what the
// calendar and the builder open) and, for run / ride / swim, the COROS workout Training Hub takes. Pure.
// The model's format is the phone Coach's WORKOUT (CorosKit HubWorkoutAI), so both Coaches write the same thing.
import type { CardStat, CoachHue, WorkoutCard } from "@/data/coach";
import type { HubExercise, HubIntensity, HubSport, HubStepKind, HubWorkout, HubWorkoutBlock, HubWorkoutStep } from "@/data/hub";
import type { Workout } from "@/data/workouts";
import { intensityLabel } from "@/lib/hubWorkout";
import { clock as clockText } from "@/lib/format";
import { msg, t, tx } from "@/lib/i18n";
import { distance, distanceIn, distanceUnit, heightIn, imperial, inUnits, paceIn, paceUnitLabel, shortDistance, weightIn, weightUnit, type Units } from "@/lib/units";
import { expand, formatClock, stepIntensity, stepSeconds, totals, type Pacing, type Sport, type StepKind, type StepTarget, type WorkoutItem, type WorkoutStep } from "@/lib/workout";
import { hubWorkoutProblem } from "@/server/hub/rules";
import { dayOfRef, familyOf, finite, isDay, quoted, shownDay, today, type AthleteItems, type Clock } from "./items";
import { paceOf } from "./read";
import { SPORT_HUE, sportStats, workoutBody } from "./sportCard";
import type { LiftHistory } from "./strengthCard";
import type { AthleteZones } from "./zones";

/** The sports Coach can write a workout for, and the builder sport each is drawn as (null: only COROS can hold it). */
const SPORTS: Record<string, { hub: HubSport; sport: Sport | null }> = {
  run: { hub: "run", sport: "run" }, trailrun: { hub: "trailRun", sport: "run" }, bike: { hub: "bike", sport: "ride" }, ride: { hub: "bike", sport: "ride" },
  cycling: { hub: "bike", sport: "ride" }, swim: { hub: "swim", sport: "swim" }, strength: { hub: "strength", sport: "strength" }, gym: { hub: "strength", sport: "strength" },
  hyrox: { hub: "hyrox", sport: null }, xcski: { hub: "xcSki", sport: null }, indoorclimb: { hub: "indoorClimb", sport: null }, bouldering: { hub: "bouldering", sport: null },
};

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (finite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export interface CoachWorkout {
  /** The builder's shape: what this browser's calendar shows and the builder opens. Null when only COROS can hold it. */
  workout: Workout | null;
  /** The same workout for the COROS calendar. Null for a gym workout whose exercises aren't from COROS's list. */
  hub: HubWorkout | null;
  name: string;
  sport: HubSport;
  /**
   * The workout step by step whether or not COROS can hold it, for the card's picture: a gym exercise that isn't
   * from COROS's list carries its name in the step's `name`. Never saved.
   */
  draft?: HubWorkout;
}

const KINDS: Record<string, HubStepKind> = { warmup: "warmup", "warm-up": "warmup", training: "training", work: "training", interval: "training", rest: "rest", recovery: "rest", recover: "rest", cooldown: "cooldown", "cool-down": "cooldown" };
const INTENSITY_KINDS = ["none", "heartRate", "pace", "power", "speed", "cadence", "stroke", "bodyweight", "weight", "rpe", "grade"] as const;
const STROKES = ["freestyle", "breaststroke", "backstroke", "butterfly", "mix", "individualMedley", "drills"] as const;
const TARGETS = ["time", "distance", "open", "reps", "load", "hrRecovery", "elevationGain", "routes"] as const;
const GRADE_SYSTEMS = ["yds", "french", "uiaa", "ewbank", "vScale", "font"] as const;

function intensityOf(raw: unknown): HubIntensity | string {
  if (raw === undefined || raw === null) return { kind: "none" };
  if (!isBag(raw)) return "a step's intensity must be an object.";
  const kind = INTENSITY_KINDS.find((k) => k === raw.kind);
  if (!kind) return `intensity kind "${quoted(String(raw.kind), 20)}" isn't one a step can carry.`;
  const out: HubIntensity = { kind };
  const low = num(raw.low), high = num(raw.high), offset = num(raw.gradeOffset);
  if (low !== undefined) out.low = low;
  if (high !== undefined) out.high = high;
  if (kind === "stroke") { const s = STROKES.find((x) => x === raw.stroke); if (s) out.stroke = s; }
  if (kind === "grade") { if (offset !== undefined) out.gradeOffset = Math.round(offset); else if (typeof raw.grade === "string") out.grade = raw.grade.slice(0, 8); }
  return out;
}

/* ───────────── COROS's exercise list ───────────── */

const plain = (text: string): string => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const wordsOf = (text: string): string[] => plain(text).split(" ").filter((w) => w.length > 1).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/** Exercises whose names share the most words with `query` ("squat, lunge, hamstrings"), best first. */
export function searchExercises(catalog: readonly HubExercise[], query: string, limit = 60): HubExercise[] {
  const wanted = new Set(wordsOf(query));
  if (!wanted.size) return [];
  return catalog
    .map((e) => { const own = wordsOf(e.name); return { e, score: own.filter((w) => wanted.has(w)).length, size: own.length }; })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.size - b.size || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e);
}

/** The catalog exercise with exactly this name (case, accents and punctuation forgiven), never a near one. */
export function findExercise(catalog: readonly HubExercise[], name: string): HubExercise | null {
  const wanted = plain(name);
  return wanted ? catalog.find((e) => plain(e.name) === wanted) ?? null : null;
}

interface RawStep { step: HubWorkoutStep; exercise: string; weightKg?: number }

function stepOf(raw: unknown, sport: HubSport, catalog: readonly HubExercise[] | null): RawStep | string {
  if (!isBag(raw)) return "a step must be an object.";
  const strength = sport === "strength" || sport === "hyrox";
  const kind = KINDS[String(raw.kind ?? "training").toLowerCase()] ?? "training";
  const intensity = intensityOf(raw.intensity);
  if (typeof intensity === "string") return intensity;
  const seconds = num(raw.seconds), meters = num(raw.meters), count = num(raw.count), sets = num(raw.sets), rest = num(raw.restSeconds), load = num(raw.load), bpm = num(raw.bpm);
  const target = TARGETS.find((x) => x === raw.target) ?? (meters !== undefined ? "distance" : seconds !== undefined ? "time" : count !== undefined ? "reps" : null);
  if (!target) return "each step needs a target: time (seconds), distance (meters), reps (count), open, load, hrRecovery (bpm), elevationGain (meters) or routes (count).";
  const exercise = quoted(typeof raw.exercise === "string" ? raw.exercise : isBag(raw.exercise) ? raw.exercise.name : "", 80);
  const step: HubWorkoutStep = { kind, target, intensity };
  if (target === "time") { if (!(seconds !== undefined && seconds >= 1 && seconds <= 86_399)) return "a time step needs seconds between 1 and 86399."; step.seconds = Math.round(seconds); }
  if (target === "distance" || target === "elevationGain") { if (!(meters !== undefined && meters > 0 && meters <= 1_000_000)) return `a ${target === "distance" ? "distance" : "elevation gain"} step needs meters above 0.`; step.meters = Math.round(meters); }
  if (target === "reps" || target === "routes") { if (!(count !== undefined && count >= 1 && count <= 500)) return `a ${target} step needs count, 1 or more.`; step.count = Math.round(count); }
  if (target === "load") { if (!(load !== undefined && load >= 0 && load <= 999)) return "a load step needs load between 0 and 999."; step.load = Math.round(load); }
  if (target === "hrRecovery") { if (!(bpm !== undefined && bpm >= 30 && bpm <= 180)) return "an hrRecovery step needs bpm between 30 and 180."; step.bpm = Math.round(bpm); }
  if (sport === "strength" && kind === "training" && !exercise) return "every strength training step needs \"exercise\", the exercise's name.";
  if (exercise && strength && kind === "training" && catalog) {
    const found = findExercise(catalog, exercise);
    if (!found) {
      const near = searchExercises(catalog, exercise, 6).map((e) => e.name);
      return `COROS has no exercise “${exercise}”.${near.length ? ` Closest: ${near.join("; ")}.` : ""} Use a name from search_exercises exactly as it is written.`;
    }
    step.exercise = found;
  }
  if (sets !== undefined) { if (!(sets >= 1 && sets <= 99)) return "sets go from 1 to 99."; step.sets = Math.round(sets); }
  if (rest !== undefined && rest >= 0 && rest <= 1800) step.restSeconds = Math.round(rest);
  const name = quoted(raw.name, 60);
  if (name && !step.exercise) step.name = name;
  return { step, exercise: step.exercise?.name ?? exercise, weightKg: intensity.kind === "weight" && finite(intensity.low) ? intensity.low : undefined };
}

const paceText = (s: number) => clockText(s, s % 1 ? 2 : 0);

function targetOf(i: HubIntensity): StepTarget {
  if (i.kind === "none") return { type: "none" };
  if (i.kind === "pace" && finite(i.low) && i.low > 0) return { type: "pace", fast: Math.min(i.low, i.high ?? i.low), slow: Math.max(i.low, i.high ?? i.low) };
  return { type: "kept", label: intensityLabel(i) };
}

/** A strength step's time, counted the way a set goes: about three seconds a rep, the rest between sets. */
function gymSeconds(s: HubWorkoutStep): number {
  const sets = s.sets ?? 1, rest = s.restSeconds ?? 90;
  const one = s.target === "time" ? s.seconds ?? 0 : s.target === "reps" ? (s.count ?? 0) * 3 : 60;
  return Math.max(1, Math.round(sets * one + Math.max(0, sets - 1) * rest));
}

function gymStep(r: RawStep, id: string): WorkoutStep {
  const s = r.step;
  const kind: StepKind = s.kind === "warmup" ? "warmup" : s.kind === "cooldown" ? "cooldown" : s.kind === "training" ? "work" : "rest";
  const sets = s.sets ?? 1;
  const amount = s.target === "reps" ? `${sets} × ${s.count}` : s.target === "time" ? `${sets} × ${formatClock(s.seconds ?? 0)}` : `${sets} × open`;
  const load = r.weightKg !== undefined ? ` · ${r.weightKg} kg` : s.intensity.kind === "bodyweight" ? " · bodyweight" : "";
  const label = r.exercise ? `${r.exercise} · ${amount}${load}` : s.name;
  return { type: "step", id, kind, length: { type: "time", seconds: gymSeconds(s) }, target: { type: "none" }, ...(label ? { label } : {}) };
}

/** A run, ride or swim step in the builder's shape, or null when it ends on something the builder can't hold. */
function builderStep(r: RawStep, id: string): WorkoutStep | null {
  const s = r.step;
  const kind: StepKind = s.kind === "warmup" ? "warmup" : s.kind === "cooldown" ? "cooldown" : s.kind === "training" ? "work" : s.target === "distance" || s.intensity.kind !== "none" ? "recovery" : "rest";
  if (s.target !== "distance" && s.target !== "time") return null;
  const length = s.target === "distance"
    ? { type: "distance" as const, metres: s.meters!, unit: (s.meters! < 1000 || s.meters! % 100 !== 0 ? "m" : "km") as "m" | "km" }
    : { type: "time" as const, seconds: s.seconds! };
  return { type: "step", id, kind, length, target: targetOf(s.intensity), ...(s.name ? { label: s.name } : {}) };
}

/**
 * Reads the model's WORKOUT. Returns the workout in the shapes the web can hold, or the reason it can't be
 * planned, written for the model to fix and send again. `catalog` is COROS's exercise list when Training Hub
 * could be read: strength exercises are then matched to it, so the workout can go to COROS and the watch.
 */
export function parseWorkout(raw: unknown, date: string, id: string, catalog: readonly HubExercise[] | null = null): CoachWorkout | { error: string } {
  let value = raw;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return { error: "workout must be a JSON object." }; } }
  if (!isBag(value)) return { error: "workout must be a JSON object in the WORKOUT format." };
  const which = SPORTS[String(value.sport ?? "").toLowerCase()];
  if (!which) return { error: "sport must be run, trailRun, bike, swim, strength, hyrox, xcSki, indoorClimb or bouldering." };
  const name = quoted(value.name, 60);
  if (!name) return { error: "the workout needs a name." };
  const blocksIn = Array.isArray(value.blocks) ? value.blocks : Array.isArray(value.steps) ? value.steps.map((s) => ({ steps: [s] })) : null;
  if (!blocksIn || !blocksIn.length) return { error: "the workout needs blocks, each with steps." };
  if (blocksIn.length > 60) return { error: "a workout holds at most 60 blocks." };
  const strength = which.sport === "strength";
  const blocks: HubWorkoutBlock[] = [], drawn: HubWorkoutBlock[] = [], items: WorkoutItem[] = [];
  const drawnStep = (p: RawStep): HubWorkoutStep => (p.step.exercise || !p.exercise ? p.step : { ...p.step, name: p.exercise });
  let n = 0, fits = which.sport !== null;
  for (const b of blocksIn) {
    if (!isBag(b) || !Array.isArray(b.steps) || !b.steps.length || b.steps.length > 20) return { error: "each block needs 1 to 20 steps." };
    const parsed: RawStep[] = [];
    for (const s of b.steps) {
      const step = stepOf(s, which.hub, catalog);
      if (typeof step === "string") return { error: step };
      parsed.push(step);
    }
    const made = parsed.map((p) => (strength ? gymStep(p, `${id}-s${n++}`) : builderStep(p, `${id}-s${n++}`)));
    const whole = made.filter((m): m is WorkoutStep => m !== null);
    if (whole.length !== made.length) fits = false;
    const repeats = num(b.repeats ?? b.repeat);
    if (repeats !== undefined && repeats > 1) {
      if (!(Number.isInteger(repeats) && repeats <= 99)) return { error: "repeats go from 2 to 99." };
      blocks.push({ repeats, steps: parsed.map((p) => p.step) });
      drawn.push({ repeats, steps: parsed.map(drawnStep) });
      items.push({ type: "repeat", id: `${id}-b${n++}`, count: repeats, steps: whole });
    } else {
      for (const p of parsed) { blocks.push({ repeats: null, steps: [p.step] }); drawn.push({ repeats: null, steps: [drawnStep(p)] }); }
      items.push(...whole);
    }
  }
  const system = GRADE_SYSTEMS.find((g) => g === value.gradeSystem);
  const hub: HubWorkout = { name, sport: which.hub, description: quoted(value.description, 300), blocks, ...(system ? { gradeSystem: system } : {}) };
  const workout: Workout | null = fits && which.sport ? { id, name, sport: which.sport, date, repeatWeeks: 1, items } : null;
  const draft: HubWorkout = { ...hub, blocks: drawn };
  const problem = hubWorkoutProblem(hub, () => false);
  if (strength && (problem || !catalog)) {
    // Without COROS's exercise list (Training Hub not connected) a gym workout stays in this browser's calendar.
    if (!workout) return { error: `this strength workout can't be planned: ${problem ?? "its steps aren't ones the web can hold."}` };
    return { workout, hub: null, name, sport: which.hub, draft };
  }
  if (problem) return { error: `COROS wouldn't take this workout: ${problem}` };
  return { workout, hub, name, sport: which.hub, draft };
}

/* ───────────── Pacing: this athlete's own speeds, for the card's time and distance ───────────── */

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * What a workout's totals are worked out with: threshold pace for a runner when the phone sent it, else the
 * middle pace of the athlete's own recent activities in the sport. Null when there is neither; then the card
 * shows only what the steps themselves say.
 */
export function pacingFor(items: AthleteItems, clock: Clock, sport: Sport): Pacing | null {
  if (sport === "strength") return { zonePace: [600, 600, 600, 600, 600], easyPace: 600, still: true };
  const th = items.training?.thresholdPaceSecPerKm;
  if (sport === "run" && finite(th) && th > 120 && th < 900) return { zonePace: [th * 1.38, th * 1.25, th * 1.12, th, th * 0.92], easyPace: th * 1.45 };
  const from = today(clock);
  const paces = items.activities.filter((a) => familyOf(a.sport) === sport && dayOfRef(a.start ?? 0, clock) <= from).slice(0, 12).map(paceOf).filter((p): p is number => p !== null);
  if (paces.length < 3) return null;
  const m = median(paces);
  return { zonePace: [m * 1.1, m, m * 0.93, m * 0.86, m * 0.8], easyPace: m * 1.15 };
}

/* ───────────── The card ───────────── */

const KIND_WORDS: Record<StepKind, string> = { warmup: msg("Warm up"), work: msg("Work"), recovery: msg("Recovery"), rest: msg("Rest"), cooldown: msg("Cool down") };
const KIND_HUE: Record<StepKind, CoachHue> = { warmup: "cyan", work: "mint", recovery: "blue", rest: "violet", cooldown: "cyan" };
const KIND_HEIGHT: Record<StepKind, number> = { warmup: 0.42, cooldown: 0.42, work: 0.78, recovery: 0.3, rest: 0.16 };
const SPORT_TITLE: Record<Sport, string> = { run: msg("Run"), ride: msg("Ride"), swim: msg("Swim"), strength: msg("Strength") };

/** A step's length: as the model wrote it, or in the athlete's units when `shown`. */
function lengthText(step: WorkoutStep, shown = false): string {
  if (step.length.type === "time") return formatClock(step.length.seconds);
  if (shown && imperial()) return step.length.unit === "km" ? distance(step.length.metres, 2) : shortDistance(step.length.metres, 2);
  return step.length.unit === "km" ? `${(step.length.metres / 1000).toFixed(2)} km` : `${Math.round(step.length.metres)} m`;
}

/** A step's target in words: English and metric for the model, or in the app's language and units when `shown`. */
function targetText(target: StepTarget, shown = false): string {
  if (target.type === "pace" && shown && imperial()) {
    const per = (s: number) => clockText(paceIn(s), s % 1 ? 2 : 0);
    return target.fast === target.slow ? `${per(target.fast)} ${paceUnitLabel()}` : t("{fast} to {slow} /mi", { fast: per(target.fast), slow: per(target.slow) });
  }
  if (target.type === "pace") {
    if (target.fast === target.slow) return `${paceText(target.fast)} /km`;
    return shown ? t("{fast} to {slow} /km", { fast: paceText(target.fast), slow: paceText(target.slow) }) : `${paceText(target.fast)} to ${paceText(target.slow)} /km`;
  }
  if (target.type === "hr") return shown ? t("Zone {zone}", { zone: target.zone }) : `Zone ${target.zone}`;
  if (target.type === "kept") return target.label;
  return "";
}

const HUB_SPORT_TITLE: Record<HubSport, string> = {
  run: msg("Run"), trailRun: msg("Trail run"), bike: msg("Ride"), swim: msg("Swim"), strength: msg("Strength"), hyrox: "HYROX", xcSki: msg("Ski"), indoorClimb: msg("Climb"), bouldering: msg("Bouldering"),
};
const HUB_KIND: Record<HubStepKind, StepKind> = { warmup: "warmup", training: "work", rest: "rest", cooldown: "cooldown" };

/** How long a COROS step is, in words: English for the model, or in the app's language when `shown`. */
export function hubLength(s: HubWorkoutStep, shown = false): string {
  const sets = s.sets && s.sets > 1 ? `${s.sets} × ` : "";
  switch (s.target) {
    case "time": return `${sets}${formatClock(s.seconds ?? 0)}`;
    case "distance":
      if (shown && imperial()) return (s.meters ?? 0) >= 1000 ? distance(s.meters ?? 0, 2) : shortDistance(s.meters ?? 0, 2);
      return (s.meters ?? 0) >= 1000 ? `${((s.meters ?? 0) / 1000).toFixed(2)} km` : `${Math.round(s.meters ?? 0)} m`;
    case "reps": return `${s.sets ?? 1} × ${s.count ?? 0}`;
    case "routes": return shown ? (s.count === 1 ? tx("climbing", "1 route") : tx("climbing", "{n} routes", { n: s.count ?? 0 })) : `${s.count ?? 0} routes`;
    case "load": return shown ? t("load {n}", { n: s.load ?? 0 }) : `load ${s.load ?? 0}`;
    case "hrRecovery": return shown ? t("until {n} bpm", { n: s.bpm ?? 0 }) : `until ${s.bpm ?? 0} bpm`;
    case "elevationGain": return shown && imperial() ? `+${Math.round(heightIn(s.meters ?? 0))} ft` : `+${Math.round(s.meters ?? 0)} m`;
    case "open": return `${sets}${shown ? t("open") : "open"}`;
  }
}

/** A weight in kilograms in the athlete's units, to a tenth of a pound. */
const shownKg = (kg: number) => (imperial() ? `${Number(weightIn(kg).toFixed(1))} ${weightUnit()}` : `${kg} kg`);

const hubTarget = (i: HubIntensity, shown = false): string =>
  i.kind === "none" || i.kind === "kept" ? "" : i.kind === "pace" && finite(i.low) ? targetText(targetOf(i), shown) : i.kind === "bodyweight" ? (shown ? t("bodyweight") : "bodyweight") : i.kind === "weight" ? (shown ? shownKg(i.low ?? 0) : `${i.low ?? 0} kg`) : intensityLabel(i);

/** "Run · suggested", "Run · change": the workout card's eyebrow. */
const eyebrowOf = (sport: string, change: boolean) => (change ? t("{sport} · change", { sport: t(sport) }) : t("{sport} · suggested", { sport: t(sport) }));
const stepsWord = (n: number) => (n === 1 ? t("1 step") : t("{n} steps", { n }));

/** A COROS workout step by step, for the model to read before it changes one. */
export function describeHubWorkout(w: HubWorkout): string {
  const line = (s: HubWorkoutStep) => [s.exercise?.name ?? s.name ?? s.kind, hubLength(s), hubTarget(s.intensity), s.restSeconds ? `rest ${s.restSeconds} s` : ""].filter(Boolean).join(" · ");
  const out = [`"${quoted(w.name)}" · ${w.sport}${w.description ? ` · ${quoted(w.description, 200)}` : ""}`];
  w.blocks.forEach((b, i) => {
    if (b.repeats === null) out.push(`${i + 1}. ${b.steps[0] ? `${b.steps[0].kind}: ${line(b.steps[0])}` : "(empty)"}`);
    else { out.push(`${i + 1}. ${b.repeats} × repeat:`); for (const s of b.steps) out.push(`   - ${s.kind}: ${line(s)}`); }
  });
  return out.join("\n");
}

/** The builder's workout step by step, for the same purpose. */
export function describeBuilderWorkout(w: Workout): string {
  const line = (s: WorkoutStep) => [s.label ?? KIND_WORDS[s.kind], lengthText(s), targetText(s.target)].filter(Boolean).join(" · ");
  const out = [`"${quoted(w.name)}" · ${w.sport}`];
  w.items.forEach((item, i) => {
    if (item.type === "step") out.push(`${i + 1}. ${line(item)}`);
    else { out.push(`${i + 1}. ${item.count} × repeat:`); for (const s of item.steps) out.push(`   - ${line(s)}`); }
  });
  return out.join("\n");
}

/** `units`: the athlete's, when a server draws the card for them; absent draws in the page's own. */
export interface CardInput { id: string; date: string; note?: unknown; replaces?: WorkoutCard["replaces"]; units?: Units }

/** The card for a workout only COROS can hold (open steps, HYROX, climbing): its steps as COROS has them. */
function hubCard(hub: HubWorkout, drawn: HubWorkout, input: CardInput, zones: AthleteZones | null, lifts: LiftHistory | null): WorkoutCard {
  const steps: WorkoutCard["steps"] = [];
  const seen = new Map<string, number>();
  const unique = (name: string) => { const k = (seen.get(name) ?? 0) + 1; seen.set(name, k); return k === 1 ? name : `${name} (${k})`; };
  let seconds = 0, metres = 0, sets = 0, open = false;
  for (const b of hub.blocks) {
    const times = b.repeats ?? 1;
    for (const s of b.steps) {
      const kind = HUB_KIND[s.kind];
      const own = s.target === "time" ? (s.seconds ?? 0) * (s.sets ?? 1) : s.target === "distance" ? ((s.meters ?? 0) / 1000) * 330 : s.target === "reps" ? gymSeconds(s) : 120;
      if (s.target === "time") seconds += (s.seconds ?? 0) * (s.sets ?? 1) * times;
      if (s.target === "distance") metres += (s.meters ?? 0) * times;
      if (s.exercise || s.sets) sets += (s.sets ?? 1) * times;
      if (s.target === "open") open = true;
      steps.push({
        name: unique(`${times > 1 ? `${times} × ` : ""}${s.exercise?.name ?? s.name ?? t(KIND_WORDS[kind])}`), length: hubLength(s, true), target: hubTarget(s.intensity, true), note: "",
        hue: KIND_HUE[kind], weight: Math.max(1, Math.round(own * times)), height: KIND_HEIGHT[kind], soft: kind !== "work" || undefined,
      });
    }
  }
  const stats: CardStat[] = [];
  if (metres > 0) stats.push({ label: t("Distance"), value: distanceIn(metres).toFixed(2), unit: distanceUnit() });
  if (seconds > 0) stats.push({ label: metres > 0 || open ? t("Timed steps") : t("Time"), value: formatClock(seconds) });
  if (sets > 0) stats.push({ label: t("Sets"), value: String(sets) });
  const body = workoutBody(drawn, { zones, lifts });
  return {
    kind: "workout", id: input.id, eyebrow: eyebrowOf(HUB_SPORT_TITLE[hub.sport], !!input.replaces), title: hub.name, date: input.date, dayLabel: isDay(input.date) ? shownDay(input.date) : input.date,
    stats: sportStats(drawn, body, { zones, lifts }) ?? stats, steps, shapeLabel: t("The workout's shape: {steps}", { steps: steps.map((s) => s.name).join(", ") }), summary: stepsWord(steps.length), note: quoted(input.note, 240),
    hue: SPORT_HUE[hub.sport], sport: hub.sport, body,
    hub, ...(input.replaces ? { replaces: input.replaces } : {}),
  };
}

/** A gym line's weight ("60 kg", as the builder keeps it) in the athlete's units. */
const gymLoad = (text: string) => { const kg = /^(\d+(?:\.\d+)?) kg$/.exec(text); return kg && imperial() ? shownKg(Number(kg[1])) : text; };

export function workoutCard(made: CoachWorkout, pacing: Pacing | null, input: CardInput, zones: AthleteZones | null = null, lifts: LiftHistory | null = null): WorkoutCard {
  return inUnits(input.units, () => drawWorkoutCard(made, pacing, input, zones, lifts));
}

function drawWorkoutCard(made: CoachWorkout, pacing: Pacing | null, input: CardInput, zones: AthleteZones | null, lifts: LiftHistory | null): WorkoutCard {
  if (!made.workout) return hubCard(made.hub!, made.draft ?? made.hub!, input, zones, lifts);
  const w = made.workout, strength = w.sport === "strength";
  const steps: WorkoutCard["steps"] = [];
  const seen = new Map<string, number>();
  const unique = (name: string) => { const k = (seen.get(name) ?? 0) + 1; seen.set(name, k); return k === 1 ? name : `${name} (${k})`; };
  const row = (s: WorkoutStep, times: number) => {
    const seconds = pacing ? stepSeconds(s, pacing) : s.length.type === "time" ? s.length.seconds : (s.length.metres / 1000) * 330;
    const gym = strength && s.label?.includes(" · ") ? s.label.split(" · ") : null;
    steps.push({
      name: unique(`${times > 1 ? `${times} × ` : ""}${gym ? gym[0] : s.label || t(KIND_WORDS[s.kind])}`),
      length: gym ? gym[1] ?? "" : lengthText(s, true), target: gym ? gymLoad(gym[2] ?? "") : targetText(s.target, true), note: gym || !s.label ? "" : t(KIND_WORDS[s.kind]),
      hue: KIND_HUE[s.kind], weight: Math.max(1, Math.round(seconds * times)), height: pacing && !strength ? stepIntensity(s, pacing) : KIND_HEIGHT[s.kind],
      soft: s.kind !== "work" || undefined,
    });
  };
  for (const item of w.items) {
    if (item.type === "step") row(item, 1);
    else for (const s of item.steps) row(s, item.count);
  }
  const all = expand(w.items);
  const timed = all.every((s) => s.length.type === "time"), measured = all.every((s) => s.length.type === "distance");
  const stats: CardStat[] = [];
  let summary = stepsWord(steps.length);
  if (pacing) {
    const sum = totals(w.items, pacing);
    stats.push({ label: timed ? t("Time") : t("Time, about"), value: formatClock(sum.seconds) });
    if (sum.metres >= 1) stats.push({ label: measured ? t("Distance") : t("Distance, about"), value: distanceIn(sum.metres).toFixed(2), unit: distanceUnit() });
    if (!strength) stats.push({ label: t("Load, about"), value: String(sum.load), hue: "pink" });
    summary = sum.metres >= 1 ? `${distanceIn(sum.metres).toFixed(2)} ${distanceUnit()} · ${formatClock(sum.seconds)}` : formatClock(sum.seconds);
  } else if (timed) {
    const seconds = all.reduce((sum, s) => sum + (s.length.type === "time" ? s.length.seconds : 0), 0);
    stats.push({ label: t("Time"), value: formatClock(seconds) });
    summary = formatClock(seconds);
  } else if (measured) {
    const metres = all.reduce((sum, s) => sum + (s.length.type === "distance" ? s.length.metres : 0), 0);
    stats.push({ label: t("Distance"), value: distanceIn(metres).toFixed(2), unit: distanceUnit() });
    summary = `${distanceIn(metres).toFixed(2)} ${distanceUnit()}`;
  }
  if (strength) stats.push({ label: t("Exercises"), value: String(all.filter((s) => s.kind === "work").length) });
  const draft = made.draft ?? made.hub, athlete = { pacing: strength ? null : pacing, zones, lifts };
  const body = draft ? workoutBody(draft, athlete) : undefined;
  return {
    kind: "workout", id: input.id, eyebrow: eyebrowOf(made.sport === "trailRun" ? HUB_SPORT_TITLE.trailRun : SPORT_TITLE[w.sport], !!input.replaces), title: w.name, date: input.date, dayLabel: isDay(input.date) ? shownDay(input.date) : input.date,
    stats: (draft && body ? sportStats(draft, body, athlete) : null) ?? stats, steps, shapeLabel: t("The workout's shape: {steps}", { steps: steps.map((s) => s.name).join(", ") }), summary, note: quoted(input.note, 240),
    hue: SPORT_HUE[made.sport], sport: made.sport, ...(body ? { body } : {}),
    workout: w, hub: made.hub ?? undefined, ...(input.replaces ? { replaces: input.replaces } : {}), ...(pacing ? { totals: { metres: Math.round(totals(w.items, pacing).metres), load: totals(w.items, pacing).load } } : {}),
  };
}
