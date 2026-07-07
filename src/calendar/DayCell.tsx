import { Plus } from "lucide-react";
import { useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatUpcomingWorkoutVolumeDisplay,
  inferUpcomingWorkoutCategory
} from "../training/formatters";
import type { CalendarDay, PlannedActualPair } from "./calendarTypes";
import { dayNumber } from "./dateUtils";

export const CALENDAR_DRAG_MIME = "application/x-coroslink-scheduled-workout";

export interface CalendarDragPayload {
  planId: string;
  idInPlan: string;
  planProgramId?: string;
  happenDay: string;
}

interface DayCellProps {
  day: CalendarDay;
  mode: "month" | "week";
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onAdd: (dateKey: string) => void;
  onDropEntry: (payload: CalendarDragPayload, targetDay: string) => void;
  busy: boolean;
}

function categoryClass(name: string): string {
  return `calendar-cat-${inferUpcomingWorkoutCategory(name).toLowerCase()}`;
}

function completionTone(pct?: number): string {
  if (pct === undefined) {
    return "";
  }
  if (pct >= 90) {
    return "is-complete";
  }
  if (pct >= 50) {
    return "is-partial";
  }
  return "is-missed";
}

function activityStatsLine(activity: TrainingHubActivity): string {
  const parts: string[] = [];
  if (activity.duration) {
    parts.push(formatDurationSeconds(activity.duration));
  }
  if (activity.distance) {
    parts.push(formatDistanceMeters(activity.distance));
  }
  return parts.join(" · ");
}

function PairChip({
  pair,
  day,
  onSelectScheduled,
  onSelectActivity
}: {
  pair: PlannedActualPair;
  day: CalendarDay;
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
}) {
  const { scheduled, activity } = pair;

  if (activity) {
    // Completed: lead with the actual activity, show planned vs actual load.
    const plannedLoad = scheduled.trainingLoad;
    const actualLoad = activity.trainingLoad;
    return (
      <button
        type="button"
        className={`calendar-chip calendar-chip-paired ${categoryClass(scheduled.name)}`}
        onClick={() => onSelectActivity(activity)}
        title={`${scheduled.name} — planned vs actual`}
      >
        <span className="calendar-chip-title">
          <span className="calendar-chip-name">{activity.name ?? scheduled.name}</span>
          {pair.completionPct !== undefined ? (
            <span
              className={`calendar-chip-badge ${completionTone(pair.completionPct)}`}
            >
              {Math.min(pair.completionPct, 999)}
            </span>
          ) : null}
        </span>
        <span className="calendar-chip-meta">{activityStatsLine(activity)}</span>
        {actualLoad !== undefined || plannedLoad !== undefined ? (
          <span className="calendar-chip-meta calendar-chip-load">
            {Math.round(actualLoad ?? 0)} TL
            {plannedLoad !== undefined ? ` / ${Math.round(plannedLoad)} TL planned` : ""}
          </span>
        ) : null}
      </button>
    );
  }

  // Planned only. Past days show the COROS-style "0 TL" miss.
  const missed = day.isPast;
  return (
    <button
      type="button"
      className={`calendar-chip calendar-chip-planned ${categoryClass(scheduled.name)} ${missed ? "is-unfulfilled" : ""}`}
      draggable={!day.isPast}
      onDragStart={(event) => {
        const payload: CalendarDragPayload = {
          planId: scheduled.planId,
          idInPlan: scheduled.idInPlan,
          planProgramId: scheduled.planProgramId,
          happenDay: scheduled.happenDay
        };
        event.dataTransfer.setData(CALENDAR_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSelectScheduled(scheduled)}
      title={scheduled.name}
    >
      <span className="calendar-chip-title">
        <span className="calendar-chip-name">{scheduled.name}</span>
      </span>
      <span className="calendar-chip-meta">
        {formatUpcomingWorkoutVolumeDisplay(scheduled.volume)}
        {scheduled.trainingLoad !== undefined
          ? missed
            ? ` · ${Math.round(scheduled.trainingLoad)} TL / 0 TL`
            : ` · ${Math.round(scheduled.trainingLoad)} TL`
          : ""}
      </span>
    </button>
  );
}

export function DayCell({
  day,
  mode,
  onSelectScheduled,
  onSelectActivity,
  onAdd,
  onDropEntry,
  busy
}: DayCellProps) {
  const [dropTarget, setDropTarget] = useState(false);
  const canReceiveDrop = !day.isPast;

  return (
    <div
      className={[
        "calendar-day",
        mode === "week" && "calendar-day-week",
        !day.inMonth && "is-outside",
        day.isToday && "is-today",
        day.isPast && "is-past",
        dropTarget && "is-drop-target"
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={(event) => {
        if (!canReceiveDrop || !event.dataTransfer.types.includes(CALENDAR_DRAG_MIME)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        setDropTarget(false);
        if (!canReceiveDrop) {
          return;
        }
        const raw = event.dataTransfer.getData(CALENDAR_DRAG_MIME);
        if (!raw) {
          return;
        }
        event.preventDefault();
        try {
          const payload = JSON.parse(raw) as CalendarDragPayload;
          onDropEntry(payload, day.dateKey);
        } catch {
          // Malformed drag payload — ignore.
        }
      }}
    >
      <div className="calendar-day-head">
        <span className="calendar-day-number">
          {day.isToday ? `Today ${String(dayNumber(day.dateKey)).padStart(2, "0")}` : dayNumber(day.dateKey)}
        </span>
        {!day.isPast ? (
          <button
            type="button"
            className="calendar-day-add"
            onClick={() => onAdd(day.dateKey)}
            disabled={busy}
            title="Add workout"
            aria-label={`Add workout on ${day.dateKey}`}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="calendar-day-items">
        {day.pairs.map((pair, index) => (
          <PairChip
            key={`pair-${pair.scheduled.planId}-${pair.scheduled.idInPlan}-${index}`}
            pair={pair}
            day={day}
            onSelectScheduled={onSelectScheduled}
            onSelectActivity={onSelectActivity}
          />
        ))}
        {day.unplannedActivities.map((activity) => (
          <button
            key={`activity-${activity.activityId}`}
            type="button"
            className="calendar-chip calendar-chip-activity"
            onClick={() => onSelectActivity(activity)}
            title={activity.name ?? activity.sportName ?? "Activity"}
          >
            <span className="calendar-chip-title">
              <span className="calendar-chip-name">
                {activity.name ?? activity.sportName ?? "Activity"}
              </span>
            </span>
            <span className="calendar-chip-meta">{activityStatsLine(activity)}</span>
            {activity.trainingLoad !== undefined ? (
              <span className="calendar-chip-meta calendar-chip-load">
                {Math.round(activity.trainingLoad)} TL
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
