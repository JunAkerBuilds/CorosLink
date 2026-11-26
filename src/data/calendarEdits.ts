"use client";
// Saving the calendar draft: each move, copy and removal goes where its workout lives.
import { hubMoveScheduled, hubRemoveScheduled, hubScheduleWorkout } from "@/data/hub";
import { createStore } from "@/data/local/store";
import { deleteWorkout, savedWorkouts, saveWorkout } from "@/data/local/workouts";
import { put, remove } from "@/data/sync";
import { calendarDayOf, newUuid } from "@/data/sync/native";
import type { CalendarEntry } from "@/data/training";
import { newWorkoutId } from "@/data/workouts";
import { addDays } from "@/lib/calendar";
import { t } from "@/lib/i18n";
import type { DraftOp, Filter, Link, NetChange } from "@/lib/calendarPlan";
import { NO_FILTER } from "@/lib/calendarPlan";

/** Changes made on the calendar and not saved yet. Kept in this browser so a reload doesn't lose them. */
export const draftStore = createStore<DraftOp[]>("calendar.draft.v1", []);
export const NO_DRAFT: DraftOp[] = [];

/** Done-to-planned pairings set by hand (right-click → Link or Unlink). Kept in this browser. */
export const linkStore = createStore<Link[]>("calendar.links.v1", []);
export const NO_LINKS: Link[] = [];

/** The calendar's filters. */
export const filterStore = createStore<Filter>("calendar.filter.v1", NO_FILTER);

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** One change, written where the workout lives. Throws with a sentence when it can't be done. */
export async function saveChange(change: NetChange<CalendarEntry>, today: string): Promise<void> {
  const e = change.entry;
  if (change.kind !== "remove" && change.to < today) throw new Error(t("“{name}” can only go on today or later.", { name: e.name }));
  if (e.source === "coros" && e.coros) {
    const where = { day: e.date, idInPlan: e.coros.idInPlan, name: e.coros.name };
    if (change.kind === "move") { await hubMoveScheduled(where, change.to); return; }
    if (change.kind === "remove") { await hubRemoveScheduled(where); return; }
    if (!e.coros.workout) throw new Error(t("“{name}” has steps this app can't write, so it can't be copied from here.", { name: e.name }));
    await hubScheduleWorkout(change.to, e.coros.workout);
    return;
  }
  if (e.source === "browser" && e.browser) {
    const saved = savedWorkouts().find((w) => w.id === e.browser!.workoutId);
    if (!saved) throw new Error(t("“{name}” is not saved on this computer any more.", { name: e.name }));
    // A workout repeated on the same weekday moves as a whole.
    if (change.kind === "move") { saveWorkout({ ...saved, date: addDays(saved.date, dayDiff(e.date, change.to)) }); return; }
    if (change.kind === "remove") { deleteWorkout(saved.id); return; }
    saveWorkout({ ...saved, id: newWorkoutId(), date: change.to, repeatWeeks: 1, savedAt: new Date().toISOString() });
    return;
  }
  if (e.source === "synced" && e.planned) {
    if (change.kind === "move") { put("gym.planned", e.planned.id, { ...e.planned, day: calendarDayOf(change.to) }); return; }
    if (change.kind === "remove") { remove("gym.planned", e.planned.id); return; }
    const id = newUuid();
    put("gym.planned", id, { id, routineID: e.planned.routineID, day: calendarDayOf(change.to) });
    return;
  }
  throw new Error(t("“{name}” can't be changed from here.", { name: e.name }));
}

/** The draft that is left when only `rest` still has to be saved. */
export function opsFor(rest: readonly NetChange<CalendarEntry>[]): DraftOp[] {
  return rest.map((c): DraftOp => (c.kind === "remove" ? { op: "remove", id: c.entry.id } : c.kind === "move" ? { op: "move", id: c.entry.id, to: c.to } : { op: "copy", id: c.entry.id, to: c.to, key: c.key }));
}

/** Where a change goes, for the review list. */
export function destination(e: CalendarEntry): string {
  if (e.source === "coros") return t("COROS calendar");
  if (e.source === "browser") return t("This computer");
  if (e.source === "synced") return t("C-LINK, reaches your phone");
  return "";
}
