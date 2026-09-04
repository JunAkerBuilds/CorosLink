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
const capture = (provider) => async (options) => {
  captured.push({ provider, instructions: options.instructions, fallback: options.fallbackInstructions });
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
    getAllMcpTools: () => [],
    getMcpServerCachedTools: () => []
  },
  "./chatWorkoutTools": { getChatWorkoutTools: () => [], isChatWorkoutTool: () => false },
  "./chatActivityTools": { getChatActivityTools: () => [], isChatActivityTool: () => false },
  "./chatAnalyticsTools": { getChatAnalyticsTools: () => [], isChatAnalyticsTool: () => false },
  "./chatHistoryStore": {},
  "./localChatProvider": { ...require("./localChatProvider"), streamLocalChatCompletion: capture("local") },
  "./openRouterProvider": { ...require("./openRouterProvider"), streamOpenRouterChatCompletion: capture("openrouter") },
  "./claudeCodeProvider": {
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
    captured.push({ provider: "chatgpt", instructions: JSON.parse(options.body).instructions });
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
    for (const prompt of [request.instructions, request.fallback].filter(Boolean)) {
      assert.match(prompt, /Never trigger a write until the athlete confirms/);
      if (preference) assert.ok(prompt.includes(preference), `${provider} dropped custom instructions`);
      else assert.ok(!prompt.includes("<athlete_custom_instructions>"), `${provider} retained cleared instructions`);
      if (preference !== "Only run on Tuesdays.") assert.ok(!prompt.includes("Only run on Tuesdays."));
    }
  }
}
console.log("chat instruction routing tests passed (all 4 providers, edits and clearing)");
