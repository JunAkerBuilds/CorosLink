import {
  requireDatabase,
  getSetting,
  setSetting,
  deleteSettings
} from "./database";
import { isValidServerId } from "./mcpToolNames";
import type { McpServerConfig, McpServerInput } from "./types";

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
    name: r.name,
    url: r.url,
    transport: r.transport as McpServerConfig["transport"],
    authType: r.auth_type as McpServerConfig["authType"],
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
  const id = input.id ?? slug(input.name);
  if (!isValidServerId(id)) {
    throw new Error(`Invalid MCP server id: "${id}"`);
  }
  if (getMcpServer(id, db)) {
    throw new Error(`MCP server "${id}" already exists.`);
  }
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
    name: input.name,
    url: input.url,
    transport: input.transport ?? "streamable-http",
    auth_type: input.authType ?? "oauth",
    scope: input.scope ?? null,
    enabled: input.enabled === false ? 0 : 1,
    sort_order: maxOrder + 1
  });
  return getMcpServer(id, db)!;
}

export function updateMcpServer(
  id: string,
  patch: Partial<McpServerInput>,
  db = requireDatabase()
): McpServerConfig {
  const existing = getMcpServer(id, db);
  if (!existing) {
    throw new Error(`Unknown MCP server "${id}".`);
  }
  if (existing.builtin && (patch.url !== undefined || patch.id !== undefined)) {
    throw new Error(`Built-in MCP server "${id}" url/id is immutable.`);
  }
  db.prepare(
    `UPDATE mcp_servers SET name=@name, url=@url, transport=@transport,
       auth_type=@auth_type, scope=@scope, enabled=@enabled WHERE id=@id`
  ).run({
    id,
    name: patch.name ?? existing.name,
    url: patch.url ?? existing.url,
    transport: patch.transport ?? existing.transport,
    auth_type: patch.authType ?? existing.authType,
    scope: patch.scope ?? existing.scope ?? null,
    enabled:
      patch.enabled === undefined ? (existing.enabled ? 1 : 0) : patch.enabled ? 1 : 0
  });
  return getMcpServer(id, db)!;
}

export function removeMcpServer(id: string, db = requireDatabase()): void {
  const existing = getMcpServer(id, db);
  if (!existing) {
    return;
  }
  if (existing.builtin) {
    throw new Error(`Built-in MCP server "${id}" cannot be removed.`);
  }
  db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  deleteSettings([
    mcpSecretKey(id, "tokens"),
    mcpSecretKey(id, "clientInfo"),
    mcpSecretKey(id, "bearer")
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
  setSetting(
    mcpSecretKey(id, "bearer"),
    safeStorage().encryptString(token).toString("base64")
  );
}
