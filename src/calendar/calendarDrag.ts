export const CALENDAR_DRAG_MIME =
  "application/x-coroslink-scheduled-workout";

export interface CalendarDragPayload {
  planId: string;
  idInPlan: string;
  planProgramId?: string;
  happenDay: string;
  name: string;
}

type CalendarDragSource = CalendarDragPayload;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createCalendarDragPayload(
  entry: CalendarDragSource
): CalendarDragPayload {
  return {
    planId: entry.planId,
    idInPlan: entry.idInPlan,
    planProgramId: entry.planProgramId || undefined,
    happenDay: entry.happenDay,
    name: entry.name
  };
}

export function parseCalendarDragPayload(
  serialized: string
): CalendarDragPayload | null {
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !isNonEmptyString(value.planId) ||
      !isNonEmptyString(value.idInPlan) ||
      !isNonEmptyString(value.name) ||
      typeof value.happenDay !== "string" ||
      !/^\d{8}$/.test(value.happenDay) ||
      (value.planProgramId !== undefined &&
        typeof value.planProgramId !== "string")
    ) {
      return null;
    }

    return {
      planId: value.planId,
      idInPlan: value.idInPlan,
      planProgramId: value.planProgramId || undefined,
      happenDay: value.happenDay,
      name: value.name
    };
  } catch {
    return null;
  }
}

export function moveScheduledWorkoutEntries<
  Entry extends CalendarDragSource
>(
  entries: readonly Entry[],
  workout: Pick<CalendarDragPayload, "planId" | "idInPlan" | "happenDay">,
  newHappenDay: string
): Entry[] {
  return entries.map((entry) =>
    entry.planId === workout.planId &&
    entry.idInPlan === workout.idInPlan &&
    entry.happenDay === workout.happenDay
      ? { ...entry, happenDay: newHappenDay }
      : entry
  );
}
