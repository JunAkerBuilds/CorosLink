import { fromSample, fromSynced, type Loaded } from "@/data/core";
import { ownMeasurements } from "@/data/local/body";
import { BODY_SAMPLE } from "@/data/sample/body";
import { newUuid, put, remove, syncView, type SyncView } from "@/data/sync";
import { bodyFromItems, goalsWithWeight, measurementBody, measurementWrite, movedId, ownMeasurements as typedMeasurements, phoneWeight, profileWithEdit, profileWithWeight } from "@/data/sync/body";
import { mergeMeasurements } from "@/lib/body";

/** One weigh-in. Body fat is there when the scale gives it. */
export interface Measurement {
  /** YYYY-MM-DD */
  day: string;
  weightKg: number;
  bodyFatPct?: number;
}

/** A measurement the person typed in here, saved in this browser. */
export interface OwnMeasurement extends Measurement {
  id: string;
}

/** "custom" is the phone app's own daily calorie number; it can't be chosen here, only kept. */
export type GoalKind = "lose" | "maintain" | "gain" | "custom";
export const GOAL_LABEL: Record<GoalKind, string> = { lose: "Lose slowly", maintain: "Maintain", gain: "Gain slowly", custom: "Own calorie target" };

/** Each is null when signed in and the phone hasn't sent it. */
export interface BodyProfile {
  heightCm: number | null;
  age: number | null;
  goal: GoalKind | null;
  goalWeightKg: number | null;
  /** kcal a day at rest, estimated by the phone app. */
  restingKcal: number | null;
}

/** The parts of the profile that can be edited at a desk. */
export interface ProfileEdit { heightCm?: number; goal?: GoalKind; goalWeightKg?: number }

export interface BodyAge {
  value: number;
  /** YYYY-MM-DD. The next two are left out when signed in and the phone didn't send them. */
  asOf?: string;
  nextUpdate?: string;
}

export type Hue = "rose" | "cyan" | "sky" | "blue" | "mint" | "gold" | "violet";

/** A nightly reading from the watch against the person's usual. */
export interface Signal {
  name: string;
  detail: string;
  pill: string;
  hue: Hue;
  values: number[];
}

/** A watch-derived number with its recent trend. */
export interface WatchStat {
  name: string;
  value: string;
  unit: string;
  note: string;
  hue: Hue;
  values: number[];
}

export interface BodyData {
  /** The sample athlete's "today". */
  sampleDay: string;
  profile: BodyProfile;
  /** Null when signed in and the phone hasn't worked one out. */
  bodyAge: BodyAge | null;
  /** The phone app's words for the night. Not synced: left out when signed in. */
  headline?: string;
  advice?: string;
  signals: Signal[];
  stats: WatchStat[];
  /** The sample history, or when signed in the phone's latest weight (the only weight it syncs). */
  measurements: Measurement[];
  /** Signed in: the measurements typed here, kept in the account. Signed out they are in this browser. */
  own?: OwnMeasurement[];
}

/**
 * Measurements typed in before signing in move to the account once: each becomes an item under its own id (so two
 * loaders moving at once write the same thing), a day the account already has keeps the account's, then the browser's are cleared.
 */
function moveBrowserMeasurements(view: SyncView): boolean {
  const saved = ownMeasurements.get();
  if (saved.length === 0) return false;
  const taken = new Map(view.all("body.measurement").map((i) => [i.body?.day, i.id]));
  for (const m of saved) {
    const id = movedId(m, newUuid);
    const there = taken.get(m.day);
    if (there == null || there === id) put("body.measurement", id, measurementBody(m));
  }
  ownMeasurements.clear();
  return true;
}

export async function loadBody(): Promise<Loaded<BodyData>> {
  let view = await syncView();
  if (!view) return fromSample(BODY_SAMPLE);
  if (moveBrowserMeasurements(view)) view = (await syncView()) ?? view;
  return fromSynced(bodyFromItems({
    view: view.get("view.body", "me"),
    goals: view.get("body.goals", "me"),
    profile: view.get("fuel.profile", "me"),
    measurements: view.all("body.measurement"),
    days: view.all("health.day").map((i) => i.body),
    training: view.get("view.training", "me"),
  }, new Date()));
}

// MARK: Edits when signed in. Each writes items; the screen re-reads through `loadBody`.

async function signedIn(): Promise<SyncView> {
  const view = await syncView();
  if (!view) throw new Error("C-LINK is still starting. Try again in a moment.");
  return view;
}

/** Saves a measurement to the account, replacing the one already on that day. */
export async function saveSyncedMeasurement(m: Measurement): Promise<void> {
  const view = await signedIn();
  const write = measurementWrite(view.all("body.measurement"), m, newUuid());
  for (const id of write.remove) remove("body.measurement", id);
  put("body.measurement", write.id, write.body);
  // The phones read weight from the Fuel profile: the newest typed weight goes there too.
  const profile = view.get("fuel.profile", "me");
  const nextProfile = profile ? profileWithWeight(profile, view.all("body.measurement"), write.body) : null;
  if (nextProfile) put("fuel.profile", "me", nextProfile);
}

export async function deleteSyncedMeasurement(id: string): Promise<void> {
  await signedIn();
  remove("body.measurement", id);
}

/**
 * Height and goal go to the Fuel profile (only when the phone has set one up: weight, age and sex are never made
 * up here), the goal weight to the body goals, counted from the latest weight.
 */
export async function saveSyncedProfile(edit: ProfileEdit): Promise<void> {
  const view = await signedIn();
  const profile = view.get("fuel.profile", "me");
  const nextProfile = profile ? profileWithEdit(profile, edit) : null;
  if (nextProfile) put("fuel.profile", "me", nextProfile);
  if (edit.goalWeightKg == null) return;
  const phone = phoneWeight(view.get("view.body", "me"));
  const current = mergeMeasurements(phone ? [phone] : [], typedMeasurements(view.all("body.measurement"))).at(-1)?.weightKg ?? profile?.weightKg;
  if (current == null) throw new Error("Add a measurement first, so the goal has a weight to start from.");
  const goals = goalsWithWeight(view.get("body.goals", "me"), edit.goalWeightKg, current, new Date());
  if (goals) put("body.goals", "me", goals);
}
