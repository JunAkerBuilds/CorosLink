import crypto from "node:crypto";
import type { RemoteSecretBox, RemoteSettingsStore } from "../identity";

/**
 * Signing this computer in to watchfaces.coroslink.com, the account the relay
 * links it to. The desktop is the website's `coroslink-desktop` app client:
 * PKCE (S256) in the system browser, back through the `coroslink://auth/callback`
 * deep link, then a `clk_` app token kept with safeStorage. That token buys
 * 10-minute relay tokens (`POST /api/v1/app/relay-token`) and opens the
 * member's own private watch faces on the same website (`tokenFor`); it is
 * never sent to the relay, to a phone or to any other host. See CorosLink-web
 * Watchfaces/docs/relay-tokens.md.
 */

export const PRODUCTION_WEBSITE_URL = "https://watchfaces.coroslink.com";
export const WEBSITE_CLIENT_ID = "coroslink-desktop";
export const AUTH_CALLBACK_URL = "coroslink://auth/callback";

/** How long the browser has to come back with a code. */
const SIGN_IN_TTL_MS = 10 * 60_000;
/** A cached relay token is refreshed this long before it expires. */
const RELAY_TOKEN_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

const TOKEN_KEY = "remote.cloud.websiteToken";
const ACCOUNT_KEY = "remote.cloud.websiteAccount";

const STATE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ERROR_PATTERN = /^[a-z_]{1,64}$/;
const APP_TOKEN_PATTERN = /^clk_[A-Za-z0-9_-]{43}$/;

export function websiteBaseUrl(input: { isPackaged: boolean; override?: string | undefined }): string {
  const override = input.override?.trim();
  if (!override || input.isPackaged) return PRODUCTION_WEBSITE_URL;
  const parsed = new URL(override);
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("COROSLINK_WATCHFACE_SITE_URL must use https (or http on this computer).");
  }
  return parsed.origin;
}

// ----- PKCE and the callback -----

export function createPkce(): { verifier: string; challenge: string } {
  // 32 bytes is a 43-character verifier, the RFC 7636 minimum.
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier, "ascii").digest("base64url") };
}

export function authorizeUrl(origin: string, input: { challenge: string; state: string }): string {
  const query = new URLSearchParams({
    client_id: WEBSITE_CLIENT_ID,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state
  });
  return `${origin}/apps/authorize?${query.toString()}`;
}

export type AuthCallback =
  | { kind: "code"; code: string; state: string }
  | { kind: "error"; error: string; state: string };

/** `coroslink://auth/callback…`, whatever follows. main.ts routes these here and nowhere else. */
export function isAuthCallbackUrl(value: string): boolean {
  return /^coroslink:\/\/auth\/callback(?:[?#/]|$)/i.test(value.trim());
}

/**
 * The website's answer: `?code=…&state=…`, or `?error=access_denied&state=…`
 * on Cancel. Anything else (extra or repeated parameters, a fragment, a
 * malformed code or state) is null.
 */
export function parseAuthCallback(value: string): AuthCallback | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "coroslink:" ||
    parsed.hostname !== "auth" ||
    parsed.pathname !== "/callback" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash
  ) {
    return null;
  }
  const params = new Map<string, string>();
  for (const [key, item] of parsed.searchParams) {
    if (params.has(key) || !["code", "state", "error", "error_description"].includes(key)) return null;
    params.set(key, item);
  }
  const state = params.get("state") ?? "";
  if (!STATE_PATTERN.test(state)) return null;
  const code = params.get("code");
  const error = params.get("error");
  if (code !== undefined && error === undefined) {
    return CODE_PATTERN.test(code) && !params.has("error_description") ? { kind: "code", code, state } : null;
  }
  if (error !== undefined && code === undefined) {
    return ERROR_PATTERN.test(error) ? { kind: "error", error, state } : null;
  }
  return null;
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ----- The account -----

export interface WebsiteViewer {
  handle: string;
  displayName: string | null;
}

export interface WebsiteAccountStatus {
  signedIn: boolean;
  viewer: WebsiteViewer | null;
  /** Waiting for the browser to come back. */
  signingIn: boolean;
  error?: string;
}

export interface WebsiteAccountOptions {
  origin: string;
  settings: RemoteSettingsStore;
  secrets: RemoteSecretBox;
  openExternal: (url: string) => Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: () => void;
}

export class WebsiteAccountError extends Error {
  constructor(message: string, readonly code: "signed_out" | "rate_limited" | "unavailable" | "failed" = "failed") {
    super(message);
    this.name = "WebsiteAccountError";
  }
}

interface PendingSignIn {
  state: string;
  verifier: string;
  expiresAt: number;
}

interface SavedAccount {
  version: 1;
  viewer: WebsiteViewer;
  expiresAt: string | null;
}

export class WebsiteAccount {
  private pending: PendingSignIn | null = null;
  private relay: { token: string; expiresAt: number } | null = null;
  private relayRequest: Promise<string> | null = null;
  private error: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: WebsiteAccountOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  get origin(): string {
    return this.options.origin;
  }

  status(): WebsiteAccountStatus {
    const account = this.savedAccount();
    const signedIn = Boolean(account && this.options.settings.get(TOKEN_KEY));
    return {
      signedIn,
      viewer: signedIn ? account!.viewer : null,
      signingIn: Boolean(this.pending && this.pending.expiresAt > this.now()),
      ...(this.error ? { error: this.error } : {})
    };
  }

  get signedIn(): boolean {
    return this.status().signedIn;
  }

  /** Opens the website's consent page in the browser. Refuses when the token couldn't be kept safely. */
  async beginSignIn(): Promise<void> {
    this.options.secrets.ensureAvailable();
    const { verifier, challenge } = createPkce();
    const state = crypto.randomBytes(32).toString("base64url");
    this.pending = { state, verifier, expiresAt: this.now() + SIGN_IN_TTL_MS };
    this.error = undefined;
    this.changed();
    try {
      await this.options.openExternal(authorizeUrl(this.options.origin, { challenge, state }));
    } catch (error) {
      this.pending = null;
      this.changed();
      throw new WebsiteAccountError("Couldn't open your browser to sign in.");
    }
  }

  cancelSignIn(): void {
    this.pending = null;
    this.error = undefined;
    this.changed();
  }

  /**
   * The `coroslink://auth/callback` deep link. Only an answer to the sign-in
   * this computer started (same state, not expired) is used, once.
   */
  async handleCallback(url: string): Promise<void> {
    const callback = parseAuthCallback(url);
    const pending = this.pending;
    if (!callback) return this.fail("That sign-in link isn't valid. Try signing in again.");
    if (!pending || pending.expiresAt <= this.now() || !sameText(callback.state, pending.state)) {
      return this.fail("That sign-in link doesn't match a sign-in started on this computer. Try signing in again.");
    }
    this.pending = null;
    if (callback.kind === "error") {
      return this.fail(callback.error === "access_denied" ? "Sign-in was cancelled." : "watchfaces.coroslink.com couldn't sign you in.");
    }
    try {
      const answer = await this.request("/api/v1/app/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: WEBSITE_CLIENT_ID,
          code: callback.code,
          code_verifier: pending.verifier
        })
      });
      const token = answer.accessToken;
      if (typeof token !== "string" || !APP_TOKEN_PATTERN.test(token)) {
        throw new WebsiteAccountError("watchfaces.coroslink.com sent an unexpected answer.");
      }
      const viewer = answer.viewer as Partial<WebsiteViewer> | undefined;
      this.store(token, {
        version: 1,
        viewer: {
          handle: typeof viewer?.handle === "string" ? viewer.handle.slice(0, 64) : "",
          displayName: typeof viewer?.displayName === "string" ? viewer.displayName.slice(0, 80) : null
        },
        expiresAt: typeof answer.expiresAt === "string" ? answer.expiresAt : null
      });
      this.error = undefined;
      this.changed();
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Couldn't finish signing in.");
    }
  }

  /** A relay token for this account, cached until shortly before it expires. */
  relayToken(): Promise<string> {
    const cached = this.relay;
    if (cached && cached.expiresAt - RELAY_TOKEN_MARGIN_MS > this.now()) return Promise.resolve(cached.token);
    this.relayRequest ??= this.fetchRelayToken().finally(() => {
      this.relayRequest = null;
    });
    return this.relayRequest;
  }

  /** The relay refused the cached token: the next call fetches a new one. */
  forgetRelayToken(): void {
    this.relay = null;
  }

  private async fetchRelayToken(): Promise<string> {
    const appToken = this.appToken();
    if (!appToken) throw new WebsiteAccountError("Sign in to watchfaces.coroslink.com first.", "signed_out");
    const answer = await this.request("/api/v1/app/relay-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${appToken}` }
    });
    const expiresAt = typeof answer.expiresAt === "string" ? Date.parse(answer.expiresAt) : NaN;
    if (typeof answer.token !== "string" || answer.token.length > 4096 || !Number.isFinite(expiresAt)) {
      throw new WebsiteAccountError("watchfaces.coroslink.com sent an unexpected answer.");
    }
    this.relay = { token: answer.token, expiresAt };
    return answer.token;
  }

  /** Signs this computer out on the website (best effort) and forgets the token. */
  async signOut(): Promise<void> {
    const appToken = this.appToken();
    this.forget();
    if (!appToken) return;
    try {
      await this.request("/api/v1/app/session", { method: "DELETE", headers: { Authorization: `Bearer ${appToken}` } });
    } catch {
      // The token is gone here either way; the website expires it in time.
    }
  }

  private forget(): void {
    this.options.settings.set(TOKEN_KEY, "");
    this.options.settings.set(ACCOUNT_KEY, "");
    this.relay = null;
    this.pending = null;
    this.changed();
  }

  /**
   * The app token, for a request to this account's own website only (the community catalog
   * opening the member's private faces). Null when signed out or for any other origin, so the
   * keychain is only touched for a signed-in account.
   */
  tokenFor(origin: string): string | null {
    if (!this.signedIn) return null;
    let requested: string;
    try {
      requested = new URL(origin).origin;
    } catch {
      return null;
    }
    return requested === new URL(this.options.origin).origin ? this.appToken() : null;
  }

  private appToken(): string | null {
    const encoded = this.options.settings.get(TOKEN_KEY);
    if (!encoded) return null;
    try {
      this.options.secrets.ensureAvailable();
      const token = this.options.secrets.decrypt(Buffer.from(encoded, "base64"));
      return APP_TOKEN_PATTERN.test(token) ? token : null;
    } catch {
      return null;
    }
  }

  private store(token: string, account: SavedAccount): void {
    this.options.secrets.ensureAvailable();
    this.options.settings.set(TOKEN_KEY, this.options.secrets.encrypt(token).toString("base64"));
    this.options.settings.set(ACCOUNT_KEY, JSON.stringify(account));
    this.relay = null;
  }

  private savedAccount(): SavedAccount | null {
    const saved = this.options.settings.get(ACCOUNT_KEY);
    if (!saved) return null;
    try {
      const account = JSON.parse(saved) as SavedAccount;
      return account?.version === 1 && account.viewer ? account : null;
    } catch {
      return null;
    }
  }

  private fail(message: string): void {
    this.error = message;
    this.changed();
  }

  private changed(): void {
    this.options.onChange?.();
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.origin}${path}`, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new WebsiteAccountError("Couldn't reach watchfaces.coroslink.com. Check your internet connection.", "unavailable");
    }
    const text = await response.text().catch(() => "");
    let json: Record<string, unknown> = {};
    try {
      const parsed = text ? JSON.parse(text) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch {
      // Not JSON; the status decides.
    }
    if (response.ok) return json;
    if (response.status === 401) {
      // Signed out on the website, revoked, expired or suspended.
      if (path !== "/api/v1/app/token") this.forget();
      throw new WebsiteAccountError(
        path === "/api/v1/app/token"
          ? "That sign-in expired. Try signing in again."
          : "You were signed out of watchfaces.coroslink.com. Sign in again.",
        "signed_out"
      );
    }
    if (response.status === 429) {
      throw new WebsiteAccountError("watchfaces.coroslink.com is busy. Wait a few minutes, then try again.", "rate_limited");
    }
    const message = typeof json.message === "string" && json.message ? json.message.slice(0, 300) : null;
    throw new WebsiteAccountError(message ?? `watchfaces.coroslink.com answered ${response.status}.`, "unavailable");
  }
}
