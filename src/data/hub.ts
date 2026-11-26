"use client";
// The person's own COROS account, through Training Hub: sign-in, the calendar's planned workouts, the saved
// workout library and the exercise catalog. Every function here calls this app's own /api/hub routes, which
// talk to COROS; the COROS session lives in an httpOnly cookie this code can't read.
//
// Rule from the user: Training Hub never signs in on its own. When COROS ends the session these functions
// throw `HubSessionEndedError`, `useHubSession()` turns to "ended", and the person signs in again by hand.
import { useSyncExternalStore } from "react";
import { fromCoros, NotWiredError, type Loaded } from "@/data/core";
import { t } from "@/lib/i18n";
import { md5Hex } from "@/lib/md5";

// The same rules the server checks a workout with, for the builder: what a step of a sport may end on and
// carry, the climbing grades, why COROS would refuse a workout, and its planned totals.
export { HUB_CLIMB_GRADES, HUB_SPORTS, hubIntensitiesFor, hubTargetsFor, hubTotals, hubWorkoutProblem } from "@/server/hub/rules";

// MARK: Types

/** A calendar day as `YYYY-MM-DD` (`dayKey` in `@/lib/format`). */
export type HubDay = string;

/** The sports COROS's workout editor writes. */
export type HubSport = "run" | "trailRun" | "bike" | "swim" | "strength" | "hyrox" | "xcSki" | "indoorClimb" | "bouldering";
export type HubStepKind = "warmup" | "training" | "rest" | "cooldown";
/**
 * What ends a step: `time` (`seconds`), `distance` (`meters`), `open` (the lap button), `reps` and `routes`
 * (`count`), `load` (training load, `load`), `hrRecovery` (rests: heart rate down to `bpm`), `elevationGain` (`meters`).
 */
export type HubStepTarget = "time" | "distance" | "open" | "reps" | "load" | "hrRecovery" | "elevationGain" | "routes";
/** `kept` is a COROS target this app can't show (zones as percentages, effort pace…): it is saved back untouched. */
export type HubIntensityKind = "none" | "heartRate" | "pace" | "power" | "speed" | "cadence" | "stroke" | "bodyweight" | "weight" | "rpe" | "grade" | "kept";
export type HubStroke = "freestyle" | "breaststroke" | "backstroke" | "butterfly" | "mix" | "individualMedley" | "drills";
export type HubClimbSystem = "yds" | "french" | "uiaa" | "ewbank" | "vScale" | "font";

/** One exercise from COROS's catalog. */
export interface HubExercise {
  id: string;
  name: string;
  /** HYROX station kind (1 SkiErg … 8 wall balls); absent for gym exercises. */
  kind?: number;
  /** COROS's own name for it, a code like T1301 that its apps and the watch translate; absent for an athlete's own exercise. */
  code?: string;
  /** COROS's description code for it (`sid_strength_…`). */
  overview?: string;
}

/** The effort a step asks for. */
export interface HubIntensity {
  kind: HubIntensityKind;
  /**
   * The range, always metric: heart rate bpm, pace seconds per km, watts, km/h, cadence per minute, kg
   * (`low` only), or RPE 1–10 (`low` only). Low is the easier end except for pace, where it is the faster.
   */
  low?: number;
  high?: number;
  stroke?: HubStroke;
  /** A climbing grade in the workout's `gradeSystem`… */
  grade?: string;
  /** …or grades relative to the athlete's onsight grade (−8…+4). */
  gradeOffset?: number;
}

export interface HubWorkoutStep {
  /** COROS's ID for the step, present when it was read from COROS. Send it back unchanged when editing; leave it out for a new step. */
  id?: string;
  kind: HubStepKind;
  target: HubStepTarget;
  seconds?: number;
  meters?: number;
  count?: number;
  load?: number;
  bpm?: number;
  intensity: HubIntensity;
  name?: string;
  /** Strength exercises and HYROX stations. */
  exercise?: HubExercise;
  /** Strength: sets of this exercise, and the rest between them in seconds. */
  sets?: number;
  restSeconds?: number;
}

/** One step on its own (`repeats` null, exactly one step) or a group repeated `repeats` times. */
export interface HubWorkoutBlock {
  /** COROS's ID for a repeat group read from COROS; same rule as a step's `id`. */
  id?: string;
  repeats: number | null;
  steps: HubWorkoutStep[];
}

export interface HubWorkout {
  name: string;
  sport: HubSport;
  description: string;
  blocks: HubWorkoutBlock[];
  /** Indoor climbing and bouldering: the system grades are written in. */
  gradeSystem?: HubClimbSystem;
  /** Pool swims: the pool's length in metres (COROS's 25 m when left out). */
  poolLength?: number;
}

/** Planned seconds and metres (open steps add nothing) and strength sets, counting repeats. */
export interface HubTotals { seconds: number; meters: number; sets: number }

/** A workout planned on the COROS calendar. */
export interface HubPlannedWorkout {
  day: HubDay;
  /** With `day`, what names this entry in every schedule change. */
  idInPlan: string;
  /** The training plan it belongs to ("" or "0" when it is a one-off). */
  planId: string;
  planProgramId: string;
  name: string;
  /** COROS's training sport code, and the sport when it is one this app writes. */
  sportCode: number | null;
  sport: HubSport | null;
  /** The steps, for showing and editing; null when the sport or a step is one this app can't write (it can still be moved or removed). */
  workout: HubWorkout | null;
  /** Distance and time as COROS works them out for the program, else summed from the steps; null when there's neither. */
  totals: HubTotals | null;
  /** COROS's planned training load for the program, when it gives one. */
  load?: number | null;
}

export interface HubCalendarDay { day: HubDay; workouts: HubPlannedWorkout[] }

/** A workout in the COROS library. */
export interface HubSavedWorkout {
  id: string;
  name: string;
  sportCode: number | null;
  sport: HubSport | null;
  /** The list sometimes comes without steps: then `workout` is null and `hubWorkout(id)` has them. */
  hasSteps: boolean;
  workout: HubWorkout | null;
  /** From the steps when they are known, else COROS's own totals for the workout. */
  totals: HubTotals | null;
}

/** How far a calendar move got. A failed move's error carries it; pass it to `hubResumeMove`. */
export interface HubMoveProgress {
  from: HubDay;
  to: HubDay;
  name: string;
  idInPlan: string | null;
  targetBefore: string[] | null;
  /** The workout's `idInPlan` on its new day, once copied there. */
  newIdInPlan: string | null;
  /** Taken off the old day. */
  removed: boolean;
}

/** One row of COROS's lap table. Zero from COROS means "not recorded" and arrives here as absent. */
export interface HubLap {
  /** From 1. */
  index: number;
  name?: string;
  meters: number;
  /** Timer time, to the hundredth. */
  seconds: number;
  cumulativeSeconds?: number;
  /** Seconds per kilometre. */
  adjustedPace?: number;
  averageHR?: number;
  maxHR?: number;
  averagePower?: number;
  averageCadence?: number;
  maxCadence?: number;
  /** Metres per step. */
  stride?: number;
  /** Milliseconds. */
  groundContact?: number;
  /** Centimetres. */
  verticalOscillation?: number;
  /** Percent. */
  verticalRatio?: number;
  ascent?: number;
  descent?: number;
}

export interface HubLapGroup {
  /** `laps` the watch's own, `splits` of `lapMeters` each, `whole` the activity as one row. */
  kind: "laps" | "splits" | "whole";
  type: number;
  lapMeters: number | null;
  laps: HubLap[];
  /** Lap numbers COROS marks fastest, from 1. */
  fastest: number[];
}

export interface HubLapTable { groups: HubLapGroup[]; columns: string[] }

/**
 * The sign-in as the browser knows it. `needsCode`: COROS emailed a 6-digit code to `codeSentTo` and waits
 * for it. `ended`: COROS signed the person out; only they can sign in again.
 */
export interface HubSessionInfo {
  state: "signedOut" | "signedIn" | "needsCode" | "ended";
  email?: string;
  /** "Global", "Europe", "Mainland China" or "Singapore". */
  region?: string;
  regionId?: string;
  codeSentTo?: string;
}

export interface HubUnits {
  /** Show distances and paces in miles on the watch and in COROS's apps. Values sent here stay metric. */
  imperial?: boolean;
  /** Show weights in pounds; as `imperial` when left out. */
  pounds?: boolean;
}

// MARK: Errors

export type HubErrorCode =
  | "expired" | "signed_out" | "wrong_password" | "unknown_account" | "refused" | "invalid"
  | "unreachable" | "coros" | "forbidden" | "not_wired" | "server";

/** A Hub request that failed, with a message fit to show. `corosCode` is COROS's own result code when it refused. */
export class HubError extends Error {
  constructor(public readonly code: HubErrorCode, message: string, public readonly corosCode?: string, public readonly move?: HubMoveProgress) {
    super(message);
    this.name = "HubError";
  }
}

/** COROS ended the session (or nobody is signed in). Show "sign in again"; never retry on your own. */
export class HubSessionEndedError extends HubError {
  constructor(code: "expired" | "signed_out", message: string) {
    super(code, message);
    this.name = "HubSessionEndedError";
  }
}

// MARK: The session, shared by every screen

let current: HubSessionInfo | undefined;
let loading: Promise<HubSessionInfo> | null = null;
const listeners = new Set<() => void>();

/** Counts session reads and changes, so a read that was overtaken by a later one doesn't overwrite it. */
let turn = 0;

function setSession(next: HubSessionInfo): HubSessionInfo {
  turn += 1;
  current = next;
  listeners.forEach((listener) => listener());
  return next;
}

async function call<T>(path: string, init?: { method: "POST" | "PUT" | "DELETE"; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/hub/${path}`, {
      method: init?.method ?? "GET", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", ...(init ? { "X-Clink-Hub": "1" } : {}), ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new HubError("unreachable", t("C-LINK couldn't be reached. Try again."));
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Handled below: an answer that isn't JSON is a server fault.
  }
  if (response.ok && payload !== null) return payload as T;
  const error = (payload as { error?: { code?: HubErrorCode; message?: string; corosCode?: string; move?: HubMoveProgress } } | null)?.error;
  const code = error?.code ?? "server";
  const message = error?.message ?? t("C-LINK couldn't finish that. Try again.");
  if (code === "expired" || code === "signed_out") {
    setSession({ state: code === "expired" ? "ended" : "signedOut", email: current?.email });
    throw new HubSessionEndedError(code, message);
  }
  if (code === "not_wired") throw new NotWiredError(`hub:${path.split("?")[0]}`, message);
  throw new HubError(code, message, error?.corosCode, error?.move);
}

const query = (values: Record<string, string>): string => new URLSearchParams(values).toString();

/** Who is signed in to COROS here. `verify` also asks COROS whether the session still stands. */
export async function hubSession(verify = false): Promise<HubSessionInfo> {
  const mine = ++turn;
  try {
    const info = await call<HubSessionInfo>(verify ? "session?verify=1" : "session");
    return mine === turn ? setSession(info) : current ?? info;
  } catch (error) {
    // Never leave a screen waiting on a read that failed.
    if (current === undefined) setSession({ state: "signedOut" });
    throw error;
  }
}

/**
 * Signs in to COROS Training Hub. The password is hashed (MD5, what COROS's own web sign-in hashes) here in
 * the browser; only the email and that hash go to this app's server, which passes them to COROS and keeps
 * neither. Resolves to `signedIn`, or `needsCode` when COROS emailed a code: finish with `hubVerifyCode`.
 * Throws `HubError` with `wrong_password` or `unknown_account` when COROS says so.
 */
export async function hubSignIn(email: string, password: string): Promise<HubSessionInfo> {
  if (email.trim() === "" || password === "") throw new HubError("invalid", t("Enter your COROS email and password."));
  return setSession(await call<HubSessionInfo>("session", { method: "POST", body: { email: email.trim(), passwordHash: md5Hex(password) } }));
}

/** Finishes a sign-in with the 6-digit code COROS emailed. */
export async function hubVerifyCode(code: string): Promise<HubSessionInfo> {
  return setSession(await call<HubSessionInfo>("session/code", { method: "POST", body: { code: code.trim() } }));
}

/** Asks COROS to email the code again. */
export async function hubResendCode(): Promise<HubSessionInfo> {
  return setSession(await call<HubSessionInfo>("session/code", { method: "PUT" }));
}

/** Signs out of COROS here (also cancels a sign-in waiting for its code). */
export async function hubSignOut(): Promise<HubSessionInfo> {
  return setSession(await call<HubSessionInfo>("session", { method: "DELETE" }));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (current === undefined && !loading) {
    loading = hubSession().catch(() => setSession({ state: "signedOut" })).finally(() => { loading = null; });
  }
  return () => { listeners.delete(listener); };
}

/**
 * The COROS sign-in, live: undefined while it is first being read, then the state. It changes on sign-in and
 * sign-out anywhere on the page, and turns to `ended` the moment any Hub request finds COROS ended the session.
 */
// A sync pull brought a Training Hub sign-in (or sign-out) made on the phone: read who is signed in again.
if (typeof window !== "undefined") window.addEventListener("clink:hub", () => { void hubSession().catch(() => {}); });

export function useHubSession(): HubSessionInfo | undefined {
  return useSyncExternalStore(subscribe, () => current, () => undefined);
}

// MARK: Calendar

/** Every day from `from` to `to` (at most 400 days), in order, each with its planned workouts. */
export async function hubCalendar(from: HubDay, to: HubDay): Promise<Loaded<HubCalendarDay[]>> {
  return fromCoros((await call<{ days: HubCalendarDay[] }>(`calendar?${query({ from, to })}`)).days);
}

/** Plans a new workout on `day` (COROS takes days from today on). Resolves to its `idInPlan`. */
export async function hubScheduleWorkout(day: HubDay, workout: HubWorkout, units: HubUnits = {}): Promise<Loaded<string>> {
  return fromCoros((await call<{ idInPlan: string }>("schedule", { method: "POST", body: { day, workout, ...units } })).idInPlan);
}

/**
 * Replaces a planned workout's steps, name and description, keeping its day, plan and IDs. Steps and repeat
 * groups that came from COROS must keep their `id`, so what this app can't show about them survives.
 */
export async function hubUpdateScheduled(planned: Pick<HubPlannedWorkout, "day" | "idInPlan" | "name">, workout: HubWorkout, units: HubUnits = {}): Promise<void> {
  await call<{ ok: true }>("schedule", { method: "PUT", body: { day: planned.day, idInPlan: planned.idInPlan, name: planned.name, workout, ...units } });
}

/** Takes a planned workout off the calendar. A library copy, if any, stays. */
export async function hubRemoveScheduled(planned: Pick<HubPlannedWorkout, "day" | "idInPlan" | "name">): Promise<void> {
  await call<{ ok: true }>(`schedule?${query({ day: planned.day, idInPlan: planned.idInPlan, name: planned.name })}`, { method: "DELETE" });
}

/**
 * Moves a planned workout to another day (any sport, plan workouts too). COROS has no move: the workout is
 * copied to the new day and then taken off the old one, so a failure part-way can leave it on both days but
 * never loses it. Resolves to its `idInPlan` on the new day. On failure the thrown `HubError` has `move`:
 * call `hubResumeMove(error.move)` to finish without copying twice.
 */
export async function hubMoveScheduled(planned: Pick<HubPlannedWorkout, "day" | "idInPlan" | "name">, to: HubDay): Promise<Loaded<string>> {
  const { move } = await call<{ move: HubMoveProgress }>("schedule/move", { method: "POST", body: { from: planned.day, to, idInPlan: planned.idInPlan, name: planned.name } });
  return fromCoros(move.newIdInPlan ?? planned.idInPlan);
}

/** Picks up a move that stopped part-way. */
export async function hubResumeMove(progress: HubMoveProgress): Promise<Loaded<string>> {
  const { move } = await call<{ move: HubMoveProgress }>("schedule/move", { method: "POST", body: { move: progress } });
  return fromCoros(move.newIdInPlan ?? progress.idInPlan ?? "");
}

// MARK: Saved workouts and the exercise catalog

/** The COROS workout library. */
export async function hubWorkouts(): Promise<Loaded<HubSavedWorkout[]>> {
  return fromCoros((await call<{ workouts: HubSavedWorkout[] }>("workouts")).workouts);
}

/** One saved workout with its steps. To plan it on a day: `hubScheduleWorkout(day, saved.workout)`. */
export async function hubWorkout(id: string): Promise<Loaded<HubSavedWorkout>> {
  return fromCoros((await call<{ workout: HubSavedWorkout }>(`workouts?${query({ id })}`)).workout);
}

/** Saves a new workout to the COROS workout library, without putting it on a day. */
export async function hubSaveWorkout(workout: HubWorkout, units: HubUnits = {}): Promise<Loaded<HubSavedWorkout>> {
  return fromCoros((await call<{ workout: HubSavedWorkout }>("workouts", { method: "POST", body: { workout, ...units } })).workout);
}

/** Takes a workout out of the COROS workout library. Calendar entries made from it stay. */
export async function hubDeleteWorkout(id: string): Promise<void> {
  await call<{ ok: true }>(`workouts?${query({ id })}`, { method: "DELETE" });
}

/** COROS's exercise catalog for strength workouts and HYROX stations (stations have a `kind`), with the person's own exercises. */
export async function hubExercises(sport: "strength" | "hyrox" = "strength"): Promise<Loaded<HubExercise[]>> {
  return fromCoros((await call<{ exercises: HubExercise[] }>(`exercises?${query({ sport })}`)).exercises);
}

/** COROS's lap table for an activity. Not connected (COROS serves it outside Training Hub): throws `NotWiredError`. */
export async function hubLaps(activityId: string, sportCode: number): Promise<Loaded<HubLapTable>> {
  return fromCoros((await call<{ table: HubLapTable }>(`laps?${query({ activityId, sportCode: String(sportCode) })}`)).table);
}
