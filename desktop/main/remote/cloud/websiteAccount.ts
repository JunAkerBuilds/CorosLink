// The coroslink.com website account "Reach from anywhere" links this computer to. C-LINK signs in as the website's
// `coroslink-desktop` app client: PKCE (S256) in the system browser, back through `coroslink://auth/callback` (the
// only callback the website allows that client), then a `clk_` app token sealed with the keychain. The token buys
// 10-minute relay tokens (`POST /api/v1/app/relay-token`) and goes to no other host. See CorosLink-web
// Watchfaces/docs/relay-tokens.md. Nothing here runs until the athlete chooses to sign in.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { t } from "@/lib/i18n";
import type { Sealer } from "../../secrets";

export const WEBSITE_URL = "https://watchfaces.coroslink.com";
export const CLIENT_ID = "coroslink-desktop";
export const CALLBACK_URL = "coroslink://auth/callback";

const SIGN_IN_TTL_MS = 10 * 60_000;
/** A cached relay token is fetched again this long before it expires. */
const RELAY_TOKEN_MARGIN_MS = 60_000;
const TIMEOUT_MS = 20_000;
const STATE = /^[A-Za-z0-9_-]{8,128}$/;
const CODE = /^[A-Za-z0-9_-]{32,128}$/;
const ERROR = /^[a-z_]{1,64}$/;
const APP_TOKEN = /^clk_[A-Za-z0-9_-]{43}$/;

/** The website: production, or COROSLINK_WATCHFACE_SITE_URL in an unpackaged build (https, or http on loopback). */
export function websiteOrigin(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.COROSLINK_WATCHFACE_SITE_URL?.trim();
  if (!override || isPackaged) return WEBSITE_URL;
  const url = new URL(override);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("COROSLINK_WATCHFACE_SITE_URL must use https (or http on this computer).");
  return url.origin;
}

export const isAuthCallback = (url: string): boolean => /^coroslink:\/\/auth\/callback(?:[?#/]|$)/i.test(url.trim());

export type Callback = { code: string; state: string } | { error: string; state: string };

/** `?code=…&state=…`, or `?error=…&state=…` on Cancel; anything else (extra or repeated parameters too) is null. */
export function parseCallback(value: string): Callback | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "coroslink:" || url.hostname !== "auth" || url.pathname !== "/callback" || url.username || url.password || url.port || url.hash) return null;
  const params = new Map<string, string>();
  for (const [key, item] of url.searchParams) {
    if (params.has(key) || !["code", "state", "error", "error_description"].includes(key)) return null;
    params.set(key, item);
  }
  const state = params.get("state") ?? "";
  const code = params.get("code");
  const error = params.get("error");
  if (!STATE.test(state)) return null;
  if (code !== undefined && error === undefined) return CODE.test(code) && !params.has("error_description") ? { code, state } : null;
  if (error !== undefined && code === undefined) return ERROR.test(error) ? { error, state } : null;
  return null;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class AccountError extends Error {
  constructor(message: string, readonly code: "signedOut" | "busy" | "unreachable" | "failed" = "failed") { super(message); }
}

export interface AccountStatus { signedIn: boolean; handle: string | null; signingIn: boolean; error?: string }

interface Saved { token: string; handle: string; expiresAt: string | null }

export interface WebsiteAccountOptions {
  /** Where the sealed account lives. */
  dir: string;
  sealer: Sealer;
  origin: string;
  openExternal: (url: string) => Promise<void> | void;
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: () => void;
}

export class WebsiteAccount {
  private readonly file: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private saved: Saved | null = null;
  private pending: { state: string; verifier: string; until: number } | null = null;
  private relay: { token: string; until: number } | null = null;
  private relayFetch: Promise<string> | null = null;
  private error: string | undefined;

  constructor(private readonly options: WebsiteAccountOptions) {
    this.file = path.join(options.dir, "website-account.bin");
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.now = options.now ?? Date.now;
  }

  /** Reads the saved account. A file sealed elsewhere, or damaged, is signed out. */
  async load(): Promise<void> {
    try {
      const { text, stale } = await this.options.sealer.decrypt(await fs.promises.readFile(this.file));
      const saved = JSON.parse(text) as Partial<Saved>;
      if (typeof saved.token !== "string" || !APP_TOKEN.test(saved.token)) return;
      this.saved = { token: saved.token, handle: typeof saved.handle === "string" ? saved.handle : "", expiresAt: saved.expiresAt ?? null };
      if (stale) await this.write(this.saved);
    } catch { /* none saved */ }
  }

  status(): AccountStatus {
    return {
      signedIn: Boolean(this.saved),
      handle: this.saved?.handle || null,
      signingIn: Boolean(this.pending && this.pending.until > this.now()),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  get signedIn(): boolean { return Boolean(this.saved); }

  /** Opens the website's consent page in the browser; the answer comes back through `handleCallback`. */
  async signIn(): Promise<void> {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    this.pending = { state, verifier, until: this.now() + SIGN_IN_TTL_MS };
    this.error = undefined;
    this.changed();
    const query = new URLSearchParams({ client_id: CLIENT_ID, code_challenge: challenge, code_challenge_method: "S256", state });
    try {
      await this.options.openExternal(`${this.options.origin}/apps/authorize?${query}`);
    } catch {
      this.pending = null;
      this.fail(t("Couldn't open your browser to sign in."));
      throw new AccountError(t("Couldn't open your browser to sign in."));
    }
  }

  /**
   * A `coroslink://auth/callback` link: true when it was one (the rest goes on in the background, and the status
   * says how it went). Only the answer to the sign-in this computer started, unexpired, is used, once.
   */
  handleCallback(url: string): boolean {
    if (!isAuthCallback(url)) return false;
    void this.finish(url);
    return true;
  }

  /** The exchange `handleCallback` starts; exposed for tests. */
  async finish(url: string): Promise<void> {
    const answer = parseCallback(url);
    const pending = this.pending;
    if (!answer) return this.fail(t("That sign-in link isn't valid. Try signing in again."));
    if (!pending || pending.until <= this.now() || !same(answer.state, pending.state)) {
      return this.fail(t("That sign-in link doesn't match a sign-in started on this computer. Try signing in again."));
    }
    this.pending = null;
    if ("error" in answer) return this.fail(answer.error === "access_denied" ? t("Sign-in was cancelled.") : t("The website couldn't sign you in."));
    try {
      const reply = await this.request("/api/v1/app/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", client_id: CLIENT_ID, code: answer.code, code_verifier: pending.verifier }),
      });
      if (typeof reply.accessToken !== "string" || !APP_TOKEN.test(reply.accessToken)) throw new AccountError(t("The website sent an unexpected answer."));
      const viewer = reply.viewer as { handle?: unknown } | undefined;
      this.saved = {
        token: reply.accessToken,
        handle: typeof viewer?.handle === "string" ? viewer.handle.slice(0, 64) : "",
        expiresAt: typeof reply.expiresAt === "string" ? reply.expiresAt : null,
      };
      this.relay = null;
      await this.write(this.saved);
      this.error = undefined;
      this.changed();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : t("Couldn't finish signing in."));
    }
  }

  /** A relay token for this account, kept until shortly before it expires. */
  relayToken(): Promise<string> {
    if (this.relay && this.relay.until - RELAY_TOKEN_MARGIN_MS > this.now()) return Promise.resolve(this.relay.token);
    return (this.relayFetch ??= this.fetchRelayToken().finally(() => { this.relayFetch = null; }));
  }

  /** The relay refused the cached token: the next call fetches a new one. */
  forgetRelayToken(): void { this.relay = null; }

  private async fetchRelayToken(): Promise<string> {
    const token = this.saved?.token;
    if (!token) throw new AccountError(t("Sign in to your coroslink.com account first."), "signedOut");
    const reply = await this.request("/api/v1/app/relay-token", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const until = typeof reply.expiresAt === "string" ? Date.parse(reply.expiresAt) : NaN;
    if (typeof reply.token !== "string" || reply.token.length > 4096 || !Number.isFinite(until)) throw new AccountError(t("The website sent an unexpected answer."));
    this.relay = { token: reply.token, until };
    return reply.token;
  }

  /** Forgets the token here, and signs the computer out on the website when it can. */
  async signOut(): Promise<void> {
    const token = this.saved?.token;
    await this.forget();
    if (!token) return;
    await this.request("/api/v1/app/session", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }

  private async forget(): Promise<void> {
    this.saved = null;
    this.relay = null;
    this.pending = null;
    this.error = undefined;
    await fs.promises.rm(this.file, { force: true });
    this.changed();
  }

  private async write(saved: Saved): Promise<void> {
    const sealed = await this.options.sealer.encrypt(JSON.stringify(saved));
    await fs.promises.mkdir(this.options.dir, { recursive: true });
    const temp = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.promises.writeFile(temp, sealed, { mode: 0o600 });
      await fs.promises.rename(temp, this.file);
    } finally {
      await fs.promises.rm(temp, { force: true }).catch(() => {});
    }
  }

  private fail(message: string): void {
    this.error = message;
    this.changed();
  }

  private changed(): void { this.options.onChange?.(); }

  private async request(route: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetch(`${this.options.origin}${route}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new AccountError(t("Couldn't reach coroslink.com. Check your internet connection."), "unreachable");
    }
    let json: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await response.text());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch { /* not JSON: the status decides */ }
    if (response.ok) return json;
    if (response.status === 401) {
      // Signed out on the website, revoked or expired. A refused code leaves a signed-in account alone.
      if (route !== "/api/v1/app/token") await this.forget();
      throw new AccountError(route === "/api/v1/app/token" ? t("That sign-in expired. Try signing in again.") : t("You were signed out of coroslink.com. Sign in again."), "signedOut");
    }
    if (response.status === 429) throw new AccountError(t("coroslink.com is busy. Wait a few minutes, then try again."), "busy");
    throw new AccountError(t("coroslink.com answered {status}.", { status: response.status }), "unreachable");
  }
}
