// Coach's tools for an AI that runs as its own program (Claude Code, Gemini CLI, OpenCode, Antigravity): a small MCP
// server over HTTP on 127.0.0.1, for one answer only. It takes a random bearer token, offers exactly Coach's tools and
// refuses anything else. Calls are handed to `call`; nothing here reads data itself.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ToolDef } from "@/lib/coach/tools";

export const BRIDGE_NAME = "clink";
const MAX_BODY = 4 * 1024 * 1024;

export interface ToolBridge { url: string; token: string; close(): void }

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: Record<string, unknown> };

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new Error("too large");
  }
  return body;
}

export async function openBridge(tools: readonly ToolDef[], call: (name: string, input: unknown) => Promise<{ text: string; isError?: boolean }>): Promise<ToolBridge> {
  const token = randomBytes(32).toString("base64url");
  const offered = new Set(tools.map((t) => t.name));

  async function answer(rpc: Rpc): Promise<unknown> {
    switch (rpc.method) {
      case "initialize":
        return { protocolVersion: typeof rpc.params?.protocolVersion === "string" ? rpc.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "C-LINK Coach", version: "1" } };
      case "ping":
        return {};
      case "tools/list":
        return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) };
      case "tools/call": {
        const name = String(rpc.params?.name ?? "");
        if (!offered.has(name)) return { content: [{ type: "text", text: `Error: there is no tool called ${name}.` }], isError: true };
        const result = await call(name, rpc.params?.arguments ?? {});
        return { content: [{ type: "text", text: result.text }], isError: !!result.isError };
      }
      default:
        throw Object.assign(new Error(`Unknown method ${rpc.method}`), { code: -32601 });
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end(); return; }
    let parsed: Rpc | Rpc[];
    try { parsed = JSON.parse(await readBody(req)) as Rpc | Rpc[]; } catch { res.writeHead(400).end(); return; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    const replies = await Promise.all(batch.filter((r) => r.id !== undefined && r.id !== null).map(async (r) => {
      try { return { jsonrpc: "2.0", id: r.id, result: await answer(r) }; } catch (error) {
        return { jsonrpc: "2.0", id: r.id, error: { code: (error as { code?: number }).code ?? -32603, message: error instanceof Error ? error.message : "failed" } };
      }
    }));
    // Notifications only (initialized, cancelled): accepted, nothing to say.
    if (!replies.length) { res.writeHead(202).end(); return; }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
  }

  const server = createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); }); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp`, token, close: () => { server.closeAllConnections(); server.close(); } };
}
