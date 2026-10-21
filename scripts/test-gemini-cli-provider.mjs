import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const providerUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "geminiCliProvider.js")
).href;

const scratch = await mkdtemp(path.join(os.tmpdir(), "coroslink-gemini-test-"));
// Keep the real Gemini configuration out of every check below.
process.env.GEMINI_CLI_HOME = path.join(scratch, "home");
process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = path.join(scratch, "system", "settings.json");
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_DEFAULT_AUTH_TYPE;
const geminiDir = path.join(process.env.GEMINI_CLI_HOME, ".gemini");
await mkdir(geminiDir, { recursive: true });

const {
  authFailureDetail,
  geminiModelOptionsFromSession,
  geminiPrompt,
  getGeminiAuthState,
  getGeminiCliStatus,
  getGeminiExecutableCandidates,
  getGeminiSessionModels,
  launchGeminiCliLogin,
  listGeminiCliModels,
  normalizeGeminiCliError,
  parseGeminiSelectedAuthType,
  recheckGeminiCliStatus,
  streamGeminiCliCompletion
} = await import(`${providerUrl}?cacheBust=${Date.now()}`);

try {
  // ----- Pure helpers -----

  assert.equal(
    parseGeminiSelectedAuthType(
      '{\n  // "selectedType": "vertex-ai",\n  "security": { "auth": { "selectedType": "oauth-personal" } }\n}'
    ),
    "oauth-personal"
  );
  assert.equal(parseGeminiSelectedAuthType('{ "selectedAuthType": "gemini-api-key" }'), "gemini-api-key");
  assert.equal(parseGeminiSelectedAuthType("{}"), undefined);

  const macCandidates = getGeminiExecutableCandidates(undefined, "darwin", { HOME: "/Users/tester" });
  assert.ok(macCandidates.includes("/opt/homebrew/bin/gemini"));
  assert.ok(macCandidates.includes("/Users/tester/.local/bin/gemini"));
  const windowsCandidates = getGeminiExecutableCandidates(undefined, "win32", {
    USERPROFILE: "C:\\Users\\tester",
    APPDATA: "C:\\Users\\tester\\AppData\\Roaming"
  });
  assert.ok(windowsCandidates.some((candidate) => candidate.endsWith(path.join("npm", "gemini.cmd"))));

  assert.equal(normalizeGeminiCliError(new Error("Quota exceeded for quota metric")).kind, "usage-limit");
  assert.equal(normalizeGeminiCliError(Object.assign(new Error("Rate limit"), { code: 429 })).kind, "usage-limit");
  assert.equal(normalizeGeminiCliError(new Error("Authentication required")).kind, "auth");
  assert.equal(normalizeGeminiCliError(new Error("spawn ENOENT")).kind, "not-installed");
  assert.equal(normalizeGeminiCliError(new Error("socket hang up")).kind, "connection");

  assert.equal(
    authFailureDetail(
      "Loaded cached credentials.\nError authenticating: IneligibleTierError: This client is no longer supported.\n    at frame"
    ),
    "This client is no longer supported."
  );
  assert.equal(authFailureDetail("Loaded cached credentials."), undefined);

  assert.deepEqual(geminiModelOptionsFromSession(undefined), []);
  assert.deepEqual(
    geminiModelOptionsFromSession({
      currentModelId: "auto",
      availableModels: [
        { modelId: "auto", name: "Auto" },
        { modelId: "gemini-3-pro", name: "Gemini 3 Pro" },
        { modelId: 7 }
      ]
    }),
    [
      { value: "", label: "Default", detail: "Auto" },
      { value: "auto", label: "Auto" },
      { value: "gemini-3-pro", label: "Gemini 3 Pro" }
    ]
  );

  const prompt = geminiPrompt([
    { role: "user", content: "Plan my week", images: [{ label: "plan.pdf, page 1", mimeType: "image/png", base64: "AAAA" }] },
    { role: "assistant", content: "Sure." }
  ]);
  assert.equal(prompt[0].type, "text");
  assert.match(prompt[0].text, /Athlete: Plan my week\n\nAssistant: Sure\./);
  assert.deepEqual(prompt.slice(1), [
    { type: "text", text: "Image: plan.pdf, page 1" },
    { type: "image", mimeType: "image/png", data: "AAAA" }
  ]);

  // ----- Sign-in state from the CLI's own files -----

  assert.deepEqual(await getGeminiAuthState(), { signedIn: false });
  await writeFile(
    path.join(geminiDir, "settings.json"),
    '{ "security": { "auth": { "selectedType": "oauth-personal" } } }'
  );
  assert.deepEqual(await getGeminiAuthState(), { method: "oauth-personal", signedIn: false });
  await writeFile(path.join(geminiDir, "oauth_creds.json"), "{}");
  assert.deepEqual(await getGeminiAuthState(), { method: "oauth-personal", signedIn: true });
  assert.deepEqual(
    await getGeminiAuthState({ ...process.env, GEMINI_CLI_HOME: path.join(scratch, "nobody"), GEMINI_API_KEY: "k" }),
    { method: "gemini-api-key", signedIn: true }
  );

  const missing = await getGeminiCliStatus(path.join(scratch, "missing-gemini"));
  assert.equal(missing.state, "not-installed");
  assert.equal(missing.installed, false);

  // ----- A fake Gemini CLI speaking ACP, end to end through the tool bridge -----

  const bin = path.join(scratch, "bin");
  await mkdir(bin, { recursive: true });
  const fakeGemini = path.join(bin, "gemini");
  await writeFile(fakeGemini, fakeGeminiSource(repoRoot));
  await chmod(fakeGemini, 0o755);
  const workspaceDir = path.join(scratch, "app", "gemini-coach", "workspace");

  const status = await getGeminiCliStatus(fakeGemini);
  assert.equal(status.state, "connected");
  assert.equal(status.version, "0.99.0");
  assert.equal(status.authMethod, "oauth-personal");

  const tokens = [];
  const thinking = [];
  const toolEvents = [];
  const result = await streamGeminiCliCompletion({
    executablePath: fakeGemini,
    workspaceDir,
    instructions: "COACH INSTRUCTIONS",
    messages: [
      { role: "user", content: "How far did I run?", images: [{ label: "watch.png", mimeType: "image/png", base64: "AAAA" }] }
    ],
    tools: [
      {
        name: "get_weekly_mileage",
        description: "Weekly running distance.",
        inputSchema: { type: "object", properties: { unit: { type: "string" } }, required: ["unit"] }
      }
    ],
    signal: new AbortController().signal,
    model: "flash",
    onToken: (delta) => tokens.push(delta),
    onThinking: (delta) => thinking.push(delta),
    onToolCallStart: (name) => toolEvents.push(`start:${name}`),
    onToolCallError: (name, message) => toolEvents.push(`error:${name}:${message}`),
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
    'You ran {"distance":42.7}. [args:ok model:flash probe:401 system:ok settings:ok image:ok tools:get_weekly_mileage permission:cancelled]'
  );
  // The instructions file lives only as long as the request.
  assert.deepEqual(await readdir(path.join(scratch, "app", "gemini-coach", "gemini-coach-prompts")), []);
  const workspaceSettings = JSON.parse(await readFile(path.join(workspaceDir, ".gemini", "settings.json"), "utf8"));
  assert.deepEqual(workspaceSettings.tools.core, []);

  // The model picker reads what that session offered instead of starting one (Google sign-in).
  assert.deepEqual(getGeminiSessionModels(fakeGemini), [
    { value: "", label: "Default", detail: "Gemini Fake Pro" },
    { value: "gemini-fake-pro", label: "Gemini Fake Pro" },
    { value: "gemini-fake-flash", label: "Gemini Fake Flash" }
  ]);
  assert.deepEqual(getGeminiSessionModels(path.join(bin, "other-gemini")), []);

  const models = await listGeminiCliModels(fakeGemini, workspaceDir);
  assert.deepEqual(models, [
    { value: "", label: "Default", detail: "Gemini Fake Pro" },
    { value: "gemini-fake-pro", label: "Gemini Fake Pro" },
    { value: "gemini-fake-flash", label: "Gemini Fake Flash" }
  ]);

  // An unsafe model name never reaches the command line.
  await assert.rejects(
    streamGeminiCliCompletion({
      executablePath: fakeGemini,
      workspaceDir,
      instructions: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
      model: "pro; rm -rf ~",
      onToken: () => undefined,
      onToolCall: async () => ""
    }),
    /Unsupported Gemini model name/
  );

  // A refused sign-in reports Gemini's reason and holds in the status.
  process.env.FAKE_GEMINI_REFUSE = "1";
  await assert.rejects(
    streamGeminiCliCompletion({
      executablePath: fakeGemini,
      workspaceDir,
      instructions: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
      onToken: () => undefined,
      onToolCall: async () => ""
    }),
    (error) =>
      error.kind === "auth" &&
      error.message === "Gemini CLI could not sign in: Google sign-in is not available for this account."
  );
  const refused = await getGeminiCliStatus(fakeGemini);
  assert.equal(refused.state, "sign-in-required");
  assert.match(refused.message, /not available for this account/);
  // Check again retries once with a prompt-less session; a refusal that holds keeps its reason.
  const stillRefused = await recheckGeminiCliStatus(fakeGemini, workspaceDir);
  assert.equal(stillRefused.state, "sign-in-required");
  assert.match(stillRefused.message, /not available for this account/);
  delete process.env.FAKE_GEMINI_REFUSE;
  // Signing in again: cached credentials don't make it connected while it runs or after it fails.
  assert.equal((await launchGeminiCliLogin(fakeGemini, workspaceDir)).state, "connecting");
  assert.equal((await getGeminiCliStatus(fakeGemini)).state, "connecting");
  let afterLogin;
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    afterLogin = await getGeminiCliStatus(fakeGemini);
    if (afterLogin.state !== "connecting") break;
  }
  assert.equal(afterLogin.state, "sign-in-required");
  assert.match(afterLogin.message, /Google sign-in did not finish: Google sign-in is not available/);
  // New credentials clear the refusal.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(path.join(geminiDir, "oauth_creds.json"), '{"fresh":true}');
  assert.equal((await getGeminiCliStatus(fakeGemini)).state, "connected");

  const refuseOnce = async () => {
    process.env.FAKE_GEMINI_REFUSE = "1";
    try {
      await assert.rejects(
        streamGeminiCliCompletion({
          executablePath: fakeGemini,
          workspaceDir,
          instructions: "x",
          messages: [{ role: "user", content: "hi" }],
          tools: [],
          signal: new AbortController().signal,
          onToken: () => undefined,
          onToolCall: async () => ""
        }),
        (error) => error.kind === "auth"
      );
    } finally {
      delete process.env.FAKE_GEMINI_REFUSE;
    }
  };

  // A passing refusal changes nothing on disk; Check again lifts it once a session starts.
  await refuseOnce();
  assert.equal((await getGeminiCliStatus(fakeGemini)).state, "sign-in-required");
  assert.equal((await recheckGeminiCliStatus(fakeGemini, workspaceDir)).state, "connected");

  // An API key setup is never switched to Google sign-in (that rewrites the CLI's settings).
  const apiKeySettings = '{ "security": { "auth": { "selectedType": "gemini-api-key" } } }';
  await writeFile(path.join(geminiDir, "settings.json"), apiKeySettings);
  await refuseOnce();
  const apiKeyLogin = await launchGeminiCliLogin(fakeGemini, workspaceDir);
  assert.equal(apiKeyLogin.state, "sign-in-required");
  assert.match(apiKeyLogin.message, /set up for your Gemini API key, so CorosLink won't switch it to Google sign-in/);
  assert.equal((await getGeminiCliStatus(fakeGemini)).state, "sign-in-required", "no sign-in started");
  assert.equal(await readFile(path.join(geminiDir, "settings.json"), "utf8"), apiKeySettings);
  await writeFile(
    path.join(geminiDir, "settings.json"),
    '{ "security": { "auth": { "selectedType": "oauth-personal" } } }'
  );

  // Cancelling ends the CLI process and reports a cancellation.
  const controller = new AbortController();
  process.env.FAKE_GEMINI_HANG = "1";
  const pending = streamGeminiCliCompletion({
    executablePath: fakeGemini,
    workspaceDir,
    instructions: "x",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    signal: controller.signal,
    onToken: () => controller.abort(),
    onToolCall: async () => ""
  });
  await assert.rejects(pending, (error) => error.kind === "cancelled");
  delete process.env.FAKE_GEMINI_HANG;

  console.log("gemini cli provider tests passed (helpers, sign-in state, ACP stream, tool bridge, models, refusals, recheck, API-key sign-in guard, cancel)");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

/** A stand-in `gemini` that answers ACP like the real CLI and calls the tool bridge. */
function fakeGeminiSource(root) {
  return `#!/usr/bin/env node
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const requireFromRepo = createRequire(${JSON.stringify(path.join(root, "package.json"))});
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("0.99.0"); process.exit(0); }
if (args.includes("--help")) { console.log("  --acp  Starts the agent in ACP mode"); process.exit(0); }
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
let mcp;
let nextId = 1000;
const waiting = new Map();
const checks = [];
if (args[0] === "--acp" && args.includes("--allowed-mcp-server-names") && args.includes("coroslink") && args.includes("none")) checks.push("args:ok");
const modelIndex = args.indexOf("--model");
if (modelIndex >= 0) checks.push("model:" + args[modelIndex + 1]);
async function handle(message) {
  if (message.id !== undefined && waiting.has(message.id)) { waiting.get(message.id)(message.result); return; }
  if (message.method === "initialize") return send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (message.method === "authenticate") {
    return setTimeout(() => send({ id: message.id, error: { code: -32000, message: "Google sign-in is not available for this account." } }), 1500);
  }
  if (message.method === "session/new") {
    if (process.env.FAKE_GEMINI_REFUSE) {
      process.stderr.write("Error authenticating: IneligibleTierError: Google sign-in is not available for this account.\\n");
      return send({ id: message.id, error: { code: -32000, message: "Authentication required" } });
    }
    const server = message.params.mcpServers[0];
    if (server) {
      const { Client } = requireFromRepo("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } = requireFromRepo("@modelcontextprotocol/sdk/client/streamableHttp.js");
      mcp = new Client({ name: "fake-gemini", version: "1" });
      const headers = Object.fromEntries(server.headers.map((header) => [header.name, header.value]));
      // Same length in characters as the real token, longer in bytes: refused, never a crash.
      const probe = await fetch(server.url, { method: "POST", headers: { authorization: "Bearer " + "\u00e9".repeat(headers.Authorization.length - 7) } });
      checks.push("probe:" + probe.status);
      await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
    }
    return send({ id: message.id, result: { sessionId: "s1", models: { currentModelId: "gemini-fake-pro", availableModels: [
      { modelId: "gemini-fake-pro", name: "Gemini Fake Pro" }, { modelId: "gemini-fake-flash", name: "Gemini Fake Flash" }
    ] } } });
  }
  if (message.method === "session/prompt") {
    const update = (value) => send({ method: "session/update", params: { sessionId: "s1", update: value } });
    if (process.env.FAKE_GEMINI_HANG) {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "..." } });
      return;
    }
    if (fs.readFileSync(process.env.GEMINI_SYSTEM_MD, "utf8") === "COACH INSTRUCTIONS") checks.push("system:ok");
    const settings = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".gemini", "settings.json"), "utf8"));
    if (settings.tools.core.length === 0 && settings.skills.enabled === false) checks.push("settings:ok");
    if (message.params.prompt.some((block) => block.type === "image" && block.data === "AAAA")) checks.push("image:ok");
    update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking the week" } });
    const tools = (await mcp.listTools()).tools.map((tool) => tool.name);
    checks.push("tools:" + tools.join(","));
    update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "get_weekly_mileage", status: "in_progress" });
    const result = await mcp.callTool({ name: "get_weekly_mileage", arguments: { unit: "km" } });
    const permission = await new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      send({ id, method: "session/request_permission", params: { sessionId: "s1", toolCall: { toolCallId: "t2", title: "rm -rf" }, options: [] } });
    });
    checks.push("permission:" + permission.outcome.outcome);
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
