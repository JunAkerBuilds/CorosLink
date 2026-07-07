import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubSportType,
  TrainingHubStatus
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatHappenDayLabel,
  formatUpcomingWorkoutLoad,
  formatUpcomingWorkoutVolumeDisplay,
  getLocalHappenDayKey
} from "../training/formatters";
import { AddWorkoutModal } from "./AddWorkoutModal";
import { CalendarGrid } from "./CalendarGrid";
import type {
  CalendarDay,
  CalendarMode,
  CalendarSelection,
  CalendarWeek
} from "./calendarTypes";
import type { CalendarDragPayload } from "./DayCell";
import { DayDetailPanel } from "./DayDetailPanel";
import {
  isKeyInMonth,
  monthGridWeeks,
  monthLabel,
  weekRangeLabel,
  weekRow
} from "./dateUtils";
import { useCalendarData } from "./useCalendarData";

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

function describeDayForCoach(day: CalendarDay): string | null {
  const parts: string[] = [];
  for (const entry of day.scheduled) {
    parts.push(
      `planned "${entry.name}" (${formatUpcomingWorkoutVolumeDisplay(entry.volume)}, ${formatUpcomingWorkoutLoad(entry.trainingLoad)})`
    );
  }
  for (const activity of day.activities) {
    const stats = [
      activity.duration ? formatDurationSeconds(activity.duration) : null,
      activity.distance ? formatDistanceMeters(activity.distance) : null,
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
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selection, setSelection] = useState<CalendarSelection | null>(null);
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

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

  const headline =
    mode === "month"
      ? monthLabel(anchorYear, anchorMonth)
      : weekRangeLabel(weekKeys[0] ?? []);

  const navigate = (direction: -1 | 1) => {
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
      if (payload.happenDay === targetDay) {
        return;
      }
      if (targetDay < getLocalHappenDayKey()) {
        onError("COROS doesn't allow scheduling workouts in the past.");
        return;
      }
      setMutating(true);
      applyOptimisticMove(
        {
          planId: payload.planId,
          idInPlan: payload.idInPlan,
          planProgramId: payload.planProgramId ?? "",
          happenDay: payload.happenDay,
          name: ""
        } as TrainingHubScheduledWorkoutEntry,
        targetDay
      );
      void api
        .rescheduleWorkout(payload, targetDay)
        .then(() => {
          onMessage(`Workout moved to ${formatHappenDayLabel(targetDay)}.`);
        })
        .catch((cause: unknown) => {
          onError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          setMutating(false);
          reload();
        });
    },
    [api, applyOptimisticMove, onError, onMessage, reload]
  );

  const handleDelete = useCallback(
    (target: Extract<CalendarSelection, { kind: "scheduled" }>) => {
      setMutating(true);
      void api
        .removeScheduledWorkout({
          planId: target.entry.planId,
          idInPlan: target.entry.idInPlan,
          planProgramId: target.entry.planProgramId
        })
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

  const handleAskCoachWeek = useCallback(
    (week: CalendarWeek) => {
      const lines = week.days
        .map(describeDayForCoach)
        .filter((line): line is string => Boolean(line));
      const stats = week.stats;
      const summary = [
        `training load ${stats.actualLoad}${stats.plannedLoad ? ` of ${stats.plannedLoad} planned` : ""} TL`,
        stats.distanceMeters > 0
          ? `${(stats.distanceMeters / 1000).toFixed(1)} km`
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
    [onOpenCoach]
  );

  const handleAskCoachSelection = useCallback(
    (target: CalendarSelection) => {
      if (target.kind === "scheduled") {
        onOpenCoach(
          `I have "${target.entry.name}" (${formatUpcomingWorkoutVolumeDisplay(target.entry.volume)}, ${formatUpcomingWorkoutLoad(target.entry.trainingLoad)}) scheduled on ${formatHappenDayLabel(target.entry.happenDay)}. How should I approach it?`
        );
      } else {
        const activity = target.activity;
        const stats = [
          activity.duration ? formatDurationSeconds(activity.duration) : null,
          activity.distance ? formatDistanceMeters(activity.distance) : null,
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
    [onOpenCoach]
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
            onClick={() => setAnchor(new Date())}
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
              onClick={() => setMode("month")}
            >
              Month
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "week"}
              className={mode === "week" ? "is-active" : ""}
              onClick={() => setMode("week")}
            >
              Week
            </button>
          </div>
        </div>
      </header>

      {error ? <p className="calendar-error">{error}</p> : null}

      <CalendarGrid
        weeks={weeks}
        mode={mode}
        busy={mutating}
        onSelectScheduled={(day, entry) => setSelection({ kind: "scheduled", day, entry })}
        onSelectActivity={(day, activity: TrainingHubActivity) =>
          setSelection({ kind: "activity", day, activity })
        }
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
        onError={onError}
      />

      {addTarget ? (
        <AddWorkoutModal
          api={api}
          dateKey={addTarget}
          onClose={() => setAddTarget(null)}
          onScheduled={(message) => {
            onMessage(message);
            setAddTarget(null);
            reload();
          }}
          onError={onError}
        />
      ) : null}
    </section>
  );
}
