import { app, BrowserWindow, safeStorage, shell } from "electron";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { deleteSettings, getSetting, setSetting } from "./database";
import {
  getMcpBearer,
  getMcpServer,
  listMcpServers,
  mcpSecretKey
} from "./mcpServersStore";
import { prefixToolName, splitToolName } from "./mcpToolNames";
import type {
  CorosMcpTool,
  McpServerConfig,
  McpServerStatus
} from "./types";

// Generalization of the old single-server COROS MCP client into a registry of
// connections keyed by server id. Each server gets its own OAuth provider
// (loopback redirect on a per-server port), token storage, and cached tools;
// tools are exposed to the chat prefixed "<id>__<tool>".

// ----- per-server settings keys (COROS keeps its legacy keys for compat) -----

interface ServerKeys {
  tokens: string;
  clientInfo: string;
  resourceUrl: string;
}

function keysFor(id: string): ServerKeys {
  if (id === "coros") {
    return {
      tokens: "corosMcp.tokens",
      clientInfo: "corosMcp.clientInfo",
      resourceUrl: "corosMcp.resourceUrl"
    };
  }
  return {
    tokens: mcpSecretKey(id, "tokens"),
    clientInfo: mcpSecretKey(id, "clientInfo"),
    resourceUrl: `mcp.${id}.resourceUrl`
  };
}

// COROS keeps :1456 (its published behavior); other servers get a deterministic
// port in a small range so two servers don't fight over the same loopback.
function loopbackPortFor(id: string): number {
  if (id === "coros") return 1456;
  let hash = 0;
  for (const ch of id) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return 1457 + (hash % 40);
}

function redirectPathFor(id: string): string {
  return `/mcp/${id}/callback`;
}

// ----- token persistence (encrypted, per server) -----

function readTokens(id: string): OAuthTokens | undefined {
  const encoded = getSetting(keysFor(id).tokens);
  if (!encoded || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    const json = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    return JSON.parse(json) as OAuthTokens;
  } catch {
    return undefined;
  }
}

function writeTokens(id: string, tokens: OAuthTokens): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  const encrypted = safeStorage
    .encryptString(JSON.stringify(tokens))
    .toString("base64");
  setSetting(keysFor(id).tokens, encrypted);
}

function hasStoredTokens(id: string): boolean {
  return Boolean(getSetting(keysFor(id).tokens));
}

// ----- OAuth client provider (per server) -----

interface ProviderConfig {
  serverId: string;
  serverName: string;
  resourceUrl: string;
  scope: string;
  loopbackPort: number;
  redirectPath: string;
}

class McpOAuthProvider implements OAuthClientProvider {
  private verifier = "";
  private oauthState = "";
  private loopback: http.Server | null = null;
  private codePromise: Promise<string> | null = null;
  private settleCode:
    | ((result: { ok: true; code: string } | { ok: false; error: Error }) => void)
    | null = null;
  private authWindow: BrowserWindow | undefined;
  private closingWindow = false;

  constructor(
    private readonly config: ProviderConfig,
    private readonly parentWindow?: BrowserWindow | null,
    private readonly interactive = true
  ) {}

  private get redirectUri(): string {
    return `http://localhost:${this.config.loopbackPort}${this.config.redirectPath}`;
  }

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "CorosLink",
      redirect_uris: [this.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: this.config.scope
    };
  }

  state(): string {
    if (!this.oauthState) {
      this.oauthState = base64Url(crypto.randomBytes(16));
    }
    return this.oauthState;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    const raw = getSetting(keysFor(this.config.serverId).clientInfo);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OAuthClientInformationFull;
    } catch {
      return undefined;
    }
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    setSetting(keysFor(this.config.serverId).clientInfo, JSON.stringify(info));
  }

  tokens(): OAuthTokens | undefined {
    return readTokens(this.config.serverId);
  }

  saveTokens(tokens: OAuthTokens): void {
    writeTokens(this.config.serverId, tokens);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    return this.verifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (!this.interactive) return;
    this.startLoopback(authorizationUrl);
  }

  waitForCode(): Promise<string> {
    if (!this.codePromise) {
      throw new Error(`${this.config.serverName} authorization was not started.`);
    }
    return this.codePromise;
  }

  authorizationStarted(): boolean {
    return this.codePromise !== null;
  }

  async cleanup(): Promise<void> {
    this.finishCode({
      ok: false,
      error: new Error(`${this.config.serverName} connection cancelled.`)
    });

    const server = this.loopback;
    this.loopback = null;
    if (server) {
      await Promise.race([
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.on("error", () => resolve());
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 1000))
      ]);
    }

    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.closingWindow = true;
      const toClose = this.authWindow;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!toClose.isDestroyed()) toClose.close();
          resolve();
        }, 300);
      });
    }
  }

  private finishCode(
    result: { ok: true; code: string } | { ok: false; error: Error }
  ): void {
    const settle = this.settleCode;
    if (!settle) return;
    this.settleCode = null;
    settle(result);
  }

  private openAuthWindow(authorizationUrl: URL): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) return;
    this.authWindow = new BrowserWindow({
      width: 520,
      height: 760,
      title: `Connect ${this.config.serverName}`,
      parent: this.parentWindow ?? undefined,
      modal: Boolean(this.parentWindow),
      closable: true,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    this.authWindow.on("closed", () => {
      this.authWindow = undefined;
      if (this.closingWindow) return;
      this.finishCode({
        ok: false,
        error: new Error(`${this.config.serverName} connection window was closed.`)
      });
    });
    this.authWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    this.authWindow.webContents.on("dom-ready", () => {
      void this.injectCloseButton();
    });
    void this.authWindow.loadURL(authorizationUrl.toString());
  }

  private async injectCloseButton(): Promise<void> {
    if (!this.authWindow || this.authWindow.isDestroyed()) return;
    try {
      await this.authWindow.webContents.executeJavaScript(
        `(() => {
          if (document.getElementById("coroslink-mcp-close")) return;
          const button = document.createElement("button");
          button.id = "coroslink-mcp-close";
          button.type = "button";
          button.setAttribute("aria-label", "Close");
          button.title = "Close";
          button.textContent = "×";
          button.style.cssText = [
            "position:fixed","top:12px","right:12px","z-index:2147483647",
            "width:36px","height:36px","border:none","border-radius:18px",
            "background:rgba(15,18,24,0.72)","color:#fff",
            "font:600 24px/36px system-ui,sans-serif","cursor:pointer",
            "box-shadow:0 4px 16px rgba(0,0,0,0.28)"
          ].join(";");
          button.addEventListener("click", () => window.close());
          document.documentElement.appendChild(button);
        })();`,
        true
      );
    } catch {
      // Page may block script injection; OS window chrome remains available.
    }
  }

  private startLoopback(authorizationUrl: URL): void {
    if (this.codePromise) return;
    const { loopbackPort, redirectPath, serverName } = this.config;
    this.codePromise = new Promise<string>((resolve, reject) => {
      this.settleCode = (result) => {
        if (result.ok) resolve(result.code);
        else reject(result.error);
      };
      const server = http.createServer((request, response) => {
        if (!request.url) return;
        const callbackUrl = new URL(request.url, this.redirectUri);
        if (callbackUrl.pathname !== redirectPath) {
          response.writeHead(404);
          response.end();
          return;
        }
        const error = callbackUrl.searchParams.get("error");
        const code = callbackUrl.searchParams.get("code");
        const returnedState = callbackUrl.searchParams.get("state");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (error) {
          response.end(mcpResultPage(serverName, `${serverName} connection failed.`, true));
          this.finishCode({ ok: false, error: new Error(error) });
          return;
        }
        if (returnedState !== this.oauthState || !code) {
          response.end(mcpResultPage(serverName, `${serverName} connection failed.`, true));
          this.finishCode({
            ok: false,
            error: new Error(`${serverName} OAuth state mismatch.`)
          });
          return;
        }
        response.end(mcpResultPage(serverName, `${serverName} connected.`, false));
        this.finishCode({ ok: true, code });
      });
      server.on("error", (err) => {
        const detail = err instanceof Error ? err : new Error(String(err));
        if ((detail as NodeJS.ErrnoException).code === "EADDRINUSE") {
          this.finishCode({
            ok: false,
            error: new Error(
              `${serverName} OAuth callback port ${loopbackPort} is already in use. ` +
                `Close other CorosLink windows, or run: lsof -nP -iTCP:${loopbackPort} -sTCP:LISTEN`
            )
          });
          return;
        }
        this.finishCode({ ok: false, error: detail });
      });
      this.loopback = server;
      server.listen(loopbackPort, "127.0.0.1", () => {
        const address = server.address() as AddressInfo | null;
        if (!address || address.port !== loopbackPort) {
          this.finishCode({
            ok: false,
            error: new Error(`${serverName} OAuth callback port did not bind.`)
          });
          return;
        }
        this.openAuthWindow(authorizationUrl);
      });
    });
    void this.codePromise.catch(() => undefined);
  }
}

function mcpResultPage(name: string, message: string, failed: boolean): string {
  const tone = failed ? "#b42318" : "#027a48";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect ${name}</title>
<style>
  :root { color-scheme: light dark; } * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font:15px/1.45 system-ui,-apple-system,sans-serif; background:#0f1218; color:#f4f6f8; }
  .card { position:relative; width:min(360px,calc(100vw - 32px)); padding:28px 24px 24px;
    border-radius:16px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
    text-align:center; }
  .close { position:absolute; top:10px; right:10px; width:36px; height:36px; border:none;
    border-radius:18px; background:rgba(255,255,255,0.12); color:#fff;
    font:600 24px/36px system-ui,sans-serif; cursor:pointer; }
  .close:hover { background:rgba(255,255,255,0.2); }
  h1 { margin:8px 0 8px; font-size:18px; font-weight:650; color:${tone}; }
  p { margin:0 0 18px; color:rgba(244,246,248,0.72); }
  .action { border:none; border-radius:999px; padding:10px 18px; background:#f4f6f8;
    color:#0f1218; font:600 13px/1 system-ui,sans-serif; cursor:pointer; }
</style></head>
<body><div class="card">
  <button class="close" type="button" aria-label="Close" title="Close" onclick="window.close()">×</button>
  <h1>${message}</h1><p>You can close this window.</p>
  <button class="action" type="button" onclick="window.close()">Close</button>
</div></body></html>`;
}

// ----- per-server runtime state -----

interface ServerRuntime {
  client: Client | null;
  tools: CorosMcpTool[];
  connectInFlight: Promise<void> | null;
  connectInFlightInteractive: boolean;
  lastError?: string;
}

const runtimes = new Map<string, ServerRuntime>();

function runtime(id: string): ServerRuntime {
  let rt = runtimes.get(id);
  if (!rt) {
    rt = { client: null, tools: [], connectInFlight: null, connectInFlightInteractive: false };
    runtimes.set(id, rt);
  }
  return rt;
}

function providerConfig(server: McpServerConfig): ProviderConfig {
  return {
    serverId: server.id,
    serverName: server.name,
    resourceUrl: server.url,
    scope: server.scope ?? "openid offline_access",
    loopbackPort: loopbackPortFor(server.id),
    redirectPath: redirectPathFor(server.id)
  };
}

function clearStoredAuth(id: string): void {
  const rt = runtime(id);
  const stale = rt.client;
  rt.client = null;
  rt.tools = [];
  if (stale) void stale.close().catch(() => undefined);
  const keys = keysFor(id);
  deleteSettings([keys.tokens, keys.clientInfo]);
}

async function refreshTools(server: McpServerConfig): Promise<void> {
  const rt = runtime(server.id);
  if (!rt.client) return;
  const result = await rt.client.listTools();
  rt.tools = (result.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>
  }));
}

function buildTransport(server: McpServerConfig, authProvider?: McpOAuthProvider) {
  if (server.authType === "oauth" && authProvider) {
    return new StreamableHTTPClientTransport(new URL(server.url), { authProvider });
  }
  // bearer / none: send a static Authorization header when a bearer is stored.
  const headers: Record<string, string> = {};
  if (server.authType === "bearer") {
    const token = getMcpBearer(server.id);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers }
  });
}

// ----- connect (OAuth or header auth) -----

async function connectOnce(
  server: McpServerConfig,
  parentWindow: BrowserWindow | null,
  interactive: boolean
): Promise<void> {
  const rt = runtime(server.id);
  if (rt.client) return;

  if (server.authType !== "oauth") {
    const transport = buildTransport(server);
    const mcpClient = new Client(
      { name: "CorosLink", version: app.getVersion() },
      { capabilities: {} }
    );
    await mcpClient.connect(transport);
    rt.client = mcpClient;
    await refreshTools(server);
    return;
  }

  let clearedStaleAuth = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authProvider = new McpOAuthProvider(
      providerConfig(server),
      parentWindow,
      interactive
    );
    const transport = buildTransport(server, authProvider);
    const mcpClient = new Client(
      { name: "CorosLink", version: app.getVersion() },
      { capabilities: {} }
    );

    try {
      try {
        await mcpClient.connect(transport);
      } catch (error) {
        if (
          error instanceof UnauthorizedError &&
          interactive &&
          authProvider.authorizationStarted()
        ) {
          const code = await authProvider.waitForCode();
          await transport.finishAuth(code);
          const retryTransport = buildTransport(server, authProvider);
          await mcpClient.connect(retryTransport);
        } else if (error instanceof UnauthorizedError) {
          clearStoredAuth(server.id);
          if (interactive && !clearedStaleAuth) {
            clearedStaleAuth = true;
            continue;
          }
          throw error;
        } else {
          throw error;
        }
      }
    } finally {
      await authProvider.cleanup();
    }

    rt.client = mcpClient;
    setSetting(keysFor(server.id).resourceUrl, server.url);
    await refreshTools(server);
    return;
  }

  throw new Error(`${server.name} MCP authorization expired. Connect ${server.name} again.`);
}

/** Connect a server (running its OAuth flow if needed). Single-flight per server. */
export async function connectMcpServer(
  id: string,
  interactive = true,
  parentWindow: BrowserWindow | null = null
): Promise<McpServerStatus> {
  const server = getMcpServer(id);
  if (!server) throw new Error(`Unknown MCP server "${id}".`);
  const rt = runtime(id);

  for (;;) {
    if (rt.client) return statusFor(server);

    if (rt.connectInFlight) {
      if (!interactive || rt.connectInFlightInteractive) {
        try {
          await rt.connectInFlight;
        } catch {
          // fall through to report status/error
        }
        return statusFor(server);
      }
      try {
        await rt.connectInFlight;
      } catch {
        // fall through to an interactive attempt
      }
      continue;
    }

    rt.connectInFlightInteractive = interactive;
    rt.lastError = undefined;
    const flight = connectOnce(server, parentWindow, interactive)
      .catch((error) => {
        rt.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(() => {
        if (rt.connectInFlight === flight) {
          rt.connectInFlight = null;
          rt.connectInFlightInteractive = false;
        }
      });
    rt.connectInFlight = flight;
    try {
      await flight;
    } catch {
      // status reflects lastError
    }
    return statusFor(server);
  }
}

export async function disconnectMcpServer(id: string): Promise<void> {
  const rt = runtime(id);
  if (rt.client) {
    try {
      await rt.client.close();
    } catch {
      // best-effort
    }
  }
  rt.client = null;
  rt.tools = [];
  const keys = keysFor(id);
  deleteSettings([keys.tokens, keys.clientInfo]);
}

/** Silent reconnect using stored auth (no browser). Non-fatal. */
async function ensureMcpConnected(server: McpServerConfig): Promise<void> {
  const rt = runtime(server.id);
  if (rt.client) return;
  if (server.authType === "oauth" && !hasStoredTokens(server.id)) return;
  if (server.authType === "bearer" && !getMcpBearer(server.id)) return;
  try {
    await connectMcpServer(server.id, false, null);
  } catch {
    // non-fatal; surfaced via status
  }
}

/** Connect every enabled server silently. Per-server failures are swallowed. */
export async function ensureAllMcpConnected(): Promise<void> {
  await Promise.all(
    listMcpServers()
      .filter((s) => s.enabled)
      .map((s) => ensureMcpConnected(s).catch(() => undefined))
  );
}

// ----- tools -----

/** All tools from connected servers, names prefixed "<id>__<tool>". */
export function getAllMcpTools(): CorosMcpTool[] {
  const tools: CorosMcpTool[] = [];
  for (const [id, rt] of runtimes) {
    if (!rt.client) continue;
    for (const tool of rt.tools) {
      tools.push({ ...tool, name: prefixToolName(id, tool.name) });
    }
  }
  return tools;
}

/** Cached unprefixed tools for one server (sync; empty if not connected). */
export function getMcpServerCachedTools(id: string): CorosMcpTool[] {
  return runtime(id).tools;
}

/** Silent reconnect of one server using stored auth. Returns connected state. */
export async function ensureMcpServerConnected(id: string): Promise<boolean> {
  const server = getMcpServer(id);
  if (!server) return false;
  const rt = runtime(id);
  if (rt.client) return true;
  if (server.authType === "oauth" && !hasStoredTokens(id)) return false;
  if (server.authType === "bearer" && !getMcpBearer(id)) return false;
  try {
    await connectMcpServer(id, false, null);
  } catch {
    // non-fatal
  }
  return runtime(id).client !== null;
}

/** Unprefixed tools for one server (for the settings UI). */
export async function getMcpServerTools(id: string): Promise<CorosMcpTool[]> {
  const server = getMcpServer(id);
  if (!server) return [];
  const rt = runtime(id);
  if (rt.client) await refreshTools(server);
  return rt.tools;
}

export async function callMcpTool(
  prefixedName: string,
  args: Record<string, unknown>
): Promise<string> {
  const split = splitToolName(prefixedName);
  if (!split) {
    throw new Error(`Unknown tool "${prefixedName}".`);
  }
  const rt = runtime(split.serverId);
  const server = getMcpServer(split.serverId);
  const serverName = server?.name ?? split.serverId;
  if (!rt.client) {
    throw new Error(
      `${serverName} MCP is not connected. Connect it in Settings → MCP Servers.`
    );
  }

  let result;
  try {
    result = await rt.client.callTool({ name: split.toolName, arguments: args });
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    throw new Error(formatToolFailure(serverName, split.serverId, split.toolName, detail));
  }

  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((block) => {
      if (block && typeof block === "object" && "text" in block) {
        return String((block as { text: unknown }).text ?? "");
      }
      return JSON.stringify(block);
    })
    .join("\n");
  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? JSON.stringify(result.structuredContent)
      : "";
  const combined = [text.trim(), structured.trim()].filter(Boolean).join("\n");

  if (result.isError) {
    throw new Error(
      formatToolFailure(serverName, split.serverId, split.toolName, combined || text || "unknown error")
    );
  }
  if (/service exceptions?/i.test(combined || text)) {
    throw new Error(formatToolFailure(serverName, split.serverId, split.toolName, combined || text));
  }
  return combined || text;
}

function formatToolFailure(
  serverName: string,
  serverId: string,
  toolName: string,
  detail: string
): string {
  const trimmed = detail.trim();
  // Preserve the COROS-specific guidance the coach relies on.
  if (serverId === "coros") {
    if (/service exceptions?/i.test(trimmed)) {
      if (/recovery|health|fitness|training.?load|daily/i.test(toolName)) {
        return (
          `COROS MCP ${toolName} is temporarily unavailable (COROS server error). ` +
          "Try again later, or use local get_activity_detail / the training snapshot for activity questions."
        );
      }
      return (
        `COROS MCP ${toolName} failed with a COROS server error. Try again later. ` +
        "For lap splits and workout breakdowns, use local get_activity_detail instead."
      );
    }
    if (/lap|split|interval|activity|workout/i.test(toolName)) {
      return (
        `COROS MCP ${toolName} failed: ${trimmed}. ` +
        "For lap and split analysis, prefer local get_activity_detail."
      );
    }
    return `COROS MCP ${toolName} failed: ${trimmed}`;
  }
  return `${serverName} MCP ${toolName} failed: ${trimmed}`;
}

// ----- status -----

function statusFor(server: McpServerConfig): McpServerStatus {
  const rt = runtime(server.id);
  let authenticated: boolean;
  if (server.authType === "none") authenticated = true;
  else if (server.authType === "bearer") authenticated = Boolean(getMcpBearer(server.id));
  else authenticated = hasStoredTokens(server.id);
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    connected: rt.client !== null,
    authenticated,
    toolCount: rt.tools.length,
    error: rt.lastError
  };
}

export function getMcpStatuses(): McpServerStatus[] {
  return listMcpServers().map((server) => statusFor(server));
}

export function getMcpServerStatus(id: string): McpServerStatus | undefined {
  const server = getMcpServer(id);
  return server ? statusFor(server) : undefined;
}

// ----- helpers -----

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
