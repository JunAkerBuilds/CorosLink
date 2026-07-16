# MCP server registry — configurable MCP connections for the chat

Date: 2026-07-15
Branch: `feat/mcp-server-registry` (based on `main` @ b14c2c2)

## Problem

The in-app chat can call tools from the COROS hosted MCP server, but that
connection is hard-coded in `electron/corosMcpService.ts`. There is no way to
add other MCP servers (Freddy / freddy.coach, Strava, or any future hosted
server). We want a **registry** where the user configures multiple MCP servers,
and every chat provider (Claude Agent SDK, ChatGPT, local) can call their tools.

## How it works today (baseline)

- `corosMcpService.ts` is an **MCP client** (`@modelcontextprotocol/sdk`,
  Streamable HTTP transport + OAuth: discovery, dynamic client registration,
  PKCE, loopback redirect on `:1456`). It connects to `mcpus.coros.com/mcp` and
  caches its tool list as `CorosMcpTool[]`.
- `chatService.ts` aggregates tools in `getAllChatTools()`
  (`getCorosMcpTools()` + local tools), passes them to each provider, and routes
  the agent's tool calls back through `onToolCall` → `callCorosMcpTool(name,
  args)`. `ensureCorosMcpConnected()` runs before each turn.
- `claudeCodeProvider.ts` wraps the tool list into an in-process SDK MCP server
  (`createSdkMcpServer`); ChatGPT/local consume the same list. **No provider is
  special** — they all read one aggregated tool list.

The COROS OAuth flow is already mostly server-agnostic: the MCP SDK derives
auth-server metadata, DCR, and PKCE from the resource URL. The only
COROS-specific inputs are the **resource URL**, **scope**, and **loopback
port** — everything else generalizes.

## Target architecture

An **app-level MCP registry** (not tied to the Claude path) so tools reach every
provider uniformly, exactly as COROS does today.

### 1. Config store (`electron/mcpServersStore.ts` + DB)

New table `mcp_servers`:

| column | notes |
|---|---|
| `id` TEXT PK | stable slug (e.g. `coros`, `freddy`, `strava`, or generated) |
| `name` TEXT | display name |
| `url` TEXT | resource URL (hosted servers) |
| `transport` TEXT | `streamable-http` \| `sse` |
| `auth_type` TEXT | `oauth` \| `bearer` \| `none` |
| `scope` TEXT | OAuth scope (nullable) |
| `enabled` INTEGER | 0/1 |
| `builtin` INTEGER | 1 for COROS (non-deletable, can be disabled) |
| `sort_order` INTEGER | |

Secrets (bearer tokens, OAuth tokens/client info) are stored **encrypted via
`safeStorage`** under existing `app_settings` keys namespaced per server
(`mcp.<id>.tokens`, `mcp.<id>.clientInfo`, `mcp.<id>.bearer`) — mirroring the
current `corosMcp.*` keys. No plaintext secrets in `mcp_servers`.

### 2. Generic client manager (`electron/mcpClientManager.ts`)

Generalize `corosMcpService.ts` into a manager keyed by server `id`:

- `McpServerConfig` drives transport + auth. A per-server `OAuthClientProvider`
  (loopback redirect, token store) parameterized by `url` / `scope` / `port`.
  COROS keeps its exact current params (`mcpus.coros.com/mcp`, its scope,
  `:1456`); other servers get their own loopback port (allocate from a small
  range, single-flight guard per port as COROS does today).
- Per-server: `connect(id, interactive?)`, `disconnect(id)`,
  `status(id)`, `listTools(id)`, `callTool(id, name, args)`, plus
  `connectAll()` / `statusAll()`.
- **Tool namespacing:** exposed tool names are prefixed `"<id>__<toolName>"` so
  two servers can define the same tool name without colliding. The manager keeps
  a `Map<prefixedName, {serverId, originalName}>` for routing.
- `corosMcpService.ts` becomes a thin wrapper (or is folded in) so existing
  callers keep working during migration.

### 3. chatService integration (the aggregation + routing seam)

- `getAllChatTools()` → `[...getAllMcpTools(), ...localTools]` where
  `getAllMcpTools()` returns the prefixed tools from every **enabled, connected**
  server.
- `ensureCorosMcpConnected()` → `ensureAllMcpConnected()` (connect all enabled
  servers; failures per-server are non-fatal and surfaced as status).
- `onToolCall` / `callCorosMcpTool(name,args)` → `callMcpTool(name,args)` which
  splits the `<id>__<tool>` prefix and dispatches to `callTool(id, tool, args)`.
- `findChatTool` resolves against the prefixed set.

Providers are untouched — they still receive one aggregated `CorosMcpTool[]`.
(Keep the `CorosMcpTool` shape; optionally rename to `McpTool` later.)

### 4. IPC + preload + api

New handlers mirroring the existing `watchfaces:*` / `trainingHub:*` pattern:
`mcp:listServers`, `mcp:addServer`, `mcp:updateServer`, `mcp:removeServer`,
`mcp:connect`, `mcp:disconnect`, `mcp:status`, `mcp:listTools`. Exposed via
`preload.ts` and typed in `src/coroslink-api.ts`.

### 5. Settings UI (`src/chat/McpServersPanel.tsx` or Settings section)

Beside the existing `CorosMcpToolsPanel`:
- List configured servers with connection status + tool count.
- Add / edit / remove (built-in COROS is edit-limited, not removable).
- **Connect** button → triggers OAuth loopback for `oauth` servers; a token
  field for `bearer`.
- **Presets:** one-click "Add" so the user only clicks Connect —
  - Freddy: `https://freddy.coach/mcp`
  - Strava: `https://mcp.strava.com/mcp`
  Both hosted URL + OAuth (transport `streamable-http`, `auth_type: oauth`);
  scope discovered from each server's auth metadata by the MCP SDK.
- Per-server "Test / Refresh tools" showing the exposed tool names.

### 6. COROS migration

Seed the `mcp_servers` table with a built-in `coros` row on first run
(migration in `database.ts`, like the `feel_type` column add). Its secrets stay
under the existing `corosMcp.*` keys (read-compat) or are copied to
`mcp.coros.*`. No behavior change for existing users.

## Security

- Secrets encrypted via `safeStorage`; never stored in `mcp_servers` or logged.
- Tool name prefixing prevents one server shadowing another's tool.
- Each server is an isolated client; a failing/hostile server can't take down
  others (per-server try/catch, status surfaced, non-fatal).
- OAuth loopback is bound to `localhost` only, single-flight per port (as COROS
  does now) to avoid port races between Connect and Training Hub.
- Disabled/disconnected servers contribute no tools.

## Phasing

1. **Store + manager + IPC**, COROS migrated to a registry entry (behavior
   parity). No new UI yet; verified via existing COROS flow.
2. **Aggregation + routing** in chatService (prefixing), so a second server's
   tools reach the chat. Add a `bearer`-auth test server to validate end-to-end
   without OAuth.
3. **Generic OAuth** per server (parameterized loopback/scope/resource) →
   Freddy / Strava.
4. **Settings UI** + presets.

## Out of scope

- stdio (local process) MCP transport — hosted URL servers only for now
  (add later if a local MCP server is needed).
- Changing how any provider consumes the tool list.
- No new runtime dependencies (`@modelcontextprotocol/sdk` already present).

## Testing

- Pure: prefix split/join and routing table (`mcpClientManager` name mapping)
  unit-tested (TDD, `.mjs`).
- Store: add/list/update/remove + built-in seed migration.
- Live: COROS parity (tools still work), then a bearer test server, then
  Freddy/Strava OAuth connect; verify tools appear namespaced and callable from
  the chat across providers.
