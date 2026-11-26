// Coach's model over any OpenAI-style chat-completions API: the athlete's own OpenAI, DeepSeek, OpenRouter… key or a
// model on their computer (desktop/main/ai/keyed.ts). One streamed request per round of the loop in
// `@/lib/coach/loop`, with Coach's tools as functions. The loop's messages are Anthropic-shaped (tool results as
// `tool_result` blocks); they are turned into OpenAI-shaped ones here and nowhere else.
import type { CoachModel, ModelMessage, ModelRequest, ModelTurn, ToolCall } from "@/lib/coach/loop";
import { textFileBlock, type UserPart } from "@/lib/coach/files";
import { CoachModelError } from "./anthropic";
import { t } from "@/lib/i18n";

const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 150_000;

/** One chat-completions API and model. */
export interface ChatEndpoint {
  url: string;
  /** Sent as a bearer token; a model on this computer may need none. */
  key: string | null;
  model: string;
  /** Who answers, in the athlete's words ("OpenAI"). */
  name: string;
  /** Newer OpenAI models take only `max_completion_tokens`. */
  tokensField?: "max_tokens" | "max_completion_tokens";
  /** Extra fields of every request, such as how to report usage. */
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
}

type OAContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "file"; file: { filename: string; file_data: string } })[];
interface OAToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
type OAMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: OAContent }
  | { role: "assistant"; content: string | null; tool_calls?: OAToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** What a turn hands back to the loop as the assistant's content: the OpenAI message itself, marked. */
interface Kept { openai: OAMessage }
const isKept = (c: unknown): c is Kept => typeof c === "object" && c !== null && !Array.isArray(c) && "openai" in c;

function userContent(parts: UserPart[]): OAContent {
  return parts.map((p) => {
    if (p.type === "text") return { type: "text" as const, text: p.text };
    const f = p.file;
    if (f.kind === "image") return { type: "image_url" as const, image_url: { url: `data:${f.mime};base64,${f.data}` } };
    if (f.kind === "pdf") return { type: "file" as const, file: { filename: f.name, file_data: `data:application/pdf;base64,${f.data}` } };
    return { type: "text" as const, text: textFileBlock(f) };
  });
}

/** The loop's messages as OpenAI chat messages, after Coach's rules and the athlete's context. */
export function toOpenAI(request: Pick<ModelRequest, "rules" | "context" | "messages">): OAMessage[] {
  const out: OAMessage[] = [{ role: "system", content: request.rules }, { role: "system", content: request.context }];
  for (const m of request.messages as ModelMessage[]) {
    if (m.role === "assistant") {
      out.push(isKept(m.content) ? m.content.openai : { role: "assistant", content: typeof m.content === "string" ? m.content : "" });
      continue;
    }
    if (typeof m.content === "string") { out.push({ role: "user", content: m.content }); continue; }
    const parts = Array.isArray(m.content) ? (m.content as { type?: string }[]) : [];
    if (parts.some((p) => p?.type === "tool_result")) {
      for (const r of parts as { type: string; tool_use_id: string; content: string; is_error?: boolean }[]) {
        if (r.type === "tool_result") out.push({ role: "tool", tool_call_id: r.tool_use_id, content: r.is_error && !r.content.startsWith("Error") ? `Error: ${r.content}` : r.content });
      }
    } else {
      out.push({ role: "user", content: userContent(parts as UserPart[]) });
    }
  }
  return out;
}

function statusError(status: number, detail: string, at: Pick<ChatEndpoint, "name">): CoachModelError {
  if (status === 401 || status === 403) return new CoachModelError("bad_key", t("{name} didn't accept the key.", { name: at.name }));
  if (status === 402) return new CoachModelError("rate_limited", t("The {name} account is out of credit.", { name: at.name }));
  if (status === 429) return new CoachModelError("rate_limited", t("The AI is busy right now. Try again in a minute."));
  if (status === 400 || status === 404) return new CoachModelError("refused_request", detail ? t("The AI refused the request: {detail}.", { detail }) : t("The AI refused the request."));
  return new CoachModelError("overloaded", t("The AI is having trouble right now. Try again shortly."));
}

type Fetch = typeof fetch;

export function chatCompletionsModel(at: ChatEndpoint, fetchImpl: Fetch = (...args) => fetch(...args)): CoachModel {
  return {
    async turn(request: ModelRequest): Promise<ModelTurn> {
      const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(request.signal ? [request.signal] : [])];
      let response: Response;
      try {
        response = await fetchImpl(at.url, {
          method: "POST",
          headers: { ...(at.key ? { Authorization: `Bearer ${at.key}` } : {}), "Content-Type": "application/json", Accept: "text/event-stream", ...at.headers },
          body: JSON.stringify({
            model: at.model, stream: true, [at.tokensField ?? "max_tokens"]: MAX_TOKENS, ...at.extra,
            messages: toOpenAI(request),
            // No tools at all when none are offered: some local servers refuse the field.
            ...(request.tools.length ? {
              tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })),
              tool_choice: request.allowTools ? "auto" : "none",
            } : {}),
          }),
          cache: "no-store", redirect: "manual", signal: AbortSignal.any(signals),
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        throw new CoachModelError("unreachable", `${at.name} couldn't be reached.`);
      }
      if (!response.ok || !response.body) {
        let detail = "";
        try { const body = (await response.json()) as { error?: { message?: unknown } }; detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 160) : ""; } catch {}
        throw statusError(response.status, detail, at);
      }

      let text = "", finish: string | null = null, inputTokens = 0, outputTokens = 0, buffer = "";
      const calls: { id: string; name: string; args: string }[] = [];
      const reader = response.body.getReader(), decoder = new TextDecoder();
      const take = (line: string) => {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") return;
        let chunk: {
          error?: { message?: string; code?: number };
          choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try { chunk = JSON.parse(data); } catch { return; }
        if (chunk.error) throw statusError(typeof chunk.error.code === "number" ? chunk.error.code : 500, String(chunk.error.message ?? "").slice(0, 160), at);
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) { text += delta.content; request.onText(delta.content); }
        for (const part of delta?.tool_calls ?? []) {
          const i = part.index ?? calls.length;
          const call = (calls[i] ??= { id: "", name: "", args: "" });
          if (part.id) call.id = part.id;
          if (part.function?.name) call.name += part.function.name;
          if (part.function?.arguments) call.args += part.function.arguments;
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (chunk.usage) { inputTokens = chunk.usage.prompt_tokens ?? inputTokens; outputTokens = chunk.usage.completion_tokens ?? outputTokens; }
      };
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
        if (error instanceof CoachModelError || request.signal?.aborted) throw error;
        throw new CoachModelError("unreachable", t("The AI's answer was cut off. Try again."));
      }

      const toolCalls: ToolCall[] = calls.filter((c) => c && c.name).map((c, k) => {
        let input: unknown;
        try { input = c.args.trim() ? JSON.parse(c.args) : {}; } catch { input = { unreadable_arguments: c.args.slice(0, 400) }; }
        return { id: c.id || `call_${k}`, name: c.name, input };
      });
      const kept: Kept = {
        openai: {
          role: "assistant", content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
        },
      };
      return {
        content: kept, text: text.trim(), calls: toolCalls,
        stop: finish === "content_filter" ? "refusal" : finish === "length" ? "max_tokens" : toolCalls.length ? "tools" : finish === "stop" ? "end" : "other",
        inputTokens, outputTokens,
      };
    },
  };
}
