// Tools from multiple MCP servers share one flat list exposed to the chat
// providers. To avoid two servers colliding on the same tool name, exposed
// names are prefixed "<serverId>__<toolName>"; the manager splits the prefix to
// route a call back to the right server.

const SEPARATOR = "__";

// Server ids are lowercase slugs (used in tool prefixes, loopback paths, and
// per-server secret keys), so keep them URL/identifier-safe and bounded.
export const SERVER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isValidServerId(id: string): boolean {
  return SERVER_ID_RE.test(id);
}

export function prefixToolName(serverId: string, toolName: string): string {
  return `${serverId}${SEPARATOR}${toolName}`;
}

export function splitToolName(
  prefixed: string
): { serverId: string; toolName: string } | undefined {
  const index = prefixed.indexOf(SEPARATOR);
  // Need a non-empty serverId before the separator and a non-empty toolName
  // after it. Tool names may contain "__", so split on the FIRST separator.
  if (index <= 0 || index + SEPARATOR.length >= prefixed.length) {
    return undefined;
  }
  return {
    serverId: prefixed.slice(0, index),
    toolName: prefixed.slice(index + SEPARATOR.length)
  };
}
