// Coach's model: Claude through the Anthropic SDK, one streamed request per round of the loop in
// `@/lib/coach/loop`. The key is the athlete's own (desktop/main/ai/keyed.ts); it is used for this request and
// kept nowhere else.
import Anthropic from "@anthropic-ai/sdk";
import type { CoachModel, ModelMessage, ModelRequest, ModelTurn } from "@/lib/coach/loop";
import { textFileBlock, type UserPart } from "@/lib/coach/files";

export const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** What went wrong with the model, in words for the athlete, and whether their key is the cause. */
export class CoachModelError extends Error {
  constructor(public readonly code: "bad_key" | "rate_limited" | "overloaded" | "refused_request" | "unreachable", message: string) {
    super(message);
    this.name = "CoachModelError";
  }
}

export function modelError(error: unknown): CoachModelError {
  if (error instanceof CoachModelError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new CoachModelError("bad_key", "Anthropic didn't accept the AI key.");
  if (error instanceof Anthropic.RateLimitError) return new CoachModelError("rate_limited", "The AI key has hit its rate limit. Try again in a minute.");
  if (error instanceof Anthropic.BadRequestError) return new CoachModelError("refused_request", "Anthropic refused the request, so Coach couldn't answer.");
  if (error instanceof Anthropic.APIConnectionError) return new CoachModelError("unreachable", "Anthropic couldn't be reached.");
  if (error instanceof Anthropic.APIError) return new CoachModelError("overloaded", "Anthropic is having trouble right now. Try again shortly.");
  return new CoachModelError("unreachable", "Coach's model couldn't be reached.");
}

/** Files in the athlete's question as Claude's image, document and text blocks; everything else unchanged. */
export function toAnthropic(messages: readonly ModelMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (m.role !== "user" || !Array.isArray(m.content) || !(m.content as { type?: string }[]).some((p) => p?.type === "file")) return m as Anthropic.MessageParam;
    const content = (m.content as UserPart[]).map((p): Anthropic.ContentBlockParam => {
      if (p.type === "text") return { type: "text", text: p.text };
      const f = p.file;
      if (f.kind === "image") return { type: "image", source: { type: "base64", media_type: f.mime as "image/png", data: f.data } };
      if (f.kind === "pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name };
      return { type: "text", text: textFileBlock(f) };
    });
    return { role: "user", content };
  });
}

export function anthropicModel(apiKey: string, model: string = DEFAULT_MODEL): CoachModel {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
  // Refusal fallbacks are asked for first; an account or model that doesn't take the parameter gets the plain request.
  let fallbacks = true;

  async function once(request: ModelRequest): Promise<Anthropic.Message> {
    const params: Anthropic.MessageStreamParams = {
      model,
      max_tokens: MAX_TOKENS,
      // The rules are the same for every athlete and every answer: cached. The athlete's context follows, uncached.
      system: [{ type: "text", text: request.rules, cache_control: { type: "ephemeral" } }, ...(request.context ? [{ type: "text" as const, text: request.context }] : [])],
      ...(request.tools.length ? { tools: request.tools.map((tool) => ({ ...tool, eager_input_streaming: true })), tool_choice: request.allowTools ? { type: "auto" as const } : { type: "none" as const } } : {}),
      messages: toAnthropic(request.messages),
      // Effort is taken by the Opus and Fable models; the others refuse it.
      ...(/opus|fable/.test(model) ? { output_config: { effort: "medium" as const } } : {}),
    };
    const options = { signal: request.signal };
    if (fallbacks) {
      try {
        type BetaParams = Parameters<typeof client.beta.messages.stream>[0];
        const stream = client.beta.messages.stream({ ...(params as unknown as BetaParams), betas: [FALLBACK_BETA], fallbacks: "default" } as BetaParams, options);
        stream.on("text", request.onText);
        return (await stream.finalMessage()) as unknown as Anthropic.Message;
      } catch (error) {
        if (!(error instanceof Anthropic.BadRequestError)) throw error;
        fallbacks = false;
      }
    }
    const stream = client.messages.stream(params, options);
    stream.on("text", request.onText);
    return stream.finalMessage();
  }

  return {
    async turn(request): Promise<ModelTurn> {
      let message: Anthropic.Message | null = null;
      // With eager input streaming a tool input that can't be parsed rejects the stream: that turn is asked again.
      for (let attempt = 0; !message; attempt++) {
        try {
          message = await once(request);
        } catch (error) {
          if (request.signal?.aborted) throw error;
          if (error instanceof Anthropic.APIError || attempt >= 2) throw modelError(error);
        }
      }
      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
      const usage = message.usage;
      return {
        content: message.content, text, calls,
        stop: message.stop_reason === "refusal" ? "refusal" : message.stop_reason === "max_tokens" ? "max_tokens" : calls.length ? "tools" : message.stop_reason === "end_turn" ? "end" : "other",
        inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens ?? 0,
      };
    },
  };
}
