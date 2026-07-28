import { Check, GripVertical, Plus } from "lucide-react";
import { useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem
} from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatUpcomingWorkoutVolumeDisplay,
  inferUpcomingWorkoutCategory
} from "../training/formatters";
import { sportColorCategory } from "../training/sportColors";
import { isSwimSportType } from "../training/sportTypes";
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
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  isScheduledSelected: (entry: TrainingHubScheduledWorkoutEntry) => boolean;
  onAdd: (dateKey: string) => void;
  onDropEntry: (payload: CalendarDragPayload, targetDay: string) => void;
  selectionMode: boolean;
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

function activityStatsLine(
  activity: TrainingHubActivity,
  unitSystem: UnitSystem
): string {
  const parts: string[] = [];
  if (activity.duration) {
    parts.push(formatDurationSeconds(activity.duration));
  }
  if (activity.distance) {
    parts.push(
      formatDistanceMeters(
        activity.distance,
        unitSystem,
        isSwimSportType(activity.sportType)
      )
    );
  }
  return parts.join(" · ");
}

function PairChip({
  pair,
  day,
  busy,
  selectionMode,
  selected,
  onSelectScheduled,
  onSelectActivity,
  onToggleScheduled
}: {
  pair: PlannedActualPair;
  day: CalendarDay;
  busy: boolean;
  selectionMode: boolean;
  selected: boolean;
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const { scheduled, activity } = pair;
  const selectable = selectionMode && !day.isPast;

  if (activity) {
    // Completed: lead with the actual activity, show planned vs actual load.
    const plannedLoad = scheduled.trainingLoad;
    const actualLoad = activity.trainingLoad;
    return (
      <button
        type="button"
        className={[
          "calendar-chip",
          "calendar-chip-paired",
          categoryClass(scheduled.name),
          sportClass(activity),
          selectable && "is-selection-enabled",
          selected && "is-selected",
          selectionMode && !selectable && "is-selection-unavailable"
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() =>
          selectable ? onToggleScheduled(scheduled) : onSelectActivity(activity)
        }
        disabled={selectionMode && !selectable}
        aria-pressed={selectable ? selected : undefined}
        title={
          selectable
            ? `${selected ? "Deselect" : "Select"} ${scheduled.name}`
            : `${scheduled.name} — planned vs actual`
        }
      >
        {selectable ? (
          <span className="calendar-chip-selector" aria-hidden="true">
            {selected ? <Check size={12} strokeWidth={3} /> : null}
          </span>
        ) : null}
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
        <span className="calendar-chip-meta">{activityStatsLine(activity, unitSystem)}</span>
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
  const canDrag = !day.isPast && !busy && !selectionMode;
  return (
    <button
      type="button"
      className={[
        "calendar-chip",
        "calendar-chip-planned",
        categoryClass(scheduled.name),
        selectable && "is-selection-enabled",
        selected && "is-selected",
        selectionMode && !selectable && "is-selection-unavailable"
      ]
        .filter(Boolean)
        .join(" ")}
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
      onClick={() =>
        selectable ? onToggleScheduled(scheduled) : onSelectScheduled(scheduled)
      }
      disabled={selectionMode && !selectable}
      aria-pressed={selectable ? selected : undefined}
      title={
        selectable
          ? `${selected ? "Deselect" : "Select"} ${scheduled.name}`
          : canDrag
            ? `${scheduled.name} — drag to another day`
            : scheduled.name
      }
      aria-label={
        selectable
          ? `${selected ? "Deselect" : "Select"} ${scheduled.name}`
          : canDrag
          ? `${scheduled.name}. Drag to another day to reschedule.`
          : scheduled.name
      }
    >
      {selectable ? (
        <span className="calendar-chip-selector" aria-hidden="true">
          {selected ? <Check size={12} strokeWidth={3} /> : null}
        </span>
      ) : null}
      <span className="calendar-chip-title">
        <span className="calendar-chip-name">{scheduled.name}</span>
      </span>
      <span className="calendar-chip-meta">
        {formatUpcomingWorkoutVolumeDisplay(scheduled.volume, unitSystem)}
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
  onToggleScheduled,
  isScheduledSelected,
  onAdd,
  onDropEntry,
  selectionMode,
  busy
}: DayCellProps) {
  const { unitSystem } = useUnitSystem();
  const [dropTarget, setDropTarget] = useState(false);
  const canReceiveDrop = !day.isPast && !busy && !selectionMode;

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
          disabled={busy || selectionMode}
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
            selectionMode={selectionMode}
            selected={isScheduledSelected(pair.scheduled)}
            onSelectScheduled={onSelectScheduled}
            onSelectActivity={onSelectActivity}
            onToggleScheduled={onToggleScheduled}
          />
        ))}
        {day.unplannedActivities.map((activity) => (
          <button
            key={`activity-${activity.activityId}`}
            type="button"
            className={[
              "calendar-chip",
              "calendar-chip-activity",
              sportClass(activity),
              selectionMode && "is-selection-unavailable"
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSelectActivity(activity)}
            disabled={selectionMode}
            title={activity.name ?? activity.sportName ?? "Activity"}
          >
            <span className="calendar-chip-title">
              <span className="calendar-chip-name">
                {activity.name ?? activity.sportName ?? "Activity"}
              </span>
            </span>
            <span className="calendar-chip-meta">{activityStatsLine(activity, unitSystem)}</span>
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
