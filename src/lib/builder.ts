/**
 * The Structured workout builder, without the screen: what a workout of each COROS sport is made of, the
 * checks before it is saved, its totals and shape, and the way to and from a COROS workout. What a sport may
 * hold comes from `@/server/hub/rules`, the rules the server checks with; this file only adds what the builder
 * shows that the server can't save yet (percentage targets, effort pace, swim send-offs), and marks it so.
 */
import type {
  HubClimbSystem, HubExercise, HubIntensity, HubIntensityKind, HubSport, HubStepKind, HubStepTarget, HubStroke, HubWorkout, HubWorkoutBlock, HubWorkoutStep,
} from "@/data/hub";
import { thousands } from "@/lib/format";
import { intensityLabel } from "@/lib/hubWorkout";
import {
  formatClock, paceIntensity, parseClock, shapePaths, type Pacing, type ShapeBucket, type ShapeSegment, type Sport, type StepKind, type StepTarget,
  type WorkoutItem, type WorkoutStep,
} from "@/lib/workout";
import { HUB_CLIMB_GRADES, defaultGradeSystem, hubIntensitiesFor, hubTargetsFor, hubWorkoutProblem, isClimb } from "@/server/hub/rules";

/* ───────────── The workout being built ───────────── */

/** A step's kind. `sendOff` is the pool swim send-off, which COROS has and this app can't save yet. */
export type BuilderKind = HubStepKind | "sendOff";
/** Targets CorosLink's builder offers that the server here doesn't write yet. */
export type UnwiredIntensity = "heartRatePercent" | "thresholdPacePercent" | "effortPacePercent" | "effortPace" | "ftpPercent";
export type BuilderIntensityKind = HubIntensityKind | UnwiredIntensity;
export type HeartBasis = "maxHr" | "reserve" | "lthr";

export interface BuilderIntensity extends Omit<HubIntensity, "kind"> {
  kind: BuilderIntensityKind;
  /** % Heart Rate: what the percentage is of. */
  basis?: HeartBasis;
  /** Percentage targets: a zone's key, or "custom" with `low`/`high` as the percentages. */
  zone?: string;
}

export interface BuilderStep {
  type: "step";
  /** This page's own id for the row. */
  id: string;
  /** COROS's id for the step when it was read from COROS; sent back so COROS keeps what this page can't show. */
  coros?: string;
  kind: BuilderKind;
  target: HubStepTarget;
  seconds?: number;
  meters?: number;
  count?: number;
  load?: number;
  bpm?: number;
  intensity: BuilderIntensity;
  name?: string;
  exercise?: HubExercise;
  /** HYROX: a station (an exercise from COROS's list) instead of a run. */
  station?: boolean;
  sets?: number;
  restSeconds?: number;
  /** Send-off: leave every this many seconds. */
  sendOffSeconds?: number;
}

export interface BuilderRepeat {
  type: "repeat";
  id: string;
  coros?: string;
  count: number;
  steps: BuilderStep[];
}

export type BuilderItem = BuilderStep | BuilderRepeat;

export interface BuilderDoc {
  name: string;
  sport: HubSport;
  description: string;
  items: BuilderItem[];
  /** Pool swim: the pool's length in metres. */
  poolLength?: number;
  gradeSystem?: HubClimbSystem;
}

/** The athlete's own numbers, for the "Derived:" line under a percentage target. */
export interface AthleteNumbers {
  maxHr?: number;
  restingHr?: number;
  lthr?: number;
  /** Seconds per km. */
  thresholdPace?: number;
  ftp?: number;
}

export const DEFAULT_NAME = "Structured Workout";
export const DESCRIPTION_MAX = 300;
export const DEFAULT_POOL = 25;
export const REST_CHIPS: readonly number[] = [30, 45, 60, 90, 120];
export const QUICK_DISTANCES: readonly number[] = [5, 8, 10, 21.1];

/* ───────────── Sports, kinds, targets, intensities ───────────── */

/** The sports in the order the builder lists them. */
export const SPORTS: readonly { sport: HubSport; label: string }[] = [
  { sport: "run", label: "Run" }, { sport: "bike", label: "Bike" }, { sport: "swim", label: "Pool Swim" },
  { sport: "strength", label: "Strength" }, { sport: "trailRun", label: "Trail Run" }, { sport: "indoorClimb", label: "Indoor Climb" },
  { sport: "bouldering", label: "Bouldering" }, { sport: "xcSki", label: "XC Ski" }, { sport: "hyrox", label: "HYROX" },
];

export const sportLabel = (sport: HubSport): string => SPORTS.find((s) => s.sport === sport)?.label ?? sport;
export const isSport = (value: unknown): value is HubSport => SPORTS.some((s) => s.sport === value);

/** The calendar draws four sports; the rest take the nearest one's colour. */
export function calendarSport(sport: HubSport): Sport {
  if (sport === "bike") return "ride";
  if (sport === "swim") return "swim";
  if (sport === "run" || sport === "trailRun" || sport === "xcSki") return "run";
  return "strength";
}

export const KIND_LABEL: Record<BuilderKind, string> = { warmup: "Warm-up", training: "Training", rest: "Rest", cooldown: "Cool-down", sendOff: "Send-off" };

export function kindsFor(sport: HubSport): BuilderKind[] {
  return sport === "swim" ? ["warmup", "training", "rest", "cooldown", "sendOff"] : ["warmup", "training", "rest", "cooldown"];
}

/** Repeat blocks are not offered for strength. */
export const allowsRepeats = (sport: HubSport): boolean => sport !== "strength";

const hubKind = (kind: BuilderKind): HubStepKind => (kind === "sendOff" ? "training" : kind);

/** A step laid out as a card: an exercise with sets, per set and load (a strength exercise, a HYROX station). */
export function isCard(step: BuilderStep, sport: HubSport): boolean {
  return step.kind === "training" && (sport === "strength" || (sport === "hyrox" && step.station === true));
}

export const TARGET_LABEL: Record<HubStepTarget, string> = {
  distance: "Distance", time: "Time", load: "Training Load", open: "Open", hrRecovery: "HR Recovery", elevationGain: "Elevation Gain", reps: "Reps", routes: "Routes",
};
/** What a card's "Per set" is counted in. */
export const PER_SET_LABEL: Partial<Record<HubStepTarget, string>> = { reps: "reps", time: "seconds", distance: "metres", open: "to lap button" };
export const OPEN_TEXT = "Ends when you press the lap button";

const TARGET_ORDER: readonly HubStepTarget[] = ["reps", "routes", "distance", "time", "load", "open", "hrRecovery", "elevationGain"];

const stationKind = (step: BuilderStep): number | undefined => (step.station ? step.exercise?.kind : undefined);

/** What a step may end on, in the order the builder lists it. */
export function targetsFor(sport: HubSport, step: Pick<BuilderStep, "kind" | "station" | "exercise">): HubStepTarget[] {
  const allowed = hubTargetsFor(sport, hubKind(step.kind), stationKind(step as BuilderStep));
  // A HYROX station is counted per set; training load is for its runs.
  const list = sport === "hyrox" && step.station ? allowed.filter((t) => t !== "load") : allowed;
  return TARGET_ORDER.filter((t) => list.includes(t));
}

export const INTENSITY_LABEL: Record<BuilderIntensityKind, string> = {
  none: "Not set", heartRate: "Heart Rate", heartRatePercent: "% Heart Rate", thresholdPacePercent: "% Threshold Pace", ftpPercent: "% FTP", pace: "Pace",
  effortPacePercent: "% Effort Pace", effortPace: "Effort Pace", speed: "Speed", power: "Power", cadence: "Cadence", stroke: "Stroke",
  bodyweight: "Bodyweight", weight: "Weight", rpe: "RPE", grade: "Grade", kept: "From COROS",
};

const INTENSITY_ORDER: readonly BuilderIntensityKind[] = [
  "none", "heartRate", "heartRatePercent", "thresholdPacePercent", "ftpPercent", "pace", "effortPacePercent", "effortPace", "speed", "power", "cadence",
  "stroke", "weight", "bodyweight", "rpe", "grade",
];
const RUN_EXTRA: readonly UnwiredIntensity[] = ["heartRatePercent", "thresholdPacePercent", "effortPacePercent", "effortPace"];
const UNWIRED: readonly BuilderIntensityKind[] = ["heartRatePercent", "thresholdPacePercent", "effortPacePercent", "effortPace", "ftpPercent"];
export const isUnwired = (kind: BuilderIntensityKind): kind is UnwiredIntensity => UNWIRED.includes(kind);

/** The targets a step may carry: the server's list for the sport, with the ones only CorosLink writes so far. */
export function intensitiesFor(sport: HubSport, step: Pick<BuilderStep, "kind" | "station" | "exercise">): BuilderIntensityKind[] {
  const station = stationKind(step as BuilderStep);
  const wired: BuilderIntensityKind[] = hubIntensitiesFor(sport, hubKind(step.kind), station);
  let extra: readonly UnwiredIntensity[] = [];
  if (sport === "run" || sport === "trailRun" || (sport === "hyrox" && !step.station)) extra = RUN_EXTRA;
  else if (sport === "bike") extra = ["heartRatePercent", "ftpPercent"];
  else if (sport === "xcSki") extra = ["heartRatePercent"];
  const all = new Set<BuilderIntensityKind>([...wired, ...extra]);
  return INTENSITY_ORDER.filter((k) => all.has(k));
}

export const STROKES: readonly { stroke: HubStroke; label: string }[] = [
  { stroke: "freestyle", label: "Freestyle" }, { stroke: "breaststroke", label: "Breaststroke" }, { stroke: "backstroke", label: "Backstroke" },
  { stroke: "butterfly", label: "Butterfly" }, { stroke: "drills", label: "Drills" }, { stroke: "individualMedley", label: "Individual Medley" },
  { stroke: "mix", label: "Mix" },
];

export const GRADE_SYSTEMS: readonly { system: HubClimbSystem; label: string }[] = [
  { system: "yds", label: "YDS" }, { system: "french", label: "French" }, { system: "uiaa", label: "UIAA" },
  { system: "ewbank", label: "Ewbank" }, { system: "vScale", label: "V-Scale" }, { system: "font", label: "Font" },
];

export const gradeSystemOf = (doc: Pick<BuilderDoc, "sport" | "gradeSystem">): HubClimbSystem => doc.gradeSystem ?? defaultGradeSystem(doc.sport);
export const gradesOf = (doc: Pick<BuilderDoc, "sport" | "gradeSystem">): readonly string[] => HUB_CLIMB_GRADES[gradeSystemOf(doc)];

/* ───────────── Percentage zones (CorosLink's presets) ───────────── */

export interface Zone { key: string; label: string; low: number; high: number }

const zones = (rows: [string, string, number, number][]): Zone[] => rows.map(([key, label, low, high]) => ({ key, label, low, high }));

export const HEART_BASES: readonly { basis: HeartBasis; label: string }[] = [
  { basis: "maxHr", label: "% Max Heart Rate" }, { basis: "reserve", label: "% Heart Rate Reserve" }, { basis: "lthr", label: "% Lactate Threshold HR" },
];

export const HEART_ZONES: Record<HeartBasis, readonly Zone[]> = {
  maxHr: zones([["recovery", "Recovery", 0, 50], ["warmUp", "Warm Up", 51, 60], ["fatBurn", "Fat Burn", 61, 70], ["aerobicEndurance", "Aerobic Endurance", 71, 80], ["threshold", "Threshold", 81, 90], ["anaerobic", "Anaerobic", 91, 100]]),
  reserve: zones([["recovery", "Recovery", 0, 59], ["warmUp", "Warm Up", 60, 74], ["fatBurn", "Fat Burn", 75, 84], ["aerobicEndurance", "Aerobic Endurance", 85, 88], ["threshold", "Threshold", 89, 95], ["anaerobic", "Anaerobic", 96, 100]]),
  lthr: zones([["recovery", "Recovery", 0, 80], ["warmUp", "Warm Up", 81, 90], ["fatBurn", "Fat Burn", 91, 95], ["aerobicEndurance", "Aerobic Endurance", 96, 102], ["threshold", "Threshold", 103, 106], ["anaerobic", "Anaerobic", 107, 120]]),
};
export const PACE_ZONES: readonly Zone[] = zones([["recovery", "Recovery", 0, 77], ["aerobicEndurance", "Aerobic Endurance", 78, 87], ["aerobicPower", "Aerobic Power", 88, 94], ["threshold", "Threshold", 95, 108], ["anaerobicEndurance", "Anaerobic Endurance", 109, 118], ["anaerobicPower", "Anaerobic Power", 119, 200]]);
export const FTP_ZONES: readonly Zone[] = zones([["recovery", "Recovery", 0, 55], ["aerobicEndurance", "Aerobic Endurance", 56, 75], ["aerobicPower", "Aerobic Power", 76, 90], ["threshold", "Threshold", 91, 105], ["anaerobicEndurance", "Anaerobic Endurance", 106, 120], ["anaerobicPower", "Anaerobic Power", 121, 150], ["sprint", "Sprint", 151, 300]]);

export const CUSTOM_ZONE = "custom";

/** The zones a percentage target picks from; empty for every other target. */
export function zonesFor(intensity: BuilderIntensity): readonly Zone[] {
  if (intensity.kind === "heartRatePercent") return HEART_ZONES[intensity.basis ?? "maxHr"];
  if (intensity.kind === "thresholdPacePercent" || intensity.kind === "effortPacePercent") return PACE_ZONES;
  if (intensity.kind === "ftpPercent") return FTP_ZONES;
  return [];
}

/** The percentages a percentage target stands for, or null while a custom range is incomplete. */
export function percentRange(intensity: BuilderIntensity): { low: number; high: number } | null {
  const list = zonesFor(intensity);
  if (list.length === 0) return null;
  if (intensity.zone !== CUSTOM_ZONE) {
    const zone = list.find((z) => z.key === intensity.zone);
    return zone ? { low: zone.low, high: zone.high } : null;
  }
  const { low, high } = intensity;
  return low !== undefined && high !== undefined && low >= 0 && high > low && high <= 300 ? { low, high } : null;
}

/** What a percentage target comes to for this athlete ("124 to 143 bpm"), or null when their number isn't known. */
export function derivedText(intensity: BuilderIntensity, numbers: AthleteNumbers | null): string | null {
  const range = percentRange(intensity);
  if (!range || !numbers) return null;
  const of = (reference: number, percent: number) => Math.round((reference * percent) / 100);
  if (intensity.kind === "heartRatePercent") {
    const basis = intensity.basis ?? "maxHr";
    if (basis === "reserve") {
      const { maxHr, restingHr } = numbers;
      if (!maxHr || !restingHr) return null;
      return `${Math.round(restingHr + ((maxHr - restingHr) * range.low) / 100)} to ${Math.round(restingHr + ((maxHr - restingHr) * range.high) / 100)} bpm`;
    }
    const reference = basis === "lthr" ? numbers.lthr : numbers.maxHr;
    return reference ? `${of(reference, range.low)} to ${of(reference, range.high)} bpm` : null;
  }
  if (intensity.kind === "ftpPercent") return numbers.ftp ? `${of(numbers.ftp, range.low)} to ${of(numbers.ftp, range.high)} W` : null;
  // A higher percentage of threshold pace is a faster pace: fewer seconds per km.
  if (!numbers.thresholdPace || range.low <= 0) return null;
  return `${formatClock((numbers.thresholdPace * 100) / range.high)} to ${formatClock((numbers.thresholdPace * 100) / range.low)} /km`;
}

/* ───────────── New steps ───────────── */

const midGrade = (system: HubClimbSystem): string => HUB_CLIMB_GRADES[system][Math.floor(HUB_CLIMB_GRADES[system].length / 3)];

/** The target a step gets when its kind of target changes: the values are left for the athlete to fill in. */
export function defaultIntensity(kind: BuilderIntensityKind, doc: Pick<BuilderDoc, "sport" | "gradeSystem">): BuilderIntensity {
  switch (kind) {
    case "heartRatePercent": return { kind, basis: "maxHr", zone: "aerobicEndurance" };
    case "thresholdPacePercent": case "effortPacePercent": case "ftpPercent": return { kind, zone: "aerobicEndurance" };
    case "stroke": return { kind, stroke: "freestyle" };
    case "grade": return { kind, grade: midGrade(gradeSystemOf(doc)) };
    case "rpe": return { kind, low: 5 };
    default: return { kind };
  }
}

/** The values a step gets when what it ends on changes. */
export function defaultTarget(target: HubStepTarget, sport: HubSport, kind: BuilderKind): Partial<BuilderStep> {
  const clear = { seconds: undefined, meters: undefined, count: undefined, load: undefined, bpm: undefined };
  switch (target) {
    case "time": return { ...clear, target, seconds: kind === "rest" ? 60 : sport === "strength" ? 30 : 600 };
    case "distance": return { ...clear, target, meters: sport === "swim" ? 100 : 1000 };
    case "reps": return { ...clear, target, count: 10 };
    case "routes": return { ...clear, target, count: 3 };
    case "load": return { ...clear, target, load: 50 };
    case "hrRecovery": return { ...clear, target, bpm: 120 };
    case "elevationGain": return { ...clear, target, meters: 100 };
    case "open": return { ...clear, target };
  }
}

/** A fresh step of a kind for a sport. */
export function newStep(id: string, kind: BuilderKind, doc: Pick<BuilderDoc, "sport" | "gradeSystem">, station = false): BuilderStep {
  const sport = doc.sport;
  const intensity: BuilderIntensity = isClimb(sport) ? defaultIntensity("grade", doc) : { kind: "none" };
  const base = { type: "step" as const, id, kind, intensity };
  const time = (seconds: number): BuilderStep => ({ ...base, target: "time", seconds });
  const distance = (meters: number): BuilderStep => ({ ...base, target: "distance", meters });
  if (kind === "sendOff") return { ...distance(100), sendOffSeconds: 120 };
  if (sport === "strength" || (sport === "hyrox" && station && kind === "training")) {
    if (kind === "training") return { ...base, target: sport === "hyrox" ? "time" : "reps", ...(sport === "hyrox" ? { seconds: 60, station: true } : { count: 10 }), sets: sport === "hyrox" ? 1 : 3, restSeconds: 60 };
    return time(kind === "rest" ? 60 : 300);
  }
  if (kind === "rest") return time(sport === "swim" ? 20 : isClimb(sport) ? 180 : 60);
  if (isClimb(sport)) return kind === "training" ? { ...base, target: "routes", count: 3 } : time(600);
  if (sport === "swim") return distance(kind === "warmup" ? 400 : kind === "cooldown" ? 200 : 100);
  if (sport === "run" || sport === "trailRun") return distance(kind === "training" ? 1000 : 2000);
  return time(600);
}

/** What a new workout of a sport opens with: warm-up, training and cool-down, or one exercise for strength. `ids` needs three. */
export function starterItems(doc: Pick<BuilderDoc, "sport" | "gradeSystem">, ids: readonly [string, string, string]): BuilderItem[] {
  if (doc.sport === "strength") return [newStep(ids[0], "training", doc)];
  return [newStep(ids[0], "warmup", doc), newStep(ids[1], "training", doc), newStep(ids[2], "cooldown", doc)];
}

export function newDoc(sport: HubSport, ids: readonly [string, string, string]): BuilderDoc {
  const doc: BuilderDoc = { name: "", sport, description: "", items: [], ...(sport === "swim" ? { poolLength: DEFAULT_POOL } : {}), ...(isClimb(sport) ? { gradeSystem: defaultGradeSystem(sport) } : {}) };
  return { ...doc, items: starterItems(doc, ids) };
}

/** A fresh repeat: four rounds of a training step and a rest. `ids` is [block, training, rest]. */
export function newRepeat(ids: readonly [string, string, string], doc: Pick<BuilderDoc, "sport" | "gradeSystem">): BuilderRepeat {
  return { type: "repeat", id: ids[0], count: 4, steps: [newStep(ids[1], "training", doc), newStep(ids[2], "rest", doc)] };
}

/** One run by distance, with a pace when one is given: what Quick training plans. */
export function quickRunDoc(name: string, km: number, paceSeconds: number | null, id: string): BuilderDoc {
  const intensity: BuilderIntensity = paceSeconds ? { kind: "pace", low: paceSeconds, high: paceSeconds } : { kind: "none" };
  return { name: name.trim() || "Quick Run", sport: "run", description: "", items: [{ type: "step", id, kind: "training", target: "distance", meters: Math.round(km * 1000), intensity }] };
}

/**
 * The same workout as another sport. A step keeps what the new sport allows and is made afresh where it
 * doesn't; a sport without repeats gets each block's steps once. `nextId` makes ids for remade steps.
 */
export function fitToSport(doc: BuilderDoc, sport: HubSport, nextId: () => string): BuilderDoc {
  if (sport === doc.sport) return doc;
  const next: BuilderDoc = { name: doc.name, sport, description: doc.description, items: [] };
  if (sport === "swim") next.poolLength = doc.poolLength ?? DEFAULT_POOL;
  if (isClimb(sport)) next.gradeSystem = defaultGradeSystem(sport);
  const fit = (step: BuilderStep): BuilderStep => {
    const kind = kindsFor(sport).includes(step.kind) ? step.kind : "training";
    const fresh = newStep(step.id, kind, next);
    const plain: BuilderStep = { type: "step", id: step.id, kind, target: step.target, seconds: step.seconds, meters: step.meters, count: step.count, load: step.load, bpm: step.bpm, intensity: step.intensity };
    if (isCard(fresh, sport) || isCard(step, doc.sport) || !targetsFor(sport, plain).includes(plain.target)) return fresh;
    // Distances are typed in metres for the pool and in kilometres elsewhere: keep the number sensible.
    if (plain.target === "distance" && (sport === "swim") !== (doc.sport === "swim")) return fresh;
    return intensitiesFor(sport, plain).includes(plain.intensity.kind) ? plain : { ...plain, intensity: fresh.intensity };
  };
  next.items = doc.items.flatMap((item): BuilderItem[] => {
    if (item.type === "step") return [fit(item)];
    return allowsRepeats(sport) ? [{ type: "repeat", id: item.id, count: item.count, steps: item.steps.map(fit) }] : item.steps.map(fit);
  });
  if (next.items.length === 0) next.items = starterItems(next, [nextId(), nextId(), nextId()]);
  return next;
}

/**
 * The same step as another kind (`station` for a HYROX station). It keeps what it ends on and its target where
 * the new kind allows them, and starts afresh when it turns into, or stops being, an exercise with sets.
 */
export function withKind(doc: Pick<BuilderDoc, "sport" | "gradeSystem">, step: BuilderStep, kind: BuilderKind, station = false): BuilderStep {
  const fresh: BuilderStep = { ...newStep(step.id, kind, doc, station), ...(step.coros ? { coros: step.coros } : {}) };
  if (isCard(step, doc.sport) !== isCard(fresh, doc.sport)) return fresh;
  const next: BuilderStep = { ...step, kind };
  delete next.station; delete next.sendOffSeconds;
  if (fresh.station) next.station = true;
  if (fresh.sendOffSeconds !== undefined) next.sendOffSeconds = step.sendOffSeconds ?? fresh.sendOffSeconds;
  if (kind !== "training") { delete next.exercise; delete next.sets; delete next.restSeconds; }
  if (!targetsFor(doc.sport, next).includes(next.target)) Object.assign(next, defaultTarget(fresh.target, doc.sport, kind), { seconds: fresh.seconds, meters: fresh.meters, count: fresh.count });
  if (next.intensity.kind !== "kept" && !intensitiesFor(doc.sport, next).includes(next.intensity.kind)) next.intensity = fresh.intensity;
  return next;
}

/** The workout graded in another climbing system: every grade starts again in the new one. */
export function withGradeSystem(doc: BuilderDoc, system: HubClimbSystem): BuilderDoc {
  const regrade = (s: BuilderStep): BuilderStep => (s.intensity.kind === "grade" && s.intensity.gradeOffset === undefined ? { ...s, intensity: defaultIntensity("grade", { sport: doc.sport, gradeSystem: system }) } : s);
  return { ...doc, gradeSystem: system, items: doc.items.map((item) => (item.type === "step" ? regrade(item) : { ...item, steps: item.steps.map(regrade) })) };
}

/** Every step in the order it is listed, a repeat's steps once. */
export function listSteps(items: readonly BuilderItem[]): BuilderStep[] {
  return items.flatMap((item) => (item.type === "step" ? [item] : item.steps));
}

/* ───────────── To and from COROS ───────────── */

const everyStep = listSteps;

function toHubIntensity(intensity: BuilderIntensity): HubIntensity {
  if (isUnwired(intensity.kind)) return { kind: "none" };
  const kind = intensity.kind as HubIntensityKind;
  const out: HubIntensity = { kind };
  if (["heartRate", "pace", "power", "speed", "cadence"].includes(kind)) { out.low = intensity.low; out.high = intensity.high; }
  if (kind === "weight" || kind === "rpe") out.low = intensity.low;
  if (kind === "stroke") out.stroke = intensity.stroke;
  if (kind === "grade") {
    if (intensity.gradeOffset !== undefined) out.gradeOffset = intensity.gradeOffset;
    else out.grade = intensity.grade;
  }
  for (const key of ["low", "high", "stroke", "grade"] as const) if (out[key] === undefined) delete out[key];
  return out;
}

function toHubStep(step: BuilderStep, sport: HubSport): HubWorkoutStep {
  const out: HubWorkoutStep = { ...(step.coros ? { id: step.coros } : {}), kind: hubKind(step.kind), target: step.target, intensity: toHubIntensity(step.intensity) };
  if (step.target === "time" && step.seconds !== undefined) out.seconds = step.seconds;
  if ((step.target === "distance" || step.target === "elevationGain") && step.meters !== undefined) out.meters = step.meters;
  if ((step.target === "reps" || step.target === "routes") && step.count !== undefined) out.count = step.count;
  if (step.target === "load" && step.load !== undefined) out.load = step.load;
  if (step.target === "hrRecovery" && step.bpm !== undefined) out.bpm = step.bpm;
  const card = isCard(step, sport);
  const exercise = step.kind === "training" ? step.exercise : undefined;
  if (exercise) out.exercise = exercise;
  const name = step.name?.trim();
  if (name && name !== exercise?.name) out.name = name;
  if (card) {
    out.sets = step.sets ?? 1;
    out.restSeconds = step.restSeconds ?? 60;
  }
  return out;
}

/** What in the workout the server can't write to COROS yet, in words; empty when all of it can go. */
export function docUnwired(doc: BuilderDoc): string[] {
  const found = new Set<string>();
  for (const step of everyStep(doc.items)) {
    if (step.kind === "sendOff") found.add("Send-off steps");
    if (isUnwired(step.intensity.kind)) found.add(`${INTENSITY_LABEL[step.intensity.kind]} targets`);
    // A target only COROS can show survives an edit of the same workout, not a copy onto another day.
    if (step.intensity.kind === "kept" && !step.coros) found.add("Targets only the COROS app can show");
  }
  return [...found];
}

/** The workout as COROS takes it. Only for a workout with nothing in `docUnwired`. */
export function docToHub(doc: BuilderDoc): HubWorkout {
  const blocks: HubWorkoutBlock[] = doc.items.map((item) =>
    item.type === "step"
      ? { repeats: null, steps: [toHubStep(item, doc.sport)] }
      : { ...(item.coros ? { id: item.coros } : {}), repeats: item.count, steps: item.steps.map((s) => toHubStep(s, doc.sport)) });
  return {
    name: doc.name.trim() || DEFAULT_NAME, sport: doc.sport, description: doc.description.trim().slice(0, DESCRIPTION_MAX), blocks,
    ...(isClimb(doc.sport) ? { gradeSystem: gradeSystemOf(doc) } : {}),
    ...(doc.sport === "swim" && doc.poolLength ? { poolLength: doc.poolLength } : {}),
  };
}

/** A COROS workout for the builder. `keepIds` false makes a new workout of it (a library workout planned afresh). */
export function docFromHub(workout: HubWorkout, nextId: () => string, keepIds = true): BuilderDoc {
  const step = (s: HubWorkoutStep): BuilderStep => {
    const out: BuilderStep = { type: "step", id: nextId(), kind: s.kind, target: s.target, intensity: { ...s.intensity } };
    if (keepIds && s.id) out.coros = s.id;
    for (const key of ["seconds", "meters", "count", "load", "bpm", "sets", "restSeconds"] as const) if (s[key] !== undefined) out[key] = s[key];
    if (s.name) out.name = s.name;
    if (s.exercise) out.exercise = s.exercise;
    if (workout.sport === "hyrox" && s.kind === "training" && (s.exercise?.kind ?? 0) > 0) out.station = true;
    return out;
  };
  const items: BuilderItem[] = workout.blocks.flatMap((block): BuilderItem[] => {
    if (block.repeats === null || block.repeats === undefined) return block.steps.map(step);
    return [{ type: "repeat", id: nextId(), ...(keepIds && block.id ? { coros: block.id } : {}), count: block.repeats, steps: block.steps.map(step) }];
  });
  return {
    name: workout.name, sport: workout.sport, description: workout.description ?? "", items,
    ...(workout.sport === "swim" ? { poolLength: workout.poolLength ?? DEFAULT_POOL } : {}),
    ...(isClimb(workout.sport) ? { gradeSystem: workout.gradeSystem ?? defaultGradeSystem(workout.sport) } : {}),
  };
}

/* ───────────── Workouts saved by the first builder ───────────── */

const LEGACY_SPORT: Record<Sport, HubSport> = { run: "run", ride: "bike", swim: "swim", strength: "strength" };
const LEGACY_KIND: Record<StepKind, HubStepKind> = { warmup: "warmup", work: "training", recovery: "rest", rest: "rest", cooldown: "cooldown" };

/**
 * A workout saved by the first builder (time or distance steps, a pace or a heart rate zone) as a builder
 * workout. A zone becomes its heart rate range from `zones`, the zones it was planned with.
 */
export function legacyDoc(workout: { name: string; sport: Sport; items: readonly WorkoutItem[] }, zoneList: readonly { zone: number; low: number; high: number }[], nextId: () => string): BuilderDoc {
  const sport = LEGACY_SPORT[workout.sport] ?? "run";
  const doc: BuilderDoc = { name: workout.name, sport, description: "", items: [], ...(sport === "swim" ? { poolLength: DEFAULT_POOL } : {}) };
  const intensity = (target: StepTarget, step: BuilderStep): BuilderIntensity => {
    let made: BuilderIntensity = { kind: "none" };
    if (target.type === "pace") made = { kind: "pace", low: target.fast, high: target.slow };
    if (target.type === "hr") {
      const zone = zoneList.find((z) => z.zone === target.zone);
      if (zone) made = { kind: "heartRate", low: zone.low, high: zone.high };
    }
    return intensitiesFor(sport, step).includes(made.kind) ? made : { kind: "none" };
  };
  const convert = (s: WorkoutStep): BuilderStep => {
    const step: BuilderStep = { type: "step", id: nextId(), kind: LEGACY_KIND[s.kind] ?? "training", target: s.length.type, intensity: { kind: "none" } };
    if (s.length.type === "time") step.seconds = s.length.seconds;
    else step.meters = s.length.metres;
    if (s.label) step.name = s.label;
    if (isCard(step, sport)) { step.sets = 1; step.restSeconds = 60; }
    if (!targetsFor(sport, step).includes(step.target)) return { ...newStep(step.id, step.kind, doc), ...(step.name ? { name: step.name } : {}) };
    step.intensity = intensity(s.target, step);
    return step;
  };
  doc.items = workout.items.flatMap((item): BuilderItem[] => {
    if (item.type === "step") return [convert(item)];
    return allowsRepeats(sport) ? [{ type: "repeat", id: nextId(), count: item.count, steps: item.steps.map(convert) }] : item.steps.map(convert);
  });
  return doc;
}

/** One target in words, for a calendar line or Coach: "Heart Rate 124–143 bpm", "% Heart Rate · Fat Burn". */
export function intensityText(intensity: BuilderIntensity): string {
  if (!isUnwired(intensity.kind)) return intensity.kind === "kept" ? INTENSITY_LABEL.kept : intensityLabel(toHubIntensity(intensity));
  if (intensity.kind === "effortPace") return intensity.low && intensity.high ? `Effort Pace ${formatPaceRange(intensity.low, intensity.high)}` : INTENSITY_LABEL.effortPace;
  const range = percentRange(intensity);
  const zone = zonesFor(intensity).find((z) => z.key === intensity.zone);
  return `${INTENSITY_LABEL[intensity.kind]}${zone ? ` · ${zone.label}` : range ? ` · ${range.low}-${range.high}%` : ""}`;
}

/**
 * The workout as the first builder's steps, for the parts of the app that still read those (Coach, the
 * calendar's week totals); null when it has anything they can't hold (another sport, sets, an open step).
 */
export function docToLegacy(doc: BuilderDoc): WorkoutItem[] | null {
  if (!(doc.sport === "run" || doc.sport === "trailRun" || doc.sport === "bike" || doc.sport === "swim")) return null;
  let ok = true;
  const convert = (s: BuilderStep): WorkoutStep => {
    if (s.kind === "sendOff" || !(s.target === "time" || s.target === "distance")) ok = false;
    const kind: StepKind = s.kind === "warmup" ? "warmup" : s.kind === "cooldown" ? "cooldown" : s.kind === "rest" ? (s.target === "distance" ? "recovery" : "rest") : "work";
    const i = s.intensity;
    const target: StepTarget = i.kind === "none" ? { type: "none" } : i.kind === "pace" && i.low && i.high ? { type: "pace", fast: i.low, slow: i.high } : { type: "kept", label: intensityText(i) };
    const metres = s.meters ?? 0;
    return {
      type: "step", id: s.id, kind, target,
      length: s.target === "time" ? { type: "time", seconds: s.seconds ?? 0 } : { type: "distance", metres, unit: doc.sport === "swim" || metres < 1000 ? "m" : "km" },
    };
  };
  const items = doc.items.map((item): WorkoutItem => (item.type === "step" ? convert(item) : { type: "repeat", id: item.id, count: item.count, steps: item.steps.map(convert) }));
  return ok ? items : null;
}

/* ───────────── Checks ───────────── */

/**
 * Why a step isn't ready, or null. The limits are the server's own (`hubWorkoutProblem`). `browser` is a
 * workout that stays in this browser: there a typed exercise name stands in for one from COROS's list.
 */
export function stepProblem(doc: BuilderDoc, step: BuilderStep, browser = false): string | null {
  const sport = doc.sport;
  const i = step.intensity;
  if (i.kind === "effortPace") {
    if (!(i.low && i.high && i.low >= 60 && i.high <= 3600 && i.low <= i.high)) return "Paces go from 1:00 to 60:00 per km, fast to slow.";
  } else if (isUnwired(i.kind) && !percentRange(i)) return "A custom range needs both ends, low then high.";
  if (!intensitiesFor(sport, step).includes(i.kind) && i.kind !== "kept") return "That target isn't available for this step.";
  if (step.kind === "sendOff" && !(step.sendOffSeconds && step.sendOffSeconds >= 1 && step.sendOffSeconds <= 3600)) return "A send-off needs its time.";
  const named = Boolean(step.name?.trim());
  if (isCard(step, sport)) {
    if (!step.exercise && !(browser && named) && !step.coros) return sport === "hyrox" ? "Pick a station." : "Pick an exercise for each strength step.";
    if (!(step.restSeconds === undefined || (step.restSeconds >= 0 && step.restSeconds <= 3600))) return "Rest between sets goes from 0 to 3600 seconds.";
  }
  const alone: HubWorkout = { name: "x", sport, description: "", blocks: [{ repeats: null, steps: [toHubStep(step, sport)] }], ...(isClimb(sport) ? { gradeSystem: gradeSystemOf(doc) } : {}) };
  return hubWorkoutProblem(alone, () => step.coros !== undefined || (browser && named));
}

export interface Check { ok: boolean; text: string }

/** The Checks list: what is missing, or that every step is ready. */
export function docChecks(doc: BuilderDoc, browser = false): Check[] {
  const checks: Check[] = [];
  const first = doc.items[0], last = doc.items[doc.items.length - 1];
  if (doc.sport !== "strength") {
    if (!(first?.type === "step" && first.kind === "warmup")) checks.push({ ok: false, text: "Add a warm-up before the hard work" });
    if (!(last?.type === "step" && last.kind === "cooldown")) checks.push({ ok: false, text: "Add a cool-down at the end" });
  }
  if (doc.description.trim().length > DESCRIPTION_MAX) checks.push({ ok: false, text: `Shorten the description to ${DESCRIPTION_MAX} characters` });
  const pending = pendingCount(doc, browser);
  checks.push(pending > 0
    ? { ok: false, text: pending === 1 ? "1 block needs a value" : `${pending} blocks need a value` }
    : { ok: true, text: "Every step is ready for the watch" });
  return checks;
}

/** How many blocks (steps, and repeats with a bad count or no steps) still need a value. */
export function pendingCount(doc: BuilderDoc, browser = false): number {
  let pending = everyStep(doc.items).filter((s) => stepProblem(doc, s, browser) !== null).length;
  for (const item of doc.items) {
    if (item.type === "repeat" && (item.steps.length === 0 || !(Number.isInteger(item.count) && item.count >= 1 && item.count <= 99))) pending += 1;
  }
  if (doc.items.length === 0) pending += 1;
  return pending;
}

/** Whether the workout can be scheduled: something in it, and nothing waiting for a value. */
export const docReady = (doc: BuilderDoc, browser = false): boolean => pendingCount(doc, browser) === 0 && doc.description.trim().length <= DESCRIPTION_MAX;

/* ───────────── Totals and shape ───────────── */

const LEGACY_PACING: Partial<Record<HubSport, Sport>> = { run: "run", trailRun: "run", bike: "ride", swim: "swim" };

/** The usual paces to estimate with for a sport, when the athlete's are known. */
export function pacingFor(sport: HubSport, all: Record<Sport, Pacing> | null): Pacing | null {
  const key = LEGACY_PACING[sport];
  return all && key ? all[key] : null;
}

const middle = (i: BuilderIntensity): number | null => (i.low !== undefined && i.high !== undefined && i.low > 0 && i.high > 0 ? (i.low + i.high) / 2 : null);

/** The pace a step is expected at (seconds per km): its own pace or speed, else the athlete's usual for that kind. */
function expectedPace(step: BuilderStep, pacing: Pacing | null): number | null {
  const i = step.intensity, mid = middle(i);
  if ((i.kind === "pace" || i.kind === "effortPace") && mid) return mid;
  if (i.kind === "speed" && mid) return 3600 / mid;
  if (!pacing) return null;
  if (step.kind === "rest") return pacing.easyPace;
  return pacing.zonePace[Math.min(step.kind === "training" ? 2 : 1, pacing.zonePace.length - 1)] ?? null;
}

const setsOf = (step: BuilderStep, sport: HubSport): number => (isCard(step, sport) ? Math.max(1, step.sets ?? 1) : 1);

/** Seconds a step takes, null when it can't be known (an open step, a distance with no pace to go by). */
export function stepSeconds(step: BuilderStep, sport: HubSport, pacing: Pacing | null): { seconds: number; estimated: boolean } | null {
  const sets = setsOf(step, sport);
  const rests = isCard(step, sport) ? (sets - 1) * (step.restSeconds ?? 0) : 0;
  if (step.target === "time" && step.seconds !== undefined) return { seconds: sets * step.seconds + rests, estimated: false };
  if (step.target === "distance" && step.meters !== undefined) {
    const pace = expectedPace(step, pacing);
    return pace ? { seconds: sets * (step.meters / 1000) * pace + rests, estimated: true } : null;
  }
  return null;
}

/** Metres a step covers: its distance, or its time at its own pace or speed target (nothing for a rest spent standing). */
export function stepMeters(step: BuilderStep, sport: HubSport): { meters: number; estimated: boolean } {
  if (step.target === "distance") return { meters: setsOf(step, sport) * (step.meters ?? 0), estimated: false };
  if (step.target !== "time" || step.kind === "rest" || isCard(step, sport) || isClimb(sport) || sport === "strength") return { meters: 0, estimated: false };
  const pace = expectedPace(step, null);
  return pace && step.seconds ? { meters: (step.seconds / pace) * 1000, estimated: true } : { meters: 0, estimated: false };
}

export interface DocTotals {
  /** Null when a step's time can't be known. */
  seconds: number | null;
  /** The time leans on a pace, not only on timed steps. */
  secondsEstimated: boolean;
  meters: number;
  metersEstimated: boolean;
  /** Timed rests, for the pool. */
  restSeconds: number;
  /** Rows, a repeat's steps counted once. */
  steps: number;
  repeats: number;
  exercises: number;
  sets: number;
  /** Reps of every set; open and timed sets add nothing. */
  reps: number;
  routes: number;
}

export function docTotals(doc: BuilderDoc, pacing: Pacing | null): DocTotals {
  const t: DocTotals = { seconds: 0, secondsEstimated: false, meters: 0, metersEstimated: false, restSeconds: 0, steps: 0, repeats: 0, exercises: 0, sets: 0, reps: 0, routes: 0 };
  for (const item of doc.items) {
    const times = item.type === "repeat" ? Math.max(0, Math.min(99, Math.floor(item.count) || 0)) : 1;
    if (item.type === "repeat") t.repeats += 1;
    for (const step of item.type === "repeat" ? item.steps : [item]) {
      t.steps += 1;
      const s = stepSeconds(step, doc.sport, pacing);
      if (!s) t.seconds = null;
      else if (t.seconds !== null) { t.seconds += times * s.seconds; t.secondsEstimated ||= s.estimated; }
      const m = stepMeters(step, doc.sport);
      t.meters += times * m.meters;
      t.metersEstimated ||= m.estimated && m.meters > 0;
      if (step.kind === "rest" && step.target === "time") t.restSeconds += times * (step.seconds ?? 0);
      if (isCard(step, doc.sport)) {
        const sets = setsOf(step, doc.sport);
        t.exercises += 1;
        t.sets += times * sets;
        if (step.target === "reps") t.reps += times * sets * (step.count ?? 0);
      }
      if (step.target === "routes") t.routes += times * (step.count ?? 0);
    }
  }
  return t;
}

/** A distance as the sport writes it: metres in the pool, kilometres elsewhere. */
export function distanceText(meters: number, sport: HubSport): string {
  return sport === "swim" ? `${thousands(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

/** What a repeat block comes to, all its rounds together: its distance, else its time. */
export function repeatText(block: BuilderRepeat, doc: BuilderDoc, pacing: Pacing | null): string {
  const t = docTotals({ ...doc, items: [block] }, pacing);
  if (t.meters > 0) return distanceText(t.meters, doc.sport);
  return t.seconds ? formatClock(t.seconds) : "";
}

/** One line for a table or the calendar: "49:56 · 9.60 km", "2,400 m", "5 exercises · 17 sets". */
export function docSummary(doc: BuilderDoc, pacing: Pacing | null): string {
  const t = docTotals(doc, pacing);
  if (doc.sport === "strength") return `${t.exercises} ${t.exercises === 1 ? "exercise" : "exercises"} · ${t.sets} ${t.sets === 1 ? "set" : "sets"}`;
  if (doc.sport === "swim" && t.meters > 0) return distanceText(t.meters, "swim");
  const parts: string[] = [];
  if (t.seconds) parts.push(formatClock(t.seconds));
  if (t.meters >= 1) parts.push(distanceText(t.meters, doc.sport));
  if (t.routes > 0) parts.push(`${t.routes} ${t.routes === 1 ? "route" : "routes"}`);
  return parts.join(" · ") || `${t.steps} ${t.steps === 1 ? "step" : "steps"}`;
}

/** The line under a card's sets: "24 reps in total". */
export function setsText(step: BuilderStep): string {
  const sets = Math.max(1, step.sets ?? 1);
  if (step.target === "open") return "Each set ends when you press the lap button";
  if (step.target === "reps" && step.count) return `${sets * step.count} reps in total`;
  if (step.target === "time" && step.seconds) return `About ${formatClock(sets * step.seconds + (sets - 1) * (step.restSeconds ?? 0))} in total`;
  if (step.target === "distance" && step.meters) return `${thousands(sets * step.meters)} m in total`;
  return "";
}

const BUCKET: Record<BuilderKind, ShapeBucket> = { warmup: "easy", cooldown: "easy", training: "hard", rest: "rest", sendOff: "rest" };

/** How tall a step stands in the shape, 0 to 1. */
function stepHeight(step: BuilderStep, pacing: Pacing | null): number {
  const i = step.intensity, mid = middle(i);
  if ((i.kind === "pace" || i.kind === "effortPace") && mid && pacing) return paceIntensity(mid, pacing);
  const list = zonesFor(i);
  const at = list.findIndex((z) => z.key === i.zone);
  if (at >= 0) return 0.3 + (0.65 * at) / Math.max(1, list.length - 1);
  if (step.kind === "training") return 0.78;
  if (step.kind === "rest" || step.kind === "sendOff") return step.target === "distance" ? 0.28 : 0.15;
  return 0.42;
}

export interface DocShape {
  paths: Record<ShapeBucket, string>;
  /** Labels under the drawing, left to right; empty when the steps have no common measure. */
  ticks: string[];
  /** What the widths are: each step's time, its distance, or one width per step. */
  basis: "time" | "distance" | "steps";
}

/** The drawing: a bar per step, as wide as its share of the time (or the distance) and as tall as its effort. */
export function docShape(doc: BuilderDoc, pacing: Pacing | null): DocShape {
  const rounds = doc.items.map((item) => (item.type === "repeat" ? Array.from({ length: Math.max(0, Math.min(99, Math.floor(item.count) || 0)) }, () => item.steps).flat() : [item]));
  const all = rounds.flat();
  const timed = all.map((s) => stepSeconds(s, doc.sport, pacing)?.seconds ?? null);
  const far = all.map((s) => stepMeters(s, doc.sport).meters);
  const basis: DocShape["basis"] = all.length > 0 && doc.sport !== "swim" && timed.every((v) => v !== null && v > 0) ? "time" : far.some((m) => m > 0) ? "distance" : "steps";
  const width = (k: number) => (basis === "time" ? timed[k] ?? 0 : basis === "distance" ? far[k] : 1);
  const segs: ShapeSegment[] = all.map((s, k) => ({ bucket: BUCKET[s.kind], seconds: width(k), intensity: stepHeight(s, pacing) })).filter((s) => s.seconds > 0);
  let k = 0;
  const spans = rounds.map((steps) => steps.reduce((sum) => sum + width(k++), 0));
  const total = spans.reduce((a, b) => a + b, 0);
  const marks = basis === "steps" || !(total > 0) ? [] : spans.length >= 3 ? [0, spans[0], total - spans[spans.length - 1], total] : [0, total];
  const text = (v: number) => (basis === "time" ? formatClock(v) : distanceText(v, doc.sport));
  return { paths: shapePaths(segs), ticks: marks.filter((v, n) => n === 0 || Math.round(v) > Math.round(marks[n - 1])).map(text), basis };
}

/** The drawing in words, for people who can't see it. */
export function shapeLabel(doc: BuilderDoc): string {
  if (doc.items.length === 0) return "Effort through the workout: no steps yet";
  const one = (s: BuilderStep) => KIND_LABEL[s.kind].toLowerCase();
  return `Effort through the workout: ${doc.items.map((item) => (item.type === "step" ? one(item) : `${item.count} times ${item.steps.map(one).join(" then ")}`)).join(", ")}`;
}

/* ───────────── Text boxes ───────────── */

/** "4:30-4:40/km", fast to slow. */
export function formatPaceRange(low: number, high: number): string {
  return `${formatClock(low)}-${formatClock(high)}/km`;
}

/** Reads "4:30-4:40/km", "4:30 – 4:40" or one pace ("5:30"); null when it isn't a pace range, fast to slow. */
export function parsePaceRange(text: string): { low: number; high: number } | null {
  const parts = text.trim().replace(/\s*\/\s*km\s*$/i, "").split(/\s*(?:-|–|—|to)\s*/i).filter((p) => p !== "");
  if (parts.length < 1 || parts.length > 2 || parts.some((p) => !p.includes(":"))) return null;
  const [low, high] = parts.map(parseClock);
  const slow = high ?? low;
  if (low == null || slow == null || low < 60 || slow > 3600 || low > slow) return null;
  return { low, high: slow };
}

/** Reads a whole or decimal number inside `low`…`high`; null otherwise. `step` snaps to a grid (0.5 kg). */
export function parseNumber(text: string, low: number, high: number, step = 0): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const value = step > 0 ? Math.round(parseFloat(t) / step) * step : parseFloat(t);
  return value >= low && value <= high ? value : null;
}
