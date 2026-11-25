// First-run setup (desktop/renderer/pages/Setup.tsx), answered at /api/desktop/setup: whether setup is done, the
// sports picked there, and the two things it turns on for this computer: opening at login and a weekly backup.
// Kept in setup.json in the data folder.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { refToDate, type RefDate } from "@/data/sync/native";
import { packBackup } from "./backup";
import type { LocalStore } from "./localStore";

/** The sport tiles setup offers, in the order it shows them. */
export const SPORTS = ["run", "trail", "ride", "swim", "lift", "hike", "tri", "ski", "row", "climb", "yoga", "hybrid"] as const;
export type SportTile = (typeof SPORTS)[number];

/** Which tile an activity's sport counts toward. Walks and "other" count toward none. */
const TILE_OF: Record<string, SportTile> = {
  run: "run", indoorRun: "run", track: "run", trailRun: "trail", bike: "ride", indoorBike: "ride", poolSwim: "swim", openWater: "swim",
  strength: "lift", hike: "hike", ski: "ski", row: "row", multisport: "tri", cardio: "hybrid",
};

const DAY = 86_400_000;
/** Setup counts the last six months of workouts. */
export const FOUND_DAYS = 183;
/** A sport is picked for you from at least this many sessions… */
const PICK_SESSIONS = 4;
/** …that are at least this share of all of them. */
const PICK_SHARE = 0.1;
export const BACKUP_EVERY_DAYS = 7;
/** Weekly backups kept in the folder; older ones of ours are removed. */
export const BACKUPS_KEPT = 4;
const BACKUP_PREFIX = "C-LINK weekly ";

/** Sessions of each tile in the last six months, from synced activities (`activity` items). */
export function sportCounts(activities: readonly { body: Record<string, unknown> }[], now: Date): Partial<Record<SportTile, number>> {
  const from = now.getTime() - FOUND_DAYS * DAY;
  const counts: Partial<Record<SportTile, number>> = {};
  for (const { body } of activities) {
    const tile = typeof body.sport === "string" ? TILE_OF[body.sport] : undefined;
    if (!tile || typeof body.start !== "number" || !Number.isFinite(body.start)) continue;
    const at = refToDate(body.start as RefDate).getTime();
    if (at < from || at > now.getTime()) continue;
    counts[tile] = (counts[tile] ?? 0) + 1;
  }
  return counts;
}

/** The tiles picked for you: the sports you do regularly, not the odd one. */
export function prePicked(counts: Partial<Record<SportTile, number>>): SportTile[] {
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  return SPORTS.filter((s) => (counts[s] ?? 0) >= PICK_SESSIONS && (counts[s] ?? 0) / total >= PICK_SHARE);
}

/** Whether a weekly backup is due. */
export function backupDue(lastBackupAt: string | null, now: Date): boolean {
  if (!lastBackupAt) return true;
  const last = Date.parse(lastBackupAt);
  return !Number.isFinite(last) || now.getTime() - last >= BACKUP_EVERY_DAYS * DAY || last > now.getTime();
}

/** Our backups past the newest few, to remove. Only files named by the weekly backup. */
export function backupsToRemove(names: readonly string[], kept = BACKUPS_KEPT): string[] {
  return names.filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(".clinkbackup")).sort().reverse().slice(kept);
}

interface Saved { setupDone: boolean; sports: SportTile[] | null; weeklyBackup: boolean; lastBackupAt: string | null }

export interface SetupHost {
  /** The store the app reads now (the sample athlete's while sample data is on), for counts. */
  store: () => LocalStore | null;
  /** The data on this computer, never the sample's: what the weekly backup copies. */
  realStore: () => LocalStore | null;
  /** Opening at login (Electron's login item), or null where it can't be set (running from source). */
  loginItem: { get: () => boolean; set: (on: boolean) => void } | null;
  /** True for an install that already had data before setup existed: it isn't asked to set up. */
  existingInstall: boolean;
  /** False while the smoke run opens screens: setup never takes over a screen it didn't ask for. */
  showOnLaunch: boolean;
  backupFolder?: string;
  log: (line: string) => void;
}

const tilde = (p: string) => (p.startsWith(homedir()) ? "~" + p.slice(homedir().length) : p);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export class FirstRun {
  private readonly file: string;
  private saved: Saved;
  readonly backupFolder: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(folder: string, private readonly host: SetupHost) {
    this.file = path.join(folder, "setup.json");
    this.backupFolder = host.backupFolder ?? path.join(homedir(), "Documents", "C-LINK Backups");
    let saved: Partial<Saved> | null = null;
    try { if (existsSync(this.file)) saved = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved>; } catch { saved = null; }
    this.saved = {
      setupDone: typeof saved?.setupDone === "boolean" ? saved.setupDone : host.existingInstall,
      sports: Array.isArray(saved?.sports) ? saved.sports.filter((s): s is SportTile => (SPORTS as readonly string[]).includes(s)) : null,
      weeklyBackup: saved?.weeklyBackup === true,
      lastBackupAt: typeof saved?.lastBackupAt === "string" ? saved.lastBackupAt : null,
    };
  }

  get done(): boolean { return this.saved.setupDone; }

  private save(): void {
    const temp = `${this.file}.tmp`;
    try { writeFileSync(temp, JSON.stringify(this.saved, null, 2)); renameSync(temp, this.file); } catch (error) { this.host.log(`Setup wasn't saved: ${String(error)}`); }
  }

  /** Changes from the page; anything not given stays as it is. */
  change(body: Record<string, unknown>): void {
    if (typeof body.setupDone === "boolean") this.saved.setupDone = body.setupDone;
    if (Array.isArray(body.sports)) this.saved.sports = SPORTS.filter((s) => (body.sports as unknown[]).includes(s));
    if (typeof body.weeklyBackup === "boolean") {
      this.saved.weeklyBackup = body.weeklyBackup;
      if (body.weeklyBackup) void this.backUpIfDue();
    }
    if (typeof body.openAtLogin === "boolean") this.host.loginItem?.set(body.openAtLogin);
    this.save();
  }

  state(now = new Date()) {
    const store = this.host.store();
    const found = store ? sportCounts(store.list("activity"), now) : {};
    const other = store ? ["gym.workout", "gym.routine", "gym.planned", "fuel.entry"].reduce((n, c) => n + store.count(c), 0) : 0;
    return {
      setupDone: this.saved.setupDone,
      showOnLaunch: this.host.showOnLaunch && !this.saved.setupDone,
      sports: this.saved.sports,
      found, picked: prePicked(found),
      data: store ? { activities: store.count("activity"), healthDays: store.count("health.day"), other } : null,
      openAtLogin: this.host.loginItem ? this.host.loginItem.get() : null,
      weeklyBackup: this.saved.weeklyBackup,
      backupFolder: tilde(this.backupFolder),
      lastBackupAt: this.saved.lastBackupAt,
    };
  }

  async answer(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      this.change(body);
    } else if (request.method !== "GET") return json({ error: { code: "method", message: "Not here." } }, 405);
    return json(this.state());
  }

  /** The weekly backup: checked now and every few hours while the app runs. */
  startBackups(): void {
    if (this.timer) return;
    void this.backUpIfDue();
    this.timer = setInterval(() => void this.backUpIfDue(), 6 * 3_600_000);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Writes this computer's data to the backup folder when a week has passed, and keeps the newest few. */
  async backUpIfDue(now = new Date()): Promise<string | null> {
    const store = this.host.realStore();
    if (!this.saved.weeklyBackup || !store || store.size === 0 || !backupDue(this.saved.lastBackupAt, now)) return null;
    try {
      await mkdir(this.backupFolder, { recursive: true });
      const target = path.join(this.backupFolder, `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.clinkbackup`);
      await writeFile(target, await packBackup(store.items(), "", now), { mode: 0o600 });
      for (const old of backupsToRemove(await readdir(this.backupFolder))) await unlink(path.join(this.backupFolder, old)).catch(() => {});
      this.saved.lastBackupAt = now.toISOString();
      this.save();
      return target;
    } catch (error) {
      this.host.log(`The weekly backup failed: ${String(error)}`);
      return null;
    }
  }
}
