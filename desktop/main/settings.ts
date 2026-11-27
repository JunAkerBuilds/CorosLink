// The desktop's own settings (Settings page, desktop/renderer/pages/Settings.tsx), answered at /api/desktop/settings:
// the data mode and what it stopped (settings.json), backups, storage, error logs and the build. Shared preferences
// (sidebar, activity colours, theme) stay where the web code keeps them, in the page.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import path from "node:path";
import { BackupProblem, isSealed, packBackup, unpackBackup } from "./backup";
import { guardFetch, savedMode, type Blocked, type DataMode } from "./dataMode";
import type { ErrorLog } from "./errorLog";
import type { LocalStore } from "./localStore";
import { isLang, msg, t, type Lang } from "@/lib/i18n";

/**
 * `intro`: the first-run intro (desktop/renderer/pages/Intro.tsx). "pending" on the very first launch (no settings
 * file yet, as when CorosLink's users first open C-LINK) until the athlete leaves it for the app; a settings file
 * from before the intro existed counts as "seen".
 */
/**
 * `usage`: whether the daily anonymous check-in goes out (usage.ts). `crashReports`: whether crashes are sent to the
 * developer on their own (reports.ts). Nothing is sent until the athlete answers the privacy question (`privacy`, in
 * the intro or, for an install from before it, a window of its own), where usage counts start on and crash reports
 * off (pages/Intro.tsx); changed after in Privacy.
 */
/** `whatsNew`: the release whose What's new sheet was last shown (desktop/renderer/whatsNew.ts); "" for none yet. */
interface Saved { dataMode: DataMode; blocked: Blocked[]; intro: "pending" | "seen"; privacy: "pending" | "seen"; language: Lang; usage: boolean; crashReports: boolean; whatsNew: string }

/** What the main process lends the settings: dialogs and the file manager come from Electron. */
export interface SettingsHost {
  version: string;
  /** The data on this computer (never the sample athlete's). */
  store: () => LocalStore | null;
  saveDialog: (name: string) => Promise<string | null>;
  openDialog: () => Promise<string | null>;
  reveal: (target: string) => void;
  /** After a restore: the window starts over on the restored data. */
  restored: () => void;
  /** Asks before uploads to COROS are allowed again (a native dialog, so the page alone can't turn the guard off). */
  confirm: (message: string, detail: string, button: string) => Promise<boolean>;
  /** When phones last synced here, if any is paired. */
  lastPhoneSync: () => string | null;
  /** Local mode turned on or off: the watch links or lets go (watch/service.ts). */
  modeChanged: (mode: DataMode) => void;
  /** The page's language changed (or was first told): the menu and the main process's own lines follow it. */
  languageChanged: (lang: Lang) => void;
  /** Usage counts turned on or off in Privacy. */
  usageChanged: (on: boolean) => void;
  /** Sends the error log to the developer (reports.ts). */
  sendReport: (input: { note: string; contact: string; hours: number }) => Promise<{ reference: string } | { failed: "offline" | "refused" | "unavailable" }>;
}

/** What the guard stops, for the Electron sessions too (main.ts). */
export interface ModeGuard { localOnly: () => boolean; blocked: (b: Blocked) => void }

const MAX_BLOCKED = 100;
const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };
const ARCH: Record<string, string> = { arm64: "Apple silicon", x64: "Intel" };

/**
 * The system as people know it: "macOS · Apple silicon", "Windows 11 (build 26300)", "Linux 6.8.0". Windows 11 still
 * reports itself as 10.0 (`os.release()` "10.0.26300"); build 22000 and up is Windows 11.
 */
export function platformLabel(platform: string, arch: string, osRelease: string): string {
  if (platform === "darwin") return `macOS · ${ARCH[arch] ?? arch}`;
  if (platform === "win32") {
    const build = Number(osRelease.split(".")[2]);
    if (osRelease.startsWith("10.0.") && Number.isFinite(build)) return `Windows ${build >= 22_000 ? 11 : 10} (build ${build})`;
    return `Windows ${osRelease}`;
  }
  return `${PLATFORM[platform] ?? platform} ${osRelease}`;
}

/** Every place the app keeps something, as Settings → Storage lists them. Paths are inside the data folder. */
const PLACES = [
  { id: "data", label: msg("Your data"), paths: ["clink.db", "clink.db-wal", "clink.db-shm"] },
  { id: "phones", label: msg("Phone pairing"), paths: ["phones.db", "phones.db-wal", "phones.db-shm"] },
  { id: "sample", label: msg("Sample data"), paths: ["sample.db", "sample.db-wal", "sample.db-shm", "sample.json"] },
  { id: "media", label: msg("Music library"), paths: ["media"] },
  { id: "ai", label: msg("AI helpers"), paths: ["antigravity", "claude-coach", "gemini-coach", "opencode-coach", "ai.json", "ai-secrets.bin"] },
  { id: "logs", label: msg("Error logs"), paths: ["logs"] },
  { id: "cache", label: msg("Window cache"), paths: ["Cache", "Code Cache", "GPUCache", "GPUPersistentCache", "DawnGraphiteCache", "DawnWebGPUCache", "GraphiteDawnCache", "Shared Dictionary"] },
] as const;

async function sizeOf(target: string): Promise<number> {
  const info = await stat(target).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  const names = await readdir(target).catch(() => [] as string[]);
  let total = 0;
  for (const name of names) total += await sizeOf(path.join(target, name));
  return total;
}

const tilde = (p: string) => (p.startsWith(homedir()) ? "~" + p.slice(homedir().length) : p);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const problem = (message: string, code = "problem", status = 400) => json({ error: { code, message } }, status);

export class DesktopSettings {
  private readonly file: string;
  private saved: Saved = { dataMode: "connected", blocked: [], intro: "seen", privacy: "pending", language: "en", usage: false, crashReports: false, whatsNew: "" };

  readonly guard: ModeGuard = {
    localOnly: () => this.saved.dataMode === "localOnly",
    blocked: (b) => { this.saved.blocked = [...this.saved.blocked, b].slice(-MAX_BLOCKED); this.save(); },
  };

  /**
   * `replayIntro` (CLINK_INTRO=1, development): shows the intro again on this launch. `skipIntro` (smoke runs, which
   * open /welcome themselves when they want it): goes straight to the app.
   */
  constructor(private readonly folder: string, private readonly log: ErrorLog, private readonly host: SettingsHost, options: { replayIntro?: boolean; skipIntro?: boolean } = {}) {
    this.file = path.join(folder, "settings.json");
    let raw: string | null = null;
    try { raw = existsSync(this.file) ? readFileSync(this.file, "utf8") : null; } catch { raw = ""; }
    const { dataMode, damaged } = savedMode(raw);
    this.saved.dataMode = dataMode;
    if (raw === null) { this.saved.intro = "pending"; this.save(); }
    if (damaged) { log.add("app", "Settings couldn't be read, so Local mode is on."); this.save(); }
    else if (raw) {
      const parsed = JSON.parse(raw) as Partial<Saved>;
      if (Array.isArray(parsed.blocked)) this.saved.blocked = parsed.blocked.slice(-MAX_BLOCKED);
      if (parsed.intro === "pending") this.saved.intro = "pending";
      if (isLang(parsed.language)) this.saved.language = parsed.language;
      if (typeof parsed.whatsNew === "string") this.saved.whatsNew = parsed.whatsNew.slice(0, 64);
      // Only an answer to the privacy question turns either on; a file from before it was asked keeps both off.
      if (parsed.privacy === "seen") {
        this.saved.privacy = "seen";
        this.saved.usage = parsed.usage === true;
        this.saved.crashReports = parsed.crashReports === true;
      }
    }
    if (options.replayIntro) this.saved.intro = "pending";
    else if (options.skipIntro) { this.saved.intro = "seen"; this.saved.privacy = "seen"; }
    guardFetch(this.guard.localOnly, this.guard.blocked);
  }

  /** The language the page last said it speaks, so the menu starts in it before the page loads. */
  get language(): Lang { return this.saved.language; }

  /** Whether the daily usage check-in may go out: turned on, and not in Local mode. */
  get usageAllowed(): boolean { return this.saved.privacy === "seen" && this.saved.usage && this.saved.dataMode !== "localOnly"; }

  /** Whether crashes are sent on their own: turned on, and not in Local mode. */
  get crashesAllowed(): boolean { return this.saved.privacy === "seen" && this.saved.crashReports && this.saved.dataMode !== "localOnly"; }

  /** Whether the first-run intro still shows before the app. */
  get introPending(): boolean { return this.saved.intro === "pending"; }

  /** Written whole to a temporary file, then moved over the old one, so a crash never leaves half a file. */
  private save(): void {
    const temp = `${this.file}.tmp`;
    try { writeFileSync(temp, JSON.stringify(this.saved, null, 2)); renameSync(temp, this.file); } catch (error) { this.log.add("app", `Settings weren't saved: ${String(error)}`); }
  }

  get about() {
    return {
      version: this.host.version,
      platform: platformLabel(process.platform, process.arch, release()),
      electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
    };
  }

  private state() {
    return { dataMode: this.saved.dataMode, blocked: this.saved.blocked.slice().reverse(), about: this.about, local: this.local(), intro: this.saved.intro, privacy: this.saved.privacy, usage: this.saved.usage, crashReports: this.saved.crashReports };
  }

  /** What Privacy → Local data counts: what phones have synced here. */
  private local() {
    const store = this.host.store();
    if (!store) return null;
    let bytes = 0;
    for (const name of ["clink.db", "clink.db-wal"]) { try { bytes += statSync(path.join(this.folder, name)).size; } catch { /* not there */ } }
    return { activities: store.count("activity"), healthDays: store.count("health.day"), lastPhoneSync: this.host.lastPhoneSync(), bytes };
  }

  /** Turns Local mode on (CorosLink ran Local-Only: coroslink/move.ts). Entering it needs no question. */
  enterLocalMode(): Promise<void> { return this.setMode("localOnly"); }

  private async setMode(mode: DataMode): Promise<void> {
    if (mode === this.saved.dataMode) return;
    // Leaving asks in a native dialog, so the page alone can't turn the guard off. No restart: the guard reads the
    // mode on every request (dataMode.ts).
    if (mode === "connected" && !(await this.host.confirm(
      t("Leave Local mode?"),
      t("C-LINK stops syncing with the watch, and workouts and plans can be saved to your COROS account again. Pair the watch with the COROS app or C-LINK on your phone to use it there. What's on this computer stays here."),
      t("Leave Local Mode"),
    ))) return;
    this.saved.dataMode = mode;
    this.save();
    this.host.modeChanged(mode);
  }

  async answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname.slice("/api/desktop/settings".length) || "/";
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    try {
      switch (`${request.method} ${route}`) {
        case "GET /": return json(this.state());
        case "POST /": {
          if (body.dataMode === "connected" || body.dataMode === "localOnly") await this.setMode(body.dataMode);
          this.choose(body);
          return json(this.state());
        }
        // The privacy question's answer (the intro, or its own window): both switches at once, and it isn't asked again.
        case "POST /privacy": {
          this.saved.privacy = "seen";
          this.choose({ usage: body.usage === true, crashReports: body.crashReports === true }, true);
          return json(this.state());
        }
        // The intro: "seen" once the athlete goes on to the app; "pending" shows it again (Developer page).
        case "GET /intro": return json({ intro: this.saved.intro, privacy: this.saved.privacy });
        case "POST /intro": {
          if (body.intro === "seen" || body.intro === "pending") { this.saved.intro = body.intro; this.save(); }
          return json({ intro: this.saved.intro });
        }
        // The What's new sheet: the release it last showed, set when it opens; "" shows it again (Developer page).
        case "GET /whats-new": return json({ shown: this.saved.whatsNew });
        case "POST /whats-new": {
          if (typeof body.shown === "string" && body.shown.length <= 64 && body.shown !== this.saved.whatsNew) { this.saved.whatsNew = body.shown; this.save(); }
          return json({ shown: this.saved.whatsNew });
        }
        // The page says which language it speaks on every load (desktop/renderer/main.tsx).
        case "POST /language": {
          if (isLang(body.language)) {
            if (body.language !== this.saved.language) { this.saved.language = body.language; this.save(); }
            this.host.languageChanged(body.language);
          }
          return json({ language: this.saved.language });
        }
        case "POST /blocked/clear": this.saved.blocked = []; this.save(); return json(this.state());
        case "GET /storage": return json({ folder: tilde(this.folder), places: await this.places() });
        case "POST /storage/open": return this.open(String(body.id ?? ""));
        case "GET /logs": {
          const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours")) || 24));
          const a = this.about;
          return json({ count: this.log.since(hours).length, report: this.log.report(hours, `C-LINK ${a.version} · ${a.platform} · Electron ${a.electron}`) });
        }
        case "POST /logs/send": {
          const hours = Math.min(168, Math.max(1, Number(body.hours) || 24));
          const sent = await this.host.sendReport({ note: String(body.note ?? ""), contact: String(body.contact ?? ""), hours });
          if ("reference" in sent) return json(sent);
          return problem(sent.failed === "offline" ? t("C-LINK couldn't reach the server. Check the connection and try again.")
            : sent.failed === "refused" ? t("The report wasn't taken. Check the email address.")
            : t("Reports can't be sent right now. Try again later."), sent.failed, 502);
        }
        case "POST /logs/clear": this.log.clear(); return json({ count: 0 });
        case "POST /backup/export": return await this.exportBackup(typeof body.passphrase === "string" ? body.passphrase : "");
        case "POST /backup/restore": return await this.restoreBackup(typeof body.passphrase === "string" ? body.passphrase : "");
        default: return problem(t("Not a setting."), "notFound", 404);
      }
    } catch (error) {
      if (error instanceof BackupProblem) return problem(error.message, error.code);
      this.log.add("app", `Settings ${route} failed: ${String(error)}`);
      return problem(t("That didn't work."), "internal", 500);
    }
  }

  /** Usage counts and crash reports turned on or off; the check-in starts or forgets its ID when usage changes. */
  private choose(body: Record<string, unknown>, answered = false): void {
    const usage = typeof body.usage === "boolean" && body.usage !== this.saved.usage ? body.usage : null;
    if (usage !== null) this.saved.usage = usage;
    if (typeof body.crashReports === "boolean") this.saved.crashReports = body.crashReports;
    if (usage !== null || typeof body.crashReports === "boolean" || answered) this.save();
    if (usage !== null || (answered && this.saved.usage)) this.host.usageChanged(this.saved.usage);
  }

  private async places() {
    const places = await Promise.all(PLACES.map(async (p) => {
      const found = p.paths.map((name) => path.join(this.folder, name)).filter((f) => existsSync(f));
      const bytes = (await Promise.all(found.map(sizeOf))).reduce((a, b) => a + b, 0);
      return { id: p.id, label: t(p.label), path: tilde(found[0] ?? path.join(this.folder, p.paths[0])), bytes: found.length ? bytes : null };
    }));
    return [...places, { id: "folder", label: t("App data folder"), path: tilde(this.folder) + "/", bytes: await sizeOf(this.folder) }];
  }

  private open(id: string): Response {
    if (id === "folder") { this.host.reveal(this.folder); return json({ opened: true }); }
    const place = PLACES.find((p) => p.id === id);
    const found = place?.paths.map((name) => path.join(this.folder, name)).find((f) => existsSync(f));
    if (!found) return problem(t("Nothing is kept there yet."), "missing", 404);
    this.host.reveal(found);
    return json({ opened: true });
  }

  private async exportBackup(passphrase: string): Promise<Response> {
    const store = this.host.store();
    if (!store) return problem(t("There is no data on this computer to back up."), "noStore");
    const file = await packBackup(store.items(), passphrase);
    const day = new Date().toISOString().slice(0, 10);
    const target = await this.host.saveDialog(t("C-LINK backup {day}", { day }) + ".clinkbackup");
    if (!target) return json({ cancelled: true });
    await writeFile(target, file, { mode: 0o600 });
    return json({ saved: path.basename(target), items: store.size, sealed: !!passphrase });
  }

  private async restoreBackup(passphrase: string): Promise<Response> {
    const store = this.host.store();
    if (!store) return problem(t("There is no store on this computer to restore into."), "noStore");
    const source = await this.host.openDialog();
    if (!source) return json({ cancelled: true });
    const file = await readFile(source);
    if (isSealed(file) && !passphrase) return problem(t("This backup has a passphrase. Type it in, then restore again."), "passphrase");
    const { items } = await unpackBackup(file, passphrase);
    store.replaceWith(items);
    this.host.restored();
    return json({ restored: items.length });
  }
}
