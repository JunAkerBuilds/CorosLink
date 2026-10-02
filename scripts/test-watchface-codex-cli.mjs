import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, access, mkdir, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WatchfaceCodexCli, findCodexExecutable } = require('../dist-electron/watchfaceCodexCli.js');
const root = await mkdtemp(path.join(os.tmpdir(), 'watchmaker-cli-test-'));
const fake = path.join(root, 'codex');
const sdk = require.resolve('@modelcontextprotocol/sdk/client/index.js');
const transport = require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
await writeFile(fake, `#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require(${JSON.stringify(sdk)});
const { StreamableHTTPClientTransport } = require(${JSON.stringify(transport)});
const read = require('node:readline').createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
let client, turns = 0, mode;
read.on('line', async line => {
 try {
  const message = JSON.parse(line), p = message.params;
  if (message.method === 'initialize') return send({ id: message.id, result: { userAgent: 'fixture' } });
  if (message.method === 'thread/start') {
   assert.equal(p.sandbox, 'workspace-write'); assert.equal(p.approvalPolicy, 'never'); assert.equal(p.ephemeral, true);
   assert.ok(!JSON.stringify(p).includes(process.env.COROSLINK_WATCHMAKER_TOKEN));
   const config = p.config['mcp_servers.watchmaker'];
   mode = p.developerInstructions.includes('CANCEL_TEST') ? 'cancel' : 'normal';
   client = new Client({ name: 'fake-codex', version: '1' });
   await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: { Authorization: 'Bearer ' + process.env[config.bearer_token_env_var] } } }));
   const tools = await client.listTools(); assert.equal(tools.tools.length, 1); assert.equal(tools.tools[0].name, 'probe');
   return send({ id: message.id, result: { thread: { id: 'fixture-thread' } } });
  }
  if (message.method === 'turn/start') {
   const turn = 'turn-' + ++turns;
   send({ method: 'turn/started', params: { turn: { id: turn } } });
   send({ id: message.id, result: { turn: { id: turn } } });
   if (mode === 'cancel') return;
   for (const image of p.input.filter(v => v.type === 'localImage')) assert.ok(fs.existsSync(image.path));
   send({ method: 'item/started', params: { item: { id: 'shell', type: 'commandExecution', command: 'printf fixture', status: 'inProgress' } } });
   send({ method: 'item/completed', params: { item: { id: 'shell', type: 'commandExecution', command: 'printf fixture', status: 'completed', exitCode: 0 } } });
   const result = await client.callTool({ name: 'probe', arguments: { text: 'through-mcp' } });
   assert.equal(result.isError, turns > 1);
   if (turns === 1) {
    assert.ok(result.content.some(p => p.type === 'image' && p.mimeType === 'image/png'));
    const file = result.content.find(p => p.type === 'text' && p.text.startsWith('Image available')).text.split(' at: ')[1];
    assert.ok(fs.existsSync(file));
   }
   send({ method: 'item/agentMessage/delta', params: { delta: turns === 1 ? 'MCP and shell complete.' : 'Tool failure received.' } });
   send({ method: 'turn/completed', params: { turn: { id: turn, status: 'completed' } } });
  }
 } catch(error) { console.error(error); process.exit(1); }
});
`);
await chmod(fake, 0o700);
// Reproduce an executable npm shim whose underlying vendor executable is absent.
const detection = path.join(root, 'detection');
await mkdir(detection);
const candidate = async (name, source) => {
 const file = path.join(detection, name);
 await writeFile(file, '#!' + process.execPath + '\n' + source);
 await chmod(file, 0o700); return file;
};
const broken = await candidate('broken-codex', "console.error('\\u001b[31mError: spawn vendor/codex ENOENT\\u001b[0m'); process.exit(1);");
const old = await candidate('old-codex', "if (process.argv[2] === '--version') console.log('codex-cli 0.1.0'); else { console.error('unrecognized subcommand app-server'); process.exit(1); }");
const healthy = await candidate('healthy-codex', "console.log(process.argv[2] === '--version' ? 'codex-cli 0.155.1' : 'app-server --listen stdio://');");
assert.equal(await findCodexExecutable({ candidates: [path.join(root, 'absent'), broken, old, healthy] }), healthy);
await assert.rejects(findCodexExecutable({ candidates: [broken] }), error => error.code === 'CODEX_CLI_UNAVAILABLE' && /none passed.*launch check/.test(error.message) && /ENOENT/.test(error.message) && !error.message.includes('\x1b'));
await assert.rejects(findCodexExecutable({ candidates: [path.join(root, 'absent')] }), error => error.code === 'CODEX_CLI_NOT_FOUND' && /not found/.test(error.message));
const slow = await candidate('slow-codex', "setInterval(() => {}, 1000);");
assert.equal(await findCodexExecutable({ candidates: [slow, healthy], probeTimeoutMs: 100 }), healthy);
const abortDetection = new AbortController();
const detecting = findCodexExecutable({ candidates: [slow, healthy], signal: abortDetection.signal });
setTimeout(() => abortDetection.abort(), 100);
await assert.rejects(detecting, /aborted/);
// A GUI PATH without node must still find the sibling runtime in an npm install.
if (process.platform !== 'win32') {
 const npmBin = path.join(detection, 'npm-bin'); await mkdir(npmBin);
 await symlink(process.execPath, path.join(npmBin, 'node'));
 const npmShim = path.join(npmBin, 'codex');
 await writeFile(npmShim, '#!/usr/bin/env node\n' + (await readFile(healthy, 'utf8')).split('\n').slice(1).join('\n'));
 await chmod(npmShim, 0o700);
 assert.equal(await findCodexExecutable({ candidates: [npmShim], env: { ...process.env, PATH: '/usr/bin:/bin' } }), npmShim);
}
console.log('Codex detection passed: broken vendor binary, incompatible CLI, timeout, cancellation, and GUI npm PATH.');
const options = controller => ({ instructions: 'Only use the test probe and harmless shell.', tools: [{ type: 'function', name: 'probe', description: 'Returns a test marker.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }], signal: controller.signal,
 input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run the test.' }, { type: 'input_image', image_url: 'data:image/png;base64,' + png }] }] });
const events = async response => (await response.response.text()).trim().split('\n\n').map(line => JSON.parse(line.slice(6)));
const controller = new AbortController(), progress = [];
const cli = new WatchfaceCodexCli(event => progress.push(event), fake);
let cwd;
try {
 const input = options(controller);
 let frames = await events(await cli.open(input));
 cwd = cli.directory;
 const call = frames.find(frame => frame.item?.type === 'function_call').item;
 assert.equal(call.name, 'probe'); assert.deepEqual(JSON.parse(call.arguments), { text: 'through-mcp' });
 input.input.push({ type: 'function_call_output', call_id: call.call_id, output: '{"ok":true}' }, { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,' + png }] });
 frames = await events(await cli.open(input));
 assert.equal(frames[0].delta, 'MCP and shell complete.');
 assert.ok(progress.some(event => event.tool === 'codex_commandExecution' && event.status === 'done'));
 frames = await events(await cli.open(input));
 const next = frames.find(frame => frame.item)?.item;
 input.input.push({ type: 'function_call_output', call_id: next.call_id, output: '{"error":"rejected asset"}' });
 frames = await events(await cli.open(input));
 assert.equal(frames[0].delta, 'Tool failure received.');
} finally { await cli.dispose(); }
await assert.rejects(access(cwd), /ENOENT/);
const aborter = new AbortController();
const cancelled = new WatchfaceCodexCli(() => {}, fake);
try {
 const running = cancelled.open({ ...options(aborter), instructions: 'CANCEL_TEST' });
 setTimeout(() => aborter.abort(), 400);
 await assert.rejects(running, /cancelled|aborted|closed/);
} finally { await cancelled.dispose(); }
const absent = new WatchfaceCodexCli(() => {}, path.join(root, 'missing-codex'));
try { await assert.rejects(absent.open(options(new AbortController())), /launch Codex|no longer running|ENOENT/); }
finally { await absent.dispose(); }
await rm(root, { recursive: true, force: true });
console.log('Codex CLI MCP tests passed: authenticated private bridge, native events, tool errors, image/file handoff, follow-up turns, missing executable and cancellation cleanup.');

if (process.argv.includes('--live')) {
 const cli = new WatchfaceCodexCli(event => { if (event.type === 'tool') console.log(event.tool, event.status); });
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 120_000);
 try {
  const input = options(controller);
  input.instructions = 'This is an isolated connection test. Run one harmless shell command: printf watchmaker-cli-ok. Then call the watchmaker MCP probe with text=watchmaker-cli-ok. Do not access the live CorosLink app, projects, or any other MCP server. Do not search or inspect other files. After probe returns, reply exactly Connected.';
  input.input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Perform the isolated shell and MCP test now.' }] }];
  let called = false, finished = false;
  for (let round = 0; round < 5; round++) {
   const frames = await events(await cli.open(input));
   const calls = frames.filter(f => f.item?.type === 'function_call');
   if (!calls.length) { assert.ok(called, 'real CLI called the private MCP tool'); assert.ok(frames.some(f => f.delta?.includes('Connected'))); finished = true; break; }
   for (const { item } of calls) {
    assert.equal(item.name, 'probe'); called = true;
    input.input.push({ type: 'function_call_output', call_id: item.call_id, output: '{"connected":true}' });
   }
  }
  assert.ok(finished);
  console.log('Installed Codex CLI live shell + MCP smoke test passed in a temporary workspace.');
 } finally { clearTimeout(timer); await cli.dispose(); }
}
