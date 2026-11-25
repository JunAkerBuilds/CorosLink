// The TypeScript watch engine: what Local mode asks of the watch, answered over clink-ble. It takes the same commands
// and gives the same answers and events as the CorosKit helper (the retired clink-watch helper's main.swift), so
// desktop/main/watch/service.ts drives either.
import { CorosError } from "./bytes";
import { displayName, FEATURES, firmwareLabel, supports, targetOf, type DeviceInfo } from "./models";
import { WatchSession } from "./session";
import { localeUses12HourClock, parseWatchKey } from "./systemBind";
import { BleLink, type BleSpawner } from "./transport";
import { HelperProblem, type HelperEvent, type WatchDriver } from "../helper";
import { signIn } from "./accountLogin";
import { activityScreensCommand } from "./activityScreens";
import { installCommand, readFaces, showFaceCommand } from "./faces";
import { Kept } from "./kept";
import { mapReady, mapRemove, mapStart, mapTasks, storageCommand } from "./maps";
import { readRoutesCommand, routeCancel, syncRouteCommand } from "./routes";
import { sync } from "./sync";
import { ringWatch } from "./watchData";
import { applyChanges, settingsRead, setProfile, setSleep, setSwitch, type PendingChange } from "./watchSettings";
import { sendWeatherIfDue, weatherPlace } from "./weather";

export class WatchEngine implements WatchDriver {
  private readonly link: BleLink;
  private session: WatchSession | null = null;
  /** Commands run one at a time, in order, as the helper ran them; `cancel` is answered at once. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Set by `cancel`, read by a face install between blocks (a route reads routeCancel). */
  private installCancelled = false;

  constructor(start: BleSpawner, private readonly onEvent: (e: HelperEvent) => void, private readonly onLog: (line: string) => void = () => {}) {
    this.link = new BleLink(start, (line) => this.onLog(`clink-ble: ${line}`));
    this.link.onEvent = (e) => {
      if (e.event === "disconnected") {
        this.session = null;
        this.onEvent({ event: "disconnected", reason: typeof e.detail?.reason === "string" ? e.detail.reason : "The watch disconnected." });
      }
    };
  }

  /** The engine runs inside the app; clink-ble starts on first use. */
  get running(): boolean { return true; }

  async call<T>(cmd: string, fields: Record<string, unknown> = {}): Promise<T> {
    if (cmd === "cancel") {
      routeCancel.set(true);
      this.installCancelled = true;
      return { cancelled: true } as T;
    }
    const run = this.queue.then(() => this.run(cmd, fields), () => this.run(cmd, fields));
    this.queue = run.catch(() => {});
    try {
      return (await run) as T;
    } catch (error) {
      throw error instanceof HelperProblem ? error : new HelperProblem(error instanceof Error ? error.message : String(error));
    }
  }

  stop(): void {
    this.session = null;
    this.link.stop();
  }

  private requireSession(): WatchSession {
    if (!this.session || !this.link.isConnected) throw new CorosError("The watch isn't connected.");
    return this.session;
  }

  private emit = (event: Record<string, unknown>): void => { this.onEvent(event as HelperEvent); };

  private async run(cmd: string, fields: Record<string, unknown>): Promise<unknown> {
    switch (cmd) {
      case "hello":
        return { bluetooth: await this.link.hello() };
      case "scan": {
        const found = (await this.link.scan()).filter((w) => w.name.startsWith("COROS")).sort((a, b) => (b.rssi ?? -200) - (a.rssi ?? -200));
        const rows = found.map((w) => ({ name: w.name, display: displayName(w.name), connected: false, ...(w.rssi === undefined ? {} : { rssi: w.rssi }) }));
        for (const row of rows) this.onEvent({ event: "found", ...row });
        return rows;
      }
      case "signIn":
        // The COROS sign-in the iPhone uses for its watch key. Only the key comes back; the password and COROS's
        // session token are dropped here.
        return signIn(fields);
      case "connect": {
        const name = typeof fields.name === "string" ? fields.name : "";
        const keyText = typeof fields.key === "string" ? fields.key : "";
        if (!name || !keyText) throw new CorosError("A watch name and the watch key are needed.");
        return this.connect(name, keyText);
      }
      case "status": {
        if (!this.session || !this.link.isConnected) return { connected: false };
        await this.link.refreshBattery();
        return { ...describe(this.link.info), connected: true };
      }
      case "sync": {
        if (typeof fields.folder !== "string") throw new CorosError("No folder to keep the watch's files in.");
        const session = this.requireSession();
        return sync({
          session, info: () => this.link.info, isConnected: () => this.link.isConnected, describe, emit: this.emit,
        }, {
          kept: new Kept(fields.folder),
          changes: Array.isArray(fields.changes) ? fields.changes as PendingChange[] : [],
          stepGoal: Number.isInteger(fields.stepGoal) ? fields.stepGoal as number : undefined,
          weather: weatherPlace(fields.weather),
        });
      }
      case "apply": {
        const session = this.requireSession();
        const changes = Array.isArray(fields.changes) ? fields.changes as PendingChange[] : [];
        return applyChanges(session, this.link.info, changes, () => this.link.isConnected, () => this.emit({ event: "progress", step: "changes" }));
      }
      case "settings":
        return settingsRead(this.requireSession(), this.link.info);
      case "setSwitch": {
        if (typeof fields.key !== "string" || !Number.isInteger(fields.value)) throw new CorosError("Which setting, and to what?");
        return { switches: await setSwitch(this.requireSession(), fields.key, fields.value as number) };
      }
      case "setProfile":
        return { profile: await setProfile(this.requireSession(), fields) };
      case "setSleep": {
        if (!Number.isInteger(fields.bedtime) || !Number.isInteger(fields.wake)) throw new CorosError("Pick a bedtime and a wake time.");
        return { sleep: await setSleep(this.requireSession(), fields.bedtime as number, fields.wake as number) };
      }
      case "weather": {
        const place = weatherPlace(fields.place);
        if (!place) throw new CorosError("Pick a place for the weather.");
        if (!supports(this.link.info, "weather")) throw new CorosError("This watch gets its weather from the COROS app.");
        const session = this.requireSession();
        const folder = typeof fields.folder === "string" ? new Kept(fields.folder).folder : null;
        return { sent: await sendWeatherIfDue(session, place, folder, true) };
      }
      case "faces":
        return readFaces(this.requireSession());
      case "showFace":
        return showFaceCommand(this.requireSession(), fields);
      case "install": {
        const session = this.requireSession();
        this.installCancelled = false;
        return installCommand(session, fields, this.emit, () => this.installCancelled);
      }
      case "routes":
        // The watch's route library (0xAA): slots with track IDs and CRCs; the watch keeps no names there.
        return readRoutesCommand(this.requireSession());
      case "syncRoute":
        // One route from a file the app wrote (and removes); `cancel` stops it between blocks.
        return syncRouteCommand(this.requireSession(), fields, this.emit);
      case "storage":
        return storageCommand(this.requireSession());
      case "mapTasks":
        return mapTasks(this.requireSession());
      case "mapReady":
        return mapReady(this.requireSession());
      case "mapStart":
        return mapStart(this.requireSession(), fields);
      case "mapRemove":
        return mapRemove(this.requireSession(), fields);
      case "activityScreens":
        // Developer mode's Activity screens (watch/activityScreens.ts): read (V3 0x9E) or written (0x9F).
        return activityScreensCommand(this.requireSession(), fields);
      case "ring":
        // Rings until the watch's back button is pressed (WatchFinding).
        return { status: await ringWatch(this.requireSession()) };
      case "disconnect":
        this.session = null;
        await this.link.disconnect();
        return { connected: false };
      default:
        throw new CorosError("Unknown command.");
    }
  }

  /** Finds the watch by its advertised name, connects, signs in with the account key and sets its clock. */
  private async connect(name: string, keyText: string): Promise<Record<string, unknown>> {
    const key = parseWatchKey(keyText);
    this.session = null;
    await this.link.disconnect();
    this.onEvent({ event: "step", step: "searching" });
    await this.link.connect(name);
    this.onEvent({ event: "step", step: "signingIn" });
    const session = new WatchSession(this.link, (line) => this.onLog(`watch: ${line}`));
    try {
      await session.authenticate(key);
    } catch (error) {
      await this.link.disconnect();
      throw error;
    }
    this.session = session;
    // The 12/24-hour setting comes from this computer, as the iPhone's comes from the iPhone.
    await session.setClock(localeUses12HourClock()).catch((e: unknown) => this.onLog(`watch: clock not set: ${e instanceof Error ? e.message : e}`));
    return describe(this.link.info);
  }
}

/** The watch as the helper describes it (CorosKit helper's `describe`). */
export function describe(info: DeviceInfo): Record<string, unknown> {
  const out: Record<string, unknown> = { name: info.name, display: displayName(info.name) };
  const target = targetOf(info);
  if (target) out.model = target.label;
  const firmware = firmwareLabel(info);
  if (firmware) out.firmware = firmware;
  if (info.batteryPercent !== undefined) out.battery = info.batteryPercent;
  out.features = FEATURES.filter((f) => supports(info, f));
  return out;
}
