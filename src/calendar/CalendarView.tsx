import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
  scheduledWorkoutKey,
  type CalendarDay,
  type CalendarMode,
  type CalendarSelection,
  type CalendarWeek
} from "./calendarTypes";
import type { CalendarDragPayload } from "./calendarDrag";
import { DayDetailPanel } from "./DayDetailPanel";
import {
  isKeyInMonth,
  monthGridWeeks,
  monthLabel,
  weekRangeLabel,
  weekRow
} from "./dateUtils";
import { useCalendarData } from "./useCalendarData";
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
  const [editRef, setEditRef] = useState<WorkoutEditRef | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedWorkoutKeys, setSelectedWorkoutKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

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

  const handleDropEntry = useCallback(
    (payload: CalendarDragPayload, targetDay: string) => {
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
        .then(() => {
          onMessage(
            `Moved "${payload.name}" to ${formatHappenDayLabel(targetDay)}.`
          );
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
    [api, applyOptimisticMove, mutating, onError, onMessage, reload]
  );

  const handleDelete = useCallback(
    (target: Extract<CalendarSelection, { kind: "scheduled" }>) => {
      setMutating(true);
      void api
        .removeScheduledWorkout(scheduledWorkoutRemovalRef(target.entry))
        .then(() => {
          onMessage(`Removed "${target.entry.name}" from the calendar.`);
          setSelection(null);
        })
        .catch((cause: unknown) => {
          onError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          setMutating(false);
          reload();
        });
    },
    [api, onError, onMessage, reload]
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
        onDropEntry={handleDropEntry}
        onAskCoachWeek={handleAskCoachWeek}
      />

      <DayDetailPanel
        api={api}
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
          }}
          onError={onError}
        />
      ) : null}
    </section>
  );
}
