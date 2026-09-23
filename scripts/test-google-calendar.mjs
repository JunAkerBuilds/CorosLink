import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { GoogleCalendarClient } from "../dist-electron/googleCalendarClient.js";
import {
  authorizeGoogleCalendar,
  GOOGLE_CALENDAR_SCOPES,
  requestGoogleTokens,
} from "../dist-electron/googleCalendarOAuth.js";
import {
  calendarSyncRange,
  GoogleCalendarApiError,
  shiftCalendarDay,
  syncWorkoutEvents,
  workoutGoogleEvent,
} from "../dist-electron/googleCalendarSync.js";

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});
const config = {
  clientId: "test.apps.googleusercontent.com",
  clientSecret: "test-secret",
};
const tokens = () => ({
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() + 3600_000,
});
const workout = (id = "w1", happenDay = "20260904") => ({
  planId: "plan",
  idInPlan: id,
  planProgramId: "program",
  happenDay,
  name: "Easy run",
  volume: "5 km",
  trainingLoad: 35,
});

function fakeCalendar(initial = []) {
  const events = new Map(
    initial.map((event) => [event.id, structuredClone(event)]),
  );
  const calls = [];
  const request = async (path, method = "GET", body) => {
    calls.push({ path, method, body });
    const url = new URL(path, "https://test.invalid");
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    if (method === "GET" && id === "events")
      return { items: [...events.values()] };
    if (method === "GET") {
      if (!events.has(id)) throw new GoogleCalendarApiError(404, "Missing");
      return structuredClone(events.get(id));
    }
    if (method === "POST") {
      if (events.has(body.id))
        throw new GoogleCalendarApiError(409, "Duplicate");
      events.set(body.id, structuredClone(body));
      return body;
    }
    if (method === "PATCH") {
      assert.ok(events.has(id));
      events.set(id, { ...events.get(id), ...structuredClone(body) });
      return events.get(id);
    }
    if (method === "DELETE") {
      events.delete(id);
      return undefined;
    }
    throw new Error(`Unexpected ${method} ${path}`);
  };
  return { events, calls, request };
}
const syncInput = (api, workouts) => ({
  userId: "coros-1",
  calendarId: "personal@example.com",
  startDay: "20260901",
  endDay: "20260930",
  workouts,
  request: api.request,
});

test("all-day dates survive leap days, year changes and local DST boundaries", () => {
  assert.equal(shiftCalendarDay("20240228", 1), "20240229");
  assert.equal(shiftCalendarDay("20261231", 1), "20270101");
  assert.equal(shiftCalendarDay("20260308", 1), "20260309");
  assert.throws(
    () => workoutGoogleEvent("u", workout("w", "20260230")),
    /invalid scheduled date/,
  );
  const event = workoutGoogleEvent("u", workout("w", "20261231"));
  assert.deepEqual(event.start, { date: "2026-12-31" });
  assert.deepEqual(event.end, { date: "2027-01-01" });
  assert.match(event.id, /^[a-v0-9]{5,1024}$/);
  assert.equal(
    workoutGoogleEvent("u", workout("w", "20260905")).id,
    workoutGoogleEvent("u", workout("w")).id,
  );
  assert.notEqual(
    workoutGoogleEvent("u2", workout()).id,
    workoutGoogleEvent("u", workout()).id,
  );
});

test("repeat sync is idempotent, with edits and moves updating the same event", async () => {
  const api = fakeCalendar();
  const input = syncInput(api, [workout()]);
  assert.deepEqual(await syncWorkoutEvents(input), {
    created: 1,
    updated: 0,
    deleted: 0,
    unchanged: 0,
  });
  assert.deepEqual(await syncWorkoutEvents(input), {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 1,
  });
  const moved = { ...workout("w1", "20260910"), name: "Long run" };
  assert.equal((await syncWorkoutEvents(syncInput(api, [moved]))).updated, 1);
  assert.equal(api.events.size, 1);
  assert.equal([...api.events.values()][0].start.date, "2026-09-10");
  assert.equal([...api.events.values()][0].summary, "Long run");
  assert.ok(api.calls[0].path.includes("personal%40example.com"));
});

test("removals affect only owned workouts in the fully fetched window", async () => {
  const current = workoutGoogleEvent("coros-1", workout());
  const history = workoutGoogleEvent("coros-1", workout("history", "20260801"));
  const future = workoutGoogleEvent("coros-1", workout("future", "20261001"));
  const otherUser = workoutGoogleEvent("coros-2", workout());
  const personal = {
    id: "personal",
    summary: "Dentist",
    start: { date: "2026-09-04" },
  };
  const copied = { ...current, id: "user-made-copy" };
  const api = fakeCalendar([
    current,
    history,
    future,
    otherUser,
    personal,
    copied,
  ]);
  const result = await syncWorkoutEvents(syncInput(api, []));
  assert.equal(result.deleted, 1);
  assert.equal(api.events.size, 5);
  assert.ok(
    api.events.has(copied.id),
    "a user's manual copy is not managed by the app",
  );
  assert.ok(
    api.events.has("personal") &&
      api.events.has(otherUser.id) &&
      api.events.has(history.id),
  );
});

test("invalid source or failed upsert never triggers cleanup", async () => {
  const api = fakeCalendar([workoutGoogleEvent("coros-1", workout("remove"))]);
  await assert.rejects(
    syncWorkoutEvents(syncInput(api, [workout("bad", "20260999")])),
    /invalid scheduled date/,
  );
  assert.equal(api.calls.length, 0);
  const request = async (path, method, body) => {
    if (method === "POST") throw new Error("offline");
    return api.request(path, method, body);
  };
  await assert.rejects(
    syncWorkoutEvents({ ...syncInput(api, [workout()]), request }),
    /offline/,
  );
  assert.equal(api.calls.filter((call) => call.method === "DELETE").length, 0);
});

test("remote pagination completes before any mutation", async () => {
  const event = workoutGoogleEvent("coros-1", workout());
  let pages = 0;
  const input = syncInput(fakeCalendar(), [workout()]);
  input.request = async (path, method = "GET") => {
    assert.equal(
      method,
      "GET",
      "existing event on second page must not be reinserted",
    );
    if (++pages === 1) return { nextPageToken: "second", items: [] };
    assert.ok(path.includes("pageToken=second"));
    return { items: [event] };
  };
  assert.equal((await syncWorkoutEvents(input)).unchanged, 1);
  input.request = async () => ({ nextPageToken: "loop" });
  await assert.rejects(syncWorkoutEvents(input), /repeated a calendar page/);
});

test("lost insert responses retry without duplicating or claiming unrelated events", async () => {
  const api = fakeCalendar();
  const input = syncInput(api, [workout()]);
  let firstList = true;
  input.request = async (path, method, body) => {
    if (firstList) {
      firstList = false;
      return { items: [] };
    }
    return api.request(path, method, body);
  };
  const desired = workoutGoogleEvent("coros-1", workout());
  api.events.set(desired.id, desired);
  assert.equal((await syncWorkoutEvents(input)).unchanged, 1);
  assert.equal(api.events.size, 1);
  firstList = true;
  api.events.set(desired.id, { id: desired.id, summary: "Unrelated" });
  await assert.rejects(syncWorkoutEvents(input), /conflicts with this workout/);
  assert.equal(api.events.get(desired.id).summary, "Unrelated");
});

function clientFixture() {
  let state = {
    config,
    tokens: tokens(),
    accountId: "google-1",
    accountEmail: "runner@example.com",
    corosUserId: "coros-1",
    calendar: { id: "primary", name: "Personal", primary: true },
    autoSync: true,
  };
  let sourceUser = "coros-1";
  let sourceRevision;
  let sourceFailure = false;
  let sourceRead;
  let authorize;
  const calls = [];
  const api = fakeCalendar();
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/token")
      return Response.json({ access_token: "renewed", expires_in: 3600 });
    if (url.pathname === "/revoke") return new Response(null, { status: 200 });
    if (url.pathname.endsWith("/userinfo"))
      return Response.json({ id: "google-1", email: "runner@example.com" });
    if (url.pathname.endsWith("/calendarList")) {
      return Response.json({
        items: [
          { id: "readonly", summary: "Read only", accessRole: "reader" },
          {
            id: "primary",
            summary: "Personal",
            primary: true,
            accessRole: "owner",
          },
        ],
      });
    }
    const result = await api.request(
      url.pathname.replace("/calendar/v3", "") + url.search,
      init.method,
      init.body ? JSON.parse(init.body) : undefined,
    );
    return result === undefined
      ? new Response(null, { status: 204 })
      : Response.json(result);
  };
  const client = new GoogleCalendarClient({
    read: () => structuredClone(state),
    write: (value) => {
      state = structuredClone(value);
    },
    ensureSecureStorage: () => {},
    sourceUserId: () => sourceUser,
    sourceRevision: () => sourceRevision,
    listWorkouts: async (start, end) => {
      if (sourceRead) return sourceRead(start, end);
      if (sourceFailure) throw new Error("COROS offline");
      const day = shiftCalendarDay(calendarSyncRange().startDay, 8);
      return day >= start && day <= end ? [workout("w1", day)] : [];
    },
    openUrl: async () => {},
    authorize: (...args) =>
      authorize ? authorize(...args) : Promise.resolve(tokens()),
  });
  return {
    client,
    calls,
    api,
    get state() {
      return state;
    },
    setState: (value) => {
      state = value;
    },
    setSource: (value) => {
      sourceUser = value;
    },
    setSourceRevision: (value) => {
      sourceRevision = value;
    },
    failSource: () => {
      sourceFailure = true;
    },
    setAuthorize: (fn) => {
      authorize = fn;
    },
    setSourceRead: (fn) => {
      sourceRead = fn;
    },
  };
}

test("refresh tokens, writable calendar selection, persisted automatic sync and manual sync", async () => {
  const f = clientFixture();
  f.setState({ ...f.state, tokens: { ...tokens(), expiresAt: 0 } });
  assert.deepEqual(
    (await f.client.listCalendars()).map((item) => item.id),
    ["primary"],
  );
  assert.equal(f.state.tokens.accessToken, "renewed");
  assert.equal(f.state.tokens.refreshToken, "refresh");
  assert.equal(f.calls[0].init.body.get("grant_type"), "refresh_token");
  await assert.rejects(
    f.client.updateSettings({ calendarId: "readonly" }),
    /permission to edit/,
  );
  await f.client.updateSettings({ calendarId: "primary", autoSync: true });
  await f.client.syncIfDue();
  assert.ok(f.state.lastSyncedAt);
  assert.equal(f.api.events.size, 1);
  const before = f.calls.length;
  await f.client.syncIfDue();
  assert.equal(f.calls.length, before);
  assert.equal((await f.client.sync()).unchanged, 1);
  assert.equal(f.client.status().syncing, false);
});

test("Google sync status tracks schedule changes, including changes during sync", async () => {
  const f = clientFixture();
  assert.equal(f.client.status().needsSync, true);
  await f.client.sync();
  assert.equal(f.client.status().needsSync, false);
  f.setSourceRevision("edited");
  assert.equal(f.client.status().needsSync, true);
  const day = shiftCalendarDay(calendarSyncRange().startDay, 8);
  f.setSourceRead(async (start, end) => {
    f.setSourceRevision("edited-during-sync");
    return day >= start && day <= end ? [workout("w1", day)] : [];
  });
  await f.client.sync();
  assert.equal(f.client.status().needsSync, true);
  f.setSourceRead(undefined);
  await f.client.sync();
  assert.equal(f.client.status().needsSync, false);
  await f.client.connect();
  assert.equal(f.client.status().needsSync, false);
});

test("source failure and account switching never write Google events", async () => {
  const f = clientFixture();
  f.failSource();
  await assert.rejects(f.client.sync(), /COROS offline/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.lastSyncedAt, undefined);
  f.setSource("different-coros-user");
  await f.client.syncIfDue();
  await assert.rejects(f.client.sync(), /paused/);
  assert.equal(f.calls.length, 0);
  await f.client.connect();
  assert.equal(f.state.corosUserId, "different-coros-user");
  assert.equal(
    f.state.calendar,
    undefined,
    "changing COROS account requires choosing a destination again",
  );
  assert.equal(f.state.autoSync, undefined);
});

test("revoked tokens stop automatic sync and expose a reconnect state", async () => {
  const f = clientFixture();
  f.setState({ ...f.state, tokens: { ...tokens(), expiresAt: 0 } });
  globalThis.fetch = async () =>
    Response.json({ error: "invalid_grant" }, { status: 400 });
  await assert.rejects(f.client.sync(), /revoked/);
  assert.equal(f.client.status().connected, false);
  assert.equal(f.client.status().autoSync, false);
  assert.match(f.client.status().error, /Reconnect/);
});

test("disconnect cancels in-flight login and removes local tokens even when offline", async () => {
  const f = clientFixture();
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  f.setAuthorize(
    (_config, _open, signal) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
      }),
  );
  const connecting = f.client.connect();
  const rejected = assert.rejects(connecting, /cancelled/);
  await ready;
  await assert.rejects(f.client.sync(), /already running/);
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  await f.client.disconnect();
  await rejected;
  assert.equal(f.client.status().connected, false);
  assert.equal(f.state.tokens, undefined);
  assert.equal(f.state.accountEmail, undefined);
  assert.match(f.state.error, /Disconnected on this computer/);
});

test("OAuth validates state, exchanges PKCE and never embeds tokens in browser responses", async () => {
  let authorizationUrl;
  let tokenBody;
  globalThis.fetch = async (_url, init) => {
    tokenBody = init.body;
    return Response.json({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    });
  };
  const result = await authorizeGoogleCalendar(
    config,
    async (rawUrl) => {
      authorizationUrl = new URL(rawUrl);
      const redirect = authorizationUrl.searchParams.get("redirect_uri");
      assert.equal(new URL(redirect).hostname, "127.0.0.1");
      assert.equal(
        authorizationUrl.searchParams.get("code_challenge_method"),
        "S256",
      );
      assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
      assert.equal(
        (await realFetch(`${redirect}?code=wrong&state=bad`)).status,
        400,
      );
      assert.equal(
        (await realFetch(new URL("/favicon.ico", redirect))).status,
        404,
      );
      const callback = new URL(redirect);
      callback.search = new URLSearchParams({
        code: "good-code",
        state: authorizationUrl.searchParams.get("state"),
      }).toString();
      const response = await realFetch(callback);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.doesNotMatch(
        await response.text(),
        /good-code|accessToken|refreshToken/,
      );
    },
    new AbortController().signal,
  );
  assert.equal(result.refreshToken, "refresh");
  assert.equal(tokenBody.get("code"), "good-code");
  assert.equal(tokenBody.get("client_secret"), "test-secret");
  assert.equal(
    createHash("sha256")
      .update(tokenBody.get("code_verifier"))
      .digest("base64url"),
    authorizationUrl.searchParams.get("code_challenge"),
  );
});

test("disconnect stops a stalled COROS read without letting late results sync", async () => {
  const f = clientFixture();
  let started, finishRead;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  f.setSourceRead(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
        started();
      }),
  );
  const syncing = f.client.sync();
  const rejected = assert.rejects(syncing, /cancelled/);
  await ready;
  await f.client.disconnect();
  await rejected;
  finishRead([workout()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.tokens, undefined);
  assert.equal(f.api.events.size, 0);
  assert.equal(
    f.calls.filter(({ url }) => url.pathname.includes("/calendar/v3")).length,
    0,
  );
});

test("OAuth consent denial, browser failure, cancellation and timeout cleanly settle", async () => {
  let exchanges = 0;
  globalThis.fetch = async () => {
    exchanges++;
    throw new Error("Unexpected exchange");
  };
  await assert.rejects(
    authorizeGoogleCalendar(
      config,
      async (rawUrl) => {
        const url = new URL(rawUrl);
        const callback = new URL(url.searchParams.get("redirect_uri"));
        callback.search = new URLSearchParams({
          error: "access_denied",
          state: url.searchParams.get("state"),
        }).toString();
        await realFetch(callback);
      },
      new AbortController().signal,
    ),
    /not granted/,
  );
  await assert.rejects(
    authorizeGoogleCalendar(
      config,
      async () => {
        throw new Error("browser failed");
      },
      new AbortController().signal,
    ),
    /browser failed/,
  );
  const controller = new AbortController();
  await assert.rejects(
    authorizeGoogleCalendar(
      config,
      async () => {
        controller.abort();
      },
      controller.signal,
    ),
    /cancelled/,
  );
  await assert.rejects(
    authorizeGoogleCalendar(
      config,
      async () => {},
      new AbortController().signal,
      20,
    ),
    /timed out/,
  );
  assert.equal(exchanges, 0);
});

test("partial grants and absent offline access fail before connecting", async () => {
  globalThis.fetch = async () =>
    Response.json({
      access_token: "access",
      refresh_token: "refresh",
      scope: "email",
    });
  await assert.rejects(
    requestGoogleTokens(config, { grant_type: "authorization_code" }),
    /Allow calendar access/,
  );
  globalThis.fetch = async () => Response.json({ access_token: "access" });
  await assert.rejects(
    requestGoogleTokens(config, { grant_type: "authorization_code" }),
    /offline access/,
  );
});

const timedPreferences = { mode: "timed", startTime: "18:00", endTime: "19:00", timeZone: "America/Toronto" };
test("Google timed events migrate in place, preserve calendar moves/resizes regardless of workout estimates", async () => {
  const entry = { ...workout(), rawProgram: { estimatedTime: 2700 } };
  const api = fakeCalendar();
  const input = syncInput(api, [entry]);
  await syncWorkoutEvents(input);
  const id = [...api.events.keys()][0];
  const timedInput = {...input, eventTiming: timedPreferences};
  assert.equal((await syncWorkoutEvents(timedInput)).updated, 1);
  assert.equal(api.events.size,1);
  assert.equal(api.events.get(id).start.dateTime,"2026-09-04T22:00:00.000Z");
  assert.equal(api.events.get(id).end.dateTime,"2026-09-04T23:00:00.000Z");
  assert.equal((await syncWorkoutEvents(timedInput)).unchanged,1);
  const moved = api.events.get(id);
  moved.start = {dateTime:"2026-09-05T09:00:00",timeZone:"America/Toronto"};
  moved.end = {dateTime:"2026-09-05T09:45:00-04:00",timeZone:"America/Toronto"};
  assert.equal((await syncWorkoutEvents(timedInput)).unchanged,1);
  entry.rawProgram.estimatedTime=3600;
  entry.name="Longer run";
  assert.equal((await syncWorkoutEvents(timedInput)).updated,1);
  assert.equal(api.events.get(id).start.dateTime,"2026-09-05T13:00:00.000Z");
  assert.equal(api.events.get(id).end.dateTime,"2026-09-05T13:45:00.000Z");
  api.events.get(id).end.dateTime="2026-09-05T14:30:00.000Z";
  entry.rawProgram.estimatedTime=4500;
  await syncWorkoutEvents(timedInput);
  assert.equal(api.events.get(id).end.dateTime,"2026-09-05T14:30:00.000Z");
  assert.equal((await syncWorkoutEvents(timedInput)).unchanged,1);
  for (const duration of [5400, 7200]) {
    entry.rawProgram = {planDuration: duration, duration, estimatedTime: duration};
    entry.name = `Run ${duration}`;
    await syncWorkoutEvents(timedInput);
    assert.equal(api.events.get(id).end.dateTime,"2026-09-05T14:30:00.000Z");
  }
  assert.equal((await syncWorkoutEvents({...timedInput,eventTiming:{...timedPreferences,startTime:"07:00"}})).updated,1);
  assert.equal(api.events.get(id).start.dateTime,"2026-09-04T11:00:00.000Z");
  assert.equal((await syncWorkoutEvents(input)).updated,1);
  assert.equal(api.events.get(id).start.date,"2026-09-04");
  assert.equal(api.events.get(id).start.dateTime,null);
  assert.equal((await syncWorkoutEvents(input)).unchanged,1);
});

test("Google settings persist timing, invalidate sync status and reject invalid values", async () => {
  const f = clientFixture();
  await f.client.updateSettings({calendarId:"primary"});
  await f.client.sync();
  assert.equal(f.client.status().eventTiming.mode,"all-day");
  await f.client.updateSettings({eventTiming:timedPreferences});
  assert.deepEqual(f.state.eventTiming,timedPreferences);
  assert.equal(f.client.status().needsSync,true);
  assert.equal(f.state.lastSyncedAt,undefined);
  await f.client.sync();
  assert.ok([...f.api.events.values()][0].start.dateTime);
  await f.client.connect();
  assert.deepEqual(f.client.status().eventTiming,timedPreferences);
  await assert.rejects(f.client.updateSettings({eventTiming:{...timedPreferences,startTime:"25:00"}}),/valid start time/);
  assert.deepEqual(f.state.eventTiming,timedPreferences);
});

test("Google applies individual event saves in place without changing other workout times", async () => {
  const api=fakeCalendar();
  const entry=workout();
  const other=workout("other");
  const input={...syncInput(api,[entry,other]),eventTiming:timedPreferences};
  await syncWorkoutEvents(input);
  const id=workoutGoogleEvent("coros-1",entry).id;
  const otherId=workoutGoogleEvent("coros-1",other).id;
  entry.calendarEvent={timing:{...timedPreferences,startTime:"07:30",endTime:"08:15"},revision:"save-1"};
  await syncWorkoutEvents(input);
  assert.equal(api.events.size,2);
  assert.equal(api.events.get(id).start.dateTime,"2026-09-04T11:30:00.000Z");
  assert.equal(api.events.get(id).end.dateTime,"2026-09-04T12:15:00.000Z");
  assert.equal(api.events.get(otherId).start.dateTime,"2026-09-04T22:00:00.000Z");
  api.events.get(id).start.dateTime="2026-09-04T10:00:00.000Z";
  await syncWorkoutEvents(input);
  assert.equal(api.events.get(id).start.dateTime,"2026-09-04T10:00:00.000Z");
  entry.calendarEvent.revision="save-2";
  await syncWorkoutEvents(input);
  assert.equal(api.events.get(id).start.dateTime,"2026-09-04T11:30:00.000Z");
  entry.calendarEvent={timing:{...timedPreferences,mode:"all-day"},revision:"save-3"};
  await syncWorkoutEvents(input);
  assert.equal(api.events.get(id).start.date,"2026-09-04");
  assert.equal(api.events.get(otherId).start.dateTime,"2026-09-04T22:00:00.000Z");
});

test("Google queues explicit event sync behind active sync and supports days outside the normal window", async () => {
  const f=clientFixture();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  f.setSourceRead(async(start,end)=>{await gate; return start<="20280904" && end>="20280904" ? [workout("far","20280904")] : [];});
  const active=f.client.sync();
  const queued=f.client.syncAfterCurrentOperation("coros-1","20280904");
  release();
  await Promise.all([active,queued]);
  assert.equal(f.api.events.size,1);
  assert.equal([...f.api.events.values()][0].start.date,"2028-09-04");
  await assert.rejects(f.client.syncAfterCurrentOperation("different-user","20280904"),/account changed/);
});
