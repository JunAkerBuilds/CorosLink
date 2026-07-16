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
