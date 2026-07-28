import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
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

      <div className="calendar-grid-body">
        {weeks.map((week) => (
          <div key={week.key} className="calendar-grid-row">
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
            <WeekStatsCell stats={week.stats} onAskCoach={() => onAskCoachWeek(week)} />
          </div>
        ))}
      </div>
    </div>
  );
}
