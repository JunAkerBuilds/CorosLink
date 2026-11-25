// A short title for a Coach conversation, written by the AI from its first question and answer, as CorosLink did.
// Pure.

export const TITLE_MAX = 48;

export const TITLE_INSTRUCTIONS =
  "You name Coach conversations. Given the athlete's first question and the Coach's answer, reply with a short, specific title of 2 to 5 words " +
  "in the language of the question, like \"Tempo week tweaks\" or \"Knee pain after long run\". Reply with the title only: no quotes, no emoji, " +
  "no trailing punctuation.";

export const titlePrompt = (question: string, answer: string): string => `Question:\n${question.slice(0, 1500)}\n\nAnswer:\n${answer.slice(0, 1500)}`;

/** The title in a reply: its first line, without a "Title:" label, markdown, quotes or a full stop. Null if none. */
export function cleanTitle(reply: string): string | null {
  const line = reply.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const title = line
    .replace(/^(?:title|titre|titel|título|标题|タイトル)\s*[:：]\s*/i, "")
    .replace(/[*_`#]/g, "")
    .replace(/[\s.。!！?？,，;；:："'“”‘’「」『』]+$/, "")
    .replace(/^["'“”‘’「」『』]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX).trimEnd()}…` : title;
}
