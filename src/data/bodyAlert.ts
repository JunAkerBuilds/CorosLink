import { fromSample, fromSynced, type Loaded } from "./core";
import { createStore } from "./local/store";
import { put, syncView } from "./sync";
import { alertFromItem, illnessBody, spellsFromItem } from "./sync/bodyAlert";
import { illnessToggled, type BodyAlertData, type Spell } from "@/lib/bodyAlert";

export interface BodyAlertPage {
  /** Null when signed in and the phone hasn't sent Body Alert (an older phone app, or never worked out). */
  alert: BodyAlertData | null;
  /** Illness mode's spells, newest last, in ms. */
  spells: Spell[];
}

/** Illness mode when signed out, kept in this browser. */
export const browserSpells = createStore<Spell[]>("body.illness", []);

export async function loadBodyAlert(): Promise<Loaded<BodyAlertPage>> {
  const view = await syncView();
  if (view) return fromSynced({ alert: alertFromItem(view.get("body.alert", "me")), spells: spellsFromItem(view.get("body.illness", "me")) });
  const { sampleBodyAlert } = await import("./sample/bodyAlert");
  return fromSample({ alert: sampleBodyAlert(), spells: browserSpells.get() });
}

/**
 * Turns Illness mode on or off. Signed in it goes to the account, and the phone follows at its next sync (it sets
 * readiness, Fuel and Coach to rest there too); signed out it stays in this browser.
 */
export async function setIllnessMode(on: boolean, now = Date.now()): Promise<void> {
  const view = await syncView();
  if (!view) { browserSpells.set((s) => illnessToggled(s, on, now)); return; }
  const had = view.get("body.illness", "me");
  put("body.illness", "me", illnessBody(illnessToggled(spellsFromItem(had), on, now), had));
}
