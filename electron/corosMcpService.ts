import type { BrowserWindow } from "electron";
import { COROS_MCP_SERVER_ID, corosMcpUrl, isCorosMcpUrl } from "./corosMcpRegions";
import {
  callMcpTool,
  connectMcpServer,
  corosMcpServerId,
  disconnectMcpServer,
  ensureMcpServerConnected,
  getMcpServerCachedTools,
  getMcpServerStatus,
  getMcpServerTools
} from "./mcpClientManager";
import { getMcpServer, restoreCorosMcpServer } from "./mcpServersStore";
import { prefixToolName } from "./mcpToolNames";
import type {
  CorosMcpAccount,
  CorosMcpStatus,
  CorosMcpTool,
  McpServerStatus
} from "./types";

// Back-compat shim: COROS is now the built-in "coros" entry of the generic MCP
// registry (electron/mcpClientManager.ts), or a COROS endpoint the athlete
// added in its place (corosMcpServerId). These wrappers keep the original
// signatures so sleepDataService, dailyHealthDataService, and the chatMcp:*
// IPC handlers keep working unchanged.

// Main wires in the account from the Training Hub and Watch Faces sessions, so
// this module stays free of those services.
let corosAccount: () => CorosMcpAccount = () => ({});

/** Supplies the COROS account CorosLink is signed in with elsewhere. */
export function setCorosMcpAccountSource(source: () => CorosMcpAccount): void {
  corosAccount = source;
}

/**
 * Connects a registered server. COROS MCP servers sign in with the COROS
 * account CorosLink already knows: its email is filled in on COROS's sign-in
 * page, and the built-in server moves to the account's regional endpoint
 * before it is first authorized.
 *
 * Interactive means the athlete pressed Connect: only then may a sign-in
 * window open, and a server they had disabled is turned back on.
 */
export async function connectMcpServerWithCorosAccount(
  id: string,
  interactive = true,
  parentWindow: BrowserWindow | null = null
): Promise<McpServerStatus> {
  const server = getMcpServer(id);
  if (!interactive || !server || !isCorosMcpUrl(server.url)) {
    return connectMcpServer(id, interactive, parentWindow, { enable: interactive });
  }
  const account = readCorosAccount();
  return connectMcpServer(id, interactive, parentWindow, {
    loginHint: account.email,
    preferredUrl:
      server.builtin && account.region ? corosMcpUrl(account.region) : undefined,
    enable: true
  });
}

function readCorosAccount(): CorosMcpAccount {
  try {
    return corosAccount();
  } catch {
    // Without the account the connection still works; the user types it in.
    return {};
  }
}

export function getCorosMcpStatus(): CorosMcpStatus {
  const id = corosMcpServerId();
  const status = id ? getMcpServerStatus(id) : undefined;
  return {
    connected: status?.connected ?? false,
    authorized: status?.authenticated ?? false,
    tools: id ? getMcpServerCachedTools(id) : []
  };
}

/**
 * The athlete's Connect (interactive), or a silent reconnect with the saved
 * authorization. Their Connect brings back a COROS server they had removed.
 */
export async function connectCorosMcp(
  mainWindow?: BrowserWindow | null,
  interactive = true
): Promise<CorosMcpStatus> {
  let id = corosMcpServerId();
  if (!id && interactive) id = restoreCorosMcpServer().id;
  if (id) await connectMcpServerWithCorosAccount(id, interactive, mainWindow ?? null);
  return getCorosMcpStatus();
}

/**
 * Reconnects with the saved authorization only: never opens COROS sign-in or
 * turns a disabled server on. Background loads use this.
 */
export async function ensureCorosMcpConnected(): Promise<boolean> {
  const id = corosMcpServerId();
  return id ? ensureMcpServerConnected(id) : false;
}

export async function disconnectCorosMcp(): Promise<CorosMcpStatus> {
  const id = corosMcpServerId();
  if (id) await disconnectMcpServer(id);
  return getCorosMcpStatus();
}

export async function listCorosMcpTools(): Promise<CorosMcpTool[]> {
  const id = corosMcpServerId();
  if (!id || !getMcpServerStatus(id)?.connected) {
    throw new Error("COROS MCP is not connected.");
  }
  return getMcpServerTools(id);
}

export function getCorosMcpTools(): CorosMcpTool[] {
  const id = corosMcpServerId();
  return id ? getMcpServerCachedTools(id) : [];
}

export async function callCorosMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  return callMcpTool(prefixToolName(COROS_MCP_SERVER_ID, name), args);
}
