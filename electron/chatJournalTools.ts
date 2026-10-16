import { listScheduledWorkoutEntries, listTrainingHubActivities, getTrainingHubStatus } from "./trainingHubService";
import { coachMayReplaceBrief, formatJournalEntryForCoach, normalizeHappenDay } from "./workoutJournalModel";
import { getWorkoutJournalEntry, listWorkoutJournal, saveWorkoutJournal } from "./workoutJournalService";
import type { CorosMcpTool, TrainingHubActivity, TrainingHubScheduledWorkoutEntry } from "./types";
import type { WorkoutCueOutcome, WorkoutFeel, WorkoutFuelOutcome, WorkoutJournalRef } from "./workoutJournalTypes";

export const CHAT_JOURNAL_TOOL_NAMES = [
  "read_workout_journal",
  "write_workout_brief",
  "log_workout_debrief"
] as const;

export type ChatJournalToolName = (typeof CHAT_JOURNAL_TOOL_NAMES)[number];

export function isChatJournalTool(name: string): name is ChatJournalToolName {
  return (CHAT_JOURNAL_TOOL_NAMES as readonly string[]).includes(name);
}

const DATE = { type: "string", description: "YYYYMMDD" } as const;
const WORKOUT_MATCH = {
  workout_name: { type: "string", description: "Workout name on that day; needed only when the day has more than one." },
  plan_id: { type: "string", description: "Schedule plan_id from list_scheduled_workouts, for an exact match." },
  id_in_plan: { type: "string", description: "Schedule id_in_plan from list_scheduled_workouts, for an exact match." }
} as const;

export function getChatJournalTools(): CorosMcpTool[] {
  if (!getTrainingHubStatus().authenticated) return [];
  return [
    {
      name: "read_workout_journal",
      description:
        "Read the athlete's workout journal: briefs written before workouts (goal, focus cues, fuel plan) and debriefs written after " +
        "(how it felt 1–5, which focus cues were hit, what they ate or drank and whether it sat well, notes). " +
        "Read it before advising on fueling, pacing or recurring problems, and to learn what the athlete has already tried.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: { ...DATE, description: "Start YYYYMMDD. Defaults to 60 days ago." },
          end_date: { ...DATE, description: "End YYYYMMDD. Defaults to 14 days from today." },
          fueling_only: { type: "boolean", description: "Only entries with fueling logged or planned." },
          limit: { type: "integer", minimum: 1, maximum: 60, description: "Most recent entries to return. Default 30." }
        }
      }
    },
    {
      name: "write_workout_brief",
      description:
        "Save a brief on a scheduled calendar workout so the athlete sees it before the session: a one-line goal, 2–4 concrete, " +
        "checkable focus cues (\"Keep HR under 150 on the climbs\", not \"run well\"), and an optional fuel plan. " +
        "The athlete checks the cues off in their debrief afterwards. Write one when the athlete asks, or after they agree to it. " +
        "Saved locally in CorosLink and shown in the calendar at once; nothing is sent to COROS.",
      inputSchema: {
        type: "object",
        properties: {
          schedule_date: { ...DATE, description: "Day of the scheduled workout, YYYYMMDD." },
          ...WORKOUT_MATCH,
          goal: { type: "string", description: "What the session is for, one line." },
          focus: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string" },
            description: "Focus cues to watch during the session, ideally 2–4."
          },
          fuel_plan: { type: "string", description: "What to eat or drink and when, if it matters for this session." },
          notes: { type: "string", description: "Anything else worth reading before the session." },
          replace: {
            type: "boolean",
            description: "Replace a brief the athlete wrote or edited. Only after the athlete agrees."
          }
        },
        required: ["schedule_date", "goal", "focus"]
      }
    },
    {
      name: "log_workout_debrief",
      description:
        "Record how a past workout went, from what the athlete told you in chat: feel 1–5, fueling (what, whether it was new, how it sat), " +
        "which brief focus cues they hit, and notes in their words. Merges with anything already logged. " +
        "Never invent details the athlete did not say. Saved locally in CorosLink.",
      inputSchema: {
        type: "object",
        properties: {
          date: { ...DATE, description: "Day of the workout, YYYYMMDD." },
          ...WORKOUT_MATCH,
          activity_id: { type: "string", description: "Recorded activity, for days without a scheduled workout." },
          feel: { type: "integer", minimum: 1, maximum: 5, description: "1 awful, 2 rough, 3 okay, 4 good, 5 great." },
          fueling_taken: { type: "string", description: "What they ate or drank, with timing if known." },
          fueling_new: { type: "boolean", description: "True when the fueling was something new they were trying." },
          fueling_outcome: { type: "string", enum: ["good", "mixed", "bad"], description: "good = sat well, bad = GI trouble or bonked." },
          focus_outcomes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                focus: { type: "string", description: "The brief's focus cue text." },
                outcome: { type: "string", enum: ["hit", "partial", "missed"] }
              },
              required: ["focus", "outcome"]
            }
          },
          notes: { type: "string", description: "How it went, in the athlete's words." }
        },
        required: ["date"]
      }
    }
  ];
}

function localDay(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sameName(left: string | undefined, right: string): boolean {
  return (left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

function looseName(left: string | undefined, right: string): boolean {
  const a = (left ?? "").trim().toLowerCase();
  const b = right.trim().toLowerCase();
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
}

function scheduledRef(entry: TrainingHubScheduledWorkoutEntry): WorkoutJournalRef {
  return {
    happenDay: entry.happenDay,
    planId: entry.planId,
    idInPlan: entry.idInPlan,
    workoutName: entry.name,
    sportType: entry.sportType
  };
}

function pickScheduled(
  entries: TrainingHubScheduledWorkoutEntry[],
  args: Record<string, unknown>
): TrainingHubScheduledWorkoutEntry | undefined {
  const planId = optionalString(args.plan_id);
  const idInPlan = optionalString(args.id_in_plan);
  if (planId && idInPlan) return entries.find((entry) => entry.planId === planId && entry.idInPlan === idInPlan);
  const name = optionalString(args.workout_name);
  if (name) {
    return entries.find((entry) => sameName(entry.name, name)) ??
      (entries.filter((entry) => looseName(entry.name, name)).length === 1
        ? entries.find((entry) => looseName(entry.name, name))
        : undefined);
  }
  return entries.length === 1 ? entries[0] : undefined;
}

function pickActivity(activities: TrainingHubActivity[], args: Record<string, unknown>): TrainingHubActivity | undefined {
  const activityId = optionalString(args.activity_id);
  if (activityId) return activities.find((activity) => activity.activityId === activityId);
  const name = optionalString(args.workout_name);
  if (name) return activities.find((activity) => looseName(activity.name ?? activity.sportName, name));
  return activities.length === 1 ? activities[0] : undefined;
}

function candidates(entries: TrainingHubScheduledWorkoutEntry[]) {
  return entries.map((entry) => ({ workout_name: entry.name, plan_id: entry.planId, id_in_plan: entry.idInPlan }));
}

function failure(error_code: string, action: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: false, error_code, action, ...extra });
}

export async function handleChatJournalTool(name: ChatJournalToolName, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === "read_workout_journal") return readJournal(args);
    if (name === "write_workout_brief") return await writeBrief(args);
    return await logDebrief(args);
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "The workout journal is unavailable." });
  }
}

function readJournal(args: Record<string, unknown>): string {
  const start = normalizeHappenDay(optionalString(args.start_date) ?? localDay(-60));
  const end = normalizeHappenDay(optionalString(args.end_date) ?? localDay(14));
  const requested = Number(args.limit);
  const limit = Number.isFinite(requested) ? Math.min(60, Math.max(1, Math.round(requested))) : 30;
  const entries = listWorkoutJournal(start, end)
    .filter((entry) => args.fueling_only !== true || entry.debrief?.fueling || entry.brief?.fuelPlan)
    .sort((left, right) => right.happenDay.localeCompare(left.happenDay))
    .slice(0, limit);
  return JSON.stringify({
    ok: true,
    range: { start_date: start, end_date: end },
    count: entries.length,
    journal: entries.length ? entries.map(formatJournalEntryForCoach).join("\n") : "No journal entries in this range."
  });
}

async function writeBrief(args: Record<string, unknown>): Promise<string> {
  const day = normalizeHappenDay(args.schedule_date ?? args.date);
  const entries = await listScheduledWorkoutEntries(day, day);
  const entry = pickScheduled(entries, args);
  if (!entry) {
    return entries.length
      ? failure("workout_ambiguous", "Call again with workout_name, or plan_id and id_in_plan, from the candidates.", { candidates: candidates(entries) })
      : failure("no_scheduled_workout", "There is no scheduled workout that day. Check the date with list_scheduled_workouts, or draft the workout first.");
  }
  const focus = Array.isArray(args.focus) ? args.focus.map((cue) => String(cue ?? "")) : [];
  const ref = scheduledRef(entry);
  const existing = getWorkoutJournalEntry(ref);
  if (!coachMayReplaceBrief(existing?.brief) && args.replace !== true) {
    return failure(
      "athlete_brief_exists",
      "The athlete already wrote or edited this brief. Show them your version and call again with replace=true only if they agree.",
      { existing: existing ? formatJournalEntryForCoach({ ...existing, debrief: undefined }) : undefined }
    );
  }
  const saved = saveWorkoutJournal({
    ref,
    brief: {
      goal: optionalString(args.goal),
      cues: focus.map((text) => ({ id: "", text })),
      fuelPlan: optionalString(args.fuel_plan),
      notes: optionalString(args.notes)
    }
  }, "coach");
  if (!saved?.brief) return failure("empty_brief", "Provide a goal and at least one focus cue.");
  return JSON.stringify({
    ok: true,
    saved: "brief",
    entry: formatJournalEntryForCoach(saved),
    action: "Tell the athlete the brief is on the workout in their calendar. Do not repeat it in full unless asked."
  });
}

function matchCue(cues: { id: string; text: string }[], focus: string): string | undefined {
  return cues.find((cue) => sameName(cue.text, focus))?.id ??
    cues.find((cue) => looseName(cue.text, focus))?.id;
}

async function logDebrief(args: Record<string, unknown>): Promise<string> {
  const day = normalizeHappenDay(args.date ?? args.schedule_date);
  const scheduled = await listScheduledWorkoutEntries(day, day);
  let ref: WorkoutJournalRef | undefined;
  const pickedScheduled = optionalString(args.activity_id) && !optionalString(args.plan_id) ? undefined : pickScheduled(scheduled, args);
  if (pickedScheduled) {
    ref = { ...scheduledRef(pickedScheduled), ...(optionalString(args.activity_id) ? { activityId: optionalString(args.activity_id) } : {}) };
  } else {
    const activities = await listTrainingHubActivities(1, 20, day, day);
    const activity = pickActivity(activities, args);
    if (activity) {
      ref = { happenDay: day, activityId: activity.activityId, workoutName: activity.name ?? activity.sportName, sportType: activity.sportType };
    } else if (scheduled.length || activities.length) {
      return failure("workout_ambiguous", "Call again with workout_name, plan_id and id_in_plan, or activity_id.", {
        candidates: [
          ...candidates(scheduled),
          ...activities.map((item) => ({ workout_name: item.name ?? item.sportName, activity_id: item.activityId }))
        ]
      });
    } else {
      return failure("no_workout", "Nothing was scheduled or recorded that day. Check the date with the athlete.");
    }
  }

  const existing = getWorkoutJournalEntry(ref);
  const previous = existing?.debrief;
  const cues = existing?.brief?.cues ?? [];
  const cueOutcomes: Record<string, WorkoutCueOutcome> = { ...previous?.cueOutcomes };
  const unmatched: string[] = [];
  for (const item of Array.isArray(args.focus_outcomes) ? args.focus_outcomes : []) {
    const focus = optionalString((item as { focus?: unknown })?.focus);
    const outcome = (item as { outcome?: unknown })?.outcome as WorkoutCueOutcome;
    if (!focus || !["hit", "partial", "missed"].includes(outcome)) continue;
    const id = matchCue(cues, focus);
    if (id) cueOutcomes[id] = outcome;
    else unmatched.push(focus);
  }
  const notes = optionalString(args.notes);
  const fuelingGiven = args.fueling_taken !== undefined || args.fueling_new !== undefined || args.fueling_outcome !== undefined;
  const saved = saveWorkoutJournal({
    ref,
    debrief: {
      feel: args.feel === undefined ? previous?.feel : Number(args.feel) as WorkoutFeel,
      cueOutcomes,
      fueling: fuelingGiven
        ? {
            taken: optionalString(args.fueling_taken) ?? previous?.fueling?.taken,
            experiment: typeof args.fueling_new === "boolean" ? args.fueling_new : previous?.fueling?.experiment,
            outcome: (optionalString(args.fueling_outcome) as WorkoutFuelOutcome | undefined) ?? previous?.fueling?.outcome
          }
        : previous?.fueling,
      // Keep what the athlete already wrote; add the new account below it.
      notes: notes && previous?.notes && !previous.notes.includes(notes) ? `${previous.notes}\n\n${notes}` : notes ?? previous?.notes
    }
  }, "coach");
  if (!saved?.debrief) return failure("empty_debrief", "Include at least a feel, fueling, focus outcome or notes from the athlete.");
  return JSON.stringify({
    ok: true,
    saved: "debrief",
    entry: formatJournalEntryForCoach(saved),
    ...(unmatched.length ? { unmatched_focus: unmatched, note: "These did not match a focus cue on the brief and were not recorded." } : {}),
    action: "Tell the athlete it is logged in their workout journal."
  });
}

/** The athlete's recent debriefs and upcoming briefs, for the Coach's context. */
export function formatWorkoutJournalContext(options: { past: boolean; upcoming: boolean }): string {
  if (!options.past && !options.upcoming) return "";
  try {
    const today = localDay();
    const entries = listWorkoutJournal(localDay(-14), localDay(10)).filter((entry) =>
      entry.happenDay < today ? options.past && entry.debrief : options.upcoming && (entry.brief || entry.debrief)
    );
    return entries.slice(-12).map(formatJournalEntryForCoach).join("\n");
  } catch {
    return "";
  }
}
