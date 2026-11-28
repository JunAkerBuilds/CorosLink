import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isBeta, notesText, notPublishedYet, problemText, Updates, versionLabel, type Updater } from "./updates";

/** electron-updater's AppUpdater as the service sees it: events, and calls that say what happened. */
function fakeUpdater(script: { check?: (u: FakeUpdater) => void; download?: (u: FakeUpdater) => void } = {}) {
  const u = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: false, channel: null as string | null, allowPrerelease: true, allowDowngrade: true, installed: 0,
    async checkForUpdates(): Promise<{ isUpdateAvailable?: boolean } | null> { u.emit("checking-for-update"); script.check?.(u); return null; },
    async downloadUpdate() { script.download?.(u); return []; },
    quitAndInstall() { u.installed++; },
  });
  return u;
}
type FakeUpdater = ReturnType<typeof fakeUpdater>;

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(path.join(tmpdir(), "clink-updates-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const ask = (updates: Updates, route: string, body?: unknown) =>
  updates.answer(new Request(`clink://app/api/desktop/updates${route}`, body === undefined && route === "" ? {} : { method: "POST", body: JSON.stringify(body ?? {}) })).then((r) => r.json());

describe("Updates", () => {
  it("never looks at prereleases or older versions, and installs on quit", () => {
    const u = fakeUpdater();
    new Updates(dir(), "0.2.0", u as unknown as Updater);
    expect(u.allowPrerelease).toBe(false);
    expect(u.allowDowngrade).toBe(false);
    expect(u.autoInstallOnAppQuit).toBe(true);
  });

  it("checks, downloads by itself and offers a restart", async () => {
    const u = fakeUpdater({
      check: (x) => {
        x.emit("update-available", { version: "0.2.1", releaseDate: "2026-12-01T00:00:00Z", releaseNotes: "<p>Faster <b>sync</b></p><ul><li>One</li></ul>" });
        x.emit("download-progress", { percent: 42.4 });
      },
    });
    const updates = new Updates(dir(), "0.2.0", u as unknown as Updater);
    const checking = await ask(updates, "/check");
    expect(checking).toMatchObject({ phase: "downloading", percent: 42, available: { version: "0.2.1", notes: "Faster sync\n• One" } });
    u.emit("update-downloaded");
    expect(await ask(updates, "")).toMatchObject({ phase: "ready", percent: 100 });
    await ask(updates, "/install");
    expect(u.installed).toBe(1);
  });

  it("waits for a click to download when downloading by itself is off, and remembers that", async () => {
    const data = dir();
    const u = fakeUpdater({ check: (x) => x.emit("update-available", { version: "0.3.0" }), download: (x) => x.emit("update-downloaded") });
    const updates = new Updates(data, "0.2.0", u as unknown as Updater);
    expect((await ask(updates, "/settings", { download: false })).auto).toEqual({ check: true, download: false });
    expect(u.autoDownload).toBe(false);
    expect(JSON.parse(readFileSync(path.join(data, "updates.json"), "utf8"))).toEqual({ check: true, download: false });
    expect((await ask(updates, "/check")).phase).toBe("available");
    await ask(updates, "/download");
    expect((await ask(updates, "")).phase).toBe("ready");
    // Read back on the next launch.
    expect(new Updates(data, "0.2.0", fakeUpdater() as unknown as Updater).state.auto.download).toBe(false);
  });

  it("treats a tag whose release isn't published yet as no update, logs nothing, and lets a beta still ask its track", async () => {
    const missing = () => Object.assign(new Error("Cannot find latest-mac.yml in the latest release artifacts (https://github.com/x/y/releases/download/v0.2.0-clink.4/latest-mac.yml): HttpError: 404"), { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" });
    expect(notPublishedYet(missing())).toBe(true);
    expect(notPublishedYet(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(false);
    const lines: string[] = [];
    const channels: (string | null)[] = [];
    const u = fakeUpdater();
    u.checkForUpdates = async () => {
      u.emit("checking-for-update");
      channels.push(u.channel);
      if (u.channel === "latest") { const e = missing(); u.emit("error", e); throw e; }
      u.emit("update-not-available");
      return null;
    };
    const updates = new Updates(dir(), "0.2.0-clink.3", u as unknown as Updater, (line) => lines.push(line));
    expect(u).toMatchObject({ logger: null });
    expect(await ask(updates, "/check")).toMatchObject({ phase: "none", problem: null });
    expect(channels).toEqual(["latest", "clink"]);
    expect(lines).toEqual([]);
  });

  it("says up to date, and turns failures into plain words", async () => {
    const quiet = fakeUpdater({ check: (x) => x.emit("update-not-available") });
    expect((await ask(new Updates(dir(), "0.2.0", quiet as unknown as Updater), "/check")).phase).toBe("none");
    const broken = fakeUpdater({ check: (x) => x.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED")) });
    const state = await ask(new Updates(dir(), "0.2.0", broken as unknown as Updater), "/check");
    expect(state).toMatchObject({ phase: "failed", problem: "Couldn't reach the update server. Check the connection and try again." });
    expect(problemText(new Error("Cannot find latest-mac.yml in the latest release artifacts (HttpError: 404)"))).toBe("No update is available for this computer yet.");
    expect(problemText(new Error("Code signature at URL file:///… did not pass validation"))).toMatch(/couldn't be verified/);
  });

  it("does nothing in a development build", async () => {
    const updates = new Updates(dir(), "0.1.0", null);
    expect((await ask(updates, "/check")).phase).toBe("unavailable");
  });

  it("a stable build only asks the stable track", async () => {
    const asked: boolean[] = [];
    const asked2: string[] = [];
    const u = fakeUpdater({ check: (x) => { asked.push(x.allowPrerelease); asked2.push(`${x.channel}/${x.allowDowngrade}`); x.emit("update-not-available"); } });
    await ask(new Updates(dir(), "0.2.0", u as unknown as Updater), "/check");
    expect(asked).toEqual([false]);
    expect(asked2).toEqual(["latest/false"]);
  });

  it("a beta asks the stable track first, then its own channel", async () => {
    const asked: boolean[] = [];
    const channels: string[] = [];
    // Nothing newer on the stable track (only CorosLink 0.1.85): the beta channel has 0.2.0-clink.2.
    const u = fakeUpdater({ check: (x) => {
      asked.push(x.allowPrerelease);
      channels.push(`${x.channel}/${x.allowDowngrade}`);
      if (x.allowPrerelease) x.emit("update-available", { version: "0.2.0-clink.2" }); else x.emit("update-not-available");
    } });
    const state = await ask(new Updates(dir(), "0.2.0-clink.1", u as unknown as Updater), "/check");
    expect(asked).toEqual([false, true]);
    expect(channels).toEqual(["latest/false", "clink/false"]);
    expect(state).toMatchObject({ version: "0.2.0 beta 1", phase: "downloading", available: { version: "0.2.0 beta 2" } });
  });

  it("a beta takes the stable C-LINK when there is one", async () => {
    const asked: boolean[] = [];
    const u = fakeUpdater({ check: (x) => { asked.push(x.allowPrerelease); x.emit("update-available", { version: "0.2.0" }); } });
    // The fake answers checkForUpdates with nothing, so say there was an update on the stable track.
    u.checkForUpdates = async () => { u.emit("checking-for-update"); asked.push(u.allowPrerelease); u.emit("update-available", { version: "0.2.0" }); return { isUpdateAvailable: true }; };
    const state = await ask(new Updates(dir(), "0.2.0-clink.4", u as unknown as Updater), "/check");
    expect(asked).toEqual([false]);
    expect(state.available.version).toBe("0.2.0");
  });

  it("labels betas", () => {
    expect(isBeta("0.2.0-clink.3")).toBe(true);
    expect(isBeta("0.2.0")).toBe(false);
    expect(versionLabel("0.2.0-clink.3")).toBe("0.2.0 beta 3");
    expect(versionLabel("0.1.83")).toBe("0.1.83");
  });

  it("reads notes given one entry per version", () => {
    expect(notesText([{ version: "0.2.1", note: "A" }, { version: "0.2.2", note: "B &amp; C" }])).toBe("A\n\nB & C");
  });
});
