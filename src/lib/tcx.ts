// A hand-entered activity as a one-lap TCX file, the format COROS takes for an activity logged after the fact.
// Ported from the desktop app (CorosLink electron/tcxBuilder.ts): same elements, same order, same rounding.

/** TCX knows three sports. Everything that is not a run or a ride is "Other". */
export type TcxSport = "run" | "bike" | "other";

export interface ManualActivity {
  sport: TcxSport;
  /** The start as an ISO instant (2026-11-18T05:40:00.000Z). */
  startTimeIso: string;
  durationSec: number;
  /** 0 when not known. */
  distanceM: number;
  calories?: number;
  avgHr?: number;
}

const SPORT_NAME: Record<TcxSport, string> = { run: "Running", bike: "Biking", other: "Other" };

const xmlEscape = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A minimal, schema-valid TCX: one activity, one lap, totals only. */
export function buildManualTcx(input: ManualActivity): string {
  const sport = SPORT_NAME[input.sport] ?? "Other";
  const start = xmlEscape(input.startTimeIso);
  const total = Math.max(0, Math.round(input.durationSec));
  const distance = Math.max(0, Math.round(input.distanceM));
  const calories = Math.max(0, Math.round(input.calories ?? 0));
  const hr = input.avgHr != null && input.avgHr > 0 ? `        <AverageHeartRateBpm><Value>${Math.round(input.avgHr)}</Value></AverageHeartRateBpm>\n` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n` +
    `  <Activities>\n` +
    `    <Activity Sport="${sport}">\n` +
    `      <Id>${start}</Id>\n` +
    `      <Lap StartTime="${start}">\n` +
    `        <TotalTimeSeconds>${total}</TotalTimeSeconds>\n` +
    `        <DistanceMeters>${distance}</DistanceMeters>\n` +
    `        <Calories>${calories}</Calories>\n` +
    hr +
    `        <Intensity>Active</Intensity>\n` +
    `        <TriggerMethod>Manual</TriggerMethod>\n` +
    `      </Lap>\n` +
    `    </Activity>\n` +
    `  </Activities>\n` +
    `</TrainingCenterDatabase>\n`
  );
}

/**
 * The activity as the server will write it, or why it can't be logged. Mirrors the desktop's checks: a real
 * start, a duration above zero, and unknown extras dropped rather than guessed.
 */
export function cleanManualActivity(raw: { sport?: unknown; startTimeIso?: unknown; durationSec?: unknown; distanceM?: unknown; calories?: unknown; avgHr?: unknown }, now: number = Date.now()):
  ManualActivity | string {
  const sport = raw.sport === "run" || raw.sport === "bike" || raw.sport === "other" ? raw.sport : null;
  if (!sport) return "That activity type isn't one this app knows.";
  const started = typeof raw.startTimeIso === "string" && raw.startTimeIso.length <= 40 ? Date.parse(raw.startTimeIso) : NaN;
  if (!Number.isFinite(started)) return "The start time isn't valid.";
  if (started > now) return "Logging is for activities that have already started.";
  const duration = Number(raw.durationSec);
  if (!Number.isFinite(duration) || !(duration > 0)) return "Add a duration to log this activity.";
  if (duration > 24 * 3600) return "A logged activity can be at most 24 hours long.";
  const positive = (value: unknown, max: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
  };
  const calories = positive(raw.calories, 65_535), avgHr = positive(raw.avgHr, 255);
  return {
    sport, startTimeIso: new Date(started).toISOString(), durationSec: Math.round(duration), distanceM: positive(raw.distanceM, 2_000_000),
    ...(calories > 0 ? { calories } : {}), ...(avgHr > 0 ? { avgHr } : {}),
  };
}
