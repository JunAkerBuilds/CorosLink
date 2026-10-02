import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarConnectionStatus } from "../../electron/calendarSyncTypes";
import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubSportType,
  TrainingHubStatus,
  UnitSystem,
  WorkoutEditRef
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatHappenDayLabel,
  formatUpcomingWorkoutLoad,
  formatUpcomingWorkoutVolumeDisplay,
  getLocalHappenDayKey
} from "../training/formatters";
import { isSwimSportType } from "../training/sportTypes";
import { AddWorkoutModal } from "./AddWorkoutModal";
import { CalendarGrid } from "./CalendarGrid";
import {
  createCalendarClipboardEntry,
  scheduledWorkoutKey,
  type CalendarClipboardEntry,
  type CalendarDay,
  type CalendarMode,
  type CalendarSelection,
  type CalendarWeek
} from "./calendarTypes";
import type { CalendarDragPayload } from "./calendarDrag";
import { DayDetailPanel } from "./DayDetailPanel";
import {
  CalendarContextMenu,
  MOD_KEY_LABEL,
  type CalendarContextMenuItem
} from "./CalendarContextMenu";
import {
  addDaysToKey,
  isKeyInMonth,
  monthGridWeeks,
  monthLabel,
  weekRangeLabel,
  weekRow
} from "./dateUtils";
import { useCalendarData } from "./useCalendarData";
import { calendarSyncButtonState } from "./calendarSyncStatus";
import { WorkoutEditorModal } from "./WorkoutEditorModal";
import { WorkoutLibraryModal } from "./WorkoutLibraryModal";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";

const CALENDAR_MODE_PREFERENCE = defineSelectionPreference<CalendarMode>({
  key: "calendar.mode",
  defaultValue: "month",
  validate: selectionIsOneOf(["month", "week"])
});

interface CalendarViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  sportTypes: TrainingHubSportType[];
  refreshToken: number;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
  onOpenTraining: () => void;
  onOpenCoach: (prompt: string) => void;
}

function describeDayForCoach(
  day: CalendarDay,
  unitSystem: UnitSystem
): string | null {
  const parts: string[] = [];
  for (const entry of day.scheduled) {
    parts.push(
      `planned "${entry.name}" (${formatUpcomingWorkoutVolumeDisplay(entry.volume, unitSystem)}, ${formatUpcomingWorkoutLoad(entry.trainingLoad)})`
    );
  }
  for (const activity of day.activities) {
    const stats = [
      activity.duration ? formatDurationSeconds(activity.duration) : null,
      activity.distance
        ? formatDistanceMeters(
            activity.distance,
            unitSystem,
            isSwimSportType(activity.sportType)
          )
        : null,
      activity.trainingLoad !== undefined
        ? `${Math.round(activity.trainingLoad)} TL`
        : null
    ]
      .filter(Boolean)
      .join(", ");
    parts.push(`completed "${activity.name ?? activity.sportName ?? "activity"}" (${stats})`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `${formatHappenDayLabel(day.dateKey)}: ${parts.join("; ")}`;
}

function scheduledWorkoutRemovalRef(entry: TrainingHubScheduledWorkoutEntry) {
  return {
    planId: entry.planId,
    idInPlan: entry.idInPlan,
    planProgramId: entry.planProgramId,
    pbVersion:
      typeof entry.rawProgram?.pbVersion === "number"
        ? entry.rawProgram.pbVersion
        : undefined
  };
}

interface CalendarContextTarget {
  x: number;
  y: number;
  dayKey: string;
  workoutKey?: string;
}

function workoutCountLabel(count: number): string {
  return count === 1 ? "workout" : `${count} workouts`;
}

const ARROW_DAY_STEPS: Record<string, number | undefined> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7
};

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true']") !== null)
  );
}

async function removeScheduledWorkoutEntries(
  api: CorosLinkApi,
  entries: TrainingHubScheduledWorkoutEntry[]
): Promise<
  Array<{ entry: TrainingHubScheduledWorkoutEntry; cause: unknown }>
> {
  const failures: Array<{
    entry: TrainingHubScheduledWorkoutEntry;
    cause: unknown;
  }> = [];

  // Schedule mutations share server-side plan state, so apply them in order
  // instead of racing several updates against the same COROS calendar.
  for (const entry of entries) {
    try {
      await api.removeScheduledWorkout(scheduledWorkoutRemovalRef(entry));
    } catch (cause: unknown) {
      failures.push({ entry, cause });
    }
  }

  return failures;
}

export function CalendarView({
  api,
  status,
  sportTypes,
  refreshToken,
  onMessage,
  onError,
  onOpenTraining,
  onOpenCoach
}: CalendarViewProps) {
  const { unitSystem } = useUnitSystem();
  const [mode, setMode] = useSelectionPreference(CALENDAR_MODE_PREFERENCE);
  const [anchor, setAnchor] = useState(() => new Date());
  const [selection, setSelection] = useState<CalendarSelection | null>(null);
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarStatuses, setCalendarStatuses] = useState<CalendarConnectionStatus[] | null>(null);
  const [editRef, setEditRef] = useState<WorkoutEditRef | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedWorkoutKeys, setSelectedWorkoutKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [clipboard, setClipboard] = useState<CalendarClipboardEntry[] | null>(null);
  const [contextMenu, setContextMenu] = useState<CalendarContextTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const statuses = await Promise.all([
          api.getGoogleCalendarStatus(),
          api.getAppleCalendarStatus()
        ]);
        if (!cancelled) setCalendarStatuses(statuses);
      } catch {
        if (!cancelled) setCalendarStatuses(null);
      }
    };
    setCalendarStatuses(null);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, calendarSyncing, mutating, refreshToken, status?.userId]);

  const calendarSyncState = calendarSyncButtonState(calendarStatuses, calendarSyncing);

  const syncCalendarEdit = useCallback(async (entry: { planId: string; idInPlan: string; happenDay: string }) => {
    if (!status?.userId) return;
    setCalendarSyncing(true);
    try {
      const result = await api.syncEditedCalendarWorkout({ userId: status.userId, ...entry });
      if (result.errors.length) onError(`Saved in CorosLink. ${result.errors.join(" ")}`);
    } catch (cause) {
      onError(`Saved in CorosLink. Calendar sync failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setCalendarSyncing(false);
    }
  }, [api, status?.userId, onError]);

  const handleSyncCalendars = useCallback(async () => {
    if (calendarSyncing) return;
    setCalendarSyncing(true);
    onError(null);
    onMessage(null);
    try {
      const providers = [
        { name: "Google Calendar", getStatus: api.getGoogleCalendarStatus, sync: api.syncGoogleCalendar },
        { name: "Apple Calendar", getStatus: api.getAppleCalendarStatus, sync: api.syncAppleCalendar }
      ];
      const results = await Promise.allSettled(providers.map(async (provider) => {
        const connection = await provider.getStatus();
        if (!connection.connected || !connection.calendar) return null;
        if (!connection.accountMatches)
          throw new Error(`${provider.name} sync is paused. Sign in to the linked COROS account or reconnect the calendar in Settings.`);
        if (connection.syncing || connection.connecting)
          return `${provider.name} sync is already running.`;
        const result = await provider.sync();
        return `${provider.name} synced: ${result.created} added, ${result.updated} updated, ${result.deleted} removed.`;
      }));
      const messages = results.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : []
      );
      const errors = results.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error
              ? result.reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
              : "Calendar sync failed. Try again."]
          : []
      );
      if (messages.length) onMessage(messages.join(" "));
      if (errors.length) onError(errors.join(" "));
      else if (!messages.length)
        onError("Connect a calendar and choose a destination in Settings to start syncing.");
    } finally {
      setCalendarSyncing(false);
    }
  }, [api, calendarSyncing, onError, onMessage]);

  const anchorYear = anchor.getFullYear();
  const anchorMonth = anchor.getMonth();

  const weekKeys = useMemo(
    () =>
      mode === "month"
        ? monthGridWeeks(anchorYear, anchorMonth)
        : [weekRow(anchor)],
    [mode, anchor, anchorYear, anchorMonth]
  );

  const isInMonth = useCallback(
    (dateKey: string) =>
      mode === "week" ? true : isKeyInMonth(dateKey, anchorYear, anchorMonth),
    [mode, anchorYear, anchorMonth]
  );

  const authenticated = Boolean(status?.authenticated);
  const { weeks, loading, error, reload, applyOptimisticMove } = useCalendarData({
    api,
    authenticated,
    weekKeys,
    refreshToken,
    isInMonth
  });

  useEffect(() => api.onWorkoutEditsChanged(() => { if (authenticated) void reload(); }), [api, authenticated, reload]);

  const selectableWorkouts = useMemo(() => {
    const entries = new Map<string, TrainingHubScheduledWorkoutEntry>();
    for (const week of weeks) {
      for (const day of week.days) {
        if (day.isPast) {
          continue;
        }
        for (const entry of day.scheduled) {
          entries.set(scheduledWorkoutKey(entry), entry);
        }
      }
    }
    return [...entries.values()];
  }, [weeks]);

  const allSelectableSelected =
    selectableWorkouts.length > 0 &&
    selectableWorkouts.every((entry) =>
      selectedWorkoutKeys.has(scheduledWorkoutKey(entry))
    );

  const headline =
    mode === "month"
      ? monthLabel(anchorYear, anchorMonth)
      : weekRangeLabel(weekKeys[0] ?? []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedWorkoutKeys(new Set());
    setConfirmBulkDelete(false);
  }, []);

  const toggleSelectionMode = () => {
    if (selectionMode) {
      exitSelectionMode();
      return;
    }
    setSelection(null);
    setSelectionMode(true);
    setSelectedWorkoutKeys(new Set());
    setConfirmBulkDelete(false);
  };

  const toggleScheduledSelection = useCallback(
    (entry: TrainingHubScheduledWorkoutEntry) => {
      const key = scheduledWorkoutKey(entry);
      setConfirmBulkDelete(false);
      setSelectedWorkoutKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    },
    []
  );

  const toggleSelectAll = () => {
    setConfirmBulkDelete(false);
    setSelectedWorkoutKeys(
      allSelectableSelected
        ? new Set()
        : new Set(selectableWorkouts.map(scheduledWorkoutKey))
    );
  };

  const navigate = (direction: -1 | 1) => {
    exitSelectionMode();
    setAnchor((current) => {
      const next = new Date(current);
      if (mode === "month") {
        next.setDate(1);
        next.setMonth(next.getMonth() + direction);
      } else {
        next.setDate(next.getDate() + direction * 7);
      }
      return next;
    });
  };

  const pasteEntries = useCallback(
    async (entries: CalendarClipboardEntry[], targetDay: string) => {
      if (mutating || entries.length === 0) {
        return;
      }
      if (targetDay < getLocalHappenDayKey()) {
        onError("COROS doesn't allow scheduling workouts in the past.");
        return;
      }
      setMutating(true);
      onError(null);
      const failures: string[] = [];
      try {
        // One at a time: each copy reads the target day's schedule to pick its slot.
        for (const entry of entries) {
          try {
            await api.copyScheduledWorkout(
              {
                planId: entry.planId,
                idInPlan: entry.idInPlan,
                happenDay: entry.happenDay,
                rawProgram: entry.rawProgram
              },
              targetDay
            );
          } catch (cause) {
            failures.push(
              `"${entry.name}": ${cause instanceof Error ? cause.message : String(cause)}`
            );
          }
        }
        const pasted = entries.length - failures.length;
        if (pasted > 0) {
          onMessage(
            pasted === 1 && entries.length === 1
              ? `Pasted "${entries[0]!.name}" on ${formatHappenDayLabel(targetDay)}.`
              : `Pasted ${pasted} workout${pasted === 1 ? "" : "s"} on ${formatHappenDayLabel(targetDay)}.`
          );
        }
        if (failures.length > 0) {
          onError(`Couldn't paste ${failures.join("; ")}`);
        }
      } finally {
        setMutating(false);
        reload();
      }
    },
    [api, mutating, onError, onMessage, reload]
  );

  const copyEntries = useCallback(
    (entries: TrainingHubScheduledWorkoutEntry[], sourceLabel?: string) => {
      if (entries.length === 0) {
        return;
      }
      setClipboard(entries.map(createCalendarClipboardEntry));
      onError(null);
      onMessage(
        `Copied ${
          entries.length === 1 ? `"${entries[0]!.name}"` : `${entries.length} workouts`
        }${sourceLabel ? ` from ${sourceLabel}` : ""}. Right-click a day to paste, or press ${MOD_KEY_LABEL}V.`
      );
    },
    [onError, onMessage]
  );

  const handleDropEntry = useCallback(
    (payload: CalendarDragPayload, targetDay: string, copy: boolean) => {
      if (copy || payload.happenDay < getLocalHappenDayKey()) {
        void pasteEntries([payload], targetDay);
        return;
      }
      if (mutating || payload.happenDay === targetDay) {
        return;
      }
      if (targetDay < getLocalHappenDayKey()) {
        onError("COROS doesn't allow scheduling workouts in the past.");
        return;
      }
      setMutating(true);
      const rollback = applyOptimisticMove(payload, targetDay);
      void api
        .rescheduleWorkout(payload, targetDay)
        .then(async () => {
          onMessage(
            `Moved "${payload.name}" to ${formatHappenDayLabel(targetDay)}.`
          );
          await syncCalendarEdit({ ...payload, happenDay: targetDay });
        })
        .catch((cause: unknown) => {
          rollback();
          onError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          setMutating(false);
          reload();
        });
    },
    [api, applyOptimisticMove, pasteEntries, mutating, onError, onMessage, reload, syncCalendarEdit]
  );

  const handleDelete = useCallback(
    (target: Extract<CalendarSelection, { kind: "scheduled" }>) => {
      setMutating(true);
      void api
        .removeScheduledWorkout(scheduledWorkoutRemovalRef(target.entry))
        .then(async () => {
          onMessage(`Removed "${target.entry.name}" from the calendar.`);
          setSelection(null);
          await syncCalendarEdit(target.entry);
        })
        .catch((cause: unknown) => {
          onError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          setMutating(false);
          reload();
        });
    },
    [api, onError, onMessage, reload, syncCalendarEdit]
  );

  const handleDeleteSelected = useCallback(() => {
    if (mutating || selectedWorkoutKeys.size === 0) {
      return;
    }
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      return;
    }

    const targets = selectableWorkouts.filter((entry) =>
      selectedWorkoutKeys.has(scheduledWorkoutKey(entry))
    );
    if (targets.length === 0) {
      exitSelectionMode();
      return;
    }

    setMutating(true);
    void removeScheduledWorkoutEntries(api, targets)
      .then((failures) => {
        const removedCount = targets.length - failures.length;

        if (removedCount > 0) {
          onMessage(
            `Removed ${removedCount} workout${removedCount === 1 ? "" : "s"} from the calendar.`
          );
        }

        if (failures.length === 0) {
          exitSelectionMode();
          return;
        }

        setSelectedWorkoutKeys(
          new Set(failures.map(({ entry }) => scheduledWorkoutKey(entry)))
        );
        setConfirmBulkDelete(false);
        const firstCause = failures[0]?.cause;
        const detail =
          firstCause instanceof Error
            ? firstCause.message
            : firstCause
              ? String(firstCause)
              : "Unknown error";
        onError(
          `${failures.length} workout${failures.length === 1 ? "" : "s"} could not be removed: ${detail}`
        );
      })
      .finally(() => {
        setMutating(false);
        reload();
      });
  }, [
    api,
    confirmBulkDelete,
    exitSelectionMode,
    mutating,
    onError,
    onMessage,
    reload,
    selectableWorkouts,
    selectedWorkoutKeys
  ]);

  const daysByKey = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const week of weeks) {
      for (const day of week.days) map.set(day.dateKey, day);
    }
    return map;
  }, [weeks]);

  const findScheduled = useCallback(
    (dayKey: string, workoutKey: string) =>
      daysByKey
        .get(dayKey)
        ?.scheduled.find((entry) => scheduledWorkoutKey(entry) === workoutKey),
    [daysByKey]
  );

  const copiedWorkoutKeys = useMemo(
    () => new Set((clipboard ?? []).map(scheduledWorkoutKey)),
    [clipboard]
  );

  const modalOpen = addTarget !== null || editRef !== null || libraryOpen;
  const keyboardState = useRef({
    clipboard,
    selection,
    selectionMode,
    selectedWorkoutKeys,
    selectableWorkouts,
    modalOpen,
    contextMenuOpen: contextMenu !== null,
    daysByKey,
    findScheduled,
    copyEntries,
    pasteEntries
  });
  keyboardState.current = {
    clipboard,
    selection,
    selectionMode,
    selectedWorkoutKeys,
    selectableWorkouts,
    modalOpen,
    contextMenuOpen: contextMenu !== null,
    daysByKey,
    findScheduled,
    copyEntries,
    pasteEntries
  };

  // ⌘C / ⌘V (Ctrl on Windows/Linux). Copy targets, most specific first: the
  // multi-select, the focused workout chip, the open workout's details, then
  // the focused or hovered day. Paste lands on the focused or hovered day.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = keyboardState.current;
      if (event.defaultPrevented || state.modalOpen || state.contextMenuOpen) return;
      if (event.key === "Escape" && state.clipboard && !state.selection) {
        setClipboard(null);
        return;
      }
      if (isEditableTarget(event.target)) return;
      const active =
        document.activeElement instanceof Element ? document.activeElement : null;

      const arrowStep = ARROW_DAY_STEPS[event.key];
      if (arrowStep && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const fromDay = active?.closest<HTMLElement>("[data-calendar-day]")?.dataset.calendarDay;
        if (!fromDay) return;
        const next = document.querySelector<HTMLElement>(
          `[data-calendar-day="${addDaysToKey(fromDay, arrowStep)}"]`
        );
        if (next) {
          event.preventDefault();
          next.focus();
        }
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      if (key === "c" && window.getSelection()?.toString()) return;

      // The pointer wins over focus: hovering a workout or day and pressing
      // ⌘C / ⌘V acts there, as in Google Calendar. Focus covers keyboard use.
      const activeWorkout =
        document.querySelector<HTMLElement>("[data-calendar-workout]:hover") ??
        active?.closest<HTMLElement>("[data-calendar-workout]");
      const dayEl =
        document.querySelector<HTMLElement>("[data-calendar-day]:hover") ??
        active?.closest<HTMLElement>("[data-calendar-day]");
      const dayKey = dayEl?.dataset.calendarDay;

      if (key === "c") {
        if (state.selectionMode && state.selectedWorkoutKeys.size > 0) {
          event.preventDefault();
          state.copyEntries(
            state.selectableWorkouts.filter((entry) =>
              state.selectedWorkoutKeys.has(scheduledWorkoutKey(entry))
            )
          );
          return;
        }
        const workoutDay = activeWorkout
          ?.closest<HTMLElement>("[data-calendar-day]")
          ?.dataset.calendarDay;
        const workout =
          workoutDay && activeWorkout?.dataset.calendarWorkout
            ? state.findScheduled(workoutDay, activeWorkout.dataset.calendarWorkout)
            : undefined;
        if (workout) {
          event.preventDefault();
          state.copyEntries([workout]);
          return;
        }
        if (state.selection?.kind === "scheduled") {
          event.preventDefault();
          state.copyEntries([state.selection.entry]);
          return;
        }
        const day = dayKey ? state.daysByKey.get(dayKey) : undefined;
        if (day && day.scheduled.length > 0) {
          event.preventDefault();
          state.copyEntries(day.scheduled, formatHappenDayLabel(day.dateKey));
        }
        return;
      }

      if (state.clipboard && dayKey) {
        event.preventDefault();
        void state.pasteEntries(state.clipboard, dayKey);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const contextMenuItems = useMemo((): CalendarContextMenuItem[] => {
    if (!contextMenu) return [];
    const day = daysByKey.get(contextMenu.dayKey);
    if (!day) return [];
    const workout = contextMenu.workoutKey
      ? findScheduled(day.dateKey, contextMenu.workoutKey)
      : undefined;
    const items: CalendarContextMenuItem[] = [];
    if (workout) {
      items.push({
        id: "copy-workout",
        label: "Copy workout",
        icon: "copy",
        shortcut: `${MOD_KEY_LABEL}C`,
        onSelect: () => copyEntries([workout])
      });
    }
    if (!workout || day.scheduled.length > 1) {
      items.push({
        id: "copy-day",
        label:
          day.scheduled.length > 0
            ? `Copy day (${workoutCountLabel(day.scheduled.length)})`
            : "Copy day",
        icon: "copy-day",
        shortcut: workout ? undefined : `${MOD_KEY_LABEL}C`,
        disabled: day.scheduled.length === 0,
        hint: day.scheduled.length === 0 ? "No scheduled workouts on this day" : undefined,
        onSelect: () => copyEntries(day.scheduled, formatHappenDayLabel(day.dateKey))
      });
    }
    items.push({
      id: "paste",
      label: clipboard ? `Paste ${workoutCountLabel(clipboard.length)}` : "Paste",
      icon: "paste",
      shortcut: `${MOD_KEY_LABEL}V`,
      disabled: !clipboard || day.isPast || mutating,
      hint: day.isPast
        ? "COROS doesn't allow scheduling workouts in the past"
        : !clipboard
          ? "Copy a workout or a day first"
          : undefined,
      onSelect: () => {
        if (clipboard) void pasteEntries(clipboard, day.dateKey);
      }
    });
    return items;
  }, [clipboard, contextMenu, copyEntries, daysByKey, findScheduled, mutating, pasteEntries]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleAskCoachWeek = useCallback(
    (week: CalendarWeek) => {
      const lines = week.days
        .map((day) => describeDayForCoach(day, unitSystem))
        .filter((line): line is string => Boolean(line));
      const stats = week.stats;
      const summary = [
        `training load ${stats.actualLoad}${stats.plannedLoad ? ` of ${stats.plannedLoad} planned` : ""} TL`,
        stats.distanceMeters > 0
          ? formatDistanceMeters(stats.distanceMeters, unitSystem)
          : null,
        stats.activityTimeSeconds > 0
          ? formatDurationSeconds(stats.activityTimeSeconds)
          : null
      ]
        .filter(Boolean)
        .join(", ");
      onOpenCoach(
        `Here's my training week of ${weekRangeLabel(week.days.map((day) => day.dateKey))} (${summary}):\n` +
          `${lines.join("\n") || "No workouts logged or planned."}\n\n` +
          "How is this week looking? Anything I should adjust?"
      );
    },
    [onOpenCoach, unitSystem]
  );

  const handleAskCoachSelection = useCallback(
    (target: CalendarSelection) => {
      if (target.kind === "scheduled") {
        onOpenCoach(
          `I have "${target.entry.name}" (${formatUpcomingWorkoutVolumeDisplay(target.entry.volume, unitSystem)}, ${formatUpcomingWorkoutLoad(target.entry.trainingLoad)}) scheduled on ${formatHappenDayLabel(target.entry.happenDay)}. How should I approach it?`
        );
      } else {
        const activity = target.activity;
        const stats = [
          activity.duration ? formatDurationSeconds(activity.duration) : null,
          activity.distance
            ? formatDistanceMeters(
                activity.distance,
                unitSystem,
                isSwimSportType(activity.sportType)
              )
            : null,
          activity.trainingLoad !== undefined
            ? `${Math.round(activity.trainingLoad)} TL`
            : null
        ]
          .filter(Boolean)
          .join(", ");
        onOpenCoach(
          `Can you review my activity "${activity.name ?? activity.sportName ?? "workout"}" from ${formatHappenDayLabel(target.day.dateKey)} (${stats})?`
        );
      }
    },
    [onOpenCoach, unitSystem]
  );

  if (!authenticated) {
    return (
      <section className="calendar-view">
        <div className="panel calendar-connect">
          <CalendarDays size={28} aria-hidden="true" />
          <h2>Training Calendar</h2>
          <p>
            Connect your COROS account to see scheduled workouts, completed
            activities, and weekly stats in one calendar.
          </p>
          <button type="button" className="primary-button" onClick={onOpenTraining}>
            Connect in Training Hub
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="calendar-view">
      <header className="calendar-header">
        <div className="calendar-header-nav">
          <button
            type="button"
            className="calendar-nav-button"
            onClick={() => {
              exitSelectionMode();
              setAnchor(new Date());
            }}
          >
            Today
          </button>
          <div className="calendar-nav-arrows">
            <button
              type="button"
              className="calendar-nav-button calendar-nav-arrow"
              onClick={() => navigate(-1)}
              aria-label={mode === "month" ? "Previous month" : "Previous week"}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="calendar-nav-button calendar-nav-arrow"
              onClick={() => navigate(1)}
              aria-label={mode === "month" ? "Next month" : "Next week"}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <h2 className="calendar-headline">{headline}</h2>
          {loading ? <span className="calendar-loading">Loading…</span> : null}
        </div>
        <div className="calendar-header-actions">
          <button
            className="calendar-nav-button"
            type="button"
            onClick={() => void handleSyncCalendars()}
            disabled={calendarSyncState === "syncing" || mutating}
            aria-busy={calendarSyncState === "syncing"}
          >
            {calendarSyncState === "synced" && !mutating ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <RefreshCw size={14} className={calendarSyncState === "syncing" ? "spin" : undefined} aria-hidden="true" />
            )}
            {calendarSyncState === "syncing" ? "Syncing…" : calendarSyncState === "synced" && !mutating ? "Synced" : "Sync now"}
          </button>
          <button
            type="button"
            className={`calendar-nav-button calendar-select-button ${selectionMode ? "is-active" : ""}`}
            onClick={toggleSelectionMode}
            disabled={
              mutating || (!selectionMode && selectableWorkouts.length === 0)
            }
            aria-pressed={selectionMode}
            title={
              selectionMode
                ? "Cancel workout selection"
                : selectableWorkouts.length === 0
                  ? "No upcoming workouts to select"
                  : "Select multiple workouts"
            }
          >
            {selectionMode ? (
              <X size={14} aria-hidden="true" />
            ) : (
              <ListChecks size={14} aria-hidden="true" />
            )}
            {selectionMode ? "Cancel" : "Select"}
          </button>
          <button
            type="button"
            className="calendar-nav-button calendar-library-button"
            onClick={() => setLibraryOpen(true)}
            disabled={selectionMode}
          >
            <BookOpen size={14} aria-hidden="true" />
            Workout Library
          </button>
          <button
            type="button"
            className="calendar-nav-button calendar-nav-arrow"
            onClick={reload}
            title="Refresh"
            aria-label="Refresh calendar"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <div className="calendar-mode-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "month"}
              className={mode === "month" ? "is-active" : ""}
              onClick={() => {
                exitSelectionMode();
                setMode("month");
              }}
            >
              Month
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "week"}
              className={mode === "week" ? "is-active" : ""}
              onClick={() => {
                exitSelectionMode();
                setMode("week");
              }}
            >
              Week
            </button>
          </div>
        </div>
      </header>

      {error ? <p className="calendar-error">{error}</p> : null}

      {selectionMode ? (
        <div
          className="calendar-selection-bar"
          role="toolbar"
          aria-label="Selected calendar workouts"
        >
          <div className="calendar-selection-summary" aria-live="polite">
            <span className="calendar-selection-icon" aria-hidden="true">
              <ListChecks size={15} />
            </span>
            <strong>
              {selectedWorkoutKeys.size} workout
              {selectedWorkoutKeys.size === 1 ? "" : "s"} selected
            </strong>
            <span>Select upcoming workouts in the calendar to remove them.</span>
          </div>
          <div className="calendar-selection-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={toggleSelectAll}
              disabled={mutating || selectableWorkouts.length === 0}
            >
              {allSelectableSelected ? "Deselect all" : "Select all"}
            </button>
            {selectedWorkoutKeys.size > 0 ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setSelectedWorkoutKeys(new Set());
                  setConfirmBulkDelete(false);
                }}
                disabled={mutating}
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              className={`ghost-button calendar-selection-delete ${confirmBulkDelete ? "is-armed" : ""}`}
              onClick={handleDeleteSelected}
              disabled={mutating || selectedWorkoutKeys.size === 0}
            >
              <Trash2 size={14} aria-hidden="true" />
              {mutating
                ? "Removing…"
                : confirmBulkDelete
                  ? `Confirm remove ${selectedWorkoutKeys.size}`
                  : `Remove ${selectedWorkoutKeys.size || ""}`.trim()}
            </button>
          </div>
        </div>
      ) : null}

      <CalendarGrid
        weeks={weeks}
        mode={mode}
        loading={loading}
        busy={mutating}
        selectionMode={selectionMode}
        selectedWorkoutKeys={selectedWorkoutKeys}
        onSelectScheduled={(day, entry) => setSelection({ kind: "scheduled", day, entry })}
        onSelectActivity={(day, activity: TrainingHubActivity) =>
          setSelection({ kind: "activity", day, activity })
        }
        onToggleScheduled={toggleScheduledSelection}
        onAdd={setAddTarget}
        onCopyDay={(day) => copyEntries(day.scheduled, formatHappenDayLabel(day.dateKey))}
        onPasteDay={(dateKey) => {
          if (clipboard) void pasteEntries(clipboard, dateKey);
        }}
        clipboardCount={clipboard?.length ?? 0}
        onDropEntry={handleDropEntry}
        onAskCoachWeek={handleAskCoachWeek}
        copiedWorkoutKeys={copiedWorkoutKeys}
        onContextMenu={(target) => {
          if (!selectionMode) setContextMenu(target);
        }}
      />

      {contextMenu && contextMenuItems.length > 0 ? (
        <CalendarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={
            (contextMenu.workoutKey &&
              findScheduled(contextMenu.dayKey, contextMenu.workoutKey)?.name) ||
            formatHappenDayLabel(contextMenu.dayKey)
          }
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      ) : null}

      <DayDetailPanel
        api={api}
        userId={status?.userId}
        onEventSaved={(event) => {
          setSelection(current => current?.kind === "scheduled" ? { ...current, entry: { ...current.entry, calendarEvent: event } } : current);
          reload();
        }}
        selection={selection}
        sportTypes={sportTypes}
        deleting={mutating}
        onClose={() => setSelection(null)}
        onDelete={handleDelete}
        onAskCoach={handleAskCoachSelection}
        onEdit={(target) => {
          setSelection(null);
          setEditRef({
            kind: "scheduled",
            happenDay: target.entry.happenDay,
            planId: target.entry.planId,
            idInPlan: target.entry.idInPlan,
            planProgramId: target.entry.planProgramId
          });
        }}
        onError={onError}
      />

      {addTarget ? (
        <AddWorkoutModal
          api={api}
          dateKey={addTarget}
          sportTypes={sportTypes}
          onClose={() => setAddTarget(null)}
          onScheduled={(message) => {
            onMessage(message);
            setAddTarget(null);
            reload();
          }}
          onError={onError}
          onEditLibrary={(programId) => {
            setAddTarget(null);
            setEditRef({ kind: "library", programId });
          }}
        />
      ) : null}

      {libraryOpen ? (
        <WorkoutLibraryModal
          api={api}
          onClose={() => setLibraryOpen(false)}
          onEdit={(ref) => {
            setLibraryOpen(false);
            setEditRef(ref);
          }}
          onScheduled={(message) => {
            onMessage(message);
            setLibraryOpen(false);
            reload();
          }}
          onError={onError}
        />
      ) : null}

      {editRef ? (
        <WorkoutEditorModal
          api={api}
          editRef={editRef}
          onClose={() => setEditRef(null)}
          onSaved={(result) => {
            const scope = editRef.kind === "scheduled" ? "scheduled occurrence" : "library workout";
            onMessage(result.verified ? `Updated ${scope} in COROS.` : result.warning ?? `Updated ${scope}, but verification is still pending.`);
            setEditRef(null);
            reload();
            if (editRef.kind === "scheduled") void syncCalendarEdit(editRef);
          }}
          onError={onError}
        />
      ) : null}
    </section>
  );
}
