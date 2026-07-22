import { GripVertical, Plus } from "lucide-react";
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
import { sportColorCategory } from "../training/sportColors";
import {
  CALENDAR_DRAG_MIME,
  createCalendarDragPayload,
  parseCalendarDragPayload,
  type CalendarDragPayload
} from "./calendarDrag";
import type { CalendarDay, PlannedActualPair } from "./calendarTypes";
import { dayNumber } from "./dateUtils";

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

// Color a completed activity chip by sport, matching the training heatmap.
function sportClass(activity: TrainingHubActivity): string {
  return `calendar-sport-${sportColorCategory(activity.sportType)}`;
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
  busy,
  onSelectScheduled,
  onSelectActivity
}: {
  pair: PlannedActualPair;
  day: CalendarDay;
  busy: boolean;
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
        className={`calendar-chip calendar-chip-paired ${categoryClass(scheduled.name)} ${sportClass(activity)}`}
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
  const canDrag = !day.isPast && !busy;
  return (
    <button
      type="button"
      className={`calendar-chip calendar-chip-planned ${categoryClass(scheduled.name)}`}
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag) {
          event.preventDefault();
          return;
        }
        const payload = createCalendarDragPayload(scheduled);
        event.dataTransfer.setData(CALENDAR_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.setData("text/plain", scheduled.name);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSelectScheduled(scheduled)}
      title={canDrag ? `${scheduled.name} — drag to another day` : scheduled.name}
      aria-label={
        canDrag
          ? `${scheduled.name}. Drag to another day to reschedule.`
          : scheduled.name
      }
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
      {canDrag ? (
        <GripVertical
          className="calendar-chip-drag-handle"
          size={14}
          aria-hidden="true"
        />
      ) : null}
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
  const canReceiveDrop = !day.isPast && !busy;

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
        if (
          !canReceiveDrop ||
          !Array.from(event.dataTransfer.types).includes(CALENDAR_DRAG_MIME)
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(true);
      }}
      onDragLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setDropTarget(false);
      }}
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
        const payload = parseCalendarDragPayload(raw);
        if (payload) {
          onDropEntry(payload, day.dateKey);
        }
      }}
    >
      <div className="calendar-day-head">
        <span className="calendar-day-number">
          {day.isToday ? `Today ${String(dayNumber(day.dateKey)).padStart(2, "0")}` : dayNumber(day.dateKey)}
        </span>
        <button
          type="button"
          className="calendar-day-add"
          onClick={() => onAdd(day.dateKey)}
          disabled={busy}
          title={day.isPast ? "Log activity" : "Add workout"}
          aria-label={`${day.isPast ? "Log activity" : "Add workout"} on ${day.dateKey}`}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="calendar-day-items">
        {day.pairs.map((pair) => (
          <PairChip
            key={`pair-${pair.scheduled.planId}-${pair.scheduled.idInPlan}`}
            pair={pair}
            day={day}
            busy={busy}
            onSelectScheduled={onSelectScheduled}
            onSelectActivity={onSelectActivity}
          />
        ))}
        {day.unplannedActivities.map((activity) => (
          <button
            key={`activity-${activity.activityId}`}
            type="button"
            className={`calendar-chip calendar-chip-activity ${sportClass(activity)}`}
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
