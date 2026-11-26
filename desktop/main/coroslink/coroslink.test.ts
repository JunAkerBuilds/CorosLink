import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { refToMs } from "@/data/sync/native";
import type { RouteSave } from "../../maps/types";
import { ActivityRules } from "../activities/duplicates";
import { LocalStore } from "../localStore";
import { plain } from "../media/vault";
import { LocalWatch } from "../watch/service";
import { parseWatchKey } from "../watch/engine/systemBind";
import { candidates, findCorosLink, installedVersion } from "./detect";
import { FIXTURE_ACCOUNT_ID, FIXTURE_KEYCHAIN_PASSWORD, FIXTURE_PROGRAM, FIXTURE_PROJECT, makeCorosLinkFolder } from "./fixture";
import { activityChanges, chatChanges, healthChanges, journalChanges, maskEmail, pairedWatch, routeSave, sportOf, watchKeyText } from "./map";
import { corosLinkKeychain } from "./oldKeychain";
import { localWorkouts, planDocs, programDoc } from "./plans";
import { CorosLinkMove, type MoveHost } from "./move";

const temp = (name: string) => mkdtempSync(path.join(tmpdir(), `clink-${name}-`));

/** Every file under `folder` with its hash and mtime: proof that nothing in it changed. */
function fingerprint(folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name), s = statSync(file);
      if (s.isDirectory()) walk(file);
      else out[path.relative(folder, file)] = `${createHash("sha256").update(readFileSync(file)).digest("hex")}:${s.mtimeMs}`;
    }
  };
  walk(folder);
  return out;
}

describe("finding CorosLink", () => {
  it("finds the packaged folder, and counts CorosLink and coroslink once on a case-insensitive disk", () => {
    const appData = temp("appdata"), own = path.join(appData, "C-LINK");
    makeCorosLinkFolder(path.join(appData, "CorosLink"));
    mkdirSync(own);
    const found = findCorosLink({ appData, ownData: own });
    expect(found?.db).toBe(path.join(appData, "CorosLink", "coroslink.sqlite"));
    expect(found?.sameFolder).toBe(false);
    expect(found?.lastOpened).toMatch(/^\d{4}-/);
    expect(candidates({ appData, ownData: own })).toContain(own);
  });

  it("finds it in C-LINK's own folder when the switch shares CorosLink's app id", () => {
    const appData = temp("appdata"), shared = path.join(appData, "CorosLink");
    makeCorosLinkFolder(shared);
    const found = findCorosLink({ appData: temp("elsewhere"), ownData: shared });
    expect(found?.folder).toBe(shared);
    expect(found?.sameFolder).toBe(true);
  });

  it("finds the database under its old name, and nothing when there's only an empty file or no folder", () => {
    const appData = temp("appdata");
    mkdirSync(path.join(appData, "coroslink"));
    writeFileSync(path.join(appData, "coroslink", "coroslink.sqlite"), "");
    expect(findCorosLink({ appData, ownData: path.join(appData, "C-LINK") })).toBeNull();
    writeFileSync(path.join(appData, "coroslink", "coros-desktop.sqlite"), "SQLite format 3");
    expect(findCorosLink({ appData, ownData: path.join(appData, "C-LINK") })?.db).toMatch(/coros-desktop\.sqlite$/);
    expect(findCorosLink({ appData: temp("empty"), ownData: temp("own") })).toBeNull();
  });

  it("reads the installed version, and looks only where told when CLINK_COROSLINK_DIR is set", () => {
    const apps = temp("apps");
    mkdirSync(path.join(apps, "CorosLink.app", "Contents"), { recursive: true });
    writeFileSync(path.join(apps, "CorosLink.app", "Contents", "Info.plist"), "<plist><dict><key>CFBundleShortVersionString</key>\n<string>0.1.81</string></dict></plist>");
    expect(installedVersion([temp("none"), apps])).toBe("0.1.81");
    // Windows: the NSIS install's own package.json (an unpacked resources\app stands in for app.asar here).
    const programs = temp("programs");
    mkdirSync(path.join(programs, "CorosLink", "resources", "app"), { recursive: true });
    writeFileSync(path.join(programs, "CorosLink", "resources", "app", "package.json"), JSON.stringify({ name: "coroslink", version: "0.1.83" }));
    expect(installedVersion([temp("none"), programs])).toBe("0.1.83");
    const appData = temp("appdata");
    makeCorosLinkFolder(path.join(appData, "CorosLink"));
    const elsewhere = makeCorosLinkFolder(path.join(temp("copy"), "x"));
    expect(findCorosLink({ appData, ownData: temp("own"), only: elsewhere })?.folder).toBe(elsewhere);
  });
});

describe("mapping CorosLink's rows", () => {
  it("knows COROS's sport codes", () => {
    expect([100, 101, 200, 201, 301, 402, 900, 10001, 4242].map(sportOf)).toEqual(["run", "indoorRun", "bike", "indoorBike", "openWater", "strength", "walk", "multisport", "other"]);
  });

  it("brings each workout once: COROS's id, the watch's own id otherwise, and never a blip", () => {
    const row = { activity_id: "481", name: "Run", sport_type: 100, sport_name: "Run", start_time: 1794418202, duration: 2180, distance: 4006, avg_hr: 164, max_hr: 0, calories: 366, training_load: 76, elevation_gain: 16 };
    const blip = { ...row, activity_id: "482", duration: 28, distance: 0 };
    const file = { activity_id: "watch-1", watch_activity_id: "coros-1792419428-0", file_path: "fit/a.fit", format: "fit", sport_type: 100, name: null, start_time: 1792419428, duration: 1800, distance: 5000, avg_hr: 140, max_hr: 160, calories: 300, elevation_gain: 0 };
    const twin = { ...file, activity_id: "watch-2", watch_activity_id: "coros-1794418202-0", start_time: 1794418202 };
    const out = activityChanges([row, blip], [file, twin]);
    expect(out.map((c) => c.id)).toEqual(["481", "coros-1792419428-0"]);
    const body = out[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ id: "481", sport: "run", sportCode: 100, distanceMeters: 4006, averageHR: 164, trainingLoad: 76 });
    expect(body.maxHR).toBeUndefined();
    expect(refToMs(body.start as number)).toBe(1794418202_000);
    expect((out[1].body as Record<string, unknown>).name).toBe("Workout");
  });

  it("makes health days and nights keyed like the phone's", () => {
    const out = healthChanges(
      [{ day: "20261021", metric: "steps", value: 7250.4 }, { day: "20261021", metric: "active_time", value: 1800 }, { day: "bad", metric: "steps", value: 1 }, { day: "20261023", metric: "distance", value: 500 }],
      [{ start_ts: 1792368000, end_ts: 1792395000, day: "2026-10-22", total_minutes: 430, awake_minutes: 20, light_minutes: 230, deep_minutes: 90, rem_minutes: 90, avg_hr: 52 }],
    );
    expect(out.map((c) => `${c.collection}/${c.id}`)).toEqual(["health.night/2026-10-22", "health.day/2026-10-21", "health.day/2026-10-22"]);
    expect(out[1].body).toEqual({ day: { year: 2026, month: 10, day: 21 }, steps: 7250, exerciseMinutes: 30 });
    expect(out[2].body).toMatchObject({ sleepMinutes: 430 });
  });

  it("makes one night of a day's sleep sessions", () => {
    const s = { day: "20261022", awake_minutes: 10, light_minutes: 100, deep_minutes: 40, rem_minutes: 30 };
    const out = healthChanges([], [
      { ...s, start_ts: 1792368000, end_ts: 1792378000, total_minutes: 180, avg_hr: 50 },
      { ...s, start_ts: 1792380000, end_ts: 1792395000, total_minutes: 240, avg_hr: 57 },
    ]);
    expect(out.map((c) => `${c.collection}/${c.id}`)).toEqual(["health.night/2026-10-22", "health.day/2026-10-22"]);
    expect(out[0].body).toMatchObject({ totalMinutes: 420, deepMinutes: 80, awakeMinutes: 20, averageHR: 54, bedtime: 1792368000 - 978307200, wakeTime: 1792395000 - 978307200 });
    expect(out[1].body).toMatchObject({ sleepMinutes: 420 });
  });

  it("carries chat text and leaves CorosLink's cards out", () => {
    const { changes, conversations, leftOut } = chatChanges([
      { id: "c1", title: "Run", created_at: "2026-11-11T18:46:11Z", updated_at: "2026-11-11T18:46:55Z", messages_json: JSON.stringify([
        { kind: "message", role: "user", content: "How was it?" }, { kind: "coachChart" }, { kind: "message", role: "assistant", content: "Steady." }]) },
      { id: "c2", title: "Empty", created_at: "x", updated_at: "x", messages_json: "not json" },
    ]);
    expect(conversations).toBe(1);
    expect(leftOut).toBe(1);
    expect(changes.map((c) => c.id)).toEqual(["c1", "c1.0001", "c1.0002"]);
    expect((changes[1].body as { message: unknown }).message).toEqual({ id: "c1.m1", from: "you", text: "How was it?" });
    expect((changes[2].body as { message: unknown }).message).toEqual({ id: "c1.m2", from: "coach", blocks: [{ kind: "text", text: "Steady." }] });
  });

  it("turns a route's points into Route Studio's, or refuses one it can't read", () => {
    const save = routeSave({ id: "r", name: " Loop ", distance_meters: 4666, ascent_meters: 19, descent_meters: null, mode: "loop", surface_preference: "road", activity_type: "running",
      points_json: JSON.stringify([{ lat: 45.1, lon: -75.1, elevation: 63 }, { lat: 45.2, lon: -75.2 }, { lat: 999, lon: 0 }]) });
    expect(save).toEqual({ name: "Loop", sport: "run", kind: "loop", source: "import", route: { points: [[45.1, -75.1, 63], [45.2, -75.2]], distanceM: 4666, ascentM: 19, descentM: 0 } });
    expect(routeSave({ id: "r", name: "x", distance_meters: 1, ascent_meters: 0, descent_meters: 0, mode: "ab", surface_preference: "road", activity_type: null, points_json: "[" })).toBeNull();
  });
});

describe("mapping CorosLink's own things", () => {
  it("turns CorosLink's watch key into C-LINK's, keeping an account ID past 2^53 exact", () => {
    const text = watchKeyText(JSON.stringify({ version: 1, accountUserId: "18446744073709551615", privateKeyDer: "QUJD", unit: 1, dataCollectSwitch: 3, accountEmail: "a@b.c" }));
    expect(text).toBe('{"accountUserId":18446744073709551615,"unit":1,"dataCollectSwitch":3,"deviceName":null,"privateKeyDER":"QUJD"}');
    expect(parseWatchKey(text!).accountUserId).toBe(18446744073709551615n);
    // The older per-watch key keeps its watch.
    expect(watchKeyText(JSON.stringify({ version: 1, deviceName: "COROS APEX 2 0A0B0C", accountUserId: "7", bindProfile: "x", privateKeyDer: "QUJD" }))).toContain('"deviceName":"COROS APEX 2 0A0B0C"');
    for (const bad of ["not json", "{}", JSON.stringify({ accountUserId: "x1", privateKeyDer: "QUJD" }), JSON.stringify({ accountUserId: "1", privateKeyDer: "not base64!" })]) expect(watchKeyText(bad)).toBeNull();
    expect(maskEmail("runner@example.com")).toBe("ru•••@example.com");
    expect(maskEmail("nope")).toBeNull();
  });

  it("pairs the watch CorosLink trusted, by its advertised name", () => {
    const identity = JSON.stringify({ system: { deviceId: "X", deviceName: "COROS PACE 3 112233", model: "PACE 3" } });
    expect(pairedWatch(identity, null, null)).toEqual({ name: "COROS PACE 3 112233", display: "PACE 3", model: "PACE 3" });
    expect(pairedWatch("{}", JSON.stringify({ deviceName: "COROS VERTIX 2 A1B2C3", deviceId: "Y" }), null)).toEqual({ name: "COROS VERTIX 2 A1B2C3", display: "VERTIX 2" });
    expect(pairedWatch(null, null, { name: "COROS PACE Pro 2F1A6C", model: "pace-pro" })).toEqual({ name: "COROS PACE Pro 2F1A6C", display: "PACE Pro", model: "pace-pro" });
    // Something that isn't a COROS watch is never paired.
    expect(pairedWatch(JSON.stringify({ system: { deviceName: "Headphones" } }), "bad", { name: "Fitbit", model: null })).toBeNull();
  });

  it("brings workout briefs to Coach and keeps debriefs out of the morning feel check", () => {
    const out = journalChanges([
      { entry_id: "j1", happen_day: "20261208", workout_name: "Tempo", brief_json: JSON.stringify({ goal: "Hold 4:30", cues: [{ id: "c", text: " Tall " }, { id: "d", text: "" }], fuelPlan: "Gel at 30'" }), updated_at: "2026-12-08T10:00:00Z" },
      { entry_id: "j2", happen_day: "20261209", workout_name: null, brief_json: "{}", updated_at: "x" },
    ]);
    expect(out.map((c) => `${c.collection}/${c.id}`)).toEqual(["coach.brief/coroslink.j1"]);
    expect(out[0].body).toMatchObject({ title: "Tempo", day: "2026-12-08", goal: "Hold 4:30", cues: ["Tall"], fuel: "Gel at 30'" });
  });

  it("brings the athlete's own plans with their workouts built, and leaves COROS's plans to COROS", () => {
    const doc = { id: "plan:1", name: "Base", weekCount: 1, difficulty: "weird", sportMix: ["run", "kayak"], phases: [], startDate: "20270104",
      entries: [
        { id: "e1", kind: "workout", weekIndex: 0, dayIndex: 0, sortOrder: 0, corosProgram: FIXTURE_PROGRAM, workout: { key: "k", name: "Easy 5K", sport: "run" } },
        { id: "e2", kind: "workout", weekIndex: 0, dayIndex: 3, sortOrder: 0, programId: "55", workout: { key: "k2", name: "Library run", sport: "run" } },
        { id: "e3", kind: "workout", weekIndex: 0, sortOrder: 1, workout: { key: "k3", name: "Paddle", sport: "kayak" } },
      ],
      calendarInstalls: [{ id: "i", startDate: "20270104", planRevision: "r", state: "active", createdAt: "t", updatedAt: "t", failures: [],
        occurrences: [{ planEntryId: "e1", happenDay: "20270104", schedulePlanId: "9", scheduleIdInPlan: 41, createdAt: "t" }] }],
    };
    const { plans, workouts, withoutSteps } = planDocs([
      { id: "plan:1", source: "local", document_json: JSON.stringify(doc), archived_at: "2026-01-01" },
      { id: "coros:2", source: "coros", document_json: JSON.stringify({ ...doc, id: "coros:2" }), archived_at: null },
      { id: "bad", source: "local", document_json: "{", archived_at: null },
    ]);
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan).toMatchObject({ id: "plan:1", difficulty: "custom", sportMix: ["run"], startDate: "2027-01-04", archived: true, syncState: "local", source: "local" });
    expect(plan.entries[0].workout?.doc?.items).toHaveLength(3);
    expect(plan.entries[0].workout?.doc?.name).toBe("Easy 5K");
    expect(plan.entries[1].workout).toEqual({ key: "k2", name: "Library run", sport: "run" });
    expect(plan.entries[2].workout).toBeUndefined();
    expect([workouts, withoutSteps]).toEqual([2, 1]);
    expect(plan.calendarInstalls?.[0].occurrences).toEqual([{ planEntryId: "e1", happenDay: "2027-01-04", where: "coros", ref: "41", name: "Easy 5K", createdAt: "t" }]);
  });

  it("builds Local-Only workouts, and counts the ones the builder can't read", () => {
    expect(programDoc({ sportType: 9999 })).toBeNull();
    const { workouts, unread } = localWorkouts([{ id: "1", program: JSON.stringify(FIXTURE_PROGRAM) }, { id: "2", program: "{" }], [{ id_in_plan: 3, happen_day: "20261210", program: JSON.stringify(FIXTURE_PROGRAM) }]);
    expect(workouts.map((w) => [w.id, w.date, w.doc.sport])).toEqual([["coroslink-1", null, "run"], ["coroslink-day-3", "2026-12-10", "run"]]);
    expect(unread).toBe(1);
  });
});

describe("bringing it over", () => {
  function setup() {
    const appData = temp("appdata"), data = path.join(appData, "C-LINK");
    mkdirSync(data);
    const source = makeCorosLinkFolder(path.join(appData, "CorosLink"));
    const store = new LocalStore(path.join(data, "clink.db"));
    // As main.ts runs it: one workout, one activity.
    store.attachRules(new ActivityRules(store, { fitFolder: path.join(data, "watch", "fit"), ledger: path.join(data, "activity-merges.json") }));
    const routes: RouteSave[] = [];
    const ai = { picked: null as string | null, models: {} as Record<string, string>, efforts: {} as Record<string, string>, localUrl: null as string | null };
    const secrets = new Map<string, string>();
    const watch = new LocalWatch(data, { store: () => store, sealer: plain, localMode: () => false, engine: null, log: () => {} });
    const seen = { localMode: false, studio: null as unknown, ors: null as string | null, mcp: [] as { input: unknown; oauth?: unknown }[], tracks: [] as string[], media: new Map<string, string>() };
    const host: MoveHost = {
      data, appData, store: () => store, log: () => {},
      saveRoute: async (r) => { routes.push(r); return { id: `route-${routes.length}` }; },
      ai: {
        current: () => ai,
        choose: (c) => { Object.assign(ai, { ...c, models: { ...ai.models, ...c.models }, efforts: { ...ai.efforts, ...c.efforts } }); },
        hasSecret: async (id) => secrets.has(id),
        setSecret: async (id, value) => { secrets.set(id, value); },
      },
      keychain: (folder) => corosLinkKeychain({ platform: "darwin", folder, secret: async () => FIXTURE_KEYCHAIN_PASSWORD }),
      watch,
      localMode: { on: () => seen.localMode, enter: async () => { seen.localMode = true; } },
      studioAccount: { adopt: async (input) => { seen.studio = input; return true; } },
      adoptOrsKey: async (key) => { seen.ors = key; return true; },
      mcp: {
        urls: () => seen.mcp.map((m) => (m.input as { url: string }).url),
        add: async (input) => { seen.mcp.push({ input }); return `m${seen.mcp.length}`; },
        setOAuth: async (id, oauth) => { seen.mcp[Number(id.slice(1)) - 1].oauth = oauth; },
      },
      media: { addTrack: async (_file, name) => { seen.tracks.push(name); return true; }, setting: (k) => seen.media.get(k) ?? null, setSetting: (k, v) => { seen.media.set(k, v); } },
    };
    return { appData, data, source, store, routes, host, ai, secrets, seen, picked: () => ai.picked };
  }

  it("shows real counts and keeps the tiles C-LINK can't take yet switched off", async () => {
    const { host } = setup();
    const survey = await new CorosLinkMove(host).look();
    expect(survey?.counts).toEqual({ activities: 7, healthDays: 2, chats: 2, faces: 1 });
    const tiles = Object.fromEntries(survey!.tiles.map((t) => [t.id, t]));
    expect(Object.keys(tiles)).toEqual(["acts", "health", "plans", "lift", "coach", "watch", "phones", "faces", "routes", "links", "cals", "media", "prefs"]);
    for (const id of ["acts", "health", "plans", "coach", "watch", "faces", "routes", "links", "media", "prefs"]) expect(tiles[id]).toMatchObject({ ready: true, on: true });
    for (const id of ["lift", "phones", "cals"]) expect(tiles[id]).toMatchObject({ ready: false, on: false });
    expect(tiles.lift.instead).toBe("coros");
    expect(tiles.watch.figure).toBe("PACE Pro");
    // One own plan, a Local-Only library workout and a calendar day, a race goal and a race result.
    expect(tiles.plans.figure).toBe("5");
    // COROS (Training Hub, Studio), Hevy, intervals.icu; Strava has no place yet.
    expect(tiles.links.figure).toBe("4");
    expect(tiles.links.detail).toMatch(/Strava again later/);
    // Coach's AI, two MCP servers, the routing key.
    expect(tiles.prefs.figure).toBe("4");
  });

  it("copies into C-LINK, leaves CorosLink's folder exactly as it was, and adds nothing the second time", async () => {
    const { source, store, routes, host, data, picked, ai, secrets, seen } = setup();
    const before = fingerprint(source);
    const move = new CorosLinkMove(host);
    await move.start(["acts", "health", "coach", "faces", "routes", "prefs", "plans", "watch", "links", "media", "lift", "cals"]);
    await move.running;
    const job = (await (await move.answer(new Request("clink://app/api/desktop/move/progress"))).json() as { job: { stage: string; pct: number; tiles: Record<string, { state: string }> } }).job;
    expect(job.stage).toBe("done");
    expect(job.pct).toBe(100);
    expect(Object.keys(job.tiles).sort()).toEqual(["acts", "coach", "faces", "health", "links", "media", "plans", "prefs", "routes", "watch"]);
    expect(Object.values(job.tiles).every((t) => t.state === "done")).toBe(true);

    expect(store.count("activity")).toBe(7);
    expect(store.list("activity").map((a) => a.id)).toContain("coros-1792419428-0");
    expect(store.count("health.day")).toBe(2);
    expect(store.count("health.night")).toBe(1);
    expect(store.count("coach.conversation")).toBe(2);
    expect(store.count("coach.message")).toBe(3);
    expect(store.count("coach.memory")).toBe(1);
    expect(store.list("coach.brief")[0].body).toMatchObject({ title: "Easy 5K", day: "2026-12-08", goal: "Stay easy", cues: ["Relax shoulders"], fuel: "Water" });
    expect(readFileSync(path.join(data, "watch", "fit", "coros-1792419428-0.fit"), "utf8")).toBe("FIT-BYTES");
    // The watch's copy of the newest run went into COROS's, its FIT file with it.
    expect(store.list("activity").map((a) => a.id)).not.toContain("coros-1794418242-0");
    expect(readFileSync(path.join(data, "watch", "fit", "481686637942702580.fit"), "utf8")).toBe("FIT-TWIN");
    const project = path.join(data, "studio", "projects", FIXTURE_PROJECT);
    expect(readdirSync(project).sort()).toEqual(["preview.png", "project.json", "starter.dat"]);
    expect(routes.map((r) => r.name)).toEqual(["5.0 km loop"]);
    expect(picked()).toBe("chatgpt");

    // Plans and workouts, as this computer's store keeps them (src/data/local).
    expect(store.list("training.plan").map((p) => p.id)).toEqual(["plan:7d1e"]);
    expect((store.list("training.plan")[0].body as { entries: { workout?: { doc?: unknown } }[] }).entries[0].workout?.doc).toBeTruthy();
    expect(store.list("training.workout").map((w) => [w.id, w.body.date, w.body.name])).toEqual([["coroslink-day-3", "2026-12-10", "Thursday 5K"]]);
    expect(store.list("training.workout")[0].body).toMatchObject({ sport: "run", repeatWeeks: 1, summary: { metres: 5000 } });
    expect(store.list("training.library").map((w) => [w.id, w.body.name])).toEqual([["coroslink-1792000000000000", "Easy 5K"]]);
    expect(store.list("training.library")[0].body.summary).toBeUndefined();

    // The watch: its key sealed in watch/key.bin (C-LINK's sealer; plain here), paired, weather and auto-sync, Local mode on.
    const key = parseWatchKey(readFileSync(path.join(data, "watch", "key.bin"), "utf8"));
    expect(key.accountUserId).toBe(BigInt(FIXTURE_ACCOUNT_ID));
    const pairing = JSON.parse(readFileSync(path.join(data, "watch", "pairing.json"), "utf8"));
    expect(pairing).toMatchObject({ account: "ru•••@example.com", paired: { name: "COROS PACE Pro 2F1A6C", display: "PACE Pro", model: "PACE Pro" }, autoSyncMinutes: 5, weather: { city: "Ottawa" } });
    expect(seen.localMode).toBe(true);

    // Accounts: the Training Hub session, Studio's COROS account, Hevy and intervals.icu.
    expect(store.list("hub.session")[0].body).toMatchObject({ accessToken: "hub-token", userId: FIXTURE_ACCOUNT_ID, baseURL: "https://teamapi.coros.com", email: "runner@example.com" });
    expect(store.list("connection").map((c) => [c.id, c.body])).toEqual([["hevy", { apiKey: "hevy-fixture-key" }], ["intervals", { apiKey: "intervals-fixture-key", athleteId: "i12345" }]]);
    expect(seen.studio).toEqual({ session: { accessToken: "mobile-token", userId: FIXTURE_ACCOUNT_ID, region: "us", email: "runner@example.com" }, saved: { account: "runner@example.com", pwdHash: "0123456789abcdef0123456789abcdef" } });
    expect(job.tiles.links).toMatchObject({ state: "done" });

    // Settings: AI keys sealed again by C-LINK's vault, models, MCP servers with their sign-ins, the routing key.
    expect(secrets.get("openrouter")).toBe("sk-or-fixture");
    expect(JSON.parse(secrets.get("chatgpt")!)).toEqual({ access: "at", refresh: "rt", expiresAt: 1800000000_000, accountId: "acct", email: "runner@example.com" });
    expect(ai.models).toEqual({ chatgpt: "gpt-5", "claude-code": "opus" });
    expect(ai.efforts).toEqual({ chatgpt: "high" });
    expect(seen.mcp).toEqual([
      { input: { name: "COROS", transport: "http", url: "https://mcpus.coros.com/mcp", auth: "oauth" }, oauth: { tokens: { access_token: "mcp-at", token_type: "Bearer", refresh_token: "mcp-rt" }, client: { client_id: "cid", redirect_uris: ["http://127.0.0.1:1456/coros-mcp/callback"] }, redirect: "http://127.0.0.1:1456/coros-mcp/callback" } },
      { input: { name: "Notes", transport: "http", url: "https://notes.example.com/mcp", auth: "bearer", bearer: "notes-token" } },
    ]);
    expect(seen.ors).toBe("ors-fixture-key-0123456789");
    expect(seen.tracks).toEqual(["song.mp3"]);
    expect(seen.media.get("spotify.clientId")).toBe("spotify-client-id");

    // What has no place in C-LINK yet is kept, never a secret.
    const kept = readFileSync(path.join(data, "coroslink", "kept.json"), "utf8");
    expect(Object.keys(JSON.parse(kept)).sort()).toEqual(["activityFiles", "calendarState", "coachInstructions", "healthSamples", "raceEntries", "raceTargets", "settings", "sleepRanges", "workoutJournal"]);
    for (const secret of ["hevy-fixture-key", "sk-or-fixture", "hub-token", "mobile-token", "0123456789abcdef", "privateKeyDer"]) expect(kept).not.toContain(secret);
    expect(existsSync(path.join(data, "coroslink", "local-archive", "fit", "27", "277d.fit"))).toBe(true);
    expect(existsSync(path.join(data, "coroslink", "local-archive", "partial"))).toBe(false);
    expect(existsSync(path.join(data, "coroslink", "coach-attachments", "s1", "a1", "text.txt"))).toBe(true);
    expect(existsSync(path.join(data, "coroslink", "watchface-ai-chats", "c1.json"))).toBe(true);
    expect(fingerprint(source)).toEqual(before);
    expect(existsSync(path.join(data, "coroslink-snapshot"))).toBe(false);

    const cursor = store.cursor;
    const again = new CorosLinkMove(host);
    await again.start(["acts", "health", "coach", "faces", "routes", "prefs", "watch", "links"]);
    await again.running;
    expect(store.cursor).toBe(cursor);
    expect(routes).toHaveLength(1);
    expect(seen.mcp).toHaveLength(2);
  });

  it("asks for a sign-in again, and writes no secret, when CorosLink's keychain won't open", async () => {
    const { host, data, store, secrets } = setup();
    const move = new CorosLinkMove({ ...host, keychain: (folder) => corosLinkKeychain({ platform: "darwin", folder, secret: async () => null }) });
    await move.start(["watch", "links", "prefs"]);
    await move.running;
    const job = (await (await move.answer(new Request("clink://app/api/desktop/move/progress"))).json() as { job: { tiles: Record<string, { state: string; note?: string }> } }).job;
    expect(job.tiles.watch).toMatchObject({ state: "attn", note: "The key didn't open here. Pair the watch again" });
    expect(existsSync(path.join(data, "watch", "key.bin"))).toBe(false);
    // What CorosLink kept in plain text still comes over (the Training Hub session, intervals.icu); the sealed ones don't.
    expect(job.tiles.links.state).toBe("attn");
    expect(store.list("connection").map((c) => c.id)).toEqual(["intervals"]);
    expect([...secrets.keys()]).toEqual([]);
  });

  it("never writes over what C-LINK already has", async () => {
    const { store, host } = setup();
    store.seed([{ collection: "health.day", id: "2026-10-21", body: { day: { year: 2026, month: 10, day: 21 }, steps: 12000, hrv: 61 } }]);
    const move = new CorosLinkMove(host);
    await move.start(["health"]);
    await move.running;
    expect(store.list("health.day").find((d) => d.id === "2026-10-21")?.body).toMatchObject({ steps: 12000, hrv: 61 });
    expect(store.count("health.day")).toBe(2);
  });

  it("reads what CorosLink still holds in its WAL while it's open", async () => {
    const { source, store, host } = setup();
    const open = new DatabaseSync(path.join(source, "coroslink.sqlite"));
    open.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
    open.prepare("INSERT INTO training_activities (activity_id, name, sport_type, start_time, duration, distance, synced_at) VALUES ('999', 'Long Run', 100, 1794500000, 7200, 20000, 'x')").run();
    expect(existsSync(path.join(source, "coroslink.sqlite-wal"))).toBe(true);
    const move = new CorosLinkMove(host);
    await move.start(["acts"]);
    await move.running;
    open.close();
    expect(store.list("activity").some((a) => a.id === "999")).toBe(true);
  });

  it("says when there is nothing to bring", async () => {
    const appData = temp("appdata"), data = path.join(appData, "C-LINK");
    mkdirSync(data);
    const ai = { current: () => ({ picked: null, models: {}, efforts: {}, localUrl: null }), choose: () => {}, hasSecret: async () => false, setSecret: async () => {} };
    const move = new CorosLinkMove({ data, appData, store: () => null, saveRoute: async () => ({ id: "x" }), ai, log: () => {} });
    expect(await (await move.answer(new Request("clink://app/api/desktop/move"))).json()).toEqual({ found: null, job: null });
    expect((await move.answer(new Request("clink://app/api/desktop/move/start", { method: "POST", body: "{}" }))).status).toBe(404);
  });
});
