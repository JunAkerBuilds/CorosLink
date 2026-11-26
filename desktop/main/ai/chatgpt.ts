// ChatGPT with the athlete's own ChatGPT account, as CorosLink did it: the Codex CLI's sign-in (OAuth with PKCE and
// a loopback redirect on port 1455) and ChatGPT's Codex Responses endpoint. CorosLink's own note on it: this reuses
// the Codex app's client and is a grey area under OpenAI's terms; the athlete picks it knowingly.
// The token is kept in the vault (encrypted) and refreshed here; it never reaches the page.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { CoachModel, ModelMessage, ModelRequest, ModelTurn, ToolCall } from "@/lib/coach/loop";
import { textFileBlock, type UserPart } from "@/lib/coach/files";
import { CoachModelError } from "@/server/coach/anthropic";
import type { AccountProvider, EffortLevels } from "./service";
import { t } from "@/lib/i18n";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const SCOPE = "openid profile email offline_access";
const PORT = 1455;
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const MODELS_URL = "https://chatgpt.com/backend-api/codex/models?client_version=0.162.0";
const ORIGINATOR = "codex_cli_rs";
const SIGN_IN_MS = 10 * 60_000;
const TIMEOUT_MS = 180_000;
/** Used when the account's list can't be read. */
const FALLBACK_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];

export interface ChatGPTToken { access: string; refresh: string; expiresAt: number; accountId: string | null; email: string | null }

/** What the main process gives this provider: where the token is kept, and a sign-in window. */
export interface ChatGPTHost {
  load(): Promise<string | null>;
  save(value: string | null): Promise<void>;
  /** Shows the sign-in page, calling `onClosed` if the athlete closes it; returns a function that closes it. */
  openSignIn(url: string, state: string, onClosed: () => void): () => void;
}

const b64url = (b: Buffer) => b.toString("base64url");

function claims(idToken: unknown): Record<string, unknown> {
  if (typeof idToken !== "string") return {};
  try { return JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>; } catch { return {}; }
}

/** The token as kept, from OpenAI's token answer. */
export function tokenFrom(body: Record<string, unknown>, previous: ChatGPTToken | null, now = Date.now()): ChatGPTToken {
  if (typeof body.access_token !== "string") throw new CoachModelError("bad_key", t("ChatGPT didn't sign in. Try again."));
  const c = claims(body.id_token);
  const auth = (c["https://api.openai.com/auth"] ?? {}) as { chatgpt_account_id?: unknown };
  return {
    access: body.access_token,
    refresh: typeof body.refresh_token === "string" ? body.refresh_token : previous?.refresh ?? "",
    expiresAt: now + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
    accountId: typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id : previous?.accountId ?? null,
    email: typeof c.email === "string" ? c.email : previous?.email ?? null,
  };
}

async function tokenRequest(form: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new CoachModelError("unreachable", t("ChatGPT couldn't be reached."));
  }
  if (!response.ok) throw new CoachModelError("bad_key", t("ChatGPT's sign-in ended. Sign in again."));
  return (await response.json()) as Record<string, unknown>;
}

/* ───────────── The Responses API ───────────── */

type Item = Record<string, unknown>;
interface Kept { chatgpt: Item[] }
const isKept = (c: unknown): c is Kept => typeof c === "object" && c !== null && "chatgpt" in c;

function userContent(parts: UserPart[]): Item[] {
  return parts.map((p): Item => {
    if (p.type === "text") return { type: "input_text", text: p.text };
    const f = p.file;
    if (f.kind === "image") return { type: "input_image", image_url: `data:${f.mime};base64,${f.data}` };
    if (f.kind === "pdf") return { type: "input_file", filename: f.name, file_data: `data:application/pdf;base64,${f.data}` };
    return { type: "input_text", text: textFileBlock(f) };
  });
}

/** The loop's messages as Responses input items. */
export function toResponses(messages: readonly ModelMessage[]): Item[] {
  const out: Item[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      if (isKept(m.content)) out.push(...m.content.chatgpt);
      else out.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: typeof m.content === "string" ? m.content : "" }] });
      continue;
    }
    if (typeof m.content === "string") { out.push({ type: "message", role: "user", content: [{ type: "input_text", text: m.content }] }); continue; }
    const parts = Array.isArray(m.content) ? (m.content as { type?: string }[]) : [];
    if (parts.some((p) => p?.type === "tool_result")) {
      for (const r of parts as { type: string; tool_use_id: string; content: string }[]) if (r.type === "tool_result") out.push({ type: "function_call_output", call_id: r.tool_use_id, output: r.content });
    } else out.push({ type: "message", role: "user", content: userContent(parts as UserPart[]) });
  }
  return out;
}

function statusError(status: number, detail: string): CoachModelError {
  if (status === 401 || status === 403) return new CoachModelError("bad_key", t("ChatGPT's sign-in ended. Sign in again on the AI page."));
  if (status === 429) return new CoachModelError("rate_limited", t("This ChatGPT account has reached its usage limit for now."));
  if (status === 400 && /not supported/i.test(detail)) return new CoachModelError("refused_request", t("That model isn't on this ChatGPT plan. Pick another on the AI page."));
  if (status === 400) return new CoachModelError("refused_request", `ChatGPT refused the request${detail ? `: ${detail.slice(0, 160)}` : ""}.`);
  return new CoachModelError("overloaded", t("ChatGPT is having trouble right now. Try again shortly."));
}

type Fetch = typeof fetch;

interface CatalogModel {
  slug?: unknown; visibility?: unknown; supported_in_api?: unknown; priority?: unknown;
  supported_reasoning_levels?: unknown; default_reasoning_level?: unknown;
}

/** A catalog model's reasoning levels: [{ effort: "low" }, …] or plain names. */
export function effortsOf(m: CatalogModel): EffortLevels {
  const levels = (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [])
    .map((l: unknown) => (l && typeof l === "object" ? (l as { effort?: unknown }).effort : l))
    .filter((l): l is string => typeof l === "string" && /^[a-z]{2,16}$/.test(l));
  const fallback = typeof m.default_reasoning_level === "string" && levels.includes(m.default_reasoning_level) ? m.default_reasoning_level : undefined;
  return { levels, ...(fallback ? { default: fallback } : {}) };
}

export function chatgptModel(token: () => Promise<ChatGPTToken>, model: () => Promise<string>, fetchImpl: Fetch = (...args) => fetch(...args), effort?: string): CoachModel {
  return {
    async turn(request: ModelRequest): Promise<ModelTurn> {
      const tok = await token();
      const tools = request.allowTools ? request.tools : [];
      let response: Response;
      try {
        response = await fetchImpl(RESPONSES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tok.access}`, "Content-Type": "application/json", Accept: "text/event-stream",
            "OpenAI-Beta": "responses=experimental", originator: ORIGINATOR, "User-Agent": ORIGINATOR, session_id: randomBytes(16).toString("hex"),
            ...(tok.accountId ? { "chatgpt-account-id": tok.accountId } : {}),
          },
          body: JSON.stringify({
            model: await model(), instructions: [request.rules, request.context].filter(Boolean).join("\n\n"), input: toResponses(request.messages), stream: true, store: false,
            ...(effort ? { reasoning: { effort } } : {}),
            ...(tools.length ? { tools: tools.map((x) => ({ type: "function", name: x.name, description: x.description, parameters: x.input_schema, strict: false })), tool_choice: "auto" } : {}),
          }),
          redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(request.signal ? [request.signal] : [])]),
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        throw new CoachModelError("unreachable", t("ChatGPT couldn't be reached."));
      }
      if (!response.ok || !response.body) throw statusError(response.status, await response.text().catch(() => ""));

      let text = "", status = "", inputTokens = 0, outputTokens = 0, buffer = "", failure: CoachModelError | null = null;
      const kept: Item[] = [], calls: ToolCall[] = [];
      const take = (frame: string) => {
        const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("");
        if (!data || data === "[DONE]") return;
        let event: { type?: string; delta?: unknown; item?: Item; response?: { status?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string }; incomplete_details?: { reason?: string } } };
        try { event = JSON.parse(data); } catch { return; }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") { text += event.delta; request.onText(event.delta); }
        else if (event.type === "response.output_item.done" && event.item) {
          const item = event.item;
          if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
            kept.push({ type: "function_call", call_id: item.call_id, name: item.name, arguments: item.arguments ?? "" });
            let input: unknown;
            try { input = typeof item.arguments === "string" && item.arguments.trim() ? JSON.parse(item.arguments) : {}; } catch { input = { unreadable_arguments: String(item.arguments).slice(0, 400) }; }
            calls.push({ id: item.call_id, name: item.name, input });
          }
        } else if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
          status = event.response?.incomplete_details?.reason ?? event.response?.status ?? "";
          inputTokens = event.response?.usage?.input_tokens ?? 0;
          outputTokens = event.response?.usage?.output_tokens ?? 0;
          if (event.type === "response.failed") failure = new CoachModelError("overloaded", event.response?.error?.message ? `ChatGPT: ${event.response.error.message.slice(0, 160)}` : t("ChatGPT couldn't answer. Try again."));
        } else if (event.type === "error") failure = new CoachModelError("overloaded", t("ChatGPT couldn't answer. Try again."));
      };
      const reader = response.body.getReader(), decoder = new TextDecoder();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true }).replace(/\r\n/g, "\n");
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) take(frame);
        }
        take(buffer);
      } catch (error) {
        if (request.signal?.aborted) throw error;
        throw new CoachModelError("unreachable", t("ChatGPT's answer was cut off. Try again."));
      }
      if (failure) throw failure;
      if (text) kept.unshift({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      return {
        content: { chatgpt: kept } satisfies Kept, text: text.trim(), calls,
        stop: status === "max_output_tokens" ? "max_tokens" : status === "content_filter" ? "refusal" : calls.length ? "tools" : status === "completed" ? "end" : "other",
        inputTokens, outputTokens,
      };
    },
  };
}

/* ───────────── Sign-in and the account ───────────── */

/** Waits for the loopback redirect and answers the browser. Resolves with the code. */
function waitForCode(state: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let server: Server | null = null;
    const done = (error: Error | null, code?: string) => { server?.close(); if (error) reject(error); else resolve(code!); };
    signal.addEventListener("abort", () => done(new CoachModelError("unreachable", t("Sign-in took too long or was closed."))), { once: true });
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/auth/callback") { res.writeHead(404).end(); return; }
      const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" })
        .end(`<!doctype html><meta charset="utf-8"><title>C-LINK</title><body style="font:16px system-ui;padding:40px">${ok ? t("Signed in. You can close this window.") : t("That sign-in didn't match. Try again from C-LINK.")}</body>`);
      if (ok) done(null, url.searchParams.get("code")!);
      else done(new CoachModelError("bad_key", url.searchParams.get("error_description") ?? t("ChatGPT didn't sign in.")));
    });
    server.on("error", () => done(new CoachModelError("unreachable", t("Port {port} is in use (is the Codex CLI signing in?). Close it and try again.", { port: PORT }))));
    server.listen(PORT, "127.0.0.1");
  });
}

export class ChatGPTAccount implements AccountProvider {
  private refreshing: Promise<ChatGPTToken> | null = null;
  private listed: { at: number; models: string[]; efforts: Map<string, EffortLevels> } | null = null;

  constructor(private readonly host: ChatGPTHost) {}

  private async stored(): Promise<ChatGPTToken | null> {
    const raw = await this.host.load();
    if (!raw) return null;
    try { return JSON.parse(raw) as ChatGPTToken; } catch { return null; }
  }

  /** A token with at least a minute left, refreshed once however many ask at the same time. */
  async token(): Promise<ChatGPTToken> {
    const tok = await this.stored();
    if (!tok) throw new CoachModelError("bad_key", t("Sign in to ChatGPT on the AI page."));
    if (tok.expiresAt - Date.now() > 60_000) return tok;
    this.refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: tok.refresh, client_id: CLIENT_ID, scope: SCOPE })
      .then(async (body) => { const next = tokenFrom(body, tok); await this.host.save(JSON.stringify(next)); return next; })
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async status() {
    const tok = await this.stored();
    return tok ? { ready: true, ...(tok.email ? { account: tok.email } : {}) } : { ready: false };
  }

  async signIn(): Promise<void> {
    const verifier = b64url(randomBytes(32)), state = b64url(randomBytes(16));
    const url = new URL(AUTHORIZE_URL);
    for (const [k, v] of Object.entries({
      response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPE,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
      id_token_add_organizations: "true", codex_cli_simplified_flow: "true", state,
    })) url.searchParams.set(k, v);
    const closed = new AbortController();
    const waiting = waitForCode(state, AbortSignal.any([AbortSignal.timeout(SIGN_IN_MS), closed.signal]));
    const close = this.host.openSignIn(url.href, state, () => closed.abort());
    try {
      const code = await waiting;
      const body = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: verifier });
      await this.host.save(JSON.stringify(tokenFrom(body, null)));
      this.listed = null;
    } finally {
      close();
    }
  }

  async signOut(): Promise<void> {
    await this.host.save(null);
    this.listed = null;
  }

  /** The account's models, best first, cached for ten minutes. */
  async models(): Promise<string[]> {
    if (this.listed && Date.now() - this.listed.at < 10 * 60_000) return this.listed.models;
    try {
      const tok = await this.token();
      const response = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${tok.access}`, Accept: "application/json", originator: ORIGINATOR, "User-Agent": ORIGINATOR, ...(tok.accountId ? { "chatgpt-account-id": tok.accountId } : {}) }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { models?: CatalogModel[] };
      const shown = (body.models ?? []).filter((m) => typeof m.slug === "string" && m.visibility !== "hide" && m.supported_in_api !== false)
        .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999));
      const models = shown.map((m) => m.slug as string);
      if (!models.length) throw new Error("empty");
      this.listed = { at: Date.now(), models, efforts: new Map(shown.map((m) => [m.slug as string, effortsOf(m)])) };
      return models;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  /** The levels the catalog lists for this model ("" is the account's best model). */
  async efforts(model: string): Promise<EffortLevels | null> {
    const slug = model || (await this.models())[0];
    const found = this.listed?.efforts.get(slug);
    return found?.levels.length ? found : null;
  }

  /** "" is the account's best model. */
  model(model: string, effort?: string): CoachModel {
    return chatgptModel(() => this.token(), async () => model || (await this.models())[0], undefined, effort);
  }
}
