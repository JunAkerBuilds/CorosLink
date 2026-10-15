import type { StrengthSession, StravaSessionDetails } from "./types";

type JsonRecord = Record<string, unknown>;

/**
 * Strava sport types read as gym sessions, with the COROS sport code each one
 * lines up with (402 Strength, 400 Gym Cardio — the pair COROS itself counts).
 */
const GYM_SPORT_TYPES: Record<string, { label: string; corosSportType: number }> = {
  WeightTraining: { label: "Weight Training", corosSportType: 402 },
  Crossfit: { label: "CrossFit", corosSportType: 402 },
  HighIntensityIntervalTraining: { label: "HIIT", corosSportType: 400 },
  Workout: { label: "Workout", corosSportType: 400 }
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number > 0 ? number : undefined;
}

export function stravaActivityId(raw: JsonRecord): string | undefined {
  // Activity IDs are integers well inside the safe range; keep them as strings
  // so they never round-trip through float formatting.
  const id = raw.id;
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return String(id);
  return typeof id === "string" && /^\d+$/.test(id) ? id : undefined;
}

/** `sport_type` superseded `type`; old payloads only carry the latter. */
export function stravaSportType(raw: JsonRecord): string | undefined {
  return stringValue(raw.sport_type) ?? stringValue(raw.type);
}

export function isStravaGymActivity(raw: JsonRecord): boolean {
  const sportType = stravaSportType(raw);
  return sportType !== undefined && sportType in GYM_SPORT_TYPES;
}

export function stravaActivityStartTime(raw: JsonRecord): number | undefined {
  const text = stringValue(raw.start_date);
  if (!text) return undefined;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined;
}

/**
 * The list endpoint has no `updated_at`, so a detail is refreshed when any
 * field an edit can change on the summary no longer matches.
 */
export function stravaSummaryFingerprint(raw: JsonRecord): string {
  return JSON.stringify([
    raw.name ?? null,
    stravaSportType(raw) ?? null,
    raw.start_date ?? null,
    raw.elapsed_time ?? null,
    raw.moving_time ?? null,
    raw.visibility ?? raw.private ?? null
  ]);
}

export function stravaActivityUrl(activityId: string): string {
  return `https://www.strava.com/activities/${activityId}`;
}

/** Convert a Strava gym activity into the provider-neutral Strength model. */
export function normalizeStravaActivity(
  summary: JsonRecord,
  detail?: JsonRecord
): StrengthSession | undefined {
  const raw = detail ? { ...summary, ...detail } : summary;
  const id = stravaActivityId(raw);
  const startTime = stravaActivityStartTime(raw);
  const sportType = stravaSportType(raw);
  const gym = sportType ? GYM_SPORT_TYPES[sportType] : undefined;
  if (!id || startTime === undefined || !sportType || !gym) return undefined;

  // Elapsed, not moving: COROS reports total time, and gym rest is still the session.
  const durationSec = Math.round(
    positive(raw.elapsed_time) ?? positive(raw.moving_time) ?? 0
  );
  const calories = positive(detail?.calories);
  const avgHr = positive(raw.average_heartrate);
  const maxHr = positive(raw.max_heartrate);
  const perceivedExertion = finite(detail?.perceived_exertion);

  const strava: StravaSessionDetails = {
    activityId: id,
    url: stravaActivityUrl(id),
    sportType,
    description: stringValue(detail?.description),
    relativeEffort: positive(raw.suffer_score),
    ...(perceivedExertion !== undefined && perceivedExertion >= 1 && perceivedExertion <= 10
      ? { perceivedExertion }
      : {}),
    deviceName: stringValue(raw.device_name),
    detailLoaded: Boolean(detail)
  };

  return {
    activityId: `strava:${id}`,
    source: "strava",
    sourceIds: { strava: id },
    sportType: gym.corosSportType,
    sportName: gym.label,
    name: stringValue(raw.name) ?? gym.label,
    startTime,
    duration: durationSec,
    calories,
    avgHr: avgHr === undefined ? undefined : Math.round(avgHr),
    maxHr: maxHr === undefined ? undefined : Math.round(maxHr),
    strava,
    detail: {
      summary: {
        sets: 0,
        totalReps: 0,
        totalWeightKg: 0,
        exercises: 0,
        calories: calories ?? 0,
        durationSec,
        avgHr: avgHr === undefined ? undefined : Math.round(avgHr),
        maxHr: maxHr === undefined ? undefined : Math.round(maxHr)
      },
      exercises: []
    }
  };
}
