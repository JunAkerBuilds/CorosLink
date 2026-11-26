// A Coach conversation's title from its first exchange, written by the AI writer (./server/ai/writer.ts). Nothing is
// saved here: the page keeps the title with the conversation. 503 `not_set_up` until there is an AI to ask.
import type { NextRequest } from "next/server";
import { cleanTitle, TITLE_INSTRUCTIONS, titlePrompt } from "@/lib/ai/title";
import { fail, json, notReady } from "@/server/local/http";
import { callerOf } from "@/server/ai/caller";
import { aiWriter } from "@/server/ai/writer";
import { askAllowed } from "@/server/coach/access";
import { t } from "@/lib/i18n";

/** `{ question, answer }` → `{ title }`. */
export async function POST(request: NextRequest): Promise<Response> {
  const caller = await callerOf(request);
  if (caller === "forbidden") return fail(403, "forbidden", t("That request didn't come from this app."));
  if (!caller) return notReady();
  const body = (await request.json().catch(() => null)) as { question?: unknown; answer?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "", answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (!question) return fail(400, "invalid", t("There is nothing to name."));
  const writer = await aiWriter();
  if (!writer) return fail(503, "not_set_up", t("Titles need an AI."));
  if (!(await askAllowed("title:" + caller.limitKey))) return fail(429, "slow_down", t("Give it a moment."));
  try {
    const title = cleanTitle((await writer.write({ instructions: TITLE_INSTRUCTIONS, prompt: titlePrompt(question, answer), maxTokens: 40 })).text);
    return title ? json({ title }) : fail(502, "empty", t("No title came back."));
  } catch {
    return fail(502, "unreachable", t("The AI couldn't be reached."));
  }
}
