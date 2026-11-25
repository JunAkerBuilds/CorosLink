// generate_image for Watchmaker: OpenAI's image model, with the athlete's own OpenAI key from the AI page's vault.
// Offered only while such a key is saved; the key never leaves the main process.
import { CoachModelError } from "@/server/coach/anthropic";
import type { ImageMaker } from "./tools";

const ENDPOINT = "https://api.openai.com/v1/images/generations";

export function openAIImageMaker(key: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): ImageMaker {
  return async (prompt, { transparent, size, signal }) => {
    let response: Response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-1", prompt, size, n: 1, output_format: "png", ...(transparent ? { background: "transparent" } : {}) }),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new CoachModelError("unreachable", "OpenAI couldn't be reached for the image.");
    }
    const body = (await response.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string } } | null;
    if (!response.ok) {
      if (response.status === 401) throw new CoachModelError("bad_key", "OpenAI didn't accept the key for images.");
      throw new CoachModelError("refused_request", `OpenAI didn't make the image${body?.error?.message ? `: ${body.error.message}` : ""}.`);
    }
    const b64 = body?.data?.[0]?.b64_json;
    if (!b64) throw new CoachModelError("refused_request", "OpenAI sent no image.");
    return Buffer.from(b64, "base64");
  };
}
