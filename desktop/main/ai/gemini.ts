// Coach's model on Google's Gemini API with the athlete's own key: one streamed generateContent request per round
// of the loop. The loop's Anthropic-shaped messages become Gemini `contents` here; a model turn is handed back as
// Gemini's own parts, so its function calls (and their thought signatures) go back to it unchanged.
import type { CoachModel, ModelMessage, ModelRequest, ModelTurn, ToolCall } from "@/lib/coach/loop";
import { textFileBlock, type UserPart } from "@/lib/coach/files";
import { CoachModelError } from "@/server/coach/anthropic";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 150_000;
const MAX_TOKENS = 16_000;

type Part =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { id?: string; name: string; args?: unknown }; thoughtSignature?: string }
  | { functionResponse: { id?: string; name: string; response: { result: string } | { error: string } } };
interface Content { role: "user" | "model"; parts: Part[] }

/** A model turn as the loop keeps it. */
interface Kept { gemini: Content }
const isKept = (c: unknown): c is Kept => typeof c === "object" && c !== null && "gemini" in c;

function userParts(parts: UserPart[]): Part[] {
  return parts.map((p): Part => {
    if (p.type === "text") return { text: p.text };
    if (p.file.kind === "text") return { text: textFileBlock(p.file) };
    return { inlineData: { mimeType: p.file.kind === "pdf" ? "application/pdf" : p.file.mime, data: p.file.data } };
  });
}

/** The loop's messages as Gemini contents. Tool results name their function, from the call they answer. */
export function toGemini(messages: readonly ModelMessage[]): Content[] {
  const names = new Map<string, string>();
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      if (isKept(m.content)) {
        for (const p of m.content.gemini.parts) if ("functionCall" in p && p.functionCall.id) names.set(p.functionCall.id, p.functionCall.name);
        out.push(m.content.gemini);
      } else out.push({ role: "model", parts: [{ text: typeof m.content === "string" ? m.content : "" }] });
      continue;
    }
    if (typeof m.content === "string") { out.push({ role: "user", parts: [{ text: m.content }] }); continue; }
    const parts = Array.isArray(m.content) ? (m.content as { type?: string }[]) : [];
    if (parts.some((p) => p?.type === "tool_result")) {
      out.push({
        role: "user",
        parts: (parts as { type: string; tool_use_id: string; content: string; is_error?: boolean }[]).filter((r) => r.type === "tool_result").map((r) => ({
          functionResponse: { id: r.tool_use_id, name: names.get(r.tool_use_id) ?? "tool", response: r.is_error ? { error: r.content } : { result: r.content } },
        })),
      });
    } else out.push({ role: "user", parts: userParts(parts as UserPart[]) });
  }
  return out;
}

export function statusError(status: number, detail: string): CoachModelError {
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(detail))) return new CoachModelError("bad_key", "Google didn't accept the key.");
  if (status === 429) return new CoachModelError("rate_limited", "The Gemini key has hit its limit. Try again in a minute.");
  if (status === 400 || status === 404) return new CoachModelError("refused_request", `Gemini refused the request${detail ? `: ${detail}` : ""}.`);
  return new CoachModelError("overloaded", "Gemini is having trouble right now. Try again shortly.");
}

type Fetch = typeof fetch;

export function geminiModel(key: string, model: string, fetchImpl: Fetch = (...args) => fetch(...args)): CoachModel {
  return {
    async turn(request: ModelRequest): Promise<ModelTurn> {
      const system = [request.rules, request.context].filter(Boolean).join("\n\n");
      let response: Response;
      try {
        response = await fetchImpl(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: toGemini(request.messages),
            ...(request.tools.length ? {
              tools: [{ functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }],
              toolConfig: { functionCallingConfig: { mode: request.allowTools ? "AUTO" : "NONE" } },
            } : {}),
            generationConfig: { maxOutputTokens: MAX_TOKENS },
          }),
          cache: "no-store", redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(request.signal ? [request.signal] : [])]),
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        throw new CoachModelError("unreachable", "Gemini couldn't be reached.");
      }
      if (!response.ok || !response.body) {
        let detail = "";
        try { const body = (await response.json()) as { error?: { message?: unknown } }; detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 160) : ""; } catch { /* no detail */ }
        throw statusError(response.status, detail);
      }

      const parts: Part[] = [];
      let text = "", finish = "", inputTokens = 0, outputTokens = 0, buffer = "";
      const take = (line: string) => {
        if (!line.startsWith("data:")) return;
        let chunk: { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; promptFeedback?: { blockReason?: string } };
        try { chunk = JSON.parse(line.slice(5)); } catch { return; }
        if (chunk.promptFeedback?.blockReason) finish = "SAFETY";
        const candidate = chunk.candidates?.[0];
        for (const p of candidate?.content?.parts ?? []) {
          parts.push(p);
          if ("text" in p && !p.thought && p.text) { text += p.text; request.onText(p.text); }
        }
        if (candidate?.finishReason) finish = candidate.finishReason;
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
          outputTokens = (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0);
        }
      };
      const reader = response.body.getReader(), decoder = new TextDecoder();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) take(line.trim());
        }
        take(buffer.trim());
      } catch (error) {
        if (request.signal?.aborted) throw error;
        throw new CoachModelError("unreachable", "Gemini's answer was cut off. Try again.");
      }

      // Each call gets an id of its own when Gemini sends none, so its result can be matched to it.
      const calls: ToolCall[] = [];
      parts.forEach((p, k) => {
        if (!("functionCall" in p)) return;
        p.functionCall.id ||= `call_${k}`;
        calls.push({ id: p.functionCall.id, name: p.functionCall.name, input: p.functionCall.args ?? {} });
      });
      // Streamed text arrives in pieces: kept as one part, with the function calls as they came.
      const kept: Kept = { gemini: { role: "model", parts: [...(text ? [{ text }] : []), ...parts.filter((p) => "functionCall" in p)] } };
      return {
        content: kept, text: text.trim(), calls,
        stop: finish === "SAFETY" || finish === "PROHIBITED_CONTENT" ? "refusal" : finish === "MAX_TOKENS" ? "max_tokens" : calls.length ? "tools" : finish === "STOP" ? "end" : "other",
        inputTokens, outputTokens,
      };
    },
  };
}
