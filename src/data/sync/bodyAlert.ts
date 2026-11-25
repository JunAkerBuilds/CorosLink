// Body Alert and Illness mode from synced items (contract: body.alert, body.illness). Pure.
import type { BodyAlertBody, BodyIllnessBody } from "./native";
import { calendarDayKey, msToRef, refToMs } from "./native";
import type { BodyAlertData, Spell } from "@/lib/bodyAlert";

const STATES = ["learning", "normal", "watch", "strain", "strainHigh", "recovering"] as const;
const CLASSES = ["noData", "statusOnly", "normal", "deviating", "strong"] as const;
const SIGNALS = ["heart", "hrv", "breathing"] as const;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The phone's Body Alert, checked; null when the phone hasn't sent one. */
export function alertFromItem(body: BodyAlertBody | undefined): BodyAlertData | null {
  if (!body || typeof body !== "object") return null;
  const state = STATES.includes(body.state) ? body.state : "learning";
  const nights = (Array.isArray(body.nights) ? body.nights : []).slice(-28).flatMap((n) => {
    if (!n?.day || !finite(n.day.year)) return [];
    return [{
      day: calendarDayKey(n.day),
      state: STATES.includes(n.state) ? n.state : state,
      nightClass: CLASSES.includes(n.nightClass) ? n.nightClass : "noData",
      level: finite(n.level) ? n.level : 0,
      signals: (Array.isArray(n.signals) ? n.signals : []).filter((s) => SIGNALS.includes(s?.signal as never) && finite(s.value) && finite(s.usual))
        .map((s) => ({ signal: s.signal, channel: String(s.channel ?? ""), value: s.value, usual: s.usual, spread: finite(s.spread) ? s.spread : 0, z: finite(s.z) ? s.z : 0 })),
    }];
  });
  return { on: body.on !== false, state, nightsLearned: finite(body.nightsLearned) ? Math.max(0, Math.min(14, body.nightsLearned)) : 0, nights };
}

/** Illness mode's spells in ms. */
export const spellsFromItem = (body: BodyIllnessBody | undefined): Spell[] =>
  (body?.spells ?? []).filter((s) => finite(s?.start)).map((s) => ({ start: refToMs(s.start), ...(finite(s.end) ? { end: refToMs(s.end) } : {}) }));

/** The item for new spells, keeping what else the phone stored (its `confirmedAt`). */
export const illnessBody = (spells: readonly Spell[], had: BodyIllnessBody | undefined): BodyIllnessBody => ({
  ...(had ?? {}),
  spells: spells.map((s) => ({ start: msToRef(s.start), ...(s.end != null ? { end: msToRef(s.end) } : {}) })),
});
