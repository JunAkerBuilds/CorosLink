// The athlete's own MCP servers, as tools for Coach. A server is started (stdio) or reached (Streamable HTTP) the
// first time it is needed, its tools are listed, and Coach is offered only the ones the athlete turned on, named
// "<server>__<tool>" (mcpNames.ts). Calls are forwarded with a time limit and come back as text, cut when very long.
// It answers the settings page at /api/desktop/mcp/*; nothing secret goes back to the page.
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ExtraTools } from "@/lib/coach/loop";
import type { ToolDef, ToolResult } from "@/lib/coach/tools";
import { findProgram, searchPath } from "./cli";
import { toolName } from "./mcpNames";
import { openCallback, VaultOAuth } from "./mcpOAuth";
import { checkInput, McpInputError, type McpServerConfig, type McpStore } from "./mcpStore";
import { t } from "@/lib/i18n";

export const CONNECT_MS = 20_000;
export const CALL_MS = 60_000;
const CALL_MAX_MS = 180_000;
/** How long an answer waits for a server that is still starting before going on without it. */
const OFFER_WAIT_MS = 8_000;
export const MAX_RESULT = 24_000;
const MAX_TOOLS = 128;
const MAX_DESCRIPTION = 1_000;
const STDERR_TAIL = 2_000;

export type McpState = "off" | "idle" | "connecting" | "connected" | "error" | "signin";

export interface McpToolView { name: string; description: string; on: boolean; as: string }
export interface McpServerView {
  id: string; name: string; enabled: boolean; transport: McpServerConfig["transport"]; auth: McpServerConfig["auth"];
  /** The command line or the URL, without anything secret. */
  target: string;
  envNames: string[]; headerNames: string[];
  state: McpState; error?: string;
  signedIn: boolean;
  tools: McpToolView[];
}

interface Live { client: Client; transport: Transport; tools: Tool[]; stderr: () => string }
interface Conn { live?: Live; pending?: Promise<Live>; state: McpState; error?: string }

export interface McpHooks {
  /** Opens a URL in the athlete's browser (OAuth sign-in). */
  openExternal(url: string): void;
  /** Starts a stdio server; tests swap it. */
  stdio?(server: McpServerConfig, env: Record<string, string>): Transport;
  log?(line: string): void;
}

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

/** A tool's input schema as every provider takes it: an object with properties, without the $schema line. */
export function schemaOf(tool: Pick<Tool, "inputSchema">): ToolDef["input_schema"] {
  const raw = (tool.inputSchema ?? {}) as Record<string, unknown>;
  const { $schema: _drop, ...rest } = raw;
  void _drop;
  return { ...rest, type: "object", properties: typeof rest.properties === "object" && rest.properties ? rest.properties as Record<string, unknown> : {} } as ToolDef["input_schema"];
}

/** A tool's answer as text for the model. Pictures and sound aren't passed on; a very long answer is cut. */
export function resultText(result: { content?: unknown; structuredContent?: unknown; isError?: boolean }, max = MAX_RESULT): string {
  const parts: string[] = [];
  for (const c of Array.isArray(result.content) ? result.content as Record<string, unknown>[] : []) {
    if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
    else if (c.type === "image") parts.push(`[an image (${String(c.mimeType ?? "image")}) that can't be shown here]`);
    else if (c.type === "audio") parts.push("[audio that can't be played here]");
    else if (c.type === "resource") {
      const r = (c.resource ?? {}) as Record<string, unknown>;
      parts.push(typeof r.text === "string" ? r.text : `[a file: ${String(r.uri ?? "")}]`);
    } else if (c.type === "resource_link") parts.push(`[link: ${String(c.name ?? "")} ${String(c.uri ?? "")}]`.trim());
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  let text = parts.join("\n\n").trim() || (result.isError ? "The tool failed and said nothing." : "The tool answered with nothing.");
  if (text.length > max) text = `${text.slice(0, max)}\n… (cut: ${text.length - max} more characters)`;
  return text;
}

/** Why connecting failed, in words for the settings page. */
function why(error: unknown, server: McpServerConfig, stderr: string): string {
  const code = (error as { code?: unknown })?.code;
  if (code === "ENOENT" || code === "ENOTDIR" || /\b(ENOENT|ENOTDIR)\b/.test(String((error as Error)?.message))) return server.command ? t("Couldn't find {command}.", { command: server.command }) : t("Couldn't find the command.");
  let message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) message = t("Couldn't reach the server.");
  const last = stderr.trim().split("\n").filter(Boolean).at(-1);
  return `${message.slice(0, 240)}${last && !message.includes(last) ? ` · ${last.slice(0, 200)}` : ""}`;
}

export class McpHub {
  private readonly conns = new Map<string, Conn>();
  /** Coach's name for each offered tool → its server and the server's own name for it. */
  private routes = new Map<string, { id: string; tool: string }>();

  constructor(private readonly store: McpStore, private readonly hooks: McpHooks) {}

  private conn(id: string): Conn {
    let c = this.conns.get(id);
    if (!c) { c = { state: "idle" }; this.conns.set(id, c); }
    return c;
  }

  private async transportFor(server: McpServerConfig): Promise<{ transport: Transport; stderr: () => string; oauth?: VaultOAuth }> {
    const secrets = await this.store.secrets(server.id);
    if (server.transport === "stdio") {
      // A plain environment (not the app's own, which may hold keys), the usual program folders on PATH, and the
      // athlete's own values for this server.
      const env: Record<string, string> = { ...getDefaultEnvironment(), PATH: searchPath().join(path.delimiter), ...secrets.env };
      if (this.hooks.stdio) return { transport: this.hooks.stdio(server, env), stderr: () => "" };
      const command = server.command!.includes("/") ? server.command! : findProgram(server.command!);
      if (!command) throw Object.assign(new Error(t("Couldn't find {command}.", { command: server.command ?? "" })), { code: "ENOENT" });
      const transport = new StdioClientTransport({ command, args: server.args ?? [], env, cwd: os.homedir(), stderr: "pipe" });
      let tail = "";
      transport.stderr?.on("data", (d: Buffer) => { tail = (tail + d.toString()).slice(-STDERR_TAIL); });
      return { transport, stderr: () => tail };
    }
    const headers: Record<string, string> = { ...secrets.headers };
    if (server.auth === "bearer" && secrets.bearer) headers.Authorization = `Bearer ${secrets.bearer}`;
    const oauth = server.auth === "oauth" ? new VaultOAuth(this.store, server.id, secrets.oauth?.redirect ?? "http://127.0.0.1/callback", undefined, server.scope) : undefined;
    const transport = new StreamableHTTPClientTransport(new URL(server.url!), { requestInit: { headers }, authProvider: oauth });
    return { transport, stderr: () => "", oauth };
  }

  /** The server's live connection, made if there is none. Throws with words for the athlete. */
  connect(id: string): Promise<Live> {
    const c = this.conn(id);
    if (c.live) return Promise.resolve(c.live);
    if (c.pending) return c.pending;
    const server = this.store.get(id);
    if (!server) return Promise.reject(new Error(t("There's no such server.")));
    if (!server.enabled) return Promise.reject(new Error(t("{name} is off.", { name: server.name })));
    c.state = "connecting";
    c.error = undefined;
    const attempt = (async (): Promise<Live> => {
      const { transport, stderr, oauth } = await this.transportFor(server).catch((error: unknown) => { throw new Error(why(error, server, "")); });
      const client = new Client({ name: "C-LINK Coach", version: "1" });
      try {
        await withTimeout(client.connect(transport, { timeout: CONNECT_MS }), CONNECT_MS, t("No answer in {seconds} s.", { seconds: CONNECT_MS / 1000 }));
        const live: Live = { client, transport, tools: await this.listTools(client), stderr };
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          live.tools = await this.listTools(client).catch(() => live.tools);
          this.remember(id, live.tools);
        });
        client.onclose = () => {
          // Gone (the program quit, the server dropped us): the next use connects again.
          if (this.conn(id).live === live) { this.conn(id).live = undefined; this.conn(id).state = "idle"; }
        };
        this.remember(id, live.tools);
        return live;
      } catch (error) {
        await client.close().catch(() => {});
        const signin = oauth?.needsSignIn || error instanceof UnauthorizedError || (server.auth === "oauth" && /401|unauthori[sz]ed/i.test(String((error as Error)?.message)));
        throw Object.assign(new Error(signin ? t("Sign in to use it.") : why(error, server, stderr())), { signin });
      }
    })();
    c.pending = attempt;
    attempt.then((live) => { c.live = live; c.state = "connected"; }, (error: Error & { signin?: boolean }) => {
      c.state = error.signin ? "signin" : "error";
      c.error = error.message;
      this.hooks.log?.(`MCP ${server.name}: ${error.message}`);
    }).finally(() => { c.pending = undefined; });
    return attempt;
  }

  private async listTools(client: Client): Promise<Tool[]> {
    const tools: Tool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const answer = await client.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_MS });
      for (const t of answer.tools) if (!tools.some((x) => x.name === t.name)) tools.push(t);
      if (!answer.nextCursor || seen.has(answer.nextCursor) || tools.length >= MAX_TOOLS) break;
      seen.add(answer.nextCursor);
      cursor = answer.nextCursor;
    }
    return tools.slice(0, MAX_TOOLS);
  }

  private remember(id: string, tools: readonly Tool[]): void {
    const server = this.store.get(id);
    if (!server) return;
    const known = tools.map((t) => ({ name: t.name, description: (t.description ?? t.title ?? "").slice(0, MAX_DESCRIPTION) }));
    // A tool the server no longer has is turned off, so a new one with its name doesn't come on by itself.
    const on = server.on.filter((n) => known.some((k) => k.name === n));
    if (JSON.stringify(known) !== JSON.stringify(server.known) || on.length !== server.on.length) this.store.update(id, { known, on });
  }

  async disconnect(id: string): Promise<void> {
    const c = this.conns.get(id);
    if (!c) return;
    const live = c.live ?? (c.pending ? await c.pending.catch(() => undefined) : undefined);
    c.live = undefined;
    c.state = "idle";
    c.error = undefined;
    await live?.client.close().catch(() => {});
  }

  /** The last step of quitting, which can't wait: any server program still running is told to stop. */
  stopNow(): void {
    for (const c of this.conns.values()) {
      const pid = c.live?.transport instanceof StdioClientTransport ? c.live.transport.pid : null;
      if (pid) { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
    }
  }

  /** On quit: every server closed, every program stopped. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.conns.keys()].map((id) => this.disconnect(id)));
  }

  async view(server: McpServerConfig): Promise<McpServerView> {
    const c = this.conn(server.id);
    const secrets = server.auth === "oauth" ? await this.store.secrets(server.id) : {};
    const target = server.transport === "stdio" ? [server.command, ...(server.args ?? [])].join(" ") : server.url ?? "";
    return {
      id: server.id, name: server.name, enabled: server.enabled, transport: server.transport, auth: server.auth, target,
      envNames: server.envNames, headerNames: server.headerNames,
      state: server.enabled ? c.state : "off", ...(c.error && server.enabled ? { error: c.error } : {}),
      signedIn: !!secrets.oauth?.tokens,
      tools: server.known.map((t) => ({ name: t.name, description: t.description, on: server.on.includes(t.name), as: toolName(server.slug, t.name) })),
    };
  }

  async status(): Promise<{ servers: McpServerView[] }> {
    return { servers: await Promise.all(this.store.list().map((s) => this.view(s))) };
  }

  /** Coach's extra tools for one answer: the ones turned on, from servers that answer in time. Null when there are none. */
  async coachTools(): Promise<ExtraTools | null> {
    const wanted = this.store.list().filter((s) => s.enabled && s.on.length);
    if (!wanted.length) return null;
    const defs: ToolDef[] = [], words: Record<string, string> = {};
    const routes = new Map<string, { id: string; tool: string }>();
    await Promise.all(wanted.map(async (server) => {
      const live = await withTimeout(this.connect(server.id), OFFER_WAIT_MS, "slow").catch(() => null);
      if (!live) return;
      for (const tool of live.tools) {
        if (!server.on.includes(tool.name)) continue;
        const name = toolName(server.slug, tool.name);
        if (routes.has(name)) continue;
        routes.set(name, { id: server.id, tool: tool.name });
        const about = (tool.description ?? tool.title ?? "").slice(0, MAX_DESCRIPTION);
        defs.push({ name, description: `From ${server.name}, an MCP server the athlete added.${about ? ` ${about}` : ""}`, input_schema: schemaOf(tool) });
        words[name] = t("Asking {server}", { server: server.name });
      }
    }));
    if (!defs.length) return null;
    for (const [k, v] of routes) this.routes.set(k, v);
    return { defs, words, run: (name, input, signal) => this.call(name, input, signal) };
  }

  /** Runs one of Coach's calls on its server. Never throws. */
  async call(name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult> {
    const route = this.routes.get(name);
    const server = route && this.store.get(route.id);
    if (!route || !server) return { text: `Error: there is no tool called ${name}.`, isError: true };
    if (!server.enabled || !server.on.includes(route.tool)) return { text: `Error: the athlete turned ${name} off.`, isError: true };
    const source = { title: server.name, detail: route.tool, href: "/coach/settings?section=mcp" };
    const args = typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const live = await this.connect(server.id);
        const result = await live.client.callTool({ name: route.tool, arguments: args }, undefined, { timeout: CALL_MS, resetTimeoutOnProgress: true, maxTotalTimeout: CALL_MAX_MS, signal });
        const text = resultText(result as { content?: unknown; structuredContent?: unknown; isError?: boolean });
        return result.isError ? { text: `Error: ${text}`, isError: true, source } : { text, source };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The connection dropped under us: once more on a fresh one.
        if (attempt === 0 && !signal?.aborted && /closed|not connected|EPIPE|ECONNRESET/i.test(message)) { await this.disconnect(server.id); continue; }
        return { text: `Error: ${server.name} couldn't run ${route.tool}: ${message.slice(0, 300)}`, isError: true, source };
      }
    }
    return { text: `Error: ${server.name} couldn't run ${route.tool}.`, isError: true, source };
  }

  /** OAuth sign-in in the athlete's browser, then a fresh connection. */
  async signIn(id: string): Promise<void> {
    const server = this.store.get(id);
    if (!server || server.transport !== "http" || server.auth !== "oauth") throw new McpInputError(t("This server doesn't use sign-in."));
    await this.disconnect(id);
    const callback = await openCallback();
    try {
      const oauth = new VaultOAuth(this.store, id, callback.redirect, (url) => this.hooks.openExternal(url), server.scope);
      const first = await auth(oauth, { serverUrl: server.url! });
      if (first === "REDIRECT") {
        const code = await callback.code(() => oauth.sentState);
        await auth(oauth, { serverUrl: server.url!, authorizationCode: code });
      }
    } finally {
      callback.close();
    }
    await this.connect(id).catch(() => {});
  }

  async signOut(id: string): Promise<void> {
    await this.disconnect(id);
    await this.store.setOAuth(id, null);
  }

  /** /api/desktop/mcp/*. */
  async answer(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const action = pathname.slice("/api/desktop/mcp".length).replace(/^\//, "");
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const id = typeof body.id === "string" ? body.id : "";
    const server = id ? this.store.get(id) : undefined;
    try {
      if (request.method === "GET" && action === "") return reply(await this.status());
      if (request.method !== "POST") return reply({ error: "notFound" }, 404);

      if (action === "add") {
        const added = await this.store.add(checkInput(body));
        // Connects now to list its tools, unless it waits for a sign-in.
        if (added.auth !== "oauth") await this.connect(added.id).catch(() => {});
        return reply({ ...(await this.status()), added: added.id });
      }
      if (!server) return reply({ error: "invalid", message: t("There's no such server.") }, 404);

      if (action === "remove") { await this.disconnect(id); await this.store.remove(id); return reply(await this.status()); }
      if (action === "enable") {
        const enabled = body.enabled === true;
        this.store.update(id, { enabled });
        if (enabled) await this.connect(id).catch(() => {}); else await this.disconnect(id);
        return reply(await this.status());
      }
      if (action === "tools") {
        // One tool ({ tool, on }) or all of them ({ all: true | false }).
        const names = server.known.map((t) => t.name);
        const on = typeof body.all === "boolean" ? (body.all ? names : [])
          : typeof body.tool === "string" && names.includes(body.tool) ? (body.on === true ? [...new Set([...server.on, body.tool])] : server.on.filter((n) => n !== body.tool))
          : null;
        if (!on) return reply({ error: "invalid", message: t("There's no such tool.") }, 400);
        this.store.update(id, { on });
        return reply(await this.status());
      }
      if (action === "connect") {
        await this.disconnect(id);
        await this.connect(id).catch(() => {});
        return reply(await this.status());
      }
      if (action === "signin") { await this.signIn(id); return reply(await this.status()); }
      if (action === "signout") { await this.signOut(id); return reply(await this.status()); }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("That didn't work.");
      return reply({ error: error instanceof McpInputError ? "invalid" : "failed", message }, error instanceof McpInputError ? 400 : 502);
    }
    return reply({ error: "notFound" }, 404);
  }
}
