// The AI the athlete picked in Coach settings (desktop/main/ai/service.ts): their own key, a sign-in, or a model
// running on this computer. It is the only AI there is: C-LINK has no key of its own.
import type { CoachModel, ExtraTools } from "@/lib/coach/loop";
import type { CoachFile } from "@/lib/coach/files";
import { withFiles } from "@/lib/coach/files";

export interface HostModel {
  model: CoachModel;
  /** Who answers, for the screens: "ChatGPT · gpt-5.5". */
  label: string;
}

export interface HostAI {
  /** The picked model, or null when none is set up yet. */
  model(): Promise<HostModel | null>;
  /** Tools the athlete added on that computer (MCP servers), for Coach's answers; null or absent for none. */
  tools?(): Promise<ExtraTools | null>;
}

export const hostAI: { current: HostAI | null } = { current: null };

/** One answer in words from a Coach model: no tools, nothing streamed. Photos go with the prompt when given. */
export async function answerOnce(model: CoachModel, input: { instructions: string; prompt: string; files?: readonly CoachFile[]; signal?: AbortSignal }): Promise<{ text: string; tokens: number }> {
  const turn = await model.turn({
    rules: input.instructions, context: "", tools: [], allowTools: false, onText: () => {}, signal: input.signal,
    messages: [{ role: "user", content: withFiles(input.prompt, input.files ?? []) }],
  });
  return { text: turn.text, tokens: turn.inputTokens + turn.outputTokens };
}
