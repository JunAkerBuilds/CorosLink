import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const providerUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "opencodeProvider.js")
).href;

const scratch = await mkdtemp(path.join(os.tmpdir(), "coroslink-opencode-test-"));
const sessionLog = path.join(scratch, "sessions.log");
process.env.FAKE_OPENCODE_LOG = sessionLog;
// Inherited ones would outrank the request's configuration file; the provider must drop them.
process.env.OPENCODE_CONFIG_CONTENT = '{"permission":{"*":"allow"}}';
process.env.OPENCODE_PERMISSION = '{"*":"allow"}';

const {
  buildOpencodeConfig,
  createOpencodeEnvironment,
  getOpencodeExecutableCandidates,
  getOpencodeSessionModels,
  getOpencodeStatus,
  listOpencodeModels,
  normalizeOpencodeError,
  opencodeMajor,
  opencodeModelOptions,
  parseOpencodeVersion,
  pickOpencodeFromPath,
  readOpencodeSessionConfig,
  recheckOpencodeStatus,
  resetOpencodeCatalog,
  streamOpencodeCompletion,
  testOpencodeConnection
} = await import(`${providerUrl}?cacheBust=${Date.now()}`);

const deletedSessions = async () =>
  (await readFile(sessionLog, "utf8").catch(() => "")).split("\n").filter(Boolean);

try {
  // ----- Pure helpers -----

  const macCandidates = getOpencodeExecutableCandidates(undefined, "darwin", { HOME: "/Users/tester" });
  assert.equal(macCandidates[0], "/Users/tester/.opencode/bin/opencode", "the install script's folder first");
  assert.ok(macCandidates.includes("/opt/homebrew/bin/opencode"));
  const windowsCandidates = getOpencodeExecutableCandidates(undefined, "win32", {
    USERPROFILE: "C:\\Users\\tester",
    APPDATA: "C:\\Users\\tester\\AppData\\Roaming"
  });
  assert.ok(windowsCandidates.some((candidate) => candidate.endsWith(path.join("npm", "opencode.cmd"))));
  assert.equal(getOpencodeExecutableCandidates(" /custom/opencode ", "darwin", { HOME: "/h" })[0], "/custom/opencode");

  // Windows: npm's extensionless shell script is listed first and can't be started.
  const whereOutput = "C:\\Users\\tester\\AppData\\Roaming\\npm\\opencode\r\nC:\\Users\\tester\\AppData\\Roaming\\npm\\opencode.cmd\r\n";
  assert.equal(pickOpencodeFromPath(whereOutput, "win32"), "C:\\Users\\tester\\AppData\\Roaming\\npm\\opencode.cmd");
  assert.equal(pickOpencodeFromPath("C:\\tools\\opencode\r\n", "win32"), undefined, "nothing Windows can run");
  assert.equal(pickOpencodeFromPath("C:\\tools\\OpenCode.EXE\r\n", "win32"), "C:\\tools\\OpenCode.EXE");
  assert.equal(pickOpencodeFromPath("/opt/homebrew/bin/opencode\n/usr/local/bin/opencode\n", "darwin"), "/opt/homebrew/bin/opencode");
  assert.equal(pickOpencodeFromPath("\n", "linux"), undefined);

  assert.equal(parseOpencodeVersion("opencode v2.0.22\n"), "2.0.22");
  assert.equal(parseOpencodeVersion("1.19.5"), "1.19.5");
  assert.equal(parseOpencodeVersion("0.0.0-dev-202611080442"), "0.0.0-dev-202611080442");
  assert.equal(parseOpencodeVersion("no version here"), undefined);
  assert.equal(opencodeMajor("1.19.5"), 1);
  assert.equal(opencodeMajor("2.2.6"), 2);
  assert.equal(opencodeMajor(undefined), 2, "an unreadable version is taken for the current line");

  const bridge = { url: "http://127.0.0.1:1234/mcp", token: "secret" };
  const v2 = buildOpencodeConfig({ major: 2, instructions: "Coach {env:HOME} {file:~/.ssh/id_rsa}", bridge });
  assert.equal(v2.default_agent, "coroslink-coach");
  assert.deepEqual(v2.permissions, [
    { action: "*", resource: "*", effect: "deny" },
    { action: "coroslink_*", resource: "*", effect: "allow" }
  ]);
  assert.deepEqual(v2.agents["coroslink-coach"].permissions, v2.permissions, "agent rules are read last");
  assert.equal(
    v2.agents["coroslink-coach"].system,
    "Coach { env:HOME} { file:~/.ssh/id_rsa}",
    "OpenCode's config variables are broken up in the athlete's text"
  );
  assert.equal(v2.mcp.servers.coroslink.codemode, false, "tools are offered directly, never through Code Mode");
  assert.equal(v2.mcp.servers.coroslink.oauth, false);
  assert.deepEqual(v2.mcp.servers.coroslink.headers, { Authorization: "Bearer secret" });
  assert.equal(v2.permission, undefined);

  const v1 = buildOpencodeConfig({ major: 1, instructions: "Coach", bridge });
  assert.deepEqual(v1.permission, { "*": "deny", "coroslink_*": "allow" });
  assert.deepEqual(Object.keys(v1.permission), ["*", "coroslink_*"], "deny first, so the allow is the last match");
  assert.equal(v1.agent["coroslink-coach"].prompt, "Coach");
  assert.deepEqual(v1.agent["coroslink-coach"].permission, v1.permission);
  assert.equal(v1.mcp.coroslink.url, bridge.url);
  assert.equal(v1.mcp.coroslink.codemode, undefined, "1.x rejects keys it does not know");
  assert.equal(v1.share, "disabled");
  assert.equal(v1.agents, undefined);
  assert.equal(buildOpencodeConfig({ major: 2, instructions: "x" }).mcp, undefined);

  const environment = createOpencodeEnvironment("/opt/tools/opencode", "/tmp/request.json");
  assert.equal(environment.OPENCODE_CONFIG, "/tmp/request.json");
  assert.equal(environment.OPENCODE_CONFIG_CONTENT, undefined);
  assert.equal(environment.OPENCODE_PERMISSION, undefined);
  assert.equal(environment.OPENCODE_DISABLE_AUTOUPDATE, "1");
  assert.ok(environment.PATH.startsWith(`/opt/tools${path.delimiter}`));

  const flat = readOpencodeSessionConfig({
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: "openai/gpt-5.4",
        options: [
          { value: "openai/gpt-5.4", name: "openai/GPT-5.4" },
          { group: "anthropic", name: "Anthropic", options: [{ value: "anthropic/claude", name: "anthropic/Claude" }] },
          { value: 7 }
        ]
      },
      { id: "effort", category: "thought_level", currentValue: "default", options: [{ value: "high", name: "High" }] },
      { id: "mode", category: "mode", currentValue: "build", options: [{ value: "build", name: "Build" }, { value: "plan", name: "Plan" }] }
    ]
  });
  assert.equal(flat.currentMode, "build");
  assert.deepEqual(flat.modes, ["build", "plan"]);
  assert.deepEqual(opencodeModelOptions(flat), [
    { value: "", label: "Default", detail: "openai/GPT-5.4" },
    { value: "openai/gpt-5.4", label: "openai/GPT-5.4" },
    { value: "anthropic/claude", label: "anthropic/Claude" }
  ]);
  const legacy = readOpencodeSessionConfig({
    models: { currentModelId: "a/b", availableModels: [{ modelId: "a/b", name: "A B" }, { modelId: "c/d" }] },
    modes: { currentModeId: "coroslink-coach", availableModes: [{ id: "coroslink-coach" }] }
  });
  assert.equal(legacy.currentMode, "coroslink-coach");
  assert.deepEqual(opencodeModelOptions(legacy).map((row) => row.value), ["", "a/b", "c/d"]);
  assert.deepEqual(opencodeModelOptions(readOpencodeSessionConfig(undefined)), []);

  const quota = normalizeOpencodeError(
    Object.assign(new Error("Internal error: Insufficient account funds"), { code: -32603 })
  );
  assert.equal(quota.kind, "usage-limit");
  assert.match(quota.message, /Insufficient account funds/);
  assert.doesNotMatch(quota.message, /Internal error/);
  assert.equal(normalizeOpencodeError(Object.assign(new Error("Authentication required"), { code: -32000 })).kind, "auth");
  assert.equal(normalizeOpencodeError(new Error("Internal error: No models are available")).kind, "auth");
  assert.equal(normalizeOpencodeError(new Error("spawn /x/opencode ENOENT")).kind, "not-installed");
  assert.equal(normalizeOpencodeError(new Error("socket hang up")).kind, "connection");

  const missing = await getOpencodeStatus(path.join(scratch, "missing-opencode"));
  assert.equal(missing.state, "not-installed");
  assert.equal(missing.installed, false);
  assert.equal(missing.authenticated, false);

  // ----- A fake OpenCode speaking ACP, end to end through the tool bridge -----

  const bin = path.join(scratch, "bin");
  await mkdir(bin, { recursive: true });
  const fakeV2 = path.join(bin, "opencode");
  await writeFile(fakeV2, fakeOpencodeSource(repoRoot, "opencode v2.9.9"));
  await chmod(fakeV2, 0o755);
  // Its own file, so the version kept for the first one is not reused.
  const fakeV1 = path.join(bin, "opencode-v1");
  await writeFile(fakeV1, fakeOpencodeSource(repoRoot, "1.19.5"));
  await chmod(fakeV1, 0o755);
  const workspaceDir = path.join(scratch, "app", "opencode-coach");

  const status = await getOpencodeStatus(fakeV2);
  assert.equal(status.state, "connected");
  assert.equal(status.version, "2.9.9");
  assert.equal(status.modelCount, undefined, "no session has listed the models yet");

  // The picker's list comes from a session that sends no prompt and leaves nothing behind.
  const models = await listOpencodeModels(fakeV2, workspaceDir);
  assert.deepEqual(models, [
    { value: "", label: "Default", detail: "zen/Default Model" },
    { value: "zen/default", label: "zen/Default Model" },
    { value: "openai/gpt-fake", label: "openai/GPT Fake" },
    { value: "local/from-config", label: "local/From Config" }
  ]);
  assert.deepEqual(getOpencodeSessionModels(fakeV2), models);
  assert.deepEqual(await deletedSessions(), ["s1"], "the check session was removed from OpenCode's history");
  const listed = await getOpencodeStatus(fakeV2);
  assert.equal(listed.modelCount, 3);
  assert.match(listed.message, /3 models/);

  const run = (executablePath, extra = {}) => {
    const events = { tokens: [], thinking: [], tools: [] };
    const result = streamOpencodeCompletion({
      executablePath,
      workspaceDir,
      instructions: "COACH INSTRUCTIONS {env:HOME}",
      messages: [
        { role: "user", content: "How far did I run?", images: [{ label: "week.png", mimeType: "image/png", base64: "AAAA" }] }
      ],
      tools: [
        { name: "get_weekly_mileage", description: "Weekly distance", inputSchema: { type: "object", properties: { unit: { type: "string" } } } }
      ],
      signal: new AbortController().signal,
      onToken: (delta) => events.tokens.push(delta),
      onThinking: (delta) => events.thinking.push(delta),
      onToolCallStart: (name) => events.tools.push(`start:${name}`),
      onToolCallError: (name, message) => events.tools.push(`error:${name}:${message}`),
      onToolCall: async (name, args) => {
        events.tools.push(`call:${name}:${JSON.stringify(args)}`);
        return "42.5 km";
      },
      ...extra
    });
    return { events, result };
  };

  // Request files an app that crashed left behind: the next request takes the old ones.
  const requestsDir = path.join(workspaceDir, "requests");
  for (const [name, ageHours] of [["crashed.json", 48], ["running.json", 1]]) {
    await writeFile(path.join(requestsDir, name), "{}\n");
    const when = new Date(Date.now() - ageHours * 60 * 60_000);
    await utimes(path.join(requestsDir, name), when, when);
  }

  // 2.x: answers session/new before it has read the request's configuration.
  const second = run(fakeV2, { model: "openai/gpt-fake" });
  const answer = await second.result;
  assert.match(answer.fullText, /^You ran 42\.5 km\./);
  for (const check of [
    "env:ok",
    "dialect:v2",
    "system:ok",
    "locked:ok",
    "codemode:off",
    "model:openai/gpt-fake",
    "tools-listed-before-prompt",
    "tools:get_weekly_mileage",
    "image:ok",
    "permission:selected:reject"
  ]) {
    assert.ok(answer.fullText.includes(check), `${check} in ${answer.fullText}`);
  }
  assert.deepEqual(second.events.thinking, ["Checking the week"]);
  assert.deepEqual(second.events.tools, ["start:get_weekly_mileage", 'call:get_weekly_mileage:{"unit":"km"}']);
  assert.deepEqual(await deletedSessions(), ["s1", "s1"], "the Coach session was removed too");
  assert.deepEqual(await readdir(requestsDir), ["running.json"], "no request file is left behind, and a recent one is not touched");
  await rm(path.join(requestsDir, "running.json"));
  assert.deepEqual(await readdir(path.join(workspaceDir, "workspace")), [], "sessions run in an empty directory");

  // 1.x: the older configuration keys, and no session/delete.
  const firstStarted = performance.now();
  const first = run(fakeV1);
  const older = await first.result;
  assert.ok(performance.now() - firstStarted < 2_500, "1.x reads the tools as the prompt starts, so nothing is waited for");
  for (const check of ["dialect:v1", "system:ok", "locked:ok", "tools:get_weekly_mileage", "permission:selected:reject"]) {
    assert.ok(older.fullText.includes(check), `${check} in ${older.fullText}`);
  }
  assert.ok(!older.fullText.includes("model:"), "no model is set when none is chosen");
  assert.deepEqual(await deletedSessions(), ["s1", "s1"], "1.x has no session/delete, so none is sent");

  // A request without Coach tools still offers one, which free models insist on.
  const connection = await testOpencodeConnection(fakeV2, workspaceDir, "openai/gpt-fake");
  assert.equal(connection.ok, true, connection.message);
  assert.equal(connection.status.state, "connected");

  // A model OpenCode no longer offers.
  await assert.rejects(run(fakeV2, { model: "gone/model" }).result, (error) => {
    assert.equal(error.kind, "connection");
    assert.match(error.message, /doesn't offer gone\/model/);
    return true;
  });

  // The provider of the chosen model refuses: said in its own words, and no gate on OpenCode itself.
  process.env.FAKE_OPENCODE_QUOTA = "1";
  await assert.rejects(run(fakeV2).result, (error) => {
    assert.equal(error.kind, "usage-limit");
    assert.match(error.message, /Insufficient account funds/);
    return true;
  });
  const refused = await testOpencodeConnection(fakeV2, workspaceDir);
  assert.equal(refused.ok, false);
  assert.equal(refused.status.state, "usage-limit-reached");
  assert.equal(refused.status.authenticated, true, "the other models stay usable");
  delete process.env.FAKE_OPENCODE_QUOTA;
  assert.equal((await getOpencodeStatus(fakeV2)).state, "connected");

  // An OpenCode that ignores the request's configuration would run its coding agent: refused.
  process.env.FAKE_OPENCODE_NO_COACH = "1";
  let toolCalled = false;
  await assert.rejects(
    run(fakeV2, { onToolCall: async () => { toolCalled = true; return ""; } }).result,
    (error) => {
      assert.equal(error.kind, "connection");
      assert.match(error.message, /did not load CorosLink's Coach setup/);
      return true;
    }
  );
  assert.equal(toolCalled, false, "no prompt was sent");
  delete process.env.FAKE_OPENCODE_NO_COACH;

  // No provider connected in OpenCode: the status says how to connect one, and "Check" lifts it.
  process.env.FAKE_OPENCODE_NO_MODELS = "1";
  const empty = await recheckOpencodeStatus(fakeV2, workspaceDir);
  assert.equal(empty.state, "sign-in-required");
  assert.equal(empty.authenticated, false);
  assert.equal(empty.modelCount, 0);
  assert.match(empty.message, /opencode auth login/);
  assert.equal((await getOpencodeStatus(fakeV2)).state, "sign-in-required", "remembered without another launch");
  delete process.env.FAKE_OPENCODE_NO_MODELS;
  const lifted = await recheckOpencodeStatus(fakeV2, workspaceDir);
  assert.equal(lifted.state, "connected");
  assert.equal(lifted.modelCount, 3);

  // A turn stopped while its session is still starting knows only what OpenCode said
  // before it read the request's configuration; the picker keeps the full list.
  process.env.FAKE_OPENCODE_SLOW_CONFIG = "1";
  const early = new AbortController();
  const stoppedEarly = run(fakeV2, { signal: early.signal });
  setTimeout(() => early.abort(), 900);
  await assert.rejects(stoppedEarly.result, (error) => error.kind === "cancelled");
  delete process.env.FAKE_OPENCODE_SLOW_CONFIG;
  assert.deepEqual(getOpencodeSessionModels(fakeV2), models, "the model list is not replaced by a half-started session's");

  // Cancelling ends the OpenCode process and reports a cancellation. The stopped
  // conversation is removed from OpenCode's history first, while the process can still take it.
  const controller = new AbortController();
  process.env.FAKE_OPENCODE_HANG = "1";
  const deletedBeforeStop = (await deletedSessions()).length;
  await assert.rejects(
    run(fakeV2, { signal: controller.signal, onToken: () => controller.abort() }).result,
    (error) => error.kind === "cancelled"
  );
  assert.equal((await deletedSessions()).length, deletedBeforeStop + 1, "a stopped turn is removed from OpenCode's history");
  assert.deepEqual(await readdir(path.join(workspaceDir, "requests")), []);

  // A turn that stops responding is removed too.
  const deletedBeforeTimeout = (await deletedSessions()).length;
  await assert.rejects(
    run(fakeV2, { timeoutMs: 2_500 }).result,
    (error) => error.kind === "timeout" && /stopped responding/.test(error.message)
  );
  assert.equal((await deletedSessions()).length, deletedBeforeTimeout + 1, "a timed-out turn is removed from OpenCode's history");
  delete process.env.FAKE_OPENCODE_HANG;

  resetOpencodeCatalog();
  console.log(
    "opencode provider tests passed (helpers, 1.x and 2.x configuration, ACP stream, tool bridge, models, session cleanup, refusals, no-models gate, cancel)"
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}

/**
 * A stand-in `opencode` that answers ACP like the real one: it reads the
 * request's configuration from OPENCODE_CONFIG, connects to the bridge that
 * configuration declares and, as 2.x does, answers session/new before it has
 * loaded any of it.
 */
function fakeOpencodeSource(root, versionLine) {
  return `#!/usr/bin/env node
const { createRequire } = require("node:module");
const fs = require("node:fs");
const requireFromRepo = createRequire(${JSON.stringify(path.join(root, "package.json"))});
const args = process.argv.slice(2);
const VERSION = ${JSON.stringify(versionLine)};
if (args.includes("--version")) { console.log(VERSION); process.exit(0); }
if (args[0] !== "acp") { process.stderr.write("unexpected arguments: " + args.join(" ") + "\\n"); process.exit(2); }
const v2 = !/^1\\./.test(VERSION);
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const config = JSON.parse(fs.readFileSync(process.env.OPENCODE_CONFIG, "utf8"));
const checks = [];
if (!process.env.OPENCODE_CONFIG_CONTENT && !process.env.OPENCODE_PERMISSION && process.env.OPENCODE_DISABLE_AUTOUPDATE === "1") checks.push("env:ok");
checks.push(config.agents ? "dialect:v2" : "dialect:v1");
const coach = (config.agents || config.agent || {})[config.default_agent] || {};
if ((coach.system || coach.prompt) === "COACH INSTRUCTIONS { env:HOME}") checks.push("system:ok");
const rules = JSON.stringify([config.permissions || config.permission, coach.permissions || coach.permission]);
if (rules === JSON.stringify(v2
  ? Array(2).fill([{ action: "*", resource: "*", effect: "deny" }, { action: "coroslink_*", resource: "*", effect: "allow" }])
  : Array(2).fill({ "*": "deny", "coroslink_*": "allow" }))) checks.push("locked:ok");
const server = v2 ? config.mcp && config.mcp.servers && config.mcp.servers.coroslink : config.mcp && config.mcp.coroslink;
if (v2 && server && server.codemode === false) checks.push("codemode:off");
const MODELS = [
  { value: "zen/default", name: "zen/Default Model" },
  { value: "openai/gpt-fake", name: "openai/GPT Fake" }
];
const options = (models, mode, modes, model = "zen/default") => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: model, options: models },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] },
  { id: "mode", name: "Session Mode", category: "mode", type: "select", currentValue: mode, options: modes.map((value) => ({ value, name: value })) }
];
const loadedModels = [...MODELS, { value: "local/from-config", name: "local/From Config" }];
const loadedMode = process.env.FAKE_OPENCODE_NO_COACH ? "build" : config.default_agent;
const loadedModes = process.env.FAKE_OPENCODE_NO_COACH ? ["build", "plan"] : [config.default_agent, "build"];
let mcp;
let tools;
let model = "zen/default";
let nextId = 1000;
const waiting = new Map();
async function connectBridge() {
  if (!server) return;
  const { Client } = requireFromRepo("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = requireFromRepo("@modelcontextprotocol/sdk/client/streamableHttp.js");
  mcp = new Client({ name: "fake-opencode", version: "1" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
  tools = (await mcp.listTools()).tools.map((tool) => tool.name);
}
async function handle(message) {
  if (message.id !== undefined && waiting.has(message.id)) { waiting.get(message.id)(message.result); return; }
  if (message.method === "initialize") {
    return send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: v2 ? { delete: {}, close: {} } : { close: {} } }, agentInfo: { name: "OpenCode" } } });
  }
  if (message.method === "session/new") {
    if (process.env.FAKE_OPENCODE_NO_MODELS) {
      return send({ id: message.id, error: { code: -32603, message: "Internal error: No models are available", data: { errorName: "ACPCatalogNotReadyError" } } });
    }
    if (message.params.mcpServers.length > 0) checks.push("mcp-over-acp");
    if (!v2) {
      // 1.x has read its configuration by the time it answers, and reads the bridge's tools as the prompt starts.
      return send({ id: message.id, result: { sessionId: "s1", configOptions: options(loadedModels, loadedMode, loadedModes) } });
    }
    send({ id: message.id, result: { sessionId: "s1", configOptions: options(MODELS, "build", ["build", "plan"]) } });
    setTimeout(async () => {
      send({ method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "config_option_update", configOptions: options(loadedModels, loadedMode, loadedModes) } } });
      // The bridge's tools arrive a little after the agents and models.
      setTimeout(() => connectBridge().catch((error) => { process.stderr.write(String(error.stack) + "\\n"); process.exit(1); }), 250);
    }, process.env.FAKE_OPENCODE_SLOW_CONFIG ? 10_000 : 150);
    return;
  }
  if (message.method === "session/set_config_option") {
    if (message.params.configId === "model") {
      if (!loadedModels.some((row) => row.value === message.params.value)) {
        return send({ id: message.id, error: { code: -32602, message: "Invalid params: model not found: " + message.params.value, data: { modelId: message.params.value } } });
      }
      model = message.params.value;
      checks.push("model:" + model);
    }
    return send({ id: message.id, result: { configOptions: options(loadedModels, loadedMode, loadedModes, model) } });
  }
  if (message.method === "session/delete") {
    fs.appendFileSync(process.env.FAKE_OPENCODE_LOG, message.params.sessionId + "\\n");
    return send({ id: message.id, result: {} });
  }
  if (message.method === "session/prompt") {
    const update = (value) => send({ method: "session/update", params: { sessionId: "s1", update: value } });
    if (process.env.FAKE_OPENCODE_HANG) {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "..." } });
      return;
    }
    if (process.env.FAKE_OPENCODE_QUOTA) {
      return send({ id: message.id, error: { code: -32603, message: "Internal error: Insufficient account funds", data: { service: "session", errorName: "provider.quota" } } });
    }
    // As the real one: a prompt that arrives before the tools were read goes out without them.
    if (v2 && tools) checks.push("tools-listed-before-prompt");
    if (!v2) await connectBridge();
    if (tools) checks.push("tools:" + tools.join(","));
    if (message.params.prompt.some((block) => block.type === "image" && block.data === "AAAA")) checks.push("image:ok");
    if (!tools || tools[0] === "no_tools_needed") {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Connected" } });
      return send({ id: message.id, result: { stopReason: "end_turn" } });
    }
    update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking the week" } });
    update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "coroslink_get_weekly_mileage", kind: "other", status: "pending" });
    const result = await mcp.callTool({ name: "get_weekly_mileage", arguments: { unit: "km" } });
    const permission = await new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      send({ id, method: "session/request_permission", params: { sessionId: "s1", toolCall: { toolCallId: "t2", title: "shell" }, options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }
      ] } });
    });
    checks.push("permission:" + permission.outcome.outcome + ":" + permission.outcome.optionId);
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "You ran " + result.content[0].text + "." } });
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " [" + checks.join(" ") + "]" } });
    return send({ id: message.id, result: { stopReason: "end_turn" } });
  }
  if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: "unknown" } });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) if (line.trim()) handle(JSON.parse(line)).catch((error) => { process.stderr.write(String(error.stack) + "\\n"); process.exit(1); });
});
process.stdin.on("end", () => process.exit(0));
`;
}
