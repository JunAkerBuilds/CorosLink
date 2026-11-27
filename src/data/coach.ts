"use client";
// Coach: the conversation types every card is drawn from, and the browser's side of talking to Coach. A question
// goes to `/api/coach`, which streams the answer back; conversations are kept in the store on this computer
// (the `coach.*` sync collections), so the phone has them too. Coach never writes on its own:
// each card's button does, here, through the same data layer as the other screens, and keeps what Undo needs.
import type { CoachFile } from "@/lib/coach/files";
import type { PlanOp, PlanTarget, PlanUndo } from "@/lib/coach/plan";
import type { PlanDraft, PlanEditOp, PlanEditRow } from "@/lib/coach/plans";
import type { CoachEvent } from "@/lib/coach/loop";
import { plannedBody } from "@/lib/coach/plan";
import { msg, t, tx } from "@/lib/i18n";
import { units } from "@/lib/units";
import { fromSample, fromSynced, NotWiredError, type Loaded } from "./core";
import { hubCalendar, hubDeleteWorkout, hubMoveScheduled, hubRemoveScheduled, hubSaveWorkout, hubScheduleWorkout, hubSession, hubUpdateScheduled, type HubCalendarDay, type HubSport, type HubWorkout } from "./hub";
import { titleFrom } from "./local/coach";
import { planDraftStore, putPlan, savedPlans } from "./local/plans";
import { createStore } from "./local/store";
import { planBrief } from "@/lib/coach/plans";
import { validateTrainingPlan, type TrainingPlanDocument } from "@/lib/plan";
import { applyPlanEdit, planFromDraft } from "@/lib/planEdit";
import { deleteWorkout, savedWorkouts, saveWorkout } from "./local/workouts";
import { SAMPLE_COACH } from "./sample/coach";
import { put, remove, syncView, type SyncView } from "./sync";
import { newEntry } from "./sync/fuel";
import { calendarDayOf, dateToRef, newUuid, refToMs, type CoachConversationBody } from "./sync/native";
import type { SavedWorkout, Workout } from "./workouts";

/** A hue token name: drawn with `var(--h-<name>)`, written with `var(--h-<name>-ink)`. */
export type CoachHue = "mint" | "cyan" | "rose" | "violet" | "blue" | "pink" | "gold" | "orange" | "coral" | "lime" | "honey";

/** One labelled figure. `hue` colours the number. */
export interface CardStat { label: string; value: string; unit?: string; hue?: CoachHue }

/** What every card has: its small coloured line, its title, and the one-line read in the footer. */
interface CardBase {
  id: string;
  eyebrow: string;
  title: string;
  read?: string;
}

/** How a workout went: route, six figures, pace per kilometre with heart rate over it. */
export interface RecapCard extends CardBase {
  kind: "recap";
  activityId: string;
  routePath: string;
  routeLabel: string;
  stats: CardStat[];
  /** One per kilometre, or per mile when `splitUnit` says so. `block` marks the splits the read is about. */
  splits: { seconds: number; block?: boolean }[];
  /** "mi" when the card was drawn in imperial units; absent for kilometres. */
  splitUnit?: "mi";
  /** Evenly spaced samples from start to finish. */
  heartRate: number[];
  /** Seconds per kilometre, whatever the split unit. */
  paceSeconds: number[];
  chartLabel: string;
}

/** Two workouts or two weeks side by side. */
export interface CompareCard extends CardBase {
  kind: "compare";
  before: { label: string; short: string; href: string };
  after: { label: string; short: string; href: string };
  rows: { label: string; before: string; after: string; change: string; better?: boolean }[];
  /** Pace per kilometre in seconds (per mile when `splitUnit` says so), the same splits in both. */
  beforeSeconds: number[];
  afterSeconds: number[];
  splitUnit?: "mi";
  chartLabel: string;
}

/** What is left to eat today, with one meal idea. */
export interface FuelCard extends CardBase {
  kind: "fuel";
  leftKcal: number;
  eatenKcal: number;
  targetKcal: number;
  /** Null when the watch has not counted the day's calories. */
  burnedKcal: number | null;
  macros: { name: string; hue: CoachHue; grams: number; leftGrams: number }[];
  /** A meal idea. With its numbers and day it can be logged; `logged` is set once the athlete did. */
  /** `slot` is the meal's name as shown; `slotId` the meal it is logged under (older cards have only an English `slot`). */
  meal?: { slot: string; slotId?: "breakfast" | "lunch" | "dinner" | "snack"; name: string; detail: string; kcal?: number; proteinG?: number; carbsG?: number; fatG?: number; day?: string; logged?: { entryId: string; at: number } };
}

/** One metric over time, with the day Coach means marked. */
export interface TrendCard extends CardBase {
  kind: "trend";
  unit: string;
  /** One value a night, oldest first. The last is `lastDay`. */
  values: number[];
  /** YYYY-MM-DD of the last value. */
  lastDay: string;
  usual: [number, number];
  /** How many values from the end the marked day is (0 = the last). */
  markBack?: number;
  /** "last 30 nights": the words after the metric in the eyebrow follow the range picked. */
  metric: string;
  href: string;
  hrefLabel: string;
}

/** Recovery, sleep, energy and form in one read. */
export interface TodayCard extends CardBase {
  kind: "today";
  dials: { label: string; value: string; unit?: string; note: string; hue: CoachHue; fraction: number }[];
  /** Left out when the phone has not sent fitness and fatigue. */
  form?: { value: number; note: string; min: number; max: number };
  rows: { label: string; value: string; note?: string }[];
}

export type PlanDayState = "done" | "rest" | "skipped" | "moved-away" | "moved-here" | "planned";

/** Planned against done. */
export interface PlanCheckCard extends CardBase {
  kind: "plancheck";
  days: { label: string; state: PlanDayState; hue?: CoachHue }[];
  daysLabel: string;
  totals: { label: string; done: string; planned: string; fraction: number; hue: CoachHue }[];
  misses: { day: string; name: string; state: "skipped" | "moved"; note: string }[];
}

/** After the athlete says how a workout felt. */
export interface DebriefCard extends CardBase {
  kind: "debrief";
  activityId: string;
  feel: { score: number; of: number; word: string };
  cues: { text: string; hit: boolean }[];
  fuel: string;
  said: string;
}

export interface PlanSession { name: string; hue: CoachHue | "none"; changed?: boolean }

/** Anything that moves, swaps or removes calendar workouts. It waits for an OK. */
export interface PlanCard {
  kind: "plan";
  id: string;
  title: string;
  rows: { day: string; now: PlanSession[]; proposed: PlanSession[]; loadNow: number; loadNext: number }[];
  week: { label: string; before: number; after: number; done: number };
  note: string;
  /** What Apply does, step by step. Cards without it (the sample's) can't be applied. */
  ops?: PlanOp[];
  /** The athlete chose to leave the calendar as it was. */
  kept?: boolean;
  /** Set once applied: when, and what Undo does for each step that went through. */
  applied?: { at: number; undo: PlanUndo[]; steps: number };
}

/** Changes to one of the athlete's saved plans (Library › Plans). It waits for an OK; Undo puts the plan back. */
export interface PlanEditCard {
  kind: "planEdit";
  id: string;
  planId: string;
  planName: string;
  title: string;
  note: string;
  rows: PlanEditRow[];
  load: { before: number; after: number; weeks: number };
  ops: PlanEditOp[];
  kept?: boolean;
  /** Set once applied: when, and whether it went into the open editor (its Undo) or the saved plan. */
  applied?: { at: number; in: "editor" | "saved" };
}

/** A whole new plan Coach built in one answer. Saved to the Library (or opened in the editor) on the athlete's OK. */
export interface PlanDraftCard {
  kind: "planDraft";
  id: string;
  draft: PlanDraft;
  saved?: { planId: string; at: number };
  /** Put in place of the plan open in the editor (one undoable edit there). */
  replaced?: { planId: string; planName: string; at: number };
}

/** Which picture a workout card draws: each sport is read its own way. */
export type WorkoutBodyKind = "strength" | "intervals" | "swim" | "hyrox" | "climb" | "simple";
export type BodyStepKind = "warmup" | "work" | "recovery" | "rest" | "cooldown";

/** One step of a workout in its sport's own words. */
export interface BodyRow {
  kind: BodyStepKind;
  name: string;
  /** "3 × 10", "1.00 km", "8 × 100 m", "4 routes". */
  amount: string;
  /** "60 kg", "4:10 to 4:20 /km", "250–270 W · 88–95 % FTP", "6a+". Empty when the step carries none. */
  target: string;
  /** "1:30 rest" between sets or after a swim repeat. Empty when none. */
  rest: string;
  /** HYROX: the station's number in the session. Climbing: routes to draw as dots. */
  mark?: number;
  /** Swim: this line's share of the longest line's metres, 0 to 1. */
  bar?: number;
}
export interface BodyGroup { repeats: number; rows: BodyRow[] }
/** One block of the interval strip. `weight` is seconds, `height` 0 to 1. */
export interface BodySeg { kind: BodyStepKind; weight: number; height: number }
export interface BodyStrip { repeats: number; amount: string; target: string; segs: BodySeg[] }
export interface BodyShare { name: string; value: string; share: number }
/** A number with its unit, so it never reads as something else: 6 reps, 45 s hold, 82.5 kg. */
export interface BodyNumber { value: string; unit: string }
/** One strength exercise on its own line: sets, what each set is, the weight, and the rest between sets. */
export interface BodyLift {
  /** "rest" is a rest step on its own between exercises: only its rest is shown. */
  kind: "lift" | "rest";
  name: string;
  sets: number;
  /** Reps, a hold, or to the lap button (`value` empty). */
  each: BodyNumber;
  /** The weight; "bodyweight"; null when the workout sets none. */
  load: BodyNumber | "bodyweight" | null;
  /** "2:30"; empty when the workout sets none. */
  rest: string;
  /** Today goes up on the athlete's last logged sets of this exercise: on which number, and by how much ("+2.5"). */
  up?: { on: "load" | "each"; by: string };
}
/** A warm-up or cool-down in a strength workout. */
export interface BodyExtra { name: string; amount: BodyNumber }

/** A workout card's own middle, built from the workout by `workoutBody`. */
export interface WorkoutBody {
  kind: WorkoutBodyKind;
  /** What the list counts, for "Show 7 steps". */
  unit: "steps" | "exercises" | "sets" | "stations";
  count: number;
  /** Every step in order, grouped by repeat. */
  list: BodyGroup[];
  /** Runs, rides and skiing: the blocks to draw. */
  strip?: BodyStrip[];
  /** Strength: muscles by effective sets. Rides: time in power zones. Swims: metres by stroke. */
  shares?: BodyShare[];
  sharesLabel?: string;
  /** The picture in words, for screen readers. */
  label: string;
  /** Strength: the exercises one per line, warm-ups before and cool-downs after, the summary line, the main muscles. */
  lifts?: BodyLift[];
  before?: BodyExtra[];
  after?: BodyExtra[];
  line?: string;
  works?: string[];
}

/** A suggested session, ready for the calendar or the builder. */
export interface WorkoutCard {
  kind: "workout";
  id: string;
  eyebrow: string;
  title: string;
  /** YYYY-MM-DD and the words for it. */
  date: string;
  dayLabel: string;
  stats: CardStat[];
  steps: { name: string; length: string; target: string; note: string; hue: CoachHue; weight: number; height: number; soft?: boolean }[];
  shapeLabel: string;
  summary: string;
  note: string;
  /** The card's colour and its sport's own picture. Absent on cards made before each sport had one. */
  hue?: CoachHue;
  sport?: HubSport;
  body?: WorkoutBody;
  /** The workout itself, in the builder's shape. Absent when only COROS can hold it (and on the sample's cards). */
  workout?: Workout;
  /** Set when the card changes a planned workout instead of adding one: the workout as it was. */
  replaces?: PlanTarget;
  /** Set when the card adds one of the athlete's saved COROS workouts exactly as saved. */
  saved?: { id: string; name: string };
  /** The same workout for the COROS calendar; absent for gym workouts. */
  hub?: HubWorkout;
  totals?: { metres: number; load: number };
  /** Set once added: where it went and what Undo needs. */
  added?: { where: "coros" | "browser"; ref: string; at: number; undo?: PlanUndo };
  /** Set while the athlete has turned the card down ("Not now"). */
  declined?: { at: number };
  /** Set once "Save to library" put it in the COROS workout library. */
  inLibrary?: { id: string; at: number };
}

/** One decision Coach needs before going on. */
export interface QuestionCard {
  kind: "question";
  id: string;
  title: string;
  options: { id: string; title: string; detail: string; recommended?: boolean }[];
  /** What the athlete answered, once sent to Coach. */
  answered?: { text: string; at: number };
}

/** Saved on a planned workout: goal, cues, fuel. */
export interface BriefCard extends CardBase {
  kind: "brief";
  goal: string;
  cues: string[];
  fuel: string;
  saved: string;
  savedNote: string;
  /** The planned workout's day. */
  day?: string;
  /** The saved brief's id, once the athlete saved it. */
  briefId?: string;
}

/** While Coach reads data and builds a card. */
export interface WorkingCard {
  kind: "working";
  id: string;
  title: string;
  steps: { text: string; done: boolean }[];
}

/** When the data for a card isn't available. */
export interface FailedCard {
  kind: "failed";
  id: string;
  title: string;
  text: string;
  tried: string;
}

/** A small line in the thread, not a card: what Coach saved or read. */
export interface NoteLine {
  kind: "note";
  id: string;
  note: "remembered" | "read";
  text: string;
  /** The athlete had Coach forget it. */
  forgotten?: boolean;
}

export type CoachCard =
  | RecapCard | CompareCard | FuelCard | TrendCard | TodayCard | PlanCheckCard | DebriefCard
  | PlanCard | PlanEditCard | PlanDraftCard | WorkoutCard | QuestionCard | BriefCard | WorkingCard | FailedCard;

export type CoachBlock = { kind: "text"; text: string } | CoachCard | NoteLine;

export type CoachMessage =
  | { id: string; from: "you"; text: string; /** Names of the files sent with it; the files themselves aren't kept. */ files?: string[] }
  | { id: string; from: "coach"; blocks: CoachBlock[] };

export interface CoachSource {
  title: string;
  detail: string;
  href: string;
}

export interface Conversation {
  id: string;
  title: string;
  group: "Today" | "This week" | "Earlier";
  stamp: string;
  messages: CoachMessage[];
  /** Follow-up questions offered under the thread. */
  suggestions: string[];
  /** "Used in this answer". */
  sources: CoachSource[];
}

export interface CoachData {
  conversations: Conversation[];
  /** "What Coach is looking at". */
  looking: { label: string; value: string }[];
  /** Null when signed in: the goal race is not synced to the web. */
  goal: { title: string; detail: string } | null;
  /** Coach's level and the look the next streak earns. Null when signed in: it lives on the phone. */
  level: { number: number; fraction: number; line: string; next: string } | null;
}

/* ───────────── Loading ───────────── */

const MONTHS = [msg("Jan"), msg("Feb"), msg("Mar"), msg("Apr"), msg("May"), msg("Jun"), msg("Jul"), msg("Aug"), msg("Sep"), msg("Oct"), msg("Nov"), msg("Dec")];
const two = (n: number) => String(n).padStart(2, "0");
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** 09:21 for today, else 19 Nov. */
export function stampOf(ms: number, now: Date): string {
  const d = new Date(ms);
  return startOfDay(d) === startOfDay(now) ? `${two(d.getHours())}:${two(d.getMinutes())}` : t("{day} {month}", { day: d.getDate(), month: tx("month", MONTHS[d.getMonth()]) });
}

export function groupOf(ms: number, now: Date): Conversation["group"] {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(ms))) / 86_400_000);
  return days <= 0 ? msg("Today") : days < 7 ? msg("This week") : msg("Earlier");
}

/** A conversation group's name for the screen. The group itself stays English: it is compared. */
export const groupName = (group: Conversation["group"]): string => t(group);

/** The id of a message's item: its conversation and its place in it. */
export const messageItemId = (conversationId: string, n: number): string => `${conversationId}.${String(n).padStart(4, "0")}`;

const isMessage = (m: unknown): m is CoachMessage => {
  const v = m as { id?: unknown; from?: unknown; text?: unknown; blocks?: unknown } | null;
  return !!v && typeof v.id === "string" && ((v.from === "you" && typeof v.text === "string") || (v.from === "coach" && Array.isArray(v.blocks)));
};

interface Item<B> { id: string; body: B }
type MessageItem = Item<{ conversationId: string; n: number; at: number; message: unknown }>;

/** Conversations from their synced items, newest first. Pure. A conversation with no readable message is left out. */
export function conversationsFrom(conversations: readonly Item<CoachConversationBody>[], messages: readonly MessageItem[], now: Date): Conversation[] {
  const byConversation = new Map<string, MessageItem[]>();
  for (const m of messages) {
    if (!m.body || typeof m.body.conversationId !== "string" || !isMessage(m.body.message)) continue;
    byConversation.set(m.body.conversationId, [...(byConversation.get(m.body.conversationId) ?? []), m]);
  }
  return [...conversations]
    .filter((c) => c.body && typeof c.body.title === "string" && byConversation.has(c.id))
    .sort((a, b) => (b.body.updatedAt ?? 0) - (a.body.updatedAt ?? 0))
    .map((c) => {
      const at = refToMs(c.body.updatedAt ?? c.body.startedAt ?? 0);
      return {
        id: c.id, title: c.body.title, group: groupOf(at, now), stamp: stampOf(at, now),
        messages: byConversation.get(c.id)!.sort((a, b) => a.body.n - b.body.n).map((m) => m.body.message as CoachMessage),
        suggestions: Array.isArray(c.body.suggestions) ? c.body.suggestions.filter((s) => typeof s === "string") : [],
        sources: Array.isArray(c.body.sources) ? c.body.sources : [],
      };
    });
}

function lookingAt(view: SyncView): CoachData["looking"] {
  const out: CoachData["looking"] = [];
  const activities = view.all("activity").length, nights = view.all("health.night").length, gym = view.all("gym.workout").length, foods = view.all("fuel.entry").length;
  if (activities) out.push({ label: t("Activities"), value: String(activities) });
  const f = view.get("view.training", "me")?.fitness;
  if (f?.fitness?.length && f.fatigue?.length === f.fitness.length) {
    const fit = f.fitness[f.fitness.length - 1], fat = f.fatigue[f.fatigue.length - 1], form = Math.round((fit - fat) * 10) / 10;
    out.push({ label: t("Fitness / fatigue / form"), value: `${fit} / ${fat} / ${form < 0 ? `−${Math.abs(form)}` : `+${form}`}` });
  }
  if (nights) out.push({ label: t("Nights of sleep"), value: String(nights) });
  if (gym) out.push({ label: t("Gym workouts"), value: String(gym) });
  if (foods) out.push({ label: t("Foods logged"), value: String(foods) });
  const memory = view.all("coach.memory").length;
  if (memory) out.push({ label: t("Remembered"), value: String(memory) });
  return out;
}

/** Signed in: the person's own conversations and what Coach can read. Signed out: the sample. */
export async function loadCoach(): Promise<Loaded<CoachData>> {
  const view = await syncView();
  if (!view) return fromSample(SAMPLE_COACH);
  return fromSynced({
    conversations: conversationsFrom(view.all("coach.conversation"), view.all("coach.message"), new Date()),
    looking: lookingAt(view), goal: null, level: null,
  });
}

/* ───────────── The AI ───────────── */

/** Which AI answers: the athlete's own pick in Coach settings, the scripted dev model, or none yet. */
export interface CoachAccessInfo { key: "own" | "mock" | "none"; model: string }

export class CoachError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CoachError";
  }
}

async function api<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    throw new CoachError("unreachable", t("C-LINK couldn't be reached. Try again."));
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (response.ok && payload) return payload;
  throw new CoachError(payload?.error?.code ?? `http_${response.status}`, payload?.error?.message ?? t("Coach couldn't do that."));
}

export const loadCoachAccess = (): Promise<CoachAccessInfo> => api<CoachAccessInfo>("/api/coach/key");

/* ───────────── Asking ───────────── */

async function signedIn(): Promise<SyncView> {
  const view = await syncView();
  if (!view) throw new NotWiredError("coach", t("Coach reads your own data, which isn't open yet. Try again in a moment."));
  return view;
}

function stored(view: SyncView, conversationId: string): { itemId: string; n: number; message: CoachMessage }[] {
  return view.all("coach.message")
    .filter((i) => i.body?.conversationId === conversationId && isMessage(i.body.message))
    .map((i) => ({ itemId: i.id, n: i.body.n, message: i.body.message as CoachMessage }))
    .sort((a, b) => a.n - b.n);
}

const dayKeyOf = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** The COROS calendar around today, when Training Hub is connected in this browser; null otherwise. */
async function hubDays(): Promise<HubCalendarDay[] | null> {
  const session = await hubSession().catch(() => null);
  if (session?.state !== "signedIn") return null;
  const now = new Date(), at = (n: number) => dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  try { return (await hubCalendar(at(-14), at(45))).data; } catch { return null; }
}

/** Starts a conversation. Nothing is saved until its first message. */
export const newConversationId = (): string => newUuid();

export interface AskOptions {
  /** Called for each streamed event: words, the working card, cards as they are built. */
  onEvent?: (event: CoachEvent) => void;
  signal?: AbortSignal;
  /** Ask the last question again instead of sending `text` as a new one. */
  retry?: boolean;
  /** Photos, PDFs and text files for this question. They go to Coach once; only their names are saved. */
  files?: CoachFile[];
  /** The page asked from (the side Coach): what it is and what it shows. Sent with the question, never saved. */
  page?: { title: string; text: string };
  /** The plan open in the plan editor, as it stands (unsaved edits too): Coach reads and edits this one. */
  openPlan?: TrainingPlanDocument;
}

/** A message as sent back to Coach: a whole plan Coach built goes back as one line, not every workout. */
function lightForHistory(m: CoachMessage): CoachMessage {
  if (m.from !== "coach" || !m.blocks.some((b) => b.kind === "planDraft")) return m;
  return { ...m, blocks: m.blocks.map((b) => (b.kind === "planDraft"
    ? { kind: "note" as const, id: b.id, note: "read" as const, text: `Built a new plan “${b.draft.name}”: ${b.draft.weeks} weeks, ${b.draft.workouts.length} workouts from ${b.draft.start}; ${b.saved ? `the athlete saved it to their Library (${b.saved.planId})` : "not saved yet"}` }
    : b)) };
}

/** The athlete's saved plans in short form for Coach, the open one as it stands. */
function plansForCoach(open?: TrainingPlanDocument) {
  const saved = savedPlans().filter((p) => p.id !== open?.id);
  return [...(open ? [planBrief(open, true)] : []), ...saved.slice(0, 19).map((p) => planBrief(p))];
}

const paragraphs = (text: string): CoachBlock[] => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({ kind: "text" as const, text: p }));

/**
 * Sends a question and resolves to Coach's reply once it is saved. The question is saved first, so it survives a
 * lost connection. A model failure is saved as a "couldn't answer" card in the thread; only what stops the
 * question being asked at all (no AI key, too many questions, signed out) is thrown, as `CoachError`.
 */
export async function sendToCoach(conversationId: string, text: string, options: AskOptions = {}): Promise<CoachMessage> {
  const view = await signedIn();
  let thread = stored(view, conversationId);
  let question = text.trim();
  if (options.retry) {
    const lastYou = thread.map((m) => m.message.from).lastIndexOf("you");
    if (lastYou < 0) throw new CoachError("nothing_to_retry", t("There is no question to ask again."));
    for (const m of thread.slice(lastYou + 1)) remove("coach.message", m.itemId);
    const asked = thread[lastYou].message;
    question = asked.from === "you" ? asked.text : "";
    thread = thread.slice(0, lastYou);
  }
  const files = options.retry ? [] : options.files ?? [];
  if (!question && files.length) question = files.length === 1 ? t("What do you make of this file?") : t("What do you make of these files?");
  if (!question) throw new CoachError("empty", t("Type a question for Coach."));
  const had = view.get("coach.conversation", conversationId), now = Date.now();
  const conversation: CoachConversationBody = { title: had?.title ?? titleFrom(question), startedAt: had?.startedAt ?? dateToRef(new Date(now)), updatedAt: dateToRef(new Date(now)), suggestions: [], sources: [] };
  let n = thread.length ? thread[thread.length - 1].n + 1 : 0;
  put("coach.conversation", conversationId, conversation);
  put("coach.message", messageItemId(conversationId, n), { conversationId, n, at: dateToRef(new Date(now)), message: { id: newUuid(), from: "you", text: question, ...(files.length ? { files: files.map((f) => f.name) } : {}) } });
  n += 1;

  const save = (blocks: CoachBlock[], extra: Partial<CoachConversationBody> = {}): CoachMessage => {
    const reply: CoachMessage = { id: newUuid(), from: "coach", blocks };
    const at = dateToRef(new Date());
    put("coach.message", messageItemId(conversationId, n), { conversationId, n, at, message: reply });
    put("coach.conversation", conversationId, { ...conversation, updatedAt: at, ...extra });
    for (const b of blocks) if (b.kind === "note" && b.note === "remembered") put("coach.memory", b.id, { text: b.text, at });
    return reply;
  };
  const failed = (message: string): CoachBlock => ({ kind: "failed", id: newUuid(), title: t("Coach couldn't answer"), text: message, tried: "" });

  let response: Response;
  try {
    response = await fetch("/api/coach", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: options.signal,
      headers: { Accept: "application/x-ndjson", "Content-Type": "application/json", "X-Clink-Hub": "1" },
      body: JSON.stringify({
        text: question, files, history: thread.map((m) => lightForHistory(m.message)), ...(options.page ? { page: options.page } : {}), plans: plansForCoach(options.openPlan), offsetMin: new Date().getTimezoneOffset(), units: units(), hubDays: await hubDays(),
        browserWorkouts: savedWorkouts().map((w) => ({ id: w.id, name: w.name, sport: w.sport, date: w.date, summary: w.summary, items: w.items })),
      }),
    });
  } catch {
    if (options.signal?.aborted) return save([{ kind: "note", id: newUuid(), note: "read", text: t("Stopped before Coach answered.") }]);
    return save([failed(t("Coach couldn't be reached. Check your connection and try again."))]);
  }
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const code = payload?.error?.code ?? `http_${response.status}`, message = payload?.error?.message ?? t("Coach couldn't answer.");
    if (code === "no_key" || code === "signed_out") throw new CoachError(code, message);
    return save([failed(message)]);
  }

  const reader = response.body.getReader(), decoder = new TextDecoder();
  const blocks: CoachBlock[] = [];
  let words = "", buffer = "", done: Extract<CoachEvent, { t: "done" }> | null = null, problem: string | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    let event: CoachEvent;
    try { event = JSON.parse(line) as CoachEvent; } catch { return; }
    if (event.t === "text") words += event.delta;
    else if (event.t === "reset") words = "";
    else if (event.t === "block") {
      const b = event.block, at = b.kind === "text" ? -1 : blocks.findIndex((x) => x.kind !== "text" && x.id === b.id);
      if (at >= 0) blocks[at] = b; else { blocks.push(...paragraphs(words), b); words = ""; }
    }
    else if (event.t === "done") done = event;
    else if (event.t === "error") problem = event.message;
    options.onEvent?.(event);
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(take);
    }
    take(buffer);
  } catch {
    if (!options.signal?.aborted) problem ??= t("The connection dropped before Coach finished.");
  }
  const finished = done as Extract<CoachEvent, { t: "done" }> | null;
  if (finished) {
    const reply = save(finished.blocks, { suggestions: finished.suggestions, sources: finished.sources });
    if (!had) void nameConversation(conversationId, conversation.title, question, finished.blocks);
    return reply;
  }
  const partial = [...blocks, ...paragraphs(words)];
  if (options.signal?.aborted) return save([...partial, { kind: "note", id: newUuid(), note: "read", text: t("Stopped before Coach finished.") }]);
  return save([...partial, failed(problem ?? t("Coach stopped before finishing."))]);
}

/**
 * A new conversation's title, written by the AI from its first exchange. Quiet when it can't (no AI set up, offline),
 * and kept only while the title is still the one made from the question: a title changed meanwhile stands.
 */
async function nameConversation(conversationId: string, madeFrom: string, question: string, blocks: readonly CoachBlock[]): Promise<void> {
  try {
    const answer = blocks.map((b) => (b.kind === "text" ? b.text : "title" in b ? b.title : "")).filter(Boolean).join("\n\n");
    const response = await fetch("/api/ai/title", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" }, body: JSON.stringify({ question, answer }),
    });
    const title = response.ok ? ((await response.json()) as { title?: unknown }).title : null;
    if (typeof title !== "string" || !title) return;
    const view = await signedIn();
    const now = view.get("coach.conversation", conversationId);
    if (now && now.title === madeFrom) put("coach.conversation", conversationId, { ...now, title });
  } catch {
    // The title made from the question stays.
  }
}

/** Removes a conversation and its messages from the account. */
export async function deleteConversation(conversationId: string): Promise<void> {
  const view = await signedIn();
  for (const m of stored(view, conversationId)) remove("coach.message", m.itemId);
  remove("coach.conversation", conversationId);
}

/* ───────────── Card actions: the only places Coach's suggestions are written ───────────── */

const SAMPLE_CARD = msg("This is a sample card. Coach works on your own data.");

/** Rewrites one block of a saved conversation (a card's state after its button was pressed). */
/* A card's latest state, published the moment a button changes it, so every copy of the conversation on screen
   (the Coach page, the side Coach) shows it at once and a button can't be pressed twice. */
const patched = new Map<string, CoachBlock>();
const patchListeners = new Set<(block: CoachBlock) => void>();
export function onCardChanged(listener: (block: CoachBlock) => void): () => void { patchListeners.add(listener); return () => { patchListeners.delete(listener); }; }
/** The card as it is now: its latest published state when a button changed it in this window. */
export function latestCard<B extends CoachBlock>(block: B): B {
  return (block.kind === "text" ? block : (patched.get(block.id) as B | undefined) ?? block);
}
function publish(block: CoachBlock): void {
  if (block.kind === "text") return;
  patched.set(block.id, block);
  patchListeners.forEach((l) => l(block));
}

async function updateBlock(conversationId: string, blockId: string, change: (block: CoachBlock) => CoachBlock): Promise<void> {
  const view = await signedIn();
  for (const m of stored(view, conversationId)) {
    if (m.message.from !== "coach" || !m.message.blocks.some((b) => b.kind !== "text" && b.id === blockId)) continue;
    const message: CoachMessage = { ...m.message, blocks: m.message.blocks.map((b) => (b.kind !== "text" && b.id === blockId ? change(latestCard(b)) : b)) };
    put("coach.message", m.itemId, { conversationId, n: m.n, at: dateToRef(new Date()), message });
    const next = message.blocks.find((b) => b.kind !== "text" && b.id === blockId);
    if (next) publish(next);
    return;
  }
  throw new Error(t("This card's conversation is not in your account any more."));
}

const hubConnected = async (): Promise<boolean> => (await hubSession().catch(() => null))?.state === "signedIn";

const NEEDS_HUB = msg("This workout has steps only COROS can hold. Connect COROS Training Hub on the Connections page, then add it.");

/**
 * Puts a workout on a day: on the COROS calendar when Training Hub is connected and COROS can hold it, otherwise
 * in this browser's calendar, as the builder does. Resolves to where it went and what takes it back.
 */
async function placeWorkout(day: string, w: { workout: Workout | null | undefined; hub: HubWorkout | null | undefined; detail: string; metres?: number; load?: number }): Promise<{ where: "coros" | "browser"; ref: string; undo: PlanUndo }> {
  if (w.hub && (await hubConnected())) {
    const idInPlan = (await hubScheduleWorkout(day, w.hub)).data;
    return { where: "coros", ref: idInPlan, undo: { undo: "coros_remove", day, idInPlan, name: w.hub.name } };
  }
  if (!w.workout) throw new Error(t(NEEDS_HUB));
  const saved: SavedWorkout = { ...w.workout, date: day, summary: { detail: w.detail, metres: w.metres ?? 0, load: w.load ?? 0 }, savedAt: new Date().toISOString() };
  saveWorkout(saved);
  return { where: "browser", ref: saved.id, undo: { undo: "browser_delete", workoutId: saved.id } };
}

/** Replaces a planned workout's steps and name with the card's, where it already is. */
async function changeWorkout(card: WorkoutCard, was: PlanTarget): Promise<{ where: "coros" | "browser"; ref: string; undo: PlanUndo }> {
  if (was.coros) {
    if (!card.hub || !was.coros.workout) throw new Error(t("“{name}” can't be rewritten on COROS from here.", { name: was.name }));
    if (!(await hubConnected())) throw new Error(t("Connect COROS Training Hub on the Connections page to change the COROS calendar."));
    const where = { day: was.date, idInPlan: was.coros.idInPlan, name: was.coros.name };
    await hubUpdateScheduled(where, card.hub);
    return { where: "coros", ref: was.coros.idInPlan, undo: { undo: "coros_update", day: was.date, idInPlan: was.coros.idInPlan, name: card.hub.name, workout: was.coros.workout } };
  }
  if (was.browser) {
    const saved = savedWorkouts().find((w) => w.id === was.browser!.workoutId);
    if (!saved) throw new Error(t("“{name}” is not saved on this computer any more.", { name: was.name }));
    if (!card.workout) throw new Error(t(NEEDS_HUB));
    saveWorkout({ ...card.workout, id: saved.id, date: saved.date, repeatWeeks: saved.repeatWeeks, summary: { detail: card.summary, metres: card.totals?.metres ?? 0, load: card.totals?.load ?? 0 }, savedAt: new Date().toISOString() });
    return { where: "browser", ref: saved.id, undo: { undo: "browser_restore", saved } };
  }
  throw new Error(t("“{name}” can't be changed from here.", { name: was.name }));
}

/**
 * Does what a workout card proposes: adds the workout to its day, or (a change card) rewrites the planned workout
 * it names. What Undo needs is kept on the card.
 */
export async function addCoachWorkout(conversationId: string, card: WorkoutCard): Promise<void> {
  if (!card.workout && !card.hub) throw new NotWiredError("coach.workout", t(SAMPLE_CARD));
  if (card.added) return;
  const done = card.replaces ? await changeWorkout(card, card.replaces) : await placeWorkout(card.date, { workout: card.workout, hub: card.hub, detail: card.summary, metres: card.totals?.metres, load: card.totals?.load });
  const added: NonNullable<WorkoutCard["added"]> = { ...done, at: Date.now() };
  await updateBlock(conversationId, card.id, (b) => (b.kind === "workout" ? { ...b, added } : b));
}

/** "Not now" on a workout card, and back. Nothing is saved anywhere but the card. */
export async function declineCoachWorkout(conversationId: string, card: WorkoutCard, declined: boolean): Promise<void> {
  if (!card.workout && !card.hub) throw new NotWiredError("coach.workout", t(SAMPLE_CARD));
  await updateBlock(conversationId, card.id, (b) => {
    if (b.kind !== "workout") return b;
    if (declined) return { ...b, declined: { at: Date.now() } };
    const { declined: _gone, ...rest } = b; void _gone; return rest;
  });
}

/** Takes back what the card did: the added workout comes off, the changed one goes back to how it was. */
export async function undoCoachWorkout(conversationId: string, card: WorkoutCard): Promise<void> {
  if (!card.added) return;
  if (card.added.undo) await undoOp(card.added.undo);
  else if (card.added.where === "coros") await hubRemoveScheduled({ day: card.date, idInPlan: card.added.ref, name: card.hub?.name ?? card.title });
  else deleteWorkout(card.added.ref);
  await updateBlock(conversationId, card.id, (b) => { if (b.kind !== "workout") return b; const { added: _gone, ...rest } = b; void _gone; return rest; });
}

/** Saves the card's workout to the COROS workout library, without putting it on a day. */
export async function saveCoachWorkoutToLibrary(conversationId: string, card: WorkoutCard): Promise<void> {
  if (!card.hub) throw new Error(t("Only workouts COROS can hold go in the COROS workout library."));
  if (card.inLibrary) return;
  if (!(await hubConnected())) throw new Error(t("Connect COROS Training Hub on the Connections page to save to your COROS workout library."));
  const saved = (await hubSaveWorkout(card.hub)).data;
  await updateBlock(conversationId, card.id, (b) => (b.kind === "workout" ? { ...b, inLibrary: { id: saved.id, at: Date.now() } } : b));
}

export async function removeCoachWorkoutFromLibrary(conversationId: string, card: WorkoutCard): Promise<void> {
  if (!card.inLibrary) return;
  await hubDeleteWorkout(card.inLibrary.id);
  await updateBlock(conversationId, card.id, (b) => { if (b.kind !== "workout") return b; const { inLibrary: _gone, ...rest } = b; void _gone; return rest; });
}

async function applyOp(op: PlanOp): Promise<PlanUndo> {
  if (op.op === "add_routine") {
    put("gym.planned", op.plannedId, plannedBody(op.plannedId, op.routineId, op.day));
    return { undo: "gym_remove", plannedId: op.plannedId };
  }
  if (op.op === "add_workout") return (await placeWorkout(op.day, { workout: op.workout, hub: op.hub, detail: op.detail, load: op.load })).undo;
  const e = op.entry;
  if (e.source === "coros" && e.coros) {
    if (!(await hubConnected())) throw new Error(t("Connect COROS Training Hub on the Connections page to change the COROS calendar."));
    const where = { day: e.date, idInPlan: e.coros.idInPlan, name: e.coros.name };
    if (op.op === "move") return { undo: "coros_move", name: e.coros.name, day: op.to, idInPlan: (await hubMoveScheduled(where, op.to)).data, to: e.date };
    await hubRemoveScheduled(where);
    return e.coros.workout ? { undo: "coros_add", day: e.date, workout: e.coros.workout } : { undo: "none", why: t("“{name}” has steps this app can't write, so it can't be put back from here.", { name: e.name }) };
  }
  if (e.source === "browser" && e.browser) {
    const saved = savedWorkouts().find((w) => w.id === e.browser!.workoutId);
    if (!saved) throw new Error(t("“{name}” is not saved on this computer any more.", { name: e.name }));
    if (op.op === "move") { saveWorkout({ ...saved, date: op.to }); return { undo: "browser_put", workoutId: saved.id, date: e.date }; }
    deleteWorkout(saved.id);
    return { undo: "browser_restore", saved };
  }
  if (e.source === "synced" && e.planned) {
    if (op.op === "move") put("gym.planned", e.planned.id, { ...e.planned, day: calendarDayOf(op.to) });
    else remove("gym.planned", e.planned.id);
    return { undo: "gym_put", planned: e.planned };
  }
  throw new Error(t("“{name}” can't be changed from here.", { name: e.name }));
}

async function undoOp(step: PlanUndo): Promise<void> {
  switch (step.undo) {
    case "coros_move": await hubMoveScheduled({ day: step.day, idInPlan: step.idInPlan, name: step.name }, step.to); return;
    case "coros_add": await hubScheduleWorkout(step.day, step.workout); return;
    case "coros_remove": await hubRemoveScheduled({ day: step.day, idInPlan: step.idInPlan, name: step.name }); return;
    case "coros_update": await hubUpdateScheduled({ day: step.day, idInPlan: step.idInPlan, name: step.name }, step.workout); return;
    case "browser_delete": deleteWorkout(step.workoutId); return;
    case "browser_put": { const saved = savedWorkouts().find((w) => w.id === step.workoutId); if (saved) saveWorkout({ ...saved, date: step.date }); return; }
    case "browser_restore": saveWorkout(step.saved as SavedWorkout); return;
    case "gym_put": put("gym.planned", step.planned.id, step.planned); return;
    case "gym_remove": remove("gym.planned", step.plannedId); return;
    case "none": throw new Error(step.why);
  }
}

/**
 * Writes Coach's proposed plan change to the calendar, one step at a time. When a step fails, the steps that went
 * through are kept on the card (so Undo takes them back) and the failure is thrown.
 */
export async function applyPlanChange(conversationId: string, card: PlanCard): Promise<void> {
  if (!card.ops) throw new NotWiredError("coach.apply", t(SAMPLE_CARD));
  if (card.applied) return;
  const undo: PlanUndo[] = [];
  let problem: Error | null = null;
  for (const op of card.ops) {
    try { undo.push(await applyOp(op)); } catch (e) { problem = e instanceof Error ? e : new Error(String(e)); break; }
  }
  if (undo.length) await updateBlock(conversationId, card.id, (b) => (b.kind === "plan" ? { ...b, kept: false, applied: { at: Date.now(), undo, steps: undo.length } } : b));
  if (problem) throw new Error(undo.length ? t("{done} of {all} changes were made, then: {problem}", { done: undo.length, all: card.ops.length, problem: problem.message }) : problem.message);
}

/** Takes an applied plan change back, last step first. */
export async function undoPlanChange(conversationId: string, card: PlanCard): Promise<void> {
  if (!card.applied) return;
  const left = [...card.applied.undo];
  try {
    while (left.length) { await undoOp(left[left.length - 1]); left.pop(); }
  } finally {
    await updateBlock(conversationId, card.id, (b) => {
      if (b.kind !== "plan") return b;
      const { applied, ...rest } = b;
      return left.length && applied ? { ...rest, applied: { ...applied, undo: left } } : rest;
    });
  }
}

/* ───────────── Saved plans ───────────── */

/** What Undo needs for a plan edit applied to a saved plan: the plan as it was, by card. */
const planUndoStore = createStore<Record<string, TrainingPlanDocument>>("coach.plan-undo.v1", {});
const nextStep = () => newUuid().slice(0, 8);

/** The plan editor, when the plan a card names is open in it: Apply goes through its own undo history. */
export interface OpenPlanEditor { plan: TrainingPlanDocument; apply: (next: TrainingPlanDocument, message: string) => void; undo: () => void }

/** Applies Coach's plan edit: to the open editor when that plan is open, else to the saved plan. */
export async function applyCoachPlanEdit(conversationId: string, card: PlanEditCard, editor: OpenPlanEditor | null): Promise<void> {
  if (card.applied) return;
  if (editor && editor.plan.id === card.planId) {
    editor.apply(applyPlanEdit(editor.plan, card.ops, nextStep), t("Coach: {title}", { title: card.title }));
    await updateBlock(conversationId, card.id, (b) => (b.kind === "planEdit" ? { ...b, kept: false, applied: { at: Date.now(), in: "editor" } } : b));
    return;
  }
  const plan = savedPlans().find((p) => p.id === card.planId);
  if (!plan) throw new Error(t("“{name}” isn't saved in this app any more.", { name: card.planName }));
  const next = applyPlanEdit(plan, card.ops, nextStep);
  const problem = validateTrainingPlan(next).find((i) => i.severity === "error");
  if (problem) throw new Error(problem.message);
  planUndoStore.set({ ...planUndoStore.get(), [card.id]: plan });
  putPlan({ ...next, updatedAt: new Date().toISOString(), syncState: "local" });
  await updateBlock(conversationId, card.id, (b) => (b.kind === "planEdit" ? { ...b, kept: false, applied: { at: Date.now(), in: "saved" } } : b));
}

/** Puts the plan back as it was before the card was applied. */
export async function undoCoachPlanEdit(conversationId: string, card: PlanEditCard, editor: OpenPlanEditor | null): Promise<void> {
  if (!card.applied) return;
  if (card.applied.in === "editor") {
    if (!editor || editor.plan.id !== card.planId) throw new Error(t("Open “{name}” in the plan editor to undo this there, or use its Undo button.", { name: card.planName }));
    editor.undo();
  } else {
    const was = planUndoStore.get()[card.id];
    if (!was) throw new Error(t("This change was made on another device or too long ago to undo here."));
    putPlan(was);
    const { [card.id]: _gone, ...rest } = planUndoStore.get(); void _gone;
    planUndoStore.set(rest);
  }
  await updateBlock(conversationId, card.id, (b) => { if (b.kind !== "planEdit") return b; const { applied: _a, ...r } = b; void _a; return r; });
}

export async function keepCoachPlanEdit(conversationId: string, card: PlanEditCard, kept: boolean): Promise<void> {
  await updateBlock(conversationId, card.id, (b) => (b.kind === "planEdit" ? { ...b, kept } : b));
}

/** Saves the plan Coach built to the Library. Resolves to the saved plan's id. */
export async function saveCoachPlanDraft(conversationId: string, card: PlanDraftCard): Promise<string> {
  if (card.saved) return card.saved.planId;
  const plan = planFromDraft(card.draft, nextStep);
  const problem = validateTrainingPlan(plan).find((i) => i.severity === "error");
  if (problem) throw new Error(problem.message);
  putPlan({ ...plan, syncState: "local", updatedAt: new Date().toISOString() });
  await updateBlock(conversationId, card.id, (b) => (b.kind === "planDraft" ? { ...b, saved: { planId: plan.id, at: Date.now() } } : b));
  return plan.id;
}

/** Puts the plan Coach built in place of the plan open in the editor: same plan (id, calendar), Coach's weeks. */
export async function replaceOpenPlanWithDraft(conversationId: string, card: PlanDraftCard, editor: OpenPlanEditor): Promise<void> {
  if (card.replaced || card.saved) return;
  const made = planFromDraft(card.draft, nextStep);
  const was = editor.plan;
  editor.apply({ ...was, name: made.name, goal: made.goal || was.goal, description: made.description, startDate: made.startDate, weekCount: made.weekCount, entries: made.entries, phases: made.phases, sportMix: made.sportMix }, t("Coach's plan: {name}", { name: made.name }));
  await updateBlock(conversationId, card.id, (b) => (b.kind === "planDraft" ? { ...b, replaced: { planId: was.id, planName: was.name, at: Date.now() } } : b));
}

/** Takes a replace back through the editor's own undo. */
export async function undoReplaceOpenPlan(conversationId: string, card: PlanDraftCard, editor: OpenPlanEditor | null): Promise<void> {
  if (!card.replaced) return;
  if (!editor || editor.plan.id !== card.replaced.planId) throw new Error(t("Open “{name}” in the plan editor to undo this, or use its Undo button.", { name: card.replaced.planName }));
  editor.undo();
  await updateBlock(conversationId, card.id, (b) => { if (b.kind !== "planDraft") return b; const { replaced: _r, ...rest } = b; void _r; return rest; });
}

/** Opens the plan Coach built in the plan editor, unsaved (the editor's draft). */
export function openCoachPlanDraft(card: PlanDraftCard): string {
  if (card.saved) return `/calendar/plans/edit?id=${encodeURIComponent(card.saved.planId)}`;
  planDraftStore.set({ plan: planFromDraft(card.draft, nextStep), differences: [] });
  return "/calendar/plans/edit?draft=1";
}

/** "Keep as is" and "Review again". */
export async function keepPlan(conversationId: string, card: PlanCard, kept: boolean): Promise<void> {
  if (!card.ops) throw new NotWiredError("coach.apply", t(SAMPLE_CARD));
  await updateBlock(conversationId, card.id, (b) => (b.kind === "plan" ? { ...b, kept } : b));
}

/** Logs the meal Coach suggested in Fuel, on the day and meal the card names. */
export async function logCoachMeal(conversationId: string, card: FuelCard): Promise<void> {
  const m = card.meal;
  if (!m || m.kcal == null || !m.day) throw new NotWiredError("coach.meal", t(SAMPLE_CARD));
  if (m.logged) return;
  await signedIn();
  const meal = m.slotId ?? (m.slot.toLowerCase() as "breakfast" | "lunch" | "dinner" | "snack");
  const per = { kcal: m.kcal, protein: m.proteinG ?? 0, carbs: m.carbsG ?? 0, fat: m.fatG ?? 0, fiber: 0, sugar: 0, satFat: 0, sodium: 0, cholesterol: 0 };
  const made = newEntry({ id: newUuid(), itemId: newUuid(), day: m.day, meal, food: { id: "", name: m.name, unit: "serving", amount: 1, per }, origin: { from: "own" }, now: new Date() });
  put("fuel.entry", made.entry.id, made.entry);
  await updateBlock(conversationId, card.id, (b) => (b.kind === "fuel" && b.meal ? { ...b, meal: { ...b.meal, logged: { entryId: made.entry.id, at: Date.now() } } } : b));
}

export async function undoCoachMeal(conversationId: string, card: FuelCard): Promise<void> {
  const logged = card.meal?.logged;
  if (!logged) return;
  await signedIn();
  remove("fuel.entry", logged.entryId);
  await updateBlock(conversationId, card.id, (b) => { if (b.kind !== "fuel" || !b.meal) return b; const { logged: _gone, ...meal } = b.meal; void _gone; return { ...b, meal }; });
}

/** Saves a brief Coach wrote, or removes a saved one. */
export async function saveCoachBrief(conversationId: string, card: BriefCard): Promise<void> {
  if (!card.day) throw new NotWiredError("coach.brief", t(SAMPLE_CARD));
  await signedIn();
  const at = new Date();
  put("coach.brief", card.id, { title: card.title, day: card.day, goal: card.goal, cues: card.cues, fuel: card.fuel, at: dateToRef(at) });
  await updateBlock(conversationId, card.id, (b) => (b.kind === "brief" ? { ...b, briefId: card.id, saved: t("Saved"), savedNote: t("On this computer · {time}", { time: stampOf(at.getTime(), at) }) } : b));
}

export async function removeCoachBrief(conversationId: string, card: BriefCard): Promise<void> {
  if (!card.briefId) return;
  await signedIn();
  remove("coach.brief", card.briefId);
  await updateBlock(conversationId, card.id, (b) => { if (b.kind !== "brief") return b; const { briefId: _gone, ...rest } = b; void _gone; return { ...rest, saved: "", savedNote: "" }; });
}

/** Has Coach forget something it was told to remember. */
export async function forgetFact(conversationId: string, line: NoteLine): Promise<void> {
  const view = await signedIn();
  if (!view.get("coach.memory", line.id) && !line.id.includes("-")) throw new NotWiredError("coach.forget", t(SAMPLE_CARD));
  remove("coach.memory", line.id);
  await updateBlock(conversationId, line.id, (b) => (b.kind === "note" ? { ...b, forgotten: true } : b));
}

/* ───────────── Memory: what Coach remembers between conversations ───────────── */

export interface CoachFact { id: string; text: string; at: number }

/** The remembered facts, newest first, from the synced `coach.memory` items. */
export function factsFrom(items: readonly { id: string; body?: { text?: unknown; at?: unknown } | null }[]): CoachFact[] {
  return items
    .filter((i) => typeof i.body?.text === "string" && i.body.text.trim())
    .map((i) => ({ id: i.id, text: (i.body!.text as string).trim(), at: typeof i.body!.at === "number" ? refToMs(i.body!.at) : 0 }))
    .sort((a, b) => b.at - a.at);
}

/** A fact the athlete writes themselves. Coach reads it with the rest from the next question on. */
export async function rememberOwnFact(text: string): Promise<void> {
  const fact = text.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!fact) return;
  await signedIn();
  put("coach.memory", newUuid(), { text: fact, at: dateToRef(new Date()) });
}

/** Has Coach forget one fact, or all of them. */
export async function forgetMemory(ids: readonly string[]): Promise<void> {
  await signedIn();
  for (const id of ids) remove("coach.memory", id);
}

/** Marks a question answered. The page then sends the answer to Coach as the athlete's next message. */
export async function answerQuestion(conversationId: string, card: QuestionCard, text: string): Promise<void> {
  await updateBlock(conversationId, card.id, (b) => (b.kind === "question" ? { ...b, answered: { text, at: Date.now() } } : b));
}

/** Files can't be sent to Coach from the web yet. */
export async function attachToCoach(): Promise<never> {
  throw new NotWiredError("coach.attach", t("Attaching files isn't connected on the web yet."));
}
