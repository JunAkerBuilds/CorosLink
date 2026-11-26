// "Bring over my CorosLink data", answered at /api/desktop/move: what CorosLink left on this computer (detect.ts),
// the tiles the Move screen shows (desktop/renderer/pages/Move.tsx), and the copy itself. The full list of what
// CorosLink keeps and where each piece goes is docs/coroslink-move.md.
//
// A copy, not a move: CorosLink's folder is only ever read (its database through a private copy, snapshot.ts), so
// CorosLink still opens as it was. What comes over is written the way C-LINK keeps it: synced items in the store
// (map.ts, plans.ts), the watch key and pairing through Local mode's watch, FIT files beside Local mode's, Studio
// projects in studio/projects, routes through Route Studio, secrets
// opened with CorosLink's keychain (oldKeychain.ts) and sealed again with C-LINK's. What COROS (or Hevy, Strava)
// gives back once signed in isn't copied. What is CorosLink's alone but has no place in C-LINK yet is kept as it is
// in <data>/coroslink (kept.json and copies of its folders), so it isn't lost when CorosLink goes.
// Anything already here is kept as it is, so running the move twice adds nothing.
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LocalStore } from "../localStore";
import type { RouteSave } from "../../maps/types";
import type { McpServerInput } from "../ai/mcpStore";
import { savedFromDoc } from "@/lib/savedWorkout";
import { duplicateGroups } from "../activities/duplicates";
import { findCorosLink, freeBytes, type DetectOptions, type FoundCorosLink } from "./detect";
import {
  activityChanges, chatChanges, healthChanges, journalChanges, maskEmail, memoryChanges, pairedWatch, routeSave, watchKeyText,
  type ActivityFileRow, type ActivityRow, type Change, type ChatRow, type HealthRow, type JournalRow, type MemoryRow, type PairedWatch, type RouteRow, type SleepRow,
} from "./map";
import { corosLinkKeychain, type OldKeychain } from "./oldKeychain";
import { localWorkouts, planDocs, type PlanRow } from "./plans";
import { Snapshot } from "./snapshot";
import { locale, t } from "@/lib/i18n";

export type TileId = "acts" | "health" | "plans" | "lift" | "coach" | "watch" | "phones" | "faces" | "routes" | "links" | "cals" | "media" | "prefs";

export interface Tile {
  id: TileId;
  label: string;
  detail: string;
  /** What the tile shows big: a count, a size, a watch name. */
  figure: string;
  /** C-LINK can store it now. False: the tile stays, off, with `detail` saying what to do. */
  ready: boolean;
  /** On before the athlete changes anything. */
  on: boolean;
  /** When it isn't ready: "again" (set it up again in C-LINK), "later" (C-LINK can't hold it yet), "coros" (C-LINK
   * gets it again from COROS or the service it came from). */
  instead?: "again" | "later" | "coros";
}

export type TileState = "wait" | "going" | "done" | "attn" | "left" | "failed";
export interface TileProgress { state: TileState; pct: number; done: number; total: number; note?: string }
export interface MoveJob { stage: "moving" | "done"; pct: number; startedAt: string; finishedAt: string | null; tiles: Partial<Record<TileId, TileProgress>>; bytes: number }

export interface MoveHost extends Omit<DetectOptions, "ownData"> {
  /** C-LINK's data folder. */
  data: string;
  store: () => LocalStore | null;
  /** Route Studio's store (maps/routes.ts). */
  saveRoute: (route: RouteSave) => Promise<{ id: string }>;
  /** Coach's AI (ai/vault.ts): the picks and the sealed keys. */
  ai: {
    current: () => { picked: string | null; models: Partial<Record<string, string>>; efforts: Partial<Record<string, string>>; localUrl: string | null };
    choose: (change: { picked?: string; models?: Record<string, string>; efforts?: Record<string, string>; localUrl?: string }) => void;
    hasSecret: (id: string) => Promise<boolean>;
    setSecret: (id: string, value: string) => Promise<void>;
  };
  /** CorosLink's keychain; by default the system's, asked the first time a sealed value is opened. */
  keychain?: (folder: string) => OldKeychain;
  /** Local mode's watch (watch/service.ts adopt). */
  watch?: { adopt: (input: { key: string; account: string | null; paired: PairedWatch | null; weather?: { latitude: number; longitude: number; city: string } | null; autoSyncHours?: number | null }) => Promise<boolean> };
  /** Turns Local mode on (settings.ts), when CorosLink ran Local-Only. */
  localMode?: { on: () => boolean; enter: () => Promise<void> };
  /** Studio's COROS account (watchface/corosAccount.ts adopt). */
  studioAccount?: { adopt: (input: { session?: { accessToken: string; userId?: string; region?: unknown; email: string }; saved?: { account: string; pwdHash: string } }) => Promise<boolean> };
  /** Route Studio's OpenRouteService key (maps/routesService.ts adoptOrsKey). */
  adoptOrsKey?: (key: string) => Promise<boolean>;
  /** The athlete's MCP servers (ai/mcpStore.ts). */
  mcp?: { urls: () => string[]; add: (input: McpServerInput) => Promise<string>; setOAuth: (id: string, oauth: { tokens?: unknown; client?: unknown; redirect?: string }) => Promise<void> };
  /** Media's library (media/library.ts add moves the file in) and its service settings (media/vault.ts). */
  media?: { addTrack: (file: string, name: string, origin: string) => Promise<boolean>; setting: (key: string) => string | null; setSetting: (key: string, value: string) => void };
  /** Pause between batches, so the copy can be watched (CLINK_MOVE_PACE_MS, development only). */
  paceMs?: number;
  log: (line: string) => void;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const problem = (message: string, code = "problem", status = 400) => json({ error: { code, message } }, status);
const gb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const fmt = (n: number) => n.toLocaleString(locale("en-US"));
/** Copies a file, as a clone where the disk can (APFS, Btrfs, ReFS): no second copy of the bytes until one changes. */
const clone = (from: string, to: string) => copyFile(from, to, constants.COPYFILE_FICLONE);
const parse = <T>(text: string | null): T | null => { try { return text ? (JSON.parse(text) as T) : null; } catch { return null; } };

/** Coach's providers in CorosLink, and the prefix of their settings keys. Same ids as C-LINK's (ai/catalog.ts). */
const AI_KEYS: Record<string, string> = { chatgpt: "chatgpt", "claude-code": "claudeCode", "gemini-cli": "geminiCli", antigravity: "antigravity", opencode: "opencode", openrouter: "openRouter", local: "local" };
/** CorosLink's watch keys: the one from its COROS sign-in, then the older per-watch one. */
const WATCH_KEYS = ["coros.ble.loginAuth", "coros.ble.accountAuth"];
const PROJECT_ID = /^[a-f0-9-]{36}$/i;
/** A safeStorage value as CorosLink kept it: base64 of "v10…"/"v11…". */
const SEALED = /^djE[wx]/;
/** The store refuses an item past 256 KB (localStore.ts); src/data/local/synced.ts keeps under the same line. */
const MAX_ITEM_CHARS = 250_000;

/** Everything about the CorosLink found that the Move screen shows, read once. */
interface Survey {
  found: FoundCorosLink;
  free: number | null;
  counts: { activities: number; healthDays: number; chats: number; faces: number };
  tiles: Tile[];
  /** Bytes each tile copies, for "N picked · X GB". */
  bytes: Partial<Record<TileId, number>>;
}

async function folderSize(target: string): Promise<number> {
  const info = await stat(target).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(target).catch(() => [] as string[])) total += await folderSize(path.join(target, name));
  return total;
}

/** Copies a folder's files that aren't at `to` yet. Returns how many it copied. */
async function copyTree(from: string, to: string, skip: (name: string) => boolean = () => false): Promise<number> {
  const entries = await readdir(from, { withFileTypes: true }).catch(() => []);
  let copied = 0;
  for (const e of entries) {
    if (skip(e.name)) continue;
    const source = path.join(from, e.name), target = path.join(to, e.name);
    if (e.isDirectory()) copied += await copyTree(source, target, skip);
    else if (e.isFile() && !existsSync(target)) {
      await mkdir(to, { recursive: true });
      await clone(source, target);
      copied++;
    }
  }
  return copied;
}

/** CorosLink's Studio projects worth copying: a folder per project with a readable project.json. */
async function projectsIn(folder: string): Promise<string[]> {
  const root = path.join(folder, "watchface-projects");
  const names = await readdir(root).catch(() => [] as string[]);
  const out: string[] = [];
  for (const id of names) {
    if (!PROJECT_ID.test(id)) continue;
    if (existsSync(path.join(root, id, "project.json")) && existsSync(path.join(root, id, "starter.dat"))) out.push(id);
  }
  return out;
}

/** CorosLink's downloaded MP3s (downloads/). */
async function mp3sIn(folder: string): Promise<string[]> {
  return (await readdir(path.join(folder, "downloads")).catch(() => [] as string[])).filter((n) => /\.mp3$/i.test(n));
}

/** CorosLink's data mode (privacy/data-mode.json): true when it ran Local-Only. */
function wasLocalOnly(folder: string): boolean {
  return parse<{ mode?: string }>((() => { try { return readFileSync(path.join(folder, "privacy", "data-mode.json"), "utf8"); } catch { return null; } })())?.mode === "local_only";
}

export class CorosLinkMove {
  private survey: { at: number; value: Survey | null } | null = null;
  private job: MoveJob | null = null;
  private readonly ledgerFile: string;
  /** Where what has no place in C-LINK yet is kept as CorosLink had it. */
  private readonly keptFolder: string;
  private keychain: OldKeychain | null = null;

  constructor(private readonly host: MoveHost) {
    this.ledgerFile = path.join(host.data, "coroslink-move.json");
    this.keptFolder = path.join(host.data, "coroslink");
    try { this.job = (JSON.parse(readFileSync(this.ledgerFile, "utf8")) as { job?: MoveJob }).job ?? null; } catch { this.job = null; }
    // A copy that was cut off (the app quit) shows as unfinished; starting again picks up what's missing.
    if (this.job?.stage === "moving") this.job = null;
  }

  /** CorosLink's data, if any, without reading it. */
  find(): FoundCorosLink | null {
    return findCorosLink({ ...this.host, ownData: this.host.data });
  }

  private snapshot(found: FoundCorosLink): Snapshot {
    return Snapshot.open(found.db, path.join(this.host.data, "coroslink-snapshot"));
  }

  /** Reads what's there and builds the tiles. Kept for a minute: the screen asks more than once. */
  async look(fresh = false): Promise<Survey | null> {
    if (!fresh && this.survey && Date.now() - this.survey.at < 60_000) return this.survey.value;
    const found = this.find();
    const value = found ? await this.read(found) : null;
    this.survey = { at: Date.now(), value };
    return value;
  }

  private async read(found: FoundCorosLink): Promise<Survey> {
    const db = this.snapshot(found);
    try {
      const list = db.all<ActivityRow>("SELECT * FROM training_activities");
      const files = db.all<ActivityFileRow>("SELECT * FROM local_activity_files");
      // Workouts, not copies: a run COROS lists and the watch's archive kept too counts once (activities/duplicates.ts).
      const changes = activityChanges(list, files).map((c) => ({ id: c.id, body: c.body as Record<string, unknown> }));
      const activities = changes.length - duplicateGroups(changes).reduce((n, g) => n + g.length - 1, 0);
      const healthDays = new Set([
        ...db.all<{ day: string }>("SELECT DISTINCT day FROM local_health_summaries").map((r) => r.day.replaceAll("-", "")),
        ...db.all<{ day: string }>("SELECT DISTINCT day FROM local_sleep_sessions").map((r) => r.day.replaceAll("-", "")),
      ]).size;
      const chats = chatChanges(db.all<ChatRow>("SELECT * FROM chat_sessions")).conversations;
      const memory = db.count("SELECT COUNT(*) AS n FROM athlete_memory");
      const journal = db.count("SELECT COUNT(*) AS n FROM workout_journal");
      const projects = await projectsIn(found.folder);
      const routes = db.count("SELECT COUNT(*) AS n FROM generated_routes");
      const plans = db.count("SELECT COUNT(*) AS n FROM training_plans WHERE source != 'coros'");
      const ownWorkouts = db.count("SELECT COUNT(*) AS n FROM local_training_programs") + db.count("SELECT COUNT(*) AS n FROM local_training_schedule");
      const races = db.count("SELECT COUNT(*) AS n FROM race_targets") + db.count("SELECT COUNT(*) AS n FROM race_entries");
      const lift = db.count("SELECT COUNT(*) AS n FROM strength_sessions") + db.count("SELECT COUNT(*) AS n FROM hevy_workouts");
      const device = db.one<{ name: string | null; model: string | null }>("SELECT name, model FROM local_devices ORDER BY last_seen_at DESC");
      const paired = pairedWatch(db.setting("coros.ble.watchIdentity"), db.setting("coros.ble.systemDevice"), device);
      const hasKey = WATCH_KEYS.some((k) => db.setting(k));
      const phones = db.count("SELECT COUNT(*) AS n FROM remote_sessions WHERE revoked_at IS NULL");
      const accounts = (db.setting("trainingHub.accessToken") ? 1 : 0) + (db.setting("watchfaces.mobileSession") || db.setting("coros.credentials") ? 1 : 0) +
        (db.setting("hevy.apiKey") ? 1 : 0) + (db.setting("intervals.apiKey") ? 1 : 0);
      const strava = !!db.setting("strava.secureState");
      const calendars = db.count("SELECT COUNT(*) AS n FROM app_settings WHERE key IN ('appleCalendar.secureState', 'googleCalendar.secureState')");
      const provider = db.setting("chat.provider");
      const mcp = db.count("SELECT COUNT(*) AS n FROM mcp_servers");
      const settings = (provider && AI_KEYS[provider] ? 1 : 0) + mcp + (db.setting("maps.openRouteServiceApiKey") ? 1 : 0);
      const tracks = await mp3sIn(found.folder);
      const media = await folderSize(path.join(found.folder, "downloads"));
      const watchName = paired?.display ?? device?.name?.replace(/^COROS\s+/i, "").replace(/\s+[A-F0-9]{6}$/i, "") ?? null;

      const bytes: Survey["bytes"] = {
        acts: (await stat(found.db).then((s) => s.size).catch(() => 0)) + (await folderSize(path.join(found.folder, "local-archive"))),
        faces: (await folderSize(path.join(found.folder, "watchface-projects"))) + (await folderSize(path.join(found.folder, "watchface-ai-chats"))),
        coach: await folderSize(path.join(found.folder, "coach-attachments")),
        media,
      };
      const tiles: Tile[] = [
        { id: "acts", label: t("Activities"), detail: t("Every workout, with its FIT file when the watch gave one"), figure: fmt(activities), ready: true, on: activities > 0 },
        { id: "health", label: t("Sleep and health"), detail: t("Nights, steps and the watch's daily figures"), figure: healthDays === 1 ? t("1 day") : t("{n} days", { n: fmt(healthDays) }), ready: true, on: healthDays > 0 },
        { id: "plans", label: t("Plans and races"), detail: t("Your own plans and workouts. Race goals are kept for later"), figure: fmt(plans + ownWorkouts + races), ready: true, on: plans + ownWorkouts + races > 0 },
        { id: "lift", label: t("Strength and gear"), detail: t("COROS and Hevy send these again once you're signed in"), figure: fmt(lift), ready: false, on: false, instead: "coros" },
        { id: "coach", label: t("Coach chats"), detail: t("Conversations, what Coach remembers, workout briefs"), figure: fmt(chats), ready: true, on: chats + memory + journal > 0 },
        {
          id: "watch", label: t("Watch key"), detail: hasKey ? t("Your watch stays paired. Local mode works at once") : t("Pair the watch in C-LINK"),
          figure: watchName ?? t("None"), ready: hasKey && !!this.host.watch, on: hasKey && !!this.host.watch, ...(hasKey ? {} : { instead: "again" as const }),
        },
        // CorosLink's remote pairing is a different link from C-LINK's phone sync, so phones pair again with C-LINK's QR code.
        { id: "phones", label: t("Paired phones"), detail: t("Scan C-LINK's code on your phone once"), figure: fmt(phones), ready: false, on: false, instead: "again" },
        { id: "faces", label: t("Faces and Studio"), detail: t("Your designs, drafts and imports"), figure: fmt(projects.length), ready: true, on: projects.length > 0 },
        { id: "routes", label: t("Routes"), detail: t("Saved routes. Map areas download again"), figure: fmt(routes), ready: true, on: routes > 0 },
        { id: "links", label: t("Accounts"), detail: strava ? t("COROS, Hevy and intervals.icu. Connect Strava again later") : t("COROS, Hevy and intervals.icu, still signed in"), figure: fmt(accounts), ready: true, on: accounts > 0 },
        // Calendar sync isn't in C-LINK yet. The event IDs are worked out from the workouts (docs/coroslink-move.md), so
        // once it is, the same events are found again instead of added twice.
        { id: "cals", label: t("Calendars"), detail: t("Not in C-LINK yet. Events stay where they are"), figure: fmt(calendars), ready: false, on: false, instead: "later" },
        { id: "media", label: t("Media library"), detail: t("Downloaded music"), figure: tracks.length ? gb(media) : "0", ready: !!this.host.media, on: tracks.length > 0 && !!this.host.media },
        { id: "prefs", label: t("Settings"), detail: t("Coach's AI and keys, MCP servers, routing key"), figure: fmt(settings), ready: true, on: settings > 0 },
      ];
      return { found, free: freeBytes(this.host.data), counts: { activities, healthDays, chats, faces: projects.length }, tiles, bytes };
    } finally {
      db.close();
    }
  }

  private saving: Promise<void> = Promise.resolve();
  /** Saves the ledger in the background, one write at a time, each the newest state. */
  private save(): void {
    this.saving = this.saving.then(async () => {
      const temp = `${this.ledgerFile}.tmp`;
      await writeFile(temp, JSON.stringify({ job: this.job }, null, 2));
      await rename(temp, this.ledgerFile);
    }).catch((e: unknown) => this.host.log(`Move: ledger not saved (${e instanceof Error ? e.name : "error"})`));
  }

  private routesDone(): Record<string, string> {
    try { return (JSON.parse(readFileSync(path.join(this.host.data, "coroslink-routes.json"), "utf8")) as Record<string, string>) ?? {}; } catch { return {}; }
  }

  /**
   * Plans, calendar workouts and kept workouts as store items (src/data/local: `training.plan`, `training.workout`,
   * `training.library`). The library keeps one workout per name, so one named like a kept one is left. One too large
   * for the store is counted, not written.
   */
  private planChanges(db: Snapshot): { changes: Change[]; plans: number; workouts: number; tooLarge: number } {
    const { plans } = planDocs(db.all<PlanRow>("SELECT id, source, document_json, archived_at FROM training_plans"));
    const { workouts } = localWorkouts(
      db.all<{ id: string; program: string }>("SELECT id, program FROM local_training_programs"),
      db.all<{ id_in_plan: string; happen_day: string; program: string }>("SELECT id_in_plan, happen_day, program FROM local_training_schedule"),
    );
    const library = new Set((this.host.store()?.list("training.library") ?? []).map((i) => i.body.name));
    const changes: Change[] = plans.map((plan) => ({ collection: "training.plan", id: plan.id, body: plan }));
    for (const { id, date, doc } of workouts) {
      const saved = savedFromDoc(doc, date ?? "", id, null);
      if (date) changes.push({ collection: "training.workout", id, body: saved });
      else if (!library.has(saved.name)) {
        library.add(saved.name);
        const { summary: _summary, savedAt: _savedAt, ...workout } = saved;
        void _summary; void _savedAt;
        changes.push({ collection: "training.library", id, body: workout });
      }
    }
    const fits = changes.filter((c) => JSON.stringify(c.body).length <= MAX_ITEM_CHARS);
    return { changes: fits, plans: plans.length, workouts: workouts.length, tooLarge: changes.length - fits.length };
  }

  /** Starts copying the picked tiles. Only ready tiles are copied, whatever is asked. */
  async start(picked: TileId[]): Promise<{ job: MoveJob }> {
    if (this.job?.stage === "moving") return { job: this.job };
    const survey = await this.look(true);
    if (!survey) throw new Error(t("CorosLink's data wasn't found."));
    const tiles = survey.tiles.filter((t) => t.ready && picked.includes(t.id));
    const bytes = tiles.reduce((sum, t) => sum + (survey.bytes[t.id] ?? 0), 0);
    this.job = { stage: "moving", pct: 0, startedAt: new Date().toISOString(), finishedAt: null, bytes, tiles: Object.fromEntries(tiles.map((t) => [t.id, { state: "wait", pct: 0, done: 0, total: 0 }])) };
    this.save();
    void this.run(survey.found, tiles.map((t) => t.id)).catch((e: unknown) => this.host.log(`Move failed: ${String(e)}`));
    return { job: this.job };
  }

  /** Waits for the copy to finish (tests). */
  running: Promise<void> = Promise.resolve();

  private async run(found: FoundCorosLink, ids: TileId[]): Promise<void> {
    let finish = () => {};
    this.running = new Promise((resolve) => { finish = resolve; });
    const job = this.job!;
    const db = this.snapshot(found);
    this.keychain = (this.host.keychain ?? ((folder) => corosLinkKeychain({ platform: process.platform, folder })))(found.folder);
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const tile = job.tiles[id]!;
        tile.state = "going";
        const tick = (done: number, total: number) => {
          tile.done = done; tile.total = total; tile.pct = total ? Math.min(100, Math.round((done / total) * 100)) : 100;
          job.pct = Math.round(((i + tile.pct / 100) / ids.length) * 100);
        };
        try {
          const result = await this.copy(id, found, db, tick);
          tick(tile.total, tile.total);
          tile.state = typeof result === "object" && result?.attn ? "attn" : "done";
          const note = typeof result === "object" ? result?.note : result;
          if (note) tile.note = note;
        } catch (e) {
          tile.state = "failed";
          tile.note = t("This one didn't copy. Try again from Settings.");
          // Never the error's text: it could quote what was being copied.
          this.host.log(`Move: ${id} failed (${e instanceof Error ? e.name : "error"})`);
        }
        this.save();
      }
    } finally {
      db.close();
      this.keychain = null;
      job.stage = "done";
      job.pct = 100;
      job.finishedAt = new Date().toISOString();
      this.save();
      finish();
    }
  }

  private pause = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (this.host.paceMs) await new Promise((resolve) => setTimeout(resolve, this.host.paceMs));
  };

  /** Writes items the store doesn't have yet, in batches, so the window stays responsive. */
  private async writeNew(changes: Change[], tick: (done: number, total: number) => void): Promise<number> {
    const store = this.host.store();
    if (!store) throw new Error(t("There is no store on this computer."));
    const have = new Map<string, Set<string>>();
    const fresh = changes.filter((c) => {
      const ids = have.get(c.collection) ?? have.set(c.collection, new Set(store.list(c.collection).map((i) => i.id))).get(c.collection)!;
      return !ids.has(c.id);
    });
    const total = changes.length;
    let done = total - fresh.length;
    tick(done, total);
    for (let at = 0; at < fresh.length; at += 50) {
      const batch = fresh.slice(at, at + 50);
      store.write(batch);
      done += batch.length;
      tick(done, total);
      await this.pause();
    }
    return fresh.length;
  }

  /**
   * One sealed setting, opened with CorosLink's keychain. Null when it isn't there or can't be opened. A value
   * CorosLink kept in plain text (intervals.icu without a keychain, its "encrypted:" MCP prefix aside) is returned
   * as it is. Never logged.
   */
  private async secret(db: Snapshot, key: string): Promise<string | null> {
    let value = db.setting(key);
    if (!value) return null;
    if (value.startsWith("encrypted:")) value = value.slice("encrypted:".length);
    else if (!SEALED.test(value)) return value;
    return (await this.keychain?.open(value)) ?? null;
  }

  /** Adds `section` to <data>/coroslink/kept.json: CorosLink's own data C-LINK has no place for yet. */
  private async keep(section: string, value: unknown): Promise<void> {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) return;
    const file = path.join(this.keptFolder, "kept.json");
    await mkdir(this.keptFolder, { recursive: true });
    const kept = parse<Record<string, unknown>>(await readFile(file, "utf8").catch(() => null)) ?? {};
    kept[section] = value;
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(kept, null, 2), { mode: 0o600 });
    await rename(temp, file);
  }

  private async copy(id: TileId, found: FoundCorosLink, db: Snapshot, tick: (done: number, total: number) => void): Promise<string | { note: string; attn?: boolean } | null> {
    switch (id) {
      case "acts": {
        const files = db.all<ActivityFileRow>("SELECT * FROM local_activity_files");
        // The watch's FIT files go where Local mode keeps its own (watch/fit/<watch id>.fit) first: the next watch sync
        // reads them instead of building them again, and the store makes each workout's detail (laps, streams, map)
        // from them as it's written (activities/duplicates.ts), which also keeps a workout COROS lists too as one.
        const fitFolder = path.join(this.host.data, "watch", "fit");
        let fits = 0;
        for (const f of files) {
          if (f.format !== "fit" || !f.watch_activity_id || !/^[A-Za-z0-9._-]{1,80}$/.test(f.watch_activity_id)) continue;
          const source = path.isAbsolute(f.file_path) ? f.file_path : path.join(found.folder, "local-archive", f.file_path);
          const target = path.join(fitFolder, `${f.watch_activity_id}.fit`);
          if (existsSync(target) || !existsSync(source)) continue;
          await mkdir(fitFolder, { recursive: true });
          await clone(source, target);
          fits++;
        }
        const added = await this.writeNew(activityChanges(db.all<ActivityRow>("SELECT * FROM training_activities"), files), tick);
        // Every original the watch sent and every FIT the athlete imported, as CorosLink kept them (its own backups
        // are made of these): the only copy once CorosLink is gone. In-progress transfers aren't.
        await copyTree(path.join(found.folder, "local-archive"), path.join(this.keptFolder, "local-archive"), (name) => name === "partial");
        await this.keep("activityFiles", db.all("SELECT activity_id, device_id, watch_activity_id, source, provenance, file_path, format, sha256, sport_type, name, start_time, duration, distance, original_name, imported_at FROM local_activity_files"));
        return !fits ? t("{n} added", { n: fmt(added) }) : fits === 1 ? t("{n} added, 1 FIT file", { n: fmt(added) }) : t("{n} added, {fits} FIT files", { n: fmt(added), fits: fmt(fits) });
      }
      case "health": {
        const added = await this.writeNew(healthChanges(
          db.all<HealthRow>("SELECT day, metric, value FROM local_health_summaries"),
          db.all<SleepRow>("SELECT * FROM local_sleep_sessions"),
        ), tick);
        // The watch's own readings through the day (heart rate, stress…), checks and recovery: C-LINK keeps daily
        // figures only, so these are kept as CorosLink read them.
        await this.keep("healthSamples", db.all("SELECT device_id, metric, ts, value, unit, validity, source, utc_offset_minutes FROM local_health_samples"));
        await this.keep("healthChecks", db.all("SELECT * FROM local_health_checks"));
        await this.keep("workoutRecovery", db.all("SELECT * FROM local_workout_recovery"));
        await this.keep("sleepRanges", db.all("SELECT device_id, start_ts, ranges FROM local_sleep_sessions"));
        return t("{n} added", { n: fmt(added) });
      }
      case "plans": {
        const made = this.planChanges(db);
        const added = await this.writeNew(made.changes, tick);
        // What C-LINK has no place for yet is kept: race goals and results, library tags and folders, plan-to-activity
        // matches the athlete set.
        await this.keep("raceTargets", db.all("SELECT * FROM race_targets"));
        await this.keep("raceEntries", db.all("SELECT * FROM race_entries"));
        await this.keep("workoutTags", db.all("SELECT program_id, favorite, tags_json, collection_id, source, last_used_at FROM training_workout_metadata WHERE favorite = 1 OR tags_json NOT IN ('', '[]') OR collection_id IS NOT NULL"));
        await this.keep("collections", db.all("SELECT * FROM training_collections"));
        await this.keep("manualMatches", db.all("SELECT * FROM training_activity_matches WHERE manual = 1"));
        // Calendar sync's own state (not its sign-ins): with it, C-LINK's calendar sync can find CorosLink's events.
        const calendar = db.all<{ key: string; value: string }>("SELECT key, value FROM app_settings WHERE key LIKE 'calendar.workoutEvents.%' OR key LIKE 'calendar.scheduleRevision.%'");
        await this.keep("calendarState", calendar.length ? Object.fromEntries(calendar.map((r) => [r.key, r.value])) : null);
        const races = db.count("SELECT COUNT(*) AS n FROM race_targets") + db.count("SELECT COUNT(*) AS n FROM race_entries");
        const note = [
          made.plans === 1 ? t("1 plan") : t("{n} plans", { n: fmt(made.plans) }),
          !made.workouts ? "" : made.workouts === 1 ? t("1 workout") : t("{n} workouts", { n: fmt(made.workouts) }),
          !races ? "" : races === 1 ? t("1 race kept") : t("{n} races kept", { n: fmt(races) }),
        ].filter(Boolean).join(", ");
        if (made.tooLarge) return { note: `${note}. ${made.tooLarge === 1 ? t("1 plan too large to keep") : t("{n} plans too large to keep", { n: fmt(made.tooLarge) })}`, attn: true };
        return added || !made.changes.length ? note : t("{note} (already here)", { note });
      }
      case "coach": {
        const chats = chatChanges(db.all<ChatRow>("SELECT * FROM chat_sessions"));
        const added = await this.writeNew([
          ...chats.changes,
          ...memoryChanges(db.all<MemoryRow>("SELECT * FROM athlete_memory")),
          ...journalChanges(db.all<JournalRow>("SELECT entry_id, happen_day, workout_name, brief_json, updated_at FROM workout_journal")),
        ], tick);
        await this.keep("workoutJournal", db.all("SELECT entry_id, happen_day, plan_id, id_in_plan, activity_id, workout_name, sport_type, brief_json, debrief_json, created_at, updated_at FROM workout_journal"));
        await this.keep("coachInstructions", db.setting("chat.customInstructions"));
        await this.keep("pinnedCharts", parse(db.setting("coach.pinnedCharts")));
        await copyTree(path.join(found.folder, "coach-attachments"), path.join(this.keptFolder, "coach-attachments"));
        return t("{n} added", { n: fmt(added) });
      }
      case "watch": {
        tick(0, 1);
        let opened: string | null = null;
        for (const key of WATCH_KEYS) if ((opened = await this.secret(db, key))) break;
        const key = opened ? watchKeyText(opened) : null;
        if (!key) return { note: t("The key didn't open here. Pair the watch again"), attn: true };
        const device = db.one<{ name: string | null; model: string | null }>("SELECT name, model FROM local_devices ORDER BY last_seen_at DESC");
        const weather = parse<{ latitude?: unknown; longitude?: unknown; place?: unknown }>(db.setting("watch.weatherLocation"));
        const autoSync = parse<{ enabled?: unknown; intervalHours?: unknown }>(db.setting("watch.autoSync"));
        const adopted = await this.host.watch!.adopt({
          key,
          account: maskEmail(parse<{ accountEmail?: unknown }>(opened)?.accountEmail),
          paired: pairedWatch(db.setting("coros.ble.watchIdentity"), db.setting("coros.ble.systemDevice"), device),
          weather: weather && typeof weather.latitude === "number" && typeof weather.longitude === "number" ? { latitude: weather.latitude, longitude: weather.longitude, city: typeof weather.place === "string" ? weather.place : "" } : null,
          autoSyncHours: autoSync ? (autoSync.enabled === false ? 0 : typeof autoSync.intervalHours === "number" ? autoSync.intervalHours : null) : null,
        });
        // CorosLink ran Local-Only: so does C-LINK, or the watch would sit unused.
        if (wasLocalOnly(found.folder) && this.host.localMode && !this.host.localMode.on()) await this.host.localMode.enter();
        return adopted ? t("Paired, Local mode ready") : t("A watch key was already saved here");
      }
      case "faces": {
        const ids = await projectsIn(found.folder);
        const into = path.join(this.host.data, "studio", "projects");
        await mkdir(into, { recursive: true });
        let added = 0;
        tick(0, ids.length);
        for (let i = 0; i < ids.length; i++) {
          const pid = ids[i], target = path.join(into, pid);
          if (!existsSync(target)) {
            const from = path.join(found.folder, "watchface-projects", pid);
            // Only a manifest Studio can open (studio.ts readStored): its own id, a name, a template, design version 1.
            const manifest = JSON.parse(await readFile(path.join(from, "project.json"), "utf8")) as { projectId?: unknown; name?: unknown; design?: { version?: unknown } };
            if (manifest.projectId === pid && typeof manifest.name === "string" && manifest.design?.version === 1) {
              const temp = `${target}.moving`;
              await rm(temp, { recursive: true, force: true });
              await mkdir(temp);
              for (const name of ["project.json", "starter.dat", "preview.png"]) {
                if (existsSync(path.join(from, name))) await clone(path.join(from, name), path.join(temp, name));
              }
              await rename(temp, target);
              added++;
            }
          }
          tick(i + 1, ids.length);
          await this.pause();
        }
        // Studio's AI chats about faces: C-LINK's Watchmaker keeps none yet.
        await copyTree(path.join(found.folder, "watchface-ai-chats"), path.join(this.keptFolder, "watchface-ai-chats"));
        return t("{n} added", { n: fmt(added) });
      }
      case "routes": {
        const rows = db.all<RouteRow>("SELECT * FROM generated_routes ORDER BY created_at");
        const ledger = path.join(this.host.data, "coroslink-routes.json");
        const done = this.routesDone();
        let added = 0;
        tick(0, rows.length);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const save = done[row.id] ? null : routeSave(row);
          if (save) {
            done[row.id] = (await this.host.saveRoute(save)).id;
            await writeFile(ledger, JSON.stringify(done));
            added++;
          }
          tick(i + 1, rows.length);
          await this.pause();
        }
        return t("{n} added", { n: fmt(added) });
      }
      case "links": {
        tick(0, 4);
        const came: string[] = [];
        const store = this.host.store();
        const has = (collection: string, itemId: string) => !!store?.list(collection).some((i) => i.id === itemId);
        let unopened = 0;
        const open = async (key: string) => { const v = await this.secret(db, key); if (!v && db.setting(key)) unopened++; return v; };
        const credentials = parse<{ account?: unknown; pwdHash?: unknown }>(await open("coros.credentials"));
        const email = typeof credentials?.account === "string" ? credentials.account : "";
        // COROS Training Hub: CorosLink's session (kept in plain text) becomes the shared session C-LINK signs in with
        // (src/server/hub/shared.ts). An expired one asks for a sign-in again, as it would have in CorosLink.
        const token = db.setting("trainingHub.accessToken"), userId = db.setting("trainingHub.userId"), baseURL = db.setting("trainingHub.baseUrl");
        if (store && token && userId && baseURL && !has("hub.session", "me")) {
          store.write([{ collection: "hub.session", id: "me", body: { accessToken: token, userId, regionId: db.setting("trainingHub.regionId") ?? "", baseURL, ...(email ? { email } : {}) } }]);
          came.push("COROS");
        }
        tick(1, 4);
        // Studio's COROS account (faces): the mobile session, and the remembered login it signs in again with.
        const mobile = parse<{ accessToken?: unknown; userId?: unknown; region?: unknown }>(await open("watchfaces.mobileSession"));
        if (this.host.studioAccount && (email || mobile)) {
          const adopted = await this.host.studioAccount.adopt({
            ...(typeof mobile?.accessToken === "string" && email ? { session: { accessToken: mobile.accessToken, ...(typeof mobile.userId === "string" ? { userId: mobile.userId } : {}), region: mobile.region, email } } : {}),
            ...(email && typeof credentials?.pwdHash === "string" ? { saved: { account: email, pwdHash: credentials.pwdHash } } : {}),
          });
          if (adopted && !came.includes("COROS")) came.push("COROS");
        }
        tick(2, 4);
        const hevy = await open("hevy.apiKey");
        if (store && hevy && !has("connection", "hevy")) { store.write([{ collection: "connection", id: "hevy", body: { apiKey: hevy } }]); came.push("Hevy"); }
        tick(3, 4);
        const intervals = await open("intervals.apiKey"), athleteId = db.setting("intervals.athleteId");
        if (store && intervals && athleteId && !has("connection", "intervals")) { store.write([{ collection: "connection", id: "intervals", body: { apiKey: intervals, athleteId } }]); came.push("intervals.icu"); }
        const strava = db.setting("strava.secureState") ? t("Connect Strava again later") : "";
        if (unopened) return { note: [came.length ? t("{names} signed in", { names: came.join(", ") }) : "", t("Some sign-ins didn't open here. Sign in again")].filter(Boolean).join(". "), attn: true };
        return [came.length ? t("{names} signed in", { names: came.join(", ") }) : t("Nothing new"), strava].filter(Boolean).join(". ");
      }
      case "media": {
        const names = await mp3sIn(found.folder);
        let added = 0;
        tick(0, names.length);
        for (let i = 0; i < names.length; i++) {
          if (await this.host.media!.addTrack(path.join(found.folder, "downloads", names[i]), names[i], `coroslink:${names[i]}`)) added++;
          tick(i + 1, names.length);
          await this.pause();
        }
        const spotify = db.setting("spotify.clientId");
        if (spotify && !this.host.media!.setting("spotify.clientId")) this.host.media!.setSetting("spotify.clientId", spotify);
        return `${fmt(added)} added`;
      }
      case "prefs": {
        tick(0, 3);
        const came: string[] = [];
        // Coach's AI: the pick (when none is made here), and each provider's model, effort and key.
        const provider = db.setting("chat.provider");
        const now = this.host.ai.current();
        const models: Record<string, string> = {}, efforts: Record<string, string> = {};
        for (const [id, prefix] of Object.entries(AI_KEYS)) {
          const model = db.setting(`chat.${prefix}.model`), effort = db.setting(`chat.${prefix}.effort`);
          if (model && !now.models[id]) models[id] = model;
          if (effort && !now.efforts[id]) efforts[id] = effort;
        }
        const localUrl = db.setting("chat.local.baseUrl");
        this.host.ai.choose({
          ...(provider && AI_KEYS[provider] && !now.picked ? { picked: provider } : {}), models, efforts,
          ...(localUrl && !now.localUrl ? { localUrl } : {}),
        });
        if (provider && AI_KEYS[provider]) came.push(t("Coach's AI"));
        const keys: [string, string, (v: string) => string | null][] = [
          ["openrouter", "chat.openRouter.apiKey", (v) => v],
          ["local", "chat.local.apiKey", (v) => v],
          // ChatGPT's sign-in, in C-LINK's shape (ai/chatgpt.ts ChatGPTToken).
          ["chatgpt", "chat.oauthToken", (v) => {
            const tok = parse<{ access_token?: unknown; refresh_token?: unknown; expires_at?: unknown; account_id?: unknown; email?: unknown }>(v);
            return tok && typeof tok.access_token === "string" && typeof tok.refresh_token === "string"
              ? JSON.stringify({ access: tok.access_token, refresh: tok.refresh_token, expiresAt: typeof tok.expires_at === "number" ? tok.expires_at * 1000 : 0, accountId: typeof tok.account_id === "string" ? tok.account_id : null, email: typeof tok.email === "string" ? tok.email : null })
              : null;
          }],
        ];
        for (const [secretId, setting, shape] of keys) {
          if (await this.host.ai.hasSecret(secretId)) continue;
          const opened = await this.secret(db, setting);
          const value = opened ? shape(opened) : null;
          if (value) await this.host.ai.setSecret(secretId, value);
        }
        tick(1, 3);
        // MCP servers, with their sign-ins where CorosLink kept them (OAuth tokens or a token).
        const servers = db.all<{ id: string; name: string; url: string; auth_type: string; scope: string | null; enabled: number }>("SELECT id, name, url, auth_type, scope, enabled FROM mcp_servers ORDER BY sort_order");
        let mcp = 0;
        if (this.host.mcp) {
          const have = new Set(this.host.mcp.urls());
          for (const s of servers) {
            if (have.has(s.url)) continue;
            const prefix = s.id === "coros" ? "corosMcp" : `mcp.${s.id}`;
            const auth = s.auth_type === "bearer" ? "bearer" : s.auth_type === "oauth" ? "oauth" : "none";
            const bearer = auth === "bearer" ? await this.secret(db, `mcp.${s.id}.bearer`) : null;
            try {
              const newId = await this.host.mcp.add({ name: s.name, transport: "http", url: s.url, auth: auth === "bearer" && !bearer ? "none" : auth, ...(s.scope ? { scope: s.scope } : {}), ...(bearer ? { bearer } : {}) });
              if (auth === "oauth") {
                const tokens = parse(await this.secret(db, `${prefix}.tokens`));
                const client = parse<{ redirect_uris?: unknown }>(await this.secret(db, `${prefix}.clientInfo`));
                const redirect = Array.isArray(client?.redirect_uris) && typeof client.redirect_uris[0] === "string" ? client.redirect_uris[0] : undefined;
                if (tokens) await this.host.mcp.setOAuth(newId, { tokens, ...(client ? { client } : {}), ...(redirect ? { redirect } : {}) });
              }
              mcp++;
            } catch { /* a server C-LINK refuses (stdio aside, CorosLink only had http) is left */ }
          }
        }
        if (mcp) came.push(mcp === 1 ? t("1 MCP server") : t("{n} MCP servers", { n: fmt(mcp) }));
        tick(2, 3);
        const ors = db.setting("maps.openRouteServiceApiKey");
        if (ors && this.host.adoptOrsKey && (await this.host.adoptOrsKey(ors))) came.push(t("routing key"));
        // Settings C-LINK has no place for yet (language, units, Claude Code's data permissions).
        await this.keep("settings", Object.fromEntries(db.all<{ key: string; value: string }>("SELECT key, value FROM app_settings WHERE key IN ('app.language', 'coach.unitSystem', 'chat.visualizations.enabled') OR key LIKE 'chat.claudeCode.permissions.%'").map((r) => [r.key, r.value])));
        return came.length ? came.join(", ") : t("Nothing new");
      }
      default:
        return null;
    }
  }

  private view(survey: Survey | null) {
    if (!survey) return { found: null, job: this.job };
    const { found, free, counts, tiles, bytes } = survey;
    return {
      found: { version: found.version, lastOpened: found.lastOpened, sameFolder: found.sameFolder, free },
      counts, tiles, bytes, job: this.job,
    };
  }

  async answer(request: Request): Promise<Response> {
    const route = new URL(request.url).pathname.slice("/api/desktop/move".length) || "/";
    try {
      switch (`${request.method} ${route}`) {
        case "GET /": return json(this.view(await this.look()));
        case "GET /progress": return json({ job: this.job });
        case "POST /start": {
          const body = (await request.json().catch(() => ({}))) as { tiles?: unknown };
          const picked = Array.isArray(body.tiles) ? body.tiles.filter((t): t is TileId => typeof t === "string") as TileId[] : [];
          if (!this.find()) return problem(t("CorosLink's data isn't on this computer."), "missing", 404);
          return json(await this.start(picked));
        }
        default: return problem(t("Not part of the move."), "notFound", 404);
      }
    } catch (error) {
      this.host.log(`Move ${route} failed (${error instanceof Error ? error.name : "error"})`);
      return problem(t("That didn't work."), "internal", 500);
    }
  }
}
