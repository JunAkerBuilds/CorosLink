// Who answers Coach and the AI notes: only the athlete's own pick in the app's AI settings (desktop/main/ai: their
// key, a ChatGPT/Claude Code/Gemini sign-in, or a model on this computer). C-LINK has no key of its own.

/** True when the scripted dev model may stand in for an AI (COACH_MODEL=mock). Never in a production build. */
export function usingMockModel(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.COACH_MODEL === "mock";
}

const memory = globalThis as typeof globalThis & { __coachAsked?: Map<string, number[]> };
const askedMap = (): Map<string, number[]> => (memory.__coachAsked ??= new Map<string, number[]>());

export const REQUESTS_PER_MINUTE = 12;

/** At most 12 questions a minute, so a page stuck in a loop can't run up the athlete's AI bill. */
export async function askAllowed(key: string): Promise<boolean> {
  const asked = askedMap(), now = Date.now();
  const recent = (asked.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= REQUESTS_PER_MINUTE) { asked.set(key, recent); return false; }
  asked.set(key, [...recent, now]);
  return true;
}
