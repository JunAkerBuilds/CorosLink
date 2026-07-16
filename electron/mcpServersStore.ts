import {
  requireDatabase,
  getSetting,
  setSetting,
  deleteSettings
} from "./database";
import { isValidServerId } from "./mcpToolNames";
import type { McpServerConfig, McpServerInput } from "./types";

const MCP_TRANSPORTS = new Set(["streamable-http"]);
const MCP_AUTH_TYPES = new Set(["oauth", "bearer", "none"]);

// safeStorage is loaded lazily via require so this module can be imported
// outside the Electron runtime (unit tests) without pulling the electron binary
// in. Compiled to CommonJS for Electron, so `require` is available; the tests
// never call the bearer helpers, so require("electron") is never evaluated.
function safeStorage(): typeof import("electron").safeStorage {
  return (require("electron") as typeof import("electron")).safeStorage;
}

interface Row {
  id: string;
  name: string;
  url: string;
  transport: string;
  auth_type: string;
  scope: string | null;
  enabled: number;
  builtin: number;
  sort_order: number;
}

function toConfig(r: Row): McpServerConfig {
  return {
    id: r.id,
    name: validateName(r.name),
    url: validateUrl(r.url),
    transport: validateTransport(r.transport),
    authType: validateAuthType(r.auth_type),
    scope: r.scope ?? undefined,
    enabled: r.enabled === 1,
    builtin: r.builtin === 1,
    sortOrder: r.sort_order
  };
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function validateName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("MCP server name is required.");
  }
  return name.trim();
}

function validateUrl(url: unknown): string {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("MCP server URL is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("MCP server URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("MCP server URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("MCP server URL must not include credentials.");
  }
  return parsed.toString();
}

function validateTransport(transport: unknown): McpServerConfig["transport"] {
  if (typeof transport !== "string" || !MCP_TRANSPORTS.has(transport)) {
    throw new Error(`Unsupported MCP transport "${String(transport)}".`);
  }
  return transport as McpServerConfig["transport"];
}

function validateAuthType(authType: unknown): McpServerConfig["authType"] {
  if (typeof authType !== "string" || !MCP_AUTH_TYPES.has(authType)) {
    throw new Error(`Unsupported MCP authentication type "${String(authType)}".`);
  }
  return authType as McpServerConfig["authType"];
}

function normalizeScope(scope: unknown): string | null {
  if (scope === undefined || scope === null) return null;
  if (typeof scope !== "string") {
    throw new Error("MCP OAuth scope must be a string.");
  }
  return scope.trim() || null;
}

function normalizeEnabled(enabled: unknown, fallback: boolean): boolean {
  if (enabled === undefined) return fallback;
  if (typeof enabled !== "boolean") {
    throw new Error("MCP enabled state must be a boolean.");
  }
  return enabled;
}

export function mcpSecretKey(
  id: string,
  kind: "tokens" | "clientInfo" | "bearer"
): string {
  return `mcp.${id}.${kind}`;
}

export function listMcpServers(db = requireDatabase()): McpServerConfig[] {
  return (
    db.prepare("SELECT * FROM mcp_servers ORDER BY sort_order, name").all() as Row[]
  ).map(toConfig);
}

export function getMcpServer(
  id: string,
  db = requireDatabase()
): McpServerConfig | undefined {
  const row = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as
    | Row
    | undefined;
  return row ? toConfig(row) : undefined;
}

export function addMcpServer(
  input: McpServerInput,
  db = requireDatabase()
): McpServerConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid MCP server configuration.");
  }
  const name = validateName(input.name);
  const id = input.id ?? slug(name);
  if (typeof id !== "string" || !isValidServerId(id)) {
    throw new Error(`Invalid MCP server id: "${id}"`);
  }
  if (getMcpServer(id, db)) {
    throw new Error(`MCP server "${id}" already exists.`);
  }
  const url = validateUrl(input.url);
  const transport = validateTransport(input.transport ?? "streamable-http");
  const authType = validateAuthType(input.authType ?? "oauth");
  const scope = normalizeScope(input.scope);
  const enabled = normalizeEnabled(input.enabled, true);
  const maxOrder = (
    db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM mcp_servers").get() as {
      m: number;
    }
  ).m;
  db.prepare(
    `INSERT INTO mcp_servers (id,name,url,transport,auth_type,scope,enabled,builtin,sort_order)
     VALUES (@id,@name,@url,@transport,@auth_type,@scope,@enabled,0,@sort_order)`
  ).run({
    id,
    name,
    url,
    transport,
    auth_type: authType,
    scope,
    enabled: enabled ? 1 : 0,
    sort_order: maxOrder + 1
  });
  return getMcpServer(id, db)!;
}

export function updateMcpServer(
  id: string,
  patch: Partial<McpServerInput>,
  db = requireDatabase()
): McpServerConfig {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Invalid MCP server update.");
  }
  const existing = getMcpServer(id, db);
  if (!existing) {
    throw new Error(`Unknown MCP server "${id}".`);
  }
  if ("id" in patch) {
    throw new Error("MCP server ids cannot be changed.");
  }
  if (existing.builtin && patch.url !== undefined) {
    throw new Error(`Built-in MCP server "${id}" URL is immutable.`);
  }
  const name = patch.name === undefined ? existing.name : validateName(patch.name);
  const url = patch.url === undefined ? existing.url : validateUrl(patch.url);
  const transport =
    patch.transport === undefined
      ? existing.transport
      : validateTransport(patch.transport);
  const authType =
    patch.authType === undefined
      ? existing.authType
      : validateAuthType(patch.authType);
  const scope =
    patch.scope === undefined
      ? existing.scope ?? null
      : normalizeScope(patch.scope);
  const enabled = normalizeEnabled(patch.enabled, existing.enabled);
  db.prepare(
    `UPDATE mcp_servers SET name=@name, url=@url, transport=@transport,
       auth_type=@auth_type, scope=@scope, enabled=@enabled WHERE id=@id`
  ).run({
    id,
    name,
    url,
    transport,
    auth_type: authType,
    scope,
    enabled: enabled ? 1 : 0
  });
  return getMcpServer(id, db)!;
}

export function removeMcpServer(
  id: string,
  db = requireDatabase(),
  deleteStoredSettings: typeof deleteSettings = deleteSettings
): void {
  const existing = getMcpServer(id, db);
  if (!existing) {
    return;
  }
  if (existing.builtin) {
    throw new Error(`Built-in MCP server "${id}" cannot be removed.`);
  }
  db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  deleteStoredSettings([
    mcpSecretKey(id, "tokens"),
    mcpSecretKey(id, "clientInfo"),
    mcpSecretKey(id, "bearer"),
    `mcp.${id}.resourceUrl`
  ]);
}

export function getMcpBearer(id: string): string | undefined {
  const raw = getSetting(mcpSecretKey(id, "bearer"));
  if (!raw) {
    return undefined;
  }
  try {
    return safeStorage().decryptString(Buffer.from(raw, "base64"));
  } catch {
    return undefined;
  }
}

export function setMcpBearer(id: string, token: string): void {
  const server = getMcpServer(id);
  if (!server) {
    throw new Error(`Unknown MCP server "${id}".`);
  }
  if (server.authType !== "bearer") {
    throw new Error(`${server.name} does not use API key authentication.`);
  }
  if (typeof token !== "string") {
    throw new Error("API key must be a string.");
  }
  const value = token.trim();
  if (!value) {
    throw new Error("API key cannot be empty.");
  }
  const storage = safeStorage();
  if (!storage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable on this system.");
  }
  setSetting(
    mcpSecretKey(id, "bearer"),
    storage.encryptString(value).toString("base64")
  );
  setSetting(`mcp.${id}.resourceUrl`, server.url);
}
