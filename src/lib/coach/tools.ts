// Coach's tools on the web: what the model may call, and what each call does. Pure: everything a tool reads is
// in the `ToolContext` handed in, which the server fills with the signed-in athlete's own items and nothing else.
// No tool writes. The "propose" tools make a card; the card's own button does the writing, in the browser, after
// the athlete says so. Names, formats and result wording follow the phone Coach (CorosKit PhoneCoach.swift)
// wherever the phone has the same tool.
import type { BriefCard, CoachBlock, CoachSource, DebriefCard, NoteLine, QuestionCard } from "@/data/coach";
import type { HubExercise, HubSavedWorkout, HubSport } from "@/data/hub";
import type { SavedWorkout } from "@/data/workouts";
import type { Sport } from "@/lib/workout";
import { compareCard, fuelCard, fuelTargetsOn, planCheckCard, recapCard, todayCard, trendCard } from "./cards";
import { dayLabel, finite, isDay, quoted, shiftDay, today, type AthleteItems, type Clock } from "./items";
import { findEntry, parsePlanChange, planCard, planTarget, type PlanOp } from "./plan";
import { addToDraft, findPlan, listPlansText, planEdit, readPlanText, type DraftWorkout, type MadeWorkout, type PlanBrief, type PlanDraft } from "./plans";
import { findActivity, profileText, readActivities, readActivity, readCalendar, readFuel, readHealth, readStrength, readTraining, type PlanEntry } from "./read";
import { liftHistory } from "./strengthCard";
import type { AthleteZones } from "./zones";
import { describeBuilderWorkout, describeHubWorkout, pacingFor, parseWorkout, searchExercises, workoutCard, type CoachWorkout } from "./workout";

export interface ToolDef { name: string; description: string; input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] } }

const DATE = { type: "string", description: "YYYY-MM-DD" };
const READ = { type: "string", description: "One sentence the card ends on: what these numbers mean for this athlete. No new numbers." };
const TITLE = { type: "string", description: "The card's headline, under 60 characters." };

/** The phone Coach's WORKOUT, with the sports and step ends the web can plan. */
const WORKOUT = {
  type: "object", description: "WORKOUT, in the format the instructions give.",
  properties: {
    name: { type: "string" }, sport: { type: "string", enum: ["run", "trailRun", "bike", "swim", "strength", "hyrox", "xcSki", "indoorClimb", "bouldering"] }, description: { type: "string" },
    gradeSystem: { type: "string", enum: ["yds", "french", "uiaa", "ewbank", "vScale", "font"] },
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          repeats: { type: "integer" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["warmup", "training", "rest", "cooldown"] }, target: { type: "string", enum: ["time", "distance", "open", "reps", "load", "hrRecovery", "elevationGain", "routes"] },
                seconds: { type: "number" }, meters: { type: "number" }, count: { type: "integer" }, load: { type: "integer" }, bpm: { type: "integer" }, exercise: { type: "string" }, sets: { type: "integer" },
                restSeconds: { type: "number" }, name: { type: "string" },
                intensity: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: ["none", "heartRate", "pace", "power", "speed", "cadence", "stroke", "bodyweight", "weight", "rpe", "grade"] },
                    low: { type: "number" }, high: { type: "number" }, grade: { type: "string" }, gradeOffset: { type: "integer" }, stroke: { type: "string", enum: ["freestyle", "breaststroke", "backstroke", "butterfly", "mix", "individualMedley", "drills"] },
                  },
                  required: ["kind"],
                },
              },
              required: ["kind", "target"],
            },
          },
        },
        required: ["steps"],
      },
    },
  },
  required: ["name", "sport", "blocks"],
};

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolDef["input_schema"] => ({ type: "object", properties, required });

export const TOOLS: readonly ToolDef[] = [
  { name: "read_profile", description: "The athlete's profile: the sports they do, thresholds (pace, heart rate, FTP, VO2max), body numbers, fitness and form, predictions, bests, their watch, and what they asked you to remember.", input_schema: obj({}) },
  { name: "read_activities", description: "Recorded activities between two dates (default the last 14 days, at most 365), newest first: start, name, sport, distance, time, pace or speed, heart rate, load, and the id. Use an id with read_training activity for splits.", input_schema: obj({ days: { type: "integer", description: "How many days back from today." }, sport: { type: "string", description: "run, ride, swim, strength or other; leave out for all." }, limit: { type: "integer", description: "Most activities to list, 1–60; default 40." } }) },
  { name: "read_training", description: "C-LINK's analysis of a topic: load (acute, chronic, ratio, readiness), fitness (fitness, fatigue, form now and weeks back), week (each of the last six weeks), records (personal bests), predictions (race predictions), activity (one, by activity_id from read_activities, with laps and heart rate zones), strength (gym workouts set by set), muscles (fatigue per muscle).", input_schema: obj({ topic: { type: "string", enum: ["load", "fitness", "week", "records", "predictions", "activity", "strength", "muscles", "all"] }, activity_id: { type: "string" } }, ["topic"]) },
  { name: "read_health", description: "Health numbers day by day (default the last 30 days, at most 400): sleep (time asleep, score, stages, last night), hrv (overnight, with the usual range), resting_hr, stress, steps, energy (today's 0–100 level and what charged or drained it), all.", input_schema: obj({ metric: { type: "string", enum: ["sleep", "hrv", "resting_hr", "stress", "steps", "energy", "all"] }, days: { type: "integer" } }, ["metric"]) },
  { name: "list_calendar", description: "The calendar between two days (at most 62): what is planned (the COROS calendar when Training Hub is connected, workouts saved on this computer, gym routines put on a day) with each entry's id, and what was recorded. Default 7 days back to 14 ahead.", input_schema: obj({ start_date: DATE, end_date: DATE }) },
  { name: "read_fuel", description: "Food from the Fuel page on one day (default today): calories and macros eaten, the day's target, what is left, energy burned, and each food logged.", input_schema: obj({ date: DATE }) },
  { name: "list_saved_workouts", description: "The athlete's saved workouts: gym routines in C-LINK with their folders, and the COROS workout library when Training Hub is connected. Each line: id (routine-… or coros-…), name, where, sport, shape. With query, only the ones whose name holds it.", input_schema: obj({ query: { type: "string", description: "A workout name or part of one." } }) },
  { name: "read_saved_workout", description: "One saved workout's real content: every exercise with its sets, or every step with its length and target.", input_schema: obj({ workout: { type: "string", description: "The saved workout's id from list_saved_workouts." } }, ["workout"]) },
  { name: "read_workout", description: "One planned calendar workout's steps as they are now, with lengths, targets and repeats. Read it before changing it with propose_workout_change.", input_schema: obj({ entry: { type: "string", description: "The entry id from list_calendar." }, date: DATE, name: { type: "string", description: "Instead of entry: the workout's day and exact name." } }) },
  { name: "search_exercises", description: "COROS's strength exercise list, searched by the words you send: movements, muscles or equipment, several at once (\"squat, lunge, hamstring curl, dumbbell\"). Call it before any strength or HYROX workout and use the names exactly as returned.", input_schema: obj({ query: { type: "string", description: "Movements or muscles, e.g. 'squat, lunge, hamstrings'." } }, ["query"]) },
  { name: "show_workout_recap", description: "Card: how one recorded workout went, with its route, key numbers and pace per kilometre under heart rate. Optionally mark a block of kilometres (a tempo block, the fast finish).", input_schema: obj({ activity_id: { type: "string" }, block_from_km: { type: "integer", description: "First kilometre of the block to mark, counting from 1." }, block_to_km: { type: "integer" }, read: READ }, ["activity_id"]) },
  { name: "show_comparison", description: "Card: two recorded workouts side by side, with what changed and pace per kilometre for both.", input_schema: obj({ before_activity_id: { type: "string" }, after_activity_id: { type: "string" }, read: READ }, ["before_activity_id", "after_activity_id"]) },
  { name: "show_trend", description: "Card: one health metric night by night over the last 90 days against the athlete's usual range.", input_schema: obj({ metric: { type: "string", enum: ["hrv", "resting_hr", "sleep", "sleep_score"] }, mark_date: { ...DATE, description: "A day to mark on the chart, YYYY-MM-DD." }, title: TITLE, read: READ }, ["metric"]) },
  { name: "show_today", description: "Card: how today looks, with sleep, HRV, Energy, readiness, form, resting heart rate, load and what is planned.", input_schema: obj({ title: TITLE, read: READ }) },
  { name: "get_plan_compliance", description: "Card: planned against done for one week, day by day, with what was skipped. A planned workout counts as done when an activity of the same sport was recorded that day.", input_schema: obj({ week_of: { ...DATE, description: "Any day of the week, YYYY-MM-DD; default this week." }, title: TITLE, read: READ }) },
  { name: "show_fuel", description: "Card: today's food against the target, with what is left of each macro. With meal, it also offers one meal idea the athlete can log with a button; nothing is logged until they press it.", input_schema: obj({ title: TITLE, read: READ, meal: { type: "object", properties: { slot: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] }, name: { type: "string" }, kcal: { type: "number" }, protein_g: { type: "number" }, carbs_g: { type: "number" }, fat_g: { type: "number" } }, required: ["slot", "name", "kcal", "protein_g", "carbs_g", "fat_g"] } }) },
  { name: "propose_workout", description: "Card that adds one workout to a day once the athlete approves. Send either workout (a new one, written out) or saved_workout (a saved workout's id from list_saved_workouts, put on the card exactly as saved). With Training Hub connected it goes on the COROS calendar and to the watch, and the card can also save it to the COROS workout library; without it, a run, ride, swim or gym workout is saved on this computer's calendar.", input_schema: obj({ date: DATE, workout: WORKOUT, saved_workout: { type: "string", description: "Instead of workout: a saved workout's id (routine-… or coros-…)." }, note: { type: "string", description: "One sentence: why this workout, now." } }, ["date"]) },
  { name: "propose_workout_change", description: "Card that replaces a planned workout's steps and name once the athlete approves, keeping its day. Read it first with read_workout, then send the whole workout as it should be. A gym routine from the phone can't be rewritten here.", input_schema: obj({ entry: { type: "string", description: "The entry id from list_calendar." }, date: DATE, name: { type: "string", description: "Instead of entry: the workout's day and exact name." }, workout: WORKOUT, note: { type: "string", description: "One sentence: what changed and why." } }, ["workout"]) },
  { name: "propose_training_plan", description: "Card that puts several workouts on the calendar once the athlete approves: each on its own day. Up to 28 workouts per card; a longer plan goes up a week or two at a time, one call per chunk. Leave rest days out.", input_schema: obj({ name: { type: "string", description: "Short plan name." }, overview: { type: "string", description: "One or two sentences: the goal and how the weeks build." }, start_date: DATE, workouts: { type: "array", items: { type: "object", properties: { day: { type: "integer", description: "Day of the plan; 1 is start_date." }, workout: WORKOUT, saved_workout: { type: "string", description: "Instead of workout: a routine id from list_saved_workouts." } }, required: ["day"] } } }, ["name", "start_date", "workouts"]) },
  { name: "list_plans", description: "The athlete's saved training plans (Library › Plans), with ids, weeks, workouts and phases. The one open in the plan editor is marked OPEN.", input_schema: obj({}) },
  { name: "read_plan", description: "One saved plan week by week: every workout and rest day with its date, weekday, minutes, load and entry id. Read it before proposing edits. Without plan, the one open in the editor.", input_schema: obj({ plan: { type: "string", description: "The plan id from list_plans." } }) },
  { name: "propose_plan_edit", description: "Card with changes to a saved plan, applied once the athlete approves (in the plan editor it changes the open plan; Undo puts it back). Only what you list changes: keep it to what they asked. Actions: move (entry → date, or week + weekday), remove (entry), replace (entry, workout), add (date or week + weekday, workout), add_week (after_week: 0 puts it first, leave out for the end; copy_week to copy one; recovery: true), remove_week (week), set_phases (phases: kind base/build/peak/taper/recovery/custom with start_week and end_week, the whole list), rename (name), set_goal (goal). Changes run in order, so add a week before adding workouts to it.", input_schema: obj({ plan: { type: "string", description: "The plan id; leave out for the open one." }, title: { type: "string", description: "Short title for the card." }, note: { type: "string", description: "One or two sentences: what changes and why." }, changes: { type: "array", items: { type: "object", properties: { action: { type: "string", enum: ["move", "remove", "replace", "add", "add_week", "remove_week", "set_phases", "rename", "set_goal"] }, entry: { type: "string" }, date: DATE, week: { type: "integer", description: "1-based." }, weekday: { type: "string", enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] }, workout: WORKOUT, after_week: { type: "integer" }, copy_week: { type: "integer" }, recovery: { type: "boolean" }, phases: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, start_week: { type: "integer" }, end_week: { type: "integer" } } } }, name: { type: "string" }, goal: { type: "string" } }, required: ["action"] } } }, ["changes"]) },
  { name: "build_plan", description: "Builds a whole new multi-week plan as ONE saved plan for the athlete's Library (not the calendar). Send the plan in chunks of up to 28 workouts, one build_plan call per chunk with the same name, all in this one answer, until every week to the goal is covered; they join into one card the athlete saves or opens in the plan editor. Leave rest days out.", input_schema: obj({ name: { type: "string", description: "Short plan name, the same on every chunk, without week numbers." }, overview: { type: "string", description: "One or two sentences: the goal and how the weeks build." }, goal: { type: "string" }, start_date: DATE, weeks: { type: "integer", description: "How many weeks the whole plan has." }, workouts: { type: "array", items: { type: "object", properties: { day: { type: "integer", description: "Day of the plan; 1 is start_date." }, workout: WORKOUT }, required: ["day", "workout"] } } }, ["name", "start_date", "weeks", "workouts"]) },
  { name: "propose_plan_change", description: "Card that changes the calendar once the athlete approves: move a planned workout to another day, remove one, or add a saved gym routine to a day. Several changes go on one card. Name a workout by its date and exact name, or by its entry id from list_calendar.", input_schema: obj({ title: TITLE, note: { type: "string", description: "One sentence: why." }, changes: { type: "array", items: { type: "object", properties: { action: { type: "string", enum: ["move", "remove", "add_saved"] }, date: DATE, name: { type: "string", description: "The calendar workout's exact name." }, entry: { type: "string", description: "The entry id from list_calendar, instead of date and name." }, new_date: DATE, saved_workout: { type: "string", description: "For add_saved: a routine id from list_saved_workouts." } }, required: ["action"] } } }, ["changes"]) },
  { name: "write_workout_brief", description: "Card with a brief for a planned workout: a one-line goal, 2–4 concrete, checkable cues (\"keep HR under 150 on the climbs\", not \"run well\") and an optional fuel plan. It is saved when the athlete presses Save.", input_schema: obj({ date: DATE, name: { type: "string", description: "The planned workout's name." }, goal: { type: "string" }, cues: { type: "array", items: { type: "string" } }, fuel_plan: { type: "string" } }, ["date", "name", "goal", "cues"]) },
  { name: "log_workout_debrief", description: "Card recording how a past workout went, from what the athlete told you: feel 1–5, which cues they hit, fuelling, notes in their words. Never invent details.", input_schema: obj({ activity_id: { type: "string" }, feel: { type: "integer", minimum: 1, maximum: 5 }, feel_word: { type: "string", description: "One or two words for the feel: Strong, Flat, Heavy legs." }, cue_outcomes: { type: "array", items: { type: "object", properties: { cue: { type: "string" }, outcome: { type: "string", enum: ["hit", "missed"] } }, required: ["cue", "outcome"] } }, fueling_taken: { type: "string" }, notes: { type: "string", description: "What the athlete said, in their words." }, read: READ }, ["activity_id", "feel"]) },
  { name: "remember_fact", description: "Save one lasting fact about the athlete for later conversations (a goal race, an injury, the days they can train, equipment). The athlete sees each save and can forget it.", input_schema: obj({ fact: { type: "string", description: "One sentence." } }, ["fact"]) },
  { name: "request_coach_input", description: "Ask the athlete one necessary question with answer buttons, recommended choice first. At most once per answer; then stop and wait for their reply.", input_schema: obj({ question: { type: "string" }, choices: { type: "array", items: { type: "object", properties: { label: { type: "string", description: "Short button text, under 45 characters." }, description: { type: "string", description: "One-sentence tradeoff." } }, required: ["label"] } } }, ["question", "choices"]) },
];

/** Everything one answer's tools can reach. */
export interface ToolContext {
  items: AthleteItems;
  clock: Clock;
  /** Planned calendar entries from every source. */
  entries: readonly PlanEntry[];
  /** Why the COROS calendar is not in `entries`, in words for the model; null when it is. */
  hubNote: string | null;
  /** COROS Training Hub reads for this athlete, or null when no shared session is in their account. */
  hub: HubLoaders | null;
  /** Workouts saved in the athlete's browser calendar, with their steps. */
  browser: readonly SavedWorkout[];
  /** Makes ids for cards and new items: an uppercase UUID. */
  newId: () => string;
  /** The athlete's zones and FTP from Training Hub or the phone, for a workout card's zone names and heights. */
  zones?: AthleteZones | null;
  /** True once this answer has asked its one question. */
  asked: boolean;
  /** The athlete's saved plans, short form (the open one marked). */
  plans?: readonly PlanBrief[];
  /** Plans being built with build_plan in this answer, by name, with their card id. */
  drafts?: Map<string, { id: string; draft: PlanDraft }>;
}

/** What Coach may read from COROS Training Hub while answering. A failed read comes back as words. */
export interface HubLoaders {
  catalog(): Promise<HubExercise[] | { problem: string }>;
  library(): Promise<HubSavedWorkout[] | { problem: string }>;
  libraryWorkout(id: string): Promise<HubSavedWorkout | { problem: string }>;
}

export interface ToolResult {
  /** What the model reads back. */
  text: string;
  isError?: boolean;
  /** What the athlete sees: a card, or a small line. */
  block?: CoachBlock;
  /** For "Used in this answer". */
  source?: CoachSource;
}

const fail = (message: string): ToolResult => ({ text: `Error: ${message}`, isError: true });
const AWAITING = "awaiting_confirmation: the athlete sees a card for this and nothing is saved until they approve it. Don't propose it again; say briefly what it does and stop.";
const SHOWN = "The athlete sees this card now. Don't repeat its numbers in words; add only what the card doesn't say.";

function built<T extends CoachBlock>(made: { card: T } | { error: string }, text: string, source?: CoachSource): ToolResult {
  return "error" in made ? fail(made.error) : { text, block: made.card, source };
}

/** What a running tool is called on the working card. */
export const TOOL_WORDS: Record<string, string> = {
  read_profile: "Reading your profile", read_activities: "Reading your activities", read_training: "Reading your training", read_health: "Reading sleep and recovery",
  list_calendar: "Reading your calendar", read_fuel: "Reading Fuel", list_saved_workouts: "Reading your routines", show_workout_recap: "Drawing the recap",
  show_comparison: "Comparing the two", show_trend: "Drawing the trend", show_today: "Putting today together", get_plan_compliance: "Checking the plan",
  show_fuel: "Adding up today's food", propose_workout: "Building the workout", propose_plan_change: "Laying out the change", write_workout_brief: "Writing the brief",
  log_workout_debrief: "Writing the debrief", remember_fact: "Making a note", request_coach_input: "Asking you",
  read_saved_workout: "Reading a saved workout", read_workout: "Reading the workout", search_exercises: "Looking up exercises",
  propose_workout_change: "Rewriting the workout", propose_training_plan: "Laying out the plan",
  list_plans: "Reading your plans", read_plan: "Reading the plan", propose_plan_edit: "Laying out the plan change", build_plan: "Building the plan",
};

const NO_HUB = "COROS Training Hub isn't connected for this athlete, so COROS's exercise list and workout library can't be read. They connect it on the Connections page.";
const HUB_SPORT_AS: Record<HubSport, Sport> = { run: "run", trailRun: "run", bike: "ride", swim: "swim", strength: "strength", hyrox: "strength", xcSki: "run", indoorClimb: "strength", bouldering: "strength" };

/** COROS's exercise list, when a workout is a strength one and Training Hub can be read; null otherwise. */
async function catalogFor(workout: unknown, ctx: ToolContext): Promise<readonly HubExercise[] | null> {
  let value = workout;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return null; } }
  const sport = String((value as { sport?: unknown } | null)?.sport ?? "").toLowerCase();
  if (!ctx.hub || !["strength", "gym", "hyrox"].includes(sport)) return null;
  const list = await ctx.hub.catalog();
  return Array.isArray(list) ? list : null;
}

function shapeOf(saved: HubSavedWorkout): string {
  const t = saved.totals, parts: string[] = [];
  if (t && t.sets > 0) parts.push(`${t.sets} sets`);
  if (t && t.meters > 0) parts.push(`${(t.meters / 1000).toFixed(2)} km`);
  if (t && t.seconds > 0) parts.push(`${Math.round(t.seconds / 60)} min`);
  return parts.join(", ");
}

const detailOf = (made: CoachWorkout, card: { summary: string }): string => (made.workout ? card.summary : shapeOf({ id: "", name: "", sportCode: null, sport: made.sport, hasSteps: true, workout: made.hub, totals: null }) || card.summary);

/** A workout Coach wrote for a plan, made the way a calendar card makes it (load included). */
async function makeForPlan(raw: unknown, day: string, ctx: ToolContext): Promise<(MadeWorkout & { detail: string }) | { error: string }> {
  const made = parseWorkout(raw, day, `w-${ctx.newId().toLowerCase()}`, await catalogFor(raw, ctx));
  if ("error" in made) return { error: `Workout: ${made.error}` };
  const card = workoutCard(made, made.workout ? pacingFor(ctx.items, ctx.clock, made.workout.sport) : null, { id: "x", date: day });
  return { name: made.name, sport: made.sport, workout: made.workout, hub: made.hub, detail: detailOf(made, card), ...(card.totals ? { load: card.totals.load } : {}) };
}

/** Runs one tool call. Never throws: a bad call comes back as an error for the model to fix. */
export async function runTool(name: string, raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const { items, clock } = ctx;
  const num = (v: unknown) => (finite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (name) {
    case "read_profile":
      return { text: profileText(items, clock), source: { title: "Your profile", detail: "Thresholds, sports, bests", href: "/" } };
    case "read_activities":
      return { text: readActivities(items, clock, { days: num(input.days), sport: str(input.sport), limit: num(input.limit) }), source: { title: "Activities", detail: `Last ${Math.round(num(input.days) ?? 14)} days`, href: "/activities" } };
    case "read_training": {
      const topic = str(input.topic) ?? "all";
      if (topic === "activity") {
        const a = findActivity(items, input.activity_id);
        if (!a) return fail(input.activity_id ? `no activity ${quoted(String(input.activity_id), 60)}. Use an id from read_activities.` : "activity needs activity_id from read_activities.");
        return { text: readActivity(items, clock, a.id), source: { title: quoted(a.name, 40) || "Activity", detail: "Laps and heart rate zones", href: `/activities/${encodeURIComponent(a.id)}` } };
      }
      if (topic === "strength") return { text: readStrength(items, clock, { topic: "workouts" }), source: { title: "Strength", detail: "Gym workouts", href: "/strength" } };
      if (topic === "muscles") return { text: readStrength(items, clock, { topic: "muscles" }), source: { title: "Strength", detail: "Muscle fatigue", href: "/strength" } };
      return { text: readTraining(items, clock, { topic }), source: { title: "Training", detail: topic === "all" ? "Load, fitness, weeks" : topic[0].toUpperCase() + topic.slice(1), href: "/" } };
    }
    case "read_health":
      return { text: readHealth(items, clock, { topic: str(input.metric), days: num(input.days) }), source: { title: "Health", detail: `${str(input.metric) ?? "all"}, last ${Math.round(num(input.days) ?? 30)} days`, href: "/health" } };
    case "list_calendar":
      return { text: readCalendar(items, clock, ctx.entries, { from: str(input.start_date), to: str(input.end_date) }, ctx.hubNote), source: { title: "Calendar", detail: "Planned and done", href: "/calendar" } };
    case "read_fuel": {
      const day = isDay(input.date) ? input.date : today(clock);
      return { text: readFuel(items, clock, { day }, fuelTargetsOn(items, day)), source: { title: "Fuel", detail: dayLabel(day), href: "/fuel" } };
    }
    case "list_saved_workouts": {
      const query = (str(input.query) ?? "").trim().toLowerCase();
      const out = [readStrength(items, clock, { topic: "routines" })];
      if (!ctx.hub) out.push("COROS Training Hub isn't connected, so the COROS workout library isn't listed.");
      else {
        const saved = await ctx.hub.library();
        if (!Array.isArray(saved)) out.push(`The COROS workout library couldn't be read: ${saved.problem}`);
        else {
          const hits = saved.filter((w) => !query || w.name.toLowerCase().includes(query)).slice(0, 60);
          out.push(hits.length ? `COROS workout library, ${hits.length} of ${saved.length} (id · name · sport · shape):` : `No COROS library workout matches “${quoted(query, 40)}”.`);
          for (const w of hits) out.push(`coros-${w.id} · ${quoted(w.name)} · ${w.sport ?? "other"}${shapeOf(w) ? ` · ${shapeOf(w)}` : ""}`);
        }
      }
      return { text: out.join("\n"), source: { title: "Saved workouts", detail: "Routines and the COROS library", href: "/strength" } };
    }
    case "read_saved_workout": {
      const id = (str(input.workout) ?? "").trim();
      if (id.startsWith("routine-")) {
        const r = items.routines.find((x) => x.id === id.slice(8));
        if (!r) return fail(`no saved workout ${quoted(id, 60)}. Find it with list_saved_workouts.`);
        const names = items.strength?.exerciseNames ?? {};
        return { text: [`# ${quoted(r.name) || "Routine"} (saved workout ${id}, C-LINK gym routine${r.folder ? `, folder “${quoted(r.folder, 40)}”` : ""})`, ...(r.entries ?? []).map((e, i) => `${i + 1}. ${quoted(names[e.exerciseID]) || e.exerciseID} · ${(e.sets ?? []).length} sets: ${(e.sets ?? []).map((x) => `${finite(x.reps) ? x.reps : finite(x.seconds) ? `${x.seconds} s` : "?"}${finite(x.weightKg) ? ` @ ${x.weightKg} kg` : ""}`).join(", ")}${finite(e.restSeconds) ? ` · rest ${e.restSeconds} s` : ""}`)].join("\n") };
      }
      if (!id.startsWith("coros-")) return fail("workout must be an id from list_saved_workouts (routine-… or coros-…).");
      if (!ctx.hub) return fail(NO_HUB);
      const saved = await ctx.hub.libraryWorkout(id.slice(6));
      if ("problem" in saved) return fail(saved.problem);
      if (!saved.workout) return fail("that saved workout has steps this app can't read.");
      return { text: `# Saved workout ${id}, COROS library\n${describeHubWorkout(saved.workout)}` };
    }
    case "read_workout": {
      const entry = findEntry(ctx.entries, input);
      if (typeof entry === "string") return fail(entry);
      const head = `Planned on ${entry.date} [entry ${entry.id}]`;
      if (entry.coros) return entry.coros.workout ? { text: `${head}, COROS calendar:\n${describeHubWorkout(entry.coros.workout)}` } : fail(`“${entry.name}” has steps this app can't read or rewrite. It can still be moved or removed.`);
      if (entry.browser) {
        const saved = ctx.browser.find((w) => w.id === entry.browser!.workoutId);
        return saved && saved.items.length ? { text: `${head}, saved on this computer:\n${describeBuilderWorkout(saved)}` } : fail(`“${entry.name}” came without its steps.`);
      }
      return { text: `${head}: a gym routine from the phone (“${entry.name}”${entry.detail ? `, ${entry.detail}` : ""}). Its sets are edited in the phone app; here it can be moved or removed. read_saved_workout shows what is in it.` };
    }
    case "search_exercises": {
      const query = quoted(input.query, 200);
      if (!query) return fail("search_exercises needs a query.");
      const own = searchExercises(Object.entries(items.strength?.exerciseNames ?? {}).map(([id, n]) => ({ id, name: String(n) })), query, 20).map((e) => e.name);
      const ownLine = own.length ? `\nIn their own gym log: ${own.join("; ")}` : "";
      if (!ctx.hub) return { text: `${NO_HUB} Use plain exercise names; the workout is then saved on this computer's calendar, not on the watch.${ownLine}` };
      const catalog = await ctx.hub.catalog();
      if (!Array.isArray(catalog)) return { text: `COROS's exercise list couldn't be read: ${catalog.problem} Use plain exercise names; the workout is then saved on this computer's calendar.${ownLine}` };
      const hits = searchExercises(catalog, query);
      return { text: `${hits.length ? `COROS exercises: ${hits.map((e) => quoted(e.name, 60)).join("; ")}` : `No COROS exercise matches “${query}”. Search the movement's plain name: squat, row, curl, press.`}${ownLine}`, source: { title: "COROS exercises", detail: `${catalog.length} in the list`, href: "/strength" } };
    }
    case "show_workout_recap":
      return built(recapCard(items, clock, ctx.newId(), input), SHOWN, { title: "Activity", detail: "Splits and heart rate", href: `/activities/${encodeURIComponent(String(input.activity_id ?? ""))}` });
    case "show_comparison":
      return built(compareCard(items, clock, ctx.newId(), input), SHOWN, { title: "Activities", detail: "Two workouts compared", href: "/activities" });
    case "show_trend":
      return built(trendCard(items, clock, ctx.newId(), input), SHOWN, { title: "Health", detail: "90-day trend", href: "/health" });
    case "show_today":
      return built(todayCard(items, clock, ctx.newId(), ctx.entries, input), SHOWN, { title: "Health", detail: "Today", href: "/health" });
    case "get_plan_compliance": {
      const made = planCheckCard(items, clock, ctx.newId(), ctx.entries, input);
      if ("error" in made) return fail(made.error);
      const c = made.card;
      return { text: `${SHOWN}\nOn the card: ${c.title}. ${c.daysLabel}.${c.misses.length ? ` Missed: ${c.misses.map((m) => `${m.day} “${m.name}” (${m.note})`).join("; ")}.` : ""}${ctx.hubNote ? `\n${ctx.hubNote}` : ""}`, block: c, source: { title: "Calendar", detail: "Planned against done", href: "/calendar" } };
    }
    case "show_fuel":
      return built(fuelCard(items, clock, ctx.newId(), input), input.meal ? `${SHOWN} The meal is offered with a Log button; nothing is logged until they press it.` : SHOWN, { title: "Fuel", detail: "Today", href: "/fuel" });
    case "propose_workout": {
      if (!isDay(input.date)) return fail("date must be a date, YYYY-MM-DD.");
      if (input.date < today(clock)) return fail(`${input.date} is in the past; the calendar plans from today on.`);
      if (input.date > shiftDay(today(clock), 365)) return fail("date is more than a year away.");
      const id = `w-${ctx.newId().toLowerCase()}`;
      const saved = (str(input.saved_workout) ?? "").trim();
      if (saved.startsWith("routine-") || (saved && !saved.startsWith("coros-"))) {
        const parsed = parsePlanChange(items, clock, ctx.entries, { changes: [{ action: "add_saved", saved_workout: saved, new_date: input.date }] }, ctx.newId);
        if ("error" in parsed) return fail(parsed.error);
        return { text: `${AWAITING}\nThis is their gym routine exactly as saved, on C-LINK's own calendar: it reaches the phone at its next sync and is started there in the gym logger, not on the watch. Say so in a few words.`, block: planCard(items, clock, ctx.entries, parsed.ops, ctx.newId(), { title: `Add “${(parsed.ops[0] as { name: string }).name}”`, note: input.note }) };
      }
      if (saved) {
        if (!ctx.hub) return fail(NO_HUB);
        const found = await ctx.hub.libraryWorkout(saved.slice(6));
        if ("problem" in found) return fail(found.problem);
        if (!found.workout) return fail("that saved workout has steps this app can't write, so it can't be put on a day from here.");
        return { text: `${AWAITING}\nThis is their saved COROS workout exactly as saved.`, block: { ...workoutCard({ workout: null, hub: found.workout, name: found.name, sport: found.workout.sport }, null, { id, date: input.date, note: input.note }, ctx.zones ?? null, liftHistory(items.gymWorkouts, items.strength?.exerciseNames)), saved: { id: found.id, name: found.name } } };
      }
      if (input.workout === undefined) return fail("No workout: send workout, or saved_workout with a saved workout's id.");
      const made = parseWorkout(input.workout, input.date, id, await catalogFor(input.workout, ctx));
      if ("error" in made) return fail(`Workout: ${made.error}`);
      const where = made.hub ? (ctx.hub ? "" : "\nTraining Hub isn't connected, so it will be saved on this computer's calendar, not on COROS or the watch; say so in a few words.") : "\nA gym workout without COROS's own exercises is saved on this computer's calendar, not on the watch; say so in a few words.";
      return { text: `${AWAITING}${where}`, block: workoutCard(made, made.workout ? pacingFor(items, clock, made.workout.sport) : null, { id, date: input.date, note: input.note }, ctx.zones ?? null, liftHistory(items.gymWorkouts, items.strength?.exerciseNames)) };
    }
    case "propose_workout_change": {
      const entry = findEntry(ctx.entries, input);
      if (typeof entry === "string") return fail(entry);
      if (entry.date < today(clock)) return fail(`${entry.date} is in the past; only workouts from today on can be changed.`);
      if (entry.planned) return fail(`“${entry.name}” is a gym routine from the phone, which can't be rewritten here. Its sets are edited in the phone app; it can be moved or removed.`);
      if (entry.coros && !entry.coros.workout) return fail(`“${entry.name}” has steps this app can't rewrite. It can be moved or removed.`);
      const made = parseWorkout(input.workout, entry.date, `w-${ctx.newId().toLowerCase()}`, await catalogFor(input.workout, ctx));
      if ("error" in made) return fail(`Workout: ${made.error}`);
      if (entry.coros && !made.hub) return fail("this workout is on the COROS calendar, and COROS can't hold the new version: every strength training step needs an exercise from search_exercises.");
      if (entry.browser && !made.workout) return fail("this workout is saved in the browser's calendar, which holds only time and distance steps (and gym sets). Keep to those, or the athlete can re-add it with Training Hub connected.");
      return { text: "awaiting_confirmation: the athlete sees a card with the workout as it would be. Nothing changes until they press Apply change. Say briefly what is different and stop.", block: workoutCard(made, made.workout ? pacingFor(items, clock, made.workout.sport) : null, { id: ctx.newId(), date: entry.date, note: input.note, replaces: planTarget(entry) }, ctx.zones ?? null, liftHistory(items.gymWorkouts, items.strength?.exerciseNames)) };
    }
    case "propose_training_plan": {
      if (!isDay(input.start_date)) return fail("start_date must be a date, YYYY-MM-DD.");
      if (input.start_date < today(clock)) return fail(`${input.start_date} is in the past; the calendar plans from today on.`);
      const list = Array.isArray(input.workouts) ? input.workouts : [];
      if (!list.length) return fail("A plan needs workouts.");
      if (list.length > 28) return fail("A card holds at most 28 workouts. Send the plan a week or two at a time, one propose_training_plan per chunk.");
      const ops: PlanOp[] = [];
      for (let i = 0; i < list.length; i++) {
        const w = list[i] as Record<string, unknown> | null;
        const dayNo = finite(w?.day) ? Math.round(w.day) : NaN;
        if (!w || !(dayNo >= 1)) return fail(`Workout ${i + 1} needs its day (1 is start_date).`);
        if (dayNo > 182) return fail(`Workout ${i + 1} falls more than 26 weeks after start_date.`);
        const day = shiftDay(input.start_date, dayNo - 1);
        if (typeof w.saved_workout === "string" && w.saved_workout) {
          const parsed = parsePlanChange(items, clock, ctx.entries, { changes: [{ action: "add_saved", saved_workout: w.saved_workout, new_date: day }] }, ctx.newId);
          if ("error" in parsed) return fail(`Workout ${i + 1} (day ${dayNo}): ${parsed.error}`);
          ops.push(...parsed.ops);
          continue;
        }
        const made = parseWorkout(w.workout, day, `w-${ctx.newId().toLowerCase()}`, await catalogFor(w.workout, ctx));
        if ("error" in made) return fail(`Workout ${i + 1} (day ${dayNo}): ${made.error}`);
        const card = workoutCard(made, made.workout ? pacingFor(items, clock, made.workout.sport) : null, { id: "x", date: day });
        ops.push({ op: "add_workout", day, name: made.name, sport: HUB_SPORT_AS[made.sport], workout: made.workout, hub: made.hub, detail: detailOf(made, card), ...(card.totals ? { load: card.totals.load } : {}) });
      }
      const title = quoted(input.name, 60) || "Training plan";
      return { text: `${AWAITING}${ctx.hub ? "" : "\nTraining Hub isn't connected, so the workouts will be saved on this computer's calendar, not on COROS; say so in a few words."}`, block: planCard(items, clock, ctx.entries, ops, ctx.newId(), { title, note: quoted(input.overview, 240) || input.note }) };
    }
    case "list_plans":
      return { text: listPlansText(ctx.plans ?? []), source: { title: "Plans", detail: "Library › Plans", href: "/calendar/plans" } };
    case "read_plan": {
      const plan = findPlan(ctx.plans ?? [], input.plan);
      if (!plan) return fail(input.plan ? `no plan ${quoted(String(input.plan), 60)}. Use an id from list_plans.` : "no plan is open in the editor; send plan with an id from list_plans.");
      return { text: readPlanText(plan), source: { title: plan.name, detail: `${plan.weeks} weeks`, href: `/calendar/plans/edit?id=${encodeURIComponent(plan.id)}` } };
    }
    case "propose_plan_edit": {
      const plan = findPlan(ctx.plans ?? [], input.plan);
      if (!plan) return fail(input.plan ? `no plan ${quoted(String(input.plan), 60)}. Use an id from list_plans.` : "no plan is open in the editor; send plan with an id from list_plans.");
      const changes = (Array.isArray(input.changes) ? input.changes : []).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null).slice(0, 80);
      const made: (MadeWorkout | null)[] = [];
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        if (c.action !== "add" && c.action !== "replace") { made.push(null); continue; }
        if (c.workout === undefined) return fail(`change ${i + 1}: ${String(c.action)} needs workout.`);
        const m = await makeForPlan(c.workout, isDay(c.date) ? c.date : plan.start || today(clock), ctx);
        if ("error" in m) return fail(`change ${i + 1}: ${m.error}`);
        made.push(m);
      }
      const edit = planEdit(plan, changes, made);
      if ("error" in edit) return fail(edit.error);
      return {
        text: `awaiting_confirmation: the athlete sees the changes to “${plan.name}” on a card. Nothing changes until they press Apply changes${plan.open ? " (it then changes the plan open in their editor, with Undo)" : ""}. Say in a sentence or two what changes and stop.`,
        block: { kind: "planEdit", id: ctx.newId(), planId: plan.id, planName: plan.name, title: quoted(input.title, 60) || "Plan change", note: quoted(input.note, 280), rows: edit.rows, load: edit.load, ops: edit.ops },
      };
    }
    case "build_plan": {
      const planName = quoted(input.name, 60);
      if (!planName) return fail("build_plan needs name.");
      if (!isDay(input.start_date)) return fail("start_date must be a date, YYYY-MM-DD.");
      const weeks = finite(input.weeks) ? Math.round(input.weeks) : NaN;
      if (!(weeks >= 1 && weeks <= 52)) return fail("weeks must be 1 to 52.");
      const list = Array.isArray(input.workouts) ? input.workouts : [];
      if (!list.length) return fail("a chunk needs workouts.");
      if (list.length > 28) return fail("at most 28 workouts per call: send the rest in more build_plan calls with the same name.");
      const workouts: DraftWorkout[] = [];
      for (let i = 0; i < list.length; i++) {
        const w = list[i] as Record<string, unknown> | null;
        const dayNo = finite(w?.day) ? Math.round(w.day) : NaN;
        if (!w || !(dayNo >= 1 && dayNo <= weeks * 7)) return fail(`workout ${i + 1} needs its day, 1 to ${weeks * 7} (1 is start_date).`);
        const m = await makeForPlan(w.workout, shiftDay(input.start_date, dayNo - 1), ctx);
        if ("error" in m) return fail(`workout ${i + 1} (day ${dayNo}): ${m.error}`);
        workouts.push({ ...m, offset: dayNo - 1 });
      }
      ctx.drafts ??= new Map();
      const key = planName.toLowerCase(), had = ctx.drafts.get(key);
      const draft = addToDraft(had?.draft, { name: planName, overview: quoted(input.overview, 280), goal: quoted(input.goal, 180), start: had?.draft.start ?? input.start_date, weeks, workouts });
      const id = had?.id ?? ctx.newId();
      ctx.drafts.set(key, { id, draft });
      const covered = new Set(draft.workouts.map((w) => Math.floor(w.offset / 7))).size;
      return {
        text: `Added to “${planName}”: ${draft.workouts.length} workouts over ${covered} of ${draft.weeks} weeks so far. ${covered < draft.weeks ? "Send the next chunk with build_plan (same name) until every week is covered, then say in two or three sentences how the plan builds." : "Every week has workouts. Say in two or three sentences how the plan builds; the athlete saves it from the card."}`,
        block: { kind: "planDraft", id, draft },
      };
    }
    case "propose_plan_change": {
      const parsed = parsePlanChange(items, clock, ctx.entries, input, ctx.newId);
      if ("error" in parsed) return fail(parsed.error);
      return { text: AWAITING, block: planCard(items, clock, ctx.entries, parsed.ops, ctx.newId(), input) };
    }
    case "write_workout_brief": {
      const goal = quoted(input.goal, 200), title = quoted(input.name, 80);
      const cues = Array.isArray(input.cues) ? input.cues.map((c) => quoted(c, 160)).filter(Boolean).slice(0, 8) : [];
      if (!isDay(input.date)) return fail("date must be the workout's day, YYYY-MM-DD.");
      if (!goal || !cues.length || !title) return fail("a brief needs the workout's name, a goal and at least one cue.");
      const card: BriefCard = { kind: "brief", id: ctx.newId(), eyebrow: `Brief · ${dayLabel(input.date)}`, title, day: input.date, goal, cues, fuel: quoted(input.fuel_plan, 240), saved: "", savedNote: "" };
      return { text: "awaiting_confirmation: the athlete sees the brief on a card with a Save button. Don't repeat it in full.", block: card };
    }
    case "log_workout_debrief": {
      const a = findActivity(items, input.activity_id);
      if (!a) return fail("no activity with that id. Use an id from read_activities.");
      const feel = finite(input.feel) ? Math.max(1, Math.min(5, Math.round(input.feel))) : null;
      if (feel === null) return fail("feel must be a number from 1 to 5, from what the athlete said.");
      const cues = Array.isArray(input.cue_outcomes) ? input.cue_outcomes.filter((c): c is { cue: string; outcome: string } => typeof c?.cue === "string").slice(0, 8).map((c) => ({ text: quoted(c.cue, 160), hit: c.outcome === "hit" })) : [];
      const card: DebriefCard = {
        kind: "debrief", id: ctx.newId(), activityId: a.id, eyebrow: `Debrief · ${quoted(a.name, 40) || "Workout"}`, title: "How it went",
        feel: { score: feel, of: 5, word: quoted(input.feel_word, 24) || ["Rough", "Hard", "OK", "Good", "Strong"][feel - 1] },
        cues, fuel: quoted(input.fueling_taken, 200), said: quoted(input.notes, 400), read: quoted(input.read, 240) || undefined,
      };
      return { text: "The athlete sees the debrief on a card in this conversation.", block: card };
    }
    case "remember_fact": {
      const fact = quoted(input.fact, 300);
      if (!fact) return fail("the fact is empty.");
      const line: NoteLine = { kind: "note", id: ctx.newId(), note: "remembered", text: fact };
      return { text: "Saved. The athlete sees it in the conversation and can forget it.", block: line };
    }
    case "request_coach_input": {
      if (ctx.asked) return fail("one question per answer. End this answer now and wait for the athlete's reply.");
      const question = quoted(input.question, 300);
      if (!question) return fail("request_coach_input needs a question.");
      const seen = new Set<string>(), options: QuestionCard["options"] = [];
      for (const c of Array.isArray(input.choices) ? input.choices : []) {
        const label = quoted((c as { label?: unknown })?.label, 80);
        if (!label || seen.has(label.toLowerCase()) || options.length >= 5) continue;
        seen.add(label.toLowerCase());
        options.push({ id: `choice-${options.length + 1}`, title: label, detail: quoted((c as { description?: unknown }).description, 240), ...(options.length === 0 ? { recommended: true } : {}) });
      }
      if (options.length < 2) return fail("request_coach_input needs at least two different choices.");
      ctx.asked = true;
      return { text: "waiting_for_athlete: the athlete sees the question with its choices. End this answer now, without repeating the question, and wait for their reply.", block: { kind: "question", id: ctx.newId(), title: question, options } };
    }
    default:
      return fail(`there's no tool ${quoted(name, 40)}.`);
  }
}
