import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;
const database = await import(distUrl("database.js"));
const hevy = await import(distUrl("hevyService.js"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-hevy-test-"));
database.initializeDatabase(tempRoot);

let encryptionAvailable = true;
hevy.setHevyCredentialStorageForTests({
  isEncryptionAvailable: () => encryptionAvailable,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, "")
});

const now = Date.now();
const isoDaysAgo = (days, hour = 12) => {
  const date = new Date(now - days * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};
const workout = (id, title, daysAgo) => ({
  id,
  title,
  start_time: isoDaysAgo(daysAgo),
  end_time: isoDaysAgo(daysAgo, 13),
  updated_at: new Date(now).toISOString(),
  exercises: [
    {
      index: 0,
      title: "Bench Press (Barbell)",
      exercise_template_id: "bench",
      sets: [{ index: 0, type: "normal", weight_kg: 80, reps: 8 }]
    }
  ]
});

let phase = "connect";
let activeUser = { id: "user-1", name: "Ada", url: "https://hevy.com/user/ada" };
const requests = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  requests.push({ url, headers: init.headers });
  if (url.pathname.endsWith("/user/info")) {
    if (phase === "bad-auth") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      });
    }
    return Response.json({ data: activeUser });
  }
  if (url.pathname.endsWith("/exercise_templates")) {
    return Response.json({
      page: 1,
      page_count: 1,
      exercise_templates: [
        {
          id: "bench",
          title: "Bench Press (Barbell)",
          type: "weight_reps",
          primary_muscle_group: "chest",
          secondary_muscle_groups: ["triceps"]
        }
      ]
    });
  }
  if (url.pathname.endsWith("/workouts/events")) {
    if (phase === "event-failure") throw new Error("offline");
    return Response.json({
      page: 1,
      page_count: 1,
      events:
        phase === "events"
          ? [
              { type: "updated", workout: workout("a", "Push Updated", 2) },
              { type: "deleted", id: "b", deleted_at: new Date(now).toISOString() }
            ]
          : []
    });
  }
  if (url.pathname.endsWith("/workouts")) {
    const page = Number(url.searchParams.get("page"));
    return Response.json(
      page === 1
        ? {
            page: 1,
            page_count: 2,
            workouts: [workout("a", "Push", 2), workout("b", "Pull", 5)]
          }
        : {
            page: 2,
            page_count: 2,
            workouts: [workout("old", "Old workout", 500)]
          }
    );
  }
  throw new Error(`Unexpected Hevy request: ${url}`);
};

const connected = await hevy.connectHevy("secret-key");
assert.equal(connected.connected, true);
assert.equal(connected.displayName, "Ada");
assert.notEqual(database.getSetting("hevy.apiKey"), "secret-key");
assert.equal(
  requests.at(-1).headers["api-key"],
  "secret-key",
  "the supplied key authenticates the validation request"
);

phase = "full";
const firstSync = await hevy.syncHevyStrengthHistory(90, false);
assert.equal(firstSync.fetched, 2);
assert.equal(firstSync.sessions.length, 2);
assert.equal(database.listStoredHevyExerciseTemplates().size, 1);
assert.ok(database.getSetting("hevy.eventCursor"));
assert.ok(
  requests.some(
    ({ url }) =>
      url.pathname.endsWith("/exercise_templates") && url.searchParams.get("pageSize") === "100"
  )
);
assert.ok(
  requests.some(
    ({ url }) => url.pathname.endsWith("/workouts") && url.searchParams.get("pageSize") === "10"
  )
);

phase = "events";
const incremental = await hevy.syncHevyStrengthHistory(90, false);
assert.equal(incremental.fetched, 1);
assert.equal(incremental.sessions.length, 1);
assert.equal(incremental.sessions[0].name, "Push Updated");

const cursorBeforeFailure = database.getSetting("hevy.eventCursor");
phase = "event-failure";
await assert.rejects(() => hevy.syncHevyStrengthHistory(90, false), /offline/);
assert.equal(
  database.getSetting("hevy.eventCursor"),
  cursorBeforeFailure,
  "a failed page must not advance the event cursor"
);
assert.equal(hevy.getStoredHevyStrengthSessions(90).length, 1, "cached data survives errors");

phase = "bad-auth";
await assert.rejects(() => hevy.connectHevy("bad-key"), /rejected the API key/);
assert.equal(hevy.getHevyStatus().userId, "user-1", "failed auth keeps the prior account");

phase = "connect";
activeUser = { id: "user-2", name: "Grace", url: "https://hevy.com/user/grace" };
const switched = await hevy.connectHevy("second-key");
assert.equal(switched.userId, "user-2");
assert.equal(hevy.getStoredHevyStrengthSessions(90).length, 0, "account switching purges workouts");
assert.equal(database.getSetting("hevy.eventCursor"), undefined);

encryptionAvailable = false;
await assert.rejects(() => hevy.connectHevy("cannot-save"), /Secure credential storage/);
encryptionAvailable = true;
hevy.disconnectHevy();
assert.equal(hevy.getHevyStatus().connected, false);
assert.equal(database.listStoredHevyWorkouts(0).length, 0);
assert.equal(database.listStoredHevyExerciseTemplates().size, 0);

console.log("hevy-service tests passed");
