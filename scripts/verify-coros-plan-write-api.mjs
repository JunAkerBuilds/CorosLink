// Cleanup-safe live verification for the native COROS Training Plan Library
// write flow (issue #4): create -> read-back -> activate -> deactivate ->
// delete, exercised against a real Training Hub session for a representative
// multi-week plan. Deletes every temporary artifact in `finally`. No other
// account data is modified.
//
// This exercises the wire contract directly (its own fetch client, not
// trainingHubService.ts) so the app's own abstraction isn't testing itself.
//
// Usage:
//   npm run build:electron && node scripts/verify-coros-plan-write-api.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;
const { applyWorkoutCalculation, buildRunWorkoutPayload, resetProgramForCreate } =
  await import(`${distUrl("corosWorkoutBuilder.js")}?cacheBust=${Date.now()}`);

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
  regionId: setting("trainingHub.regionId"),
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

function addDays(day, offset) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(4, 6)) - 1;
  const date = Number(day.slice(6, 8));
  const next = new Date(year, month, date + offset);
  return `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
}

async function retryRead(read, matches, label) {
  const waits = [0, 250, 600, 1200, 2000];
  let latest;
  for (const wait of waits) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    latest = await read();
    if (matches(latest)) return latest;
  }
  assert.fail(`${label} did not become visible after COROS accepted the write.`);
}

function simpleRunProgram(name, meters) {
  return resetProgramForCreate(
    buildRunWorkoutPayload(name, [
      { kind: "training", target_type: "distance", target_distance_meters: meters }
    ])
  );
}

const probeSuffix = Date.now().toString(36);
const probeName = `CorosLink plan-write probe ${probeSuffix}`;
// Far enough out to never collide with a real activated plan.
const startDay = futureDay(120);
// A representative two-week plan: four workouts across both weeks.
const dayOffsets = [0, 3, 7, 10];
const workoutMeters = [5000, 8000, 10000, 6000];
const scheduledDays = dayOffsets.map((offset) => addDays(startDay, offset));

let planId;
let activePlanId;

try {
  const built = dayOffsets.map((dayNo, index) => ({
    idInPlan: index + 1,
    dayNo,
    raw: simpleRunProgram(`${probeName} day ${dayNo}`, workoutMeters[index])
  }));

  const entities = [];
  const programs = [];
  let pbVersion = 2;
  for (const entry of built) {
    const calculation = requireSuccess(
      await api("POST", "/training/program/calculate", { body: entry.raw }),
      `program/calculate day ${entry.dayNo}`
    );
    const calculated = {
      ...applyWorkoutCalculation(entry.raw, calculation),
      idInPlan: entry.idInPlan
    };
    programs.push(calculated);
    pbVersion = Math.max(pbVersion, Number(calculated.pbVersion) || 2);
    // Plan Library entities carry placeholder identity only; happenDay is
    // set when the plan is activated (executeSubPlan), not at create time.
    entities.push({
      happenDay: "",
      idInPlan: entry.idInPlan,
      dayNo: entry.dayNo,
      sortNo: entry.idInPlan,
      sortNoInPlan: entry.idInPlan,
      sortNoInSchedule: 1
    });
  }

  const totalDay = Math.max(...dayOffsets) + 1;
  const weeks = Math.max(1, Math.ceil(totalDay / 7));

  const planPayload = {
    name: probeName,
    overview: "Cleanup-safe verifier probe -- safe to delete if found.",
    entities,
    programs,
    weekStages: [],
    maxIdInPlan: programs.length,
    totalDay,
    unit: 1,
    sourceId: "",
    sourceUrl: "",
    minWeeks: weeks,
    maxWeeks: weeks,
    region: auth.regionId ?? "1",
    pbVersion,
    versionObjects: entities.map((entity) => ({ id: entity.idInPlan, status: 1 }))
  };

  // 1. Create.
  const addResponse = await api("POST", "/training/plan/add", { body: planPayload });
  const createdId = requireSuccess(addResponse, "plan/add");
  assert.ok(createdId, "Add response omitted the plan ID.");
  planId = String(createdId);

  // 2. Read back.
  const detail = await retryRead(
    () =>
      api("GET", "/training/plan/detail", {
        params: { id: planId, supportRestExercise: 1 }
      }).then((response) => requireSuccess(response, "plan/detail")),
    (plan) => plan?.name === probeName,
    "Plan create"
  );
  assert.equal(detail.name, probeName);
  assert.equal(
    (detail.entities ?? []).length,
    dayOffsets.length,
    "Read-back entity count mismatch."
  );
  assert.equal(
    (detail.programs ?? []).length,
    dayOffsets.length,
    "Read-back program count mismatch."
  );

  // 3. Activate.
  requireSuccess(
    await api("POST", "/training/schedule/executeSubPlan", {
      params: { startDay, subPlanId: planId },
      body: {}
    }),
    "schedule/executeSubPlan"
  );

  const activePlans = await retryRead(
    () =>
      api("POST", "/training/plan/query", { body: { statusList: [1] } }).then(
        (response) => requireSuccess(response, "plan/query active")
      ),
    (plans) => (plans ?? []).some((plan) => String(plan.originId ?? "") === planId),
    "Plan activation"
  );
  const activePlan = activePlans.find((plan) => String(plan.originId ?? "") === planId);
  assert.ok(activePlan, "Activated plan instance not found via plan/query.");
  activePlanId = String(activePlan.id);
  assert.equal(activePlan.startDay, startDay, "Activated plan started on the wrong day.");

  const scheduleAfterActivate = requireSuccess(
    await api("GET", "/training/schedule/query", {
      params: {
        startDate: scheduledDays[0],
        endDate: scheduledDays[scheduledDays.length - 1],
        supportRestExercise: 1
      }
    }),
    "schedule/query after activate"
  );
  const scheduledPrograms = (scheduleAfterActivate.programs ?? []).filter((program) =>
    String(program.name ?? "").startsWith(probeName)
  );
  assert.equal(
    scheduledPrograms.length,
    dayOffsets.length,
    "Activation did not materialize every workout onto the calendar."
  );

  // 4. Deactivate.
  requireSuccess(
    await api("POST", "/training/schedule/quitSubPlan", {
      params: { subPlanId: activePlanId }
    }),
    "schedule/quitSubPlan"
  );

  const scheduleAfterQuit = await retryRead(
    () =>
      api("GET", "/training/schedule/query", {
        params: {
          startDate: scheduledDays[0],
          endDate: scheduledDays[scheduledDays.length - 1],
          supportRestExercise: 1
        }
      }).then((response) => requireSuccess(response, "schedule/query after quit")),
    (schedule) =>
      !(schedule.programs ?? []).some((program) =>
        String(program.name ?? "").startsWith(probeName)
      ),
    "Plan deactivation"
  );
  assert.equal(
    (scheduleAfterQuit.programs ?? []).filter((program) =>
      String(program.name ?? "").startsWith(probeName)
    ).length,
    0,
    "Deactivation left workouts on the calendar."
  );

  // 5. Delete the library plan.
  requireSuccess(
    await api("POST", "/training/plan/delete", { body: [planId] }),
    "plan/delete"
  );
  const deletedPlanId = planId;
  planId = undefined; // deleted; the name-prefix sweep below still verifies it.

  const plansAfterDelete = requireSuccess(
    await api("POST", "/training/plan/query", { body: {} }),
    "plan/query after delete"
  );
  assert.ok(
    !(plansAfterDelete ?? []).some((plan) => String(plan.name ?? "") === probeName),
    "Deleted plan still appears in the library."
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoints: {
          add: { result: "0000", planId: deletedPlanId },
          detail: {
            result: "0000",
            entityCount: detail.entities.length,
            programCount: detail.programs.length
          },
          executeSubPlan: { result: "0000", activePlanId, startDay },
          quitSubPlan: { result: "0000", calendarCleared: true },
          delete: { result: "0000", removedFromLibrary: true }
        }
      },
      null,
      2
    )
  );
} finally {
  // Defensive sweep by name prefix, independent of what the steps above
  // captured -- mirrors verify-coach-workout-api.mjs so a failed assertion
  // midway through the flow can't strand a plan on the account.
  try {
    const active = await api("POST", "/training/plan/query", {
      body: { statusList: [1, 2] }
    });
    for (const plan of active.ok ? active.data ?? [] : []) {
      if (!String(plan.name ?? "").startsWith(probeName)) continue;
      const id = String(plan.id ?? "");
      if (!id) continue;
      try {
        const response = await api("POST", "/training/schedule/quitSubPlan", {
          params: { subPlanId: id }
        });
        console.log(`cleanup quitSubPlan ${id}: ${response.ok ? "ok" : "failed"}`);
      } catch (error) {
        console.error(
          `cleanup quitSubPlan ${id} failed: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  } catch (error) {
    console.error(
      `cleanup active-plan scan failed: ${error instanceof Error ? error.message : error}`
    );
  }

  try {
    const library = await api("POST", "/training/plan/query", { body: {} });
    const stray = (library.ok ? library.data ?? [] : []).filter((plan) =>
      String(plan.name ?? "").startsWith(probeName)
    );
    for (const plan of stray) {
      const id = String(plan.id ?? "");
      if (!id) continue;
      try {
        const response = await api("POST", "/training/plan/delete", { body: [id] });
        console.log(`cleanup plan/delete ${id}: ${response.ok ? "ok" : "failed"}`);
      } catch (error) {
        console.error(
          `cleanup plan/delete ${id} failed: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  } catch (error) {
    console.error(
      `cleanup library-plan scan failed: ${error instanceof Error ? error.message : error}`
    );
  }
}
