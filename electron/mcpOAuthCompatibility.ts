export function mcpOAuthClientName(
  resourceUrl: string,
  serverName: string
): string {
  // Strava's current MCP rollout only provisions its published Claude client
  // during dynamic registration. Keep CorosLink visible in the identifier while
  // using the Claude-compatible prefix that Strava accepts.
  if (new URL(resourceUrl).hostname.toLowerCase() === "mcp.strava.com") {
    return `Claude Code (${serverName} via CorosLink)`;
  }
  return "CorosLink";
}

export type McpOAuthInvalidationScope =
  | "all"
  | "client"
  | "tokens"
  | "verifier"
  | "discovery";

export type McpOAuthInvalidationTarget =
  | "clientInformation"
  | "tokens"
  | "verifier";

export function mcpOAuthInvalidationTargets(
  scope: McpOAuthInvalidationScope
): McpOAuthInvalidationTarget[] {
  if (scope === "all") {
    return ["clientInformation", "tokens", "verifier"];
  }
  if (scope === "client") return ["clientInformation"];
  if (scope === "tokens") return ["tokens"];
  if (scope === "verifier") return ["verifier"];
  // Discovery metadata is not persisted by CorosLink.
  return [];
}
