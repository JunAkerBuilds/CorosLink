// Coach and the athlete's saved training plans (Library › Plans). Plans live in the app, not the account, so the app
// sends a short form of each with a question (PlanBrief); Coach lists and reads them from that, and proposes edits on
// a card that the app applies to the real plan document (lib/planEdit.ts). A whole new plan is built across several
// build_plan calls in one answer into one card (PlanDraftCard). Pure.
import type { CoachHue, PlanSession } from "@/data/coach";
import type { HubSport, HubWorkout } from "@/data/hub";
import type { Workout } from "@/data/workouts";
import { addDays } from "@/lib/calendar";
import { daysBetween, DAY_NAMES, MAX_PLAN_WEEKS, PHASE_KINDS, PHASE_LABELS, planDate, trainingPlanEntryMetrics, type PhaseKind, type TrainingPlanDocument } from "@/lib/plan";
import { finite, isDay, quoted } from "./items";

/** One workout or rest day in a brief. */
export interface BriefEntry { id: string; week: number; day: number; kind: "workout" | "rest"; title: string; sport: string; minutes: number; load: number }

/** A saved plan as Coach sees it: no workout steps, just what each day holds. */
export interface PlanBrief {
  id: string; name: string; goal: string; difficulty: string; start: string; weeks: number;
  phases: { kind: string; name: string; startWeek: number; endWeek: number }[];
  entries: BriefEntry[];
  /** Open in the plan editor right now (its unsaved state). */
  open: boolean;
}

export const MAX_PLANS = 20, MAX_BRIEF_ENTRIES = 1200;

/** A plan document as a brief (in the app, before sending). */
export function planBrief(plan: TrainingPlanDocument, open = false): PlanBrief {
  return {
    id: plan.id, name: plan.name, goal: plan.goal, difficulty: plan.difficulty, start: planDate(plan.startDate) ?? "", weeks: plan.weekCount, open,
    phases: plan.phases.map((p) => ({ kind: p.kind ?? "custom", name: p.name, startWeek: p.startWeek, endWeek: p.endWeek })),
    entries: plan.entries.filter((e) => e.dayIndex !== undefined).map((e) => ({
      id: e.id, week: e.weekIndex, day: e.dayIndex!, kind: e.kind === "rest" ? "rest" : "workout", title: e.title ?? (e.kind === "rest" ? "Rest day" : "Workout"),
      sport: e.workout?.sport ?? "", minutes: Math.round(trainingPlanEntryMetrics(e).durationSeconds / 60), load: Math.round(e.plannedTrainingLoad ?? 0),
    })),
  };
}

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, lo: number, hi: number): number | null => (finite(v) && v >= lo && v <= hi ? Math.round(v) : null);

/** The plans sent with a question, checked and trimmed. */
export function parsePlans(raw: unknown): PlanBrief[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanBrief[] = [];
  let budget = MAX_BRIEF_ENTRIES;
  for (const p of raw.slice(0, MAX_PLANS)) {
    if (!isBag(p) || typeof p.id !== "string" || !/^[\w:.-]{1,120}$/.test(p.id)) continue;
    const weeks = whole(p.weeks, 1, MAX_PLAN_WEEKS);
    if (weeks === null) continue;
    const entries: BriefEntry[] = [];
    for (const e of Array.isArray(p.entries) ? p.entries : []) {
      if (budget <= 0) break;
      if (!isBag(e) || typeof e.id !== "string" || !/^[\w:.-]{1,120}$/.test(e.id)) continue;
      const week = whole(e.week, 0, weeks - 1), day = whole(e.day, 0, 6);
      if (week === null || day === null) continue;
      entries.push({ id: e.id, week, day, kind: e.kind === "rest" ? "rest" : "workout", title: quoted(e.title, 80) || "Workout", sport: quoted(e.sport, 20), minutes: whole(e.minutes, 0, 1440) ?? 0, load: whole(e.load, 0, 5000) ?? 0 });
      budget -= 1;
    }
    const phases = (Array.isArray(p.phases) ? p.phases : []).filter(isBag).slice(0, 30).flatMap((ph) => {
      const s = whole(ph.startWeek, 1, weeks), e = whole(ph.endWeek, 1, weeks);
      return s !== null && e !== null && s <= e ? [{ kind: quoted(ph.kind, 20) || "custom", name: quoted(ph.name, 40), startWeek: s, endWeek: e }] : [];
    });
    out.push({ id: p.id, name: quoted(p.name, 80) || "Untitled plan", goal: quoted(p.goal, 180), difficulty: quoted(p.difficulty, 20), start: isDay(p.start) ? p.start : "", weeks, phases, entries, open: p.open === true });
  }
  return out;
}

const dayName = (plan: PlanBrief, day: number): string => (plan.start ? new Date(`${addDays(plan.start, day)}T12:00:00Z`).toUTCString().slice(0, 3) : DAY_NAMES[day]);
const dateOf = (plan: PlanBrief, week: number, day: number): string => (plan.start ? addDays(plan.start, week * 7 + day) : "");
const weekLoad = (plan: PlanBrief, week: number) => plan.entries.filter((e) => e.week === week && e.kind === "workout").reduce((s, e) => s + e.load, 0);

/** list_plans */
export function listPlansText(plans: readonly PlanBrief[]): string {
  if (!plans.length) return "The athlete has no saved plans in the app.";
  return plans.map((p) => {
    const workouts = p.entries.filter((e) => e.kind === "workout").length;
    return `${p.id}: “${p.name}”${p.open ? " (OPEN in the plan editor now)" : ""}${p.goal ? ` · goal: ${p.goal}` : ""} · ${p.weeks} weeks · ${workouts} workouts${p.start ? ` · starts ${p.start}` : ""}${p.phases.length ? ` · phases: ${p.phases.map((ph) => `${ph.name || ph.kind} W${ph.startWeek}–${ph.endWeek}`).join(", ")}` : ""}`;
  }).join("\n");
}

/** read_plan: every week, each day with its entry id. */
export function readPlanText(plan: PlanBrief): string {
  const lines = [`Plan ${plan.id}: “${plan.name}”${plan.open ? " (open in the plan editor; edits apply to it directly)" : ""}`, `Goal: ${plan.goal || "—"} · difficulty ${plan.difficulty || "—"} · ${plan.weeks} weeks${plan.start ? ` · week 1 starts ${plan.start} (a ${dayName(plan, 0)}); each week is seven days from there` : ""}`];
  if (plan.phases.length) lines.push(`Phases: ${plan.phases.map((ph) => `${ph.name || ph.kind} (${ph.kind}) weeks ${ph.startWeek}–${ph.endWeek}`).join("; ")}`);
  for (let w = 0; w < plan.weeks; w++) {
    const days = plan.entries.filter((e) => e.week === w).sort((a, b) => a.day - b.day);
    lines.push(`Week ${w + 1}${weekLoad(plan, w) ? ` (load ${weekLoad(plan, w)})` : ""}:`);
    if (!days.length) lines.push("  (empty)");
    for (const e of days) lines.push(`  ${dateOf(plan, w, e.day)} ${dayName(plan, e.day)} · ${e.kind === "rest" ? "rest day" : `${e.title} (${e.sport || "workout"}${e.minutes ? `, ${e.minutes} min` : ""}${e.load ? `, load ${e.load}` : ""})`} · entry ${e.id}`);
  }
  return lines.join("\n");
}

export const findPlan = (plans: readonly PlanBrief[], id: unknown): PlanBrief | undefined =>
  typeof id === "string" ? plans.find((p) => p.id === id) ?? plans.find((p) => p.name.toLowerCase() === id.toLowerCase()) : plans.find((p) => p.open);

/* ───────────── Edits ───────────── */

/** A workout made by Coach for a plan: the same fields a calendar card carries. */
export interface MadeWorkout { name: string; sport: HubSport | string; workout: Workout | null; hub: HubWorkout | null; load?: number }

export type PlanEditOp =
  | { op: "move"; entry: string; week: number; day: number }
  | { op: "remove"; entry: string }
  | ({ op: "replace"; entry: string } & MadeWorkout)
  | ({ op: "add"; week: number; day: number } & MadeWorkout)
  /** Adds a week after `after` (0-based; the last week to append): empty, a copy of week `copy`, or a recovery week. */
  | { op: "add_week"; after: number; copy?: number; recovery?: boolean }
  | { op: "remove_week"; week: number }
  | { op: "phases"; phases: { kind: PhaseKind; startWeek: number; endWeek: number }[] }
  | { op: "rename"; name: string }
  | { op: "goal"; goal: string };

export interface PlanEditRow { label: string; now: PlanSession[]; proposed: PlanSession[]; loadNow: number; loadNext: number }

const SPORT_HUE: Record<string, CoachHue> = { run: "mint", trailRun: "mint", bike: "cyan", ride: "cyan", swim: "blue", strength: "violet", hyrox: "violet", xcSki: "mint", indoorClimb: "orange", bouldering: "orange" };
const hueOf = (sport: string): CoachHue | "none" => SPORT_HUE[sport] ?? "gold";
const NONE = (name: string): PlanSession => ({ name, hue: "none" });

/** A change as Coach sends it, before its workout (if any) is made. */
export type EditInput = Record<string, unknown>;

/**
 * Checks Coach's changes against the plan, in order (a week added first can then take workouts), and describes them
 * as card rows with the load before and after. `made` holds the workout already made for each change that has one.
 */
export function planEdit(plan: PlanBrief, changes: readonly EditInput[], made: readonly (MadeWorkout | null)[]):
  { ops: PlanEditOp[]; rows: PlanEditRow[]; load: { before: number; after: number; weeks: number } } | { error: string } {
  const ops: PlanEditOp[] = [], rows: PlanEditRow[] = [];
  const entries = new Map(plan.entries.map((e) => [e.id, { ...e }]));
  let weeks = plan.weeks;
  const before = plan.entries.reduce((s, e) => s + (e.kind === "workout" ? e.load : 0), 0);
  let after = before;
  const at = (week: number, day: number) => `W${week + 1} · ${dayName(plan, day)}`;
  const where = (c: EditInput, n: number): { week: number; day: number } | string => {
    if (isDay(c.date)) {
      if (!plan.start) return `change ${n}: this plan has no start date, so send week and weekday instead of date.`;
      const off = daysBetween(plan.start, c.date);
      if (off < 0) return `change ${n}: ${c.date} is before the plan starts (${plan.start}).`;
      return { week: Math.floor(off / 7), day: off % 7 };
    }
    const week = whole(c.week, 1, MAX_PLAN_WEEKS), wd = typeof c.weekday === "string" ? DAY_NAMES.findIndex((d) => d.toLowerCase() === c.weekday!.toString().slice(0, 3).toLowerCase()) : -1;
    if (week === null || wd < 0) return `change ${n}: say where with date (YYYY-MM-DD) or with week (1-based) and weekday (Mon–Sun).`;
    const startWd = plan.start ? (new Date(`${plan.start}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
    return { week: week - 1, day: (wd - startWd + 7) % 7 };
  };
  const entryOf = (c: EditInput, n: number) => {
    const e = typeof c.entry === "string" ? entries.get(c.entry) : undefined;
    return e ?? `change ${n}: no entry ${quoted(c.entry, 60) || "(none)"} in this plan. Use an entry id from read_plan.`;
  };
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i], n = i + 1, w = made[i];
    switch (c.action) {
      case "move": {
        const e = entryOf(c, n); if (typeof e === "string") return { error: e };
        const to = where(c, n); if (typeof to === "string") return { error: to };
        if (to.week >= weeks) return { error: `change ${n}: week ${to.week + 1} is past the plan's last week (${weeks}). Add a week first.` };
        rows.push({ label: e.week === to.week ? `${at(e.week, e.day)} → ${dayName(plan, to.day)}` : `${at(e.week, e.day)} → W${to.week + 1} ${dayName(plan, to.day)}`, now: [{ name: e.title, hue: hueOf(e.sport) }], proposed: [{ name: e.title, hue: hueOf(e.sport), changed: true }], loadNow: 0, loadNext: 0 });
        ops.push({ op: "move", entry: e.id, week: to.week, day: to.day });
        e.week = to.week; e.day = to.day;
        break;
      }
      case "remove": {
        const e = entryOf(c, n); if (typeof e === "string") return { error: e };
        rows.push({ label: at(e.week, e.day), now: [{ name: e.title, hue: e.kind === "rest" ? "none" : hueOf(e.sport) }], proposed: [NONE("Removed")], loadNow: e.load, loadNext: 0 });
        after -= e.load; entries.delete(e.id);
        ops.push({ op: "remove", entry: e.id });
        break;
      }
      case "replace": {
        const e = entryOf(c, n); if (typeof e === "string") return { error: e };
        if (!w) return { error: `change ${n}: replace needs workout.` };
        rows.push({ label: at(e.week, e.day), now: [{ name: e.title, hue: hueOf(e.sport) }], proposed: [{ name: w.name, hue: hueOf(String(w.sport)), changed: true }], loadNow: e.load, loadNext: w.load ?? 0 });
        after += (w.load ?? 0) - e.load; e.title = w.name; e.load = w.load ?? 0;
        ops.push({ op: "replace", entry: e.id, ...w });
        break;
      }
      case "add": {
        if (!w) return { error: `change ${n}: add needs workout.` };
        const to = where(c, n); if (typeof to === "string") return { error: to };
        if (to.week >= weeks) return { error: `change ${n}: week ${to.week + 1} is past the plan's last week (${weeks}). Add a week first with add_week.` };
        const there = [...entries.values()].filter((e) => e.week === to.week && e.day === to.day);
        rows.push({ label: at(to.week, to.day), now: there.length ? there.map((e) => ({ name: e.title, hue: e.kind === "rest" ? "none" as const : hueOf(e.sport) })) : [NONE("—")], proposed: [...there.filter((e) => e.kind === "workout").map((e) => ({ name: e.title, hue: hueOf(e.sport) })), { name: w.name, hue: hueOf(String(w.sport)), changed: true }], loadNow: 0, loadNext: w.load ?? 0 });
        after += w.load ?? 0;
        ops.push({ op: "add", week: to.week, day: to.day, ...w });
        break;
      }
      case "add_week": {
        if (weeks >= MAX_PLAN_WEEKS) return { error: `change ${n}: a plan holds at most ${MAX_PLAN_WEEKS} weeks.` };
        const afterW = c.after_week === undefined ? weeks : whole(c.after_week, 0, weeks);
        if (afterW === null) return { error: `change ${n}: after_week must be 0 to ${weeks} (0 puts it first; leave it out for the end).` };
        const copy = c.copy_week === undefined ? undefined : whole(c.copy_week, 1, weeks);
        if (copy === null) return { error: `change ${n}: copy_week must be a week of the plan, 1 to ${weeks}.` };
        const copied = copy ? [...entries.values()].filter((e) => e.week === copy - 1 && e.kind === "workout") : [];
        const recovery = c.recovery === true;
        rows.push({ label: `New week ${afterW + 1}`, now: [NONE("—")], proposed: copied.length ? copied.map((e) => ({ name: e.title, hue: hueOf(e.sport), changed: true })) : [NONE(recovery ? "Recovery week, empty to fill" : "Empty week")], loadNow: 0, loadNext: copied.reduce((s, e) => s + e.load, 0) });
        after += copied.reduce((s, e) => s + e.load, 0);
        for (const e of entries.values()) if (e.week >= afterW) e.week += 1;
        weeks += 1;
        ops.push({ op: "add_week", after: afterW - 1, ...(copy ? { copy: copy - 1 } : {}), ...(recovery ? { recovery } : {}) });
        break;
      }
      case "remove_week": {
        const week = whole(c.week, 1, weeks);
        if (week === null) return { error: `change ${n}: week must be 1 to ${weeks}.` };
        if (weeks <= 1) return { error: `change ${n}: a plan needs at least one week.` };
        const gone = [...entries.values()].filter((e) => e.week === week - 1);
        const load = gone.reduce((s, e) => s + (e.kind === "workout" ? e.load : 0), 0);
        rows.push({ label: `Week ${week}`, now: gone.length ? gone.filter((e) => e.kind === "workout").map((e) => ({ name: e.title, hue: hueOf(e.sport) })) : [NONE("Empty")], proposed: [NONE("Week removed; later weeks move up")], loadNow: load, loadNext: 0 });
        after -= load;
        for (const e of gone) entries.delete(e.id);
        for (const e of entries.values()) if (e.week > week - 1) e.week -= 1;
        weeks -= 1;
        ops.push({ op: "remove_week", week: week - 1 });
        break;
      }
      case "set_phases": {
        const list = (Array.isArray(c.phases) ? c.phases : []).filter(isBag);
        const phases: { kind: PhaseKind; startWeek: number; endWeek: number }[] = [];
        for (const ph of list.slice(0, 20)) {
          const kind = PHASE_KINDS.includes(ph.kind as PhaseKind) ? (ph.kind as PhaseKind) : null;
          const s = whole(ph.start_week, 1, weeks), e = whole(ph.end_week, 1, weeks);
          if (!kind || s === null || e === null || s > e) return { error: `change ${n}: each phase needs kind (${PHASE_KINDS.join(", ")}) and start_week ≤ end_week within 1–${weeks}.` };
          phases.push({ kind, startWeek: s, endWeek: e });
        }
        const show = (ps: { kind: string; name?: string; startWeek: number; endWeek: number }[]) => ps.length ? ps.map((p) => ({ name: `${p.name || PHASE_LABELS[p.kind as PhaseKind] || p.kind} W${p.startWeek}–${p.endWeek}`, hue: "none" as const })) : [NONE("No phases")];
        rows.push({ label: "Phases", now: show(plan.phases), proposed: show(phases).map((p) => ({ ...p, changed: true })), loadNow: 0, loadNext: 0 });
        ops.push({ op: "phases", phases });
        break;
      }
      case "rename": {
        const name = quoted(c.name, 80);
        if (!name) return { error: `change ${n}: rename needs name.` };
        rows.push({ label: "Name", now: [NONE(plan.name)], proposed: [{ name, hue: "none", changed: true }], loadNow: 0, loadNext: 0 });
        ops.push({ op: "rename", name });
        break;
      }
      case "set_goal": {
        const goal = quoted(c.goal, 180);
        if (!goal) return { error: `change ${n}: set_goal needs goal.` };
        rows.push({ label: "Goal", now: [NONE(plan.goal || "—")], proposed: [{ name: goal, hue: "none", changed: true }], loadNow: 0, loadNext: 0 });
        ops.push({ op: "goal", goal });
        break;
      }
      default:
        return { error: `change ${n}: action must be one of move, remove, replace, add, add_week, remove_week, set_phases, rename, set_goal.` };
    }
  }
  if (!ops.length) return { error: "a plan edit needs at least one change." };
  return { ops, rows, load: { before, after: Math.max(0, after), weeks } };
}

/* ───────────── A whole new plan ───────────── */

/** One workout of a plan being built: its day of the plan (0-based from the start) and what it is. */
export interface DraftWorkout extends MadeWorkout { offset: number; detail: string }

export interface PlanDraft { name: string; overview: string; goal: string; start: string; weeks: number; workouts: DraftWorkout[] }

/** Adds a build_plan chunk to the plan it belongs to (by name), replacing any workout already on the same day and name. */
export function addToDraft(draft: PlanDraft | undefined, chunk: PlanDraft): PlanDraft {
  if (!draft) return { ...chunk, workouts: [...chunk.workouts].sort((a, b) => a.offset - b.offset) };
  const key = (w: DraftWorkout) => `${w.offset}|${w.name.toLowerCase()}`;
  const byKey = new Map(draft.workouts.map((w) => [key(w), w]));
  for (const w of chunk.workouts) byKey.set(key(w), w);
  return {
    name: draft.name, overview: chunk.overview || draft.overview, goal: chunk.goal || draft.goal, start: draft.start,
    weeks: Math.max(draft.weeks, chunk.weeks, ...[...byKey.values()].map((w) => Math.floor(w.offset / 7) + 1)),
    workouts: [...byKey.values()].sort((a, b) => a.offset - b.offset),
  };
}

/** Load per week of a draft, for the card's bars. */
export const draftWeekLoads = (d: PlanDraft): number[] =>
  Array.from({ length: d.weeks }, (_, w) => d.workouts.filter((x) => Math.floor(x.offset / 7) === w).reduce((s, x) => s + (x.load ?? 0), 0));
