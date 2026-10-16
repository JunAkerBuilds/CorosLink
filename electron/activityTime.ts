import type { TrainingHubActivity } from "./types";

// Moving vs elapsed time, shared by the main process and the renderer.
// Type-only imports keep it loadable by Node's strip-types test runner.
//
// COROS sends elapsed time including pauses (totalTime → `duration`) and
// timer time (workoutTime → `movingTime`). Its app headlines moving time and
// derives avg pace/speed from it, so CorosLink does too. Activities cached
// before `movingTime` existed fall back to elapsed.

/** Below a minute of pauses the elapsed time adds noise, not information. */
export const SIGNIFICANT_PAUSE_SECONDS = 60;

type ActivityTimes = Pick<TrainingHubActivity, "duration" | "movingTime">;

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Seconds the timer ran, or elapsed seconds when COROS sent no moving time. */
export function activityMovingSeconds(activity: ActivityTimes): number | undefined {
  return positive(activity.movingTime) ?? positive(activity.duration);
}

/** Elapsed seconds, only when pauses added at least a minute to moving time. */
export function activitySignificantElapsedSeconds(
  activity: ActivityTimes
): number | undefined {
  const moving = positive(activity.movingTime);
  const elapsed = positive(activity.duration);
  return moving !== undefined &&
    elapsed !== undefined &&
    elapsed - moving >= SIGNIFICANT_PAUSE_SECONDS
    ? elapsed
    : undefined;
}

/** Moving seconds per km; undefined without a positive distance and time. */
export function activityPaceSecondsPerKm(
  activity: ActivityTimes & { distance?: number }
): number | undefined {
  const moving = activityMovingSeconds(activity);
  const distance = positive(activity.distance);
  return moving !== undefined && distance !== undefined
    ? moving / (distance / 1000)
    : undefined;
}

/** Moving km/h; undefined without a positive distance and time. */
export function activitySpeedKmh(
  activity: ActivityTimes & { distance?: number }
): number | undefined {
  const moving = activityMovingSeconds(activity);
  const distance = positive(activity.distance);
  return moving !== undefined && distance !== undefined
    ? distance / 1000 / (moving / 3600)
    : undefined;
}
