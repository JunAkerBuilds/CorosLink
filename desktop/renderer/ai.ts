// The main process's AI settings (desktop/main/ai/service.ts), as the AI page reads and changes them. Keys go in;
// nothing secret comes back out.
import { t } from "@/lib/i18n";

export type ProviderGroup = "account" | "key" | "computer";

export interface ProviderView {
  id: string; name: string; group: ProviderGroup;
  ready: boolean; model: string; account?: string; problem?: string; keyHint?: string; keyPage?: string; canForget: boolean;
  program?: string;
  /** The program's name (`claude`), when the athlete can type where it is. */
  programName?: string;
  /** A sign-in is open in the browser. */
  signingIn?: boolean;
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
  if (!response.ok || !answer) throw new AIProblem(answer?.message ?? t("That didn't work."));
  return answer;
}

export const readAI = () => call<AIStatus>("");
/** One provider again (cheaper than everything, for checking while a sign-in is open). */
export const readAIProvider = (provider: string) => call<{ provider: ProviderView }>(`/provider?provider=${encodeURIComponent(provider)}`);
/**
 * Signs in and, when the sign-in finishes later in the browser (Claude Code), waits for it: the status once signed in,
 * or the provider's problem when the sign-in closed without it.
 */
export async function signInAndWait(provider: string, every = 3000): Promise<AIStatus> {
  const status = await signInAI(provider);
  let p = status.providers.find((x) => x.id === provider);
  while (p?.signingIn && !p.ready) {
    await new Promise((r) => setTimeout(r, every));
    p = (await readAIProvider(provider)).provider;
  }
  if (!p?.ready) throw new AIProblem(p?.problem ?? t("That didn't work."));
  return p === status.providers.find((x) => x.id === provider) ? status : readAI();
}
export const listAIModels = (provider: string) => call<{ models: string[]; model: string }>(`/models?provider=${encodeURIComponent(provider)}`);
export const connectAI = (provider: string, fields: { key?: string; url?: string; model?: string }) => call<AIStatus>("/connect", { provider, ...fields });
export const pickAI = (provider: string, model?: string) => call<AIStatus>("/pick", { provider, ...(model !== undefined ? { model } : {}) });
export const signInAI = (provider: string) => call<AIStatus>("/signin", { provider });
export const forgetAI = (provider: string) => call<AIStatus>("/forget", { provider });
export const setAIModel = (provider: string, model: string) => call<AIStatus>("/model", { provider, model });
/** Where the provider's program is, when C-LINK can't find it; "" looks for it again. */
export const setAIProgram = (provider: string, program: string) => call<AIStatus>("/program", { provider, program });
export const testAI = (provider: string) => call<{ ok: true; ms: number; label: string }>("/test", { provider });
/** The power levels a model takes (lowest first), its own default, and the saved level. */
export const readAIEfforts = (provider: string, model: string) =>
  call<{ levels: string[]; default?: string; effort: string }>(`/efforts?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`);
export const setAIEffort = (provider: string, effort: string) => call<AIStatus>("/effort", { provider, effort });
export const detectLocalAI = () => call<{ url: string }>("/detect", {});
