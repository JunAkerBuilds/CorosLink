import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "electron", "mcpServersStore.ts")
);
const {
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  getMcpServer
} = await import(`${modUrl.href}?c=${Date.now()}`);

// better-sqlite3 is built for the Electron ABI and won't dlopen under plain
// node, so this fake implements exactly the query set mcpServersStore issues.
// It exercises the store's JS branching (defaults, dedupe, built-in guards);
// the trivial SQL itself is verified when the app runs live.
function fakeDb() {
  const rows = new Map(); // id -> row
  return {
    _rows: rows,
    prepare(sql) {
      if (/^SELECT \* FROM mcp_servers ORDER BY/.test(sql)) {
        return {
          all: () =>
            [...rows.values()].sort(
              (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
            )
        };
      }
      if (/^SELECT \* FROM mcp_servers WHERE id = \?/.test(sql)) {
        return { get: (id) => rows.get(id) };
      }
      if (/COALESCE\(MAX\(sort_order\)/.test(sql)) {
        return {
          get: () => ({
            m: [...rows.values()].reduce((m, r) => Math.max(m, r.sort_order), 0)
          })
        };
      }
      if (/^INSERT INTO mcp_servers/.test(sql)) {
        return {
          run: (o) => {
            rows.set(o.id, { ...o });
          }
        };
      }
      if (/^UPDATE mcp_servers SET/.test(sql)) {
        return {
          run: (o) => {
            rows.set(o.id, { ...rows.get(o.id), ...o });
          }
        };
      }
      if (/^DELETE FROM mcp_servers WHERE id = \?/.test(sql)) {
        return {
          run: (id) => {
            rows.delete(id);
          }
        };
      }
      throw new Error(`Unhandled SQL in fake: ${sql}`);
    }
  };
}

const db = fakeDb();
db._rows.set("coros", {
  id: "coros",
  name: "COROS",
  url: "https://mcpus.coros.com/mcp",
  transport: "streamable-http",
  auth_type: "oauth",
  scope: null,
  enabled: 1,
  builtin: 1,
  sort_order: 0
});

// add — slug from name, defaults applied
const freddy = addMcpServer({ name: "Freddy", url: "https://freddy.coach/mcp" }, db);
assert.equal(freddy.id, "freddy");
assert.equal(freddy.transport, "streamable-http");
assert.equal(freddy.authType, "oauth");
assert.equal(freddy.builtin, false);
assert.equal(freddy.sortOrder, 1);
assert.equal(listMcpServers(db).length, 2);

// duplicate id rejected
assert.throws(() =>
  addMcpServer({ id: "freddy", name: "x", url: "https://x/mcp" }, db)
);

// invalid id rejected
assert.throws(() => addMcpServer({ id: "BAD_ID", name: "x", url: "https://x/mcp" }, db));

// runtime IPC input is validated, not just TypeScript callers
assert.throws(() =>
  addMcpServer({ id: "bad-url", name: "Bad URL", url: "file:///tmp/mcp" }, db)
);
assert.throws(() =>
  addMcpServer({
    id: "bad-transport",
    name: "Bad transport",
    url: "https://x.example/mcp",
    transport: "sse"
  }, db)
);
assert.throws(() =>
  addMcpServer({
    id: "bad-auth",
    name: "Bad auth",
    url: "https://x.example/mcp",
    authType: "magic"
  }, db)
);
assert.throws(() =>
  addMcpServer({
    id: "bad-enabled",
    name: "Bad enabled",
    url: "https://x.example/mcp",
    enabled: "false"
  }, db)
);
assert.throws(() =>
  addMcpServer({
    id: 123,
    name: "Bad id type",
    url: "https://x.example/mcp"
  }, db)
);

// built-in url immutable, enabled mutable
assert.throws(() => updateMcpServer("coros", { url: "https://evil/mcp" }, db));
const corosOff = updateMcpServer("coros", { enabled: false }, db);
assert.equal(corosOff.enabled, false);

// scope can be explicitly cleared and ids cannot be changed
assert.equal(updateMcpServer("freddy", { scope: "read write" }, db).scope, "read write");
assert.equal(updateMcpServer("freddy", { scope: null }, db).scope, undefined);
assert.throws(() => updateMcpServer("freddy", { id: "renamed" }, db));

// built-in not removable; custom removal deletes its stored secrets
assert.throws(() => removeMcpServer("coros", db));
let removedKeys = [];
removeMcpServer("freddy", db, (keys) => {
  removedKeys = keys;
});
assert.equal(getMcpServer("freddy", db), undefined);
assert.deepEqual(removedKeys, [
  "mcp.freddy.tokens",
  "mcp.freddy.clientInfo",
  "mcp.freddy.bearer",
  "mcp.freddy.resourceUrl"
]);

console.log("mcp-servers-store tests passed");
