import { randomUUID } from "node:crypto";
import { calendarHash } from "./calendarSyncUtils";
import { calendarSourceUserId } from "./calendarWorkoutEventStorage";
import { listScheduledWorkoutEntries, rescheduleScheduledWorkout } from "./trainingHubService";
import { findJournalEntry, mergeJournalEntry, normalizeHappenDay } from "./workoutJournalModel";
import {
  deleteJournalRow,
  findJournalRows,
  listJournalRows,
  moveScheduledJournalRows,
  upsertJournalRow
} from "./workoutJournalStore";
import type { WorkoutJournalAuthor, WorkoutJournalEntry, WorkoutJournalRef, WorkoutJournalSaveInput } from "./workoutJournalTypes";

type JournalListener = (change: { entry: WorkoutJournalEntry | null; ref: WorkoutJournalRef }) => void;

const listeners = new Set<JournalListener>();

/** Main forwards changes the Coach makes so an open calendar redraws its badges. */
export function onWorkoutJournalChanged(listener: JournalListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function userKey(): string {
  const userId = calendarSourceUserId();
  if (!userId) throw new Error("Sign in to COROS Training Hub to keep workout notes.");
  return calendarHash(`journal:${userId}`);
}

export function listWorkoutJournal(startDay: string, endDay: string): WorkoutJournalEntry[] {
  const start = normalizeHappenDay(startDay);
  const end = normalizeHappenDay(endDay);
  return listJournalRows(userKey(), start <= end ? start : end, start <= end ? end : start);
}

export function getWorkoutJournalEntry(ref: WorkoutJournalRef): WorkoutJournalEntry | undefined {
  return findJournalEntry(findJournalRows(userKey(), ref), ref);
}

export function saveWorkoutJournal(
  input: WorkoutJournalSaveInput,
  author: WorkoutJournalAuthor = "athlete"
): WorkoutJournalEntry | null {
  const key = userKey();
  const existing = findJournalEntry(findJournalRows(key, input.ref ?? {}), input.ref ?? {});
  const entry = mergeJournalEntry(existing, input, {
    author,
    now: new Date().toISOString(),
    entryId: randomUUID
  });
  if (entry) {
    upsertJournalRow(key, entry);
  } else if (existing) {
    deleteJournalRow(key, existing.entryId);
  }
  for (const listener of listeners) listener({ entry, ref: input.ref });
  return entry;
}

/**
 * Re-point notes after a drag-move. COROS gives the re-added workout a new
 * idInPlan; the planId is read back from the target day because COROS assigns
 * it. A failure leaves the notes on the old occurrence rather than losing them.
 */
export function followRescheduledWorkout(
  from: { planId: string; idInPlan: string },
  to: { planId: string; idInPlan: string; happenDay: string }
): void {
  try {
    if (moveScheduledJournalRows(userKey(), from, to) > 0) {
      for (const listener of listeners) listener({ entry: null, ref: to });
    }
  } catch {
    // Notes are a convenience; never fail the move over them.
  }
}

/** Move a calendar workout to another day; its brief and debrief follow it. */
export async function rescheduleWorkoutWithNotes(
  entry: { planId: string; idInPlan: string; planProgramId?: string; happenDay: string },
  newHappenDay: string
): Promise<void> {
  const moved = await rescheduleScheduledWorkout(entry, newHappenDay);
  if (!moved) return;
  // The re-added workout gets a new idInPlan.
  const target = (await listScheduledWorkoutEntries(newHappenDay, newHappenDay).catch(() => []))
    .find((candidate) => candidate.idInPlan === moved.idInPlan);
  if (target) {
    followRescheduledWorkout(entry, { planId: target.planId, idInPlan: target.idInPlan, happenDay: newHappenDay });
  }
}
