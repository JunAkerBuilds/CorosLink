# MCP Server Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hard-coded COROS MCP client into an app-level registry so the in-app chat can connect to multiple hosted MCP servers (COROS, Freddy, Strava, …) and expose their tools to every provider.

**Architecture:** A generic MCP client manager (generalized from `corosMcpService.ts`) is driven by a persisted `mcp_servers` config table. Each enabled server connects via `@modelcontextprotocol/sdk` (Streamable HTTP + per-server OAuth/bearer), and its tools are exposed to the chat under a `"<serverId>__<toolName>"` prefix. `chatService` aggregates all servers' tools into the one list every provider already consumes, and routes tool calls back by splitting the prefix.

**Tech Stack:** Electron + TypeScript, `@modelcontextprotocol/sdk` (already a dependency), better-sqlite3, `safeStorage` for secrets, React renderer.

## Global Constraints

- No new runtime dependencies — `@modelcontextprotocol/sdk` is already present.
- Secrets (OAuth tokens, client info, bearer tokens) are encrypted via `safeStorage` and stored in `app_settings` under per-server keys; never in `mcp_servers`, never logged.
- Tool names exposed to providers are prefixed `"<serverId>__<toolName>"`; the `CorosMcpTool` shape (`{ name, description?, inputSchema }`) is preserved.
- COROS keeps its exact current OAuth params (resource `https://mcpus.coros.com/mcp`, its scope, loopback `:1456`) and must have zero behavior regression.
- OAuth loopback binds `localhost` only, single-flight per port.
- hosted URL transports only (`streamable-http` / `sse`); stdio is out of scope.
- Test scripts follow the repo convention: `node --experimental-strip-types scripts/test-*.mjs`, registered in `package.json`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- Create `electron/mcpServersStore.ts` — DB-backed CRUD for `mcp_servers` + per-server secret helpers.
- Create `electron/mcpToolNames.ts` — pure prefix join/split + routing-table helpers (unit-tested).
- Create `electron/mcpClientManager.ts` — generic multi-server MCP client (generalized from `corosMcpService.ts`), incl. a parameterized `McpOAuthProvider`.
- Modify `electron/database.ts` — create `mcp_servers` table + seed built-in COROS row.
- Modify `electron/corosMcpService.ts` — re-export/delegate to the manager for back-compat (or fold in).
- Modify `electron/chatService.ts` — aggregate + route through the manager.
- Modify `electron/main.ts`, `electron/preload.ts`, `src/coroslink-api.ts` — `mcp:*` IPC.
- Modify `electron/types.ts` — `McpServerConfig`, `McpServerStatus`, `McpServerInput`.
- Create `src/chat/McpServersPanel.tsx` + wire into Settings — registry UI.
- Create `scripts/test-mcp-tool-names.mjs`, `scripts/test-mcp-servers-store.mjs`.

---

### Task 1: Tool-name prefix helpers (pure, TDD)

**Files:**
- Create: `electron/mcpToolNames.ts`
- Test: `scripts/test-mcp-tool-names.mjs`
- Modify: `package.json` (add `test:mcp-tool-names`)

**Interfaces:**
- Produces:
  - `prefixToolName(serverId: string, toolName: string): string` → `"<serverId>__<toolName>"`
  - `splitToolName(prefixed: string): { serverId: string; toolName: string } | undefined` (splits on the FIRST `"__"`; returns undefined if no separator)
  - `SERVER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/` and `isValidServerId(id: string): boolean`

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "mcpToolNames.ts"));
const { prefixToolName, splitToolName, isValidServerId } = await import(
  `${modUrl.href}?c=${Date.now()}`
);

assert.equal(prefixToolName("freddy", "get_sleep"), "freddy__get_sleep");
// Tool names may themselves contain "__" — split on the FIRST separator only.
assert.deepEqual(splitToolName("strava__list__activities"), {
  serverId: "strava",
  toolName: "list__activities"
});
assert.deepEqual(splitToolName("coros__query"), {
  serverId: "coros",
  toolName: "query"
});
assert.equal(splitToolName("noseparator"), undefined);

assert.equal(isValidServerId("freddy"), true);
assert.equal(isValidServerId("Freddy"), false); // uppercase rejected
assert.equal(isValidServerId(""), false);
assert.equal(isValidServerId("a".repeat(40)), false); // too long

console.log("mcp-tool-names tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types scripts/test-mcp-tool-names.mjs`
Expected: FAIL (`Cannot find module .../electron/mcpToolNames.ts`).

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/mcpToolNames.ts
const SEPARATOR = "__";
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
  if (index <= 0 || index + SEPARATOR.length >= prefixed.length) {
    return undefined;
  }
  return {
    serverId: prefixed.slice(0, index),
    toolName: prefixed.slice(index + SEPARATOR.length)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types scripts/test-mcp-tool-names.mjs`
Expected: `mcp-tool-names tests passed`.

- [ ] **Step 5: Add the npm script**

In `package.json`, after the `"test:rpe-load"` line add:
```json
    "test:mcp-tool-names": "node --experimental-strip-types scripts/test-mcp-tool-names.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add electron/mcpToolNames.ts scripts/test-mcp-tool-names.mjs package.json
git commit -m "feat(mcp): tool-name prefix/split helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `mcp_servers` table + built-in COROS seed

**Files:**
- Modify: `electron/database.ts` (add `CREATE TABLE IF NOT EXISTS mcp_servers` next to the other tables; seed COROS after `ensureColumn` calls)
- Modify: `electron/types.ts` (add `McpServerConfig`, `McpServerInput`, `McpTransport`, `McpAuthType`)

**Interfaces:**
- Produces (types.ts):
```ts
export type McpTransport = "streamable-http" | "sse";
export type McpAuthType = "oauth" | "bearer" | "none";
export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  authType: McpAuthType;
  scope?: string;
  enabled: boolean;
  builtin: boolean;
  sortOrder: number;
}
export interface McpServerInput {
  id?: string;
  name: string;
  url: string;
  transport?: McpTransport;
  authType?: McpAuthType;
  scope?: string;
  enabled?: boolean;
}
```

- [ ] **Step 1: Add the table** in the `db.exec(...)` schema block of `database.ts`:

```sql
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'streamable-http',
      auth_type TEXT NOT NULL DEFAULT 'oauth',
      scope TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
```

- [ ] **Step 2: Seed the built-in COROS row** after the `ensureColumn(...)` calls, before `return db;`:

```ts
  db.prepare(
    `INSERT INTO mcp_servers (id, name, url, transport, auth_type, scope, enabled, builtin, sort_order)
     VALUES ('coros', 'COROS', 'https://mcpus.coros.com/mcp', 'streamable-http', 'oauth',
             'openid mcp.tools offline_access', 1, 1, 0)
     ON CONFLICT(id) DO NOTHING`
  ).run();
```

- [ ] **Step 3: Add the types** to `electron/types.ts` (block above).

- [ ] **Step 4: Verify build**

Run: `npm run build:electron`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/database.ts electron/types.ts
git commit -m "feat(mcp): mcp_servers table + built-in COROS seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `mcpServersStore` CRUD (TDD)

**Files:**
- Create: `electron/mcpServersStore.ts`
- Test: `scripts/test-mcp-servers-store.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `McpServerConfig`, `McpServerInput` (Task 2); `requireDatabase` from `database.ts`; `isValidServerId`, `SERVER_ID_RE` (Task 1).
- Produces:
  - `listMcpServers(): McpServerConfig[]` (ordered by `sort_order, name`)
  - `getMcpServer(id): McpServerConfig | undefined`
  - `addMcpServer(input: McpServerInput): McpServerConfig` (slugifies `name`→`id` when `id` omitted; throws on duplicate/invalid id)
  - `updateMcpServer(id, patch: Partial<McpServerInput>): McpServerConfig` (built-in rows: `url`/`id` immutable, `enabled` mutable)
  - `removeMcpServer(id): void` (throws if `builtin`)
  - Secret helpers keyed per server: `getMcpBearer(id)`, `setMcpBearer(id, token)`, `mcpSecretKey(id, kind)` returning `"mcp.<id>.<kind>"`

The store uses the same DB test harness as `test-heatmap-summary.mjs` requires: this test needs a live better-sqlite3 DB. Because `database.ts` initializes against Electron `app.getPath`, the test opens its **own** in-memory schema and passes a DB handle — so `mcpServersStore.ts` functions must accept an optional injected DB (`db = requireDatabase()`), mirroring how other store functions call `requireDatabase()`. Implement store functions as `export function listMcpServers(db = requireDatabase())`.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "mcpServersStore.ts"));
const {
  listMcpServers, addMcpServer, updateMcpServer, removeMcpServer, getMcpServer
} = await import(`${modUrl.href}?c=${Date.now()}`);

const db = new Database(":memory:");
db.exec(`CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'streamable-http',
  auth_type TEXT NOT NULL DEFAULT 'oauth', scope TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0);`);
db.prepare(`INSERT INTO mcp_servers (id,name,url,auth_type,builtin) VALUES ('coros','COROS','https://mcpus.coros.com/mcp','oauth',1)`).run();

// add
const freddy = addMcpServer({ name: "Freddy", url: "https://freddy.coach/mcp" }, db);
assert.equal(freddy.id, "freddy");
assert.equal(freddy.transport, "streamable-http");
assert.equal(freddy.authType, "oauth");
assert.equal(listMcpServers(db).length, 2);

// duplicate id rejected
assert.throws(() => addMcpServer({ id: "freddy", name: "x", url: "https://x/mcp" }, db));

// built-in url immutable, enabled mutable
assert.throws(() => updateMcpServer("coros", { url: "https://evil/mcp" }, db));
const corosOff = updateMcpServer("coros", { enabled: false }, db);
assert.equal(corosOff.enabled, false);

// built-in not removable; custom removable
assert.throws(() => removeMcpServer("coros", db));
removeMcpServer("freddy", db);
assert.equal(getMcpServer("freddy", db), undefined);

console.log("mcp-servers-store tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types scripts/test-mcp-servers-store.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `mcpServersStore.ts`**

```ts
import { requireDatabase, getSetting, setSetting, deleteSettings } from "./database";
import { isValidServerId } from "./mcpToolNames";
import { safeStorage } from "electron";
import type { McpServerConfig, McpServerInput } from "./types";

interface Row {
  id: string; name: string; url: string; transport: string;
  auth_type: string; scope: string | null; enabled: number;
  builtin: number; sort_order: number;
}
function toConfig(r: Row): McpServerConfig {
  return {
    id: r.id, name: r.name, url: r.url,
    transport: r.transport as McpServerConfig["transport"],
    authType: r.auth_type as McpServerConfig["authType"],
    scope: r.scope ?? undefined, enabled: r.enabled === 1,
    builtin: r.builtin === 1, sortOrder: r.sort_order
  };
}
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}
export function mcpSecretKey(id: string, kind: "tokens" | "clientInfo" | "bearer"): string {
  return `mcp.${id}.${kind}`;
}
export function listMcpServers(db = requireDatabase()): McpServerConfig[] {
  return (db.prepare("SELECT * FROM mcp_servers ORDER BY sort_order, name").all() as Row[]).map(toConfig);
}
export function getMcpServer(id: string, db = requireDatabase()): McpServerConfig | undefined {
  const row = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as Row | undefined;
  return row ? toConfig(row) : undefined;
}
export function addMcpServer(input: McpServerInput, db = requireDatabase()): McpServerConfig {
  const id = input.id ?? slug(input.name);
  if (!isValidServerId(id)) throw new Error(`Invalid MCP server id: "${id}"`);
  if (getMcpServer(id, db)) throw new Error(`MCP server "${id}" already exists.`);
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM mcp_servers").get() as { m: number }).m;
  db.prepare(
    `INSERT INTO mcp_servers (id,name,url,transport,auth_type,scope,enabled,builtin,sort_order)
     VALUES (@id,@name,@url,@transport,@auth_type,@scope,@enabled,0,@sort_order)`
  ).run({
    id, name: input.name, url: input.url,
    transport: input.transport ?? "streamable-http",
    auth_type: input.authType ?? "oauth",
    scope: input.scope ?? null,
    enabled: input.enabled === false ? 0 : 1,
    sort_order: maxOrder + 1
  });
  return getMcpServer(id, db)!;
}
export function updateMcpServer(id: string, patch: Partial<McpServerInput>, db = requireDatabase()): McpServerConfig {
  const existing = getMcpServer(id, db);
  if (!existing) throw new Error(`Unknown MCP server "${id}".`);
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
    enabled: patch.enabled === undefined ? (existing.enabled ? 1 : 0) : patch.enabled ? 1 : 0
  });
  return getMcpServer(id, db)!;
}
export function removeMcpServer(id: string, db = requireDatabase()): void {
  const existing = getMcpServer(id, db);
  if (!existing) return;
  if (existing.builtin) throw new Error(`Built-in MCP server "${id}" cannot be removed.`);
  db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  deleteSettings([mcpSecretKey(id, "tokens"), mcpSecretKey(id, "clientInfo"), mcpSecretKey(id, "bearer")]);
}
export function getMcpBearer(id: string): string | undefined {
  const raw = getSetting(mcpSecretKey(id, "bearer"));
  if (!raw) return undefined;
  try { return safeStorage.decryptString(Buffer.from(raw, "base64")); } catch { return undefined; }
}
export function setMcpBearer(id: string, token: string): void {
  setSetting(mcpSecretKey(id, "bearer"), safeStorage.encryptString(token).toString("base64"));
}
```

> Note: the test injects a raw `better-sqlite3` DB, so `deleteSettings`/`getSetting` are only exercised in the app (not the store test). If `deleteSettings` isn't exported from `database.ts`, add a thin `export function deleteSettings(keys: string[])`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types scripts/test-mcp-servers-store.mjs`
Expected: `mcp-servers-store tests passed`.

- [ ] **Step 5: Add npm script + commit**

Add `"test:mcp-servers-store": "node --experimental-strip-types scripts/test-mcp-servers-store.mjs",` to `package.json`.

```bash
git add electron/mcpServersStore.ts scripts/test-mcp-servers-store.mjs package.json
git commit -m "feat(mcp): mcp_servers store CRUD + per-server secret keys

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Generic MCP client manager (parameterized OAuth) + COROS parity

**Files:**
- Create: `electron/mcpClientManager.ts`
- Modify: `electron/corosMcpService.ts` (delegate its exported functions to the manager for the `coros` id; keep the same signatures)
- Modify: `electron/types.ts` (add `McpServerStatus`)

**Interfaces:**
- Consumes: `listMcpServers`, `getMcpServer`, `mcpSecretKey`, `getMcpBearer` (Task 3); `prefixToolName`, `splitToolName` (Task 1); `CorosMcpTool`, `McpServerConfig` (types).
- Produces:
  - `McpServerStatus` (types.ts): `{ id; name; enabled; connected; authenticated: boolean; toolCount: number; error?: string }`
  - `connectMcpServer(id: string, interactive?: boolean): Promise<McpServerStatus>`
  - `disconnectMcpServer(id: string): Promise<void>`
  - `ensureAllMcpConnected(): Promise<void>` (connect every enabled server; per-server failures are caught and reflected in status)
  - `getAllMcpTools(): CorosMcpTool[]` (prefixed names, from connected servers)
  - `callMcpTool(prefixedName: string, args: Record<string, unknown>): Promise<string>` (splits prefix, dispatches)
  - `getMcpStatuses(): McpServerStatus[]`
  - `getMcpServerTools(id: string): Promise<CorosMcpTool[]>` (unprefixed, for the UI)

**Implementation guidance (generalize `corosMcpService.ts`):**

1. Copy `CorosOAuthProvider` → `McpOAuthProvider` and parameterize the constructor with `{ serverId, resourceUrl, scope, loopbackPort, parentWindow, interactive }`. Replace the module constants: `LOOPBACK_REDIRECT_URI` → `http://localhost:${loopbackPort}/mcp/${serverId}/callback`; `MCP_SCOPE` → the instance `scope`; and the settings keys `SETTINGS.clientInfo`/`SETTINGS.tokens` → `mcpSecretKey(serverId, "clientInfo")`/`mcpSecretKey(serverId, "tokens")`. Keep the token encryption exactly as `readTokens`/`writeTokens` do today (safeStorage), just keyed per server.
2. Allocate a distinct loopback port per server: COROS stays `1456`; others get `1457 + hash(serverId) % 40` (a fixed small range). Keep the existing single-flight guard, but keyed per-server (`Map<id, Promise<...>>`).
3. The manager holds `Map<id, { client: Client; tools: CorosMcpTool[]; status: McpServerStatus }>`. `connectMcpServer` builds a `StreamableHTTPClientTransport(new URL(config.url), { authProvider })` for `oauth`; for `bearer`, pass a transport with an `Authorization: Bearer <token>` header (via the transport's `requestInit.headers`) and no auth provider; for `none`, no auth. Then `client.connect(transport)`, `client.listTools()`, cache tools.
4. `getAllMcpTools()` iterates connected servers and returns `tools.map(t => ({ ...t, name: prefixToolName(id, t.name) }))`.
5. `callMcpTool(prefixed, args)`: `const s = splitToolName(prefixed); if (!s) throw; const entry = map.get(s.serverId); return await entry.client.callTool({ name: s.toolName, arguments: args })` → serialize result content to string (reuse the exact serialization `callCorosMcpTool` uses today).
6. `withAccessTokenParam`/hostname allowlist logic in COROS: generalize to allow each configured server's hostname.

- [ ] **Step 1:** Create `mcpClientManager.ts` with the `McpOAuthProvider` and manager map per the guidance above; export the functions in the Interfaces block.
- [ ] **Step 2:** Add `McpServerStatus` to `types.ts`.
- [ ] **Step 3:** Rewrite `corosMcpService.ts` exports to delegate: `getCorosMcpStatus()` → `getMcpStatuses().find(s => s.id === "coros")` mapped to `CorosMcpStatus`; `connectCorosMcp(...)` → `connectMcpServer("coros", interactive)`; `ensureCorosMcpConnected()` → `connectMcpServer("coros", false)` (swallow errors → boolean); `listCorosMcpTools()`/`getCorosMcpTools()` → `getMcpServerTools("coros")` / cached; `callCorosMcpTool(name,args)` → `callMcpTool(prefixToolName("coros", name), args)`. This keeps every current caller working.
- [ ] **Step 4:** Build: `npm run build:electron` → no errors.
- [ ] **Step 5:** **Live COROS parity check.** Launch the app (`npm run build && npx electron .`), open the chat, confirm COROS connects and a COROS tool still runs (no regression). This is the gate for this task.
- [ ] **Step 6: Commit**

```bash
git add electron/mcpClientManager.ts electron/corosMcpService.ts electron/types.ts
git commit -m "feat(mcp): generic multi-server MCP client manager (COROS parity)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: chatService aggregation + routing

**Files:**
- Modify: `electron/chatService.ts` (`getAllChatTools` @943, tool-call routing @~1089, `ensureCorosMcpConnected` call sites @606/@684/@754, `findChatTool` @1103)

**Interfaces:**
- Consumes: `getAllMcpTools`, `callMcpTool`, `ensureAllMcpConnected` (Task 4).

- [ ] **Step 1:** Replace the import block `{ callCorosMcpTool, ensureCorosMcpConnected, getCorosMcpTools }` from `./corosMcpService` with `{ getAllMcpTools, callMcpTool, ensureAllMcpConnected }` from `./mcpClientManager`.
- [ ] **Step 2:** `getAllChatTools()` → `return [...getAllMcpTools(), ...<existing local tools>];`
- [ ] **Step 3:** Every `await ensureCorosMcpConnected();` → `await ensureAllMcpConnected();`
- [ ] **Step 4:** The tool dispatch that calls `callCorosMcpTool(name, args)` → `callMcpTool(name, args)`. The `remoteTools` filter at ~982 (`getCorosMcpTools().filter(...)`) → `getAllMcpTools().filter(...)`.
- [ ] **Step 5:** `findChatTool` resolves against `getAllChatTools()` (already does) — no change if it iterates that list.
- [ ] **Step 6:** Build: `npm run build:electron` → no errors.
- [ ] **Step 7: Commit**

```bash
git add electron/chatService.ts
git commit -m "feat(mcp): aggregate + route chat tools across all MCP servers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: IPC + preload + api types

**Files:**
- Modify: `electron/main.ts` (register `mcp:*` handlers, import manager + store)
- Modify: `electron/preload.ts` (expose `mcp*` methods)
- Modify: `src/coroslink-api.ts` (type the methods)

**Interfaces (renderer-facing api):**
```ts
listMcpServers: () => Promise<McpServerConfig[]>;
addMcpServer: (input: McpServerInput) => Promise<McpServerConfig>;
updateMcpServer: (id: string, patch: Partial<McpServerInput>) => Promise<McpServerConfig>;
removeMcpServer: (id: string) => Promise<void>;
connectMcpServer: (id: string) => Promise<McpServerStatus>;
disconnectMcpServer: (id: string) => Promise<void>;
getMcpStatuses: () => Promise<McpServerStatus[]>;
setMcpBearer: (id: string, token: string) => Promise<void>;
```

- [ ] **Step 1:** In `main.ts`, add handlers mirroring existing `trainingHub:*` registration:
```ts
ipcMain.handle("mcp:listServers", () => listMcpServers());
ipcMain.handle("mcp:addServer", (_e, input) => addMcpServer(input));
ipcMain.handle("mcp:updateServer", (_e, id, patch) => updateMcpServer(id, patch));
ipcMain.handle("mcp:removeServer", (_e, id) => removeMcpServer(id));
ipcMain.handle("mcp:connect", (_e, id) => connectMcpServer(id, true));
ipcMain.handle("mcp:disconnect", (_e, id) => disconnectMcpServer(id));
ipcMain.handle("mcp:statuses", () => getMcpStatuses());
ipcMain.handle("mcp:setBearer", (_e, id, token) => setMcpBearer(id, token));
```
- [ ] **Step 2:** `preload.ts`: add the eight methods calling `ipcRenderer.invoke("mcp:...", ...)`.
- [ ] **Step 3:** `src/coroslink-api.ts`: add the typed method signatures (Interfaces block) + import `McpServerConfig`, `McpServerInput`, `McpServerStatus`.
- [ ] **Step 4:** Build: `npm run build` → no errors.
- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/coroslink-api.ts
git commit -m "feat(mcp): IPC + preload + api for the MCP registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Settings UI — MCP Servers panel + presets

**Files:**
- Create: `src/chat/McpServersPanel.tsx`
- Modify: the Settings/chat view that renders `CorosMcpToolsPanel` to also render `McpServersPanel`
- Modify: `src/styles.css` (panel styles, reuse existing settings/list classes where possible)

**Interfaces:**
- Consumes: the api methods (Task 6).

- [ ] **Step 1:** Build `McpServersPanel.tsx`: on mount `api.listMcpServers()` + `api.getMcpStatuses()`; render each server row with name, url, status pill (connected/authenticated/tool count/error), and buttons: **Connect** (`api.connectMcpServer(id)`), **Disconnect**, **Remove** (hidden for `builtin`). An "Add server" form (name + url + auth type). A **bearer** token input shown when `authType === "bearer"` → `api.setMcpBearer(id, token)`.
- [ ] **Step 2:** Add a **Presets** row with two one-click buttons that call `api.addMcpServer(...)` then `api.connectMcpServer(id)`:
```ts
const PRESETS = [
  { id: "freddy", name: "Freddy", url: "https://freddy.coach/mcp", authType: "oauth" },
  { id: "strava", name: "Strava", url: "https://mcp.strava.com/mcp", authType: "oauth" }
];
```
(Skip a preset button if a server with that id already exists.)
- [ ] **Step 3:** Wire `McpServersPanel` into the view next to `CorosMcpToolsPanel`.
- [ ] **Step 4:** Build: `npm run build` → no errors.
- [ ] **Step 5: Live end-to-end.** Launch the app; add Freddy via preset → Connect → OAuth loopback → confirm Freddy's tools appear (namespaced `freddy__…`) in the chat and are callable. Repeat mentally for Strava.
- [ ] **Step 6: Commit**

```bash
git add src/chat/McpServersPanel.tsx src/styles.css src/<view-file>.tsx
git commit -m "feat(mcp): Settings panel for MCP servers + Freddy/Strava presets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** store (T2/T3), generic manager+OAuth (T4), aggregation/routing (T5), IPC (T6), UI+presets (T7), namespacing (T1, used T4/T5), COROS migration/parity (T2 seed + T4 delegation), security (safeStorage in T3, per-server isolation in T4). All spec sections map to a task.
- **Phasing:** T1–T4 = plumbing + COROS parity (spec phase 1–3 collapsed since OAuth generalizes cleanly from the existing provider); T5 wiring; T6 IPC; T7 UI (spec phase 4). Bearer path is included in T4/T7 so a non-OAuth server can be tested without OAuth.
- **Type consistency:** `McpServerConfig`/`McpServerInput`/`McpServerStatus`, `prefixToolName`/`splitToolName`, `getAllMcpTools`/`callMcpTool`/`ensureAllMcpConnected` used consistently across T4–T7.
- **Known unknown to verify during T4:** the exact `StreamableHTTPClientTransport` option for a static bearer header and for injecting per-server headers — confirm against the installed `@modelcontextprotocol/sdk` types before finalizing T4; adjust the bearer branch accordingly.
