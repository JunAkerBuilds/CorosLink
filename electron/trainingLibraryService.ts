import crypto from "node:crypto";
import {
  deleteTrainingCollection,
  deleteTrainingPlanDocument,
  deleteTrainingWorkoutMetadata,
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
  queryNativeCorosPlanLibrary,
  readNativeCorosPlan
} from "./corosTrainingPlanAdapter";
import { resolveActivityLinks, scheduledLinkKey } from "./activityLinks";
import { recordDiagnosticError } from "./diagnosticsService";
import {
  createAndScheduleWorkout,
  deactivateNativeTrainingPlan,
  deleteNativeTrainingPlan,
  deleteWorkoutProgram,
  listActiveNativeTrainingPlanInstanceIds,
  listActiveNativeTrainingPlanInstances,
  listScheduledWorkoutEntries,
  listTrainingHubActivities,
  queryLibraryWorkouts,
  removeScheduledWorkout,
  scheduleLibraryWorkout
} from "./trainingHubService";
import {
  activeTrainingPlanCalendarInstall,
  shiftTrainingPlan,
  trainingPlanCalendarRevision,
  validateTrainingPlan,
  workoutSportFromType
} from "./trainingPlanDomain";
import type {
  CorosTrainingPlanDeleteResult,
  LocalTrainingPlanDeleteResult,
  ManualActivityLink,
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
  TrainingPlanCalendarFailure,
  TrainingPlanCalendarInstall,
  TrainingPlanCalendarMutationResult,
  TrainingPlanCalendarPreview,
  TrainingPlanCalendarPreviewEntry,
  TrainingPlanMetadataPatch,
  TrainingPlanWriteCapabilities,
  TrainingWorkoutMetadata,
  UnitSystem,
  WorkoutMetadataPatch,
  WorkoutSport
} from "./types";

const UNSUPPORTED_NATIVE_WRITE_REASON =
  "Editing native COROS plans, or duplicating them on COROS, isn't available in CorosLink yet. Use the COROS app.";

export function getNativePlanWriteCapabilities(): TrainingPlanWriteCapabilities {
  return {
    // Create/activate are live from chat (uploadNativeTrainingPlan). The
    // Library deletes plans, ending an active calendar instance first
    // (deleteCorosTrainingPlan); native edit/copy aren't wired yet.
    create: true,
    update: false,
    duplicate: false,
    delete: true,
    activate: true,
    removeActive: true,
    reason: UNSUPPORTED_NATIVE_WRITE_REASON
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

type NativePlanEntity = NativeCorosPlanDetail["entities"][number];

function nativePlanEntityFingerprint(entity: NativePlanEntity): string {
  return JSON.stringify([
    entity.id ?? null,
    entity.idInPlan,
    entity.planProgramId ?? null,
    entity.happenDay ?? null,
    entity.dayNo ?? null,
    entity.sortNo ?? null,
    entity.sortNoInPlan ?? null,
    entity.sortNoInSchedule ?? null,
    entity.status ?? null
  ]);
}

function nativePlanEntityHash(entity: NativePlanEntity): string {
  return crypto
    .createHash("sha256")
    .update(nativePlanEntityFingerprint(entity))
    .digest("hex")
    .slice(0, 16);
}

function nativePlanEntitiesWithIdentity(plan: NativeCorosPlanDetail): Array<{
  entity: NativePlanEntity;
  identityKey: string;
}> {
  const seenFingerprints = new Set<string>();
  const entities = plan.entities.filter((entity) => {
    if (entity.status === 3) return false;
    const fingerprint = nativePlanEntityFingerprint(entity);
    if (seenFingerprints.has(fingerprint)) return false;
    seenFingerprints.add(fingerprint);
    return true;
  });
  const idInPlanCounts = new Map<string, number>();
  for (const entity of entities) {
    idInPlanCounts.set(
      entity.idInPlan,
      (idInPlanCounts.get(entity.idInPlan) ?? 0) + 1
    );
  }
  const candidates = entities.map((entity) => ({
    entity,
    identityKey:
      idInPlanCounts.get(entity.idInPlan) === 1
        ? entity.idInPlan
        : entity.id
          ? `entity:${entity.id}`
          : `occurrence:${entity.idInPlan}:${nativePlanEntityHash(entity)}`
  }));
  const candidateCounts = new Map<string, number>();
  for (const candidate of candidates) {
    candidateCounts.set(
      candidate.identityKey,
      (candidateCounts.get(candidate.identityKey) ?? 0) + 1
    );
  }
  return candidates.map(({ entity, identityKey }) => ({
    entity,
    identityKey:
      candidateCounts.get(identityKey) === 1
        ? identityKey
        : `${identityKey}:${nativePlanEntityHash(entity)}`
  }));
}

export function nativePlanToDocument(plan: NativeCorosPlanDetail): TrainingPlanDocument {
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
  const entries = nativePlanEntitiesWithIdentity(plan)
    .map(({ entity, identityKey }, index) => {
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
      const usesLegacyIdentity = identityKey === entity.idInPlan;
      return {
        id: `coros:${plan.remoteId}:${identityKey}`,
        kind: "workout" as const,
        weekIndex: Math.max(0, Math.floor(dayNo / 7)),
        dayIndex: Math.max(0, dayNo % 7),
        sortOrder: entity.sortNoInSchedule ?? entity.sortNo ?? index,
        title: program?.name ?? "Workout",
        workout: {
          key: usesLegacyIdentity
            ? `coros:${entity.idInPlan}`
            : `coros:${plan.remoteId}:${identityKey}`,
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

let queryNativePlanLibrary = queryNativeCorosPlanLibrary;
let queryLibraryWorkoutList = queryLibraryWorkouts;

/** Test seam for the snapshot's plan/query read. Never used by the renderer. */
export function setNativePlanLibraryQueryForTests(
  query?: typeof queryNativeCorosPlanLibrary
): void {
  queryNativePlanLibrary = query ?? queryNativeCorosPlanLibrary;
}

/** Test seam for the snapshot's program/query read. Never used by the renderer. */
export function setLibraryWorkoutQueryForTests(query?: typeof queryLibraryWorkouts): void {
  queryLibraryWorkoutList = query ?? queryLibraryWorkouts;
}

let recordRefreshFailure: (source: string, error: unknown) => void = recordDiagnosticError;
let reportedRefreshFailures = new Set<string>();

/** Test seam for the error-report recorder. Never used by the renderer. */
export function setRefreshFailureRecorderForTests(
  record?: (source: string, error: unknown) => void
): void {
  recordRefreshFailure = record ?? recordDiagnosticError;
  reportedRefreshFailures = new Set();
}

/**
 * Puts Library refresh failures in the error report. The snapshot catches them
 * for its banner, so no IPC handler ever sees them. A failure that repeats on
 * every refresh is recorded once, until it clears or changes.
 */
function reportRefreshFailures(failures: string[], causes: Map<string, unknown>): void {
  for (const failure of failures) {
    if (reportedRefreshFailures.has(failure)) continue;
    recordRefreshFailure("trainingLibrary:snapshot", new Error(failure, { cause: causes.get(failure) }));
  }
  reportedRefreshFailures = new Set(failures);
}

/**
 * Drops cached workouts that a complete program/query no longer returns, such
 * as workouts deleted in the COROS app. Without this, a later failed query
 * falls back to the cache and shows them again, and deleting them can't make
 * them go away. Only rows cached before the query are candidates.
 */
function pruneDeletedWorkouts(
  cachedProgramIds: string[],
  fetched: TrainingHubLibraryWorkout[],
  partialFailures: string[]
): void {
  const live = new Set(fetched.map((workout) => workout.id));
  for (const programId of cachedProgramIds) {
    if (live.has(programId)) continue;
    try {
      deleteTrainingWorkoutMetadata(programId);
    } catch (error) {
      partialFailures.push(`Workout ${programId}: ${errorReason(error)}`);
    }
  }
}

/**
 * Drops cached native plans that a complete plan/query no longer returns, such
 * as plans deleted in the COROS app. Only documents cached before the query
 * are candidates, so a plan saved while it was in flight isn't mistaken for a
 * deleted one. Local tags, notes, favorite, and collection go with the
 * document; if the plan reappears, the next refresh rebuilds it from COROS
 * with default metadata.
 */
function pruneDeletedNativePlans(
  cached: TrainingPlanDocument[],
  fetched: NativeCorosPlanSummary[],
  partialFailures: string[]
): void {
  const live = new Set(fetched.map((plan) => plan.remoteId));
  for (const plan of cached) {
    if (plan.source !== "coros" || !plan.remoteId || live.has(plan.remoteId)) continue;
    try {
      deleteTrainingPlanDocument(plan.id);
    } catch (error) {
      partialFailures.push(
        `Training plan "${plan.name}" (${plan.remoteId}): ${errorReason(error)}`
      );
    }
  }
}

export async function getTrainingLibrarySnapshot(): Promise<TrainingLibrarySnapshot> {
  const cachedAt = new Date().toISOString();
  const partialFailures: string[] = [];
  // The original errors go to the error report as causes, so their stacks survive.
  const failureCauses = new Map<string, unknown>();
  const addRejected = (section: string, reason: unknown) => {
    const failure = `${section}: ${String((reason as { message?: unknown } | undefined)?.message ?? reason)}`;
    partialFailures.push(failure);
    failureCauses.set(failure, reason);
  };
  const localPlans = listTrainingPlanDocuments();
  const cachedProgramIds = listTrainingWorkoutMetadata().map((metadata) => metadata.programId);
  const [workoutsResult, nativeResult, scheduleResult, activeNativeResult] = await Promise.allSettled([
    queryLibraryWorkoutList(),
    queryNativePlanLibrary(),
    listScheduledWorkoutEntries(relativeDateKey(-180), relativeDateKey(365)),
    listActiveNativeTrainingPlanInstances()
  ]);

  let baseWorkouts: TrainingHubLibraryWorkout[];
  if (workoutsResult.status === "fulfilled") {
    const { workouts: fetchedWorkouts, complete } = workoutsResult.value;
    baseWorkouts = fetchedWorkouts;
    if (complete) {
      pruneDeletedWorkouts(cachedProgramIds, fetchedWorkouts, partialFailures);
    } else {
      partialFailures.push(
        "Workouts: COROS sent a workout list CorosLink couldn't fully read, so workouts " +
          "deleted on COROS may still be listed."
      );
    }
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
    addRejected("Workouts", workoutsResult.reason);
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
    const { plans: fetched, complete } = nativeResult.value;
    nativePlans = fetched;
    for (const native of fetched) {
      try {
        saveTrainingPlanDocument(nativePlanToDocument(native), native.rawPayload);
      } catch (error) {
        partialFailures.push(
          `Training plan "${native.name}" (${native.remoteId}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    if (complete) {
      pruneDeletedNativePlans(localPlans, fetched, partialFailures);
    } else {
      partialFailures.push(
        "Training plans: COROS sent a plan list CorosLink couldn't fully read, so plans " +
          "deleted on COROS may still be listed."
      );
    }
  } else {
    addRejected("Training plans", nativeResult.reason);
  }

  const schedule = scheduleResult.status === "fulfilled" ? scheduleResult.value : [];
  if (scheduleResult.status === "rejected") {
    addRejected("Schedule", scheduleResult.reason);
  }
  reportRefreshFailures(partialFailures, failureCauses);
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
    offline:
      workoutsResult.status === "rejected" &&
      nativeResult.status === "rejected" &&
      scheduleResult.status === "rejected",
    partialFailures,
    nativePlanWrites: getNativePlanWriteCapabilities(),
    // Only a badge depends on this, so a failed query just leaves it out.
    nativePlansOnCalendar: activeNativeResult.status === "fulfilled"
      ? Object.fromEntries(
          activeNativeResult.value
            .filter((instance) => instance.originId)
            .map((instance) => [instance.originId, { startDay: instance.startDay }])
        )
      : undefined
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
    throw new Error("This plan is stored on COROS. Delete it from your COROS account instead.");
  }
  if (activeTrainingPlanCalendarInstall(plan)) {
    throw new Error("Remove this plan's future calendar workouts before deleting the plan.");
  }
  deleteTrainingPlanDocument(id);
}

/**
 * Library delete for local plans. A plan that still owns upcoming calendar
 * workouts has them removed first, through the same owned-occurrence removal
 * as the calendar button (past days stay), and is kept if any can't be
 * confirmed removed.
 */
export async function deleteLocalTrainingPlanAndCalendar(
  id: string,
  confirmed: boolean
): Promise<LocalTrainingPlanDeleteResult> {
  if (!confirmed) throw new Error("Deleting a training plan requires confirmation.");
  const plan = getTrainingPlanDocument(id);
  let removedCalendarWorkouts = 0;
  if (plan && plan.source !== "coros" && activeTrainingPlanCalendarInstall(plan)) {
    const preview = await previewTrainingPlanCalendarRemoval(plan.id);
    const result = await removeTrainingPlanFromCalendar(preview.previewId, true);
    removedCalendarWorkouts = result.removedCount;
    if (activeTrainingPlanCalendarInstall(result.plan)) {
      throw new Error(
        `Removed ${result.removedCount} upcoming workout${result.removedCount === 1 ? "" : "s"} ` +
          `from your COROS calendar, but ${result.failures.length} couldn't be confirmed removed, ` +
          "so the plan wasn't deleted. Retry from the plan's calendar button, then delete it."
      );
    }
  }
  deleteLocalTrainingPlan(id, true);
  return { removedCalendarWorkouts };
}

interface NativeTrainingPlanWriter {
  listActiveInstanceIds: typeof listActiveNativeTrainingPlanInstanceIds;
  deactivate: typeof deactivateNativeTrainingPlan;
  delete: typeof deleteNativeTrainingPlan;
}

const defaultNativeTrainingPlanWriter: NativeTrainingPlanWriter = {
  listActiveInstanceIds: listActiveNativeTrainingPlanInstanceIds,
  deactivate: deactivateNativeTrainingPlan,
  delete: deleteNativeTrainingPlan
};

let nativeTrainingPlanWriter = defaultNativeTrainingPlanWriter;

/** Test seam for native plan delete simulations. Never used by the renderer. */
export function setNativeTrainingPlanWriterForTests(
  overrides?: Partial<NativeTrainingPlanWriter>
): void {
  nativeTrainingPlanWriter = overrides
    ? { ...defaultNativeTrainingPlanWriter, ...overrides }
    : defaultNativeTrainingPlanWriter;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Deletes a native plan from the athlete's COROS account. If the plan is on
 * the calendar, its active instance is ended first (quitSubPlan removes only
 * upcoming workouts; past days stay), so no workouts outlive a plan that
 * CorosLink no longer lists. Any failure before plan/delete leaves the plan in
 * place.
 */
export async function deleteCorosTrainingPlan(
  remoteId: string,
  confirmed: boolean
): Promise<CorosTrainingPlanDeleteResult> {
  if (!confirmed) throw new Error("Deleting a training plan requires confirmation.");
  const id = remoteId.trim();
  const local = listTrainingPlanDocuments().filter(
    (plan) => plan.source === "coros" && plan.remoteId === id
  );
  if (!id || local.length === 0) {
    throw new Error("This COROS plan isn't in the Training Library. Refresh and try again.");
  }

  let instanceIds: string[];
  try {
    instanceIds = await nativeTrainingPlanWriter.listActiveInstanceIds(id);
  } catch (error) {
    throw new Error(
      `${errorReason(error)} CorosLink couldn't check whether this plan is on your COROS ` +
        "calendar, so nothing was deleted.",
      { cause: error }
    );
  }
  for (const instanceId of instanceIds) {
    try {
      await nativeTrainingPlanWriter.deactivate(instanceId);
    } catch (error) {
      throw new Error(
        `${errorReason(error)} CorosLink couldn't remove this plan's upcoming workouts from ` +
          "your COROS calendar, so the plan wasn't deleted.",
        { cause: error }
      );
    }
  }
  try {
    await nativeTrainingPlanWriter.delete(id);
  } catch (error) {
    if (instanceIds.length === 0) throw error;
    throw new Error(
      `${errorReason(error)} The plan's upcoming workouts were removed from your COROS ` +
        "calendar, but the plan itself wasn't deleted. Try again.",
      { cause: error }
    );
  }

  for (const plan of local) deleteTrainingPlanDocument(plan.id);
  return { remoteId: id, endedCalendarPlans: instanceIds.length };
}

interface StoredPlanCalendarPreview {
  preview: TrainingPlanCalendarPreview;
  projectedPlan: TrainingPlanDocument;
  calendarFingerprint: string;
  rangeStart: string;
  rangeEnd: string;
  installId?: string;
}

interface TrainingPlanCalendarAdapter {
  listScheduled: typeof listScheduledWorkoutEntries;
  scheduleLibrary: typeof scheduleLibraryWorkout;
  createAndSchedule: typeof createAndScheduleWorkout;
  removeScheduled: typeof removeScheduledWorkout;
}

const defaultTrainingPlanCalendarAdapter: TrainingPlanCalendarAdapter = {
  listScheduled: listScheduledWorkoutEntries,
  scheduleLibrary: scheduleLibraryWorkout,
  createAndSchedule: createAndScheduleWorkout,
  removeScheduled: removeScheduledWorkout
};

let trainingPlanCalendarAdapter = defaultTrainingPlanCalendarAdapter;

/** Test seam for calendar mutation simulations. Never used by the renderer. */
export function setTrainingPlanCalendarAdapterForTests(
  overrides?: Partial<TrainingPlanCalendarAdapter>
): void {
  trainingPlanCalendarAdapter = overrides
    ? { ...defaultTrainingPlanCalendarAdapter, ...overrides }
    : defaultTrainingPlanCalendarAdapter;
}

const PLAN_CALENDAR_PREVIEW_TTL_MS = 15 * 60_000;
const planCalendarPreviews = new Map<string, StoredPlanCalendarPreview>();

function normalizedCalendarDay(value: string): string {
  const day = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(day)) throw new Error("Calendar dates must use YYYY-MM-DD.");
  return day;
}

function dashedCalendarDay(value: string): string {
  const day = normalizedCalendarDay(value);
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;
}

function addCalendarDays(value: string, offset: number): string {
  const date = parsePlanDay(value);
  if (!date) throw new Error("Calendar dates must use YYYY-MM-DD.");
  date.setDate(date.getDate() + offset);
  return dateKey(date);
}

function scheduleIdentity(entry: TrainingHubScheduledWorkoutEntry): string {
  return `${entry.planId}:${entry.idInPlan}`;
}

function fingerprintCalendar(entries: TrainingHubScheduledWorkoutEntry[]): string {
  const serialized = entries
    .map((entry) => ({
      planId: entry.planId,
      idInPlan: entry.idInPlan,
      planProgramId: entry.planProgramId,
      happenDay: entry.happenDay,
      name: entry.name
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return crypto.createHash("sha256").update(JSON.stringify(serialized)).digest("hex");
}

function latestInstallForPlan(plan: TrainingPlanDocument): TrainingPlanCalendarInstall | undefined {
  const today = dateKey(new Date());
  return [...(plan.calendarInstalls ?? [])]
    .filter((install) => install.state === "partial" || (
      install.state !== "removed" && install.occurrences.some((occurrence) => !occurrence.removedAt && occurrence.happenDay >= today)
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function buildTrainingPlanCalendarProjection(
  plan: TrainingPlanDocument,
  startDate: string,
  scheduled: TrainingHubScheduledWorkoutEntry[],
  today = dateKey(new Date())
): Pick<TrainingPlanCalendarPreview, "startDate" | "entries" | "conflicts" | "blockers"> & {
  projectedPlan: TrainingPlanDocument;
} {
  if (plan.source === "coros") {
    throw new Error("Native COROS plans are read-only in the Training Library.");
  }
  const startDay = normalizedCalendarDay(startDate);
  if (startDay < today) throw new Error("A training plan cannot be installed in the past.");
  const projectedPlan = shiftTrainingPlan(plan, dashedCalendarDay(startDay));
  const planRevision = trainingPlanCalendarRevision(projectedPlan);
  const existingInstall = latestInstallForPlan(plan);
  const blockers: string[] = [];
  if (existingInstall?.state === "active") {
    blockers.push("This plan already has an active calendar installation.");
  } else if (existingInstall) {
    if (existingInstall.lastOperation === "remove") {
      blockers.push("Finish removing the partial calendar installation before reinstalling.");
    }
    if (normalizedCalendarDay(existingInstall.startDate) !== startDay) {
      blockers.push("Remove the partial calendar installation before choosing a new start date.");
    }
    if (existingInstall.planRevision !== planRevision) {
      blockers.push("The plan changed after its partial calendar installation. Remove it before reinstalling.");
    }
    if (existingInstall.failures.some((failure) => failure.writeMayHaveSucceeded && failure.happenDay >= today)) {
      blockers.push("COROS may have accepted an unverified workout. Refresh the calendar before retrying.");
    }
  }
  const owned = new Set(
    existingInstall?.occurrences
      .filter((occurrence) => !occurrence.removedAt)
      .map((occurrence) => `${occurrence.planEntryId}:${occurrence.happenDay}`) ?? []
  );
  const entries: TrainingPlanCalendarPreviewEntry[] = [];
  for (const entry of projectedPlan.entries) {
    if (entry.kind !== "workout") continue;
    if (entry.dayIndex === undefined) {
      blockers.push(`"${entry.title ?? "Untitled workout"}" is still in the holding area.`);
      continue;
    }
    const happenDay = addCalendarDays(startDay, entry.weekIndex * 7 + entry.dayIndex);
    if (owned.has(`${entry.id}:${happenDay}`)) continue;
    if (!entry.programId && !entry.workout) {
      blockers.push(`"${entry.title ?? "Untitled workout"}" has no workout definition.`);
      continue;
    }
    entries.push({
      planEntryId: entry.id,
      name: entry.title ?? entry.workout?.name ?? "Workout",
      happenDay,
      sport: entry.workout?.sport
    });
  }
  const conflicts = [...new Set(entries.map((entry) => entry.happenDay))]
    .map((happenDay) => ({
      happenDay,
      existing: scheduled
        .filter((entry) => entry.happenDay === happenDay)
        .map((entry) => ({
          name: entry.name,
          schedulePlanId: entry.planId,
          scheduleIdInPlan: entry.idInPlan
        }))
    }))
    .filter((conflict) => conflict.existing.length > 0);
  return {
    projectedPlan,
    startDate: dashedCalendarDay(startDay),
    entries,
    conflicts,
    blockers: [...new Set(blockers)]
  };
}

function rememberPlanCalendarPreview(
  preview: Omit<TrainingPlanCalendarPreview, "previewId" | "expiresAt">,
  projectedPlan: TrainingPlanDocument,
  calendarEntries: TrainingHubScheduledWorkoutEntry[],
  rangeStart: string,
  rangeEnd: string,
  installId?: string
): TrainingPlanCalendarPreview {
  for (const [id, record] of planCalendarPreviews) {
    if (Date.parse(record.preview.expiresAt) <= Date.now()) planCalendarPreviews.delete(id);
  }
  const previewId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const saved: TrainingPlanCalendarPreview = {
    ...preview,
    previewId,
    expiresAt: new Date(Date.now() + PLAN_CALENDAR_PREVIEW_TTL_MS).toISOString()
  };
  planCalendarPreviews.set(previewId, {
    preview: saved,
    projectedPlan,
    calendarFingerprint: fingerprintCalendar(calendarEntries),
    rangeStart,
    rangeEnd,
    installId
  });
  return saved;
}

export async function previewTrainingPlanCalendar(
  planId: string,
  startDate: string
): Promise<TrainingPlanCalendarPreview> {
  const plan = getTrainingPlanDocument(planId);
  if (!plan) throw new Error("Training plan was not found.");
  const startDay = normalizedCalendarDay(startDate);
  const rangeEnd = addCalendarDays(startDay, Math.max(0, plan.weekCount * 7 - 1));
  const scheduled = await trainingPlanCalendarAdapter.listScheduled(startDay, rangeEnd);
  const projection = buildTrainingPlanCalendarProjection(plan, startDate, scheduled);
  return rememberPlanCalendarPreview(
    {
      operation: "install",
      planId: plan.id,
      planName: plan.name,
      planRevision: trainingPlanCalendarRevision(projection.projectedPlan),
      startDate: projection.startDate,
      entries: projection.entries,
      conflicts: projection.conflicts,
      blockers: projection.blockers
    },
    projection.projectedPlan,
    scheduled,
    startDay,
    rangeEnd,
    latestInstallForPlan(plan)?.id
  );
}

export async function previewTrainingPlanCalendarRemoval(
  planId: string
): Promise<TrainingPlanCalendarPreview> {
  const plan = getTrainingPlanDocument(planId);
  if (!plan) throw new Error("Training plan was not found.");
  const today = dateKey(new Date());
  const install = activeTrainingPlanCalendarInstall(plan, today);
  if (!install) throw new Error("This plan has no future calendar workouts to remove.");
  const occurrences = install.occurrences.filter(
    (occurrence) => !occurrence.removedAt && occurrence.happenDay >= today
  );
  const rangeStart = occurrences.map((entry) => entry.happenDay).sort()[0] ?? today;
  const rangeEnd = occurrences.map((entry) => entry.happenDay).sort().at(-1) ?? today;
  const scheduled = await trainingPlanCalendarAdapter.listScheduled(rangeStart, rangeEnd);
  const entries: TrainingPlanCalendarPreviewEntry[] = occurrences.map((occurrence) => ({
    planEntryId: occurrence.planEntryId,
    name: plan.entries.find((entry) => entry.id === occurrence.planEntryId)?.title ?? "Workout",
    happenDay: occurrence.happenDay,
    schedulePlanId: occurrence.schedulePlanId,
    scheduleIdInPlan: occurrence.scheduleIdInPlan,
    planProgramId: occurrence.planProgramId,
    pbVersion: occurrence.pbVersion
  }));
  return rememberPlanCalendarPreview(
    {
      operation: "remove",
      planId: plan.id,
      planName: plan.name,
      planRevision: trainingPlanCalendarRevision(plan),
      startDate: install.startDate,
      entries,
      conflicts: [],
      blockers: []
    },
    plan,
    scheduled,
    rangeStart,
    rangeEnd,
    install.id
  );
}

async function requireCurrentCalendarPreview(
  previewId: string,
  operation: "install" | "remove",
  confirmed: boolean
): Promise<{ record: StoredPlanCalendarPreview; plan: TrainingPlanDocument }> {
  if (!confirmed) throw new Error("Calendar changes require confirmation.");
  const record = planCalendarPreviews.get(previewId);
  if (!record || record.preview.operation !== operation || Date.parse(record.preview.expiresAt) <= Date.now()) {
    planCalendarPreviews.delete(previewId);
    throw new Error("This calendar preview expired. Refresh it before confirming.");
  }
  if (record.preview.blockers.length > 0) {
    throw new Error(record.preview.blockers.join(" "));
  }
  const plan = getTrainingPlanDocument(record.preview.planId);
  if (!plan) throw new Error("Training plan was not found.");
  const revision = operation === "install"
    ? trainingPlanCalendarRevision(shiftTrainingPlan(plan, record.preview.startDate))
    : trainingPlanCalendarRevision(plan);
  if (revision !== record.preview.planRevision) {
    throw new Error("The plan changed after this preview. Refresh before confirming.");
  }
  const scheduled = await trainingPlanCalendarAdapter.listScheduled(record.rangeStart, record.rangeEnd);
  if (fingerprintCalendar(scheduled) !== record.calendarFingerprint) {
    throw new Error("The COROS calendar changed after this preview. Refresh before confirming.");
  }
  return { record, plan };
}

function waitForCalendar(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function captureScheduledIdentity(
  previewEntry: TrainingPlanCalendarPreviewEntry,
  before: Set<string>
): Promise<TrainingHubScheduledWorkoutEntry | undefined> {
  for (const delayMs of [0, 250, 600, 1_200]) {
    if (delayMs) await waitForCalendar(delayMs);
    const current = await trainingPlanCalendarAdapter.listScheduled(previewEntry.happenDay, previewEntry.happenDay);
    const added = current.filter((entry) => !before.has(scheduleIdentity(entry)));
    const exact = added.filter((entry) => entry.name === previewEntry.name);
    if (exact.length === 1) return exact[0];
    if (added.length === 1) return added[0];
  }
  return undefined;
}

export async function addTrainingPlanToCalendar(
  previewId: string,
  confirmed: boolean,
  unitSystem: UnitSystem
): Promise<TrainingPlanCalendarMutationResult> {
  const { record, plan } = await requireCurrentCalendarPreview(previewId, "install", confirmed);
  const projectedPlan = shiftTrainingPlan(plan, record.preview.startDate);
  const now = new Date().toISOString();
  let install = projectedPlan.calendarInstalls?.find((item) => item.id === record.installId && item.state === "partial");
  if (!install) {
    install = {
      id: crypto.randomUUID(),
      startDate: record.preview.startDate,
      planRevision: record.preview.planRevision,
      state: "partial",
      lastOperation: "install",
      occurrences: [],
      failures: [],
      createdAt: now,
      updatedAt: now
    };
  }
  install.lastOperation = "install";
  const installs = (projectedPlan.calendarInstalls ?? []).filter((item) => item.id !== install!.id);
  let nextPlan: TrainingPlanDocument = { ...projectedPlan, calendarInstalls: [...installs, install] };
  saveTrainingPlanDocument(nextPlan);
  let scheduledCount = 0;
  for (const previewEntry of record.preview.entries) {
    const planEntry = nextPlan.entries.find((entry) => entry.id === previewEntry.planEntryId);
    if (!planEntry || planEntry.kind !== "workout") continue;
    if (install.occurrences.some((occurrence) => !occurrence.removedAt && occurrence.planEntryId === planEntry.id && occurrence.happenDay === previewEntry.happenDay)) {
      continue;
    }
    install.failures = install.failures.filter((failure) => !(failure.planEntryId === planEntry.id && failure.happenDay === previewEntry.happenDay));
    let writeMayHaveSucceeded = false;
    try {
      const beforeEntries = await trainingPlanCalendarAdapter.listScheduled(previewEntry.happenDay, previewEntry.happenDay);
      const before = new Set(beforeEntries.map(scheduleIdentity));
      writeMayHaveSucceeded = true;
      if (planEntry.programId) {
        await trainingPlanCalendarAdapter.scheduleLibrary(planEntry.programId, previewEntry.happenDay);
      } else if (planEntry.workout) {
        await trainingPlanCalendarAdapter.createAndSchedule(
          { ...planEntry.workout, schedule_date: previewEntry.happenDay, save_to_library: false },
          previewEntry.happenDay,
          unitSystem,
          false
        );
      } else {
        throw new Error("The plan workout definition is missing.");
      }
      const captured = await captureScheduledIdentity(previewEntry, before);
      if (!captured) throw new Error("COROS accepted the workout, but its schedule identity could not be verified yet.");
      install.occurrences.push({
        planEntryId: planEntry.id,
        happenDay: captured.happenDay,
        schedulePlanId: captured.planId,
        scheduleIdInPlan: captured.idInPlan,
        planProgramId: captured.planProgramId,
        createdAt: new Date().toISOString()
      });
      scheduledCount += 1;
    } catch (cause) {
      install.failures.push({
        planEntryId: planEntry.id,
        happenDay: previewEntry.happenDay,
        message: cause instanceof Error ? cause.message : String(cause),
        writeMayHaveSucceeded
      });
    }
    install.updatedAt = new Date().toISOString();
    install.state = "partial";
    nextPlan = { ...nextPlan, calendarInstalls: [...installs, structuredClone(install)] };
    saveTrainingPlanDocument(nextPlan);
  }
  install.state = install.failures.length > 0 ? "partial" : "active";
  install.updatedAt = new Date().toISOString();
  nextPlan = { ...nextPlan, calendarInstalls: [...installs, structuredClone(install)] };
  saveTrainingPlanDocument(nextPlan);
  planCalendarPreviews.delete(previewId);
  return {
    plan: nextPlan,
    scheduledCount,
    removedCount: 0,
    failures: structuredClone(install.failures)
  };
}

export async function removeTrainingPlanFromCalendar(
  previewId: string,
  confirmed: boolean
): Promise<TrainingPlanCalendarMutationResult> {
  const { record, plan } = await requireCurrentCalendarPreview(previewId, "remove", confirmed);
  const install = plan.calendarInstalls?.find((item) => item.id === record.installId);
  if (!install) throw new Error("The calendar installation was not found.");
  install.lastOperation = "remove";
  install.state = "partial";
  install.updatedAt = new Date().toISOString();
  saveTrainingPlanDocument(plan);
  let removedCount = 0;
  const failures: TrainingPlanCalendarFailure[] = [];
  for (const previewEntry of record.preview.entries) {
    const occurrence = install.occurrences.find((item) =>
      item.planEntryId === previewEntry.planEntryId &&
      item.schedulePlanId === previewEntry.schedulePlanId &&
      item.scheduleIdInPlan === previewEntry.scheduleIdInPlan &&
      !item.removedAt
    );
    if (!occurrence) continue;
    try {
      const current = await trainingPlanCalendarAdapter.listScheduled(occurrence.happenDay, occurrence.happenDay);
      const present = current.some((entry) =>
        entry.planId === occurrence.schedulePlanId && entry.idInPlan === occurrence.scheduleIdInPlan
      );
      if (present) {
        await trainingPlanCalendarAdapter.removeScheduled({
          planId: occurrence.schedulePlanId,
          idInPlan: occurrence.scheduleIdInPlan,
          planProgramId: occurrence.planProgramId,
          pbVersion: occurrence.pbVersion
        });
        removedCount += 1;
      }
      occurrence.removedAt = new Date().toISOString();
    } catch (cause) {
      failures.push({
        planEntryId: occurrence.planEntryId,
        happenDay: occurrence.happenDay,
        message: cause instanceof Error ? cause.message : String(cause)
      });
    }
    install.updatedAt = new Date().toISOString();
    saveTrainingPlanDocument(plan);
  }
  const today = dateKey(new Date());
  const futureOwned = install.occurrences.some((occurrence) => !occurrence.removedAt && occurrence.happenDay >= today);
  const unresolved = install.failures.some((failure) => failure.writeMayHaveSucceeded && failure.happenDay >= today);
  install.state = futureOwned || unresolved || failures.length > 0 ? "partial" : "removed";
  install.updatedAt = new Date().toISOString();
  saveTrainingPlanDocument(plan);
  planCalendarPreviews.delete(previewId);
  return {
    plan,
    scheduledCount: 0,
    removedCount,
    failures: [
      ...failures,
      ...install.failures.filter((failure) => failure.writeMayHaveSucceeded && failure.happenDay >= today)
    ]
  };
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

function toManualActivityLink(match: TrainingActivityMatch): ManualActivityLink {
  return {
    planId: match.schedulePlanId,
    idInPlan: match.scheduleIdInPlan,
    happenDay: match.happenDay,
    activityId: match.activityId
  };
}

/**
 * Plan adherence from links only — COROS's (the workout was started from the
 * plan) or the user's. A same-day activity nobody linked doesn't count, the
 * same rule the calendar and COROS's own calendar use.
 */
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
  const links = resolveActivityLinks(
    scheduled,
    activities,
    previous.filter((match) => match.manual).map(toManualActivityLink)
  );
  const fetched = new Set(activities.map((activity) => activity.activityId));
  const results: TrainingActivityMatch[] = [];
  for (const entry of scheduled) {
    const key = scheduledLinkKey(entry);
    const manual = existing.get(key);
    const link = links.get(key);
    if (
      manual?.manual &&
      manual.activityId &&
      link?.source !== "manual" &&
      (!fetched.has(manual.activityId) || manual.status === "skipped")
    ) {
      // The user's activity is outside this fetch (range or page cap), or they
      // skipped the session: keep their row as it is.
      results.push(manual);
      continue;
    }
    // A user link that no longer resolves (other day, or another workout has the
    // activity) stops counting; don't save whatever resolved instead as theirs.
    const keepsManual = manual?.manual === true && (link?.source === "manual" || !manual.activityId);
    const activity = link?.activity;
    const confidence = link ? (link.source === "manual" ? manual?.confidence ?? 1 : 1) : undefined;
    const corosRate = link?.source === "coros" ? entry.corosActivity?.completeRate : undefined;
    const ratio = corosRate ?? (entry.trainingLoad && activity?.trainingLoad !== undefined
      ? activity.trainingLoad / entry.trainingLoad
      : undefined);
    const status: TrainingActivityMatch["status"] = keepsManual && manual?.status === "skipped"
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
      manual: keepsManual,
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

/** The user's own plan↔activity links in a range (manual rows only). */
export function listManualActivityLinks(startDay: string, endDay: string): ManualActivityLink[] {
  return listTrainingActivityMatches()
    .filter((match) => match.manual && match.happenDay >= startDay && match.happenDay <= endDay)
    .map(toManualActivityLink);
}

/**
 * Link an activity to a scheduled workout, or with no `activity` say that none
 * belongs to it (this also hides COROS's own link). Local only: COROS has no
 * API for linking.
 */
export function saveManualActivityLink(
  entry: Pick<TrainingHubScheduledWorkoutEntry, "planId" | "idInPlan" | "happenDay" | "trainingLoad">,
  activity?: Pick<TrainingHubActivity, "activityId" | "duration" | "distance" | "trainingLoad">
): ManualActivityLink {
  const existing = listTrainingActivityMatches().find(
    (match) => match.schedulePlanId === entry.planId && match.scheduleIdInPlan === entry.idInPlan
  );
  const ratio = activity && entry.trainingLoad && activity.trainingLoad !== undefined
    ? activity.trainingLoad / entry.trainingLoad
    : undefined;
  const match: TrainingActivityMatch = {
    id: existing?.id ?? crypto.randomUUID(),
    planId: existing?.planId,
    planEntryId: existing?.planEntryId,
    schedulePlanId: entry.planId,
    scheduleIdInPlan: entry.idInPlan,
    activityId: activity?.activityId,
    happenDay: entry.happenDay,
    status: activity
      ? ratio !== undefined && ratio < 0.75 ? "partial" : "completed"
      : entry.happenDay < dateKey(new Date()) ? "missed" : "upcoming",
    confidence: activity ? 1 : undefined,
    manual: true,
    completedDurationSeconds: activity?.duration,
    completedDistanceMeters: activity?.distance,
    plannedTrainingLoad: entry.trainingLoad ?? existing?.plannedTrainingLoad,
    completedTrainingLoad: activity?.trainingLoad,
    updatedAt: new Date().toISOString()
  };
  saveTrainingActivityMatch(match);
  return toManualActivityLink(match);
}

/** Drop the user's link so the workout goes back to COROS's own (or none). */
export function clearManualActivityLink(planId: string, idInPlan: string): void {
  const existing = listTrainingActivityMatches().find(
    (match) => match.schedulePlanId === planId && match.scheduleIdInPlan === idInPlan
  );
  if (!existing?.manual) return;
  saveTrainingActivityMatch({
    ...existing,
    activityId: undefined,
    confidence: undefined,
    manual: false,
    status: existing.happenDay < dateKey(new Date()) ? "missed" : "upcoming",
    completedDurationSeconds: undefined,
    completedDistanceMeters: undefined,
    completedTrainingLoad: undefined,
    updatedAt: new Date().toISOString()
  });
}
