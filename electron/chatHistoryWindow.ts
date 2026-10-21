// How much of a Coach conversation each request carries. Long conversations
// keep their newest messages within a per-provider budget, and the model is
// told that earlier ones were left out instead of silently losing them.
import type { ChatMessage, ChatProvider } from "./types";

/** About four characters per token, as the attachment limits assume. */
const CHARS_PER_TOKEN = 4;
/** What an attached image roughly costs a request, whatever its size. */
const IMAGE_TOKENS = 1_000;

/**
 * Estimated tokens of transcript per request. Local models run the smallest
 * contexts; OpenRouter models vary, so they get a middle budget.
 */
export const CHAT_HISTORY_TOKEN_BUDGETS: Record<ChatProvider, number> = {
  chatgpt: 48_000,
  "claude-code": 48_000,
  "gemini-cli": 48_000,
  openrouter: 32_000,
  local: 8_000
};

export interface ChatHistoryWindow {
  messages: ChatMessage[];
  /** How many of the oldest messages were left out. */
  omitted: number;
}

export function estimateChatMessageTokens(message: ChatMessage): number {
  return (
    Math.ceil(message.content.length / CHARS_PER_TOKEN) +
    (message.images?.length ?? 0) * IMAGE_TOKENS
  );
}

/** The newest messages that fit the budget; the latest message always goes. */
export function fitChatHistory(
  messages: ChatMessage[],
  budgetTokens: number
): ChatHistoryWindow {
  let start = messages.length;
  let used = 0;
  while (start > 0) {
    const cost = estimateChatMessageTokens(messages[start - 1]);
    if (start < messages.length && used + cost > budgetTokens) break;
    used += cost;
    start -= 1;
  }
  return start === 0
    ? { messages, omitted: 0 }
    : { messages: messages.slice(start), omitted: start };
}

/** Tells the model the transcript starts partway through; empty when nothing was left out. */
export function chatHistoryNote(omitted: number): string {
  if (omitted <= 0) return "";
  return (
    "## Conversation history\n" +
    `The ${omitted === 1 ? "earliest message" : `${omitted} earliest messages`} of this conversation ` +
    `${omitted === 1 ? "was" : "were"} left out to keep the request small. If the athlete refers to something ` +
    "you cannot see, say so and ask them to repeat it instead of guessing."
  );
}
