import { useLanguage, t } from "../i18n/training";
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
  useLanguage();
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
            ? `${selected ? t("Deselect") : t("Select")} ${scheduled.name}`
            : t("{{value1}} — planned vs actual. Drag to a day to schedule it again.", { value1: String(scheduled.name) })
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
            {Math.round(actualLoad ?? 0)} {t("TL")} {plannedLoad !== undefined ? t(" / {{value1}} TL planned", { value1: String(Math.round(plannedLoad)) }) : ""}
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
          ? `${selected ? t("Deselect") : t("Select")} ${scheduled.name}`
          : canDrag
            ? copyOnly
              ? t("{{value1}} — drag to a day to schedule it again", { value1: String(scheduled.name) })
              : t("{{value1}} — drag to reschedule, hold Option to copy", { value1: String(scheduled.name) })
            : scheduled.name
      }
      aria-label={
        selectable
          ? `${selected ? t("Deselect") : t("Select")} ${scheduled.name}`
          : canDrag
          ? copyOnly
            ? t("{{value1}}. Drag to a day to schedule it again.", { value1: String(scheduled.name) })
            : t("{{value1}}. Drag to another day to reschedule, or hold Option to copy.", { value1: String(scheduled.name) })
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
        {scheduled.calendarEvent.timing.mode === "all-day" ? t("All day") : `${scheduled.calendarEvent.timing.startTime}–${scheduled.calendarEvent.timing.endTime}${scheduled.calendarEvent.timing.endTime <= scheduled.calendarEvent.timing.startTime ? t(" (+1 day)") : ""}`}
      </span> : null}
      <span className="calendar-chip-meta">
        {formatUpcomingWorkoutVolumeDisplay(scheduled.volume, unitSystem)}
        {scheduled.trainingLoad !== undefined
          ? missed
            ? t(" · {{value1}} TL / 0 TL", { value1: String(Math.round(scheduled.trainingLoad)) })
            : t(" · {{value1}} TL", { value1: String(Math.round(scheduled.trainingLoad)) })
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
  useLanguage();
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
      aria-label={`${day.dateKey}${day.scheduled.length ? t(", {{value1}} scheduled", { value1: String(day.scheduled.length) }) : ""}`}
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
          {day.isToday ? t("Today {{value1}}", { value1: String(String(dayNumber(day.dateKey)).padStart(2, "0")) }) : dayNumber(day.dateKey)}
        </span>
        <div className="calendar-day-actions">
          {hasScheduledWorkouts ? (
            <button
              type="button"
              className={`calendar-day-action calendar-day-copy${isDayCopied ? " is-copied" : ""}`}
              onClick={() => onCopyDay(day)}
              disabled={busy || selectionMode}
              title={isDayCopied ? t("Workouts copied") : t("Copy day's workouts")}
              aria-label={t("Copy {{value1}} workout{{value2}} from {{value3}}", { value1: String(day.scheduled.length), value2: String(day.scheduled.length === 1 ? "" : "s"), value3: String(day.dateKey) })}
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
              title={clipboardCount === 1 ? t("Paste workout") : t("Paste {{value1}} workouts", { value1: String(clipboardCount) })}
              aria-label={t("Paste {{value1}} workout{{value2}} on {{value3}}", { value1: String(clipboardCount), value2: String(clipboardCount === 1 ? "" : "s"), value3: String(day.dateKey) })}
            >
              <ClipboardPaste size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="calendar-day-action calendar-day-add"
            onClick={() => onAdd(day.dateKey)}
            disabled={busy || selectionMode}
            title={day.isPast ? t("Log activity") : t("Add workout")}
            aria-label={t("{{value1}} on {{value2}}", { value1: String(day.isPast ? t("Log activity") : t("Add workout")), value2: String(day.dateKey) })}
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
            title={activity.name ?? (activity.sportName == null ? activity.sportName : t(String(activity.sportName))) ?? t("Activity")}
          >
            <span className="calendar-chip-title">
              <span className="calendar-chip-name">
                {activity.name ?? (activity.sportName == null ? activity.sportName : t(String(activity.sportName))) ?? t("Activity")}
              </span>
            </span>
            <span className="calendar-chip-meta">{activityStatsLine(activity, unitSystem)}</span>
            {activity.trainingLoad !== undefined ? (
              <span className="calendar-chip-meta calendar-chip-load">
                {Math.round(activity.trainingLoad)} {t("TL")} </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
