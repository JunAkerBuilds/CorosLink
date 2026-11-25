// What the browser sends with a question, checked before anything reads it. Pure. The conversation, the workouts
// saved in the browser and the COROS calendar the browser read all come from the athlete's own browser: they are
// cut to size and to the fields Coach uses, and treated as data from there on.
import type { CoachMessage } from "@/data/coach";
import type { HubCalendarDay, HubPlannedWorkout, HubSport } from "@/data/hub";
import type { SavedWorkout } from "@/data/workouts";
import type { Sport, StepKind, StepLength, StepTarget, WorkoutItem, WorkoutStep } from "@/lib/workout";
import { finite, isDay, quoted, type Clock } from "./items";
import { quotedLong } from "./prompt";
import { parseFiles, type CoachFile } from "./files";
import { parsePlans, type PlanBrief } from "./plans";

export interface CoachRequest {
  text: string;
  history: CoachMessage[];
  clock: Clock;
  browser: SavedWorkout[];
  /** The COROS calendar as the browser read it, or null when Training Hub is not connected there. */
  hubDays: HubCalendarDay[] | null;
  /** Photos, PDFs and text files sent with this question. */
  files: CoachFile[];
  /** The athlete's saved plans in short form; the one open in the plan editor as it stands. */
  plans: PlanBrief[];
  /** The page the athlete asked from (the side Coach): its name and what it shows, as plain text. */
  page: { title: string; text: string } | null;
}

/** Most of a page Coach is told about. */
export const MAX_PAGE_TEXT = 12000;

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SPORTS: readonly Sport[] = ["run", "ride", "swim", "strength"];
const HUB_SPORTS: readonly string[] = ["run", "trailRun", "bike", "swim", "strength", "hyrox", "xcSki", "indoorClimb", "bouldering"];

export const MAX_TEXT = 4000;
export const MAX_HISTORY = 40;

function message(raw: unknown): CoachMessage | null {
  if (!isBag(raw) || typeof raw.id !== "string") return null;
  if (raw.from === "you" && typeof raw.text === "string") {
    const files = Array.isArray(raw.files) ? raw.files.filter((f): f is string => typeof f === "string").slice(0, 4).map((f) => quoted(f, 120)).filter(Boolean) : [];
    return { id: raw.id.slice(0, 80), from: "you", text: quotedLong(raw.text, MAX_TEXT), ...(files.length ? { files } : {}) };
  }
  if (raw.from === "coach" && Array.isArray(raw.blocks)) {
    const blocks = raw.blocks.filter((b) => isBag(b) && typeof b.kind === "string").slice(0, 24);
    return { id: raw.id.slice(0, 80), from: "coach", blocks: blocks as CoachMessage extends { blocks: infer B } ? B : never };
  }
  return null;
}

const KINDS: readonly StepKind[] = ["warmup", "work", "recovery", "rest", "cooldown"];

function step(raw: unknown): WorkoutStep | null {
  if (!isBag(raw) || raw.type !== "step" || !KINDS.includes(raw.kind as StepKind) || !isBag(raw.length) || !isBag(raw.target)) return null;
  const l = raw.length, t = raw.target;
  let length: StepLength;
  if (l.type === "time" && finite(l.seconds) && l.seconds > 0 && l.seconds <= 86_400) length = { type: "time", seconds: l.seconds };
  else if (l.type === "distance" && finite(l.metres) && l.metres > 0 && l.metres <= 1_000_000) length = { type: "distance", metres: l.metres, unit: l.unit === "m" ? "m" : "km" };
  else return null;
  let target: StepTarget = { type: "none" };
  if (t.type === "pace" && finite(t.fast) && finite(t.slow)) target = { type: "pace", fast: t.fast, slow: t.slow };
  else if (t.type === "hr" && finite(t.zone)) target = { type: "hr", zone: t.zone };
  else if (t.type === "kept") target = { type: "kept", label: quoted(t.label, 60) };
  const label = quoted(raw.label, 80);
  return { type: "step", id: quoted(raw.id, 60) || "s", kind: raw.kind as StepKind, length, target, ...(label ? { label } : {}) };
}

/** A browser workout's steps, kept only where they are whole. They are read back to the model as data. */
function workoutItems(raw: unknown): WorkoutItem[] {
  const out: WorkoutItem[] = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 60) : []) {
    if (isBag(item) && item.type === "repeat" && Array.isArray(item.steps) && finite(item.count)) {
      const steps = item.steps.slice(0, 20).map(step).filter((s): s is WorkoutStep => s !== null);
      if (steps.length) out.push({ type: "repeat", id: quoted(item.id, 60) || "b", count: Math.max(1, Math.min(99, Math.round(item.count))), steps });
    } else { const one = step(item); if (one) out.push(one); }
  }
  return out;
}

function planned(raw: unknown, day: string, checkWorkout: (value: unknown) => HubPlannedWorkout["workout"]): HubPlannedWorkout | null {
  if (!isBag(raw) || typeof raw.idInPlan !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.idInPlan)) return null;
  const totals = isBag(raw.totals) && finite(raw.totals.seconds) && finite(raw.totals.meters) && finite(raw.totals.sets)
    ? { seconds: raw.totals.seconds, meters: raw.totals.meters, sets: raw.totals.sets } : null;
  let workout: HubPlannedWorkout["workout"] = null;
  try { workout = raw.workout ? checkWorkout(raw.workout) : null; } catch { workout = null; }
  return {
    day, idInPlan: raw.idInPlan, planId: "", planProgramId: "", name: quoted(raw.name, 120) || "Workout", sportCode: null,
    sport: typeof raw.sport === "string" && HUB_SPORTS.includes(raw.sport) ? (raw.sport as HubSport) : null, workout, totals,
  };
}

/** Reads the request body. Null when it is not a question. `checkWorkout` is the Hub routes' own workout check. */
export function parseRequest(raw: unknown, nowMs: number, checkWorkout: (value: unknown) => HubPlannedWorkout["workout"]): CoachRequest | null {
  if (!isBag(raw) || typeof raw.text !== "string") return null;
  const text = quotedLong(raw.text, MAX_TEXT);
  if (!text) return null;
  const offset = finite(raw.offsetMin) && Math.abs(raw.offsetMin) <= 16 * 60 ? Math.round(raw.offsetMin) : 0;
  const history = (Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY) : []).map(message).filter((m): m is CoachMessage => m !== null);
  const browser: SavedWorkout[] = [];
  for (const w of Array.isArray(raw.browserWorkouts) ? raw.browserWorkouts.slice(0, 200) : []) {
    if (!isBag(w) || typeof w.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(w.id) || !isDay(w.date) || !SPORTS.includes(w.sport as Sport)) continue;
    const summary = isBag(w.summary) ? w.summary : {};
    browser.push({
      id: w.id, name: quoted(w.name, 80) || "Workout", sport: w.sport as Sport, date: w.date, repeatWeeks: 1, items: workoutItems(w.items),
      summary: { detail: quoted(summary.detail, 120), metres: finite(summary.metres) ? summary.metres : 0, load: finite(summary.load) ? summary.load : 0 }, savedAt: "",
    });
  }
  let hubDays: HubCalendarDay[] | null = null;
  if (Array.isArray(raw.hubDays)) {
    hubDays = [];
    for (const d of raw.hubDays.slice(0, 120)) {
      if (!isBag(d) || !isDay(d.day) || !Array.isArray(d.workouts)) continue;
      const day = d.day;
      hubDays.push({ day, workouts: d.workouts.slice(0, 12).map((w) => planned(w, day, checkWorkout)).filter((w): w is HubPlannedWorkout => w !== null) });
    }
  }
  const page = isBag(raw.page) && typeof raw.page.text === "string" && raw.page.text.trim()
    ? { title: quoted(raw.page.title, 80) || "This page", text: quotedLong(raw.page.text, MAX_PAGE_TEXT) } : null;
  return { text, history, clock: { nowMs, offsetMin: offset }, browser, hubDays, files: parseFiles(raw.files), page, plans: parsePlans(raw.plans) };
}
