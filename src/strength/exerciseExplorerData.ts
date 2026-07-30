import type { StrengthSession, StrengthSet } from "../../electron/types";
import { resolveExerciseName } from "../training/exerciseNames";
import {
  canonicalExerciseDisplayName,
  estimateOneRepMax
} from "./strengthAnalytics";

const EPSILON = 0.01;

export interface ExplorerSet extends StrengthSet {
  setNumber: number;
  e1rmKg: number;
  volumeKg: number;
}

export type ExerciseSessionPr = "weight" | "e1rm" | "volume";

export interface ExerciseSessionRecord {
  activityId: string;
  sessionName: string;
  /** Epoch seconds. */
  at?: number;
  sets: ExplorerSet[];
  totalReps: number;
  volumeKg: number;
  topWeightKg: number;
  bestE1rmKg: number;
  workSec: number;
  prs: ExerciseSessionPr[];
}

export interface RepRangeRecord {
  id: string;
  label: string;
  shortLabel: string;
  minReps: number;
  maxReps?: number;
  reps: number;
  weightKg: number;
  e1rmKg: number;
  at?: number;
  activityId: string;
}

export type PlateauState =
  | "insufficient"
  | "progressing"
  | "plateau"
  | "declining"
  | "steady";

export interface PlateauIndicator {
  state: PlateauState;
  label: string;
  detail: string;
  sessionsConsidered: number;
  changePercent?: number;
}

export interface SessionComparison {
  latest: ExerciseSessionRecord;
  previous: ExerciseSessionRecord;
}

export interface ExerciseExplorerData {
  name: string;
  /** Newest session first for display. */
  sessions: ExerciseSessionRecord[];
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  heaviestSet?: ExplorerSet & { at?: number; activityId: string };
  bestE1rmSet?: ExplorerSet & { at?: number; activityId: string };
  repRangeRecords: RepRangeRecord[];
  comparison?: SessionComparison;
  plateau: PlateauIndicator;
}

interface RepRangeDefinition {
  id: string;
  label: string;
  shortLabel: string;
  min: number;
  max?: number;
}

const REP_RANGES: RepRangeDefinition[] = [
  { id: "1", label: "Single", shortLabel: "1 rep", min: 1, max: 1 },
  { id: "2-3", label: "Heavy double / triple", shortLabel: "2–3 reps", min: 2, max: 3 },
  { id: "4-6", label: "Strength", shortLabel: "4–6 reps", min: 4, max: 6 },
  { id: "7-9", label: "Strength / growth", shortLabel: "7–9 reps", min: 7, max: 9 },
  { id: "10-12", label: "Muscle growth", shortLabel: "10–12 reps", min: 10, max: 12 },
  { id: "13-15", label: "High-rep", shortLabel: "13–15 reps", min: 13, max: 15 },
  { id: "16+", label: "Endurance", shortLabel: "16+ reps", min: 16 }
];

/** Keep name matching identical to the Strength overview aggregation. */
export function explorerExerciseName(
  nameKey: string,
  rawName: string | undefined
): string {
  const resolved = resolveExerciseName(nameKey, rawName);
  return /^[TS]\d/.test(resolved)
    ? "Unnamed exercise"
    : canonicalExerciseDisplayName(resolved);
}

function repRangeFor(reps: number): RepRangeDefinition | undefined {
  return REP_RANGES.find(
    (range) => reps >= range.min && (range.max === undefined || reps <= range.max)
  );
}

interface LoadedSetScore {
  weightKg: number;
  reps: number;
  e1rmKg: number;
}

function isBetterLoadedSet(
  candidate: LoadedSetScore,
  current: LoadedSetScore | undefined
): boolean {
  if (!current) return true;
  if (candidate.weightKg > current.weightKg + EPSILON) return true;
  if (Math.abs(candidate.weightKg - current.weightKg) <= EPSILON) {
    if (candidate.reps > current.reps) return true;
    return candidate.reps === current.reps && candidate.e1rmKg > current.e1rmKg;
  }
  return false;
}

function plateauIndicator(records: ExerciseSessionRecord[]): PlateauIndicator {
  const loaded = records
    .filter((record) => record.bestE1rmKg > 0)
    .sort((left, right) => (left.at ?? 0) - (right.at ?? 0));

  if (loaded.length < 4) {
    return {
      state: "insufficient",
      label: "Building a baseline",
      detail: `${4 - loaded.length} more loaded session${4 - loaded.length === 1 ? "" : "s"} needed before calling a trend.`,
      sessionsConsidered: loaded.length
    };
  }

  const recent = loaded.slice(-6);
  const first = recent[0]!.bestE1rmKg;
  const latest = recent[recent.length - 1]!.bestE1rmKg;
  const values = recent.map((record) => record.bestE1rmKg);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const peak = Math.max(...values);
  const floor = Math.min(...values);
  const change = first > 0 ? (latest - first) / first : 0;
  const spread = mean > 0 ? (peak - floor) / mean : 0;
  const changePercent = change * 100;

  if (latest < peak * 0.95 && change < -0.03) {
    return {
      state: "declining",
      label: "Below recent peak",
      detail: `Estimated max is ${Math.abs(changePercent).toFixed(1)}% below the first of the last ${recent.length} sessions.`,
      sessionsConsidered: recent.length,
      changePercent
    };
  }

  if (change > 0.025) {
    return {
      state: "progressing",
      label: "Progressing",
      detail: `Estimated max is up ${changePercent.toFixed(1)}% across the last ${recent.length} sessions.`,
      sessionsConsidered: recent.length,
      changePercent
    };
  }

  if (spread <= 0.03) {
    return {
      state: "plateau",
      label: "Plateau watch",
      detail: `Estimated max has stayed inside a 3% band for ${recent.length} sessions.`,
      sessionsConsidered: recent.length,
      changePercent
    };
  }

  return {
    state: "steady",
    label: "Holding steady",
    detail: `No clear climb or plateau across the last ${recent.length} sessions yet.`,
    sessionsConsidered: recent.length,
    changePercent
  };
}

function markSessionPrs(records: ExerciseSessionRecord[]): ExerciseSessionRecord[] {
  let bestWeight = 0;
  let bestE1rm = 0;
  let bestVolume = 0;

  return records.map((record, index) => {
    const prs: ExerciseSessionPr[] = [];
    if (index > 0) {
      if (record.topWeightKg > bestWeight + EPSILON) prs.push("weight");
      if (record.bestE1rmKg > bestE1rm + EPSILON) prs.push("e1rm");
      if (record.volumeKg > bestVolume + EPSILON) prs.push("volume");
    }
    bestWeight = Math.max(bestWeight, record.topWeightKg);
    bestE1rm = Math.max(bestE1rm, record.bestE1rmKg);
    bestVolume = Math.max(bestVolume, record.volumeKg);
    return { ...record, prs };
  });
}

export function buildExerciseExplorer(
  sessions: readonly StrengthSession[],
  exerciseName: string
): ExerciseExplorerData {
  const chronological: ExerciseSessionRecord[] = [];

  for (const session of sessions) {
    const entries = session.detail.exercises
      .filter(
        (exercise) =>
          explorerExerciseName(exercise.nameKey, exercise.rawName) === exerciseName
      )
      .flatMap((exercise) => exercise.entries);

    if (entries.length === 0) continue;

    const sets: ExplorerSet[] = entries.map((entry, index) => ({
      ...entry,
      setNumber: index + 1,
      e1rmKg: estimateOneRepMax(entry.weightKg, entry.reps),
      volumeKg: entry.weightKg > 0 ? entry.weightKg * entry.reps : 0
    }));

    chronological.push({
      activityId: session.activityId,
      sessionName: session.name?.trim() || "Strength session",
      at: session.startTime,
      sets,
      totalReps: sets.reduce((sum, set) => sum + set.reps, 0),
      volumeKg: sets.reduce((sum, set) => sum + set.volumeKg, 0),
      topWeightKg: Math.max(0, ...sets.map((set) => set.weightKg)),
      bestE1rmKg: Math.max(0, ...sets.map((set) => set.e1rmKg)),
      workSec: sets.reduce((sum, set) => sum + set.workSec, 0),
      prs: []
    });
  }

  chronological.sort((left, right) => (left.at ?? 0) - (right.at ?? 0));
  const marked = markSessionPrs(chronological);

  let heaviestSet: ExerciseExplorerData["heaviestSet"];
  let bestE1rmSet: ExerciseExplorerData["bestE1rmSet"];
  const rangeRecords = new Map<string, RepRangeRecord>();

  for (const record of marked) {
    for (const set of record.sets) {
      const attached = { ...set, at: record.at, activityId: record.activityId };
      if (set.weightKg > 0 && isBetterLoadedSet(set, heaviestSet)) {
        heaviestSet = attached;
      }
      if (
        set.e1rmKg > 0 &&
        (!bestE1rmSet || set.e1rmKg > bestE1rmSet.e1rmKg + EPSILON)
      ) {
        bestE1rmSet = attached;
      }

      const range = set.weightKg > 0 ? repRangeFor(set.reps) : undefined;
      const current = range ? rangeRecords.get(range.id) : undefined;
      if (range && (!current || isBetterLoadedSet(set, current))) {
        rangeRecords.set(range.id, {
          id: range.id,
          label: range.label,
          shortLabel: range.shortLabel,
          minReps: range.min,
          maxReps: range.max,
          reps: set.reps,
          weightKg: set.weightKg,
          e1rmKg: set.e1rmKg,
          at: record.at,
          activityId: record.activityId
        });
      }
    }
  }

  const newest = [...marked].reverse();

  return {
    name: exerciseName,
    sessions: newest,
    totalSets: marked.reduce((sum, record) => sum + record.sets.length, 0),
    totalReps: marked.reduce((sum, record) => sum + record.totalReps, 0),
    totalVolumeKg: marked.reduce((sum, record) => sum + record.volumeKg, 0),
    heaviestSet,
    bestE1rmSet,
    repRangeRecords: REP_RANGES.map((range) => rangeRecords.get(range.id)).filter(
      (record): record is RepRangeRecord => Boolean(record)
    ),
    comparison:
      newest.length >= 2 ? { latest: newest[0]!, previous: newest[1]! } : undefined,
    plateau: plateauIndicator(marked)
  };
}
