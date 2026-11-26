/**
 * "Generate plan", without the screen: the request, what stops it being sent, the words Coach is asked with, and
 * the way from Coach's plan cards to an unsaved plan document. Pure. Ported from the desktop app's
 * `TrainingPlanGenerator.tsx` and `trainingPlanFromDraftPreview`. Nothing here makes a workout up: every entry is
 * one Coach proposed, and where Coach's plan differs from what was asked the difference is listed, not hidden.
 */
import type { CoachBlock } from "@/data/coach";
import type { HubSport } from "@/data/hub";
import { docFromHub, legacyDoc, sportLabel, SPORTS, type BuilderDoc } from "@/lib/builder";
import { addDays, dayMonth, isDayKey, shortDay } from "@/lib/calendar";
import { msg, t } from "@/lib/i18n";
import {
  createTrainingPlan, DAY_NAMES, daysBetween, durationText, MAX_PLAN_WEEKS, PHASE_LABELS, planDate, planDay, planEntryFromWorkout, planEnv, trainingPlanEntryMetrics,
  type PhaseKind, type PlanDifficulty, type PlanEnv, type TrainingPlanDocument, type TrainingPlanEntry, type TrainingPlanPhase,
} from "@/lib/plan";

export interface PlanGenerationRequest {
  goal: string;
  sports: HubSport[];
  difficulty: PlanDifficulty;
  weeks: number;
  sessionsPerWeek: number;
  /** Day 1 of week 1, YYYY-MM-DD. */
  startDate: string;
  /** Monday = 0 through Sunday = 6. */
  availableDayIndexes: number[];
  maxSessionMinutes?: number;
  constraints?: string;
}

export const GOAL_MAX = 180;
export const CONSTRAINTS_MAX = 600;
export const MAX_GENERATED_WEEKS = 24;

export const DIFFICULTY_OPTIONS: readonly { value: PlanDifficulty; label: string; hint: string }[] = [
  { value: "beginner", label: msg("Beginner"), hint: msg("New to structured training") },
  { value: "intermediate", label: msg("Intermediate"), hint: msg("Training consistently") },
  { value: "advanced", label: msg("Advanced"), hint: msg("Strong high-volume base") },
  { value: "custom", label: msg("Custom"), hint: msg("Coach judges from your data") },
];

export const EXAMPLE_GOALS: readonly string[] = [msg("Finish my first trail 50K comfortably"), msg("Build a consistent 5K run base"), msg("Hybrid strength and engine for HYROX")];

/** What the form opens with; a preset from "Build me a plan" fills goal, length and sessions. */
export function newPlanRequest(today: string, preset?: { goal: string; weeks: number; sessionsPerWeek: number }): PlanGenerationRequest {
  return { goal: preset?.goal ?? "", sports: ["run"], difficulty: "intermediate", weeks: preset?.weeks ?? 8, sessionsPerWeek: preset?.sessionsPerWeek ?? 4, startDate: today, availableDayIndexes: [0, 1, 2, 3, 4, 5, 6] };
}

/** The most sessions a week can hold: one a day on the available days. */
export const maxSessions = (request: Pick<PlanGenerationRequest, "availableDayIndexes">): number => Math.min(7, request.availableDayIndexes.length || 1);

/** The first thing that stops the request being sent, or null. */
export function requestProblem(request: PlanGenerationRequest, today: string): string | null {
  if (!request.goal.trim()) return t("Describe your goal to continue.");
  if (request.goal.trim().length > GOAL_MAX) return t("Keep the goal to {n} characters.", { n: GOAL_MAX });
  if (!request.sports.length) return t("Pick at least one sport.");
  if (!request.availableDayIndexes.length) return t("Pick at least one available day.");
  if (request.availableDayIndexes.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return t("Available days must be Monday through Sunday.");
  if (!(Number.isInteger(request.weeks) && request.weeks >= 1 && request.weeks <= MAX_GENERATED_WEEKS)) return t("Generated plans must contain 1 to 24 weeks.");
  if (!(Number.isInteger(request.sessionsPerWeek) && request.sessionsPerWeek >= 1 && request.sessionsPerWeek <= 7)) return t("Sessions per week must be between 1 and 7.");
  if (request.sessionsPerWeek > request.availableDayIndexes.length) return t("Choose at least {n} available days.", { n: request.sessionsPerWeek });
  if (!isDayKey(request.startDate) || request.startDate < today) return t("Choose today or a future start date.");
  if (request.maxSessionMinutes !== undefined && !(request.maxSessionMinutes >= 10 && request.maxSessionMinutes <= 600)) return t("A session limit goes from 10 to 600 minutes.");
  return null;
}

/** The Session limit box: empty is no limit, anything else must be a whole number of minutes. */
export function parseSessionLimit(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}

export interface PlanSnapshot { sports: string; structure: string; total: number; dates: string; days: string; cap: string | null }

/** The "Plan snapshot" card. */
export function planSnapshot(request: PlanGenerationRequest): PlanSnapshot {
  const days = [...request.availableDayIndexes].sort((a, b) => a - b);
  const end = isDayKey(request.startDate) ? addDays(request.startDate, Math.max(1, request.weeks) * 7 - 1) : null;
  return {
    sports: request.sports.length ? request.sports.map(sportLabel).join(", ") : "—",
    structure: request.weeks === 1 ? t("1 week · {n} / week", { n: request.sessionsPerWeek }) : t("{weeks} weeks · {n} / week", { weeks: request.weeks, n: request.sessionsPerWeek }),
    total: request.weeks * request.sessionsPerWeek,
    dates: end ? t("{from} to {to}", { from: dayMonth(request.startDate), to: dayMonth(end) }) : t("Pick a plan start date"),
    days: !days.length ? "—" : days.length === 7 ? t("Every day") : days.map((day) => t(DAY_NAMES[day])).join(", "),
    cap: request.maxSessionMinutes ? `${request.maxSessionMinutes} min` : null,
  };
}

const COACH_SPORT: Record<HubSport, string> = { run: "run", trailRun: "trailRun", bike: "bike", swim: "swim", strength: "strength", hyrox: "hyrox", xcSki: "xcSki", indoorClimb: "indoorClimb", bouldering: "bouldering" };

/** The question Coach is asked. It names Coach's own plan tool, so the answer comes back as plan cards. */
export function generationPrompt(request: PlanGenerationRequest): string {
  const available = [...request.availableDayIndexes].sort((a, b) => a - b).map((day) => DAY_NAMES[day]).join(", ");
  return [
    "Create a complete structured training plan for me from my current training, recovery, recent activities and calendar.",
    "Do not ask a follow-up question.",
    `Goal: ${request.goal.trim()}`,
    `Sports (use only these): ${request.sports.map((sport) => COACH_SPORT[sport]).join(", ")}`,
    `Difficulty: ${request.difficulty}`,
    `Length: exactly ${request.weeks} weeks`,
    `Sessions: exactly ${request.sessionsPerWeek} workouts per week`,
    `Plan start date (day 1 of week 1): ${request.startDate}`,
    "Each plan week is a consecutive seven-day block beginning on the plan start date.",
    `Available weekdays (use only these): ${available}`,
    request.maxSessionMinutes ? `Maximum duration for every session: ${request.maxSessionMinutes} minutes` : "No explicit session-duration cap.",
    request.constraints?.trim() ? `Additional constraints: ${request.constraints.trim()}` : "No additional constraints.",
    "Every workout needs its sport and complete steps with targets and intensities; no saved_workout ids.",
    "Lay the whole plan out with propose_training_plan: at most 28 workouts per call, so send it a week or more at a time, one call per chunk, until every week is covered. Then answer in one short sentence.",
    "Give every call the same title: one short name for the whole plan, without week numbers or part numbers.",
    "Shape the weeks: build load gradually, ease off every third or fourth week, and taper into the goal when it is a race.",
  ].join("\n");
}

/** The plan week by week, one line per workout (date, name, sport, minutes, load) and rest day. */
function weekLines(plan: TrainingPlanDocument): string[] {
  return Array.from({ length: plan.weekCount }, (_, week) => {
    const rows = plan.entries
      .filter((e) => e.weekIndex === week && e.dayIndex !== undefined && e.kind === "workout")
      .sort((a, b) => (a.dayIndex! - b.dayIndex!) || a.sortOrder - b.sortOrder)
      .map((e) => {
        const minutes = Math.round(trainingPlanEntryMetrics(e).durationSeconds / 60);
        return `  ${planDay(plan, week * 7 + e.dayIndex!) ?? ""} ${e.title ?? "Workout"} (${e.workout ? COACH_SPORT[e.workout.sport] : "rest"}${minutes ? `, ${minutes} min` : ""}${e.plannedTrainingLoad ? `, load ${Math.round(e.plannedTrainingLoad)}` : ""})`;
      });
    const rests = plan.entries.filter((e) => e.weekIndex === week && e.kind === "rest" && e.dayIndex !== undefined).map((e) => `  ${planDay(plan, week * 7 + e.dayIndex!) ?? ""} rest day`);
    return [`Week ${week + 1}:`, ...(rows.length || rests.length ? [...rows, ...rests] : ["  (empty)"])].join("\n");
  });
}

/** The plan in words for the side Coach: name, goal, phases and every week. */
export function planOutline(plan: TrainingPlanDocument): string {
  return [
    `Plan: ${plan.name.trim() || "Training plan"}${plan.goal.trim() ? ` · goal: ${plan.goal.trim()}` : ""} · ${plan.difficulty}`,
    `Starts ${planDate(plan.startDate) ?? "(no start date)"}; each week is seven days from there.`,
    ...plan.phases.map((ph) => `Phase ${ph.name || ph.kind}: weeks ${ph.startWeek}–${ph.endWeek}`),
    "",
    ...weekLines(plan),
  ].join("\n");
}

/**
 * The words Coach is asked with to change a plan: the plan as it stands, week by week, and the athlete's ask.
 * Coach lays the whole plan out again with the same tool, so the answer opens the same way a new plan does.
 */
export function revisionPrompt(plan: TrainingPlanDocument, ask: string): string {
  const start = planDate(plan.startDate) ?? "";
  const weeks = weekLines(plan);
  return [
    "Change this training plan as I ask below, then lay the whole changed plan out again with propose_training_plan.",
    "Do not ask a follow-up question. Keep every workout that the change doesn't touch the same (same day, name and content).",
    `Plan: ${plan.name.trim() || "Training plan"}${plan.goal.trim() ? ` · goal: ${plan.goal.trim()}` : ""}`,
    `Plan start date (day 1 of week 1): ${start}. Each week is a consecutive seven-day block from there.`,
    `Length: ${plan.weekCount} weeks unless my ask changes it.`,
    "",
    ...weeks,
    "",
    `My ask: ${ask.trim()}`,
    "",
    "Every workout needs its sport and complete steps with targets and intensities; no saved_workout ids.",
    "At most 28 workouts per propose_training_plan call, so send it a week or more at a time until every week is covered.",
    `Give every call the title “${plan.name.trim() || "Training plan"}”. In the card notes say in one or two sentences what you changed.`,
  ].join("\n");
}

/**
 * Coach's first card title names the plan; a plan laid out in chunks often carries the chunk in it
 * ("10K base build – weeks 1–4", "Marathon plan (part 1 of 3)"). That part is dropped.
 */
export function cleanPlanName(name: string): string {
  const cleaned = name
    .replace(/\s*[-–—:,(|·]\s*(?:weeks?|wks?)\s*\d+\s*(?:[-–—]|to)\s*\d+\s*\)?\s*$/i, "")
    .replace(/\s*[-–—:,(|·]\s*(?:week|wk)\s*\d+\s*\)?\s*$/i, "")
    .replace(/\s*[-–—:,(|·]\s*(?:part|block|chunk)\s*\d+(?:\s*(?:of|\/)\s*\d+)?\s*\)?\s*$/i, "")
    .trim();
  return cleaned || name.trim();
}

/** A week's load for working out phases: Coach's planned load, else its minutes. */
const weekLoads = (plan: Pick<TrainingPlanDocument, "entries" | "weekCount">): number[] => {
  const loads = Array.from({ length: plan.weekCount }, () => 0);
  for (const e of plan.entries) {
    if (e.kind !== "workout" || e.dayIndex === undefined || !(e.weekIndex in loads)) continue;
    loads[e.weekIndex] += e.plannedTrainingLoad ?? trainingPlanEntryMetrics(e).durationSeconds / 60;
  }
  return loads;
};

/**
 * Phases read off the weekly load, the way a coach would label a block: an easier week after a harder one is
 * Recovery, the heaviest stretch in the back half is Peak, a lighter last week is Taper, and what comes before
 * the peak is Base then Build. Short plans (under 3 weeks) get none.
 */
export function inferPhaseKinds(loads: readonly number[]): PhaseKind[] {
  const n = loads.length;
  if (n < 3 || Math.max(...loads) <= 0) return [];
  const kinds: (PhaseKind | null)[] = Array.from({ length: n }, () => null);
  const max = Math.max(...loads);
  if (n >= 5 && loads[n - 1] < 0.85 * Math.max(...loads.slice(0, n - 1))) kinds[n - 1] = "taper";
  for (let i = 1; i < n; i += 1) {
    if (kinds[i]) continue;
    const next = loads[i + 1];
    if (loads[i] < 0.85 * loads[i - 1] && (next === undefined ? false : next > loads[i])) kinds[i] = "recovery";
  }
  let peak = -1;
  for (let i = 0; i < n; i += 1) if (!kinds[i] && (peak < 0 || loads[i] > loads[peak])) peak = i;
  let peakStart = n;
  if (n >= 5 && peak >= Math.floor(n * 0.5)) {
    peakStart = peak;
    while (peakStart > 0 && !kinds[peakStart - 1] && loads[peakStart - 1] >= 0.92 * max && peakStart - 1 >= Math.floor(n * 0.5)) peakStart -= 1;
    for (let i = peakStart; i < n && !kinds[i] && loads[i] >= 0.9 * max; i += 1) kinds[i] = "peak";
  }
  const before = kinds.map((k, i) => (k === null && i < peakStart ? i : -1)).filter((i) => i >= 0);
  const baseCount = n < 5 ? before.length : Math.ceil(before.length / 2);
  before.forEach((i, at) => { kinds[i] = at < baseCount ? "base" : "build"; });
  return kinds.map((k) => k ?? "build");
}

/** The phases for a plan from its weekly load (see inferPhaseKinds), as phase records. */
export function inferPhases(plan: Pick<TrainingPlanDocument, "entries" | "weekCount">, env: PlanEnv = planEnv): TrainingPlanPhase[] {
  const kinds = inferPhaseKinds(weekLoads(plan));
  const phases: TrainingPlanPhase[] = [];
  kinds.forEach((kind, i) => {
    const last = phases[phases.length - 1];
    if (last && last.kind === kind) last.endWeek = i + 1;
    else phases.push({ id: env.newId("phase"), name: t(PHASE_LABELS[kind]), kind, startWeek: i + 1, endWeek: i + 1 });
  });
  return phases;
}

/** A plan's own settings as a request, so Coach's changed plan opens through the same path as a new one. */
export function requestFromPlan(plan: TrainingPlanDocument): PlanGenerationRequest {
  const workouts = plan.entries.filter((e) => e.kind === "workout" && e.dayIndex !== undefined).length;
  return {
    goal: plan.goal.trim() || plan.name.trim() || "Training plan",
    sports: plan.sportMix.length ? [...plan.sportMix] : ["run"],
    difficulty: plan.difficulty,
    weeks: Math.max(1, plan.weekCount),
    sessionsPerWeek: Math.max(1, Math.round(workouts / Math.max(1, plan.weekCount))),
    startDate: planDate(plan.startDate) ?? plan.startDate ?? "",
    availableDayIndexes: [0, 1, 2, 3, 4, 5, 6],
  };
}

/* ───────────── From Coach's cards to a plan ───────────── */

/** One workout Coach put on a day. */
export interface GeneratedWorkout { day: string; name: string; sport: HubSport; doc: BuilderDoc; load?: number }

export interface GeneratedPlan {
  /** The first card's title. */
  name: string;
  /** The cards' notes, in order. */
  summary: string;
  workouts: GeneratedWorkout[];
  /** What Coach proposed that a plan can't hold, in words. */
  left: string[];
}

/**
 * The workouts on Coach's plan cards, as the builder's documents. Null when the answer holds no plan card.
 * A saved gym routine Coach put on a day is listed in `left`: it lives in the gym log, not in a plan.
 */
export function generatedPlanFromBlocks(blocks: readonly CoachBlock[], nextId: () => string): GeneratedPlan | null {
  const cards = blocks.filter((b): b is Extract<CoachBlock, { kind: "plan" }> => b.kind === "plan" && Array.isArray(b.ops));
  if (!cards.length) return null;
  const workouts: GeneratedWorkout[] = [], left: string[] = [];
  for (const card of cards) {
    for (const op of card.ops ?? []) {
      if (op.op === "add_workout") {
        const doc = op.hub ? docFromHub(op.hub, nextId, false) : op.workout ? op.workout.doc ?? legacyDoc(op.workout, [], nextId) : null;
        if (!doc) { left.push(t("Coach's “{name}” on {day} came without steps, so it is not in this plan.", { name: op.name, day: shortDay(op.day) })); continue; }
        workouts.push({ day: op.day, name: op.name, sport: doc.sport, doc: { ...doc, name: op.name }, ...(op.load ? { load: op.load } : {}) });
      } else if (op.op === "add_routine") {
        left.push(t("Coach put your saved gym routine “{name}” on {day}. A plan holds workouts only, so it is not in this plan.", { name: op.name, day: shortDay(op.day) }));
      }
    }
  }
  return { name: cards[0].title, summary: cards.map((c) => c.note).filter(Boolean).join(" "), workouts, left };
}

export interface GeneratedDocument {
  plan: TrainingPlanDocument;
  /** Where Coach's plan differs from what was asked. Also written into the plan's notes. */
  differences: string[];
}

const weekdayIndex = (day: string): number => (new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getDay() + 6) % 7;
const list = (numbers: number[]) => numbers.join(", ");

/**
 * Coach's workouts as an unsaved Coach plan, each on the day Coach gave it. Unlike the desktop app this keeps a
 * plan that doesn't match the request exactly (fewer weeks, another day) and says how it differs, so the athlete
 * can fix it in the editor; it throws only when there is nothing to open.
 */
export function trainingPlanFromGenerated(made: GeneratedPlan, request: PlanGenerationRequest, env: PlanEnv = planEnv): GeneratedDocument {
  if (!made.workouts.length) throw new Error(t("Coach's plan held no workouts."));
  if (!made.name.trim()) throw new Error(t("Coach returned a plan without a name."));
  const differences: string[] = [...made.left];
  const sorted = [...made.workouts].sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted[0].day;
  const start = first < request.startDate ? first : request.startDate;
  if (start !== request.startDate) differences.push(t("Coach's first workout is on {day}, before the start date you asked for, so the plan starts there.", { day: shortDay(first) }));

  const plan = createTrainingPlan(cleanPlanName(made.name), "coach", env);
  plan.description = made.summary.trim();
  plan.goal = request.goal.trim();
  plan.difficulty = request.difficulty;
  plan.startDate = start;
  const entries: TrainingPlanEntry[] = [];
  let dropped = 0;
  sorted.forEach((w, index) => {
    const offset = daysBetween(start, w.day);
    if (offset >= MAX_PLAN_WEEKS * 7) { dropped += 1; return; }
    const entry = planEntryFromWorkout({ key: `coach-${index + 1}`, name: w.name, sport: w.sport, doc: w.doc }, Math.floor(offset / 7), offset % 7, undefined, env);
    entries.push({ ...entry, sortOrder: index, ...(w.load ? { plannedTrainingLoad: w.load } : {}) });
  });
  if (dropped) differences.push(t("{n} of Coach's workouts fall more than {weeks} weeks out and are not in this plan.", { n: dropped, weeks: MAX_PLAN_WEEKS }));
  plan.entries = entries;
  plan.weekCount = Math.min(MAX_PLAN_WEEKS, Math.max(request.weeks, ...entries.map((entry) => entry.weekIndex + 1)));
  plan.sportMix = [...new Set(entries.map((entry) => entry.workout!.sport))];
  plan.phases = inferPhases(plan, env);

  // What the desktop app refuses a draft for is listed here instead.
  const asked = request.weeks * request.sessionsPerWeek;
  if (entries.length !== asked) differences.push(t("Coach laid out {n} of the {asked} workouts you asked for.", { n: entries.length, asked }));
  if (plan.weekCount > request.weeks) differences.push(t("Coach's plan runs {weeks} weeks, not {asked}.", { weeks: plan.weekCount, asked: request.weeks }));
  const perWeek = Array.from({ length: request.weeks }, (_, week) => entries.filter((entry) => entry.weekIndex === week).length);
  const off = perWeek.map((n, week) => (n === request.sessionsPerWeek ? 0 : week + 1)).filter(Boolean);
  if (off.length) {
    const vars = { weeks: list(off), n: request.sessionsPerWeek };
    differences.push(off.length === 1
      ? (request.sessionsPerWeek === 1 ? t("Week {weeks} doesn't have 1 workout.", vars) : t("Week {weeks} doesn't have {n} workouts.", vars))
      : (request.sessionsPerWeek === 1 ? t("Weeks {weeks} don't have 1 workout.", vars) : t("Weeks {weeks} don't have {n} workouts.", vars)));
  }
  const offDay = sorted.filter((w) => !request.availableDayIndexes.includes(weekdayIndex(w.day)));
  if (offDay.length) differences.push(offDay.length === 1 ? t("“{name}” is on a day you didn't make available.", { name: offDay[0].name }) : t("{n} workouts are on a day you didn't make available.", { n: offDay.length }));
  const offSport = [...new Set(sorted.filter((w) => !request.sports.includes(w.sport)).map((w) => sportLabel(w.sport)))];
  if (offSport.length) differences.push(t("Coach used a sport you didn't ask for: {sports}.", { sports: offSport.join(", ") }));
  if (request.maxSessionMinutes) {
    const long = entries.filter((entry) => trainingPlanEntryMetrics(entry).durationSeconds > request.maxSessionMinutes! * 60);
    if (long.length) differences.push(long.length === 1
      ? t("“{name}” ({time}) is over your {limit} min session limit.", { name: long[0].title ?? "", time: durationText(trainingPlanEntryMetrics(long[0]).durationSeconds), limit: request.maxSessionMinutes })
      : t("{n} workouts are over your {limit} min session limit.", { n: long.length, limit: request.maxSessionMinutes }));
  }
  plan.notes = [request.constraints?.trim(), ...differences].filter(Boolean).join("\n");
  return { plan, differences };
}

/** The nine sports, in the order the form lists them. */
export const GENERATOR_SPORTS = SPORTS;
