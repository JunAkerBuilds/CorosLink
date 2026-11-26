// What Coach's tools read: one athlete's synced items, sorted into the shapes the tools need. Pure. The server
// builds it from the account's items (and nobody else's); tests build it from `seedItems()`.
import type {
  ActivityDetailBody, BodyGoalsBody, BodyMeasurementBody, CoachBriefBody, EnergyDayBody, NativeActivity, NativeDayVitals,
  NativeFoodEntry, NativeFuelProfile, NativeGymPlanned, NativeGymRoutine, NativeGymWorkout, NativeSleepNight, NativeSport,
  ViewBodyBody, ViewStrengthBody, ViewTrainingBody, WatchStateBody,
} from "@/data/sync/native";
import { calendarDayKey, REF_EPOCH_UNIX } from "@/data/sync/native";
import { msg, t, tx } from "@/lib/i18n";

export interface Row { collection: string; id: string; body: unknown }

export interface AthleteItems {
  activities: NativeActivity[];
  details: Record<string, ActivityDetailBody>;
  days: NativeDayVitals[];
  nights: NativeSleepNight[];
  energy: Record<string, EnergyDayBody>;
  training?: ViewTrainingBody;
  strength?: ViewStrengthBody;
  body?: ViewBodyBody;
  watch?: WatchStateBody;
  fuelEntries: NativeFoodEntry[];
  fuelProfile?: NativeFuelProfile;
  gymWorkouts: NativeGymWorkout[];
  routines: NativeGymRoutine[];
  planned: NativeGymPlanned[];
  bodyGoals?: BodyGoalsBody;
  measurements: BodyMeasurementBody[];
  memory: { id: string; text: string }[];
  briefs: { id: string; body: CoachBriefBody }[];
}

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Sorts raw items into an athlete. Anything that is not an object is dropped; unknown collections are ignored. */
export function athleteItems(rows: readonly Row[]): AthleteItems {
  const out: AthleteItems = {
    activities: [], details: {}, days: [], nights: [], energy: {}, fuelEntries: [], gymWorkouts: [], routines: [], planned: [],
    measurements: [], memory: [], briefs: [],
  };
  for (const row of rows) {
    const b = row.body;
    if (!isBag(b)) continue;
    switch (row.collection) {
      case "activity": out.activities.push({ ...(b as unknown as NativeActivity), id: row.id }); break;
      case "activity.detail": out.details[row.id] = b as ActivityDetailBody; break;
      case "health.day": out.days.push(b as unknown as NativeDayVitals); break;
      case "health.night": out.nights.push(b as unknown as NativeSleepNight); break;
      case "energy.day": out.energy[row.id] = b as EnergyDayBody; break;
      case "view.training": out.training = b as ViewTrainingBody; break;
      case "view.strength": out.strength = b as ViewStrengthBody; break;
      case "view.body": out.body = b as ViewBodyBody; break;
      case "watch.state": out.watch = b as WatchStateBody; break;
      case "fuel.entry": out.fuelEntries.push(b as unknown as NativeFoodEntry); break;
      case "fuel.profile": out.fuelProfile = b as unknown as NativeFuelProfile; break;
      case "gym.workout": out.gymWorkouts.push(b as unknown as NativeGymWorkout); break;
      case "gym.routine": out.routines.push(b as unknown as NativeGymRoutine); break;
      case "gym.planned": out.planned.push(b as unknown as NativeGymPlanned); break;
      case "body.goals": out.bodyGoals = b as unknown as BodyGoalsBody; break;
      case "body.measurement": out.measurements.push(b as unknown as BodyMeasurementBody); break;
      case "coach.memory": if (typeof b.text === "string") out.memory.push({ id: row.id, text: b.text }); break;
      case "coach.brief": out.briefs.push({ id: row.id, body: b as unknown as CoachBriefBody }); break;
    }
  }
  const dayOf = (d: { day?: { year: number; month: number; day: number } }) => (d.day ? calendarDayKey(d.day) : "");
  out.days = out.days.filter((d) => dayOf(d)).sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : 1));
  out.nights = out.nights.filter((d) => dayOf(d)).sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : 1));
  out.activities = out.activities.filter((a) => typeof a.start === "number").sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  out.gymWorkouts.sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  return out;
}

/**
 * The athlete's clock. The server runs in UTC, so local days are worked out from the browser's offset
 * (`Date.getTimezoneOffset()`: minutes to add to local time to get UTC).
 */
export interface Clock { nowMs: number; offsetMin: number }

const two = (n: number) => String(n).padStart(2, "0");

/** The local parts of an instant on the athlete's clock. */
export function localParts(ms: number, clock: Clock): { day: string; hour: number; minute: number; weekday: number } {
  const d = new Date(ms - clock.offsetMin * 60_000);
  return {
    day: `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`,
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(),
  };
}

export const refMs = (ref: number): number => (ref + REF_EPOCH_UNIX) * 1000;
export const today = (clock: Clock): string => localParts(clock.nowMs, clock).day;
export const dayOfRef = (ref: number, clock: Clock): string => localParts(refMs(ref), clock).day;

/** `day` moved by `n` days. Works on the key alone, so no time zone is involved. */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + n));
  return `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`;
}

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && shiftDay(v, 0) === v;

/** Monday of the week `day` is in. */
export function mondayOfDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return shiftDay(day, -((dow + 6) % 7));
}

const WEEKDAYS = [msg("Sun"), msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat")];
const MONTHS = [msg("Jan"), msg("Feb"), msg("Mar"), msg("Apr"), msg("May"), msg("Jun"), msg("Jul"), msg("Aug"), msg("Sep"), msg("Oct"), msg("Nov"), msg("Dec")];

/** "Thu 19 Nov". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** The short weekday of `day` in the app's language, for the screen ("Thu"). */
export function shownWeekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return tx("weekday", WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
}

/** `day` as the screen shows it, in the app's language ("19 Nov"). */
export function shownDayMonth(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return t("{day} {month}", { day: d, month: tx("month", MONTHS[m - 1]) });
}

/** `dayLabel` for the screen, in the app's language ("Thu 19 Nov"). `dayLabel` itself stays English for the model. */
export function shownDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return t("{weekday} {day} {month}", { weekday: shownWeekday(day), day: d, month: tx("month", MONTHS[m - 1]) });
}

export const timeLabel = (ms: number, clock: Clock): string => { const p = localParts(ms, clock); return `${two(p.hour)}:${two(p.minute)}`; };

export type Family = "run" | "ride" | "swim" | "strength" | "other";
const FAMILY: Partial<Record<NativeSport, Family>> = {
  run: "run", indoorRun: "run", trailRun: "run", track: "run", bike: "ride", indoorBike: "ride", poolSwim: "swim", openWater: "swim",
  strength: "strength", cardio: "strength",
};
export const familyOf = (sport: NativeSport | undefined): Family => (sport && FAMILY[sport]) || "other";

export const SPORT_WORDS: Record<NativeSport, string> = {
  run: msg("Run"), indoorRun: msg("Treadmill run"), trailRun: msg("Trail run"), track: msg("Track run"), walk: msg("Walk"), hike: msg("Hike"), bike: msg("Ride"),
  indoorBike: msg("Indoor ride"), poolSwim: msg("Pool swim"), openWater: msg("Open water swim"), strength: msg("Strength"), cardio: msg("Cardio"), ski: msg("Ski"),
  row: msg("Row"), multisport: msg("Multisport"), other: msg("Workout"),
};

/** A sport's name for the screen, in the app's language. `SPORT_WORDS` stays English for the model. */
export const shownSport = (sport: NativeSport | undefined): string => tx("sport", (sport && SPORT_WORDS[sport]) || "Workout");

/**
 * Text that came from the athlete's own data (names, notes), made safe to hand to the model as data: control
 * characters and line breaks go, and it is cut to `max`. The model is told such text is never an instruction.
 */
export function quoted(value: unknown, max = 80): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
