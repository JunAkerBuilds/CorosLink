import { fromBrowser, fromCoros, fromSample, NotWiredError, SAMPLE_TODAY, type Loaded } from "@/data/core";
import {
  HubError, hubCalendar, hubExercises, hubRemoveScheduled, hubSaveWorkout, hubScheduleWorkout, hubSession, hubUpdateScheduled, hubWorkout, hubWorkoutProblem, hubWorkouts,
  type HubExercise, type HubSport, type HubWorkout,
} from "@/data/hub";
import { deleteWorkout, libraryWorkouts, removeFromLibrary, savedWorkouts, saveToLibrary, saveWorkout } from "@/data/local/workouts";
import { sampleLibrary } from "@/data/sample/workoutLibrary";
import { sampleNumbers, sampleProfile, sampleWorkouts } from "@/data/sample/workouts";
import { syncView } from "@/data/sync";
import { hubDetail, type CalendarEntry } from "@/data/training";
import {
  calendarSport, DEFAULT_NAME, docFromHub, docReady, docSummary, docToHub, docToLegacy, docUnwired, isSport, legacyDoc, newDoc, pacingFor, sportLabel,
  type AthleteNumbers, type BuilderDoc,
} from "@/lib/builder";
import { isDayKey, occurrences } from "@/lib/calendar";
import { savedFromDoc } from "@/lib/savedWorkout";
import { dayKey } from "@/lib/format";
import { parseCorosWorkoutId, type CorosLink } from "@/lib/hubWorkout";
import { describe, totals, type Pacing, type Sport, type WorkoutItem } from "@/lib/workout";

export type { LengthUnit, Pacing, RepeatBlock, Sport, StepKind, StepLength, StepTarget, WorkoutItem, WorkoutStep } from "@/lib/workout";

export interface Workout {
  id: string;
  name: string;
  /** The sport as the calendar draws it. The builder's own sport is in `doc`. */
  sport: Sport;
  /** The day it is planned for (YYYY-MM-DD). */
  date: string;
  /** 1 for a single day; more repeats it on the same weekday for that many weeks in all (the first builder's weekly repeat). */
  repeatWeeks: number;
  /** The first builder's steps. Still what Coach reads and writes; empty when `doc` holds something they can't. */
  items: WorkoutItem[];
  /** The workout as the Structured builder holds it: every COROS sport, target and intensity. */
  doc?: BuilderDoc;
  /** Set when the workout is an entry on the person's COROS calendar: saving writes back to it. */
  coros?: CorosLink;
}

/** A workout saved to the calendar, with the totals it had when saved. */
export interface SavedWorkout extends Workout {
  summary: { detail: string; metres: number; load: number };
  savedAt: string;
}

export interface HeartZone {
  zone: number;
  low: number;
  high: number;
}

export interface AthleteProfile {
  zones: HeartZone[];
  pacing: Record<Sport, Pacing>;
}

/** Stamps a workout with its totals, ready for the calendar store. */
export function toSaved(workout: Workout, profile: AthleteProfile, now: Date = new Date()): SavedWorkout {
  const pacing = profile.pacing[workout.sport];
  const t = totals(workout.items, pacing);
  return { ...workout, summary: { detail: describe(workout.items, pacing), metres: Math.round(t.metres), load: t.load }, savedAt: now.toISOString() };
}

export { savedFromDoc };

/** The calendar entries a saved workout makes: one per week it repeats. */
export function workoutEntries(workout: SavedWorkout): CalendarEntry[] {
  return occurrences(workout.date, workout.repeatWeeks).map((date) => ({
    id: `${workout.id}@${date}`,
    date,
    sport: workout.sport,
    name: workout.name,
    detail: workout.summary?.detail ?? "",
    status: "planned",
    source: "browser",
    workoutId: workout.id,
    browser: { workoutId: workout.id },
    metres: workout.summary?.metres,
    load: workout.summary?.load,
  }));
}

export function newWorkoutId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let stepCounter = 0;
/** A fresh id for a step or a repeat on this page. */
export const newStepId = (): string => `s-${Date.now().toString(36)}-${(stepCounter++).toString(36)}`;

/* ───────────── Where this browser stands ───────────── */

export interface Standing {
  /** Signed in to COROS Training Hub: new workouts go to the COROS calendar. */
  toCoros: boolean;
  /** The day that counts as today: the sample athlete's when nobody is signed in anywhere. */
  today: string;
  /** The sample athlete's paces and numbers, only while the sample athlete is who the app shows. */
  pacing: Record<Sport, Pacing> | null;
  numbers: AthleteNumbers | null;
  /** Nobody is signed in anywhere: the sample athlete is who the app shows. */
  sample: boolean;
}

/** Answers that mean the check itself failed, not that nobody is signed in to COROS. */
const SESSION_CHECK_FAILED = new Set<string>(["unreachable", "server", "coros"]);

/** Where a save from this browser goes right now. Training plans ask it too. */
export async function standing(): Promise<Standing> {
  // A failed check is an error, not "signed out": saving to the browser while signed in to COROS would leave
  // the workout off the watch without anyone noticing.
  const [view, session] = await Promise.all([syncView(), hubSession().catch((error: unknown) => {
    if (error instanceof HubError && !SESSION_CHECK_FAILED.has(error.code)) return null;
    throw error;
  })]);
  const toCoros = session?.state === "signedIn";
  const sample = !toCoros && !view;
  return { toCoros, today: dayKey(sample ? SAMPLE_TODAY : new Date()), pacing: sample ? sampleProfile.pacing : null, numbers: sample ? sampleNumbers : null, sample };
}

/* ───────────── The builder ───────────── */

/** The COROS calendar entry a workout is, for the calls that change it. */
export interface CorosRef { day: string; idInPlan: string; name: string }

export interface BuilderData {
  doc: BuilderDoc;
  /** The day chosen on the calendar. */
  date: string;
  today: string;
  /** The id it is saved under in this browser, when it is. */
  savedId: string | null;
  repeatWeeks: number;
  /** The COROS calendar entry it is, when it is one. */
  coros: CorosRef | null;
  /** Opened from the library to plan: it is already there, so saving doesn't add another copy unless asked. */
  fromLibrary: boolean;
  /** Saving goes to the COROS calendar (else to this browser). */
  toCoros: boolean;
  pacing: Record<Sport, Pacing> | null;
  numbers: AthleteNumbers | null;
}

export interface BuilderQuery { id?: string | null; date?: string | null; sport?: string | null; library?: string | null }

const docOfSaved = (w: Workout): BuilderDoc => w.doc ?? legacyDoc(w, sampleProfile.zones, newStepId);

/**
 * What the builder opens with: a workout from the COROS calendar or this browser (`id`), a library workout to
 * plan afresh (`library`), or a new workout of `sport` on `date`.
 */
export async function loadWorkoutBuilder(query: BuilderQuery): Promise<Loaded<BuilderData>> {
  const at = await standing();
  const base = { today: at.today, pacing: at.pacing, numbers: at.numbers, savedId: null, repeatWeeks: 1, coros: null, fromLibrary: false };
  const date = isDayKey(query.date) ? query.date : at.today;
  const coros = query.id ? parseCorosWorkoutId(query.id) : null;
  if (query.id && coros) {
    const days = await hubCalendar(coros.day, coros.day);
    const planned = days.data.flatMap((d) => d.workouts).find((w) => w.idInPlan === coros.idInPlan);
    if (!planned) throw new Error("This workout is not on your COROS calendar any more.");
    if (!planned.workout) throw new Error("This workout has steps the builder can't edit yet. Change it in the COROS app.");
    return fromCoros({
      ...base, doc: docFromHub(planned.workout, newStepId), date: planned.day, toCoros: true,
      coros: { day: planned.day, idInPlan: planned.idInPlan, name: planned.name },
    });
  }
  if (query.id) {
    const saved = savedWorkouts().find((w) => w.id === query.id);
    if (saved) return fromBrowser({ ...base, doc: docOfSaved(saved), date: saved.date, savedId: saved.id, repeatWeeks: saved.repeatWeeks, toCoros: false });
    const planned = at.sample ? sampleWorkouts.find((w) => w.id === query.id) : undefined;
    if (planned) return fromSample({ ...base, doc: docOfSaved(planned), date: planned.date, toCoros: false });
    throw new Error("This workout is not saved on this computer any more.");
  }
  if (query.library) {
    if (at.toCoros) {
      const saved = (await hubWorkout(query.library)).data;
      if (!saved.workout) throw new Error("This workout has steps the builder can't edit yet. Schedule it from the COROS app.");
      return fromCoros({ ...base, doc: docFromHub(saved.workout, newStepId, false), date, toCoros: true, fromLibrary: true });
    }
    const kept = libraryWorkouts().find((w) => w.id === query.library);
    if (kept) return fromBrowser({ ...base, doc: docOfSaved(kept), date, toCoros: false, fromLibrary: true });
    const sample = at.sample ? sampleLibrary.find((w) => w.id === query.library) : undefined;
    if (sample) return fromSample({ ...base, doc: sample.doc, date, toCoros: false, fromLibrary: true });
    throw new Error("This workout is not in your library any more.");
  }
  const doc = newDoc(isSport(query.sport) ? query.sport : "run", [newStepId(), newStepId(), newStepId()]);
  return at.toCoros ? fromCoros({ ...base, doc, date, toCoros: true }) : fromBrowser({ ...base, doc, date, toCoros: false });
}

/** COROS's exercise list for strength workouts and HYROX stations. Not signed in to COROS there is none: names are typed. */
export async function loadExerciseList(sport: HubSport, toCoros: boolean): Promise<Loaded<HubExercise[]>> {
  return toCoros && (sport === "strength" || sport === "hyrox") ? hubExercises(sport) : fromBrowser([]);
}

export interface ScheduleRequest {
  doc: BuilderDoc;
  date: string;
  toCoros: boolean;
  /** Editing this COROS calendar entry. */
  coros?: CorosRef | null;
  /** Editing this workout saved in the browser. */
  savedId?: string | null;
  repeatWeeks?: number;
  saveToLibrary: boolean;
  pacing: Record<Sport, Pacing> | null;
}

export interface ScheduleResult {
  where: "coros" | "browser";
  /** The workout is on the calendar but the library copy failed, and why. */
  libraryProblem?: string;
  /** A new calendar entry's id: COROS's id of it, or the id it is saved under in this browser. Not set for an edit of a COROS entry. */
  ref?: string;
}

/** The workout as COROS takes it, or the reason it can't go. */
function forCoros(doc: BuilderDoc): HubWorkout {
  const unwired = docUnwired(doc);
  if (unwired.length > 0) {
    throw new NotWiredError("workout-coros-targets", `Not connected yet, so this can't go to COROS from here: ${unwired.join(", ")}.`);
  }
  const workout = docToHub(doc);
  const problem = hubWorkoutProblem(workout);
  if (problem) throw new Error(problem);
  return workout;
}

/**
 * Puts a workout on its day: on the COROS calendar when signed in to Training Hub (a new entry, or the entry
 * being edited), otherwise in this browser. Quick training, the builder and the library all save through here.
 */
export async function scheduleWorkout(request: ScheduleRequest): Promise<ScheduleResult> {
  const { doc, date } = request;
  if (!isDayKey(date)) throw new Error("Pick a day.");
  if (!docReady(doc, !request.toCoros)) throw new Error("Some steps still need a value.");
  if (!request.toCoros) {
    const id = request.savedId ?? newWorkoutId();
    saveWorkout(savedFromDoc(doc, date, id, request.pacing, request.savedId ? request.repeatWeeks ?? 1 : 1));
    if (request.saveToLibrary) keepInBrowserLibrary(doc, date);
    return { where: "browser", ref: id };
  }
  const workout = forCoros(doc);
  if (request.coros) {
    await hubUpdateScheduled(request.coros, workout);
    return { where: "coros" };
  }
  if (date < dayKey(new Date())) throw new Error("COROS takes planned workouts from today on.");
  const ref = (await hubScheduleWorkout(date, workout)).data;
  if (!request.saveToLibrary) return { where: "coros", ref };
  try {
    await hubSaveWorkout(workout);
    return { where: "coros", ref };
  } catch (e) {
    return { where: "coros", ref, libraryProblem: e instanceof Error ? e.message : "COROS didn't save the library copy." };
  }
}

function keepInBrowserLibrary(doc: BuilderDoc, date: string): void {
  const name = doc.name.trim() || DEFAULT_NAME;
  saveToLibrary({ id: `lib-${newWorkoutId()}`, name, sport: calendarSport(doc.sport), date, repeatWeeks: 1, items: docToLegacy(doc) ?? [], doc: { ...doc, name } });
}

/** Takes a planned workout off the COROS calendar, or out of this browser. */
export async function removeWorkout(target: { coros?: CorosRef | null; savedId?: string | null }): Promise<void> {
  if (target.coros) await hubRemoveScheduled(target.coros);
  else if (target.savedId) deleteWorkout(target.savedId);
}

/* ───────────── Add to calendar ───────────── */

export interface LibraryRow {
  id: string;
  name: string;
  sport: HubSport | null;
  sportName: string;
  /** The steps, when they are known; a COROS list sometimes comes without them. */
  doc: BuilderDoc | null;
  total: string;
  tags: string[];
  load: number | null;
  used: string | null;
}

export interface AddData {
  today: string;
  /** Scheduling goes to the COROS calendar (else to this browser). */
  toCoros: boolean;
  pacing: Record<Sport, Pacing> | null;
  library: LibraryRow[];
  /** Why the COROS library couldn't be read; the rest of the page still works. */
  libraryError?: string;
}

/**
 * The "Add to calendar" page: where a new workout would go, and the saved workouts to pick from: the COROS
 * workout library when signed in to Training Hub, else the ones kept in this browser, else (only with nobody signed
 * in to the store on this computer) the sample athlete's.
 */
export async function loadAddToCalendar(): Promise<Loaded<AddData>> {
  const at = await standing();
  const base = { today: at.today, toCoros: at.toCoros, pacing: at.pacing };
  if (at.toCoros) {
    let saved: Awaited<ReturnType<typeof hubWorkouts>>["data"];
    try {
      saved = (await hubWorkouts()).data;
    } catch (error) {
      return fromCoros({ ...base, library: [], libraryError: error instanceof Error ? error.message : "COROS's workout library couldn't be read." });
    }
    const library = saved.map((w): LibraryRow => {
      const doc = w.workout ? docFromHub(w.workout, newStepId, false) : null;
      return {
        id: w.id, name: w.name, sport: w.sport, sportName: w.sport ? sportLabel(w.sport) : "Other", doc,
        total: doc ? docSummary(doc, null) : hubDetail(w.totals), tags: [], load: null, used: null,
      };
    });
    return fromCoros({ ...base, library });
  }
  const row = (id: string, doc: BuilderDoc, extra: Partial<LibraryRow> = {}): LibraryRow => ({
    id, name: doc.name || DEFAULT_NAME, sport: doc.sport, sportName: sportLabel(doc.sport), doc,
    total: docSummary(doc, pacingFor(doc.sport, at.pacing)), tags: [], load: null, used: null, ...extra,
  });
  const kept = libraryWorkouts();
  if (kept.length > 0) return fromBrowser({ ...base, library: kept.map((w) => row(w.id, { ...docOfSaved(w), name: w.name })) });
  // Signed in to the store on this computer, the sample athlete's library is never shown: the list is empty until something is saved.
  if (!at.sample) return fromBrowser({ ...base, library: [] });
  return fromSample({ ...base, library: sampleLibrary.map((w) => row(w.id, w.doc, { tags: w.tags, load: w.load, used: w.used })) });
}

/**
 * Takes a workout out of the library kept in this browser. COROS's library is changed in the COROS app, and the
 * sample athlete's can't be changed.
 */
export async function removeLibraryWorkout(id: string): Promise<void> {
  removeFromLibrary(id);
}

/** Plans a library workout on `date`, through the same save as the builder. */
export async function scheduleLibraryWorkout(row: Pick<LibraryRow, "id" | "doc">, date: string, toCoros: boolean, pacing: Record<Sport, Pacing> | null): Promise<ScheduleResult> {
  let doc = row.doc;
  if (!doc && toCoros) {
    const saved = (await hubWorkout(row.id)).data;
    doc = saved.workout ? docFromHub(saved.workout, newStepId, false) : null;
  }
  if (!doc) throw new Error("This workout has steps this app can't write yet. Schedule it from the COROS app.");
  return scheduleWorkout({ doc, date, toCoros, saveToLibrary: false, pacing });
}
