import { canonicalStrengthExerciseName } from "./hevyModel";
import type {
  StrengthDataSource,
  StrengthSession,
  StrengthSourceIds
} from "./types";

function localDay(timestamp?: number): string | undefined {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function durationOf(session: StrengthSession): number {
  return Math.max(0, session.detail.summary.durationSec || session.duration || 0);
}

function intervalOverlapRatio(left: StrengthSession, right: StrengthSession): number {
  if (left.startTime === undefined || right.startTime === undefined) return 0;
  const leftDuration = durationOf(left);
  const rightDuration = durationOf(right);
  if (leftDuration <= 0 || rightDuration <= 0) return 0;
  const overlap = Math.max(
    0,
    Math.min(left.startTime + leftDuration, right.startTime + rightDuration) -
      Math.max(left.startTime, right.startTime)
  );
  return overlap / Math.min(leftDuration, rightDuration);
}

function exerciseIdentities(session: StrengthSession): Set<string> {
  return new Set(
    session.detail.exercises
      .map((exercise) =>
        canonicalStrengthExerciseName(exercise.rawName ?? exercise.nameKey)
      )
      .filter(Boolean)
  );
}

interface MatchCandidate {
  corosIndex: number;
  hevyIndex: number;
  sharedExercises: number;
  exerciseSimilarity: number;
  startDifference: number;
  durationDifference: number;
}

function matchCandidate(
  coros: StrengthSession,
  hevy: StrengthSession,
  corosIndex: number,
  hevyIndex: number
): MatchCandidate | undefined {
  if (
    coros.startTime === undefined ||
    hevy.startTime === undefined ||
    localDay(coros.startTime) !== localDay(hevy.startTime)
  ) {
    return undefined;
  }
  const startDifference = Math.abs(coros.startTime - hevy.startTime);
  const overlaps = intervalOverlapRatio(coros, hevy) >= 0.6;
  if (startDifference > 30 * 60 && !overlaps) return undefined;

  const corosExercises = exerciseIdentities(coros);
  const hevyExercises = exerciseIdentities(hevy);
  const sharedExercises = [...corosExercises].filter((name) => hevyExercises.has(name)).length;
  const union = new Set([...corosExercises, ...hevyExercises]).size;
  const exerciseSimilarity = union > 0 ? sharedExercises / union : 0;
  const durationDifference = Math.abs(durationOf(coros) - durationOf(hevy));
  const strictTimeFallback = startDifference <= 5 * 60 && durationDifference <= 15 * 60;
  if (sharedExercises === 0 && !strictTimeFallback) return undefined;

  return {
    corosIndex,
    hevyIndex,
    sharedExercises,
    exerciseSimilarity,
    startDifference,
    durationDifference
  };
}

function sourceIdsOf(session: StrengthSession): StrengthSourceIds {
  if (session.sourceIds) return session.sourceIds;
  return session.source === "hevy"
    ? { hevy: session.activityId.replace(/^hevy:/, "") }
    : { coros: session.activityId };
}

export function mergeStrengthSessionPair(
  coros: StrengthSession,
  hevy: StrengthSession
): StrengthSession {
  const corosId = sourceIdsOf(coros).coros ?? coros.activityId;
  const hevyId = sourceIdsOf(hevy).hevy ?? hevy.activityId.replace(/^hevy:/, "");
  const calories = coros.calories ?? coros.detail.summary.calories;
  const avgHr = coros.avgHr ?? coros.detail.summary.avgHr;
  const maxHr = coros.maxHr ?? coros.detail.summary.maxHr;
  const trainingLoad = coros.trainingLoad ?? coros.detail.summary.trainingLoad;
  return {
    ...hevy,
    activityId: `combined:${hevyId}:${corosId}`,
    source: "combined",
    sourceIds: { hevy: hevyId, coros: corosId },
    calories,
    avgHr,
    maxHr,
    trainingLoad,
    detail: {
      ...hevy.detail,
      summary: {
        ...hevy.detail.summary,
        calories: calories ?? hevy.detail.summary.calories,
        avgHr,
        maxHr,
        trainingLoad
      }
    }
  };
}

export function combineStrengthSessions(
  corosSessions: StrengthSession[],
  hevySessions: StrengthSession[]
): StrengthSession[] {
  const coros = corosSessions.map((session) => ({
    ...session,
    source: "coros" as const,
    sourceIds: sourceIdsOf({ ...session, source: "coros" })
  }));
  const candidates: MatchCandidate[] = [];
  for (let corosIndex = 0; corosIndex < coros.length; corosIndex += 1) {
    for (let hevyIndex = 0; hevyIndex < hevySessions.length; hevyIndex += 1) {
      const candidate = matchCandidate(
        coros[corosIndex],
        hevySessions[hevyIndex],
        corosIndex,
        hevyIndex
      );
      if (candidate) candidates.push(candidate);
    }
  }
  candidates.sort(
    (left, right) =>
      right.sharedExercises - left.sharedExercises ||
      right.exerciseSimilarity - left.exerciseSimilarity ||
      left.startDifference - right.startDifference ||
      left.durationDifference - right.durationDifference
  );

  const usedCoros = new Set<number>();
  const usedHevy = new Set<number>();
  const merged: StrengthSession[] = [];
  for (const candidate of candidates) {
    if (usedCoros.has(candidate.corosIndex) || usedHevy.has(candidate.hevyIndex)) {
      continue;
    }
    usedCoros.add(candidate.corosIndex);
    usedHevy.add(candidate.hevyIndex);
    merged.push(
      mergeStrengthSessionPair(
        coros[candidate.corosIndex],
        hevySessions[candidate.hevyIndex]
      )
    );
  }

  return [
    ...merged,
    ...coros.filter((_, index) => !usedCoros.has(index)),
    ...hevySessions.filter((_, index) => !usedHevy.has(index))
  ].sort((left, right) => (right.startTime ?? 0) - (left.startTime ?? 0));
}

export function selectStrengthSessions(
  source: StrengthDataSource,
  coros: StrengthSession[],
  hevy: StrengthSession[]
): StrengthSession[] {
  if (source === "coros") {
    return coros.map((session) => ({
      ...session,
      source: "coros",
      sourceIds: sourceIdsOf({ ...session, source: "coros" })
    }));
  }
  if (source === "hevy") return hevy;
  return combineStrengthSessions(coros, hevy);
}
