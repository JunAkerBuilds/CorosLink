// Sleep pages from synced items: every night the phone sent, with that day's HRV and resting heart rate, and what
// was done the day before from the synced activities.
import type { SleepData, SleepRecord } from "../sleep";
import type { NativeActivity, NativeDayVitals, NativeGymPlanned, NativeGymRoutine, NativeSleepNight } from "./native";
import { calendarDayKey, refToDate } from "./native";
import { nightFromItem } from "./health";
import { dayKey, parseDay } from "@/lib/format";
import { addDays } from "@/lib/health";

interface Item<B> { id: string; body: B }

const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

export function recordFromItem(day: string, n: NativeSleepNight, vitals: NativeDayVitals | undefined, dayBefore: string[] | null): SleepRecord {
  const base = nightFromItem(n);
  const spans = [...(n.stages ?? [])].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const begin = spans[0]?.start ?? n.bedtime;
  const stress = n.stress && n.stress.readings.length > 0 && begin != null
    ? { startOffset: Math.max(0, (n.stress.start - begin) / 60), readings: n.stress.readings }
    : null;
  return {
    ...base,
    day,
    nightScore: n.nightScore ?? null,
    naps: (n.naps ?? []).filter((p) => p.end > p.start).map((p) => ({
      startMinute: minuteOfDay(refToDate(p.start)), minutes: p.asleepMinutes, points: p.points ?? null,
    })),
    hrv: vitals?.hrv ?? null,
    restingHR: vitals?.restingHR ?? null,
    stress,
    dayBefore,
  };
}

export function sleepFromItems(
  nights: readonly Item<NativeSleepNight>[], days: readonly Item<NativeDayVitals>[], activities: readonly Item<NativeActivity>[], now: Date,
): SleepData {
  const vitals = new Map(days.map((d) => [d.id, d.body]));
  const workouts = new Map<string, string[]>();
  let firstActivity: string | null = null;
  for (const { body: a } of activities) {
    if (a.start == null) continue;
    const k = dayKey(refToDate(a.start));
    workouts.set(k, [...(workouts.get(k) ?? []), a.name]);
    if (firstActivity == null || k < firstActivity) firstActivity = k;
  }
  const records = [...nights]
    .filter((n) => n.body.totalMinutes != null || n.body.score != null || (n.body.stages?.length ?? 0) > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(({ id, body }) => {
      const before = dayKey(addDays(parseDay(id), -1));
      // A day with no synced activity is a rest day only once activities are known to cover it.
      const dayBefore = workouts.get(before) ?? (firstActivity != null && before >= firstActivity ? [] : null);
      return recordFromItem(id, body, vitals.get(id), dayBefore);
    });
  return { today: dayKey(now), nights: records };
}

/** The first gym routine planned for `day`, by name; null when none is. */
export function plannedOn(planned: readonly NativeGymPlanned[], routines: readonly NativeGymRoutine[], day: Date): string | null {
  const key = dayKey(day);
  const first = planned.find((p) => p.day && calendarDayKey(p.day) === key);
  if (!first) return null;
  return routines.find((r) => r.id === first.routineID)?.name || "Gym workout";
}
