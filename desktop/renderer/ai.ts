// The main process's AI settings (desktop/main/ai/service.ts), as the AI page reads and changes them. Keys go in;
// nothing secret comes back out.
export type ProviderGroup = "account" | "key" | "computer";

export interface ProviderView {
  id: string; name: string; group: ProviderGroup;
  ready: boolean; model: string; account?: string; problem?: string; keyHint?: string; keyPage?: string; canForget: boolean;
  program?: string;
  /** The saved power level; "" is the model's own default. */
  effort: string;
}

export interface AIStatus { picked: string | null; localUrl: string | null; providers: ProviderView[] }

export class AIProblem extends Error {}

async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/desktop/ai${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }
    : { cache: "no-store" });
  const answer = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok || !answer) throw new AIProblem(answer?.message ?? "That didn't work.");
  return answer;
}

export const readAI = () => call<AIStatus>("");
export const listAIModels = (provider: string) => call<{ models: string[]; model: string }>(`/models?provider=${encodeURIComponent(provider)}`);
export const connectAI = (provider: string, fields: { key?: string; url?: string; model?: string }) => call<AIStatus>("/connect", { provider, ...fields });
export const pickAI = (provider: string, model?: string) => call<AIStatus>("/pick", { provider, ...(model !== undefined ? { model } : {}) });
export const signInAI = (provider: string) => call<AIStatus>("/signin", { provider });
export const forgetAI = (provider: string) => call<AIStatus>("/forget", { provider });
export const setAIModel = (provider: string, model: string) => call<AIStatus>("/model", { provider, model });
export const testAI = (provider: string) => call<{ ok: true; ms: number; label: string }>("/test", { provider });
/** The power levels a model takes (lowest first), its own default, and the saved level. */
export const readAIEfforts = (provider: string, model: string) =>
  call<{ levels: string[]; default?: string; effort: string }>(`/efforts?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`);
export const setAIEffort = (provider: string, effort: string) => call<AIStatus>("/effort", { provider, effort });
export const detectLocalAI = () => call<{ url: string }>("/detect", {});
