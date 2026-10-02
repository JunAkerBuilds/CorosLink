import { Check, ClipboardPaste, Copy, GripVertical, Plus } from "lucide-react";
import { useState, type DragEvent } from "react";
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
  CALENDAR_DRAG_COPY_ONLY_MIME,
  CALENDAR_DRAG_MIME,
  createCalendarDragPayload,
  isCopyDrag,
  parseCalendarDragPayload,
  type CalendarDragPayload
} from "./calendarDrag";
import {
  scheduledWorkoutKey,
  type CalendarDay,
  type PlannedActualPair
} from "./calendarTypes";
import { dayNumber } from "./dateUtils";

interface DayCellProps {
  day: CalendarDay;
  mode: "month" | "week";
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  isScheduledSelected: (entry: TrainingHubScheduledWorkoutEntry) => boolean;
  isScheduledCopied: (entry: TrainingHubScheduledWorkoutEntry) => boolean;
  onAdd: (dateKey: string) => void;
  onCopyDay: (day: CalendarDay) => void;
  onPasteDay: (dateKey: string) => void;
  clipboardCount: number;
  onDropEntry: (
    payload: CalendarDragPayload,
    targetDay: string,
    copy: boolean
  ) => void;
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

function startScheduledDrag(
  event: DragEvent,
  scheduled: TrainingHubScheduledWorkoutEntry,
  copyOnly: boolean
) {
  const payload = createCalendarDragPayload(scheduled);
  event.dataTransfer.setData(CALENDAR_DRAG_MIME, JSON.stringify(payload));
  if (copyOnly) {
    event.dataTransfer.setData(CALENDAR_DRAG_COPY_ONLY_MIME, "1");
  }
  event.dataTransfer.setData("text/plain", scheduled.name);
  event.dataTransfer.effectAllowed = copyOnly ? "copy" : "copyMove";
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
  copied,
  onSelectScheduled,
  onSelectActivity,
  onToggleScheduled
}: {
  pair: PlannedActualPair;
  day: CalendarDay;
  busy: boolean;
  selectionMode: boolean;
  selected: boolean;
  copied: boolean;
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const { scheduled, activity } = pair;
  const selectable = selectionMode && !day.isPast;
  const canCopy = !busy && !selectionMode;

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
          copied && "is-copied",
          selectionMode && !selectable && "is-selection-unavailable"
        ]
          .filter(Boolean)
          .join(" ")}
        data-calendar-workout={scheduledWorkoutKey(scheduled)}
        draggable={canCopy}
        onDragStart={(event) => {
          if (!canCopy) {
            event.preventDefault();
            return;
          }
          startScheduledDrag(event, scheduled, true);
        }}
        onClick={() =>
          selectable ? onToggleScheduled(scheduled) : onSelectActivity(activity)
        }
        disabled={selectionMode && !selectable}
        aria-pressed={selectable ? selected : undefined}
        title={
          selectable
            ? `${selected ? "Deselect" : "Select"} ${scheduled.name}`
            : `${scheduled.name} — planned vs actual. Drag to a day to schedule it again.`
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
  const canDrag = !busy && !selectionMode;
  const copyOnly = day.isPast;
  return (
    <button
      type="button"
      className={[
        "calendar-chip",
        "calendar-chip-planned",
        categoryClass(scheduled.name),
        selectable && "is-selection-enabled",
        selected && "is-selected",
        copied && "is-copied",
        selectionMode && !selectable && "is-selection-unavailable"
      ]
        .filter(Boolean)
        .join(" ")}
      data-calendar-workout={scheduledWorkoutKey(scheduled)}
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag) {
          event.preventDefault();
          return;
        }
        startScheduledDrag(event, scheduled, copyOnly);
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
            ? copyOnly
              ? `${scheduled.name} — drag to a day to schedule it again`
              : `${scheduled.name} — drag to reschedule, hold Option to copy`
            : scheduled.name
      }
      aria-label={
        selectable
          ? `${selected ? "Deselect" : "Select"} ${scheduled.name}`
          : canDrag
          ? copyOnly
            ? `${scheduled.name}. Drag to a day to schedule it again.`
            : `${scheduled.name}. Drag to another day to reschedule, or hold Option to copy.`
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
      {scheduled.calendarEvent ? <span className="calendar-chip-meta">
        {scheduled.calendarEvent.timing.mode === "all-day" ? "All day" : `${scheduled.calendarEvent.timing.startTime}–${scheduled.calendarEvent.timing.endTime}${scheduled.calendarEvent.timing.endTime <= scheduled.calendarEvent.timing.startTime ? " (+1 day)" : ""}`}
      </span> : null}
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
  isScheduledCopied,
  onAdd,
  onCopyDay,
  onPasteDay,
  clipboardCount,
  onDropEntry,
  selectionMode,
  busy
}: DayCellProps) {
  const { unitSystem } = useUnitSystem();
  const [dropTarget, setDropTarget] = useState(false);
  const canReceiveDrop = !day.isPast && !busy && !selectionMode;
  const hasScheduledWorkouts = day.scheduled.length > 0;
  const isDayCopied = hasScheduledWorkouts && day.scheduled.every(isScheduledCopied);

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
      data-calendar-day={day.dateKey}
      tabIndex={day.isToday ? 0 : -1}
      aria-label={`${day.dateKey}${day.scheduled.length ? `, ${day.scheduled.length} scheduled` : ""}`}
      onMouseDown={(event) => {
        // Clicking empty space in a day makes it the ⌘C / ⌘V target.
        if (event.target === event.currentTarget || !(event.target as Element).closest("button, a, input")) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onDragOver={(event) => {
        if (
          !canReceiveDrop ||
          !Array.from(event.dataTransfer.types).includes(CALENDAR_DRAG_MIME)
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = isCopyDrag(event) ? "copy" : "move";
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
          onDropEntry(payload, day.dateKey, isCopyDrag(event));
        }
      }}
    >
      <div className="calendar-day-head">
        <span className="calendar-day-number">
          {day.isToday ? `Today ${String(dayNumber(day.dateKey)).padStart(2, "0")}` : dayNumber(day.dateKey)}
        </span>
        <div className="calendar-day-actions">
          {hasScheduledWorkouts ? (
            <button
              type="button"
              className={`calendar-day-action calendar-day-copy${isDayCopied ? " is-copied" : ""}`}
              onClick={() => onCopyDay(day)}
              disabled={busy || selectionMode}
              title={isDayCopied ? "Workouts copied" : "Copy day's workouts"}
              aria-label={`Copy ${day.scheduled.length} workout${day.scheduled.length === 1 ? "" : "s"} from ${day.dateKey}`}
            >
              {isDayCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </button>
          ) : null}
          {clipboardCount > 0 && !day.isPast ? (
            <button
              type="button"
              className="calendar-day-action calendar-day-paste"
              onClick={() => onPasteDay(day.dateKey)}
              disabled={busy || selectionMode}
              title={clipboardCount === 1 ? "Paste workout" : `Paste ${clipboardCount} workouts`}
              aria-label={`Paste ${clipboardCount} workout${clipboardCount === 1 ? "" : "s"} on ${day.dateKey}`}
            >
              <ClipboardPaste size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="calendar-day-action calendar-day-add"
            onClick={() => onAdd(day.dateKey)}
            disabled={busy || selectionMode}
            title={day.isPast ? "Log activity" : "Add workout"}
            aria-label={`${day.isPast ? "Log activity" : "Add workout"} on ${day.dateKey}`}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
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
            copied={isScheduledCopied(pair.scheduled)}
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
