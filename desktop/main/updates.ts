// C-LINK's own updates, answered at /api/desktop/updates for Settings → About C-LINK. electron-updater reads the
// same feed CorosLink used (package.json build.publish: GitHub releases of JunAkerBuilds/CorosLink), so C-LINK keeps
// updating where CorosLink did. It only ever sees published releases: drafts are invisible to it.
//
// Two tracks share the feed (docs/releases.md). Normal releases (`v0.2.0`, and CorosLink's own `v0.1.8x`) are what
// everyone gets. C-LINK betas are GitHub prereleases tagged `v0.2.0-clink.N` with `clink-mac.yml`, which only
// CorosLink installs that opted in (electron-updater channel "clink") and C-LINK betas follow. A stable build never
// looks at prereleases; a beta build checks the stable track first, so it moves to the stable C-LINK once there is
// one, then the next beta.
//
// Packaged builds only: a development build has no feed (app-update.yml) to read. Checking and downloading can each
// be switched off; a downloaded update installs when the app quits, or at once with "Restart to update".
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The part of electron-updater's AppUpdater used here (structural, so tests need no Electron). */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  /** Setting it also turns allowDowngrade on (electron-updater), so that is set again after. */
  channel: string | null;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean } | null | undefined>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export type UpdatePhase = "unavailable" | "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "failed";

export interface UpdateState {
  version: string;
  phase: UpdatePhase;
  /** The newer version found, its date and its notes as plain text. */
  available: { version: string; date: string | null; notes: string } | null;
  /** Download progress, 0–100. */
  percent: number | null;
  problem: string | null;
  checkedAt: number | null;
  auto: { check: boolean; download: boolean };
}

interface Saved { check: boolean; download: boolean }

const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 6 * 3600_000;
const MAX_NOTES = 4000;

/** Whether a version is a beta ("0.2.0-clink.3"). */
export const isBeta = (version: string): boolean => /^\d+\.\d+\.\d+-/.test(version);

/** A version as people read it: "0.2.0 beta 3" for "0.2.0-clink.3". */
export function versionLabel(version: string): string {
  const m = /^(\d+\.\d+\.\d+)-clink\.(\d+)$/.exec(version);
  return m ? `${m[1]} beta ${m[2]}` : version;
}

/** Release notes as plain text: electron-updater gives HTML, or one entry per version. */
export function notesText(notes: unknown): string {
  const raw = Array.isArray(notes)
    ? notes.map((n) => (n && typeof n === "object" && "note" in n ? String((n as { note: unknown }).note ?? "") : "")).join("\n\n")
    : typeof notes === "string" ? notes : "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d)>/gi, "\n").replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_NOTES);
}

/** What the person reads when a check or download fails: never a raw stack or URL with tokens. */
export function problemText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_|getaddrinfo|network/i.test(text)) return "Couldn't reach the update server. Check the connection and try again.";
  if (/code signature|signature|codesign/i.test(text)) return "The update couldn't be verified, so it wasn't installed. Download it from the CorosLink releases page.";
  if (/404|latest-mac\.yml|latest\.yml|latest-linux\.yml|Cannot find/i.test(text)) return "No update is available for this computer yet.";
  return "The update didn't work. Try again later.";
}

export class Updates {
  private saved: Saved = { check: true, download: true };
  private readonly file: string;
  private phase: UpdatePhase;
  private available: UpdateState["available"] = null;
  private percent: number | null = null;
  private problem: string | null = null;
  private checkedAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(data: string, private readonly version: string, private readonly updater: Updater | null, private readonly log: (line: string) => void = () => {}) {
    this.file = path.join(data, "updates.json");
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved>;
      if (typeof parsed.check === "boolean") this.saved.check = parsed.check;
      if (typeof parsed.download === "boolean") this.saved.download = parsed.download;
    } catch { /* first run: both on */ }
    this.phase = updater ? "idle" : "unavailable";
    if (!updater) return;
    updater.autoDownload = this.saved.download;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on("checking-for-update", () => { this.phase = "checking"; this.problem = null; });
    updater.on("update-not-available", () => { this.phase = "none"; this.checkedAt = Date.now(); });
    updater.on("update-available", (info) => {
      const i = (info ?? {}) as { version?: unknown; releaseDate?: unknown; releaseNotes?: unknown };
      this.available = { version: versionLabel(String(i.version ?? "")), date: typeof i.releaseDate === "string" ? i.releaseDate : null, notes: notesText(i.releaseNotes) };
      this.checkedAt = Date.now();
      this.phase = this.saved.download ? "downloading" : "available";
      this.percent = this.saved.download ? 0 : null;
    });
    updater.on("download-progress", (progress) => {
      const p = Number((progress as { percent?: unknown } | undefined)?.percent);
      this.phase = "downloading";
      this.percent = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : this.percent;
    });
    updater.on("update-downloaded", () => { this.phase = "ready"; this.percent = 100; });
    updater.on("error", (error) => {
      this.problem = problemText(error);
      this.phase = "failed";
      this.log(`Update ${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}`);
    });
  }

  /** Checks shortly after launch and every six hours, while checking is on. */
  start(): void {
    if (!this.updater) return;
    setTimeout(() => { if (this.saved.check) void this.check(); }, FIRST_CHECK_MS).unref?.();
    this.timer = setInterval(() => { if (this.saved.check && this.phase !== "downloading" && this.phase !== "ready") void this.check(); }, EVERY_MS);
    this.timer.unref?.();
  }

  get state(): UpdateState {
    return { version: versionLabel(this.version), phase: this.phase, available: this.available, percent: this.percent, problem: this.problem, checkedAt: this.checkedAt, auto: { ...this.saved } };
  }

  async check(): Promise<void> {
    if (!this.updater || this.phase === "checking" || this.phase === "downloading" || this.phase === "ready") return;
    this.phase = "checking";
    this.problem = null;
    try {
      // A beta first asks the stable track (never a prerelease) so it moves to the stable C-LINK once there is one,
      // then its own channel (the version's "clink" prerelease id). A stable build only ever asks the stable track.
      // The channel is set every time: a beta's own app-update.yml says "clink", which would make the stable check
      // look for clink-mac.yml in a normal release.
      this.track("latest", false);
      const stable = await this.updater.checkForUpdates();
      if (isBeta(this.version) && !stable?.isUpdateAvailable) {
        this.track("clink", true);
        this.phase = "checking";
        await this.updater.checkForUpdates();
      }
    } catch (error) {
      this.problem = problemText(error);
      this.phase = "failed";
    }
  }

  private track(channel: "latest" | "clink", prerelease: boolean): void {
    if (!this.updater) return;
    this.updater.channel = channel;
    this.updater.allowPrerelease = prerelease;
    this.updater.allowDowngrade = false;
  }

  async download(): Promise<void> {
    if (!this.updater || this.phase !== "available") return;
    this.phase = "downloading";
    this.percent = 0;
    try { await this.updater.downloadUpdate(); } catch (error) {
      this.problem = problemText(error);
      this.phase = "failed";
    }
  }

  install(): void {
    if (this.updater && this.phase === "ready") this.updater.quitAndInstall(false, true);
  }

  setAuto(change: Partial<Saved>): void {
    if (typeof change.check === "boolean") this.saved.check = change.check;
    if (typeof change.download === "boolean") this.saved.download = change.download;
    if (this.updater) this.updater.autoDownload = this.saved.download;
    const temp = `${this.file}.tmp`;
    try { writeFileSync(temp, JSON.stringify(this.saved)); renameSync(temp, this.file); } catch (error) { this.log(`Update settings weren't saved: ${String(error)}`); }
  }

  async answer(request: Request): Promise<Response> {
    const route = new URL(request.url).pathname.slice("/api/desktop/updates".length) || "/";
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method === "GET" && route === "/") return json(this.state);
    if (request.method !== "POST") return json({ error: { code: "notFound", message: "Not an update action." } }, 404);
    switch (route) {
      case "/check": await this.check(); return json(this.state);
      case "/download": void this.download(); return json(this.state);
      case "/install": this.install(); return json(this.state);
      case "/settings": {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        this.setAuto({ check: typeof body.check === "boolean" ? body.check : undefined, download: typeof body.download === "boolean" ? body.download : undefined });
        return json(this.state);
      }
      default: return json({ error: { code: "notFound", message: "Not an update action." } }, 404);
    }
  }
}
