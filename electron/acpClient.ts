import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { stripVTControlCharacters } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult
} from "@modelcontextprotocol/sdk/types.js";
import type { CorosMcpTool } from "./types";

// Shared by the Coach providers that run an Agent Client Protocol (ACP) agent:
// JSON-RPC over stdio, one process per request, with Coach tools reached
// through a loopback MCP server that lives only as long as the request.

const STDERR_TAIL_BYTES = 4_000;
const MCP_ENDPOINT = "/mcp";

export class AcpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    /** The agent's own detail, when it sent one. */
    readonly detail?: string
  ) {
    super(message);
    this.name = "AcpError";
  }
}

export function acpErrorMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught || "Unknown error");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export interface AcpAgentOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Names the agent in errors, e.g. "Gemini CLI". */
  label: string;
  /** Windows `.cmd` launchers run through the shell. */
  shell?: boolean;
  /**
   * The answer to `session/request_permission`. Without it every request is
   * cancelled, which declines the agent's own tools.
   */
  onPermission?: (params: unknown) => unknown;
  /** Each complete line the agent prints to stderr. */
  onStderrLine?: (line: string) => void;
}

/** An agent process speaking ACP: newline-delimited JSON-RPC 2.0 on stdio. */
export class AcpAgent {
  onNotification?: (method: string, params: unknown) => void;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private buffer = "";
  private stderrBuffer = "";
  private stderrTail = "";
  private exited = false;
  private readonly exitedPromise: Promise<void>;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly options: AcpAgentOptions
  ) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
    child.stderr.on("data", (chunk: string) => this.receiveStderr(chunk));
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => this.fail(error));
    this.exitedPromise = new Promise((resolve) => child.once("close", () => resolve()));
    child.on("exit", (code, signal) => {
      const detail = stripVTControlCharacters(this.stderrTail).trim().split(/\r?\n/).filter(Boolean).at(-1);
      this.fail(
        new Error(
          detail
            ? `${options.label} exited: ${detail}`
            : `${options.label} exited (${code ?? signal ?? "unknown"}).`
        )
      );
    });
  }

  static start(executablePath: string, args: string[], options: AcpAgentOptions): AcpAgent {
    const child = spawn(options.shell ? `"${executablePath}"` : executablePath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: options.shell ?? false
    });
    return new AcpAgent(child, options);
  }

  initialize(protocolVersion = 1): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "coroslink", title: "CorosLink", version: "1.0.0" }
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.exited) return Promise.reject(new Error(`${this.options.label} is not running.`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.exited) this.write({ jsonrpc: "2.0", method, params });
  }

  close(): void {
    if (this.exited) return;
    this.child.stdin.end();
    this.child.kill();
  }

  /** Ends the process and returns what it printed to stderr, which it may hold until exit. */
  async stop(waitMs = 3_000): Promise<string> {
    this.close();
    await this.waitForExit(waitMs);
    return this.stderrTail;
  }

  /** Resolves when the process has exited, or after `waitMs`. */
  async waitForExit(waitMs: number): Promise<void> {
    await Promise.race([
      this.exitedPromise,
      new Promise((resolve) => setTimeout(resolve, waitMs))
    ]);
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receiveStderr(chunk: string): void {
    this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    if (!this.options.onStderrLine) return;
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split("\n");
    this.stderrBuffer = (lines.pop() ?? "").slice(-64 * 1024);
    for (const line of lines) this.options.onStderrLine(line.replace(/\r$/, ""));
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: {
        id?: number | string;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: { code?: number; message?: string; data?: unknown };
      };
      try {
        message = JSON.parse(line);
      } catch {
        continue; // Stray log output.
      }
      if (message.method && message.id !== undefined) {
        this.answer(message.id, message.method, message.params);
      } else if (message.method) {
        this.onNotification?.(message.method, message.params);
      } else if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new AcpError(
              message.error.message || `${this.options.label} request failed.`,
              message.error.code,
              acpErrorDetail(message.error.data)
            )
          );
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  /** Requests from the agent. Files and terminals are not offered. */
  private answer(id: number | string, method: string, params: unknown): void {
    if (method === "session/request_permission") {
      const result = this.options.onPermission?.(params) ?? { outcome: { outcome: "cancelled" } };
      this.write({ jsonrpc: "2.0", id, result });
      return;
    }
    this.write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `CorosLink does not support ${method}.` }
    });
  }

  private fail(error: Error): void {
    this.exited = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function acpErrorDetail(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  const record = data as { message?: unknown; details?: unknown } | undefined;
  if (typeof record?.message === "string") return record.message;
  return typeof record?.details === "string" ? record.details : undefined;
}

// ----- Tool bridge -----

export interface ToolBridgeCallbacks {
  onToolCallStart?(toolName: string): void;
  onToolCallError?(toolName: string, message: string): void;
  onToolCall(toolName: string, args: Record<string, unknown>): Promise<string>;
  onActivity(): void;
}

export interface ToolBridge {
  url: string;
  token: string;
  close(): Promise<void>;
}

/** The bridge as an ACP `mcpServers` entry. */
export function toolBridgeServer(bridge: ToolBridge, name: string): Record<string, unknown> {
  return {
    type: "http",
    name,
    url: bridge.url,
    headers: [{ name: "Authorization", value: `Bearer ${bridge.token}` }]
  };
}

/**
 * A loopback MCP server for one request. Only the agent process holds its
 * random bearer token, and it closes when the request ends.
 */
export async function startToolBridge(
  serverName: string,
  tools: CorosMcpTool[],
  callbacks: ToolBridgeCallbacks
): Promise<ToolBridge> {
  const token = crypto.randomBytes(32).toString("base64url");
  // Raw JSON schemas, so the handlers go on the protocol server directly.
  const server = new McpServer(
    { name: serverName, version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Use only these CorosLink tools for approved training data, plan drafts, and calendar changes. Uploads and deletions always require explicit athlete confirmation via the buttons in chat."
    }
  );
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "CorosLink Coach tool",
      inputSchema: { ...tool.inputSchema, type: "object" as const }
    }))
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const name = request.params.name;
    if (!tools.some((tool) => tool.name === name)) {
      return { isError: true, content: [{ type: "text", text: `Error: unknown tool ${name}` }] };
    }
    callbacks.onToolCallStart?.(name);
    callbacks.onActivity();
    try {
      const output = await callbacks.onToolCall(name, request.params.arguments ?? {});
      return { content: [{ type: "text", text: output }] };
    } catch (caught) {
      const message = acpErrorMessage(caught);
      callbacks.onToolCallError?.(name, message);
      return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
    } finally {
      callbacks.onActivity();
    }
  });

  let transport: StreamableHTTPServerTransport | undefined;
  const httpServer = http.createServer((request, response) => {
    // Compare bytes: a non-ASCII header can match the token's length in characters but not in bytes.
    const supplied = Buffer.from(request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1] ?? "");
    const expected = Buffer.from(token);
    const authorized =
      supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (request.url !== MCP_ENDPOINT || !authorized || request.headers.origin || !transport) {
      response.writeHead(request.url !== MCP_ENDPOINT ? 404 : 401).end();
      return;
    }
    transport.handleRequest(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const { port } = httpServer.address() as AddressInfo;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableDnsRebindingProtection: true,
    allowedHosts: [`127.0.0.1:${port}`]
  });
  await server.connect(transport);

  return {
    url: `http://127.0.0.1:${port}${MCP_ENDPOINT}`,
    token,
    close: async () => {
      await server.close().catch(() => undefined);
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}
