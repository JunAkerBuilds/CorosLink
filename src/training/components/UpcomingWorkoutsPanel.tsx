import { CalendarDays, ChevronRight, Moon } from "lucide-react";
import { useMemo } from "react";
import type { TrainingHubUpcomingWorkout } from "../../../electron/types";
import {
  filterUpcomingWorkoutsFromToday,
  formatUpcomingWorkoutDate,
  formatUpcomingWorkoutDetailLine,
  formatUpcomingWorkoutRowStats,
  formatUpcomingWorkoutStats,
  inferUpcomingWorkoutCategory,
  isUpcomingWorkoutToday
} from "../formatters";

interface UpcomingWorkoutsPanelProps {
  workouts: TrainingHubUpcomingWorkout[];
}

export function UpcomingWorkoutsPanel({ workouts }: UpcomingWorkoutsPanelProps) {
  const scheduledWorkouts = useMemo(
    () => filterUpcomingWorkoutsFromToday(workouts),
    [workouts]
  );
  const todayWorkouts = scheduledWorkouts.filter((workout) =>
    isUpcomingWorkoutToday(workout.happenDay)
  );
  const laterWorkouts = scheduledWorkouts.filter(
    (workout) => !isUpcomingWorkoutToday(workout.happenDay)
  );
  const nextWorkout = laterWorkouts[0];
  const countLabel = `${scheduledWorkouts.length} upcoming ${
    scheduledWorkouts.length === 1 ? "workout" : "workouts"
  }`;
  const statsLabel = formatUpcomingWorkoutStats(scheduledWorkouts);

  return (
    <section className="panel training-upcoming-panel">
      <header className="training-upcoming-header">
        <div className="training-upcoming-heading">
          <p className="eyebrow">Training Calendar</p>
          <h2>Upcoming Workouts</h2>
          {scheduledWorkouts.length > 0 ? (
            <p className="training-upcoming-count">{countLabel}</p>
          ) : null}
        </div>
        {scheduledWorkouts.length > 0 ? (
          <p className="training-upcoming-stats">{statsLabel}</p>
        ) : null}
      </header>

      {scheduledWorkouts.length === 0 ? (
        <div className="training-empty-state">
          <p>No scheduled workouts in the next two weeks.</p>
        </div>
      ) : (
        <div className="training-upcoming-body">
          {todayWorkouts.length > 0 ? (
            <div className="training-upcoming-today-stack">
              {todayWorkouts.map((workout, index) => (
                <TodayWorkoutCard
                  key={`today-${workout.happenDay}-${workout.sortNo ?? index}-${workout.name}`}
                  workout={workout}
                />
              ))}
            </div>
          ) : (
            <RestDayCard nextWorkout={nextWorkout} />
          )}

          {laterWorkouts.length > 0 ? (
            <ul className="training-upcoming-list">
              {laterWorkouts.map((workout, index) => {
                const rowStats = formatUpcomingWorkoutRowStats(
                  workout.volume,
                  workout.trainingLoad
                );

                return (
                  <li
                    className="training-upcoming-row"
                    key={`${workout.happenDay}-${workout.sortNo ?? index}-${workout.name}`}
                  >
                    <div className="training-upcoming-rail" aria-hidden="true">
                      <span className="training-upcoming-dot" />
                    </div>
                    <span className="training-upcoming-date">
                      {formatUpcomingWorkoutDate(workout.happenDay)}
                    </span>
                    <div className="training-upcoming-main">
                      <div className="training-upcoming-title-row">
                        <strong className="training-upcoming-title">
                          {workout.name}
                        </strong>
                        <span className="training-upcoming-tag">
                          {inferUpcomingWorkoutCategory(workout.name)}
                        </span>
                      </div>
                      {rowStats ? (
                        <p className="training-upcoming-row-stats">{rowStats}</p>
                      ) : null}
                    </div>
                    <span className="training-upcoming-chevron" aria-hidden="true">
                      <ChevronRight size={18} strokeWidth={2.2} />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

function TodayWorkoutCard({ workout }: { workout: TrainingHubUpcomingWorkout }) {
  const category = inferUpcomingWorkoutCategory(workout.name);
  const detailLine = formatUpcomingWorkoutDetailLine(
    category,
    workout.volume,
    workout.trainingLoad
  );

  return (
    <article className="training-upcoming-today">
      <div className="training-upcoming-today-icon" aria-hidden="true">
        <CalendarDays size={22} strokeWidth={2.2} />
      </div>
      <div className="training-upcoming-today-copy">
        <div className="training-upcoming-today-heading">
          <span className="training-upcoming-today-pill">Today</span>
          <span className="training-upcoming-today-tag">{category}</span>
        </div>
        <h3 className="training-upcoming-today-title">{workout.name}</h3>
        <p className="training-upcoming-today-meta">{detailLine}</p>
      </div>
    </article>
  );
}

function RestDayCard({
  nextWorkout
}: {
  nextWorkout: TrainingHubUpcomingWorkout | undefined;
}) {
  return (
    <article className="training-upcoming-today training-upcoming-today-empty">
      <div className="training-upcoming-today-icon" aria-hidden="true">
        <Moon size={20} strokeWidth={2.2} />
      </div>
      <div className="training-upcoming-today-copy">
        <span className="training-upcoming-today-pill">Today</span>
        <h3 className="training-upcoming-today-title">Rest day</h3>
        <p className="training-upcoming-today-meta">
          No workout scheduled for today.
        </p>
        {nextWorkout ? (
          <p className="training-upcoming-today-next">
            Next up{" "}
            <strong>
              {formatUpcomingWorkoutDate(nextWorkout.happenDay)} — {nextWorkout.name}
            </strong>
          </p>
        ) : null}
      </div>
    </article>
  );
}
