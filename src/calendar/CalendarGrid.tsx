import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import { useLayoutEffect, useRef } from "react";
import {
  scheduledWorkoutKey,
  type CalendarDay,
  type CalendarMode,
  type CalendarWeek
} from "./calendarTypes";
import type { CalendarDragPayload } from "./calendarDrag";
import { DayCell } from "./DayCell";
import { WEEKDAY_LABELS } from "./dateUtils";
import { WeekStatsCell } from "./WeekStatsCell";

interface CalendarGridProps {
  weeks: CalendarWeek[];
  mode: CalendarMode;
  loading: boolean;
  busy: boolean;
  selectionMode: boolean;
  selectedWorkoutKeys: ReadonlySet<string>;
  onSelectScheduled: (day: CalendarDay, entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (day: CalendarDay, activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onAdd: (dateKey: string) => void;
  onDropEntry: (payload: CalendarDragPayload, targetDay: string) => void;
  onAskCoachWeek: (week: CalendarWeek) => void;
}

export function CalendarGrid({
  weeks,
  mode,
  loading,
  busy,
  selectionMode,
  selectedWorkoutKeys,
  onSelectScheduled,
  onSelectActivity,
  onToggleScheduled,
  onAdd,
  onDropEntry,
  onAskCoachWeek
}: CalendarGridProps) {
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
            {label}
          </div>
        ))}
        <div className="calendar-grid-header-cell calendar-grid-header-stats">
          Weekly Statistics
        </div>
      </div>

      <div ref={bodyRef} className="calendar-grid-body">
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
                  onSelectScheduled={(entry) => onSelectScheduled(day, entry)}
                  onSelectActivity={(activity) => onSelectActivity(day, activity)}
                  onToggleScheduled={onToggleScheduled}
                  onAdd={onAdd}
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
