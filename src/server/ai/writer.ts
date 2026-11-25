// Who writes the short AI texts (workout notes, meal estimates, chat titles): the athlete's own pick in the app's AI
// settings (desktop/main/ai). Null until they pick one.
import type { CoachFile } from "@/lib/coach/files";
import { CoachModelError } from "@/server/coach/anthropic";
import { answerOnce, hostAI } from "./host";

export class AIError extends Error {
  constructor(public readonly code: "bad_key" | "rate_limited" | "unreachable" | "empty", message: string) {
    super(message);
    this.name = "AIError";
  }
}

export interface WriteInput { instructions: string; prompt: string; files?: readonly CoachFile[]; maxTokens?: number }

export interface Writer {
  /** The model's name, kept with what it wrote. */
  label: string;
  /** One answer in words. Throws AIError. */
  write(input: WriteInput): Promise<{ text: string; tokens: number }>;
}

const asAIError = (error: unknown): AIError => {
  if (error instanceof AIError) return error;
  if (error instanceof CoachModelError) {
    const code = error.code === "bad_key" ? "bad_key" : error.code === "rate_limited" ? "rate_limited" : "unreachable";
    return new AIError(code, error.message);
  }
  return new AIError("unreachable", "The AI couldn't be reached.");
};

export async function aiWriter(): Promise<Writer | null> {
  const host = await hostAI.current?.model();
  if (!host) return null;
  return {
    label: host.label,
    write: (input) => answerOnce(host.model, input).catch((error: unknown) => { throw asAIError(error); }),
  };
}
