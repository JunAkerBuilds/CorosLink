// The MCP servers the athlete added for Coach. What each one is (name, command or address, which tools are on) is
// plain JSON in mcp.json; everything secret about it (env values, header values, a bearer token, OAuth tokens) is
// one JSON object per server in the AI vault (`mcp:<id>`), encrypted with the OS keychain. Only names of env vars and
// headers are kept in the JSON, so the settings page can list them without ever seeing a value.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { uniqueSlug } from "./mcpNames";
import type { AIVault } from "./vault";

export type McpTransport = "stdio" | "http";
export type McpAuth = "none" | "bearer" | "oauth";

export interface McpKnownTool { name: string; description: string }

export interface McpServerConfig {
  id: string;
  /** Its tools' prefix: "strava" → strava__get_activity. Fixed once added. */
  slug: string;
  name: string;
  /** Off: never started or asked, and none of its tools go to Coach. */
  enabled: boolean;
  transport: McpTransport;
  /** stdio: the program and its arguments. */
  command?: string;
  args?: string[];
  /** http: the Streamable HTTP endpoint. */
  url?: string;
  auth: McpAuth;
  /** OAuth scope to ask for; the server's own default when absent. */
  scope?: string;
  /** Names only; the values are in the vault. */
  envNames: string[];
  headerNames: string[];
  /** The tools turned on for Coach. A tool is off until the athlete turns it on. */
  on: string[];
  /** The tools the server listed last time, so settings shows them while it isn't connected. */
  known: McpKnownTool[];
  added: number;
}

export interface McpSecrets {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  bearer?: string;
  oauth?: { tokens?: OAuthTokens; client?: OAuthClientInformationMixed; redirect?: string; verifier?: string };
}

/** What the page sends to add a server. Values of env and headers go to the vault, never to mcp.json. */
export interface McpServerInput {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  auth?: McpAuth;
  scope?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  bearer?: string;
}

export class McpInputError extends Error {}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function pairs(raw: unknown, valid: RegExp, what: string): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new McpInputError(`${what} must be name and value pairs.`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!valid.test(k)) throw new McpInputError(`“${k.slice(0, 40)}” isn't a valid ${what.toLowerCase()} name.`);
    if (typeof v !== "string" || v.length > 8000) throw new McpInputError(`${k}'s value is too long.`);
    out[k] = v;
  }
  return out;
}

/** A server as typed on the page, checked. Throws McpInputError with words for the athlete. */
export function checkInput(raw: unknown): McpServerInput {
  const b = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : "";
  if (!name) throw new McpInputError("Give it a name.");
  const transport = b.transport === "http" ? "http" : b.transport === "stdio" ? "stdio" : null;
  if (!transport) throw new McpInputError("Pick a command or a URL.");
  if (transport === "stdio") {
    const command = typeof b.command === "string" ? b.command.trim() : "";
    if (!command || command.length > 1000) throw new McpInputError("Type the command that starts the server.");
    const args = strings(b.args).slice(0, 64);
    if (args.some((a) => a.length > 2000)) throw new McpInputError("An argument is too long.");
    return { name, transport, command, args, env: pairs(b.env, NAME, "Env") };
  }
  let url: URL;
  try { url = new URL(String(b.url ?? "").trim()); } catch { throw new McpInputError("That isn't a URL."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new McpInputError("Use an http or https URL.");
  if (url.username || url.password) throw new McpInputError("Put the password in a header or token, not the URL.");
  const auth: McpAuth = b.auth === "oauth" ? "oauth" : b.auth === "bearer" ? "bearer" : "none";
  const bearer = typeof b.bearer === "string" ? b.bearer.trim() : "";
  if (auth === "bearer" && !/^[\x21-\x7e]{1,4000}$/.test(bearer)) throw new McpInputError("Paste the token.");
  const scope = typeof b.scope === "string" && b.scope.trim() ? b.scope.trim().slice(0, 400) : undefined;
  const headers = pairs(b.headers, HEADER, "Header");
  if (Object.keys(headers).some((h) => h.toLowerCase() === "authorization") && auth !== "none") throw new McpInputError("Use either a token or an Authorization header.");
  return { name, transport, url: url.href, auth, scope, headers, ...(auth === "bearer" ? { bearer } : {}) };
}

export class McpStore {
  private readonly file: string;
  private servers: McpServerConfig[] = [];

  constructor(folder: string, private readonly vault: Pick<AIVault, "secret" | "setSecret">) {
    this.file = path.join(folder, "mcp.json");
    try {
      if (existsSync(this.file)) {
        const saved = JSON.parse(readFileSync(this.file, "utf8")) as { servers?: unknown };
        this.servers = (Array.isArray(saved.servers) ? saved.servers : []).filter((s): s is McpServerConfig =>
          typeof s === "object" && s !== null && typeof (s as McpServerConfig).id === "string" && typeof (s as McpServerConfig).slug === "string")
          .map((s) => ({ ...s, on: strings(s.on), known: Array.isArray(s.known) ? s.known : [], envNames: strings(s.envNames), headerNames: strings(s.headerNames), auth: s.auth ?? "none" }));
      }
    } catch { /* starts empty */ }
  }

  list(): readonly McpServerConfig[] { return this.servers; }
  get(id: string): McpServerConfig | undefined { return this.servers.find((s) => s.id === id); }

  private write(): void {
    writeFileSync(this.file, JSON.stringify({ servers: this.servers }, null, 2), { mode: 0o600 });
  }

  async add(input: McpServerInput): Promise<McpServerConfig> {
    if (this.servers.length >= 20) throw new McpInputError("That's 20 servers already. Remove one first.");
    const id = randomBytes(8).toString("hex");
    const server: McpServerConfig = {
      id, slug: uniqueSlug(input.name, this.servers.map((s) => s.slug)), name: input.name, enabled: true, transport: input.transport,
      ...(input.transport === "stdio" ? { command: input.command, args: input.args ?? [] } : { url: input.url }),
      auth: input.transport === "http" ? input.auth ?? "none" : "none", ...(input.scope ? { scope: input.scope } : {}),
      envNames: Object.keys(input.env ?? {}), headerNames: Object.keys(input.headers ?? {}), on: [], known: [], added: Date.now(),
    };
    const secrets: McpSecrets = {};
    if (server.envNames.length) secrets.env = input.env;
    if (server.headerNames.length) secrets.headers = input.headers;
    if (input.bearer) secrets.bearer = input.bearer;
    if (Object.keys(secrets).length) await this.setSecrets(id, secrets);
    this.servers.push(server);
    this.write();
    return server;
  }

  update(id: string, change: Partial<Pick<McpServerConfig, "enabled" | "on" | "known" | "name">>): McpServerConfig | undefined {
    const at = this.servers.findIndex((s) => s.id === id);
    if (at < 0) return undefined;
    this.servers[at] = { ...this.servers[at], ...change };
    this.write();
    return this.servers[at];
  }

  async remove(id: string): Promise<void> {
    this.servers = this.servers.filter((s) => s.id !== id);
    this.write();
    await this.vault.setSecret(`mcp:${id}`, null);
  }

  async secrets(id: string): Promise<McpSecrets> {
    const raw = await this.vault.secret(`mcp:${id}`);
    if (!raw) return {};
    try { return JSON.parse(raw) as McpSecrets; } catch { return {}; }
  }

  async setSecrets(id: string, secrets: McpSecrets): Promise<void> {
    const empty = !Object.values(secrets).some((v) => v !== undefined);
    await this.vault.setSecret(`mcp:${id}`, empty ? null : JSON.stringify(secrets));
  }

  /** Changes the stored OAuth part only. */
  setOAuth(id: string, change: Partial<NonNullable<McpSecrets["oauth"]>> | null): Promise<void> {
    // One change at a time, so tokens and client details saved together don't undo each other.
    const next = this.changing.then(async () => {
      const all = await this.secrets(id);
      const oauth = change === null ? undefined : { ...all.oauth, ...change };
      await this.setSecrets(id, { ...all, oauth });
    });
    this.changing = next.catch(() => {});
    return next;
  }

  private changing: Promise<void> = Promise.resolve();
}
