// Foster-style session-RPE load derived from the COROS end-of-activity feeling
// (sportFeelInfo.feelType, 1..5). Training Load is HR-derived and underrates
// strength work; sRPE = RPE × duration fixes that by using the subjective
// effort instead.

export interface RpeActivityInput {
  /** Epoch in seconds or milliseconds. */
  startTime?: number;
  /** Duration in seconds. */
  duration?: number;
  /** COROS feelType: 0 or undefined = not rated, 1..5 = the five smileys. */
  feelType?: number | null;
}

// feelType (1..5) → Foster CR10 RPE. Level × 2 aligns the five smileys with the
// CR10 verbal anchors (1=very easy ≈ 2, 3=moderate ≈ 6, 5=maximal ≈ 10).
export function feelTypeToCr10(feelType?: number | null): number | undefined {
  if (feelType === undefined || feelType === null) {
    return undefined;
  }
  if (!Number.isInteger(feelType) || feelType < 1 || feelType > 5) {
    return undefined;
  }
  return feelType * 2;
}

// Session load in arbitrary units: CR10 × duration in minutes. Returns 0 when
// the activity is unrated or has no usable duration.
export function sessionSrpe(
  feelType?: number | null,
  durationSeconds?: number
): number {
  const cr10 = feelTypeToCr10(feelType);
  if (cr10 === undefined) {
    return 0;
  }
  if (
    durationSeconds === undefined ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return 0;
  }
  return cr10 * (durationSeconds / 60);
}

function happenDayFromTimestamp(timestamp?: number): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

// Sum session sRPE per day (YYYYMMDD, local time). Only rated activities
// contribute; a day with no rated session is absent from the map.
export function dailyRpeLoad(
  activities: RpeActivityInput[]
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const activity of activities) {
    const load = sessionSrpe(activity.feelType, activity.duration);
    if (load <= 0) {
      continue;
    }
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay) {
      continue;
    }
    byDay.set(happenDay, (byDay.get(happenDay) ?? 0) + load);
  }
  return byDay;
}
