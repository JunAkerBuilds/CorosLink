import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CorosMcpTool } from "./types";

/** New capabilities may be on later catalog pages. Publish only a complete list. */
export async function discoverTools(client: Pick<Client, "listTools">): Promise<CorosMcpTool[]> {
  const tools = new Map<string, CorosMcpTool>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await client.listTools(cursor ? { cursor } : undefined);
    for (const tool of result.tools ?? []) {
      tools.set(tool.name, { name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Record<string, unknown> });
    }
    cursor = result.nextCursor;
    if (cursor) {
      if (cursors.has(cursor)) throw new Error("MCP tool discovery returned a repeated page cursor.");
      cursors.add(cursor);
    }
  } while (cursor);
  return [...tools.values()];
}
