import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import path from "node:path";
import vm from "node:vm";

// Exercise the real streamChat routing and settings store without accounts,
// SQLite, subprocesses, or network access. Only external boundaries are stubbed.
const servicePath = path.resolve(import.meta.dirname, "../dist-electron/chatService.js");
const require = createRequire(servicePath);
const settings = new Map([
  ["chat.openRouter.apiKey", Buffer.from("test-only-key").toString("base64")],
  ["chat.oauthToken", Buffer.from(JSON.stringify({
    access_token: "test-only-token", expires_at: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64")]
]);
const captured = [];
const remoteTools = JSON.parse(readFileSync(new URL('./fixtures/coros-mcp-workout-schemas.json', import.meta.url))).tools;
const remoteCalls = [];
let requestedTool;
let expectedToolStatus = 'awaiting_confirmation';
const capture = (provider) => async (options) => {
  captured.push({ provider, instructions: options.instructions, fallback: options.fallbackInstructions, tools: options.tools });
  if (requestedTool) {
    const result = provider === 'claude-code'
      ? await options.onToolCall(requestedTool.name, requestedTool.args)
      : await options.onToolCall({ name: requestedTool.name, arguments: JSON.stringify(requestedTool.args) });
    assert.equal(JSON.parse(result).status, expectedToolStatus);
  }
  return { fullText: "Test response" };
};
const mocks = {
  electron: { safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: (buffer) => buffer.toString()
  } },
  "./database": {
    getSetting: (key) => settings.get(key),
    setSetting: (key, value) => settings.set(key, value),
    deleteSettings: (keys) => keys.forEach((key) => settings.delete(key))
  },
  "./trainingHubService": { getTrainingHubStatus: () => ({ authenticated: false }) },
  "./mcpClientManager": {
    ensureAllMcpConnected: async () => {},
    getMcpAuthorizationKey: () => 'test-authorization',
    getAllMcpTools: () => remoteTools,
    getMcpServerCachedTools: () => remoteTools.filter(t => t.name.startsWith('coros__')).map(t => ({ ...t, name: t.name.slice(7) })),
    callMcpTool: async (name, args) => { remoteCalls.push({ name, args }); return '{"status":"ok"}'; }
  },
  "./chatWorkoutTools": { getChatWorkoutTools: () => [], isChatWorkoutTool: () => false },
  "./chatActivityTools": { getChatActivityTools: () => [], isChatActivityTool: () => false },
  "./chatAnalyticsTools": { getChatAnalyticsTools: () => [], isChatAnalyticsTool: () => false },
  "./chatFitTools": { getChatFitTools: () => [], isChatFitTool: () => false },
  "./chatHistoryStore": {},
  "./localChatProvider": { ...require("./localChatProvider"), streamLocalChatCompletion: capture("local") },
  "./openRouterProvider": { ...require("./openRouterProvider"), streamOpenRouterChatCompletion: capture("openrouter") },
  "./claudeCodeProvider": {
    ClaudeCodeProviderError: class extends Error {},
    getClaudeCodeStatus: async () => ({ authenticated: true, installed: true, executablePath: "/test/claude", state: "connected" }),
    streamClaudeCodeCompletion: capture("claude-code")
  }
};
const module = { exports: {} };
vm.runInNewContext(readFileSync(servicePath, "utf8"), {
  exports: module.exports,
  require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
  Buffer, AbortController, TextDecoder, URLSearchParams, console, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    assert.equal(url, "https://chatgpt.com/backend-api/codex/responses");
    const body = JSON.parse(options.body);
    captured.push({ provider: "chatgpt", instructions: body.instructions, tools: body.tools });
    return new Response('data: {"type":"response.completed","response":{"output":[]}}\n\ndata: [DONE]\n\n');
  }
}, { filename: servicePath });

const events = [];
const window = Object.assign(new EventEmitter(), {
  isDestroyed: () => false,
  webContents: { send: (channel, payload) => events.push({ channel, payload }) }
});
const { streamChat, getChatSettings, saveChatSettings } = module.exports;

for (const provider of ["chatgpt", "openrouter", "local", "claude-code"]) {
  settings.set("chat.provider", provider);
  for (const preference of ["Only run on Tuesdays.", "Prefer cycling on Saturdays.", ""]) {
    saveChatSettings({ ...getChatSettings(), customInstructions: preference });
    events.length = 0;
    const before = captured.length;
    await streamChat(window, `${provider}-${before}`, [{ role: "user", content: "Plan my week." }]);
    assert.equal(events.find((event) => event.channel === "chat:streamError"), undefined, JSON.stringify(events));
    assert.ok(events.some((event) => event.channel === "chat:streamDone"), provider);
    assert.equal(captured.length, before + 1, provider);
    const request = captured.at(-1);
    assert.equal(request.provider, provider);
    assert.match(request.instructions, /REST DAY, never Strength/);
    const writeTool = request.tools.find(tool => tool.name === 'coros__createSingleWorkout');
    assert.ok(writeTool, `${provider} is missing official workout tools`);
    assert.ok((writeTool.inputSchema ?? writeTool.parameters).required.includes('review_summary'));
    for (const prompt of [request.instructions, request.fallback].filter(Boolean)) {
      assert.match(prompt, /Never trigger a write until the athlete confirms/);
      if (preference) assert.ok(prompt.includes(preference), `${provider} dropped custom instructions`);
      else assert.ok(!prompt.includes("<athlete_custom_instructions>"), `${provider} retained cleared instructions`);
      if (preference !== "Only run on Tuesdays.") assert.ok(!prompt.includes("Only run on Tuesdays."));
    }
  }
}

// One malformed write schema must not prevent any provider from starting a chat.
{
  const tool = remoteTools.find(tool => tool.name === 'coros__scheduleWorkout');
  const original = tool.inputSchema;
  const warn = console.warn;
  const warnings = [];
  try {
    tool.inputSchema = { type: 'object', $defs: { Section: { type: 'string' } }, properties: { course: { $defs: { Section: { type: 'number' } } } } };
    console.warn = message => warnings.push(message);
    for (const provider of ['chatgpt', 'openrouter', 'local', 'claude-code']) {
      settings.set('chat.provider', provider);
      events.length = 0;
      await streamChat(window, `${provider}-invalid-schema`, [{ role: 'user', content: 'How is my training?' }]);
      assert.ok(events.some(event => event.channel === 'chat:streamDone'), provider);
      assert.equal(events.find(event => event.channel === 'chat:streamError'), undefined);
      assert.ok(!captured.at(-1).tools.some(candidate => candidate.name === tool.name));
      assert.ok(captured.at(-1).tools.some(candidate => candidate.name === 'coros__createSingleWorkout'));
      assert.ok(captured.at(-1).tools.some(candidate => candidate.name === 'coros__queryWorkoutDetails'));
    }
    assert.ok(warnings.length >= 4);
  } finally { tool.inputSchema = original; console.warn = warn; }
}

// Exercise the production dispatch boundary: model tool calls must create a card, never write directly.
settings.set('corosMcp.tokens', 'fixture-connection-identity');
requestedTool = { name: 'coros__createSingleWorkout', args: {
  review_summary: 'Save a short easy run in your library.',
  course: { courseName: 'Easy run', courseDescription: 'Run at an easy heart rate.', sportType: 1,
    sections: [{ sectionType: 2, targetType: 2, targetValue: 600, intensityType: 1, sectionIntensity: 1 }] }
} };
for (const provider of ['openrouter', 'local', 'claude-code']) {
  settings.set('chat.provider', provider); events.length = 0;
  await streamChat(window, `${provider}-review`, [{ role: 'user', content: 'Save an easy run in my library.' }]);
  assert.equal(events.find(event => event.channel === 'chat:streamError'), undefined, JSON.stringify(events));
  assert.ok(events.some(event => event.payload.kind === 'corosAction'), provider);
  assert.equal(remoteCalls.length, 0, 'No account write before the review button');
}
const settingsBefore = getChatSettings();
saveChatSettings({ ...settingsBefore, claudeCode: { ...settingsBefore.claudeCode,
  permissions: { ...settingsBefore.claudeCode.permissions, upcomingWorkouts: false } } });
events.length = 0;
await streamChat(window, 'claude-denied', [{ role: 'user', content: 'Make a workout.' }]);
assert.ok(events.some(event => event.channel === 'chat:streamError'));
assert.equal(remoteCalls.length, 0);
assert.ok(!captured.at(-1).tools.some(tool => tool.name === requestedTool.name));
// Hevy tools reach every provider and dispatch through the generic MCP manager.
requestedTool = undefined;
const hevyTool = {
  name: 'hevy__get-routines',
  description: 'List Hevy routines',
  inputSchema: { type: 'object', properties: { page: { type: 'integer' } } }
};
remoteTools.push(hevyTool);
for (const provider of ['chatgpt', 'openrouter', 'local', 'claude-code']) {
  settings.set('chat.provider', provider);
  events.length = 0;
  await streamChat(window, `${provider}-hevy`, [{ role: 'user', content: 'List my Hevy routines.' }]);
  assert.equal(events.find(event => event.channel === 'chat:streamError'), undefined, JSON.stringify(events));
  assert.ok(captured.at(-1).tools.some(tool => tool.name === hevyTool.name), provider);
  assert.match(captured.at(-1).instructions, /For requests targeting Hevy, use these tools rather than COROS/);
  assert.match(captured.at(-1).instructions, /never invented sets or times/);
}
expectedToolStatus = 'ok';
requestedTool = { name: hevyTool.name, args: { page: 1 } };
for (const provider of ['openrouter', 'local', 'claude-code']) {
  settings.set('chat.provider', provider);
  events.length = 0;
  const before = remoteCalls.length;
  await streamChat(window, `${provider}-hevy-dispatch`, [{ role: 'user', content: 'List my Hevy routines.' }]);
  assert.equal(events.find(event => event.channel === 'chat:streamError'), undefined, JSON.stringify(events));
  assert.equal(remoteCalls.length, before + 1);
  assert.equal(remoteCalls.at(-1).name, hevyTool.name);
  assert.equal(remoteCalls.at(-1).args.page, 1);
}
remoteTools.pop();
requestedTool = undefined;
settings.set('chat.provider', 'local');
await streamChat(window, 'hevy-disconnected', [{ role: 'user', content: 'List my Hevy routines.' }]);
assert.ok(!captured.at(-1).tools.some(tool => tool.name.startsWith('hevy__')));
assert.ok(!captured.at(-1).instructions.includes('Hevy tools (hevy__ prefix)'));
console.log("chat instruction routing tests passed (all 4 providers, COROS reviews, Hevy discovery/dispatch/disconnect)");
