import { getLocale, useLanguage, t } from "../i18n/training";
import { useLocalOnlyView } from "../privacy/localOnlyView";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CalendarConnectionStatus } from "../../electron/calendarSyncTypes";
import type {
  StrengthSession,
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubSportType,
  TrainingHubStatus,
  UnitSystem,
  WorkoutEditRef
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { activityMovingSeconds } from "../../electron/activityTime";
import { scheduledLinkKey } from "../../electron/activityLinks";
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
import { CalendarAgenda, scrollAgendaToToday } from "./CalendarAgenda";
import { CalendarFilterBar } from "./CalendarFilterBar";
import {
  countCalendarEntries,
  countCalendarSports,
  DEFAULT_CALENDAR_FILTER,
  filterCalendarDay,
  isCalendarFilter,
  isCalendarFilterActive,
  type CalendarFilter
} from "./calendarFilters";
import { CalendarGrid, type CalendarContextTarget } from "./CalendarGrid";
import {
  createCalendarClipboardEntry,
  scheduledWorkoutKey,
  type CalendarClipboardEntry,
  type CalendarDay,
  type CalendarMode,
  type CalendarNavigationRequest,
  type CalendarSelection,
  type CalendarWeek,
  type PlannedActualPair
} from "./calendarTypes";
import type { CalendarDragPayload } from "./calendarDrag";
import { DayDetailPanel } from "./DayDetailPanel";
import { ExternalWorkoutPanel } from "./ExternalWorkoutPanel";
import {
  CalendarContextMenu,
  MOD_KEY_LABEL,
  type CalendarContextMenuItem
} from "./CalendarContextMenu";
import {
  addDaysToKey,
  dateFromKey,
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
import { sameJson } from "../sameJson";
import {
  defineSelectionPreference,
  selectionIsBoolean,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";

const CALENDAR_MODE_PREFERENCE = defineSelectionPreference<CalendarMode>({
  key: "calendar.mode",
  defaultValue: "month",
  validate: selectionIsOneOf(["month", "week", "agenda"])
});

const CALENDAR_FILTER_PREFERENCE = defineSelectionPreference<CalendarFilter>({
  key: "calendar.filter",
  defaultValue: DEFAULT_CALENDAR_FILTER,
  validate: isCalendarFilter
});

const CALENDAR_FILTER_BAR_PREFERENCE = defineSelectionPreference<boolean>({
  key: "calendar.filterBarOpen",
  defaultValue: false,
  validate: selectionIsBoolean
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
  /** A day (and workout) another view asked to open; consumed once. */
  navigationRequest?: CalendarNavigationRequest | null;
  onNavigationRequestHandled?: () => void;
}

/** Moving time, like COROS shows it; null when the activity has none. */
function formatMovingTime(activity: TrainingHubActivity): string | null {
  const seconds = activityMovingSeconds(activity);
  return seconds ? formatDurationSeconds(seconds) : null;
}

/**
 * Plan workouts often share a long prefix ("2026 Block 6 … W3D1: 4x20s
 * Strides"), which truncates every menu item to the same text. Drop the
 * shared words so each reads apart; the full name stays in the tooltip.
 */
function distinctNames(names: string[]): string[] {
  if (names.length < 2 || new Set(names).size < names.length) return names;
  let prefix = names[0]!;
  for (const name of names) {
    while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const cut = prefix.lastIndexOf(" ") + 1;
  const rest = names.map((name) => name.slice(cut).replace(/^[\s:·–—-]+/, ""));
  return cut > 0 && rest.every(Boolean) ? rest : names;
}

function activityMenuLabel(activity: TrainingHubActivity): string {
  const name = activity.name || (activity.sportName == null ? undefined : t(String(activity.sportName))) || t("Activity");
  const time = formatMovingTime(activity);
  return time ? `${name} · ${time}` : name;
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
      formatMovingTime(activity),
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

/** The occurrence a navigation request names: its schedule ids, else name and slot. */
function findNavigationPair(
  day: CalendarDay,
  workout: CalendarNavigationRequest["workout"]
): PlannedActualPair | undefined {
  if (!workout) return undefined;
  const exact = workout.idInPlan
    ? day.pairs.find(
        (pair) =>
          pair.scheduled.idInPlan === workout.idInPlan &&
          (!workout.planId || pair.scheduled.planId === workout.planId)
      )
    : undefined;
  if (exact) return exact;
  const named = day.pairs.filter((pair) => pair.scheduled.name.trim() === workout.name.trim());
  return named.find((pair) => workout.sortNo === undefined || pair.scheduled.sortNo === workout.sortNo) ?? named[0];
}

/** Center an element in the calendar's own scroller, leaving the page where it is. */
function scrollIntoCalendar(element: HTMLElement) {
  const scroller = element.closest<HTMLElement>(".calendar-grid-body, .calendar-agenda-scroll");
  if (!scroller) return;
  const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += offset - (scroller.clientHeight - element.offsetHeight) / 2;
}

function workoutCountLabel(count: number): string {
  return count === 1 ? t("workout") : t("{{value1}} workouts", { value1: String(count) });
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
  onOpenCoach,
  navigationRequest,
  onNavigationRequestHandled
}: CalendarViewProps) {
  useLanguage();
  const localOnly = useLocalOnlyView();
  const { unitSystem } = useUnitSystem();
  const [mode, setMode] = useSelectionPreference(CALENDAR_MODE_PREFERENCE);
  const [filter, setFilter] = useSelectionPreference(CALENDAR_FILTER_PREFERENCE);
  const [filterBarOpen, setFilterBarOpen] = useSelectionPreference(CALENDAR_FILTER_BAR_PREFERENCE);
  const filterBarId = useId();
  // Opened from another view: start on that day so the first fetch is the right range.
  const [anchor, setAnchor] = useState(() =>
    navigationRequest ? dateFromKey(navigationRequest.happenDay) : new Date()
  );
  const [pendingNavigation, setPendingNavigation] = useState<CalendarNavigationRequest | null>(null);
  const [highlightedWorkoutKey, setHighlightedWorkoutKey] = useState<string | null>(null);
  const handledNavigationId = useRef<number | null>(null);
  const navigationSelection = useRef<CalendarSelection | null>(null);
  const [selection, setSelection] = useState<CalendarSelection | null>(null);
  const [externalSelection, setExternalSelection] = useState<StrengthSession | null>(null);
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
        // Polled every 3 s; without this the whole calendar re-renders on every poll.
        if (!cancelled) {
          setCalendarStatuses((current) => (sameJson(current, statuses) ? current : statuses));
        }
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
      if (result.errors.length) onError(t("Saved in CorosLink. {{value1}}", { value1: String(result.errors.join(" ")) }));
    } catch (cause) {
      onError(t("Saved in CorosLink. Calendar sync failed: {{value1}}", { value1: String(cause instanceof Error ? cause.message : String(cause)) }));
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
          throw new Error(t("{{value1}} sync is paused. Sign in to the linked COROS account or reconnect the calendar in Settings.", { value1: String(provider.name) }));
        if (connection.syncing || connection.connecting)
          return t("{{value1}} sync is already running.", { value1: String(provider.name) });
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

  // The list shows the same month as the month grid.
  const weekKeys = useMemo(
    () =>
      mode === "week"
        ? [weekRow(anchor)]
        : monthGridWeeks(anchorYear, anchorMonth),
    [mode, anchor, anchorYear, anchorMonth, getLocale()]
  );

  const isInMonth = useCallback(
    (dateKey: string) =>
      mode === "week" ? true : isKeyInMonth(dateKey, anchorYear, anchorMonth),
    [mode, anchorYear, anchorMonth]
  );

  const authenticated = Boolean(status?.authenticated);
  const { weeks, journal, manualLinks, loading, ready, error, reload, applyOptimisticMove, applyJournalSave, setManualLink } = useCalendarData({
    api,
    authenticated,
    weekKeys,
    refreshToken,
    isInMonth
  });

  useEffect(() => api.onWorkoutEditsChanged(() => { if (authenticated) void reload(); }), [api, authenticated, reload]);
  // A renamed activity shows its new name on its day, wherever it was renamed.
  useEffect(() => api.onTrainingHubActivityRenamed(() => { if (authenticated) void reload(); }), [api, authenticated, reload]);
  // Until the visible range's own data is in. `loading` alone can flip true and back within one render.
  const settling = !error && (loading || !ready);

  // Filters hide entries from the grid and the list; week totals still count everything.
  const visibleWeeks = useMemo(
    () =>
      isCalendarFilterActive(filter)
        ? weeks.map((week) => ({ ...week, days: week.days.map((day) => filterCalendarDay(day, filter)) }))
        : weeks,
    [weeks, filter]
  );
  // The days on screen: the list leaves out the neighbouring months' days.
  const shownDays = useMemo(() => {
    const days = weeks.flatMap((week) => week.days);
    return mode === "agenda" ? days.filter((day) => day.inMonth) : days;
  }, [weeks, mode]);
  const visibleShownDays = useMemo(() => {
    const days = visibleWeeks.flatMap((week) => week.days);
    return mode === "agenda" ? days.filter((day) => day.inMonth) : days;
  }, [visibleWeeks, mode]);
  const sportCounts = useMemo(() => countCalendarSports(shownDays, filter.kind), [shownDays, filter.kind]);
  const hiddenCount = countCalendarEntries(shownDays) - countCalendarEntries(visibleShownDays);
  const filterActive = isCalendarFilterActive(filter);
  const activeFilterCount = (filter.kind === "all" ? 0 : 1) + filter.hiddenSports.length;

  // Only what's on screen can be selected, so a bulk remove never takes a hidden workout.
  const selectableWorkouts = useMemo(() => {
    const entries = new Map<string, TrainingHubScheduledWorkoutEntry>();
    for (const day of visibleShownDays) {
      if (day.isPast) {
        continue;
      }
      for (const { scheduled } of day.pairs) {
        entries.set(scheduledWorkoutKey(scheduled), scheduled);
      }
    }
    return [...entries.values()];
  }, [visibleShownDays, getLocale()]);

  const allSelectableSelected =
    selectableWorkouts.length > 0 &&
    selectableWorkouts.every((entry) =>
      selectedWorkoutKeys.has(scheduledWorkoutKey(entry))
    );

  const headline =
    mode === "week"
      ? weekRangeLabel(weekKeys[0] ?? [])
      : monthLabel(anchorYear, anchorMonth);

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
      if (mode !== "week") {
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
        t("Copied {{value1}}{{value2}}. Right-click a day to paste, or press {{value3}}V.", { value1: String(entries.length === 1 ? `"${entries[0]!.name}"` : t("{{value1}} workouts", { value1: String(entries.length) })), value2: String(sourceLabel ? ` from ${sourceLabel}` : ""), value3: String(MOD_KEY_LABEL) })
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
          onMessage(t("Removed \"{{value1}}\" from the calendar.", { value1: String(target.entry.name) }));
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
            t("Removed {{value1}} workout{{value2}} from the calendar.", { value1: String(removedCount), value2: String(removedCount === 1 ? "" : "s") })
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
          t("{{value1}} workout{{value2}} could not be removed: {{value3}}", { value1: String(failures.length), value2: String(failures.length === 1 ? "" : "s"), value3: String(detail) })
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
  }, [weeks, getLocale()]);

  const findScheduled = useCallback(
    (dayKey: string, workoutKey: string) =>
      daysByKey
        .get(dayKey)
        ?.scheduled.find((entry) => scheduledWorkoutKey(entry) === workoutKey),
    [daysByKey]
  );

  const copiedWorkoutKeys = useMemo(
    () => new Set((clipboard ?? []).map(scheduledWorkoutKey)),
    [clipboard, getLocale()]
  );

  // Another view asked for a day: move there, then open the workout once its range has loaded.
  useEffect(() => {
    if (!navigationRequest) return;
    if (handledNavigationId.current !== navigationRequest.requestId) {
      handledNavigationId.current = navigationRequest.requestId;
      exitSelectionMode();
      setContextMenu(null);
      setSelection(null);
      setAnchor(dateFromKey(navigationRequest.happenDay));
      setPendingNavigation(navigationRequest);
    }
    onNavigationRequestHandled?.();
  }, [navigationRequest, onNavigationRequestHandled, exitSelectionMode]);

  useEffect(() => {
    if (!pendingNavigation) return;
    if (error) {
      setPendingNavigation(null);
      return;
    }
    const day = ready ? daysByKey.get(pendingNavigation.happenDay) : undefined;
    if (!day) return;
    setPendingNavigation(null);
    const pair = findNavigationPair(day, pendingNavigation.workout);
    const selector = pair
      ? `[data-calendar-workout="${CSS.escape(scheduledWorkoutKey(pair.scheduled))}"]`
      : `[data-calendar-day="${pendingNavigation.happenDay}"]`;
    if (pair) {
      navigationSelection.current = pair.activity
        ? { kind: "activity", day, activity: pair.activity }
        : { kind: "scheduled", day, entry: pair.scheduled };
      setHighlightedWorkoutKey(scheduledWorkoutKey(pair.scheduled));
      setSelection(navigationSelection.current);
    }
    // After the grid's own scroll-to-today has run.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return;
        scrollIntoCalendar(element);
        if (!pair) element.focus({ preventScroll: true });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingNavigation, ready, error, daysByKey]);

  // Once its details close, hand focus to the opened workout and let the ring fade.
  useEffect(() => {
    if (!highlightedWorkoutKey) return;
    if (selection) {
      // Opening anything else ends the hand-off.
      if (selection !== navigationSelection.current) setHighlightedWorkoutKey(null);
      return;
    }
    document
      .querySelector<HTMLElement>(`[data-calendar-workout="${CSS.escape(highlightedWorkoutKey)}"]`)
      ?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setHighlightedWorkoutKey(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedWorkoutKey, selection]);

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
    // Linking is the user's call: CorosLink never pairs a plan and an activity
    // COROS didn't link, so the menu offers the same-day candidates.
    const link = (entry: TrainingHubScheduledWorkoutEntry, activity: TrainingHubActivity | null | undefined) => {
      onError(null);
      setManualLink(entry, activity).catch((cause: unknown) =>
        onError(t("Couldn't save the link: {{value1}}", { value1: cause instanceof Error ? cause.message : String(cause) }))
      );
    };
    if (!day.isPast && !day.isToday) {
      // Nothing to link yet.
    } else if (workout) {
      const pair = day.pairs.find((candidate) => scheduledWorkoutKey(candidate.scheduled) === contextMenu.workoutKey);
      if (pair?.activity) {
        items.push({
          id: "unlink-activity",
          label: "Unlink activity",
          icon: "unlink",
          hint: pair.linkSource === "coros"
            ? "COROS linked these because the workout was started from the plan. Unlinking only changes CorosLink."
            : undefined,
          // Hide COROS's link; dropping the user's own brings COROS's back, if any.
          onSelect: () => link(workout, pair.linkSource === "coros" ? null : undefined)
        });
      } else {
        const workoutLinkKey = scheduledLinkKey(workout);
        if (workout.corosActivity && manualLinks.some((manual) => scheduledLinkKey(manual) === workoutLinkKey)) {
          items.push({
            id: "restore-coros-link",
            label: "Restore COROS link",
            icon: "link",
            onSelect: () => link(workout, undefined)
          });
        }
        for (const activity of day.unplannedActivities) {
          items.push({
            id: `link-${activity.activityId}`,
            label: t("Link “{{value1}}”", { value1: activityMenuLabel(activity) }),
            icon: "link",
            onSelect: () => link(workout, activity)
          });
        }
      }
    } else if (contextMenu.activityId) {
      const activity = day.unplannedActivities.find((candidate) => candidate.activityId === contextMenu.activityId);
      if (activity) {
        const open = day.pairs.filter((pair) => !pair.activity);
        const names = distinctNames(open.map((pair) => pair.scheduled.name));
        open.forEach((pair, index) => {
          items.push({
            id: `link-${scheduledWorkoutKey(pair.scheduled)}`,
            label: t("Link to “{{value1}}”", { value1: names[index]! }),
            icon: "link",
            hint: pair.scheduled.name,
            onSelect: () => link(pair.scheduled, activity)
          });
        });
      }
    }
    if (!workout || day.scheduled.length > 1) {
      items.push({
        id: "copy-day",
        label:
          day.scheduled.length > 0
            ? t("Copy day ({{value1}})", { value1: String(workoutCountLabel(day.scheduled.length)) })
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
  }, [clipboard, contextMenu, copyEntries, daysByKey, findScheduled, manualLinks, mutating, onError, pasteEntries, setManualLink, getLocale()]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleAskCoachWeek = useCallback(
    (week: CalendarWeek) => {
      const lines = week.days
        .map((day) => describeDayForCoach(day, unitSystem))
        .filter((line): line is string => Boolean(line));
      const stats = week.stats;
      const summary = [
        t("training load {{value1}}{{value2}} TL", { value1: String(stats.actualLoad), value2: stats.plannedLoad ? t(" of {{value1}} planned", { value1: String(stats.plannedLoad) }) : "" }),
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

  const handleAskCoachBrief = useCallback(
    (target: CalendarSelection) => {
      const name = target.kind === "scheduled"
        ? target.entry.name
        : target.day.pairs.find((pair) => pair.activity?.activityId === target.activity.activityId)?.scheduled.name ?? target.activity.name;
      const day = target.kind === "scheduled" ? target.entry.happenDay : target.day.dateKey;
      onOpenCoach(
        `Write a brief for my "${name ?? "workout"}" on ${formatHappenDayLabel(day)}: a one-line goal, 2–4 focus cues to watch, and a fuel plan if this session needs one. Save it to the workout so I see it in the calendar.`
      );
    },
    [onOpenCoach]
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
          formatMovingTime(activity),
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
          <h2>{t("Training Calendar")}</h2>
          <p>
            {t("Connect your COROS account to see scheduled workouts, completed activities, and weekly stats in one calendar.")} </p>
          <button type="button" className="primary-button" onClick={onOpenTraining}>
            {t("Connect in Training Hub")} </button>
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
              if (mode === "agenda") window.requestAnimationFrame(() => scrollAgendaToToday());
            }}
          >
            {t("Today")} </button>
          <div className="calendar-nav-arrows">
            <button
              type="button"
              className="calendar-nav-button calendar-nav-arrow"
              onClick={() => navigate(-1)}
              aria-label={mode === "week" ? t("Previous week") : t("Previous month")}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="calendar-nav-button calendar-nav-arrow"
              onClick={() => navigate(1)}
              aria-label={mode === "week" ? t("Next week") : t("Next month")}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <h2 className="calendar-headline">{headline}</h2>
          {loading ? <span className="calendar-loading">{t("Loading…")}</span> : null}
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
            {calendarSyncState === "syncing" ? t("Syncing…") : calendarSyncState === "synced" && !mutating ? t("Synced") : t("Sync now", undefined, "calendarToolbar")}
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
                ? t("Cancel workout selection")
                : selectableWorkouts.length === 0
                  ? t("No upcoming workouts to select")
                  : t("Select multiple workouts")
            }
          >
            {selectionMode ? (
              <X size={14} aria-hidden="true" />
            ) : (
              <ListChecks size={14} aria-hidden="true" />
            )}
            {selectionMode ? t("Cancel") : t("Select")}
          </button>
          <button
            type="button"
            className="calendar-nav-button calendar-library-button"
            onClick={() => setLibraryOpen(true)}
            disabled={selectionMode}
          >
            <BookOpen size={14} aria-hidden="true" />
            {t("Workout Library", undefined, "calendarToolbar")} </button>
          <button
            type="button"
            className="calendar-nav-button calendar-nav-arrow"
            onClick={reload}
            title={t("Refresh")}
            aria-label={t("Refresh calendar")}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={[
              "calendar-nav-button",
              "calendar-filter-button",
              filterBarOpen && "is-open",
              filterActive && "is-active"
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setFilterBarOpen((open) => !open)}
            aria-expanded={filterBarOpen}
            aria-controls={filterBarOpen ? filterBarId : undefined}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            {t("Filters")}
            {activeFilterCount > 0 ? (
              <span className="calendar-filter-badge">
                <span className="sr-only">{t("Active filters:")} </span>
                {activeFilterCount}
              </span>
            ) : null}
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
              {t("Month")} </button>
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
              {t("Week")} </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "agenda"}
              className={mode === "agenda" ? "is-active" : ""}
              onClick={() => {
                exitSelectionMode();
                setMode("agenda");
              }}
            >
              {t("List")} </button>
          </div>
        </div>
      </header>

      {error ? <p className="calendar-error">{error}</p> : null}

      {filterBarOpen ? (
        <CalendarFilterBar
          id={filterBarId}
          filter={filter}
          sports={sportCounts}
          hiddenCount={hiddenCount}
          onChange={(next) => {
            setConfirmBulkDelete(false);
            setSelectedWorkoutKeys(new Set());
            setFilter(next);
          }}
        />
      ) : null}

      {selectionMode ? (
        <div
          className="calendar-selection-bar"
          role="toolbar"
          aria-label={t("Selected calendar workouts")}
        >
          <div className="calendar-selection-summary" aria-live="polite">
            <span className="calendar-selection-icon" aria-hidden="true">
              <ListChecks size={15} />
            </span>
            <strong>
              {selectedWorkoutKeys.size} {t("workout")} {selectedWorkoutKeys.size === 1 ? "" : "s"} {t("selected")} </strong>
            <span>{t("Select upcoming workouts in the calendar to remove them.")}</span>
          </div>
          <div className="calendar-selection-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={toggleSelectAll}
              disabled={mutating || selectableWorkouts.length === 0}
            >
              {allSelectableSelected ? t("Deselect all") : t("Select all")}
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
                {t("Clear")} </button>
            ) : null}
            <button
              type="button"
              className={`ghost-button calendar-selection-delete ${confirmBulkDelete ? "is-armed" : ""}`}
              onClick={handleDeleteSelected}
              disabled={mutating || selectedWorkoutKeys.size === 0}
            >
              <Trash2 size={14} aria-hidden="true" />
              {mutating
                ? t("Removing…")
                : confirmBulkDelete
                  ? t("Confirm remove {{value1}}", { value1: String(selectedWorkoutKeys.size) })
                  : t("Remove {{value1}}", { value1: String(selectedWorkoutKeys.size || "") }).trim()}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "agenda" ? (
        <CalendarAgenda
          weeks={visibleWeeks}
          loading={settling}
          busy={mutating}
          selectionMode={selectionMode}
          selectedWorkoutKeys={selectedWorkoutKeys}
          highlightedWorkoutKey={highlightedWorkoutKey}
          hiddenCount={hiddenCount}
          onShowEverything={() => setFilter(DEFAULT_CALENDAR_FILTER)}
          onSelectScheduled={(day, entry) => setSelection({ kind: "scheduled", day, entry })}
          onSelectActivity={(day, activity) => setSelection({ kind: "activity", day, activity })}
          onSelectExternal={setExternalSelection}
          onToggleScheduled={toggleScheduledSelection}
          onAdd={setAddTarget}
          onContextMenu={(target) => {
            if (!selectionMode) setContextMenu(target);
          }}
        />
      ) : (
        <CalendarGrid
          weeks={visibleWeeks}
          mode={mode}
          loading={settling}
          busy={mutating}
          selectionMode={selectionMode}
          selectedWorkoutKeys={selectedWorkoutKeys}
          highlightedWorkoutKey={highlightedWorkoutKey}
          onSelectScheduled={(day, entry) => setSelection({ kind: "scheduled", day, entry })}
          onSelectExternal={setExternalSelection}
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
      )}

      {contextMenu && contextMenuItems.length > 0 ? (
        <CalendarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={
            (contextMenu.workoutKey &&
              findScheduled(contextMenu.dayKey, contextMenu.workoutKey)?.name) ||
            (contextMenu.activityId &&
              daysByKey.get(contextMenu.dayKey)?.activities.find((activity) => activity.activityId === contextMenu.activityId)?.name) ||
            formatHappenDayLabel(contextMenu.dayKey)
          }
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      ) : null}

      <ExternalWorkoutPanel session={externalSelection} onClose={() => setExternalSelection(null)} />

      <DayDetailPanel
        api={api}
        onMessage={onMessage}
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
        journal={journal}
        onJournalSaved={applyJournalSave}
        onAskCoachBrief={handleAskCoachBrief}
        onRenameActivity={async (activity, name) => {
          const saved = await api.renameTrainingHubActivity(activity.activityId, name, activity.startTime);
          setSelection((current) =>
            current?.kind === "activity" && current.activity.activityId === activity.activityId
              ? { ...current, activity: { ...current.activity, name: saved } }
              : current
          );
          return saved;
        }}
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
            onMessage(localOnly ? t("Updated {{value1}}.", { value1: String(scope) }) : result.verified ? t("Updated {{value1}} in COROS.", { value1: String(scope) }) : result.warning ?? t("Updated {{value1}}, but verification is still pending.", { value1: String(scope) }));
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
