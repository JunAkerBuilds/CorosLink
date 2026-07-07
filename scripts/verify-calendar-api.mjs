// One-off live verification for the Training Calendar feature.
//
// Verifies three undocumented COROS API behaviors the calendar depends on:
//   1. /training/schedule/update with versionObjects status 2 — is it a "move"?
//   2. /activity/query — does it accept startDay/endDay filters?
//   3. Scheduling a workout on a past day — accepted or rejected?
//
// Reuses the app's stored session from coroslink.sqlite (read-only). Creates a
// temporary workout ("CorosLink API Probe — delete me"), schedules/moves it on
// far-future dates, then removes both the schedule entries and the library
// program. Nothing else on the account is touched.
//
// Usage: npm run build:electron && node scripts/verify-calendar-api.mjs

import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");

const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;
const { buildWorkoutPayloadFromEntry, resetProgramForCreate } = await import(
  `${distUrl("corosWorkoutBuilder.js")}?cacheBust=${Date.now()}`
);

// --- session from the app's settings DB (token is stored in plain text).
// The repo's better-sqlite3 is compiled for Electron's ABI, so use the
// system sqlite3 CLI to read the settings instead.
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
if (!auth.accessToken || !auth.baseUrl) {
  console.error("No stored COROS session found. Log in via the app first.");
  process.exit(1);
}
console.log(`Using session at ${auth.baseUrl} (userId ${auth.userId})`);

// --- tiny API client mirroring trainingHubService ---
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
  for (const [k, v] of Object.entries(params ?? {})) {
    url.searchParams.set(k, String(v));
  }
  const response = await fetch(url, {
    method,
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  const result = String(payload.result ?? payload.apiCode ?? "");
  return { ok: result === "0000", result, message: payload.message, data: payload.data };
}

const day = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

async function querySchedule(startDate, endDate) {
  const res = await api("GET", "/training/schedule/query", {
    params: { startDate, endDate, supportRestExercise: 1 }
  });
  if (!res.ok) throw new Error(`schedule/query failed: ${res.result} ${res.message}`);
  return res.data ?? {};
}

const PROBE_NAME = "CorosLink API Probe — delete me";
const DAY_A = day(55);
const DAY_B = day(56);
const PAST_DAY = day(-2);
const cleanup = { scheduled: [], programId: undefined };

async function scheduleProgramOn(program, happenDay) {
  const existing = await querySchedule(happenDay, happenDay);
  const idInPlan = (Number(existing.maxIdInPlan) || 0) + 1;
  const programPayload = structuredClone(program);
  programPayload.idInPlan = idInPlan;
  const res = await api("POST", "/training/schedule/update", {
    body: {
      entities: [{ happenDay, idInPlan, sortNoInSchedule: 1 }],
      programs: [programPayload],
      versionObjects: [{ id: idInPlan, status: 1 }],
      pbVersion: 2
    }
  });
  return { res, idInPlan };
}

function probeEntities(scheduleData) {
  const entities = Array.isArray(scheduleData.entities) ? scheduleData.entities : [];
  const programs = Array.isArray(scheduleData.programs) ? scheduleData.programs : [];
  const probeIds = new Set(
    programs.filter((p) => p.name === PROBE_NAME).map((p) => String(p.idInPlan))
  );
  return entities.filter((e) => probeIds.has(String(e.idInPlan)));
}

try {
  // ---------- 1. sanity: token works ----------
  const today = day(0);
  await querySchedule(today, today);
  console.log("✓ Session token works (schedule/query ok)");

  // ---------- 2. /activity/query date filters ----------
  const plain = await api("GET", "/activity/query", { params: { size: 20, pageNumber: 1 } });
  const list = plain.data?.dataList ?? [];
  console.log(`activity/query plain: ok=${plain.ok} count=${list.length}`);
  if (list.length > 1) {
    // Pick a narrow window around one known activity and see if filters apply.
    const ts = list[Math.floor(list.length / 2)].startTime; // epoch seconds
    const d = new Date(ts * 1000);
    const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    for (const paramNames of [
      ["startDay", "endDay"],
      ["startDate", "endDate"]
    ]) {
      const res = await api("GET", "/activity/query", {
        params: { size: 50, pageNumber: 1, [paramNames[0]]: key, [paramNames[1]]: key }
      });
      const filtered = res.data?.dataList ?? [];
      const allInDay = filtered.every((a) => {
        const ad = new Date(a.startTime * 1000);
        const adKey = `${ad.getFullYear()}${String(ad.getMonth() + 1).padStart(2, "0")}${String(ad.getDate()).padStart(2, "0")}`;
        return adKey === key;
      });
      console.log(
        `activity/query ${paramNames.join("/")}=${key}: ok=${res.ok} count=${filtered.length} allInDay=${allInDay} → ${
          res.ok && filtered.length < list.length && allInDay ? "FILTER WORKS" : "filter ignored/unsupported"
        }`
      );
    }
  }

  // ---------- 3. create probe program ----------
  const payload = resetProgramForCreate(
    buildWorkoutPayloadFromEntry({ key: "probe", name: PROBE_NAME, distance_km: 3 })
  );
  const addRes = await api("POST", "/training/program/add", { body: payload });
  if (!addRes.ok) throw new Error(`program/add failed: ${addRes.result} ${addRes.message}`);
  let programId = addRes.data !== undefined && addRes.data !== null ? String(addRes.data) : undefined;
  const libraryRes = await api("POST", "/training/program/query", { body: {} });
  const library = Array.isArray(libraryRes.data) ? libraryRes.data : [];
  const fullProgram =
    library.find((p) => String(p.id ?? "") === programId) ??
    library.filter((p) => p.name === PROBE_NAME).sort((a, b) => (b.createTimestamp ?? 0) - (a.createTimestamp ?? 0))[0];
  if (!fullProgram) throw new Error("Probe program not found in library after add.");
  programId = String(fullProgram.id);
  cleanup.programId = programId;
  console.log(`✓ Created probe program id=${programId}`);

  // ---------- 4. schedule on DAY_A ----------
  const { res: schedRes, idInPlan } = await scheduleProgramOn(fullProgram, DAY_A);
  if (!schedRes.ok) throw new Error(`schedule add failed: ${schedRes.result} ${schedRes.message}`);
  let snapshot = await querySchedule(DAY_A, DAY_B);
  let entriesA = probeEntities(snapshot);
  const scheduledEntry = entriesA.find((e) => String(e.happenDay) === DAY_A);
  if (!scheduledEntry) throw new Error("Probe entry not found on DAY_A after scheduling.");
  cleanup.scheduled.push({ ...scheduledEntry });
  console.log(
    `✓ Scheduled on ${DAY_A}: idInPlan=${scheduledEntry.idInPlan} planId=${scheduledEntry.planId} planProgramId=${scheduledEntry.planProgramId}`
  );

  // ---------- 5. attempt status-2 move DAY_A → DAY_B ----------
  const movedProgram = structuredClone(
    (snapshot.programs ?? []).find(
      (p) => String(p.idInPlan) === String(scheduledEntry.idInPlan)
    ) ?? fullProgram
  );
  movedProgram.idInPlan = scheduledEntry.idInPlan;
  const moveRes = await api("POST", "/training/schedule/update", {
    body: {
      entities: [
        {
          happenDay: DAY_B,
          idInPlan: scheduledEntry.idInPlan,
          sortNoInSchedule: scheduledEntry.sortNoInSchedule ?? 1
        }
      ],
      programs: [movedProgram],
      versionObjects: [
        {
          id: scheduledEntry.idInPlan,
          planId: scheduledEntry.planId,
          planProgramId: scheduledEntry.planProgramId ?? scheduledEntry.idInPlan,
          status: 2
        }
      ],
      pbVersion: 2
    }
  });
  snapshot = await querySchedule(DAY_A, DAY_B);
  const after = probeEntities(snapshot);
  const onA = after.filter((e) => String(e.happenDay) === DAY_A).length;
  const onB = after.filter((e) => String(e.happenDay) === DAY_B).length;
  console.log(
    `status-2 move: ok=${moveRes.ok} (${moveRes.result} ${moveRes.message ?? ""}) → DAY_A=${onA} DAY_B=${onB} ⇒ ${
      moveRes.ok && onA === 0 && onB === 1 ? "MOVE WORKS" : "MOVE DOES NOT WORK AS HOPED"
    }`
  );
  cleanup.scheduled = after.map((e) => ({ ...e }));

  // ---------- 5b. reschedule via add-then-delete using schedule/query program ----------
  const current = after.find((e) => String(e.happenDay) === DAY_A) ?? after[0];
  const rawProgram = structuredClone(
    (snapshot.programs ?? []).find(
      (p) => String(p.idInPlan) === String(current.idInPlan)
    )
  );
  if (!rawProgram) throw new Error("No raw program for reschedule test.");
  const { res: readdRes, idInPlan: newId } = await scheduleProgramOn(rawProgram, DAY_B);
  console.log(`re-add on ${DAY_B} from schedule/query program: ok=${readdRes.ok} (${readdRes.result} ${readdRes.message ?? ""})`);
  if (readdRes.ok) {
    const delRes = await api("POST", "/training/schedule/update", {
      body: {
        versionObjects: [
          {
            id: current.idInPlan,
            planProgramId: current.planProgramId ?? current.idInPlan,
            planId: current.planId,
            status: 3
          }
        ],
        pbVersion: 2
      }
    });
    console.log(`delete old entry on ${DAY_A}: ok=${delRes.ok}`);
    const finalSnap = await querySchedule(DAY_A, DAY_B);
    const finalEntries = probeEntities(finalSnap);
    console.log(
      `  → final: DAY_A=${finalEntries.filter((e) => String(e.happenDay) === DAY_A).length} DAY_B=${finalEntries.filter((e) => String(e.happenDay) === DAY_B).length} ⇒ ${
        finalEntries.filter((e) => String(e.happenDay) === DAY_A).length === 0 &&
        finalEntries.filter((e) => String(e.happenDay) === DAY_B).length === 1
          ? "ADD-THEN-DELETE RESCHEDULE WORKS"
          : "reschedule flow broken"
      }`
    );
    cleanup.scheduled = finalEntries.map((e) => ({ ...e }));
  }

  // ---------- 6. past-day scheduling ----------
  const { res: pastRes, idInPlan: pastId } = await scheduleProgramOn(fullProgram, PAST_DAY);
  console.log(
    `past-day schedule (${PAST_DAY}): ok=${pastRes.ok} (${pastRes.result} ${pastRes.message ?? ""})`
  );
  if (pastRes.ok) {
    const pastSnap = await querySchedule(PAST_DAY, PAST_DAY);
    const pastEntries = probeEntities(pastSnap).filter((e) => String(e.happenDay) === PAST_DAY);
    console.log(`  → visible on past day: ${pastEntries.length > 0}`);
    cleanup.scheduled.push(...pastEntries.map((e) => ({ ...e })));
    if (pastEntries.length === 0 && pastId) {
      cleanup.scheduled.push({ idInPlan: pastId, planId: undefined, planProgramId: undefined });
    }
  }
} finally {
  // ---------- cleanup ----------
  console.log("\nCleaning up…");
  for (const entry of cleanup.scheduled) {
    if (!entry?.idInPlan) continue;
    const res = await api("POST", "/training/schedule/update", {
      body: {
        versionObjects: [
          {
            id: entry.idInPlan,
            planProgramId: entry.planProgramId ?? entry.idInPlan,
            planId: entry.planId,
            status: 3
          }
        ],
        pbVersion: 2
      }
    });
    console.log(`  removed scheduled idInPlan=${entry.idInPlan}: ok=${res.ok}`);
  }
  if (cleanup.programId) {
    const res = await api("POST", "/training/program/delete", { body: [cleanup.programId] });
    console.log(`  deleted probe program ${cleanup.programId}: ok=${res.ok}`);
  }
}
console.log("\nDone.");
