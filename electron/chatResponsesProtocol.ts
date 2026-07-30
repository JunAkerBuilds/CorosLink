/** Build the ChatGPT Responses request with safe reasoning summaries enabled. */
export function buildResponsesRequest(
  model: string,
  instructions: string,
  input: Record<string, unknown>[],
  tools: Record<string, unknown>[],
  includeReasoningSummary = true
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model,
    instructions,
    input,
    stream: true,
    store: false
  };
  if (includeReasoningSummary) {
    request.reasoning = { summary: "auto" };
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
