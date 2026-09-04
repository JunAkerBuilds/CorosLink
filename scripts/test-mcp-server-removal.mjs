import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const [phase, userDataPath, scenario] = process.argv.slice(2);
const regionalUrl = "https://mcpeu.coros.com/mcp";
const corosKeys = [
  "corosMcp.tokens", "corosMcp.clientInfo", "corosMcp.resourceUrl",
  "mcp.coros.tokens", "mcp.coros.clientInfo", "mcp.coros.resourceUrl",
  "mcp.coros.bearer"
];

if (!phase) {
  // Separate processes exercise actual SQLite persistence across app restarts.
  // Run under Electron's Node runtime to match better-sqlite3's native ABI.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-mcp-removal-"));
  try {
    for (const scenario of ["fresh", "upgrade"]) {
      for (const phase of ["setup", "remove", "restart", "empty", "restored"]) {
        const result = spawnSync(process.execPath, [
          import.meta.filename, phase, path.join(tempRoot, scenario), scenario
        ], { encoding: "utf8", timeout: 30_000 });
        assert.equal(result.status, 0,
          `${scenario}/${phase}: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
      }
    }
    console.log("mcp-server-removal tests passed (fresh install, upgrade, restart, reconnect, restore)");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
} else {
  // Only the Electron UI and remote MCP SDK are stubbed. The registry,
  // credential cleanup, connection manager, and SQLite migrations are real.
  const connectedUrls = [];
  const closedUrls = [];
  function stubModule(id, exports) {
    require.cache[require.resolve(id)] = { exports };
  }
  stubModule("electron", {
    app: { getVersion: () => "0.0.0-test" },
    BrowserWindow: class {
      constructor() { assert.fail("Removal/restart must not open a login window"); }
    },
    shell: { openExternal: () => assert.fail("Unexpected browser authorization") }
  });
  stubModule("@modelcontextprotocol/sdk/client/index.js", {
    Client: class {
      async connect(transport) {
        this.url = transport.url.toString();
        connectedUrls.push(this.url);
      }
      async listTools() {
        return { tools: [{ name: "training", inputSchema: { type: "object" } }] };
      }
      async close() {
        closedUrls.push(this.url);
        this.onclose?.();
      }
    }
  });
  stubModule("@modelcontextprotocol/sdk/client/streamableHttp.js", {
    StreamableHTTPClientTransport: class {
      constructor(url) { this.url = url; }
    }
  });
  const database = require("../dist-electron/database.js");
  const store = require("../dist-electron/mcpServersStore.js");
  const manager = require("../dist-electron/mcpClientManager.js");
  const coros = require("../dist-electron/corosMcpService.js");
  const db = database.initializeDatabase(userDataPath);

  try {
    if (phase === "setup") {
      assert.equal(store.listMcpServers().length, 1);
      assert.equal(store.getMcpServer("coros").builtin, true);
      store.updateMcpServer("coros", { name: "Original COROS", enabled: false });
      store.addMcpServer({ id: "coros-eu", name: "COROS Europe", url: regionalUrl });
      for (const key of corosKeys) {
        database.setSetting(key, key.endsWith("resourceUrl")
          ? store.getMcpServer("coros").url : "saved-default-authorization");
      }
      database.setSetting("mcp.coros-eu.tokens", "saved-regional-authorization");
      database.setSetting("unrelated.preference", "keep");
      if (scenario === "upgrade") {
        // Pre-fix registries have the default row, but no initialization marker.
        database.deleteSettings(["mcp.defaultsSeeded"]);
      }
    } else if (phase === "remove") {
      // Upgrading must preserve user changes and both servers' credentials.
      assert.equal(store.getMcpServer("coros").name, "Original COROS");
      assert.equal(store.getMcpServer("coros").enabled, false);
      assert.equal(database.getSetting("corosMcp.tokens"), "saved-default-authorization");
      assert.equal(store.getMcpServer("coros-eu").url, regionalUrl);
      await manager.connectMcpServer("coros");
      await manager.ensureAllMcpConnected();
      assert.equal(manager.getAllMcpTools().length, 2);

      // The same disconnect-then-remove sequence used by the IPC handler.
      await manager.disconnectMcpServer("coros");
      store.removeMcpServer("coros");
      assert.deepEqual(closedUrls, ["https://mcpus.coros.com/mcp"]);
      assert.deepEqual(manager.getAllMcpTools().map((tool) => tool.name), ["coros-eu__training"]);
      for (const key of corosKeys) assert.equal(database.getSetting(key), undefined);
      assert.equal(database.getSetting("mcp.coros-eu.tokens"), "saved-regional-authorization");
      assert.equal(database.getSetting("unrelated.preference"), "keep");
    } else if (phase === "restart") {
      assert.deepEqual(store.listMcpServers().map((server) => server.id), ["coros-eu"]);
      await manager.ensureAllMcpConnected();
      assert.deepEqual(connectedUrls, [regionalUrl]);
      assert.equal(await coros.ensureCorosMcpConnected(), false);
      assert.deepEqual(coros.getCorosMcpStatus(), { connected: false, authorized: false, tools: [] });
      await assert.rejects(coros.connectCorosMcp(), /Unknown MCP server/);
      await manager.disconnectMcpServer("coros-eu");
      store.removeMcpServer("coros-eu");
    } else if (phase === "empty") {
      assert.deepEqual(store.listMcpServers(), []);
      await manager.ensureAllMcpConnected();
      assert.deepEqual(connectedUrls, []);
      // Users can intentionally add COROS again with their preferred endpoint.
      store.addMcpServer({ id: "coros", name: "COROS", url: regionalUrl });
    } else if (phase === "restored") {
      assert.equal(store.listMcpServers().length, 1);
      assert.equal(store.getMcpServer("coros").url, regionalUrl);
      assert.equal(store.getMcpServer("coros").builtin, false);
      assert.equal(database.getSetting("corosMcp.tokens"), undefined);
    } else {
      assert.fail(`Unknown test phase: ${phase}`);
    }
  } finally {
    db.close();
  }
}
