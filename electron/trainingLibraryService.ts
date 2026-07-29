import crypto from "node:crypto";
import {
  deleteTrainingCollection,
  deleteTrainingPlanDocument,
  getTrainingPlanDocument,
  listCachedTrainingLibraryWorkouts,
  listTrainingActivityMatches,
  listTrainingCollections,
  listTrainingPlanDocuments,
  listTrainingWorkoutMetadata,
  saveTrainingActivityMatch,
  saveTrainingCollection,
  saveTrainingPlanDocument,
  saveTrainingWorkoutMetadata
} from "./database";
import {
  listNativeCorosPlans,
  readNativeCorosPlan
} from "./corosTrainingPlanAdapter";
import {
  deleteWorkoutProgram,
  listLibraryWorkouts,
  listScheduledWorkoutEntries,
  listTrainingHubActivities
} from "./trainingHubService";
import {
  validateTrainingPlan,
  workoutSportFromType
} from "./trainingPlanDomain";
import type {
  NativeCorosPlanDetail,
  NativeCorosPlanSummary,
  TrainingActivityMatch,
  TrainingCollection,
  TrainingHubActivity,
  TrainingHubLibraryWorkout,
  TrainingHubScheduledWorkoutEntry,
  TrainingLibraryDeleteRequest,
  TrainingLibrarySnapshot,
  TrainingLibraryWorkout,
  TrainingPlanDocument,
  TrainingPlanMetadataPatch,
  TrainingPlanWriteCapabilities,
  TrainingWorkoutMetadata,
  WorkoutMetadataPatch,
  WorkoutSport
} from "./types";

const UNVERIFIED_WRITE_REASON =
  "Native COROS plan writes are disabled until the cleanup-safe opt-in verifier confirms this account and API version. Local templates and individual workout/calendar upload remain available.";

export function getNativePlanWriteCapabilities(): TrainingPlanWriteCapabilities {
  return {
    create: false,
    update: false,
    duplicate: false,
    delete: false,
    activate: false,
    removeActive: false,
    reason: UNVERIFIED_WRITE_REASON
  };
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function relativeDateKey(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return dateKey(date);
}

function parsePlanDay(value?: string): Date | undefined {
  if (!value) return undefined;
  const digits = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) return undefined;
  const date = new Date(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)) - 1,
    Number(digits.slice(6, 8)),
    12
  );
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function mondayForPlan(value?: string): Date | undefined {
  const date = parsePlanDay(value);
  if (!date) return undefined;
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date;
}

function dashedPlanDay(date?: Date): string | undefined {
  if (!date) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sportMixFromNative(plan: NativeCorosPlanDetail): WorkoutSport[] {
  return plan.sportTypes
    .map(workoutSportFromType)
    .filter((sport): sport is WorkoutSport => Boolean(sport));
}

function nativePlanToDocument(plan: NativeCorosPlanDetail): TrainingPlanDocument {
  const existing = getTrainingPlanDocument(`coros:${plan.remoteId}`);
  const now = new Date().toISOString();
  const programByPlanId = new Map<string, NativeCorosPlanDetail["programs"][number]>();
  for (const program of plan.programs) {
    for (const id of [program.idInPlan, program.planProgramId, program.id]) {
      if (id) programByPlanId.set(id, program);
    }
  }
  const firstOccurrence = plan.entities
    .map((entity) => entity.happenDay)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const gridStart = mondayForPlan(firstOccurrence ?? plan.startDay);
  const entries = plan.entities
    .filter((entity) => entity.status !== 3)
    .map((entity, index) => {
      const program =
        programByPlanId.get(entity.idInPlan) ??
        (entity.planProgramId
          ? programByPlanId.get(entity.planProgramId)
          : undefined);
      const occurrenceDate = parsePlanDay(entity.happenDay);
      const dayNo = gridStart && occurrenceDate
        ? Math.max(
            0,
            Math.round((occurrenceDate.valueOf() - gridStart.valueOf()) / 86_400_000)
          )
        : entity.dayNo ?? index;
      const sport = workoutSportFromType(program?.sportType);
      return {
        id: `coros:${plan.remoteId}:${entity.idInPlan}`,
        kind: "workout" as const,
        weekIndex: Math.max(0, Math.floor(dayNo / 7)),
        dayIndex: Math.max(0, dayNo % 7),
        sortOrder: entity.sortNoInSchedule ?? entity.sortNo ?? index,
        title: program?.name ?? "Workout",
        workout: {
          key: `coros:${entity.idInPlan}`,
          name: program?.name ?? "Workout",
          description: program?.overview,
          sport,
          schedule_date: entity.happenDay,
          save_to_library: false
        },
        programId: program?.id,
        remotePlanProgramId: entity.planProgramId ?? program?.planProgramId,
        plannedDurationSeconds: program?.planDuration,
        plannedDistanceMeters: program?.planDistance,
        plannedTrainingLoad: program?.planTrainingLoad,
        plannedStrengthSets: program?.planSets
      };
    });
  return {
    id: `coros:${plan.remoteId}`,
    remoteId: plan.remoteId,
    name: plan.name,
    description: plan.overview,
    goal: existing?.goal ?? "",
    difficulty: existing?.difficulty ?? "custom",
    notes: existing?.notes ?? "",
    source: "coros",
    sportMix: sportMixFromNative(plan),
    weekCount: Math.max(1, Math.ceil(plan.totalDay / 7)),
    startDate: dashedPlanDay(gridStart) ?? existing?.startDate,
    phases: plan.weekStages.map((stage, index) => ({
      id: `coros:${plan.remoteId}:phase:${index}`,
      name: typeof stage.stage === "string" ? stage.stage : `Phase ${index + 1}`,
      kind: "custom",
      startWeek: stage.weekNo,
      endWeek: stage.weekNo
    })),
    entries,
    tags: existing?.tags ?? [],
    collectionId: existing?.collectionId,
    favorite: existing?.favorite ?? false,
    archived: existing?.archived ?? false,
    syncState: "synced",
    remoteVersion: plan.version,
    remoteUpdatedAt: plan.updateTimestamp,
    lastSyncedAt: plan.lastSyncedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function metadataByProgram(): Map<string, TrainingWorkoutMetadata> {
  return new Map(
    listTrainingWorkoutMetadata().map((metadata) => [metadata.programId, metadata])
  );
}

function mergeWorkout(
  workout: TrainingHubLibraryWorkout,
  metadata: TrainingWorkoutMetadata | undefined,
  plans: TrainingPlanDocument[],
  schedule: TrainingHubScheduledWorkoutEntry[]
): TrainingLibraryWorkout {
  const usedByPlanIds = plans
    .filter((plan) =>
      plan.entries.some((entry) => entry.programId === workout.id)
    )
    .map((plan) => plan.id);
  return {
    ...workout,
    favorite: metadata?.favorite ?? false,
    tags: metadata?.tags ?? [],
    collectionId: metadata?.collectionId,
    source: metadata?.source ?? "coros",
    syncState: metadata?.syncState ?? "synced",
    lastUsedAt: metadata?.lastUsedAt,
    lastSyncedAt: metadata?.lastSyncedAt,
    usedByPlanIds,
    scheduledCount: schedule.filter((entry) => entry.programId === workout.id).length
  };
}

export async function getTrainingLibrarySnapshot(): Promise<TrainingLibrarySnapshot> {
  const cachedAt = new Date().toISOString();
  const partialFailures: string[] = [];
  const localPlans = listTrainingPlanDocuments();
  const [workoutsResult, nativeResult, scheduleResult] = await Promise.allSettled([
    listLibraryWorkouts(),
    listNativeCorosPlans(),
    listScheduledWorkoutEntries(relativeDateKey(-180), relativeDateKey(365))
  ]);

  let baseWorkouts: TrainingHubLibraryWorkout[];
  if (workoutsResult.status === "fulfilled") {
    baseWorkouts = workoutsResult.value;
    const previous = metadataByProgram();
    for (const workout of baseWorkouts) {
      const metadata = previous.get(workout.id);
      saveTrainingWorkoutMetadata(
        {
          programId: workout.id,
          favorite: metadata?.favorite ?? false,
          tags: metadata?.tags ?? [],
          collectionId: metadata?.collectionId,
          source: metadata?.source ?? "coros",
          syncState: "synced",
          lastUsedAt: metadata?.lastUsedAt,
          lastSyncedAt: cachedAt,
          cachedVersion: metadata?.cachedVersion
        },
        workout as unknown as Record<string, unknown>
      );
    }
  } else {
    partialFailures.push(`Workouts: ${String(workoutsResult.reason?.message ?? workoutsResult.reason)}`);
    baseWorkouts = listCachedTrainingLibraryWorkouts();
  }

  let nativePlans: NativeCorosPlanSummary[] = localPlans
    .filter((plan) => plan.source === "coros" && plan.remoteId)
    .map((plan) => ({
      remoteId: plan.remoteId!,
      name: plan.name,
      overview: plan.description,
      totalDay: plan.weekCount * 7,
      workoutCount: plan.entries.filter((entry) => entry.kind === "workout").length,
      sportTypes: [],
      version: plan.remoteVersion,
      updateTimestamp: plan.remoteUpdatedAt,
      syncState: "stale" as const,
      lastSyncedAt: plan.lastSyncedAt
    }));
  if (nativeResult.status === "fulfilled") {
    nativePlans = nativeResult.value;
    for (const native of nativeResult.value) {
      saveTrainingPlanDocument(nativePlanToDocument(native), native.rawPayload);
    }
  } else {
    partialFailures.push(`Training plans: ${String(nativeResult.reason?.message ?? nativeResult.reason)}`);
  }

  const schedule = scheduleResult.status === "fulfilled" ? scheduleResult.value : [];
  if (scheduleResult.status === "rejected") {
    partialFailures.push(`Schedule: ${String(scheduleResult.reason?.message ?? scheduleResult.reason)}`);
  }
  const plans = listTrainingPlanDocuments();
  const metadata = metadataByProgram();
  return {
    workouts: baseWorkouts.map((workout) =>
      mergeWorkout(workout, metadata.get(workout.id), plans, schedule)
    ),
    plans,
    nativePlans,
    collections: listTrainingCollections(),
    matches: listTrainingActivityMatches(),
    cachedAt,
    stale: partialFailures.length > 0,
    offline: partialFailures.length === 3,
    partialFailures,
    nativePlanWrites: getNativePlanWriteCapabilities()
  };
}

export async function getNativeTrainingPlan(
  remoteId: string
): Promise<TrainingPlanDocument> {
  const native = await readNativeCorosPlan(remoteId);
  const document = nativePlanToDocument(native);
  saveTrainingPlanDocument(document, native.rawPayload);
  return document;
}

export function saveLocalTrainingPlan(
  input: TrainingPlanDocument
): TrainingPlanDocument {
  const errors = validateTrainingPlan(input).filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join(" "));
  }
  const now = new Date().toISOString();
  const forkNative = input.source === "coros";
  const targetId = forkNative ? `plan:${crypto.randomUUID()}` : input.id;
  const existing = forkNative ? undefined : getTrainingPlanDocument(targetId);
  const document: TrainingPlanDocument = {
    ...structuredClone(input),
    id: targetId,
    name: forkNative ? `${input.name} Local Copy` : input.name,
    source: forkNative ? "local" : input.source,
    remoteId: forkNative ? undefined : input.remoteId,
    remoteVersion: forkNative ? undefined : input.remoteVersion,
    remoteUpdatedAt: forkNative ? undefined : input.remoteUpdatedAt,
    syncState: "local",
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now
  };
  saveTrainingPlanDocument(document);
  return document;
}

export function updateTrainingPlanMetadata(
  id: string,
  patch: TrainingPlanMetadataPatch
): TrainingPlanDocument {
  const plan = getTrainingPlanDocument(id);
  if (!plan) throw new Error("Training plan was not found.");
  const updated: TrainingPlanDocument = {
    ...plan,
    favorite: patch.favorite ?? plan.favorite,
    tags: patch.tags ?? plan.tags,
    collectionId:
      patch.collectionId === null
        ? undefined
        : patch.collectionId ?? plan.collectionId,
    archived: patch.archived ?? plan.archived,
    updatedAt: new Date().toISOString()
  };
  saveTrainingPlanDocument(updated);
  return updated;
}

export function deleteLocalTrainingPlan(id: string, confirmed: boolean): void {
  if (!confirmed) throw new Error("Deleting a training plan requires confirmation.");
  const plan = getTrainingPlanDocument(id);
  if (!plan) return;
  if (plan.source === "coros") {
    throw new Error(UNVERIFIED_WRITE_REASON);
  }
  deleteTrainingPlanDocument(id);
}

export function updateWorkoutMetadata(
  programIds: string[],
  patch: WorkoutMetadataPatch
): TrainingWorkoutMetadata[] {
  const current = metadataByProgram();
  const updated: TrainingWorkoutMetadata[] = [];
  for (const programId of [...new Set(programIds)]) {
    const previous = current.get(programId);
    const metadata: TrainingWorkoutMetadata = {
      programId,
      favorite: patch.favorite ?? previous?.favorite ?? false,
      tags: patch.tags ?? previous?.tags ?? [],
      collectionId:
        patch.collectionId === null
          ? undefined
          : patch.collectionId ?? previous?.collectionId,
      source: patch.source ?? previous?.source ?? "coros",
      syncState: previous?.syncState ?? "synced",
      lastUsedAt: patch.lastUsedAt ?? previous?.lastUsedAt,
      lastSyncedAt: previous?.lastSyncedAt,
      cachedVersion: previous?.cachedVersion
    };
    saveTrainingWorkoutMetadata(metadata);
    updated.push(metadata);
  }
  return updated;
}

export function upsertTrainingCollection(
  input: Pick<TrainingCollection, "id" | "name"> &
    Partial<Pick<TrainingCollection, "description" | "color">>
): TrainingCollection {
  if (!input.name.trim()) throw new Error("Collection name is required.");
  const existing = listTrainingCollections().find((item) => item.id === input.id);
  const now = new Date().toISOString();
  const collection: TrainingCollection = {
    id: input.id || crypto.randomUUID(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    color: input.color,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  saveTrainingCollection(collection);
  return collection;
}

export function removeTrainingCollection(id: string, confirmed: boolean): void {
  if (!confirmed) throw new Error("Deleting a collection requires confirmation.");
  deleteTrainingCollection(id);
}

export async function deleteTrainingLibraryWorkouts(
  request: TrainingLibraryDeleteRequest
): Promise<string[]> {
  const ids = [...new Set(request.programIds.map((id) => id.trim()).filter(Boolean))];
  if (!request.confirmed) throw new Error("Deleting workouts requires confirmation.");
  if (ids.length === 0) throw new Error("Select at least one workout to delete.");
  for (const id of ids) await deleteWorkoutProgram(id);
  return ids;
}

export function activityDay(activity: TrainingHubActivity): string | undefined {
  if (!activity.startTime) return undefined;
  const raw = activity.startTime > 10_000_000_000 ? activity.startTime : activity.startTime * 1000;
  return dateKey(new Date(raw));
}

export function scheduledActivityScore(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity
): number {
  let score = 0.35;
  if (scheduled.sportType && scheduled.sportType === activity.sportType) score += 0.35;
  const plannedLoad = scheduled.trainingLoad;
  if (plannedLoad && activity.trainingLoad !== undefined) {
    score += 0.2 * Math.max(0, 1 - Math.abs(activity.trainingLoad - plannedLoad) / plannedLoad);
  }
  const normalizedName = scheduled.name.trim().toLowerCase();
  if (normalizedName && activity.name?.trim().toLowerCase() === normalizedName) score += 0.1;
  return Math.min(1, score);
}

export function buildTrainingActivityMatches(
  scheduled: TrainingHubScheduledWorkoutEntry[],
  activities: TrainingHubActivity[],
  previous: TrainingActivityMatch[],
  today = dateKey(new Date())
): TrainingActivityMatch[] {
  const existing = new Map(
    previous.map((match) => [
      `${match.schedulePlanId}:${match.scheduleIdInPlan}`,
      match
    ])
  );
  const usedActivities = new Set<string>();
  const results: TrainingActivityMatch[] = [];
  for (const entry of scheduled) {
    const key = `${entry.planId}:${entry.idInPlan}`;
    const manual = existing.get(key);
    let activity = manual?.manual
      ? activities.find((candidate) => candidate.activityId === manual.activityId)
      : undefined;
    let confidence = manual?.manual ? manual.confidence : undefined;
    if (!manual?.manual) {
      const candidates = activities
        .filter((candidate) => activityDay(candidate) === entry.happenDay)
        .filter((candidate) => !usedActivities.has(candidate.activityId))
        .map((candidate) => ({ candidate, score: scheduledActivityScore(entry, candidate) }))
        .sort((left, right) => right.score - left.score);
      if (candidates[0]?.score >= 0.5) {
        activity = candidates[0].candidate;
        confidence = candidates[0].score;
      }
    }
    if (activity) usedActivities.add(activity.activityId);
    const ratio = entry.trainingLoad && activity?.trainingLoad !== undefined
      ? activity.trainingLoad / entry.trainingLoad
      : undefined;
    const status: TrainingActivityMatch["status"] = manual?.status === "skipped"
      ? "skipped"
      : activity
        ? ratio !== undefined && ratio < 0.75 ? "partial" : "completed"
        : entry.happenDay < today ? "missed" : "upcoming";
    results.push({
      id: manual?.id ?? crypto.randomUUID(),
      planId: manual?.planId,
      planEntryId: manual?.planEntryId,
      schedulePlanId: entry.planId,
      scheduleIdInPlan: entry.idInPlan,
      activityId: activity?.activityId,
      happenDay: entry.happenDay,
      status,
      confidence,
      manual: manual?.manual ?? false,
      completedDurationSeconds: activity?.duration,
      completedDistanceMeters: activity?.distance,
      plannedTrainingLoad: entry.trainingLoad,
      completedTrainingLoad: activity?.trainingLoad,
      updatedAt: new Date().toISOString()
    });
  }
  return results;
}

export async function refreshTrainingActivityMatches(
  startDay: string,
  endDay: string
): Promise<TrainingActivityMatch[]> {
  const [scheduled, activities] = await Promise.all([
    listScheduledWorkoutEntries(startDay, endDay),
    listTrainingHubActivities(1, 500, startDay, endDay)
  ]);
  const results = buildTrainingActivityMatches(
    scheduled,
    activities,
    listTrainingActivityMatches()
  );
  for (const match of results) {
    saveTrainingActivityMatch(match);
  }
  return results;
}

export function saveManualActivityMatch(match: TrainingActivityMatch): TrainingActivityMatch {
  const next = { ...match, manual: true, updatedAt: new Date().toISOString() };
  saveTrainingActivityMatch(next);
  return next;
}
