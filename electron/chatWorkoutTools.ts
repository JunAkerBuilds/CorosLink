import crypto from "node:crypto";
import {
  buildPlanPreview,
  formatScheduleDay,
  validatePlanDraft,
  type CorosTrainingPlanDraft,
  type PlanWorkoutEntry
} from "./corosWorkoutBuilder";
import {
  deleteWorkout,
  getTrainingHubStatus,
  getUpcomingWorkouts,
  listScheduledWorkoutEntries,
  uploadTrainingPlan
} from "./trainingHubService";
import type {
  CorosMcpTool,
  CorosTrainingPlanDraftInput,
  DeleteWorkoutResult,
  PlanDraftPreview,
  PlanWorkoutEntryInput,
  UploadPlanResult,
  WorkoutDeletePreview
} from "./types";

interface StoredPlanDraft {
  draftId: string;
  plan: CorosTrainingPlanDraft;
  preview: PlanDraftPreview;
  createdAt: number;
  uploadedAt?: number;
}

interface StoredDeleteRequest {
  requestId: string;
  params: DeleteWorkoutParams;
  preview: WorkoutDeletePreview;
  createdAt: number;
  executedAt?: number;
}

interface DeleteWorkoutParams {
  target: "scheduled" | "library" | "both";
  schedule_date?: string;
  workout_name?: string;
  program_id?: string;
  plan_id?: string;
  id_in_plan?: string;
  plan_program_id?: string;
}

const draftStore = new Map<string, StoredPlanDraft>();
const deleteRequestStore = new Map<string, StoredDeleteRequest>();

export const CHAT_WORKOUT_TOOL_NAMES = [
  "draft_training_plan",
  "upload_training_plan",
  "list_scheduled_workouts",
  "delete_workout"
] as const;

export type ChatWorkoutToolName = (typeof CHAT_WORKOUT_TOOL_NAMES)[number];

export function isChatWorkoutTool(name: string): name is ChatWorkoutToolName {
  return (CHAT_WORKOUT_TOOL_NAMES as readonly string[]).includes(name);
}

export function getChatWorkoutTools(): CorosMcpTool[] {
  const hubStatus = getTrainingHubStatus();
  if (!hubStatus.authenticated) {
    return [];
  }

  return [
    {
      name: "draft_training_plan",
      description:
        "Validate and store a multi-day training plan draft for the athlete to review. " +
        "Always call this before attempting upload. Returns a draftId and human-readable preview.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Plan name, e.g. '4-Week 10K Build'" },
          workouts: {
            type: "array",
            description: "Workouts in the plan",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Unique key within the plan" },
                name: { type: "string", description: "Workout display name" },
                distance_km: {
                  type: "number",
                  description: "Simple easy run distance in km (omit if using steps)"
                },
                schedule_date: {
                  type: "string",
                  description: "YYYYMMDD calendar date to schedule this workout"
                },
                sort_no: {
                  type: "number",
                  description: "Order on the day (default 1)"
                },
                save_to_library: {
                  type: "boolean",
                  description: "Save to COROS workout library (default true)"
                },
                steps: {
                  type: "array",
                  description:
                    "Structured run steps. Plain step: kind (warmup|training|rest|cooldown), " +
                    "target_type (distance|time), target_distance_meters or target_duration_seconds, " +
                    "optional pace string. Repeat group: { repeat, steps: [...] }."
                }
              },
              required: ["key", "name"]
            }
          }
        },
        required: ["name", "workouts"]
      }
    },
    {
      name: "upload_training_plan",
      description:
        "Upload a previously drafted plan to COROS. Only call after the athlete confirms " +
        "via the Upload button in chat — otherwise tell them to review the preview first.",
      inputSchema: {
        type: "object",
        properties: {
          draft_id: { type: "string", description: "draftId from draft_training_plan" },
          confirmed: {
            type: "boolean",
            description: "Must be true only after explicit athlete confirmation"
          }
        },
        required: ["draft_id"]
      }
    },
    {
      name: "list_scheduled_workouts",
      description:
        "List workouts on the COROS training calendar for a date range. " +
        "Use before delete_workout to get plan_id and id_in_plan when needed.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: {
            type: "string",
            description: "Start date YYYYMMDD (defaults to today)"
          },
          end_date: {
            type: "string",
            description: "End date YYYYMMDD (defaults to 14 days from start)"
          }
        }
      }
    },
    {
      name: "delete_workout",
      description:
        "Stage a workout deletion for the athlete to confirm. " +
        "Shows a Delete from COROS button in chat — never deletes directly. " +
        "For calendar: provide schedule_date + workout_name, or plan_id + id_in_plan. " +
        "For library: provide program_id or workout_name with target library/both.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["scheduled", "library", "both"],
            description: "Where to delete from"
          },
          schedule_date: {
            type: "string",
            description: "YYYYMMDD for calendar delete"
          },
          workout_name: {
            type: "string",
            description: "Workout name to match"
          },
          program_id: {
            type: "string",
            description: "Library program ID"
          },
          plan_id: { type: "string", description: "Schedule plan ID" },
          id_in_plan: { type: "string", description: "Schedule idInPlan" },
          plan_program_id: {
            type: "string",
            description: "Optional schedule planProgramId"
          }
        },
        required: ["target"]
      }
    }
  ];
}

export function getStoredPlanDraft(draftId: string): StoredPlanDraft | undefined {
  return draftStore.get(draftId);
}

export function listStoredPlanDrafts(): PlanDraftPreview[] {
  return [...draftStore.values()].map((entry) => entry.preview);
}

export async function handleChatWorkoutTool(
  name: ChatWorkoutToolName,
  args: Record<string, unknown>,
  options?: {
    onPlanDraft?: (preview: PlanDraftPreview) => void;
    onWorkoutDelete?: (preview: WorkoutDeletePreview) => void;
  }
): Promise<string> {
  if (name === "draft_training_plan") {
    return handleDraftTrainingPlan(args, options?.onPlanDraft);
  }
  if (name === "upload_training_plan") {
    return handleUploadTrainingPlan(args);
  }
  if (name === "list_scheduled_workouts") {
    return handleListScheduledWorkouts(args);
  }
  return handleDeleteWorkout(args, options?.onWorkoutDelete);
}

function toPlanDraft(args: Record<string, unknown>): CorosTrainingPlanDraft {
  const name = String(args.name ?? "").trim();
  const rawWorkouts = Array.isArray(args.workouts) ? args.workouts : [];
  const workouts: PlanWorkoutEntry[] = rawWorkouts.map((item, index) => {
    const entry = (item ?? {}) as PlanWorkoutEntryInput;
    return {
      key: String(entry.key ?? `workout-${index + 1}`).trim(),
      name: String(entry.name ?? `Workout ${index + 1}`).trim(),
      steps: entry.steps as PlanWorkoutEntry["steps"],
      distance_km: entry.distance_km,
      schedule_date: entry.schedule_date
        ? String(entry.schedule_date).replace(/-/g, "")
        : undefined,
      sort_no: entry.sort_no,
      save_to_library: entry.save_to_library
    };
  });
  return { name, workouts };
}

async function detectScheduleConflicts(
  draft: CorosTrainingPlanDraft
): Promise<string[]> {
  const scheduledDates = [
    ...new Set(
      draft.workouts
        .map((entry) => entry.schedule_date)
        .filter((day): day is string => Boolean(day))
    )
  ];
  if (scheduledDates.length === 0) {
    return [];
  }

  const upcoming = await getUpcomingWorkouts(28);
  const conflicts: string[] = [];

  for (const entry of draft.workouts) {
    if (!entry.schedule_date) {
      continue;
    }
    const existing = upcoming.filter(
      (workout) => workout.happenDay === entry.schedule_date
    );
    if (existing.length > 0) {
      const names = existing.map((workout) => workout.name).join(", ");
      conflicts.push(
        `${entry.schedule_date}: already has ${names} — adding "${entry.name}"`
      );
    }
  }

  return conflicts;
}

async function handleDraftTrainingPlan(
  args: Record<string, unknown>,
  onPlanDraft?: (preview: PlanDraftPreview) => void
): Promise<string> {
  const draft = toPlanDraft(args);
  const validation = validatePlanDraft(draft, {
    todayDay: formatScheduleDay(new Date())
  });
  if (!validation.ok) {
    return JSON.stringify({ ok: false, errors: validation.errors });
  }

  const conflicts = await detectScheduleConflicts(draft);
  const draftId = crypto.randomUUID();
  const preview = buildPlanPreview(draftId, draft, {
    scheduleConflicts: conflicts
  });
  preview.conflicts = conflicts;

  draftStore.set(draftId, {
    draftId,
    plan: draft,
    preview,
    createdAt: Date.now()
  });

  onPlanDraft?.(preview);

  return JSON.stringify({
    ok: true,
    draft_id: draftId,
    preview: {
      name: preview.name,
      summary: preview.summary,
      entries: preview.entries,
      conflicts: preview.conflicts,
      warnings: preview.warnings
    },
    message:
      "Draft saved. Tell the athlete to review the plan preview and click Upload to COROS " +
      "when ready. Do not call upload_training_plan until they confirm."
  });
}

async function handleUploadTrainingPlan(
  args: Record<string, unknown>
): Promise<string> {
  const draftId = String(args.draft_id ?? args.draftId ?? "").trim();
  const confirmed = args.confirmed === true;

  if (!draftId) {
    return JSON.stringify({ ok: false, error: "draft_id is required." });
  }

  const stored = draftStore.get(draftId);
  if (!stored) {
    return JSON.stringify({
      ok: false,
      error: "Draft not found. Call draft_training_plan first."
    });
  }

  if (stored.uploadedAt) {
    return JSON.stringify({
      ok: false,
      error: "This draft was already uploaded.",
      uploaded_at: stored.uploadedAt
    });
  }

  if (!confirmed) {
    return JSON.stringify({
      ok: false,
      error:
        "Upload requires athlete confirmation. Ask them to click Upload to COROS in the chat preview, " +
        "or pass confirmed: true only after they explicitly approve."
    });
  }

  const input: CorosTrainingPlanDraftInput = {
    name: stored.plan.name,
    workouts: stored.plan.workouts.map((entry) => ({
      key: entry.key,
      name: entry.name,
      steps: entry.steps,
      distance_km: entry.distance_km,
      schedule_date: entry.schedule_date,
      sort_no: entry.sort_no,
      save_to_library: entry.save_to_library
    }))
  };

  const result = await uploadTrainingPlan(input);
  stored.uploadedAt = Date.now();

  return JSON.stringify({
    ok: true,
    result: summarizeUploadResult(result),
    message: `Uploaded "${result.planName}" — ${result.workoutsScheduled} scheduled, ${result.workoutsCreated} saved to library.`
  });
}

async function handleListScheduledWorkouts(
  args: Record<string, unknown>
): Promise<string> {
  const today = formatScheduleDay(new Date());
  const startDate = String(args.start_date ?? args.startDate ?? today)
    .replace(/-/g, "")
    .trim();
  let endDate = String(args.end_date ?? args.endDate ?? "").replace(/-/g, "").trim();

  if (!/^\d{8}$/.test(startDate)) {
    return JSON.stringify({ ok: false, error: "start_date must be YYYYMMDD." });
  }

  if (!endDate) {
    const end = new Date(
      Number(startDate.slice(0, 4)),
      Number(startDate.slice(4, 6)) - 1,
      Number(startDate.slice(6, 8))
    );
    end.setDate(end.getDate() + 13);
    endDate = formatScheduleDay(end);
  }

  if (!/^\d{8}$/.test(endDate)) {
    return JSON.stringify({ ok: false, error: "end_date must be YYYYMMDD." });
  }

  const entries = await listScheduledWorkoutEntries(startDate, endDate);
  return JSON.stringify({
    ok: true,
    count: entries.length,
    workouts: entries.map((entry) => ({
      schedule_date: entry.happenDay,
      name: entry.name,
      plan_id: entry.planId,
      id_in_plan: entry.idInPlan,
      plan_program_id: entry.planProgramId,
      program_id: entry.programId,
      sort_no: entry.sortNo
    }))
  });
}

async function handleDeleteWorkout(
  args: Record<string, unknown>,
  onWorkoutDelete?: (preview: WorkoutDeletePreview) => void
): Promise<string> {
  let params: DeleteWorkoutParams;
  try {
    params = parseDeleteWorkoutParams(args);
  } catch (caught) {
    return JSON.stringify({
      ok: false,
      error: caught instanceof Error ? caught.message : String(caught)
    });
  }

  try {
    const preview = await buildWorkoutDeletePreview(params);
    deleteRequestStore.set(preview.requestId, {
      requestId: preview.requestId,
      params,
      preview,
      createdAt: Date.now()
    });
    onWorkoutDelete?.(preview);

    return JSON.stringify({
      ok: true,
      request_id: preview.requestId,
      preview,
      message:
        "Delete request staged. Tell the athlete to review the confirmation card " +
        "and click Delete from COROS when ready. Do not claim the workout was removed until they confirm."
    });
  } catch (caught) {
    return JSON.stringify({
      ok: false,
      error: caught instanceof Error ? caught.message : String(caught)
    });
  }
}

function parseDeleteWorkoutParams(
  args: Record<string, unknown>
): DeleteWorkoutParams {
  const target = String(args.target ?? "").trim() as DeleteWorkoutParams["target"];
  if (!["scheduled", "library", "both"].includes(target)) {
    throw new Error("target must be scheduled, library, or both.");
  }

  const scheduleDate = args.schedule_date
    ? String(args.schedule_date).replace(/-/g, "").trim()
    : args.scheduleDate
      ? String(args.scheduleDate).replace(/-/g, "").trim()
      : undefined;

  if (scheduleDate && !/^\d{8}$/.test(scheduleDate)) {
    throw new Error("schedule_date must be YYYYMMDD.");
  }

  const params: DeleteWorkoutParams = {
    target,
    schedule_date: scheduleDate,
    workout_name: args.workout_name
      ? String(args.workout_name).trim()
      : args.workoutName
        ? String(args.workoutName).trim()
        : undefined,
    program_id: args.program_id
      ? String(args.program_id).trim()
      : args.programId
        ? String(args.programId).trim()
        : undefined,
    plan_id: args.plan_id ? String(args.plan_id).trim() : undefined,
    id_in_plan: args.id_in_plan ? String(args.id_in_plan).trim() : undefined,
    plan_program_id: args.plan_program_id
      ? String(args.plan_program_id).trim()
      : undefined
  };

  if (target === "scheduled" || target === "both") {
    const hasScheduleIds = params.plan_id && params.id_in_plan;
    const hasScheduleLookup = params.schedule_date && params.workout_name;
    if (!hasScheduleIds && !hasScheduleLookup) {
      throw new Error(
        "Scheduled delete requires schedule_date + workout_name, or plan_id + id_in_plan."
      );
    }
  }

  if (target === "library" || target === "both") {
    if (!params.program_id && !params.workout_name) {
      throw new Error(
        "Library delete requires program_id or workout_name."
      );
    }
  }

  return params;
}

function formatDisplayScheduleDate(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(normalized)) return value;
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function buildDeleteSummary(params: DeleteWorkoutParams): string {
  const parts: string[] = [];
  const name = params.workout_name;
  const date = formatDisplayScheduleDate(params.schedule_date);

  if (params.target === "scheduled" || params.target === "both") {
    if (name && date) {
      parts.push(`Remove "${name}" from your calendar on ${date}`);
    } else if (params.plan_id && params.id_in_plan) {
      parts.push("Remove the scheduled workout from your calendar");
    } else {
      parts.push("Remove from calendar");
    }
  }

  if (params.target === "library" || params.target === "both") {
    if (name) {
      parts.push(`Delete "${name}" from your workout library`);
    } else if (params.program_id) {
      parts.push("Delete the workout from your library");
    } else {
      parts.push("Delete from workout library");
    }
  }

  return parts.join(". ");
}

async function buildWorkoutDeletePreview(
  params: DeleteWorkoutParams
): Promise<WorkoutDeletePreview> {
  let workoutName = params.workout_name;
  let scheduleDate = params.schedule_date;
  let programId = params.program_id;

  if (params.target === "scheduled" || params.target === "both") {
    let scheduleEntry:
      | Awaited<ReturnType<typeof listScheduledWorkoutEntries>>[number]
      | undefined;

    if (params.plan_id && params.id_in_plan) {
      const entries = scheduleDate
        ? await listScheduledWorkoutEntries(scheduleDate, scheduleDate)
        : await listScheduledWorkoutEntries(
            formatScheduleDay(new Date()),
            formatScheduleDay(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))
          );
      scheduleEntry = entries.find(
        (entry) =>
          entry.planId === params.plan_id &&
          entry.idInPlan === params.id_in_plan
      );
    } else if (scheduleDate && workoutName) {
      const entries = await listScheduledWorkoutEntries(
        scheduleDate,
        scheduleDate
      );
      const matches = entries.filter((entry) => entry.name === workoutName);
      if (matches.length > 1) {
        throw new Error(
          `Multiple scheduled workouts named "${workoutName}" on ${scheduleDate}. ` +
            "Use plan_id and id_in_plan to disambiguate."
        );
      }
      scheduleEntry = matches[0];
    }

    if (!scheduleEntry) {
      throw new Error("Scheduled workout not found on COROS calendar.");
    }

    workoutName = workoutName ?? scheduleEntry.name;
    scheduleDate = scheduleEntry.happenDay;
    programId = programId ?? scheduleEntry.programId;
  }

  const requestId = crypto.randomUUID();
  const enriched: DeleteWorkoutParams = {
    ...params,
    workout_name: workoutName,
    schedule_date: scheduleDate,
    program_id: programId
  };

  return {
    requestId,
    target: params.target,
    workoutName,
    scheduleDate: formatDisplayScheduleDate(scheduleDate),
    programId,
    summary: buildDeleteSummary(enriched)
  };
}

export async function confirmWorkoutDeleteById(
  requestId: string
): Promise<DeleteWorkoutResult> {
  const stored = deleteRequestStore.get(requestId);
  if (!stored) {
    throw new Error("Workout delete request not found or expired.");
  }
  if (stored.executedAt) {
    throw new Error("This workout was already deleted.");
  }

  const result = await deleteWorkout(stored.params);
  stored.executedAt = Date.now();
  return result;
}

export async function uploadPlanDraftById(
  draftId: string
): Promise<UploadPlanResult> {
  const stored = draftStore.get(draftId);
  if (!stored) {
    throw new Error("Training plan draft not found or expired.");
  }
  if (stored.uploadedAt) {
    throw new Error("This training plan was already uploaded.");
  }

  const input: CorosTrainingPlanDraftInput = {
    name: stored.plan.name,
    workouts: stored.plan.workouts.map((entry) => ({
      key: entry.key,
      name: entry.name,
      steps: entry.steps,
      distance_km: entry.distance_km,
      schedule_date: entry.schedule_date,
      sort_no: entry.sort_no,
      save_to_library: entry.save_to_library
    }))
  };

  const result = await uploadTrainingPlan(input);
  stored.uploadedAt = Date.now();
  return result;
}

function summarizeUploadResult(result: UploadPlanResult): Record<string, unknown> {
  return {
    plan_name: result.planName,
    workouts_created: result.workoutsCreated,
    workouts_scheduled: result.workoutsScheduled,
    entries: result.entries
  };
}

/** Remove drafts older than 24 hours */
export function prunePlanDraftStore(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, draft] of draftStore) {
    if (draft.createdAt < cutoff) {
      draftStore.delete(id);
    }
  }
}

/** Remove delete requests older than 24 hours */
export function pruneDeleteRequestStore(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, request] of deleteRequestStore) {
    if (request.createdAt < cutoff) {
      deleteRequestStore.delete(id);
    }
  }
}
