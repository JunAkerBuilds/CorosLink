import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { AppleCalendarClient } from "../dist-electron/appleCalendarClient.js";
import {
  ICloudCalDav,
  ICloudCalendarError,
  iCloudCalendarUrl,
  calendarResourceUrl,
  parseDavResponses,
} from "../dist-electron/iCloudCalDav.js";
import {
  appleWorkoutHref,
  appleWorkoutUid,
  serializeAppleWorkout,
  parseAppleWorkout,
  syncAppleWorkoutEvents,
} from "../dist-electron/appleCalendarSync.js";
import {
  calendarHash,
  calendarSyncRange,
  shiftCalendarDay,
  workoutCalendarData,
} from "../dist-electron/calendarSyncUtils.js";

const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});
const credentials = {
  email: "runner@example.com",
  // Generate dummy credentials for mocked requests; no real account is used.
  appPassword: Array.from({ length: 4 }, () =>
    Array.from(randomBytes(4), (byte) =>
      String.fromCharCode(97 + (byte % 26)),
    ).join(""),
  ).join("-"),
};
const host = "https://p01-caldav.icloud.com";
const home = `${host}/123/calendars/`;
const calendar = `${home}workouts/`;
const workout = (id = "w1", day = "20260904") => ({
  planId: "plan",
  idInPlan: id,
  planProgramId: "program",
  happenDay: day,
  name: "Easy run",
  volume: "5 km",
  trainingLoad: 35,
});
const managedEvent = (user = "coros-1", entry = workout()) => {
  const data = workoutCalendarData(user, entry);
  return { ...data, uid: appleWorkoutUid(data.source, data.key), sequence: 0 };
};
const escapeXml = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const multistatus = (rows) =>
  `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`;
const row = (href, props, code = 200) =>
  `<d:response><d:href>${escapeXml(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 ${code} Result</d:status></d:propstat></d:response>`;
const xmlResponse = (rows) =>
  new Response(multistatus(rows), {
    status: 207,
    headers: { "content-type": "application/xml" },
  });
const calendarProps = (name, access = "write", type = "VEVENT") =>
  `<d:displayname>${name}</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="${type}"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:${access}/></d:privilege></d:current-user-privilege-set>`;

function serverFixture() {
  const resources = new Map();
  const calls = [];
  let version = 0;
  let rejectAuth = false;
  let putFailure;
  let reportFailure;
  let redirect;
  let afterRequest;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, ...init });
    assert.equal(init.redirect, "manual");
    assert.equal(
      init.headers.Authorization,
      `Basic ${Buffer.from(`${credentials.email}:${credentials.appPassword}`).toString("base64")}`,
    );
    afterRequest?.(url, init);
    if (rejectAuth) return new Response(null, { status: 401 });
    if (url.hostname === "caldav.icloud.com")
      return new Response(null, {
        status: 301,
        headers: { location: redirect ?? `${host}/` },
      });
    if (init.method === "PROPFIND") {
      if (url.pathname === "/")
        return xmlResponse(
          row(
            "/",
            "<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>",
          ),
        );
      if (url.pathname === "/123/principal/")
        return xmlResponse(
          row(
            url.pathname,
            `<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`,
          ),
        );
      if (url.href === home)
        return xmlResponse(
          [
            row(calendar, calendarProps("Workouts")),
            row(`${home}readonly/`, calendarProps("Shared", "read")),
            row(
              `${home}reminders/`,
              calendarProps("Reminders", "write", "VTODO"),
            ),
            row(home, "<d:resourcetype><d:collection/></d:resourcetype>"),
          ].join(""),
        );
    }
    if (init.method === "REPORT") {
      if (reportFailure) return new Response(reportFailure, { status: 207 });
      // iCloud rejects UID property filters, even though CalDAV defines them.
      if (init.body.includes("prop-filter"))
        return new Response(null, { status: 412 });
      return xmlResponse(
        row(calendar, "<d:getetag>&quot;collection&quot;</d:getetag>") +
        [...resources]
          .map(([href, resource]) =>
            row(
              href,
              `<d:getetag>${escapeXml(resource.etag)}</d:getetag><c:calendar-data>${escapeXml(resource.data)}</c:calendar-data>`,
            ),
          )
          .join(""),
      );
    }
    if (init.method === "PUT") {
      if (putFailure) return new Response(null, { status: putFailure });
      const current = resources.get(url.href);
      if (
        (init.headers["If-None-Match"] === "*" && current) ||
        (init.headers["If-Match"] && init.headers["If-Match"] !== current?.etag)
      )
        return new Response(null, { status: 412 });
      assert.equal(
        init.headers["Content-Type"],
        "text/calendar; charset=utf-8",
      );
      resources.set(url.href, { data: init.body, etag: `"v${++version}"` });
      return new Response(null, { status: current ? 204 : 201 });
    }
    if (init.method === "GET") {
      const resource = resources.get(url.href);
      return resource
        ? new Response(resource.data, { headers: { etag: resource.etag } })
        : new Response(null, { status: 404 });
    }
    if (init.method === "DELETE") {
      const current = resources.get(url.href);
      if (!current) return new Response(null, { status: 404 });
      if (init.headers["If-Match"] !== current.etag)
        return new Response(null, { status: 412 });
      resources.delete(url.href);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request ${init.method} ${url.href}`);
  };
  const dav = new ICloudCalDav(credentials, new AbortController().signal);
  return {
    resources,
    calls,
    dav,
    rejectAuth: () => {
      rejectAuth = true;
    },
    failPut: (code) => {
      putFailure = code;
    },
    failReport: (body) => {
      reportFailure = body;
    },
    redirectTo: (url) => {
      redirect = url;
    },
    afterRequest: (fn) => {
      afterRequest = fn;
    },
  };
}
const syncInput = (fixture, workouts) => ({
  userId: "coros-1",
  calendarId: calendar,
  startDay: "20260901",
  endDay: "20260930",
  workouts,
  dav: fixture.dav,
});
function putFixture(
  fixture,
  event,
  href = appleWorkoutHref(calendar, event.key),
) {
  fixture.resources.set(href, {
    data: serializeAppleWorkout(event),
    etag: '"initial"',
  });
}

test("discovers iCloud shard and home, showing only writable event calendars", async () => {
  const f = serverFixture();
  assert.deepEqual(await f.dav.discover(), {
    homeUrl: home,
    calendars: [{ id: calendar, name: "Workouts", primary: false }],
  });
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls.at(-1).headers.Depth, "1");
});

test("refuses foreign hosts, credential-bearing redirects and out-of-calendar resources", async () => {
  for (const url of [
    "http://caldav.icloud.com/",
    "https://evil.example/",
    "https://caldav.icloud.com.evil.example/",
    "https://user@caldav.icloud.com/",
    "https://caldav.icloud.com:444/",
    "https://caldav.icloud.com/?token=bad",
  ])
    assert.throws(() => iCloudCalendarUrl(url), /unexpected/);
  for (const href of [
    "../other/event.ics",
    "https://p02-caldav.icloud.com/123/calendars/workouts/event.ics",
    "nested%2Fevent.ics",
  ])
    assert.throws(() => calendarResourceUrl(href, calendar), /outside/);
  const f = serverFixture();
  f.redirectTo("https://evil.example/steal");
  await assert.rejects(f.dav.discover(), /unexpected/);
  assert.equal(
    f.calls.length,
    1,
    "credentials never reach the redirected host",
  );
});

test("iCalendar escapes injection and folds UTF-8 without losing content or dates", () => {
  const event = managedEvent("coros-1", {
    ...workout("w", "20261231"),
    name: "Run 🏃, café; ".repeat(15) + "\r\nBEGIN:VEVENT\r\nSUMMARY:Injected",
  });
  const data = serializeAppleWorkout(event, new Date("2026-09-04T12:34:56Z"));
  for (const line of data.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(data.split("\r\nBEGIN:VEVENT\r\n").length, 2);
  const parsed = parseAppleWorkout(data, event.source);
  assert.equal(parsed.summary, event.summary.replaceAll("\r\n", "\n"));
  assert.equal(parsed.day, "20261231");
  assert.equal(parsed.endDay, "20270101");
  assert.equal(parsed.actualStart, "20261231");
  assert.ok(data.includes("DTSTAMP:20260904T123456Z"));
  assert.throws(
    () => managedEvent("coros-1", workout("w", "20260230")),
    /invalid scheduled date/,
  );
});

test("idempotent sync moves and edits events with conditional requests", async () => {
  const f = serverFixture();
  assert.deepEqual(await syncAppleWorkoutEvents(syncInput(f, [workout()])), {
    created: 1,
    updated: 0,
    deleted: 0,
    unchanged: 0,
  });
  assert.equal(
    (await syncAppleWorkoutEvents(syncInput(f, [workout()]))).unchanged,
    1,
  );
  const changed = { ...workout("w1", "20260908"), name: "Long run" };
  assert.equal(
    (await syncAppleWorkoutEvents(syncInput(f, [changed]))).updated,
    1,
  );
  assert.equal(f.resources.size, 1);
  const saved = parseAppleWorkout(
    [...f.resources.values()][0].data,
    calendarHash("coros-1"),
  );
  assert.equal(saved.day, "20260908");
  assert.equal(saved.summary, "Long run");
  assert.equal(saved.sequence, 1);
  const puts = f.calls.filter((call) => call.method === "PUT");
  assert.equal(puts[0].headers["If-None-Match"], "*");
  assert.equal(puts[1].headers["If-Match"], '"v1"');
});

test("iCloud event queries omit unsupported UID filters and skip collection metadata", async () => {
  const f = serverFixture();
  putFixture(f, managedEvent());
  const events = await f.dav.listEvents(calendar, calendarHash("coros-1"));
  assert.equal(events.length, 1);
  assert.equal(events[0].href, appleWorkoutHref(calendar, managedEvent().key));
  const query = f.calls[0];
  assert.equal(query.method, "REPORT");
  assert.ok(query.body.includes('name="VEVENT"'));
  assert.ok(!query.body.includes("prop-filter"));
  assert.ok(!query.body.includes("text-match"));
});

test("a rejected calendar read is not reported as an event version conflict", async () => {
  serverFixture();
  globalThis.fetch = async () => new Response(null, { status: 412 });
  const dav = new ICloudCalDav(credentials, new AbortController().signal);
  await assert.rejects(
    dav.listEvents(calendar, calendarHash("coros-1")),
    (error) => error instanceof ICloudCalendarError &&
      error.status === 412 && /could not read this calendar/.test(error.message),
  );
});

test("removal preserves personal events, copies, other accounts and history", async () => {
  const f = serverFixture();
  const current = managedEvent();
  putFixture(f, current);
  putFixture(f, current, `${calendar}manual-copy.ics`);
  putFixture(f, managedEvent("coros-1", workout("history", "20260801")));
  putFixture(f, managedEvent("coros-1", workout("future", "20261001")));
  putFixture(f, managedEvent("coros-2"));
  f.resources.set(`${calendar}personal.ics`, {
    etag: '"personal"',
    data: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:dentist\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  });
  assert.equal((await syncAppleWorkoutEvents(syncInput(f, []))).deleted, 1);
  assert.equal(f.resources.size, 5);
  assert.ok(
    f.resources.has(`${calendar}personal.ics`) &&
      f.resources.has(`${calendar}manual-copy.ics`),
  );
});

test("a concurrent update reloads the event and retries with its latest version", async () => {
  const f = serverFixture();
  const event = managedEvent();
  const href = appleWorkoutHref(calendar, event.key);
  putFixture(f, event);
  putFixture(f, managedEvent("coros-1", workout("removed")));
  f.afterRequest((url, init) => {
    if (init.method !== "PUT") return;
    f.afterRequest(undefined);
    f.resources.set(url.href, {
      data: serializeAppleWorkout({ ...event, sequence: 7 }),
      etag: '"latest"',
    });
  });
  const changed = { ...workout(), name: "Changed" };
  assert.deepEqual(await syncAppleWorkoutEvents(syncInput(f, [changed])), {
    created: 0,
    updated: 1,
    deleted: 1,
    unchanged: 0,
  });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["REPORT", "PUT", "GET", "PUT", "DELETE"],
  );
  const puts = f.calls.filter((call) => call.method === "PUT");
  assert.equal(puts[0].headers["If-Match"], '"initial"');
  assert.equal(puts[1].headers["If-Match"], '"latest"');
  const saved = parseAppleWorkout(f.resources.get(href).data, event.source);
  assert.equal(saved.summary, "Changed");
  assert.equal(saved.sequence, 8);
});

test("a conflict already resolved by another writer needs no further update", async () => {
  const f = serverFixture();
  const changed = { ...workout(), name: "Changed" };
  const event = managedEvent("coros-1", changed);
  putFixture(f, managedEvent());
  f.afterRequest((url, init) => {
    if (init.method !== "PUT") return;
    f.afterRequest(undefined);
    f.resources.set(url.href, {
      data: serializeAppleWorkout({ ...event, sequence: 4 }),
      etag: '"latest"',
    });
  });
  assert.deepEqual(await syncAppleWorkoutEvents(syncInput(f, [changed])), {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 1,
  });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["REPORT", "PUT", "GET"],
  );
});

test("concurrent deletion retries use the latest version and respect the sync window", async () => {
  for (const day of ["20260904", "20261001"]) {
    const f = serverFixture();
    putFixture(f, managedEvent());
    f.afterRequest((url, init) => {
      if (init.method !== "DELETE") return;
      f.afterRequest(undefined);
      f.resources.set(url.href, {
        data: serializeAppleWorkout(
          managedEvent("coros-1", workout("w1", day)),
        ),
        etag: '"latest"',
      });
    });
    const result = await syncAppleWorkoutEvents(syncInput(f, []));
    const inRange = day === "20260904";
    assert.equal(result.deleted, inRange ? 1 : 0);
    assert.equal(f.resources.size, inRange ? 0 : 1);
    const deletes = f.calls.filter((call) => call.method === "DELETE");
    assert.equal(deletes.length, inRange ? 2 : 1);
    if (inRange) assert.equal(deletes[1].headers["If-Match"], '"latest"');
  }
});

test("events disappearing during conflict recovery are recreated or already removed", async () => {
  for (const method of ["PUT", "DELETE"]) {
    const f = serverFixture();
    putFixture(f, managedEvent());
    f.afterRequest((url, init) => {
      if (init.method === method) {
        if (method === "PUT") {
          f.afterRequest(undefined);
          f.resources.delete(url.href);
        } else {
          f.resources.get(url.href).etag = '"latest"';
        }
      } else if (init.method === "GET") {
        f.afterRequest(undefined);
        f.resources.delete(url.href);
      }
    });
    const entries =
      method === "PUT" ? [{ ...workout(), name: "Changed" }] : [];
    const result = await syncAppleWorkoutEvents(syncInput(f, entries));
    assert.equal(result.created, method === "PUT" ? 1 : 0);
    assert.equal(result.deleted, method === "DELETE" ? 1 : 0);
    assert.equal(f.resources.size, method === "PUT" ? 1 : 0);
    if (method === "PUT")
      assert.equal(f.calls.at(-1).headers["If-None-Match"], "*");
  }
});

test("conflict recovery refuses foreign or newly recurring events before retrying a write", async () => {
  for (const method of ["PUT", "DELETE"]) {
    for (const recurring of [false, true]) {
      const f = serverFixture();
      const event = managedEvent();
      const href = appleWorkoutHref(calendar, event.key);
      const data = serializeAppleWorkout({
        ...event,
        uid: recurring ? event.uid : "unrelated",
      }).replace(
        "END:VEVENT",
        recurring ? "RRULE:FREQ=DAILY\r\nEND:VEVENT" : "END:VEVENT",
      );
      putFixture(f, event);
      f.afterRequest((url, init) => {
        if (init.method !== method) return;
        f.afterRequest(undefined);
        f.resources.set(url.href, { data, etag: '"latest"' });
      });
      await assert.rejects(
        syncAppleWorkoutEvents(
          syncInput(f,
            method === "PUT" ? [{ ...workout(), name: "Changed" }] : [],
          ),
        ),
        recurring ? /repeating event/ : /unrelated/,
      );
      assert.equal(f.resources.get(href).data, data);
      assert.equal(f.calls.filter((call) => call.method === method).length, 1);
    }
  }
});

test("persistent deletion conflicts stop after bounded retries", async () => {
  const f = serverFixture();
  putFixture(f, managedEvent());
  let version = 0;
  f.afterRequest((url, init) => {
    if (init.method === "DELETE")
      f.resources.get(url.href).etag = `"conflict-${++version}"`;
  });
  await assert.rejects(
    syncAppleWorkoutEvents(syncInput(f, [])),
    /changed during sync/,
  );
  assert.equal(f.resources.size, 1);
  assert.equal(f.calls.filter((call) => call.method === "DELETE").length, 3);
  assert.equal(f.calls.filter((call) => call.method === "GET").length, 2);
});

test("failed reads, malformed data and concurrent updates prevent cleanup", async () => {
  const f = serverFixture();
  putFixture(f, managedEvent());
  putFixture(f, managedEvent("coros-1", workout("removed")));
  f.failPut(412);
  await assert.rejects(
    syncAppleWorkoutEvents(syncInput(f, [{ ...workout(), name: "Changed" }])),
    /changed during sync/,
  );
  assert.equal(f.calls.filter((call) => call.method === "PUT").length, 3);
  assert.equal(f.calls.filter((call) => call.method === "GET").length, 2);
  assert.equal(f.calls.filter((call) => call.method === "DELETE").length, 0);
  f.failReport('<d:multistatus xmlns:d="DAV:"><d:response>');
  await assert.rejects(
    syncAppleWorkoutEvents(syncInput(f, [])),
    /invalid calendar response/,
  );
  assert.equal(f.resources.size, 2);
  for (const xml of [
    "<!DOCTYPE x><multistatus/>",
    "<not-a-calendar/>",
    '<multistatus xmlns="DAV:"><error/></multistatus>',
  ])
    assert.throws(() => parseDavResponses(xml));
});

test("incomplete property responses fail instead of looking like an empty calendar", async () => {
  const f = serverFixture();
  f.failReport(
    multistatus(
      row(`${calendar}missing.ics`, "<d:getetag>&quot;v1&quot;</d:getetag>"),
    ),
  );
  await assert.rejects(
    syncAppleWorkoutEvents(syncInput(f, [])),
    /incomplete event list/,
  );
  assert.equal(
    f.calls.filter((call) => ["PUT", "DELETE"].includes(call.method)).length,
    0,
  );
});

test("retries a lost insert response safely and refuses unrelated path collisions", async () => {
  const f = serverFixture();
  putFixture(f, managedEvent());
  const dav = {
    listEvents: async () => [],
    getEvent: f.dav.getEvent.bind(f.dav),
    putEvent: f.dav.putEvent.bind(f.dav),
    deleteEvent: f.dav.deleteEvent.bind(f.dav),
  };
  assert.equal(
    (await syncAppleWorkoutEvents({ ...syncInput(f, [workout()]), dav }))
      .unchanged,
    1,
  );
  const [href, resource] = [...f.resources][0];
  resource.data =
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:unrelated\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  await assert.rejects(
    syncAppleWorkoutEvents({ ...syncInput(f, [workout()]), dav }),
    /unrelated/,
  );
  assert.equal(f.resources.get(href).data, resource.data);
});

function clientFixture() {
  const f = serverFixture();
  let state = {},
    userId = "coros-1",
    secure = true,
    sourceRevision,
    readOverride;
  const client = new AppleCalendarClient({
    read: () => structuredClone(state),
    write: (next) => {
      state = structuredClone(next);
    },
    ensureSecureStorage: () => {
      if (!secure) throw new Error("Secure storage unavailable");
    },
    sourceUserId: () => userId,
    sourceRevision: () => sourceRevision,
    listWorkouts: async (start, end) => {
      if (readOverride) return readOverride(start, end);
      const day = shiftCalendarDay(calendarSyncRange().startDay, 8);
      return day >= start && day <= end ? [workout("w", day)] : [];
    },
  });
  return {
    ...f,
    client,
    state: () => state,
    setUser: (value) => {
      userId = value;
    },
    setSourceRevision: (value) => {
      sourceRevision = value;
    },
    setSecure: (value) => {
      secure = value;
    },
    setRead: (fn) => {
      readOverride = fn;
    },
  };
}

test("client connects, selects a calendar, syncs and never exposes the password in status", async () => {
  const f = clientFixture();
  assert.equal((await f.client.connect(credentials)).connected, true);
  assert.equal(f.client.status().calendar, undefined);
  assert.ok(
    !JSON.stringify(f.client.status()).includes(credentials.appPassword),
  );
  assert.equal(f.state().credentials.appPassword, credentials.appPassword);
  await assert.rejects(
    f.client.updateSettings({ calendarId: `${home}readonly/` }),
    /permission to edit/,
  );
  await f.client.updateSettings({ calendarId: calendar, autoSync: true });
  await f.client.syncIfDue();
  assert.ok(f.state().lastSyncedAt);
  assert.equal(f.resources.size, 1);
  const calls = f.calls.length;
  await f.client.syncIfDue();
  assert.equal(f.calls.length, calls);
  await f.client.disconnect();
  assert.deepEqual(f.state(), {});
  assert.equal(f.resources.size, 1);
});

test("Apple sync status tracks schedule changes, including changes during sync", async () => {
  const f = clientFixture();
  await f.client.connect(credentials);
  await f.client.updateSettings({ calendarId: calendar });
  assert.equal(f.client.status().needsSync, true);
  await f.client.sync();
  assert.equal(f.client.status().needsSync, false);
  f.setSourceRevision("edited");
  assert.equal(f.client.status().needsSync, true);
  f.afterRequest((_url, init) => {
    if (init.method === "REPORT") f.setSourceRevision("edited-during-sync");
  });
  await f.client.sync();
  assert.equal(f.client.status().needsSync, true);
  f.afterRequest(undefined);
  await f.client.sync();
  assert.equal(f.client.status().needsSync, false);
  await f.client.connect(credentials);
  assert.equal(f.client.status().needsSync, false);
});

test("client records successful conflict recovery and clears the prior sync error", async () => {
  const f = clientFixture();
  await f.client.connect(credentials);
  await f.client.updateSettings({ calendarId: calendar });
  await f.client.sync();
  const day = shiftCalendarDay(calendarSyncRange().startDay, 8);
  const changed = { ...workout("w", day), name: "Changed" };
  f.setRead(async (start, end) => day >= start && day <= end ? [changed] : []);
  const lastSyncedAt = f.state().lastSyncedAt;
  f.failPut(412);
  await assert.rejects(f.client.sync(), /changed during sync/);
  assert.equal(f.state().lastSyncedAt, lastSyncedAt);
  assert.match(f.client.status().error, /changed during sync/);
  f.failPut(undefined);
  f.afterRequest((url, init) => {
    if (init.method !== "PUT") return;
    f.afterRequest(undefined);
    f.resources.get(url.href).etag = '"latest"';
  });
  assert.equal((await f.client.sync()).updated, 1);
  assert.equal(f.client.status().error, undefined);
  assert.equal(f.client.status().syncing, false);
  assert.ok(f.state().lastSyncedAt);
  assert.equal(f.resources.size, 1);
});

test("invalid credentials and unavailable secure storage never contact iCloud", async () => {
  const f = clientFixture();
  await assert.rejects(
    f.client.connect({ ...credentials, appPassword: "main-password" }),
    /app-specific password/,
  );
  await assert.rejects(
    f.client.connect({ ...credentials, email: "bad:user@example.com" }),
    /email address/,
  );
  f.setSecure(false);
  await assert.rejects(f.client.connect(credentials), /Secure storage/);
  assert.equal(f.calls.length, 0);
});

test("account switches pause automatic sync and require a new calendar choice", async () => {
  const f = clientFixture();
  await f.client.connect(credentials);
  await f.client.updateSettings({ calendarId: calendar, autoSync: true });
  f.setUser("coros-2");
  const calls = f.calls.length;
  await f.client.syncIfDue();
  await assert.rejects(f.client.sync(), /paused/);
  assert.equal(f.calls.length, calls);
  await f.client.connect(credentials);
  assert.equal(f.state().calendar, undefined);
  assert.equal(f.client.status().autoSync, false);
});

test("revoked app password clears local credentials and stops automatic sync", async () => {
  const f = clientFixture();
  await f.client.connect(credentials);
  await f.client.updateSettings({ calendarId: calendar, autoSync: true });
  f.rejectAuth();
  await assert.rejects(f.client.sync(), /app-specific password/);
  assert.equal(f.client.status().connected, false);
  assert.equal(f.client.status().autoSync, false);
  assert.equal(f.state().credentials, undefined);
});

test("disconnect cancels a stalled source read and discards its late result", async () => {
  const f = clientFixture();
  await f.client.connect(credentials);
  await f.client.updateSettings({ calendarId: calendar });
  let started, finishRead;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  f.setRead(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
        started();
      }),
  );
  const syncing = f.client.sync();
  const rejected = assert.rejects(syncing, /cancelled/);
  await ready;
  await assert.rejects(f.client.listCalendars(), /already running/);
  await f.client.disconnect();
  await rejected;
  finishRead([workout()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.state(), {});
  assert.equal(f.resources.size, 0);
});

test("source failures and a changed account during network reads never write events", async () => {
  const f = clientFixture();
  await f.client.connect(credentials);
  await f.client.updateSettings({ calendarId: calendar });
  f.setRead(async () => {
    throw new Error("COROS offline");
  });
  await assert.rejects(f.client.sync(), /COROS offline/);
  f.setRead(async () => {
    f.setUser("different");
    return [workout()];
  });
  await assert.rejects(f.client.sync(), /account changed/);
  assert.equal(
    f.calls.filter((call) => ["PUT", "DELETE"].includes(call.method)).length,
    0,
  );
});

const timedPreferences = { mode: "timed", startTime: "18:00", timeZone: "America/Toronto", fallbackDurationMinutes: 60 };
test("Apple timed events migrate in place, preserve moved times, alarms, location and manual duration", async () => {
  const f = serverFixture();
  const entry = {...workout(), rawProgram:{estimatedTime:2700}};
  const input=syncInput(f,[entry]);
  await syncAppleWorkoutEvents(input);
  const href=[...f.resources.keys()][0];
  const timedInput={...input,eventTiming:timedPreferences};
  assert.equal((await syncAppleWorkoutEvents(timedInput)).updated,1);
  assert.equal(f.resources.size,1);
  assert.match(f.resources.get(href).data,/DTSTART:20260904T220000Z/);
  assert.match(f.resources.get(href).data,/DTEND:20260904T224500Z/);
  assert.equal((await syncAppleWorkoutEvents(timedInput)).unchanged,1);
  f.resources.get(href).data=f.resources.get(href).data.replace("DTSTART:20260904T220000Z",'DTSTART;TZID="America/Toronto":20260905T090000').replace("DTEND:20260904T224500Z",'DTEND;TZID="America/Toronto":20260905T094500').replace("END:VEVENT","LOCATION:My gym\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT");
  assert.equal((await syncAppleWorkoutEvents(timedInput)).unchanged,1);
  entry.rawProgram.estimatedTime=3600;
  entry.name="Longer run";
  assert.equal((await syncAppleWorkoutEvents(timedInput)).updated,1);
  assert.match(f.resources.get(href).data,/DTSTART:20260905T130000Z/);
  assert.match(f.resources.get(href).data,/DTEND:20260905T140000Z/);
  assert.match(f.resources.get(href).data,/LOCATION:My gym/);
  assert.match(f.resources.get(href).data,/BEGIN:VALARM\r\nACTION:DISPLAY/);
  f.resources.get(href).data=f.resources.get(href).data.replace("DTEND:20260905T140000Z","DTEND:20260905T143000Z");
  entry.rawProgram.estimatedTime=4500;
  await syncAppleWorkoutEvents(timedInput);
  assert.match(f.resources.get(href).data,/DTEND:20260905T143000Z/);
  assert.equal((await syncAppleWorkoutEvents(timedInput)).unchanged,1);
  entry.happenDay="20260906";
  await syncAppleWorkoutEvents(timedInput);
  assert.match(f.resources.get(href).data,/DTSTART:20260906T220000Z/);
  assert.equal((await syncAppleWorkoutEvents(input)).updated,1);
  assert.match(f.resources.get(href).data,/DTSTART;VALUE=DATE:20260906/);
  assert.doesNotMatch(f.resources.get(href).data,/X-COROSLINK-TIMING/);
  assert.equal((await syncAppleWorkoutEvents(input)).unchanged,1);
});

test("Apple timing settings survive reconnect and are used by sync; invalid input never replaces them", async () => {
  const f=clientFixture();
  await f.client.connect(credentials);
  await f.client.updateSettings({calendarId:calendar});
  await f.client.sync();
  assert.equal(f.client.status().eventTiming.mode,"all-day");
  await f.client.updateSettings({eventTiming:timedPreferences});
  assert.deepEqual(f.state().eventTiming,timedPreferences);
  assert.equal(f.client.status().needsSync,true);
  assert.equal(f.state().lastSyncedAt,undefined);
  await f.client.sync();
  assert.match([...f.resources.values()][0].data,/DTSTART:\d{8}T\d{6}Z/);
  await f.client.connect(credentials);
  assert.deepEqual(f.client.status().eventTiming,timedPreferences);
  await assert.rejects(f.client.updateSettings({eventTiming:{...timedPreferences,fallbackDurationMinutes:0}}),/fallback duration/);
  assert.deepEqual(f.state().eventTiming,timedPreferences);
});

test("Apple accepts duration-based timed events and preserves a move made during a conflicting update", async () => {
  const f = serverFixture();
  const entry = {...workout(),rawProgram:{duration:3600}};
  const input = {...syncInput(f,[entry]),eventTiming:timedPreferences};
  await syncAppleWorkoutEvents(input);
  const href = [...f.resources.keys()][0];
  f.resources.get(href).data = f.resources.get(href).data.replace("DTEND:20260904T230000Z","DURATION:PT1H");
  assert.equal((await syncAppleWorkoutEvents(input)).unchanged,1);
  entry.name="Updated workout";
  f.afterRequest((url,init) => {
    if (init.method !== "PUT") return;
    f.afterRequest(undefined);
    f.resources.set(href,{data:f.resources.get(href).data.replace("DTSTART:20260904T220000Z","DTSTART:20260905T130000Z"),etag:'"moved"'});
  });
  assert.equal((await syncAppleWorkoutEvents(input)).updated,1);
  assert.match(f.resources.get(href).data,/DTSTART:20260905T130000Z/);
  assert.match(f.resources.get(href).data,/DTEND:20260905T140000Z/);
  assert.doesNotMatch(f.resources.get(href).data,/\r\nDURATION:/);
  assert.equal((await syncAppleWorkoutEvents(input)).unchanged,1);
});
