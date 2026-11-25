"use client";
import { syncedList } from "@/data/local/synced";
import type { SavedWorkout, Workout } from "@/data/workouts";

/** Workouts planned on this computer, kept in its store as `training.workout` items. */
export const workoutStore = syncedList<SavedWorkout>("training.workout", (list) => usable<SavedWorkout>(list));

/** Workouts kept for reuse, without a day: `training.library` items. */
export const libraryStore = syncedList<Workout>("training.library", (list) => usable<Workout>(list));

/** A stable empty list for the first paint (useStore needs the same reference each time). */
export const NO_WORKOUTS: SavedWorkout[] = [];
export const NO_LIBRARY: Workout[] = [];

const usable = <T extends Workout>(list: unknown): T[] =>
  Array.isArray(list) ? (list as T[]).filter((w) => w && typeof w.id === "string" && typeof w.date === "string" && Array.isArray(w.items)) : [];

/** Drops anything in the store that is not a workout (an older or hand-edited value). */
export function cleanWorkouts(list: unknown): SavedWorkout[] {
  return usable<SavedWorkout>(list);
}

export function savedWorkouts(): SavedWorkout[] {
  return usable<SavedWorkout>(workoutStore.get());
}

export function libraryWorkouts(): Workout[] {
  return usable<Workout>(libraryStore.get());
}

/** Adds the workout to the calendar, or replaces the saved one with the same id. */
export function saveWorkout(workout: SavedWorkout): void {
  workoutStore.set((prev) => [...usable<SavedWorkout>(prev).filter((w) => w.id !== workout.id), workout]);
}

export function deleteWorkout(id: string): void {
  workoutStore.set((prev) => usable<SavedWorkout>(prev).filter((w) => w.id !== id));
}

/** Keeps a copy in the library. A copy with the same name is replaced. */
export function saveToLibrary(workout: Workout): void {
  libraryStore.set((prev) => [...usable<Workout>(prev).filter((w) => w.name !== workout.name), workout]);
}

/** Takes a kept workout out of the library. Days it was planned on stay. */
export function removeFromLibrary(id: string): void {
  libraryStore.set((prev) => usable<Workout>(prev).filter((w) => w.id !== id));
}
