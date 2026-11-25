// AI on the desktop: the one place the athlete picks who answers Coach, the workout notes, meal estimates and chat
// titles. It answers the AI page (/api/desktop/ai/*) and is the web code's `hostAI`, so every AI route in src/ asks
// the picked provider. Keys and tokens stay in the vault; nothing here hands one to the page.
import type { CoachModel, ExtraTools } from "@/lib/coach/loop";
import { answerOnce, type HostAI, type HostModel } from "@/server/ai/host";
import { CoachModelError } from "@/server/coach/anthropic";
import { LOCAL_SERVERS, localBase, provider, PROVIDERS, type Provider, type ProviderId } from "./catalog";
import { checkReach, keyedModel, listModels } from "./keyed";
import type { AIVault } from "./vault";

/** The power levels a model takes, lowest first, and the one it uses when none is picked. */
export interface EffortLevels { levels: string[]; default?: string }

/** A saved level is a plain name like "high" or "xhigh"; "" is the model's own default. */
const EFFORT = /^[a-z]{2,16}$/;

/** A provider the athlete signs in to (ChatGPT, the CLIs), rather than pasting a key. */
export interface AccountProvider {
  /** False for a program's own sign-in (Claude Code, the CLIs): signing out there would sign every app out. */
  readonly canSignOut?: boolean;
  /** Whether it can answer now, the account it is signed in as, and why not when it can't. */
  status(): Promise<{ ready: boolean; account?: string; problem?: string; program?: string }>;
  /** Signs in, however the provider does it (a window, a browser). Resolves once signed in. */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** The account's models; "" is the account's own default. */
  models(): Promise<string[]>;
  /** The power levels this model takes; absent or null when it has none. */
  efforts?(model: string): Promise<EffortLevels | null>;
  model(model: string, effort?: string): CoachModel;
}

export interface ProviderView {
  id: ProviderId; name: string; group: Provider["group"];
  ready: boolean; model: string; account?: string; problem?: string; keyHint?: string; keyPage?: string;
  /** The saved power level; "" is the model's own default. */
  effort: string;
  /** Where the installed program was found (Claude Code, Gemini CLI, OpenCode). */
  program?: string;
  /** Whether "Sign out" / "Forget" applies. */
  canForget: boolean;
}

export interface AIStatus { picked: ProviderId | null; localUrl: string | null; providers: ProviderView[] }

const said = (error: unknown): { code: string; message: string } =>
  error instanceof CoachModelError ? { code: error.code, message: error.message } : { code: "failed", message: error instanceof Error ? error.message : "That didn't work." };

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export class AIService implements HostAI {
  /** The athlete's MCP servers' tools for Coach (mcp.ts), set by main.ts. */
  extraTools: () => Promise<ExtraTools | null> = async () => null;

  constructor(private readonly vault: AIVault, private readonly accounts: Partial<Record<ProviderId, AccountProvider>> = {}) {}

  /** HostAI: the tools the athlete turned on, for one answer. */
  tools(): Promise<ExtraTools | null> {
    return this.extraTools();
  }

  private modelOf(p: Provider): string {
    return this.vault.current.models[p.id] ?? p.preferred[0] ?? "";
  }

  private async ready(p: Provider): Promise<boolean> {
    if (p.group === "account") return (await this.accounts[p.id]?.status())?.ready ?? false;
    if (p.group === "computer") return this.vault.current.localUrl !== null;
    return this.vault.hasSecret(p.id);
  }

  async status(): Promise<AIStatus> {
    const views = await Promise.all(PROVIDERS.map(async (p): Promise<ProviderView> => {
      const base = { id: p.id, name: p.name, group: p.group, model: this.modelOf(p), keyHint: p.keyHint, keyPage: p.keyPage, canForget: p.group !== "account" || this.accounts[p.id]?.canSignOut !== false, effort: this.vault.current.efforts[p.id] ?? "" };
      if (p.group !== "account") return { ...base, ready: await this.ready(p) };
      const account = this.accounts[p.id];
      if (!account) return { ...base, ready: false, problem: "Not in this build yet." };
      const s = await account.status().catch((error: unknown) => ({ ready: false, problem: said(error).message }));
      return { ...base, ...s };
    }));
    const { picked, localUrl } = this.vault.current;
    return { picked, localUrl, providers: views };
  }

  /** The picked provider's model, for the web code's AI routes. */
  async model(): Promise<HostModel | null> {
    const p = provider(this.vault.current.picked);
    return p ? this.modelFor(p) : null;
  }

  /** A provider's Coach model with its chosen model, or null while it isn't set up. */
  private async modelFor(p: Provider): Promise<HostModel | null> {
    if (!(await this.ready(p))) return null;
    const model = this.modelOf(p);
    const label = model ? `${p.name} · ${model}` : p.name;
    if (p.group === "account") {
      const account = this.accounts[p.id];
      if (!account) return null;
      // A saved level goes only to a model that takes it; another would refuse the request.
      const saved = this.vault.current.efforts[p.id];
      const levels = saved ? await this.effortsFor(p, model) : null;
      return { model: account.model(model, saved && levels?.levels.includes(saved) ? saved : undefined), label };
    }
    return { model: keyedModel(p, { key: await this.vault.secret(p.id), localUrl: this.vault.current.localUrl }, model), label };
  }

  private async effortsFor(p: Provider, model: string): Promise<EffortLevels | null> {
    if (p.group !== "account") return null;
    return (await this.accounts[p.id]?.efforts?.(model).catch(() => null)) ?? null;
  }

  private async models(p: Provider): Promise<string[]> {
    if (p.group === "account") return (await this.accounts[p.id]?.models()) ?? [];
    return listModels(p, { key: await this.vault.secret(p.id), localUrl: this.vault.current.localUrl });
  }

  /** /api/desktop/ai/*. */
  async answer(request: Request): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url);
    const action = pathname.slice("/api/desktop/ai".length).replace(/^\//, "");
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const p = provider(body.provider ?? searchParams.get("provider"));
    try {
      if (request.method === "GET" && action === "") return reply(await this.status());

      // Ollama's or LM Studio's own address, whichever answers on this computer.
      if (request.method === "POST" && action === "detect") {
        for (const url of LOCAL_SERVERS) {
          const found = await fetch(`${url}/models`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
          if (found) return reply({ url });
        }
        return reply({ error: "not_found", message: "No Ollama or LM Studio is running on this computer." }, 404);
      }
      if (!p) return reply({ error: "invalid", message: "Pick a provider." }, 400);

      if (request.method === "GET" && action === "models") return reply({ models: await this.models(p), model: this.modelOf(p) });

      // The power levels a model takes (the provider's own model when none is named), and the saved one.
      if (request.method === "GET" && action === "efforts") {
        const model = searchParams.get("model") ?? this.modelOf(p);
        return reply({ ...((await this.effortsFor(p, model)) ?? { levels: [] }), effort: this.vault.current.efforts[p.id] ?? "" });
      }

      if (request.method === "POST" && action === "effort") {
        const effort = typeof body.effort === "string" ? body.effort : "";
        if (effort && !EFFORT.test(effort)) return reply({ error: "invalid", message: "Pick a level." }, 400);
        this.vault.choose({ efforts: { [p.id]: effort } });
        return reply(await this.status());
      }

      if (request.method === "POST" && action === "connect") {
        // A key or a local server: checked by asking it, then kept and picked.
        if (p.group === "account") return reply({ error: "invalid", message: "Sign in instead." }, 400);
        const key = typeof body.key === "string" ? body.key.trim() : "";
        let localUrl: string | null = null;
        if (p.group === "computer") {
          localUrl = localBase(body.url);
          if (!localUrl) return reply({ error: "invalid", message: "Use an http address on this computer or network, or https." }, 400);
        } else if (!/^[\x21-\x7e]{8,400}$/.test(key)) {
          return reply({ error: "invalid", message: "That doesn't look like a key." }, 400);
        }
        const wanted = typeof body.model === "string" && body.model ? body.model : null;
        const { model } = await checkReach(p, { key: key || (p.group === "computer" ? await this.vault.secret(p.id) : null), localUrl }, wanted);
        if (key) await this.vault.setSecret(p.id, key);
        this.vault.choose({ picked: p.id, models: { [p.id]: model }, ...(localUrl ? { localUrl } : {}) });
        return reply(await this.status());
      }

      if (request.method === "POST" && action === "pick") {
        if (!(await this.ready(p))) return reply({ error: "not_ready", message: `Set up ${p.name} first.` }, 400);
        const model = typeof body.model === "string" ? body.model.slice(0, 200) : this.modelOf(p);
        this.vault.choose({ picked: p.id, models: { [p.id]: model } });
        return reply(await this.status());
      }

      // A provider's model, without changing which provider Coach uses.
      if (request.method === "POST" && action === "model") {
        if (typeof body.model !== "string") return reply({ error: "invalid", message: "Pick a model." }, 400);
        this.vault.choose({ models: { [p.id]: body.model.slice(0, 200) } });
        return reply(await this.status());
      }

      // One short answer, to show the provider works as set up.
      if (request.method === "POST" && action === "test") {
        const host = await this.modelFor(p);
        if (!host) return reply({ error: "not_ready", message: `Set up ${p.name} first.` }, 400);
        const started = Date.now();
        await answerOnce(host.model, { instructions: "Reply with the single word OK.", prompt: "OK?", signal: AbortSignal.timeout(120_000) });
        return reply({ ok: true, ms: Date.now() - started, label: host.label });
      }

      if (request.method === "POST" && action === "signin") {
        const account = this.accounts[p.id];
        if (!account) return reply({ error: "invalid", message: `${p.name} isn't in this build yet.` }, 400);
        await account.signIn();
        if (!this.vault.current.picked || this.vault.current.picked === p.id) this.vault.choose({ picked: p.id });
        return reply(await this.status());
      }

      if (request.method === "POST" && action === "forget") {
        if (p.group === "account") await this.accounts[p.id]?.signOut();
        else if (p.group === "computer") { await this.vault.setSecret(p.id, null); this.vault.choose({ localUrl: null }); }
        else await this.vault.setSecret(p.id, null);
        if (this.vault.current.picked === p.id) this.vault.choose({ picked: null });
        return reply(await this.status());
      }
    } catch (error) {
      const { code, message } = said(error);
      return reply({ error: code, message }, code === "bad_key" || code === "invalid" ? 400 : 502);
    }
    return reply({ error: "notFound" }, 404);
  }
}
