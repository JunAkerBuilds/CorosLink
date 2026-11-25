// Signing in to a hosted MCP server (Strava, Hevy, …) with OAuth: the SDK finds the server's sign-in, registers
// C-LINK as a client, and we open the athlete's browser. The answer comes back to a one-off listener on 127.0.0.1 on
// a free port (no fixed port to clash with another app). Tokens and the client registration stay in the vault, and
// the SDK refreshes the tokens on its own when they run out.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpStore } from "./mcpStore";

const SIGN_IN_MS = 5 * 60_000;

/** The vault-backed OAuth state of one server. Without `open` it never opens a browser: a server that needs one says so. */
export class VaultOAuth implements OAuthClientProvider {
  /** Set when the server wanted the athlete to sign in and no sign-in was running. */
  needsSignIn = false;
  private expected: string | null = null;

  constructor(
    private readonly store: McpStore,
    private readonly id: string,
    /** The listener's address while signing in; otherwise the one the client was registered with. */
    private readonly redirect: string,
    /** Opens the browser; absent outside a sign-in. */
    private readonly open?: (url: string) => void,
    private readonly scope?: string,
  ) {}

  get redirectUrl(): string { return this.redirect; }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "C-LINK Coach", redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }

  state(): string { return (this.expected = randomBytes(16).toString("base64url")); }
  /** The state sent with the last sign-in, to check the answer against. */
  get sentState(): string | null { return this.expected; }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const o = (await this.store.secrets(this.id)).oauth;
    // A registration is for one redirect address; a sign-in on another port registers again.
    if (this.open && o?.redirect !== this.redirect) return undefined;
    return o?.client;
  }
  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.store.setOAuth(this.id, { client, redirect: this.redirect });
  }
  async tokens(): Promise<OAuthTokens | undefined> { return (await this.store.secrets(this.id)).oauth?.tokens; }
  async saveTokens(tokens: OAuthTokens): Promise<void> { await this.store.setOAuth(this.id, { tokens }); }
  async saveCodeVerifier(verifier: string): Promise<void> { await this.store.setOAuth(this.id, { verifier }); }
  async codeVerifier(): Promise<string> {
    const v = (await this.store.secrets(this.id)).oauth?.verifier;
    if (!v) throw new Error("The sign-in was lost. Try again.");
    return v;
  }
  redirectToAuthorization(url: URL): void {
    if (!this.open) { this.needsSignIn = true; return; }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("The server's sign-in page isn't https.");
    this.open(url.href);
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all") await this.store.setOAuth(this.id, null);
    else if (scope === "client") await this.store.setOAuth(this.id, { client: undefined, redirect: undefined });
    else if (scope === "tokens") await this.store.setOAuth(this.id, { tokens: undefined });
    else if (scope === "verifier") await this.store.setOAuth(this.id, { verifier: undefined });
  }
}

const PAGE = (title: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px -apple-system,system-ui,sans-serif;background:#101214;color:#eef;display:grid;place-items:center;height:100vh;margin:0"><p>${title}</p>`;

/** A listener for one sign-in's answer. `code` resolves with the code once the browser comes back with the right state. */
export async function openCallback(): Promise<{ redirect: string; code: (state: () => string | null) => Promise<string>; close: () => void }> {
  let deliver: (r: { code?: string; state?: string; error?: string }) => void = () => {};
  const arrived = new Promise<{ code?: string; state?: string; error?: string }>((resolve) => { deliver = resolve; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") { res.writeHead(404).end(); return; }
    const error = url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? undefined;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE(error ? "Sign-in didn't finish. Go back to C-LINK." : "Signed in. Go back to C-LINK."));
    deliver({ code: url.searchParams.get("code") ?? undefined, state: url.searchParams.get("state") ?? undefined, error });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const { port } = server.address() as AddressInfo;
  let timer: NodeJS.Timeout | undefined;
  return {
    redirect: `http://127.0.0.1:${port}/callback`,
    code: async (state) => {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Sign-in timed out.")), SIGN_IN_MS); });
      const got = await Promise.race([arrived, timeout]);
      if (got.error) throw new Error(`Sign-in failed: ${got.error.slice(0, 200)}`);
      if (!got.code || !got.state || got.state !== state()) throw new Error("Sign-in failed: the answer didn't match.");
      return got.code;
    },
    close: () => { clearTimeout(timer); server.closeAllConnections(); server.close(); },
  };
}
