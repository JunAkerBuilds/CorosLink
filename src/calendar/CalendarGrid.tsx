import { useLanguage, t } from "../i18n/training";
import type {
  StrengthSession,
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import { useLayoutEffect, useRef, type MouseEvent } from "react";
import {
  scheduledWorkoutKey,
  type CalendarDay,
  type CalendarGridMode,
  type CalendarWeek
} from "./calendarTypes";
import type { CalendarDragPayload } from "./calendarDrag";
import { DayCell } from "./DayCell";
import { WEEKDAY_LABELS } from "./dateUtils";
import { WeekStatsCell } from "./WeekStatsCell";

/** What a right-click in the grid or the list points at. */
export interface CalendarContextTarget {
  x: number;
  y: number;
  dayKey: string;
  workoutKey?: string;
  activityId?: string;
}

/**
 * Reads the day, workout and activity under a right-click from their data
 * attributes, focusing the item so ⌘C / ⌘V act on it; null outside a day.
 */
export function readCalendarContextTarget(event: MouseEvent): CalendarContextTarget | null {
  const target = event.target as Element;
  const dayEl = target.closest<HTMLElement>("[data-calendar-day]");
  if (!dayEl?.dataset.calendarDay) return null;
  event.preventDefault();
  const workoutEl = target.closest<HTMLElement>("[data-calendar-workout]");
  const activityEl = target.closest<HTMLElement>("[data-calendar-activity]");
  (workoutEl ?? activityEl ?? dayEl).focus({ preventScroll: true });
  return {
    x: event.clientX,
    y: event.clientY,
    dayKey: dayEl.dataset.calendarDay,
    workoutKey: workoutEl?.dataset.calendarWorkout,
    activityId: activityEl?.dataset.calendarActivity
  };
}

interface CalendarGridProps {
  weeks: CalendarWeek[];
  mode: CalendarGridMode;
  loading: boolean;
  busy: boolean;
  selectionMode: boolean;
  selectedWorkoutKeys: ReadonlySet<string>;
  copiedWorkoutKeys: ReadonlySet<string>;
  /** The workout another view asked to open, ringed for a moment. */
  highlightedWorkoutKey: string | null;
  onSelectScheduled: (day: CalendarDay, entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (day: CalendarDay, activity: TrainingHubActivity) => void;
  onSelectExternal: (session: StrengthSession) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onAdd: (dateKey: string) => void;
  onCopyDay: (day: CalendarDay) => void;
  onPasteDay: (dateKey: string) => void;
  clipboardCount: number;
  onDropEntry: (
    payload: CalendarDragPayload,
    targetDay: string,
    copy: boolean
  ) => void;
  onAskCoachWeek: (week: CalendarWeek) => void;
  onContextMenu: (target: CalendarContextTarget) => void;
}

export function CalendarGrid({
  weeks,
  mode,
  loading,
  busy,
  selectionMode,
  selectedWorkoutKeys,
  copiedWorkoutKeys,
  highlightedWorkoutKey,
  onSelectScheduled,
  onSelectActivity,
  onSelectExternal,
  onToggleScheduled,
  onAdd,
  onCopyDay,
  onPasteDay,
  clipboardCount,
  onDropEntry,
  onAskCoachWeek,
  onContextMenu
}: CalendarGridProps) {
  useLanguage();
  const bodyRef = useRef<HTMLDivElement>(null);
  const todayRowRef = useRef<HTMLDivElement>(null);
  const todayWeekKey = weeks.find((week) =>
    week.days.some((day) => day.isToday)
  )?.key;

  useLayoutEffect(() => {
    if (loading || !todayWeekKey) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const body = bodyRef.current;
      const todayRow = todayRowRef.current;
      if (!body || !todayRow) {
        return;
      }

      const bodyRect = body.getBoundingClientRect();
      const rowRect = todayRow.getBoundingClientRect();
      const rowTop = body.scrollTop + rowRect.top - bodyRect.top;
      const centeredTop = rowTop - (body.clientHeight - rowRect.height) / 2;
      const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);

      body.scrollTo({
        top: Math.min(maxScrollTop, Math.max(0, centeredTop)),
        behavior: "auto"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [loading, mode, todayWeekKey]);

  return (
    <div
      className={`calendar-grid ${mode === "week" ? "calendar-grid-week" : ""}`}
      aria-busy={busy}
    >
      <div className="calendar-grid-header">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="calendar-grid-header-cell">
            {t(label)}
          </div>
        ))}
        <div className="calendar-grid-header-cell calendar-grid-header-stats">
          {t("Weekly Statistics")} </div>
      </div>

      <div
        ref={bodyRef}
        className="calendar-grid-body"
        onContextMenu={(event) => {
          const target = readCalendarContextTarget(event);
          if (target) onContextMenu(target);
        }}
      >
        {weeks.map((week) => {
          const containsToday = week.key === todayWeekKey;
          return (
            <div
              key={week.key}
              ref={containsToday ? todayRowRef : undefined}
              className="calendar-grid-row"
            >
              {week.days.map((day) => (
                <DayCell
                  key={day.dateKey}
                  day={day}
                  mode={mode}
                  busy={busy}
                  selectionMode={selectionMode}
                  isScheduledSelected={(entry) =>
                    selectedWorkoutKeys.has(scheduledWorkoutKey(entry))
                  }
                  isScheduledCopied={(entry) =>
                    copiedWorkoutKeys.has(scheduledWorkoutKey(entry))
                  }
                  highlightedWorkoutKey={highlightedWorkoutKey}
                  onSelectScheduled={(entry) => onSelectScheduled(day, entry)}
                  onSelectActivity={(activity) => onSelectActivity(day, activity)}
                  onSelectExternal={onSelectExternal}
                  onToggleScheduled={onToggleScheduled}
                  onAdd={onAdd}
                  onCopyDay={onCopyDay}
                  onPasteDay={onPasteDay}
                  clipboardCount={clipboardCount}
                  onDropEntry={onDropEntry}
                />
              ))}
              <WeekStatsCell
                stats={week.stats}
                onAskCoach={() => onAskCoachWeek(week)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
