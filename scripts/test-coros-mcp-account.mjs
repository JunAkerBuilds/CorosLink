import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Connecting COROS MCP with the account CorosLink already knows, through the
// real connection manager: the email reaches COROS sign-in, and the built-in
// server follows the account's region until it is authorized. Electron,
// storage, the registry, and the MCP SDK are stubbed.
const require = createRequire(import.meta.url);
const stub = (id, exports) => { require.cache[require.resolve(id)] = { exports }; };

const US = "https://mcpus.coros.com/mcp";
const EU = "https://mcpeu.coros.com/mcp";
const settings = new Map();
const servers = new Map();
const connections = [];
let gate;

function register(id, url, builtin = false) {
  servers.set(id, {
    id, name: id, url, builtin, enabled: true,
    authType: "oauth", transport: "streamable-http"
  });
}

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString()
};
stub("electron", {
  app: { getVersion: () => "test" },
  safeStorage,
  BrowserWindow: class { constructor() { assert.fail("No sign-in window expected"); } },
  shell: {}
});
stub("../dist-electron/database.js", {
  getSetting: (key) => settings.get(key),
  setSetting: (key, value) => settings.set(key, value),
  deleteSettings: (keys) => keys.forEach((key) => settings.delete(key))
});
stub("../dist-electron/mcpServersStore.js", {
  getMcpServer: (id) => servers.get(id),
  listMcpServers: () => [...servers.values()],
  getMcpBearer: () => undefined,
  mcpSecretKey: (id, key) => `mcp.${id}.${key}`,
  updateMcpServer: (id, changes) => Object.assign(servers.get(id), changes)
});
stub("@modelcontextprotocol/sdk/client/index.js", { Client: class {
  async connect(transport) {
    await gate;
    connections.push({
      url: transport.url.toString(),
      loginHint: transport.options.authProvider?.config.loginHint
    });
  }
  setNotificationHandler() {}
  async listTools() { return { tools: [] }; }
  async close() { this.onclose?.(); }
} });
stub("@modelcontextprotocol/sdk/client/streamableHttp.js", {
  StreamableHTTPClientTransport: class {
    constructor(url, options) { this.url = url; this.options = options; }
  }
});

const manager = require("../dist-electron/mcpClientManager.js");
const coros = require("../dist-electron/corosMcpService.js");

async function connect(id, interactive = true) {
  connections.length = 0;
  await coros.connectMcpServerWithCorosAccount(id, interactive, null);
  assert.equal(connections.length, 1);
  const [connection] = connections;
  await manager.disconnectMcpServer(id, { clearAuthorization: false });
  return connection;
}

register("coros", US, true);
register("coros-eu", EU);
register("strava", "https://mcp.strava.com/mcp");

// Without a COROS account, connecting behaves as before.
assert.deepEqual(await connect("coros"), { url: US, loginHint: undefined });

// A European account moves the unauthorized built-in server and drops the
// client registration made with the US authorization server.
coros.setCorosMcpAccountSource(() => ({ email: "runner@example.com", region: "eu" }));
settings.set("corosMcp.clientInfo", JSON.stringify({ client_id: "us-registration" }));
assert.deepEqual(await connect("coros"), { url: EU, loginHint: "runner@example.com" });
assert.equal(servers.get("coros").url, EU);
assert.equal(settings.get("corosMcp.clientInfo"), undefined);

// An authorized server keeps its endpoint, whatever the account region.
servers.get("coros").url = US;
settings.set("corosMcp.resourceUrl", US);
settings.set("corosMcp.tokens", Buffer.from(JSON.stringify({
  access_token: "a", refresh_token: "r", token_type: "Bearer"
})).toString("base64"));
assert.deepEqual(await connect("coros"), { url: US, loginHint: "runner@example.com" });
assert.equal(servers.get("coros").url, US);
assert.ok(settings.get("corosMcp.tokens"), "Authorization survives");
settings.delete("corosMcp.tokens");

// Added COROS servers keep the endpoint the user chose but get the email.
coros.setCorosMcpAccountSource(() => ({ email: "runner@example.com", region: "us" }));
assert.deepEqual(await connect("coros-eu"), { url: EU, loginHint: "runner@example.com" });
assert.equal(servers.get("coros-eu").url, EU);

// Other servers never see the COROS account.
assert.deepEqual(await connect("strava"), {
  url: "https://mcp.strava.com/mcp",
  loginHint: undefined
});

// Silent reconnects open no sign-in, so they neither move nor prefill.
coros.setCorosMcpAccountSource(() => ({ email: "runner@example.com", region: "eu" }));
assert.deepEqual(await connect("coros", false), { url: US, loginHint: undefined });

// A connection already underway keeps its endpoint.
let release;
gate = new Promise((resolve) => { release = resolve; });
const first = manager.connectMcpServer("coros", true, null);
const second = coros.connectMcpServerWithCorosAccount("coros", true, null);
release();
await Promise.all([first, second]);
gate = undefined;
assert.deepEqual(connections.at(-1), { url: US, loginHint: undefined });
assert.equal(servers.get("coros").url, US);
await manager.disconnectMcpServer("coros", { clearAuthorization: false });

// An unreadable account only loses the convenience.
coros.setCorosMcpAccountSource(() => { throw new Error("Secure storage locked"); });
assert.deepEqual(await connect("coros"), { url: US, loginHint: undefined });

// A removed COROS server stays removed.
servers.delete("coros");
await assert.rejects(coros.connectCorosMcp(null), /Unknown MCP server/);

console.log("coros-mcp-account tests passed (region, email hint, authorized, added, silent, in-flight)");
