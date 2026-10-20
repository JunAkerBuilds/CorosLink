import type { ChatMessage } from "./types";

/** Build the ChatGPT Responses request with safe reasoning summaries enabled. */
export function buildResponsesRequest(
  model: string,
  instructions: string,
  input: Record<string, unknown>[],
  tools: Record<string, unknown>[],
  includeReasoningSummary = true,
  reasoningEffort?: string
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model,
    instructions,
    input,
    stream: true,
    store: false
  };
  if (includeReasoningSummary) {
    request.reasoning = {
      summary: "auto",
      ...(reasoningEffort ? { effort: reasoningEffort } : {})
    };
  }
  if (tools.length > 0) {
    request.tools = tools;
    request.tool_choice = "auto";
  }
  return request;
}

/** Pull incremental assistant output text from a Responses SSE event. */
export function extractResponseTextDelta(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const evt = event as { type?: string; delta?: unknown };
  return evt.type === "response.output_text.delta" &&
    typeof evt.delta === "string"
    ? evt.delta
    : "";
}

/** Pull a display-safe reasoning summary delta (never raw chain-of-thought). */
export function extractReasoningSummaryDelta(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const evt = event as { type?: string; delta?: unknown };
  return evt.type === "response.reasoning_summary_text.delta" &&
    typeof evt.delta === "string"
    ? evt.delta
    : "";
}

/** A COROS message turned into a Responses-API input item. */
export function toInputMessageItem(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: message.content }]
    };
  }
  return {
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text: message.content },
      // Attached images follow the text, each named so the model can refer to it.
      ...(message.images ?? []).flatMap((image) => [
        { type: "input_text", text: `Image: ${image.label}` },
        { type: "input_image", image_url: `data:${image.mimeType};base64,${image.base64}` }
      ])
    ]
  };
}
