/**
 * A workout's intensity profile: one bar per step, width by how long the step
 * runs and height by how hard it is. The library tiles, the reader and the
 * plan board all draw from this, so a session reads the same everywhere.
 *
 * Heights come from the step's own target (pace, heart rate, FTP or a COROS
 * preset) measured against the athlete's thresholds from the editor context.
 * Steps whose target says nothing about effort draw as plain "work" rather
 * than claiming a zone they were never given.
 */
import type {
  RunWorkoutEditorNode,
  RunWorkoutEditorStep,
  WorkoutEditorContext,
  WorkoutSport
} from "../../electron/types";
import { workoutSportFromType } from "../../electron/trainingPlanDomain";
import { t } from "../i18n/training";

export type ProfileZone =
  | "warmup"
  | "z1"
  | "z2"
  | "z3"
  | "z4"
  | "z5"
  | "work"
  | "rest"
  | "cooldown";

/** Session order for legends and the zone split. */
export const PROFILE_ZONE_ORDER: ProfileZone[] = ["warmup", "z1", "z2", "z3", "z4", "z5", "work", "rest", "cooldown"];

export const PROFILE_ZONE_LABELS: Record<ProfileZone, string> = {
  warmup: "Warm-up",
  z1: "Easy",
  z2: "Steady",
  z3: "Moderate",
  z4: "Threshold",
  z5: "VO₂ max",
  work: "Work",
  rest: "Recovery",
  cooldown: "Cool-down"
};

/** Bar height as a share of the tallest possible bar. */
const ZONE_HEIGHT: Record<ProfileZone, number> = {
  warmup: 0.34,
  z1: 0.3,
  z2: 0.46,
  z3: 0.62,
  z4: 0.8,
  z5: 1,
  work: 0.56,
  rest: 0.16,
  cooldown: 0.28
};

export interface ProfileSegment {
  zone: ProfileZone;
  /** Relative weight, in seconds where the step is timed. */
  weight: number;
  /** 0..1, ready for a CSS height. */
  height: number;
  label: string;
}

export interface SessionProfile {
  segments: ProfileSegment[];
  /** Weight per zone, in PROFILE_ZONE_ORDER, zones with no time left out. */
  zones: Array<{ zone: ProfileZone; weight: number; share: number }>;
  totalWeight: number;
  /** True when every step is timed, so weights are real seconds. */
  timed: boolean;
}

/** Enough bars to read an interval set without drawing hundreds. */
const SEGMENT_LIMIT = 96;

type ZoneLadder = [number, number, number, number];

/** Picks z1..z5 for a value against four ascending cut points. */
function ladder(value: number, cuts: ZoneLadder): ProfileZone {
  if (value < cuts[0]) return "z1";
  if (value < cuts[1]) return "z2";
  if (value < cuts[2]) return "z3";
  if (value < cuts[3]) return "z4";
  return "z5";
}

const PRESET_ZONES: Record<string, ProfileZone> = {
  recovery: "z1",
  warmUp: "z1",
  easy: "z2",
  fatBurn: "z2",
  aerobicEndurance: "z2",
  aerobicPower: "z3",
  moderate: "z3",
  threshold: "z4",
  anaerobicEndurance: "z5",
  anaerobicPower: "z5",
  anaerobic: "z5",
  sprint: "z5",
  interval: "z5",
  repetition: "z5"
};

/** Cut points as a percent of threshold (FTP, threshold pace speed, LTHR). */
const THRESHOLD_PERCENT: ZoneLadder = [76, 88, 95, 103];
const FTP_PERCENT: ZoneLadder = [56, 76, 91, 106];
const MAX_HR_PERCENT: ZoneLadder = [70, 80, 87, 93];
const RESERVE_HR_PERCENT: ZoneLadder = [60, 70, 80, 90];
const LTHR_PERCENT: ZoneLadder = [85, 90, 95, 100];

function midpoint(low: number, high: number): number {
  return (low + high) / 2;
}

/** How hard a work step is, or "work" when its target does not say. */
export function trainingZone(step: RunWorkoutEditorStep, context?: WorkoutEditorContext): ProfileZone {
  const intensity = step.intensity;
  switch (intensity.type) {
    case "pace":
    case "effortPace": {
      const threshold = context?.thresholdPaceSecondsPerKm;
      const pace = midpoint(intensity.lowSecondsPerKm, intensity.highSecondsPerKm);
      if (!threshold || !pace) return "work";
      return ladder((threshold / pace) * 100, THRESHOLD_PERCENT);
    }
    case "heartRate": {
      const bpm = midpoint(intensity.lowBpm, intensity.highBpm);
      if (context?.lthrBpm) return ladder((bpm / context.lthrBpm) * 100, LTHR_PERCENT);
      if (context?.maxHr) return ladder((bpm / context.maxHr) * 100, MAX_HR_PERCENT);
      return "work";
    }
    case "heartRatePercent": {
      if (intensity.preset) return PRESET_ZONES[intensity.preset] ?? "work";
      const percent = midpoint(intensity.lowPercent, intensity.highPercent);
      const cuts = intensity.basis === "lthr" ? LTHR_PERCENT : intensity.basis === "reserve" ? RESERVE_HR_PERCENT : MAX_HR_PERCENT;
      return ladder(percent, cuts);
    }
    case "thresholdPacePercent":
    case "effortPacePercent":
      if (intensity.preset) return PRESET_ZONES[intensity.preset] ?? "work";
      return ladder(midpoint(intensity.lowPercent, intensity.highPercent), THRESHOLD_PERCENT);
    case "ftpPercent":
      if (intensity.preset) return PRESET_ZONES[intensity.preset] ?? "work";
      return ladder(midpoint(intensity.lowPercent, intensity.highPercent), FTP_PERCENT);
    case "power": {
      if ("preset" in intensity && intensity.preset) return PRESET_ZONES[intensity.preset] ?? "work";
      const ftp = context?.ftp ?? context?.criticalPower;
      if (!ftp || intensity.lowWatts === undefined || intensity.highWatts === undefined) return "work";
      return ladder((midpoint(intensity.lowWatts, intensity.highWatts) / ftp) * 100, FTP_PERCENT);
    }
    case "rpe":
      return intensity.value <= 3 ? "z1" : intensity.value <= 5 ? "z2" : intensity.value <= 6 ? "z3" : intensity.value <= 8 ? "z4" : "z5";
    default:
      return "work";
  }
}

export function stepZone(step: RunWorkoutEditorStep, context?: WorkoutEditorContext): ProfileZone {
  if (step.kind === "warmup") return "warmup";
  if (step.kind === "cooldown") return "cooldown";
  if (step.kind === "rest" || step.kind === "sendOff") return "rest";
  return trainingZone(step, context);
}

/** Seconds where the step is timed; a comparable estimate otherwise. */
function stepWeight(step: RunWorkoutEditorStep): { weight: number; timed: boolean } {
  const target = step.target;
  const sets = Math.max(1, step.sets ?? 1);
  if (target.type === "time") return { weight: Math.max(1, target.seconds) * sets, timed: true };
  if (target.type === "distance") {
    const intensity = step.intensity;
    const pace =
      intensity.type === "pace" || intensity.type === "effortPace"
        ? midpoint(intensity.lowSecondsPerKm, intensity.highSecondsPerKm)
        : 0;
    return { weight: Math.max(1, pace ? (target.meters / 1000) * pace : target.meters / 3) * sets, timed: Boolean(pace) };
  }
  if (target.type === "reps") return { weight: Math.max(1, target.count * 4) * sets + (step.restValue ?? 0) * (sets - 1), timed: false };
  return { weight: 120 * sets, timed: false };
}

export function sessionProfile(
  nodes: RunWorkoutEditorNode[],
  context?: WorkoutEditorContext,
  describe: (step: RunWorkoutEditorStep) => string = (step) => step.name
): SessionProfile {
  const segments: ProfileSegment[] = [];
  let timed = true;
  const push = (step: RunWorkoutEditorStep) => {
    if (segments.length >= SEGMENT_LIMIT) return;
    const zone = stepZone(step, context);
    const { weight, timed: isTimed } = stepWeight(step);
    timed &&= isTimed;
    segments.push({ zone, weight, height: ZONE_HEIGHT[zone], label: describe(step) });
  };
  for (const node of nodes) {
    if (node.nodeType === "repeat") {
      for (let round = 0; round < node.repeat; round += 1) node.steps.forEach(push);
    } else {
      push(node);
    }
  }
  const totalWeight = segments.reduce((sum, segment) => sum + segment.weight, 0);
  const byZone = new Map<ProfileZone, number>();
  for (const segment of segments) byZone.set(segment.zone, (byZone.get(segment.zone) ?? 0) + segment.weight);
  const zones = PROFILE_ZONE_ORDER.filter((zone) => byZone.has(zone)).map((zone) => ({
    zone,
    weight: byZone.get(zone)!,
    share: totalWeight ? byZone.get(zone)! / totalWeight : 0
  }));
  return { segments, zones, totalWeight, timed: timed && segments.length > 0 };
}

/**
 * The quiet word under a workout's name. Hard work anywhere makes it a
 * quality session, so a long run with a fast finish still reads as one.
 */
export function sessionKind(profile: SessionProfile): string | undefined {
  if (!profile.segments.length) return undefined;
  const zones = new Set(profile.segments.map((segment) => segment.zone));
  if (zones.has("z5") || zones.has("z4")) return "Quality session";
  if (zones.has("z3")) return "Steady session";
  if (zones.has("z1") || zones.has("z2")) return "Easy session";
  return undefined;
}

/**
 * Library workouts carry COROS program sport types (1–9). Exports and some
 * older payloads carry activity sport codes instead (100 run, 102 trail,
 * 200 bike, 402 strength…), so both resolve to the same sport.
 */
export function resolveWorkoutSport(sportType: number | undefined): WorkoutSport | undefined {
  const direct = workoutSportFromType(sportType);
  if (direct || sportType === undefined) return direct;
  if (sportType === 102) return "trailRun";
  if (sportType >= 100 && sportType < 200) return "run";
  if (sportType >= 200 && sportType < 300) return "bike";
  if (sportType >= 300 && sportType < 400) return "swim";
  if (sportType >= 400 && sportType < 500) return "strength";
  return undefined;
}

/** COROS writes a strength volume as "6 set(s)"; people read "6 sets" or "1 set". */
export function readableVolume(volume: string): string;
export function readableVolume(volume: string | undefined): string | undefined;
export function readableVolume(volume: string | undefined): string | undefined {
  const match = volume?.trim().match(/^(\d+)\s*set\(s\)$/i);
  if (!match) return volume;
  const count = Number(match[1]);
  return count === 1 ? t("1 set") : t("{{value1}} sets", { value1: String(count) });
}
