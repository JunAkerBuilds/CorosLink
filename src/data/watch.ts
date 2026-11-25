import { fromSample, fromSynced, NotWiredError, type Loaded } from "./core";
import { discardPending, setPending, undoPending } from "./local/watch";
import { SAMPLE_WATCH } from "./sample/watch";
import { put, remove, syncView, type SyncView } from "./sync";
import { changeWrites, watchFromState, writesForChange, writesForUndo, type ChangeWrites } from "./sync/watch";
import type { Json, PendingChange } from "@/lib/watch";

export type GpsMode = "standard" | "all" | "dual";

export interface Alarm {
  id: string;
  /** 24-hour "HH:MM". */
  time: string;
  /** Days it repeats on, 0 = Sunday … 6 = Saturday. Empty rings once. */
  days: number[];
  label: string;
  on: boolean;
}

export type GoalKey = "calories" | "exercise" | "steps";

export interface Goal {
  key: GoalKey;
  name: string;
  unit: string;
  goal: number;
  /** "520 kcal so far today". */
  soFar: string;
  /** Today's count so far, in the goal's unit. */
  done: number;
  /** What one press of the minus or plus button changes the goal by. */
  step: number;
  max: number;
}

export interface Watch {
  name: string;
  synced: string;
  /** `percent` is null and `left` empty when the phone has not sent them. */
  battery: { percent: number | null; left: string };
  storage: { usedGb: number; totalGb: number } | null;
  firmware: { version: string; state: string };
  goals: Goal[];
  alarms: Alarm[];
  gpsMode: GpsMode | null;
  /** True when the app can't set the mode on this watch: the card only shows it. */
  gpsReadOnly?: boolean;
  /** `accuracy` and `battery` rank the three modes from 1 (least) to 3 (most). */
  gpsOptions: { mode: GpsMode; name: string; detail: string; accuracy: 1 | 2 | 3; battery: 1 | 2 | 3 }[];
  batteryHistory: {
    /** Day of the first reading, YYYY-MM-DD; one reading a day after it. */
    firstDay: string;
    levels: number[];
    summary: string;
    /** "4% a day". */
    perDay: string;
    alt: string;
  };
  /** Signed in: the changes waiting in the account for the phone app. Left out for the sample, whose queue is this browser's. */
  pending?: PendingChange[];
  /** What the watch refused, as one line. */
  refused?: string;
  /** Signed in and the phone has sent nothing about the watch yet. */
  empty?: boolean;
  /** The watch syncs with the desktop itself (Local mode), not through a phone. */
  viaComputer?: boolean;
}

/** The settings as the watch had them at the last sync. */
export async function loadWatch(): Promise<Loaded<Watch>> {
  const view = await syncView();
  if (!view) return fromSample(SAMPLE_WATCH);
  return fromSynced(watchFromState(view.get("watch.state", "me"), view.all("watch.change"), new Date()));
}

function write(writes: ChangeWrites): void {
  for (const p of writes.puts) put("watch.change", p.id, p.body);
  for (const id of writes.removes) remove("watch.change", id);
}

const stateOf = (view: SyncView) => ({ state: view.get("watch.state", "me"), existing: view.all("watch.change") });

/**
 * Records that a setting should become `next` (`original` is what the watch has now; going back to it drops the change).
 * Signed in, it is saved to the account as a `watch.change` item for the phone app; signed out, in this browser.
 */
export async function changeWatchSetting(key: string, original: Json, next: Json): Promise<void> {
  const view = await syncView();
  if (!view) return setPending(key, original, next);
  const { state, existing } = stateOf(view);
  if (state) write(writesForChange(state, existing, key, original, next, new Date()));
}

export async function undoWatchSetting(key: string): Promise<void> {
  const view = await syncView();
  if (!view) return undoPending(key);
  const { state, existing } = stateOf(view);
  if (state) write(writesForUndo(state, existing, key, new Date()));
}

export async function discardWatchChanges(): Promise<void> {
  const view = await syncView();
  if (!view) return discardPending();
  const { state, existing } = stateOf(view);
  write(state ? changeWrites(state, [], existing, new Date()) : { puts: [], removes: existing.map((e) => e.id) });
}

export const WATCH_NOT_CONNECTED = "The phone connection isn't built yet";

/**
 * Signed out only: hands the waiting changes to the phone app. Without an account nothing leaves this browser.
 * Signed in, changes are synced as they are made (`changeWatchSetting`) and this is not called.
 */
export async function sendPendingToPhone(count: number): Promise<never> {
  void count;
  throw new NotWiredError("watch.sync", `${WATCH_NOT_CONNECTED}. Changes stay saved in this browser and have not reached the watch.`);
}
