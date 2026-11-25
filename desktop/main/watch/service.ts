// Local mode's watch: the watch paired to this computer over Bluetooth, doing for the desktop what the iPhone app
// does for the phone (docs/sync-contract.md): each sync writes `watch.state`, `activity`, `activity.detail`,
// `health.day` and `health.night` into the store here, and writes the Watch page's waiting changes (`watch.change`)
// to the watch, deleting each once written or refused. Answered at /api/desktop/watch for the Watch page.
//
// The watch key (the COROS account's RSA key the watch trusts) comes from one COROS sign-in, made by the helper,
// and is kept sealed with the OS keychain in watch/key.bin. Only the helper ever sees it, in memory.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sealer } from "../secrets";
import type { LocalStore } from "../localStore";
import { parseWatchKey } from "./engine/systemBind";
import { HelperProblem, type HelperEvent, type WatchDriver } from "./helper";

export type Region = "us" | "eu" | "sg" | "cn";
const REGIONS: readonly Region[] = ["us", "eu", "sg", "cn"];
/** Auto-sync choices in minutes; 0 is off. */
export const AUTO_SYNC_MINUTES = [0, 5, 10, 15, 30, 45, 60] as const;

interface Paired { name: string; display: string; model?: string; pairedAt: string }
interface LastSync {
  at: string; workouts: number; healthDays: number; nights: number; newActivities: number;
  applied: number; refused: number; problems: string[];
}
interface Saved {
  paired: Paired | null;
  /** The masked COROS account the key came from ("a•••@example.com"), to show; never the key. */
  account: string | null;
  installId: string | null;
  lastSync: LastSync | null;
  autoSyncMinutes: number;
  stepGoal: number | null;
  /** Changes the watch refused, for `watch.state.refused` (§5.4), the last 10. */
  refused: { key: string; at: number }[];
  /** Where the watch's weather is for (picked on the Watch page); null sends none. */
  weather: WeatherPlace | null;
  /** When the weather last went to the watch. */
  weatherSentAt: string | null;
}

export interface WeatherPlace { latitude: number; longitude: number; city: string }
export interface FaceSlots { slots: { slot: number; faceId?: number }[]; shown: number | null; installed?: number }
export interface FaceTarget { slot: number; expectedFaceId: number | null; replace: boolean }

/** The watch's route library (0xAA): slots with the track ID (16 hex digits) and CRC16 of each route. */
export interface RouteInventory { capacity: number; full: boolean; routes: { slot: number; trackId: string; crc: number }[] }
/** A route as the helper takes it (written to a file, removed after). Every point goes as it is. */
export interface RouteForWatch {
  id: string; name: string; createdAt: number; distanceM: number; ascentM: number; descentM: number;
  points: [number, number][]; elevations: number[];
}
export interface RouteSent {
  already: boolean; slot: number; trackId: string; crc: number; name: string; pointCount: number; bytes: number; inventory: RouteInventory;
}
/** The watch's storage over Bluetooth (B6 07), in bytes. */
export interface WatchStorage { maps: number; audio: number; workouts: number; routes: number; free: number; total: number }
/** One of the watch's own Wi-Fi map downloads (B6 0B). */
export interface MapTask {
  id: string; state: "queued" | "downloading" | "complete" | "failed" | "unknown"; status: number;
  downloadedBytes: number; totalBytes: number; errorCode: number;
}
export interface MapReadiness { ready: boolean; flags: number; reasons: string[] }
/** The paired watch as Maps sees it, without touching the link. */
export interface WatchLink {
  /** Local mode on, the helper here and a watch paired: commands can go to it (connecting first). */
  usable: boolean;
  connected: boolean;
  /** Advertised name ("COROS PACE Pro 2F1A6C"), display name and CorosKit's label ("PACE Pro"). */
  name?: string; display?: string; model?: string; battery?: number;
  /** Why it isn't usable, for the athlete. */
  reason?: string;
}

/** COROS's task ids: eight ASCII letters, digits, "_" or "-". Empty or eight 0xFF bytes would mean every task. */
export const isMapTaskId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{8}$/.test(id);

interface Found { name: string; display: string; rssi?: number; connected?: boolean }
interface WatchInfo { name: string; display: string; model?: string; firmware?: string; battery?: number; features?: string[] }
interface SyncAnswer {
  items: { collection: string; id: string; body: string }[];
  applied: string[]; refused: string[]; problems: string[];
  watch: WatchInfo; workouts: number; healthDays: number; nights: number; weatherSent?: boolean;
}

export interface WatchHost {
  /** The store the watch writes to (never the sample athlete's), or null when the app isn't keeping one. */
  store: () => LocalStore | null;
  sealer: Sealer;
  /** Whether Local mode is on; the watch is only linked then. */
  localMode: () => boolean;
  /** The TypeScript watch engine (engine/engine.ts over clink-ble), or null where clink-ble isn't built. */
  engine: ((onEvent: (e: HelperEvent) => void, onLog: (line: string) => void) => WatchDriver) | null;
  log: (line: string) => void;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const problem = (message: string, code = "problem", status = 400) => json({ error: { code, message } }, status);
const REF = 978307200;
/** Seconds since 2001-01-01, as the phone-native bodies carry times. */
const refSeconds = (ms: number) => ms / 1000 - REF;

export class LocalWatch {
  private readonly folder: string;
  private readonly file: string;
  private readonly keyFile: string;
  private saved: Saved = { paired: null, account: null, installId: null, lastSync: null, autoSyncMinutes: 5, stepGoal: null, refused: [], weather: null, weatherSentAt: null };
  private readonly helper: WatchDriver | null;
  private connected: WatchInfo | null = null;
  private bluetooth = "unknown";
  private found: Found[] = [];
  private busy: null | "scanning" | "signingIn" | "connecting" | "syncing" | "installing" | "route" | "maps" = null;
  private step: { step: string; percent?: number } | null = null;
  private lastProblem: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private changeTimer: NodeJS.Timeout | null = null;
  /** Who hears a route transfer's progress (Maps), while one runs. */
  private routeProgress: ((phase: string, percent?: number) => void) | null = null;

  constructor(data: string, private readonly host: WatchHost) {
    this.folder = path.join(data, "watch");
    this.file = path.join(this.folder, "pairing.json");
    this.keyFile = path.join(this.folder, "key.bin");
    mkdirSync(this.folder, { recursive: true });
    try {
      if (existsSync(this.file)) {
        const { autoSyncHours, ...read } = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved> & { autoSyncHours?: number };
        this.saved = { ...this.saved, ...read };
        // Files from before minutes kept the choice in hours.
        if (read.autoSyncMinutes == null && typeof autoSyncHours === "number") this.saved.autoSyncMinutes = autoSyncHours ? 5 : 0;
        // A choice no longer offered (3, 6 or 12 hours) becomes the default.
        if (!(AUTO_SYNC_MINUTES as readonly number[]).includes(this.saved.autoSyncMinutes)) this.saved.autoSyncMinutes = 5;
      }
    } catch { /* starts unpaired */ }
    this.helper = host.engine ? host.engine((e) => this.onEvent(e), (line) => host.log(`watch engine: ${line}`)) : null;
    this.schedule();
  }

  private save(): void {
    const temp = `${this.file}.tmp`;
    try { writeFileSync(temp, JSON.stringify(this.saved, null, 2)); renameSync(temp, this.file); } catch (error) { this.host.log(`Watch pairing wasn't saved: ${String(error)}`); }
  }

  /** A new link (connected, or gone) is a new session: what was read over the old one isn't trusted after it. */
  private generation = 0;
  private setConnected(info: WatchInfo | null): void {
    if (!info || !this.connected) this.generation++;
    this.connected = info;
  }

  /** The connected watch for Developer → Activity screens (activityScreens.ts), and the session it's on. */
  activityLink(): { device: { key: string; name: string; model: string; firmware: string } | null; session: string } {
    const c = this.connected, paired = this.saved.paired;
    const device = c && paired ? { key: paired.name, name: c.display || paired.display, model: c.model ?? paired.model ?? "", firmware: c.firmware ?? "" } : null;
    return { device, session: String(this.generation) };
  }

  /** One activity-page exchange with the connected watch: read (0x9E) or write (0x9F), raw bytes. */
  async activityExchange(op: "read" | "write", payload: Buffer): Promise<Buffer> {
    if (!this.connected) throw new HelperProblem("Connect the watch first.");
    const answer = await this.need().call<{ payload: string }>("activityScreens", { op, payload: payload.toString("hex") });
    if (typeof answer.payload !== "string" || !/^([0-9a-f]{2})*$/.test(answer.payload)) throw new HelperProblem("The watch sent something unexpected.");
    return Buffer.from(answer.payload, "hex");
  }

  private onEvent(e: HelperEvent): void {
    if (e.event === "found" && typeof e.name === "string") {
      const row = e as unknown as Found;
      if (!this.found.some((f) => f.name === row.name)) this.found = [...this.found, row];
    } else if (e.event === "step" || e.event === "progress") {
      this.step = { step: String(e.step), ...(typeof e.percent === "number" ? { percent: e.percent } : {}) };
      if (e.step === "route") this.routeProgress?.(String(e.phase ?? "sending"), typeof e.percent === "number" ? e.percent : undefined);
    } else if (e.event === "disconnected") {
      this.setConnected(null);
      this.stopWatchingChanges();
    }
  }

  // ── State ──

  async status() {
    return {
      localMode: this.host.localMode(),
      available: !!this.helper,
      bluetooth: this.bluetooth,
      keySaved: existsSync(this.keyFile),
      account: this.saved.account,
      paired: this.saved.paired,
      connected: this.connected,
      busy: this.busy,
      step: this.step,
      found: this.found,
      lastSync: this.saved.lastSync,
      autoSyncMinutes: this.saved.autoSyncMinutes,
      problem: this.lastProblem,
      onComputer: this.onComputer(),
      weather: this.saved.weather,
      weatherSentAt: this.saved.weatherSentAt,
    };
  }

  private onComputer() {
    const store = this.host.store();
    if (!store) return null;
    return { activities: store.count("activity"), healthDays: store.count("health.day"), nights: store.count("health.night") };
  }

  // ── Key ──

  private async key(): Promise<string> {
    if (!existsSync(this.keyFile)) throw new HelperProblem("Sign in to COROS once to get your watch key.");
    const { text, stale } = await this.host.sealer.decrypt(await readFile(this.keyFile));
    if (stale) await writeFile(this.keyFile, await this.host.sealer.encrypt(text), { mode: 0o600 });
    return text;
  }

  private async signIn(email: string, password: string, region: Region, takeOver: boolean): Promise<void> {
    const helper = this.need();
    this.saved.installId ??= cryptoId();
    const answer = await helper.call<{ key: string; account: string }>("signIn", { email, password, region, takeOver, installId: this.saved.installId });
    await writeFile(this.keyFile, await this.host.sealer.encrypt(answer.key), { mode: 0o600 });
    this.saved.account = answer.account;
    this.save();
  }

  /**
   * The watch key and watch CorosLink had (coroslink/move.ts), taken only while none is saved here, so Local mode
   * works without signing in or pairing again. `key` is WatchAccountKey text; it is sealed before it is written.
   */
  async adopt(input: { key: string; account: string | null; paired: { name: string; display: string; model?: string } | null; weather?: WeatherPlace | null; autoSyncHours?: number | null }): Promise<boolean> {
    if (existsSync(this.keyFile) || this.busy) return false;
    parseWatchKey(input.key);
    await writeFile(this.keyFile, await this.host.sealer.encrypt(input.key), { mode: 0o600 });
    this.saved.account = input.account;
    if (!this.saved.paired && input.paired?.name.startsWith("COROS ")) this.saved.paired = { ...input.paired, pairedAt: new Date().toISOString() };
    if (!this.saved.weather && input.weather) this.saved.weather = input.weather;
    // CorosLink kept the choice in hours; here it's minutes, so on stays on (the default) and off stays off.
    if (typeof input.autoSyncHours === "number") this.saved.autoSyncMinutes = input.autoSyncHours ? 5 : 0;
    this.save();
    this.schedule();
    return true;
  }

  // ── Link ──

  private need(): WatchDriver {
    if (!this.helper) throw new HelperProblem("Local mode needs the Bluetooth helper, and this copy of C-LINK doesn't have it. Build it with cargo build --release in native/ble, then reopen C-LINK.");
    return this.helper;
  }

  private async run<T>(busy: NonNullable<LocalWatch["busy"]>, work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new HelperProblem("The watch is busy. Try again when it's done.");
    this.busy = busy;
    this.lastProblem = null;
    try { return await work(); } catch (error) {
      this.lastProblem = error instanceof Error ? error.message : String(error);
      throw error;
    } finally { this.busy = null; this.step = null; }
  }

  private async hello(): Promise<void> {
    const answer = await this.need().call<{ bluetooth: string }>("hello");
    this.bluetooth = answer.bluetooth;
    if (answer.bluetooth === "off") throw new HelperProblem("Turn on Bluetooth to connect your watch.");
    if (answer.bluetooth === "denied") throw new HelperProblem("Allow Bluetooth for C-LINK in System Settings → Privacy & Security → Bluetooth.");
  }

  private async scan(): Promise<Found[]> {
    return this.run("scanning", async () => {
      await this.hello();
      this.found = [];
      this.found = await this.need().call<Found[]>("scan", { seconds: 8 });
      return this.found;
    });
  }

  /** Connects to the paired watch (or `name`, when pairing), signed in with the saved key. */
  private async connect(name: string): Promise<WatchInfo> {
    await this.hello();
    const info = await this.need().call<WatchInfo>("connect", { name, key: await this.key() });
    this.setConnected(info);
    this.watchChanges();
    return info;
  }

  private async pair(name: string): Promise<void> {
    await this.run("connecting", async () => {
      const info = await this.connect(name);
      this.saved.paired = { name, display: info.display, model: info.model, pairedAt: new Date().toISOString() };
      this.save();
    });
    this.schedule();
    // The first sync, in the background: the page shows its progress.
    void this.sync().catch(() => undefined);
  }

  /** Connects to the paired watch if it isn't connected, in Local mode only. */
  private async ensureConnected(): Promise<void> {
    const paired = this.saved.paired;
    if (!paired) throw new HelperProblem("Pair a watch first.");
    if (!this.host.localMode()) throw new HelperProblem("Turn on Local mode to change the watch from here.");
    // A sync or connection under way (often the one the page itself started): wait for it rather than refuse.
    for (let waited = 0; this.busy && waited < 120_000; waited += 250) await new Promise((r) => setTimeout(r, 250));
    if (!this.connected) await this.run("connecting", () => this.connect(paired.name));
  }

  /** One command on the paired watch, connecting first if needed. While a sync runs, it waits behind it in the helper. */
  private async onWatch<T>(cmd: string, fields: Record<string, unknown> = {}): Promise<T> {
    await this.ensureConnected();
    return this.need().call<T>(cmd, fields);
  }

  /** Whether Studio can install on the paired watch, and if not, why (Studio's Send → Watch). */
  faceConnection(): { connected: boolean; reason?: string; model?: string } {
    if (!this.helper) return { connected: false, reason: "Installing over Bluetooth needs Local mode, which needs the Bluetooth helper." };
    if (!this.host.localMode()) return { connected: false, reason: "Installing over Bluetooth needs Local mode: turn it on from the Watch page." };
    if (!this.saved.paired) return { connected: false, reason: "Pair your watch on the Watch page to install faces over Bluetooth." };
    return { connected: true, model: this.saved.paired.model };
  }

  /** The watch's face slots and the face on screen. */
  faces(): Promise<FaceSlots> { return this.onWatch<FaceSlots>("faces"); }

  /** Installs a compiled BIN: into the first empty slot, or the chosen one if it still holds what it held when read. */
  async installFace(bin: Buffer, target?: FaceTarget): Promise<FaceSlots> {
    await this.ensureConnected();
    return this.run("installing", async () => {
      const file = path.join(this.folder, `face-${cryptoId()}.bin`);
      await writeFile(file, bin);
      try {
        return await this.need().call<FaceSlots>("install", { path: file, ...(target ? { slot: target.slot, expectedFaceId: target.expectedFaceId ?? undefined, replace: target.replace } : {}) });
      } finally { rmSync(file, { force: true }); }
    });
  }

  // ── Maps: routes and the watch's Wi-Fi map downloads ──

  /** The paired watch for Maps, read without touching the link. */
  link(): WatchLink {
    const paired = this.saved.paired;
    const base = paired ? { name: paired.name, display: paired.display, model: this.connected?.model ?? paired.model } : {};
    const connected = !!this.connected;
    const battery = this.connected?.battery;
    if (!this.helper) return { usable: false, connected, ...base, reason: "Sending to the watch over Bluetooth needs Local mode, which needs the Bluetooth helper." };
    if (!this.host.localMode()) return { usable: false, connected, ...base, reason: "Turn on Local mode on the Watch page to send to the watch over Bluetooth." };
    if (!paired) return { usable: false, connected, reason: "Pair your watch on the Watch page to send to it over Bluetooth." };
    return { usable: true, connected, ...base, ...(battery !== undefined ? { battery } : {}) };
  }

  /** The watch's route library. */
  watchRoutes(): Promise<RouteInventory> { return this.onWatch<RouteInventory>("routes"); }

  /** Sends one route (skipped when the watch holds the same track ID and CRC16), reporting progress as it goes. */
  async syncRoute(route: RouteForWatch, progress?: (phase: string, percent?: number) => void): Promise<RouteSent> {
    if (route.points.length < 2 || route.points.length > 40_000) throw new HelperProblem("A route must contain between 2 and 40,000 GPS points to sync.");
    await this.ensureConnected();
    return this.run("route", async () => {
      const file = path.join(this.folder, `route-${cryptoId()}.json`);
      await writeFile(file, JSON.stringify(route));
      this.routeProgress = progress ?? null;
      try {
        return await this.need().call<RouteSent>("syncRoute", { path: file });
      } finally {
        this.routeProgress = null;
        rmSync(file, { force: true });
      }
    });
  }

  /** Stops a route transfer between blocks; the helper answers at once, whatever it's doing. */
  async cancelRouteSync(): Promise<void> {
    if (this.busy !== "route" || !this.helper?.running) return;
    await this.helper.call("cancel").catch(() => undefined);
  }

  /** The watch's storage over Bluetooth, only while it's connected (never connects for it). */
  async storage(): Promise<WatchStorage | null> {
    if (!this.connected || !this.helper || !this.host.localMode()) return null;
    return this.need().call<WatchStorage>("storage").catch(() => null);
  }

  /** The watch's own map downloads. */
  async mapTasks(): Promise<MapTask[]> { return (await this.onWatch<{ tasks: MapTask[] }>("mapTasks")).tasks; }

  /** Whether the watch can start a map download now, and if not, why. */
  mapReadiness(): Promise<MapReadiness> { return this.onWatch<MapReadiness>("mapReady"); }

  /** Hands the watch COROS's task id (it checks it's ready first); answers the task list. */
  async startMapTask(taskId: string): Promise<MapTask[]> {
    if (!isMapTaskId(taskId)) throw new HelperProblem("COROS returned an invalid map download id.");
    await this.ensureConnected();
    return this.run("maps", async () => (await this.need().call<{ tasks: MapTask[] }>("mapStart", { taskId })).tasks);
  }

  /** Takes one download off the watch's list. Never an empty id or eight 0xFF bytes: the watch reads those as every task. */
  async removeMapTask(taskId: string): Promise<MapTask[]> {
    if (!isMapTaskId(taskId)) throw new HelperProblem("Choose a download from the watch's list.");
    await this.ensureConnected();
    return this.run("maps", async () => (await this.need().call<{ tasks: MapTask[] }>("mapRemove", { taskId })).tasks);
  }

  /** Disconnects; the pairing stays, so the next sync connects again. */
  disconnect(): void {
    this.stopWatchingChanges();
    this.helper?.stop();
    this.setConnected(null);
  }

  private unpair(): void {
    this.disconnect();
    this.saved.paired = null;
    this.saved.lastSync = null;
    this.save();
    this.schedule();
  }

  /** Local mode was turned off (Settings): the watch is let go at once, and auto-sync stops. The pairing is kept. */
  leftLocalMode(): void {
    this.disconnect();
    this.schedule();
  }

  // ── Sync ──

  /** Connects if needed, writes the waiting changes, reads the watch, and writes what it read to the store. */
  async sync(): Promise<LastSync> {
    const paired = this.saved.paired;
    if (!paired) throw new HelperProblem("Pair a watch first.");
    if (!this.host.localMode()) throw new HelperProblem("Turn on Local mode to sync with the watch here.");
    const store = this.host.store();
    if (!store) throw new HelperProblem("This app isn't keeping data on this computer.");
    return this.run("syncing", async () => {
      if (!this.connected) { this.step = { step: "searching" }; await this.connect(paired.name); }
      const changes = store.list("watch.change").map((c) => ({ id: c.id, body: JSON.stringify(c.body), version: c.version }));
      const answer = await this.need().call<SyncAnswer>("sync", {
        folder: this.folder, stepGoal: this.saved.stepGoal ?? undefined, weather: this.saved.weather ?? undefined,
        changes: changes.map(({ id, body }) => ({ id, body })),
      });
      this.setConnected(answer.watch);
      const now = Date.now();
      this.noteChanges(answer.applied, answer.refused, changes, now);
      const before = store.count("activity");
      // watch.state last, carrying what the watch refused.
      const items = answer.items.map((i) => ({ collection: i.collection, id: i.id, body: JSON.parse(i.body) as Record<string, unknown> }));
      for (const i of items) if (i.collection === "watch.state") i.body = { ...i.body, ...(this.saved.refused.length ? { refused: this.saved.refused.map((r) => ({ key: r.key, at: refSeconds(r.at) })) } : {}) };
      store.write(items);
      const last: LastSync = {
        at: new Date(now).toISOString(), workouts: answer.workouts, healthDays: answer.healthDays, nights: answer.nights,
        newActivities: Math.max(0, store.count("activity") - before), applied: answer.applied.length, refused: answer.refused.length, problems: answer.problems,
      };
      this.saved.lastSync = last;
      if (answer.weatherSent) this.saved.weatherSentAt = last.at;
      this.save();
      return last;
    });
  }

  /** Deletes the changes the watch took or refused (only if not changed again meanwhile), and notes refusals. */
  private noteChanges(applied: string[], refused: string[], changes: { id: string; version: number; body: string }[], now: number): void {
    const store = this.host.store();
    if (!store) return;
    const done = new Set([...applied, ...refused]);
    // The step goal is kept here as the iPhone keeps it, so `watch.state` carries it whatever the watch holds.
    const steps = applied.includes("goal.steps") ? (JSON.parse(changes.find((c) => c.id === "goal.steps")?.body ?? "{}") as { value?: unknown }).value : undefined;
    if (typeof steps === "number") this.saved.stepGoal = steps;
    store.write(changes.filter((c) => done.has(c.id)).map((c) => ({ collection: "watch.change", id: c.id, deleted: true as const, base: c.version })));
    if (refused.length) this.saved.refused = [...this.saved.refused, ...refused.map((key) => ({ key, at: now }))].slice(-10);
  }

  /** While connected, a change made on the Watch page goes to the watch within seconds, not at the next sync. */
  private watchChanges(): void {
    if (this.changeTimer) return;
    this.changeTimer = setInterval(() => {
      const store = this.host.store();
      if (!this.connected || this.busy || !store || store.count("watch.change") === 0) return;
      void this.sync().catch(() => undefined);
    }, 5000);
  }

  private stopWatchingChanges(): void {
    if (this.changeTimer) clearInterval(this.changeTimer);
    this.changeTimer = null;
  }

  /** Auto-sync every 5 minutes to 1 hour while Local mode is on and a watch is paired; 0 is off. */
  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const minutes = this.saved.autoSyncMinutes;
    if (!minutes || !this.saved.paired || !this.host.localMode() || !this.helper) return;
    this.timer = setInterval(() => {
      if (this.busy || !this.host.localMode()) return;
      // A watch that's away isn't an error worth keeping: the next turn tries again.
      void this.sync().catch((error: unknown) => this.host.log(`Auto-sync: ${error instanceof Error ? error.message : String(error)}`));
    }, minutes * 60_000);
  }

  /** Local mode turned on: auto-sync starts if a watch is already paired. */
  enteredLocalMode(): void { this.schedule(); }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.stopWatchingChanges();
    this.helper?.stop();
  }

  // ── Page ──

  async answer(request: Request): Promise<Response> {
    const route = new URL(request.url).pathname.slice("/api/desktop/watch".length) || "/";
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    try {
      switch (`${request.method} ${route}`) {
        case "GET /": return json(await this.status());
        case "POST /signin": {
          const email = String(body.email ?? "").trim(), password = String(body.password ?? "");
          const region = REGIONS.includes(body.region as Region) ? (body.region as Region) : "us";
          if (!email || !password) return problem("Type your COROS email and password.");
          await this.run("signingIn", () => this.signIn(email, password, region, body.takeOver === true));
          return json(await this.status());
        }
        case "POST /scan": await this.scan(); return json(await this.status());
        case "POST /pair": {
          if (!this.host.localMode()) return problem("Turn on Local mode first.");
          const name = String(body.name ?? "");
          if (!name.startsWith("COROS")) return problem("Pick a COROS watch.");
          await this.pair(name);
          return json(await this.status());
        }
        case "POST /sync": void this.sync().catch(() => undefined); return json(await this.status());
        case "POST /cancel": this.disconnect(); return json(await this.status());
        case "POST /disconnect": this.disconnect(); return json(await this.status());
        case "POST /unpair": this.unpair(); return json(await this.status());
        case "POST /forget-key": this.unpair(); rmSync(this.keyFile, { force: true }); this.saved.account = null; this.save(); return json(await this.status());
        case "POST /autosync": {
          const minutes = Number(body.minutes);
          if (!(AUTO_SYNC_MINUTES as readonly number[]).includes(minutes)) return problem("Pick off, or one of the times on the list.");
          this.saved.autoSyncMinutes = minutes;
          this.save();
          this.schedule();
          return json(await this.status());
        }
        // The watch's own settings, as the phone's Watch settings page changes them; each answer is what the watch kept.
        case "GET /settings": return json(await this.onWatch("settings"));
        case "POST /setting": {
          const key = String(body.key ?? ""), value = Number(body.value);
          if (!/^[a-zA-Z]{1,40}$/.test(key) || !Number.isInteger(value) || value < 0 || value > 15) return problem("Pick a setting and a value.");
          return json(await this.onWatch("setSwitch", { key, value }));
        }
        case "POST /profile": {
          const fields: Record<string, unknown> = {};
          for (const k of ["maxHR", "restingHR", "thresholdHR", "thresholdPace"] as const) {
            if (body[k] === undefined) continue;
            const n = Number(body[k]);
            if (!Number.isInteger(n) || n <= 0) return problem("Type whole numbers.");
            fields[k] = n;
          }
          if (body.zoneType !== undefined) {
            if (!["maxHR", "reserve", "threshold"].includes(String(body.zoneType))) return problem("Pick how the zones are set.");
            fields.zoneType = String(body.zoneType);
          }
          return json(await this.onWatch("setProfile", fields));
        }
        case "POST /sleep": {
          const bedtime = Number(body.bedtime), wake = Number(body.wake);
          const ok = (n: number) => Number.isInteger(n) && n >= 0 && n < 1440;
          if (!ok(bedtime) || !ok(wake)) return problem("Pick a bedtime and a wake time.");
          return json(await this.onWatch("setSleep", { bedtime, wake }));
        }
        case "POST /ring": return json(await this.onWatch("ring"));
        case "GET /faces": return json(await this.faces());
        case "POST /faces/show": {
          const slot = Number(body.slot), faceId = Number(body.faceId);
          if (!Number.isInteger(slot) || slot < 0 || slot > 9 || !Number.isInteger(faceId) || faceId < 0 || faceId > 0xfffffffe) return problem("Pick a face on the watch.");
          return json(await this.onWatch("showFace", { slot, faceId }));
        }
        // Where the watch's weather is for: a place picked on the Watch page, or none.
        case "POST /weather": {
          if (body.place === null) { this.saved.weather = null; this.save(); return json(await this.status()); }
          const p = (body.place ?? {}) as Record<string, unknown>;
          const latitude = Number(p.latitude), longitude = Number(p.longitude), city = String(p.city ?? "").trim().slice(0, 40);
          if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return problem("Pick a place for the weather.");
          // Two decimals (about a kilometre) is all the forecast needs, and all that leaves the computer.
          this.saved.weather = { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100, city };
          this.save();
          if (this.connected || body.sendNow === true) {
            await this.onWatch("weather", { place: this.saved.weather, folder: this.folder });
            this.saved.weatherSentAt = new Date().toISOString();
            this.save();
          }
          return json(await this.status());
        }
        // Places by name for the weather (Open-Meteo's geocoding: only the typed name leaves the computer).
        case "GET /places": {
          const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 60);
          if (q.length < 2) return json({ places: [] });
          return json({ places: await findPlaces(q) });
        }
        case "POST /weather/send": {
          if (!this.saved.weather) return problem("Pick a place for the weather first.");
          await this.onWatch("weather", { place: this.saved.weather, folder: this.folder });
          this.saved.weatherSentAt = new Date().toISOString();
          this.save();
          return json(await this.status());
        }
        default: return problem("Not a watch action.", "notFound", 404);
      }
    } catch (error) {
      if (error instanceof HelperProblem) return problem(error.message, "watch");
      this.host.log(`Watch ${route} failed: ${String(error)}`);
      return problem("That didn't work.", "internal", 500);
    }
  }
}

/** Up to five places matching a name, with the region and country to tell them apart. */
async function findPlaces(name: string): Promise<{ latitude: number; longitude: number; city: string; region: string }[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: "5", language: "en", format: "json" })}`;
  const answer = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!answer?.ok) throw new HelperProblem("Places couldn't be looked up. Check the connection.");
  const body = (await answer.json().catch(() => ({}))) as { results?: { name?: string; latitude?: number; longitude?: number; admin1?: string; country?: string }[] };
  return (body.results ?? []).filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number" && r.name)
    .map((r) => ({ latitude: r.latitude!, longitude: r.longitude!, city: r.name!, region: [r.admin1, r.country].filter(Boolean).join(", ") }));
}

const cryptoId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
