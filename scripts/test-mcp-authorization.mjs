import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createCorosActionService } from '../dist-electron/coachCorosActions.js';

// Exercise real token persistence, connection identity, and review confirmation.
// External boundaries use an in-memory store and a mock OAuth transport.
const require = createRequire(import.meta.url);
const stub = (id, exports) => { require.cache[require.resolve(id)] = { exports }; };
const { tools } = JSON.parse(readFileSync(new URL('./fixtures/coros-mcp-workout-schemas.json', import.meta.url)));
const settings = new Map();
const clients = [];
const calls = [];
let nonce = 0;
let refreshOnRead = false;
const server = { id: 'coros', name: 'COROS', url: 'https://example.invalid/mcp', enabled: true, authType: 'oauth', transport: 'streamable-http' };
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`${++nonce}:${value}`),
  decryptString: value => value.toString().replace(/^\d+:/, '')
};
const tokens = version => ({ access_token: `access-${version}`, refresh_token: `refresh-${version}`, token_type: 'Bearer' });
settings.set('corosMcp.tokens', safeStorage.encryptString(JSON.stringify(tokens(1))).toString('base64'));
settings.set('corosMcp.resourceUrl', server.url);
settings.set('corosMcp.clientInfo', JSON.stringify({ client_id: 'same-client-across-accounts' }));

stub('electron', { app: { getVersion: () => 'test' }, safeStorage, BrowserWindow: class {}, shell: {} });
stub('../dist-electron/database.js', {
  getSetting: key => settings.get(key),
  setSetting: (key, value) => settings.set(key, value),
  deleteSettings: keys => keys.forEach(key => settings.delete(key))
});
stub('../dist-electron/mcpServersStore.js', {
  getMcpServer: id => id === server.id ? server : undefined,
  listMcpServers: () => [server],
  getMcpBearer: () => undefined,
  mcpSecretKey: (id, key) => `mcp.${id}.${key}`,
  updateMcpServer: (_id, changes) => Object.assign(server, changes)
});
stub('@modelcontextprotocol/sdk/client/index.js', { Client: class {
  constructor() { clients.push(this); }
  async connect(transport) { this.provider = transport.options.authProvider; }
  setNotificationHandler() {}
  async listTools() { return { tools: tools.map(tool => ({ ...tool, name: tool.name.slice(7) })) }; }
  async callTool(request) {
    calls.push(request);
    if (request.name.startsWith('query')) {
      if (refreshOnRead) {
        refreshOnRead = false;
        this.provider.saveTokens(tokens(2));
      }
      return { content: [{ type: 'text', text: '{"name":"Easy","editable":true}' }] };
    }
    return { content: [{ type: 'text', text: '{"idInPlan":"123"}' }] };
  }
  async close() { this.onclose?.(); }
} });
stub('@modelcontextprotocol/sdk/client/streamableHttp.js', { StreamableHTTPClientTransport: class {
  constructor(url, options) { this.options = options; }
} });

let manager = require('../dist-electron/mcpClientManager.js');
const key = () => manager.getMcpAuthorizationKey('coros');
const actionDeps = {
  tools: () => manager.getAllMcpTools(),
  call: (name, args) => manager.callMcpTool(name, args),
  load: () => settings.get('chat.corosActions'),
  save: value => settings.set('chat.corosActions', value),
  connectionKey: key,
  canConfirm: () => true
};
let service = createCorosActionService(actionDeps);
const stage = () => service.stage('coros__scheduleWorkout', { workoutId: '123', date: '20990101', review_summary: 'Schedule Easy.' });
const writes = () => calls.filter(call => !call.name.startsWith('query'));

await manager.ensureAllMcpConnected();
const originalKey = key();
assert.ok(originalKey, 'Existing authorizations receive a persistent identity');
const preview = await stage();
await manager.disconnectMcpServer('coros', { clearAuthorization: false });
assert.equal(key(), originalKey, 'Closing a transport does not end its authorization');

delete require.cache[require.resolve('../dist-electron/mcpClientManager.js')];
manager = require('../dist-electron/mcpClientManager.js');
service = createCorosActionService(actionDeps);
await manager.ensureAllMcpConnected();
assert.equal(key(), originalKey, 'Authorization identity survives app restart');
const encryptedBefore = settings.get('corosMcp.tokens');
refreshOnRead = true;
assert.equal((await service.confirm(preview.requestId)).state, 'saved');
assert.notEqual(settings.get('corosMcp.tokens'), encryptedBefore, 'Refresh replaced encrypted tokens');
assert.equal(key(), originalKey);
assert.equal(writes().length, 1, 'A pending review saves once after refresh');

// A new account grant must invalidate pending reviews, even with the same client and URL.
let pending = await stage();
const provider = clients.at(-1).provider;
provider.saveCodeVerifier('new-authorization-code-verifier');
provider.saveTokens(tokens('other-account'));
assert.notEqual(key(), originalKey);
await assert.rejects(service.confirm(pending.requestId), /connection changed/);
assert.equal(writes().length, 1);

const reauthorizedKey = key();
provider.saveTokens(tokens('other-account-refreshed'));
assert.equal(key(), reauthorizedKey, 'Later refreshes retain the new authorization identity');
for (const scope of ['tokens', 'client', 'all']) {
  pending = await stage();
  const previousKey = key();
  provider.invalidateCredentials(scope);
  provider.saveTokens(tokens(scope));
  assert.notEqual(key(), previousKey, scope);
  await assert.rejects(service.confirm(pending.requestId), /connection changed/);
}

pending = await stage();
server.url = 'https://other.example.invalid/mcp';
await assert.rejects(service.confirm(pending.requestId), /connection changed/);
server.url = 'https://example.invalid/mcp';

pending = await stage();
const beforeDisconnect = key();
await manager.disconnectMcpServer('coros');
assert.equal(key(), '');
assert.equal(settings.get('corosMcp.authorizationId'), undefined);
await manager.connectMcpServer('coros');
clients.at(-1).provider.saveTokens(tokens('reconnected'));
assert.notEqual(key(), beforeDisconnect);
await assert.rejects(service.confirm(pending.requestId), /connection changed/);
assert.equal(writes().length, 1, 'Account changes never dispatch the old review');

console.log('MCP authorization tests passed (refresh, restart, new grant, invalidation, URL change, disconnect)');
