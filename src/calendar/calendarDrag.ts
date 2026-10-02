export const CALENDAR_DRAG_MIME =
  "application/x-coroslink-scheduled-workout";

/**
 * Marker type set alongside CALENDAR_DRAG_MIME when the dragged workout sits
 * on a past day. Past entries can only be copied, never moved; dragover can
 * read types but not data, so the rule travels as a MIME type.
 */
export const CALENDAR_DRAG_COPY_ONLY_MIME =
  "application/x-coroslink-scheduled-workout-copy-only";

/** Option (macOS) or Ctrl (Windows/Linux) held during a drag means copy. */
export function isCopyDrag(event: {
  altKey: boolean;
  ctrlKey: boolean;
  dataTransfer: DataTransfer;
}): boolean {
  return (
    event.altKey ||
    event.ctrlKey ||
    Array.from(event.dataTransfer.types).includes(CALENDAR_DRAG_COPY_ONLY_MIME)
  );
}

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
