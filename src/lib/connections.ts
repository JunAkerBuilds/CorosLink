// The words and counts on the Profile and connections page (`/connect`). Pure: every value comes in as an
// argument, so the page can never show something the app doesn't hold.
import { locale, msg, t } from "@/lib/i18n";

export type Tone = "ok" | "quiet" | "bad";
export type MonoHue = "coral" | "blue" | "pink" | "amber" | "mint" | "grey";

/** Which AI Coach answers with, as `CoachAccessInfo["key"]` names it. */
export type CoachKeyKind = "own" | "mock" | "none";

export const COACH_KEY_WORDS: Record<CoachKeyKind, string> = {
  own: msg("Your own AI"), mock: msg("Scripted dev model, not an AI"), none: msg("None yet"),
};

/** Coach has a real AI behind it, the athlete's own pick; the scripted dev model is not a connection. */
export const coachKeyConnected = (key: CoachKeyKind): boolean => key === "own";

/** How many of the page's connections are on. A state that isn't known yet (null, undefined) counts as off. */
export function connectedCount(states: readonly (boolean | null | undefined)[]): number {
  return states.filter((state) => state === true).length;
}

/** The Hevy card's pill. A sync that failed is said on the pill; the saved key still counts as a connection. */
export function hevyPill(hevy: { connected: boolean; syncing: boolean; syncProblem: string | null }): { tone: Tone; text: string } {
  if (!hevy.connected) return { tone: "quiet", text: t("Not connected") };
  if (hevy.syncing) return { tone: "quiet", text: t("Syncing…") };
  if (hevy.syncProblem) return { tone: "bad", text: t("Couldn't sync") };
  return { tone: "ok", text: t("Connected") };
}

/** "Read 40 workouts so far" while a sync runs; null before the first page is in. */
export function hevyProgress(read: number | null): string | null {
  if (read == null) return null;
  return t("Read {n} so far", { n: read.toLocaleString(locale("en-US")) });
}

/** "128 workouts", "1 workout"; null when nothing is cached. */
export function hevyCachedLabel(workouts: number | null): string | null {
  if (workouts == null) return null;
  return workouts === 1 ? t("1 workout") : t("{n} workouts", { n: workouts.toLocaleString(locale("en-US")) });
}

export interface ElsewhereRow { mono: string; hue: MonoHue; name: string; line: string; where: string }

/** What only the phone app sets up. `watchName` is the watch the phone reported; without one the row says "Your watch". */
export function managedOnPhone(watchName: string | null | undefined): ElsewhereRow[] {
  const where = t("In the C-LINK app");
  return [
    { mono: "AH", hue: "pink", name: "Apple Health", line: t("Sleep, HRV and resting heart rate. Never uploaded."), where },
    { mono: "W", hue: "mint", name: watchName?.trim() || t("Your watch"), line: t("Watch pairing, watch key and syncing"), where },
    { mono: "RC", hue: "blue", name: t("Coach on a computer"), line: t("Pairing with C-LINK Desktop"), where },
  ];
}
