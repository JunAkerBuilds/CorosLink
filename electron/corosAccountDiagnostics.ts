import { getCorosWatchfaceStatus } from "./corosWatchfaceService";
import { getMcpStatuses } from "./mcpClientManager";
import { listMcpServers } from "./mcpServersStore";
import { getTrainingHubStatus } from "./trainingHubService";

/**
 * Connection state of every COROS sign-in, for the top of the error report.
 * Hosts only: no email, user ID, or token ever reaches these lines.
 */
export function corosAccountDiagnostics(): string[] {
  const lines = ["COROS accounts"];
  lines.push(describe("Training Hub", () => {
    const hub = getTrainingHubStatus();
    const autoLogin = hub.rememberCredentials ? "automatic re-login available" : "no saved login for automatic re-login";
    return hub.authenticated
      ? `signed in · ${host(hub.baseUrl)} · region ${hub.regionId ?? "unknown"} · ${autoLogin}`
      : `signed out · ${autoLogin}`;
  }));
  lines.push(describe("Watch Faces (COROS app account)", () => {
    const watchfaces = getCorosWatchfaceStatus();
    const parts = [watchfaces.authenticated ? `signed in · region ${watchfaces.region ?? "unknown"}` : "signed out"];
    if (!watchfaces.secureStorageAvailable) parts.push("secure storage unavailable");
    if (watchfaces.watchAuthenticationError) parts.push(`watch sign-in error: ${watchfaces.watchAuthenticationError}`);
    return parts.join(" · ");
  }));
  try {
    const urls = new Map(listMcpServers().map((server) => [server.id, server.url]));
    for (const server of getMcpStatuses()) {
      const parts = [!server.enabled ? "disabled" : server.connected ? `connected · ${server.toolCount} tools` : "not connected"];
      parts.push(host(urls.get(server.id)));
      if (server.enabled && !server.connected) parts.push(server.authenticated ? "authorized" : "not authorized");
      if (server.error) parts.push(`last error: ${server.error}`);
      lines.push(`- ${server.id === "coros" ? "COROS MCP" : `MCP ${server.name}`}: ${parts.join(" · ")}`);
    }
  } catch (error) {
    lines.push(`- MCP: status unavailable (${error instanceof Error ? error.message : String(error)})`);
  }
  return lines;
}

function describe(label: string, read: () => string): string {
  try { return `- ${label}: ${read()}`; } catch (error) {
    return `- ${label}: status unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
}

function host(url: string | undefined): string {
  try { return url ? new URL(url).host : "no server"; } catch { return "unknown server"; }
}
