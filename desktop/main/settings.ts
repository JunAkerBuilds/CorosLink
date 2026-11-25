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

/**
 * `intro`: the first-run intro (desktop/renderer/pages/Intro.tsx). "pending" on the very first launch (no settings
 * file yet, as when CorosLink's users first open C-LINK) until the athlete leaves it for the app; a settings file
 * from before the intro existed counts as "seen".
 */
interface Saved { dataMode: DataMode; blocked: Blocked[]; intro: "pending" | "seen" }

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
}

/** What the guard stops, for the Electron sessions too (main.ts). */
export interface ModeGuard { localOnly: () => boolean; blocked: (b: Blocked) => void }

const MAX_BLOCKED = 100;
const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };
const ARCH: Record<string, string> = { arm64: "Apple silicon", x64: "Intel" };

/** Every place the app keeps something, as Settings → Storage lists them. Paths are inside the data folder. */
const PLACES = [
  { id: "data", label: "Your data", paths: ["clink.db", "clink.db-wal", "clink.db-shm"] },
  { id: "phones", label: "Phone pairing", paths: ["phones.db", "phones.db-wal", "phones.db-shm"] },
  { id: "sample", label: "Sample data", paths: ["sample.db", "sample.db-wal", "sample.db-shm", "sample.json"] },
  { id: "media", label: "Music library", paths: ["media"] },
  { id: "ai", label: "AI helpers", paths: ["antigravity", "claude-coach", "gemini-coach", "opencode-coach", "ai.json", "ai-secrets.bin"] },
  { id: "logs", label: "Error logs", paths: ["logs"] },
  { id: "cache", label: "Window cache", paths: ["Cache", "Code Cache", "GPUCache", "GPUPersistentCache", "DawnGraphiteCache", "DawnWebGPUCache", "GraphiteDawnCache", "Shared Dictionary"] },
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
  private saved: Saved = { dataMode: "connected", blocked: [], intro: "seen" };

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
    }
    if (options.replayIntro) this.saved.intro = "pending";
    else if (options.skipIntro) this.saved.intro = "seen";
    guardFetch(this.guard.localOnly, this.guard.blocked);
  }

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
      platform: `${PLATFORM[process.platform] ?? process.platform}${process.platform === "darwin" ? ` · ${ARCH[process.arch] ?? process.arch}` : ` ${release()}`}`,
      electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
    };
  }

  private state() {
    return { dataMode: this.saved.dataMode, blocked: this.saved.blocked.slice().reverse(), about: this.about, local: this.local(), intro: this.saved.intro };
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
      "Leave Local mode?",
      "C-LINK stops syncing with the watch, and workouts and plans can be saved to your COROS account again. Pair the watch with the COROS app or C-LINK on your phone to use it there. What's on this computer stays here.",
      "Leave Local Mode",
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
          return json(this.state());
        }
        // The intro: "seen" once the athlete goes on to the app; "pending" shows it again (Developer page).
        case "GET /intro": return json({ intro: this.saved.intro });
        case "POST /intro": {
          if (body.intro === "seen" || body.intro === "pending") { this.saved.intro = body.intro; this.save(); }
          return json({ intro: this.saved.intro });
        }
        case "POST /blocked/clear": this.saved.blocked = []; this.save(); return json(this.state());
        case "GET /storage": return json({ folder: tilde(this.folder), places: await this.places() });
        case "POST /storage/open": return this.open(String(body.id ?? ""));
        case "GET /logs": {
          const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours")) || 24));
          const a = this.about;
          return json({ count: this.log.since(hours).length, report: this.log.report(hours, `C-LINK ${a.version} · ${a.platform} · Electron ${a.electron}`) });
        }
        case "POST /logs/clear": this.log.clear(); return json({ count: 0 });
        case "POST /backup/export": return await this.exportBackup(typeof body.passphrase === "string" ? body.passphrase : "");
        case "POST /backup/restore": return await this.restoreBackup(typeof body.passphrase === "string" ? body.passphrase : "");
        default: return problem("Not a setting.", "notFound", 404);
      }
    } catch (error) {
      if (error instanceof BackupProblem) return problem(error.message, error.code);
      this.log.add("app", `Settings ${route} failed: ${String(error)}`);
      return problem("That didn't work.", "internal", 500);
    }
  }

  private async places() {
    const places = await Promise.all(PLACES.map(async (p) => {
      const found = p.paths.map((name) => path.join(this.folder, name)).filter((f) => existsSync(f));
      const bytes = (await Promise.all(found.map(sizeOf))).reduce((a, b) => a + b, 0);
      return { id: p.id, label: p.label, path: tilde(found[0] ?? path.join(this.folder, p.paths[0])), bytes: found.length ? bytes : null };
    }));
    return [...places, { id: "folder", label: "App data folder", path: tilde(this.folder) + "/", bytes: await sizeOf(this.folder) }];
  }

  private open(id: string): Response {
    if (id === "folder") { this.host.reveal(this.folder); return json({ opened: true }); }
    const place = PLACES.find((p) => p.id === id);
    const found = place?.paths.map((name) => path.join(this.folder, name)).find((f) => existsSync(f));
    if (!found) return problem("Nothing is kept there yet.", "missing", 404);
    this.host.reveal(found);
    return json({ opened: true });
  }

  private async exportBackup(passphrase: string): Promise<Response> {
    const store = this.host.store();
    if (!store) return problem("There is no data on this computer to back up.", "noStore");
    const file = await packBackup(store.items(), passphrase);
    const day = new Date().toISOString().slice(0, 10);
    const target = await this.host.saveDialog(`C-LINK backup ${day}.clinkbackup`);
    if (!target) return json({ cancelled: true });
    await writeFile(target, file, { mode: 0o600 });
    return json({ saved: path.basename(target), items: store.size, sealed: !!passphrase });
  }

  private async restoreBackup(passphrase: string): Promise<Response> {
    const store = this.host.store();
    if (!store) return problem("There is no store on this computer to restore into.", "noStore");
    const source = await this.host.openDialog();
    if (!source) return json({ cancelled: true });
    const file = await readFile(source);
    if (isSealed(file) && !passphrase) return problem("This backup has a passphrase. Type it in, then restore again.", "passphrase");
    const { items } = await unpackBackup(file, passphrase);
    store.replaceWith(items);
    this.host.restored();
    return json({ restored: items.length });
  }
}
