import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { zipSync } from "fflate";

const repoRoot = path.resolve(import.meta.dirname, "..");
const providerUrl = pathToFileURL(path.join(repoRoot, "dist-electron", "antigravityProvider.js")).href;
const scratch = await mkdtemp(path.join(os.tmpdir(), "coroslink-antigravity-test-"));
// Ambient Google credentials must never reach the agent.
process.env.GEMINI_API_KEY = "ambient-key";

const {
  ANTIGRAVITY_RELEASE_VERSION,
  antigravityEnvironment,
  antigravityModelOptions,
  antigravityReleaseFor,
  answerAntigravityPermission,
  cancelAntigravitySignIn,
  getAntigravitySessionModels,
  getAntigravityStatus,
  installAntigravityRuntime,
  listAntigravityModels,
  normalizeAntigravityError,
  parseAntigravitySignInUrl,
  pendingAntigravitySignInUrl,
  recheckAntigravity,
  signInToAntigravity,
  signOutOfAntigravity,
  streamAntigravityCompletion,
  waitForAntigravityInstall,
  waitForAntigravitySignIn
} = await import(`${providerUrl}?cacheBust=${Date.now()}`);

const SIGN_IN_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=x&redirect_uri=http%3A%2F%2F127.0.0.1%3A50754%2F&state=abc";

try {
  // ----- Pure helpers -----

  assert.equal(antigravityReleaseFor("win32", "x64").url.endsWith("windows-x86_64.zip"), true);
  assert.equal(antigravityReleaseFor("darwin", "arm64").bytes, 114_147_623);
  assert.equal(antigravityReleaseFor("freebsd", "x64"), undefined);

  const line = `Open the following link to authenticate the ACP server: ${SIGN_IN_URL}`;
  assert.equal(parseAntigravitySignInUrl(line), SIGN_IN_URL);
  assert.equal(parseAntigravitySignInUrl("I1026 auth.py] " + line), SIGN_IN_URL);
  assert.equal(parseAntigravitySignInUrl("unrelated log line"), undefined);
  assert.equal(
    parseAntigravitySignInUrl(line.replace("accounts.google.com", "accounts.google.com.evil.example")),
    undefined
  );
  assert.equal(parseAntigravitySignInUrl(line.replace("http%3A%2F%2F127.0.0.1", "http%3A%2F%2Fevil.example")), undefined);
  assert.equal(parseAntigravitySignInUrl(line.replace("https://", "http://")), undefined);
  // Gemini CLI's loopback redirect (localhost and a callback path) is Google's page too.
  const callbackLine = line.replace("http%3A%2F%2F127.0.0.1%3A50754%2F", "http%3A%2F%2Flocalhost%3A50754%2Foauth2callback");
  assert.equal(parseAntigravitySignInUrl(callbackLine), callbackLine.slice(callbackLine.indexOf("https://")));
  assert.equal(
    parseAntigravitySignInUrl(line.replace("http%3A%2F%2F127.0.0.1%3A50754%2F", "http%3A%2F%2Flocalhost.evil.example%3A80%2F")),
    undefined
  );

  const env = antigravityEnvironment(
    { home: "/h", harnessPath: "/r/localharness_external", temp: "/t" },
    { PATH: "/usr/bin", gemini_api_key: "x", GOOGLE_CLOUD_PROJECT: "p", BROWSER: "firefox" },
    "darwin"
  );
  assert.deepEqual(env, {
    PATH: "/usr/bin",
    GEMINI_HOME: "/h",
    ANTIGRAVITY_HARNESS_PATH: "/r/localharness_external",
    AGY_ACP_FORCE_FILE_STORAGE: "1",
    PYTHONUNBUFFERED: "1",
    BROWSER: "true",
    TMPDIR: "/t"
  });
  const windowsEnv = antigravityEnvironment(
    { home: "C:\\h", harnessPath: "C:\\r\\h.exe", temp: "C:\\t" },
    {},
    "win32",
    "C:\\Program Files\\CorosLink\\CorosLink.exe"
  );
  assert.equal(windowsEnv.BROWSER, "'C:/Program Files/CorosLink/CorosLink.exe' -e 0 %s");
  assert.equal(windowsEnv.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(windowsEnv.TEMP, "C:\\t");

  const configOptions = [
    { id: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] },
    {
      id: "model",
      type: "select",
      currentValue: "m-flash",
      options: [
        { value: "m-flash", name: "Fake Flash" },
        { group: "more", name: "More", options: [{ value: "m-pro", name: "Fake Pro" }] }
      ]
    }
  ];
  assert.deepEqual(antigravityModelOptions(configOptions), [
    { value: "", label: "Default", detail: "Fake Flash" },
    { value: "m-flash", label: "Fake Flash" },
    { value: "m-pro", label: "Fake Pro" }
  ]);
  assert.deepEqual(antigravityModelOptions(undefined), []);

  const options = [
    { optionId: "allow_always", kind: "allow_always" },
    { optionId: "allow", kind: "allow_once" },
    { optionId: "deny", kind: "reject_once" }
  ];
  assert.deepEqual(
    answerAntigravityPermission({
      toolCall: { _meta: { is_mcp_tool_call: true, mcp: { server: "coroslink", tool: "x" } } },
      options
    }),
    { outcome: { outcome: "selected", optionId: "allow" } }
  );
  for (const toolCall of [
    { title: "run_command" },
    { _meta: { is_mcp_tool_call: true, mcp: { server: "chrome-devtools", tool: "x" } } },
    { _meta: { mcp: { server: "coroslink" } } }
  ]) {
    assert.deepEqual(answerAntigravityPermission({ toolCall, options }), { outcome: { outcome: "cancelled" } });
  }

  assert.equal(normalizeAntigravityError(new Error("SUBSCRIPTION_REQUIRED for this user")).kind, "auth");
  assert.equal(normalizeAntigravityError(Object.assign(new Error("Authentication required"), { code: -32000 })).kind, "auth");
  assert.equal(normalizeAntigravityError(new Error("RESOURCE_EXHAUSTED: quota")).kind, "usage-limit");
  assert.equal(normalizeAntigravityError(new Error("socket hang up")).kind, "connection");

  // ----- Install: a verified download unpacked into its own runtime folder -----

  const names =
    process.platform === "win32"
      ? ["agy_acp_server.exe", "localharness_external.exe"]
      : ["agy_acp_server.par", "localharness_external"];
  const archive = Buffer.from(
    zipSync({ [names[0]]: new TextEncoder().encode("server"), [names[1]]: new TextEncoder().encode("harness") })
  );
  const server = http.createServer((request, response) => {
    if (request.url === "/release.zip") response.end(archive);
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sha256 = crypto.createHash("sha256").update(archive).digest("hex");
  try {
    const installRoot = path.join(scratch, "install");
    installAntigravityRuntime(installRoot, { url: `${base}/release.zip`, sha256, bytes: archive.length });
    assert.equal(await waitForAntigravityInstall(), undefined);
    const runtimeDir = path.join(installRoot, "runtime", `${ANTIGRAVITY_RELEASE_VERSION}-${sha256.slice(0, 12)}`);
    assert.equal(await readFile(path.join(runtimeDir, names[0]), "utf8"), "server");
    assert.equal(await readFile(path.join(runtimeDir, names[1]), "utf8"), "harness");
    assert.equal(JSON.parse(await readFile(path.join(runtimeDir, "installed.json"), "utf8")).sha256, sha256);
    assert.deepEqual(await readdir(path.join(installRoot, "downloads")), [], "the archive is removed");

    const badRoot = path.join(scratch, "bad-install");
    installAntigravityRuntime(badRoot, { url: `${base}/release.zip`, sha256: "0".repeat(64), bytes: archive.length });
    assert.match(await waitForAntigravityInstall(), /checksum/);
    assert.deepEqual(await readdir(path.join(badRoot, "downloads")), [], "a rejected download is deleted");
    await assert.rejects(stat(path.join(badRoot, "runtime")));
  } finally {
    server.close();
  }

  // ----- A fake Antigravity agent, end to end through sign-in and the tool bridge -----

  const release = antigravityReleaseFor();
  if (!release) {
    console.log("antigravity provider tests passed (helpers, install; no release for this platform)");
    process.exit(0);
  }
  const root = path.join(scratch, "app");
  const runtimeDir = path.join(root, "runtime", `${ANTIGRAVITY_RELEASE_VERSION}-${release.sha256.slice(0, 12)}`);
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(path.join(runtimeDir, names[0]), fakeAgentSource(repoRoot));
  await chmod(path.join(runtimeDir, names[0]), 0o755);
  await writeFile(path.join(runtimeDir, names[1]), "");
  await writeFile(path.join(runtimeDir, "installed.json"), JSON.stringify({ sha256: release.sha256 }));
  const acpDir = path.join(root, "home", "antigravity-acp");

  assert.equal((await getAntigravityStatus(root)).state, "sign-in-required");
  // Before sign-in, a turn never waits on a browser: the sign-in link ends it.
  await assert.rejects(
    streamAntigravityCompletion({
      root,
      instructions: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
      onToken: () => undefined,
      onToolCall: async () => ""
    }),
    (error) => error.kind === "auth"
  );

  const opened = [];
  const connecting = await signInToAntigravity(root, (url) => opened.push(url));
  assert.equal(connecting.state, "connecting");
  await waitForAntigravitySignIn();
  assert.deepEqual(opened, [SIGN_IN_URL]);
  assert.deepEqual(JSON.parse(await readFile(path.join(acpDir, "settings.json"), "utf8")), {
    auth: { type: "oauth-personal" }
  });
  const connected = await getAntigravityStatus(root);
  assert.equal(connected.state, "connected", connected.message);
  assert.equal(getAntigravitySessionModels().length, 3);

  const tokens = [];
  const thinking = [];
  const toolEvents = [];
  const result = await streamAntigravityCompletion({
    root,
    instructions: "COACH INSTRUCTIONS",
    messages: [{ role: "user", content: "How far did I run?", images: [{ label: "w.png", mimeType: "image/png", base64: "AAAA" }] }],
    tools: [
      {
        name: "get_weekly_mileage",
        description: "Weekly running distance.",
        inputSchema: { type: "object", properties: { unit: { type: "string" } } }
      }
    ],
    signal: new AbortController().signal,
    model: "m-pro",
    onToken: (delta) => tokens.push(delta),
    onThinking: (delta) => thinking.push(delta),
    onToolCallStart: (name) => toolEvents.push(`start:${name}`),
    onToolCall: async (name, args) => {
      toolEvents.push(`call:${name}:${JSON.stringify(args)}`);
      return JSON.stringify({ distance: 42.7 });
    }
  });
  assert.deepEqual(toolEvents, ['start:get_weekly_mileage', 'call:get_weekly_mileage:{"unit":"km"}']);
  assert.deepEqual(thinking, ["Checking the week"]);
  assert.equal(tokens.join(""), result.fullText);
  assert.equal(
    result.fullText,
    'You ran {"distance":42.7}. [env:ok meta:ok stdio:ok model:m-pro image:ok tools:get_weekly_mileage ours:selected:allow shell:cancelled]'
  );
  // Coach keeps the transcript; the agent's saved copy and launch folder are gone.
  assert.deepEqual(await readdir(path.join(acpDir, "conversations")), []);
  assert.deepEqual(await readdir(path.join(acpDir, "brain")), []);
  assert.deepEqual(await readdir(path.join(root, "tmp")), []);

  await assert.rejects(
    streamAntigravityCompletion({
      root,
      instructions: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
      model: "not-offered",
      onToken: () => undefined,
      onToolCall: async () => ""
    }),
    /isn't available/
  );

  assert.deepEqual(await listAntigravityModels(root), [
    { value: "", label: "Default", detail: "Fake Flash" },
    { value: "m-flash", label: "Fake Flash" },
    { value: "m-pro", label: "Fake Pro" }
  ]);

  // Cancelling mid-turn stops the agent.
  const controller = new AbortController();
  const hung = streamAntigravityCompletion({
    root,
    instructions: "HANG",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    signal: controller.signal,
    onToken: () => controller.abort(),
    onToolCall: async () => ""
  });
  await assert.rejects(hung, (error) => error.kind === "cancelled");

  // A refusal is remembered, so the saved sign-in looks lapsed until Check again asks Google.
  await writeFile(path.join(acpDir, "refuse-once"), "");
  await assert.rejects(listAntigravityModels(root));
  const refused = await getAntigravityStatus(root);
  assert.equal(refused.state, "sign-in-required");
  assert.equal((await getAntigravityStatus(root)).state, "sign-in-required", "reading the status alone never clears it");
  const rechecked = await recheckAntigravity(root);
  assert.equal(rechecked.state, "connected", rechecked.message);

  // A sign-in whose Google page never comes can be cancelled, without an error left on screen.
  await writeFile(path.join(acpDir, "stall-auth"), "");
  const waiting = await signInToAntigravity(root, () => assert.fail("no page to open"));
  assert.equal(waiting.state, "connecting");
  assert.equal((await getAntigravityStatus(root)).state, "connecting");
  // The waiting state says which step it's on: the agent answered, so it's waiting on Google's link.
  for (let i = 0; i < 50 && (await getAntigravityStatus(root)).message === "Starting Antigravity…"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await getAntigravityStatus(root)).message, "Opening Google's sign-in page…");
  assert.equal(pendingAntigravitySignInUrl(), undefined);
  const cancelled = await cancelAntigravitySignIn(root);
  assert.notEqual(cancelled.state, "connecting");
  assert.doesNotMatch(cancelled.message, /did not finish/);
  await rm(path.join(acpDir, "stall-auth"));

  const signedOut = await signOutOfAntigravity(root);
  assert.equal(signedOut.state, "sign-in-required");
  await assert.rejects(stat(path.join(acpDir, "acp_token.json")));

  console.log("antigravity provider tests passed (helpers, install, sign-in, ACP stream, tool bridge, permissions, models, cleanup, cancel, recheck, cancelled sign-in, sign-out)");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function fakeAgentSource(root) {
  return `#!/usr/bin/env node
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const requireFromRepo = createRequire(${JSON.stringify(path.join(root, "package.json"))});
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const acp = path.join(process.env.GEMINI_HOME, "antigravity-acp");
const token = path.join(acp, "acp_token.json");
const LINK = "Open the following link to authenticate the ACP server: " + ${JSON.stringify(SIGN_IN_URL)};
let mcp;
let nextId = 1000;
const waiting = new Map();
const checks = [];
const sessions = {};
function ask(params) {
  return new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); send({ id, method: "session/request_permission", params }); });
}
async function handle(message) {
  if (message.id !== undefined && waiting.has(message.id)) { waiting.get(message.id)(message.result); return; }
  if (message.method === "initialize") return send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, authMethods: [{ id: "oauth-personal" }] } });
  if (message.method === "authenticate") {
    if (fs.existsSync(path.join(acp, "stall-auth"))) return;
    process.stderr.write("I1026 credential_manager.py] Credentials missing\\n" + LINK + "\\n");
    setTimeout(() => { fs.writeFileSync(token, "{}"); send({ id: message.id, result: {} }); }, 300);
    return;
  }
  if (message.method === "session/new") {
    // Without a saved sign-in the real agent starts the browser flow and waits.
    if (!fs.existsSync(token)) { process.stderr.write(LINK + "\\n"); return; }
    if (fs.existsSync(path.join(acp, "refuse-once"))) { fs.rmSync(path.join(acp, "refuse-once")); process.stderr.write(LINK + "\\n"); return; }
    if (process.env.GEMINI_API_KEY === undefined && process.env.BROWSER && process.env.ANTIGRAVITY_HARNESS_PATH && process.env.AGY_ACP_FORCE_FILE_STORAGE === "1") checks.push("env:ok");
    const meta = message.params._meta?.antigravity ?? {};
    if (Array.isArray(meta.enabledTools) && meta.enabledTools.length === 0 && meta.eagerMcpServers?.[0] === "coroslink" && meta.systemPrompt?.append === "COACH INSTRUCTIONS") checks.push("meta:ok");
    const sessionId = "0f8e4c1a-" + String(Object.keys(sessions).length + 1).padStart(4, "0") + "-4b5c-9d6e-abcdefabcdef";
    sessions[sessionId] = { instructions: meta.systemPrompt?.append };
    fs.mkdirSync(path.join(acp, "conversations"), { recursive: true });
    fs.writeFileSync(path.join(acp, "conversations", sessionId + ".db"), "x");
    fs.writeFileSync(path.join(acp, "conversations", sessionId + ".meta"), "{}");
    fs.mkdirSync(path.join(acp, "brain", sessionId), { recursive: true });
    const server = message.params.mcpServers[0];
    if (server) {
      const { Client } = requireFromRepo("@modelcontextprotocol/sdk/client/index.js");
      const { StdioClientTransport } = requireFromRepo("@modelcontextprotocol/sdk/client/stdio.js");
      mcp = new Client({ name: "fake-antigravity", version: "1" });
      // Tools come through a stdio relay; the agent never gets the loopback URL.
      if (server.url === undefined && server.headers === undefined) checks.push("stdio:ok");
      const env = Object.fromEntries(server.env.map((entry) => [entry.name, entry.value]));
      await mcp.connect(new StdioClientTransport({ command: server.command, args: server.args, env: { ...process.env, ...env } }));
    }
    return send({ id: message.id, result: { sessionId, configOptions: [
      { id: "model", type: "select", currentValue: "m-flash", options: [
        { value: "m-flash", name: "Fake Flash" },
        { group: "more", name: "More", options: [{ value: "m-pro", name: "Fake Pro" }] }
      ] }
    ] } });
  }
  if (message.method === "session/set_config_option") {
    if (message.params.configId === "model") checks.push("model:" + message.params.value);
    return send({ id: message.id, result: { configOptions: [] } });
  }
  if (message.method === "session/cancel") process.exit(0);
  if (message.method === "session/prompt") {
    const sessionId = message.params.sessionId;
    const update = (value) => send({ method: "session/update", params: { sessionId, update: value } });
    if (sessions[sessionId]?.instructions === "HANG") {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "..." } });
      return;
    }
    if (message.params.prompt.some((block) => block.type === "image" && block.data === "AAAA")) checks.push("image:ok");
    update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking the week" } });
    checks.push("tools:" + (await mcp.listTools()).tools.map((tool) => tool.name).join(","));
    const options = [{ optionId: "allow_always", kind: "allow_always" }, { optionId: "allow", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }];
    const ours = await ask({ sessionId, options, toolCall: { toolCallId: "t1", title: "coroslink_get_weekly_mileage", _meta: { is_mcp_tool_call: true, mcp: { server: "coroslink", tool: "get_weekly_mileage" } } } });
    checks.push("ours:" + ours.outcome.outcome + ":" + ours.outcome.optionId);
    update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "get_weekly_mileage", status: "in_progress" });
    const result = await mcp.callTool({ name: "get_weekly_mileage", arguments: { unit: "km" } });
    const shell = await ask({ sessionId, options, toolCall: { toolCallId: "t2", title: "rm -rf ~", kind: "execute" } });
    checks.push("shell:" + shell.outcome.outcome);
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
