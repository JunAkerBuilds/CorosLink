// The watch-face MCP server outside AI agents (Codex, Claude Code…) use to drive Studio (CorosLink's
// watchfaceAutomationServer.ts, on the same small JSON-RPC base as ai/bridge.ts instead of the MCP SDK). It listens
// on 127.0.0.1 only, wants the private bearer token on every request before anything else, takes only its exact
// loopback Host, refuses requests a web page sends (any Origin but its own), and limits bodies.
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EditorError } from "./broker";
import { LEGIBILITY, type AutomationTool } from "./tools";

export const ENDPOINT = "/mcp";
const MAX_BODY = 1024 * 1024;
const MAX_RESULT = 4 * 1024 * 1024;

const INSTRUCTIONS = [
  "C-LINK's Watch Studio: edit the watch face open in its editor while the person watches.",
  "Call get_context, then get_schema, then get_document. Read capabilities.placement and each layer's placement before moving anything.",
  "apply_commands takes the exact sessionId and revision; one call is one undo step, so group a coherent change into one call. If the revision is stale, read the document again and reapply.",
  "Import pictures with import_asset and use the {assetId} it returns. Check with render_preview (Current and Always-on), check_contrast and validate.",
  LEGIBILITY,
].join("\n");

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: Record<string, unknown> };

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw Object.assign(new Error("too large"), { status: 413 });
  }
  return body;
}

export interface McpServerHandle { port: number; close(): Promise<void> }

/** The JSON-RPC answer to one MCP message (exported for tests). */
export async function answerRpc(tools: readonly AutomationTool[], rpc: Rpc): Promise<unknown> {
  switch (rpc.method) {
    case "initialize":
      return {
        protocolVersion: typeof rpc.params?.protocolVersion === "string" ? rpc.params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} }, serverInfo: { name: "C-LINK Watch Studio", version: "1" }, instructions: INSTRUCTIONS,
      };
    case "ping": return {};
    case "tools/list":
      return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema, ...(t.readOnly ? { annotations: { readOnlyHint: true } } : {}) })) };
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const tool = tools.find((t) => t.name === name);
      if (!tool) return { content: [{ type: "text", text: `There is no tool called ${name}.` }], isError: true };
      const args = rpc.params?.arguments && typeof rpc.params.arguments === "object" ? rpc.params.arguments as Record<string, unknown> : {};
      try {
        const out = await tool.run(args);
        let text = JSON.stringify(out.json);
        if (text.length > MAX_RESULT) text = JSON.stringify({ error: { code: "RESULT_TOO_LARGE", message: "The result is too large. Ask for less (ids, a section)." } });
        return { content: [{ type: "text", text }, ...(out.images ?? []).map((i) => ({ type: "image", data: i.data, mimeType: i.mime }))] };
      } catch (error) {
        const e = error instanceof EditorError ? { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) }
          : { code: "FAILED", message: error instanceof Error ? error.message : "That didn't work." };
        return { content: [{ type: "text", text: JSON.stringify({ error: e }) }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Unknown method ${rpc.method}`), { code: -32601 });
  }
}

/** Whether a request may reach the tools at all: right token, loopback Host on our port, no foreign Origin. */
export function admitted(headers: IncomingMessage["headers"], token: string, port: number): number {
  const auth = headers.authorization ?? "";
  if (!auth.startsWith("Bearer ") || !same(auth.slice(7), token)) return 401;
  const host = headers.host ?? "";
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 403;
  const origin = headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return 403;
  return 0;
}

export async function startMcpServer(tools: readonly AutomationTool[], token: () => string, port: number): Promise<McpServerHandle> {
  let bound = port;
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const refused = admitted(req.headers, token(), bound);
    if (refused) { res.writeHead(refused).end(); return; }
    if ((req.url ?? "").split("?")[0] !== ENDPOINT) { res.writeHead(404).end(); return; }
    // No server-sent stream: every answer comes back on its POST.
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end(); return; }
    let parsed: Rpc | Rpc[];
    try { parsed = JSON.parse(await readBody(req)) as Rpc | Rpc[]; } catch (error) { res.writeHead((error as { status?: number }).status ?? 400).end(); return; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    const replies = [];
    for (const r of batch.filter((x) => x && x.id !== undefined && x.id !== null)) {
      try { replies.push({ jsonrpc: "2.0", id: r.id, result: await answerRpc(tools, r) }); } catch (error) {
        replies.push({ jsonrpc: "2.0", id: r.id, error: { code: (error as { code?: number }).code ?? -32603, message: error instanceof Error ? error.message : "failed" } });
      }
    }
    if (!replies.length) { res.writeHead(202).end(); return; }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
  }
  const server: Server = createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); }); });
  server.requestTimeout = 10 * 60_000;
  const listen = (at: number) => new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(at, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  // The saved port first, so a copied configuration keeps working; any free one if it's taken.
  try { await listen(port); } catch { await listen(0); }
  bound = (server.address() as AddressInfo).port;
  return { port: bound, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
