// The providers reached with a pasted key (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Qwen, MiMo) or a
// server on this computer (Ollama, LM Studio, anything OpenAI-compatible): their model lists, their Coach model,
// and the check that a key really answers.
import Anthropic from "@anthropic-ai/sdk";
import type { CoachModel } from "@/lib/coach/loop";
import { answerOnce } from "@/server/ai/host";
import { anthropicModel, CoachModelError, modelError } from "@/server/coach/anthropic";
import { chatCompletionsModel } from "@/server/coach/chatCompletions";
import { defaultModel, LOCAL_SERVERS, retiredGemini, writesText, type Provider } from "./catalog";
import { t } from "@/lib/i18n";
import { GEMINI_BASE, geminiModel, statusError as geminiError } from "./gemini";

type Fetch = typeof fetch;
const LIST_TIMEOUT_MS = 15_000;

/** Where a provider is reached: its own base, or the local server's. */
export interface Reach { key: string | null; localUrl?: string | null }

const baseOf = (p: Provider, reach: Reach): string => (p.group === "computer" ? reach.localUrl ?? LOCAL_SERVERS[0] : p.base ?? "");

function httpError(p: Provider, status: number): CoachModelError {
  if (status === 401 || status === 403) return new CoachModelError("bad_key", t("{name} didn't accept the key.", { name: p.name }));
  if (status === 402) return new CoachModelError("rate_limited", t("The {name} account is out of credit.", { name: p.name }));
  if (status === 429) return new CoachModelError("rate_limited", t("{name} is busy or the key is out of credit. Try again in a minute.", { name: p.name }));
  return new CoachModelError("overloaded", t("{name} couldn't list its models ({status}).", { name: p.name, status }));
}

/** Every text model the key (or local server) can reach, sorted by name. Throws CoachModelError. */
export async function listModels(p: Provider, reach: Reach, fetchImpl: Fetch = (...args) => fetch(...args)): Promise<string[]> {
  if (p.id === "anthropic") {
    try {
      const client = new Anthropic({ apiKey: reach.key ?? "", maxRetries: 0, timeout: LIST_TIMEOUT_MS });
      const page = await client.models.list({ limit: 100 });
      return page.data.map((m) => m.id).sort();
    } catch (error) {
      throw modelError(error);
    }
  }
  const gemini = p.id === "gemini";
  const url = gemini ? `${GEMINI_BASE}/models?pageSize=200` : `${baseOf(p, reach)}/models`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: gemini ? { "x-goog-api-key": reach.key ?? "" } : reach.key ? { Authorization: `Bearer ${reach.key}` } : {},
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch {
    throw new CoachModelError("unreachable", p.group === "computer" ? t("Nothing answered at that address. Is the server running?") : t("{name} couldn't be reached.", { name: p.name }));
  }
  if (!response.ok) {
    if (gemini) { let detail = ""; try { detail = String(((await response.json()) as { error?: { message?: string } }).error?.message ?? ""); } catch { /* none */ } throw geminiError(response.status, detail); }
    throw httpError(p, response.status);
  }
  const body = (await response.json().catch(() => null)) as { data?: { id?: unknown }[]; models?: { name?: unknown; supportedGenerationMethods?: unknown }[] } | null;
  const ids = gemini
    ? (body?.models ?? []).filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")).map((m) => String(m.name ?? "").replace(/^models\//, "")).filter((id) => id && !retiredGemini(id))
    : (body?.data ?? []).map((m) => (typeof m.id === "string" ? m.id : "")).filter(Boolean);
  return [...new Set(ids.filter(writesText))].sort();
}

/** Coach's model on this provider. */
export function keyedModel(p: Provider, reach: Reach, model: string): CoachModel {
  if (p.id === "anthropic") return anthropicModel(reach.key ?? "", model);
  if (p.id === "gemini") return geminiModel(reach.key ?? "", model);
  return chatCompletionsModel({
    url: `${baseOf(p, reach)}/chat/completions`, key: reach.key, model, name: p.name,
    tokensField: p.tokensField, extra: p.usage, ...(p.id === "openrouter" ? { headers: { "X-Title": "C-LINK" } } : {}),
  });
}

/**
 * Checks a key (or local server) and finds the model to use: the models must list, and then one must answer. A list
 * alone proves little: OpenAI lists its models for an account with no credit.
 */
export async function checkReach(p: Provider, reach: Reach, wanted: string | null): Promise<{ models: string[]; model: string }> {
  const models = await listModels(p, reach);
  const first = wanted && (models.includes(wanted) || !models.length) ? wanted : defaultModel(p, models);
  if (!first) throw new CoachModelError("refused_request", p.group === "computer" ? t("The server has no models yet. Download one first.") : t("{name} lists no models for this key.", { name: p.name }));
  const candidates = [first, ...p.preferred.filter((m) => m !== first && models.includes(m))].slice(0, 3);
  let last: unknown = null;
  for (const model of candidates) {
    try {
      await answerOnce(keyedModel(p, reach, model), { instructions: "Reply with the single word OK.", prompt: "OK?", signal: AbortSignal.timeout(p.group === "computer" ? 120_000 : 30_000) });
      return { models, model };
    } catch (error) {
      last = error;
      // A refused key or an empty account is the same for every model.
      if (error instanceof CoachModelError && (error.code === "bad_key" || error.code === "rate_limited")) break;
    }
  }
  throw last instanceof CoachModelError ? last : modelError(last);
}
