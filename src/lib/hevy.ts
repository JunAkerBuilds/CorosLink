// Hevy on the web, the pure part: reading Hevy's workout JSON, keeping a year of it current, turning it into
// gym-log workouts the Strength screen already draws, and leaving out what the phone already holds.
// Field names, paging and the sync steps follow the desktop app (CorosLink electron/hevyService.ts and
// hevyModel.ts); the gym-log shape and the overlap rule follow the phone (CorosKit HevyAPI.swift, applyHevy).
// Read only: nothing here, or anywhere on the web, writes to Hevy.
import { msToRef, refToMs, type NativeGymSet, type NativeGymSetKind, type NativeGymWorkout } from "@/data/sync/native";

type Json = Record<string, unknown>;

const record = (value: unknown): Json | undefined =>
  (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined);
const records = (value: unknown): Json[] => (Array.isArray(value) ? value.map(record).filter((v): v is Json => !!v) : []);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const atLeastZero = (value: unknown): number | undefined => { const n = finite(value); return n === undefined ? undefined : Math.max(0, n); };
const isoMs = (value: unknown): number | undefined => { const t = text(value); const ms = t ? Date.parse(t) : NaN; return Number.isFinite(ms) ? ms : undefined; };

/* ───────────── What is kept of a Hevy workout ───────────── */

export type HevySetType = "normal" | "warmup" | "dropset" | "failure";

export interface HevySet { type: HevySetType; weightKg?: number; reps?: number; seconds?: number; rpe?: number }
export interface HevyExercise { title: string; templateId?: string; supersetId?: number; sets: HevySet[] }
/** One completed workout, cut down to what Strength uses. Times are Unix milliseconds. */
export interface HevyWorkout { id: string; title: string; start: number; end?: number; exercises: HevyExercise[] }

const setType = (value: unknown): HevySetType =>
  (value === "warmup" || value === "dropset" || value === "failure" ? value : "normal");

const byIndex = (a: Json, b: Json): number => (finite(a.index) ?? 0) - (finite(b.index) ?? 0);

function parseSet(raw: Json): HevySet | null {
  const weightKg = atLeastZero(raw.weight_kg), reps = atLeastZero(raw.reps), seconds = atLeastZero(raw.duration_seconds), rpe = finite(raw.rpe);
  // A set with only a distance has nothing the gym log records, and is left out (as the phone does).
  if (weightKg === undefined && reps === undefined && seconds === undefined) return null;
  return {
    type: setType(raw.type),
    ...(weightKg !== undefined ? { weightKg } : {}),
    ...(reps !== undefined ? { reps: Math.round(reps) } : {}),
    ...(seconds !== undefined ? { seconds: Math.round(seconds) } : {}),
    ...(rpe !== undefined && rpe >= 0 && rpe <= 10 ? { rpe } : {}),
  };
}

/** A workout from Hevy's `/v1/workouts` (or an event's `workout`), or null when it has no id, start or sets. */
export function parseHevyWorkout(raw: unknown): HevyWorkout | null {
  const workout = record(raw);
  const id = text(workout?.id), start = isoMs(workout?.start_time);
  if (!workout || !id || start === undefined) return null;
  const exercises = records(workout.exercises).sort(byIndex).map((exercise): HevyExercise | null => {
    const sets = records(exercise.sets).sort(byIndex).map(parseSet).filter((s): s is HevySet => !!s);
    if (!sets.length) return null;
    const templateId = text(exercise.exercise_template_id), supersetId = finite(exercise.superset_id);
    return { title: text(exercise.title) ?? "Unnamed exercise", ...(templateId ? { templateId } : {}), ...(supersetId !== undefined ? { supersetId } : {}), sets };
  }).filter((e): e is HevyExercise => !!e);
  if (!exercises.length) return null;
  const end = isoMs(workout.end_time);
  return { id, title: text(workout.title) ?? "Hevy workout", start, ...(end !== undefined && end >= start ? { end } : {}), exercises };
}

/** `page_count` of a Hevy list answer; at least 1. */
export const hevyPageCount = (answer: unknown, page: number): number => Math.max(1, finite(record(answer)?.page_count) ?? page);

/** A page of `/v1/workouts`. `seen` counts what Hevy sent, readable or not, so paging can tell an empty page. */
export function parseHevyWorkoutsPage(answer: unknown, page: number): HevyWorkoutsPage {
  const raw = records(record(answer)?.workouts);
  return { workouts: raw.map(parseHevyWorkout).filter((w): w is HevyWorkout => !!w), seen: raw.length, pageCount: hevyPageCount(answer, page) };
}

/** A page of `/v1/workouts/events`, in Hevy's order (newest first): a workout added or edited, or the id of one deleted. */
export function parseHevyEventsPage(answer: unknown, page: number): HevyEventsPage {
  const raw = records(record(answer)?.events);
  const events: HevyEvent[] = [];
  for (const event of raw) {
    if (event.type === "deleted") { const id = text(event.id); if (id) events.push({ deleted: id }); continue; }
    const workout = parseHevyWorkout(event.workout);
    if (workout) events.push({ updated: workout });
  }
  return { events, seen: raw.length, pageCount: hevyPageCount(answer, page) };
}

/** A page of `/v1/exercise_templates`: the ids whose weight is assistance, not load. */
export function parseHevyTemplatesPage(answer: unknown, page: number): HevyTemplatesPage {
  const templates = records(record(answer)?.exercise_templates);
  const assisted = templates.filter((t) => t.type === ASSISTED_TYPE).map((t) => text(t.id)).filter((id): id is string => !!id);
  return { assisted, seen: templates.length, pageCount: hevyPageCount(answer, page) };
}

const ASSISTED_TYPE = "bodyweight_assisted_reps";

export interface HevyWorkoutsPage { workouts: HevyWorkout[]; seen: number; pageCount: number }
export type HevyEvent = { updated: HevyWorkout; deleted?: undefined } | { deleted: string; updated?: undefined };
export interface HevyEventsPage { events: HevyEvent[]; seen: number; pageCount: number }
export interface HevyTemplatesPage { assisted: string[]; seen: number; pageCount: number }

/* ───────────── Keeping a year of it current ───────────── */

/** How far back workouts are read, as on the desktop. */
export const HEVY_HISTORY_DAYS = 365;
/** A stop for an account whose paging never ends: 300 pages is 3,000 workouts. */
export const HEVY_MAX_PAGES = 300;
/** Strength and Connections read Hevy's changes again when the last read is older than this. */
export const HEVY_STALE_MS = 15 * 60_000;

/** What this browser keeps of a Hevy account. Erased by "Disconnect and erase cache" and by signing out. */
export interface HevyCache {
  v: 1;
  /** Hevy's id of the account the workouts belong to: another account's key starts an empty cache. */
  userId: string;
  workouts: HevyWorkout[];
  /** Exercise template ids of assisted bodyweight exercises. */
  assisted: string[];
  /** Workouts starting on or after this are all here (Unix ms). */
  coverageSince: number;
  /** Where the next read of Hevy's changes starts (ISO time). */
  cursor: string;
  lastSyncedAt: number;
}

/** One page at a time from this app's server; the API key never reaches this code. */
export interface HevyReader {
  workouts(page: number): Promise<HevyWorkoutsPage>;
  events(since: string, page: number): Promise<HevyEventsPage>;
  templates(page: number): Promise<HevyTemplatesPage>;
}

/** Local midnight `days` days before `now`, in Unix ms. */
export function historyStart(now: Date, days: number = HEVY_HISTORY_DAYS): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime();
}

const newestFirst = (a: HevyWorkout, b: HevyWorkout): number => b.start - a.start;

async function readAssisted(reader: HevyReader): Promise<string[]> {
  const assisted: string[] = [];
  for (let page = 1; page <= HEVY_MAX_PAGES; page += 1) {
    const found = await reader.templates(page);
    assisted.push(...found.assisted);
    if (page >= found.pageCount || found.seen === 0) break;
  }
  return [...new Set(assisted)];
}

/**
 * Reads the last year from the start: every page of workouts, newest first, until one starts before the year.
 * What was cached and is no longer in Hevy is gone afterwards. `onProgress` hears how many have been read.
 */
export async function fullHevySync(reader: HevyReader, userId: string, now: Date, onProgress?: (read: number) => void): Promise<HevyCache> {
  const cursor = now.toISOString();
  const since = historyStart(now);
  const assisted = await readAssisted(reader);
  const kept = new Map<string, HevyWorkout>();
  for (let page = 1; page <= HEVY_MAX_PAGES; page += 1) {
    const found = await reader.workouts(page);
    let reachedStart = false;
    for (const workout of found.workouts) {
      if (workout.start < since) { reachedStart = true; continue; }
      kept.set(workout.id, workout);
    }
    onProgress?.(kept.size);
    if (reachedStart || page >= found.pageCount || found.seen === 0) break;
  }
  return { v: 1, userId, workouts: [...kept.values()].sort(newestFirst), assisted, coverageSince: since, cursor, lastSyncedAt: Date.now() };
}

/**
 * Reads what changed in Hevy since the last read: edits replace, deletions go, a workout that moved out of the
 * year goes. The cursor moves only after every page was read, so a read that stopped part-way is done again.
 */
export async function incrementalHevySync(cache: HevyCache, reader: HevyReader, now: Date, onProgress?: (read: number) => void): Promise<HevyCache> {
  const cursor = now.toISOString();
  const oldest = historyStart(now);
  const events: HevyEvent[] = [];
  for (let page = 1; page <= HEVY_MAX_PAGES; page += 1) {
    const found = await reader.events(cache.cursor, page);
    events.push(...found.events);
    onProgress?.(events.length);
    if (page >= found.pageCount || found.seen === 0) break;
  }
  const kept = new Map(cache.workouts.map((w) => [w.id, w]));
  const known = new Set<string | undefined>([...cache.assisted, ...cache.workouts.flatMap((w) => w.exercises.map((e) => e.templateId))]);
  let unknownTemplate = false;
  // Hevy lists the newest change first; applied oldest first, the last word on a workout is the one kept.
  for (const event of events.reverse()) {
    if (event.deleted !== undefined) { kept.delete(event.deleted); continue; }
    const workout = event.updated;
    if (workout.start < oldest) { kept.delete(workout.id); continue; }
    kept.set(workout.id, workout);
    if (workout.exercises.some((e) => e.templateId && !known.has(e.templateId))) unknownTemplate = true;
  }
  for (const [id, workout] of kept) if (workout.start < oldest) kept.delete(id);
  // An exercise not seen before may be an assisted one: the list of those is read again.
  const assisted = unknownTemplate ? await readAssisted(reader) : cache.assisted;
  return { ...cache, workouts: [...kept.values()].sort(newestFirst), assisted, cursor, lastSyncedAt: Date.now() };
}

/** Whether the changes are enough, or the year has to be read from the start. */
export function needsFullSync(cache: HevyCache | null, userId: string, now: Date): boolean {
  if (!cache || cache.v !== 1 || cache.userId !== userId || !cache.cursor || !Number.isFinite(cache.coverageSince)) return true;
  // The cache starts later than the year asked for (it can't, short of a clock set back): read it all again.
  return cache.coverageSince > historyStart(now);
}

export const isHevyStale = (cache: HevyCache | null, nowMs: number): boolean => !cache || nowMs - cache.lastSyncedAt > HEVY_STALE_MS;

/* ───────────── Hevy workouts as gym-log workouts ───────────── */

/** The gym log writes ids as uppercase UUIDs, and the phone keeps Hevy's id for a workout it brings in. */
export const hevyGymId = (hevyId: string): string => hevyId.toUpperCase();

/** One exercise's id in the merged log. Hevy's own, so a Hevy exercise is never taken for a C-LINK one of a similar name. */
export const hevyExerciseId = (exercise: Pick<HevyExercise, "title" | "templateId">): string => `hevy:${exercise.templateId ?? exercise.title.toLowerCase()}`;

const KIND: Record<HevySetType, NativeGymSetKind> = { normal: "normal", warmup: "warmUp", dropset: "drop", failure: "failure" };

/**
 * A Hevy workout in the gym log's shape, so the Strength maths (working sets, volume, records) runs on it as is.
 * - Warm-up sets stay warm-ups, which that maths leaves out; with `includeWarmups` they count as normal sets.
 * - An assisted exercise's weight is assistance, not load lifted: its sets carry no weight (the desktop's rule).
 * - Hevy keeps no time per set, so they are spread evenly over the workout (the phone's rule).
 * - Hevy's workouts carry no rest times; nothing is made up for them.
 */
export function hevyGymWorkout(workout: HevyWorkout, assisted: ReadonlySet<string>, includeWarmups: boolean): NativeGymWorkout {
  const id = hevyGymId(workout.id);
  const total = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
  const step = Math.max(0, (workout.end ?? workout.start) - workout.start) / Math.max(1, total);
  let done = 0;
  return {
    id,
    name: workout.title,
    start: msToRef(workout.start),
    ...(workout.end !== undefined ? { end: msToRef(workout.end) } : {}),
    entries: workout.exercises.map((exercise, e) => {
      const noLoad = exercise.templateId !== undefined && assisted.has(exercise.templateId);
      return {
        id: `${id}-${e}`,
        exerciseID: hevyExerciseId(exercise),
        ...(exercise.supersetId !== undefined ? { superset: exercise.supersetId } : {}),
        sets: exercise.sets.map((set, s): NativeGymSet => {
          done += 1;
          return {
            id: `${id}-${e}-${s}`,
            kind: set.type === "warmup" && includeWarmups ? "normal" : KIND[set.type],
            ...(set.weightKg !== undefined && !noLoad ? { weightKg: set.weightKg } : {}),
            ...(set.reps !== undefined ? { reps: set.reps } : {}),
            ...(set.seconds !== undefined ? { seconds: set.seconds } : {}),
            ...(set.rpe !== undefined ? { rpe: set.rpe } : {}),
            doneAt: msToRef(workout.start + step * done),
          };
        }),
      };
    }),
  };
}

/** Names for the Hevy exercise ids, as Hevy writes them: "Bench Press (Barbell)". */
export function hevyExerciseNames(workouts: readonly HevyWorkout[]): Record<string, string> {
  const names: Record<string, string> = {};
  // Oldest first, so the newest workout's wording of a name wins.
  for (const workout of [...workouts].sort((a, b) => a.start - b.start)) for (const exercise of workout.exercises) names[hevyExerciseId(exercise)] = exercise.title;
  return names;
}

/* ───────────── The same workout from the phone and from Hevy ───────────── */

export interface MergedGymLog {
  workouts: NativeGymWorkout[];
  /** Ids of the workouts read from Hevy here. */
  fromHevy: Set<string>;
  /** How many Hevy workouts were left out because the phone already holds them. */
  leftOut: number;
}

/**
 * The phone's gym log plus the Hevy workouts it doesn't already hold. The phone's copy always wins:
 * 1. Same id (the phone keeps Hevy's id when it imports a workout): the phone's copy is the one shown, with any
 *    edit made in C-LINK (`editedAt`).
 * 2. Overlapping in time with any phone workout: the same session logged twice would count double, so the Hevy
 *    one is left out. This is the phone's own rule when it imports from Hevy.
 * A phone workout with no end is taken as its start alone.
 */
export function mergeGymLogs(phone: readonly NativeGymWorkout[], hevy: readonly NativeGymWorkout[]): MergedGymLog {
  const ids = new Set(phone.map((w) => w.id.toUpperCase()));
  const spans = phone.map((w) => ({ start: refToMs(w.start), end: refToMs(w.end ?? w.start) }));
  const added: NativeGymWorkout[] = [];
  for (const workout of hevy) {
    if (ids.has(workout.id.toUpperCase())) continue;
    const start = refToMs(workout.start), end = refToMs(workout.end ?? workout.start);
    if (spans.some((span) => span.start < end && start < span.end)) continue;
    added.push(workout);
  }
  return { workouts: [...phone, ...added], fromHevy: new Set(added.map((w) => w.id)), leftOut: hevy.length - added.length };
}

/* ───────────── Words ───────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number): string => String(n).padStart(2, "0");

/** "Today at 07:12", "Yesterday at 21:40", "17 Nov at 07:12", "17 Nov 2025 at 07:12"; "Never" before the first read. */
export function lastSyncedText(at: number | null | undefined, now: Date): string {
  if (at == null) return "Never";
  const d = new Date(at);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`} at ${time}`;
}
