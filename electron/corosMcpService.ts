import type { BrowserWindow } from "electron";
import { corosMcpUrl, isCorosMcpUrl } from "./corosMcpRegions";
import {
  callMcpTool,
  connectMcpServer,
  disconnectMcpServer,
  ensureMcpServerConnected,
  getMcpServerCachedTools,
  getMcpServerStatus,
  getMcpServerTools
} from "./mcpClientManager";
import { getMcpServer } from "./mcpServersStore";
import { prefixToolName } from "./mcpToolNames";
import type {
  CorosMcpAccount,
  CorosMcpStatus,
  CorosMcpTool,
  McpServerStatus
} from "./types";

// Back-compat shim: COROS is now the built-in "coros" entry of the generic MCP
// registry (electron/mcpClientManager.ts). These wrappers keep the original
// signatures so sleepDataService, dailyHealthDataService, and the chatMcp:*
// IPC handlers keep working unchanged.

const COROS = "coros";

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
 */
export async function connectMcpServerWithCorosAccount(
  id: string,
  interactive = true,
  parentWindow: BrowserWindow | null = null
): Promise<McpServerStatus> {
  const server = getMcpServer(id);
  if (!interactive || !server || !isCorosMcpUrl(server.url)) {
    return connectMcpServer(id, interactive, parentWindow);
  }
  const account = readCorosAccount();
  return connectMcpServer(id, interactive, parentWindow, {
    loginHint: account.email,
    preferredUrl:
      server.builtin && account.region ? corosMcpUrl(account.region) : undefined
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
  const status = getMcpServerStatus(COROS);
  return {
    connected: status?.connected ?? false,
    authorized: status?.authenticated ?? false,
    tools: getMcpServerCachedTools(COROS)
  };
}

export async function connectCorosMcp(
  mainWindow?: BrowserWindow | null,
  interactive = true
): Promise<CorosMcpStatus> {
  await connectMcpServerWithCorosAccount(COROS, interactive, mainWindow ?? null);
  return getCorosMcpStatus();
}

export async function ensureCorosMcpConnected(): Promise<boolean> {
  return ensureMcpServerConnected(COROS);
}

export async function disconnectCorosMcp(): Promise<CorosMcpStatus> {
  await disconnectMcpServer(COROS);
  return getCorosMcpStatus();
}

export async function listCorosMcpTools(): Promise<CorosMcpTool[]> {
  if (!getMcpServerStatus(COROS)?.connected) {
    throw new Error("COROS MCP is not connected.");
  }
  return getMcpServerTools(COROS);
}

export function getCorosMcpTools(): CorosMcpTool[] {
  return getMcpServerCachedTools(COROS);
}

export async function callCorosMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  return callMcpTool(prefixToolName(COROS, name), args);
}
