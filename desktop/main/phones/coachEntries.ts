// A saved Coach conversation (the `coach.*` items the Coach page writes) as C-LINK's phones read a timeline: CorosKit
// CoachContract's `CoachEntry`. Pure. The phone shows words, questions and notes as they are; a card is listed by its
// title, since its buttons work on the computer.
import type { CoachBlock, CoachMessage } from "@/data/coach";

/** One timeline entry, as the phone decodes it. */
export type PhoneEntry =
  | { kind: "message"; role: "user" | "assistant"; content: string; attachment?: { label: string } }
  | { kind: "coachPrompt"; prompt: { promptId: string; question: string; choices: { id: string; label: string; description?: string }[]; allowCustom: boolean; answer?: string } }
  | { kind: "toolNotice"; message: string }
  | { kind: "coachChart"; preview: { title: string } };

const isMessage = (v: unknown): v is CoachMessage => {
  const m = v as Partial<CoachMessage> | null;
  return !!m && typeof m === "object" && ((m.from === "you" && typeof (m as { text?: unknown }).text === "string") || (m.from === "coach" && Array.isArray((m as { blocks?: unknown }).blocks)));
};

function blockEntries(blocks: readonly CoachBlock[]): PhoneEntry[] {
  const out: PhoneEntry[] = [];
  let words: string[] = [];
  const flush = () => {
    const content = words.join("\n\n").trim();
    if (content) out.push({ kind: "message", role: "assistant", content });
    words = [];
  };
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    switch (block.kind) {
      case "text":
        if (typeof block.text === "string") words.push(block.text);
        break;
      case "working":
        break;
      case "failed":
        words.push([block.title, block.text].filter(Boolean).join(": "));
        break;
      case "note":
        flush();
        if (!block.forgotten && block.text) out.push({ kind: "toolNotice", message: block.text });
        break;
      case "question":
        flush();
        out.push({
          kind: "coachPrompt",
          prompt: {
            promptId: block.id, question: block.title, allowCustom: true,
            choices: (block.options ?? []).map((o) => ({ id: o.id, label: o.title, ...(o.detail ? { description: o.detail } : {}) })),
            ...(block.answered ? { answer: block.answered.text } : {}),
          },
        });
        break;
      default: {
        flush();
        const card = block as { title?: unknown; eyebrow?: unknown };
        const title = [card.eyebrow, card.title].filter((s): s is string => typeof s === "string" && s !== "").join(" · ");
        out.push({ kind: "coachChart", preview: { title: title || "Card" } });
      }
    }
  }
  flush();
  return out;
}

/** One saved message's entries: a question is one, an answer one or more (words, then each card or note). */
export function messageEntries(message: unknown): PhoneEntry[] {
  if (!isMessage(message)) return [];
  if (message.from === "you") {
    const files = message.files?.filter((f) => typeof f === "string") ?? [];
    return [{ kind: "message", role: "user", content: message.text, ...(files.length ? { attachment: { label: files.join(", ") } } : {}) }];
  }
  return blockEntries(message.blocks);
}

/** Every entry of a conversation, its messages in order. */
export function conversationEntries(messages: readonly unknown[]): PhoneEntry[] {
  return messages.flatMap(messageEntries);
}

/** The start of the last thing said, for the phone's list of conversations. */
export function previewOf(entries: readonly PhoneEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "message" && e.content.trim()) return e.content.trim().replace(/\s+/g, " ").slice(0, 140);
  }
  return undefined;
}
