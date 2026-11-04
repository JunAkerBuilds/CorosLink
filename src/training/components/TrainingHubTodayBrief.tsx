import { getLocale, useLanguage, t } from "../../i18n/training";
import { useMemo, type CSSProperties } from "react";
import { CalendarDays, ChevronRight, Flame, Route } from "lucide-react";
import type { TrainingHubActivity, TrainingHubUpcomingWorkout } from "../../../electron/types";
import { useHiddenNavItems } from "../../navigation/hiddenNav";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  filterUpcomingWorkoutsFromToday,
  formatDistanceMeters,
  formatUpcomingWorkoutDate,
  formatUpcomingWorkoutRowStats,
  getLocalHappenDayKey,
  happenDayFromTimestamp,
  isUpcomingWorkoutToday
} from "../formatters";
import { mergeTrainingDayLists, recoveryTone } from "../parsers";
import { enrichDayListWithActivityTotals, getCalendarWeekDateKeys } from "../weeklyActivity";
import type { TrainingHubSnapshot, TrainingSummaryMetrics } from "../types";
import "../todayBrief.css";

const READINESS_LABEL = { high: "Ready", mid: "Moderate", low: "Recover", neutral: "Waiting" } as const;

/** Consecutive active days ending today, or yesterday while today is still empty. */
export function activityStreak(activities: readonly TrainingHubActivity[], today = new Date()): number {
  const days = new Set(activities.map(activity => happenDayFromTimestamp(activity.startTime)).filter(Boolean));
  const cursor = new Date(today);
  if (!days.has(getLocalHappenDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(getLocalHappenDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

interface TrainingHubTodayBriefProps {
  summary: TrainingSummaryMetrics;
  /** COROS's day totals, so the week matches the Weekly activity card. */
  snapshot?: TrainingHubSnapshot | null;
  activities: readonly TrainingHubActivity[];
  workouts: TrainingHubUpcomingWorkout[];
  onOpenWorkout?: (workout: TrainingHubUpcomingWorkout) => void;
}

/** The Overview's first line: readiness, today's session, streak and the week so far. */
export function TrainingHubTodayBrief({ summary, snapshot, activities, workouts, onOpenWorkout }: TrainingHubTodayBriefProps) {
  const { language } = useLanguage();
  const { unitSystem } = useUnitSystem();
  const open = useHiddenNavItems().has("calendar") ? undefined : onOpenWorkout;
  const recovery = Math.max(0, Math.min(100, Math.round(summary.recoveryPct ?? 0)));
  const tone = recovery > 0 ? recoveryTone(recovery) : "neutral";
  const { workout, isToday, weekDistance, streak } = useMemo(() => {
    const scheduled = filterUpcomingWorkoutsFromToday(workouts);
    const today = scheduled.find(item => isUpcomingWorkoutToday(item.happenDay));
    // The same day totals the Weekly activity card shows: COROS's day list, gaps filled from activities.
    const week = new Set(getCalendarWeekDateKeys());
    const days = enrichDayListWithActivityTotals(
      mergeTrainingDayLists(snapshot?.dailyMetrics ?? null, snapshot?.analytics ?? null),
      [...activities]
    );
    const distance = days.reduce((total, day) => week.has(day.happenDay) ? total + (day.distance ?? 0) : total, 0);
    return { workout: today ?? scheduled[0], isToday: Boolean(today), weekDistance: distance, streak: activityStreak(activities) };
  }, [workouts, activities, snapshot, language, getLocale()]);
  const stats = workout ? formatUpcomingWorkoutRowStats(workout.volume, workout.trainingLoad, unitSystem) : null;

  return (
    <div className="hub-today-brief" role="group" aria-label={t("Today at a glance")}>
      <div className={`hub-today-pill is-recovery tone-${tone}`}>
        <span className="hub-today-ring" style={{ "--pct": recovery } as CSSProperties} aria-hidden="true">
          <span>{recovery > 0 ? recovery : "–"}</span>
        </span>
        <span className="hub-today-copy">
          <span className="hub-today-label">{t("Recovery")}</span>
          <strong>{recovery > 0 ? `${recovery}% · ${t(READINESS_LABEL[tone])}` : t(READINESS_LABEL.neutral)}</strong>
        </span>
      </div>

      {workout ? (
        <button
          type="button"
          className={`hub-today-pill is-workout${isToday ? " is-today" : ""}`}
          disabled={!open}
          aria-label={open ? t("Open {{value1}} in the calendar", { value1: workout.name }) : undefined}
          onClick={open ? () => open(workout) : undefined}
        >
          <span className="hub-today-icon" aria-hidden="true"><CalendarDays size={16} /></span>
          <span className="hub-today-copy">
            <span className="hub-today-label">{isToday ? t("Today") : `${t("Up next")} · ${formatUpcomingWorkoutDate(workout.happenDay)}`}</span>
            <strong>{workout.name}{stats ? <span className="hub-today-muted"> · {stats}</span> : null}</strong>
          </span>
          {open ? <ChevronRight size={15} className="hub-today-chevron" aria-hidden="true" /> : null}
        </button>
      ) : null}

      {streak > 0 ? (
        <div className="hub-today-pill is-streak">
          <span className="hub-today-icon" aria-hidden="true"><Flame size={16} /></span>
          <span className="hub-today-copy">
            <span className="hub-today-label">{t("Streak")}</span>
            <strong>{streak === 1 ? t("1-day streak") : t("{{count}}-day streak", { count: streak })}</strong>
          </span>
        </div>
      ) : null}

      <div className="hub-today-pill is-week">
        <span className="hub-today-icon" aria-hidden="true"><Route size={16} /></span>
        <span className="hub-today-copy">
          <span className="hub-today-label">{t("This week")}</span>
          <strong>{formatDistanceMeters(weekDistance, unitSystem)}</strong>
        </span>
      </div>
    </div>
  );
}
