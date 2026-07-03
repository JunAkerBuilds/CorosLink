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
import type { CorosMcpStatus, CorosMcpTool } from "./types";

// COROS official MCP server. Discovery (auth server metadata, DCR, PKCE) is
// handled by the MCP SDK against these URLs; we only implement token storage
// and the interactive redirect via a loopback server.
const MCP_RESOURCE_URL = "https://mcpus.coros.com/mcp";
const MCP_SCOPE = "openid mcp.tools offline_access";
const LOOPBACK_PORT = 1456;
const LOOPBACK_REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/coros-mcp/callback`;

const SETTINGS = {
  clientInfo: "corosMcp.clientInfo",
  tokens: "corosMcp.tokens"
} as const;

let client: Client | null = null;
let cachedTools: CorosMcpTool[] = [];

// ----- OAuth client provider (persists to settings/safeStorage) -----

class CorosOAuthProvider implements OAuthClientProvider {
  private verifier = "";
  private oauthState = "";
  private loopback: http.Server | null = null;
  private codePromise: Promise<string> | null = null;
  private authWindow: BrowserWindow | undefined;

  constructor(
    private readonly parentWindow?: BrowserWindow | null,
    private readonly interactive = true
  ) {}

  get redirectUrl(): string {
    return LOOPBACK_REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "CorosLink",
      redirect_uris: [LOOPBACK_REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: MCP_SCOPE
    };
  }

  state(): string {
    if (!this.oauthState) {
      this.oauthState = base64Url(crypto.randomBytes(16));
    }
    return this.oauthState;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    const raw = getSetting(SETTINGS.clientInfo);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OAuthClientInformationFull;
    } catch {
      return undefined;
    }
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    setSetting(SETTINGS.clientInfo, JSON.stringify(info));
  }

  tokens(): OAuthTokens | undefined {
    return readTokens();
  }

  saveTokens(tokens: OAuthTokens): void {
    writeTokens(tokens);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    return this.verifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Non-interactive (silent reconnect): never pop a browser window.
    if (!this.interactive) return;
    this.startLoopback();
    this.authWindow = new BrowserWindow({
      width: 520,
      height: 760,
      title: "Connect COROS",
      parent: this.parentWindow ?? undefined,
      modal: Boolean(this.parentWindow),
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    this.authWindow.on("closed", () => {
      this.authWindow = undefined;
    });
    this.authWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    void this.authWindow.loadURL(authorizationUrl.toString());
  }

  /** Resolves with the authorization code once the loopback callback fires. */
  waitForCode(): Promise<string> {
    if (!this.codePromise) {
      throw new Error("COROS authorization was not started.");
    }
    return this.codePromise;
  }

  cleanup(): void {
    try {
      this.loopback?.close();
    } catch {
      // already closing
    }
    this.loopback = null;
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      const toClose = this.authWindow;
      setTimeout(() => {
        if (!toClose.isDestroyed()) toClose.close();
      }, 300);
    }
  }

  private startLoopback(): void {
    if (this.loopback) return;
    this.codePromise = new Promise<string>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        if (!request.url) return;
        const callbackUrl = new URL(request.url, LOOPBACK_REDIRECT_URI);
        if (callbackUrl.pathname !== "/coros-mcp/callback") {
          response.writeHead(404);
          response.end();
          return;
        }
        const error = callbackUrl.searchParams.get("error");
        const code = callbackUrl.searchParams.get("code");
        const returnedState = callbackUrl.searchParams.get("state");
        response.writeHead(200, { "Content-Type": "text/html" });
        if (error) {
          response.end("<p>COROS connection failed. You can close this window.</p>");
          reject(new Error(error));
          return;
        }
        if (returnedState !== this.oauthState || !code) {
          response.end("<p>COROS connection failed. You can close this window.</p>");
          reject(new Error("COROS OAuth state mismatch."));
          return;
        }
        response.end("<p>COROS connected. You can close this window.</p>");
        resolve(code);
      });
      server.on("error", reject);
      server.listen(LOOPBACK_PORT, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        if (address.port !== LOOPBACK_PORT) {
          reject(new Error("COROS OAuth callback port did not bind."));
        }
      });
      this.loopback = server;
    });
  }
}

// ----- Token persistence (encrypted) -----

function readTokens(): OAuthTokens | undefined {
  const encoded = getSetting(SETTINGS.tokens);
  if (!encoded || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    const json = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    return JSON.parse(json) as OAuthTokens;
  } catch {
    return undefined;
  }
}

function writeTokens(tokens: OAuthTokens): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens)).toString("base64");
  setSetting(SETTINGS.tokens, encrypted);
}

// ----- Public API -----

export function getCorosMcpStatus(): CorosMcpStatus {
  return {
    connected: client !== null,
    authorized: Boolean(getSetting(SETTINGS.tokens)),
    tools: cachedTools
  };
}

/** Connects (running the OAuth flow if needed) and caches the tool list. */
export async function connectCorosMcp(
  mainWindow?: BrowserWindow | null,
  interactive = true
): Promise<CorosMcpStatus> {
  if (client) {
    return getCorosMcpStatus();
  }

  const authProvider = new CorosOAuthProvider(mainWindow, interactive);
  const transport = new StreamableHTTPClientTransport(new URL(MCP_RESOURCE_URL), {
    authProvider
  });
  const mcpClient = new Client(
    { name: "CorosLink", version: app.getVersion() },
    { capabilities: {} }
  );

  try {
    try {
      await mcpClient.connect(transport);
    } catch (error) {
      if (error instanceof UnauthorizedError && interactive) {
        const code = await authProvider.waitForCode();
        await transport.finishAuth(code);
        // The original transport is already started; reconnect with a fresh one,
        // which picks up the now-saved tokens via the auth provider.
        const retryTransport = new StreamableHTTPClientTransport(
          new URL(MCP_RESOURCE_URL),
          { authProvider }
        );
        await mcpClient.connect(retryTransport);
      } else {
        throw error;
      }
    }
  } finally {
    authProvider.cleanup();
  }

  client = mcpClient;
  await refreshTools();
  return getCorosMcpStatus();
}

/** Reconnects silently using stored tokens (no browser), if authorized. */
export async function ensureCorosMcpConnected(): Promise<boolean> {
  if (client) return true;
  if (!getSetting(SETTINGS.tokens)) return false;
  try {
    await connectCorosMcp(null, false);
    return client !== null;
  } catch {
    return false;
  }
}

export async function disconnectCorosMcp(): Promise<CorosMcpStatus> {
  if (client) {
    try {
      await client.close();
    } catch {
      // best-effort
    }
  }
  client = null;
  cachedTools = [];
  deleteSettings([SETTINGS.tokens, SETTINGS.clientInfo]);
  return getCorosMcpStatus();
}

export async function listCorosMcpTools(): Promise<CorosMcpTool[]> {
  if (!client) throw new Error("COROS MCP is not connected.");
  await refreshTools();
  return cachedTools;
}

/** Returns discovered tools in a shape ready to hand to a model as functions. */
export function getCorosMcpTools(): CorosMcpTool[] {
  return cachedTools;
}

export async function callCorosMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (!client) throw new Error("COROS MCP is not connected.");
  const result = await client.callTool({ name, arguments: args });
  // Flatten the MCP content blocks into text for the model.
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((block) => {
      if (block && typeof block === "object" && "text" in block) {
        return String((block as { text: unknown }).text ?? "");
      }
      return JSON.stringify(block);
    })
    .join("\n");
  if (result.isError) {
    return `Tool error: ${text || "unknown error"}`;
  }
  return text;
}

async function refreshTools(): Promise<void> {
  if (!client) return;
  const result = await client.listTools();
  cachedTools = (result.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>
  }));
}

// ----- helpers -----

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
