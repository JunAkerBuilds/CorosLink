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
  formatScheduledExercisesForChat,
  getTrainingHubStatus,
  listScheduledWorkoutEntries,
  resolveTrainingPlanExercises,
  uploadTrainingPlan
} from "./trainingHubService";
import {
  getChatPlanDraft,
  listChatPlanDrafts,
  markChatPlanDraftUploaded,
  pruneChatPlanDrafts,
  saveChatPlanDraft
} from "./database";
import type {
  CorosMcpTool,
  CorosTrainingPlanDraftInput,
  DeleteWorkoutResult,
  PlanDraftPreview,
  PlanWorkoutEntryInput,
  TrainingPlanDestination,
  TrainingPlanDocument,
  UploadPlanResult,
  WorkoutDeletePreview,
  UnitSystem
} from "./types";
import { buildDraftTrainingPlanInputSchema } from "./workoutCapabilities";
import { formatDistanceValue } from "./unitSystem.js";
import { createTrainingPlan } from "./trainingPlanDomain";
import { saveLocalTrainingPlan } from "./trainingLibraryService";

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

function persistPlanDraft(stored: StoredPlanDraft): void {
  draftStore.set(stored.draftId, stored);
  saveChatPlanDraft({
    draftId: stored.draftId,
    planJson: JSON.stringify(stored.plan),
    previewJson: JSON.stringify(stored.preview),
    createdAt: stored.createdAt,
    uploadedAt: stored.uploadedAt
  });
}

function loadStoredPlanDraft(draftId: string): StoredPlanDraft | undefined {
  const cached = draftStore.get(draftId);
  if (cached) {
    return cached;
  }

  const row = getChatPlanDraft(draftId);
  if (!row) {
    return undefined;
  }

  try {
    const plan = JSON.parse(row.planJson) as CorosTrainingPlanDraft;
    const preview = JSON.parse(row.previewJson) as PlanDraftPreview;
    const stored: StoredPlanDraft = {
      draftId: row.draftId,
      plan,
      preview: {
        ...preview,
        uploadedAt: row.uploadedAt ?? preview.uploadedAt
      },
      createdAt: row.createdAt,
      uploadedAt: row.uploadedAt
    };
    draftStore.set(draftId, stored);
    return stored;
  } catch {
    return undefined;
  }
}

export function hydratePlanDraftStoreFromDatabase(): void {
  for (const row of listChatPlanDrafts()) {
    if (draftStore.has(row.draftId)) {
      continue;
    }
    try {
      draftStore.set(row.draftId, {
        draftId: row.draftId,
        plan: JSON.parse(row.planJson) as CorosTrainingPlanDraft,
        preview: JSON.parse(row.previewJson) as PlanDraftPreview,
        createdAt: row.createdAt,
        uploadedAt: row.uploadedAt
      });
    } catch {
      // Skip corrupted rows.
    }
  }
}

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
        "Validate and store a sport-aware training plan draft for athlete review. " +
        "Put prescribed HR, pace, power, cadence, stroke, weight, RPE, or grade in each step's typed intensity field. " +
        "Strength and HYROX exercise names are checked against the COROS catalog; if candidates are returned, " +
        "revise the affected steps and call this tool again. Always call this before upload. Returns a draftId and human-readable preview.",
      inputSchema: buildDraftTrainingPlanInputSchema()
    },
    {
      name: "upload_training_plan",
      description:
        "Compatibility guard for plan uploads. Plan writes can only be initiated by the athlete " +
        "from the confirmation card; this tool never performs a remote write.",
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
    allowUpcomingWorkouts?: boolean;
    unitSystem?: UnitSystem;
  }
): Promise<string> {
  if (name === "draft_training_plan") {
    return handleDraftTrainingPlan(
      args,
      options?.onPlanDraft,
      options?.allowUpcomingWorkouts !== false,
      options?.unitSystem ?? "metric"
    );
  }
  if (name === "upload_training_plan") {
    return handleUploadTrainingPlan(args, options?.unitSystem ?? "metric");
  }
  if (name === "list_scheduled_workouts") {
    return handleListScheduledWorkouts(args, options?.unitSystem ?? "metric");
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
      sport: entry.sport ?? "run",
      sport_options: entry.sport_options,
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

export function buildTrainingPlanUploadInput(
  plan: CorosTrainingPlanDraft
): CorosTrainingPlanDraftInput {
  return {
    name: plan.name,
    workouts: plan.workouts.map((entry) => ({
      key: entry.key,
      name: entry.name,
      description: entry.description,
      sport: entry.sport ?? "run",
      sport_options: entry.sport_options,
      steps: entry.steps,
      distance_km: entry.distance_km,
      schedule_date: entry.schedule_date,
      sort_no: entry.sort_no,
      save_to_library: entry.save_to_library
    }))
  };
}

function normalizePlanDate(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) return undefined;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function dateDayOffset(start: string, current: string): number {
  const startDate = new Date(`${start}T12:00:00`);
  const currentDate = new Date(`${current}T12:00:00`);
  return Math.max(0, Math.round((currentDate.valueOf() - startDate.valueOf()) / 86_400_000));
}

function saveDraftAsLocalTemplate(
  draftId: string,
  plan: CorosTrainingPlanDraft
): TrainingPlanDocument {
  const scheduledDates = plan.workouts
    .map((entry) => normalizePlanDate(entry.schedule_date))
    .filter((date): date is string => Boolean(date))
    .sort();
  const startDate = scheduledDates[0];
  const document = createTrainingPlan(plan.name, "template");
  document.id = `template:coach:${draftId}`;
  document.description = "Generated in Coach and saved locally for reuse.";
  document.startDate = startDate;
  document.entries = plan.workouts.map((workout, index) => {
    const scheduledDate = normalizePlanDate(workout.schedule_date);
    const offset = startDate && scheduledDate
      ? dateDayOffset(startDate, scheduledDate)
      : undefined;
    return {
      id: `entry:${draftId}:${workout.key || index}`,
      kind: "workout" as const,
      weekIndex: offset === undefined ? Math.floor(index / 7) : Math.floor(offset / 7),
      dayIndex: offset === undefined ? undefined : offset % 7,
      sortOrder: workout.sort_no ?? index,
      title: workout.name,
      workout: {
        key: workout.key,
        name: workout.name,
        description: workout.description,
        sport: workout.sport ?? "run",
        sport_options: workout.sport_options,
        steps: workout.steps,
        distance_km: workout.distance_km,
        schedule_date: workout.schedule_date,
        sort_no: workout.sort_no,
        save_to_library: workout.save_to_library
      }
    };
  });
  document.weekCount = Math.max(
    1,
    ...document.entries.map((entry) => entry.weekIndex + 1)
  );
  document.sportMix = [
    ...new Set(plan.workouts.map((entry) => entry.sport ?? "run"))
  ];
  return saveLocalTrainingPlan(document);
}

function inputForDestination(
  plan: CorosTrainingPlanDraft,
  destination: TrainingPlanDestination
): CorosTrainingPlanDraftInput {
  const input = buildTrainingPlanUploadInput(plan);
  if (destination === "workoutLibrary") {
    return {
      ...input,
      workouts: input.workouts.map((workout) => ({
        ...workout,
        schedule_date: undefined,
        save_to_library: true
      }))
    };
  }
  if (destination === "calendar") {
    const unscheduled = input.workouts.filter((workout) => !workout.schedule_date);
    if (unscheduled.length > 0) {
      throw new Error(
        `${unscheduled.length} workout${unscheduled.length === 1 ? " is" : "s are"} missing a date. Add dates before choosing Calendar.`
      );
    }
    return {
      ...input,
      workouts: input.workouts.map((workout) => ({
        ...workout,
        save_to_library: false
      }))
    };
  }
  return input;
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

  scheduledDates.sort();
  const upcoming = await listScheduledWorkoutEntries(
    scheduledDates[0]!,
    scheduledDates[scheduledDates.length - 1]!
  );
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
  onPlanDraft?: (preview: PlanDraftPreview) => void,
  allowUpcomingWorkouts = true,
  unitSystem: UnitSystem = "metric"
): Promise<string> {
  const draft = toPlanDraft(args);
  const validation = validatePlanDraft(draft, {
    todayDay: formatScheduleDay(new Date())
  });
  if (!validation.ok) {
    return JSON.stringify({ ok: false, errors: validation.errors });
  }

  const exerciseResolution = await resolveTrainingPlanExercises(draft);
  if (exerciseResolution.issues.length > 0) {
    return JSON.stringify({
      ok: false,
      error_code: "exercise_resolution_required",
      issues: exerciseResolution.issues.map((issue) => ({
        workout_key: issue.workoutKey,
        workout_name: issue.workoutName,
        sport: issue.sport,
        exercise_name: issue.exerciseName,
        reason: issue.reason,
        candidates: issue.candidates,
        message: issue.message
      })),
      action: exerciseResolution.issues.every((issue) => issue.candidates.length > 0)
        ? "Update each affected step to the exact best-matching candidate and call draft_training_plan again now. Ask the athlete only when the candidates materially change the intended movement."
        : "At least one exercise is unavailable. Ask the athlete for a supported alternative, then call draft_training_plan again."
    });
  }
  const resolvedDraft = exerciseResolution.draft;

  const conflicts = allowUpcomingWorkouts
    ? await detectScheduleConflicts(resolvedDraft)
    : [];
  const draftId = crypto.randomUUID();
  const preview = buildPlanPreview(draftId, resolvedDraft, {
    scheduleConflicts: conflicts,
    unitSystem
  });
  preview.conflicts = conflicts;

  draftStore.set(draftId, {
    draftId,
    plan: resolvedDraft,
    preview,
    createdAt: Date.now()
  });
  persistPlanDraft(draftStore.get(draftId)!);

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
  args: Record<string, unknown>,
  _unitSystem: UnitSystem
): Promise<string> {
  const draftId = String(args.draft_id ?? args.draftId ?? "").trim();
  if (!draftId) {
    return JSON.stringify({ ok: false, error: "draft_id is required." });
  }

  const stored = loadStoredPlanDraft(draftId);
  if (!stored) {
    return JSON.stringify({
      ok: false,
      error:
        "Draft not found or expired. Ask the athlete to ask you to regenerate this training plan."
    });
  }

  if (stored.uploadedAt) {
    return JSON.stringify({
      ok: false,
      error: "This draft was already uploaded.",
      uploaded_at: stored.uploadedAt
    });
  }

  return JSON.stringify({
    ok: false,
    confirmation_required: true,
    error:
      "Plan writes cannot run from an AI tool call. Ask the athlete to choose a destination and confirm the plan card."
  });
}

async function handleListScheduledWorkouts(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
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
      volume: formatScheduledVolume(entry.volume, unitSystem),
      training_load: entry.trainingLoad,
      exercises: entry.exercises?.length
        ? formatScheduledExercisesForChat(
            entry.exercises,
            unitSystem,
            Number(entry.sportType) === 3
          )
        : undefined,
      plan_id: entry.planId,
      id_in_plan: entry.idInPlan,
      plan_program_id: entry.planProgramId,
      program_id: entry.programId,
      sort_no: entry.sortNo
    }))
  });
}

function formatScheduledVolume(
  volume: string | undefined,
  unitSystem: UnitSystem
): string | undefined {
  const value = volume?.trim();
  if (!value) return volume;
  const match = value.match(/^([\d.]+)\s*(km|m)$/i);
  if (!match) return volume;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return volume;
  const swim = match[2]?.toLowerCase() === "m";
  return formatDistanceValue(amount * (swim ? 1 : 1_000), unitSystem, { swim });
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
  draftId: string,
  unitSystem: UnitSystem = "metric",
  destination: TrainingPlanDestination = "workoutLibrary"
): Promise<UploadPlanResult> {
  const stored = loadStoredPlanDraft(draftId);
  if (!stored) {
    throw new Error(
      "Training plan draft not found or expired. Ask the coach to regenerate this plan."
    );
  }
  if (stored.uploadedAt) {
    throw new Error("This training plan was already uploaded.");
  }

  if (destination === "nativePlan" || destination === "nativePlanAndCalendar") {
    throw new Error(
      "Native COROS plan writes are unavailable because the create/update payload has not been live-verified safely. Choose Workout Library, Calendar, or Local template."
    );
  }

  let result: UploadPlanResult;
  if (destination === "localTemplate") {
    const saved = saveDraftAsLocalTemplate(draftId, stored.plan);
    result = {
      planName: saved.name,
      workoutsCreated: 0,
      workoutsScheduled: 0,
      entries: [],
      destination,
      localPlanId: saved.id,
      groupedPlanCreated: false,
      remoteWrites: []
    };
  } else {
    const input = inputForDestination(stored.plan, destination);
    const uploaded = await uploadTrainingPlan(input, unitSystem);
    result = {
      ...uploaded,
      destination,
      groupedPlanCreated: false,
      remoteWrites: destination === "calendar"
        ? input.workouts.map((workout) => `Schedule ${workout.name} on ${workout.schedule_date}`)
        : input.workouts.map((workout) => `Create workout ${workout.name}`)
    };
  }
  stored.uploadedAt = Date.now();
  stored.preview.uploadedAt = stored.uploadedAt;
  stored.preview.uploadResult = {
    workoutsScheduled: result.workoutsScheduled,
    workoutsCreated: result.workoutsCreated,
    destination,
    localPlanId: result.localPlanId,
    groupedPlanCreated: result.groupedPlanCreated
  };
  persistPlanDraft(stored);
  markChatPlanDraftUploaded(draftId, stored.uploadedAt);
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
    if (draft.createdAt < cutoff && !draft.uploadedAt) {
      draftStore.delete(id);
    }
  }
  pruneChatPlanDrafts(cutoff);
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
