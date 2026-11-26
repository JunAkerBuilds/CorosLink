// A meal estimate for the Fuel page: a sentence, a photo, or both, in; the foods in it out, for the athlete to check
// and log. Nothing is saved here. It asks the athlete's own AI (./server/ai/writer.ts) and answers 503 `not_set_up`
// until there is one.
import type { NextRequest } from "next/server";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/coach/files";
import { mealInstructions, mealPrompt, parseMeal } from "@/lib/ai/meal";
import { languageTag } from "@/lib/ai/workoutNote";
import { fail, json, notReady } from "@/server/local/http";
import { callerOf } from "@/server/ai/caller";
import { AIError, aiWriter } from "@/server/ai/writer";
import { askAllowed } from "@/server/coach/access";
import { t } from "@/lib/i18n";

const MAX_BODY = 8_000_000;

/** `{ text?, photo?: { mime, data (base64) }, language }` → `{ foods, note }`. */
export async function POST(request: NextRequest): Promise<Response> {
  const caller = await callerOf(request);
  if (caller === "forbidden") return fail(403, "forbidden", t("That request didn't come from this app."));
  if (!caller) return notReady();
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, "too_large", t("That photo is too big. Send a smaller one."));
  let asked: Record<string, unknown> | null = null;
  try { const parsed: unknown = JSON.parse(raw); if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) asked = parsed as Record<string, unknown>; } catch { /* invalid */ }
  const text = typeof asked?.text === "string" ? asked.text.trim().slice(0, 1000) : "";
  const photo = asked?.photo as { mime?: unknown; data?: unknown } | undefined;
  const image = photo && typeof photo.mime === "string" && (IMAGE_TYPES as readonly string[]).includes(photo.mime) && typeof photo.data === "string" && /^[A-Za-z0-9+/=]+$/.test(photo.data) && photo.data.length * 0.75 <= MAX_IMAGE_BYTES
    ? { name: "meal", mime: photo.mime, kind: "image" as const, data: photo.data } : null;
  if (photo && !image) return fail(400, "invalid", t("That photo can't be read. Use a JPEG or PNG under 5 MB."));
  const language = languageTag(asked?.language) ?? "en-GB";
  if (!text && !image) return fail(400, "invalid", t("Describe the meal or add a photo."));

  const writer = await aiWriter();
  if (!writer) return fail(503, "not_set_up", t("Meal estimates need an AI. Set one up first."));
  if (!(await askAllowed("meal:" + caller.limitKey))) return fail(429, "slow_down", t("That's a lot of estimates in a minute. Give it a moment."));

  try {
    const answer = await writer.write({ instructions: "You estimate meals for an athlete's nutrition log. Answer with JSON only.", prompt: `${mealInstructions(language)}\n\n${mealPrompt(text, !!image)}`, files: image ? [image] : [], maxTokens: 1500 });
    const estimate = parseMeal(answer.text, () => crypto.randomUUID().toUpperCase());
    if (!estimate) return fail(502, "unreadable", t("The AI's estimate couldn't be read. Try again."));
    return json(estimate);
  } catch (error) {
    const known = error instanceof AIError ? error : new AIError("unreachable", t("The AI couldn't be reached."));
    return fail(known.code === "rate_limited" ? 429 : 502, known.code, known.message);
  }
}
