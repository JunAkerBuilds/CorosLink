import type { WorkoutJournalEntry, WorkoutJournalRef } from "../../electron/workoutJournalTypes";
import { findJournalEntry } from "../../electron/workoutJournalModel";
import type { CalendarSelection, PlannedActualPair } from "./calendarTypes";

/**
 * The journal ref for whatever the panel shows. A completed activity paired
 * with a scheduled workout keeps the scheduled key, so the brief written
 * before the session and the debrief written after it share one entry.
 */
export function journalRefForSelection(selection: CalendarSelection): WorkoutJournalRef {
  if (selection.kind === "scheduled") {
    const { entry } = selection;
    const activity = selection.day.pairs.find((pair) => pair.scheduled.planId === entry.planId && pair.scheduled.idInPlan === entry.idInPlan)?.activity;
    return {
      happenDay: entry.happenDay,
      planId: entry.planId,
      idInPlan: entry.idInPlan,
      ...(activity ? { activityId: activity.activityId } : {}),
      workoutName: entry.name,
      sportType: entry.sportType
    };
  }
  const { activity } = selection;
  const pair = selection.day.pairs.find((candidate) => candidate.activity?.activityId === activity.activityId);
  return {
    happenDay: selection.day.dateKey,
    ...(pair ? { planId: pair.scheduled.planId, idInPlan: pair.scheduled.idInPlan } : {}),
    activityId: activity.activityId,
    workoutName: activity.name ?? pair?.scheduled.name ?? activity.sportName,
    sportType: activity.sportType
  };
}

export function journalEntryForPair(
  entries: readonly WorkoutJournalEntry[] | undefined,
  pair: Pick<PlannedActualPair, "scheduled" | "activity">
): WorkoutJournalEntry | undefined {
  if (!entries?.length) return undefined;
  return findJournalEntry(entries, {
    planId: pair.scheduled.planId,
    idInPlan: pair.scheduled.idInPlan,
    activityId: pair.activity?.activityId
  });
}

export function journalEntryForActivity(
  entries: readonly WorkoutJournalEntry[] | undefined,
  activityId: string
): WorkoutJournalEntry | undefined {
  return entries?.length ? findJournalEntry(entries, { activityId }) : undefined;
}
