// Developer mode: a Developer menu and page, and sample data. Sample data is a second store of its own
// (sample.db), signed in as another viewer, so turning it on never mixes with or touches the real data, and phones
// keep syncing to the real store meanwhile.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedItems } from "@/data/sampleSeed";
import { LocalStore } from "./localStore";

export interface DevSettings {
  /** The Developer menu and page. On by default when running from source. */
  devMode: boolean;
  /** The app shows the sample athlete instead of the data on this computer. */
  sample: boolean;
}

export const REAL_VIEWER = { id: "local", handle: "you", displayName: "You", avatarUrl: null };
export const SAMPLE_VIEWER = { id: "sample", handle: "sample", displayName: "Sample athlete", avatarUrl: null };

export class DevMode {
  private readonly file: string;
  private settings: DevSettings;
  private sampleStore: LocalStore | null = null;
  /** The day the sample athlete was seeded for, read from sample.json once. */
  private seededFor: string | null | undefined;

  constructor(private readonly folder: string, readonly real: LocalStore, defaults: DevSettings) {
    this.file = path.join(folder, "developer.json");
    let saved: Partial<DevSettings> = {};
    try { if (existsSync(this.file)) saved = JSON.parse(readFileSync(this.file, "utf8")) as Partial<DevSettings>; } catch { /* starts from the defaults */ }
    this.settings = { ...defaults, ...saved };
  }

  get state(): DevSettings & { sampleItems: number | null } {
    return { ...this.settings, sampleItems: this.sampleStore?.size ?? null };
  }

  /** The store the app reads now, and who it is signed in as there. */
  get current(): { store: LocalStore; viewer: typeof REAL_VIEWER } {
    return this.settings.sample ? { store: this.sample(), viewer: SAMPLE_VIEWER } : { store: this.real, viewer: REAL_VIEWER };
  }

  /**
   * The sample store, filled with the sample athlete the first time, and again on the first use of each new day so
   * its latest workout and today's readings stay dated today.
   */
  private sample(now = new Date()): LocalStore {
    this.sampleStore ??= new LocalStore(path.join(this.folder, "sample.db"));
    if (this.sampleStore.size === 0) this.seedSample(now, false);
    else if (this.sampleDay() !== localDay(now)) this.seedSample(now, true);
    return this.sampleStore;
  }

  private seedSample(now: Date, replace: boolean): void {
    if (replace) this.sampleStore!.replaceWith(seedItems(now));
    else this.sampleStore!.seed(seedItems(now));
    this.seededFor = localDay(now);
    writeFileSync(this.sampleFile, JSON.stringify({ day: this.seededFor }));
  }

  private get sampleFile(): string { return path.join(this.folder, "sample.json"); }

  /** The day the sample athlete was last seeded for. */
  private sampleDay(): string | null {
    if (this.seededFor === undefined) {
      try { this.seededFor = (JSON.parse(readFileSync(this.sampleFile, "utf8")) as { day?: string }).day ?? null; } catch { this.seededFor = null; }
    }
    return this.seededFor;
  }

  set(change: Partial<DevSettings>): DevSettings {
    this.settings = { ...this.settings, ...change };
    // Setup's "Just look around" turns sample data on without developer mode; leaving developer mode turns it off.
    if (change.devMode === false) this.settings.sample = false;
    writeFileSync(this.file, JSON.stringify(this.settings, null, 2));
    return this.settings;
  }

  /** The sample athlete again, with today's dates. */
  resetSample(now = new Date()): void {
    this.sampleStore ??= new LocalStore(path.join(this.folder, "sample.db"));
    this.seedSample(now, this.sampleStore.size > 0);
  }

  /** For tests: the sample store as it reads at `now`. */
  sampleAt(now: Date): LocalStore { return this.sample(now); }
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
