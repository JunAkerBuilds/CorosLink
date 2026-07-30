import {
  getWorkoutProgramDetail,
  readNativeTrainingPlanEndpoint
} from "./trainingHubService";
import type {
  NativeCorosPlanDetail,
  NativeCorosPlanEntity,
  NativeCorosPlanProgram,
  NativeCorosPlanSummary,
  TrainingHubScheduledExercise
} from "./types";

type RawPlan = Record<string, unknown>;

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = String(value).trim();
  return parsed || undefined;
}

function objectArray(value: unknown): RawPlan[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is RawPlan => typeof item === "object" && item !== null
      )
    : [];
}

function mapEntity(raw: RawPlan): NativeCorosPlanEntity {
  return {
    idInPlan: stringValue(raw.idInPlan) ?? stringValue(raw.id) ?? "",
    planProgramId: stringValue(raw.planProgramId),
    happenDay: stringValue(raw.happenDay),
    dayNo: numberValue(raw.dayNo),
    sortNo: numberValue(raw.sortNo),
    sortNoInPlan: numberValue(raw.sortNoInPlan),
    sortNoInSchedule: numberValue(raw.sortNoInSchedule),
    status: numberValue(raw.status) ?? numberValue(raw.executeStatus)
  };
}

function mapProgram(raw: RawPlan): NativeCorosPlanProgram {
  return {
    id: stringValue(raw.id),
    idInPlan: stringValue(raw.idInPlan),
    planProgramId: stringValue(raw.planProgramId),
    name: stringValue(raw.name) ?? "Workout",
    overview: stringValue(raw.overview),
    sportType: numberValue(raw.sportType),
    planDistance: numberValue(raw.planDistance) ?? numberValue(raw.distance),
    planDuration: numberValue(raw.planDuration) ?? numberValue(raw.duration),
    planTrainingLoad:
      numberValue(raw.planTrainingLoad) ?? numberValue(raw.trainingLoad),
    planSets: numberValue(raw.planSets) ?? numberValue(raw.totalSets),
    exercises: objectArray(raw.exercises) as unknown as TrainingHubScheduledExercise[]
  };
}

function mapSummary(raw: RawPlan, syncedAt: string): NativeCorosPlanSummary {
  const programs = objectArray(raw.programs).map(mapProgram);
  const sportTypes = [
    ...new Set(
      programs
        .map((program) => program.sportType)
        .filter((value): value is number => value !== undefined)
    )
  ];
  const sum = (pick: (program: NativeCorosPlanProgram) => number | undefined) =>
    programs.reduce((total, program) => total + (pick(program) ?? 0), 0);
  return {
    remoteId: stringValue(raw.id) ?? "",
    name: stringValue(raw.name) ?? "Training Plan",
    overview: stringValue(raw.overview) ?? "",
    totalDay: numberValue(raw.totalDay) ?? 0,
    minWeeks: numberValue(raw.minWeeks),
    maxWeeks: numberValue(raw.maxWeeks),
    startDay: stringValue(raw.startDay),
    endDay: stringValue(raw.endDay),
    executeStatus: numberValue(raw.executeStatus),
    inSchedule: numberValue(raw.inSchedule) === 1,
    workoutCount: programs.length,
    sportTypes,
    trainingLoad: sum((program) => program.planTrainingLoad) || undefined,
    durationSeconds: sum((program) => program.planDuration) || undefined,
    distanceMeters: sum((program) => program.planDistance) || undefined,
    version: numberValue(raw.version),
    updateTimestamp: numberValue(raw.updateTimestamp),
    syncState: "synced",
    lastSyncedAt: syncedAt
  };
}

export function parseNativeCorosPlan(
  raw: RawPlan,
  syncedAt = new Date().toISOString()
): NativeCorosPlanDetail {
  const summary = mapSummary(raw, syncedAt);
  return {
    ...summary,
    entities: objectArray(raw.entities)
      .map(mapEntity)
      .filter((entity) => entity.idInPlan),
    programs: objectArray(raw.programs).map(mapProgram),
    weekStages: objectArray(raw.weekStages).map((stage) => ({
      weekNo: numberValue(stage.weekNo) ?? 1,
      stage:
        typeof stage.stage === "string" || typeof stage.stage === "number"
          ? stage.stage
          : undefined,
      planDistance: numberValue(stage.planDistance),
      planDuration: numberValue(stage.planDuration),
      planTrainingLoad: numberValue(stage.planTrainingLoad)
    })),
    rawPayload: raw
  };
}

export async function listNativeCorosPlans(): Promise<NativeCorosPlanDetail[]> {
  const data = await readNativeTrainingPlanEndpoint<unknown>(
    "/training/plan/query",
    { method: "POST", body: {} }
  );
  const syncedAt = new Date().toISOString();
  return objectArray(data)
    .map((raw) => parseNativeCorosPlan(raw, syncedAt))
    .filter((plan) => plan.remoteId);
}

export async function readNativeCorosPlan(
  remoteId: string
): Promise<NativeCorosPlanDetail> {
  const plans = await listNativeCorosPlans();
  const listPlan = plans.find((plan) => plan.remoteId === remoteId);
  const rawDetail = await readNativeTrainingPlanEndpoint<RawPlan>(
    "/training/plan/detail",
    {
      method: "GET",
      params: { id: remoteId, supportRestExercise: 1 }
    }
  );
  const detail = parseNativeCorosPlan(rawDetail);
  const groupedRaw = detail.programs.length > 0 || !listPlan
    ? rawDetail
    : {
        ...listPlan.rawPayload,
        ...rawDetail,
        programs: listPlan.rawPayload.programs,
        entities: listPlan.rawPayload.entities,
        weekStages: listPlan.rawPayload.weekStages
      };

  // Plan query/detail can contain intentionally lightweight program records.
  // Resolve their already-verified read-only workout details only when a user
  // opens a plan, keeping library refreshes inexpensive while surfacing richer
  // metrics and step structures whenever COROS exposes them for that program.
  const programs = objectArray(groupedRaw.programs);
  const enrichedPrograms = await Promise.all(
    programs.map(async (program) => {
      const id = stringValue(program.id);
      if (!id) return program;
      const programDetail = await getWorkoutProgramDetail(id);
      if (!programDetail) return program;
      return {
        ...program,
        ...programDetail,
        idInPlan: program.idInPlan ?? programDetail.idInPlan,
        planProgramId: program.planProgramId ?? programDetail.planProgramId
      };
    })
  );

  return parseNativeCorosPlan(
    { ...groupedRaw, programs: enrichedPrograms },
    detail.lastSyncedAt
  );
}
