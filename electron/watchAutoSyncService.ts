import { getSetting, setSetting } from "./database";
import type { WatchSyncProgress } from "./localSync/localDataTypes";
import { watchIdentityProblem, type WatchIdentityProblem } from "./watchIdentity";

/**
 * Background watch sync, as the phone app syncs whenever the watch is near:
 * while CorosLink runs in Local-Only Mode and Bluetooth is idle, it runs the
 * same sync as "Sync watch now" every few hours. A watch the user connected is
 * synced over that connection, which stays up; otherwise it connects to the
 * watch it last used and disconnects again afterwards. Off until the user
 * turns it on, because a sync also sets the watch's clock and sends the
 * training calendar.
 *
 * It connects only to the watch whose Bluetooth identity was remembered on a
 * connection the user made (watchIdentity.ts). With none remembered, or when
 * another device answers, it pauses until the user connects from the watch menu.
 */

const SETTING = "watch.autoSync";
const CHECK_MS = 5 * 60_000;
/** After a failure (watch out of range, Bluetooth off), try again sooner than the full interval. */
const RETRY_MS = 30 * 60_000;
const AUTO_SYNC_INTERVALS = [1, 3, 6, 12] as const;

export interface WatchAutoSyncState {
  enabled: boolean;
  intervalHours: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  /** What the last successful run found, for the watch menu. */
  lastResult?: Pick<WatchSyncProgress, "newActivities" | "health" | "calendar">;
  /** Waiting for a connection from the watch menu: no watch identity remembered yet, or another device answered. */
  paused?: WatchIdentityProblem;
  pausedAt?: number;
}

export interface WatchAutoSyncLink {
  /** Local-Only Mode is on (the only mode with watch sync). */
  active: () => boolean;
  /** No Bluetooth operation is running or starting (the watch may be connected). */
  idle: () => boolean;
  /** A watch to reconnect to, with its key saved. */
  ready: () => boolean;
  /** "ok" when a watch identity is remembered and a connected watch is that one (checked before anything else). */
  trusted: () => "ok" | WatchIdentityProblem;
  /** The watch is connected already (by the user): the sync uses that connection and leaves it up. */
  connected: () => boolean;
  /**
   * How many times the user has asked to connect. One during the run (e.g. a click on Connect
   * while this sync was connecting, which shares that connection) makes the connection the user's.
   */
  userConnects?: () => number;
  /**
   * Connects to the remembered watch's identity only; resolves whether it is signed in and its model syncs.
   * Rejects with a watch-identity error, before authenticating, when another device answers.
   */
  connect: () => Promise<boolean>;
  sync: () => Promise<WatchSyncProgress>;
  disconnect: () => Promise<unknown>;
  onChange: (state: WatchAutoSyncState) => void;
}

export function autoSyncState(): WatchAutoSyncState {
  try {
    const raw = getSetting(SETTING);
    const value = raw ? JSON.parse(raw) as Partial<WatchAutoSyncState> : {};
    return {
      ...value,
      paused: value.paused === "mismatch" || value.paused === "unpinned" ? value.paused : undefined,
      enabled: value.enabled === true,
      intervalHours: AUTO_SYNC_INTERVALS.includes(value.intervalHours as never) ? value.intervalHours! : 3
    };
  } catch {
    return { enabled: false, intervalHours: 3 };
  }
}

function store(state: WatchAutoSyncState): WatchAutoSyncState {
  setSetting(SETTING, JSON.stringify(state));
  return state;
}

export function setAutoSync(input: { enabled?: unknown; intervalHours?: unknown }): WatchAutoSyncState {
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("Invalid automatic sync setting.");
  if (input.intervalHours !== undefined && !AUTO_SYNC_INTERVALS.includes(input.intervalHours as never)) throw new Error("Invalid automatic sync interval.");
  const state = autoSyncState();
  return store({ ...state, ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.intervalHours !== undefined ? { intervalHours: input.intervalHours as number } : {}) });
}

/** When the next attempt is due (ms), from the last success, or sooner after a failure. */
export function nextAutoSyncAt(state: WatchAutoSyncState): number {
  const afterSuccess = (state.lastSuccessAt ?? 0) + state.intervalHours * 3_600_000;
  const failedSince = state.lastAttemptAt !== undefined && state.lastAttemptAt > (state.lastSuccessAt ?? 0);
  return failedSince ? Math.max(afterSuccess, state.lastAttemptAt! + RETRY_MS) : afterSuccess;
}

export class WatchAutoSync {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(private readonly link: WatchAutoSyncLink, private readonly now: () => number = Date.now) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One check: syncs when enabled, due, and nothing else is using Bluetooth. */
  tick(): Promise<void> {
    if (this.running) return this.running;
    const state = autoSyncState();
    if (!state.enabled || state.paused || !this.link.active() || !this.link.ready() || !this.link.idle() || this.now() < nextAutoSyncAt(state)) return Promise.resolve();
    this.running = this.run().finally(() => { this.running = undefined; });
    return this.running;
  }

  /** After a connection the user made to the remembered watch: background sync carries on. */
  resume(): void {
    const state = autoSyncState();
    if (!state.paused) return;
    this.link.onChange(store({ ...state, paused: undefined, pausedAt: undefined }));
  }

  private pause(problem: WatchIdentityProblem): void {
    this.link.onChange(store({ ...autoSyncState(), paused: problem, pausedAt: this.now() }));
  }

  private async run(): Promise<void> {
    const trust = this.link.trusted();
    if (trust !== "ok") { this.pause(trust); return; }
    const attempt = this.now();
    // A connection the user made stays up, also one the user asked for while this run was connecting;
    // one made here only for the sync is closed again afterwards.
    const userConnectsBefore = this.link.userConnects?.() ?? 0;
    const ownConnection = !this.link.connected();
    const closeOwnConnection = async () => {
      if (ownConnection && (this.link.userConnects?.() ?? 0) === userConnectsBefore) await this.link.disconnect().catch(() => undefined);
    };
    try {
      if (ownConnection && !await this.link.connect()) throw new Error("The watch needs attention: open the watch menu to reconnect it.");
      const result = await this.link.sync();
      await closeOwnConnection();
      this.link.onChange(store({
        ...autoSyncState(), lastAttemptAt: attempt, lastSuccessAt: this.now(), lastError: undefined,
        lastResult: { newActivities: result.newActivities, ...(result.health ? { health: result.health } : {}), ...(result.calendar ? { calendar: result.calendar } : {}) }
      }));
    } catch (error) {
      // Another device answered: nothing was sent to it, and the link is already closed.
      const problem = watchIdentityProblem(error);
      if (problem) { this.pause(problem); return; }
      // A watch out of range is normal; the next attempt comes after RETRY_MS.
      await closeOwnConnection();
      this.link.onChange(store({ ...autoSyncState(), lastAttemptAt: attempt, lastError: error instanceof Error ? error.message : String(error) }));
    }
  }
}
