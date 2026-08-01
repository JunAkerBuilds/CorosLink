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
  createAndScheduleWorkout,
  deleteWorkoutProgram,
  listLibraryWorkouts,
  listScheduledWorkoutEntries,
  listTrainingHubActivities,
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

const UNVERIFIED_WRITE_REASON =
  "Native COROS plan writes are unavailable.";

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
  if (activeTrainingPlanCalendarInstall(plan)) {
    throw new Error("Remove this plan's future calendar workouts before deleting the plan.");
  }
  deleteTrainingPlanDocument(id);
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
  const start = parsePlanDay(startDay)!;
  if (start.getDay() !== 1) throw new Error("The plan start date must be a Monday.");
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
