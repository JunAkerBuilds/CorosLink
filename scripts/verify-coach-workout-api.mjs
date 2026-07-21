// Cleanup-safe live verification for the coach -> COROS structured-workout flow.
//
// Uses the app's saved Training Hub session, creates one uniquely named workout,
// schedules it on a future day, verifies the read-back, and deletes both copies
// in finally. No other account data is modified.
//
// Usage:
//   npm run build:electron && node scripts/verify-coach-workout-api.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;
const {
  applyWorkoutCalculation,
  buildRunWorkoutPayload,
  resetProgramForCreate
} = await import(`${distUrl("corosWorkoutBuilder.js")}?cacheBust=${Date.now()}`);
const {
  buildScheduledWorkoutEditRequest,
  corosProgramToWorkoutDraft,
  parseWorkoutEditorContext,
  workoutDraftToCorosProgram
} = await import(`${distUrl("corosWorkoutEditor.js")}?cacheBust=${Date.now()}`);

const dbPath = path.join(
  os.homedir(),
  "Library/Application Support/coroslink/coroslink.sqlite"
);
const setting = (key) =>
  execFileSync(
    "sqlite3",
    ["-readonly", dbPath, `SELECT value FROM app_settings WHERE key = '${key}';`],
    { encoding: "utf8" }
  ).trim() || undefined;
const auth = {
  accessToken: setting("trainingHub.accessToken"),
  userId: setting("trainingHub.userId"),
  baseUrl: setting("trainingHub.baseUrl")
};

if (!auth.accessToken || !auth.userId || !auth.baseUrl) {
  console.error("No saved COROS session found. Log in through CorosLink first.");
  process.exit(1);
}

function headers(hasBody) {
  return {
    accesstoken: auth.accessToken,
    Accept: "application/json, text/plain, */*",
    yfheader: JSON.stringify({ userId: auth.userId }),
    ...(hasBody ? { "Content-Type": "application/json" } : {})
  };
}

async function api(method, apiPath, { params, body } = {}) {
  const url = new URL(`${auth.baseUrl}${apiPath}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return {
    httpStatus: response.status,
    ok: String(payload.result ?? payload.apiCode ?? "") === "0000",
    result: String(payload.result ?? payload.apiCode ?? ""),
    message: payload.message,
    data: payload.data
  };
}

function requireSuccess(response, operation) {
  assert.equal(
    response.ok,
    true,
    `${operation} failed: ${response.httpStatus} ${response.result} ${response.message ?? ""}`
  );
  return response.data;
}

function futureDay(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

async function querySchedule(day) {
  return requireSuccess(
    await api("GET", "/training/schedule/query", {
      params: { startDate: day, endDate: day, supportRestExercise: 1 }
    }),
    "schedule/query"
  ) ?? {};
}

async function retryRead(read, matches, label) {
  const waits = [0, 250, 600, 1200];
  let latest;
  for (const wait of waits) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    latest = await read();
    if (matches(latest)) return latest;
  }
  assert.fail(`${label} did not become visible after COROS accepted the write.`);
}

function findProbeProgram(schedule) {
  return (schedule.programs ?? []).find((program) =>
    String(program.name ?? "").startsWith(probeName)
  );
}

function findEntityForProgram(schedule, program) {
  return (schedule.entities ?? []).find((entry) =>
    [program?.idInPlan, program?.planProgramId].some(
      (id) => id !== undefined && String(entry.idInPlan) === String(id)
    )
  );
}

function summarizeExercise(exercise) {
  return {
    id: String(exercise.id ?? ""),
    groupId: String(exercise.groupId ?? ""),
    isGroup: Boolean(exercise.isGroup),
    exerciseType: exercise.exerciseType,
    targetType: exercise.targetType,
    targetValue: exercise.targetValue,
    targetDisplayUnit: exercise.targetDisplayUnit,
    intensityType: exercise.intensityType,
    intensityValue: exercise.intensityValue,
    intensityValueExtend: exercise.intensityValueExtend,
    intensityDisplayUnit: exercise.intensityDisplayUnit,
    intensityMultiplier: exercise.intensityMultiplier,
    hrType: exercise.hrType,
    isIntensityPercent: exercise.isIntensityPercent,
    intensityPercent: exercise.intensityPercent,
    intensityPercentExtend: exercise.intensityPercentExtend,
    sets: exercise.sets
  };
}

const probeSuffix = Date.now().toString(36);
const probeName = `CorosLink coach structured probe ${probeSuffix}`;
const happenDay = futureDay(61);
let programId;
let scheduledIdInPlan;

try {
  await querySchedule(happenDay);

  const rawProgram = resetProgramForCreate(
    buildRunWorkoutPayload(probeName, [
      { kind: "warmup", target_type: "open" },
      {
        repeat: 4,
        steps: [
          {
            kind: "training",
            target_type: "distance",
            target_distance_meters: 400,
            pace: "4:05-4:15/km"
          },
          {
            kind: "rest",
            target_type: "time",
            target_duration_seconds: 90
          }
        ]
      },
      {
        kind: "cooldown",
        target_type: "distance",
        target_distance_meters: 1000
      }
    ])
  );

  const rawExercises = rawProgram.exercises;
  const rawWork = rawExercises.find(
    (exercise) => exercise.exerciseType === 2 && exercise.targetValue === 40000
  );
  assert.ok(rawWork, "Builder did not produce the 400 m work step.");
  assert.deepEqual(
    {
      targetDisplayUnit: rawWork.targetDisplayUnit,
      intensityValue: rawWork.intensityValue,
      intensityValueExtend: rawWork.intensityValueExtend,
      intensityDisplayUnit: rawWork.intensityDisplayUnit,
      intensityMultiplier: rawWork.intensityMultiplier
    },
    {
      targetDisplayUnit: 2,
      intensityValue: 245000,
      intensityValueExtend: 255000,
      intensityDisplayUnit: 1,
      intensityMultiplier: 1000
    }
  );

  const calculation = requireSuccess(
    await api("POST", "/training/program/calculate", { body: rawProgram }),
    "program/calculate"
  );
  assert.ok(calculation?.planDistance, "Calculate response omitted planDistance.");
  assert.ok(
    Array.isArray(calculation?.exerciseBarChart),
    "Calculate response omitted exerciseBarChart."
  );
  const calculatedProgram = applyWorkoutCalculation(rawProgram, calculation);

  const addResponse = await api("POST", "/training/program/add", {
    body: calculatedProgram
  });
  const createdId = requireSuccess(addResponse, "program/add");
  assert.ok(createdId !== undefined && createdId !== null, "Add response omitted the program ID.");
  programId = String(createdId);

  const detail = requireSuccess(
    await api("GET", "/training/program/detail", {
      params: { id: programId, supportRestExercise: 1 }
    }),
    "program/detail"
  );
  assert.equal(detail.name, probeName);
  const savedWork = (detail.exercises ?? []).find(
    (exercise) => exercise.exerciseType === 2 && exercise.targetValue === 40000
  );
  assert.ok(savedWork, "Saved program omitted the 400 m work step.");
  assert.equal(savedWork.intensityValue, 245000);
  assert.equal(savedWork.intensityValueExtend, 255000);
  assert.equal(savedWork.intensityDisplayUnit, 1);
  assert.equal(savedWork.intensityMultiplier, 1000);

  const beforeSchedule = await querySchedule(happenDay);
  scheduledIdInPlan = (Number(beforeSchedule.maxIdInPlan) || 0) + 1;
  const scheduledProgram = structuredClone(calculatedProgram);
  scheduledProgram.id = programId;
  scheduledProgram.idInPlan = scheduledIdInPlan;
  const entity = {
    happenDay,
    idInPlan: scheduledIdInPlan,
    sortNoInSchedule: 1,
    exerciseBarChart: structuredClone(calculatedProgram.exerciseBarChart)
  };
  requireSuccess(
    await api("POST", "/training/schedule/update", {
      body: {
        entities: [entity],
        programs: [scheduledProgram],
        versionObjects: [{ id: scheduledIdInPlan, status: 1 }],
        pbVersion: 2
      }
    }),
    "schedule/update"
  );

  const scheduled = await querySchedule(happenDay);
  const scheduledProgramReadback = (scheduled.programs ?? []).find(
    (program) => program.name === probeName
  );
  assert.ok(scheduledProgramReadback, "Calendar read-back omitted the structured program.");
  const scheduledEntity = (scheduled.entities ?? []).find(
    (entry) => String(entry.idInPlan) === String(scheduledProgramReadback.idInPlan)
  );
  assert.ok(scheduledEntity, "Calendar read-back omitted the schedule entity.");
  scheduledIdInPlan = scheduledEntity.idInPlan;
  const scheduledWork = (scheduledProgramReadback.exercises ?? []).find(
    (exercise) => exercise.exerciseType === 2 && exercise.targetValue === 40000
  );
  assert.ok(scheduledWork, "Calendar read-back omitted the 400 m work step.");
  assert.equal(scheduledWork.intensityValue, 245000);
  assert.equal(scheduledWork.intensityValueExtend, 255000);

  const account = requireSuccess(
    await api("GET", "/account/query"),
    "account/query"
  ) ?? {};
  const editorContext = parseWorkoutEditorContext(account);

  // Edit the reusable library definition with identity fields intact.
  const libraryDraft = corosProgramToWorkoutDraft(detail);
  libraryDraft.name = `${probeName} library edited`;
  libraryDraft.overview = "Library edit isolation probe";
  const libraryGroup = libraryDraft.nodes.find((node) => node.nodeType === "repeat");
  assert.ok(libraryGroup, "Library draft omitted the repeat group.");
  const libraryWork = libraryGroup.steps.find((step) => step.kind === "training");
  const libraryRest = libraryGroup.steps.find((step) => step.kind === "rest");
  assert.ok(libraryWork && libraryRest, "Library draft omitted work/rest steps.");
  libraryWork.target = { type: "distance", meters: 500 };
  libraryWork.intensity = {
    type: "pace",
    lowSecondsPerKm: 260,
    highSecondsPerKm: 270,
    displayUnit: "km"
  };
  libraryRest.target = { type: "hrRecovery", bpm: 118 };
  const libraryCooldown = libraryDraft.nodes.find(
    (node) => node.nodeType === "step" && node.kind === "cooldown"
  );
  assert.ok(libraryCooldown, "Library draft omitted cooldown.");
  libraryCooldown.intensity = {
    type: "lthrPercent",
    lowPercent: 91,
    highPercent: 95
  };
  const libraryEdited = workoutDraftToCorosProgram(
    detail,
    libraryDraft,
    editorContext
  );
  assert.equal(String(libraryEdited.id), programId, "Library edit cleared program ID.");
  assert.equal(libraryEdited.version, detail.version, "Library edit cleared version.");
  const libraryCalculation = requireSuccess(
    await api("POST", "/training/program/calculate", { body: libraryEdited }),
    "program/calculate library edit"
  );
  const calculatedLibraryEdit = applyWorkoutCalculation(
    libraryEdited,
    libraryCalculation
  );
  requireSuccess(
    await api("POST", "/training/program/update", { body: calculatedLibraryEdit }),
    "program/update"
  );
  const libraryReadback = await retryRead(
    () => api("GET", "/training/program/detail", {
      params: { id: programId, supportRestExercise: 1 }
    }).then((response) => requireSuccess(response, "program/detail after library edit")),
    (program) => program.name === libraryDraft.name,
    "Library edit"
  );
  const libraryWorkReadback = (libraryReadback.exercises ?? []).find(
    (exercise) => exercise.exerciseType === 2 && exercise.targetValue === 50000
  );
  const libraryRestReadback = (libraryReadback.exercises ?? []).find(
    (exercise) => exercise.exerciseType === 4
  );
  const libraryLthrReadback = (libraryReadback.exercises ?? []).find(
    (exercise) => exercise.intensityPercent === 91
  );
  assert.ok(libraryWorkReadback, "Library edit did not preserve the 500 m target.");
  assert.equal(libraryWorkReadback.intensityValue, 260000);
  assert.equal(libraryWorkReadback.intensityValueExtend, 270000);
  assert.equal(libraryRestReadback?.targetType, 7);
  assert.equal(libraryRestReadback?.targetValue, 118);
  assert.equal(libraryLthrReadback?.isIntensityPercent, true);
  assert.equal(libraryLthrReadback?.intensityPercentExtend, 95);
  assert.equal(Number(libraryReadback.distance), Number(calculatedLibraryEdit.distance));
  assert.equal(Number(libraryReadback.duration), Number(calculatedLibraryEdit.duration));
  assert.equal(Number(libraryReadback.trainingLoad), Number(calculatedLibraryEdit.trainingLoad));

  // The already scheduled copy must remain unchanged after the library edit.
  const afterLibraryEditSchedule = await querySchedule(happenDay);
  const isolatedScheduledProgram = findProbeProgram(afterLibraryEditSchedule);
  assert.equal(isolatedScheduledProgram?.name, probeName);
  assert.ok(
    (isolatedScheduledProgram?.exercises ?? []).some(
      (exercise) => exercise.exerciseType === 2 && exercise.targetValue === 40000
    ),
    "Library edit unexpectedly changed the scheduled occurrence."
  );

  // Edit only the scheduled occurrence using COROS status 2 semantics.
  const scheduledDraft = corosProgramToWorkoutDraft(isolatedScheduledProgram);
  scheduledDraft.name = `${probeName} scheduled edited`;
  scheduledDraft.overview = "Scheduled occurrence isolation probe";
  const scheduledGroup = scheduledDraft.nodes.find((node) => node.nodeType === "repeat");
  const scheduledWorkDraft = scheduledGroup?.steps.find((step) => step.kind === "training");
  const scheduledRestDraft = scheduledGroup?.steps.find((step) => step.kind === "rest");
  assert.ok(scheduledGroup && scheduledWorkDraft && scheduledRestDraft);
  scheduledGroup.repeat = 5;
  scheduledWorkDraft.target = { type: "distance", meters: 600 };
  scheduledWorkDraft.intensity = {
    type: "pace",
    lowSecondsPerKm: 270,
    highSecondsPerKm: 280,
    displayUnit: "km"
  };
  scheduledRestDraft.target = { type: "hrRecovery", bpm: 115 };
  const scheduledEdited = workoutDraftToCorosProgram(
    isolatedScheduledProgram,
    scheduledDraft,
    editorContext
  );
  const scheduledCalculation = requireSuccess(
    await api("POST", "/training/program/calculate", { body: scheduledEdited }),
    "program/calculate scheduled edit"
  );
  const calculatedScheduledEdit = applyWorkoutCalculation(
    scheduledEdited,
    scheduledCalculation
  );
  const entityForEdit = findEntityForProgram(
    afterLibraryEditSchedule,
    isolatedScheduledProgram
  );
  assert.ok(entityForEdit, "Scheduled edit source entity was not found.");
  const scheduledRef = {
    kind: "scheduled",
    happenDay,
    planId: String(entityForEdit.planId ?? ""),
    idInPlan: String(entityForEdit.idInPlan),
    planProgramId: String(
      entityForEdit.planProgramId ?? isolatedScheduledProgram.idInPlan
    )
  };
  const scheduleEditRequest = buildScheduledWorkoutEditRequest(
    scheduledRef,
    entityForEdit,
    calculatedScheduledEdit
  );
  assert.equal(scheduleEditRequest.versionObjects[0].status, 2);
  requireSuccess(
    await api("POST", "/training/schedule/update", { body: scheduleEditRequest }),
    "schedule/update edit"
  );
  const scheduledEditReadback = await retryRead(
    () => querySchedule(happenDay),
    (schedule) => findProbeProgram(schedule)?.name === scheduledDraft.name,
    "Scheduled occurrence edit"
  );
  const editedScheduledProgram = findProbeProgram(scheduledEditReadback);
  const editedScheduledGroup = (editedScheduledProgram.exercises ?? []).find(
    (exercise) => exercise.isGroup
  );
  const editedScheduledWork = (editedScheduledProgram.exercises ?? []).find(
    (exercise) => exercise.exerciseType === 2 && exercise.targetValue === 60000
  );
  const editedScheduledRest = (editedScheduledProgram.exercises ?? []).find(
    (exercise) => exercise.exerciseType === 4
  );
  assert.equal(editedScheduledGroup?.sets, 5);
  assert.equal(editedScheduledWork?.intensityValue, 270000);
  assert.equal(editedScheduledWork?.intensityValueExtend, 280000);
  assert.equal(editedScheduledRest?.targetType, 7);
  assert.equal(editedScheduledRest?.targetValue, 115);
  assert.equal(Number(editedScheduledProgram.distance), Number(calculatedScheduledEdit.distance));
  assert.equal(Number(editedScheduledProgram.duration), Number(calculatedScheduledEdit.duration));
  assert.equal(Number(editedScheduledProgram.trainingLoad), Number(calculatedScheduledEdit.trainingLoad));

  const libraryIsolationReadback = requireSuccess(
    await api("GET", "/training/program/detail", {
      params: { id: programId, supportRestExercise: 1 }
    }),
    "program/detail isolation verification"
  );
  assert.equal(libraryIsolationReadback.name, libraryDraft.name);
  assert.ok(
    (libraryIsolationReadback.exercises ?? []).some(
      (exercise) => exercise.exerciseType === 2 && exercise.targetValue === 50000
    ),
    "Scheduled edit unexpectedly changed the library definition."
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoints: {
          calculate: {
            result: "0000",
            planDistance: calculation.planDistance,
            planDuration: calculation.planDuration,
            planTrainingLoad: calculation.planTrainingLoad,
            planSets: calculation.planSets,
            distanceDisplayUnit: calculation.distanceDisplayUnit,
            exerciseBarChartEntries: calculation.exerciseBarChart.length
          },
          add: { result: addResponse.result, returnedProgramId: true },
          detail: {
            result: "0000",
            exerciseCount: detail.exercises?.length ?? 0,
            workStep: summarizeExercise(savedWork)
          },
          scheduleUpdate: { result: "0000" },
          scheduleQuery: {
            result: "0000",
            foundProgram: true,
            foundEntity: true,
            workStep: summarizeExercise(scheduledWork)
          },
          libraryUpdate: {
            result: "0000",
            isolatedFromSchedule: true,
            repeatCount: libraryReadback.exercises?.find((exercise) => exercise.isGroup)?.sets,
            workStep: summarizeExercise(libraryWorkReadback),
            restStep: summarizeExercise(libraryRestReadback),
            lthrStep: summarizeExercise(libraryLthrReadback)
          },
          scheduledOccurrenceUpdate: {
            result: "0000",
            status: scheduleEditRequest.versionObjects[0].status,
            isolatedFromLibrary: true,
            repeatCount: editedScheduledGroup.sets,
            workStep: summarizeExercise(editedScheduledWork),
            restStep: summarizeExercise(editedScheduledRest)
          }
        }
      },
      null,
      2
    )
  );
} finally {
  try {
    const scheduled = await querySchedule(happenDay);
    const programs = (scheduled.programs ?? []).filter(
      (program) => String(program.name ?? "").startsWith(probeName)
    );
    for (const program of programs) {
      const entity = (scheduled.entities ?? []).find(
        (entry) => String(entry.idInPlan) === String(program.idInPlan)
      );
      if (!entity) continue;
      const response = await api("POST", "/training/schedule/update", {
        body: {
          versionObjects: [
            {
              id: entity.idInPlan,
              planProgramId: entity.planProgramId ?? entity.idInPlan,
              planId: entity.planId,
              status: 3
            }
          ],
          pbVersion: 2
        }
      });
      console.log(`cleanup schedule: ${response.ok ? "ok" : "failed"}`);
    }
  } catch (error) {
    console.error(`cleanup schedule failed: ${error instanceof Error ? error.message : error}`);
  }

  if (programId) {
    try {
      const response = await api("POST", "/training/program/delete", {
        body: [programId]
      });
      console.log(`cleanup library: ${response.ok ? "ok" : "failed"}`);
    } catch (error) {
      console.error(`cleanup library failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
