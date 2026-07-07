import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { getLocalHappenDayKey, happenDayFromTimestamp } from "../training/formatters";
import type { CalendarDay, CalendarWeek } from "./calendarTypes";
import { computeWeeklyStats, pairPlannedWithActual } from "./pairing";

interface CalendarRangeData {
  scheduled: TrainingHubScheduledWorkoutEntry[];
  activities: TrainingHubActivity[];
  metrics: TrainingHubDailyMetric[];
  /** Raw week aggregates from /analyse/dayDetail (recommended TL band per week). */
  weekAggregates: Record<string, unknown>[];
}

interface UseCalendarDataOptions {
  api: CorosLinkApi | undefined;
  authenticated: boolean;
  /** Rows of 7 dateKeys covering the visible range. */
  weekKeys: string[][];
  /** External bump (e.g. coach uploaded a plan) forcing a refetch. */
  refreshToken: number;
  isInMonth: (dateKey: string) => boolean;
}

export function useCalendarData({
  api,
  authenticated,
  weekKeys,
  refreshToken,
  isInMonth
}: UseCalendarDataOptions) {
  const dateKeys = useMemo(() => weekKeys.flat(), [weekKeys]);
  const rangeStart = dateKeys[0];
  const rangeEnd = dateKeys[dateKeys.length - 1];
  const rangeKey = `${rangeStart}-${rangeEnd}`;

  const [data, setData] = useState<CalendarRangeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const cacheRef = useRef(new Map<string, CalendarRangeData>());
  const rangeKeyRef = useRef(rangeKey);
  rangeKeyRef.current = rangeKey;

  useEffect(() => {
    if (!api || !authenticated || !rangeStart || !rangeEnd) {
      setData(null);
      return;
    }

    let cancelled = false;
    const cached = cacheRef.current.get(rangeKey);
    if (cached) {
      setData(cached);
    }
    setLoading(!cached);
    setError(null);

    const keysForRange = [...dateKeys];
    void Promise.all([
      api.listScheduledWorkouts(rangeStart, rangeEnd),
      api.listTrainingHubActivities(1, 200, rangeStart, rangeEnd),
      api.getDailyMetrics(keysForRange)
    ])
      .then(([scheduled, activities, dailyMetrics]) => {
        if (cancelled || rangeKeyRef.current !== rangeKey) {
          return;
        }
        const next: CalendarRangeData = {
          scheduled,
          activities,
          metrics: dailyMetrics.dayList ?? [],
          weekAggregates: dailyMetrics.weekList ?? []
        };
        cacheRef.current.set(rangeKey, next);
        setData(next);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled || rangeKeyRef.current !== rangeKey) {
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, authenticated, rangeKey, refreshToken, version]);

  const reload = useCallback(() => {
    cacheRef.current.delete(rangeKeyRef.current);
    setVersion((current) => current + 1);
  }, []);

  /**
   * Move a scheduled entry to another day in local state only, so a drag lands
   * instantly; callers must reload() after the API call settles (or fails).
   */
  const applyOptimisticMove = useCallback(
    (entry: TrainingHubScheduledWorkoutEntry, newHappenDay: string) => {
      setData((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          scheduled: current.scheduled.map((candidate) =>
            candidate.planId === entry.planId &&
            candidate.idInPlan === entry.idInPlan &&
            candidate.happenDay === entry.happenDay
              ? { ...candidate, happenDay: newHappenDay }
              : candidate
          )
        };
      });
    },
    []
  );

  const weeks = useMemo<CalendarWeek[]>(() => {
    const todayKey = getLocalHappenDayKey();
    const scheduledByDay = new Map<string, TrainingHubScheduledWorkoutEntry[]>();
    const activitiesByDay = new Map<string, TrainingHubActivity[]>();
    const metricByDay = new Map<string, TrainingHubDailyMetric>();

    for (const entry of data?.scheduled ?? []) {
      const list = scheduledByDay.get(entry.happenDay) ?? [];
      list.push(entry);
      scheduledByDay.set(entry.happenDay, list);
    }
    for (const activity of data?.activities ?? []) {
      const key = happenDayFromTimestamp(activity.startTime);
      if (!key) {
        continue;
      }
      const list = activitiesByDay.get(key) ?? [];
      list.push(activity);
      activitiesByDay.set(key, list);
    }
    for (const metric of data?.metrics ?? []) {
      metricByDay.set(metric.happenDay, metric);
    }

    return weekKeys.map((row) => {
      const days: CalendarDay[] = row.map((dateKey) => {
        const scheduled = (scheduledByDay.get(dateKey) ?? []).sort(
          (left, right) => (left.sortNo ?? 0) - (right.sortNo ?? 0)
        );
        const activities = (activitiesByDay.get(dateKey) ?? []).sort(
          (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
        );
        const { pairs, unplanned } = pairPlannedWithActual(scheduled, activities);
        return {
          dateKey,
          inMonth: isInMonth(dateKey),
          isToday: dateKey === todayKey,
          isPast: dateKey < todayKey,
          scheduled,
          activities,
          metric: metricByDay.get(dateKey),
          pairs,
          unplannedActivities: unplanned
        };
      });

      const weekKey = row[0]!;
      const aggregate = (data?.weekAggregates ?? []).find(
        (candidate) => String(candidate.firstDayOfWeek ?? "") === weekKey
      );
      const recommendedMin = Number(aggregate?.recomendTlMin);
      const recommendedMax = Number(aggregate?.recomendTlMax);

      return {
        key: weekKey,
        days,
        stats: {
          ...computeWeeklyStats(days),
          recommendedLoadMin: Number.isFinite(recommendedMin)
            ? Math.round(recommendedMin)
            : undefined,
          recommendedLoadMax: Number.isFinite(recommendedMax)
            ? Math.round(recommendedMax)
            : undefined
        }
      };
    });
  }, [data, weekKeys, isInMonth]);

  return { weeks, loading, error, reload, applyOptimisticMove };
}
