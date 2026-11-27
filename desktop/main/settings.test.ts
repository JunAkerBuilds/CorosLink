import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BackupProblem, isSealed, packBackup, unpackBackup } from "./backup";
import { guardSession, savedMode, uploadsToCoros } from "./dataMode";
import { ErrorLog, redact } from "./errorLog";
import { LocalStore } from "./localStore";
import { DesktopSettings, platformLabel } from "./settings";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-settings-"));
const items = [{ collection: "feel.check", id: "2026-11-21", body: { feel: 4, tags: [] } }, { collection: "coach.memory", id: "m1", body: { text: "Goal: sub-3 marathon" } }];

describe("backup", () => {
  it("brings every item back, with or without a passphrase", async () => {
    expect((await unpackBackup(await packBackup(items))).items).toEqual(items);
    const sealed = await packBackup(items, "correct horse");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from("sub-3"))).toBe(false);
    expect((await unpackBackup(sealed, "correct horse")).items).toEqual(items);
  });

  it("refuses a wrong or missing passphrase, a short one, and a file that isn't a backup", async () => {
    const sealed = await packBackup(items, "correct horse");
    await expect(unpackBackup(sealed)).rejects.toBeInstanceOf(BackupProblem);
    await expect(unpackBackup(sealed, "wrong horse!")).rejects.toThrow("doesn't open");
    await expect(packBackup(items, "short")).rejects.toThrow("at least 8");
    await expect(unpackBackup(Buffer.from("hello"))).rejects.toThrow("isn't a C-LINK backup");
  });

  it("restores into a store as it was", async () => {
    const from = new LocalStore(path.join(folder(), "a.db"));
    from.seed(items);
    const into = new LocalStore(path.join(folder(), "b.db"));
    into.seed([{ collection: "feel.check", id: "old", body: { feel: 1 } }]);
    into.replaceWith((await unpackBackup(await packBackup(from.items()))).items);
    expect(into.items()).toEqual(from.items());
  });
});

describe("error log", () => {
  it("takes out home folders and secrets", () => {
    expect(redact("open /Users/ann/Library/x failed", "/Users/ann")).toBe("open ~/Library/x failed");
    expect(redact("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def");
    expect(redact("key=sk-ant-api03-abcdefghijkl")).not.toContain("abcdefghijkl");
    expect(redact('{"token":"clink_local_ZZZZZZZZZZZZ"}')).not.toContain("ZZZZ");
  });

  it("counts repeats, keeps 7 days, and survives a restart", () => {
    let now = Date.UTC(2026, 10, 21, 12);
    const dir = folder();
    const log = new ErrorLog(dir, () => now);
    log.add("app", "Sync failed");
    log.add("app", "Sync failed");
    expect(log.since(1)).toHaveLength(1);
    expect(log.report(1, "C-LINK")).toContain("Sync failed (×2)");
    now += 8 * 24 * 3600_000;
    log.add("screen", "Chart broke");
    expect(new ErrorLog(dir, () => now).since(168).map((e) => e.message)).toEqual(["Chart broke"]);
    log.clear();
    expect(new ErrorLog(dir, () => now).since(168)).toHaveLength(0);
  });
});

describe("Local-Only Mode", () => {
  const u = (s: string) => new URL(s);
  it("stops writes to COROS and its upload bucket, and the start of an upload", () => {
    expect(uploadsToCoros(u("https://teamapi.coros.com/training/schedule/update"), "POST")).toBe(true);
    expect(uploadsToCoros(u("https://teamapi.coros.com/training/program/add"), "POST")).toBe(true);
    // Map areas only ask which map files cover some squares.
    expect(uploadsToCoros(u("https://mapstatic.coros.com/openapi/tileMap/getMapPackage"), "POST")).toBe(false);
    expect(uploadsToCoros(u("https://t.coros.com/api/proxy/oss/sts"), "GET")).toBe(true);
    expect(uploadsToCoros(u("https://coros-s3.s3.us-west-2.amazonaws.com/fit_zip/1/x.zip"), "PUT")).toBe(true);
  });
  it("lets reads and signing in through", () => {
    expect(uploadsToCoros(u("https://teamapi.coros.com/activity/query?size=20"), "GET")).toBe(false);
    expect(uploadsToCoros(u("https://teamapi.coros.com/training/program/query"), "POST")).toBe(false);
    expect(uploadsToCoros(u("https://teamapi.coros.com/account/login"), "POST")).toBe(false);
    expect(uploadsToCoros(u("https://api.open-meteo.com/v1/forecast"), "GET")).toBe(false);
    expect(uploadsToCoros(u("https://api.anthropic.com/v1/messages"), "POST")).toBe(false);
    // Studio's COROS account: the mobile sign-in and the face lists are reads.
    expect(uploadsToCoros(u("https://apieu.coros.com/coros/user/login"), "POST")).toBe(false);
    expect(uploadsToCoros(u("https://api.coros.com/coros/watchface/getWatchFaceThemeList?accessToken=t"), "POST")).toBe(false);
    expect(uploadsToCoros(u("https://api.coros.com/coros/watchfaceTemplate/query?accessToken=t"), "POST")).toBe(false);
  });
  it("still stops sending a watch face to COROS", () => {
    expect(uploadsToCoros(u("https://api.coros.com/coros/watchfaceTemplate/userCustom/save"), "POST")).toBe(true);
    expect(uploadsToCoros(u("https://api.coros.com/coros/watchface/createLink"), "POST")).toBe(true);
    // Send to COROS (corosShare.ts): the upload and the share link, on every region's host.
    for (const host of ["api.coros.com", "apieu.coros.com", "apicn.coros.com", "apisg.coros.com"]) {
      expect(uploadsToCoros(u(`https://${host}/coros/watchFaceTemplateUserCustom/saveOrUpdateV2?accessToken=t`), "POST")).toBe(true);
      expect(uploadsToCoros(u(`https://${host}/coros/watchface/share/createLink?accessToken=t`), "POST")).toBe(true);
    }
  });
  // Must not regress (CorosLink replacement checklist): if the mode file can't be read, the app is local-only.
  it("starts in Local-Only Mode when the settings file is damaged", () => {
    expect(savedMode(null)).toEqual({ dataMode: "connected", damaged: false });
    expect(savedMode('{"dataMode":"connected"}').dataMode).toBe("connected");
    expect(savedMode('{"dataMode":"localOnly"}').dataMode).toBe("localOnly");
    for (const raw of ["", "{", "null", '{"dataMode":"cloud"}', "[]"]) expect(savedMode(raw)).toEqual({ dataMode: "localOnly", damaged: true });
  });
  it("holds for the window's own requests too", () => {
    let listener: (d: { url: string; method: string }, cb: (a: { cancel: boolean }) => void) => void = () => undefined;
    const blocked: string[] = [];
    let on = true;
    guardSession({ webRequest: { onBeforeRequest: (_f, l) => { listener = l; } } }, () => on, (b) => blocked.push(b.target));
    const ask = (url: string, method: string) => { let cancel: boolean | undefined; listener({ url, method }, (a) => { cancel = a.cancel; }); return cancel; };
    expect(ask("https://teamapi.coros.com/training/program/add", "POST")).toBe(true);
    expect(ask("https://teamapi.coros.com/activity/query", "GET")).toBe(false);
    on = false;
    expect(ask("https://teamapi.coros.com/training/program/add", "POST")).toBe(false);
    expect(blocked).toEqual(["teamapi.coros.com/training/program/add"]);
  });
});

describe("settings file", () => {
  const host = (store: LocalStore | null = null) => ({
    version: "1", store: () => store, saveDialog: async () => null, openDialog: async () => null, reveal: () => undefined,
    restored: () => undefined, confirm: async () => false, lastPhoneSync: () => null, modeChanged: () => undefined, languageChanged: () => undefined,
    usageChanged: () => undefined, sendReport: async () => ({ reference: "R" }),
  });
  const ask = (s: DesktopSettings, body?: object) => s.answer(new Request("clink://app/api/desktop/settings", body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})).then((r) => r.json() as Promise<{ dataMode: string; local: unknown }>);

  it("fails closed, keeps the mode across a restart, and asks before turning it off", async () => {
    const dir = folder();
    writeFileSync(path.join(dir, "settings.json"), "{ not json");
    const damaged = new DesktopSettings(dir, new ErrorLog(dir), host());
    expect((await ask(damaged)).dataMode).toBe("localOnly");
    // Turning it off waits for the dialog: here the answer is Cancel.
    expect((await ask(damaged, { dataMode: "connected" })).dataMode).toBe("localOnly");
    expect(JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8")).dataMode).toBe("localOnly");
    expect(existsSync(path.join(dir, "settings.json.tmp"))).toBe(false);
    const yes = new DesktopSettings(dir, new ErrorLog(dir), { ...host(), confirm: async () => true });
    expect((await ask(yes, { dataMode: "connected" })).dataMode).toBe("connected");
    expect((await ask(new DesktopSettings(dir, new ErrorLog(dir), host()))).dataMode).toBe("connected");
  });

  it("sends nothing until the privacy question is answered, then only what was chosen, and never in Local mode", async () => {
    const answer = (s: DesktopSettings, body: object) => s.answer(new Request("clink://app/api/desktop/settings/privacy",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).then((r) => r.json() as Promise<{ privacy: string; usage: boolean; crashReports: boolean }>);
    const dir = folder();
    const changes: boolean[] = [];
    const s = new DesktopSettings(dir, new ErrorLog(dir), { ...host(), usageChanged: (on) => changes.push(on) });
    // A new install: both off and the question still to answer.
    expect(s.usageAllowed).toBe(false);
    expect(s.crashesAllowed).toBe(false);
    expect((await ask(s)) as unknown).toMatchObject({ privacy: "pending", usage: false, crashReports: false });
    // Turning a switch on in Settings before answering still sends nothing.
    await ask(s, { usage: true });
    expect(s.usageAllowed).toBe(false);
    // Answered: usage counts yes, crash reports no.
    expect(await answer(s, { usage: true, crashReports: false })).toMatchObject({ privacy: "seen", usage: true, crashReports: false });
    expect(s.usageAllowed).toBe(true);
    expect(s.crashesAllowed).toBe(false);
    const again = new DesktopSettings(dir, new ErrorLog(dir), host());
    expect([again.usageAllowed, again.crashesAllowed]).toEqual([true, false]);
    expect(((await ask(s, { usage: false })) as unknown as { usage: boolean }).usage).toBe(false);
    expect(changes.at(-1)).toBe(false);
    expect(new DesktopSettings(dir, new ErrorLog(dir), host()).usageAllowed).toBe(false);
    // An install from before the question, with both saved on: off until it's answered.
    const old = folder();
    writeFileSync(path.join(old, "settings.json"), JSON.stringify({ dataMode: "connected", blocked: [], intro: "seen", usage: true, crashReports: true }));
    const before = new DesktopSettings(old, new ErrorLog(old), host());
    expect([before.introPending, before.usageAllowed, before.crashesAllowed]).toEqual([false, false, false]);
    expect(await before.answer(new Request("clink://app/api/desktop/settings/intro")).then((r) => r.json())).toEqual({ intro: "seen", privacy: "pending" });
    const local = folder();
    writeFileSync(path.join(local, "settings.json"), JSON.stringify({ dataMode: "localOnly", blocked: [], privacy: "seen", usage: true, crashReports: true }));
    const l = new DesktopSettings(local, new ErrorLog(local), host());
    expect([l.usageAllowed, l.crashesAllowed]).toEqual([false, false]);
  });

  it("keeps the release whose What's new was last shown", async () => {
    const whatsNew = (s: DesktopSettings, body?: object) => s.answer(new Request("clink://app/api/desktop/settings/whats-new", body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})).then((r) => r.json() as Promise<{ shown: string }>);
    const dir = folder();
    expect((await whatsNew(new DesktopSettings(dir, new ErrorLog(dir), host()))).shown).toBe("");
    expect((await whatsNew(new DesktopSettings(dir, new ErrorLog(dir), host()), { shown: "0.2.0-clink.4" })).shown).toBe("0.2.0-clink.4");
    expect((await whatsNew(new DesktopSettings(dir, new ErrorLog(dir), host()))).shown).toBe("0.2.0-clink.4");
    expect((await whatsNew(new DesktopSettings(dir, new ErrorLog(dir), host()), { shown: "x".repeat(65) })).shown).toBe("0.2.0-clink.4");
  });

  it("counts what phones synced here", async () => {
    const dir = folder();
    const store = new LocalStore(path.join(dir, "clink.db"));
    store.seed([...items, { collection: "activity", id: "a1", body: {} }, { collection: "health.day", id: "d1", body: {} }, { collection: "health.day", id: "d2", body: {} }]);
    const s = new DesktopSettings(dir, new ErrorLog(dir), { ...host(store), lastPhoneSync: () => "2026-11-22T08:00:00.000Z" });
    expect((await ask(s)).local).toMatchObject({ activities: 1, healthDays: 2, lastPhoneSync: "2026-11-22T08:00:00.000Z" });
  });

  it("shows the intro on the first launch only, until the athlete goes on, and again when asked", async () => {
    const intro = (s: DesktopSettings, body?: object) => s.answer(new Request("clink://app/api/desktop/settings/intro", body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})).then((r) => r.json() as Promise<{ intro: string }>);
    const dir = folder();
    const first = new DesktopSettings(dir, new ErrorLog(dir), host());
    expect(first.introPending).toBe(true);
    // Quitting during the intro: it shows again.
    expect(new DesktopSettings(dir, new ErrorLog(dir), host()).introPending).toBe(true);
    expect((await intro(first, { intro: "seen" })).intro).toBe("seen");
    expect(new DesktopSettings(dir, new ErrorLog(dir), host()).introPending).toBe(false);
    expect((await intro(new DesktopSettings(dir, new ErrorLog(dir), host(), { replayIntro: true }))).intro).toBe("pending");
    // A settings file from before the intro existed: an existing install, which skips it.
    const old = folder();
    writeFileSync(path.join(old, "settings.json"), JSON.stringify({ dataMode: "connected", blocked: [] }));
    expect(new DesktopSettings(old, new ErrorLog(old), host()).introPending).toBe(false);
  });
});

describe("the platform in About", () => {
  it("names Windows 11 by its build, not the 10.0 it reports", () => {
    expect(platformLabel("win32", "x64", "10.0.26300")).toBe("Windows 11 (build 26300)");
    expect(platformLabel("win32", "x64", "10.0.19045")).toBe("Windows 10 (build 19045)");
    expect(platformLabel("darwin", "arm64", "25.0.0")).toBe("macOS · Apple silicon");
    expect(platformLabel("linux", "x64", "6.8.0")).toBe("Linux 6.8.0");
  });
});
