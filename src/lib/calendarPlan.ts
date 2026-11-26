/**
 * Pure maths for editing the training calendar at a desk: a draft of moves, copies and removals laid over the
 * calendar until it is saved, what may be dragged where, which recorded activity did which planned workout
 * (and how much of it), the filters, and each week's numbers.
 */
import { locale } from "@/lib/i18n";

export type DraftOp =
  /** `id` is a calendar entry's id, or the `key` of a copy made earlier in the draft. */
  | { op: "move"; id: string; to: string }
  /** A copy of entry `id` on day `to`, known in the draft as `key`. */
  | { op: "copy"; id: string; to: string; key: string }
  | { op: "remove"; id: string };

export interface DraftEntry {
  id: string;
  date: string;
  status: "done" | "planned";
}

export type Drafted<E> = E & {
  /** Set while the change is only in the draft. */
  pending?: "moved" | "added";
  /** For a copy: the id of the entry it copies. */
  copyOf?: string;
};

/** The calendar as it will look once the draft is saved. Ops that name an entry that is gone are skipped. */
export function applyDraft<E extends DraftEntry>(entries: readonly E[], ops: readonly DraftOp[]): Drafted<E>[] {
  const out = new Map<string, Drafted<E>>();
  for (const e of entries) out.set(e.id, { ...e });
  const original = new Map(entries.map((e) => [e.id, e.date]));
  for (const op of ops) {
    if (op.op === "copy") {
      const from: Drafted<E> | undefined = out.get(op.id) ?? entries.find((e) => e.id === op.id);
      if (!from || out.has(op.key)) continue;
      out.set(op.key, { ...from, id: op.key, date: op.to, pending: "added", copyOf: from.copyOf ?? from.id });
      continue;
    }
    const e = out.get(op.id);
    if (!e) continue;
    if (op.op === "remove") { out.delete(op.id); continue; }
    const moved = { ...e, date: op.to };
    if (moved.pending !== "added") moved.pending = original.get(op.id) === op.to ? undefined : "moved";
    if (!moved.pending) delete moved.pending;
    out.set(op.id, moved);
  }
  return [...out.values()];
}

/** One change that saving makes: what the draft adds up to for each entry. */
export type NetChange<E> =
  | { kind: "move"; entry: E; to: string }
  | { kind: "remove"; entry: E }
  | { kind: "copy"; entry: E; to: string; key: string };

/**
 * What saving has to do, in order: moves and removals of real entries, then the copies (of their source as it is
 * now). A move back to the original day is no change; a copy that was removed again is nothing.
 */
export function netChanges<E extends DraftEntry>(entries: readonly E[], ops: readonly DraftOp[]): NetChange<E>[] {
  const after = new Map(applyDraft(entries, ops).map((e) => [e.id, e]));
  const out: NetChange<E>[] = [];
  for (const e of entries) {
    const now = after.get(e.id);
    if (!now) out.push({ kind: "remove", entry: e });
    else if (now.date !== e.date) out.push({ kind: "move", entry: e, to: now.date });
  }
  for (const op of ops) {
    if (op.op !== "copy") continue;
    const now = after.get(op.key);
    if (!now) continue;
    const source = entries.find((e) => e.id === (now.copyOf ?? op.id));
    if (source) out.push({ kind: "copy", entry: source, to: now.date, key: op.key });
  }
  return out;
}

/** Drops the ops that name entries no longer on the calendar (saved elsewhere, or gone). */
export function liveOps(entries: readonly DraftEntry[], ops: readonly DraftOp[]): DraftOp[] {
  const known = new Set(entries.map((e) => e.id));
  const out: DraftOp[] = [];
  for (const op of ops) {
    if (!known.has(op.id)) continue;
    out.push(op);
    if (op.op === "copy") known.add(op.key);
  }
  return out;
}

/* ───────────── What may go where ───────────── */

export interface Editable extends DraftEntry {
  source: string;
  coros?: { workout: unknown | null };
  browser?: unknown;
  planned?: unknown;
}

/** A planned workout this app can change: on COROS, saved in this browser, or a gym routine the phone put on a day. */
export const isOwnPlan = (e: Editable): boolean =>
  e.status === "planned" && ((e.source === "coros" && !!e.coros) || (e.source === "browser" && !!e.browser) || (e.source === "synced" && !!e.planned));

/** Planned and from today on: it can move. Past days keep what happened on them. */
export const canMove = (e: Editable, today: string): boolean => isOwnPlan(e) && e.date >= today;

/** Any own plan, past ones too, except a COROS workout whose steps this app can't write. */
export const canCopy = (e: Editable): boolean => isOwnPlan(e) && !(e.source === "coros" && e.coros?.workout == null);

export const canRemove = (e: Editable, today: string): boolean => canMove(e, today);

/** Workouts land on today or later. */
export const canDropOn = (day: string, today: string): boolean => day >= today;

/* ───────────── Done against planned ───────────── */

export interface Pairable extends DraftEntry {
  sport: string;
  name: string;
  metres?: number;
  seconds?: number;
  load?: number;
  /** Metres climbed, for a recorded activity. */
  elevation?: number;
}

export type PlanState = "done" | "missed" | "today" | "upcoming";

export interface Pairing {
  /** Planned entry id → the recorded activity that did it. */
  doneBy: Map<string, string>;
  /** Recorded activity id → the planned entry it did. */
  did: Map<string, string>;
  /** Recorded activity id → how much of the plan, in percent, when the two can be compared. */
  percent: Map<string, number>;
}

/**
 * A pairing the person set by hand: `linked` pairs the two whatever the day or name; `linked: false` keeps them apart,
 * so the automatic match looks elsewhere.
 */
export interface Link { plan: string; activity: string; linked: boolean }

/**
 * Each planned workout gets at most one recorded activity. Links set by hand come first. Then, on each day:
 * same name first, then same sport, closest in size.
 */
export function pairEntries<E extends Pairable>(entries: readonly E[], links: readonly Link[] = []): Pairing {
  const doneBy = new Map<string, string>(), did = new Map<string, string>(), percent = new Map<string, number>();
  const byId = new Map(entries.map((e) => [e.id, e]));
  const apart = new Set(links.filter((l) => !l.linked).map((l) => `${l.plan}\n${l.activity}`));
  const pair = (plan: E, done: E) => {
    doneBy.set(plan.id, done.id);
    did.set(done.id, plan.id);
    const p = completion(plan, done);
    if (p != null) percent.set(done.id, p);
  };
  for (const l of links) {
    if (!l.linked) continue;
    const plan = byId.get(l.plan), done = byId.get(l.activity);
    if (plan?.status === "planned" && done?.status === "done" && !doneBy.has(plan.id) && !did.has(done.id)) pair(plan, done);
  }
  const byDay = new Map<string, E[]>();
  for (const e of entries) {
    const list = byDay.get(e.date);
    if (list) list.push(e); else byDay.set(e.date, [e]);
  }
  for (const list of byDay.values()) {
    const plans = list.filter((e) => e.status === "planned" && !doneBy.has(e.id));
    const free = list.filter((e) => e.status === "done");
    const take = (plan: E, pick: (d: E) => boolean) => {
      const options = free.filter((d) => !did.has(d.id) && !apart.has(`${plan.id}\n${d.id}`) && pick(d));
      if (!options.length) return;
      const size = (d: E) => (plan.metres && d.metres ? Math.abs(d.metres - plan.metres) : plan.seconds && d.seconds ? Math.abs(d.seconds - plan.seconds) : 0);
      pair(plan, options.reduce((a, b) => (size(b) < size(a) ? b : a)));
    };
    const name = (s: string) => s.trim().toLowerCase();
    for (const plan of plans) take(plan, (d) => name(d.name) === name(plan.name));
    for (const plan of plans) if (!doneBy.has(plan.id)) take(plan, (d) => d.sport === plan.sport);
  }
  return { doneBy, did, percent };
}

/** How far a link by hand may reach: a workout done up to three days either side of its day. */
export const LINK_DAYS = 3;

const daysApart = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

/**
 * What an entry could be linked to by hand: for an activity, planned workouts nobody did yet; for a plan, activities
 * that did no plan. Within `LINK_DAYS`, nearest day first, then the same sport. At most four.
 */
export function linkOptions<E extends Pairable>(entry: E, entries: readonly E[], pairing: Pairing): E[] {
  const want = entry.status === "done" ? "planned" : "done";
  return entries
    .filter((e) => e.status === want && e.id !== entry.id && daysApart(e.date, entry.date) <= LINK_DAYS
      && !(want === "planned" ? pairing.doneBy.has(e.id) : pairing.did.has(e.id)))
    .sort((a, b) => daysApart(a.date, entry.date) - daysApart(b.date, entry.date) || Number(b.sport === entry.sport) - Number(a.sport === entry.sport))
    .slice(0, 4);
}

/** The links once `plan` and `activity` are paired by hand: any other link either of them had is dropped. */
export function withLink(links: readonly Link[], plan: string, activity: string): Link[] {
  return [...links.filter((l) => l.plan !== plan && l.activity !== activity), { plan, activity, linked: true }];
}

/** The links once `plan` and `activity` are kept apart. */
export function withoutLink(links: readonly Link[], plan: string, activity: string): Link[] {
  return [...links.filter((l) => !(l.plan === plan && l.activity === activity) && !(l.linked && (l.plan === plan || l.activity === activity))), { plan, activity, linked: false }];
}

/** Done ÷ planned, by distance when both have one, else time, else load. Null when nothing compares. */
export function completion(plan: Pick<Pairable, "metres" | "seconds" | "load">, done: Pick<Pairable, "metres" | "seconds" | "load">): number | null {
  const ratio = (a?: number, b?: number) => (a && b && a > 0 && b > 0 ? b / a : null);
  const r = ratio(plan.metres, done.metres) ?? ratio(plan.seconds, done.seconds) ?? ratio(plan.load, done.load);
  return r == null ? null : Math.round(r * 100);
}

/** Desktop's tones: 90% and up is complete, 50% and up partial, below that missed. */
export const tone = (percent: number): "complete" | "partial" | "missed" => (percent >= 90 ? "complete" : percent >= 50 ? "partial" : "missed");

/** Where a planned workout stands today. */
export function planState(e: DraftEntry, pairing: Pairing, today: string): PlanState {
  if (pairing.doneBy.has(e.id)) return "done";
  if (e.date < today) return "missed";
  return e.date === today ? "today" : "upcoming";
}

/* ───────────── Filters ───────────── */

export type Show = "all" | "planned" | "completed";

export interface Filter { show: Show; hidden: readonly string[] }

export const NO_FILTER: Filter = { show: "all", hidden: [] };

export const passes = (e: { status: "done" | "planned"; sport: string }, f: Filter): boolean =>
  !f.hidden.includes(e.sport) && (f.show === "all" || (f.show === "planned" ? e.status === "planned" : e.status === "done"));

/* ───────────── A week's numbers ───────────── */

/** Done against planned for one sport, or the whole week. Planned counts every planned workout, done or not. */
export interface Totals {
  load: number;
  plannedLoad: number;
  seconds: number;
  plannedSeconds: number;
  metres: number;
  plannedMetres: number;
}

export interface WeekNumbers extends Totals {
  /** Planned workouts in the week and how many of them were done. */
  planned: number;
  done: number;
  /** Metres climbed in what was recorded. */
  elevation: number;
  /** One row per sport with anything done or planned, most load first. */
  sports: (Totals & { sport: string })[];
}

const emptyTotals = (): Totals => ({ load: 0, plannedLoad: 0, seconds: 0, plannedSeconds: 0, metres: 0, plannedMetres: 0 });

function addTo(t: Totals, e: Pairable): void {
  if (e.status === "done") { t.load += e.load ?? 0; t.seconds += e.seconds ?? 0; t.metres += e.metres ?? 0; }
  else { t.plannedLoad += e.load ?? 0; t.plannedSeconds += e.seconds ?? 0; t.plannedMetres += e.metres ?? 0; }
}

/**
 * One week's numbers. `recordedLoad` is the account's own load for the week, when it has one: it also counts a day's
 * reading when that day's activities carry no load, as the Dashboard does.
 */
export function weekNumbers<E extends Pairable>(entries: readonly E[], days: readonly string[], pairing: Pairing, recordedLoad?: number | null): WeekNumbers {
  const inWeek = entries.filter((e) => days.includes(e.date));
  const plans = inWeek.filter((e) => e.status === "planned");
  const all = emptyTotals();
  const bySport = new Map<string, Totals>();
  let elevation = 0;
  for (const e of inWeek) {
    addTo(all, e);
    let t = bySport.get(e.sport);
    if (!t) bySport.set(e.sport, (t = emptyTotals()));
    addTo(t, e);
    if (e.status === "done") elevation += e.elevation ?? 0;
  }
  const round = (t: Totals): Totals => ({ ...t, load: Math.round(t.load), plannedLoad: Math.round(t.plannedLoad) });
  const totals = round(all);
  if (recordedLoad != null && Number.isFinite(recordedLoad) && recordedLoad > totals.load) totals.load = Math.round(recordedLoad);
  return {
    ...totals,
    planned: plans.length,
    done: plans.filter((p) => pairing.doneBy.has(p.id)).length,
    elevation: Math.round(elevation),
    sports: [...bySport].map(([sport, t]) => ({ sport, ...round(t) })).sort((a, b) => b.load + b.plannedLoad - (a.load + a.plannedLoad)),
  };
}

/* ───────────── Printing ───────────── */

/** "done / planned" with the unit once; the done value alone when nothing is planned, "--" when both are empty. */
export function doneOfPlanned(done: number, planned: number, fmt: (v: number) => string, unit = ""): string {
  if (planned > 0) return `${fmt(done)} / ${fmt(planned)}${unit}`;
  return done > 0 ? `${fmt(done)}${unit}` : "--";
}

/** Kilometres to one decimal (12.4); metres whole, with thousands marks, for swimming (1,500). */
export const kmText = (m: number): string => (Math.round(Math.max(0, m) / 100) / 10).toFixed(1);
export const metresText = (m: number): string => Math.round(Math.max(0, m)).toLocaleString(locale("en-US"));

/* ───────────── Dropping ───────────── */

const dayShift = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** What a drop does: the ops to add, and how many dragged workouts had to stay where they were. */
export interface DropResult { ops: DraftOp[]; copied: boolean; left: number }

/**
 * Dropping workouts on a day. The one grabbed (`anchor`) lands on `to`; the others keep their distance from it, so
 * a dragged week stays a week. A copy when asked (Option), or when none of them can move (a past plan). A workout
 * that would land before today, or can't go at all, stays and is counted in `left`.
 */
export function dropOnDay(dragged: readonly Editable[], anchor: string, to: string, today: string, askCopy: boolean, key: () => string): DropResult {
  const copied = askCopy || dragged.every((e) => !canMove(e, today));
  const shift = dayShift(anchor, to);
  const ops: DraftOp[] = [];
  let left = 0;
  for (const e of dragged) {
    const dest = shiftDay(e.date, shift);
    if (!canDropOn(dest, today)) { left++; continue; }
    if (copied) { if (canCopy(e)) ops.push({ op: "copy", id: e.id, to: dest, key: key() }); else left++; }
    else if (canMove(e, today)) { if (dest !== e.date) ops.push({ op: "move", id: e.id, to: dest }); }
    else left++;
  }
  return { ops, copied, left };
}

/** Dropping one entry on another links them when one is a recorded activity and the other a plan: [plan, done]. */
export function linkPair<E extends DraftEntry & { pending?: unknown }>(dragged: E, target: E): [plan: E, done: E] | null {
  if (dragged.id === target.id || dragged.pending || target.pending || dragged.status === target.status) return null;
  return dragged.status === "planned" ? [dragged, target] : [target, dragged];
}
